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
import { CalendarService } from './calendar.service';
import {
  CalendarEventParamsDto,
  CalendarQueryDto,
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

@ApiTags('workspace calendar')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions(PermissionKeys.calendarView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: CalendarQueryDto) {
    return this.calendar.list(tenant, query);
  }

  @Post('events')
  @RequirePermissions(PermissionKeys.calendarEventsCreate)
  createEvent(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.calendar.createCustomEvent(tenant, dto);
  }

  @Get('events/:eventId')
  @RequirePermissions(PermissionKeys.calendarView)
  getEvent(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: CalendarEventParamsDto,
  ) {
    return this.calendar.getCustomEvent(tenant, params.eventId);
  }

  @Patch('events/:eventId')
  @RequirePermissions(PermissionKeys.calendarView)
  updateEvent(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: CalendarEventParamsDto,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendar.updateCustomEvent(tenant, params.eventId, dto);
  }

  @Post('events/:eventId/cancel')
  @RequirePermissions(PermissionKeys.calendarView)
  cancelEvent(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: CalendarEventParamsDto,
  ) {
    return this.calendar.cancelCustomEvent(tenant, params.eventId);
  }
}
