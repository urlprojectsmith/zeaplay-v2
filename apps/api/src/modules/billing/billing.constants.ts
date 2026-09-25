export const BILLING_DEFAULT_TRIAL_DAYS = 14;
export const BILLING_GRACE_PERIOD_DAYS = 7;
export const DEFAULT_AGENCY_WORKSPACE_ALLOCATION = 15;

export const BILLING_RESTRICTED_MODE_POLICY = {
  loginAllowed: true,
  readExistingDataAllowed: true,
  billingRecoveryAllowed: true,
  newWritesRestricted: true,
  dataPreserved: true,
} as const;

export const PLAN_FEATURE_KEYS = [
  'tasks',
  'tasks.enabled',
  'projects',
  'projects.enabled',
  'tickets',
  'tickets.enabled',
  'gamification',
  'gamification.enabled',
  'automation',
  'automation.enabled',
  'notifications',
  'notifications.enabled',
  'calendar',
  'calendar.enabled',
  'assets',
  'files.enabled',
  'public_api',
  'api.enabled',
  'webhooks',
  'webhooks.enabled',
  'integrations',
  'integrations.ghl.enabled',
  'integrations.slack.enabled',
  'integrations.webex.enabled',
] as const;

export const PLAN_LIMIT_KEYS = [
  'max_agencies',
  'max_workspaces',
  'max_users',
  'max_memberships',
  'storage_bytes',
  'max_active_automations',
  'automation_executions_per_month',
  'automation_executions_per_billing_period',
  'api_requests_per_month',
  'api_requests_per_billing_period',
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];
export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number];

export const BILLING_RESOURCE_KEYS = {
  agencies: 'AGENCIES',
  workspaces: 'WORKSPACES',
  workspaceMemberships: 'WORKSPACE_MEMBERSHIPS',
  storageBytes: 'STORAGE_BYTES',
  activeAutomations: 'ACTIVE_AUTOMATIONS',
  automationExecutions: 'AUTOMATION_EXECUTIONS',
  apiRequests: 'API_REQUESTS',
  webhooks: 'WEBHOOKS',
  ghl: 'GHL',
  slack: 'SLACK',
  webex: 'WEBEX',
} as const;

export type BillingResourceKey = (typeof BILLING_RESOURCE_KEYS)[keyof typeof BILLING_RESOURCE_KEYS];

export type BillingResourceDimension = 'LIVE_CAPACITY' | 'PERIOD_METERED' | 'FEATURE_ONLY';

export const BILLING_RESOURCE_CATALOG = {
  [BILLING_RESOURCE_KEYS.agencies]: {
    dimension: 'LIVE_CAPACITY',
    limitKeys: ['max_agencies'],
  },
  [BILLING_RESOURCE_KEYS.workspaces]: {
    dimension: 'LIVE_CAPACITY',
    limitKeys: ['max_workspaces'],
  },
  [BILLING_RESOURCE_KEYS.workspaceMemberships]: {
    dimension: 'LIVE_CAPACITY',
    limitKeys: ['max_memberships', 'max_users'],
  },
  [BILLING_RESOURCE_KEYS.storageBytes]: {
    dimension: 'LIVE_CAPACITY',
    limitKeys: ['storage_bytes'],
  },
  [BILLING_RESOURCE_KEYS.activeAutomations]: {
    dimension: 'LIVE_CAPACITY',
    limitKeys: ['max_active_automations'],
  },
  [BILLING_RESOURCE_KEYS.automationExecutions]: {
    dimension: 'PERIOD_METERED',
    limitKeys: ['automation_executions_per_month', 'automation_executions_per_billing_period'],
  },
  [BILLING_RESOURCE_KEYS.apiRequests]: {
    dimension: 'PERIOD_METERED',
    limitKeys: ['api_requests_per_month', 'api_requests_per_billing_period'],
  },
  [BILLING_RESOURCE_KEYS.webhooks]: {
    dimension: 'FEATURE_ONLY',
    featureKeys: ['webhooks.enabled', 'webhooks'],
  },
  [BILLING_RESOURCE_KEYS.ghl]: {
    dimension: 'FEATURE_ONLY',
    featureKeys: ['integrations.ghl.enabled'],
  },
  [BILLING_RESOURCE_KEYS.slack]: {
    dimension: 'FEATURE_ONLY',
    featureKeys: ['integrations.slack.enabled'],
  },
  [BILLING_RESOURCE_KEYS.webex]: {
    dimension: 'FEATURE_ONLY',
    featureKeys: ['integrations.webex.enabled'],
  },
} as const satisfies Record<
  BillingResourceKey,
  {
    dimension: BillingResourceDimension;
    limitKeys?: readonly PlanLimitKey[];
    featureKeys?: readonly PlanFeatureKey[];
  }
>;
