import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AuthenticatedUser, TenantContext } from '../../common/auth/auth.types';
import { CurrentTenant, ORGANIZATION_HEADER } from '../../common/tenant/tenant-context.decorator';
import { TenantContextGuard } from '../../common/tenant/tenant-context.guard';
import { UuidParamDto } from '../../common/dto/uuid-param.dto';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.organizations.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: UuidParamDto) {
    return this.organizations.get(user.id, params.id);
  }

  @Patch(':id')
  @ApiHeader({ name: ORGANIZATION_HEADER, required: true })
  @UseGuards(TenantContextGuard)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateOrganizationDto,
  ) {
    if (tenant.organizationId !== params.id) {
      throw new ForbiddenException('Organization context does not match the requested resource.');
    }
    return this.organizations.update(tenant, dto);
  }
}
