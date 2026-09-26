import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
  CreateGoalDto,
  GoalListQueryDto,
  GoalParamsDto,
  ManualGoalProgressDto,
  ParentGoalsQueryDto,
  ReconcileGoalDto,
} from './dto/goals.dto';
import { GoalsService } from './goals.service';

@ApiTags('workspace goals')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/goals')
export class WorkspaceGoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.goalsView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: GoalListQueryDto) {
    return this.goals.listGoals(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.goalsCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateGoalDto) {
    return this.goals.createGoal(tenant, dto);
  }

  @Post('expire-due')
  @RequirePermissions(PermissionKeys.goalsEdit)
  expireDue(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.goals.expireDueGoals(tenant);
  }

  @Get(':goalId')
  @RequirePermissions(PermissionKeys.goalsView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: GoalParamsDto) {
    return this.goals.getGoal(tenant, params.goalId);
  }

  @Get(':goalId/progress-events')
  @RequirePermissions(PermissionKeys.goalsView)
  progressEvents(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: GoalParamsDto,
  ) {
    return this.goals.listProgressEvents(tenant, params.goalId);
  }

  @Post(':goalId/manual-progress')
  @RequirePermissions(PermissionKeys.goalsProgressUpdate)
  manualProgress(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: GoalParamsDto,
    @Body() dto: ManualGoalProgressDto,
  ) {
    return this.goals.recordManualProgress(tenant, params.goalId, dto);
  }

  @Post(':goalId/reconcile')
  @RequirePermissions(PermissionKeys.goalsReconcile)
  reconcile(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: GoalParamsDto,
    @Body() dto: ReconcileGoalDto,
  ) {
    return this.goals.reconcileGoal(tenant, params.goalId, dto);
  }

  @Patch(':goalId/archive')
  @RequirePermissions(PermissionKeys.goalsArchive)
  archive(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: GoalParamsDto,
  ) {
    return this.goals.archiveGoal(tenant, params.goalId);
  }
}

@ApiTags('agency goals oversight')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/parent/goals')
export class AgencyGoalsOversightController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.goalsParentRead)
  list(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Query() query: ParentGoalsQueryDto) {
    return this.goals.listAgencyGoals(tenant, query);
  }
}

@ApiTags('super agency goals oversight')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/parent/goals')
export class SuperAgencyGoalsOversightController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.goalsParentRead)
  list(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: ParentGoalsQueryDto,
  ) {
    return this.goals.listSuperAgencyGoals(tenant, query);
  }
}
