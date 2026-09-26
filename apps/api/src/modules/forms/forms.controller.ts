import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentAgencyTenant,
  CurrentSuperAgencyTenant,
  CurrentWorkspaceTenant,
  SUPER_AGENCY_HEADER,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import {
  AgencyTenantGuard,
  SuperAgencyTenantGuard,
  WorkspaceTenantGuard,
} from '../../common/tenant/tenant-context.guard';
import {
  AuthorizePublicFormUploadDto,
  CompletePublicFormUploadDto,
  CreateFormDto,
  CreateFormFromTemplateDto,
  FormListQueryDto,
  FormParamsDto,
  ParentFormsQueryDto,
  PublishFormDto,
  SubmissionParamsDto,
  SubmitFormDto,
  UpdateFormDraftDto,
} from './dto/forms.dto';
import { FormsService } from './forms.service';

@ApiTags('workspace forms')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/forms')
export class WorkspaceFormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.formsView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: FormListQueryDto) {
    return this.forms.listForms(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.formsCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateFormDto) {
    return this.forms.createForm(tenant, dto);
  }

  @Get('templates')
  @RequirePermissions(PermissionKeys.formsView)
  templates(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: FormListQueryDto,
  ) {
    return this.forms.listTemplates(tenant, query);
  }

  @Post('from-template')
  @RequirePermissions(PermissionKeys.formsCreate)
  fromTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateFormFromTemplateDto,
  ) {
    return this.forms.createFromTemplate(tenant, dto);
  }

  @Get(':formId')
  @RequirePermissions(PermissionKeys.formsView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: FormParamsDto) {
    return this.forms.getForm(tenant, params.formId);
  }

  @Patch(':formId/draft')
  @RequirePermissions(PermissionKeys.formsEdit)
  updateDraft(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: FormParamsDto,
    @Body() dto: UpdateFormDraftDto,
  ) {
    return this.forms.updateDraft(tenant, params.formId, dto);
  }

  @Post(':formId/publish')
  @RequirePermissions(PermissionKeys.formsPublish)
  publish(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: FormParamsDto,
    @Body() dto: PublishFormDto,
  ) {
    return this.forms.publishForm(tenant, params.formId, dto);
  }

  @Post(':formId/archive')
  @RequirePermissions(PermissionKeys.formsEdit)
  archive(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: FormParamsDto,
  ) {
    return this.forms.archiveForm(tenant, params.formId);
  }

  @Post(':formId/submissions')
  @RequirePermissions(PermissionKeys.formsSubmit)
  submitInternal(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: FormParamsDto,
    @Body() dto: SubmitFormDto,
  ) {
    return this.forms.submitInternal(tenant, params.formId, dto);
  }

  @Get(':formId/submissions')
  @RequirePermissions(PermissionKeys.formsSubmissionsView)
  submissions(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: FormParamsDto,
    @Query() query: FormListQueryDto,
  ) {
    return this.forms.listSubmissions(tenant, params.formId, query);
  }

  @Get(':formId/submissions/:submissionId')
  @RequirePermissions(PermissionKeys.formsSubmissionsView)
  submission(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: SubmissionParamsDto,
  ) {
    return this.forms.getSubmission(tenant, params.formId, params.submissionId);
  }
}

@ApiTags('public forms')
@Controller('forms/:publicId')
export class PublicFormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  get(@Param('publicId') publicId: string) {
    return this.forms.publicForm(publicId);
  }

  @Post('submissions')
  submit(
    @Param('publicId') publicId: string,
    @Body() dto: SubmitFormDto,
    @Req() request: PublicReq,
  ) {
    return this.forms.submitPublic(publicId, dto, publicClientKey(request));
  }

  @Post('uploads/authorize')
  authorizeUpload(
    @Param('publicId') publicId: string,
    @Body() dto: AuthorizePublicFormUploadDto,
    @Req() request: PublicReq,
  ) {
    return this.forms.authorizePublicUpload(publicId, dto, publicClientKey(request));
  }

  @Post('uploads/complete')
  completeUpload(
    @Param('publicId') publicId: string,
    @Body() dto: CompletePublicFormUploadDto,
    @Req() request: PublicReq,
  ) {
    return this.forms.completePublicUpload(publicId, dto, publicClientKey(request));
  }
}

@ApiTags('agency forms oversight')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/parent/forms')
export class AgencyFormsOversightController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.formsParentRead)
  list(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Query() query: ParentFormsQueryDto) {
    return this.forms.listAgencyForms(tenant, query);
  }
}

@ApiTags('super agency forms oversight')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/parent/forms')
export class SuperAgencyFormsOversightController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.formsParentRead)
  list(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: ParentFormsQueryDto,
  ) {
    return this.forms.listSuperAgencyForms(tenant, query);
  }
}

interface PublicReq {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function publicClientKey(request: PublicReq) {
  const forwarded = request.headers?.['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (firstForwarded?.split(',')[0]?.trim() || request.ip || 'unknown').slice(0, 120);
}
