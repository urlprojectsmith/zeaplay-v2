import { UnauthorizedException } from '@nestjs/common';
import {
  GamificationAdminEconomy,
  MembershipStatus,
  SecurityStepUpPurpose,
  UserStatus,
} from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  beforeEach(() => {
    process.env = {
      ...process.env,
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000/api/v1',
      DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
      DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_CACHE_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: 'redis://localhost:6380',
      REDIS_REALTIME_URL: 'redis://localhost:6381',
      REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      MINIO_ENDPOINT: 'localhost',
      MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
      MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
      MINIO_BUCKET: 'zea-play-dev',
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'no-reply@example.com',
      RESEND_API_KEY: 'test-resend-api-key',
      OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    };
  });

  it('uses a generic login failure message', async () => {
    const service = new AuthService(
      { user: { findUnique: jest.fn().mockResolvedValue(null) } } as never,
      {
        rateLimit: {
          get: jest.fn().mockResolvedValue(null),
          incr: jest.fn().mockResolvedValue(1),
          expire: jest.fn().mockResolvedValue(1),
        },
      } as never,
      {} as never,
      { verify: jest.fn() } as never,
      { record: jest.fn() } as never,
      { sendSecurityOtp: jest.fn() } as never,
    );

    await expect(service.login('missing@zeaplay.test', 'DevelopmentPassword123!')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('does not create a final reset grant from password verification alone', async () => {
    const { service, prisma, passwords, tokens, audit, redis } = createServiceHarness();

    const result = await service.createGamificationResetStepUpGrant({
      userId: 'user-1',
      refreshToken: 'refresh-token',
      workspaceId: 'workspace-1',
      targetMembershipId: 'membership-2',
      economy: GamificationAdminEconomy.XP,
      password: 'DevelopmentPassword123!',
      meta: { ipAddress: '127.0.0.1', userAgent: 'jest' },
    });

    expect(result).toMatchObject({
      passwordVerified: true,
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.XP,
      targetMembershipId: 'membership-2',
    });
    expect(tokens.createTokenHash).toHaveBeenCalledWith('refresh-token');
    expect(passwords.verify).toHaveBeenCalledWith('hash', 'DevelopmentPassword123!');
    expect(redis.rateLimit.del).toHaveBeenCalledWith('auth:step-up:127.0.0.1:user-1');
    expect(prisma.securityStepUpGrant.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.step_up.password_verified',
        workspaceId: 'workspace-1',
        metadata: expect.objectContaining({
          targetMembershipId: 'membership-2',
          economy: GamificationAdminEconomy.XP,
        }),
      }),
    );
  });

  it('creates a final reset grant only after email OTP verification', async () => {
    const { service, prisma, mail, challenges } = createServiceHarness();
    const tenant = resetTenant();

    const challenge = await service.startEmailOtpStepUp({
      tenant,
      userId: 'user-1',
      refreshToken: 'refresh-token',
      workspaceId: 'workspace-1',
      targetMembershipId: 'membership-2',
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.XP,
      password: 'DevelopmentPassword123!',
      meta: { ipAddress: '127.0.0.1', userAgent: 'jest' },
    });
    const sentCode = mail.sendSecurityOtp.mock.calls[0]?.[0]?.code;

    expect(challenge).toMatchObject({
      maskedDestination: 'o***@zeaplay.test',
      economy: GamificationAdminEconomy.XP,
      targetMembershipId: 'membership-2',
    });
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(String(challenges[0]?.otpDigest)).not.toContain(sentCode);
    expect(mail.sendSecurityOtp).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@zeaplay.test' }),
    );

    const grant = await service.verifyEmailOtpStepUp({
      tenant,
      userId: 'user-1',
      refreshToken: 'refresh-token',
      challengeId: challenge.challengeId,
      code: sentCode,
    });

    expect(grant).toMatchObject({
      id: 'step-up-1',
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.XP,
      targetMembershipId: 'membership-2',
    });
    expect(prisma.securityStepUpGrant.create).toHaveBeenCalled();
    expect(challenges[0]?.consumedAt).toBeInstanceOf(Date);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'security.step_up_otp_verified',
          metadata: expect.not.objectContaining({ stepUpGrantId: expect.any(String) }),
        }),
      }),
    );

    await expect(
      service.verifyEmailOtpStepUp({
        tenant,
        userId: 'user-1',
        refreshToken: 'refresh-token',
        challengeId: challenge.challengeId,
        code: sentCode,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('enforces resend cooldown and rotates the active OTP for the same reset context', async () => {
    const { service, challenges, mail } = createServiceHarness();
    const tenant = resetTenant();

    const first = await service.startEmailOtpStepUp({
      tenant,
      userId: 'user-1',
      refreshToken: 'refresh-token',
      workspaceId: 'workspace-1',
      targetMembershipId: 'membership-2',
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.XP,
      password: 'DevelopmentPassword123!',
    });
    const firstCode = mail.sendSecurityOtp.mock.calls[0]?.[0]?.code;

    await expect(
      service.startEmailOtpStepUp({
        tenant,
        userId: 'user-1',
        refreshToken: 'refresh-token',
        workspaceId: 'workspace-1',
        targetMembershipId: 'membership-2',
        purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
        economy: GamificationAdminEconomy.XP,
        password: 'DevelopmentPassword123!',
      }),
    ).rejects.toThrow('OTP_RESEND_COOLDOWN');

    challenges[0]!.lastSentAt = new Date(Date.now() - 120_000);
    const second = await service.startEmailOtpStepUp({
      tenant,
      userId: 'user-1',
      refreshToken: 'refresh-token',
      workspaceId: 'workspace-1',
      targetMembershipId: 'membership-2',
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.XP,
      password: 'DevelopmentPassword123!',
    });

    expect(second.challengeId).not.toBe(first.challengeId);
    expect(challenges.find((item) => item.id === first.challengeId)?.invalidatedAt).toBeInstanceOf(
      Date,
    );
    await expect(
      service.verifyEmailOtpStepUp({
        tenant,
        userId: 'user-1',
        refreshToken: 'refresh-token',
        challengeId: first.challengeId,
        code: firstCode,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects expired OTPs, enforces max attempts, and rejects wrong sessions or Workspaces', async () => {
    const { service, challenges } = createServiceHarness();
    const tenant = resetTenant();

    const challenge = await service.startEmailOtpStepUp({
      tenant,
      userId: 'user-1',
      refreshToken: 'refresh-token',
      workspaceId: 'workspace-1',
      targetMembershipId: 'membership-2',
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.REWARD_POINTS,
      password: 'DevelopmentPassword123!',
    });
    challenges[0]!.expiresAt = new Date(Date.now() - 1_000);
    await expect(
      service.verifyEmailOtpStepUp({
        tenant,
        userId: 'user-1',
        refreshToken: 'refresh-token',
        challengeId: challenge.challengeId,
        code: '000000',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(challenges[0]?.invalidatedAt).toBeInstanceOf(Date);

    challenges.length = 0;
    const attemptChallenge = await service.startEmailOtpStepUp({
      tenant,
      userId: 'user-1',
      refreshToken: 'refresh-token',
      workspaceId: 'workspace-1',
      targetMembershipId: 'membership-2',
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.XP,
      password: 'DevelopmentPassword123!',
    });
    challenges[0]!.maxAttempts = 2;
    await expect(
      service.verifyEmailOtpStepUp({
        tenant,
        userId: 'user-1',
        refreshToken: 'refresh-token',
        challengeId: attemptChallenge.challengeId,
        code: '000000',
      }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.verifyEmailOtpStepUp({
        tenant,
        userId: 'user-1',
        refreshToken: 'refresh-token',
        challengeId: attemptChallenge.challengeId,
        code: '111111',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(challenges[0]).toMatchObject({ attemptCount: 2 });
    expect(challenges[0]?.invalidatedAt).toBeInstanceOf(Date);

    challenges.length = 0;
    const boundChallenge = await service.startEmailOtpStepUp({
      tenant,
      userId: 'user-1',
      refreshToken: 'refresh-token',
      workspaceId: 'workspace-1',
      targetMembershipId: 'membership-2',
      purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
      economy: GamificationAdminEconomy.XP,
      password: 'DevelopmentPassword123!',
    });
    await expect(
      service.verifyEmailOtpStepUp({
        tenant,
        userId: 'user-1',
        refreshToken: 'other-refresh-token',
        challengeId: boundChallenge.challengeId,
        code: '000000',
      }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.verifyEmailOtpStepUp({
        tenant: { ...tenant, workspaceId: 'workspace-2' },
        userId: 'user-1',
        refreshToken: 'refresh-token',
        challengeId: boundChallenge.challengeId,
        code: '000000',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects bad step-up passwords without creating a grant or OTP challenge', async () => {
    const { service, prisma, passwords, redis, mail } = createServiceHarness();
    passwords.verify.mockReturnValue(false);

    await expect(
      service.startEmailOtpStepUp({
        tenant: resetTenant(),
        userId: 'user-1',
        refreshToken: 'refresh-token',
        workspaceId: 'workspace-1',
        targetMembershipId: 'membership-2',
        purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
        economy: GamificationAdminEconomy.REWARD_POINTS,
        password: 'wrong-password',
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(redis.rateLimit.incr).toHaveBeenCalledWith('auth:step-up:unknown:user-1');
    expect(prisma.securityStepUpGrant.create).not.toHaveBeenCalled();
    expect(prisma.securityOtpChallenge.create).not.toHaveBeenCalled();
    expect(mail.sendSecurityOtp).not.toHaveBeenCalled();
  });
});

function createServiceHarness() {
  const expiresAt = new Date(Date.now() + 60_000);
  const challenges: Array<Record<string, unknown>> = [];
  type PrismaHarness = {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    refreshToken: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    workspaceMembership: { findFirst: jest.Mock };
    securityOtpChallenge: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    securityStepUpGrant: { create: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  const prisma = {} as PrismaHarness;
  Object.assign(prisma, {
    $transaction: jest.fn((callback: (tx: PrismaHarness) => unknown) => callback(prisma)),
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'challenge-1' }]),
    refreshToken: {
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          where.tokenHash === 'hash:refresh-token'
            ? {
                id: 'refresh-session-1',
                userId: 'user-1',
                expiresAt,
                revokedAt: null,
              }
            : null,
        ),
      ),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'owner@zeaplay.test',
        passwordHash: 'hash',
        status: UserStatus.ACTIVE,
      }),
    },
    workspaceMembership: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'membership-2',
        status: MembershipStatus.ACTIVE,
      }),
    },
    securityOtpChallenge: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          challenges
            .filter((item) => matchesOtpWhere(item, where))
            .sort(
              (left, right) =>
                (right.lastSentAt as Date).getTime() - (left.lastSentAt as Date).getTime(),
            )[0] ?? null,
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(challenges.find((item) => item.id === where.id) ?? null),
      ),
      updateMany: jest.fn(({ where, data }: { where: Record<string, unknown>; data: object }) => {
        let count = 0;
        for (const challenge of challenges) {
          if (!matchesOtpWhere(challenge, where)) continue;
          Object.assign(challenge, data);
          count += 1;
        }
        return Promise.resolve({ count });
      }),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        challenges.push({ ...data, attemptCount: 0, consumedAt: null, invalidatedAt: null });
        return Promise.resolve(challenges[challenges.length - 1]);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = challenges.findIndex((item) => item.id === where.id);
          if (index >= 0) challenges[index] = { ...challenges[index], ...data };
          return Promise.resolve(challenges[index]);
        },
      ),
    },
    securityStepUpGrant: {
      create: jest.fn().mockResolvedValue({
        id: 'step-up-1',
        expiresAt,
        purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
        economy: GamificationAdminEconomy.XP,
        targetMembershipId: 'membership-2',
      }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  });
  const redis = {
    rateLimit: {
      get: jest.fn().mockResolvedValue(null),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    },
  };
  const tokens = {
    createTokenHash: jest.fn((token: string) => `hash:${token}`),
  };
  const passwords = {
    verify: jest.fn().mockReturnValue(true),
  };
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const mail = {
    sendSecurityOtp: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new AuthService(
      prisma as never,
      redis as never,
      tokens as never,
      passwords as never,
      audit as never,
      mail as never,
    ),
    challenges,
    prisma,
    redis,
    tokens,
    passwords,
    audit,
    mail,
  };
}

function matchesOtpWhere(challenge: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'expiresAt' && expected && typeof expected === 'object' && 'gt' in expected) {
      return (
        challenge.expiresAt instanceof Date &&
        expected.gt instanceof Date &&
        challenge.expiresAt > expected.gt
      );
    }
    if (expected === null) return challenge[key] == null;
    return challenge[key] === expected;
  });
}

function resetTenant() {
  return {
    userId: 'user-1',
    agencyId: 'agency-1',
    agencyMembershipId: 'agency-membership-1',
    workspaceId: 'workspace-1',
    workspaceMembershipId: 'membership-1',
    roleId: 'role-1',
    roleName: 'Admin',
    accessSource: 'WORKSPACE_MEMBERSHIP' as const,
    permissions: ['gamification.reset'],
  };
}
