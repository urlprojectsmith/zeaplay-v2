import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { AgencyStatus, MembershipStatus, UserStatus, WorkspaceStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { JwtTokenService } from '../../common/auth/jwt.service';
import { PasswordService } from '../../common/auth/password.service';

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: JwtTokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async login(emailInput: string, password: string, meta: RequestMeta = {}) {
    const email = emailInput.trim().toLowerCase();
    await this.assertLoginAllowed(email, meta.ipAddress);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        status: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.registerLoginFailure(email, meta.ipAddress);
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordMatches = this.passwords.verify(user.passwordHash, password);
    if (!passwordMatches) {
      await this.registerLoginFailure(email, meta.ipAddress);
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.clearLoginFailures(email, meta.ipAddress);
    const tokenPair = await this.issueTokenPair(user.id);
    await this.audit.record({
      userId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const profile = await this.me(user.id);
    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      csrfToken: tokenPair.csrfToken,
      user: { id: user.id, email: user.email, name: user.name },
      agencies: profile.agencies,
    };
  }

  async refresh(refreshToken: string, csrfToken: string, meta: RequestMeta = {}) {
    const tokenHash = this.tokens.createTokenHash(refreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        csrfTokenHash: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { email: true, status: true } },
      },
    });

    if (
      !existing ||
      existing.expiresAt <= new Date() ||
      existing.user.status !== UserStatus.ACTIVE ||
      existing.csrfTokenHash !== this.tokens.createTokenHash(csrfToken)
    ) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        userId: existing.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'RefreshToken',
        entityId: existing.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const nextRefreshToken = this.tokens.createRefreshToken();
    const nextCsrfToken = this.tokens.createCsrfToken();
    const nextHash = this.tokens.createTokenHash(nextRefreshToken);
    const nextId = randomUUID();
    const now = new Date();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const update = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now, replacedBy: nextId },
      });
      if (update.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          id: nextId,
          userId: existing.userId,
          tokenHash: nextHash,
          csrfTokenHash: this.tokens.createTokenHash(nextCsrfToken),
          familyId: existing.familyId,
          expiresAt: this.tokens.createRefreshExpiry(),
        },
      });
      return true;
    });
    if (!rotated) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        userId: existing.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'RefreshToken',
        entityId: existing.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid refresh token.');
    }

    await this.audit.record({
      userId: existing.userId,
      action: 'auth.refresh',
      entityType: 'RefreshToken',
      entityId: nextId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      accessToken: this.tokens.signAccessToken({ id: existing.userId, email: existing.user.email }),
      refreshToken: nextRefreshToken,
      csrfToken: nextCsrfToken,
    };
  }

  async logout(
    userId: string,
    refreshToken: string | undefined,
    csrfToken: string | undefined,
    meta: RequestMeta = {},
  ) {
    if (refreshToken && csrfToken) {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          tokenHash: this.tokens.createTokenHash(refreshToken),
          csrfTokenHash: this.tokens.createTokenHash(csrfToken),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit.record({
      userId,
      action: 'auth.logout',
      entityType: 'User',
      entityId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        agencyMemberships: {
          where: {
            status: MembershipStatus.ACTIVE,
            agency: { status: AgencyStatus.ACTIVE },
          },
          select: {
            id: true,
            agency: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                workspaces: {
                  where: { status: WorkspaceStatus.ACTIVE },
                  select: {
                    id: true,
                    agencyId: true,
                    name: true,
                    slug: true,
                    status: true,
                    memberships: {
                      where: { userId, status: MembershipStatus.ACTIVE },
                      select: { id: true, role: { select: { key: true } } },
                    },
                  },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
            role: { select: { key: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      agencies: mapAgencyMemberships(user.agencyMemberships),
    };
  }

  private async issueTokenPair(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true },
    });
    const refreshToken = this.tokens.createRefreshToken();
    const csrfToken = this.tokens.createCsrfToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.tokens.createTokenHash(refreshToken),
        csrfTokenHash: this.tokens.createTokenHash(csrfToken),
        familyId: randomUUID(),
        expiresAt: this.tokens.createRefreshExpiry(),
      },
    });
    return {
      accessToken: this.tokens.signAccessToken({ id: user.id, email: user.email }),
      refreshToken,
      csrfToken,
    };
  }

  private async assertLoginAllowed(email: string, ipAddress?: string) {
    const key = this.loginFailureKey(email, ipAddress);
    const attempts = Number((await this.redis.rateLimit.get(key)) ?? 0);
    if (attempts >= this.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many login attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registerLoginFailure(email: string, ipAddress?: string) {
    const key = this.loginFailureKey(email, ipAddress);
    const count = await this.redis.rateLimit.incr(key);
    if (count === 1)
      await this.redis.rateLimit.expire(key, this.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS);
  }

  private async clearLoginFailures(email: string, ipAddress?: string) {
    await this.redis.rateLimit.del(this.loginFailureKey(email, ipAddress));
  }

  private loginFailureKey(email: string, ipAddress = 'unknown') {
    return `auth:login:${ipAddress}:${email}`;
  }
}

function mapAgencyMemberships(
  memberships: {
    id: string;
    role: { key: string };
    agency: {
      id: string;
      name: string;
      slug: string;
      status: AgencyStatus;
      workspaces: {
        id: string;
        agencyId: string;
        name: string;
        slug: string;
        status: WorkspaceStatus;
        memberships: { id: string; role: { key: string } }[];
      }[];
    };
  }[],
) {
  return memberships.map((membership) => ({
    membershipId: membership.id,
    role: membership.role.key,
    id: membership.agency.id,
    name: membership.agency.name,
    slug: membership.agency.slug,
    status: membership.agency.status,
    workspaces: membership.agency.workspaces.map((workspace) => ({
      id: workspace.id,
      agencyId: workspace.agencyId,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      membershipId: workspace.memberships[0]?.id ?? null,
      role: workspace.memberships[0]?.role.key ?? null,
    })),
  }));
}
