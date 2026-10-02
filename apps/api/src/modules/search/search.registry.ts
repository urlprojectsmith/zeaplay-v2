import { PermissionKeys } from '../../common/authorization/permissions';
import type { SearchResultTypeKey, SearchScopeTypeKey } from './dto/search.dto';

export type SearchTypeMetadata = {
  key: SearchResultTypeKey;
  label: string;
  scopes: SearchScopeTypeKey[];
  routeBase: string;
  privacy: string;
  minimumQueryLength: number;
  fuzzy: boolean;
  permission: string;
};

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_FUZZY_MIN_QUERY_LENGTH = 3;
export const SEARCH_MAX_QUERY_LENGTH = 160;
export const SEARCH_MAX_TYPES = 8;
export const SEARCH_MAX_PAGE_SIZE = 25;
export const SEARCH_RECENT_LIMIT = 10;
export const SEARCH_CACHE_SECONDS = 30;
export const PLATFORM_SCOPE_ID = '00000000-0000-4000-8000-000000000000';

export const searchTypeRegistry: SearchTypeMetadata[] = [
  type(
    'TASK',
    'Task',
    ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY'],
    '/workspace/tasks',
    PermissionKeys.tasksView,
  ),
  type(
    'PROJECT',
    'Project',
    ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY'],
    '/workspace/projects',
    PermissionKeys.projectsView,
  ),
  type(
    'TICKET',
    'Ticket',
    ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY'],
    '/workspace/tickets',
    PermissionKeys.ticketsView,
  ),
  type(
    'DOC',
    'Doc',
    ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY'],
    '/workspace/docs',
    PermissionKeys.docsView,
  ),
  type(
    'FORM',
    'Form',
    ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY'],
    '/workspace/forms',
    PermissionKeys.formsView,
  ),
  type(
    'GOAL',
    'Goal',
    ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY'],
    '/workspace/goals',
    PermissionKeys.goalsView,
  ),
  type('FILE', 'File', ['WORKSPACE'], '/workspace/files', PermissionKeys.assetRead),
  type('MEMBER', 'Member', ['WORKSPACE'], '/workspace/users', PermissionKeys.workspaceMemberRead),
  type(
    'AUTOMATION',
    'Automation',
    ['WORKSPACE'],
    '/workspace/automations',
    PermissionKeys.automationView,
  ),
  type(
    'API_KEY',
    'API Key',
    ['WORKSPACE'],
    '/workspace/settings/api-keys',
    PermissionKeys.apiKeysView,
  ),
  type(
    'WEBHOOK',
    'Webhook',
    ['WORKSPACE'],
    '/workspace/settings/webhooks',
    PermissionKeys.webhooksView,
  ),
  type(
    'INTEGRATION',
    'Integration',
    ['WORKSPACE'],
    '/workspace/settings/integrations',
    PermissionKeys.integrationsView,
  ),
  type(
    'BILLING_METADATA',
    'Billing',
    ['SUPER_AGENCY', 'PLATFORM'],
    '/super-agency/billing',
    PermissionKeys.billingInvoiceView,
  ),
  type(
    'SUPER_AGENCY',
    'Super Agency',
    ['PLATFORM'],
    '/super-admin/dashboard',
    PermissionKeys.searchPlatformRead,
  ),
  type(
    'AGENCY',
    'Agency',
    ['SUPER_AGENCY', 'PLATFORM'],
    '/super-agency/agencies',
    PermissionKeys.agencyRead,
  ),
  type(
    'WORKSPACE',
    'Workspace',
    ['AGENCY', 'SUPER_AGENCY', 'PLATFORM'],
    '/agency/dashboard',
    PermissionKeys.workspaceRead,
  ),
];

export const searchTypeByKey = new Map(searchTypeRegistry.map((item) => [item.key, item]));

function type(
  key: SearchResultTypeKey,
  label: string,
  scopes: SearchScopeTypeKey[],
  routeBase: string,
  permission: string,
): SearchTypeMetadata {
  return {
    key,
    label,
    scopes,
    routeBase,
    privacy: scopes.includes('WORKSPACE')
      ? 'scope-safe query-time authorized'
      : 'parent-safe metadata',
    minimumQueryLength: SEARCH_MIN_QUERY_LENGTH,
    fuzzy: true,
    permission,
  };
}
