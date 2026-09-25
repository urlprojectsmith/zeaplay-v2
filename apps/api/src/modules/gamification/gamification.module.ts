import { Module } from '@nestjs/common';
import { DeveloperDiagnosticsGuard } from '../../common/authorization/developer-diagnostics.guard';
import { PlatformGlobalLeaderboardGuard } from '../../common/authorization/platform-global-leaderboard.guard';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AgencyGlobalLeaderboardController,
  DeveloperGamificationController,
  GamificationController,
  PlatformGlobalLeaderboardController,
  SuperAgencyGlobalLeaderboardController,
} from './gamification.controller';
import { GamificationService } from './gamification.service';

@Module({
  imports: [AuditModule, AuthModule, BillingModule, NotificationsModule],
  controllers: [
    GamificationController,
    AgencyGlobalLeaderboardController,
    SuperAgencyGlobalLeaderboardController,
    PlatformGlobalLeaderboardController,
    DeveloperGamificationController,
  ],
  providers: [GamificationService, DeveloperDiagnosticsGuard, PlatformGlobalLeaderboardGuard],
  exports: [GamificationService],
})
export class GamificationModule {}
