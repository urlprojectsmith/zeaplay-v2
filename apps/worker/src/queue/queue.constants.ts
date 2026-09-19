export const ASSET_PROCESSING_QUEUE = 'asset-processing';
export const ASSET_PROCESSING_JOB_TYPE = 'asset.metadata';
export const TASK_RECURRENCE_QUEUE = 'task-recurrence';
export const TASK_RECURRENCE_DISPATCH_JOB_TYPE = 'task.recurrence.dispatch';

export const FOUNDATION_QUEUES = [
  'email',
  'notifications',
  'automation',
  'webhooks',
  'integrations',
  'gamification',
  'reports',
  'archives',
  'files',
  ASSET_PROCESSING_QUEUE,
  TASK_RECURRENCE_QUEUE,
] as const;

export type FoundationQueueName = (typeof FOUNDATION_QUEUES)[number];

export interface QueueJobEnvelope<TPayload = Record<string, unknown>> {
  correlationId: string;
  requestId?: string;
  actorId?: string | null;
  agencyId?: string | null;
  workspaceId?: string | null;
  payload: TPayload;
}
