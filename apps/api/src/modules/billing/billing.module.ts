import { Module } from '@nestjs/common';
import { DeveloperDiagnosticsGuard } from '../../common/authorization/developer-diagnostics.guard';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import {
  AgencyBillingController,
  PlatformBillingPlansController,
  PlatformBillingSupportController,
  PlatformBillingSubscriptionsController,
  SuperAgencyBillingController,
  StripeBillingWebhookController,
  WorkspaceBillingController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { BillingEntitlementService } from './billing-entitlement.service';
import { BillingInvoiceRefreshRateLimitService } from './billing-invoice-refresh-rate-limit.service';
import { StripeBillingGateway } from './billing.stripe-gateway';

@Module({
  imports: [RedisModule],
  controllers: [
    PlatformBillingPlansController,
    PlatformBillingSupportController,
    PlatformBillingSubscriptionsController,
    SuperAgencyBillingController,
    AgencyBillingController,
    WorkspaceBillingController,
    StripeBillingWebhookController,
  ],
  providers: [
    BillingService,
    BillingEntitlementService,
    BillingInvoiceRefreshRateLimitService,
    StripeBillingGateway,
    DeveloperDiagnosticsGuard,
  ],
  exports: [BillingService, BillingEntitlementService],
})
export class BillingModule {}
