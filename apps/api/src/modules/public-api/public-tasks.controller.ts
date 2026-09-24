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
import { TasksService } from '../tasks/tasks.service';
import { CurrentPublicApi, RequirePublicApiScopes } from './decorators/public-api.decorator';
import {
  PublicCreateTaskDto,
  PublicTaskQueryDto,
  PublicUpdateTaskDto,
} from './dto/public-resource.dto';
import { PublicApiAuthGuard } from './guards/public-api-auth.guard';
import { PublicApiRateLimitGuard } from './guards/public-api-rate-limit.guard';
import { PublicApiScopeGuard } from './guards/public-api-scope.guard';
import { PublicApiExceptionFilter } from './public-api-exception.filter';
import { PublicApiIdempotencyService } from './public-api-idempotency.service';
import { publicData, publicList } from './public-api.response';
import type { PublicApiPrincipal } from './public-api.types';

@ApiTags('public api tasks')
@ApiBearerAuth()
@UseFilters(PublicApiExceptionFilter)
@UseGuards(PublicApiAuthGuard, PublicApiRateLimitGuard, PublicApiScopeGuard)
@Controller('public/tasks')
export class PublicTasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly idempotency: PublicApiIdempotencyService,
  ) {}

  @Get()
  @RequirePublicApiScopes('tasks.read', 'tasks.write')
  async list(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Query() query: PublicTaskQueryDto,
  ) {
    return publicList(await this.tasks.list(principal.tenant, query));
  }

  @Get(':id')
  @RequirePublicApiScopes('tasks.read', 'tasks.write')
  async get(@CurrentPublicApi() principal: PublicApiPrincipal, @Param() params: UuidParamDto) {
    return publicData(await this.tasks.get(principal.tenant, params.id));
  }

  @Post()
  @RequirePublicApiScopes('tasks.write')
  async create(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Body() dto: PublicCreateTaskDto,
    @Req() request: Request,
  ) {
    const data = await this.idempotency.run(principal, {
      key: request.header('idempotency-key'),
      method: 'POST',
      routeKey: '/api/v1/public/tasks',
      body: dto,
      handler: () => this.tasks.create(principal.tenant, dto),
    });
    return publicData(data);
  }

  @Patch(':id')
  @RequirePublicApiScopes('tasks.write')
  async update(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Param() params: UuidParamDto,
    @Body() dto: PublicUpdateTaskDto,
  ) {
    return publicData(await this.tasks.update(principal.tenant, params.id, dto));
  }
}
