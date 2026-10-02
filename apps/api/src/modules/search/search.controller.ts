import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
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
import { SearchQueryDto, SearchRebuildDto } from './dto/search.dto';
import { SearchPlatformGuard } from './search-platform.guard';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchRegistryController {
  constructor(private readonly search: SearchService) {}

  @Get('registry')
  registry() {
    return this.search.registry();
  }
}

@ApiTags('workspace search')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/search')
export class WorkspaceSearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermissions(PermissionKeys.searchView)
  async query(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() dto: SearchQueryDto,
  ) {
    return this.search.search(
      await this.search.workspaceScope(tenant),
      this.search.workspaceActor(tenant),
      dto,
    );
  }

  @Get('recent')
  @RequirePermissions(PermissionKeys.searchView)
  async recent(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.search.recent(
      await this.search.workspaceScope(tenant),
      this.search.workspaceActor(tenant),
    );
  }

  @Delete('recent')
  @RequirePermissions(PermissionKeys.searchView)
  async clearRecent(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.search.clearRecent(
      await this.search.workspaceScope(tenant),
      this.search.workspaceActor(tenant),
    );
  }
}

@ApiTags('agency search')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/search')
export class AgencySearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermissions(PermissionKeys.searchView)
  async query(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Query() dto: SearchQueryDto) {
    return this.search.search(
      await this.search.agencyScope(tenant),
      this.search.agencyActor(tenant),
      dto,
    );
  }

  @Get('recent')
  @RequirePermissions(PermissionKeys.searchView)
  async recent(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.search.recent(
      await this.search.agencyScope(tenant),
      this.search.agencyActor(tenant),
    );
  }

  @Delete('recent')
  @RequirePermissions(PermissionKeys.searchView)
  async clearRecent(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.search.clearRecent(
      await this.search.agencyScope(tenant),
      this.search.agencyActor(tenant),
    );
  }
}

@ApiTags('super agency search')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/search')
export class SuperAgencySearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RequirePermissions(PermissionKeys.searchView)
  async query(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() dto: SearchQueryDto,
  ) {
    return this.search.search(
      await this.search.superAgencyScope(tenant),
      this.search.superAgencyActor(tenant),
      dto,
    );
  }

  @Get('recent')
  @RequirePermissions(PermissionKeys.searchView)
  async recent(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.search.recent(
      await this.search.superAgencyScope(tenant),
      this.search.superAgencyActor(tenant),
    );
  }

  @Delete('recent')
  @RequirePermissions(PermissionKeys.searchView)
  async clearRecent(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.search.clearRecent(
      await this.search.superAgencyScope(tenant),
      this.search.superAgencyActor(tenant),
    );
  }
}

@ApiTags('platform search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SearchPlatformGuard)
@Controller('platform/search')
export class PlatformSearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async query(@CurrentUser() user: AuthenticatedUser, @Query() dto: SearchQueryDto) {
    return this.search.search(this.search.platformScope(), this.search.platformActor(user), dto);
  }

  @Get('recent')
  async recent(@CurrentUser() user: AuthenticatedUser) {
    return this.search.recent(this.search.platformScope(), this.search.platformActor(user));
  }

  @Delete('recent')
  async clearRecent(@CurrentUser() user: AuthenticatedUser) {
    return this.search.clearRecent(this.search.platformScope(), this.search.platformActor(user));
  }

  @Post('rebuild')
  async rebuild(@CurrentUser() user: AuthenticatedUser, @Body() dto: SearchRebuildDto) {
    return this.search.enqueueRebuild(
      this.search.platformScope(),
      this.search.platformActor(user),
      dto.types,
    );
  }
}
