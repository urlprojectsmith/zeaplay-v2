import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const schema = read('prisma/schema.prisma');
const migrations = readdirSync(join(root, 'prisma/migrations')).sort();
const docsService = read('src/modules/docs/docs.service.ts');
const formsService = read('src/modules/forms/forms.service.ts');
const goalsService = read('src/modules/goals/goals.service.ts');
const assetsService = read('src/modules/assets/assets.service.ts');
const automationActionService = read('src/modules/automation/automation-action.service.ts');
const automationDomainEvents = read('src/modules/automation/automation-domain-events.service.ts');
const featureMatrix = read('src/modules/billing/phase15-3-feature-enforcement.matrix.ts');
const navigation = read('../web/components/navigation/navigation-config.ts');
const securityMatrix = read('../../docs/phase16-integration-security-matrix.md');
const phase16Certification = read('../../docs/phase16-certification.md');

describe('Phase 16.4 Docs/Forms/Goals integration and security gate', () => {
  it('keeps Phase 16 schema additive through 0083 before the Phase 17 migrations', () => {
    expect(migrations).toHaveLength(85);
    expect(migrations.at(-5)).toBe('0081_phase16_1_docs_foundation');
    expect(migrations.at(-4)).toBe('0082_phase16_2_forms_foundation');
    expect(migrations.at(-3)).toBe('0083_phase16_3_goals_foundation');
    expect(migrations.at(-2)).toBe('0084_phase17_1_analytics_foundation');
    expect(migrations.at(-1)).toBe('0085_phase17_2_reports');
    expect(schema).toMatch(/\bdocs\s+Doc\[\]/);
    expect(schema).toMatch(/\bforms\s+Form\[\]/);
    expect(schema).toMatch(/\bgoals\s+Goal\[\]/);
    expect(schema).not.toContain('agencyDocs');
    expect(schema).not.toContain('agencyForms');
    expect(schema).not.toContain('agencyGoals');
    expect(schema).not.toContain('superAgencyDocs');
    expect(schema).not.toContain('superAgencyForms');
    expect(schema).not.toContain('superAgencyGoals');
  });

  it('keeps parent oversight read-only and privacy-shaped across Docs, Forms, and Goals', () => {
    const parentFormSelect = block(
      formsService,
      'const parentFormSelect = {',
      '} satisfies Prisma.FormSelect;',
    );
    const parentGoalSummary = block(
      goalsService,
      'private async parentGoalSummary',
      'private async reconcileGoalInternal',
    );
    expect(docsService).toContain('visibility: DocVisibility.WORKSPACE');
    expect(docsService).toContain('const parentDocSelect = {');
    expect(docsService).not.toContain('parentDocMutation');
    expect(formsService).toContain('const parentFormSelect = {');
    expect(formsService).toContain('_count: { select: { submissions: true } }');
    expect(parentFormSelect).not.toContain('answers: true');
    expect(parentFormSelect).not.toContain('assets: {');
    expect(goalsService).toContain("privacy: 'AGGREGATED_WORKSPACE_ONLY'");
    expect(goalsService).toContain("by: ['workspaceId', 'status', 'ownerType', 'metricType']");
    expect(parentGoalSummary).not.toContain('progressEvents');
    expect(parentGoalSummary).not.toContain('note: true');
  });

  it('uses one canonical Asset system and blocks cross-module Asset authority confusion', () => {
    expect(docsService).toContain('formSubmissionAssets');
    expect(docsService).toContain("asset.sourceModule === 'FORM'");
    expect(formsService).toContain('docAttachments');
    expect(formsService).toContain('publicFormUploadMetadata(record.metadata)');
    expect(formsService).toContain(
      "record.sourceModule === 'FORM' && record.sourceEntityId !== context.formId",
    );
    expect(assetsService).toContain('assertQuotaAvailable');
    expect(assetsService).toContain('storageUploadReservation.create');
    expect(assetsService).toContain('authorizePublicFormUpload');
    expect(assetsService).toContain('completePublicFormUpload');
    expect(schema).toContain('docAttachments       DocAttachment[]');
    expect(schema).toContain('formSubmissionAssets FormSubmissionAsset[]');
  });

  it('uses one Automation path for Forms and Goals without duplicate engines', () => {
    expect(formsService).toContain('AutomationDomainEventsService');
    expect(formsService).toContain('AutomationTriggerType.FORM_SUBMITTED');
    expect(formsService).toContain('duplicate = true');
    expect(formsService).toContain('recordAutomation');
    expect(formsService).not.toContain('FormActionRunner');
    expect(goalsService).toContain('AutomationTriggerType.GOAL_COMPLETED');
    expect(goalsService).toContain('recordGoalCompletedInTransaction');
    expect(automationActionService).toContain('AutomationActionType.GOAL_PROGRESS_UPDATE');
    expect(automationActionService).toContain('recordCustomProgress');
    expect(automationDomainEvents).toContain('recordDomainEventInTransaction');
    expect(goalsService).not.toContain('GoalAutomationEngine');
    expect(docsService).not.toContain('DocAutomationEngine');
  });

  it('keeps Gamification canonical and prevents duplicate XP/reward writes from Goals', () => {
    expect(goalsService).toContain('gamificationXpEntry.aggregate');
    expect(goalsService).toContain('gamificationGlobalScoreEvent.aggregate');
    expect(goalsService).not.toMatch(/gamificationXpEntry\.(create|createMany)/);
    expect(goalsService).not.toMatch(
      /gamificationReward|badgeAward|achievementAward|streak|leaderboard/,
    );
    expect(goalsService).not.toContain('GoalXPService');
    expect(goalsService).not.toContain('GoalGamificationEngine');
  });

  it('preserves commercial rollout compatibility without Docs, Forms, or Goals plan keys', () => {
    expect(phase16Certification).toContain('no `docs.enabled`');
    expect(featureMatrix).toContain("'FORMS',");
    expect(featureMatrix).toContain("'GOALS',");
    expect(featureMatrix).toContain('no current Phase 15.3 Forms catalog key');
    expect(featureMatrix).toContain('no current Phase 15.3 Goals catalog key');
    expect(featureMatrix).not.toContain('docs.enabled');
    expect(featureMatrix).not.toContain('forms.enabled');
    expect(featureMatrix).not.toContain('goals.enabled');
  });

  it('keeps navigation scoped to Workspace operations and read-only parent oversight', () => {
    expect(navigation).toContain('/workspace/docs');
    expect(navigation).toContain('/workspace/forms');
    expect(navigation).toContain('/workspace/goals');
    expect(navigation).toContain('/agency/docs');
    expect(navigation).toContain('/agency/forms');
    expect(navigation).toContain('/agency/goals');
    expect(navigation).toContain('/super-agency/docs');
    expect(navigation).toContain('/super-agency/forms');
    expect(navigation).toContain('/super-agency/goals');
    expect(navigation).not.toContain('/developer/docs');
    expect(navigation).not.toContain('/developer/forms');
    expect(navigation).not.toContain('/developer/goals');
  });

  it('has a complete Phase 16 security matrix without unknown or partial rows', () => {
    expect(securityMatrix).toMatch(
      /\|\s*Surface\s*\|\s*Module\s*\|\s*Actor\s*\|\s*Scope\s*\|\s*Permission\s*\|/,
    );
    expect(securityMatrix).toContain('Row count: 36');
    expect(securityMatrix).toContain('`UNKNOWN`: 0');
    expect(securityMatrix).toContain('`PARTIAL`: 0');
    expect(securityMatrix).not.toMatch(/\|\s*UNKNOWN\s*\|/);
    expect(securityMatrix).not.toMatch(/\|\s*PARTIAL\s*\|/);
    expect(phase16Certification).toContain('Phase 16.4 Main Integration/Security Audit: PASS');
    expect(phase16Certification).toContain('Phase 16 final verification: COMPLETE / CERTIFIED');
    expect(phase16Certification).toContain('Phase 16: COMPLETE / PASS');
    expect(phase16Certification).toContain('Phase 17: NOT STARTED');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function block(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}
