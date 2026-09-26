import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import {
  AgencyAnalyticsController,
  AnalyticsRegistryController,
  PlatformAnalyticsController,
  SuperAgencyAnalyticsController,
  WorkspaceAnalyticsController,
} from './analytics.controller';
import { AnalyticsPlatformGuard } from './analytics-platform.guard';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [RedisModule],
  controllers: [
    AnalyticsRegistryController,
    WorkspaceAnalyticsController,
    AgencyAnalyticsController,
    SuperAgencyAnalyticsController,
    PlatformAnalyticsController,
  ],
  providers: [AnalyticsService, AnalyticsPlatformGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
