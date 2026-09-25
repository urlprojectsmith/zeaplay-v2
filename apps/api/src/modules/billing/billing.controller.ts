import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { DeveloperDiagnosticsGuard } from '../../common/authorization/developer-diagnostics.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentAgencyTenant,
  CurrentSuperAgencyTenant,
  CurrentWorkspaceTenant,
  SUPER_AGENCY_HEADER,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import {
  AgencyTenantGuard,
  SuperAgencyTenantGuard,
  WorkspaceTenantGuard,
} from '../../common/tenant/tenant-context.guard';
import { BillingEntitlementService } from './billing-entitlement.service';
import { BillingService } from './billing.service';
import {
  ActivateTrialDto,
  AllocationUpdateDto,
  BillingAgencyParamsDto,
  BillingInvoiceListQueryDto,
  BillingPlanListQueryDto,
  BillingPlanParamsDto,
  BillingPlanVersionParamsDto,
  BillingSuperAgencyParamsDto,
  BillingWorkspaceParamsDto,
  CancelSubscriptionDto,
  ChangeSubscriptionDto,
  CreateBillingPriceDto,
  CreateCheckoutSessionDto,
  CreateMasterPlanDto,
  CreateNextPlanVersionDto,
  ManualProvisionSubscriptionDto,
  UpdateDraftPlanVersionDto,
} from './dto/billing.dto';

@ApiTags('platform billing plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, DeveloperDiagnosticsGuard)
@Controller('platform/billing/plans')
export class PlatformBillingPlansController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  list(@Query() query: BillingPlanListQueryDto) {
    return this.billing.listPlans(query);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMasterPlanDto) {
    return this.billing.createPlan(user, dto);
  }

  @Get(':planId')
  get(@Param() params: BillingPlanParamsDto) {
    return this.billing.getPlan(params.planId);
  }

  @Patch(':planId/versions/:versionId')
  updateDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BillingPlanVersionParamsDto,
    @Body() dto: UpdateDraftPlanVersionDto,
  ) {
    return this.billing.updateDraftVersion(user, params.planId, params.versionId, dto);
  }

  @Post(':planId/versions/:versionId/publish')
  publish(@CurrentUser() user: AuthenticatedUser, @Param() params: BillingPlanVersionParamsDto) {
    return this.billing.publishVersion(user, params.planId, params.versionId);
  }

  @Post(':planId/versions/:versionId/prices')
  createPrice(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BillingPlanVersionParamsDto,
    @Body() dto: CreateBillingPriceDto,
  ) {
    return this.billing.createPrice(user, params.planId, params.versionId, dto);
  }

  @Post(':planId/versions/:versionId/archive')
  archiveVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BillingPlanVersionParamsDto,
  ) {
    return this.billing.archiveVersion(user, params.planId, params.versionId);
  }

  @Post(':planId/versions/next')
  createNextVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BillingPlanParamsDto,
    @Body() dto: CreateNextPlanVersionDto,
  ) {
    return this.billing.createNextDraftVersion(user, params.planId, dto);
  }

  @Patch(':planId/archive')
  archivePlan(@CurrentUser() user: AuthenticatedUser, @Param() params: BillingPlanParamsDto) {
    return this.billing.archivePlan(user, params.planId);
  }
}

@ApiTags('platform billing subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, DeveloperDiagnosticsGuard)
@Controller('platform/billing/subscriptions')
export class PlatformBillingSubscriptionsController {
  constructor(private readonly billing: BillingService) {}

  @Post('manual-provision')
  manualProvision(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualProvisionSubscriptionDto,
  ) {
    return this.billing.manualProvision(user, dto);
  }

  @Post('activate-trial')
  activateTrial(@CurrentUser() user: AuthenticatedUser, @Body() dto: ActivateTrialDto) {
    return this.billing.activateTrial(user, dto);
  }

  @Post(':superAgencyId/cancel-immediate')
  cancelImmediately(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: BillingSuperAgencyParamsDto,
  ) {
    return this.billing.cancelSubscription(
      user,
      {
        userId: user.id,
        superAgencyId: params.superAgencyId,
        superAgencyMembershipId: 'platform',
        roleId: 'platform',
        roleName: 'PLATFORM',
        permissions: [PermissionKeys.billingSubscriptionCancel],
        status: 'ACTIVE',
      },
      { immediate: true },
      true,
    );
  }
}

@ApiTags('platform billing support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, DeveloperDiagnosticsGuard)
@Controller('platform/billing/support')
export class PlatformBillingSupportController {
  constructor(private readonly billing: BillingService) {}

  @Get('super-agencies/:superAgencyId/invoices')
  listInvoices(
    @Param() params: BillingSuperAgencyParamsDto,
    @Query() query: BillingInvoiceListQueryDto,
  ) {
    return this.billing.listSupportInvoices(params.superAgencyId, query);
  }
}

@ApiTags('super agency billing')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/billing')
export class SuperAgencyBillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly entitlements: BillingEntitlementService,
  ) {}

  @Get('subscription')
  @RequirePermissions(PermissionKeys.billingSubscriptionView)
  getSubscription(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.billing.getSubscriptionState(tenant);
  }

  @Get('entitlements')
  @RequirePermissions(PermissionKeys.billingSubscriptionView)
  getEntitlements(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.billing.getEffectiveEntitlements(tenant.superAgencyId);
  }

  @Get('usage')
  @RequirePermissions(PermissionKeys.billingAllocationRead)
  usage(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.entitlements.superAgencyUsage(tenant.superAgencyId);
  }

  @Get('invoices')
  @RequirePermissions(PermissionKeys.billingInvoiceView)
  invoices(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: BillingInvoiceListQueryDto,
  ) {
    return this.billing.listInvoices(tenant, query);
  }

  @Post('invoices/refresh')
  @RequirePermissions(PermissionKeys.billingInvoiceRefresh)
  refreshInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
  ) {
    return this.billing.refreshInvoices(user, tenant);
  }

  @Get('payment-method')
  @RequirePermissions(PermissionKeys.billingPaymentMethodView)
  paymentMethod(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.billing.getPaymentMethodSummary(tenant);
  }

  @Get('history')
  @RequirePermissions(PermissionKeys.billingHistoryView)
  history(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: BillingInvoiceListQueryDto,
  ) {
    return this.billing.listBillingHistory(tenant, query);
  }

  @Patch('allocations/agencies/:agencyId')
  @RequirePermissions(PermissionKeys.billingAllocationManage)
  updateAgencyAllocation(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param() params: BillingAgencyParamsDto,
    @Body() dto: AllocationUpdateDto,
  ) {
    return this.entitlements.updateAgencyAllocation({
      superAgencyId: tenant.superAgencyId,
      agencyId: params.agencyId,
      resourceKey: dto.resourceKey,
      allocated: dto.allocated,
      unlimited: dto.unlimited,
      actorUserId: user.id,
    });
  }

  @Get('checkout-plans')
  @RequirePermissions(PermissionKeys.billingSubscriptionView)
  listCheckoutPlans() {
    return this.billing.listPublicCheckoutPlans();
  }

  @Post('checkout')
  @RequirePermissions(PermissionKeys.billingCheckoutCreate)
  createCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.billing.createCheckoutSession(user, tenant, dto);
  }

  @Post('portal')
  @RequirePermissions(PermissionKeys.billingPortalCreate)
  createPortal(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
  ) {
    return this.billing.createPortalSession(user, tenant);
  }

  @Post('subscription/change')
  @RequirePermissions(PermissionKeys.billingSubscriptionChange)
  changeSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: ChangeSubscriptionDto,
  ) {
    return this.billing.changeSubscription(user, tenant, dto);
  }

  @Post('subscription/cancel')
  @RequirePermissions(PermissionKeys.billingSubscriptionCancel)
  cancelSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.billing.cancelSubscription(user, tenant, dto);
  }
}

@ApiTags('agency billing usage')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/billing')
export class AgencyBillingController {
  constructor(private readonly entitlements: BillingEntitlementService) {}

  @Get('usage')
  @RequirePermissions(PermissionKeys.billingAllocationRead)
  usage(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.entitlements.agencyUsage(tenant.agencyId);
  }

  @Get('entitlements')
  @RequirePermissions(PermissionKeys.billingAllocationRead)
  async entitlementsForAgency(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    const entitlements = await this.entitlements.getEffectiveEntitlements(
      tenant.superAgencyId as string,
    );
    return { ...entitlements, subscription: null };
  }

  @Patch('allocations/workspaces/:workspaceId')
  @RequirePermissions(PermissionKeys.billingAllocationManage)
  updateWorkspaceAllocation(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param() params: BillingWorkspaceParamsDto,
    @Body() dto: AllocationUpdateDto,
  ) {
    return this.entitlements.updateWorkspaceAllocation({
      agencyId: tenant.agencyId,
      workspaceId: params.workspaceId,
      resourceKey: dto.resourceKey,
      allocated: dto.allocated,
      unlimited: dto.unlimited,
      actorUserId: tenant.userId,
    });
  }
}

@ApiTags('workspace billing usage')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/billing')
export class WorkspaceBillingController {
  constructor(private readonly entitlements: BillingEntitlementService) {}

  @Get('usage')
  @RequirePermissions(PermissionKeys.billingAllocationRead)
  usage(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.entitlements.workspaceUsage(tenant.workspaceId);
  }

  @Get('entitlements')
  @RequirePermissions(PermissionKeys.billingAllocationRead)
  async entitlementsForWorkspace(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    const entitlements = await this.entitlements.getEffectiveEntitlements(
      tenant.superAgencyId as string,
    );
    return { ...entitlements, subscription: null };
  }
}

@ApiTags('stripe billing webhooks')
@Controller('billing/stripe')
export class StripeBillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('webhook')
  receive(@Req() request: Request, @Headers('stripe-signature') signature?: string) {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    return this.billing.handleStripeWebhook(rawBody, signature);
  }
}
