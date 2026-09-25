import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AgencyTenantContext, SuperAgencyTenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentAgencyTenant,
  CurrentSuperAgencyTenant,
  SUPER_AGENCY_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import {
  AgencyTenantGuard,
  SuperAgencyTenantGuard,
} from '../../common/tenant/tenant-context.guard';
import {
  ParentProjectOversightQueryDto,
  ParentTaskOversightQueryDto,
  ParentTicketOversightQueryDto,
} from './dto/parent-oversight.dto';
import { ParentOversightService } from './parent-oversight.service';

@ApiTags('agency parent oversight')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/parent')
export class AgencyParentOversightController {
  constructor(private readonly oversight: ParentOversightService) {}

  @Get('tasks')
  @RequirePermissions(PermissionKeys.tasksParentRead)
  listTasks(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Query() query: ParentTaskOversightQueryDto,
  ) {
    return this.oversight.listAgencyTasks(tenant, query);
  }

  @Get('projects')
  @RequirePermissions(PermissionKeys.projectsParentRead)
  listProjects(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Query() query: ParentProjectOversightQueryDto,
  ) {
    return this.oversight.listAgencyProjects(tenant, query);
  }

  @Get('tickets')
  @RequirePermissions(PermissionKeys.ticketsParentRead)
  listTickets(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Query() query: ParentTicketOversightQueryDto,
  ) {
    return this.oversight.listAgencyTickets(tenant, query);
  }
}

@ApiTags('super agency parent oversight')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/parent')
export class SuperAgencyParentOversightController {
  constructor(private readonly oversight: ParentOversightService) {}

  @Get('tasks')
  @RequirePermissions(PermissionKeys.tasksParentRead)
  listTasks(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: ParentTaskOversightQueryDto,
  ) {
    return this.oversight.listSuperAgencyTasks(tenant, query);
  }

  @Get('projects')
  @RequirePermissions(PermissionKeys.projectsParentRead)
  listProjects(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: ParentProjectOversightQueryDto,
  ) {
    return this.oversight.listSuperAgencyProjects(tenant, query);
  }

  @Get('tickets')
  @RequirePermissions(PermissionKeys.ticketsParentRead)
  listTickets(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: ParentTicketOversightQueryDto,
  ) {
    return this.oversight.listSuperAgencyTickets(tenant, query);
  }
}
