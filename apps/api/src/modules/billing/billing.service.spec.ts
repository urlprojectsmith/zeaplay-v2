import {
  BillingInterval,
  BillingHistoryEventType,
  BillingPriceStatus,
  BillingProvider,
  MasterPlanStatus,
  MasterPlanType,
  PlanEntitlementKind,
  PlanEntitlementValueType,
  PlanVersionStatus,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BILLING_DEFAULT_TRIAL_DAYS,
  BILLING_GRACE_PERIOD_DAYS,
  DEFAULT_AGENCY_WORKSPACE_ALLOCATION,
} from './billing.constants';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  it('rejects duplicate entitlement keys before creating a draft plan', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(
      service.createPlan(user(), {
        key: 'professional',
        displayName: 'Professional',
        entitlements: [feature('projects', true), feature('projects', false)],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('supports typed plan categories without hardcoded commercial plan names', async () => {
    const createdPlan = planFixture({ type: MasterPlanType.PRIVATE });
    const txMock = {
      masterPlan: {
        create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(createdPlan),
      },
      masterPlanVersion: { create: jest.fn().mockResolvedValue({ id: 'version-1' }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await service.createPlan(user(), {
      key: 'private-catalog',
      type: MasterPlanType.PRIVATE,
      displayName: 'Private Catalog',
      entitlements: [],
    });

    expect(txMock.masterPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: MasterPlanType.PRIVATE }),
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: BillingHistoryEventType.PLAN_CREATED,
          metadata: expect.objectContaining({ type: MasterPlanType.PRIVATE }),
        }),
      }),
    );
  });

  it('allows provider-specific integration entitlements and rejects arbitrary feature keys', async () => {
    const txMock = {
      masterPlan: {
        create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(planFixture()),
      },
      masterPlanVersion: { create: jest.fn().mockResolvedValue({ id: 'version-1' }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(
      service.createPlan(user(), {
        key: 'provider-plan',
        displayName: 'Provider Plan',
        entitlements: [feature('integrations.ghl.enabled', true)],
      }),
    ).resolves.toBeDefined();
    await expect(service.hasFeature('super-agency-1', 'random.enabled')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects negative limits without relying on controller validation', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(
      service.createPlan(user(), {
        key: 'bad-limit',
        displayName: 'Bad Limit',
        entitlements: [
          {
            key: 'max_memberships',
            kind: PlanEntitlementKind.LIMIT,
            valueType: PlanEntitlementValueType.COUNT,
            numericValue: -1,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported limit keys and invalid feature value shapes', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(
      service.createPlan(user(), {
        key: 'bad-key',
        displayName: 'Bad Key',
        entitlements: [
          {
            key: 'workspace_magic',
            kind: PlanEntitlementKind.LIMIT,
            valueType: PlanEntitlementValueType.COUNT,
            numericValue: 5,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createPlan(user(), {
        key: 'bad-feature-shape',
        displayName: 'Bad Feature Shape',
        entitlements: [
          {
            key: 'tasks',
            kind: PlanEntitlementKind.FEATURE,
            valueType: PlanEntitlementValueType.COUNT,
            numericValue: 1,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not edit published plan versions through the draft update path', async () => {
    const prisma = {
      masterPlanVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: PlanVersionStatus.PUBLISHED,
        }),
      },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(
      service.updateDraftVersion(user(), 'plan-1', 'version-1', {
        entitlements: [feature('tasks', true)],
      }),
    ).rejects.toThrow('Published or archived plan versions cannot be edited.');
  });

  it('creates deterministic next draft versions by copying the selected source entitlements', async () => {
    const sourceEntitlement = {
      id: 'entitlement-1',
      key: 'integrations.slack.enabled',
      kind: PlanEntitlementKind.FEATURE,
      valueType: PlanEntitlementValueType.BOOLEAN,
      booleanValue: true,
      numericValue: null,
      unlimited: false,
    };
    const plan = planFixture({
      versions: [
        {
          id: 'version-3',
          versionNumber: 3,
          status: PlanVersionStatus.DRAFT,
          publishedAt: null,
          archivedAt: null,
          createdAt: new Date('2026-09-25T00:00:00.000Z'),
          updatedAt: new Date('2026-09-25T00:00:00.000Z'),
          entitlements: [sourceEntitlement],
        },
      ],
    });
    const txMock = {
      masterPlanVersion: { create: jest.fn().mockResolvedValue({ id: 'version-3' }) },
      masterPlan: { findUniqueOrThrow: jest.fn().mockResolvedValue(plan) },
    };
    const prisma = {
      masterPlanVersion: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'version-2', entitlements: [sourceEntitlement] }),
        aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 2 } }),
      },
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await service.createNextDraftVersion(user(), 'plan-1', { fromVersionId: 'version-2' });

    expect(txMock.masterPlanVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          masterPlanId: 'plan-1',
          versionNumber: 3,
          status: PlanVersionStatus.DRAFT,
          entitlements: {
            createMany: {
              data: [
                {
                  key: 'integrations.slack.enabled',
                  kind: PlanEntitlementKind.FEATURE,
                  valueType: PlanEntitlementValueType.BOOLEAN,
                  booleanValue: true,
                  numericValue: null,
                  unlimited: false,
                },
              ],
            },
          },
        }),
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: BillingHistoryEventType.PLAN_VERSION_CREATED }),
      }),
    );
  });

  it('does not create another draft when a draft version already exists', async () => {
    const prisma = {
      masterPlanVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-draft' }),
        aggregate: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(service.createNextDraftVersion(user(), 'plan-1', {})).rejects.toThrow(
      'A draft version already exists for this plan.',
    );
    expect(prisma.masterPlanVersion.aggregate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents archiving a plan version that still has a current subscription', async () => {
    const prisma = {
      masterPlanVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: PlanVersionStatus.PUBLISHED,
        }),
      },
      superAgencySubscription: { count: jest.fn().mockResolvedValue(1) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(service.archiveVersion(user(), 'plan-1', 'version-1')).rejects.toThrow(
      'Cannot archive a version with current subscriptions.',
    );
  });

  it('archives a plan without deleting referenced versions or subscription history', async () => {
    const plan = planFixture({ status: MasterPlanStatus.ARCHIVED });
    const prisma = {
      masterPlan: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 'plan-1' }).mockResolvedValueOnce(plan),
        update: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await service.archivePlan(user(), 'plan-1');

    expect(prisma.masterPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { status: MasterPlanStatus.ARCHIVED },
    });
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: BillingHistoryEventType.PLAN_ARCHIVED }),
      }),
    );
  });

  it('rejects manual provisioning against a draft plan version', async () => {
    const prisma = {
      superAgency: { findUnique: jest.fn().mockResolvedValue({ id: 'super-agency-1' }) },
      masterPlanVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: PlanVersionStatus.DRAFT,
          masterPlanId: 'plan-1',
          masterPlan: { status: MasterPlanStatus.ACTIVE },
        }),
      },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(
      service.manualProvision(user(), {
        superAgencyId: 'super-agency-1',
        planVersionId: 'version-1',
      }),
    ).rejects.toThrow('Subscriptions must reference a published plan version.');
  });

  it('records manual provisioning with a platform actor and no fake payment event', async () => {
    const created = subscriptionFixture();
    const txMock = {
      superAgencySubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const auditMock = audit();
    const prisma = {
      superAgency: { findUnique: jest.fn().mockResolvedValue({ id: 'super-agency-1' }) },
      masterPlanVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: PlanVersionStatus.PUBLISHED,
          masterPlanId: 'plan-1',
          masterPlan: { status: MasterPlanStatus.ACTIVE },
        }),
      },
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, auditMock as never);

    await service.manualProvision(user(), {
      superAgencyId: 'super-agency-1',
      planVersionId: 'version-1',
      status: SuperAgencySubscriptionStatus.ACTIVE,
    });

    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        superAgencyId: 'super-agency-1',
        userId: 'user-1',
        action: 'billing.subscription.manual_provisioned',
        entityType: 'SuperAgencySubscription',
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledTimes(1);
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: BillingHistoryEventType.PLAN_ASSIGNED,
          actorUserId: 'user-1',
        }),
      }),
    );
  });

  it('keeps legacy Super Agencies with no subscription readable and unenforced', async () => {
    const prisma = {
      superAgencySubscription: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(service.getEffectiveEntitlements('super-agency-1')).resolves.toEqual({
      superAgencyId: 'super-agency-1',
      hasCurrentSubscription: false,
      subscription: null,
      features: [],
      limits: [],
    });
  });

  it('resolves boolean features, numeric limits, and unlimited limits from current subscription', async () => {
    const prisma = {
      superAgencySubscription: {
        findFirst: jest.fn().mockResolvedValue(subscriptionFixture()),
      },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(service.hasFeature('super-agency-1', 'tasks')).resolves.toBe(true);
    await expect(service.getLimit('super-agency-1', 'max_users')).resolves.toEqual({
      key: 'max_users',
      valueType: PlanEntitlementValueType.COUNT,
      unlimited: false,
      value: '25',
    });
    await expect(service.getLimit('super-agency-1', 'storage_bytes')).resolves.toEqual({
      key: 'storage_bytes',
      valueType: PlanEntitlementValueType.UNLIMITED,
      unlimited: true,
      value: null,
    });
  });

  it('manual provisioning can explicitly create a 14-day no-card trial foundation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
    const created = subscriptionFixture();
    const txMock = {
      superAgencySubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const prisma = {
      superAgency: { findUnique: jest.fn().mockResolvedValue({ id: 'super-agency-1' }) },
      masterPlanVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: PlanVersionStatus.PUBLISHED,
          masterPlanId: 'plan-1',
          masterPlan: { status: MasterPlanStatus.ACTIVE },
        }),
      },
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await service.manualProvision(user(), {
      superAgencyId: 'super-agency-1',
      planVersionId: 'version-1',
      startTrial: true,
    });

    expect(txMock.superAgencySubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SuperAgencySubscriptionStatus.TRIALING,
          trialStartedAt: new Date('2026-09-25T00:00:00.000Z'),
          trialEndsAt: new Date('2026-10-09T00:00:00.000Z'),
        }),
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: BillingHistoryEventType.PLAN_ASSIGNED }),
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: BillingHistoryEventType.TRIAL_STARTED,
          metadata: { trialDays: BILLING_DEFAULT_TRIAL_DAYS },
        }),
      }),
    );
    jest.useRealTimers();
  });

  it('creates USD monthly Stripe price mappings through the gateway when Stripe is enabled', async () => {
    const gateway = {
      enabled: true,
      createProduct: jest.fn().mockResolvedValue({ id: 'prod_123' }),
      createRecurringPrice: jest.fn().mockResolvedValue({ id: 'price_123' }),
    };
    const prisma = {
      masterPlanVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: PlanVersionStatus.PUBLISHED,
          masterPlanId: 'plan-1',
          masterPlan: {
            id: 'plan-1',
            displayName: 'Professional',
            status: MasterPlanStatus.ACTIVE,
            externalProductId: null,
          },
        }),
      },
      masterPlan: { update: jest.fn().mockResolvedValue({ id: 'plan-1' }) },
      billingPrice: {
        create: jest.fn().mockResolvedValue({
          id: 'price-row-1',
          masterPlanId: 'plan-1',
          planVersionId: 'version-1',
          provider: BillingProvider.STRIPE,
          currency: 'USD',
          interval: BillingInterval.MONTHLY,
          amountMinor: BigInt(1999),
          externalProductId: 'prod_123',
          externalPriceId: 'price_123',
          status: BillingPriceStatus.ACTIVE,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never, gateway as never);

    await service.createPrice(user(), 'plan-1', 'version-1', {
      interval: BillingInterval.MONTHLY,
      amountMinor: 1999,
    });

    expect(gateway.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { masterPlanId: 'plan-1' },
        idempotencyKey: 'product:plan-1',
      }),
    );
    expect(gateway.createRecurringPrice).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'prod_123',
        currency: 'USD',
        interval: 'month',
        amountMinor: 1999,
      }),
    );
    expect(prisma.billingPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountMinor: BigInt(1999),
          externalPriceId: 'price_123',
          status: BillingPriceStatus.ACTIVE,
        }),
      }),
    );
  });

  it('activates internal trials without creating a Stripe customer', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-25T00:00:00.000Z'));
    const txMock = {
      superAgencySubscription: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest
          .fn()
          .mockResolvedValue(
            subscriptionFixture({ status: SuperAgencySubscriptionStatus.TRIALING }),
          ),
      },
    };
    const prisma = {
      superAgencySubscription: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      },
      masterPlanVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: PlanVersionStatus.PUBLISHED,
          masterPlanId: 'plan-1',
          masterPlan: { status: MasterPlanStatus.ACTIVE },
        }),
      },
      superAgencyBillingAccount: { upsert: jest.fn() },
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const gateway = { enabled: true, createCustomer: jest.fn() };
    const service = new BillingService(prisma as never, audit() as never, gateway as never);

    await service.activateTrial(user(), {
      superAgencyId: 'super-agency-1',
      planVersionId: 'version-1',
    });

    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(prisma.superAgencyBillingAccount.upsert).not.toHaveBeenCalled();
    expect(txMock.superAgencySubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: BillingProvider.INTERNAL,
          status: SuperAgencySubscriptionStatus.TRIALING,
          trialEndsAt: new Date('2026-10-09T00:00:00.000Z'),
        }),
      }),
    );
    jest.useRealTimers();
  });

  it('creates hosted Checkout from server-resolved customer and price identifiers', async () => {
    const gateway = {
      enabled: true,
      createCustomer: jest.fn().mockResolvedValue({ id: 'cus_123' }),
      createCheckoutSession: jest.fn().mockResolvedValue({
        id: 'cs_123',
        url: 'https://checkout.stripe.test/session',
        expires_at: 1_800_000_000,
      }),
    };
    const txMock = {
      $queryRaw: jest.fn().mockResolvedValue([{ lock: '' }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      superAgencyBillingAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'account-1', stripeCustomerId: 'cus_123' }),
      },
      superAgency: {
        findUnique: jest.fn().mockResolvedValue({ id: 'super-agency-1', name: 'Super Agency A' }),
      },
    };
    const prisma = {
      billingPrice: {
        findFirst: jest.fn().mockResolvedValue(billingPriceFixture()),
      },
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
      billingCheckoutAttempt: {
        upsert: jest.fn().mockResolvedValue({
          id: 'attempt-1',
          superAgencyId: 'super-agency-1',
          billingPriceId: 'billing-price-1',
        }),
        update: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
      },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never, gateway as never);

    await service.createCheckoutSession(user(), tenant(), {
      planVersionId: 'version-1',
      interval: BillingInterval.MONTHLY,
    });

    expect(gateway.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_123',
        priceId: 'price_123',
        clientReferenceId: 'attempt-1',
        metadata: expect.objectContaining({
          superAgencyId: 'super-agency-1',
          billingPriceId: 'billing-price-1',
        }),
      }),
    );
  });

  it('schedules downgrades for period end without changing current entitlement immediately', async () => {
    const gateway = {
      enabled: true,
      schedulePriceChange: jest.fn().mockResolvedValue({ id: 'sub_sched_123' }),
    };
    const currentPeriodStart = new Date('2026-09-01T00:00:00.000Z');
    const currentPeriodEnd = new Date('2026-10-01T00:00:00.000Z');
    const current = subscriptionFixture({
      provider: BillingProvider.STRIPE,
      billingPriceId: 'current-price-row',
      billingInterval: BillingInterval.MONTHLY,
      stripeSubscriptionId: 'sub_123',
      stripeSubscriptionItemId: 'si_123',
      currentPeriodStart,
      currentPeriodEnd,
      masterPlan: { tierRank: 2 },
      billingPrice: { externalPriceId: 'price_current' },
    });
    const target = billingPriceFixture({
      id: 'target-price-row',
      planVersionId: 'version-downgrade',
      interval: BillingInterval.ANNUAL,
      externalPriceId: 'price_downgrade',
      masterPlan: { tierRank: 1 },
    });
    const prisma = {
      superAgencySubscription: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({
          ...current,
          pendingPlanVersionId: target.planVersionId,
          pendingBillingPriceId: target.id,
          pendingChangeEffectiveAt: currentPeriodEnd,
        }),
      },
      billingPrice: { findFirst: jest.fn().mockResolvedValue(target) },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never, gateway as never);

    await expect(
      service.changeSubscription(user(), tenant(), {
        planVersionId: target.planVersionId,
        interval: BillingInterval.ANNUAL,
      }),
    ).resolves.toEqual({ status: 'CHANGE_SCHEDULED', effectiveAt: currentPeriodEnd });

    expect(gateway.schedulePriceChange).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      currentPriceId: 'price_current',
      priceId: 'price_downgrade',
      currentPeriodStart,
      currentPeriodEnd,
      idempotencyKey: 'schedule:subscription-1:target-price-row',
    });
    expect(prisma.superAgencySubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: current.id },
        data: expect.objectContaining({
          pendingPlanVersionId: target.planVersionId,
          pendingBillingPriceId: target.id,
          pendingChangeEffectiveAt: currentPeriodEnd,
        }),
      }),
    );
  });

  it('rejects new plan changes while a scheduled billing change is pending', async () => {
    const current = subscriptionFixture({
      provider: BillingProvider.STRIPE,
      stripeSubscriptionId: 'sub_123',
      stripeSubscriptionItemId: 'si_123',
      pendingBillingPriceId: 'pending-price-row',
      pendingPlanVersionId: 'pending-version',
      pendingChangeEffectiveAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    const prisma = {
      superAgencySubscription: { findFirst: jest.fn().mockResolvedValue(current) },
      billingPrice: { findFirst: jest.fn() },
    };
    const gateway = { enabled: true, updateSubscriptionForUpgrade: jest.fn() };
    const service = new BillingService(prisma as never, audit() as never, gateway as never);

    await expect(
      service.changeSubscription(user(), tenant(), {
        planVersionId: 'version-upgrade',
        interval: BillingInterval.MONTHLY,
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.billingPrice.findFirst).not.toHaveBeenCalled();
    expect(gateway.updateSubscriptionForUpgrade).not.toHaveBeenCalled();
  });

  it('clears pending scheduled changes when period-end cancellation is requested', async () => {
    const current = subscriptionFixture({
      provider: BillingProvider.STRIPE,
      stripeSubscriptionId: 'sub_123',
      pendingBillingPriceId: 'pending-price-row',
      pendingPlanVersionId: 'pending-version',
      pendingChangeEffectiveAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    const prisma = {
      superAgencySubscription: {
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({ ...current, cancelAtPeriodEnd: true }),
      },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const gateway = { enabled: true, cancelAtPeriodEnd: jest.fn().mockResolvedValue({}) };
    const service = new BillingService(prisma as never, audit() as never, gateway as never);

    await service.cancelSubscription(user(), tenant(), { immediate: false });

    expect(gateway.cancelAtPeriodEnd).toHaveBeenCalledWith(
      'sub_123',
      'cancel-period-end:subscription-1',
    );
    expect(prisma.superAgencySubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelAtPeriodEnd: true,
          pendingPlanVersionId: null,
          pendingBillingPriceId: null,
          pendingChangeEffectiveAt: null,
        }),
      }),
    );
  });

  it('applies pending upgrade entitlements only after provider price confirmation', async () => {
    const current = subscriptionFixture({
      provider: BillingProvider.STRIPE,
      billingPriceId: 'current-price-row',
      billingInterval: BillingInterval.MONTHLY,
      stripeSubscriptionId: 'sub_123',
      stripeSubscriptionItemId: 'si_123',
      pendingBillingPriceId: 'upgrade-price-row',
      pendingPlanVersionId: 'version-upgrade',
      masterPlan: { tierRank: 1 },
      billingPrice: { externalPriceId: 'price_current' },
    });
    const upgradePrice = billingPriceFixture({
      id: 'upgrade-price-row',
      planVersionId: 'version-upgrade',
      externalPriceId: 'price_upgrade',
      masterPlan: { tierRank: 2 },
    });
    const prisma = {
      superAgencySubscription: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({
          ...current,
          masterPlanId: upgradePrice.masterPlanId,
          planVersionId: upgradePrice.planVersionId,
          billingPriceId: upgradePrice.id,
          pendingBillingPriceId: null,
          pendingPlanVersionId: null,
        }),
      },
      billingPrice: { findUnique: jest.fn().mockResolvedValue(upgradePrice) },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await (
      service as unknown as {
        reconcileStripeSubscription: (subscription: unknown) => Promise<unknown>;
      }
    ).reconcileStripeSubscription({
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: 1_788_220_800,
      current_period_end: 1_790_812_800,
      pending_update: null,
      items: { data: [{ id: 'si_456', price: { id: 'price_upgrade' } }] },
    });

    expect(prisma.superAgencySubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          masterPlanId: upgradePrice.masterPlanId,
          planVersionId: upgradePrice.planVersionId,
          billingPriceId: upgradePrice.id,
          pendingPlanVersionId: null,
          pendingBillingPriceId: null,
          pendingChangeEffectiveAt: null,
        }),
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: BillingHistoryEventType.UPGRADE_COMPLETED,
          metadata: expect.objectContaining({ billingPriceId: 'upgrade-price-row' }),
        }),
      }),
    );
  });

  it('clears expired pending upgrade state when provider keeps the current price', async () => {
    const current = subscriptionFixture({
      provider: BillingProvider.STRIPE,
      billingPriceId: 'current-price-row',
      billingInterval: BillingInterval.MONTHLY,
      stripeSubscriptionId: 'sub_123',
      pendingBillingPriceId: 'upgrade-price-row',
      pendingPlanVersionId: 'version-upgrade',
      billingPrice: { externalPriceId: 'price_current' },
    });
    const currentPrice = billingPriceFixture({
      id: 'current-price-row',
      externalPriceId: 'price_current',
    });
    const prisma = {
      superAgencySubscription: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({
          ...current,
          pendingBillingPriceId: null,
          pendingPlanVersionId: null,
        }),
      },
      billingPrice: { findUnique: jest.fn().mockResolvedValue(currentPrice) },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await (
      service as unknown as {
        reconcileStripeSubscription: (subscription: unknown) => Promise<unknown>;
      }
    ).reconcileStripeSubscription({
      id: 'sub_123',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: 1_788_220_800,
      current_period_end: 1_790_812_800,
      pending_update: null,
      items: { data: [{ id: 'si_123', price: { id: 'price_current' } }] },
    });

    expect(prisma.superAgencySubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pendingPlanVersionId: null,
          pendingBillingPriceId: null,
          pendingChangeEffectiveAt: null,
        }),
      }),
    );
    expect(prisma.billingHistory.create).not.toHaveBeenCalled();
  });

  it('moves expired trial grace to restricted mode without mutating tenant status', async () => {
    const now = new Date('2026-10-16T00:00:00.000Z');
    const txMock = {
      superAgencySubscription: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'subscription-1',
              superAgencyId: 'super-agency-1',
              masterPlanId: 'plan-1',
              planVersionId: 'version-1',
            },
          ]),
        update: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
      },
      billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history-1' }) },
      superAgency: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: typeof txMock) => unknown) => callback(txMock)),
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(service.processBillingDeadlines(now)).resolves.toEqual({
      trialGraceStarted: 0,
      restricted: 1,
    });
    expect(txMock.superAgencySubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SuperAgencySubscriptionStatus.RESTRICTED }),
      }),
    );
    expect(txMock.superAgency.update).not.toHaveBeenCalled();
  });

  it('lists Super Agency invoices with provider links while Platform support receives metadata only', async () => {
    const invoice = invoiceFixture();
    const prisma = {
      $transaction: jest
        .fn()
        .mockResolvedValueOnce([[invoice], 1])
        .mockResolvedValueOnce([[invoice], 1]),
      superAgency: { findUnique: jest.fn().mockResolvedValue({ id: 'super-agency-1' }) },
      billingInvoice: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const service = new BillingService(prisma as never, audit() as never);

    await expect(service.listInvoices(tenant(), { page: 1, pageSize: 25 })).resolves.toMatchObject({
      items: [
        {
          providerInvoiceId: 'in_123',
          hostedInvoiceUrl: 'https://billing.stripe.test/in_123',
          invoicePdfUrl: 'https://billing.stripe.test/in_123.pdf',
          amountDueMinor: '2500',
        },
      ],
      total: 1,
    });
    await expect(
      service.listSupportInvoices('super-agency-1', { page: 1, pageSize: 25 }),
    ).resolves.toMatchObject({
      items: [
        {
          providerInvoiceId: 'in_123',
          hostedInvoiceUrl: null,
          invoicePdfUrl: null,
          amountDueMinor: '2500',
        },
      ],
    });
    await expect(
      service.listInvoices(tenant(), { page: 1, pageSize: 25, status: 'customer.email' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns only safe default payment method summary fields', async () => {
    const prisma = {
      superAgencyBillingAccount: {
        findUnique: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_123' }),
      },
    };
    const stripe = {
      enabled: true,
      retrieveDefaultPaymentMethod: jest.fn().mockResolvedValue({
        id: 'pm_123',
        type: 'card',
        card: {
          brand: 'visa',
          display_brand: 'Visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2030,
        },
      }),
    };
    const service = new BillingService(prisma as never, audit() as never, stripe as never);

    await expect(service.getPaymentMethodSummary(tenant())).resolves.toEqual({
      provider: BillingProvider.STRIPE,
      paymentMethod: {
        type: 'card',
        brand: 'visa',
        displayBrand: 'Visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        isDefault: true,
      },
    });
  });

  it('refreshes invoices through known Stripe billing accounts and upserts a minimal projection', async () => {
    const auditService = audit();
    const prisma = {
      superAgencyBillingAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ stripeCustomerId: 'cus_123' })
          .mockResolvedValue({ superAgencyId: 'super-agency-1' }),
      },
      superAgencySubscription: { findUnique: jest.fn() },
      billingInvoice: {
        upsert: jest.fn().mockResolvedValue({ id: 'invoice-row', superAgencyId: 'super-agency-1' }),
      },
    };
    const stripe = {
      enabled: true,
      listInvoices: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'in_123',
            customer: 'cus_123',
            subscription: 'sub_123',
            number: 'INV-001',
            currency: 'usd',
            status: 'open',
            amount_due: 2500,
            amount_paid: 0,
            amount_remaining: 2500,
            created: 1790812800,
            hosted_invoice_url: 'https://billing.stripe.test/in_123',
            invoice_pdf: 'https://billing.stripe.test/in_123.pdf',
          },
        ],
      }),
    };
    const rateLimit = { assertWithinLimit: jest.fn().mockResolvedValue(undefined) };
    const service = new BillingService(
      prisma as never,
      auditService as never,
      stripe as never,
      undefined,
      rateLimit as never,
    );

    await expect(service.refreshInvoices(user(), tenant())).resolves.toMatchObject({
      provider: BillingProvider.STRIPE,
      synced: 1,
    });
    expect(rateLimit.assertWithinLimit).toHaveBeenCalledWith('super-agency-1', 'user-1');
    expect(prisma.billingInvoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerInvoiceId: {
            provider: BillingProvider.STRIPE,
            providerInvoiceId: 'in_123',
          },
        },
        create: expect.objectContaining({
          superAgencyId: 'super-agency-1',
          amountDueMinor: BigInt(2500),
          hostedInvoiceUrl: 'https://billing.stripe.test/in_123',
        }),
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.invoices.refreshed',
        metadata: expect.objectContaining({ synced: 1 }),
      }),
    );
  });

  it('rate limits manual invoice refresh before calling Stripe', async () => {
    const prisma = {
      superAgencyBillingAccount: { findUnique: jest.fn() },
    };
    const stripe = {
      enabled: true,
      listInvoices: jest.fn(),
    };
    const rateLimit = {
      assertWithinLimit: jest.fn().mockRejectedValue(new Error('rate limited')),
    };
    const service = new BillingService(
      prisma as never,
      audit() as never,
      stripe as never,
      undefined,
      rateLimit as never,
    );

    await expect(service.refreshInvoices(user(), tenant())).rejects.toThrow('rate limited');
    expect(prisma.superAgencyBillingAccount.findUnique).not.toHaveBeenCalled();
    expect(stripe.listInvoices).not.toHaveBeenCalled();
  });

  it('rate limits high-risk billing actions before downstream provider or subscription work', async () => {
    const rateLimit = {
      assertActionWithinLimit: jest.fn().mockRejectedValue(new Error('rate limited')),
    };

    const checkoutPrisma = { billingPrice: { findFirst: jest.fn() } };
    await expect(
      new BillingService(
        checkoutPrisma as never,
        audit() as never,
        { enabled: true } as never,
        undefined,
        rateLimit as never,
      ).createCheckoutSession(user(), tenant(), {
        planVersionId: 'version-1',
        interval: BillingInterval.MONTHLY,
      }),
    ).rejects.toThrow('rate limited');
    expect(checkoutPrisma.billingPrice.findFirst).not.toHaveBeenCalled();

    const portalPrisma = { superAgencyBillingAccount: { findUnique: jest.fn() } };
    await expect(
      new BillingService(
        portalPrisma as never,
        audit() as never,
        { enabled: true } as never,
        undefined,
        rateLimit as never,
      ).createPortalSession(user(), tenant()),
    ).rejects.toThrow('rate limited');
    expect(portalPrisma.superAgencyBillingAccount.findUnique).not.toHaveBeenCalled();

    const changePrisma = { superAgencySubscription: { findFirst: jest.fn() } };
    await expect(
      new BillingService(
        changePrisma as never,
        audit() as never,
        { enabled: true } as never,
        undefined,
        rateLimit as never,
      ).changeSubscription(user(), tenant(), {
        planVersionId: 'version-2',
        interval: BillingInterval.MONTHLY,
      }),
    ).rejects.toThrow('rate limited');
    expect(changePrisma.superAgencySubscription.findFirst).not.toHaveBeenCalled();

    const cancelPrisma = { superAgencySubscription: { findFirst: jest.fn() } };
    await expect(
      new BillingService(
        cancelPrisma as never,
        audit() as never,
        { enabled: true } as never,
        undefined,
        rateLimit as never,
      ).cancelSubscription(user(), tenant(), { immediate: false }),
    ).rejects.toThrow('rate limited');
    expect(cancelPrisma.superAgencySubscription.findFirst).not.toHaveBeenCalled();

    const trialPrisma = { superAgencySubscription: { findFirst: jest.fn() } };
    await expect(
      new BillingService(
        trialPrisma as never,
        audit() as never,
        undefined,
        undefined,
        rateLimit as never,
      ).activateTrial(user(), {
        superAgencyId: 'super-agency-1',
        planVersionId: 'version-1',
      }),
    ).rejects.toThrow('rate limited');
    expect(trialPrisma.superAgencySubscription.findFirst).not.toHaveBeenCalled();

    expect(rateLimit.assertActionWithinLimit).toHaveBeenCalledWith(
      'checkout',
      'super-agency-1',
      'user-1',
    );
    expect(rateLimit.assertActionWithinLimit).toHaveBeenCalledWith(
      'portal',
      'super-agency-1',
      'user-1',
    );
    expect(rateLimit.assertActionWithinLimit).toHaveBeenCalledWith(
      'subscriptionChange',
      'super-agency-1',
      'user-1',
    );
    expect(rateLimit.assertActionWithinLimit).toHaveBeenCalledWith(
      'subscriptionCancel',
      'super-agency-1',
      'user-1',
    );
    expect(rateLimit.assertActionWithinLimit).toHaveBeenCalledWith(
      'trialActivation',
      'super-agency-1',
      'user-1',
    );
  });

  it('centralizes grace and default allocation policy without activating enforcement', () => {
    expect(BILLING_GRACE_PERIOD_DAYS).toBe(7);
    expect(DEFAULT_AGENCY_WORKSPACE_ALLOCATION).toBe(15);
  });
});

function feature(key: string, enabled: boolean) {
  return {
    key,
    kind: PlanEntitlementKind.FEATURE,
    valueType: PlanEntitlementValueType.BOOLEAN,
    booleanValue: enabled,
  };
}

function audit() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function user() {
  return { id: 'user-1', email: 'platform@zeaplay.test' };
}

function tenant() {
  return {
    userId: 'user-1',
    superAgencyId: 'super-agency-1',
    superAgencyMembershipId: 'super-agency-membership-1',
    roleId: 'role-1',
    roleName: 'SUPER_AGENCY_OWNER',
    permissions: ['billing.checkout.create'],
    status: 'ACTIVE',
  };
}

function billingPriceFixture(
  overrides: {
    id?: string;
    planVersionId?: string;
    interval?: BillingInterval;
    externalPriceId?: string | null;
    masterPlan?: { tierRank?: number; type?: MasterPlanType; status?: MasterPlanStatus };
  } = {},
) {
  const now = new Date('2026-09-25T00:00:00.000Z');
  return {
    id: overrides.id ?? 'billing-price-1',
    masterPlanId: 'plan-1',
    planVersionId: overrides.planVersionId ?? 'version-1',
    provider: BillingProvider.STRIPE,
    currency: 'USD',
    interval: overrides.interval ?? BillingInterval.MONTHLY,
    amountMinor: BigInt(1999),
    externalProductId: 'prod_123',
    externalPriceId: overrides.externalPriceId ?? 'price_123',
    status: BillingPriceStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    masterPlan: {
      id: 'plan-1',
      key: 'professional',
      type: MasterPlanType.PUBLIC,
      tierRank: 1,
      displayName: 'Professional',
      status: MasterPlanStatus.ACTIVE,
      ...overrides.masterPlan,
    },
    planVersion: {
      id: overrides.planVersionId ?? 'version-1',
      status: PlanVersionStatus.PUBLISHED,
      versionNumber: 1,
    },
  };
}

function invoiceFixture() {
  const now = new Date('2026-10-01T00:00:00.000Z');
  return {
    id: 'invoice-row',
    superAgencyId: 'super-agency-1',
    provider: BillingProvider.STRIPE,
    providerInvoiceId: 'in_123',
    providerSubscriptionId: 'sub_123',
    invoiceNumber: 'INV-001',
    currency: 'USD',
    status: 'open',
    amountDueMinor: BigInt(2500),
    amountPaidMinor: BigInt(0),
    amountRemainingMinor: BigInt(2500),
    providerCreatedAt: now,
    dueAt: null,
    periodStart: null,
    periodEnd: null,
    finalizedAt: null,
    paidAt: null,
    voidedAt: null,
    hostedInvoiceUrl: 'https://billing.stripe.test/in_123',
    invoicePdfUrl: 'https://billing.stripe.test/in_123.pdf',
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function subscriptionFixture(
  overrides: {
    status?: SuperAgencySubscriptionStatus;
    provider?: BillingProvider;
    billingPriceId?: string | null;
    billingInterval?: BillingInterval | null;
    stripeSubscriptionId?: string | null;
    stripeSubscriptionItemId?: string | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    pendingPlanVersionId?: string | null;
    pendingBillingPriceId?: string | null;
    pendingChangeEffectiveAt?: Date | null;
    masterPlan?: { tierRank?: number; type?: MasterPlanType; status?: MasterPlanStatus };
    billingPrice?: { externalPriceId?: string | null; status?: BillingPriceStatus } | null;
  } = {},
) {
  const now = new Date('2026-09-25T00:00:00.000Z');
  return {
    id: 'subscription-1',
    superAgencyId: 'super-agency-1',
    masterPlanId: 'plan-1',
    planVersionId: 'version-1',
    billingPriceId: overrides.billingPriceId ?? null,
    provider: overrides.provider ?? BillingProvider.INTERNAL,
    status: overrides.status ?? SuperAgencySubscriptionStatus.ACTIVE,
    isCurrent: true,
    billingInterval: overrides.billingInterval ?? null,
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? null,
    stripeSubscriptionItemId: overrides.stripeSubscriptionItemId ?? null,
    providerStatus: null,
    currentPeriodStart: overrides.currentPeriodStart ?? null,
    currentPeriodEnd: overrides.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
    graceStartedAt: null,
    graceEndsAt: null,
    restrictedAt: null,
    pendingPlanVersionId: overrides.pendingPlanVersionId ?? null,
    pendingBillingPriceId: overrides.pendingBillingPriceId ?? null,
    pendingChangeEffectiveAt: overrides.pendingChangeEffectiveAt ?? null,
    startedAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    masterPlan: {
      id: 'plan-1',
      key: 'professional',
      type: MasterPlanType.PUBLIC,
      tierRank: 1,
      displayName: 'Professional',
      status: MasterPlanStatus.ACTIVE,
      ...overrides.masterPlan,
    },
    billingPrice:
      overrides.billingPrice === null
        ? null
        : overrides.billingPrice || overrides.billingPriceId
          ? {
              id: overrides.billingPriceId ?? 'current-price-row',
              currency: 'USD',
              interval: overrides.billingInterval ?? BillingInterval.MONTHLY,
              amountMinor: BigInt(1999),
              externalPriceId: 'price_current',
              status: BillingPriceStatus.ACTIVE,
              ...overrides.billingPrice,
            }
          : null,
    planVersion: {
      id: 'version-1',
      versionNumber: 1,
      status: PlanVersionStatus.PUBLISHED,
      publishedAt: now,
      entitlements: [
        {
          id: 'entitlement-1',
          key: 'tasks',
          kind: PlanEntitlementKind.FEATURE,
          valueType: PlanEntitlementValueType.BOOLEAN,
          booleanValue: true,
          numericValue: null,
          unlimited: false,
        },
        {
          id: 'entitlement-2',
          key: 'max_users',
          kind: PlanEntitlementKind.LIMIT,
          valueType: PlanEntitlementValueType.COUNT,
          booleanValue: null,
          numericValue: BigInt(25),
          unlimited: false,
        },
        {
          id: 'entitlement-3',
          key: 'storage_bytes',
          kind: PlanEntitlementKind.LIMIT,
          valueType: PlanEntitlementValueType.UNLIMITED,
          booleanValue: null,
          numericValue: null,
          unlimited: true,
        },
      ],
    },
  };
}

function planFixture(
  overrides: {
    type?: MasterPlanType;
    status?: MasterPlanStatus;
    versions?: Array<{
      id: string;
      versionNumber: number;
      status: PlanVersionStatus;
      publishedAt: Date | null;
      archivedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      entitlements: Array<{
        id: string;
        key: string;
        kind: PlanEntitlementKind;
        valueType: PlanEntitlementValueType;
        booleanValue: boolean | null;
        numericValue: bigint | null;
        unlimited: boolean;
      }>;
    }>;
  } = {},
) {
  const now = new Date('2026-09-25T00:00:00.000Z');
  return {
    id: 'plan-1',
    key: 'private-catalog',
    type: overrides.type ?? MasterPlanType.PUBLIC,
    displayName: 'Private Catalog',
    description: null,
    status: overrides.status ?? MasterPlanStatus.DRAFT,
    createdAt: now,
    updatedAt: now,
    versions: overrides.versions ?? [
      {
        id: 'version-1',
        versionNumber: 1,
        status: PlanVersionStatus.DRAFT,
        publishedAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        entitlements: [],
      },
    ],
  };
}
