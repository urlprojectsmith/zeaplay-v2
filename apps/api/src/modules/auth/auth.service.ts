import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AgencyStatus,
  GamificationAdminEconomy,
  MembershipStatus,
  Prisma,
  SecurityStepUpPurpose,
  SuperAgencyStatus,
  UserStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { JwtTokenService } from '../../common/auth/jwt.service';
import { PasswordService } from '../../common/auth/password.service';

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

interface CreateGamificationResetStepUpGrantInput {
  userId: string;
  refreshToken: string;
  workspaceId: string;
  targetMembershipId: string;
  economy: GamificationAdminEconomy;
  password: string;
  meta?: RequestMeta;
}

interface StartEmailOtpStepUpInput extends CreateGamificationResetStepUpGrantInput {
  tenant: WorkspaceTenantContext;
  purpose: SecurityStepUpPurpose;
}

interface VerifyEmailOtpStepUpInput {
  tenant: WorkspaceTenantContext;
  userId: string;
  refreshToken: string;
  challengeId: string;
  code: string;
  meta?: RequestMeta;
}

const STEP_UP_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: JwtTokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
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
      superAgencies: profile.superAgencies,
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
        superAgencyMemberships: {
          where: {
            status: MembershipStatus.ACTIVE,
            superAgency: { status: 'ACTIVE' },
          },
          select: {
            id: true,
            superAgency: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                agencies: {
                  select: { id: true, name: true, slug: true, status: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
            role: { select: { key: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
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
                    timezone: true,
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
      superAgencies: mapSuperAgencyMemberships(user.superAgencyMemberships),
      agencies: mapAgencyMemberships(user.agencyMemberships),
    };
  }

  async createGamificationResetStepUpGrant(input: CreateGamificationResetStepUpGrantInput) {
    await this.verifyGamificationResetPassword(input);
    return {
      passwordVerified: true,
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: input.economy,
      targetMembershipId: input.targetMembershipId,
    };
  }

  async startEmailOtpStepUp(input: StartEmailOtpStepUpInput) {
    assertTenantPermission(input.tenant, PermissionKeys.gamificationReset);
    if (input.purpose !== SecurityStepUpPurpose.GAMIFICATION_RESET)
      throw new BadRequestException('OTP_PURPOSE_INVALID');
    const { session, user } = await this.verifyGamificationResetPassword(input);
    await this.assertOtpSendAllowed(input.userId, session.id, input.meta?.ipAddress);
    const recent = await this.prisma.securityOtpChallenge.findFirst({
      where: this.activeOtpContextWhere(input.userId, session.id, input),
      orderBy: { lastSentAt: 'desc' },
      select: { lastSentAt: true },
    });
    const now = new Date();
    if (
      recent &&
      recent.lastSentAt.getTime() + this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000 > now.getTime()
    ) {
      throw new HttpException('OTP_RESEND_COOLDOWN', HttpStatus.TOO_MANY_REQUESTS);
    }
    const challengeId = randomUUID();
    const code = generateOtpCode();
    const expiresAt = new Date(
      now.getTime() + Math.min(this.env.OTP_TTL_SECONDS, STEP_UP_TTL_MS / 1000) * 1000,
    );
    const resendAvailableAt = new Date(now.getTime() + this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000);
    const otpDigest = this.createOtpDigest({
      challengeId,
      userId: input.userId,
      refreshTokenId: session.id,
      purpose: input.purpose,
      code,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.securityOtpChallenge.updateMany({
        where: this.activeOtpContextWhere(input.userId, session.id, input),
        data: { invalidatedAt: now },
      });
      await tx.securityOtpChallenge.create({
        data: {
          id: challengeId,
          userId: input.userId,
          refreshTokenId: session.id,
          workspaceId: input.workspaceId,
          targetMembershipId: input.targetMembershipId,
          purpose: input.purpose,
          economy: input.economy,
          otpDigest,
          maxAttempts: this.env.OTP_MAX_VERIFY_ATTEMPTS,
          lastSentAt: now,
          expiresAt,
        },
      });
    });

    try {
      await this.mail.sendSecurityOtp({
        to: user.email,
        code,
        expiresInMinutes: Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000),
      });
    } catch {
      await this.prisma.securityOtpChallenge.updateMany({
        where: { id: challengeId, consumedAt: null },
        data: { invalidatedAt: new Date() },
      });
      throw new HttpException('OTP_DELIVERY_FAILED', HttpStatus.BAD_GATEWAY);
    }

    await this.registerOtpSend(input.userId, session.id, input.meta?.ipAddress);
    await this.audit.record({
      userId: input.userId,
      workspaceId: input.workspaceId,
      action: 'security.step_up_otp_requested',
      entityType: 'SecurityOtpChallenge',
      entityId: challengeId,
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
      metadata: {
        purpose: input.purpose,
        economy: input.economy,
        targetMembershipId: input.targetMembershipId,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      challengeId,
      expiresAt,
      resendAvailableAt,
      maskedDestination: maskEmail(user.email),
      purpose: input.purpose,
      economy: input.economy,
      targetMembershipId: input.targetMembershipId,
    };
  }

  async verifyEmailOtpStepUp(input: VerifyEmailOtpStepUpInput) {
    assertTenantPermission(input.tenant, PermissionKeys.gamificationReset);
    await this.assertOtpVerifyAllowed(input.userId, input.challengeId, input.meta?.ipAddress);
    const session = await this.getActiveRefreshSession(input.userId, input.refreshToken);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM security_otp_challenges
        WHERE id = ${input.challengeId}::uuid
        FOR UPDATE
      `);
      const challenge = await tx.securityOtpChallenge.findUnique({
        where: { id: input.challengeId },
      });
      if (
        !challenge ||
        challenge.userId !== input.userId ||
        challenge.refreshTokenId !== session.id ||
        challenge.workspaceId !== input.tenant.workspaceId ||
        challenge.purpose !== SecurityStepUpPurpose.GAMIFICATION_RESET ||
        challenge.consumedAt ||
        challenge.invalidatedAt
      ) {
        throw new UnauthorizedException('OTP_CHALLENGE_INVALID');
      }
      if (challenge.expiresAt <= now) {
        await tx.securityOtpChallenge.update({
          where: { id: challenge.id },
          data: { invalidatedAt: now },
        });
        throw new UnauthorizedException('OTP_EXPIRED');
      }
      if (challenge.attemptCount >= challenge.maxAttempts) {
        throw new UnauthorizedException('OTP_ATTEMPTS_EXCEEDED');
      }
      const expectedDigest = this.createOtpDigest({
        challengeId: challenge.id,
        userId: challenge.userId,
        refreshTokenId: challenge.refreshTokenId,
        purpose: challenge.purpose,
        code: input.code,
      });
      if (!timingSafeDigestEqual(challenge.otpDigest, expectedDigest)) {
        const attemptCount = challenge.attemptCount + 1;
        await tx.securityOtpChallenge.update({
          where: { id: challenge.id },
          data: {
            attemptCount,
            ...(attemptCount >= challenge.maxAttempts ? { invalidatedAt: now } : {}),
          },
        });
        await this.registerOtpVerifyFailure(input.userId, input.challengeId, input.meta?.ipAddress);
        await this.audit.record({
          userId: input.userId,
          workspaceId: challenge.workspaceId,
          action: 'security.step_up_otp_failed',
          entityType: 'SecurityOtpChallenge',
          entityId: challenge.id,
          ipAddress: input.meta?.ipAddress,
          userAgent: input.meta?.userAgent,
          metadata: {
            purpose: challenge.purpose,
            economy: challenge.economy,
            targetMembershipId: challenge.targetMembershipId,
            attemptCount,
          },
        });
        throw new UnauthorizedException('OTP_INVALID');
      }
      const grant = await tx.securityStepUpGrant.create({
        data: {
          userId: input.userId,
          refreshTokenId: session.id,
          workspaceId: challenge.workspaceId,
          targetMembershipId: challenge.targetMembershipId,
          purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
          economy: challenge.economy,
          expiresAt: new Date(now.getTime() + STEP_UP_TTL_MS),
        },
        select: {
          id: true,
          expiresAt: true,
          purpose: true,
          economy: true,
          targetMembershipId: true,
        },
      });
      await tx.securityOtpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
      await tx.auditLog.create({
        data: {
          superAgencyId: input.tenant.superAgencyId,
          agencyId: input.tenant.agencyId,
          userId: input.userId,
          workspaceId: challenge.workspaceId,
          action: 'security.step_up_otp_verified',
          entityType: 'SecurityOtpChallenge',
          entityId: challenge.id,
          metadata: {
            purpose: challenge.purpose,
            economy: challenge.economy,
            targetMembershipId: challenge.targetMembershipId,
          },
        },
      });
      return grant;
    });
  }

  private async verifyGamificationResetPassword(input: CreateGamificationResetStepUpGrantInput) {
    await this.assertStepUpAllowed(input.userId, input.meta?.ipAddress);
    const session = await this.getActiveRefreshSession(input.userId, input.refreshToken);
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, passwordHash: true, status: true },
    });
    if (
      !user ||
      user.status !== UserStatus.ACTIVE ||
      !this.passwords.verify(user.passwordHash, input.password)
    ) {
      await this.registerStepUpFailure(input.userId, input.meta?.ipAddress);
      throw new UnauthorizedException('STEP_UP_VERIFICATION_FAILED');
    }
    await this.clearStepUpFailures(input.userId, input.meta?.ipAddress);
    const target = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: input.targetMembershipId,
        workspaceId: input.workspaceId,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!target) throw new ForbiddenException('TARGET_MEMBERSHIP_NOT_FOUND');
    await this.audit.record({
      userId: input.userId,
      workspaceId: input.workspaceId,
      action: 'auth.step_up.password_verified',
      entityType: 'User',
      entityId: input.userId,
      ipAddress: input.meta?.ipAddress,
      userAgent: input.meta?.userAgent,
      metadata: {
        purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
        economy: input.economy,
        targetMembershipId: input.targetMembershipId,
      },
    });
    return { session, user };
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

  private async getActiveRefreshSession(userId: string, refreshToken: string) {
    const session = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.createTokenHash(refreshToken) },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('STEP_UP_SESSION_INVALID');
    }
    return session;
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

  private async assertStepUpAllowed(userId: string, ipAddress?: string) {
    const key = this.stepUpFailureKey(userId, ipAddress);
    const attempts = Number((await this.redis.rateLimit.get(key)) ?? 0);
    if (attempts >= this.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many verification attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registerStepUpFailure(userId: string, ipAddress?: string) {
    const key = this.stepUpFailureKey(userId, ipAddress);
    const count = await this.redis.rateLimit.incr(key);
    if (count === 1)
      await this.redis.rateLimit.expire(key, this.env.LOGIN_RATE_LIMIT_WINDOW_SECONDS);
  }

  private async clearStepUpFailures(userId: string, ipAddress?: string) {
    await this.redis.rateLimit.del(this.stepUpFailureKey(userId, ipAddress));
  }

  private stepUpFailureKey(userId: string, ipAddress = 'unknown') {
    return `auth:step-up:${ipAddress}:${userId}`;
  }

  private activeOtpContextWhere(
    userId: string,
    refreshTokenId: string,
    input: {
      workspaceId: string;
      targetMembershipId: string;
      purpose: SecurityStepUpPurpose;
      economy: GamificationAdminEconomy;
    },
  ) {
    return {
      userId,
      refreshTokenId,
      workspaceId: input.workspaceId,
      targetMembershipId: input.targetMembershipId,
      purpose: input.purpose,
      economy: input.economy,
      consumedAt: null,
      invalidatedAt: null,
      expiresAt: { gt: new Date() },
    };
  }

  private createOtpDigest(input: {
    challengeId: string;
    userId: string;
    refreshTokenId: string;
    purpose: SecurityStepUpPurpose;
    code: string;
  }) {
    return createHmac('sha256', this.env.OTP_PEPPER)
      .update(
        [input.challengeId, input.userId, input.refreshTokenId, input.purpose, input.code].join(
          ':',
        ),
      )
      .digest('hex');
  }

  private async assertOtpSendAllowed(userId: string, refreshTokenId: string, ipAddress?: string) {
    const key = this.otpSendRateKey(userId, refreshTokenId, ipAddress);
    const attempts = Number((await this.redis.rateLimit.get(key)) ?? 0);
    if (attempts >= this.env.OTP_SEND_RATE_LIMIT_MAX) {
      throw new HttpException('OTP_SEND_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async registerOtpSend(userId: string, refreshTokenId: string, ipAddress?: string) {
    const key = this.otpSendRateKey(userId, refreshTokenId, ipAddress);
    const count = await this.redis.rateLimit.incr(key);
    if (count === 1)
      await this.redis.rateLimit.expire(key, this.env.OTP_SEND_RATE_LIMIT_WINDOW_SECONDS);
  }

  private otpSendRateKey(userId: string, refreshTokenId: string, ipAddress = 'unknown') {
    return `auth:otp-send:${ipAddress}:${userId}:${refreshTokenId}`;
  }

  private async assertOtpVerifyAllowed(userId: string, challengeId: string, ipAddress?: string) {
    const key = this.otpVerifyRateKey(userId, challengeId, ipAddress);
    const attempts = Number((await this.redis.rateLimit.get(key)) ?? 0);
    if (attempts >= this.env.OTP_VERIFY_RATE_LIMIT_MAX) {
      throw new HttpException('OTP_VERIFY_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async registerOtpVerifyFailure(userId: string, challengeId: string, ipAddress?: string) {
    const key = this.otpVerifyRateKey(userId, challengeId, ipAddress);
    const count = await this.redis.rateLimit.incr(key);
    if (count === 1)
      await this.redis.rateLimit.expire(key, this.env.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS);
  }

  private otpVerifyRateKey(userId: string, challengeId: string, ipAddress = 'unknown') {
    return `auth:otp-verify:${ipAddress}:${userId}:${challengeId}`;
  }
}

function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function timingSafeDigestEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

function assertTenantPermission(tenant: WorkspaceTenantContext, permission: string) {
  if (!tenant.permissions.includes('*') && !tenant.permissions.includes(permission)) {
    throw new ForbiddenException('PERMISSION_DENIED');
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
        timezone: string;
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
      timezone: workspace.timezone,
      status: workspace.status,
      membershipId: workspace.memberships[0]?.id ?? null,
      role: workspace.memberships[0]?.role.key ?? null,
    })),
  }));
}

function mapSuperAgencyMemberships(
  memberships: {
    id: string;
    role: { key: string };
    superAgency: {
      id: string;
      name: string;
      slug: string;
      status: SuperAgencyStatus;
      agencies: {
        id: string;
        name: string;
        slug: string;
        status: AgencyStatus;
      }[];
    };
  }[],
) {
  return memberships.map((membership) => ({
    membershipId: membership.id,
    role: membership.role.key,
    id: membership.superAgency.id,
    name: membership.superAgency.name,
    slug: membership.superAgency.slug,
    status: membership.superAgency.status,
    agencies: membership.superAgency.agencies,
  }));
}
