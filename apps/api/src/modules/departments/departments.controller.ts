import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentWorkspaceTenant,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import { WorkspaceTenantGuard } from '../../common/tenant/tenant-context.guard';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { DepartmentParamsDto } from './dto/department-params.dto';
import { DepartmentQueryDto } from './dto/department-query.dto';
import { DepartmentsService } from './departments.service';

@ApiTags('departments')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.departmentsView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: DepartmentQueryDto,
  ) {
    return this.departments.list(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.departmentsCreate)
  create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.departments.create(tenant, dto);
  }

  @Get(':departmentId')
  @RequirePermissions(PermissionKeys.departmentsView)
  get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DepartmentParamsDto,
  ) {
    return this.departments.get(tenant, params.departmentId);
  }

  @Patch(':departmentId')
  @RequirePermissions(PermissionKeys.departmentsUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DepartmentParamsDto,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(tenant, params.departmentId, dto);
  }

  @Get(':departmentId/members')
  @RequirePermissions(PermissionKeys.departmentsManageMembers)
  members(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DepartmentParamsDto,
    @Query() query: DepartmentQueryDto,
  ) {
    return this.departments.members(tenant, params.departmentId, query);
  }
}
