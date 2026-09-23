import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { GamificationModule } from '../gamification/gamification.module';
import { LegacyProjectsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [GamificationModule, AutomationModule],
  controllers: [ProjectsController, LegacyProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
