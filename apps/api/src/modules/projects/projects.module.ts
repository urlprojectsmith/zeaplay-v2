import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { BillingModule } from '../billing/billing.module';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LegacyProjectsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [GamificationModule, AutomationModule, NotificationsModule, BillingModule],
  controllers: [ProjectsController, LegacyProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
