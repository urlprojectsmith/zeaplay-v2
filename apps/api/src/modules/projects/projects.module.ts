import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LegacyProjectsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [GamificationModule, AutomationModule, NotificationsModule],
  controllers: [ProjectsController, LegacyProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
