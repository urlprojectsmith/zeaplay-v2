import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyticsScopeType,
  AssetLifecycle,
  AutomationWorkflowStatus,
  DocVisibility,
  MembershipStatus,
  Prisma,
  ProjectVisibility,
  SearchIndexJobStatus,
  SearchIndexOperation,
  SearchPrivacyClass,
  SearchResultType,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { SEARCH_INDEX_JOB_TYPE, SEARCH_INDEX_QUEUE } from '../queue/queue.constants';

type SearchScope = {
  type: AnalyticsScopeType;
  id: string;
  workspaceId: string | null;
  agencyId: string | null;
  superAgencyId: string | null;
};

type SearchDocumentInput = {
  scope: SearchScope;
  entityType: SearchResultType;
  entityId: string;
  title: string;
  subtitle?: string | null;
  searchText: string;
  route: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  privacyClass: SearchPrivacyClass;
  archived?: boolean;
  sourceUpdatedAt: Date;
  sourceVersion?: number;
};

type SearchIndexPayload = {
  searchIndexJobId?: string;
  operation: SearchIndexOperation;
  entityType?: SearchResultType;
  entityId?: string;
  scopeType?: AnalyticsScopeType;
  scopeId?: string;
  types?: SearchResultType[];
  sourceUpdatedAt?: string;
  sourceVersion?: number;
  correlationId?: string;
};

const REBUILD_BATCH_SIZE = 250;

@Processor(SEARCH_INDEX_QUEUE)
@Injectable()
export class SearchIndexProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchIndexProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<SearchIndexPayload>): Promise<void> {
    if (job.name !== SEARCH_INDEX_JOB_TYPE) return;
    const payload = this.validate(job.data);
    const jobId = payload.searchIndexJobId;
    if (jobId) {
      const claimed = await this.prisma.searchIndexJob.updateMany({
        where: {
          id: jobId,
          status: { in: [SearchIndexJobStatus.PENDING, SearchIndexJobStatus.FAILED] },
        },
        data: {
          status: SearchIndexJobStatus.RUNNING,
          lockedAt: new Date(),
          attemptCount: { increment: 1 },
          safeErrorCode: null,
        },
      });
      if (claimed.count === 0) return;
    }
    try {
      const result =
        payload.operation === SearchIndexOperation.REBUILD_SCOPE
          ? await this.rebuildScope(payload)
          : await this.applyEntityJob(payload);
      if (jobId) {
        await this.prisma.searchIndexJob.update({
          where: { id: jobId },
          data: {
            status: result.skippedStale
              ? SearchIndexJobStatus.SKIPPED_STALE
              : SearchIndexJobStatus.SUCCEEDED,
            completedAt: new Date(),
            payload: { ...safePayload(payload), result },
          },
        });
      }
      this.logger.log({
        correlationId: payload.correlationId,
        jobId,
        operation: payload.operation,
        result,
        message: 'Search indexing job completed',
      });
    } catch (error) {
      const code = safeErrorCode(error);
      if (jobId) {
        await this.prisma.searchIndexJob.update({
          where: { id: jobId },
          data: { status: SearchIndexJobStatus.FAILED, safeErrorCode: code },
        });
      }
      this.logger.warn(
        {
          correlationId: payload.correlationId,
          jobId,
          operation: payload.operation,
          code,
          message: 'Search indexing job failed',
        },
        'Search indexing job failed',
      );
      throw error;
    }
  }

  private validate(payload: SearchIndexPayload): SearchIndexPayload {
    if (!payload || typeof payload !== 'object') throw new Error('SEARCH_JOB_INVALID');
    if (!Object.values(SearchIndexOperation).includes(payload.operation)) {
      throw new Error('SEARCH_JOB_OPERATION_INVALID');
    }
    if (payload.operation === SearchIndexOperation.REBUILD_SCOPE) {
      if (!payload.scopeType || !payload.scopeId) throw new Error('SEARCH_REBUILD_SCOPE_REQUIRED');
      return payload;
    }
    if (!payload.entityType || !payload.entityId) throw new Error('SEARCH_ENTITY_REQUIRED');
    return payload;
  }

  private async rebuildScope(payload: SearchIndexPayload) {
    const scope = await this.resolveScope(payload.scopeType!, payload.scopeId!);
    const allowed = new Set(
      payload.types?.length ? payload.types : Object.values(SearchResultType),
    );
    await this.prisma.searchDocument.deleteMany({
      where: { scopeType: scope.type, scopeId: scope.id },
    });
    let indexed = 0;
    if (scope.type === AnalyticsScopeType.WORKSPACE && scope.workspaceId) {
      indexed += await this.rebuildWorkspace(scope, allowed);
    } else if (scope.type === AnalyticsScopeType.AGENCY && scope.agencyId) {
      indexed += await this.rebuildAgency(scope, allowed);
    } else if (scope.type === AnalyticsScopeType.SUPER_AGENCY && scope.superAgencyId) {
      indexed += await this.rebuildSuperAgency(scope, allowed);
    } else if (scope.type === AnalyticsScopeType.PLATFORM) {
      indexed += await this.rebuildPlatform(scope, allowed);
    }
    return { indexed, skippedStale: false };
  }

  private async applyEntityJob(payload: SearchIndexPayload) {
    const requestedAt = parsePayloadDate(payload.sourceUpdatedAt);
    if (payload.operation === SearchIndexOperation.DELETE) {
      await this.deleteAllEntityDocuments(
        payload.entityType!,
        payload.entityId!,
        requestedAt,
        payload.sourceVersion,
      );
      return { indexed: 0, deleted: true, skippedStale: false };
    }
    const indexed = await this.indexEntity(
      payload.entityType!,
      payload.entityId!,
      requestedAt,
      payload.sourceVersion,
    );
    return { indexed, skippedStale: indexed === 0 };
  }

  private async rebuildWorkspace(scope: SearchScope, allowed: Set<SearchResultType>) {
    const workspaceId = scope.workspaceId!;
    let indexed = 0;
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.TASK, (cursor) =>
      this.prisma.task.findMany({
        where: { workspaceId, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.PROJECT, (cursor) =>
      this.prisma.project.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.TICKET, (cursor) =>
      this.prisma.ticket.findMany({
        where: { workspaceId, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.DOC, (cursor) =>
      this.prisma.doc.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.FORM, (cursor) =>
      this.prisma.form.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.GOAL, (cursor) =>
      this.prisma.goal.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.FILE, (cursor) =>
      this.prisma.asset.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.MEMBER, (cursor) =>
      this.prisma.workspaceMembership.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.AUTOMATION, (cursor) =>
      this.prisma.automationWorkflow.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.API_KEY, (cursor) =>
      this.prisma.apiKey.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.WEBHOOK, (cursor) =>
      this.prisma.webhookSubscription.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    indexed += await this.rebuildWorkspaceType(allowed, SearchResultType.INTEGRATION, (cursor) =>
      this.prisma.integrationConnection.findMany({
        where: { workspaceId },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: REBUILD_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    );
    return indexed;
  }

  private async rebuildWorkspaceType(
    allowed: Set<SearchResultType>,
    type: SearchResultType,
    fetchBatch: (cursor?: string) => Promise<Array<{ id: string }>>,
  ) {
    if (!allowed.has(type)) return 0;
    let indexed = 0;
    let cursor: string | undefined;
    for (;;) {
      const records = await fetchBatch(cursor);
      for (const record of records) indexed += await this.indexEntity(type, record.id);
      if (records.length < REBUILD_BATCH_SIZE) break;
      cursor = records.at(-1)?.id;
      if (!cursor) break;
    }
    return indexed;
  }

  private async rebuildAgency(scope: SearchScope, allowed: Set<SearchResultType>) {
    const workspaces = await this.prisma.workspace.findMany({
      where: { agencyId: scope.agencyId! },
      select: { id: true },
      take: REBUILD_BATCH_SIZE,
    });
    let indexed = 0;
    if (allowed.has(SearchResultType.WORKSPACE)) {
      for (const workspace of workspaces)
        indexed += await this.indexEntity(SearchResultType.WORKSPACE, workspace.id);
    }
    for (const type of parentWorkspaceTypes) {
      if (!allowed.has(type)) continue;
      for (const workspace of workspaces) {
        indexed += await this.rebuildWorkspace(
          { ...scope, workspaceId: workspace.id },
          new Set([type]),
        );
      }
    }
    return indexed;
  }

  private async rebuildSuperAgency(scope: SearchScope, allowed: Set<SearchResultType>) {
    const [agencies, workspaces, invoices] = await Promise.all([
      allowed.has(SearchResultType.AGENCY)
        ? this.prisma.agency.findMany({
            where: { superAgencyId: scope.superAgencyId! },
            select: { id: true },
            take: REBUILD_BATCH_SIZE,
          })
        : [],
      this.prisma.workspace.findMany({
        where: { agency: { superAgencyId: scope.superAgencyId! } },
        select: { id: true },
        take: REBUILD_BATCH_SIZE,
      }),
      allowed.has(SearchResultType.BILLING_METADATA)
        ? this.prisma.billingInvoice.findMany({
            where: { superAgencyId: scope.superAgencyId! },
            select: { id: true },
            take: REBUILD_BATCH_SIZE,
          })
        : [],
    ]);
    let indexed = 0;
    for (const agency of agencies)
      indexed += await this.indexEntity(SearchResultType.AGENCY, agency.id);
    if (allowed.has(SearchResultType.WORKSPACE)) {
      for (const workspace of workspaces)
        indexed += await this.indexEntity(SearchResultType.WORKSPACE, workspace.id);
    }
    for (const invoice of invoices)
      indexed += await this.indexEntity(SearchResultType.BILLING_METADATA, invoice.id);
    for (const type of parentWorkspaceTypes) {
      if (!allowed.has(type)) continue;
      for (const workspace of workspaces) {
        indexed += await this.rebuildWorkspace(
          { ...scope, workspaceId: workspace.id },
          new Set([type]),
        );
      }
    }
    return indexed;
  }

  private async rebuildPlatform(scope: SearchScope, allowed: Set<SearchResultType>) {
    let indexed = 0;
    if (allowed.has(SearchResultType.SUPER_AGENCY)) {
      const rows = await this.prisma.superAgency.findMany({
        select: { id: true },
        take: REBUILD_BATCH_SIZE,
      });
      for (const row of rows)
        indexed += await this.indexEntity(SearchResultType.SUPER_AGENCY, row.id);
    }
    if (allowed.has(SearchResultType.AGENCY)) {
      const rows = await this.prisma.agency.findMany({
        select: { id: true },
        take: REBUILD_BATCH_SIZE,
      });
      for (const row of rows) indexed += await this.indexEntity(SearchResultType.AGENCY, row.id);
    }
    if (allowed.has(SearchResultType.WORKSPACE)) {
      const rows = await this.prisma.workspace.findMany({
        select: { id: true },
        take: REBUILD_BATCH_SIZE,
      });
      for (const row of rows) indexed += await this.indexEntity(SearchResultType.WORKSPACE, row.id);
    }
    if (scope.type !== AnalyticsScopeType.PLATFORM) return indexed;
    return indexed;
  }

  private async indexEntity(
    type: SearchResultType,
    id: string,
    requestedAt?: Date,
    sourceVersion?: number,
  ) {
    switch (type) {
      case SearchResultType.TASK:
        return this.indexTask(id, requestedAt, sourceVersion);
      case SearchResultType.PROJECT:
        return this.indexProject(id, requestedAt, sourceVersion);
      case SearchResultType.TICKET:
        return this.indexTicket(id, requestedAt, sourceVersion);
      case SearchResultType.DOC:
        return this.indexDoc(id, requestedAt, sourceVersion);
      case SearchResultType.FORM:
        return this.indexForm(id, requestedAt, sourceVersion);
      case SearchResultType.GOAL:
        return this.indexGoal(id, requestedAt, sourceVersion);
      case SearchResultType.FILE:
        return this.indexAsset(id, requestedAt, sourceVersion);
      case SearchResultType.MEMBER:
        return this.indexMember(id, requestedAt, sourceVersion);
      case SearchResultType.AUTOMATION:
        return this.indexAutomation(id, requestedAt, sourceVersion);
      case SearchResultType.API_KEY:
        return this.indexApiKey(id, requestedAt, sourceVersion);
      case SearchResultType.WEBHOOK:
        return this.indexWebhook(id, requestedAt, sourceVersion);
      case SearchResultType.INTEGRATION:
        return this.indexIntegration(id, requestedAt, sourceVersion);
      case SearchResultType.WORKSPACE:
        return this.indexWorkspace(id, requestedAt, sourceVersion);
      case SearchResultType.AGENCY:
        return this.indexAgency(id, requestedAt, sourceVersion);
      case SearchResultType.SUPER_AGENCY:
        return this.indexSuperAgency(id, requestedAt, sourceVersion);
      case SearchResultType.BILLING_METADATA:
        return this.indexBillingInvoice(id, requestedAt, sourceVersion);
      default:
        return 0;
    }
  }

  private async indexTask(id: string, requestedAt?: Date, sourceVersion?: number) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!task || task.deletedAt)
      return this.deleteAllEntityDocuments(SearchResultType.TASK, id, requestedAt, sourceVersion);
    const scope = workspaceScope(
      task.workspaceId,
      task.workspace.agencyId,
      task.workspace.agency.superAgencyId,
    );
    const archived = Boolean(task.archivedAt);
    let indexed = 0;
    await this.upsertDocument({
      scope,
      entityType: SearchResultType.TASK,
      entityId: task.id,
      title: task.title,
      subtitle: task.priority,
      searchText: [task.title, task.description].join(' '),
      route: { href: `/workspace/tasks?task=${task.id}` },
      metadata: { statusDefinitionId: task.statusDefinitionId, priority: task.priority },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived,
      sourceUpdatedAt: task.updatedAt,
    });
    indexed += 1;
    indexed += await this.upsertParentOperational(
      task.workspaceId,
      scope.agencyId!,
      scope.superAgencyId,
      SearchResultType.TASK,
      task.id,
      task.title,
      task.priority,
      [task.title, task.priority].join(' '),
      { priority: task.priority },
      archived,
      task.updatedAt,
    );
    return indexed;
  }

  private async indexProject(id: string, requestedAt?: Date, sourceVersion?: number) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!project)
      return this.deleteAllEntityDocuments(
        SearchResultType.PROJECT,
        id,
        requestedAt,
        sourceVersion,
      );
    const scope = workspaceScope(
      project.workspaceId,
      project.workspace.agencyId,
      project.workspace.agency.superAgencyId,
    );
    const archived = Boolean(project.archivedAt);
    let indexed = 0;
    await this.upsertDocument({
      scope,
      entityType: SearchResultType.PROJECT,
      entityId: project.id,
      title: project.name,
      subtitle: project.status,
      searchText: [project.name, project.description].join(' '),
      route: { href: `/workspace/projects/${project.id}` },
      metadata: { status: project.status, visibility: project.visibility },
      privacyClass:
        project.visibility === ProjectVisibility.RESTRICTED
          ? SearchPrivacyClass.ACL_SENSITIVE
          : SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived,
      sourceUpdatedAt: project.updatedAt,
    });
    indexed += 1;
    indexed += await this.upsertParentOperational(
      project.workspaceId,
      scope.agencyId!,
      scope.superAgencyId,
      SearchResultType.PROJECT,
      project.id,
      project.name,
      project.status,
      [project.name, project.status, project.visibility].join(' '),
      { status: project.status, visibility: project.visibility },
      archived,
      project.updatedAt,
    );
    return indexed;
  }

  private async indexTicket(id: string, requestedAt?: Date, sourceVersion?: number) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!ticket || ticket.deletedAt)
      return this.deleteAllEntityDocuments(SearchResultType.TICKET, id, requestedAt, sourceVersion);
    const scope = workspaceScope(
      ticket.workspaceId,
      ticket.workspace.agencyId,
      ticket.workspace.agency.superAgencyId,
    );
    let indexed = 0;
    await this.upsertDocument({
      scope,
      entityType: SearchResultType.TICKET,
      entityId: ticket.id,
      title: ticket.subject,
      subtitle: ticket.ticketNumber,
      searchText: [ticket.ticketNumber, ticket.subject, ticket.description].join(' '),
      route: { href: `/workspace/tickets/${ticket.id}` },
      metadata: { ticketNumber: ticket.ticketNumber, priority: ticket.priority },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      sourceUpdatedAt: ticket.updatedAt,
    });
    indexed += 1;
    indexed += await this.upsertParentOperational(
      ticket.workspaceId,
      scope.agencyId!,
      scope.superAgencyId,
      SearchResultType.TICKET,
      ticket.id,
      ticket.subject,
      ticket.ticketNumber,
      [ticket.ticketNumber, ticket.subject, ticket.priority].join(' '),
      { ticketNumber: ticket.ticketNumber, priority: ticket.priority },
      false,
      ticket.updatedAt,
    );
    return indexed;
  }

  private async indexDoc(id: string, requestedAt?: Date, sourceVersion?: number) {
    const doc = await this.prisma.doc.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!doc)
      return this.deleteAllEntityDocuments(SearchResultType.DOC, id, requestedAt, sourceVersion);
    const scope = workspaceScope(
      doc.workspaceId,
      doc.workspace.agencyId,
      doc.workspace.agency.superAgencyId,
    );
    const archived = doc.status === 'ARCHIVED';
    let indexed = 0;
    await this.upsertDocument({
      scope,
      entityType: SearchResultType.DOC,
      entityId: doc.id,
      title: doc.title,
      subtitle: doc.visibility,
      searchText: [doc.title, extractStructuredText(doc.content)].join(' '),
      route: { href: `/workspace/docs?doc=${doc.id}` },
      metadata: { visibility: doc.visibility, type: doc.type },
      privacyClass:
        doc.visibility === DocVisibility.WORKSPACE
          ? SearchPrivacyClass.WORKSPACE_OPERATIONAL
          : SearchPrivacyClass.ACL_SENSITIVE,
      archived,
      sourceUpdatedAt: doc.updatedAt,
      sourceVersion: doc.contentRevision,
    });
    indexed += 1;
    if (doc.visibility === DocVisibility.WORKSPACE) {
      indexed += await this.upsertParentOperational(
        doc.workspaceId,
        scope.agencyId!,
        scope.superAgencyId,
        SearchResultType.DOC,
        doc.id,
        doc.title,
        doc.visibility,
        [doc.title, extractStructuredText(doc.content)].join(' '),
        { visibility: doc.visibility, type: doc.type },
        archived,
        doc.updatedAt,
        doc.contentRevision,
      );
    } else {
      await this.deleteParentEntityDocuments(
        SearchResultType.DOC,
        doc.id,
        doc.updatedAt,
        doc.contentRevision,
      );
    }
    return indexed;
  }

  private async indexForm(id: string, requestedAt?: Date, sourceVersion?: number) {
    const form = await this.prisma.form.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!form)
      return this.deleteAllEntityDocuments(SearchResultType.FORM, id, requestedAt, sourceVersion);
    const scope = workspaceScope(
      form.workspaceId,
      form.workspace.agencyId,
      form.workspace.agency.superAgencyId,
    );
    const archived = Boolean(form.archivedAt);
    let indexed = 0;
    const text = [form.title, form.description].join(' ');
    await this.upsertDocument({
      scope,
      entityType: SearchResultType.FORM,
      entityId: form.id,
      title: form.title,
      subtitle: form.status,
      searchText: text,
      route: { href: `/workspace/forms?form=${form.id}` },
      metadata: { status: form.status, type: form.type, visibility: form.visibility },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived,
      sourceUpdatedAt: form.updatedAt,
    });
    indexed += 1;
    indexed += await this.upsertParentOperational(
      form.workspaceId,
      scope.agencyId!,
      scope.superAgencyId,
      SearchResultType.FORM,
      form.id,
      form.title,
      form.status,
      text,
      { status: form.status, type: form.type, visibility: form.visibility },
      archived,
      form.updatedAt,
    );
    return indexed;
  }

  private async indexGoal(id: string, requestedAt?: Date, sourceVersion?: number) {
    const goal = await this.prisma.goal.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!goal)
      return this.deleteAllEntityDocuments(SearchResultType.GOAL, id, requestedAt, sourceVersion);
    const scope = workspaceScope(
      goal.workspaceId,
      goal.workspace.agencyId,
      goal.workspace.agency.superAgencyId,
    );
    const archived = goal.status === 'ARCHIVED';
    const text = [goal.title, goal.description, goal.metricType, goal.periodType].join(' ');
    let indexed = 0;
    await this.upsertDocument({
      scope,
      entityType: SearchResultType.GOAL,
      entityId: goal.id,
      title: goal.title,
      subtitle: goal.status,
      searchText: text,
      route: { href: `/workspace/goals?goal=${goal.id}` },
      metadata: { status: goal.status, metricType: goal.metricType, periodType: goal.periodType },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived,
      sourceUpdatedAt: goal.updatedAt,
    });
    indexed += 1;
    indexed += await this.upsertParentOperational(
      goal.workspaceId,
      scope.agencyId!,
      scope.superAgencyId,
      SearchResultType.GOAL,
      goal.id,
      goal.title,
      goal.status,
      text,
      { status: goal.status, metricType: goal.metricType, periodType: goal.periodType },
      archived,
      goal.updatedAt,
    );
    return indexed;
  }

  private async indexAsset(id: string, requestedAt?: Date, sourceVersion?: number) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!asset)
      return this.deleteAllEntityDocuments(SearchResultType.FILE, id, requestedAt, sourceVersion);
    await this.upsertDocument({
      scope: workspaceScope(
        asset.workspaceId,
        asset.workspace.agencyId,
        asset.workspace.agency.superAgencyId,
      ),
      entityType: SearchResultType.FILE,
      entityId: asset.id,
      title: asset.displayName,
      subtitle: asset.mimeType,
      searchText: [asset.displayName, asset.originalFilename, asset.extension, asset.mimeType].join(
        ' ',
      ),
      route: { href: `/workspace/files?file=${asset.id}` },
      metadata: {
        extension: asset.extension,
        mimeType: asset.mimeType,
        lifecycle: asset.lifecycle,
      },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived: asset.lifecycle !== AssetLifecycle.ACTIVE,
      sourceUpdatedAt: asset.updatedAt,
    });
    return 1;
  }

  private async indexMember(id: string, requestedAt?: Date, sourceVersion?: number) {
    const member = await this.prisma.workspaceMembership.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!member)
      return this.deleteAllEntityDocuments(SearchResultType.MEMBER, id, requestedAt, sourceVersion);
    await this.upsertDocument({
      scope: workspaceScope(
        member.workspaceId,
        member.workspace.agencyId,
        member.workspace.agency.superAgencyId,
      ),
      entityType: SearchResultType.MEMBER,
      entityId: member.id,
      title: member.user.name ?? member.user.email,
      subtitle: member.user.email,
      searchText: [member.user.name, member.user.email].join(' '),
      route: { href: `/workspace/users?member=${member.id}` },
      metadata: { status: member.status },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived: member.status !== MembershipStatus.ACTIVE,
      sourceUpdatedAt: member.updatedAt,
    });
    return 1;
  }

  private async indexAutomation(id: string, requestedAt?: Date, sourceVersion?: number) {
    const automation = await this.prisma.automationWorkflow.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!automation)
      return this.deleteAllEntityDocuments(
        SearchResultType.AUTOMATION,
        id,
        requestedAt,
        sourceVersion,
      );
    await this.upsertDocument({
      scope: workspaceScope(
        automation.workspaceId,
        automation.workspace.agencyId,
        automation.workspace.agency.superAgencyId,
      ),
      entityType: SearchResultType.AUTOMATION,
      entityId: automation.id,
      title: automation.name,
      subtitle: automation.status,
      searchText: [automation.name, automation.description, automation.status].join(' '),
      route: { href: `/workspace/automations/${automation.id}` },
      metadata: { status: automation.status },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived: automation.status === AutomationWorkflowStatus.ARCHIVED,
      sourceUpdatedAt: automation.updatedAt,
    });
    return 1;
  }

  private async indexApiKey(id: string, requestedAt?: Date, sourceVersion?: number) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!apiKey)
      return this.deleteAllEntityDocuments(
        SearchResultType.API_KEY,
        id,
        requestedAt,
        sourceVersion,
      );
    await this.upsertDocument({
      scope: workspaceScope(
        apiKey.workspaceId,
        apiKey.workspace.agencyId,
        apiKey.workspace.agency.superAgencyId,
      ),
      entityType: SearchResultType.API_KEY,
      entityId: apiKey.id,
      title: apiKey.name,
      subtitle: apiKey.status,
      searchText: [apiKey.name, apiKey.description, apiKey.publicIdentifier, apiKey.status].join(
        ' ',
      ),
      route: { href: `/workspace/settings/api-keys?key=${apiKey.id}` },
      metadata: { status: apiKey.status, publicIdentifier: apiKey.publicIdentifier },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived: apiKey.status !== 'ACTIVE',
      sourceUpdatedAt: apiKey.updatedAt,
    });
    return 1;
  }

  private async indexWebhook(id: string, requestedAt?: Date, sourceVersion?: number) {
    const webhook = await this.prisma.webhookSubscription.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!webhook)
      return this.deleteAllEntityDocuments(
        SearchResultType.WEBHOOK,
        id,
        requestedAt,
        sourceVersion,
      );
    await this.upsertDocument({
      scope: workspaceScope(
        webhook.workspaceId,
        webhook.workspace.agencyId,
        webhook.workspace.agency.superAgencyId,
      ),
      entityType: SearchResultType.WEBHOOK,
      entityId: webhook.id,
      title: webhook.name,
      subtitle: webhook.status,
      searchText: [
        webhook.name,
        webhook.description,
        webhook.eventTypes.join(' '),
        webhook.status,
      ].join(' '),
      route: { href: `/workspace/settings/webhooks?webhook=${webhook.id}` },
      metadata: { status: webhook.status, eventTypes: webhook.eventTypes },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived: webhook.status !== 'ACTIVE',
      sourceUpdatedAt: webhook.updatedAt,
    });
    return 1;
  }

  private async indexIntegration(id: string, requestedAt?: Date, sourceVersion?: number) {
    const integration = await this.prisma.integrationConnection.findUnique({
      where: { id },
      include: {
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!integration)
      return this.deleteAllEntityDocuments(
        SearchResultType.INTEGRATION,
        id,
        requestedAt,
        sourceVersion,
      );
    await this.upsertDocument({
      scope: workspaceScope(
        integration.workspaceId,
        integration.workspace.agencyId,
        integration.workspace.agency.superAgencyId,
      ),
      entityType: SearchResultType.INTEGRATION,
      entityId: integration.id,
      title: integration.name,
      subtitle: integration.provider,
      searchText: [
        integration.name,
        integration.provider,
        integration.providerAccountLabel,
        integration.status,
      ].join(' '),
      route: { href: `/workspace/settings/integrations?connection=${integration.id}` },
      metadata: { status: integration.status, provider: integration.provider },
      privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
      archived: integration.status === 'DISABLED' || Boolean(integration.revokedAt),
      sourceUpdatedAt: integration.updatedAt,
    });
    return 1;
  }

  private async indexWorkspace(id: string, requestedAt?: Date, sourceVersion?: number) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: { agency: { select: { superAgencyId: true } } },
    });
    if (!workspace)
      return this.deleteAllEntityDocuments(
        SearchResultType.WORKSPACE,
        id,
        requestedAt,
        sourceVersion,
      );
    const agencyScope = {
      type: AnalyticsScopeType.AGENCY,
      id: workspace.agencyId,
      workspaceId: null,
      agencyId: workspace.agencyId,
      superAgencyId: workspace.agency.superAgencyId,
    };
    const superScope = {
      type: AnalyticsScopeType.SUPER_AGENCY,
      id: workspace.agency.superAgencyId,
      workspaceId: null,
      agencyId: null,
      superAgencyId: workspace.agency.superAgencyId,
    };
    const platformScope = {
      type: AnalyticsScopeType.PLATFORM,
      id: PLATFORM_SCOPE_ID,
      workspaceId: null,
      agencyId: null,
      superAgencyId: null,
    };
    await Promise.all(
      [agencyScope, superScope, platformScope].map((scope) =>
        this.upsertDocument({
          scope,
          entityType: SearchResultType.WORKSPACE,
          entityId: workspace.id,
          title: workspace.name,
          subtitle: workspace.status,
          searchText: [workspace.name, workspace.slug, workspace.status].join(' '),
          route: { href: `/agency/dashboard?workspace=${workspace.id}` },
          metadata: { status: workspace.status, agencyId: workspace.agencyId },
          privacyClass:
            scope.type === AnalyticsScopeType.PLATFORM
              ? SearchPrivacyClass.PLATFORM_SAFE_METADATA
              : SearchPrivacyClass.PARENT_SAFE_METADATA,
          archived: workspace.status === 'ARCHIVED',
          sourceUpdatedAt: workspace.updatedAt,
        }),
      ),
    );
    return 3;
  }

  private async indexAgency(id: string, requestedAt?: Date, sourceVersion?: number) {
    const agency = await this.prisma.agency.findUnique({ where: { id } });
    if (!agency)
      return this.deleteAllEntityDocuments(SearchResultType.AGENCY, id, requestedAt, sourceVersion);
    const scopes = [
      {
        type: AnalyticsScopeType.SUPER_AGENCY,
        id: agency.superAgencyId,
        workspaceId: null,
        agencyId: null,
        superAgencyId: agency.superAgencyId,
      },
      {
        type: AnalyticsScopeType.PLATFORM,
        id: PLATFORM_SCOPE_ID,
        workspaceId: null,
        agencyId: null,
        superAgencyId: null,
      },
    ];
    await Promise.all(
      scopes.map((scope) =>
        this.upsertDocument({
          scope,
          entityType: SearchResultType.AGENCY,
          entityId: agency.id,
          title: agency.name,
          subtitle: agency.status,
          searchText: [agency.name, agency.slug, agency.status].join(' '),
          route: { href: `/super-agency/agencies/${agency.id}` },
          metadata: { status: agency.status, superAgencyId: agency.superAgencyId },
          privacyClass:
            scope.type === AnalyticsScopeType.PLATFORM
              ? SearchPrivacyClass.PLATFORM_SAFE_METADATA
              : SearchPrivacyClass.PARENT_SAFE_METADATA,
          archived: agency.status === 'ARCHIVED',
          sourceUpdatedAt: agency.updatedAt,
        }),
      ),
    );
    return 2;
  }

  private async indexSuperAgency(id: string, requestedAt?: Date, sourceVersion?: number) {
    const superAgency = await this.prisma.superAgency.findUnique({ where: { id } });
    if (!superAgency)
      return this.deleteAllEntityDocuments(
        SearchResultType.SUPER_AGENCY,
        id,
        requestedAt,
        sourceVersion,
      );
    await this.upsertDocument({
      scope: {
        type: AnalyticsScopeType.PLATFORM,
        id: PLATFORM_SCOPE_ID,
        workspaceId: null,
        agencyId: null,
        superAgencyId: null,
      },
      entityType: SearchResultType.SUPER_AGENCY,
      entityId: superAgency.id,
      title: superAgency.name,
      subtitle: superAgency.status,
      searchText: [superAgency.name, superAgency.slug, superAgency.status].join(' '),
      route: { href: `/super-admin/dashboard?superAgency=${superAgency.id}` },
      metadata: { status: superAgency.status },
      privacyClass: SearchPrivacyClass.PLATFORM_SAFE_METADATA,
      archived: superAgency.status === 'ARCHIVED',
      sourceUpdatedAt: superAgency.updatedAt,
    });
    return 1;
  }

  private async indexBillingInvoice(id: string, requestedAt?: Date, sourceVersion?: number) {
    const invoice = await this.prisma.billingInvoice.findUnique({ where: { id } });
    if (!invoice)
      return this.deleteAllEntityDocuments(
        SearchResultType.BILLING_METADATA,
        id,
        requestedAt,
        sourceVersion,
      );
    const scopes = [
      {
        type: AnalyticsScopeType.SUPER_AGENCY,
        id: invoice.superAgencyId,
        workspaceId: null,
        agencyId: null,
        superAgencyId: invoice.superAgencyId,
      },
      {
        type: AnalyticsScopeType.PLATFORM,
        id: PLATFORM_SCOPE_ID,
        workspaceId: null,
        agencyId: null,
        superAgencyId: null,
      },
    ];
    await Promise.all(
      scopes.map((scope) =>
        this.upsertDocument({
          scope,
          entityType: SearchResultType.BILLING_METADATA,
          entityId: invoice.id,
          title: invoice.invoiceNumber ?? invoice.providerInvoiceId,
          subtitle: invoice.status,
          searchText: [invoice.invoiceNumber, invoice.status, invoice.provider].join(' '),
          route: { href: `/super-agency/billing?invoice=${invoice.id}` },
          metadata: { status: invoice.status, provider: invoice.provider },
          privacyClass: SearchPrivacyClass.BILLING_SAFE_METADATA,
          sourceUpdatedAt: invoice.updatedAt,
        }),
      ),
    );
    return 2;
  }

  private async upsertParentOperational(
    workspaceId: string,
    agencyId: string,
    superAgencyId: string | null,
    entityType: SearchResultType,
    entityId: string,
    title: string,
    subtitle: string | null,
    searchText: string,
    metadata: Prisma.InputJsonValue,
    archived: boolean,
    sourceUpdatedAt: Date,
    sourceVersion?: number,
  ) {
    let indexed = 0;
    const scopes = [
      { type: AnalyticsScopeType.AGENCY, id: agencyId, workspaceId: null, agencyId, superAgencyId },
      ...(superAgencyId
        ? [
            {
              type: AnalyticsScopeType.SUPER_AGENCY,
              id: superAgencyId,
              workspaceId: null,
              agencyId: null,
              superAgencyId,
            },
          ]
        : []),
    ];
    for (const scope of scopes) {
      await this.upsertDocument({
        scope,
        entityType,
        entityId,
        title,
        subtitle,
        searchText,
        route: {
          href: `/${scope.type === AnalyticsScopeType.AGENCY ? 'agency' : 'super-agency'}/search?workspace=${workspaceId}&entity=${entityId}`,
        },
        metadata,
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived,
        sourceUpdatedAt,
        sourceVersion,
      });
      indexed += 1;
    }
    return indexed;
  }

  private async upsertDocument(input: SearchDocumentInput) {
    const title = cleanSearchText(input.title).slice(0, 240);
    const subtitle = cleanSearchText(input.subtitle ?? '').slice(0, 300) || null;
    const searchText = cleanSearchText(input.searchText).slice(0, 8000);
    const sourceVersion = input.sourceVersion ?? 1;
    const identity = {
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      entityType: input.entityType,
      entityId: input.entityId,
    };
    const data = {
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      workspaceId: input.scope.workspaceId,
      agencyId: input.scope.agencyId,
      superAgencyId: input.scope.superAgencyId,
      entityType: input.entityType,
      entityId: input.entityId,
      title,
      subtitle,
      searchText,
      route: input.route,
      metadata: input.metadata ?? {},
      privacyClass: input.privacyClass,
      archived: input.archived ?? false,
      sourceUpdatedAt: input.sourceUpdatedAt,
      sourceVersion,
    };
    try {
      await this.prisma.searchDocument.create({ data });
      return;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
    await this.prisma.searchDocument.updateMany({
      where: {
        ...identity,
        OR: [
          { sourceVersion: { lt: sourceVersion } },
          { sourceVersion, sourceUpdatedAt: { lte: input.sourceUpdatedAt } },
        ],
      },
      data,
    });
  }

  private async deleteAllEntityDocuments(
    entityType: SearchResultType,
    entityId: string,
    sourceUpdatedAt = new Date(),
    sourceVersion = 1,
  ) {
    await this.prisma.searchDocument.deleteMany({
      where: {
        entityType,
        entityId,
        OR: [
          { sourceVersion: { lt: sourceVersion } },
          { sourceVersion, sourceUpdatedAt: { lte: sourceUpdatedAt } },
        ],
      },
    });
    return 0;
  }

  private async deleteParentEntityDocuments(
    entityType: SearchResultType,
    entityId: string,
    sourceUpdatedAt: Date,
    sourceVersion = 1,
  ) {
    await this.prisma.searchDocument.deleteMany({
      where: {
        entityType,
        entityId,
        scopeType: { in: [AnalyticsScopeType.AGENCY, AnalyticsScopeType.SUPER_AGENCY] },
        OR: [
          { sourceVersion: { lt: sourceVersion } },
          { sourceVersion, sourceUpdatedAt: { lte: sourceUpdatedAt } },
        ],
      },
    });
  }

  private async resolveScope(type: AnalyticsScopeType, id: string): Promise<SearchScope> {
    if (type === AnalyticsScopeType.WORKSPACE) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id },
        select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
      });
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
      return workspaceScope(id, workspace.agencyId, workspace.agency.superAgencyId);
    }
    if (type === AnalyticsScopeType.AGENCY) {
      const agency = await this.prisma.agency.findUnique({
        where: { id },
        select: { superAgencyId: true },
      });
      if (!agency) throw new Error('AGENCY_NOT_FOUND');
      return { type, id, workspaceId: null, agencyId: id, superAgencyId: agency.superAgencyId };
    }
    if (type === AnalyticsScopeType.SUPER_AGENCY) {
      const superAgency = await this.prisma.superAgency.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!superAgency) throw new Error('SUPER_AGENCY_NOT_FOUND');
      return { type, id, workspaceId: null, agencyId: null, superAgencyId: id };
    }
    return {
      type: AnalyticsScopeType.PLATFORM,
      id: PLATFORM_SCOPE_ID,
      workspaceId: null,
      agencyId: null,
      superAgencyId: null,
    };
  }
}

const PLATFORM_SCOPE_ID = '00000000-0000-4000-8000-000000000000';
const parentWorkspaceTypes = [
  SearchResultType.TASK,
  SearchResultType.PROJECT,
  SearchResultType.TICKET,
  SearchResultType.DOC,
  SearchResultType.FORM,
  SearchResultType.GOAL,
];

function workspaceScope(workspaceId: string, agencyId: string, superAgencyId: string): SearchScope {
  return {
    type: AnalyticsScopeType.WORKSPACE,
    id: workspaceId,
    workspaceId,
    agencyId,
    superAgencyId,
  };
}

function cleanSearchText(value: unknown) {
  const raw =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/javascript:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStructuredText(value: Prisma.JsonValue): string {
  const parts: string[] = [];
  visitJson(value, parts);
  return cleanSearchText(parts.join(' ')).slice(0, 6000);
}

function visitJson(value: Prisma.JsonValue, parts: string[]) {
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitJson(item, parts));
    return;
  }
  const record = value as Record<string, Prisma.JsonValue>;
  if (typeof record.text === 'string') parts.push(record.text);
  if (Array.isArray(record.content)) visitJson(record.content, parts);
}

function parsePayloadDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function safePayload(payload: SearchIndexPayload) {
  return {
    operation: payload.operation,
    entityType: payload.entityType,
    entityId: payload.entityId,
    scopeType: payload.scopeType,
    scopeId: payload.scopeId,
    types: payload.types ?? [],
    sourceUpdatedAt: payload.sourceUpdatedAt,
    sourceVersion: payload.sourceVersion,
    correlationId: payload.correlationId,
  };
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 120);
  return 'SEARCH_INDEX_FAILED';
}
