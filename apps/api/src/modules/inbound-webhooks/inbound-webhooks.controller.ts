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
import {
  CreateInboundWebhookSourceDto,
  InboundWebhookEventParamDto,
  InboundWebhookListQueryDto,
  InboundWebhookSourceParamDto,
  UpdateInboundWebhookSourceDto,
} from './dto/inbound-webhook.dto';
import { InboundWebhooksService } from './inbound-webhooks.service';

@ApiTags('workspace inbound webhooks')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId')
export class InboundWebhooksController {
  constructor(private readonly inboundWebhooks: InboundWebhooksService) {}

  @Get('inbound-webhooks')
  @RequirePermissions(PermissionKeys.inboundWebhooksView)
  listSources(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: InboundWebhookListQueryDto,
  ) {
    return this.inboundWebhooks.listSources(tenant, query);
  }

  @Post('inbound-webhooks')
  @RequirePermissions(PermissionKeys.inboundWebhooksCreate)
  createSource(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateInboundWebhookSourceDto,
  ) {
    return this.inboundWebhooks.createSource(tenant, dto);
  }

  @Get('inbound-webhooks/:sourceId')
  @RequirePermissions(PermissionKeys.inboundWebhooksView)
  getSource(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: InboundWebhookSourceParamDto,
  ) {
    return this.inboundWebhooks.getSource(tenant, params.sourceId);
  }

  @Patch('inbound-webhooks/:sourceId')
  @RequirePermissions(PermissionKeys.inboundWebhooksManage)
  updateSource(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: InboundWebhookSourceParamDto,
    @Body() dto: UpdateInboundWebhookSourceDto,
  ) {
    return this.inboundWebhooks.updateSource(tenant, params.sourceId, dto);
  }

  @Post('inbound-webhooks/:sourceId/rotate-secret')
  @RequirePermissions(PermissionKeys.inboundWebhooksManage)
  rotateSecret(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: InboundWebhookSourceParamDto,
  ) {
    return this.inboundWebhooks.rotateSecret(tenant, params.sourceId);
  }

  @Post('inbound-webhooks/:sourceId/disable')
  @RequirePermissions(PermissionKeys.inboundWebhooksManage)
  disableSource(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: InboundWebhookSourceParamDto,
  ) {
    return this.inboundWebhooks.disableSource(tenant, params.sourceId);
  }

  @Get('inbound-webhooks/:sourceId/events')
  @RequirePermissions(PermissionKeys.inboundWebhooksView)
  listEvents(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: InboundWebhookSourceParamDto,
    @Query() query: InboundWebhookListQueryDto,
  ) {
    return this.inboundWebhooks.listEvents(tenant, params.sourceId, query);
  }

  @Get('inbound-webhook-events/:eventId')
  @RequirePermissions(PermissionKeys.inboundWebhooksView)
  getEvent(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: InboundWebhookEventParamDto,
  ) {
    return this.inboundWebhooks.getEvent(tenant, params.eventId);
  }
}
