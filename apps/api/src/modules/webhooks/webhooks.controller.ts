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
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
  WebhookDeliveryIdParamDto,
  WebhookDeliveryListQueryDto,
  WebhookListQueryDto,
  WebhookSubscriptionIdParamDto,
} from './dto/webhook.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('workspace webhooks')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('webhooks')
  @RequirePermissions(PermissionKeys.webhooksView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: WebhookListQueryDto,
  ) {
    return this.webhooks.list(tenant, query);
  }

  @Post('webhooks')
  @RequirePermissions(PermissionKeys.webhooksCreate)
  create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateWebhookSubscriptionDto,
  ) {
    return this.webhooks.create(tenant, dto);
  }

  @Patch('webhooks/:webhookId')
  @RequirePermissions(PermissionKeys.webhooksManage)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WebhookSubscriptionIdParamDto,
    @Body() dto: UpdateWebhookSubscriptionDto,
  ) {
    return this.webhooks.update(tenant, params.webhookId, dto);
  }

  @Post('webhooks/:webhookId/disable')
  @RequirePermissions(PermissionKeys.webhooksManage)
  disable(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WebhookSubscriptionIdParamDto,
  ) {
    return this.webhooks.disable(tenant, params.webhookId);
  }

  @Post('webhooks/:webhookId/rotate-secret')
  @RequirePermissions(PermissionKeys.webhooksManage)
  rotateSecret(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WebhookSubscriptionIdParamDto,
  ) {
    return this.webhooks.rotateSecret(tenant, params.webhookId);
  }

  @Post('webhooks/:webhookId/test')
  @RequirePermissions(PermissionKeys.webhooksManage)
  sendTest(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WebhookSubscriptionIdParamDto,
  ) {
    return this.webhooks.sendTest(tenant, params.webhookId);
  }

  @Get('webhooks/:webhookId/deliveries')
  @RequirePermissions(PermissionKeys.webhooksView)
  listDeliveries(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WebhookSubscriptionIdParamDto,
    @Query() query: WebhookDeliveryListQueryDto,
  ) {
    return this.webhooks.listDeliveries(tenant, params.webhookId, query);
  }

  @Get('webhook-deliveries/:deliveryId')
  @RequirePermissions(PermissionKeys.webhooksView)
  getDelivery(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WebhookDeliveryIdParamDto,
  ) {
    return this.webhooks.getDelivery(tenant, params.deliveryId);
  }

  @Post('webhook-deliveries/:deliveryId/retry')
  @RequirePermissions(PermissionKeys.webhooksRetry)
  retryDelivery(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WebhookDeliveryIdParamDto,
  ) {
    return this.webhooks.retryDelivery(tenant, params.deliveryId);
  }
}
