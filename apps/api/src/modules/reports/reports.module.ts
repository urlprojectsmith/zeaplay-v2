import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import {
  AgencyReportsController,
  PlatformReportsController,
  SuperAgencyReportsController,
  WorkspaceReportsController,
} from './reports.controller';
import { ReportsPlatformGuard } from './reports-platform.guard';
import { ReportsScheduleProcessor } from './reports-schedule.processor';
import { ReportsSchedulerService } from './reports-scheduler.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [AnalyticsModule, AuditModule, StorageModule],
  controllers: [
    WorkspaceReportsController,
    AgencyReportsController,
    SuperAgencyReportsController,
    PlatformReportsController,
  ],
  providers: [
    ReportsService,
    ReportsPlatformGuard,
    ReportsSchedulerService,
    ReportsScheduleProcessor,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
