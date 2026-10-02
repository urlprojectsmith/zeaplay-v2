import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const schema = read('prisma/schema.prisma');
const migrationDirs = readdirSync(join(root, 'prisma/migrations')).sort();
const migration = read('prisma/migrations/0083_phase16_3_goals_foundation/migration.sql');
const service = read('src/modules/goals/goals.service.ts');
const controller = read('src/modules/goals/goals.controller.ts');
const actionService = read('src/modules/automation/automation-action.service.ts');
const domainEvents = read('src/modules/automation/automation-domain-events.service.ts');
const matrix = read('src/modules/billing/phase15-3-feature-enforcement.matrix.ts');

describe('Phase 16.3 Goals schema and architecture gate', () => {
  it('adds a single 0083 Goals foundation migration after the certified 0082 Forms baseline', () => {
    const formsIndex = migrationDirs.indexOf('0082_phase16_2_forms_foundation');
    const goalsIndex = migrationDirs.indexOf('0083_phase16_3_goals_foundation');
    expect(formsIndex).toBeGreaterThanOrEqual(0);
    expect(goalsIndex).toBe(formsIndex + 1);
    expect(migrationDirs.filter((name) => name.startsWith('0083_'))).toEqual([
      '0083_phase16_3_goals_foundation',
    ]);
    expect(migrationDirs).toHaveLength(90);
    expect(migrationDirs.at(-7)).toBe('0084_phase17_1_analytics_foundation');
    expect(migrationDirs.at(-6)).toBe('0085_phase17_2_reports');
    expect(migrationDirs.at(-5)).toBe('0086_phase17_3_global_search');
    expect(migrationDirs.at(-4)).toBe('0087_phase17_4_custom_dashboards');
    expect(migrationDirs.at(-3)).toBe('0088_phase17_4_dashboard_widget_limit_lock');
    expect(migrationDirs.at(-2)).toBe('0089_phase18_1_white_label_branding');
    expect(migrationDirs.at(-1)).toBe('0090_phase18_2_custom_domains');
    expect(migration).toContain('CREATE TABLE "goals"');
    expect(migration).toContain('CREATE TABLE "goal_progress_events"');
    expect(migration).toContain('goals_owner_shape_chk');
  });

  it('models Workspace-owned goals only with USER, DEPARTMENT, and WORKSPACE targets', () => {
    expect(schema).toContain('model Goal {');
    expect(schema).toContain('workspaceId           String');
    expect(schema).toContain('enum GoalOwnerType');
    expect(schema).toContain('USER');
    expect(schema).toContain('DEPARTMENT');
    expect(schema).toContain('WORKSPACE');
    expect(schema).not.toContain('agencyGoals');
    expect(schema).not.toContain('superAgencyGoals');
  });

  it('tracks authoritative periods, progress cache, immutable ledger, and idempotency', () => {
    expect(schema).toContain('periodStart           DateTime');
    expect(schema).toContain('periodEnd             DateTime');
    expect(schema).toContain('currentProgress       Int');
    expect(schema).toContain('model GoalProgressEvent');
    expect(schema).toContain('@@unique([goalId, idempotencyKey])');
    expect(service).toContain('reconcileGoalInternal');
    expect(service).toContain('recordProgressDelta');
  });

  it('derives automatic progress from canonical events and gamification ledgers', () => {
    expect(service).toContain('AutomationTriggerType.TASK_COMPLETED');
    expect(service).toContain('AutomationTriggerType.PROJECT_COMPLETED');
    expect(service).toContain('AutomationTriggerType.TICKET_RESOLVED');
    expect(service).toContain('gamificationXpEntry.aggregate');
    expect(service).toContain('gamificationGlobalScoreEvent.aggregate');
    expect(service).not.toContain('GoalXPService');
    expect(service).not.toContain('GoalGamificationEngine');
  });

  it('emits GOAL_COMPLETED through the existing automation event architecture only once', () => {
    expect(schema).toContain('GOAL_COMPLETED');
    expect(schema).toContain('GOAL_PROGRESS_UPDATE');
    expect(schema).toContain('GOAL');
    expect(service).toContain('AutomationTriggerType.GOAL_COMPLETED');
    expect(service).toContain('idempotencyKey: `goal-completed:${goal.id}`');
    expect(actionService).toContain('AutomationActionType.GOAL_PROGRESS_UPDATE');
    expect(domainEvents).toContain('AutomationDomainEventEntityType.GOAL');
  });

  it('keeps manual progress constrained to MANUAL_NUMERIC and custom progress server-side', () => {
    expect(service).toContain('requireMetricType: GoalMetricType.MANUAL_NUMERIC');
    expect(service).toContain('requireMetricType: GoalMetricType.CUSTOM_NUMERIC');
    expect(controller).toContain("@Post(':goalId/manual-progress')");
    expect(actionService).toContain('recordCustomProgress');
  });

  it('provides parent read-only aggregate oversight without user-level details', () => {
    expect(controller).toContain("@Controller('agencies/:agencyId/parent/goals')");
    expect(controller).toContain("@Controller('super-agencies/:superAgencyId/parent/goals')");
    expect(service).toContain("privacy: 'AGGREGATED_WORKSPACE_ONLY'");
    expect(service).toContain("by: ['workspaceId', 'status', 'ownerType', 'metricType']");
  });

  it('documents Goals as not commercially gated while retaining restricted-mode boundaries', () => {
    expect(matrix).toContain("'GOALS'");
    expect(matrix).toContain("'WorkspaceGoalsController'");
    expect(matrix).toContain('no current Phase 15.3 Goals catalog key');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
