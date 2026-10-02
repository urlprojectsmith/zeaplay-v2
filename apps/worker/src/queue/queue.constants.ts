export const ASSET_PROCESSING_QUEUE = 'asset-processing';
export const ASSET_PROCESSING_JOB_TYPE = 'asset.metadata';
export const TASK_RECURRENCE_QUEUE = 'task-recurrence';
export const TASK_RECURRENCE_DISPATCH_JOB_TYPE = 'task.recurrence.dispatch';
export const TICKET_SLA_QUEUE = 'ticket-sla';
export const TICKET_SLA_SCAN_JOB_TYPE = 'ticket.sla.scan';
export const AUTOMATION_EXECUTION_QUEUE = 'automation-execution';
export const AUTOMATION_EXECUTION_JOB_TYPE = 'automation.execution';
export const STORAGE_RETENTION_QUEUE = 'storage-retention';
export const STORAGE_RETENTION_SCAN_JOB_TYPE = 'storage-retention.scan';
export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE = 'webhook.delivery.dispatch';
export const WEBHOOK_DELIVERY_RECOVERY_JOB_TYPE = 'webhook.delivery.recovery';
export const INBOUND_WEBHOOK_MAINTENANCE_QUEUE = 'inbound-webhook-maintenance';
export const INBOUND_WEBHOOK_CLEANUP_JOB_TYPE = 'inbound-webhook.cleanup';
export const BILLING_LIFECYCLE_QUEUE = 'billing-lifecycle';
export const BILLING_LIFECYCLE_SCAN_JOB_TYPE = 'billing.lifecycle.scan';
export const ANALYTICS_ROLLUP_QUEUE = 'analytics-rollup';
export const ANALYTICS_ROLLUP_SCAN_JOB_TYPE = 'analytics.rollup.scan';
export const REPORTS_QUEUE = 'reports';
export const REPORT_EXPORT_JOB_TYPE = 'report.export.generate';
export const REPORT_SCHEDULE_SCAN_JOB_TYPE = 'report.schedule.scan';
export const SEARCH_INDEX_QUEUE = 'search-index';
export const SEARCH_INDEX_JOB_TYPE = 'search.index';
export const CUSTOM_DOMAIN_PROVISIONING_QUEUE = 'custom-domain-provisioning';
export const CUSTOM_DOMAIN_PROVISION_JOB_TYPE = 'custom-domain.provision';
export const CUSTOM_DOMAIN_RECONCILE_JOB_TYPE = 'custom-domain.reconcile';

export const FOUNDATION_QUEUES = [
  'email',
  'notifications',
  'automation',
  'webhooks',
  'integrations',
  'gamification',
  'archives',
  'files',
  ASSET_PROCESSING_QUEUE,
  TASK_RECURRENCE_QUEUE,
  TICKET_SLA_QUEUE,
  AUTOMATION_EXECUTION_QUEUE,
  STORAGE_RETENTION_QUEUE,
  WEBHOOK_DELIVERY_QUEUE,
  INBOUND_WEBHOOK_MAINTENANCE_QUEUE,
  BILLING_LIFECYCLE_QUEUE,
  ANALYTICS_ROLLUP_QUEUE,
  REPORTS_QUEUE,
  SEARCH_INDEX_QUEUE,
  CUSTOM_DOMAIN_PROVISIONING_QUEUE,
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
