import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AutomationWorkflowVersionState, Prisma } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AUTOMATION_DEFINITION_VERSION, defaultAutomationDefinition } from './automation.constants';
import { AutomationPolicyService } from './automation-policy.service';
import {
  cloneAutomationDefinitionForAuthoring,
  definitionFromVersionSnapshot,
} from './automation-authoring.utils';
import {
  AutomationDefinition,
  toPrismaJson,
  validateAutomationDefinition,
} from './automation-graph.validator';
import {
  AutomationTemplateQueryDto,
  AutomationVersionQueryDto,
  AutomationWorkflowQueryDto,
  CloneAutomationWorkflowDto,
  CreateAutomationTemplateDto,
  CreateAutomationWorkflowDto,
  UpdateAutomationDraftDto,
  UpdateAutomationWorkflowDto,
  UseAutomationTemplateDto,
} from './dto/automation.dto';

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly policy?: AutomationPolicyService,
    @Optional() private readonly realtime?: RealtimeService,
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
    await this.assertActionLimit(tenant.workspaceId, validated.definition, this.prisma);
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
    await this.publishWorkflowRealtime(tenant, workflow.id);
    return serializeWorkflowDetail(workflow);
  }

  async cloneWorkflow(
    tenant: WorkspaceTenantContext,
    workflowId: string,
    dto: CloneAutomationWorkflowDto,
  ) {
    const source = await this.sourceVersionForAuthoring(
      tenant.workspaceId,
      workflowId,
      dto.sourceVersionId,
    );
    const baseDefinition = validateAutomationDefinition(
      definitionFromVersionSnapshot(source.version),
    );
    const cloned = cloneAutomationDefinitionForAuthoring(baseDefinition.definition);
    const validated = validateAutomationDefinition(cloned.definition);
    await this.assertActionLimit(tenant.workspaceId, validated.definition, this.prisma);
    const name = normalizeName(dto.name ?? `${source.workflow.name} Copy`);
    const workflow = await this.prisma
      .$transaction(
        async (tx) => {
          const created = await tx.automationWorkflow.create({
            data: {
              workspaceId: tenant.workspaceId,
              name,
              description: source.workflow.description,
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
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleAutomationWriteError);
    await this.record(tenant, 'automation.workflow_cloned', workflow.id, {
      sourceWorkflowId: workflowId,
      sourceVersionId: source.version.id,
      nodeCount: validated.definition.nodes.length,
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
    await this.publishWorkflowRealtime(tenant, workflowId, Object.keys(dto));
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
    await this.assertActionLimit(tenant.workspaceId, validated.definition, this.prisma);
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
    await this.publishWorkflowRealtime(tenant, workflowId, ['draft']);
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
          const validated = validateAutomationDefinition({
            trigger: draft.triggerDefinition as Record<string, unknown>,
            nodes: draft.nodesDefinition as unknown as AutomationDefinition['nodes'],
            edges: draft.edgesDefinition as unknown as AutomationDefinition['edges'],
            settings: draft.settingsDefinition as Record<string, unknown>,
          });
          if (this.policy) {
            await this.policy.assertActionCountLimit(
              tenant.workspaceId,
              countActionNodes(validated.definition),
              tx,
            );
            await this.policy.withWorkspaceQuotaLock(tenant.workspaceId, tx, 11_800, async () => {
              await this.policy?.assertPublishedWorkflowLimit(tenant.workspaceId, workflowId, tx);
            });
          }
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
    await this.publishWorkflowRealtime(tenant, workflowId, ['published']);
    return serializeVersion(result);
  }

  private async publishWorkflowRealtime(
    tenant: WorkspaceTenantContext,
    workflowId: string,
    changedFields: string[] = [],
  ) {
    await this.realtime?.publishWorkspace({
      eventType: 'AUTOMATION_WORKFLOW_UPDATED',
      workspaceId: tenant.workspaceId,
      entityType: 'AUTOMATION_WORKFLOW',
      entityId: workflowId,
      actorMembershipId: tenant.workspaceMembershipId,
      payload: { workflowId, changedFields },
    });
  }

  async createDraftFromVersion(
    tenant: WorkspaceTenantContext,
    workflowId: string,
    versionId: string,
  ) {
    const result = await this.prisma
      .$transaction(
        async (tx) => {
          const workflow = await tx.automationWorkflow.findFirst({
            where: { id: workflowId, workspaceId: tenant.workspaceId, archivedAt: null },
            select: { id: true },
          });
          if (!workflow) throw new NotFoundException('Automation workflow not found.');
          const existingDraft = await tx.automationWorkflowVersion.findFirst({
            where: { workflowId, workspaceId: tenant.workspaceId, state: 'DRAFT' },
            select: { id: true },
          });
          if (existingDraft) {
            throw new ConflictException('Archive or publish the current draft before restoring.');
          }
          const source = await tx.automationWorkflowVersion.findFirst({
            where: {
              id: versionId,
              workflowId,
              workspaceId: tenant.workspaceId,
              state: 'PUBLISHED',
            },
            select: versionSelect,
          });
          if (!source) throw new NotFoundException('Published automation version not found.');
          const validated = validateAutomationDefinition(definitionFromVersionSnapshot(source));
          await this.assertActionLimit(tenant.workspaceId, validated.definition, tx);
          const draft = await tx.automationWorkflowVersion.create({
            data: versionCreateData(
              workflowId,
              tenant,
              validated.definition,
              validated.definitionSizeBytes,
            ),
            select: versionSelect,
          });
          await tx.automationWorkflow.update({
            where: { id: workflowId },
            data: { updatedByMembershipId: this.requireWorkspaceMembership(tenant) },
          });
          return draft;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleAutomationWriteError);
    await this.record(tenant, 'automation.draft_created_from_version', workflowId, {
      sourceVersionId: versionId,
      draftVersionId: result.id,
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

  async listTemplates(tenant: WorkspaceTenantContext, query: AutomationTemplateQueryDto) {
    const page = query.page;
    const pageSize = query.pageSize;
    const where: Prisma.AutomationWorkflowTemplateWhereInput = {
      workspaceId: tenant.workspaceId,
      archivedAt: query.includeArchived ? undefined : null,
      ...(query.search
        ? { name: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.automationWorkflowTemplate.count({ where }),
      this.prisma.automationWorkflowTemplate.findMany({
        where,
        select: templateSummarySelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: items.map(serializeTemplateSummary), total, page, pageSize };
  }

  async getTemplate(tenant: WorkspaceTenantContext, templateId: string) {
    const template = await this.prisma.automationWorkflowTemplate.findFirst({
      where: { id: templateId, workspaceId: tenant.workspaceId, archivedAt: null },
      select: templateDetailSelect,
    });
    if (!template) throw new NotFoundException('Automation workflow template not found.');
    return serializeTemplateDetail(template);
  }

  async createTemplate(tenant: WorkspaceTenantContext, dto: CreateAutomationTemplateDto) {
    const source = await this.sourceVersionForAuthoring(
      tenant.workspaceId,
      dto.sourceWorkflowId,
      dto.sourceWorkflowVersionId,
    );
    const validated = validateAutomationDefinition(definitionFromVersionSnapshot(source.version));
    await this.assertActionLimit(tenant.workspaceId, validated.definition, this.prisma);
    const template = await this.prisma.automationWorkflowTemplate.create({
      data: {
        workspaceId: tenant.workspaceId,
        name: normalizeName(dto.name),
        description: normalizeDescription(dto.description),
        definitionVersion: source.version.definitionVersion,
        triggerDefinition: toPrismaJson(validated.definition.trigger),
        nodesDefinition: toPrismaJson(validated.definition.nodes),
        edgesDefinition: toPrismaJson(validated.definition.edges),
        settingsDefinition: toPrismaJson(validated.definition.settings),
        definitionSizeBytes: validated.definitionSizeBytes,
        sourceWorkflowId: source.workflow.id,
        sourceWorkflowVersionId: source.version.id,
        createdByMembershipId: this.requireWorkspaceMembership(tenant),
      },
      select: templateDetailSelect,
    });
    await this.recordTemplate(tenant, 'automation.template_created', template.id, {
      sourceWorkflowId: source.workflow.id,
      sourceVersionId: source.version.id,
      nodeCount: validated.definition.nodes.length,
    });
    return serializeTemplateDetail(template);
  }

  async useTemplate(
    tenant: WorkspaceTenantContext,
    templateId: string,
    dto: UseAutomationTemplateDto,
  ) {
    const template = await this.prisma.automationWorkflowTemplate.findFirst({
      where: { id: templateId, workspaceId: tenant.workspaceId, archivedAt: null },
      select: templateDetailSelect,
    });
    if (!template) throw new NotFoundException('Automation workflow template not found.');
    const baseDefinition = validateAutomationDefinition(templateDefinition(template));
    const cloned = cloneAutomationDefinitionForAuthoring(baseDefinition.definition);
    const validated = validateAutomationDefinition(cloned.definition);
    await this.assertActionLimit(tenant.workspaceId, validated.definition, this.prisma);
    const name = normalizeName(dto.name ?? template.name);
    const workflow = await this.prisma
      .$transaction(
        async (tx) => {
          const created = await tx.automationWorkflow.create({
            data: {
              workspaceId: tenant.workspaceId,
              name,
              description:
                dto.description === undefined
                  ? template.description
                  : normalizeDescription(dto.description),
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
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleAutomationWriteError);
    await this.recordTemplate(tenant, 'automation.template_used', template.id, {
      workflowId: workflow.id,
      nodeCount: validated.definition.nodes.length,
    });
    return serializeWorkflowDetail(workflow);
  }

  async archiveTemplate(tenant: WorkspaceTenantContext, templateId: string) {
    const template = await this.prisma.automationWorkflowTemplate.findFirst({
      where: { id: templateId, workspaceId: tenant.workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!template) throw new NotFoundException('Automation workflow template not found.');
    const updated = await this.prisma.automationWorkflowTemplate.update({
      where: { id: templateId },
      data: { archivedAt: new Date() },
      select: templateDetailSelect,
    });
    await this.recordTemplate(tenant, 'automation.template_archived', templateId);
    return serializeTemplateDetail(updated);
  }

  private async assertWorkflowExists(workspaceId: string, workflowId: string) {
    const workflow = await this.prisma.automationWorkflow.findFirst({
      where: { id: workflowId, workspaceId, archivedAt: null },
      select: { id: true },
    });
    if (!workflow) throw new NotFoundException('Automation workflow not found.');
  }

  private async sourceVersionForAuthoring(
    workspaceId: string,
    workflowId: string,
    sourceVersionId?: string,
  ) {
    const workflow = await this.prisma.automationWorkflow.findFirst({
      where: { id: workflowId, workspaceId, archivedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        activePublishedVersionId: true,
      },
    });
    if (!workflow) throw new NotFoundException('Automation workflow not found.');
    const version = sourceVersionId
      ? await this.prisma.automationWorkflowVersion.findFirst({
          where: { id: sourceVersionId, workflowId, workspaceId },
          select: versionSelect,
        })
      : await this.prisma.automationWorkflowVersion.findFirst({
          where: { workflowId, workspaceId, state: 'DRAFT' },
          select: versionSelect,
        });
    if (sourceVersionId && !version) {
      throw new NotFoundException('Automation workflow version not found.');
    }
    if (version) return { workflow, version };
    if (!workflow.activePublishedVersionId) {
      throw new BadRequestException('Workflow has no draft or published version to use.');
    }
    const active = await this.prisma.automationWorkflowVersion.findFirst({
      where: {
        id: workflow.activePublishedVersionId,
        workflowId,
        workspaceId,
        state: 'PUBLISHED',
      },
      select: versionSelect,
    });
    if (!active) throw new NotFoundException('Automation workflow version not found.');
    return { workflow, version: active };
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

  private async assertActionLimit(
    workspaceId: string,
    definition: AutomationDefinition,
    client: Prisma.TransactionClient | PrismaService,
  ) {
    if (!this.policy) return;
    await this.policy.assertActionCountLimit(workspaceId, countActionNodes(definition), client);
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

  private recordTemplate(
    tenant: WorkspaceTenantContext,
    action: string,
    templateId: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType: 'AutomationWorkflowTemplate',
      entityId: templateId,
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

const templateSummarySelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  definitionVersion: true,
  definitionSizeBytes: true,
  sourceWorkflowId: true,
  sourceWorkflowVersionId: true,
  createdByMembershipId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AutomationWorkflowTemplateSelect;

const templateDetailSelect = {
  ...templateSummarySelect,
  triggerDefinition: true,
  nodesDefinition: true,
  edgesDefinition: true,
  settingsDefinition: true,
  sourceWorkflow: {
    select: { id: true, name: true, status: true },
  },
  sourceWorkflowVersion: {
    select: { id: true, versionNumber: true, state: true, publishedAt: true },
  },
} satisfies Prisma.AutomationWorkflowTemplateSelect;

type WorkflowSummary = Prisma.AutomationWorkflowGetPayload<{
  select: typeof workflowSummarySelect;
}>;
type WorkflowDetail = Prisma.AutomationWorkflowGetPayload<{ select: typeof workflowDetailSelect }>;
type VersionRecord = Prisma.AutomationWorkflowVersionGetPayload<{ select: typeof versionSelect }>;
type TemplateSummary = Prisma.AutomationWorkflowTemplateGetPayload<{
  select: typeof templateSummarySelect;
}>;
type TemplateDetail = Prisma.AutomationWorkflowTemplateGetPayload<{
  select: typeof templateDetailSelect;
}>;

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

function serializeTemplateSummary(template: TemplateSummary) {
  return template;
}

function serializeTemplateDetail(template: TemplateDetail) {
  return template;
}

function templateDefinition(template: TemplateDetail): AutomationDefinition {
  return {
    trigger: template.triggerDefinition as Record<string, unknown>,
    nodes: template.nodesDefinition as unknown as AutomationDefinition['nodes'],
    edges: template.edgesDefinition as unknown as AutomationDefinition['edges'],
    settings: template.settingsDefinition as Record<string, unknown>,
  };
}

function countActionNodes(definition: AutomationDefinition) {
  return definition.nodes.filter((node) => node.type === 'ACTION').length;
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
