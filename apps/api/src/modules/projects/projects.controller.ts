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
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UuidParamDto } from '../../common/dto/uuid-param.dto';
import {
  AGENCY_HEADER,
  CurrentWorkspaceTenant,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import { WorkspaceTenantGuard } from '../../common/tenant/tenant-context.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @RequirePermissions(PermissionKeys.projectCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(tenant, dto);
  }

  @Get()
  @RequirePermissions(PermissionKeys.projectRead)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: PaginationDto) {
    return this.projects.list(tenant, query);
  }

  @Get(':id')
  @RequirePermissions(PermissionKeys.projectRead)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: UuidParamDto) {
    return this.projects.get(tenant, params.id);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.projectUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(tenant, params.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.projectDelete)
  remove(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: UuidParamDto) {
    return this.projects.archive(tenant, params.id);
  }
}
