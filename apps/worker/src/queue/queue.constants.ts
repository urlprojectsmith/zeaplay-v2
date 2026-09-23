export const ASSET_PROCESSING_QUEUE = 'asset-processing';
export const ASSET_PROCESSING_JOB_TYPE = 'asset.metadata';
export const TASK_RECURRENCE_QUEUE = 'task-recurrence';
export const TASK_RECURRENCE_DISPATCH_JOB_TYPE = 'task.recurrence.dispatch';
export const TICKET_SLA_QUEUE = 'ticket-sla';
export const TICKET_SLA_SCAN_JOB_TYPE = 'ticket.sla.scan';
export const AUTOMATION_EXECUTION_QUEUE = 'automation-execution';
export const AUTOMATION_EXECUTION_JOB_TYPE = 'automation.execution';

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
  TICKET_SLA_QUEUE,
  AUTOMATION_EXECUTION_QUEUE,
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
