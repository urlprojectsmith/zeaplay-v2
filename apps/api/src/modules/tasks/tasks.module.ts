import { Module } from '@nestjs/common';
import { GamificationModule } from '../gamification/gamification.module';
import { MeTimeTrackingController } from './me-time-tracking.controller';
import { TasksController } from './tasks.controller';
import { TaskRecurrenceSchedulerService } from './task-recurrence-scheduler.service';
import { TasksService } from './tasks.service';

@Module({
  imports: [GamificationModule],
  controllers: [TasksController, MeTimeTrackingController],
  providers: [TasksService, TaskRecurrenceSchedulerService],
})
export class TasksModule {}
