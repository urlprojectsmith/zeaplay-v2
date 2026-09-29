import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/current-user.decorator';
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
  CreateReportDto,
  CreateReportScheduleDto,
  ExportReportDto,
  ReportListQueryDto,
  UpdateReportDto,
  UpdateReportScheduleDto,
} from './dto/reports.dto';
import { ReportsPlatformGuard } from './reports-platform.guard';
import { ReportsService } from './reports.service';

@ApiTags('workspace reports')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/reports')
export class WorkspaceReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.reportsView)
  async list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: ReportListQueryDto,
  ) {
    return this.reports.list(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      query,
    );
  }

  @Post()
  @RequirePermissions(PermissionKeys.reportsCreate)
  async create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.create(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      dto,
    );
  }

  @Get(':reportId')
  @RequirePermissions(PermissionKeys.reportsView)
  async get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.get(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
    );
  }

  @Patch(':reportId')
  @RequirePermissions(PermissionKeys.reportsEdit)
  async update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reports.update(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
      dto,
    );
  }

  @Post(':reportId/archive')
  @RequirePermissions(PermissionKeys.reportsManage)
  async archive(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.archive(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/preview')
  @RequirePermissions(PermissionKeys.reportsView)
  async preview(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.preview(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/exports')
  @RequirePermissions(PermissionKeys.reportsExport)
  async export(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: ExportReportDto,
  ) {
    return this.reports.export(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
      dto,
    );
  }

  @Get(':reportId/exports/:exportId/download')
  @RequirePermissions(PermissionKeys.reportsExport)
  async download(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
    @Param('exportId') exportId: string,
  ) {
    return this.reports.download(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
      exportId,
    );
  }

  @Get(':reportId/schedules')
  @RequirePermissions(PermissionKeys.reportsView)
  async listSchedules(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.listSchedules(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/schedules')
  @RequirePermissions(PermissionKeys.reportsSchedule)
  async createSchedule(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: CreateReportScheduleDto,
  ) {
    return this.reports.createSchedule(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
      dto,
    );
  }

  @Patch(':reportId/schedules/:scheduleId')
  @RequirePermissions(PermissionKeys.reportsSchedule)
  async updateSchedule(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('reportId') reportId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateReportScheduleDto,
  ) {
    return this.reports.updateSchedule(
      await this.reports.workspaceScope(tenant),
      this.reports.workspaceActor(tenant),
      reportId,
      scheduleId,
      dto,
    );
  }
}

@ApiTags('agency reports')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/reports')
export class AgencyReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.reportsView)
  async list(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Query() query: ReportListQueryDto,
  ) {
    return this.reports.list(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      query,
    );
  }

  @Post()
  @RequirePermissions(PermissionKeys.reportsCreate)
  async create(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Body() dto: CreateReportDto) {
    return this.reports.create(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      dto,
    );
  }

  @Get(':reportId')
  @RequirePermissions(PermissionKeys.reportsView)
  async get(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.get(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
    );
  }

  @Patch(':reportId')
  @RequirePermissions(PermissionKeys.reportsEdit)
  async update(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reports.update(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
      dto,
    );
  }

  @Post(':reportId/archive')
  @RequirePermissions(PermissionKeys.reportsManage)
  async archive(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.archive(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/preview')
  @RequirePermissions(PermissionKeys.reportsView)
  async preview(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.preview(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/exports')
  @RequirePermissions(PermissionKeys.reportsExport)
  async export(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: ExportReportDto,
  ) {
    return this.reports.export(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
      dto,
    );
  }

  @Get(':reportId/exports/:exportId/download')
  @RequirePermissions(PermissionKeys.reportsExport)
  async download(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
    @Param('exportId') exportId: string,
  ) {
    return this.reports.download(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
      exportId,
    );
  }

  @Post(':reportId/schedules')
  @RequirePermissions(PermissionKeys.reportsSchedule)
  async createSchedule(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: CreateReportScheduleDto,
  ) {
    return this.reports.createSchedule(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
      dto,
    );
  }

  @Get(':reportId/schedules')
  @RequirePermissions(PermissionKeys.reportsView)
  async listSchedules(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.listSchedules(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
    );
  }

  @Patch(':reportId/schedules/:scheduleId')
  @RequirePermissions(PermissionKeys.reportsSchedule)
  async updateSchedule(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('reportId') reportId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateReportScheduleDto,
  ) {
    return this.reports.updateSchedule(
      await this.reports.agencyScope(tenant),
      this.reports.agencyActor(tenant),
      reportId,
      scheduleId,
      dto,
    );
  }
}

@ApiTags('super agency reports')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/reports')
export class SuperAgencyReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.reportsView)
  async list(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: ReportListQueryDto,
  ) {
    return this.reports.list(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      query,
    );
  }

  @Post()
  @RequirePermissions(PermissionKeys.reportsCreate)
  async create(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateReportDto,
  ) {
    return this.reports.create(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      dto,
    );
  }

  @Get(':reportId')
  @RequirePermissions(PermissionKeys.reportsView)
  async get(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.get(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
    );
  }

  @Patch(':reportId')
  @RequirePermissions(PermissionKeys.reportsEdit)
  async update(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reports.update(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
      dto,
    );
  }

  @Post(':reportId/archive')
  @RequirePermissions(PermissionKeys.reportsManage)
  async archive(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.archive(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/preview')
  @RequirePermissions(PermissionKeys.reportsView)
  async preview(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.preview(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/exports')
  @RequirePermissions(PermissionKeys.reportsExport)
  async export(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: ExportReportDto,
  ) {
    return this.reports.export(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
      dto,
    );
  }

  @Get(':reportId/exports/:exportId/download')
  @RequirePermissions(PermissionKeys.reportsExport)
  async download(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
    @Param('exportId') exportId: string,
  ) {
    return this.reports.download(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
      exportId,
    );
  }

  @Get(':reportId/schedules')
  @RequirePermissions(PermissionKeys.reportsView)
  async listSchedules(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
  ) {
    return this.reports.listSchedules(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
    );
  }

  @Post(':reportId/schedules')
  @RequirePermissions(PermissionKeys.reportsSchedule)
  async createSchedule(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
    @Body() dto: CreateReportScheduleDto,
  ) {
    return this.reports.createSchedule(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
      dto,
    );
  }

  @Patch(':reportId/schedules/:scheduleId')
  @RequirePermissions(PermissionKeys.reportsSchedule)
  async updateSchedule(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('reportId') reportId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateReportScheduleDto,
  ) {
    return this.reports.updateSchedule(
      await this.reports.superAgencyScope(tenant),
      this.reports.superAgencyActor(tenant),
      reportId,
      scheduleId,
      dto,
    );
  }
}

@ApiTags('platform reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ReportsPlatformGuard)
@Controller('platform/reports')
export class PlatformReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ReportListQueryDto) {
    return this.reports.list(this.reports.platformScope(), this.reports.platformActor(user), query);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    return this.reports.create(this.reports.platformScope(), this.reports.platformActor(user), dto);
  }

  @Get(':reportId')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('reportId') reportId: string) {
    return this.reports.get(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
    );
  }

  @Patch(':reportId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.reports.update(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
      dto,
    );
  }

  @Post(':reportId/archive')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('reportId') reportId: string) {
    return this.reports.archive(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
    );
  }

  @Post(':reportId/preview')
  async preview(@CurrentUser() user: AuthenticatedUser, @Param('reportId') reportId: string) {
    return this.reports.preview(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
    );
  }

  @Post(':reportId/exports')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Body() dto: ExportReportDto,
  ) {
    return this.reports.export(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
      dto,
    );
  }

  @Get(':reportId/exports/:exportId/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Param('exportId') exportId: string,
  ) {
    return this.reports.download(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
      exportId,
    );
  }

  @Get(':reportId/schedules')
  async listSchedules(@CurrentUser() user: AuthenticatedUser, @Param('reportId') reportId: string) {
    return this.reports.listSchedules(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
    );
  }

  @Post(':reportId/schedules')
  async createSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Body() dto: CreateReportScheduleDto,
  ) {
    return this.reports.createSchedule(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
      dto,
    );
  }

  @Patch(':reportId/schedules/:scheduleId')
  async updateSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId') reportId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() dto: UpdateReportScheduleDto,
  ) {
    return this.reports.updateSchedule(
      this.reports.platformScope(),
      this.reports.platformActor(user),
      reportId,
      scheduleId,
      dto,
    );
  }
}
