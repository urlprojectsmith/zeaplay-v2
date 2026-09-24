export const PUBLIC_API_SCOPES = [
  'tasks.read',
  'tasks.write',
  'projects.read',
  'projects.write',
  'tickets.read',
  'tickets.write',
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export const PUBLIC_API_SCOPE_SET = new Set<string>(PUBLIC_API_SCOPES);

export const PUBLIC_API_KEY_PREFIX = 'zea_live';
export const PUBLIC_API_ACTIVE_KEY_LIMIT = 25;
export const PUBLIC_API_DEFAULT_PAGE_SIZE = 25;
export const PUBLIC_API_MAX_PAGE_SIZE = 100;
export const PUBLIC_API_LAST_USED_THROTTLE_SECONDS = 300;
