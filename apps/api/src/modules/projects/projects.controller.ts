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
import type { TenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { UuidParamDto } from '../../common/dto/uuid-param.dto';
import { CurrentTenant, ORGANIZATION_HEADER } from '../../common/tenant/tenant-context.decorator';
import { TenantContextGuard } from '../../common/tenant/tenant-context.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@ApiHeader({ name: ORGANIZATION_HEADER, required: true })
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @RequirePermissions(PermissionKeys.projectCreate)
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(tenant, dto);
  }

  @Get()
  @RequirePermissions(PermissionKeys.projectRead)
  list(@CurrentTenant() tenant: TenantContext, @Query() query: PaginationDto) {
    return this.projects.list(tenant, query);
  }

  @Get(':id')
  @RequirePermissions(PermissionKeys.projectRead)
  get(@CurrentTenant() tenant: TenantContext, @Param() params: UuidParamDto) {
    return this.projects.get(tenant, params.id);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.projectUpdate)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(tenant, params.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.projectDelete)
  remove(@CurrentTenant() tenant: TenantContext, @Param() params: UuidParamDto) {
    return this.projects.archive(tenant, params.id);
  }
}
