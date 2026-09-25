import {
  Activity,
  Bell,
  Blocks,
  BriefcaseBusiness,
  Building2,
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

export type DashboardScope = 'developer' | 'super-admin' | 'super-agency' | 'agency' | 'workspace';

export interface NavigationItemConfig {
  labelKey: `navigation.${string}`;
  href: string;
  icon: LucideIcon;
  disabled?: boolean;
  locked?: boolean;
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
          {
            labelKey: 'navigation.billing',
            href: '/super-admin/plans',
            icon: Receipt,
          },
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
  'super-agency': {
    scope: 'super-agency',
    title: 'Super Agency Dashboard',
    description: 'Parent tenant shell for Super Agency context, members, roles, and settings.',
    basePath: '/super-agency',
    groups: [
      {
        label: 'Super Agency',
        items: [
          {
            labelKey: 'navigation.dashboard',
            href: '/super-agency',
            icon: LayoutDashboard,
            requiredPermissions: ['super_agency.view'],
          },
          {
            labelKey: 'navigation.agencies',
            href: '/super-agency/agencies',
            icon: Building2,
            requiredPermissions: ['agency.read'],
          },
          {
            labelKey: 'navigation.docs',
            href: '/super-agency/docs',
            icon: FileText,
            requiredPermissions: ['docs.parent.read'],
          },
          {
            labelKey: 'navigation.members',
            href: '/super-agency/members',
            icon: Users,
            requiredPermissions: ['super_agency.members.view'],
          },
          {
            labelKey: 'navigation.roles',
            href: '/super-agency/roles',
            icon: Shield,
            requiredPermissions: ['super_agency.roles.view'],
          },
          {
            labelKey: 'navigation.globalLeaderboard',
            href: '/super-agency/gamification',
            icon: Trophy,
            requiredPermissions: ['gamification.global_leaderboard.view_super_agency'],
          },
          {
            labelKey: 'navigation.billing',
            href: '/super-agency/billing',
            icon: Receipt,
            requiredPermissions: ['billing.subscription.view'],
          },
          {
            labelKey: 'navigation.settings',
            href: '/super-agency/settings',
            icon: Settings,
            requiredPermissions: ['super_agency.view'],
          },
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
          {
            labelKey: 'navigation.plansUsage',
            href: '/agency/usage',
            icon: Receipt,
            requiredPermissions: ['billing.allocation.read'],
          },
          {
            labelKey: 'navigation.docs',
            href: '/agency/docs',
            icon: FileText,
            requiredPermissions: ['docs.parent.read'],
          },
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
          {
            labelKey: 'navigation.tasks',
            href: '/workspace/tasks',
            icon: ListChecks,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.recurringTasks',
            href: '/workspace/tasks/recurring',
            icon: Repeat,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.templates',
            href: '/workspace/tasks/templates',
            icon: FileText,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.timeTracking',
            href: '/workspace/tasks/time',
            icon: Clock,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.workload',
            href: '/workspace/tasks/workload',
            icon: Gauge,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.team',
            href: '/workspace/tasks/team',
            icon: Users,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.calendar',
            href: '/workspace/calendar',
            icon: CalendarDays,
            featureKey: 'calendar.enabled',
          },
          {
            labelKey: 'navigation.gantt',
            href: '/workspace/tasks?view=gantt',
            icon: Activity,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.reports',
            href: '/workspace/tasks/reports',
            icon: ClipboardList,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.activityLogs',
            href: '/workspace/tasks/activity',
            icon: ScrollText,
            featureKey: 'tasks.enabled',
          },
          {
            labelKey: 'navigation.projects',
            href: '/workspace/projects',
            icon: ClipboardList,
            featureKey: 'projects.enabled',
          },
          {
            labelKey: 'navigation.tickets',
            href: '/workspace/tickets',
            icon: SearchCode,
            featureKey: 'tickets.enabled',
          },
          {
            labelKey: 'navigation.ticketReports',
            href: '/workspace/tickets/reports',
            icon: ClipboardList,
            featureKey: 'tickets.enabled',
          },
          {
            labelKey: 'navigation.gamification',
            href: '/workspace/gamification',
            icon: Sparkles,
            featureKey: 'gamification.enabled',
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
          {
            labelKey: 'navigation.automation',
            href: '/workspace/automations',
            icon: Rocket,
            featureKey: 'automation.enabled',
            requiredPermissions: ['automation.view'],
          },
          {
            labelKey: 'navigation.files',
            href: '/workspace/files',
            icon: FileText,
            featureKey: 'files.enabled',
            requiredPermissions: ['storage.view'],
          },
          {
            labelKey: 'navigation.docs',
            href: '/workspace/docs',
            icon: FileText,
            requiredPermissions: ['docs.view'],
          },
          {
            labelKey: 'navigation.usageLimits',
            href: '/workspace/usage',
            icon: Receipt,
            requiredPermissions: ['billing.allocation.read'],
          },
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
