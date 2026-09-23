import {
  Activity,
  Bell,
  Blocks,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Clock,
  Code2,
  Database,
  FileText,
  Flag,
  Gauge,
  Goal,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  LucideIcon,
  Plug,
  Puzzle,
  Receipt,
  Repeat,
  Rocket,
  ScrollText,
  SearchCode,
  Settings,
  Shield,
  Sparkles,
  Trophy,
  Users,
  Webhook,
} from 'lucide-react';

export type DashboardScope = 'developer' | 'super-admin' | 'agency' | 'workspace';

export interface NavigationItemConfig {
  labelKey: `navigation.${string}`;
  href: string;
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string;
  featureKey?: string;
  requiredPermissions?: string[];
}

export interface NavigationGroupConfig {
  label: string;
  items: NavigationItemConfig[];
}

export interface DashboardConfig {
  scope: DashboardScope;
  title: string;
  description: string;
  basePath: string;
  requiresPlatformScope?: boolean;
  groups: NavigationGroupConfig[];
}

function disabled(
  labelKey: NavigationItemConfig['labelKey'],
  icon: LucideIcon,
  featureKey?: string,
) {
  return { labelKey, icon, href: '#', disabled: true, badge: 'Future', featureKey };
}

export const dashboardConfigs: Record<DashboardScope, DashboardConfig> = {
  developer: {
    scope: 'developer',
    title: 'Developer Dashboard',
    description: 'Platform operations shell and module foundation.',
    basePath: '/developer/dashboard',
    requiresPlatformScope: true,
    groups: [
      {
        label: 'Platform',
        items: [
          { labelKey: 'navigation.dashboard', href: '/developer/dashboard', icon: LayoutDashboard },
          disabled('navigation.agencies', BriefcaseBusiness),
          disabled('navigation.subAccounts', Blocks),
          disabled('navigation.modules', Puzzle),
          disabled('navigation.featureFlags', Flag),
          disabled('navigation.templates', FileText),
          disabled('navigation.isolatedSpace', LockKeyhole),
          {
            labelKey: 'navigation.gamification',
            href: '/developer/dashboard',
            icon: Trophy,
          },
        ],
      },
      {
        label: 'Operations',
        items: [
          disabled('navigation.releases', Rocket),
          disabled('navigation.deployments', Activity),
          disabled('navigation.systemHealth', HeartPulse),
          disabled('navigation.logs', ScrollText),
          disabled('navigation.apiWebhooks', Webhook),
          disabled('navigation.database', Database),
          disabled('navigation.jobs', ListChecks),
          disabled('navigation.security', Shield),
          disabled('navigation.settings', Settings),
        ],
      },
    ],
  },
  'super-admin': {
    scope: 'super-admin',
    title: 'Super Admin Dashboard',
    description: 'Global administration shell awaiting platform authorization.',
    basePath: '/super-admin/dashboard',
    requiresPlatformScope: true,
    groups: [
      {
        label: 'Administration',
        items: [
          {
            labelKey: 'navigation.dashboard',
            href: '/super-admin/dashboard',
            icon: LayoutDashboard,
          },
          disabled('navigation.agencies', BriefcaseBusiness),
          disabled('navigation.subAccounts', Blocks),
          disabled('navigation.users', Users),
          disabled('navigation.billing', Receipt),
          disabled('navigation.featureManagement', Flag),
          disabled('navigation.modules', Puzzle),
          disabled('navigation.isolatedSpace', LockKeyhole),
          {
            labelKey: 'navigation.globalLeaderboard',
            href: '/super-admin/dashboard',
            icon: Trophy,
          },
        ],
      },
      {
        label: 'System',
        items: [
          disabled('navigation.apiManagement', Code2),
          disabled('navigation.webhooks', Webhook),
          disabled('navigation.auditLogs', ScrollText),
          disabled('navigation.notifications', Bell),
          disabled('navigation.developerAccess', KeyRound),
          disabled('navigation.systemSettings', Settings),
        ],
      },
    ],
  },
  agency: {
    scope: 'agency',
    title: 'Agency Dashboard',
    description: 'Agency operations shell using the authorized agency context.',
    basePath: '/agency/dashboard',
    groups: [
      {
        label: 'Agency',
        items: [
          { labelKey: 'navigation.dashboard', href: '/agency/dashboard', icon: LayoutDashboard },
          disabled('navigation.subAccounts', Blocks),
          disabled('navigation.users', Users),
          disabled('navigation.departments', BriefcaseBusiness),
          disabled('navigation.rolesPermissions', Shield),
          disabled('navigation.plansUsage', Receipt),
          disabled('navigation.featureControls', Flag),
          {
            labelKey: 'navigation.agencyLeaderboard',
            href: '/agency/dashboard',
            icon: Trophy,
          },
        ],
      },
      {
        label: 'Tools',
        items: [
          disabled('navigation.reports', ClipboardList),
          disabled('navigation.apiWebhooks', Webhook),
          disabled('navigation.integrations', Plug),
          disabled('navigation.notifications', Bell),
          { labelKey: 'navigation.settings', href: '/workspace/settings', icon: Settings },
        ],
      },
    ],
  },
  workspace: {
    scope: 'workspace',
    title: 'Workspace Dashboard',
    description: 'Workspace shell prepared for Phase 6 product modules.',
    basePath: '/workspace/dashboard',
    groups: [
      {
        label: 'Work',
        items: [
          { labelKey: 'navigation.dashboard', href: '/workspace/dashboard', icon: LayoutDashboard },
          { labelKey: 'navigation.tasks', href: '/workspace/tasks', icon: ListChecks },
          {
            labelKey: 'navigation.recurringTasks',
            href: '/workspace/tasks/recurring',
            icon: Repeat,
          },
          { labelKey: 'navigation.templates', href: '/workspace/tasks/templates', icon: FileText },
          { labelKey: 'navigation.timeTracking', href: '/workspace/tasks/time', icon: Clock },
          { labelKey: 'navigation.workload', href: '/workspace/tasks/workload', icon: Gauge },
          { labelKey: 'navigation.team', href: '/workspace/tasks/team', icon: Users },
          {
            labelKey: 'navigation.calendar',
            href: '/workspace/tasks?view=calendar',
            icon: CalendarDays,
          },
          { labelKey: 'navigation.gantt', href: '/workspace/tasks?view=gantt', icon: Activity },
          { labelKey: 'navigation.reports', href: '/workspace/tasks/reports', icon: ClipboardList },
          {
            labelKey: 'navigation.activityLogs',
            href: '/workspace/tasks/activity',
            icon: ScrollText,
          },
          { labelKey: 'navigation.projects', href: '/workspace/projects', icon: ClipboardList },
          { labelKey: 'navigation.tickets', href: '/workspace/tickets', icon: SearchCode },
          {
            labelKey: 'navigation.ticketReports',
            href: '/workspace/tickets/reports',
            icon: ClipboardList,
          },
          {
            labelKey: 'navigation.gamification',
            href: '/workspace/gamification',
            icon: Sparkles,
            requiredPermissions: ['gamification.view'],
          },
        ],
      },
      {
        label: 'Workspace',
        items: [
          { labelKey: 'navigation.users', href: '/workspace/users', icon: Users },
          {
            labelKey: 'navigation.departments',
            href: '/workspace/departments',
            icon: BriefcaseBusiness,
          },
          { labelKey: 'navigation.rolesPermissions', href: '/workspace/roles', icon: Shield },
          { labelKey: 'navigation.statusManagement', href: '/workspace/statuses', icon: Gauge },
          disabled('navigation.automation', Rocket),
          disabled('navigation.docs', FileText),
          disabled('navigation.forms', ScrollText),
          disabled('navigation.goals', Goal),
          disabled('navigation.reports', ClipboardList),
          disabled('navigation.customDashboard', Gauge),
          disabled('navigation.notifications', Bell),
          disabled('navigation.integrations', Plug),
          disabled('navigation.settings', Settings),
        ],
      },
    ],
  },
};

export function canShowFeature(_featureKey?: string) {
  return !_featureKey;
}
