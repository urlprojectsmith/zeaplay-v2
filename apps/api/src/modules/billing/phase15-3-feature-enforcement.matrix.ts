import { PLAN_FEATURE_KEYS, type PlanFeatureKey } from './billing.constants';

export type FeatureMatrixStatus = 'ENFORCED' | 'EXEMPT-BY-DESIGN' | 'NOT-COMMERCIALLY-GATED';
export type FeatureMatrixClassification =
  'MUTATION' | 'REDUCTION' | 'RECOVERY' | 'MAINTENANCE' | 'SYSTEM-INTERNAL';

export interface FeatureEnforcementMatrixRow {
  domain: string;
  controller?: string;
  method?: string;
  entryPoint: string;
  operation: string;
  classification: FeatureMatrixClassification;
  featureKey: PlanFeatureKey | null;
  entitlementCheckLocation: string;
  readAllowedWhenDisabled: boolean;
  reductionAllowed: boolean;
  testReference: string;
  status: FeatureMatrixStatus;
}

const featureKeySet = new Set<string>(PLAN_FEATURE_KEYS);

function row(input: FeatureEnforcementMatrixRow): FeatureEnforcementMatrixRow {
  if (input.featureKey && !featureKeySet.has(input.featureKey)) {
    throw new Error(`Unsupported Phase 15.3 feature key in matrix: ${input.featureKey}`);
  }
  return input;
}

function routeRows(
  domain: string,
  controller: string,
  featureKey: PlanFeatureKey | null,
  entitlementCheckLocation: string,
  testReference: string,
  methods: Array<{
    method: string;
    operation?: string;
    classification?: FeatureMatrixClassification;
    featureKey?: PlanFeatureKey | null;
    status?: FeatureMatrixStatus;
    reductionAllowed?: boolean;
  }>,
): FeatureEnforcementMatrixRow[] {
  return methods.map((item) => {
    const rowFeatureKey = item.featureKey === undefined ? featureKey : item.featureKey;
    return row({
      domain,
      controller,
      method: item.method,
      entryPoint: `${controller}.${item.method}`,
      operation: item.operation ?? item.method,
      classification: item.classification ?? 'MUTATION',
      featureKey: rowFeatureKey,
      entitlementCheckLocation,
      readAllowedWhenDisabled: true,
      reductionAllowed: item.reductionAllowed ?? item.classification === 'REDUCTION',
      testReference,
      status: item.status ?? (rowFeatureKey ? 'ENFORCED' : 'NOT-COMMERCIALLY-GATED'),
    });
  });
}

export const PHASE15_3_FEATURE_ENFORCEMENT_MATRIX: FeatureEnforcementMatrixRow[] = [
  ...routeRows(
    'TASKS',
    'TasksController',
    'tasks.enabled',
    'TasksService service boundary',
    'tasks.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create' },
      { method: 'pauseRecurrence', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'resumeRecurrence' },
      { method: 'endRecurrence', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'updateCapacity' },
      { method: 'createTemplate' },
      { method: 'updateTemplate' },
      { method: 'createFromTemplate' },
      { method: 'archiveTemplate', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'reactivateTemplate' },
      { method: 'updateKanbanColumnSetting' },
      { method: 'bulkUpdateStatus' },
      { method: 'bulkUpdatePriority' },
      { method: 'bulkAddAssignees' },
      { method: 'bulkRemoveAssignees', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'bulkRemove', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'moveKanbanTask' },
      { method: 'updateSchedule' },
      { method: 'createSubtask' },
      { method: 'makeRecurring' },
      { method: 'saveTaskAsTemplate' },
      { method: 'startTimer' },
      { method: 'addManualTime' },
      { method: 'updateTimeEntry' },
      { method: 'deleteTimeEntry', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'replaceWorkloadAllocations' },
      { method: 'upsertCompletionPolicy' },
      { method: 'submitCompletion' },
      { method: 'decideCompletion' },
      { method: 'updateParent' },
      { method: 'addBlockedBy' },
      { method: 'removeBlockedBy', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'addRelated' },
      { method: 'removeRelated', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'createComment' },
      { method: 'createCommentReply' },
      { method: 'updateComment' },
      { method: 'deleteComment', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'addCommentReaction' },
      { method: 'removeCommentReaction', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'addTaskTags' },
      { method: 'removeTaskTags', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'initAttachmentUpload', featureKey: 'files.enabled' },
      { method: 'completeAttachmentUpload', featureKey: 'files.enabled' },
      { method: 'addUrlAttachment' },
      { method: 'linkAttachments' },
      { method: 'removeAttachment', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'update' },
      { method: 'updateStatus' },
      { method: 'replaceAssignees' },
      { method: 'replaceFollowers' },
      { method: 'replaceProjects' },
      { method: 'remove', classification: 'REDUCTION', reductionAllowed: true },
    ],
  ),
  ...routeRows(
    'TASKS',
    'MeTimeTrackingController',
    'tasks.enabled',
    'TasksService service boundary',
    'tasks.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [{ method: 'stop', operation: 'stopActive' }],
  ),
  ...routeRows(
    'PROJECTS',
    'ProjectsController',
    'projects.enabled',
    'ProjectsService service boundary',
    'projects.service.ts feature gates + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create' },
      { method: 'update' },
      { method: 'updateStatus' },
      { method: 'updateProgress' },
      { method: 'addTags' },
      { method: 'removeTags', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'linkTasks' },
      { method: 'unlinkTasks', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'addMembers' },
      { method: 'removeMember', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'updateOwner' },
      { method: 'initAttachmentUpload', featureKey: 'files.enabled' },
      { method: 'completeAttachmentUpload', featureKey: 'files.enabled' },
      { method: 'addUrlAttachment' },
      { method: 'linkAttachments' },
      { method: 'removeAttachment', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'remove', classification: 'REDUCTION', reductionAllowed: true },
    ],
  ),
  ...routeRows(
    'PROJECTS',
    'LegacyProjectsController',
    'projects.enabled',
    'ProjectsService service boundary',
    'projects.service.ts feature gates + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create' },
      { method: 'update' },
      { method: 'updateStatus' },
      { method: 'remove', classification: 'REDUCTION', reductionAllowed: true },
    ],
  ),
  ...routeRows(
    'TICKETS',
    'TicketsController',
    'tickets.enabled',
    'TicketsService and TicketSlaService service boundary',
    'tickets.service.ts/ticket-sla.service.ts feature gates + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create' },
      { method: 'createSavedView' },
      { method: 'updateSavedView' },
      { method: 'deleteSavedView', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'createSlaPolicy' },
      { method: 'updateSlaPolicy' },
      { method: 'createConversationEntry' },
      { method: 'initAttachmentUpload', featureKey: 'files.enabled' },
      { method: 'completeAttachmentUpload', featureKey: 'files.enabled' },
      { method: 'addUrlAttachment' },
      { method: 'linkAttachments' },
      { method: 'removeAttachment', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'update' },
      { method: 'updateStatus' },
      { method: 'updateRequester' },
      { method: 'updateAssignment' },
      { method: 'claim' },
      { method: 'updateEscalation' },
      { method: 'delete', classification: 'REDUCTION', reductionAllowed: true },
    ],
  ),
  ...routeRows(
    'CALENDAR',
    'CalendarController',
    'calendar.enabled',
    'CalendarService service boundary',
    'calendar.service.ts feature gates + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'createEvent', operation: 'createCustomEvent' },
      { method: 'updateEvent', operation: 'updateCustomEvent' },
      {
        method: 'cancelEvent',
        operation: 'cancelCustomEvent',
        classification: 'REDUCTION',
        reductionAllowed: true,
      },
    ],
  ),
  ...routeRows(
    'FILES',
    'AssetsController',
    'files.enabled',
    'AssetsService storage authority',
    'assets.service.spec.ts + phase15-3-concurrency.integration-spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'initUpload' },
      { method: 'completeUpload' },
      {
        method: 'remove',
        operation: 'delete',
        classification: 'REDUCTION',
        reductionAllowed: true,
      },
    ],
  ),
  ...routeRows(
    'FILES',
    'WorkspaceFilesController',
    'files.enabled',
    'AssetsService storage authority',
    'assets.service.spec.ts + phase15-3-concurrency.integration-spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'initUpload' },
      { method: 'completeUpload' },
      { method: 'bulkAction' },
      {
        method: 'downloadUrl',
        operation: 'createDownloadUrl',
        classification: 'REDUCTION',
        status: 'EXEMPT-BY-DESIGN',
      },
      {
        method: 'archive',
        operation: 'archiveFile',
        classification: 'REDUCTION',
        reductionAllowed: true,
      },
      {
        method: 'delete',
        operation: 'requestDelete',
        classification: 'REDUCTION',
        reductionAllowed: true,
      },
      { method: 'restore', operation: 'restoreFile' },
      {
        method: 'updateRetentionPolicy',
        classification: 'MAINTENANCE',
        status: 'EXEMPT-BY-DESIGN',
      },
    ],
  ),
  ...routeRows(
    'AUTOMATION',
    'AutomationController',
    'automation.enabled',
    'AutomationService and AutomationExecutionService service boundary',
    'automation.service.spec.ts + automation-execution.service.spec.ts + phase15-3-concurrency.integration-spec.ts',
    [
      { method: 'create' },
      { method: 'clone' },
      { method: 'updateRuntimePolicy' },
      { method: 'replayExecution' },
      { method: 'update' },
      { method: 'updateDraft' },
      { method: 'publish' },
      { method: 'disable', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'enable' },
      { method: 'archive', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'createDraftFromVersion' },
    ],
  ),
  ...routeRows(
    'AUTOMATION',
    'AutomationTemplateController',
    'automation.enabled',
    'AutomationService template boundary',
    'automation.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create', operation: 'saveAsTemplate' },
      { method: 'use', operation: 'useTemplate' },
      {
        method: 'archive',
        operation: 'archiveTemplate',
        classification: 'REDUCTION',
        reductionAllowed: true,
      },
    ],
  ),
  ...routeRows(
    'PUBLIC API',
    'PublicTasksController',
    'api.enabled',
    'PublicApiScopeGuard then canonical TasksService',
    'public-api.service.spec.ts + phase15-3-concurrency.integration-spec.ts',
    [{ method: 'create' }, { method: 'update' }],
  ),
  ...routeRows(
    'PUBLIC API',
    'PublicProjectsController',
    'api.enabled',
    'PublicApiScopeGuard then canonical ProjectsService',
    'public-api.service.spec.ts + phase15-3-concurrency.integration-spec.ts',
    [{ method: 'create' }, { method: 'update' }],
  ),
  ...routeRows(
    'PUBLIC API',
    'PublicTicketsController',
    'api.enabled',
    'PublicApiScopeGuard then canonical TicketsService',
    'public-api.service.spec.ts + phase15-3-concurrency.integration-spec.ts',
    [{ method: 'create' }, { method: 'update' }],
  ),
  ...routeRows(
    'PUBLIC API',
    'ApiKeysController',
    'api.enabled',
    'ApiKeysService service boundary',
    'api-keys.service.ts feature/capacity gates + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create' },
      { method: 'update' },
      { method: 'revoke', classification: 'REDUCTION', reductionAllowed: true },
    ],
  ),
  ...routeRows(
    'WEBHOOKS',
    'WebhooksController',
    'webhooks.enabled',
    'WebhooksService service boundary',
    'webhooks.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create' },
      { method: 'update' },
      { method: 'disable', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'rotateSecret' },
      { method: 'sendTest', operation: 'test' },
      { method: 'retryDelivery', classification: 'RECOVERY' },
    ],
  ),
  ...routeRows(
    'GHL/SLACK/WEBEX',
    'IntegrationsController',
    null,
    'IntegrationsService provider-specific assertWorkspaceFeatureAvailable mapping for integrations.ghl.enabled, integrations.slack.enabled, and integrations.webex.enabled; Generic REST has no Phase 15.3 key',
    'integrations.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'create', operation: 'connect', status: 'ENFORCED' },
      { method: 'update', status: 'ENFORCED' },
      { method: 'test', status: 'ENFORCED' },
      {
        method: 'disconnect',
        classification: 'REDUCTION',
        status: 'EXEMPT-BY-DESIGN',
        reductionAllowed: true,
      },
      { method: 'execute', operation: 'executeAction', status: 'ENFORCED' },
    ],
  ),
  ...routeRows(
    'GHL/SLACK/WEBEX',
    'CloudDrivesController',
    'files.enabled',
    'CloudDrivesService storage feature boundary plus provider connection checks',
    'cloud-drives.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'connect' },
      { method: 'disconnect', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'importFile' },
      { method: 'exportFile' },
    ],
  ),
  ...routeRows(
    'GHL/SLACK/WEBEX',
    'CloudDriveOAuthController',
    'files.enabled',
    'CloudDrivesService callback state binding and storage boundary',
    'cloud-drives.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [{ method: 'callbackPost', operation: 'callback', classification: 'RECOVERY' }],
  ),
  ...routeRows(
    'GAMIFICATION',
    'GamificationController',
    'gamification.enabled',
    'GamificationService active-action service boundary',
    'gamification.service.spec.ts + phase15-3-feature-enforcement-matrix.spec.ts',
    [
      { method: 'createLevel' },
      { method: 'updateLevel' },
      { method: 'createBadge' },
      { method: 'updateBadge' },
      { method: 'createAchievement' },
      { method: 'updateAchievement' },
      { method: 'createReward' },
      { method: 'updateReward' },
      { method: 'redeemReward' },
      { method: 'fulfillRewardRedemption' },
      { method: 'cancelRewardRedemption', classification: 'REDUCTION', reductionAllowed: true },
      { method: 'updateStreakConfig' },
      { method: 'updateLeaderboardConfig' },
      { method: 'updateMyLeaderboardPreference' },
      { method: 'upsertCompletionPointRule' },
      {
        method: 'removeCompletionPointRuleOverride',
        classification: 'REDUCTION',
        reductionAllowed: true,
      },
      { method: 'upsertCreationPointRule' },
      {
        method: 'removeCreationPointRuleOverride',
        classification: 'REDUCTION',
        reductionAllowed: true,
      },
      { method: 'previewCompletionPoints' },
      { method: 'adjustAdminBalance' },
      { method: 'createResetStepUpGrant', classification: 'RECOVERY', status: 'EXEMPT-BY-DESIGN' },
      { method: 'resetAdminBalance' },
      { method: 'previewXpReconciliation' },
      { method: 'applyXpReconciliation' },
    ],
  ),
  row({
    domain: 'TASKS',
    entryPoint: 'TaskRecurrenceProcessor.process',
    operation: 'recurrence-generated Task',
    classification: 'SYSTEM-INTERNAL',
    featureKey: 'tasks.enabled',
    entitlementCheckLocation: 'Worker reloads tenant state then canonical TasksService create path',
    readAllowedWhenDisabled: true,
    reductionAllowed: false,
    testReference: 'task-recurrence.processor.spec.ts + tasks.service.spec.ts',
    status: 'ENFORCED',
  }),
  row({
    domain: 'AUTOMATION',
    entryPoint: 'AutomationExecutionProcessor.process',
    operation: 'trigger-generated execution',
    classification: 'SYSTEM-INTERNAL',
    featureKey: 'automation.enabled',
    entitlementCheckLocation: 'AutomationExecutionService.reserveAutomationExecutionUsageTx',
    readAllowedWhenDisabled: true,
    reductionAllowed: false,
    testReference:
      'automation-execution.service.spec.ts + phase15-3-concurrency.integration-spec.ts',
    status: 'ENFORCED',
  }),
  row({
    domain: 'FILES',
    entryPoint: 'StorageRetentionProcessor.process',
    operation: 'retention purge cleanup',
    classification: 'MAINTENANCE',
    featureKey: null,
    entitlementCheckLocation: 'Maintenance exemption; no new storage is created',
    readAllowedWhenDisabled: true,
    reductionAllowed: true,
    testReference: 'storage-retention.processor.spec.ts',
    status: 'EXEMPT-BY-DESIGN',
  }),
  row({
    domain: 'WEBHOOKS',
    entryPoint: 'WebhookDeliveryProcessor.process',
    operation: 'already-committed outbound delivery',
    classification: 'SYSTEM-INTERNAL',
    featureKey: null,
    entitlementCheckLocation:
      'Delivery preserves committed event semantics; no new config mutation',
    readAllowedWhenDisabled: true,
    reductionAllowed: false,
    testReference: 'webhook-delivery.processor.spec.ts',
    status: 'EXEMPT-BY-DESIGN',
  }),
  row({
    domain: 'GENERIC REST',
    entryPoint: 'IntegrationsService GENERIC_REST provider action',
    operation: 'fixed-origin Generic REST action',
    classification: 'MUTATION',
    featureKey: null,
    entitlementCheckLocation:
      'No current Phase 15.3 feature catalog key; retains SSRF/credential/action safeguards',
    readAllowedWhenDisabled: true,
    reductionAllowed: false,
    testReference:
      'integration-generic-rest-security.service.spec.ts + integrations.service.spec.ts',
    status: 'NOT-COMMERCIALLY-GATED',
  }),
];

export function matrixKey(controller: string, method: string) {
  return `${controller}.${method}`;
}

export const PHASE15_3_MATRIX_ROUTE_KEYS = new Set(
  PHASE15_3_FEATURE_ENFORCEMENT_MATRIX.flatMap((item) =>
    item.controller && item.method ? [matrixKey(item.controller, item.method)] : [],
  ),
);
