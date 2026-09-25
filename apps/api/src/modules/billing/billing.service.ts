import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BillingCheckoutAttemptStatus,
  BillingInterval,
  BillingHistoryEventType,
  BillingPriceStatus,
  BillingProvider,
  MasterPlanStatus,
  MasterPlanType,
  PlanEntitlementKind,
  PlanEntitlementValueType,
  PlanVersionStatus,
  Prisma,
  StripeBillingEventStatus,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import type { AuthenticatedUser, SuperAgencyTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  BILLING_DEFAULT_TRIAL_DAYS,
  BILLING_GRACE_PERIOD_DAYS,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
} from './billing.constants';
import { BillingEntitlementService } from './billing-entitlement.service';
import { BillingInvoiceRefreshRateLimitService } from './billing-invoice-refresh-rate-limit.service';
import { StripeBillingGateway } from './billing.stripe-gateway';
import {
  ActivateTrialDto,
  BILLING_INVOICE_STATUS_FILTERS,
  BillingInvoiceListQueryDto,
  BillingPlanListQueryDto,
  CancelSubscriptionDto,
  ChangeSubscriptionDto,
  CreateBillingPriceDto,
  CreateCheckoutSessionDto,
  CreateMasterPlanDto,
  CreateNextPlanVersionDto,
  ManualProvisionSubscriptionDto,
  PlanEntitlementDto,
  UpdateDraftPlanVersionDto,
} from './dto/billing.dto';

const invoiceEventTypes = new Set([
  'invoice.created',
  'invoice.finalized',
  'invoice.updated',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'invoice.marked_uncollectible',
]);

const invoiceStatusFilters = new Set<string>(BILLING_INVOICE_STATUS_FILTERS);

const currentSubscriptionStatuses = new Set<SuperAgencySubscriptionStatus>([
  SuperAgencySubscriptionStatus.TRIALING,
  SuperAgencySubscriptionStatus.ACTIVE,
  SuperAgencySubscriptionStatus.PAST_DUE,
  SuperAgencySubscriptionStatus.GRACE_PERIOD,
  SuperAgencySubscriptionStatus.TRIAL_GRACE,
  SuperAgencySubscriptionStatus.PAYMENT_GRACE,
  SuperAgencySubscriptionStatus.RESTRICTED,
  SuperAgencySubscriptionStatus.SUSPENDED,
]);

const fullAccessStatuses = new Set<SuperAgencySubscriptionStatus>([
  SuperAgencySubscriptionStatus.TRIALING,
  SuperAgencySubscriptionStatus.ACTIVE,
]);

const warningAccessStatuses = new Set<SuperAgencySubscriptionStatus>([
  SuperAgencySubscriptionStatus.GRACE_PERIOD,
  SuperAgencySubscriptionStatus.TRIAL_GRACE,
  SuperAgencySubscriptionStatus.PAYMENT_GRACE,
  SuperAgencySubscriptionStatus.PAST_DUE,
]);

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stripe?: StripeBillingGateway,
    private readonly entitlementService?: BillingEntitlementService,
    private readonly invoiceRefreshRateLimit?: BillingInvoiceRefreshRateLimitService,
  ) {}

  async listPlans(query: BillingPlanListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where: Prisma.MasterPlanWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            OR: [
              { key: { contains: query.search.trim().toLowerCase(), mode: 'insensitive' } },
              { displayName: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.masterPlan.findMany({
        where,
        select: planSummarySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.masterPlan.count({ where }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  async getPlan(planId: string) {
    const plan = await this.prisma.masterPlan.findUnique({
      where: { id: planId },
      select: planDetailSelect,
    });
    if (!plan) throw new NotFoundException('Master plan not found.');
    return serializePlan(plan);
  }

  async createPlan(user: AuthenticatedUser, dto: CreateMasterPlanDto) {
    const entitlements = normalizeEntitlements(dto.entitlements);
    const plan = await this.prisma
      .$transaction(async (tx) => {
        const createdPlan = await tx.masterPlan.create({
          data: {
            key: normalizePlanKey(dto.key),
            type: dto.type ?? MasterPlanType.PUBLIC,
            tierRank: dto.tierRank ?? 0,
            displayName: dto.displayName.trim(),
            description: trimNullable(dto.description),
          },
          select: { id: true },
        });
        await tx.masterPlanVersion.create({
          data: {
            masterPlanId: createdPlan.id,
            versionNumber: 1,
            status: PlanVersionStatus.DRAFT,
            entitlements: { createMany: { data: entitlements } },
          },
        });
        return tx.masterPlan.findUniqueOrThrow({
          where: { id: createdPlan.id },
          select: planDetailSelect,
        });
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error)) throw new ConflictException('Master plan key already exists.');
        throw error;
      });
    await this.audit.record({
      userId: user.id,
      action: 'billing.master_plan.created',
      entityType: 'MasterPlan',
      entityId: plan.id,
      metadata: { key: plan.key, draftVersion: 1 },
    });
    await this.recordBillingHistory({
      masterPlanId: plan.id,
      eventType: BillingHistoryEventType.PLAN_CREATED,
      actorUserId: user.id,
      metadata: { key: plan.key, type: plan.type, tierRank: plan.tierRank, draftVersion: 1 },
    });
    return serializePlan(plan);
  }

  async updateDraftVersion(
    user: AuthenticatedUser,
    planId: string,
    versionId: string,
    dto: UpdateDraftPlanVersionDto,
  ) {
    const entitlements =
      dto.entitlements === undefined ? undefined : normalizeEntitlements(dto.entitlements);
    const version = await this.prisma.masterPlanVersion.findFirst({
      where: { id: versionId, masterPlanId: planId },
      select: { id: true, status: true },
    });
    if (!version) throw new NotFoundException('Plan version not found.');
    if (version.status !== PlanVersionStatus.DRAFT) {
      throw new BadRequestException('Published or archived plan versions cannot be edited.');
    }
    const plan = await this.prisma.$transaction(async (tx) => {
      if (
        dto.displayName !== undefined ||
        dto.description !== undefined ||
        dto.type !== undefined ||
        dto.tierRank !== undefined
      ) {
        await tx.masterPlan.update({
          where: { id: planId },
          data: {
            type: dto.type,
            tierRank: dto.tierRank,
            displayName: dto.displayName?.trim(),
            description: dto.description === undefined ? undefined : trimNullable(dto.description),
          },
        });
      }
      if (entitlements) {
        await tx.planEntitlement.deleteMany({ where: { planVersionId: versionId } });
        if (entitlements.length) {
          await tx.planEntitlement.createMany({
            data: entitlements.map((item) => ({ ...item, planVersionId: versionId })),
          });
        }
      }
      return tx.masterPlan.findUniqueOrThrow({ where: { id: planId }, select: planDetailSelect });
    });
    await this.audit.record({
      userId: user.id,
      action: 'billing.master_plan.draft_updated',
      entityType: 'MasterPlanVersion',
      entityId: versionId,
      metadata: { planId, changed: Object.keys(dto) },
    });
    await this.recordBillingHistory({
      masterPlanId: planId,
      planVersionId: versionId,
      eventType: BillingHistoryEventType.PLAN_DRAFT_UPDATED,
      actorUserId: user.id,
      metadata: { changed: Object.keys(dto) },
    });
    return serializePlan(plan);
  }

  async publishVersion(user: AuthenticatedUser, planId: string, versionId: string) {
    const version = await this.prisma.masterPlanVersion.findFirst({
      where: { id: versionId, masterPlanId: planId },
      select: {
        id: true,
        status: true,
        entitlements: { select: entitlementSelect },
      },
    });
    if (!version) throw new NotFoundException('Plan version not found.');
    if (version.status !== PlanVersionStatus.DRAFT) {
      throw new BadRequestException('Only draft plan versions can be published.');
    }
    normalizeEntitlements(
      version.entitlements.map((item) => deserializeEntitlementForValidation(item)),
    );
    const now = new Date();
    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.masterPlanVersion.update({
        where: { id: versionId },
        data: { status: PlanVersionStatus.PUBLISHED, publishedAt: now },
      });
      await tx.masterPlan.update({
        where: { id: planId },
        data: { status: MasterPlanStatus.ACTIVE },
      });
      return tx.masterPlan.findUniqueOrThrow({ where: { id: planId }, select: planDetailSelect });
    });
    await this.audit.record({
      userId: user.id,
      action: 'billing.master_plan.version_published',
      entityType: 'MasterPlanVersion',
      entityId: versionId,
      metadata: { planId },
    });
    await this.recordBillingHistory({
      masterPlanId: planId,
      planVersionId: versionId,
      eventType: BillingHistoryEventType.PLAN_VERSION_PUBLISHED,
      actorUserId: user.id,
    });
    return serializePlan(plan);
  }

  async createNextDraftVersion(
    user: AuthenticatedUser,
    planId: string,
    dto: CreateNextPlanVersionDto,
  ) {
    const existingDraft = await this.prisma.masterPlanVersion.findFirst({
      where: { masterPlanId: planId, status: PlanVersionStatus.DRAFT },
      select: { id: true },
    });
    if (existingDraft) throw new ConflictException('A draft version already exists for this plan.');
    const source = dto.fromVersionId
      ? await this.prisma.masterPlanVersion.findFirst({
          where: { id: dto.fromVersionId, masterPlanId: planId },
          select: { id: true, entitlements: { select: entitlementSelect } },
        })
      : await this.prisma.masterPlanVersion.findFirst({
          where: { masterPlanId: planId },
          select: { id: true, entitlements: { select: entitlementSelect } },
          orderBy: { versionNumber: 'desc' },
        });
    if (!source) throw new NotFoundException('Source plan version not found.');
    const max = await this.prisma.masterPlanVersion.aggregate({
      where: { masterPlanId: planId },
      _max: { versionNumber: true },
    });
    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.masterPlanVersion.create({
        data: {
          masterPlanId: planId,
          versionNumber: (max._max.versionNumber ?? 0) + 1,
          status: PlanVersionStatus.DRAFT,
          entitlements: {
            createMany: {
              data: source.entitlements.map((item) => ({
                key: item.key,
                kind: item.kind,
                valueType: item.valueType,
                booleanValue: item.booleanValue,
                numericValue: item.numericValue,
                unlimited: item.unlimited,
              })),
            },
          },
        },
      });
      return tx.masterPlan.findUniqueOrThrow({ where: { id: planId }, select: planDetailSelect });
    });
    await this.audit.record({
      userId: user.id,
      action: 'billing.master_plan.version_created',
      entityType: 'MasterPlan',
      entityId: planId,
      metadata: { fromVersionId: source.id },
    });
    await this.recordBillingHistory({
      masterPlanId: planId,
      eventType: BillingHistoryEventType.PLAN_VERSION_CREATED,
      actorUserId: user.id,
      metadata: { fromVersionId: source.id },
    });
    return serializePlan(plan);
  }

  async archiveVersion(user: AuthenticatedUser, planId: string, versionId: string) {
    const version = await this.prisma.masterPlanVersion.findFirst({
      where: { id: versionId, masterPlanId: planId },
      select: { id: true, status: true },
    });
    if (!version) throw new NotFoundException('Plan version not found.');
    if (version.status === PlanVersionStatus.ARCHIVED) return this.getPlan(planId);
    const activeSubscriptionCount = await this.prisma.superAgencySubscription.count({
      where: { planVersionId: versionId, isCurrent: true },
    });
    if (activeSubscriptionCount > 0) {
      throw new BadRequestException('Cannot archive a version with current subscriptions.');
    }
    await this.prisma.masterPlanVersion.update({
      where: { id: versionId },
      data: { status: PlanVersionStatus.ARCHIVED, archivedAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      action: 'billing.master_plan.version_archived',
      entityType: 'MasterPlanVersion',
      entityId: versionId,
      metadata: { planId },
    });
    await this.recordBillingHistory({
      masterPlanId: planId,
      planVersionId: versionId,
      eventType: BillingHistoryEventType.PLAN_VERSION_ARCHIVED,
      actorUserId: user.id,
    });
    return this.getPlan(planId);
  }

  async archivePlan(user: AuthenticatedUser, planId: string) {
    const plan = await this.prisma.masterPlan.findUnique({
      where: { id: planId },
      select: { id: true },
    });
    if (!plan) throw new NotFoundException('Master plan not found.');
    await this.prisma.masterPlan.update({
      where: { id: planId },
      data: { status: MasterPlanStatus.ARCHIVED },
    });
    await this.audit.record({
      userId: user.id,
      action: 'billing.master_plan.archived',
      entityType: 'MasterPlan',
      entityId: planId,
    });
    await this.recordBillingHistory({
      masterPlanId: planId,
      eventType: BillingHistoryEventType.PLAN_ARCHIVED,
      actorUserId: user.id,
    });
    return this.getPlan(planId);
  }

  async manualProvision(user: AuthenticatedUser, dto: ManualProvisionSubscriptionDto) {
    const status =
      dto.startTrial || dto.status === SuperAgencySubscriptionStatus.TRIALING
        ? SuperAgencySubscriptionStatus.TRIALING
        : (dto.status ?? SuperAgencySubscriptionStatus.ACTIVE);
    const [superAgency, version] = await Promise.all([
      this.prisma.superAgency.findUnique({
        where: { id: dto.superAgencyId },
        select: { id: true },
      }),
      this.prisma.masterPlanVersion.findUnique({
        where: { id: dto.planVersionId },
        select: {
          id: true,
          status: true,
          masterPlanId: true,
          masterPlan: { select: { status: true } },
        },
      }),
    ]);
    if (!superAgency) throw new NotFoundException('Super Agency not found.');
    if (!version) throw new NotFoundException('Plan version not found.');
    if (version.status !== PlanVersionStatus.PUBLISHED) {
      throw new BadRequestException('Subscriptions must reference a published plan version.');
    }
    if (version.masterPlan.status === MasterPlanStatus.ARCHIVED) {
      throw new BadRequestException('Cannot provision an archived master plan.');
    }
    const now = new Date();
    const trialStartedAt = status === SuperAgencySubscriptionStatus.TRIALING ? now : null;
    const trialEndsAt =
      status === SuperAgencySubscriptionStatus.TRIALING
        ? new Date(now.getTime() + BILLING_DEFAULT_TRIAL_DAYS * 24 * 60 * 60 * 1000)
        : null;
    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.superAgencySubscription.updateMany({
        where: { superAgencyId: dto.superAgencyId, isCurrent: true },
        data: { isCurrent: false, endedAt: now },
      });
      return tx.superAgencySubscription.create({
        data: {
          superAgencyId: dto.superAgencyId,
          masterPlanId: version.masterPlanId,
          planVersionId: version.id,
          status,
          isCurrent: true,
          trialStartedAt,
          trialEndsAt,
          startedAt: now,
        },
        select: subscriptionSelect,
      });
    });
    await this.audit.record({
      superAgencyId: dto.superAgencyId,
      userId: user.id,
      action: 'billing.subscription.manual_provisioned',
      entityType: 'SuperAgencySubscription',
      entityId: subscription.id,
      metadata: {
        planVersionId: version.id,
        masterPlanId: version.masterPlanId,
        status,
        startTrial: Boolean(dto.startTrial),
      },
    });
    await this.recordBillingHistory({
      superAgencyId: dto.superAgencyId,
      masterPlanId: version.masterPlanId,
      planVersionId: version.id,
      subscriptionId: subscription.id,
      eventType: BillingHistoryEventType.PLAN_ASSIGNED,
      actorUserId: user.id,
      metadata: { status, startTrial: Boolean(dto.startTrial) },
    });
    if (status === SuperAgencySubscriptionStatus.TRIALING) {
      await this.recordBillingHistory({
        superAgencyId: dto.superAgencyId,
        masterPlanId: version.masterPlanId,
        planVersionId: version.id,
        subscriptionId: subscription.id,
        eventType: BillingHistoryEventType.TRIAL_STARTED,
        actorUserId: user.id,
        metadata: { trialDays: BILLING_DEFAULT_TRIAL_DAYS },
      });
    }
    return serializeSubscription(subscription);
  }

  async createPrice(
    user: AuthenticatedUser,
    planId: string,
    versionId: string,
    dto: CreateBillingPriceDto,
  ) {
    const version = await this.prisma.masterPlanVersion.findFirst({
      where: { id: versionId, masterPlanId: planId },
      select: {
        id: true,
        status: true,
        masterPlanId: true,
        masterPlan: {
          select: {
            id: true,
            displayName: true,
            status: true,
            externalProductId: true,
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Plan version not found.');
    if (version.status !== PlanVersionStatus.PUBLISHED) {
      throw new BadRequestException('Prices require a published plan version.');
    }
    if (version.masterPlan.status === MasterPlanStatus.ARCHIVED) {
      throw new BadRequestException('Cannot price an archived master plan.');
    }

    let externalProductId = version.masterPlan.externalProductId;
    let externalPriceId: string | null = null;
    let status: BillingPriceStatus = BillingPriceStatus.DRAFT;

    if (this.stripe?.enabled) {
      if (!externalProductId) {
        const product = await this.stripe.createProduct({
          name: version.masterPlan.displayName,
          metadata: { masterPlanId: planId },
          idempotencyKey: `product:${planId}`,
        });
        externalProductId = product.id;
        await this.prisma.masterPlan.update({
          where: { id: planId },
          data: { externalProductId },
        });
      }
      const price = await this.stripe.createRecurringPrice({
        productId: externalProductId,
        currency: 'USD',
        interval: dto.interval === BillingInterval.MONTHLY ? 'month' : 'year',
        amountMinor: dto.amountMinor,
        metadata: { masterPlanId: planId, planVersionId: versionId, interval: dto.interval },
        idempotencyKey: `price:${versionId}:${dto.interval}:USD:${dto.amountMinor}`,
      });
      externalPriceId = price.id;
      status = BillingPriceStatus.ACTIVE;
    }

    const billingPrice = await this.prisma.billingPrice
      .create({
        data: {
          masterPlanId: planId,
          planVersionId: versionId,
          provider: BillingProvider.STRIPE,
          currency: 'USD',
          interval: dto.interval,
          amountMinor: BigInt(dto.amountMinor),
          externalProductId,
          externalPriceId,
          status,
        },
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error)) {
          throw new ConflictException('A price already exists for this plan version and interval.');
        }
        throw error;
      });
    await this.audit.record({
      userId: user.id,
      action: 'billing.price.created',
      entityType: 'BillingPrice',
      entityId: billingPrice.id,
      metadata: {
        planId,
        versionId,
        interval: dto.interval,
        currency: 'USD',
        amountMinor: dto.amountMinor,
        provider: BillingProvider.STRIPE,
        stripeSynced: Boolean(externalPriceId),
      },
    });
    await this.recordBillingHistory({
      masterPlanId: planId,
      planVersionId: versionId,
      eventType: BillingHistoryEventType.PRICE_CREATED,
      actorUserId: user.id,
      metadata: {
        billingPriceId: billingPrice.id,
        interval: dto.interval,
        currency: 'USD',
        amountMinor: dto.amountMinor,
        stripeSynced: Boolean(externalPriceId),
      },
    });
    return serializePrice(billingPrice);
  }

  async activateTrial(user: AuthenticatedUser, dto: ActivateTrialDto) {
    await this.invoiceRefreshRateLimit?.assertActionWithinLimit(
      'trialActivation',
      dto.superAgencyId,
      user.id,
    );
    const [existingTrial, current, version] = await Promise.all([
      this.prisma.superAgencySubscription.findFirst({
        where: { superAgencyId: dto.superAgencyId, trialStartedAt: { not: null } },
        select: { id: true, status: true, isCurrent: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.superAgencySubscription.findFirst({
        where: { superAgencyId: dto.superAgencyId, isCurrent: true },
        select: subscriptionSelect,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.masterPlanVersion.findUnique({
        where: { id: dto.planVersionId },
        select: {
          id: true,
          status: true,
          masterPlanId: true,
          masterPlan: { select: { status: true } },
        },
      }),
    ]);
    if (current?.status === SuperAgencySubscriptionStatus.TRIALING)
      return serializeSubscription(current);
    if (existingTrial)
      throw new ConflictException('Trial has already been used for this Super Agency.');
    if (!version) throw new NotFoundException('Plan version not found.');
    if (version.status !== PlanVersionStatus.PUBLISHED) {
      throw new BadRequestException('Trial activation requires a published plan version.');
    }
    if (version.masterPlan.status === MasterPlanStatus.ARCHIVED) {
      throw new BadRequestException('Cannot activate trial on an archived plan.');
    }

    const now = new Date();
    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.superAgencySubscription.updateMany({
        where: { superAgencyId: dto.superAgencyId, isCurrent: true },
        data: { isCurrent: false, endedAt: now },
      });
      return tx.superAgencySubscription.create({
        data: {
          superAgencyId: dto.superAgencyId,
          masterPlanId: version.masterPlanId,
          planVersionId: version.id,
          provider: BillingProvider.INTERNAL,
          status: SuperAgencySubscriptionStatus.TRIALING,
          isCurrent: true,
          trialStartedAt: now,
          trialEndsAt: addDays(now, BILLING_DEFAULT_TRIAL_DAYS),
          startedAt: now,
        },
        select: subscriptionSelect,
      });
    });
    await this.audit.record({
      superAgencyId: dto.superAgencyId,
      userId: user.id,
      action: 'billing.trial.activated',
      entityType: 'SuperAgencySubscription',
      entityId: subscription.id,
      metadata: { planVersionId: version.id, trialDays: BILLING_DEFAULT_TRIAL_DAYS },
    });
    await this.recordBillingHistory({
      superAgencyId: dto.superAgencyId,
      masterPlanId: version.masterPlanId,
      planVersionId: version.id,
      subscriptionId: subscription.id,
      eventType: BillingHistoryEventType.TRIAL_STARTED,
      actorUserId: user.id,
      metadata: { trialDays: BILLING_DEFAULT_TRIAL_DAYS },
    });
    return serializeSubscription(subscription);
  }

  async createCheckoutSession(
    user: AuthenticatedUser,
    tenant: SuperAgencyTenantContext,
    dto: CreateCheckoutSessionDto,
  ) {
    await this.invoiceRefreshRateLimit?.assertActionWithinLimit(
      'checkout',
      tenant.superAgencyId,
      user.id,
    );
    const price = await this.resolveCheckoutPrice(dto.planVersionId, dto.interval);
    const account = await this.ensureStripeCustomer(tenant.superAgencyId);
    const attemptIdempotencyKey = `checkout:${tenant.superAgencyId}:${price.id}`;
    const attempt = await this.prisma.billingCheckoutAttempt.upsert({
      where: { idempotencyKey: attemptIdempotencyKey },
      update: { status: BillingCheckoutAttemptStatus.OPEN },
      create: {
        superAgencyId: tenant.superAgencyId,
        masterPlanId: price.masterPlanId,
        planVersionId: price.planVersionId,
        billingPriceId: price.id,
        actorUserId: user.id,
        interval: dto.interval,
        status: BillingCheckoutAttemptStatus.OPEN,
        idempotencyKey: attemptIdempotencyKey,
      },
    });
    const appUrl = webAppUrl();
    const session = await this.stripeOrThrow().createCheckoutSession({
      customerId: account.stripeCustomerId,
      priceId: requireExternalPrice(price),
      successUrl: `${appUrl}/super-agency/billing/checkout/success?attempt=${attempt.id}`,
      cancelUrl: `${appUrl}/super-agency/billing/checkout/cancel?attempt=${attempt.id}`,
      clientReferenceId: attempt.id,
      metadata: {
        superAgencyId: tenant.superAgencyId,
        checkoutAttemptId: attempt.id,
        planVersionId: price.planVersionId,
        billingPriceId: price.id,
      },
      idempotencyKey: attemptIdempotencyKey,
    });
    await this.prisma.billingCheckoutAttempt.update({
      where: { id: attempt.id },
      data: {
        stripeSessionId: session.id,
        expiresAt: epochSecondsToDate(session.expires_at),
      },
    });
    await this.recordBillingHistory({
      superAgencyId: tenant.superAgencyId,
      masterPlanId: price.masterPlanId,
      planVersionId: price.planVersionId,
      eventType: BillingHistoryEventType.CHECKOUT_STARTED,
      actorUserId: user.id,
      metadata: {
        checkoutAttemptId: attempt.id,
        billingPriceId: price.id,
        interval: dto.interval,
      },
    });
    return { attemptId: attempt.id, url: session.url, status: 'OPEN' };
  }

  async createPortalSession(user: AuthenticatedUser, tenant: SuperAgencyTenantContext) {
    await this.invoiceRefreshRateLimit?.assertActionWithinLimit(
      'portal',
      tenant.superAgencyId,
      user.id,
    );
    const account = await this.prisma.superAgencyBillingAccount.findUnique({
      where: { superAgencyId: tenant.superAgencyId },
      select: { stripeCustomerId: true },
    });
    if (!account?.stripeCustomerId)
      throw new BadRequestException('Stripe customer is not configured.');
    const appUrl = webAppUrl();
    const session = await this.stripeOrThrow().createPortalSession({
      customerId: account.stripeCustomerId,
      returnUrl: `${appUrl}/super-agency/billing`,
      idempotencyKey: `portal:${tenant.superAgencyId}:${Date.now()}`,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: user.id,
      action: 'billing.portal.created',
      entityType: 'SuperAgencyBillingAccount',
      metadata: { provider: BillingProvider.STRIPE },
    });
    await this.recordBillingHistory({
      superAgencyId: tenant.superAgencyId,
      eventType: BillingHistoryEventType.PORTAL_SESSION_CREATED,
      actorUserId: user.id,
      metadata: { provider: BillingProvider.STRIPE },
    });
    return { url: session.url };
  }

  async changeSubscription(
    user: AuthenticatedUser,
    tenant: SuperAgencyTenantContext,
    dto: ChangeSubscriptionDto,
  ) {
    await this.invoiceRefreshRateLimit?.assertActionWithinLimit(
      'subscriptionChange',
      tenant.superAgencyId,
      user.id,
    );
    const current = await this.prisma.superAgencySubscription.findFirst({
      where: { superAgencyId: tenant.superAgencyId, isCurrent: true },
      select: subscriptionSelect,
      orderBy: { createdAt: 'desc' },
    });
    if (!current?.stripeSubscriptionId || !current.stripeSubscriptionItemId) {
      throw new BadRequestException('A paid Stripe subscription is required for plan changes.');
    }
    if (current.pendingBillingPriceId || current.pendingPlanVersionId) {
      throw new ConflictException('A subscription change is already scheduled.');
    }
    if (current.cancelAtPeriodEnd) {
      throw new ConflictException('Subscription is already scheduled for cancellation.');
    }
    const target = await this.resolveCheckoutPrice(dto.planVersionId, dto.interval);
    const direction = compareTierRanks(current.masterPlan.tierRank, target.masterPlan.tierRank);
    if (direction === 'UPGRADE') {
      await this.stripeOrThrow().updateSubscriptionForUpgrade({
        subscriptionId: current.stripeSubscriptionId,
        subscriptionItemId: current.stripeSubscriptionItemId,
        priceId: requireExternalPrice(target),
        idempotencyKey: `upgrade:${current.id}:${target.id}`,
      });
      await this.prisma.superAgencySubscription.update({
        where: { id: current.id },
        data: {
          pendingPlanVersionId: target.planVersionId,
          pendingBillingPriceId: target.id,
          pendingChangeEffectiveAt: null,
        },
      });
      await this.recordBillingHistory({
        superAgencyId: tenant.superAgencyId,
        masterPlanId: target.masterPlanId,
        planVersionId: target.planVersionId,
        subscriptionId: current.id,
        eventType: BillingHistoryEventType.UPGRADE_REQUESTED,
        actorUserId: user.id,
        metadata: { targetBillingPriceId: target.id, interval: dto.interval },
      });
      return { status: 'UPGRADE_REQUESTED', effective: 'AFTER_PROVIDER_CONFIRMATION' };
    }

    const currentPriceId = requireExternalPrice(current.billingPrice);
    if (!current.currentPeriodStart || !current.currentPeriodEnd) {
      throw new BadRequestException('Current billing period is required for scheduled changes.');
    }
    await this.stripeOrThrow().schedulePriceChange({
      subscriptionId: current.stripeSubscriptionId,
      currentPriceId,
      priceId: requireExternalPrice(target),
      currentPeriodStart: current.currentPeriodStart,
      currentPeriodEnd: current.currentPeriodEnd,
      idempotencyKey: `schedule:${current.id}:${target.id}`,
    });
    await this.prisma.superAgencySubscription.update({
      where: { id: current.id },
      data: {
        pendingPlanVersionId: target.planVersionId,
        pendingBillingPriceId: target.id,
        pendingChangeEffectiveAt: current.currentPeriodEnd,
      },
    });
    await this.recordBillingHistory({
      superAgencyId: tenant.superAgencyId,
      masterPlanId: target.masterPlanId,
      planVersionId: target.planVersionId,
      subscriptionId: current.id,
      eventType: BillingHistoryEventType.DOWNGRADE_SCHEDULED,
      actorUserId: user.id,
      metadata: { targetBillingPriceId: target.id, interval: dto.interval, direction },
    });
    return { status: 'CHANGE_SCHEDULED', effectiveAt: current.currentPeriodEnd };
  }

  async cancelSubscription(
    user: AuthenticatedUser,
    tenant: SuperAgencyTenantContext,
    dto: CancelSubscriptionDto,
    platformImmediate = false,
  ) {
    await this.invoiceRefreshRateLimit?.assertActionWithinLimit(
      'subscriptionCancel',
      tenant.superAgencyId,
      user.id,
    );
    const current = await this.prisma.superAgencySubscription.findFirst({
      where: { superAgencyId: tenant.superAgencyId, isCurrent: true },
      select: subscriptionSelect,
      orderBy: { createdAt: 'desc' },
    });
    if (!current) throw new NotFoundException('Current subscription not found.');
    if (dto.immediate && !platformImmediate) {
      throw new ForbiddenException('Immediate cancellation is platform-only.');
    }
    if (current.stripeSubscriptionId) {
      if (dto.immediate) {
        await this.stripeOrThrow().cancelImmediately(
          current.stripeSubscriptionId,
          `cancel-now:${current.id}`,
        );
      } else {
        await this.stripeOrThrow().cancelAtPeriodEnd(
          current.stripeSubscriptionId,
          `cancel-period-end:${current.id}`,
        );
      }
    }
    const now = new Date();
    const updated = await this.prisma.superAgencySubscription.update({
      where: { id: current.id },
      data: dto.immediate
        ? {
            status: SuperAgencySubscriptionStatus.CANCELED,
            canceledAt: now,
            endedAt: now,
            restrictedAt: now,
            pendingPlanVersionId: null,
            pendingBillingPriceId: null,
            pendingChangeEffectiveAt: null,
          }
        : {
            cancelAtPeriodEnd: true,
            canceledAt: now,
            pendingPlanVersionId: null,
            pendingBillingPriceId: null,
            pendingChangeEffectiveAt: null,
          },
      select: subscriptionSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: user.id,
      action: dto.immediate
        ? 'billing.subscription.cancelled_immediately'
        : 'billing.subscription.cancel_at_period_end',
      entityType: 'SuperAgencySubscription',
      entityId: current.id,
    });
    await this.recordBillingHistory({
      superAgencyId: tenant.superAgencyId,
      masterPlanId: current.masterPlanId,
      planVersionId: current.planVersionId,
      subscriptionId: current.id,
      eventType: dto.immediate
        ? BillingHistoryEventType.CANCELED
        : BillingHistoryEventType.CANCELLATION_REQUESTED,
      actorUserId: user.id,
    });
    return serializeSubscription(updated);
  }

  async listInvoices(tenant: SuperAgencyTenantContext, query: BillingInvoiceListQueryDto) {
    return this.listInvoicesForSuperAgency(tenant.superAgencyId, query, true);
  }

  async listSupportInvoices(superAgencyId: string, query: BillingInvoiceListQueryDto) {
    const superAgency = await this.prisma.superAgency.findUnique({
      where: { id: superAgencyId },
      select: { id: true },
    });
    if (!superAgency) throw new NotFoundException('Super Agency not found.');
    return this.listInvoicesForSuperAgency(superAgencyId, query, false);
  }

  async refreshInvoices(user: AuthenticatedUser, tenant: SuperAgencyTenantContext) {
    await this.invoiceRefreshRateLimit?.assertWithinLimit(tenant.superAgencyId, user.id);
    const gateway = this.stripeOrThrow();
    const account = await this.prisma.superAgencyBillingAccount.findUnique({
      where: { superAgencyId: tenant.superAgencyId },
      select: { stripeCustomerId: true },
    });
    if (!account?.stripeCustomerId) {
      return { synced: 0, provider: BillingProvider.STRIPE, lastSyncedAt: new Date() };
    }
    const invoices = await gateway.listInvoices({
      customerId: account.stripeCustomerId,
      limit: 25,
    });
    let synced = 0;
    for (const invoice of invoices.data ?? []) {
      const projection = await this.upsertInvoiceProjection(
        invoice as unknown as StripeInvoiceLike,
      );
      if (projection?.superAgencyId === tenant.superAgencyId) synced += 1;
    }
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: user.id,
      action: 'billing.invoices.refreshed',
      entityType: 'SuperAgencyBillingAccount',
      metadata: { provider: BillingProvider.STRIPE, synced },
    });
    return { synced, provider: BillingProvider.STRIPE, lastSyncedAt: new Date() };
  }

  async getPaymentMethodSummary(tenant: SuperAgencyTenantContext) {
    const account = await this.prisma.superAgencyBillingAccount.findUnique({
      where: { superAgencyId: tenant.superAgencyId },
      select: { stripeCustomerId: true },
    });
    if (!account?.stripeCustomerId) {
      return { provider: BillingProvider.STRIPE, paymentMethod: null };
    }
    const method = await this.stripeOrThrow().retrieveDefaultPaymentMethod(
      account.stripeCustomerId,
    );
    return {
      provider: BillingProvider.STRIPE,
      paymentMethod: serializePaymentMethodSummary(method as StripePaymentMethodLike | null),
    };
  }

  async listBillingHistory(tenant: SuperAgencyTenantContext, query: BillingInvoiceListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.billingHistory.findMany({
        where: { superAgencyId: tenant.superAgencyId },
        select: {
          id: true,
          eventType: true,
          createdAt: true,
          masterPlan: { select: { displayName: true } },
          planVersion: { select: { versionNumber: true } },
          subscriptionId: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.billingHistory.count({ where: { superAgencyId: tenant.superAgencyId } }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        eventType: item.eventType,
        label: billingHistoryLabel(item.eventType),
        createdAt: item.createdAt,
        planName: item.masterPlan?.displayName ?? null,
        planVersion: item.planVersion?.versionNumber ?? null,
        subscriptionId: item.subscriptionId,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!signature) throw new BadRequestException('STRIPE_SIGNATURE_REQUIRED');
    const event = this.stripeOrThrow().constructWebhookEvent(rawBody, signature);
    const object = event.data.object as unknown as StripeObjectRecord;
    const existing = await this.prisma.stripeBillingEvent.findUnique({
      where: { stripeEventId: event.id },
      select: { id: true, status: true },
    });
    if (
      existing?.status === StripeBillingEventStatus.PROCESSED ||
      existing?.status === StripeBillingEventStatus.IGNORED
    ) {
      return { received: true, duplicate: true };
    }
    const ledger = existing
      ? existing
      : await this.prisma.stripeBillingEvent.create({
          data: {
            stripeEventId: event.id,
            eventType: event.type,
            status: StripeBillingEventStatus.RECEIVED,
            stripeCustomerId: stringOrNull(object.customer),
            stripeSubscriptionId: stringOrNull(object.subscription) ?? stringOrNull(object.id),
            stripeCheckoutSessionId: event.type.startsWith('checkout.')
              ? stringOrNull(object.id)
              : null,
            providerCreatedAt: epochSecondsToDate(event.created),
            metadata: safeStripeEventMetadata(event.type, object),
          },
          select: { id: true, status: true },
        });

    try {
      const result = await this.processStripeEvent(event.type, object);
      await this.prisma.stripeBillingEvent.update({
        where: { id: ledger.id },
        data: {
          status: result.ignored
            ? StripeBillingEventStatus.IGNORED
            : StripeBillingEventStatus.PROCESSED,
          processedAt: new Date(),
          superAgencyId: result.superAgencyId,
        },
      });
      return { received: true, ignored: result.ignored === true };
    } catch (error) {
      await this.prisma.stripeBillingEvent.update({
        where: { id: ledger.id },
        data: { status: StripeBillingEventStatus.FAILED, safeErrorCode: safeErrorCode(error) },
      });
      throw error;
    }
  }

  async processBillingDeadlines(now = new Date()) {
    const [trialGrace, restricted] = await this.prisma.$transaction(async (tx) => {
      const trialing = await tx.superAgencySubscription.findMany({
        where: {
          isCurrent: true,
          status: SuperAgencySubscriptionStatus.TRIALING,
          trialEndsAt: { lte: now },
        },
        select: { id: true, superAgencyId: true, masterPlanId: true, planVersionId: true },
        take: 100,
        orderBy: { trialEndsAt: 'asc' },
      });
      for (const subscription of trialing) {
        await tx.superAgencySubscription.update({
          where: { id: subscription.id },
          data: {
            status: SuperAgencySubscriptionStatus.TRIAL_GRACE,
            graceStartedAt: now,
            graceEndsAt: addDays(now, BILLING_GRACE_PERIOD_DAYS),
          },
        });
        await tx.billingHistory.create({
          data: {
            superAgencyId: subscription.superAgencyId,
            masterPlanId: subscription.masterPlanId,
            planVersionId: subscription.planVersionId,
            subscriptionId: subscription.id,
            eventType: BillingHistoryEventType.TRIAL_GRACE_STARTED,
            metadata: { source: 'WORKER', graceDays: BILLING_GRACE_PERIOD_DAYS },
          },
        });
      }

      const graceExpired = await tx.superAgencySubscription.findMany({
        where: {
          isCurrent: true,
          status: {
            in: [
              SuperAgencySubscriptionStatus.GRACE_PERIOD,
              SuperAgencySubscriptionStatus.TRIAL_GRACE,
              SuperAgencySubscriptionStatus.PAYMENT_GRACE,
              SuperAgencySubscriptionStatus.PAST_DUE,
            ],
          },
          graceEndsAt: { lte: now },
        },
        select: { id: true, superAgencyId: true, masterPlanId: true, planVersionId: true },
        take: 100,
        orderBy: { graceEndsAt: 'asc' },
      });
      for (const subscription of graceExpired) {
        await tx.superAgencySubscription.update({
          where: { id: subscription.id },
          data: { status: SuperAgencySubscriptionStatus.RESTRICTED, restrictedAt: now },
        });
        await tx.billingHistory.create({
          data: {
            superAgencyId: subscription.superAgencyId,
            masterPlanId: subscription.masterPlanId,
            planVersionId: subscription.planVersionId,
            subscriptionId: subscription.id,
            eventType: BillingHistoryEventType.RESTRICTED,
            metadata: { source: 'WORKER' },
          },
        });
      }
      return [trialing.length, graceExpired.length] as const;
    });
    return { trialGraceStarted: trialGrace, restricted };
  }

  async resolveAccessState(superAgencyId: string, now = new Date()) {
    const subscription = await this.prisma.superAgencySubscription.findFirst({
      where: { superAgencyId, isCurrent: true },
      select: {
        id: true,
        status: true,
        trialEndsAt: true,
        graceEndsAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return { level: 'FULL' as const, reason: 'NO_SUBSCRIPTION' as const };
    if (
      subscription.status === SuperAgencySubscriptionStatus.TRIALING &&
      subscription.trialEndsAt
    ) {
      const graceEnd = addDays(subscription.trialEndsAt, BILLING_GRACE_PERIOD_DAYS);
      if (now > graceEnd)
        return {
          level: 'READ_ONLY_RESTRICTED' as const,
          reason: 'TRIAL_EXPIRED' as const,
          subscription,
        };
      if (now > subscription.trialEndsAt)
        return {
          level: 'FULL_WITH_WARNING' as const,
          reason: 'TRIAL_GRACE' as const,
          subscription,
          graceEndsAt: graceEnd,
        };
    }
    if (fullAccessStatuses.has(subscription.status)) {
      return { level: 'FULL' as const, reason: subscription.status, subscription };
    }
    if (warningAccessStatuses.has(subscription.status)) {
      if (subscription.graceEndsAt && now > subscription.graceEndsAt) {
        return {
          level: 'READ_ONLY_RESTRICTED' as const,
          reason: 'GRACE_EXPIRED' as const,
          subscription,
        };
      }
      return { level: 'FULL_WITH_WARNING' as const, reason: subscription.status, subscription };
    }
    return { level: 'READ_ONLY_RESTRICTED' as const, reason: subscription.status, subscription };
  }

  async getSubscriptionState(tenant: SuperAgencyTenantContext) {
    const subscription = await this.currentSubscription(tenant.superAgencyId);
    const access = await this.resolveAccessState(tenant.superAgencyId);
    return {
      superAgencyId: tenant.superAgencyId,
      hasCurrentSubscription: Boolean(subscription),
      subscription: subscription ? serializeSubscription(subscription) : null,
      access,
    };
  }

  async getEffectiveEntitlements(superAgencyId: string) {
    if (this.entitlementService) {
      return this.entitlementService.getEffectiveEntitlements(superAgencyId);
    }
    const subscription = await this.currentSubscription(superAgencyId);
    const entitlements = subscription?.planVersion.entitlements ?? [];
    return {
      superAgencyId,
      hasCurrentSubscription: Boolean(subscription),
      subscription: subscription ? serializeSubscription(subscription) : null,
      features: entitlements
        .filter((item) => item.kind === PlanEntitlementKind.FEATURE)
        .map((item) => ({ key: item.key, enabled: item.booleanValue === true })),
      limits: entitlements
        .filter((item) => item.kind === PlanEntitlementKind.LIMIT)
        .map((item) => ({
          key: item.key,
          valueType: item.valueType,
          unlimited: item.unlimited,
          value: item.numericValue?.toString() ?? null,
        })),
    };
  }

  async listPublicCheckoutPlans() {
    const plans = await this.prisma.masterPlan.findMany({
      where: {
        type: MasterPlanType.PUBLIC,
        status: MasterPlanStatus.ACTIVE,
        versions: {
          some: {
            status: PlanVersionStatus.PUBLISHED,
            prices: {
              some: {
                provider: BillingProvider.STRIPE,
                status: BillingPriceStatus.ACTIVE,
                currency: 'USD',
                externalPriceId: { not: null },
              },
            },
          },
        },
      },
      select: planDetailSelect,
      orderBy: [{ tierRank: 'asc' }, { displayName: 'asc' }],
    });
    return plans.map(serializePlan);
  }

  async hasFeature(superAgencyId: string, featureKey: string) {
    assertFeatureKey(featureKey);
    if (this.entitlementService) {
      return (
        await this.entitlementService.resolveEffectiveFeature(
          superAgencyId,
          featureKey as (typeof PLAN_FEATURE_KEYS)[number],
        )
      ).enabled;
    }
    const entitlements = await this.getEffectiveEntitlements(superAgencyId);
    return entitlements.features.some((feature) => feature.key === featureKey && feature.enabled);
  }

  async getLimit(superAgencyId: string, limitKey: string) {
    assertLimitKey(limitKey);
    const entitlements = await this.getEffectiveEntitlements(superAgencyId);
    return entitlements.limits.find((limit) => limit.key === limitKey) ?? null;
  }

  private async processStripeEvent(eventType: string, object: StripeObjectRecord) {
    let invoiceProjection: { superAgencyId: string } | null = null;
    if (invoiceEventTypes.has(eventType)) {
      const invoiceId = stringOrNull(object.id);
      if (invoiceId) {
        const invoice = await this.stripeOrThrow().retrieveInvoice(invoiceId);
        invoiceProjection = await this.upsertInvoiceProjection(
          invoice as unknown as StripeInvoiceLike,
        );
      }
    }

    if (eventType === 'checkout.session.completed') {
      const sessionId = stringOrNull(object.id);
      const subscriptionId = stringOrNull(object.subscription);
      if (!sessionId || !subscriptionId) return { ignored: true };
      const attempt = await this.prisma.billingCheckoutAttempt.findUnique({
        where: { stripeSessionId: sessionId },
        select: {
          id: true,
          superAgencyId: true,
          masterPlanId: true,
          planVersionId: true,
          billingPriceId: true,
          interval: true,
        },
      });
      if (!attempt) return { ignored: true };
      const subscription = await this.stripeOrThrow().retrieveSubscription(subscriptionId);
      await this.activatePaidSubscriptionFromProvider(attempt, subscription);
      await this.prisma.billingCheckoutAttempt.update({
        where: { id: attempt.id },
        data: {
          status: BillingCheckoutAttemptStatus.COMPLETED,
          completedAt: new Date(),
          stripeSubscriptionId: subscriptionId,
        },
      });
      return { superAgencyId: attempt.superAgencyId };
    }

    if (
      eventType === 'customer.subscription.created' ||
      eventType === 'customer.subscription.updated' ||
      eventType === 'customer.subscription.deleted' ||
      eventType === 'customer.subscription.pending_update_expired'
    ) {
      const subscriptionId = stringOrNull(object.id);
      if (!subscriptionId) return { ignored: true };
      const subscription = await this.stripeOrThrow().retrieveSubscription(subscriptionId);
      const internal = await this.reconcileStripeSubscription(subscription);
      return internal ? { superAgencyId: internal.superAgencyId } : { ignored: true };
    }

    if (eventType === 'invoice.payment_failed') {
      const subscriptionId = stringOrNull(object.subscription);
      if (!subscriptionId) return { ignored: true };
      const providerSubscription = await this.stripeOrThrow().retrieveSubscription(subscriptionId);
      const status = mapStripeStatus(providerSubscription.status);
      if (status === SuperAgencySubscriptionStatus.ACTIVE) return { ignored: true };
      const internal = await this.startPaymentGrace(subscriptionId);
      return internal
        ? { superAgencyId: internal.superAgencyId }
        : invoiceProjection
          ? { superAgencyId: invoiceProjection.superAgencyId }
          : { ignored: true };
    }

    if (eventType === 'invoice.paid') {
      const subscriptionId = stringOrNull(object.subscription);
      if (!subscriptionId) return { ignored: true };
      const internal = await this.recoverPayment(subscriptionId);
      return internal
        ? { superAgencyId: internal.superAgencyId }
        : invoiceProjection
          ? { superAgencyId: invoiceProjection.superAgencyId }
          : { ignored: true };
    }

    if (invoiceProjection) return { superAgencyId: invoiceProjection.superAgencyId };

    return { ignored: true };
  }

  private async listInvoicesForSuperAgency(
    superAgencyId: string,
    query: BillingInvoiceListQueryDto,
    includeLinks: boolean,
  ) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const normalizedStatus = query.status?.trim().toLowerCase();
    if (normalizedStatus && !invoiceStatusFilters.has(normalizedStatus)) {
      throw new BadRequestException('Unsupported invoice status filter.');
    }
    const where: Prisma.BillingInvoiceWhereInput = {
      superAgencyId,
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.billingInvoice.findMany({
        where,
        select: billingInvoiceSelect,
        orderBy: [{ providerCreatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.billingInvoice.count({ where }),
    ]);
    return {
      items: items.map((item) => serializeInvoice(item, includeLinks)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private async upsertInvoiceProjection(invoice: StripeInvoiceLike) {
    const providerInvoiceId = stringOrNull(invoice.id);
    if (!providerInvoiceId) return null;
    const customerId = stringOrNull(invoice.customer);
    const providerSubscriptionId = stringOrNull(invoice.subscription);
    const superAgencyId = await this.resolveInvoiceSuperAgency(customerId, providerSubscriptionId);
    if (!superAgencyId) return null;
    const data = stripeInvoiceProjectionData(invoice, superAgencyId);
    return this.prisma.billingInvoice.upsert({
      where: {
        provider_providerInvoiceId: {
          provider: BillingProvider.STRIPE,
          providerInvoiceId,
        },
      },
      update: {
        ...data,
        lastSyncedAt: new Date(),
      },
      create: data,
      select: { id: true, superAgencyId: true },
    });
  }

  private async resolveInvoiceSuperAgency(
    customerId: string | null,
    subscriptionId: string | null,
  ) {
    if (customerId) {
      const account = await this.prisma.superAgencyBillingAccount.findUnique({
        where: { stripeCustomerId: customerId },
        select: { superAgencyId: true },
      });
      if (account) return account.superAgencyId;
    }
    if (subscriptionId) {
      const subscription = await this.prisma.superAgencySubscription.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
        select: { superAgencyId: true },
      });
      if (subscription) return subscription.superAgencyId;
    }
    return null;
  }

  private async activatePaidSubscriptionFromProvider(
    attempt: {
      superAgencyId: string;
      masterPlanId: string;
      planVersionId: string;
      billingPriceId: string;
      interval: BillingInterval;
    },
    providerSubscription: ProviderSubscription,
  ) {
    const now = new Date();
    const providerData = providerSubscriptionData(providerSubscription);
    const subscription = await this.prisma.$transaction(async (tx) => {
      const current = await tx.superAgencySubscription.findFirst({
        where: { superAgencyId: attempt.superAgencyId, isCurrent: true },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      const data = {
        masterPlanId: attempt.masterPlanId,
        planVersionId: attempt.planVersionId,
        billingPriceId: attempt.billingPriceId,
        provider: BillingProvider.STRIPE,
        status: SuperAgencySubscriptionStatus.ACTIVE,
        isCurrent: true,
        billingInterval: attempt.interval,
        stripeSubscriptionId: providerData.subscriptionId,
        stripeSubscriptionItemId: providerData.subscriptionItemId,
        providerStatus: providerData.status,
        currentPeriodStart: providerData.currentPeriodStart,
        currentPeriodEnd: providerData.currentPeriodEnd,
        cancelAtPeriodEnd: providerData.cancelAtPeriodEnd,
        graceStartedAt: null,
        graceEndsAt: null,
        restrictedAt: null,
        startedAt: now,
      } satisfies Prisma.SuperAgencySubscriptionUncheckedUpdateInput;
      if (current) {
        return tx.superAgencySubscription.update({
          where: { id: current.id },
          data,
          select: subscriptionSelect,
        });
      }
      return tx.superAgencySubscription.create({
        data: {
          superAgencyId: attempt.superAgencyId,
          ...data,
        } as Prisma.SuperAgencySubscriptionUncheckedCreateInput,
        select: subscriptionSelect,
      });
    });
    await this.recordBillingHistory({
      superAgencyId: attempt.superAgencyId,
      masterPlanId: attempt.masterPlanId,
      planVersionId: attempt.planVersionId,
      subscriptionId: subscription.id,
      eventType: BillingHistoryEventType.SUBSCRIPTION_ACTIVATED,
      metadata: {
        source: 'STRIPE',
        billingPriceId: attempt.billingPriceId,
        stripeSubscriptionId: providerData.subscriptionId,
      },
    });
    return subscription;
  }

  private async reconcileStripeSubscription(providerSubscription: ProviderSubscription) {
    const providerData = providerSubscriptionData(providerSubscription);
    const internal = await this.prisma.superAgencySubscription.findUnique({
      where: { stripeSubscriptionId: providerData.subscriptionId },
      select: subscriptionSelect,
    });
    if (!internal) return null;
    const mapped = mapStripeStatus(providerData.status);
    const providerPrice = providerData.priceId
      ? await this.prisma.billingPrice.findUnique({
          where: { externalPriceId: providerData.priceId },
          select: billingPriceSelect,
        })
      : null;
    const confirmedPendingPrice =
      providerPrice && internal.pendingBillingPriceId === providerPrice.id ? providerPrice : null;
    const clearExpiredPending =
      Boolean(internal.pendingBillingPriceId) &&
      !providerData.pendingUpdate &&
      providerData.priceId === internal.billingPrice?.externalPriceId;
    const updated = await this.prisma.superAgencySubscription.update({
      where: { id: internal.id },
      data: {
        ...(confirmedPendingPrice
          ? {
              masterPlanId: confirmedPendingPrice.masterPlanId,
              planVersionId: confirmedPendingPrice.planVersionId,
              billingPriceId: confirmedPendingPrice.id,
              billingInterval: confirmedPendingPrice.interval,
              pendingPlanVersionId: null,
              pendingBillingPriceId: null,
              pendingChangeEffectiveAt: null,
            }
          : clearExpiredPending
            ? {
                pendingPlanVersionId: null,
                pendingBillingPriceId: null,
                pendingChangeEffectiveAt: null,
              }
            : {}),
        status: mapped,
        providerStatus: providerData.status,
        stripeSubscriptionItemId: providerData.subscriptionItemId,
        currentPeriodStart: providerData.currentPeriodStart,
        currentPeriodEnd: providerData.currentPeriodEnd,
        cancelAtPeriodEnd: providerData.cancelAtPeriodEnd,
        canceledAt: providerData.canceledAt,
        endedAt:
          mapped === SuperAgencySubscriptionStatus.CANCELED
            ? (providerData.canceledAt ?? new Date())
            : internal.endedAt,
        restrictedAt:
          mapped === SuperAgencySubscriptionStatus.CANCELED
            ? (providerData.canceledAt ?? new Date())
            : internal.restrictedAt,
      },
      select: subscriptionSelect,
    });
    if (mapped === SuperAgencySubscriptionStatus.CANCELED) {
      await this.recordBillingHistory({
        superAgencyId: updated.superAgencyId,
        masterPlanId: updated.masterPlanId,
        planVersionId: updated.planVersionId,
        subscriptionId: updated.id,
        eventType: BillingHistoryEventType.CANCELED,
        metadata: { source: 'STRIPE' },
      });
    }
    if (confirmedPendingPrice) {
      const direction = compareTierRanks(
        internal.masterPlan.tierRank,
        confirmedPendingPrice.masterPlan.tierRank,
      );
      await this.recordBillingHistory({
        superAgencyId: updated.superAgencyId,
        masterPlanId: confirmedPendingPrice.masterPlanId,
        planVersionId: confirmedPendingPrice.planVersionId,
        subscriptionId: updated.id,
        eventType:
          direction === 'UPGRADE'
            ? BillingHistoryEventType.UPGRADE_COMPLETED
            : BillingHistoryEventType.DOWNGRADE_APPLIED,
        metadata: {
          source: 'STRIPE',
          billingPriceId: confirmedPendingPrice.id,
          stripeSubscriptionId: providerData.subscriptionId,
        },
      });
    }
    return updated;
  }

  private async startPaymentGrace(stripeSubscriptionId: string) {
    const current = await this.prisma.superAgencySubscription.findUnique({
      where: { stripeSubscriptionId },
      select: subscriptionSelect,
    });
    if (!current) return null;
    if (
      current.status === SuperAgencySubscriptionStatus.PAYMENT_GRACE ||
      current.status === SuperAgencySubscriptionStatus.RESTRICTED
    ) {
      return current;
    }
    const now = new Date();
    const updated = await this.prisma.superAgencySubscription.update({
      where: { id: current.id },
      data: {
        status: SuperAgencySubscriptionStatus.PAYMENT_GRACE,
        graceStartedAt: now,
        graceEndsAt: addDays(now, BILLING_GRACE_PERIOD_DAYS),
      },
      select: subscriptionSelect,
    });
    await this.recordBillingHistory({
      superAgencyId: updated.superAgencyId,
      masterPlanId: updated.masterPlanId,
      planVersionId: updated.planVersionId,
      subscriptionId: updated.id,
      eventType: BillingHistoryEventType.PAYMENT_FAILED,
      metadata: { source: 'STRIPE', graceDays: BILLING_GRACE_PERIOD_DAYS },
    });
    return updated;
  }

  private async recoverPayment(stripeSubscriptionId: string) {
    const current = await this.prisma.superAgencySubscription.findUnique({
      where: { stripeSubscriptionId },
      select: subscriptionSelect,
    });
    if (!current) return null;
    const updated = await this.prisma.superAgencySubscription.update({
      where: { id: current.id },
      data: {
        status: SuperAgencySubscriptionStatus.ACTIVE,
        graceStartedAt: null,
        graceEndsAt: null,
        restrictedAt: null,
      },
      select: subscriptionSelect,
    });
    await this.recordBillingHistory({
      superAgencyId: updated.superAgencyId,
      masterPlanId: updated.masterPlanId,
      planVersionId: updated.planVersionId,
      subscriptionId: updated.id,
      eventType:
        current.status === SuperAgencySubscriptionStatus.RESTRICTED
          ? BillingHistoryEventType.REACTIVATED
          : BillingHistoryEventType.PAYMENT_RECOVERED,
      metadata: { source: 'STRIPE' },
    });
    return updated;
  }

  private async resolveCheckoutPrice(planVersionId: string, interval: BillingInterval) {
    const price = await this.prisma.billingPrice.findFirst({
      where: {
        planVersionId,
        interval,
        currency: 'USD',
        provider: BillingProvider.STRIPE,
        status: BillingPriceStatus.ACTIVE,
      },
      select: billingPriceSelect,
    });
    if (!price) throw new NotFoundException('Active Stripe price not found for plan and interval.');
    if (price.planVersion.status !== PlanVersionStatus.PUBLISHED) {
      throw new BadRequestException('Checkout requires a published plan version.');
    }
    if (price.masterPlan.type !== MasterPlanType.PUBLIC) {
      throw new ForbiddenException('Only public plans are eligible for self-service checkout.');
    }
    if (!price.externalPriceId) {
      throw new ServiceUnavailableException('STRIPE_PRICE_NOT_SYNCED');
    }
    return price;
  }

  private async ensureStripeCustomer(superAgencyId: string) {
    const gateway = this.stripeOrThrow();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-customer:${superAgencyId}`}))`;
      const existing = await tx.superAgencyBillingAccount.findUnique({
        where: { superAgencyId },
        select: { id: true, stripeCustomerId: true },
      });
      if (existing?.stripeCustomerId) return existing as { id: string; stripeCustomerId: string };
      const superAgency = await tx.superAgency.findUnique({
        where: { id: superAgencyId },
        select: { id: true, name: true },
      });
      if (!superAgency) throw new NotFoundException('Super Agency not found.');
      const customer = await gateway.createCustomer({
        name: superAgency.name,
        metadata: { superAgencyId },
        idempotencyKey: `customer:${superAgencyId}`,
      });
      return tx.superAgencyBillingAccount.upsert({
        where: { superAgencyId },
        update: { stripeCustomerId: customer.id },
        create: {
          superAgencyId,
          provider: BillingProvider.STRIPE,
          stripeCustomerId: customer.id,
        },
        select: { id: true, stripeCustomerId: true },
      }) as Promise<{ id: string; stripeCustomerId: string }>;
    });
  }

  private stripeOrThrow() {
    if (!this.stripe?.enabled) throw new ServiceUnavailableException('STRIPE_DISABLED');
    return this.stripe;
  }

  private currentSubscription(superAgencyId: string) {
    return this.prisma.superAgencySubscription.findFirst({
      where: {
        superAgencyId,
        isCurrent: true,
        status: { in: [...currentSubscriptionStatuses] },
      },
      select: subscriptionSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  private async recordBillingHistory(data: Prisma.BillingHistoryUncheckedCreateInput) {
    await this.prisma.billingHistory.create({ data });
  }
}

const entitlementSelect = {
  id: true,
  key: true,
  kind: true,
  valueType: true,
  booleanValue: true,
  numericValue: true,
  unlimited: true,
} satisfies Prisma.PlanEntitlementSelect;

const planSummarySelect = {
  id: true,
  key: true,
  type: true,
  tierRank: true,
  externalProductId: true,
  displayName: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  versions: {
    select: { id: true, versionNumber: true, status: true, publishedAt: true, archivedAt: true },
    orderBy: { versionNumber: 'desc' },
    take: 5,
  },
  prices: {
    select: {
      id: true,
      planVersionId: true,
      provider: true,
      currency: true,
      interval: true,
      amountMinor: true,
      externalProductId: true,
      externalPriceId: true,
      status: true,
    },
    orderBy: [{ interval: 'asc' }, { createdAt: 'desc' }],
  },
} satisfies Prisma.MasterPlanSelect;

const planDetailSelect = {
  ...planSummarySelect,
  versions: {
    select: {
      id: true,
      versionNumber: true,
      status: true,
      publishedAt: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      entitlements: { select: entitlementSelect, orderBy: { key: 'asc' } },
    },
    orderBy: { versionNumber: 'desc' },
  },
} satisfies Prisma.MasterPlanSelect;

const subscriptionSelect = {
  id: true,
  superAgencyId: true,
  masterPlanId: true,
  planVersionId: true,
  billingPriceId: true,
  provider: true,
  status: true,
  isCurrent: true,
  billingInterval: true,
  stripeSubscriptionId: true,
  stripeSubscriptionItemId: true,
  providerStatus: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  canceledAt: true,
  trialStartedAt: true,
  trialEndsAt: true,
  graceStartedAt: true,
  graceEndsAt: true,
  restrictedAt: true,
  pendingPlanVersionId: true,
  pendingBillingPriceId: true,
  pendingChangeEffectiveAt: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
  masterPlan: {
    select: {
      id: true,
      key: true,
      type: true,
      tierRank: true,
      displayName: true,
      status: true,
    },
  },
  billingPrice: {
    select: {
      id: true,
      currency: true,
      interval: true,
      amountMinor: true,
      externalPriceId: true,
      status: true,
    },
  },
  planVersion: {
    select: {
      id: true,
      versionNumber: true,
      status: true,
      publishedAt: true,
      entitlements: { select: entitlementSelect, orderBy: { key: 'asc' } },
    },
  },
} satisfies Prisma.SuperAgencySubscriptionSelect;

const billingPriceSelect = {
  id: true,
  masterPlanId: true,
  planVersionId: true,
  provider: true,
  currency: true,
  interval: true,
  amountMinor: true,
  externalProductId: true,
  externalPriceId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  masterPlan: {
    select: {
      id: true,
      key: true,
      type: true,
      tierRank: true,
      displayName: true,
      status: true,
    },
  },
  planVersion: {
    select: {
      id: true,
      status: true,
      versionNumber: true,
    },
  },
} satisfies Prisma.BillingPriceSelect;

const billingInvoiceSelect = {
  id: true,
  superAgencyId: true,
  provider: true,
  providerInvoiceId: true,
  providerSubscriptionId: true,
  invoiceNumber: true,
  currency: true,
  status: true,
  amountDueMinor: true,
  amountPaidMinor: true,
  amountRemainingMinor: true,
  providerCreatedAt: true,
  dueAt: true,
  periodStart: true,
  periodEnd: true,
  finalizedAt: true,
  paidAt: true,
  voidedAt: true,
  hostedInvoiceUrl: true,
  invoicePdfUrl: true,
  lastSyncedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BillingInvoiceSelect;

type PlanRecord = Prisma.MasterPlanGetPayload<{ select: typeof planDetailSelect }>;
type SubscriptionRecord = Prisma.SuperAgencySubscriptionGetPayload<{
  select: typeof subscriptionSelect;
}>;
type EntitlementRecord = Prisma.PlanEntitlementGetPayload<{ select: typeof entitlementSelect }>;
type BillingInvoiceRecord = Prisma.BillingInvoiceGetPayload<{
  select: typeof billingInvoiceSelect;
}>;

function serializePlan(plan: PlanRecord) {
  return {
    ...plan,
    prices: (plan.prices ?? []).map(serializePrice),
    versions: plan.versions.map((version) => ({
      ...version,
      entitlements: version.entitlements.map(serializeEntitlement),
    })),
  };
}

function serializePrice<TPrice extends { amountMinor: bigint }>(price: TPrice) {
  return {
    ...price,
    amountMinor: price.amountMinor.toString(),
  };
}

function serializeSubscription(subscription: SubscriptionRecord) {
  return {
    ...subscription,
    planVersion: {
      ...subscription.planVersion,
      entitlements: subscription.planVersion.entitlements.map(serializeEntitlement),
    },
  };
}

function serializeInvoice(invoice: BillingInvoiceRecord, includeLinks: boolean) {
  return {
    ...invoice,
    amountDueMinor: invoice.amountDueMinor.toString(),
    amountPaidMinor: invoice.amountPaidMinor.toString(),
    amountRemainingMinor: invoice.amountRemainingMinor.toString(),
    hostedInvoiceUrl: includeLinks ? invoice.hostedInvoiceUrl : null,
    invoicePdfUrl: includeLinks ? invoice.invoicePdfUrl : null,
  };
}

function serializeEntitlement(item: EntitlementRecord) {
  return {
    id: item.id,
    key: item.key,
    kind: item.kind,
    valueType: item.valueType,
    booleanValue: item.booleanValue,
    numericValue: item.numericValue?.toString() ?? null,
    unlimited: item.unlimited,
  };
}

function normalizeEntitlements(entitlements: PlanEntitlementDto[]) {
  const seen = new Set<string>();
  return entitlements.map((item) => {
    const key = item.key.trim();
    if (seen.has(key)) throw new BadRequestException('Duplicate entitlement keys are not allowed.');
    seen.add(key);
    if (item.kind === PlanEntitlementKind.FEATURE) {
      assertFeatureKey(key);
      if (item.valueType !== PlanEntitlementValueType.BOOLEAN || item.booleanValue === undefined) {
        throw new BadRequestException('Feature entitlements must be boolean values.');
      }
      return {
        key,
        kind: item.kind,
        valueType: item.valueType,
        booleanValue: item.booleanValue,
        numericValue: null,
        unlimited: false,
      };
    }
    assertLimitKey(key);
    if (item.valueType === PlanEntitlementValueType.UNLIMITED) {
      return {
        key,
        kind: item.kind,
        valueType: item.valueType,
        booleanValue: null,
        numericValue: null,
        unlimited: true,
      };
    }
    const isNumericLimit =
      item.valueType === PlanEntitlementValueType.INTEGER ||
      item.valueType === PlanEntitlementValueType.BYTES ||
      item.valueType === PlanEntitlementValueType.COUNT;
    if (!isNumericLimit || item.numericValue === undefined || item.numericValue < 0) {
      throw new BadRequestException('Limit entitlements must be numeric or unlimited values.');
    }
    return {
      key,
      kind: item.kind,
      valueType: item.valueType,
      booleanValue: null,
      numericValue: BigInt(item.numericValue),
      unlimited: false,
    };
  });
}

function deserializeEntitlementForValidation(item: EntitlementRecord): PlanEntitlementDto {
  return {
    key: item.key,
    kind: item.kind,
    valueType: item.valueType,
    booleanValue: item.booleanValue ?? undefined,
    numericValue: item.numericValue === null ? undefined : Number(item.numericValue),
    unlimited: item.unlimited,
  };
}

function assertFeatureKey(key: string) {
  if (!(PLAN_FEATURE_KEYS as readonly string[]).includes(key)) {
    throw new BadRequestException(`Unsupported plan feature key: ${key}`);
  }
}

function assertLimitKey(key: string) {
  if (!(PLAN_LIMIT_KEYS as readonly string[]).includes(key)) {
    throw new BadRequestException(`Unsupported plan limit key: ${key}`);
  }
}

function normalizePlanKey(key: string) {
  return key.trim().toLowerCase();
}

function trimNullable(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function requireExternalPrice(price: { externalPriceId: string | null } | null) {
  if (!price?.externalPriceId) throw new ServiceUnavailableException('STRIPE_PRICE_NOT_SYNCED');
  return price.externalPriceId;
}

function compareTierRanks(currentRank: number, targetRank: number) {
  if (targetRank > currentRank) return 'UPGRADE' as const;
  if (targetRank < currentRank) return 'DOWNGRADE' as const;
  return 'SAME_TIER' as const;
}

type StripeObjectRecord = Record<string, unknown>;

type StripeInvoiceLike = {
  id?: string;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  number?: string | null;
  currency?: string | null;
  status?: string | null;
  amount_due?: number | null;
  amount_paid?: number | null;
  amount_remaining?: number | null;
  created?: number | null;
  due_date?: number | null;
  period_start?: number | null;
  period_end?: number | null;
  status_transitions?: {
    finalized_at?: number | null;
    paid_at?: number | null;
    voided_at?: number | null;
  } | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
};

type StripePaymentMethodLike = {
  id?: string;
  type?: string | null;
  card?: {
    brand?: string | null;
    display_brand?: string | null;
    last4?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
  } | null;
};

type ProviderSubscription = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_start?: number | null;
  current_period_end?: number | null;
  canceled_at?: number | null;
  pending_update?: unknown;
  items?: {
    data?: Array<{
      id?: string;
      price?: {
        id?: string;
      };
    }>;
  };
};

function providerSubscriptionData(subscription: ProviderSubscription) {
  return {
    subscriptionId: subscription.id,
    subscriptionItemId: subscription.items?.data?.[0]?.id ?? null,
    priceId: subscription.items?.data?.[0]?.price?.id ?? null,
    status: subscription.status,
    currentPeriodStart: epochSecondsToDate(subscription.current_period_start),
    currentPeriodEnd: epochSecondsToDate(subscription.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    canceledAt: epochSecondsToDate(subscription.canceled_at),
    pendingUpdate: Boolean(subscription.pending_update),
  };
}

function stripeInvoiceProjectionData(invoice: StripeInvoiceLike, superAgencyId: string) {
  return {
    superAgencyId,
    provider: BillingProvider.STRIPE,
    providerInvoiceId: stringOrNull(invoice.id) as string,
    providerSubscriptionId: stringOrNull(invoice.subscription),
    invoiceNumber: trimNullable(invoice.number ?? undefined),
    currency: normalizeCurrency(invoice.currency),
    status: normalizeInvoiceStatus(invoice.status),
    amountDueMinor: BigInt(nonNegativeInteger(invoice.amount_due)),
    amountPaidMinor: BigInt(nonNegativeInteger(invoice.amount_paid)),
    amountRemainingMinor: BigInt(nonNegativeInteger(invoice.amount_remaining)),
    providerCreatedAt: epochSecondsToDate(invoice.created) ?? new Date(),
    dueAt: epochSecondsToDate(invoice.due_date),
    periodStart: epochSecondsToDate(invoice.period_start),
    periodEnd: epochSecondsToDate(invoice.period_end),
    finalizedAt: epochSecondsToDate(invoice.status_transitions?.finalized_at),
    paidAt: epochSecondsToDate(invoice.status_transitions?.paid_at),
    voidedAt: epochSecondsToDate(invoice.status_transitions?.voided_at),
    hostedInvoiceUrl: safeProviderUrl(invoice.hosted_invoice_url),
    invoicePdfUrl: safeProviderUrl(invoice.invoice_pdf),
    lastSyncedAt: new Date(),
  };
}

function serializePaymentMethodSummary(method: StripePaymentMethodLike | null) {
  if (!method) return null;
  if (method.type === 'card' && method.card) {
    return {
      type: 'card',
      brand: method.card.brand ?? 'card',
      displayBrand: method.card.display_brand ?? method.card.brand ?? 'Card',
      last4: method.card.last4 ?? null,
      expMonth: method.card.exp_month ?? null,
      expYear: method.card.exp_year ?? null,
      isDefault: true,
    };
  }
  return {
    type: method.type ?? 'unknown',
    brand: null,
    displayBrand: method.type ?? 'Payment method',
    last4: null,
    expMonth: null,
    expYear: null,
    isDefault: true,
  };
}

function billingHistoryLabel(eventType: BillingHistoryEventType) {
  return eventType
    .toLowerCase()
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeCurrency(value: unknown) {
  return typeof value === 'string' && value.length === 3 ? value.toUpperCase() : 'USD';
}

function normalizeInvoiceStatus(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.toLowerCase() : 'unknown';
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeProviderUrl(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function mapStripeStatus(status: string) {
  if (status === 'active' || status === 'trialing') return SuperAgencySubscriptionStatus.ACTIVE;
  if (status === 'past_due' || status === 'unpaid') {
    return SuperAgencySubscriptionStatus.PAYMENT_GRACE;
  }
  if (status === 'canceled' || status === 'incomplete_expired') {
    return SuperAgencySubscriptionStatus.CANCELED;
  }
  return SuperAgencySubscriptionStatus.PAST_DUE;
}

function epochSecondsToDate(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
}

function stringOrNull(value: unknown) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function safeStripeEventMetadata(eventType: string, object: StripeObjectRecord) {
  return {
    type: eventType,
    objectId: stringOrNull(object.id),
    customer: stringOrNull(object.customer),
    subscription: stringOrNull(object.subscription),
  };
}

function safeErrorCode(error: unknown) {
  if (error instanceof BadRequestException) return 'BAD_REQUEST';
  if (error instanceof NotFoundException) return 'NOT_FOUND';
  if (error instanceof ForbiddenException) return 'FORBIDDEN';
  if (error instanceof ServiceUnavailableException) return 'SERVICE_UNAVAILABLE';
  return 'PROCESSING_FAILED';
}

function webAppUrl() {
  return (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}
