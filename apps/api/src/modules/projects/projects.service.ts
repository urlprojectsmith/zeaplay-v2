import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AssetStatus,
  AttachmentType,
  DepartmentStatus,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  MembershipStatus,
  Prisma,
  ProcessingJobStatus,
  ProjectStatus,
  ProjectVisibility,
  StatusEntityType,
  TaskPriority,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { safeWorkspaceTimezone } from '../../common/timezones';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import {
  ASSET_PROCESSING_JOB_TYPE,
  ASSET_PROCESSING_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { AuditService } from '../audit/audit.service';
import { UploadCompleteDto } from '../assets/dto/upload-complete.dto';
import { UploadInitDto } from '../assets/dto/upload-init.dto';
import { GamificationService } from '../gamification/gamification.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import {
  CreateProjectUrlAttachmentDto,
  ProjectActivityQueryDto,
  ProjectAttachmentIdsDto,
  ProjectMemberQueryDto,
  ProjectMembersDto,
  ProjectReportQueryDto,
  ProjectTaskIdsDto,
  ProjectTagIdsDto,
  UpdateProjectDto,
  UpdateProjectProgressDto,
} from './dto/update-project.dto';

const PROJECT_ATTACHMENT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ASSET_JOB_VERSION = 1;
const PROJECT_REPORT_EXPORT_MAX_ROWS = 10_000;
const missingGamificationService = {
  evaluateProjectCompletionAchievements: () => Promise.resolve(undefined),
  handleProjectCreationXp: () => Promise.resolve(undefined),
  handleProjectCompletionXp: () => Promise.resolve(undefined),
  handleWorkCreationVoid: () => Promise.resolve(undefined),
  handleWorkReopen: () => Promise.resolve(undefined),
} as Pick<
  GamificationService,
  | 'evaluateProjectCompletionAchievements'
  | 'handleProjectCreationXp'
  | 'handleProjectCompletionXp'
  | 'handleWorkCreationVoid'
  | 'handleWorkReopen'
> as GamificationService;

@Injectable()
export class ProjectsService {
  private readonly env = validateEnvironment(process.env);
  private readonly allowedMimeTypes = new Set(
    this.env.ALLOWED_MIME_TYPES.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectQueue(ASSET_PROCESSING_QUEUE) private readonly queue: Queue,
    @Optional() private readonly gamification: GamificationService = missingGamificationService,
  ) {}

  async create(tenant: WorkspaceTenantContext, dto: CreateProjectDto) {
    const name = normalizeName(dto.name);
    const description = normalizeDescription(dto.description);
    const { plannedStartAt, dueAt } = normalizeProjectDates(dto);
    const status = await this.projectStatus(tenant.workspaceId, dto.statusDefinitionId);
    const department = await this.projectDepartment(tenant.workspaceId, dto.departmentId);
    const ownerMembershipId = dto.ownerMembershipId ?? tenant.workspaceMembershipId;
    if (!ownerMembershipId) throw new BadRequestException('INVALID_PROJECT_OWNER');
    const owner = await this.activeMembership(tenant.workspaceId, ownerMembershipId);
    const memberIds = uniqueIds(dto.memberMembershipIds ?? []).filter((id) => id !== owner.id);
    await this.activeMemberships(tenant.workspaceId, memberIds);

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId: tenant.workspaceId,
          createdById: tenant.userId,
          name,
          description,
          statusDefinitionId: status.id,
          priority: dto.priority ?? TaskPriority.MEDIUM,
          xpCategory: dto.xpCategory ?? null,
          visibility: dto.visibility ?? ProjectVisibility.WORKSPACE,
          plannedStartAt,
          dueAt,
          departmentId: department?.id ?? null,
          ownerMembershipId: owner.id,
          status: ProjectStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (memberIds.length > 0) {
        await tx.projectMember.createMany({
          data: memberIds.map((membershipId) => ({
            workspaceId: tenant.workspaceId,
            projectId: created.id,
            workspaceMembershipId: membershipId,
            addedByMembershipId: tenant.workspaceMembershipId,
          })),
          skipDuplicates: true,
        });
      }
      return tx.project.findUniqueOrThrow({
        where: { id_workspaceId: { id: created.id, workspaceId: tenant.workspaceId } },
        select: projectDetailSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.created',
      entityType: 'Project',
      entityId: project.id,
      metadata: {
        statusDefinitionId: status.id,
        ownerMembershipId: owner.id,
        visibility: project.visibility,
        xpCategory: project.xpCategory,
        memberCount: memberIds.length,
      },
    });
    await this.gamification.handleProjectCreationXp(
      tenant.workspaceId,
      project.id,
      tenant.workspaceMembershipId ?? null,
    );
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async list(tenant: WorkspaceTenantContext, query: ProjectQueryDto) {
    const where = this.projectWhere(tenant, query);
    const orderBy = projectOrderBy(query.sortBy, query.sortDirection);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        select: projectListSelect,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);
    const progress = await this.progressSummaryForProjects(tenant.workspaceId, items);
    return {
      items: items.map((project) => serializeProject(project, progress)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(tenant: WorkspaceTenantContext, id: string) {
    const project = await this.readAccessibleProject(tenant, id, projectDetailSelect);
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async update(tenant: WorkspaceTenantContext, id: string, dto: UpdateProjectDto) {
    const existing = await this.readAccessibleProject(tenant, id, {
      id: true,
      statusDefinitionId: true,
      statusDefinition: { select: { isTerminal: true } },
      name: true,
      description: true,
      priority: true,
      xpCategory: true,
      visibility: true,
      plannedStartAt: true,
      dueAt: true,
      departmentId: true,
    } satisfies Prisma.ProjectSelect);

    const nextDates = normalizeProjectDates({
      plannedStartAt:
        dto.plannedStartAt === undefined ? existing.plannedStartAt : dto.plannedStartAt,
      dueAt: dto.dueAt === undefined ? existing.dueAt : dto.dueAt,
    });
    const status = dto.statusDefinitionId
      ? await this.projectStatus(tenant.workspaceId, dto.statusDefinitionId)
      : null;
    const reopensProject =
      Boolean(status) &&
      status!.id !== existing.statusDefinitionId &&
      existing.statusDefinition?.isTerminal === true &&
      !status!.isTerminal;
    const reopensAwardedCompletion =
      reopensProject &&
      (await this.hasActiveCompletionXpAward(
        tenant.workspaceId,
        GamificationPointWorkType.PROJECT,
        id,
      ));
    if (reopensAwardedCompletion) {
      requireFutureReopenTarget(nextDates.dueAt, 'PROJECT_REOPEN_REQUIRES_NEW_FUTURE_DUE_AT');
    }
    const department =
      dto.departmentId !== undefined
        ? await this.projectDepartment(tenant.workspaceId, dto.departmentId)
        : undefined;
    const data: Prisma.ProjectUpdateInput = {
      ...(dto.name !== undefined ? { name: normalizeName(dto.name) } : {}),
      ...(dto.description !== undefined
        ? { description: normalizeDescription(dto.description) }
        : {}),
      ...(dto.priority ? { priority: dto.priority } : {}),
      ...(dto.xpCategory !== undefined ? { xpCategory: dto.xpCategory } : {}),
      ...(dto.visibility ? { visibility: dto.visibility } : {}),
      plannedStartAt: nextDates.plannedStartAt,
      dueAt: nextDates.dueAt,
      ...(status
        ? {
            statusDefinition: {
              connect: { id_workspaceId: { id: status.id, workspaceId: tenant.workspaceId } },
            },
          }
        : {}),
      ...(department !== undefined
        ? department
          ? {
              department: {
                connect: { id_workspaceId: { id: department.id, workspaceId: tenant.workspaceId } },
              },
            }
          : { department: { disconnect: true } }
        : {}),
    };
    const changed = changedProjectFields(existing, dto, nextDates);
    if (status && status.id !== existing.statusDefinitionId) changed.push('statusDefinitionId');
    if (department !== undefined && (department?.id ?? null) !== existing.departmentId)
      changed.push('departmentId');
    if (dto.visibility && dto.visibility !== existing.visibility) changed.push('visibility');
    if (changed.length === 0) return this.get(tenant, id);

    const project = await this.prisma.project.update({
      where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
      data,
      select: projectDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        dto.visibility && dto.visibility !== existing.visibility
          ? 'project.visibility_changed'
          : 'project.updated',
      entityType: 'Project',
      entityId: id,
      metadata:
        dto.visibility && dto.visibility !== existing.visibility
          ? { fromVisibility: existing.visibility, toVisibility: dto.visibility }
          : { changed },
    });
    if (status?.isTerminal && status.id !== existing.statusDefinitionId) {
      await this.gamification.evaluateProjectCompletionAchievements(tenant.workspaceId, id);
      await this.gamification.handleProjectCompletionXp(
        tenant.workspaceId,
        id,
        tenant.workspaceMembershipId ?? null,
      );
    } else if (reopensAwardedCompletion) {
      await this.gamification.handleWorkReopen(
        tenant.workspaceId,
        GamificationPointWorkType.PROJECT,
        id,
        tenant.workspaceMembershipId ?? null,
      );
    }
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async updateStatus(
    tenant: WorkspaceTenantContext,
    id: string,
    statusDefinitionId: string,
    reopenDueAtInput?: string | Date | null,
  ) {
    const existing = await this.readAccessibleProject(tenant, id, {
      id: true,
      statusDefinitionId: true,
      statusDefinition: { select: { isTerminal: true } },
    } satisfies Prisma.ProjectSelect);
    const status = await this.projectStatus(tenant.workspaceId, statusDefinitionId);
    if (existing.statusDefinitionId === status.id) return this.get(tenant, id);
    const reopensProject = existing.statusDefinition?.isTerminal === true && !status.isTerminal;
    const reopensAwardedCompletion =
      reopensProject &&
      (await this.hasActiveCompletionXpAward(
        tenant.workspaceId,
        GamificationPointWorkType.PROJECT,
        id,
      ));
    const reopenDueAt = reopensAwardedCompletion
      ? requireFutureReopenTarget(
          parseOptionalDate(reopenDueAtInput),
          'PROJECT_REOPEN_REQUIRES_NEW_FUTURE_DUE_AT',
        )
      : null;
    const project = await this.prisma.$transaction(async (tx) => {
      if (status.isTerminal) {
        const openTaskCount = await this.openLinkedTaskCount(tenant.workspaceId, id, tx);
        if (openTaskCount > 0) {
          throw new BadRequestException({
            code: 'PROJECT_HAS_OPEN_TASKS',
            message: 'Project has open tasks.',
            details: { openTaskCount },
          });
        }
      }
      return tx.project.update({
        where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
        data: {
          statusDefinitionId: status.id,
          ...(reopensAwardedCompletion ? { dueAt: reopenDueAt } : {}),
        },
        select: projectDetailSelect,
      });
    }, serializableTransaction);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.status_changed',
      entityType: 'Project',
      entityId: id,
      metadata: {
        fromStatusId: existing.statusDefinitionId,
        toStatusId: status.id,
      },
    });
    if (status.isTerminal) {
      await this.gamification.evaluateProjectCompletionAchievements(tenant.workspaceId, id);
      await this.gamification.handleProjectCompletionXp(
        tenant.workspaceId,
        id,
        tenant.workspaceMembershipId ?? null,
      );
    } else if (reopensAwardedCompletion) {
      await this.gamification.handleWorkReopen(
        tenant.workspaceId,
        GamificationPointWorkType.PROJECT,
        id,
        tenant.workspaceMembershipId ?? null,
      );
    }
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async archive(tenant: WorkspaceTenantContext, id: string) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const update = await this.prisma.project.updateMany({
      where: { id, workspaceId: tenant.workspaceId, archivedAt: null },
      data: { status: ProjectStatus.ARCHIVED, archivedAt: new Date() },
    });
    if (update.count !== 1) throw new NotFoundException('Project not found.');
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.deleted',
      entityType: 'Project',
      entityId: id,
    });
    await this.gamification.handleWorkCreationVoid(
      tenant.workspaceId,
      GamificationPointWorkType.PROJECT,
      id,
      tenant.workspaceMembershipId ?? null,
    );
    return { id, deleted: true };
  }

  async listMembers(tenant: WorkspaceTenantContext, id: string, query: ProjectMemberQueryDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const search = query.search?.trim();
    const where: Prisma.ProjectMemberWhereInput = {
      workspaceId: tenant.workspaceId,
      projectId: id,
      ...(search
        ? {
            workspaceMembership: {
              user: {
                OR: [
                  { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
                  { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.projectMember.findMany({
        where,
        select: projectMemberSelect,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.projectMember.count({ where }),
    ]);
    return {
      items: items.map(serializeProjectMember),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async addMembers(tenant: WorkspaceTenantContext, id: string, dto: ProjectMembersDto) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      ownerMembershipId: true,
    } satisfies Prisma.ProjectSelect);
    const membershipIds = uniqueIds(dto.membershipIds).filter(
      (item) => item !== project.ownerMembershipId,
    );
    await this.activeMemberships(tenant.workspaceId, membershipIds);
    const existing = await this.prisma.projectMember.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        projectId: id,
        workspaceMembershipId: { in: membershipIds },
      },
      select: { workspaceMembershipId: true },
    });
    const existingIds = new Set(existing.map((item) => item.workspaceMembershipId));
    const newIds = membershipIds.filter((item) => !existingIds.has(item));
    if (newIds.length === 0) return this.listMembers(tenant, id, new ProjectMemberQueryDto());
    const created = await this.prisma.projectMember.createMany({
      data: newIds.map((membershipId) => ({
        workspaceId: tenant.workspaceId,
        projectId: id,
        workspaceMembershipId: membershipId,
        addedByMembershipId: tenant.workspaceMembershipId,
      })),
      skipDuplicates: true,
    });
    if (created.count === 0) return this.listMembers(tenant, id, new ProjectMemberQueryDto());
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.member_added',
      entityType: 'Project',
      entityId: id,
      metadata: { requestedCount: membershipIds.length, addedCount: created.count },
    });
    return this.listMembers(tenant, id, new ProjectMemberQueryDto());
  }

  async removeMember(tenant: WorkspaceTenantContext, id: string, membershipId: string) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      ownerMembershipId: true,
    } satisfies Prisma.ProjectSelect);
    if (membershipId === project.ownerMembershipId)
      throw new BadRequestException('PROJECT_OWNER_NOT_REMOVABLE');
    const deleted = await this.prisma.projectMember.deleteMany({
      where: {
        workspaceId: tenant.workspaceId,
        projectId: id,
        workspaceMembershipId: membershipId,
      },
    });
    if (deleted.count === 0) return { id, membershipId, removed: false };
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.member_removed',
      entityType: 'Project',
      entityId: id,
      metadata: { membershipId },
    });
    return { id, membershipId, removed: true };
  }

  async updateOwner(tenant: WorkspaceTenantContext, id: string, workspaceMembershipId: string) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      ownerMembershipId: true,
    } satisfies Prisma.ProjectSelect);
    const owner = await this.activeMembership(tenant.workspaceId, workspaceMembershipId);
    if (owner.id === project.ownerMembershipId) return this.get(tenant, id);
    const updated = await this.prisma.project.update({
      where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
      data: { ownerMembershipId: owner.id },
      select: projectDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.owner_changed',
      entityType: 'Project',
      entityId: id,
      metadata: { fromMembershipId: project.ownerMembershipId, toMembershipId: owner.id },
    });
    return serializeProject(
      updated,
      await this.progressSummaryForProjects(tenant.workspaceId, [updated]),
    );
  }

  async listAttachments(tenant: WorkspaceTenantContext, id: string, query: ProjectMemberQueryDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const search = query.search?.trim();
    const where: Prisma.ProjectAttachmentWhereInput = {
      workspaceId: tenant.workspaceId,
      projectId: id,
      removedAt: null,
      attachment: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { displayName: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { url: { contains: search, mode: Prisma.QueryMode.insensitive } },
                {
                  asset: {
                    displayName: { contains: search, mode: Prisma.QueryMode.insensitive },
                  },
                },
                {
                  asset: {
                    originalFilename: { contains: search, mode: Prisma.QueryMode.insensitive },
                  },
                },
              ],
            }
          : {}),
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.projectAttachment.findMany({
        where,
        select: projectAttachmentSelect,
        orderBy: [{ createdAt: 'desc' }, { attachmentId: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.projectAttachment.count({ where }),
    ]);
    return {
      items: items.map(serializeProjectAttachment),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async initAttachmentUpload(
    tenant: WorkspaceTenantContext,
    id: string,
    dto: UploadInitDto,
    correlationId: string,
  ) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const filename = sanitizeFilename(dto.filename);
    const displayName = sanitizeFilename(dto.displayName ?? filename);
    const mimeType = sanitizeMimeType(dto.mimeType);
    if (!this.allowedMimeTypes.has(mimeType)) {
      throw new UnprocessableEntityException('File type is not allowed.');
    }
    if (dto.sizeBytes > PROJECT_ATTACHMENT_MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('File is too large.');
    }

    const assetId = randomUUID();
    const extension = extractExtension(filename);
    const storageKey = buildProjectAssetStorageKey(tenant.workspaceId, id, assetId, extension);
    const uploadExpiresAt = new Date(Date.now() + this.env.UPLOAD_URL_TTL_SECONDS * 1000);
    const sizeBytes = BigInt(dto.sizeBytes);
    const created = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: tenant.workspaceId },
        select: { storageUsedBytes: true, storageLimitBytes: true },
      });
      if (workspace.storageUsedBytes + sizeBytes > workspace.storageLimitBytes) {
        throw new PayloadTooLargeException('Workspace storage limit would be exceeded.');
      }
      await tx.workspace.update({
        where: { id: tenant.workspaceId },
        data: { storageUsedBytes: { increment: sizeBytes } },
      });
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          projectId: id,
          createdById: tenant.userId,
          originalFilename: filename,
          displayName,
          storageBucket: this.env.MINIO_BUCKET,
          storageKey,
          mimeType,
          extension,
          sizeBytes,
          status: AssetStatus.UPLOADING,
          uploadExpiresAt,
          metadata: { correlationId, projectId: id },
        },
        select: attachmentAssetSelect,
      });
      const attachment = await tx.attachment.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          type: AttachmentType.FILE,
          assetId: asset.id,
          displayName,
          createdById: tenant.userId,
        },
        select: attachmentCoreSelect,
      });
      return { attachment, asset };
    });

    const uploadUrl = await this.storage.createPresignedUploadUrl(
      storageKey,
      this.env.UPLOAD_URL_TTL_SECONDS,
    );
    return {
      attachment: serializePendingProjectFile(created.attachment, created.asset),
      uploadUrl,
      expiresAt: uploadExpiresAt,
    };
  }

  async completeAttachmentUpload(
    tenant: WorkspaceTenantContext,
    id: string,
    attachmentId: string,
    dto: UploadCompleteDto,
    correlationId: string,
  ) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const attachment = await this.findFileAttachment(tenant.workspaceId, attachmentId);
    const asset = attachment.asset;
    if (!asset) throw new NotFoundException('Attachment not found.');
    if (asset.status === AssetStatus.DELETED) throw new NotFoundException('Attachment not found.');
    const metadata = isRecord(asset.metadata) ? asset.metadata : {};
    if (metadata.projectId !== id || asset.projectId !== id) {
      throw new NotFoundException('Attachment not found.');
    }
    if (asset.status === AssetStatus.UPLOADING) {
      if (!asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date()) {
        throw new GoneException('Upload authorization has expired.');
      }
      const object = await this.storage.getMetadata(asset.storageKey).catch(() => {
        throw new ServiceUnavailableException('Uploaded object is not available for verification.');
      });
      if (object.key !== asset.storageKey) {
        throw new BadRequestException('Uploaded object key mismatch.');
      }
      if (object.size !== dto.sizeBytes || BigInt(object.size) !== asset.sizeBytes) {
        throw new BadRequestException('Uploaded object size does not match the authorized size.');
      }
      await this.prisma.asset.update({
        where: { id_workspaceId: { id: asset.id, workspaceId: tenant.workspaceId } },
        data: {
          status: AssetStatus.PROCESSING,
          metadata: {
            ...withoutUndefined({
              ...(isRecord(asset.metadata) ? asset.metadata : {}),
              etag: object.etag,
              uploadedContentType: object.contentType,
            }),
          },
        },
      });
    } else if (asset.status !== AssetStatus.PROCESSING && asset.status !== AssetStatus.READY) {
      throw new ConflictException('Attachment file is not awaiting upload completion.');
    }

    const link = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.$queryRaw<Array<{ attachment_id: string }>>(Prisma.sql`
        INSERT INTO "project_attachments" ("workspace_id", "project_id", "attachment_id", "attached_by_id")
        VALUES (${tenant.workspaceId}::uuid, ${id}::uuid, ${attachmentId}::uuid, ${tenant.userId}::uuid)
        ON CONFLICT ("project_id", "attachment_id") DO UPDATE
        SET "removed_at" = NULL,
            "attached_by_id" = EXCLUDED."attached_by_id"
        WHERE "project_attachments"."removed_at" IS NOT NULL
        RETURNING "attachment_id"
      `);
      return tx.projectAttachment
        .findUniqueOrThrow({
          where: { projectId_attachmentId: { projectId: id, attachmentId } },
          select: projectAttachmentSelect,
        })
        .then((projectAttachment) => ({ projectAttachment, changedCount: changed.length }));
    });
    await this.ensureProcessingJob(asset, correlationId);
    if (link.changedCount > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.attachment_file_uploaded',
        entityType: 'Project',
        entityId: id,
        metadata: { attachmentId, assetId: asset.id, sizeBytes: Number(asset.sizeBytes) },
      });
    }
    return serializeProjectAttachment(link.projectAttachment);
  }

  async addUrlAttachment(
    tenant: WorkspaceTenantContext,
    id: string,
    dto: CreateProjectUrlAttachmentDto,
  ) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const url = normalizeAttachmentUrl(dto.url);
    const displayName = normalizeAttachmentDisplayName(dto.displayName) ?? url;
    const link = await this.prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          workspaceId: tenant.workspaceId,
          type: AttachmentType.URL,
          url,
          displayName,
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      await tx.projectAttachment.create({
        data: {
          workspaceId: tenant.workspaceId,
          projectId: id,
          attachmentId: attachment.id,
          attachedById: tenant.userId,
        },
      });
      return tx.projectAttachment.findUniqueOrThrow({
        where: { projectId_attachmentId: { projectId: id, attachmentId: attachment.id } },
        select: projectAttachmentSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.attachment_url_added',
      entityType: 'Project',
      entityId: id,
      metadata: { attachmentId: link.attachmentId },
    });
    return serializeProjectAttachment(link);
  }

  async linkAttachments(tenant: WorkspaceTenantContext, id: string, dto: ProjectAttachmentIdsDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const attachmentIds = uniqueIds(dto.attachmentIds);
    const attachments = await this.prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, workspaceId: tenant.workspaceId, deletedAt: null },
      select: reusableAttachmentSelect,
    });
    if (attachments.length !== attachmentIds.length) {
      throw new NotFoundException('One or more attachments were not found.');
    }
    const unavailable = attachments.find(
      (attachment) =>
        attachment.type === AttachmentType.FILE &&
        (!attachment.asset ||
          attachment.asset.deletedAt ||
          attachment.asset.status !== AssetStatus.READY),
    );
    if (unavailable) throw new ConflictException('Only ready file attachments can be linked.');

    const result = await this.prisma.$transaction(async (tx) => {
      if (attachmentIds.length === 0) return { requestedCount: 0, changedCount: 0 };
      const values = Prisma.join(
        attachmentIds.map(
          (attachmentId) =>
            Prisma.sql`(${tenant.workspaceId}::uuid, ${id}::uuid, ${attachmentId}::uuid, ${tenant.userId}::uuid)`,
        ),
      );
      const changed = await tx.$queryRaw<Array<{ attachment_id: string }>>(Prisma.sql`
        INSERT INTO "project_attachments" ("workspace_id", "project_id", "attachment_id", "attached_by_id")
        VALUES ${values}
        ON CONFLICT ("project_id", "attachment_id") DO UPDATE
        SET "removed_at" = NULL,
            "attached_by_id" = EXCLUDED."attached_by_id"
        WHERE "project_attachments"."removed_at" IS NOT NULL
        RETURNING "attachment_id"
      `);
      return { requestedCount: attachmentIds.length, changedCount: changed.length };
    });
    if (result.changedCount > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.attachments_linked',
        entityType: 'Project',
        entityId: id,
        metadata: {
          requestedCount: result.requestedCount,
          changedCount: result.changedCount,
          unchangedCount: result.requestedCount - result.changedCount,
          attachmentIds,
        },
      });
    }
    return {
      ...result,
      unchangedCount: result.requestedCount - result.changedCount,
    };
  }

  async downloadAttachment(tenant: WorkspaceTenantContext, id: string, attachmentId: string) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const link = await this.findActiveProjectAttachment(tenant.workspaceId, id, attachmentId);
    if (link.attachment.type !== AttachmentType.FILE || !link.attachment.asset) {
      throw new ConflictException('Attachment is not a downloadable file.');
    }
    if (link.attachment.asset.deletedAt || link.attachment.asset.status !== AssetStatus.READY) {
      throw new ConflictException('Attachment file is not ready for download.');
    }
    const downloadUrl = await this.storage.createPresignedDownloadUrl(
      link.attachment.asset.storageKey,
      this.env.DOWNLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.attachment_download_authorized',
      entityType: 'Project',
      entityId: id,
      metadata: { attachmentId, assetId: link.attachment.asset.id },
    });
    return { downloadUrl, expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS };
  }

  async removeAttachment(tenant: WorkspaceTenantContext, id: string, attachmentId: string) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    await this.findActiveProjectAttachment(tenant.workspaceId, id, attachmentId);
    const removed = await this.prisma.projectAttachment.updateMany({
      where: { workspaceId: tenant.workspaceId, projectId: id, attachmentId, removedAt: null },
      data: { removedAt: new Date() },
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.attachment_removed',
        entityType: 'Project',
        entityId: id,
        metadata: { attachmentId },
      });
    }
    return { changed: removed.count > 0 };
  }

  async listActivity(tenant: WorkspaceTenantContext, id: string, query: ProjectActivityQueryDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: tenant.workspaceId },
      select: { timezone: true },
    });
    const range = activityRange(query.from, query.to, safeWorkspaceTimezone(workspace.timezone));
    const actionFilter: Prisma.StringFilter =
      query.action && projectActivityActions.includes(query.action as ProjectActivityAction)
        ? { equals: query.action }
        : { in: [...projectActivityActions] };
    const where: Prisma.AuditLogWhereInput = {
      workspaceId: tenant.workspaceId,
      entityType: 'Project',
      entityId: id,
      action: actionFilter,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(range ? { createdAt: range } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: projectActivitySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map(serializeProjectActivity),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async reports(tenant: WorkspaceTenantContext, id: string, query: ProjectReportQueryDto) {
    const project = await this.readAccessibleProject(tenant, id, projectDetailSelect);
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const where = this.projectReportTaskWhere(tenant, id, query, timezone);
    const now = new Date();
    const taskFacts = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        dueAt: true,
        pendingCompletionSubmissionId: true,
        statusDefinition: { select: { isTerminal: true } },
        assignees: {
          select: {
            membershipId: true,
            membership: { select: { user: { select: { name: true, email: true } } } },
          },
        },
      },
    });
    const progress = (await this.progressSummaryForProjects(tenant.workspaceId, [project])).get(id);
    const taskIds = taskFacts.map((task) => task.id);
    const completedTasks = taskFacts.filter((task) => task.statusDefinition.isTerminal).length;
    const openTasks = taskFacts.length - completedTasks;
    const overdueTasks = taskFacts.filter(
      (task) => task.dueAt && task.dueAt < now && !task.statusDefinition.isTerminal,
    ).length;
    const pendingApprovalTasks = taskFacts.filter(
      (task) => task.pendingCompletionSubmissionId,
    ).length;
    const estimatedMinutes = await this.projectReportEstimatedMinutes(where);
    const trackedSeconds = await this.projectReportTrackedSeconds(tenant, taskIds);

    return {
      project: {
        id: project.id,
        name: project.name,
      },
      timezone,
      filters: safeProjectReportFilters(query),
      kpis: {
        totalTasks: taskFacts.length,
        openTasks,
        completedTasks,
        overdueTasks,
        pendingApprovalTasks,
        completionRate: taskFacts.length
          ? Math.round((completedTasks / taskFacts.length) * 10000) / 100
          : 0,
        estimatedMinutes,
        trackedSeconds: trackedSeconds.value,
        trackedTimeAvailable: !trackedSeconds.restricted,
      },
      progress: {
        calculatedProgress:
          progress?.calculatedProgress ?? emptyProgress(project).calculatedProgress,
        manualProgressPercent: project.manualProgressPercent,
        effectiveProgress:
          project.manualProgressPercent ??
          progress?.calculatedProgress ??
          emptyProgress(project).calculatedProgress,
      },
      distributions: {
        status: await this.projectReportStatusDistribution(tenant.workspaceId, where),
        priority: await this.projectReportPriorityDistribution(where),
        assignees: projectReportAssigneeBreakdown(taskFacts, now),
        departments: await this.projectReportDepartmentBreakdown(tenant.workspaceId, where),
      },
      completionTrend: await this.projectCompletionTrend(
        tenant.workspaceId,
        query,
        timezone,
        taskIds,
      ),
      semantics: {
        dateRange: 'Report filters use Task dueAt in the Workspace timezone.',
        assigneeBreakdown: 'Counts Task assignments, not unique Tasks across all assignees.',
        completionTrend:
          'Counts reliable terminal completion events from AuditLog for the current filtered Project Task set.',
        multiProject:
          'Multi-Project Tasks contribute their full estimate, tracked time, and completion events to each linked Project report.',
      },
    };
  }

  async reportsCsv(tenant: WorkspaceTenantContext, id: string, query: ProjectReportQueryDto) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      name: true,
    } satisfies Prisma.ProjectSelect);
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const where = this.projectReportTaskWhere(tenant, id, query, timezone);
    const total = await this.prisma.task.count({ where });
    if (total > PROJECT_REPORT_EXPORT_MAX_ROWS) throw projectExportTooLarge();
    const includeTrackedTime = hasPermission(tenant, PermissionKeys.taskTimeViewAll);
    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        priority: true,
        plannedStartAt: true,
        dueAt: true,
        estimatedMinutes: true,
        pendingCompletionSubmissionId: true,
        createdAt: true,
        updatedAt: true,
        statusDefinition: { select: { name: true } },
        department: { select: { name: true } },
        assignees: {
          select: {
            membership: { select: { user: { select: { name: true, email: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
        tags: {
          select: { tag: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: PROJECT_REPORT_EXPORT_MAX_ROWS,
    });
    const trackedByTask = includeTrackedTime
      ? await this.projectTrackedSecondsByTask(
          tenant.workspaceId,
          tasks.map((task) => task.id),
        )
      : new Map<string, number>();
    const header = [
      'Project ID',
      'Project Name',
      'Task ID',
      'Title',
      'Status',
      'Priority',
      'Assignees',
      'Department',
      'Tags',
      'Planned Start',
      'Due At',
      'Estimated Minutes',
      ...(includeTrackedTime ? ['Tracked Seconds'] : []),
      'Pending Approval',
      'Created At',
      'Updated At',
    ];
    return {
      filename: 'project-report.csv',
      contentType: 'text/csv; charset=utf-8',
      csv: toProjectCsv([
        header,
        ...tasks.map((task) => [
          project.id,
          project.name,
          task.id,
          task.title,
          task.statusDefinition.name,
          task.priority,
          task.assignees
            .map((assignee) => assignee.membership.user.name || assignee.membership.user.email)
            .join('; '),
          task.department?.name ?? '',
          task.tags.map((tag) => tag.tag.name).join('; '),
          task.plannedStartAt?.toISOString() ?? '',
          task.dueAt?.toISOString() ?? '',
          String(task.estimatedMinutes ?? ''),
          ...(includeTrackedTime ? [String(trackedByTask.get(task.id) ?? 0)] : []),
          task.pendingCompletionSubmissionId ? 'Yes' : 'No',
          task.createdAt.toISOString(),
          task.updatedAt.toISOString(),
        ]),
      ]),
    };
  }

  async listTags(tenant: WorkspaceTenantContext, id: string) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const tags = await this.prisma.projectTag.findMany({
      where: { workspaceId: tenant.workspaceId, projectId: id },
      select: projectTagSelect,
      orderBy: { createdAt: 'asc' },
    });
    return tags.map(serializeProjectTag);
  }

  async addTags(tenant: WorkspaceTenantContext, id: string, dto: ProjectTagIdsDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const tagIds = uniqueIds(dto.tagIds);
    const changed = await withSerializableRetry(() =>
      this.prisma.$transaction(async (tx) => {
        if (tagIds.length === 0) return 0;
        await this.lockActiveWorkspaceTags(tx, tenant.workspaceId, tagIds);
        const created = await tx.projectTag.createMany({
          data: tagIds.map((tagId) => ({
            workspaceId: tenant.workspaceId,
            projectId: id,
            tagId,
            createdById: tenant.userId,
          })),
          skipDuplicates: true,
        });
        return created.count;
      }, serializableTransaction),
    );
    if (changed > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.tag_added',
        entityType: 'Project',
        entityId: id,
        metadata: { requestedCount: tagIds.length, changedCount: changed },
      });
    }
    return { requestedCount: tagIds.length, changedCount: changed };
  }

  async removeTags(tenant: WorkspaceTenantContext, id: string, dto: ProjectTagIdsDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const tagIds = uniqueIds(dto.tagIds);
    const removed = await this.prisma.projectTag.deleteMany({
      where: { workspaceId: tenant.workspaceId, projectId: id, tagId: { in: tagIds } },
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.tag_removed',
        entityType: 'Project',
        entityId: id,
        metadata: { requestedCount: tagIds.length, changedCount: removed.count },
      });
    }
    return { requestedCount: tagIds.length, changedCount: removed.count };
  }

  async linkTasks(tenant: WorkspaceTenantContext, id: string, dto: ProjectTaskIdsDto) {
    const taskIds = uniqueIds(dto.taskIds);
    const changed = await withSerializableRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockAccessibleProjectForTaskMutation(tx, tenant, id);
        if (taskIds.length === 0) return 0;
        await this.lockActiveWorkspaceTasks(tx, tenant.workspaceId, taskIds);
        const created = await tx.taskProject.createMany({
          data: taskIds.map((taskId) => ({
            workspaceId: tenant.workspaceId,
            projectId: id,
            taskId,
          })),
          skipDuplicates: true,
        });
        return created.count;
      }, serializableTransaction),
    );
    if (changed > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.task_linked',
        entityType: 'Project',
        entityId: id,
        metadata: { requestedCount: taskIds.length, changedCount: changed },
      });
    }
    return {
      requestedCount: taskIds.length,
      changedCount: changed,
      unchangedCount: taskIds.length - changed,
    };
  }

  async unlinkTasks(tenant: WorkspaceTenantContext, id: string, dto: ProjectTaskIdsDto) {
    const taskIds = uniqueIds(dto.taskIds);
    const changed = await withSerializableRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockAccessibleProjectForTaskMutation(tx, tenant, id);
        if (taskIds.length === 0) return 0;
        await this.lockActiveWorkspaceTasks(tx, tenant.workspaceId, taskIds);
        const removed = await tx.taskProject.deleteMany({
          where: { workspaceId: tenant.workspaceId, projectId: id, taskId: { in: taskIds } },
        });
        return removed.count;
      }, serializableTransaction),
    );
    if (changed > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.task_unlinked',
        entityType: 'Project',
        entityId: id,
        metadata: { requestedCount: taskIds.length, changedCount: changed },
      });
    }
    return {
      requestedCount: taskIds.length,
      changedCount: changed,
      unchangedCount: taskIds.length - changed,
    };
  }

  async updateProgress(tenant: WorkspaceTenantContext, id: string, dto: UpdateProjectProgressDto) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      manualProgressPercent: true,
    } satisfies Prisma.ProjectSelect);
    const next = dto.manualProgressPercent;
    if (project.manualProgressPercent === next) return this.get(tenant, id);
    const updated = await this.prisma.project.update({
      where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
      data: {
        manualProgressPercent: next,
        manualProgressUpdatedAt: new Date(),
        manualProgressUpdatedByMembershipId: tenant.workspaceMembershipId,
      },
      select: projectDetailSelect,
    });
    const progress = await this.progressSummaryForProjects(tenant.workspaceId, [updated]);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: next === null ? 'project.progress_override_cleared' : 'project.progress_override_set',
      entityType: 'Project',
      entityId: id,
      metadata: {
        fromManualProgressPercent: project.manualProgressPercent,
        toManualProgressPercent: next,
        calculatedProgress: progress.get(id)?.calculatedProgress ?? 0,
      },
    });
    return serializeProject(updated, progress);
  }

  private projectWhere(
    tenant: WorkspaceTenantContext,
    query: ProjectQueryDto,
  ): Prisma.ProjectWhereInput {
    const plannedRange = dateRange(
      query.plannedFrom,
      query.plannedTo,
      'INVALID_PROJECT_DATE_RANGE',
    );
    const dueRange = dateRange(query.dueFrom, query.dueTo, 'INVALID_PROJECT_DATE_RANGE');
    const filters: Prisma.ProjectWhereInput[] = [this.accessibleProjectWhere(tenant)];
    if (query.search) {
      const search = query.search.trim();
      filters.push({
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { description: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      });
    }
    if (query.tagId) {
      filters.push({ tags: { some: { tagId: query.tagId, workspaceId: tenant.workspaceId } } });
    }
    return {
      AND: filters,
      statusDefinitionId: query.statusDefinitionId,
      priority: query.priority,
      departmentId: query.departmentId,
      ...(plannedRange ? { plannedStartAt: plannedRange } : {}),
      ...(dueRange ? { dueAt: dueRange } : {}),
    };
  }

  private accessibleProjectWhere(tenant: WorkspaceTenantContext): Prisma.ProjectWhereInput {
    const base = { workspaceId: tenant.workspaceId, archivedAt: null };
    if (hasPermission(tenant, PermissionKeys.projectsViewAll)) return base;
    const membershipId = tenant.workspaceMembershipId;
    return {
      ...base,
      OR: [
        { visibility: ProjectVisibility.WORKSPACE },
        ...(membershipId
          ? [
              { ownerMembershipId: membershipId },
              {
                members: {
                  some: { workspaceMembershipId: membershipId, workspaceId: tenant.workspaceId },
                },
              },
            ]
          : []),
      ],
    };
  }

  private async readAccessibleProject<T extends Prisma.ProjectSelect>(
    tenant: WorkspaceTenantContext,
    id: string,
    select: T,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { ...this.accessibleProjectWhere(tenant), id },
      select,
    });
    if (!project) throw new NotFoundException('Project not found.');
    return project as Prisma.ProjectGetPayload<{ select: T }>;
  }

  private async projectStatus(workspaceId: string, statusDefinitionId?: string) {
    const where: Prisma.StatusDefinitionWhereInput = statusDefinitionId
      ? { id: statusDefinitionId, workspaceId }
      : { workspaceId, entityType: StatusEntityType.PROJECT, isDefault: true, isActive: true };
    const status = await this.prisma.statusDefinition.findFirst({
      where,
      select: statusSelect,
      orderBy: { position: 'asc' },
    });
    if (!status || status.entityType !== StatusEntityType.PROJECT || !status.isActive)
      throw new BadRequestException('INVALID_PROJECT_STATUS');
    return status;
  }

  private async hasActiveCompletionXpAward(
    workspaceId: string,
    workType: GamificationPointWorkType,
    sourceEntityId: string,
  ) {
    const award = await this.prisma.gamificationWorkXpEvent.findFirst({
      where: {
        workspaceId,
        workType,
        sourceEntityId,
        eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
        outcome: GamificationWorkXpEventOutcome.APPLIED,
        reversalEvents: { none: {} },
      },
      select: { id: true },
    });
    return Boolean(award);
  }

  private async projectDepartment(workspaceId: string, departmentId?: string | null) {
    if (departmentId === undefined) return undefined;
    if (departmentId === null || departmentId === '') return null;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId },
      select: { id: true, status: true },
    });
    if (!department || department.status !== DepartmentStatus.ACTIVE)
      throw new BadRequestException('INVALID_PROJECT_DEPARTMENT');
    return department;
  }

  private async activeMembership(workspaceId: string, membershipId: string) {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
      select: { id: true },
    });
    if (!membership) throw new BadRequestException('INVALID_PROJECT_MEMBERSHIP');
    return membership;
  }

  private async activeMemberships(workspaceId: string, membershipIds: string[]) {
    if (membershipIds.length === 0) return [];
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { id: { in: membershipIds }, workspaceId, status: MembershipStatus.ACTIVE },
      select: { id: true },
    });
    if (memberships.length !== membershipIds.length)
      throw new BadRequestException('INVALID_PROJECT_MEMBERSHIP');
    return memberships;
  }

  private async lockActiveWorkspaceTags(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    tagIds: string[],
  ) {
    const tags = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "workspace_tags"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" IN (${Prisma.join(uuidParams(tagIds))})
        AND "status" = 'ACTIVE'
      FOR UPDATE
    `);
    if (tags.length !== tagIds.length) throw new BadRequestException('INVALID_PROJECT_TAG');
    return tags;
  }

  private async lockAccessibleProjectForTaskMutation(
    tx: Prisma.TransactionClient,
    tenant: WorkspaceTenantContext,
    projectId: string,
  ) {
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "projects"
      WHERE "workspace_id" = ${tenant.workspaceId}::uuid
        AND "id" = ${projectId}::uuid
      FOR UPDATE
    `);
    if (locked.length !== 1) throw new NotFoundException('Project not found.');
    const project = await tx.project.findFirst({
      where: { ...this.accessibleProjectWhere(tenant), id: projectId },
      select: { id: true, status: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
    if (project.status === ProjectStatus.ARCHIVED)
      throw new BadRequestException('PROJECT_ARCHIVED');
    return project;
  }

  private async lockActiveWorkspaceTasks(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    taskIds: string[],
  ) {
    const tasks = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "tasks"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" IN (${Prisma.join(uuidParams(taskIds))})
        AND "deleted_at" IS NULL
      FOR UPDATE
    `);
    if (tasks.length !== taskIds.length) throw new BadRequestException('INVALID_PROJECT_TASK');
    return tasks;
  }

  private async openLinkedTaskCount(
    workspaceId: string,
    projectId: string,
    tx: Prisma.TransactionClient,
  ) {
    await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "projects"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${projectId}::uuid
      FOR UPDATE
    `);
    return tx.taskProject.count({
      where: {
        workspaceId,
        projectId,
        task: {
          deletedAt: null,
          statusDefinition: { isTerminal: false },
        },
      },
    });
  }

  private async workspaceTimezone(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    return safeWorkspaceTimezone(workspace.timezone);
  }

  private projectReportTaskWhere(
    tenant: WorkspaceTenantContext,
    projectId: string,
    query: ProjectReportQueryDto,
    timezone: string,
  ): Prisma.TaskWhereInput {
    const range = reportDateWindow(query, timezone);
    return {
      workspaceId: tenant.workspaceId,
      deletedAt: null,
      statusDefinitionId: query.statusDefinitionId,
      priority: query.priority,
      departmentId: query.departmentId,
      ...(query.search
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(query.assigneeMembershipId
        ? {
            assignees: {
              some: { membershipId: query.assigneeMembershipId, workspaceId: tenant.workspaceId },
            },
          }
        : {}),
      ...(query.tagId
        ? { tags: { some: { tagId: query.tagId, workspaceId: tenant.workspaceId } } }
        : {}),
      projects: {
        some: {
          projectId,
          workspaceId: tenant.workspaceId,
        },
      },
      ...(range.from || range.to
        ? {
            dueAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? (range.toExclusive ? { lt: range.to } : { lte: range.to }) : {}),
            },
          }
        : {}),
    };
  }

  private async projectReportTrackedSeconds(tenant: WorkspaceTenantContext, taskIds: string[]) {
    if (!taskIds.length) return { value: 0, restricted: false };
    if (!hasPermission(tenant, PermissionKeys.taskTimeViewAll)) {
      return { value: null, restricted: true };
    }
    const result = await this.prisma.taskTimeEntry.aggregate({
      where: {
        workspaceId: tenant.workspaceId,
        taskId: { in: taskIds },
        deletedAt: null,
        endedAt: { not: null },
      },
      _sum: { durationSeconds: true },
    });
    return { value: result._sum.durationSeconds ?? 0, restricted: false };
  }

  private async projectReportEstimatedMinutes(where: Prisma.TaskWhereInput) {
    const result = await this.prisma.task.aggregate({
      where,
      _sum: { estimatedMinutes: true },
    });
    return result._sum.estimatedMinutes ?? 0;
  }

  private async projectReportStatusDistribution(workspaceId: string, where: Prisma.TaskWhereInput) {
    const rows = await this.prisma.task.groupBy({
      by: ['statusDefinitionId'],
      where,
      _count: { _all: true },
    });
    if (!rows.length) return [];
    const statuses = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, id: { in: rows.map((row) => row.statusDefinitionId) } },
      select: { id: true, name: true, color: true, isTerminal: true },
    });
    const statusById = new Map(statuses.map((status) => [status.id, status]));
    return rows.flatMap((row) => {
      const status = statusById.get(row.statusDefinitionId);
      if (!status) return [];
      return {
        statusDefinitionId: status.id,
        name: status.name,
        color: status.color,
        terminal: status.isTerminal,
        count: row._count._all,
      };
    });
  }

  private async projectReportPriorityDistribution(where: Prisma.TaskWhereInput) {
    const rows = await this.prisma.task.groupBy({
      by: ['priority'],
      where,
      _count: { _all: true },
    });
    const countByPriority = new Map(rows.map((row) => [row.priority, row._count._all]));
    return (Object.values(TaskPriority) as TaskPriority[]).map((priority) => ({
      priority,
      count: countByPriority.get(priority) ?? 0,
    }));
  }

  private async projectReportDepartmentBreakdown(
    workspaceId: string,
    where: Prisma.TaskWhereInput,
  ) {
    const rows = await this.prisma.task.groupBy({
      by: ['departmentId'],
      where,
      _count: { _all: true },
    });
    const departmentIds = rows
      .map((row) => row.departmentId)
      .filter((departmentId): departmentId is string => Boolean(departmentId));
    const departments = departmentIds.length
      ? await this.prisma.department.findMany({
          where: { workspaceId, id: { in: departmentIds } },
          select: { id: true, name: true },
        })
      : [];
    const departmentById = new Map(departments.map((department) => [department.id, department]));
    return rows.map((row) => {
      const department = row.departmentId ? departmentById.get(row.departmentId) : null;
      return {
        departmentId: row.departmentId,
        name: department?.name ?? 'Unassigned',
        count: row._count._all,
      };
    });
  }

  private async projectTrackedSecondsByTask(workspaceId: string, taskIds: string[]) {
    if (!taskIds.length) return new Map<string, number>();
    const rows = await this.prisma.taskTimeEntry.groupBy({
      by: ['taskId'],
      where: {
        workspaceId,
        taskId: { in: taskIds },
        deletedAt: null,
        endedAt: { not: null },
      },
      _sum: { durationSeconds: true },
    });
    return new Map(rows.map((row) => [row.taskId, row._sum.durationSeconds ?? 0]));
  }

  private async projectCompletionTrend(
    workspaceId: string,
    query: ProjectReportQueryDto,
    timezone: string,
    taskIds: string[],
  ) {
    if (!taskIds.length) return [];
    const range = reportDateWindow(query, timezone);
    const terminalStatuses = await this.prisma.statusDefinition.findMany({
      where: {
        workspaceId,
        entityType: StatusEntityType.TASK,
        isTerminal: true,
      },
      select: { id: true },
    });
    const terminalStatusIds = new Set(terminalStatuses.map((status) => status.id));
    const rows = await this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        OR: [
          { entityType: 'Task', entityId: { in: taskIds }, action: 'task.status_changed' },
          { entityType: 'TaskCompletionSubmission', action: 'task.completion_approved' },
        ],
        ...(range.from || range.to
          ? {
              createdAt: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? (range.toExclusive ? { lt: range.to } : { lte: range.to }) : {}),
              },
            }
          : {}),
      },
      select: { action: true, entityId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    const taskIdSet = new Set(taskIds);
    const buckets = new Map<string, number>();
    const approvedKeys = new Set<string>();
    const countedKeys = new Set<string>();
    for (const row of rows) {
      const metadata = isRecord(row.metadata) ? row.metadata : {};
      const key = DateTime.fromJSDate(row.createdAt, { zone: timezone }).toISODate()!;
      if (
        row.action === 'task.completion_approved' &&
        metadata.completed === true &&
        typeof metadata.taskId === 'string' &&
        taskIdSet.has(metadata.taskId)
      ) {
        approvedKeys.add(`${metadata.taskId}:${key}`);
      }
    }
    for (const row of rows) {
      const metadata = isRecord(row.metadata) ? row.metadata : {};
      const dateKey = DateTime.fromJSDate(row.createdAt, { zone: timezone }).toISODate()!;
      const taskId =
        row.action === 'task.status_changed'
          ? row.entityId
          : typeof metadata.taskId === 'string'
            ? metadata.taskId
            : null;
      if (!taskId || !taskIdSet.has(taskId)) continue;
      const eventKey = `${taskId}:${dateKey}`;
      const counts =
        row.action === 'task.status_changed'
          ? typeof metadata.toStatusDefinitionId === 'string' &&
            terminalStatusIds.has(metadata.toStatusDefinitionId) &&
            !approvedKeys.has(eventKey)
          : metadata.completed === true;
      if (!counts || countedKeys.has(eventKey)) continue;
      countedKeys.add(eventKey);
      buckets.set(dateKey, (buckets.get(dateKey) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([date, count]) => ({ date, count }));
  }

  private async findFileAttachment(workspaceId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, workspaceId, deletedAt: null, type: AttachmentType.FILE },
      select: fileAttachmentSelect,
    });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    return attachment;
  }

  private async findActiveProjectAttachment(
    workspaceId: string,
    projectId: string,
    attachmentId: string,
  ) {
    const link = await this.prisma.projectAttachment.findFirst({
      where: {
        workspaceId,
        projectId,
        attachmentId,
        removedAt: null,
        attachment: { deletedAt: null },
      },
      select: projectAttachmentSelect,
    });
    if (!link) throw new NotFoundException('Attachment not found.');
    return link;
  }

  private async ensureProcessingJob(asset: AttachmentAssetRecord, correlationId: string) {
    const job = await this.prisma.processingJob.upsert({
      where: { assetId_type: { assetId: asset.id, type: ASSET_PROCESSING_JOB_TYPE } },
      update: {},
      create: {
        workspaceId: asset.workspaceId,
        projectId: asset.projectId,
        assetId: asset.id,
        type: ASSET_PROCESSING_JOB_TYPE,
        status: ProcessingJobStatus.QUEUED,
        correlationId,
      },
      select: { id: true, status: true },
    });
    if (job.status === ProcessingJobStatus.QUEUED) {
      await this.queue.add(
        ASSET_PROCESSING_JOB_TYPE,
        {
          version: ASSET_JOB_VERSION,
          jobId: job.id,
          correlationId,
          workspaceId: asset.workspaceId,
          projectId: asset.projectId,
          assetId: asset.id,
          type: ASSET_PROCESSING_JOB_TYPE,
          createdAt: new Date().toISOString(),
        },
        { jobId: job.id, attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
      );
    }
    return job;
  }

  private async progressSummaryForProjects(workspaceId: string, projects: ProjectRecord[]) {
    const result = new Map<string, ProjectProgressSummary>();
    for (const project of projects) result.set(project.id, emptyProgress(project));
    if (projects.length === 0) return result;

    const now = new Date();
    const rows = await this.prisma.taskProject.findMany({
      where: {
        workspaceId,
        projectId: { in: projects.map((project) => project.id) },
        task: { deletedAt: null },
      },
      select: {
        projectId: true,
        task: {
          select: {
            dueAt: true,
            statusDefinition: { select: { isTerminal: true } },
          },
        },
      },
    });
    for (const row of rows) {
      const summary = result.get(row.projectId);
      if (!summary) continue;
      summary.taskCounts.totalTasks += 1;
      if (row.task.statusDefinition.isTerminal) {
        summary.taskCounts.completedTasks += 1;
      } else {
        summary.taskCounts.openTasks += 1;
        if (row.task.dueAt && row.task.dueAt < now) summary.taskCounts.overdueTasks += 1;
      }
    }
    for (const project of projects) {
      const summary = result.get(project.id)!;
      if (summary.taskCounts.totalTasks > 0) {
        summary.calculatedProgress = Math.round(
          (summary.taskCounts.completedTasks / summary.taskCounts.totalTasks) * 100,
        );
      } else {
        summary.calculatedProgress = project.statusDefinition?.isTerminal ? 100 : 0;
      }
      summary.effectiveProgress = project.manualProgressPercent ?? summary.calculatedProgress;
    }
    return result;
  }
}

const membershipSummarySelect = {
  id: true,
  status: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

const statusSelect = {
  id: true,
  workspaceId: true,
  entityType: true,
  name: true,
  color: true,
  isTerminal: true,
  isActive: true,
  isDefault: true,
  position: true,
} satisfies Prisma.StatusDefinitionSelect;

const departmentSelect = {
  id: true,
  name: true,
  status: true,
} satisfies Prisma.DepartmentSelect;

const projectListSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  statusDefinitionId: true,
  statusDefinition: { select: statusSelect },
  priority: true,
  xpCategory: true,
  visibility: true,
  manualProgressPercent: true,
  manualProgressUpdatedAt: true,
  manualProgressUpdatedByMembershipId: true,
  plannedStartAt: true,
  dueAt: true,
  departmentId: true,
  department: { select: departmentSelect },
  ownerMembershipId: true,
  ownerMembership: { select: membershipSummarySelect },
  manualProgressUpdatedBy: { select: membershipSummarySelect },
  _count: { select: { members: true } },
  createdById: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

const projectDetailSelect = {
  ...projectListSelect,
} satisfies Prisma.ProjectSelect;

const projectMemberSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  workspaceMembershipId: true,
  workspaceMembership: { select: membershipSummarySelect },
  createdAt: true,
} satisfies Prisma.ProjectMemberSelect;

const projectTagSelect = {
  workspaceId: true,
  projectId: true,
  tagId: true,
  createdAt: true,
  tag: { select: { id: true, name: true, color: true, status: true } },
} satisfies Prisma.ProjectTagSelect;

const attachmentAssetSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  originalFilename: true,
  displayName: true,
  storageBucket: true,
  storageKey: true,
  mimeType: true,
  extension: true,
  sizeBytes: true,
  checksum: true,
  status: true,
  metadata: true,
  uploadExpiresAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssetSelect;

const attachmentCoreSelect = {
  id: true,
  workspaceId: true,
  type: true,
  assetId: true,
  url: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AttachmentSelect;

const fileAttachmentSelect = {
  ...attachmentCoreSelect,
  asset: { select: attachmentAssetSelect },
} satisfies Prisma.AttachmentSelect;

const projectAttachmentSelect = {
  projectId: true,
  attachmentId: true,
  createdAt: true,
  removedAt: true,
  attachment: {
    select: {
      ...attachmentCoreSelect,
      asset: { select: attachmentAssetSelect },
      createdBy: { select: { id: true, email: true, name: true } },
    },
  },
  attachedBy: { select: { id: true, email: true, name: true } },
} satisfies Prisma.ProjectAttachmentSelect;

const reusableAttachmentSelect = {
  id: true,
  type: true,
  asset: { select: { id: true, status: true, deletedAt: true } },
} satisfies Prisma.AttachmentSelect;

const projectActivityActions = [
  'project.created',
  'project.updated',
  'project.visibility_changed',
  'project.status_changed',
  'project.deleted',
  'project.member_added',
  'project.member_removed',
  'project.owner_changed',
  'project.tag_added',
  'project.tag_removed',
  'project.task_linked',
  'project.task_unlinked',
  'project.progress_override_set',
  'project.progress_override_cleared',
  'project.attachment_file_uploaded',
  'project.attachment_url_added',
  'project.attachments_linked',
  'project.attachment_download_authorized',
  'project.attachment_removed',
] as const;

type ProjectActivityAction = (typeof projectActivityActions)[number];

const projectActivitySelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.AuditLogSelect;

type ProjectRecord = Prisma.ProjectGetPayload<{ select: typeof projectDetailSelect }>;
type ProjectMemberRecord = Prisma.ProjectMemberGetPayload<{ select: typeof projectMemberSelect }>;
type ProjectTagRecord = Prisma.ProjectTagGetPayload<{ select: typeof projectTagSelect }>;
type AttachmentAssetRecord = Prisma.AssetGetPayload<{ select: typeof attachmentAssetSelect }>;
type AttachmentCoreRecord = Prisma.AttachmentGetPayload<{ select: typeof attachmentCoreSelect }>;
type ProjectAttachmentRecord = Prisma.ProjectAttachmentGetPayload<{
  select: typeof projectAttachmentSelect;
}>;
type ProjectActivityRecord = Prisma.AuditLogGetPayload<{ select: typeof projectActivitySelect }>;
type ProjectReportTaskFact = {
  id: string;
  dueAt: Date | null;
  pendingCompletionSubmissionId: string | null;
  statusDefinition: { isTerminal: boolean };
  assignees: {
    membershipId: string;
    membership: { user: { name: string | null; email: string } };
  }[];
};

interface ProjectProgressSummary {
  calculatedProgress: number;
  effectiveProgress: number;
  taskCounts: {
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
    overdueTasks: number;
  };
}

function serializeProject(
  project: ProjectRecord,
  progressByProjectId: Map<string, ProjectProgressSummary>,
) {
  const progress = progressByProjectId.get(project.id) ?? emptyProgress(project);
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    description: project.description,
    statusDefinitionId: project.statusDefinitionId,
    status: project.statusDefinition
      ? {
          id: project.statusDefinition.id,
          name: project.statusDefinition.name,
          color: project.statusDefinition.color,
          terminal: project.statusDefinition.isTerminal,
        }
      : null,
    priority: project.priority,
    xpCategory: project.xpCategory,
    visibility: project.visibility,
    calculatedProgress: progress.calculatedProgress,
    manualProgressPercent: project.manualProgressPercent,
    manualProgressUpdatedAt: project.manualProgressUpdatedAt,
    manualProgressUpdatedByMembershipId: project.manualProgressUpdatedByMembershipId,
    manualProgressUpdatedBy: project.manualProgressUpdatedBy
      ? serializeMembership(project.manualProgressUpdatedBy)
      : null,
    effectiveProgress: project.manualProgressPercent ?? progress.calculatedProgress,
    taskCounts: progress.taskCounts,
    plannedStartAt: project.plannedStartAt,
    dueAt: project.dueAt,
    departmentId: project.departmentId,
    department: project.department
      ? {
          id: project.department.id,
          name: project.department.name,
          status: project.department.status,
        }
      : null,
    ownerMembershipId: project.ownerMembershipId,
    owner: serializeMembership(project.ownerMembership),
    memberCount: project._count.members,
    createdById: 'createdById' in project ? project.createdById : undefined,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function serializeProjectMember(member: ProjectMemberRecord) {
  return {
    id: member.id,
    workspaceId: member.workspaceId,
    projectId: member.projectId,
    workspaceMembershipId: member.workspaceMembershipId,
    member: serializeMembership(member.workspaceMembership),
    createdAt: member.createdAt,
  };
}

function serializeProjectTag(projectTag: ProjectTagRecord) {
  return {
    id: projectTag.tag.id,
    workspaceId: projectTag.workspaceId,
    projectId: projectTag.projectId,
    tagId: projectTag.tagId,
    name: projectTag.tag.name,
    color: projectTag.tag.color,
    status: projectTag.tag.status,
    createdAt: projectTag.createdAt,
  };
}

function serializePendingProjectFile(
  attachment: AttachmentCoreRecord,
  asset: AttachmentAssetRecord,
) {
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    type: attachment.type,
    displayName: attachment.displayName ?? asset.displayName,
    url: null,
    file: serializeAttachmentAsset(asset),
    attachedAt: null,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

function serializeProjectAttachment(link: ProjectAttachmentRecord) {
  const attachment = link.attachment;
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    projectId: link.projectId,
    type: attachment.type,
    displayName: attachment.displayName ?? attachment.asset?.displayName ?? attachment.url,
    url: attachment.type === AttachmentType.URL ? attachment.url : null,
    file: attachment.asset ? serializeAttachmentAsset(attachment.asset) : null,
    attachedAt: link.createdAt,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    createdBy: attachment.createdBy,
    attachedBy: link.attachedBy,
  };
}

function serializeAttachmentAsset(asset: AttachmentAssetRecord) {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    projectId: asset.projectId,
    originalFilename: asset.originalFilename,
    displayName: asset.displayName,
    mimeType: asset.mimeType,
    extension: asset.extension,
    sizeBytes: Number(asset.sizeBytes),
    checksum: asset.checksum,
    status: asset.status,
    uploadExpiresAt: asset.uploadExpiresAt,
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function serializeProjectActivity(item: ProjectActivityRecord) {
  return {
    id: item.id,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    metadata: safeProjectActivityMetadata(item.action, item.metadata),
    createdAt: item.createdAt,
    actor: item.user ? { id: item.user.id, email: item.user.email, name: item.user.name } : null,
  };
}

function emptyProgress(project: Pick<ProjectRecord, 'statusDefinition' | 'manualProgressPercent'>) {
  const calculatedProgress = project.statusDefinition?.isTerminal ? 100 : 0;
  return {
    calculatedProgress,
    effectiveProgress: project.manualProgressPercent ?? calculatedProgress,
    taskCounts: {
      totalTasks: 0,
      openTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
    },
  };
}

function serializeMembership(
  membership: Prisma.WorkspaceMembershipGetPayload<{ select: typeof membershipSummarySelect }>,
) {
  return {
    id: membership.id,
    status: membership.status,
    user: membership.user,
  };
}

function normalizeName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('Project name is required.');
  return normalized;
}

function normalizeDescription(value?: string | null) {
  if (value === undefined) return undefined;
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeProjectDates(input: {
  plannedStartAt?: string | Date | null;
  dueAt?: string | Date | null;
}) {
  const plannedStartAt = input.plannedStartAt ? new Date(input.plannedStartAt) : null;
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (plannedStartAt && Number.isNaN(plannedStartAt.getTime()))
    throw new BadRequestException('INVALID_PROJECT_DATE_RANGE');
  if (dueAt && Number.isNaN(dueAt.getTime()))
    throw new BadRequestException('INVALID_PROJECT_DATE_RANGE');
  if (plannedStartAt && dueAt && plannedStartAt > dueAt)
    throw new BadRequestException('INVALID_PROJECT_DATE_RANGE');
  return { plannedStartAt, dueAt };
}

function parseOptionalDate(value: string | Date | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

function requireFutureReopenTarget(value: Date | null | undefined, errorCode: string) {
  if (!value || Number.isNaN(value.getTime()) || value <= new Date()) {
    throw new BadRequestException(errorCode);
  }
  return value;
}

function dateRange(from?: string, to?: string, errorCode = 'INVALID_DATE_RANGE') {
  if (!from && !to) return undefined;
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if (start && Number.isNaN(start.getTime())) throw new BadRequestException(errorCode);
  if (end && Number.isNaN(end.getTime())) throw new BadRequestException(errorCode);
  if (start && end && start > end) throw new BadRequestException(errorCode);
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

function activityRange(from: string | undefined, to: string | undefined, timezone: string) {
  if (!from && !to) return undefined;
  const start = from ? parseActivityBoundary(from, timezone, 'start') : null;
  const end = to ? parseActivityBoundary(to, timezone, 'end') : null;
  if (start && end && start > end) throw new BadRequestException('INVALID_PROJECT_ACTIVITY_RANGE');
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
}

function parseActivityBoundary(value: string, timezone: string, boundary: 'start' | 'end') {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = dateOnly
    ? DateTime.fromISO(value, { zone: timezone })
    : DateTime.fromISO(value, { zone: timezone, setZone: true });
  if (!parsed.isValid) throw new BadRequestException('INVALID_PROJECT_ACTIVITY_RANGE');
  const bounded = dateOnly
    ? boundary === 'start'
      ? parsed.startOf('day')
      : parsed.endOf('day')
    : parsed;
  return bounded.toUTC().toJSDate();
}

function normalizeAttachmentUrl(value: string) {
  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new UnprocessableEntityException('Attachment URL is invalid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnprocessableEntityException('Attachment URL must use http or https.');
  }
  if (normalized.length > 2048) {
    throw new UnprocessableEntityException('Attachment URL is too long.');
  }
  return parsed.toString();
}

function normalizeAttachmentDisplayName(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 255) : undefined;
}

function sanitizeFilename(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (
    !normalized ||
    normalized.includes('..') ||
    /%(?:25)*(?:2e|2f|5c)/i.test(normalized) ||
    /[\\/\u2044\u2215\u2216\u29f5\u29f8\uFE68\uFF0F\uFF3C]/u.test(normalized) ||
    hasControlCharacters(normalized)
  ) {
    throw new UnprocessableEntityException('Invalid filename.');
  }
  return normalized.slice(0, 255);
}

function sanitizeMimeType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i.test(normalized)) {
    throw new UnprocessableEntityException('Invalid MIME type.');
  }
  return normalized;
}

function extractExtension(filename: string) {
  const last = filename.lastIndexOf('.');
  if (last <= 0 || last === filename.length - 1) return null;
  const extension = filename
    .slice(last + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return extension ? extension.slice(0, 24) : null;
}

function buildProjectAssetStorageKey(
  workspaceId: string,
  projectId: string,
  assetId: string,
  extension: string | null,
) {
  const suffix = extension ? `asset.${extension}` : 'asset.bin';
  return `workspace/${workspaceId}/projects/${projectId}/assets/${assetId}/${suffix}`;
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined,
    ),
  );
}

function safeProjectActivityMetadata(action: string, metadata: Prisma.JsonValue) {
  const source = isRecord(metadata) ? metadata : {};
  const keysByAction: Record<string, string[]> = {
    'project.created': ['statusDefinitionId', 'ownerMembershipId', 'visibility', 'memberCount'],
    'project.updated': ['changedFields'],
    'project.visibility_changed': ['fromVisibility', 'toVisibility'],
    'project.status_changed': ['fromStatusId', 'toStatusId'],
    'project.member_added': ['requestedCount', 'addedCount'],
    'project.member_removed': ['membershipId'],
    'project.owner_changed': ['fromMembershipId', 'toMembershipId'],
    'project.tag_added': ['requestedCount', 'changedCount'],
    'project.tag_removed': ['requestedCount', 'changedCount'],
    'project.task_linked': ['requestedCount', 'changedCount'],
    'project.task_unlinked': ['requestedCount', 'changedCount'],
    'project.progress_override_set': [
      'fromManualProgressPercent',
      'toManualProgressPercent',
      'calculatedProgress',
    ],
    'project.progress_override_cleared': [
      'fromManualProgressPercent',
      'toManualProgressPercent',
      'calculatedProgress',
    ],
    'project.attachment_file_uploaded': ['attachmentId', 'assetId', 'sizeBytes'],
    'project.attachment_url_added': ['attachmentId'],
    'project.attachments_linked': ['requestedCount', 'changedCount', 'unchangedCount'],
    'project.attachment_download_authorized': ['attachmentId', 'assetId'],
    'project.attachment_removed': ['attachmentId'],
  };
  return Object.fromEntries(
    (keysByAction[action] ?? [])
      .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
      .map((key) => [key, source[key]]),
  );
}

function safeProjectReportFilters(query: ProjectReportQueryDto) {
  return {
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.statusDefinitionId ? { statusDefinitionId: query.statusDefinitionId } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.assigneeMembershipId ? { assigneeMembershipId: query.assigneeMembershipId } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.tagId ? { tagId: query.tagId } : {}),
    ...(query.search?.trim() ? { search: query.search.trim() } : {}),
  };
}

function projectReportAssigneeBreakdown(tasks: ProjectReportTaskFact[], now: Date) {
  const map = new Map<
    string,
    {
      membershipId: string | null;
      displayName: string;
      taskAssignmentCount: number;
      openTaskCount: number;
      completedTaskCount: number;
      overdueTaskCount: number;
    }
  >();
  for (const task of tasks) {
    const assignees =
      task.assignees.length > 0
        ? task.assignees.map((assignee) => ({
            membershipId: assignee.membershipId,
            displayName: assignee.membership.user.name || assignee.membership.user.email,
          }))
        : [{ membershipId: null, displayName: 'Unassigned' }];
    for (const assignee of assignees) {
      const key = assignee.membershipId ?? 'unassigned';
      const existing = map.get(key) ?? {
        membershipId: assignee.membershipId,
        displayName: assignee.displayName,
        taskAssignmentCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
        overdueTaskCount: 0,
      };
      existing.taskAssignmentCount += 1;
      if (task.statusDefinition.isTerminal) existing.completedTaskCount += 1;
      else {
        existing.openTaskCount += 1;
        if (task.dueAt && task.dueAt < now) existing.overdueTaskCount += 1;
      }
      map.set(key, existing);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.taskAssignmentCount - a.taskAssignmentCount)
    .slice(0, 25);
}

function reportDateWindow(query: { from?: string; to?: string }, timezone: string) {
  const from = query.from ? parseReportBoundary(query.from, timezone, 'from') : null;
  const to = query.to ? parseReportBoundary(query.to, timezone, 'to') : null;
  if (from?.date && to?.date && to.date <= from.date)
    throw new BadRequestException('INVALID_TIME_RANGE');
  return { from: from?.date ?? null, to: to?.date ?? null, toExclusive: Boolean(to?.exclusive) };
}

function parseReportBoundary(value: string, timezone: string, boundary: 'from' | 'to') {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const local = DateTime.fromISO(value, { zone: timezone });
    if (!local.isValid) throw new BadRequestException('INVALID_TIME_RANGE');
    const edge =
      boundary === 'from' ? local.startOf('day') : local.plus({ days: 1 }).startOf('day');
    return { date: edge.toJSDate(), exclusive: boundary === 'to' };
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('INVALID_TIME_RANGE');
  return { date, exclusive: false };
}

function projectExportTooLarge() {
  return new PayloadTooLargeException({
    code: 'TASK_EXPORT_TOO_LARGE',
    message: 'TASK_EXPORT_TOO_LARGE',
    details: { maxRows: PROJECT_REPORT_EXPORT_MAX_ROWS },
  });
}

function toProjectCsv(rows: string[][]) {
  return `\uFEFF${rows.map((row) => row.map(projectCsvCell).join(',')).join('\n')}`;
}

function projectCsvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function projectOrderBy(sortBy: ProjectQueryDto['sortBy'], sortDirection: Prisma.SortOrder) {
  if (sortBy === 'dueAt' || sortBy === 'plannedStartAt') {
    return [
      { [sortBy]: { sort: sortDirection, nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'asc' },
    ] satisfies Prisma.ProjectOrderByWithRelationInput[];
  }
  return [{ [sortBy]: sortDirection }, { id: 'asc' }] as Prisma.ProjectOrderByWithRelationInput[];
}

function changedProjectFields(
  existing: {
    name: string;
    description: string | null;
    priority: TaskPriority;
    xpCategory: string | null;
    plannedStartAt: Date | null;
    dueAt: Date | null;
  },
  dto: UpdateProjectDto,
  dates: { plannedStartAt: Date | null; dueAt: Date | null },
) {
  const changed: string[] = [];
  if (dto.name !== undefined && normalizeName(dto.name) !== existing.name) changed.push('name');
  if (
    dto.description !== undefined &&
    normalizeDescription(dto.description) !== existing.description
  )
    changed.push('description');
  if (dto.priority && dto.priority !== existing.priority) changed.push('priority');
  if (dto.xpCategory !== undefined && dto.xpCategory !== existing.xpCategory)
    changed.push('xpCategory');
  if (dateTime(dates.plannedStartAt) !== dateTime(existing.plannedStartAt))
    changed.push('plannedStartAt');
  if (dateTime(dates.dueAt) !== dateTime(existing.dueAt)) changed.push('dueAt');
  return changed;
}

function dateTime(value: Date | null) {
  return value?.getTime() ?? null;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function hasPermission(tenant: WorkspaceTenantContext, permission: string) {
  return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
}

const serializableTransaction = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
};

function uuidParams(ids: string[]) {
  return ids.map((id) => Prisma.sql`${id}::uuid`);
}

async function withSerializableRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSerializableConflict(error) || attempt === attempts - 1) throw error;
    }
  }
  throw lastError;
}

function isSerializableConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.meta?.code === '40001')
  );
}
