import type { EffectiveEntitlements } from '../../services/billing';
import type { DashboardScope, NavigationItemConfig } from './navigation-config';

export const moduleFeatureKeys = {
  tasks: 'tasks.enabled',
  projects: 'projects.enabled',
  tickets: 'tickets.enabled',
  calendar: 'calendar.enabled',
  files: 'files.enabled',
  automation: 'automation.enabled',
  api: 'api.enabled',
  webhooks: 'webhooks.enabled',
  gamification: 'gamification.enabled',
  ghl: 'integrations.ghl.enabled',
  slack: 'integrations.slack.enabled',
  webex: 'integrations.webex.enabled',
} as const;

export type CommercialFeatureKey = (typeof moduleFeatureKeys)[keyof typeof moduleFeatureKeys];

export interface RouteFeatureRule {
  scope: DashboardScope;
  prefix: string;
  featureKey: CommercialFeatureKey;
}

export const routeFeatureRules: RouteFeatureRule[] = [
  { scope: 'workspace', prefix: '/workspace/tasks', featureKey: moduleFeatureKeys.tasks },
  { scope: 'workspace', prefix: '/workspace/projects', featureKey: moduleFeatureKeys.projects },
  { scope: 'workspace', prefix: '/workspace/tickets', featureKey: moduleFeatureKeys.tickets },
  { scope: 'workspace', prefix: '/workspace/calendar', featureKey: moduleFeatureKeys.calendar },
  { scope: 'workspace', prefix: '/workspace/files', featureKey: moduleFeatureKeys.files },
  {
    scope: 'workspace',
    prefix: '/workspace/automations',
    featureKey: moduleFeatureKeys.automation,
  },
  {
    scope: 'workspace',
    prefix: '/workspace/gamification',
    featureKey: moduleFeatureKeys.gamification,
  },
  {
    scope: 'super-agency',
    prefix: '/super-agency/gamification',
    featureKey: moduleFeatureKeys.gamification,
  },
];

const aliases: Record<string, string[]> = {
  'tasks.enabled': ['tasks'],
  'projects.enabled': ['projects'],
  'tickets.enabled': ['tickets'],
  'gamification.enabled': ['gamification'],
  'automation.enabled': ['automation'],
  'files.enabled': ['assets'],
  'api.enabled': ['public_api'],
  'webhooks.enabled': ['webhooks'],
};

export function featureEnabled(
  entitlements: Pick<EffectiveEntitlements, 'features' | 'hasCurrentSubscription'> | undefined,
  featureKey: string | undefined,
) {
  if (!featureKey) return true;
  if (!entitlements?.hasCurrentSubscription) return true;
  const features = new Map(entitlements.features.map((feature) => [feature.key, feature.enabled]));
  if (features.get(featureKey) === true) return true;
  return aliases[featureKey]?.some((alias) => features.get(alias) === true) ?? false;
}

export function resolveCommercialNavItem(
  item: NavigationItemConfig,
  entitlements: Pick<EffectiveEntitlements, 'features' | 'hasCurrentSubscription'> | undefined,
): NavigationItemConfig {
  if (item.disabled || !item.featureKey || featureEnabled(entitlements, item.featureKey)) {
    return item;
  }
  return {
    ...item,
    locked: true,
    badge: 'Locked',
  };
}

export function resolveRouteFeature(
  scope: DashboardScope,
  pathname: string,
): RouteFeatureRule | null {
  return (
    routeFeatureRules.find(
      (rule) =>
        rule.scope === scope &&
        (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)),
    ) ?? null
  );
}
