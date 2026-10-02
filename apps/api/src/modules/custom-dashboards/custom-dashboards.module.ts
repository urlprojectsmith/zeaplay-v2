import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { ReportsModule } from '../reports/reports.module';
import {
  AgencyCustomDashboardsController,
  PlatformCustomDashboardsController,
  SuperAgencyCustomDashboardsController,
  WorkspaceCustomDashboardsController,
} from './custom-dashboards.controller';
import { CustomDashboardsPlatformGuard } from './custom-dashboards-platform.guard';
import { CustomDashboardsService } from './custom-dashboards.service';

@Module({
  imports: [AnalyticsModule, ReportsModule, AuditModule],
  controllers: [
    WorkspaceCustomDashboardsController,
    AgencyCustomDashboardsController,
    SuperAgencyCustomDashboardsController,
    PlatformCustomDashboardsController,
  ],
  providers: [CustomDashboardsService, CustomDashboardsPlatformGuard],
  exports: [CustomDashboardsService],
})
export class CustomDashboardsModule {}
