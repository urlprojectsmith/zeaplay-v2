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
import { TicketsService } from '../tickets/tickets.service';
import { CurrentPublicApi, RequirePublicApiScopes } from './decorators/public-api.decorator';
import {
  PublicCreateTicketDto,
  PublicTicketQueryDto,
  PublicUpdateTicketDto,
} from './dto/public-resource.dto';
import { PublicApiAuthGuard } from './guards/public-api-auth.guard';
import { PublicApiRateLimitGuard } from './guards/public-api-rate-limit.guard';
import { PublicApiScopeGuard } from './guards/public-api-scope.guard';
import { PublicApiExceptionFilter } from './public-api-exception.filter';
import { PublicApiIdempotencyService } from './public-api-idempotency.service';
import { publicData, publicList } from './public-api.response';
import type { PublicApiPrincipal } from './public-api.types';

@ApiTags('public api tickets')
@ApiBearerAuth()
@UseFilters(PublicApiExceptionFilter)
@UseGuards(PublicApiAuthGuard, PublicApiRateLimitGuard, PublicApiScopeGuard)
@Controller('public/tickets')
export class PublicTicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly idempotency: PublicApiIdempotencyService,
  ) {}

  @Get()
  @RequirePublicApiScopes('tickets.read', 'tickets.write')
  async list(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Query() query: PublicTicketQueryDto,
  ) {
    return publicList(await this.tickets.list(principal.tenant, query));
  }

  @Get(':id')
  @RequirePublicApiScopes('tickets.read', 'tickets.write')
  async get(@CurrentPublicApi() principal: PublicApiPrincipal, @Param() params: UuidParamDto) {
    return publicData(await this.tickets.get(principal.tenant, params.id));
  }

  @Post()
  @RequirePublicApiScopes('tickets.write')
  async create(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Body() dto: PublicCreateTicketDto,
    @Req() request: Request,
  ) {
    const data = await this.idempotency.run(principal, {
      key: request.header('idempotency-key'),
      method: 'POST',
      routeKey: '/api/v1/public/tickets',
      body: dto,
      handler: () => this.tickets.create(principal.tenant, dto),
    });
    return publicData(data);
  }

  @Patch(':id')
  @RequirePublicApiScopes('tickets.write')
  async update(
    @CurrentPublicApi() principal: PublicApiPrincipal,
    @Param() params: UuidParamDto,
    @Body() dto: PublicUpdateTicketDto,
  ) {
    return publicData(await this.tickets.update(principal.tenant, params.id, dto));
  }
}
