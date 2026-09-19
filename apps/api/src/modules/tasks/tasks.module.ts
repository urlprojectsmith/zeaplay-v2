import { Module } from '@nestjs/common';
import { MeTimeTrackingController } from './me-time-tracking.controller';
import { TasksController } from './tasks.controller';
import { TaskRecurrenceSchedulerService } from './task-recurrence-scheduler.service';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController, MeTimeTrackingController],
  providers: [TasksService, TaskRecurrenceSchedulerService],
})
export class TasksModule {}
