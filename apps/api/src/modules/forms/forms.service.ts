import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AssetLifecycle,
  AssetStatus,
  AutomationDomainEventEntityType,
  AutomationTriggerType,
  FormStatus,
  FormSubmissionAssetKind,
  FormSubmissionAutomationStatus,
  FormSubmissionSource,
  FormType,
  FormVersionState,
  FormVisibility,
  Prisma,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssetsService } from '../assets/assets.service';
import { AutomationDomainEventsService } from '../automation/automation-domain-events.service';
import {
  AuthorizePublicFormUploadDto,
  CompletePublicFormUploadDto,
  CreateFormDto,
  CreateFormFromTemplateDto,
  FormListQueryDto,
  ParentFormsQueryDto,
  PublishFormDto,
  SubmitFormDto,
  UpdateFormDraftDto,
} from './dto/forms.dto';
import { FormsCaptchaService } from './forms-captcha.service';
import { FormsRateLimitService } from './forms-rate-limit.service';

const FORM_SCHEMA_MAX_BYTES = 256 * 1024;
const FORM_SETTINGS_MAX_BYTES = 32 * 1024;
const FORM_MAX_FIELDS = 120;
const FORM_MAX_STEPS = 20;
const FIELD_ID_RE = /^[a-z][a-z0-9_-]{1,78}$/i;
const OPTION_ID_RE = /^[a-z][a-z0-9_-]{1,78}$/i;
const SAFE_FIELD_TYPES = new Set([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'DATE',
  'DROPDOWN',
  'MULTI_SELECT',
  'CHECKBOX',
  'RADIO',
  'RATING',
  'FILE_UPLOAD',
  'SIGNATURE',
  'HIDDEN',
]);
const SAFE_OPERATORS = new Set(['EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS']);

type ParentScope =
  { kind: 'AGENCY'; agencyId: string } | { kind: 'SUPER_AGENCY'; superAgencyId: string };

interface FormField {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: Array<{ id: string; label: string }>;
  min?: number;
  max?: number;
  maxLength?: number;
  maxFiles?: number;
  maxSizeBytes?: number;
  accept?: string[];
  condition?: { fieldId: string; operator: string; value?: unknown };
}

interface NormalizedSchema {
  fields: FormField[];
  steps?: Array<{ id: string; title: string; fieldIds: string[] }>;
}

interface NormalizedSubmission {
  answers: Record<string, unknown>;
  summary: Record<string, unknown>;
  assets: Array<{
    fieldId: string;
    assetId: string;
    kind: FormSubmissionAssetKind;
    uploadToken?: string;
  }>;
}

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assets: AssetsService,
    private readonly automationEvents: AutomationDomainEventsService,
    private readonly rateLimit: FormsRateLimitService,
    private readonly captcha: FormsCaptchaService,
  ) {}

  async listForms(tenant: WorkspaceTenantContext, query: FormListQueryDto) {
    requireWorkspaceMembership(tenant);
    const where: Prisma.FormWhereInput = {
      workspaceId: tenant.workspaceId,
      status: query.status,
      type: query.type,
      ...(query.search?.trim()
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.form.findMany({
        where,
        select: formListSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.form.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async listTemplates(tenant: WorkspaceTenantContext, query: FormListQueryDto) {
    return this.listForms(tenant, {
      ...query,
      type: FormType.TEMPLATE,
      status: FormStatus.PUBLISHED,
    });
  }

  async createForm(tenant: WorkspaceTenantContext, dto: CreateFormDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const schema = validateFormSchema(dto.schema);
    const settings = validateSettings(dto.settings ?? {});
    const title = normalizeTitle(dto.title);
    const description = normalizeDescription(dto.description);
    const form = await this.prisma.$transaction(async (tx) => {
      const created = await tx.form.create({
        data: {
          workspaceId: tenant.workspaceId,
          publicId: createPublicId(),
          title,
          description,
          type: dto.type,
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
        },
        select: { id: true },
      });
      await tx.formVersion.create({
        data: {
          formId: created.id,
          workspaceId: tenant.workspaceId,
          versionNumber: 1,
          state: FormVersionState.DRAFT,
          titleSnapshot: title,
          descriptionSnapshot: description,
          schema: toJson(schema),
          settings: toJson(settings),
          createdByMembershipId: membershipId,
        },
      });
      const form = await tx.form.findFirstOrThrow({
        where: { id: created.id, workspaceId: tenant.workspaceId },
        select: formDetailSelect,
      });
      return form;
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'form.create',
      entityType: 'Form',
      entityId: form.id,
      metadata: { type: form.type },
    });
    return serializeForm(form);
  }

  async createFromTemplate(tenant: WorkspaceTenantContext, dto: CreateFormFromTemplateDto) {
    requireWorkspaceMembership(tenant);
    const template = await this.prisma.form.findFirst({
      where: { id: dto.templateId, workspaceId: tenant.workspaceId, type: FormType.TEMPLATE },
      select: { title: true, description: true, versions: publishedVersionSelect },
    });
    if (!template?.versions[0]) throw new BadRequestException('FORM_TEMPLATE_REQUIRED');
    return this.createForm(tenant, {
      title: dto.title ?? template.title,
      description: template.description,
      type: FormType.FORM,
      schema: template.versions[0].schema as Record<string, unknown>,
      settings: (template.versions[0].settings ?? {}) as Record<string, unknown>,
    });
  }

  async getForm(tenant: WorkspaceTenantContext, formId: string) {
    requireWorkspaceMembership(tenant);
    const form = await this.prisma.form.findFirst({
      where: { id: formId, workspaceId: tenant.workspaceId },
      select: formDetailSelect,
    });
    if (!form) throw new NotFoundException('FORM_NOT_FOUND');
    return serializeForm(form);
  }

  async updateDraft(tenant: WorkspaceTenantContext, formId: string, dto: UpdateFormDraftDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const schema = validateFormSchema(dto.schema);
    const settings = validateSettings(dto.settings ?? {});
    const existing = await this.loadFormForEdit(tenant.workspaceId, formId);
    if (existing.status === FormStatus.ARCHIVED) throw new ConflictException('FORM_ARCHIVED');
    const title = dto.title === undefined ? existing.title : normalizeTitle(dto.title);
    const description =
      dto.description === undefined ? existing.description : normalizeDescription(dto.description);
    const currentDraft = existing.versions.find(
      (version) => version.state === FormVersionState.DRAFT,
    );
    const nextVersionNumber =
      currentDraft?.versionNumber ??
      Math.max(0, ...existing.versions.map((version) => version.versionNumber)) + 1;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (currentDraft) {
        await tx.formVersion.update({
          where: { id_workspaceId: { id: currentDraft.id, workspaceId: tenant.workspaceId } },
          data: {
            titleSnapshot: title,
            descriptionSnapshot: description,
            schema: toJson(schema),
            settings: toJson(settings),
          },
        });
      } else {
        await tx.formVersion.create({
          data: {
            formId,
            workspaceId: tenant.workspaceId,
            versionNumber: nextVersionNumber,
            state: FormVersionState.DRAFT,
            titleSnapshot: title,
            descriptionSnapshot: description,
            schema: toJson(schema),
            settings: toJson(settings),
            createdByMembershipId: membershipId,
          },
        });
      }
      return tx.form.update({
        where: { id_workspaceId: { id: formId, workspaceId: tenant.workspaceId } },
        data: { title, description, updatedByMembershipId: membershipId },
        select: formDetailSelect,
      });
    });
    return serializeForm(updated);
  }

  async publishForm(tenant: WorkspaceTenantContext, formId: string, dto: PublishFormDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const existing = await this.loadFormForEdit(tenant.workspaceId, formId);
    if (existing.status === FormStatus.ARCHIVED) throw new ConflictException('FORM_ARCHIVED');
    const draft = existing.versions.find((version) => version.state === FormVersionState.DRAFT);
    if (!draft) throw new BadRequestException('FORM_DRAFT_REQUIRED');
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.formVersion.updateMany({
        where: { formId, workspaceId: tenant.workspaceId, state: FormVersionState.PUBLISHED },
        data: { state: FormVersionState.ARCHIVED, archivedAt: new Date() },
      });
      await tx.formVersion.update({
        where: { id_workspaceId: { id: draft.id, workspaceId: tenant.workspaceId } },
        data: {
          state: FormVersionState.PUBLISHED,
          publishedAt: new Date(),
          publishedByMembershipId: membershipId,
        },
      });
      return tx.form.update({
        where: { id_workspaceId: { id: formId, workspaceId: tenant.workspaceId } },
        data: {
          status: FormStatus.PUBLISHED,
          visibility: dto.publicEnabled ? FormVisibility.PUBLIC : FormVisibility.INTERNAL,
          publicEnabled: Boolean(dto.publicEnabled),
          publishedVersionNumber: draft.versionNumber,
          updatedByMembershipId: membershipId,
        },
        select: formDetailSelect,
      });
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'form.publish',
      entityType: 'Form',
      entityId: formId,
      metadata: { publicEnabled: Boolean(dto.publicEnabled), versionNumber: draft.versionNumber },
    });
    return serializeForm(published);
  }

  async archiveForm(tenant: WorkspaceTenantContext, formId: string) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadFormForEdit(tenant.workspaceId, formId);
    const archived = await this.prisma.form.update({
      where: { id_workspaceId: { id: formId, workspaceId: tenant.workspaceId } },
      data: {
        status: FormStatus.ARCHIVED,
        archivedAt: new Date(),
        archivedByMembershipId: membershipId,
        publicEnabled: false,
        visibility: FormVisibility.INTERNAL,
      },
      select: formDetailSelect,
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'form.archive',
      entityType: 'Form',
      entityId: formId,
    });
    return serializeForm(archived);
  }

  async submitInternal(tenant: WorkspaceTenantContext, formId: string, dto: SubmitFormDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const form = await this.loadPublishedForm(tenant.workspaceId, formId);
    return this.createSubmission({
      workspaceId: tenant.workspaceId,
      form,
      dto,
      source: FormSubmissionSource.INTERNAL,
      submittedByMembershipId: membershipId,
      publicClientHash: null,
      userId: tenant.userId,
    });
  }

  async publicForm(publicId: string) {
    const form = await this.loadPublicForm(publicId);
    const version = form.versions[0];
    if (!version) throw new NotFoundException('FORM_NOT_FOUND');
    return {
      publicId: form.publicId,
      title: version.titleSnapshot,
      description: version.descriptionSnapshot,
      versionNumber: version.versionNumber,
      schema: publicSchema(version.schema),
      settings: publicSettings(version.settings),
      noindex: true,
    };
  }

  async submitPublic(publicId: string, dto: SubmitFormDto, clientKey: string) {
    if (dto.honeypot?.trim()) throw new BadRequestException('FORM_SPAM_REJECTED');
    const form = await this.loadPublicForm(publicId);
    await this.assertPublicWriteAllowed(form.workspace.agency.superAgencyId);
    await this.rateLimit.assertPublicSubmitAllowed(publicId, form.workspaceId, clientKey);
    const version = form.versions[0];
    if (!version) throw new NotFoundException('FORM_NOT_FOUND');
    this.captcha.verifyIfRequired(
      (version.settings ?? {}) as Record<string, unknown>,
      dto.captchaToken,
    );
    return this.createSubmission({
      workspaceId: form.workspaceId,
      form,
      dto,
      source: FormSubmissionSource.PUBLIC,
      submittedByMembershipId: null,
      publicClientHash: hash(clientKey),
      userId: undefined,
    });
  }

  async authorizePublicUpload(
    publicId: string,
    dto: AuthorizePublicFormUploadDto,
    clientKey: string,
  ) {
    const form = await this.loadPublicForm(publicId);
    await this.assertPublicWriteAllowed(form.workspace.agency.superAgencyId);
    await this.rateLimit.assertPublicUploadAllowed(publicId, form.workspaceId, clientKey);
    const version = form.versions[0];
    if (!version || version.versionNumber !== dto.formVersionNumber) {
      throw new ConflictException('FORM_VERSION_CHANGED');
    }
    const field = findUploadField(version.schema as Record<string, unknown>, dto.fieldId);
    if (!field) throw new BadRequestException('FORM_UPLOAD_FIELD_INVALID');
    return this.assets.authorizePublicFormUpload({
      workspaceId: form.workspaceId,
      formId: form.id,
      formPublicId: form.publicId,
      formVersionId: version.id,
      formVersionNumber: version.versionNumber,
      fieldId: field.id,
      fieldType: field.type as 'FILE_UPLOAD' | 'SIGNATURE',
      filename: dto.filename,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      maxSizeBytes: publicUploadMaxSizeBytes(field),
      maxFiles: publicUploadMaxFiles(field),
      allowedMimeTypes: publicUploadAllowedMimeTypes(field),
      ownerUserId: form.createdByMembership.userId,
      ownerMembershipId: form.createdByMembershipId,
      publicClientHash: hash(clientKey),
    });
  }

  async completePublicUpload(
    publicId: string,
    dto: CompletePublicFormUploadDto,
    clientKey: string,
  ) {
    const form = await this.loadPublicForm(publicId);
    await this.assertPublicWriteAllowed(form.workspace.agency.superAgencyId);
    await this.rateLimit.assertPublicUploadAllowed(publicId, form.workspaceId, clientKey);
    const version = form.versions[0];
    if (!version || version.versionNumber !== dto.formVersionNumber) {
      throw new ConflictException('FORM_VERSION_CHANGED');
    }
    const field = findUploadField(version.schema as Record<string, unknown>, dto.fieldId);
    if (!field) throw new BadRequestException('FORM_UPLOAD_FIELD_INVALID');
    return this.assets.completePublicFormUpload({
      publicId,
      workspaceId: form.workspaceId,
      formId: form.id,
      formVersionId: version.id,
      formVersionNumber: version.versionNumber,
      fieldId: field.id,
      assetId: dto.assetId,
      uploadToken: dto.uploadToken,
      sizeBytes: dto.sizeBytes,
      checksum: dto.checksum,
    });
  }

  async listSubmissions(tenant: WorkspaceTenantContext, formId: string, query: FormListQueryDto) {
    requireWorkspaceMembership(tenant);
    await this.assertFormExists(tenant.workspaceId, formId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.formSubmission.findMany({
        where: { workspaceId: tenant.workspaceId, formId },
        select: submissionListSelect,
        orderBy: { submittedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.formSubmission.count({ where: { workspaceId: tenant.workspaceId, formId } }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getSubmission(tenant: WorkspaceTenantContext, formId: string, submissionId: string) {
    requireWorkspaceMembership(tenant);
    const submission = await this.prisma.formSubmission.findFirst({
      where: { id: submissionId, formId, workspaceId: tenant.workspaceId },
      select: submissionDetailSelect,
    });
    if (!submission) throw new NotFoundException('FORM_SUBMISSION_NOT_FOUND');
    return submission;
  }

  async listAgencyForms(tenant: AgencyTenantContext, query: ParentFormsQueryDto) {
    return this.listParentForms({ kind: 'AGENCY', agencyId: tenant.agencyId }, query);
  }

  async listSuperAgencyForms(tenant: SuperAgencyTenantContext, query: ParentFormsQueryDto) {
    return this.listParentForms(
      { kind: 'SUPER_AGENCY', superAgencyId: tenant.superAgencyId },
      query,
    );
  }

  private async createSubmission(input: {
    workspaceId: string;
    form: LoadedForm;
    dto: SubmitFormDto;
    source: FormSubmissionSource;
    submittedByMembershipId: string | null;
    publicClientHash: string | null;
    userId?: string;
  }) {
    const version = input.form.versions[0];
    if (!version) throw new ConflictException('FORM_PUBLISHED_VERSION_MISSING');
    const idempotencyKeyHash = input.dto.idempotencyKey ? hash(input.dto.idempotencyKey) : null;
    if (idempotencyKeyHash) {
      const existing = await this.prisma.formSubmission.findFirst({
        where: {
          workspaceId: input.workspaceId,
          formId: input.form.id,
          idempotencyKeyHash,
        },
        select: submissionReceiptSelect,
      });
      if (existing) {
        return {
          id: existing.id,
          submittedAt: existing.submittedAt,
          status: existing.status,
          automationStatus: existing.automationStatus,
          duplicate: true,
        };
      }
    }
    const normalized = await this.normalizeSubmission(
      input.workspaceId,
      version.schema as Record<string, unknown>,
      input.dto.answers,
      {
        source: input.source,
        formId: input.form.id,
        formPublicId: input.form.publicId,
        formVersionId: version.id,
        formVersionNumber: version.versionNumber,
      },
    );
    const create = async () =>
      this.prisma.$transaction(async (tx) => {
        const submission = await tx.formSubmission.create({
          data: {
            workspaceId: input.workspaceId,
            formId: input.form.id,
            formVersionId: version.id,
            source: input.source,
            submittedByMembershipId: input.submittedByMembershipId,
            idempotencyKeyHash,
            publicClientHash: input.publicClientHash,
            answers: toJson(normalized.answers),
            answerSummary: toJson(normalized.summary),
            assets: normalized.assets.length
              ? {
                  create: normalized.assets.map((asset) => ({
                    workspaceId: input.workspaceId,
                    formId: input.form.id,
                    formVersionId: version.id,
                    assetId: asset.assetId,
                    fieldId: asset.fieldId,
                    kind: asset.kind,
                  })),
                }
              : undefined,
          },
          select: submissionReceiptSelect,
        });
        if (input.source === FormSubmissionSource.PUBLIC) {
          await consumePublicUploadAssets(tx, input.workspaceId, normalized.assets);
        }
        return submission;
      });
    let submission: Prisma.FormSubmissionGetPayload<{ select: typeof submissionReceiptSelect }>;
    let duplicate = false;
    try {
      submission = await create();
    } catch (error) {
      if (
        idempotencyKeyHash &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        submission = await this.prisma.formSubmission.findFirstOrThrow({
          where: { workspaceId: input.workspaceId, formId: input.form.id, idempotencyKeyHash },
          select: submissionReceiptSelect,
        });
        duplicate = true;
      } else {
        throw error;
      }
    }

    if (duplicate) {
      return {
        id: submission.id,
        submittedAt: submission.submittedAt,
        status: submission.status,
        automationStatus: submission.automationStatus,
        duplicate: true,
      };
    }

    await this.recordAutomation(
      input.form,
      version.id,
      submission.id,
      input.submittedByMembershipId,
    );
    if (input.userId) {
      await this.audit.record({
        workspaceId: input.workspaceId,
        userId: input.userId,
        action: 'form.submission.create',
        entityType: 'FormSubmission',
        entityId: submission.id,
        metadata: { formId: input.form.id, source: input.source },
      });
    }
    return {
      id: submission.id,
      submittedAt: submission.submittedAt,
      status: submission.status,
      automationStatus: submission.automationStatus,
      duplicate: false,
    };
  }

  private async recordAutomation(
    form: LoadedForm,
    versionId: string,
    submissionId: string,
    actorMembershipId: string | null,
  ) {
    try {
      const event = await this.automationEvents.recordDomainEvent({
        workspaceId: form.workspaceId,
        eventType: AutomationTriggerType.FORM_SUBMITTED,
        entityType: AutomationDomainEventEntityType.FORM_SUBMISSION,
        entityId: submissionId,
        actorMembershipId,
        idempotencyKey: `form-submission:${submissionId}:submitted`,
        payload: {
          formId: form.id,
          formPublicId: form.publicId,
          formVersionId: versionId,
          title: form.title,
        },
      });
      await this.prisma.formSubmission.update({
        where: { id_workspaceId: { id: submissionId, workspaceId: form.workspaceId } },
        data: {
          automationStatus: FormSubmissionAutomationStatus.QUEUED,
          automationErrorCode: null,
        },
      });
      return event;
    } catch (error) {
      this.logger.warn({
        message: 'Form submission persisted but automation event capture failed',
        formId: form.id,
        submissionId,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      await this.prisma.formSubmission
        .update({
          where: { id_workspaceId: { id: submissionId, workspaceId: form.workspaceId } },
          data: {
            automationStatus: FormSubmissionAutomationStatus.FAILED,
            automationErrorCode: 'FORM_AUTOMATION_CAPTURE_FAILED',
          },
        })
        .catch(() => undefined);
    }
  }

  private async normalizeSubmission(
    workspaceId: string,
    schemaInput: Record<string, unknown>,
    answers: Record<string, unknown>,
    context: {
      source: FormSubmissionSource;
      formId: string;
      formPublicId: string;
      formVersionId: string;
      formVersionNumber: number;
    },
  ): Promise<NormalizedSubmission> {
    const schema = validateFormSchema(schemaInput);
    const fields = schema.fields;
    const fieldIds = new Set(fields.map((field) => field.id));
    for (const key of Object.keys(answers)) {
      if (!fieldIds.has(key)) throw new UnprocessableEntityException('FORM_UNKNOWN_FIELD');
    }
    const byId = new Map(fields.map((field) => [field.id, field]));
    const normalized: Record<string, unknown> = {};
    const assets: NormalizedSubmission['assets'] = [];
    for (const field of fields) {
      if (!isFieldActive(field, byId, answers, new Map())) continue;
      const value = answers[field.id];
      if (value === undefined || value === null || value === '') {
        if (field.required) throw new UnprocessableEntityException('FORM_REQUIRED_FIELD_MISSING');
        continue;
      }
      const answer = normalizeAnswer(field, value, context.source);
      normalized[field.id] = answer.value;
      for (const assetId of answer.assetIds) {
        assets.push({
          fieldId: field.id,
          assetId,
          kind: answer.kind,
          uploadToken: answer.uploadTokens.get(assetId),
        });
      }
    }
    if (assets.length) await this.assertAssets(workspaceId, assets, context);
    return {
      answers: normalized,
      assets,
      summary: {
        fieldCount: Object.keys(normalized).length,
        fileCount: assets.filter((asset) => asset.kind === FormSubmissionAssetKind.FILE).length,
        signatureCount: assets.filter((asset) => asset.kind === FormSubmissionAssetKind.SIGNATURE)
          .length,
      },
    };
  }

  private async assertAssets(
    workspaceId: string,
    assets: NormalizedSubmission['assets'],
    context: {
      source: FormSubmissionSource;
      formId: string;
      formPublicId: string;
      formVersionId: string;
      formVersionNumber: number;
    },
  ) {
    const uniqueIds = [...new Set(assets.map((asset) => asset.assetId))];
    const records = await this.prisma.asset.findMany({
      where: {
        id: { in: uniqueIds },
        workspaceId,
        status: AssetStatus.READY,
        lifecycle: { in: [AssetLifecycle.ACTIVE, AssetLifecycle.ARCHIVED] },
      },
      select: {
        id: true,
        sourceModule: true,
        sourceEntityId: true,
        uploadExpiresAt: true,
        metadata: true,
        _count: { select: { docAttachments: true } },
      },
    });
    if (records.length !== uniqueIds.length)
      throw new UnprocessableEntityException('FORM_ASSET_INVALID');
    const byId = new Map(records.map((record) => [record.id, record]));
    if (context.source !== FormSubmissionSource.PUBLIC) {
      for (const asset of assets) {
        const record = byId.get(asset.assetId);
        if (
          !record ||
          record._count.docAttachments > 0 ||
          publicFormUploadMetadata(record.metadata) ||
          (record.sourceModule === 'FORM' && record.sourceEntityId !== context.formId)
        ) {
          throw new UnprocessableEntityException('FORM_ASSET_INVALID');
        }
      }
      return;
    }
    for (const asset of assets) {
      const record = byId.get(asset.assetId);
      const metadata = publicFormUploadMetadata(record?.metadata);
      if (
        !record ||
        !metadata ||
        record.sourceModule !== 'FORM' ||
        record.sourceEntityId !== context.formId ||
        metadata.formPublicId !== context.formPublicId ||
        metadata.formVersionId !== context.formVersionId ||
        metadata.formVersionNumber !== context.formVersionNumber ||
        metadata.fieldId !== asset.fieldId ||
        metadata.uploadTokenHash !== hash(asset.uploadToken ?? '') ||
        metadata.consumedAt ||
        record.uploadExpiresAt <= new Date() ||
        new Date(metadata.expiresAt).getTime() <= Date.now()
      ) {
        throw new UnprocessableEntityException('FORM_ASSET_INVALID');
      }
    }
  }

  private async assertPublicWriteAllowed(superAgencyId: string) {
    const subscription = await this.prisma.superAgencySubscription.findFirst({
      where: { superAgencyId, isCurrent: true },
      select: { status: true, graceEndsAt: true, trialEndsAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return;
    const restricted =
      subscription.status === SuperAgencySubscriptionStatus.RESTRICTED ||
      subscription.status === SuperAgencySubscriptionStatus.SUSPENDED ||
      subscription.status === SuperAgencySubscriptionStatus.CANCELED ||
      subscription.status === SuperAgencySubscriptionStatus.EXPIRED ||
      (subscription.graceEndsAt?.getTime() ?? Number.POSITIVE_INFINITY) < Date.now() ||
      (subscription.status === SuperAgencySubscriptionStatus.TRIALING &&
        subscription.trialEndsAt &&
        subscription.trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000 < Date.now());
    if (restricted) throw new ForbiddenException('FORM_UNAVAILABLE');
  }

  private async listParentForms(scope: ParentScope, query: ParentFormsQueryDto) {
    const where: Prisma.FormWhereInput = {
      status: { not: FormStatus.ARCHIVED },
      type: query.type ?? undefined,
      workspace: parentWorkspaceFence(scope, query),
      ...(query.search?.trim()
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.form.findMany({
        where,
        select: parentFormSelect,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.form.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private async loadFormForEdit(workspaceId: string, formId: string) {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, workspaceId },
      select: editFormSelect,
    });
    if (!form) throw new NotFoundException('FORM_NOT_FOUND');
    return form;
  }

  private async assertFormExists(workspaceId: string, formId: string) {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, workspaceId },
      select: { id: true },
    });
    if (!form) throw new NotFoundException('FORM_NOT_FOUND');
  }

  private async loadPublishedForm(workspaceId: string, formId: string) {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, workspaceId, status: FormStatus.PUBLISHED },
      select: loadedFormSelect,
    });
    if (!form?.versions[0]) throw new NotFoundException('FORM_NOT_FOUND');
    return form;
  }

  private async loadPublicForm(publicId: string) {
    const form = await this.prisma.form.findUnique({
      where: { publicId },
      select: publicLoadedFormSelect,
    });
    if (
      !form?.versions[0] ||
      form.status !== FormStatus.PUBLISHED ||
      !form.publicEnabled ||
      form.visibility !== FormVisibility.PUBLIC
    ) {
      throw new NotFoundException('FORM_NOT_FOUND');
    }
    return form;
  }
}

const versionSelect = {
  id: true,
  versionNumber: true,
  state: true,
  titleSnapshot: true,
  descriptionSnapshot: true,
  schema: true,
  settings: true,
  publishedAt: true,
  createdAt: true,
} satisfies Prisma.FormVersionSelect;

const publishedVersionSelect = {
  where: { state: FormVersionState.PUBLISHED },
  select: versionSelect,
  orderBy: { versionNumber: 'desc' as const },
  take: 1,
};

const formListSelect = {
  id: true,
  workspaceId: true,
  publicId: true,
  title: true,
  description: true,
  status: true,
  type: true,
  visibility: true,
  publicEnabled: true,
  publishedVersionNumber: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { submissions: true } },
} satisfies Prisma.FormSelect;

const formDetailSelect = {
  ...formListSelect,
  versions: {
    select: versionSelect,
    orderBy: { versionNumber: 'desc' as const },
    take: 5,
  },
} satisfies Prisma.FormSelect;

const editFormSelect = {
  id: true,
  workspaceId: true,
  title: true,
  description: true,
  status: true,
  versions: { select: { id: true, versionNumber: true, state: true } },
} satisfies Prisma.FormSelect;

const loadedFormSelect = {
  id: true,
  workspaceId: true,
  publicId: true,
  title: true,
  versions: publishedVersionSelect,
} satisfies Prisma.FormSelect;

const publicLoadedFormSelect = {
  ...loadedFormSelect,
  status: true,
  publicEnabled: true,
  visibility: true,
  createdByMembershipId: true,
  createdByMembership: { select: { userId: true } },
  workspace: { select: { agency: { select: { superAgencyId: true } } } },
} satisfies Prisma.FormSelect;

type LoadedForm = Prisma.FormGetPayload<{ select: typeof loadedFormSelect }> & {
  createdByMembershipId?: string;
  createdByMembership?: { userId: string };
  workspace?: { agency: { superAgencyId: string } };
};

const submissionReceiptSelect = {
  id: true,
  status: true,
  automationStatus: true,
  submittedAt: true,
} satisfies Prisma.FormSubmissionSelect;

const submissionListSelect = {
  id: true,
  formId: true,
  formVersionId: true,
  source: true,
  status: true,
  answerSummary: true,
  automationStatus: true,
  submittedAt: true,
  submittedByMembership: {
    select: { id: true, user: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.FormSubmissionSelect;

const submissionDetailSelect = {
  ...submissionListSelect,
  answers: true,
  assets: {
    select: {
      id: true,
      fieldId: true,
      kind: true,
      asset: { select: { id: true, displayName: true, mimeType: true, sizeBytes: true } },
    },
  },
} satisfies Prisma.FormSubmissionSelect;

const parentFormSelect = {
  id: true,
  workspaceId: true,
  publicId: true,
  title: true,
  description: true,
  status: true,
  type: true,
  visibility: true,
  publicEnabled: true,
  publishedVersionNumber: true,
  updatedAt: true,
  workspace: {
    select: {
      id: true,
      name: true,
      slug: true,
      agency: { select: { id: true, name: true, slug: true, superAgencyId: true } },
    },
  },
  _count: { select: { submissions: true } },
} satisfies Prisma.FormSelect;

function validateFormSchema(input: Record<string, unknown>): NormalizedSchema {
  assertJsonSize(input, FORM_SCHEMA_MAX_BYTES, 'FORM_SCHEMA_TOO_LARGE');
  assertSafeJson(input);
  const fieldsInput = input.fields;
  if (
    !Array.isArray(fieldsInput) ||
    fieldsInput.length === 0 ||
    fieldsInput.length > FORM_MAX_FIELDS
  ) {
    throw new UnprocessableEntityException('FORM_FIELDS_INVALID');
  }
  const seen = new Set<string>();
  const fields = fieldsInput.map((item) => normalizeField(item, seen));
  const fieldIds = new Set(fields.map((field) => field.id));
  for (const field of fields) {
    if (field.condition && !fieldIds.has(field.condition.fieldId)) {
      throw new UnprocessableEntityException('FORM_CONDITION_FIELD_INVALID');
    }
  }
  assertNoConditionCycles(fields);
  const steps = normalizeSteps(input.steps, fieldIds);
  return steps ? { fields, steps } : { fields };
}

function normalizeField(value: unknown, seen: Set<string>): FormField {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnprocessableEntityException('FORM_FIELD_INVALID');
  }
  const raw = value as Record<string, unknown>;
  const id = normalizeId(raw.id, FIELD_ID_RE, 'FORM_FIELD_ID_INVALID');
  if (seen.has(id)) throw new UnprocessableEntityException('FORM_FIELD_ID_DUPLICATE');
  seen.add(id);
  const type = typeof raw.type === 'string' ? raw.type.toUpperCase() : '';
  if (!SAFE_FIELD_TYPES.has(type))
    throw new UnprocessableEntityException('FORM_FIELD_TYPE_INVALID');
  const label = normalizeString(raw.label, 160, 'FORM_FIELD_LABEL_INVALID');
  const field: FormField = { id, type, label, required: raw.required === true };
  if (Array.isArray(raw.options)) {
    const optionSeen = new Set<string>();
    field.options = raw.options.slice(0, 80).map((option) => normalizeOption(option, optionSeen));
  }
  for (const key of ['min', 'max', 'maxLength', 'maxFiles', 'maxSizeBytes'] as const) {
    if (raw[key] !== undefined) {
      const valueNumber = Number(raw[key]);
      if (!Number.isFinite(valueNumber))
        throw new UnprocessableEntityException('FORM_FIELD_RULE_INVALID');
      (field as unknown as Record<string, unknown>)[key] = valueNumber;
    }
  }
  if (Array.isArray(raw.accept)) {
    field.accept = raw.accept
      .slice(0, 40)
      .map((item) => normalizeString(item, 160, 'FORM_FIELD_RULE_INVALID'));
  }
  if (raw.condition !== undefined) field.condition = normalizeCondition(raw.condition);
  return field;
}

function normalizeOption(value: unknown, seen: Set<string>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnprocessableEntityException('FORM_OPTION_INVALID');
  }
  const raw = value as Record<string, unknown>;
  const id = normalizeId(raw.id, OPTION_ID_RE, 'FORM_OPTION_ID_INVALID');
  if (seen.has(id)) throw new UnprocessableEntityException('FORM_OPTION_ID_DUPLICATE');
  seen.add(id);
  return { id, label: normalizeString(raw.label, 160, 'FORM_OPTION_LABEL_INVALID') };
}

function normalizeCondition(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UnprocessableEntityException('FORM_CONDITION_INVALID');
  }
  const raw = value as Record<string, unknown>;
  const fieldId = normalizeId(raw.fieldId, FIELD_ID_RE, 'FORM_CONDITION_FIELD_INVALID');
  const operator = typeof raw.operator === 'string' ? raw.operator.toUpperCase() : '';
  if (!SAFE_OPERATORS.has(operator))
    throw new UnprocessableEntityException('FORM_CONDITION_INVALID');
  return { fieldId, operator, value: raw.value };
}

function normalizeSteps(value: unknown, fieldIds: Set<string>) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > FORM_MAX_STEPS) {
    throw new UnprocessableEntityException('FORM_STEPS_INVALID');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new UnprocessableEntityException('FORM_STEPS_INVALID');
    }
    const raw = item as Record<string, unknown>;
    const stepFieldIds = Array.isArray(raw.fieldIds) ? raw.fieldIds : [];
    for (const fieldId of stepFieldIds) {
      if (typeof fieldId !== 'string' || !fieldIds.has(fieldId)) {
        throw new UnprocessableEntityException('FORM_STEP_FIELD_INVALID');
      }
    }
    return {
      id: normalizeId(raw.id, FIELD_ID_RE, 'FORM_STEP_ID_INVALID'),
      title: normalizeString(raw.title, 160, 'FORM_STEP_TITLE_INVALID'),
      fieldIds: stepFieldIds as string[],
    };
  });
}

function assertNoConditionCycles(fields: FormField[]) {
  const edges = new Map(fields.map((field) => [field.id, field.condition?.fieldId]));
  for (const field of fields) {
    const visiting = new Set<string>();
    let current: string | undefined = field.id;
    while (current) {
      if (visiting.has(current)) throw new UnprocessableEntityException('FORM_CONDITION_CYCLE');
      visiting.add(current);
      current = edges.get(current);
    }
  }
}

function validateSettings(input: Record<string, unknown>) {
  assertJsonSize(input, FORM_SETTINGS_MAX_BYTES, 'FORM_SETTINGS_TOO_LARGE');
  assertSafeJson(input);
  const successRedirectUrl =
    typeof input.successRedirectUrl === 'string' ? input.successRedirectUrl.trim() : undefined;
  if (successRedirectUrl && !isSafeRedirect(successRedirectUrl)) {
    throw new UnprocessableEntityException('FORM_REDIRECT_UNSAFE');
  }
  return {
    successMessage:
      typeof input.successMessage === 'string'
        ? normalizeString(input.successMessage, 600, 'FORM_SUCCESS_MESSAGE_INVALID')
        : 'Thanks. Your response was submitted.',
    successRedirectUrl,
    captchaRequired: input.captchaRequired === true,
  };
}

function normalizeAnswer(field: FormField, value: unknown, source: FormSubmissionSource) {
  const emptyAssets: string[] = [];
  const emptyTokens = new Map<string, string>();
  switch (field.type) {
    case 'TEXT':
    case 'TEXTAREA':
    case 'PHONE':
    case 'HIDDEN': {
      const text = normalizeString(value, field.maxLength ?? 4000, 'FORM_ANSWER_INVALID');
      return {
        value: text,
        assetIds: emptyAssets,
        uploadTokens: emptyTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    }
    case 'EMAIL': {
      const email = normalizeString(value, 320, 'FORM_ANSWER_INVALID');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new UnprocessableEntityException('FORM_EMAIL_INVALID');
      return {
        value: email,
        assetIds: emptyAssets,
        uploadTokens: emptyTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    }
    case 'NUMBER':
    case 'RATING': {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue))
        throw new UnprocessableEntityException('FORM_NUMBER_INVALID');
      if (field.min !== undefined && numberValue < field.min)
        throw new UnprocessableEntityException('FORM_NUMBER_INVALID');
      if (field.max !== undefined && numberValue > field.max)
        throw new UnprocessableEntityException('FORM_NUMBER_INVALID');
      return {
        value: field.type === 'RATING' ? Math.round(numberValue) : numberValue,
        assetIds: emptyAssets,
        uploadTokens: emptyTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    }
    case 'DATE': {
      const date = normalizeString(value, 40, 'FORM_DATE_INVALID');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        throw new UnprocessableEntityException('FORM_DATE_INVALID');
      }
      return {
        value: date,
        assetIds: emptyAssets,
        uploadTokens: emptyTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    }
    case 'CHECKBOX':
      if (typeof value !== 'boolean')
        throw new UnprocessableEntityException('FORM_CHECKBOX_INVALID');
      return {
        value,
        assetIds: emptyAssets,
        uploadTokens: emptyTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    case 'DROPDOWN':
    case 'RADIO': {
      const optionId = normalizeOptionAnswer(field, value);
      return {
        value: optionId,
        assetIds: emptyAssets,
        uploadTokens: emptyTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    }
    case 'MULTI_SELECT': {
      if (!Array.isArray(value) || value.length > 80)
        throw new UnprocessableEntityException('FORM_MULTI_SELECT_INVALID');
      return {
        value: value.map((item) => normalizeOptionAnswer(field, item)),
        assetIds: emptyAssets,
        uploadTokens: emptyTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    }
    case 'FILE_UPLOAD': {
      const refs = normalizeAssetRefs(
        value,
        source === FormSubmissionSource.PUBLIC
          ? publicUploadMaxFiles(field)
          : (field.maxFiles ?? 10),
        source,
      );
      return {
        value: refs.assetIds,
        assetIds: refs.assetIds,
        uploadTokens: refs.uploadTokens,
        kind: FormSubmissionAssetKind.FILE,
      };
    }
    case 'SIGNATURE': {
      const refs = normalizeAssetRefs(value, 1, source);
      return {
        value: refs.assetIds[0],
        assetIds: refs.assetIds,
        uploadTokens: refs.uploadTokens,
        kind: FormSubmissionAssetKind.SIGNATURE,
      };
    }
    default:
      throw new UnprocessableEntityException('FORM_ANSWER_INVALID');
  }
}

function normalizeOptionAnswer(field: FormField, value: unknown) {
  if (typeof value !== 'string')
    throw new UnprocessableEntityException('FORM_OPTION_ANSWER_INVALID');
  const allowed = new Set((field.options ?? []).map((option) => option.id));
  if (!allowed.has(value)) throw new UnprocessableEntityException('FORM_OPTION_ANSWER_INVALID');
  return value;
}

function normalizeAssetRefs(value: unknown, max: number, source: FormSubmissionSource) {
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.length > max)
    throw new UnprocessableEntityException('FORM_ASSET_INVALID');
  const uploadTokens = new Map<string, string>();
  const assetIds = values.map((item) => {
    if (source === FormSubmissionSource.PUBLIC) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new UnprocessableEntityException('FORM_ASSET_INVALID');
      }
      const ref = item as Record<string, unknown>;
      if (typeof ref.assetId !== 'string' || typeof ref.uploadToken !== 'string') {
        throw new UnprocessableEntityException('FORM_ASSET_INVALID');
      }
      assertUuid(ref.assetId);
      uploadTokens.set(ref.assetId, ref.uploadToken);
      return ref.assetId;
    }
    if (typeof item !== 'string') throw new UnprocessableEntityException('FORM_ASSET_INVALID');
    assertUuid(item);
    return item;
  });
  if (new Set(assetIds).size !== assetIds.length) {
    throw new UnprocessableEntityException('FORM_ASSET_INVALID');
  }
  return { assetIds, uploadTokens };
}

function assertUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new UnprocessableEntityException('FORM_ASSET_INVALID');
  }
}

function isFieldActive(
  field: FormField,
  byId: Map<string, FormField>,
  answers: Record<string, unknown>,
  memo: Map<string, boolean>,
): boolean {
  if (memo.has(field.id)) return memo.get(field.id) as boolean;
  if (!field.condition) {
    memo.set(field.id, true);
    return true;
  }
  const parent = byId.get(field.condition.fieldId);
  if (!parent || !isFieldActive(parent, byId, answers, memo)) {
    memo.set(field.id, false);
    return false;
  }
  const active = conditionMatches(field.condition, answers[field.condition.fieldId]);
  memo.set(field.id, active);
  return active;
}

function conditionMatches(condition: { operator: string; value?: unknown }, value: unknown) {
  switch (condition.operator) {
    case 'EQUALS':
      return value === condition.value;
    case 'NOT_EQUALS':
      return value !== condition.value;
    case 'IN':
      return Array.isArray(condition.value) && condition.value.includes(value);
    case 'NOT_IN':
      return Array.isArray(condition.value) && !condition.value.includes(value);
    case 'EXISTS':
      return value !== undefined && value !== null && value !== '';
    case 'NOT_EXISTS':
      return value === undefined || value === null || value === '';
    default:
      return false;
  }
}

function normalizeId(value: unknown, regex: RegExp, code: string) {
  if (typeof value !== 'string' || !regex.test(value)) throw new UnprocessableEntityException(code);
  return value;
}

function normalizeString(value: unknown, max: number, code: string) {
  if (typeof value !== 'string') throw new UnprocessableEntityException(code);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) throw new UnprocessableEntityException(code);
  return trimmed;
}

function normalizeTitle(value: string) {
  return normalizeString(value.replace(/\s+/g, ' '), 220, 'FORM_TITLE_INVALID');
}

function normalizeDescription(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1000) : null;
}

function assertJsonSize(value: unknown, max: number, code: string) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > max) {
    throw new UnprocessableEntityException(code);
  }
}

function assertSafeJson(value: unknown) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (/javascript:|<script|on\w+=/i.test(value))
      throw new UnprocessableEntityException('FORM_SCHEMA_UNSAFE');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertSafeJson);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^on/i.test(key) || key === 'html' || key === 'script')
        throw new UnprocessableEntityException('FORM_SCHEMA_UNSAFE');
      assertSafeJson(child);
    }
    return;
  }
  throw new UnprocessableEntityException('FORM_SCHEMA_UNSAFE');
}

function isSafeRedirect(value: string) {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function publicSchema(value: Prisma.JsonValue) {
  const schema = validateFormSchema(value as Record<string, unknown>);
  return schema;
}

function publicSettings(value: Prisma.JsonValue | null) {
  const settings = (value ?? {}) as Record<string, unknown>;
  return {
    successMessage: settings.successMessage,
    successRedirectUrl: settings.successRedirectUrl,
    captchaRequired: settings.captchaRequired === true,
  };
}

function findUploadField(schemaInput: Record<string, unknown>, fieldId: string) {
  const schema = validateFormSchema(schemaInput);
  const field = schema.fields.find((item) => item.id === fieldId);
  if (!field || (field.type !== 'FILE_UPLOAD' && field.type !== 'SIGNATURE')) return null;
  return field;
}

function publicUploadMaxSizeBytes(field: FormField) {
  const configured = Number(field.maxSizeBytes ?? 5 * 1024 * 1024);
  if (!Number.isFinite(configured) || configured <= 0) {
    throw new UnprocessableEntityException('FORM_UPLOAD_SIZE_INVALID');
  }
  return Math.min(Math.floor(configured), 25 * 1024 * 1024);
}

function publicUploadMaxFiles(field: FormField) {
  if (field.type === 'SIGNATURE') return 1;
  const configured = Number(field.maxFiles ?? 1);
  if (!Number.isFinite(configured) || configured < 1) {
    throw new UnprocessableEntityException('FORM_UPLOAD_COUNT_INVALID');
  }
  return Math.min(Math.floor(configured), 10);
}

function publicUploadAllowedMimeTypes(field: FormField) {
  if (field.type === 'SIGNATURE') {
    const configured = field.accept?.length ? field.accept : ['image/png', 'image/webp'];
    return configured
      .map((mimeType) => mimeType.trim().toLowerCase())
      .filter((mimeType) => ['image/png', 'image/webp'].includes(mimeType));
  }
  if (!field.accept?.length) throw new UnprocessableEntityException('FORM_UPLOAD_TYPE_NOT_ALLOWED');
  return field.accept.map((mimeType) => mimeType.trim().toLowerCase());
}

function publicFormUploadMetadata(value: Prisma.JsonValue | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = (value as Record<string, unknown>).publicFormUpload;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const record = metadata as Record<string, unknown>;
  const formPublicId = stringValue(record.formPublicId);
  const formVersionId = stringValue(record.formVersionId);
  const formVersionNumber = numberValue(record.formVersionNumber);
  const fieldId = stringValue(record.fieldId);
  const uploadTokenHash = stringValue(record.uploadTokenHash);
  const expiresAt = stringValue(record.expiresAt);
  const consumedAt = typeof record.consumedAt === 'string' ? record.consumedAt : null;
  if (
    !formPublicId ||
    !formVersionId ||
    !formVersionNumber ||
    !fieldId ||
    !uploadTokenHash ||
    !expiresAt
  ) {
    return null;
  }
  return {
    formPublicId,
    formVersionId,
    formVersionNumber,
    fieldId,
    uploadTokenHash,
    expiresAt,
    consumedAt,
  };
}

async function consumePublicUploadAssets(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  assets: NormalizedSubmission['assets'],
) {
  const publicAssets = assets.filter((asset) => asset.uploadToken);
  if (!publicAssets.length) return;
  const consumedAt = new Date().toISOString();
  for (const asset of publicAssets) {
    const record = await tx.asset.findUnique({
      where: { id_workspaceId: { id: asset.assetId, workspaceId } },
      select: { metadata: true },
    });
    const metadata = publicFormUploadMetadata(record?.metadata);
    if (!record || !metadata || metadata.consumedAt) {
      throw new UnprocessableEntityException('FORM_ASSET_INVALID');
    }
    const root =
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, unknown>)
        : {};
    const upload =
      root.publicFormUpload &&
      typeof root.publicFormUpload === 'object' &&
      !Array.isArray(root.publicFormUpload)
        ? (root.publicFormUpload as Record<string, unknown>)
        : {};
    await tx.asset.update({
      where: { id_workspaceId: { id: asset.assetId, workspaceId } },
      data: {
        metadata: toJson({
          ...root,
          publicFormUpload: {
            ...upload,
            consumedAt,
          },
        }),
      },
    });
  }
}

function serializeForm(form: Record<string, unknown>) {
  return form;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function createPublicId() {
  return `frm_${randomBytes(18).toString('base64url')}`;
}

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
  if (!tenant.workspaceMembershipId || tenant.accessSource !== 'WORKSPACE_MEMBERSHIP') {
    throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
  }
  return tenant.workspaceMembershipId;
}

function parentWorkspaceFence(
  scope: ParentScope,
  query: { agencyId?: string; workspaceId?: string },
) {
  return {
    ...(query.workspaceId ? { id: query.workspaceId } : {}),
    ...(scope.kind === 'AGENCY'
      ? {
          agencyId: scope.agencyId,
          ...(query.agencyId && query.agencyId !== scope.agencyId
            ? { id: '00000000-0000-4000-8000-000000000000' }
            : {}),
        }
      : {
          ...(query.agencyId ? { agencyId: query.agencyId } : {}),
          agency: { superAgencyId: scope.superAgencyId },
        }),
  };
}
