import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AssetLifecycle,
  AssetStatus,
  AutomationActionType,
  AutomationDomainEventEntityType,
  AutomationTriggerType,
  FormSubmissionAutomationStatus,
  FormSubmissionSource,
  FormType,
  GamificationGlobalScoreEventScoreType,
  GamificationGlobalScoreEventStatus,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  GamificationXpEntryType,
  GoalMetricType,
  GoalOwnerType,
  GoalPeriodType,
  GoalProgressSourceType,
  GoalStatus,
  MembershipStatus,
  RoleScope,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../src/common/auth/auth.types';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AutomationActionService } from '../src/modules/automation/automation-action.service';
import { AutomationDomainEventsService } from '../src/modules/automation/automation-domain-events.service';
import { FormsService } from '../src/modules/forms/forms.service';
import { GoalsService } from '../src/modules/goals/goals.service';

loadApiEnv();

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const assets = {};
const rateLimit = {
  assertPublicSubmitAllowed: jest.fn().mockResolvedValue(undefined),
  assertPublicUploadAllowed: jest.fn().mockResolvedValue(undefined),
};
const captcha = {
  verifyIfRequired: jest.fn().mockReturnValue({ verified: false, required: false }),
};

describe('Phase 16.4 real Docs/Forms/Goals integration', () => {
  let prisma: PrismaService;
  let automationEvents: AutomationDomainEventsService;
  let forms: FormsService;
  let goals: GoalsService;
  let actions: AutomationActionService;
  let ids: SeedIds;
  let tenant: WorkspaceTenantContext;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    prisma = new PrismaService();
    await prisma.$connect();
    automationEvents = new AutomationDomainEventsService(prisma);
    goals = new GoalsService(prisma, audit as never, automationEvents);
    forms = new FormsService(
      prisma,
      audit as never,
      assets as never,
      automationEvents,
      rateLimit as never,
      captcha as never,
    );
    actions = new AutomationActionService(prisma, undefined, undefined, undefined, {
      get: () => goals,
    } as never);
  });

  afterAll(async () => {
    await cleanup(prisma, ids).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    audit.record.mockClear();
    rateLimit.assertPublicSubmitAllowed.mockClear();
    rateLimit.assertPublicUploadAllowed.mockClear();
    captcha.verifyIfRequired.mockClear();
    ids = makeIds();
    await cleanup(prisma, ids);
    await seedTenant(prisma, ids);
    tenant = {
      userId: ids.user,
      superAgencyId: ids.superAgency,
      agencyId: ids.agency,
      workspaceId: ids.workspace,
      workspaceMembershipId: ids.workspaceMembership,
      agencyMembershipId: ids.agencyMembership,
      roleId: ids.role,
      roleName: 'Phase 16 Owner',
      permissions: [],
      accessSource: 'WORKSPACE_MEMBERSHIP',
    };
  });

  afterEach(async () => {
    await cleanup(prisma, ids);
  });

  it('persists a public form submission once and records one canonical automation event', async () => {
    const form = await forms.createForm(tenant, {
      title: 'Phase 16.4 Public Form',
      type: FormType.FORM,
      schema: { fields: [{ id: 'name', type: 'TEXT', label: 'Name', required: true }] },
      settings: {},
    });
    const formId = String(form.id);
    await forms.publishForm(tenant, formId, { publicEnabled: true });
    const published = await prisma.form.findUniqueOrThrow({
      where: { id: formId },
      select: { publicId: true },
    });

    const first = await forms.submitPublic(
      published.publicId,
      { answers: { name: 'Ada' }, idempotencyKey: 'phase16-public-submit-key' },
      'phase16-client',
    );
    const duplicate = await forms.submitPublic(
      published.publicId,
      { answers: { name: 'Ada' }, idempotencyKey: 'phase16-public-submit-key' },
      'phase16-client',
    );

    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({ id: first.id, duplicate: true });
    await expect(
      prisma.formSubmission.count({
        where: {
          id: first.id,
          workspaceId: ids.workspace,
          source: FormSubmissionSource.PUBLIC,
          automationStatus: FormSubmissionAutomationStatus.QUEUED,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.automationDomainEvent.count({
        where: {
          workspaceId: ids.workspace,
          eventType: AutomationTriggerType.FORM_SUBMITTED,
          entityType: AutomationDomainEventEntityType.FORM_SUBMISSION,
          entityId: first.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it('updates a custom goal through the canonical automation action path', async () => {
    const period = activeGoalPeriod();
    const goal = await goals.createGoal(tenant, {
      title: 'Phase 16.4 Automation Goal',
      ownerType: GoalOwnerType.WORKSPACE,
      metricType: GoalMetricType.CUSTOM_NUMERIC,
      periodType: GoalPeriodType.CUSTOM,
      periodStart: period.start,
      periodEnd: period.end,
      targetValue: 5,
    });

    const result = await actions.executeAction(
      tenant,
      {
        workspaceId: ids.workspace,
        actionNodeId: 'goal-progress-action',
        mutation: {
          workflowId: ids.workflow,
          workflowVersionId: ids.workflowVersion,
          triggerDomainEventId: ids.domainEvent,
          triggerMatchId: ids.triggerMatch,
          causationId: ids.formSubmission,
          invocationKey: 'phase16-goal-progress-invocation',
          parentAutomationDepth: 0,
        },
      },
      {
        actionType: AutomationActionType.GOAL_PROGRESS_UPDATE,
        goalId: goal.id,
        delta: 5,
        idempotencyKey: 'phase16-goal-progress-key',
      },
    );

    expect(result).toMatchObject({
      actionType: AutomationActionType.GOAL_PROGRESS_UPDATE,
      entityType: AutomationDomainEventEntityType.GOAL,
      entityId: goal.id,
      changed: true,
    });
    await expect(
      prisma.goal.findUnique({
        where: { id: goal.id },
        select: { currentProgress: true, status: true },
      }),
    ).resolves.toMatchObject({ currentProgress: 5, status: GoalStatus.COMPLETED });
    await expect(
      prisma.goalProgressEvent.count({
        where: {
          goalId: goal.id,
          sourceType: GoalProgressSourceType.CUSTOM,
          idempotencyKey: 'phase16-goal-progress-key',
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.automationDomainEvent.count({
        where: {
          workspaceId: ids.workspace,
          eventType: AutomationTriggerType.GOAL_COMPLETED,
          entityType: AutomationDomainEventEntityType.GOAL,
          entityId: goal.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it('reconciles goals from gamification ledgers without writing XP or score rows', async () => {
    const period = activeGoalPeriod();
    await prisma.gamificationXpEntry.create({
      data: {
        workspaceId: ids.workspace,
        membershipId: ids.workspaceMembership,
        amount: 40,
        entryType: GamificationXpEntryType.EARN,
        sourceType: 'SYSTEM',
        sourceEvent: 'phase16-test',
        idempotencyKey: `phase16-xp-${ids.run}`,
        createdAt: period.ledgerAt,
      },
    });
    await prisma.gamificationWorkXpEvent.create({
      data: {
        id: ids.workXpEvent,
        workspaceId: ids.workspace,
        recipientMembershipId: ids.workspaceMembership,
        triggeredByMembershipId: ids.workspaceMembership,
        workType: GamificationPointWorkType.TASK,
        sourceEntityId: ids.domainEvent,
        eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
        correlationKey: `phase16-score-${ids.run}`,
        idempotencyKey: `phase16-score-work-${ids.run}`,
        outcome: GamificationWorkXpEventOutcome.APPLIED,
        netXpSnapshot: 10,
        occurredAt: period.ledgerAt,
      },
    });
    await prisma.gamificationGlobalScoreEvent.create({
      data: {
        workspaceId: ids.workspace,
        recipientMembershipId: ids.workspaceMembership,
        workXpEventId: ids.workXpEvent,
        workType: GamificationPointWorkType.TASK,
        sourceEntityId: ids.domainEvent,
        eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
        scoreType: GamificationGlobalScoreEventScoreType.COMPLETION,
        status: GamificationGlobalScoreEventStatus.APPLIED,
        normalizedScore: 7,
        occurredAt: period.ledgerAt,
        idempotencyKey: `phase16-score-event-${ids.run}`,
      },
    });
    const beforeXp = await prisma.gamificationXpEntry.count({
      where: { workspaceId: ids.workspace },
    });
    const beforeScore = await prisma.gamificationGlobalScoreEvent.count({
      where: { workspaceId: ids.workspace },
    });

    const xpGoal = await goals.createGoal(tenant, {
      title: 'Phase 16.4 XP Goal',
      ownerType: GoalOwnerType.USER,
      ownerMembershipId: ids.workspaceMembership,
      metricType: GoalMetricType.XP_EARNED,
      periodType: GoalPeriodType.CUSTOM,
      periodStart: period.start,
      periodEnd: period.end,
      targetValue: 40,
    });
    const scoreGoal = await goals.createGoal(tenant, {
      title: 'Phase 16.4 Score Goal',
      ownerType: GoalOwnerType.USER,
      ownerMembershipId: ids.workspaceMembership,
      metricType: GoalMetricType.GLOBAL_SCORE,
      periodType: GoalPeriodType.CUSTOM,
      periodStart: period.start,
      periodEnd: period.end,
      targetValue: 7,
    });

    expect(xpGoal).toMatchObject({ currentProgress: 40, status: GoalStatus.COMPLETED });
    expect(scoreGoal).toMatchObject({ currentProgress: 7, status: GoalStatus.COMPLETED });
    await expect(
      prisma.gamificationXpEntry.count({ where: { workspaceId: ids.workspace } }),
    ).resolves.toBe(beforeXp);
    await expect(
      prisma.gamificationGlobalScoreEvent.count({ where: { workspaceId: ids.workspace } }),
    ).resolves.toBe(beforeScore);
  });

  it('keeps Doc and Form storage links in one canonical Asset table', async () => {
    await prisma.asset.createMany({
      data: [
        assetRow(ids, ids.docAsset, 'DOC', 'DOC', ids.doc),
        assetRow(ids, ids.formAsset, 'FORM', 'FORM_SUBMISSION', ids.formSubmission),
      ],
    });
    await prisma.docFolder.create({
      data: {
        id: ids.docFolder,
        workspaceId: ids.workspace,
        name: 'Phase 16 folder',
        createdByMembershipId: ids.workspaceMembership,
      },
    });
    await prisma.doc.create({
      data: {
        id: ids.doc,
        workspaceId: ids.workspace,
        folderId: ids.docFolder,
        title: 'Phase 16 doc',
        content: { type: 'doc', content: [] },
        createdByMembershipId: ids.workspaceMembership,
      },
    });
    await prisma.docAttachment.create({
      data: {
        docId: ids.doc,
        workspaceId: ids.workspace,
        assetId: ids.docAsset,
        linkedByMembershipId: ids.workspaceMembership,
      },
    });
    await prisma.form.create({
      data: {
        id: ids.form,
        workspaceId: ids.workspace,
        publicId: `phase16-${ids.run.slice(0, 24)}`,
        title: 'Phase 16 form',
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        publicEnabled: true,
        publishedVersionNumber: 1,
        createdByMembershipId: ids.workspaceMembership,
      },
    });
    await prisma.formVersion.create({
      data: {
        id: ids.formVersion,
        formId: ids.form,
        workspaceId: ids.workspace,
        versionNumber: 1,
        state: 'PUBLISHED',
        titleSnapshot: 'Phase 16 form',
        schema: { fields: [{ id: 'upload', type: 'FILE_UPLOAD', label: 'Upload' }] },
        createdByMembershipId: ids.workspaceMembership,
        publishedByMembershipId: ids.workspaceMembership,
        publishedAt: new Date(),
      },
    });
    await prisma.formSubmission.create({
      data: {
        id: ids.formSubmission,
        formId: ids.form,
        formVersionId: ids.formVersion,
        workspaceId: ids.workspace,
        source: 'PUBLIC',
        answers: { upload: 'file.txt' },
      },
    });
    await prisma.formSubmissionAsset.create({
      data: {
        id: ids.formSubmissionAsset,
        workspaceId: ids.workspace,
        formSubmissionId: ids.formSubmission,
        formId: ids.form,
        formVersionId: ids.formVersion,
        assetId: ids.formAsset,
        fieldId: 'upload',
        kind: 'FILE',
      },
    });

    const storageLinks = await prisma.asset.findMany({
      where: { workspaceId: ids.workspace, id: { in: [ids.docAsset, ids.formAsset] } },
      select: {
        sourceModule: true,
        docAttachments: { select: { docId: true } },
        formSubmissionAssets: { select: { formSubmissionId: true } },
      },
      orderBy: { sourceModule: 'asc' },
    });

    expect(storageLinks).toEqual([
      { sourceModule: 'DOC', docAttachments: [{ docId: ids.doc }], formSubmissionAssets: [] },
      {
        sourceModule: 'FORM',
        docAttachments: [],
        formSubmissionAssets: [{ formSubmissionId: ids.formSubmission }],
      },
    ]);
  });
});

function assetRow(
  ids: SeedIds,
  id: string,
  sourceModule: 'DOC' | 'FORM',
  sourceEntityType: string,
  sourceEntityId: string,
) {
  return {
    id,
    workspaceId: ids.workspace,
    createdById: ids.user,
    uploadedByMembershipId: ids.workspaceMembership,
    originalFilename: `${sourceModule.toLowerCase()}.txt`,
    displayName: `${sourceModule.toLowerCase()}.txt`,
    storageBucket: 'phase16',
    storageProvider: 'MINIO',
    storageKey: `${ids.run}/${sourceModule.toLowerCase()}.txt`,
    mimeType: 'text/plain',
    extension: 'txt',
    sizeBytes: 12,
    status: AssetStatus.READY,
    lifecycle: AssetLifecycle.ACTIVE,
    sourceModule,
    sourceEntityType,
    sourceEntityId,
    uploadExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}

function activeGoalPeriod() {
  const now = Date.now();
  return {
    start: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    end: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ledgerAt: new Date(now - 60 * 60 * 1000),
  };
}

async function seedTenant(prisma: PrismaService, ids: SeedIds) {
  await prisma.user.create({
    data: { id: ids.user, email: `${ids.run}@example.test`, passwordHash: 'hash' },
  });
  await prisma.role.create({
    data: {
      id: ids.role,
      key: `phase16_${ids.run}`,
      name: 'Phase 16 Owner',
      scope: RoleScope.WORKSPACE,
    },
  });
  await prisma.superAgency.create({
    data: {
      id: ids.superAgency,
      name: 'Phase 16 SA',
      slug: `phase16-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.agency.create({
    data: {
      id: ids.agency,
      superAgencyId: ids.superAgency,
      name: 'Phase 16 Agency',
      slug: `phase16-agency-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.workspace.create({
    data: {
      id: ids.workspace,
      agencyId: ids.agency,
      name: 'Phase 16 Workspace',
      slug: `phase16-workspace-${ids.run}`,
      timezone: 'UTC',
      createdById: ids.user,
    },
  });
  await prisma.agencyMembership.create({
    data: { id: ids.agencyMembership, userId: ids.user, agencyId: ids.agency, roleId: ids.role },
  });
  await prisma.workspaceMembership.create({
    data: {
      id: ids.workspaceMembership,
      userId: ids.user,
      workspaceId: ids.workspace,
      roleId: ids.role,
      status: MembershipStatus.ACTIVE,
    },
  });
}

async function cleanup(prisma: PrismaService, ids?: SeedIds) {
  if (!ids) return;
  await prisma.goalProgressEvent.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.goal.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.formSubmissionAsset.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.formSubmission.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.formVersion.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.form.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docAttachment.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docShare.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docFavorite.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docMention.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docComment.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docVersion.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docAccess.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.doc.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.docFolder.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.asset.deleteMany({ where: { workspaceId: ids.workspace } });
  await deleteImmutableAutomationRows(prisma, ids.workspace);
  await deleteImmutableGamificationRows(prisma, ids.workspace);
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.agencyMembership.deleteMany({ where: { agencyId: ids.agency } });
  await prisma.workspace.deleteMany({ where: { id: ids.workspace } });
  await prisma.agency.deleteMany({ where: { id: ids.agency } });
  await prisma.superAgency.deleteMany({ where: { id: ids.superAgency } });
  await prisma.role.deleteMany({ where: { id: ids.role } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function deleteImmutableAutomationRows(prisma: PrismaService, workspaceId: string) {
  await prisma.$executeRawUnsafe('ALTER TABLE automation_trigger_matches DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe('ALTER TABLE automation_domain_events DISABLE TRIGGER USER');
  try {
    await prisma.automationTriggerMatch.deleteMany({ where: { workspaceId } });
    await prisma.automationDomainEvent.deleteMany({ where: { workspaceId } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE automation_domain_events ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE automation_trigger_matches ENABLE TRIGGER USER');
  }
}

async function deleteImmutableGamificationRows(prisma: PrismaService, workspaceId: string) {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE gamification_global_score_events DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe('ALTER TABLE gamification_work_xp_events DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe('ALTER TABLE gamification_xp_entries DISABLE TRIGGER USER');
  try {
    await prisma.gamificationGlobalScoreEvent.deleteMany({ where: { workspaceId } });
    await prisma.gamificationWorkXpEvent.deleteMany({ where: { workspaceId } });
    await prisma.gamificationXpEntry.deleteMany({ where: { workspaceId } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE gamification_xp_entries ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE gamification_work_xp_events ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE gamification_global_score_events ENABLE TRIGGER USER',
    );
  }
}

function makeIds(): SeedIds {
  const run = `p164-${randomUUID()}`;
  return {
    run,
    user: randomUUID(),
    role: randomUUID(),
    superAgency: randomUUID(),
    agency: randomUUID(),
    workspace: randomUUID(),
    agencyMembership: randomUUID(),
    workspaceMembership: randomUUID(),
    workflow: randomUUID(),
    workflowVersion: randomUUID(),
    domainEvent: randomUUID(),
    triggerMatch: randomUUID(),
    workXpEvent: randomUUID(),
    form: randomUUID(),
    formVersion: randomUUID(),
    formSubmission: randomUUID(),
    formSubmissionAsset: randomUUID(),
    doc: randomUUID(),
    docFolder: randomUUID(),
    docAsset: randomUUID(),
    formAsset: randomUUID(),
  };
}

function loadApiEnv() {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    if (process.env[key]) continue;
    const rawValue = trimmed.slice(separator + 1);
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

interface SeedIds {
  run: string;
  user: string;
  role: string;
  superAgency: string;
  agency: string;
  workspace: string;
  agencyMembership: string;
  workspaceMembership: string;
  workflow: string;
  workflowVersion: string;
  domainEvent: string;
  triggerMatch: string;
  workXpEvent: string;
  form: string;
  formVersion: string;
  formSubmission: string;
  formSubmissionAsset: string;
  doc: string;
  docFolder: string;
  docAsset: string;
  formAsset: string;
}
