import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { CustomDashboardsPlatformGuard } from './custom-dashboards-platform.guard';
import { CustomDashboardsService } from './custom-dashboards.service';
import {
  CreateDashboardDto,
  CreateDashboardFromTemplateDto,
  CreateDashboardWidgetDto,
  DashboardListQueryDto,
  DashboardPreferenceDto,
  UpdateDashboardDto,
  UpdateDashboardLayoutDto,
  UpdateDashboardWidgetDto,
} from './dto/custom-dashboards.dto';

@ApiTags('workspace custom dashboards')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/dashboards')
export class WorkspaceCustomDashboardsController {
  constructor(private readonly dashboards: CustomDashboardsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.dashboardsView)
  async list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: DashboardListQueryDto,
  ) {
    return this.dashboards.list(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      query,
    );
  }

  @Get('templates')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async templates(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.dashboards.templates(await this.dashboards.workspaceScope(tenant));
  }

  @Post()
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateDashboardDto,
  ) {
    return this.dashboards.create(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dto,
    );
  }

  @Post('from-template')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async createFromTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateDashboardFromTemplateDto,
  ) {
    return this.dashboards.createFromTemplate(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dto,
    );
  }

  @Get(':dashboardId')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.get(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
    );
  }

  @Get(':dashboardId/render')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async render(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.render(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
    );
  }

  @Patch(':dashboardId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.dashboards.update(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/archive')
  @RequirePermissions(PermissionKeys.dashboardsManage)
  async archive(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.archive(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/restore')
  @RequirePermissions(PermissionKeys.dashboardsManage)
  async restore(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.restore(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/duplicate')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async duplicate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.duplicate(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/widgets')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async addWidget(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateDashboardWidgetDto,
  ) {
    return this.dashboards.addWidget(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Patch(':dashboardId/widgets/:widgetId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async updateWidget(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateDashboardWidgetDto,
  ) {
    return this.dashboards.updateWidget(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
      widgetId,
      dto,
    );
  }

  @Post(':dashboardId/widgets/:widgetId/render')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async renderWidget(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.renderOne(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
      widgetId,
    );
  }

  @Delete(':dashboardId/widgets/:widgetId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async removeWidget(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.removeWidget(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
      widgetId,
    );
  }

  @Patch(':dashboardId/layout')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async layout(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardLayoutDto,
  ) {
    return this.dashboards.updateLayout(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/favorite')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async favorite(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: DashboardPreferenceDto,
  ) {
    return this.dashboards.setFavorite(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/default')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async setDefault(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.setDefault(
      await this.dashboards.workspaceScope(tenant),
      this.dashboards.workspaceActor(tenant),
      dashboardId,
    );
  }
}

@ApiTags('agency custom dashboards')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/dashboards')
export class AgencyCustomDashboardsController {
  constructor(private readonly dashboards: CustomDashboardsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.dashboardsView)
  async list(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Query() query: DashboardListQueryDto,
  ) {
    return this.dashboards.list(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      query,
    );
  }

  @Get('templates')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async templates(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.dashboards.templates(await this.dashboards.agencyScope(tenant));
  }

  @Post()
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async create(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Body() dto: CreateDashboardDto,
  ) {
    return this.dashboards.create(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dto,
    );
  }

  @Post('from-template')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async createFromTemplate(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Body() dto: CreateDashboardFromTemplateDto,
  ) {
    return this.dashboards.createFromTemplate(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dto,
    );
  }

  @Get(':dashboardId')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async get(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.get(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
    );
  }

  @Get(':dashboardId/render')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async render(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.render(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
    );
  }

  @Patch(':dashboardId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async update(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.dashboards.update(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/archive')
  @RequirePermissions(PermissionKeys.dashboardsManage)
  async archive(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.archive(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/restore')
  @RequirePermissions(PermissionKeys.dashboardsManage)
  async restore(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.restore(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/duplicate')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async duplicate(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.duplicate(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/widgets')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async addWidget(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateDashboardWidgetDto,
  ) {
    return this.dashboards.addWidget(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Patch(':dashboardId/widgets/:widgetId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async updateWidget(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateDashboardWidgetDto,
  ) {
    return this.dashboards.updateWidget(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
      widgetId,
      dto,
    );
  }

  @Post(':dashboardId/widgets/:widgetId/render')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async renderWidget(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.renderOne(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
      widgetId,
    );
  }

  @Delete(':dashboardId/widgets/:widgetId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async removeWidget(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.removeWidget(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
      widgetId,
    );
  }

  @Patch(':dashboardId/layout')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async layout(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardLayoutDto,
  ) {
    return this.dashboards.updateLayout(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/favorite')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async favorite(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: DashboardPreferenceDto,
  ) {
    return this.dashboards.setFavorite(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/default')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async setDefault(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.setDefault(
      await this.dashboards.agencyScope(tenant),
      this.dashboards.agencyActor(tenant),
      dashboardId,
    );
  }
}

@ApiTags('super agency custom dashboards')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/dashboards')
export class SuperAgencyCustomDashboardsController {
  constructor(private readonly dashboards: CustomDashboardsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.dashboardsView)
  async list(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: DashboardListQueryDto,
  ) {
    return this.dashboards.list(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      query,
    );
  }

  @Get('templates')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async templates(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.dashboards.templates(await this.dashboards.superAgencyScope(tenant));
  }

  @Post()
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async create(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateDashboardDto,
  ) {
    return this.dashboards.create(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dto,
    );
  }

  @Post('from-template')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async createFromTemplate(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateDashboardFromTemplateDto,
  ) {
    return this.dashboards.createFromTemplate(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dto,
    );
  }

  @Get(':dashboardId')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async get(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.get(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
    );
  }

  @Get(':dashboardId/render')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async render(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.render(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
    );
  }

  @Patch(':dashboardId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async update(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.dashboards.update(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/archive')
  @RequirePermissions(PermissionKeys.dashboardsManage)
  async archive(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.archive(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/restore')
  @RequirePermissions(PermissionKeys.dashboardsManage)
  async restore(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.restore(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/duplicate')
  @RequirePermissions(PermissionKeys.dashboardsCreate)
  async duplicate(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.duplicate(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
    );
  }

  @Post(':dashboardId/widgets')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async addWidget(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateDashboardWidgetDto,
  ) {
    return this.dashboards.addWidget(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Patch(':dashboardId/widgets/:widgetId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async updateWidget(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateDashboardWidgetDto,
  ) {
    return this.dashboards.updateWidget(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
      widgetId,
      dto,
    );
  }

  @Post(':dashboardId/widgets/:widgetId/render')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async renderWidget(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.renderOne(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
      widgetId,
    );
  }

  @Delete(':dashboardId/widgets/:widgetId')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async removeWidget(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.removeWidget(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
      widgetId,
    );
  }

  @Patch(':dashboardId/layout')
  @RequirePermissions(PermissionKeys.dashboardsEdit)
  async layout(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardLayoutDto,
  ) {
    return this.dashboards.updateLayout(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/favorite')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async favorite(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: DashboardPreferenceDto,
  ) {
    return this.dashboards.setFavorite(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/default')
  @RequirePermissions(PermissionKeys.dashboardsView)
  async setDefault(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.setDefault(
      await this.dashboards.superAgencyScope(tenant),
      this.dashboards.superAgencyActor(tenant),
      dashboardId,
    );
  }
}

@ApiTags('platform custom dashboards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CustomDashboardsPlatformGuard)
@Controller('platform/dashboards')
export class PlatformCustomDashboardsController {
  constructor(private readonly dashboards: CustomDashboardsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: DashboardListQueryDto) {
    return this.dashboards.list(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      query,
    );
  }

  @Get('templates')
  templates() {
    return this.dashboards.templates(this.dashboards.platformScope());
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDashboardDto) {
    return this.dashboards.create(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dto,
    );
  }

  @Post('from-template')
  async createFromTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDashboardFromTemplateDto,
  ) {
    return this.dashboards.createFromTemplate(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dto,
    );
  }

  @Get(':dashboardId')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('dashboardId') dashboardId: string) {
    return this.dashboards.get(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
    );
  }

  @Get(':dashboardId/render')
  async render(@CurrentUser() user: AuthenticatedUser, @Param('dashboardId') dashboardId: string) {
    return this.dashboards.render(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
    );
  }

  @Patch(':dashboardId')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.dashboards.update(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/archive')
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('dashboardId') dashboardId: string) {
    return this.dashboards.archive(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
    );
  }

  @Post(':dashboardId/restore')
  async restore(@CurrentUser() user: AuthenticatedUser, @Param('dashboardId') dashboardId: string) {
    return this.dashboards.restore(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
    );
  }

  @Post(':dashboardId/duplicate')
  async duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.duplicate(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
    );
  }

  @Post(':dashboardId/widgets')
  async addWidget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: CreateDashboardWidgetDto,
  ) {
    return this.dashboards.addWidget(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
      dto,
    );
  }

  @Patch(':dashboardId/widgets/:widgetId')
  async updateWidget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateDashboardWidgetDto,
  ) {
    return this.dashboards.updateWidget(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
      widgetId,
      dto,
    );
  }

  @Post(':dashboardId/widgets/:widgetId/render')
  async renderWidget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.renderOne(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
      widgetId,
    );
  }

  @Delete(':dashboardId/widgets/:widgetId')
  async removeWidget(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.dashboards.removeWidget(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
      widgetId,
    );
  }

  @Patch(':dashboardId/layout')
  async layout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: UpdateDashboardLayoutDto,
  ) {
    return this.dashboards.updateLayout(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/favorite')
  async favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
    @Body() dto: DashboardPreferenceDto,
  ) {
    return this.dashboards.setFavorite(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
      dto,
    );
  }

  @Post(':dashboardId/default')
  async setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('dashboardId') dashboardId: string,
  ) {
    return this.dashboards.setDefault(
      this.dashboards.platformScope(),
      this.dashboards.platformActor(user),
      dashboardId,
    );
  }
}
