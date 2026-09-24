import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from '@zea-play/config';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AgenciesModule } from './modules/agencies/agencies.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { StatusesModule } from './modules/statuses/statuses.module';
import { FeaturesModule } from './modules/features/features.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { MonitoringModule } from './infrastructure/monitoring/monitoring.module';
import { SecurityModule } from './common/security.module';
import { AuditModule } from './modules/audit/audit.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AssetsModule } from './modules/assets/assets.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TagsModule } from './modules/tags/tags.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { AutomationModule } from './modules/automation/automation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { CloudDrivesModule } from './modules/cloud-drives/cloud-drives.module';
import { PublicApiModule } from './modules/public-api/public-api.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
    RedisModule,
    QueueModule,
    StorageModule,
    MonitoringModule,
    SecurityModule,
    AuditModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    AssetsModule,
    TasksModule,
    TicketsModule,
    GamificationModule,
    AutomationModule,
    NotificationsModule,
    RealtimeModule,
    CalendarModule,
    CloudDrivesModule,
    PublicApiModule,
    TagsModule,
    AgenciesModule,
    WorkspacesModule,
    UsersModule,
    DepartmentsModule,
    RolesModule,
    PermissionsModule,
    StatusesModule,
    FeaturesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('{*path}');
  }
}
