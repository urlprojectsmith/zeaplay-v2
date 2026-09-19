import { Module } from '@nestjs/common';
import { LegacyProjectsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, LegacyProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
