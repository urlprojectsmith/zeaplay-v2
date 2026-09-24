import { Module } from '@nestjs/common';
import { DeveloperDiagnosticsGuard } from '../../common/authorization/developer-diagnostics.guard';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AgencyGlobalLeaderboardController,
  DeveloperGamificationController,
  GamificationController,
  PlatformGlobalLeaderboardController,
} from './gamification.controller';
import { GamificationService } from './gamification.service';

@Module({
  imports: [AuditModule, AuthModule, NotificationsModule],
  controllers: [
    GamificationController,
    AgencyGlobalLeaderboardController,
    PlatformGlobalLeaderboardController,
    DeveloperGamificationController,
  ],
  providers: [GamificationService, DeveloperDiagnosticsGuard],
  exports: [GamificationService],
})
export class GamificationModule {}
