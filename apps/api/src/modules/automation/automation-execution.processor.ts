import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  AUTOMATION_EXECUTION_JOB_TYPE,
  AUTOMATION_EXECUTION_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { AutomationExecutionService } from './automation-execution.service';

@Injectable()
@Processor(AUTOMATION_EXECUTION_QUEUE)
export class AutomationExecutionProcessor extends WorkerHost {
  constructor(private readonly executions: AutomationExecutionService) {
    super();
  }

  async process(job: Job<{ executionId: string }>) {
    if (job.name !== AUTOMATION_EXECUTION_JOB_TYPE) return;
    if (
      !job.data ||
      Object.keys(job.data).length !== 1 ||
      typeof job.data.executionId !== 'string'
    ) {
      throw new Error('AUTOMATION_EXECUTION_JOB_PAYLOAD_INVALID');
    }
    await this.executions.processExecution(job.data.executionId);
  }
}
