import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AutomationWorkflowVersionState, Prisma } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUTOMATION_DEFINITION_VERSION, defaultAutomationDefinition } from './automation.constants';
import {
  AutomationDefinition,
  toPrismaJson,
  validateAutomationDefinition,
} from './automation-graph.validator';
import {
  AutomationVersionQueryDto,
  AutomationWorkflowQueryDto,
  CreateAutomationWorkflowDto,
  UpdateAutomationDraftDto,
  UpdateAutomationWorkflowDto,
} from './dto/automation.dto';

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: WorkspaceTenantContext, query: AutomationWorkflowQueryDto) {
    const page = query.page;
    const pageSize = query.pageSize;
    const where: Prisma.AutomationWorkflowWhereInput = {
      workspaceId: tenant.workspaceId,
      status: query.status,
      archivedAt: query.includeArchived ? undefined : null,
      ...(query.search
        ? { name: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.automationWorkflow.count({ where }),
      this.prisma.automationWorkflow.findMany({
        where,
        select: workflowSummarySelect,
        orderBy: [{ [query.sortBy]: query.sortDirection }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: items.map(serializeWorkflowSummary), total, page, pageSize };
  }

  async get(tenant: WorkspaceTenantContext, workflowId: string) {
    const workflow = await this.prisma.automationWorkflow.findFirst({
      where: { id: workflowId, workspaceId: tenant.workspaceId, archivedAt: null },
      select: workflowDetailSelect,
    });
    if (!workflow) throw new NotFoundException('Automation workflow not found.');
    return serializeWorkflowDetail(workflow);
  }

  async versions(
    tenant: WorkspaceTenantContext,
    workflowId: string,
    query: AutomationVersionQueryDto,
  ) {
    await this.assertWorkflowExists(tenant.workspaceId, workflowId);
    const page = query.page;
    const pageSize = query.pageSize;
    const where = { workflowId, workspaceId: tenant.workspaceId };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.automationWorkflowVersion.count({ where }),
      this.prisma.automationWorkflowVersion.findMany({
        where,
        select: versionSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: items.map(serializeVersion), total, page, pageSize };
  }

  async version(tenant: WorkspaceTenantContext, workflowId: string, versionId: string) {
    const version = await this.prisma.automationWorkflowVersion.findFirst({
      where: { id: versionId, workflowId, workspaceId: tenant.workspaceId },
      select: versionSelect,
    });
    if (!version) throw new NotFoundException('Automation workflow version not found.');
    return serializeVersion(version);
  }

  async create(tenant: WorkspaceTenantContext, dto: CreateAutomationWorkflowDto) {
    const definition = definitionFromDto(dto, defaultAutomationDefinition);
    const validated = validateAutomationDefinition(definition);
    const workflow = await this.prisma.$transaction(async (tx) => {
      const created = await tx.automationWorkflow.create({
        data: {
          workspaceId: tenant.workspaceId,
          name: normalizeName(dto.name),
          description: normalizeDescription(dto.description),
          createdByMembershipId: this.requireWorkspaceMembership(tenant),
          updatedByMembershipId: this.requireWorkspaceMembership(tenant),
        },
        select: { id: true },
      });
      await tx.automationWorkflowVersion.create({
        data: versionCreateData(
          created.id,
          tenant,
          validated.definition,
          validated.definitionSizeBytes,
        ),
      });
      return tx.automationWorkflow.findUniqueOrThrow({
        where: { id: created.id },
        select: workflowDetailSelect,
      });
    });
    await this.record(tenant, 'automation.workflow_created', workflow.id, {
      name: workflow.name,
      status: workflow.status,
    });
    return serializeWorkflowDetail(workflow);
  }

  async update(
    tenant: WorkspaceTenantContext,
    workflowId: string,
    dto: UpdateAutomationWorkflowDto,
  ) {
    await this.assertWorkflowExists(tenant.workspaceId, workflowId);
    const workflow = await this.prisma.automationWorkflow.update({
      where: { id: workflowId },
      data: {
        name: dto.name === undefined ? undefined : normalizeName(dto.name),
        description:
          dto.description === undefined ? undefined : normalizeDescription(dto.description),
        updatedByMembershipId: this.requireWorkspaceMembership(tenant),
      },
      select: workflowDetailSelect,
    });
    await this.record(tenant, 'automation.workflow_updated', workflowId, {
      changed: Object.keys(dto),
      name: workflow.name,
    });
    return serializeWorkflowDetail(workflow);
  }

  async updateDraft(
    tenant: WorkspaceTenantContext,
    workflowId: string,
    dto: UpdateAutomationDraftDto,
  ) {
    const workflow = await this.findWorkflowForMutation(tenant.workspaceId, workflowId);
    const draft = await this.getOrCreateDraft(tenant, workflow);
    if (
      dto.expectedUpdatedAtMs !== undefined &&
      draft.updatedAt.getTime() !== dto.expectedUpdatedAtMs
    ) {
      throw new ConflictException('Draft was changed by another request. Reload and retry.');
    }
    const base = {
      trigger: draft.triggerDefinition as Record<string, unknown>,
      nodes: draft.nodesDefinition as unknown as AutomationDefinition['nodes'],
      edges: draft.edgesDefinition as unknown as AutomationDefinition['edges'],
      settings: draft.settingsDefinition as Record<string, unknown>,
    };
    const validated = validateAutomationDefinition(definitionFromDto(dto, base));
    const updated = await this.prisma.automationWorkflowVersion.update({
      where: { id: draft.id },
      data: {
        triggerDefinition: toPrismaJson(validated.definition.trigger),
        nodesDefinition: toPrismaJson(validated.definition.nodes),
        edgesDefinition: toPrismaJson(validated.definition.edges),
        settingsDefinition: toPrismaJson(validated.definition.settings),
        definitionSizeBytes: validated.definitionSizeBytes,
      },
      select: versionSelect,
    });
    await this.prisma.automationWorkflow.update({
      where: { id: workflowId },
      data: { updatedByMembershipId: this.requireWorkspaceMembership(tenant) },
    });
    await this.record(tenant, 'automation.draft_updated', workflowId, {
      versionId: updated.id,
    });
    return serializeVersion(updated);
  }

  async publish(tenant: WorkspaceTenantContext, workflowId: string) {
    const result = await this.prisma
      .$transaction(
        async (tx) => {
          const workflow = await tx.automationWorkflow.findFirst({
            where: { id: workflowId, workspaceId: tenant.workspaceId, archivedAt: null },
            select: { id: true },
          });
          if (!workflow) throw new NotFoundException('Automation workflow not found.');
          const draft = await tx.automationWorkflowVersion.findFirst({
            where: { workflowId, workspaceId: tenant.workspaceId, state: 'DRAFT' },
            select: versionSelect,
          });
          if (!draft) throw new BadRequestException('A draft version is required before publish.');
          validateAutomationDefinition({
            trigger: draft.triggerDefinition as Record<string, unknown>,
            nodes: draft.nodesDefinition as unknown as AutomationDefinition['nodes'],
            edges: draft.edgesDefinition as unknown as AutomationDefinition['edges'],
            settings: draft.settingsDefinition as Record<string, unknown>,
          });
          const maxVersion = await tx.automationWorkflowVersion.aggregate({
            where: { workflowId, workspaceId: tenant.workspaceId, state: 'PUBLISHED' },
            _max: { versionNumber: true },
          });
          const versionNumber = (maxVersion._max.versionNumber ?? 0) + 1;
          const updated = await tx.automationWorkflowVersion.updateMany({
            where: { id: draft.id, state: 'DRAFT' },
            data: {
              state: 'PUBLISHED',
              versionNumber,
              publishedAt: new Date(),
            },
          });
          if (updated.count !== 1) {
            throw new ConflictException('Draft was already published. Reload and retry.');
          }
          await tx.automationWorkflow.update({
            where: { id: workflowId },
            data: {
              status: 'PUBLISHED',
              activePublishedVersionId: draft.id,
              updatedByMembershipId: this.requireWorkspaceMembership(tenant),
            },
          });
          return tx.automationWorkflowVersion.findUniqueOrThrow({
            where: { id: draft.id },
            select: versionSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleAutomationWriteError);
    await this.record(tenant, 'automation.workflow_published', workflowId, {
      versionId: result.id,
      versionNumber: result.versionNumber,
    });
    return serializeVersion(result);
  }

  async disable(tenant: WorkspaceTenantContext, workflowId: string) {
    const workflow = await this.findWorkflowForMutation(tenant.workspaceId, workflowId);
    if (!workflow.activePublishedVersionId) {
      throw new BadRequestException('Workflow must have a published version before disabling.');
    }
    const updated = await this.prisma.automationWorkflow.update({
      where: { id: workflowId },
      data: { status: 'DISABLED', updatedByMembershipId: this.requireWorkspaceMembership(tenant) },
      select: workflowDetailSelect,
    });
    await this.record(tenant, 'automation.workflow_disabled', workflowId, {
      activePublishedVersionId: updated.activePublishedVersionId,
    });
    return serializeWorkflowDetail(updated);
  }

  async enable(tenant: WorkspaceTenantContext, workflowId: string) {
    const workflow = await this.findWorkflowForMutation(tenant.workspaceId, workflowId);
    if (!workflow.activePublishedVersionId) {
      throw new BadRequestException('Workflow must have a published version before enabling.');
    }
    const updated = await this.prisma.automationWorkflow.update({
      where: { id: workflowId },
      data: { status: 'PUBLISHED', updatedByMembershipId: this.requireWorkspaceMembership(tenant) },
      select: workflowDetailSelect,
    });
    await this.record(tenant, 'automation.workflow_enabled', workflowId, {
      activePublishedVersionId: updated.activePublishedVersionId,
    });
    return serializeWorkflowDetail(updated);
  }

  async archive(tenant: WorkspaceTenantContext, workflowId: string) {
    await this.findWorkflowForMutation(tenant.workspaceId, workflowId);
    const updated = await this.prisma.automationWorkflow.update({
      where: { id: workflowId },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        updatedByMembershipId: this.requireWorkspaceMembership(tenant),
      },
      select: workflowDetailSelect,
    });
    await this.record(tenant, 'automation.workflow_archived', workflowId, {
      activePublishedVersionId: updated.activePublishedVersionId,
    });
    return serializeWorkflowDetail(updated);
  }

  private async assertWorkflowExists(workspaceId: string, workflowId: string) {
    const workflow = await this.prisma.automationWorkflow.findFirst({
      where: { id: workflowId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!workflow) throw new NotFoundException('Automation workflow not found.');
  }

  private async findWorkflowForMutation(workspaceId: string, workflowId: string) {
    const workflow = await this.prisma.automationWorkflow.findFirst({
      where: { id: workflowId, workspaceId, archivedAt: null },
      select: {
        id: true,
        workspaceId: true,
        activePublishedVersionId: true,
      },
    });
    if (!workflow) throw new NotFoundException('Automation workflow not found.');
    return workflow;
  }

  private async getOrCreateDraft(
    tenant: WorkspaceTenantContext,
    workflow: { id: string; workspaceId: string; activePublishedVersionId: string | null },
  ) {
    const draft = await this.prisma.automationWorkflowVersion.findFirst({
      where: { workflowId: workflow.id, workspaceId: tenant.workspaceId, state: 'DRAFT' },
      select: versionSelect,
    });
    if (draft) return draft;
    if (!workflow.activePublishedVersionId) {
      throw new BadRequestException('Workflow has no draft or published version to edit.');
    }
    const active = await this.prisma.automationWorkflowVersion.findFirstOrThrow({
      where: {
        id: workflow.activePublishedVersionId,
        workflowId: workflow.id,
        workspaceId: tenant.workspaceId,
        state: 'PUBLISHED',
      },
      select: versionSelect,
    });
    return this.prisma.automationWorkflowVersion.create({
      data: {
        workflowId: workflow.id,
        workspaceId: tenant.workspaceId,
        definitionVersion: active.definitionVersion,
        triggerDefinition: toPrismaJson(active.triggerDefinition),
        nodesDefinition: toPrismaJson(active.nodesDefinition),
        edgesDefinition: toPrismaJson(active.edgesDefinition),
        settingsDefinition: toPrismaJson(active.settingsDefinition),
        definitionSizeBytes: active.definitionSizeBytes,
        createdByMembershipId: this.requireWorkspaceMembership(tenant),
      },
      select: versionSelect,
    });
  }

  private requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId) {
      throw new BadRequestException('Workspace membership context is required.');
    }
    return tenant.workspaceMembershipId;
  }

  private record(
    tenant: WorkspaceTenantContext,
    action: string,
    workflowId: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType: 'AutomationWorkflow',
      entityId: workflowId,
      metadata: toPrismaJson(metadata),
    });
  }
}

const versionSelect = {
  id: true,
  workflowId: true,
  workspaceId: true,
  versionNumber: true,
  state: true,
  definitionVersion: true,
  triggerDefinition: true,
  nodesDefinition: true,
  edgesDefinition: true,
  settingsDefinition: true,
  definitionSizeBytes: true,
  createdByMembershipId: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
} satisfies Prisma.AutomationWorkflowVersionSelect;

const workflowSummarySelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  status: true,
  activePublishedVersionId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  activePublishedVersion: {
    select: { id: true, versionNumber: true, publishedAt: true },
  },
  versions: {
    where: { state: AutomationWorkflowVersionState.DRAFT },
    select: { id: true, triggerDefinition: true, updatedAt: true },
    take: 1,
  },
} satisfies Prisma.AutomationWorkflowSelect;

const workflowDetailSelect = {
  ...workflowSummarySelect,
  createdByMembershipId: true,
  updatedByMembershipId: true,
  versions: {
    select: versionSelect,
    orderBy: [{ state: 'asc' }, { createdAt: 'desc' }],
    take: 20,
  },
} satisfies Prisma.AutomationWorkflowSelect;

type WorkflowSummary = Prisma.AutomationWorkflowGetPayload<{
  select: typeof workflowSummarySelect;
}>;
type WorkflowDetail = Prisma.AutomationWorkflowGetPayload<{ select: typeof workflowDetailSelect }>;
type VersionRecord = Prisma.AutomationWorkflowVersionGetPayload<{ select: typeof versionSelect }>;

function serializeWorkflowSummary(workflow: WorkflowSummary) {
  const { versions, ...summary } = workflow;
  const draft = versions[0] ?? null;
  return {
    ...summary,
    currentVersion: workflow.activePublishedVersion?.versionNumber ?? null,
    hasDraft: Boolean(draft),
    draftTriggerType: triggerTypeFromJson(draft?.triggerDefinition ?? null),
    draftUpdatedAt: draft?.updatedAt ?? null,
  };
}

function serializeWorkflowDetail(workflow: WorkflowDetail) {
  return {
    ...workflow,
    currentVersion: workflow.activePublishedVersion?.versionNumber ?? null,
    hasDraft: workflow.versions.some((version) => version.state === 'DRAFT'),
    versions: workflow.versions.map(serializeVersion),
  };
}

function serializeVersion(version: VersionRecord) {
  return version;
}

function triggerTypeFromJson(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const triggerType = value.triggerType;
  return typeof triggerType === 'string' ? triggerType : null;
}

function definitionFromDto(
  dto: Partial<CreateAutomationWorkflowDto & UpdateAutomationDraftDto>,
  fallback: AutomationDefinition,
): AutomationDefinition {
  return {
    trigger: dto.trigger ?? fallback.trigger,
    nodes: (dto.nodes as AutomationDefinition['nodes'] | undefined) ?? fallback.nodes,
    edges: (dto.edges as AutomationDefinition['edges'] | undefined) ?? fallback.edges,
    settings: dto.settings ?? fallback.settings,
  };
}

function versionCreateData(
  workflowId: string,
  tenant: WorkspaceTenantContext,
  definition: AutomationDefinition,
  definitionSizeBytes: number,
): Prisma.AutomationWorkflowVersionCreateInput {
  return {
    workflow: { connect: { id_workspaceId: { id: workflowId, workspaceId: tenant.workspaceId } } },
    workspace: { connect: { id: tenant.workspaceId } },
    definitionVersion: AUTOMATION_DEFINITION_VERSION,
    triggerDefinition: toPrismaJson(definition.trigger),
    nodesDefinition: toPrismaJson(definition.nodes),
    edgesDefinition: toPrismaJson(definition.edges),
    settingsDefinition: toPrismaJson(definition.settings),
    definitionSizeBytes,
    createdByMembership: {
      connect: {
        id_workspaceId: {
          id: tenant.workspaceMembershipId as string,
          workspaceId: tenant.workspaceId,
        },
      },
    },
  };
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeDescription(description: string | null | undefined) {
  return description?.trim() || null;
}

function handleAutomationWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('Automation workflow update conflicted with another request.');
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    throw new ConflictException('Automation workflow update conflicted with another request.');
  }
  throw error;
}
