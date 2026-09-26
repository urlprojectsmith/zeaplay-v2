export type AnalyticsScope = 'WORKSPACE' | 'AGENCY' | 'SUPER_AGENCY' | 'PLATFORM';
export type AnalyticsDomain =
  | 'TASKS'
  | 'PROJECTS'
  | 'TICKETS'
  | 'GAMIFICATION'
  | 'AUTOMATION'
  | 'FORMS'
  | 'GOALS'
  | 'FILES'
  | 'API_USAGE'
  | 'MEMBERSHIPS'
  | 'BILLING';
export type MetricValueType =
  'COUNT' | 'NUMBER' | 'DECIMAL' | 'BYTES' | 'DURATION' | 'PERCENTAGE' | 'CURRENCY';
export type MetricAggregationType =
  'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'DISTINCT_COUNT' | 'RATIO' | 'CURRENT_VALUE';
export type AnalyticsDimension =
  | 'DATE'
  | 'HOUR'
  | 'DAY'
  | 'WEEK'
  | 'MONTH'
  | 'WORKSPACE'
  | 'AGENCY'
  | 'DEPARTMENT'
  | 'STATUS'
  | 'PRIORITY'
  | 'PLAN'
  | 'SUBSCRIPTION_STATUS';
export type AnalyticsFilter =
  | 'DATE_RANGE'
  | 'WORKSPACE'
  | 'AGENCY'
  | 'DEPARTMENT'
  | 'STATUS'
  | 'PRIORITY'
  | 'PLAN'
  | 'SUBSCRIPTION_STATUS';
export type FreshnessMode = 'NEAR_REAL_TIME' | 'ROLLUP' | 'HYBRID';
export type SourceStrategy = 'DIRECT' | 'ROLLUP' | 'HYBRID';

export interface MetricDefinition {
  key: string;
  displayName: string;
  domain: AnalyticsDomain;
  valueType: MetricValueType;
  aggregationType: MetricAggregationType;
  supportedScopes: AnalyticsScope[];
  supportedDimensions: AnalyticsDimension[];
  supportedFilters: AnalyticsFilter[];
  supportsTimeSeries: boolean;
  supportsComparison: boolean;
  freshnessMode: FreshnessMode;
  privacyLevel: 'SAFE_AGGREGATE' | 'OPERATIONAL_AGGREGATE' | 'COMMERCIAL_AGGREGATE';
  financialSensitivity: boolean;
  sourceStrategy: SourceStrategy;
  rollupStrategy: 'NONE' | 'DAILY_REBUILDABLE';
  unit: string;
  description: string;
}

const operationalScopes: AnalyticsScope[] = ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY', 'PLATFORM'];
const billingScopes: AnalyticsScope[] = ['SUPER_AGENCY', 'PLATFORM'];
const standardDimensions: AnalyticsDimension[] = ['WORKSPACE', 'AGENCY'];
const standardFilters: AnalyticsFilter[] = ['DATE_RANGE', 'WORKSPACE', 'AGENCY'];

export const ANALYTICS_DIMENSIONS: AnalyticsDimension[] = [
  'DATE',
  'HOUR',
  'DAY',
  'WEEK',
  'MONTH',
  'WORKSPACE',
  'AGENCY',
  'DEPARTMENT',
  'STATUS',
  'PRIORITY',
  'PLAN',
  'SUBSCRIPTION_STATUS',
];

export const ANALYTICS_FILTERS: AnalyticsFilter[] = [
  'DATE_RANGE',
  'WORKSPACE',
  'AGENCY',
  'DEPARTMENT',
  'STATUS',
  'PRIORITY',
  'PLAN',
  'SUBSCRIPTION_STATUS',
];

export const METRIC_REGISTRY: MetricDefinition[] = [
  metric('tasks.total', 'Tasks', 'TASKS', 'COUNT'),
  metric('tasks.completed', 'Completed Tasks', 'TASKS', 'COUNT'),
  metric('tasks.open', 'Open Tasks', 'TASKS', 'COUNT'),
  metric('tasks.overdue', 'Overdue Tasks', 'TASKS', 'COUNT'),
  metric('projects.total', 'Projects', 'PROJECTS', 'COUNT'),
  metric('projects.completed', 'Completed Projects', 'PROJECTS', 'COUNT'),
  metric('projects.active', 'Active Projects', 'PROJECTS', 'COUNT'),
  metric('tickets.total', 'Tickets', 'TICKETS', 'COUNT'),
  metric('tickets.resolved', 'Resolved Tickets', 'TICKETS', 'COUNT'),
  metric('tickets.open', 'Open Tickets', 'TICKETS', 'COUNT'),
  metric('gamification.xp_earned', 'XP Earned', 'GAMIFICATION', 'NUMBER'),
  metric('gamification.global_score', 'Global Score', 'GAMIFICATION', 'DECIMAL'),
  metric('gamification.badges_awarded', 'Badges Awarded', 'GAMIFICATION', 'COUNT'),
  metric('gamification.achievements_awarded', 'Achievements Awarded', 'GAMIFICATION', 'COUNT'),
  metric('automation.executions', 'Automation Executions', 'AUTOMATION', 'COUNT'),
  metric('automation.successful', 'Successful Automation Executions', 'AUTOMATION', 'COUNT'),
  metric('automation.failed', 'Failed Automation Executions', 'AUTOMATION', 'COUNT'),
  metric('automation.active_workflows', 'Active Workflows', 'AUTOMATION', 'COUNT', {
    sourceStrategy: 'DIRECT',
    supportsTimeSeries: false,
  }),
  metric('forms.submissions', 'Form Submissions', 'FORMS', 'COUNT'),
  metric('goals.active', 'Active Goals', 'GOALS', 'COUNT', {
    sourceStrategy: 'DIRECT',
    supportsTimeSeries: false,
  }),
  metric('goals.completed', 'Completed Goals', 'GOALS', 'COUNT'),
  metric('goals.expired', 'Expired Goals', 'GOALS', 'COUNT'),
  metric('goals.completion_rate', 'Goal Completion Rate', 'GOALS', 'PERCENTAGE', {
    aggregationType: 'RATIO',
  }),
  metric('files.storage_bytes', 'Storage Used', 'FILES', 'BYTES', {
    aggregationType: 'SUM',
    sourceStrategy: 'DIRECT',
    supportsTimeSeries: false,
  }),
  metric('files.assets', 'Assets', 'FILES', 'COUNT'),
  metric('api.requests', 'API Requests', 'API_USAGE', 'COUNT', {
    sourceStrategy: 'ROLLUP',
    freshnessMode: 'ROLLUP',
    rollupStrategy: 'DAILY_REBUILDABLE',
  }),
  metric('memberships.active', 'Active Memberships', 'MEMBERSHIPS', 'COUNT', {
    sourceStrategy: 'DIRECT',
    supportsTimeSeries: false,
  }),
  metric('billing.active_subscriptions', 'Active Subscriptions', 'BILLING', 'COUNT', {
    scopes: billingScopes,
    dimensions: [],
    filters: [],
    privacyLevel: 'COMMERCIAL_AGGREGATE',
    financialSensitivity: true,
    sourceStrategy: 'DIRECT',
    supportsTimeSeries: false,
  }),
];

export const METRIC_REGISTRY_BY_KEY = new Map(METRIC_REGISTRY.map((item) => [item.key, item]));

export const DEFAULT_ANALYTICS_METRICS = [
  'tasks.total',
  'tasks.completed',
  'tickets.open',
  'projects.active',
  'gamification.xp_earned',
  'automation.executions',
  'forms.submissions',
  'goals.active',
  'files.storage_bytes',
  'api.requests',
  'memberships.active',
];

function metric(
  key: string,
  displayName: string,
  domain: AnalyticsDomain,
  valueType: MetricValueType,
  options: Partial<MetricDefinition> & {
    scopes?: AnalyticsScope[];
    dimensions?: AnalyticsDimension[];
    filters?: AnalyticsFilter[];
  } = {},
): MetricDefinition {
  return {
    key,
    displayName,
    domain,
    valueType,
    aggregationType: options.aggregationType ?? (valueType === 'COUNT' ? 'COUNT' : 'SUM'),
    supportedScopes: options.scopes ?? (domain === 'BILLING' ? billingScopes : operationalScopes),
    supportedDimensions: options.dimensions ?? (domain === 'BILLING' ? [] : standardDimensions),
    supportedFilters: options.filters ?? (domain === 'BILLING' ? [] : standardFilters),
    supportsTimeSeries: options.supportsTimeSeries ?? true,
    supportsComparison: options.supportsComparison ?? true,
    freshnessMode:
      options.freshnessMode ?? (options.sourceStrategy === 'ROLLUP' ? 'ROLLUP' : 'NEAR_REAL_TIME'),
    privacyLevel: options.privacyLevel ?? 'SAFE_AGGREGATE',
    financialSensitivity: options.financialSensitivity ?? false,
    sourceStrategy: options.sourceStrategy ?? 'HYBRID',
    rollupStrategy: options.rollupStrategy ?? 'DAILY_REBUILDABLE',
    unit: options.unit ?? valueType.toLowerCase(),
    description:
      options.description ??
      `${displayName} is derived from canonical ${domain.toLowerCase()} data without changing source records.`,
  };
}
