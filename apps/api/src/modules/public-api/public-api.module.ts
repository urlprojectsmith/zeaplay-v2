import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { PublicProjectsController } from './public-projects.controller';
import { PublicTicketsController } from './public-tickets.controller';
import { PublicTasksController } from './public-tasks.controller';
import { PublicApiIdempotencyService } from './public-api-idempotency.service';
import { PublicApiMaintenanceService } from './public-api-maintenance.service';
import { PublicApiRateLimitService } from './public-api-rate-limit.service';
import { PublicApiAuthGuard } from './guards/public-api-auth.guard';
import { PublicApiRateLimitGuard } from './guards/public-api-rate-limit.guard';
import { PublicApiScopeGuard } from './guards/public-api-scope.guard';

@Module({
  imports: [TasksModule, ProjectsModule, TicketsModule],
  controllers: [
    ApiKeysController,
    PublicTasksController,
    PublicProjectsController,
    PublicTicketsController,
  ],
  providers: [
    ApiKeysService,
    PublicApiIdempotencyService,
    PublicApiMaintenanceService,
    PublicApiRateLimitService,
    PublicApiAuthGuard,
    PublicApiRateLimitGuard,
    PublicApiScopeGuard,
  ],
  exports: [ApiKeysService, PublicApiIdempotencyService],
})
export class PublicApiModule {}
