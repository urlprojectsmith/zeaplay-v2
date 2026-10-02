import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const repoRoot = join(root, '..', '..');
const migrations = readdirSync(join(root, 'prisma/migrations')).sort();

const projectStatus = read('../../docs/project-status.md');
const securityMatrix = read('../../docs/version1-security-matrix.md');
const integrationMatrix = read('../../docs/version1-integration-matrix.md');
const certification = read('../../docs/version1-certification.md');
const architecture = read('../../docs/architecture.md');
const apiStandards = read('../../docs/api-standards.md');
const frontendArchitecture = read('../../docs/frontend-architecture.md');
const dashboardShells = read('../../docs/dashboard-shells.md');
const navigation = read('../web/components/navigation/navigation-config.ts');
const permissions = read('src/common/authorization/permissions.ts');
const analyticsRegistry = read('src/modules/analytics/analytics.registry.ts');
const analyticsService = read('src/modules/analytics/analytics.service.ts');
const reportsService = read('src/modules/reports/reports.service.ts');
const reportsExporter = read('src/modules/reports/report-exporter.ts');
const reportsScheduler = read('src/modules/reports/reports-scheduler.service.ts');
const searchRegistry = read('src/modules/search/search.registry.ts');
const searchService = read('src/modules/search/search.service.ts');
const searchWorker = read('../worker/src/processors/search-index.processor.ts');
const dashboardsDto = read('src/modules/custom-dashboards/dto/custom-dashboards.dto.ts');
const dashboardsService = read('src/modules/custom-dashboards/custom-dashboards.service.ts');
const superAgenciesService = read('src/modules/super-agencies/super-agencies.service.ts');

describe('Version 1 Phase 17.5 Prompt 1 main audit', () => {
  it('keeps the Version 1 migration boundary at 0088 and tracks Phase 18 through 0090', () => {
    expect(migrations).toHaveLength(90);
    expect(migrations.at(-7)).toBe('0084_phase17_1_analytics_foundation');
    expect(migrations.at(-6)).toBe('0085_phase17_2_reports');
    expect(migrations.at(-5)).toBe('0086_phase17_3_global_search');
    expect(migrations.at(-4)).toBe('0087_phase17_4_custom_dashboards');
    expect(migrations.at(-3)).toBe('0088_phase17_4_dashboard_widget_limit_lock');
    expect(migrations.at(-2)).toBe('0089_phase18_1_white_label_branding');
    expect(migrations.at(-1)).toBe('0090_phase18_2_custom_domains');
  });

  it('publishes complete Version 1 final matrices without unknown, partial, or fail rows', () => {
    expect(countPassRows(securityMatrix)).toBe(69);
    expect(securityMatrix).toContain('Row count: 69.');
    expect(securityMatrix).toContain('Unknown rows: 0.');
    expect(securityMatrix).toContain('Partial rows: 0.');
    expect(securityMatrix).toContain('Fail rows: 0.');
    expect(securityMatrix).not.toMatch(/\|\s*(UNKNOWN|PARTIAL|FAIL)\s*\|/);

    expect(countPassRows(integrationMatrix)).toBe(39);
    expect(integrationMatrix).toContain('Row count: 39.');
    expect(integrationMatrix).toContain('Unknown rows: 0.');
    expect(integrationMatrix).toContain('Partial rows: 0.');
    expect(integrationMatrix).toContain('Fail rows: 0.');
    expect(integrationMatrix).not.toMatch(/\|\s*(UNKNOWN|PARTIAL|FAIL)\s*\|/);

    expect(certification).toContain('Status: ZeaPlay Version 1 COMPLETE / CERTIFIED.');
    expect(certification).toContain('Phase 17.5 Final Certification: COMPLETE / PASS.');
    expect(certification).toContain('ZeaPlay Version 1: COMPLETE / CERTIFIED.');
    expect(certification).toContain('Phase 18: NOT STARTED.');
  });

  it('preserves hierarchy, five environments, and Organization compatibility boundaries', () => {
    for (const scope of ['developer', 'super-admin', 'super-agency', 'agency', 'workspace']) {
      expect(navigation).toContain(`scope: '${scope}'`);
    }
    expect(dashboardShells).toContain(
      'Developer, Platform / Super Admin, Super Agency, Agency, and Workspace / Sub-account',
    );
    expect(architecture).toContain('Platform / Super Admin -> Super Agency ->');
    expect(apiStandards).toContain('Organization` is legacy');
    expect(frontendArchitecture).toContain('Parent scope selection must not grant child-shell');
    expect(projectStatus).not.toContain('VERSION 1: COMPLETE / CERTIFIED');
  });

  it('keeps Phase 17 modules as reuse layers over canonical authorities', () => {
    expect(analyticsRegistry).toContain('export const METRIC_REGISTRY');
    expect(analyticsRegistry).toContain("'billing.active_subscriptions'");
    expect(analyticsRegistry).toContain('const billingScopes');
    expect(analyticsService).toContain('METRIC_REGISTRY_BY_KEY');
    expect(analyticsService).toContain('maxPageSize: 100');

    expect(reportsService).toContain('AnalyticsService');
    expect(reportsService).toContain('ReportsService');
    expect(reportsExporter).toContain('REPORT_SYNC_EXPORT_ROW_LIMIT = 1_000');
    expect(reportsScheduler).toContain('ReportsSchedulerService');

    expect(searchRegistry).toContain('SEARCH_MAX_PAGE_SIZE = 25');
    expect(searchRegistry).toContain('SEARCH_RECENT_LIMIT = 10');
    expect(searchService).toContain('scopeType');
    expect(searchService).toContain('SEARCH_QUERY_RATE_LIMIT = 90');
    expect(searchWorker).toContain('REBUILD_BATCH_SIZE');

    expect(dashboardsDto).toContain('export const dashboardWidgetTypes = [');
    expect(countDashboardWidgetTypes(dashboardsDto)).toBe(9);
    expect(dashboardsDto).toContain('@Min(60)');
    expect(dashboardsService).toContain('MAX_WIDGETS_PER_DASHBOARD = 30');
    expect(dashboardsService).toContain('AnalyticsService');
    expect(dashboardsService).toContain('ReportsService');
  });

  it('keeps RBAC permission-key based and platform permissions non-delegable to tenant roles', () => {
    expect(permissions).toContain('analytics.platform.read');
    expect(permissions).toContain('reports.platform.read');
    expect(permissions).toContain('search.platform.read');
    expect(permissions).toContain('dashboards.platform.read');
    expect(permissions).toContain('PLATFORM_ONLY_PERMISSION_KEYS');
    expect(superAgenciesService).toContain('PLATFORM_ONLY_PERMISSION_KEYS.has');

    const source = readTree([
      'apps/api/src',
      'apps/web/app',
      'apps/web/components',
      'apps/web/contexts',
      'apps/web/services',
      'apps/web/stores',
    ]);
    expect(source).not.toMatch(/role\s*===\s*['"](OWNER|ADMIN)['"]/);
    expect(source).not.toMatch(/roleName\s*===/);
    expect(source).not.toContain('eval(');
    expect(source).not.toContain('new Function(');
  });

  it('keeps post-Phase 18.2 scope out of active source while allowing documented deferred text', () => {
    const source = readTree([
      'apps/api/src',
      'apps/web/app',
      'apps/web/components',
      'apps/web/services',
    ]);
    expect(source).not.toMatch(/branded login/i);
    expect(source).not.toMatch(/public forms branding/i);
    expect(source).not.toMatch(/public docs branding/i);
    expect(source).not.toMatch(/email branding/i);
    expect(source).not.toMatch(/custom sender/i);
    expect(source).not.toMatch(/developer isolated space/i);
    expect(source).not.toMatch(/isolated developer/i);
    expect(source).not.toMatch(/public custom dashboard/i);
    expect(source).not.toMatch(/dashboard share token/i);
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function countPassRows(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| ') && /\|\s*PASS\s*\|/.test(line)).length;
}

function countDashboardWidgetTypes(source: string) {
  const match = source.match(/dashboardWidgetTypes = \[([\s\S]+?)\] as const/);
  expect(match).toBeTruthy();
  const widgetList = match?.[1] ?? '';
  return (widgetList.match(/'[^']+'/g) ?? []).length;
}

function readTree(relativeDirs: string[]) {
  return relativeDirs.map((relativeDir) => readDir(join(repoRoot, relativeDir))).join('\n');
}

function readDir(dir: string): string {
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => {
      const stats = statSync(path);
      if (stats.isDirectory() && /[\\/](\.next|dist|coverage|node_modules)$/.test(path)) {
        return false;
      }
      if (stats.isDirectory()) return true;
      return (
        /\.(ts|tsx|js|jsx)$/.test(path) && !path.endsWith('.spec.ts') && !path.endsWith('.test.tsx')
      );
    })
    .map((path) => (statSync(path).isDirectory() ? readDir(path) : readFileSync(path, 'utf8')))
    .join('\n');
}
