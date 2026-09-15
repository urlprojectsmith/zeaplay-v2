import { Injectable } from '@nestjs/common';
import { FOUNDATION_QUEUES } from './queue.constants';

@Injectable()
export class QueueHealthService {
  listRegisteredQueues() {
    return FOUNDATION_QUEUES.map((name) => ({ name, status: 'registered' }));
  }
}
