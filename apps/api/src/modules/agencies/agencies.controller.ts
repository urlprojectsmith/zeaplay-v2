import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
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
  SUPER_AGENCY_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import {
  AgencyTenantGuard,
  SuperAgencyTenantGuard,
} from '../../common/tenant/tenant-context.guard';
import { AgenciesService } from './agencies.service';
import { AgencyMembershipParamsDto } from './dto/agency-params.dto';
import { CreateAgencyMembershipDto, UpdateAgencyMembershipDto } from './dto/agency-membership.dto';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { UpdateAgencyDto } from './dto/update-agency.dto';

@ApiTags('agencies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agencies')
export class AgenciesController {
  constructor(private readonly agencies: AgenciesService) {}

  @Post()
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.agencyCreate)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateAgencyDto,
  ) {
    return this.agencies.create(user, dto, tenant);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.agencies.list(user.id);
  }

  @Get(':agencyId')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.agencyRead)
  get(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.agencies.get(tenant);
  }

  @Patch(':agencyId')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.agencyUpdate)
  update(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Body() dto: UpdateAgencyDto) {
    return this.agencies.update(tenant, dto);
  }

  @Get(':agencyId/memberships')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.agencyMemberRead)
  listMemberships(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.agencies.listMemberships(tenant);
  }

  @Post(':agencyId/memberships')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.agencyMemberCreate)
  addMembership(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Body() dto: CreateAgencyMembershipDto,
  ) {
    return this.agencies.addMembership(tenant, dto);
  }

  @Patch(':agencyId/memberships/:id')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.agencyMemberUpdate)
  updateMembership(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @Param() params: AgencyMembershipParamsDto,
    @Body() dto: UpdateAgencyMembershipDto,
  ) {
    return this.agencies.updateMembership(tenant, params.id, dto);
  }
}
