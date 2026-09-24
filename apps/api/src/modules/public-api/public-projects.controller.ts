import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { UuidParamDto } from '../../common/dto/uuid-param.dto';
import { ProjectsService } from '../projects/projects.service';
import { CurrentPublicApi, RequirePublicApiScopes } from './decorators/public-api.decorator';
import {
  PublicCreateProjectDto,
  PublicProjectQueryDto,
  PublicUpdateProjectDto,
} from './dto/public-resource.dto';
import { PublicApiAuthGuard } from './guards/public-api-auth.guard';
import { PublicApiRateLimitGuard } from './guards/public-api-rate-limit.guard';
import { PublicApiScopeGuard } from './guards/public-api-scope.guard';
import { PublicApiExceptionFilter } from './public-api-exception.filter';
import { PublicApiIdempotencyService } from './public-api-idempotency.service';
import { publicData, publicList } from './public-api.response';
import type { PublicApiPrincipal } from './public-api.types';

@ApiTags('public api projects')
@ApiBearerAuth()
@UseFilters(PublicApiExceptionFilter)
@UseGuards(PublicApiAuthGuard, PublicApiRateLimitGuard, PublicApiScopeGuard)
@Controller('public/projects')
export class PublicProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly idempotency: PublicApiIdempotencyService,
  ) {}

  @Get()
  @RequirePublicApiScopes('projects.read', 'projects.write')
  async list(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Query() query: PublicProjectQueryDto,
  ) {
    return publicList(await this.projects.list(principal.tenant, query));
  }

  @Get(':id')
  @RequirePublicApiScopes('projects.read', 'projects.write')
  async get(@CurrentPublicApi() principal: PublicApiPrincipal, @Param() params: UuidParamDto) {
    return publicData(await this.projects.get(principal.tenant, params.id));
  }

  @Post()
  @RequirePublicApiScopes('projects.write')
  async create(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Body() dto: PublicCreateProjectDto,
    @Req() request: Request,
  ) {
    const data = await this.idempotency.run(principal, {
      key: request.header('idempotency-key'),
      method: 'POST',
      routeKey: '/api/v1/public/projects',
      body: dto,
      handler: () => this.projects.create(principal.tenant, dto),
    });
    return publicData(data);
  }

  @Patch(':id')
  @RequirePublicApiScopes('projects.write')
  async update(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Param() params: UuidParamDto,
    @Body() dto: PublicUpdateProjectDto,
  ) {
    return publicData(await this.projects.update(principal.tenant, params.id, dto));
  }
}
