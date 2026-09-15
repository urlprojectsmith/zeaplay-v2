import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import { CurrentTenant, ORGANIZATION_HEADER } from '../../common/tenant/tenant-context.decorator';
import { TenantContextGuard } from '../../common/tenant/tenant-context.guard';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { MembershipParamsDto } from './dto/membership-params.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('memberships')
@ApiBearerAuth()
@ApiHeader({ name: ORGANIZATION_HEADER, required: true })
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
@Controller('organizations/:organizationId/memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.memberRead)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.memberships.list(tenant);
  }

  @Post()
  @RequirePermissions(PermissionKeys.memberCreate)
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateMembershipDto) {
    return this.memberships.addExistingUser(tenant, dto);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.memberUpdate)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param() params: MembershipParamsDto,
    @Body() dto: UpdateMembershipDto,
  ) {
    return this.memberships.update(tenant, params.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.memberDelete)
  remove(@CurrentTenant() tenant: TenantContext, @Param() params: MembershipParamsDto) {
    return this.memberships.suspend(tenant, params.id);
  }
}
