import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { LegacyProjectsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [GamificationModule],
  controllers: [ProjectsController, LegacyProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
