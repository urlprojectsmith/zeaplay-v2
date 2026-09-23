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
  NotificationListQueryDto,
  NotificationParamsDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('workspace notifications')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.notificationsView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: NotificationListQueryDto,
  ) {
    return this.notifications.listForMembership(tenant, query);
  }

  @Get('unread-count')
  @RequirePermissions(PermissionKeys.notificationsView)
  unreadCount(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.notifications.getUnreadCount(tenant);
  }

  @Get('preferences')
  @RequirePermissions(PermissionKeys.notificationsPreferencesManageSelf)
  preferences(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.notifications.listPreferences(tenant);
  }

  @Patch('preferences')
  @RequirePermissions(PermissionKeys.notificationsPreferencesManageSelf)
  updatePreferences(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(tenant, dto);
  }

  @Post('read-all')
  @RequirePermissions(PermissionKeys.notificationsView)
  readAll(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.notifications.markAllRead(tenant);
  }

  @Post(':notificationId/read')
  @RequirePermissions(PermissionKeys.notificationsView)
  markRead(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: NotificationParamsDto,
  ) {
    return this.notifications.markRead(tenant, params.notificationId);
  }

  @Post(':notificationId/unread')
  @RequirePermissions(PermissionKeys.notificationsView)
  markUnread(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: NotificationParamsDto,
  ) {
    return this.notifications.markUnread(tenant, params.notificationId);
  }
}
