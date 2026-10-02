import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AnalyticsScopeType,
  DashboardStatus,
  DashboardVisibility,
  DashboardWidgetDataSourceType,
  DashboardWidgetType,
  MembershipStatus,
  Prisma,
} from '@prisma/client';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { METRIC_REGISTRY_BY_KEY } from '../analytics/analytics.registry';
import type { AnalyticsQueryDto } from '../analytics/dto/analytics.dto';
import { AuditService } from '../audit/audit.service';
import { ReportsService } from '../reports/reports.service';
import {
  CreateDashboardDto,
  CreateDashboardFromTemplateDto,
  CreateDashboardWidgetDto,
  DashboardFiltersDto,
  DashboardWidgetConfigDto,
  DashboardListQueryDto,
  DashboardPreferenceDto,
  UpdateDashboardDto,
  UpdateDashboardLayoutDto,
  UpdateDashboardWidgetDto,
  dashboardWidgetTypes,
} from './dto/custom-dashboards.dto';

const PLATFORM_SCOPE_ID = '00000000-0000-4000-8000-000000000000';
const MAX_WIDGETS_PER_DASHBOARD = 30;
const MIN_REFRESH_SECONDS = 60;

type DashboardScope = {
  type: AnalyticsScopeType;
  id: string;
  workspaceId: string | null;
  agencyId: string | null;
  superAgencyId: string | null;
};

type DashboardActor = {
  userId: string;
  permissions: string[];
  workspaceMembershipId?: string | null;
  agencyMembershipId?: string | null;
  superAgencyMembershipId?: string | null;
};

type DashboardAccessEntry = {
  workspaceMembershipId?: string | null;
  agencyMembershipId?: string | null;
  superAgencyMembershipId?: string | null;
  userId?: string | null;
};

type ReadableDashboard = {
  accesses: DashboardAccessEntry[];
  visibility: DashboardVisibility;
  createdByUserId: string | null;
};

type SerializableDashboard = ReadableDashboard & {
  id: string;
  scopeType: AnalyticsScopeType;
  scopeId: string;
  name: string;
  description: string | null;
  globalFilters: Prisma.JsonValue;
  revision: number;
  status: DashboardStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  widgets?: SerializableWidget[];
  preferences?: Array<{ isFavorite: boolean; isDefault: boolean }>;
};

type SerializableWidget = {
  id: string;
  dashboardId: string;
  type: DashboardWidgetType;
  title: string;
  description: string | null;
  dataSourceType: DashboardWidgetDataSourceType;
  configuration: Prisma.JsonValue;
  layout: Prisma.JsonValue;
  refreshSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReportsPreview = {
  preview: (scope: unknown, actor: unknown, reportId: string) => Promise<unknown>;
};

@Injectable()
export class CustomDashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  workspaceScope(tenant: WorkspaceTenantContext): Promise<DashboardScope> {
    return this.resolveScope(AnalyticsScopeType.WORKSPACE, tenant.workspaceId);
  }

  agencyScope(tenant: AgencyTenantContext): Promise<DashboardScope> {
    return this.resolveScope(AnalyticsScopeType.AGENCY, tenant.agencyId);
  }

  superAgencyScope(tenant: SuperAgencyTenantContext): Promise<DashboardScope> {
    return this.resolveScope(AnalyticsScopeType.SUPER_AGENCY, tenant.superAgencyId);
  }

  platformScope(): DashboardScope {
    return {
      type: AnalyticsScopeType.PLATFORM,
      id: PLATFORM_SCOPE_ID,
      workspaceId: null,
      agencyId: null,
      superAgencyId: null,
    };
  }

  workspaceActor(tenant: WorkspaceTenantContext): DashboardActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      workspaceMembershipId: tenant.workspaceMembershipId,
      agencyMembershipId: tenant.agencyMembershipId,
    };
  }

  agencyActor(tenant: AgencyTenantContext): DashboardActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      agencyMembershipId: tenant.agencyMembershipId,
    };
  }

  superAgencyActor(tenant: SuperAgencyTenantContext): DashboardActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      superAgencyMembershipId: tenant.superAgencyMembershipId,
    };
  }

  platformActor(user: AuthenticatedUser): DashboardActor {
    return {
      userId: user.id,
      permissions: [
        PermissionKeys.dashboardsPlatformRead,
        PermissionKeys.dashboardsView,
        PermissionKeys.dashboardsCreate,
        PermissionKeys.dashboardsEdit,
        PermissionKeys.dashboardsManage,
        PermissionKeys.analyticsPlatformRead,
        PermissionKeys.reportsPlatformRead,
        PermissionKeys.reportsView,
      ],
    };
  }

  async list(scope: DashboardScope, actor: DashboardActor, query: DashboardListQueryDto) {
    this.assertPermission(actor, PermissionKeys.dashboardsView);
    const dashboards = await this.prisma.customDashboard.findMany({
      where: {
        scopeType: scope.type,
        scopeId: scope.id,
        status: query.status ?? DashboardStatus.ACTIVE,
        ...(query.search
          ? { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
          : {}),
      },
      include: {
        accesses: true,
        widgets: true,
        preferences: { where: { userId: actor.userId } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return {
      dashboards: dashboards
        .filter((dashboard) => this.canRead(dashboard, actor))
        .map((dashboard) => serializeDashboard(dashboard)),
    };
  }

  templates(scope: DashboardScope) {
    return {
      templates: dashboardTemplates(scope.type).map((template) => ({
        key: template.key,
        name: template.name,
        description: template.description,
        widgetCount: template.widgets.length,
      })),
    };
  }

  async create(scope: DashboardScope, actor: DashboardActor, dto: CreateDashboardDto) {
    this.assertPermission(actor, PermissionKeys.dashboardsCreate);
    const visibility = normalizeVisibility(scope, dto.visibility);
    await this.assertAccessMembers(scope, dto.accessMembershipIds ?? []);
    const widgets = dto.widgets ?? [];
    if (widgets.length > MAX_WIDGETS_PER_DASHBOARD) {
      throw new BadRequestException('DASHBOARD_WIDGET_LIMIT_EXCEEDED');
    }
    for (const widget of widgets) this.validateWidget(scope, widget);
    const dashboard = await this.prisma.customDashboard.create({
      data: {
        scopeType: scope.type,
        scopeId: scope.id,
        workspaceId: scope.workspaceId,
        agencyId: scope.agencyId,
        superAgencyId: scope.superAgencyId,
        createdByUserId: actor.userId,
        createdByWorkspaceMembershipId: actor.workspaceMembershipId ?? null,
        createdByAgencyMembershipId: actor.agencyMembershipId ?? null,
        createdBySuperAgencyMembershipId: actor.superAgencyMembershipId ?? null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        visibility,
        globalFilters: sanitizeFilters(dto.globalFilters),
        accesses: { create: this.accessRows(scope, dto.accessMembershipIds ?? []) },
        widgets: { create: widgets.map((widget) => this.widgetCreateData(scope, widget)) },
      },
      include: { accesses: true, widgets: true, preferences: { where: { userId: actor.userId } } },
    });
    await this.auditDashboard(scope, actor, 'dashboard.create', dashboard.id, dashboard);
    return { dashboard: serializeDashboard(dashboard) };
  }

  async createFromTemplate(
    scope: DashboardScope,
    actor: DashboardActor,
    dto: CreateDashboardFromTemplateDto,
  ) {
    const template = dashboardTemplates(scope.type).find((item) => item.key === dto.templateKey);
    if (!template) throw new NotFoundException('DASHBOARD_TEMPLATE_NOT_FOUND');
    return this.create(scope, actor, {
      name: template.name,
      description: template.description,
      visibility: scope.type === AnalyticsScopeType.WORKSPACE ? 'PRIVATE' : 'SCOPE',
      globalFilters: { datePreset: 'LAST_30_DAYS' },
      widgets: template.widgets,
    });
  }

  async get(scope: DashboardScope, actor: DashboardActor, dashboardId: string) {
    this.assertPermission(actor, PermissionKeys.dashboardsView);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, false);
    this.assertCanRead(dashboard, actor);
    return { dashboard: serializeDashboard(dashboard) };
  }

  async render(scope: DashboardScope, actor: DashboardActor, dashboardId: string) {
    this.assertPermission(actor, PermissionKeys.dashboardsView);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanRead(dashboard, actor);
    const widgets = [...dashboard.widgets].sort(compareWidgetLayout);
    const rendered = [];
    for (const widget of widgets) {
      rendered.push(await this.renderWidget(scope, actor, dashboard, widget));
    }
    return {
      dashboard: serializeDashboard(dashboard),
      widgets: rendered,
      queryConcurrency: 1,
    };
  }

  async renderOne(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    widgetId: string,
  ) {
    this.assertPermission(actor, PermissionKeys.dashboardsView);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanRead(dashboard, actor);
    const widget = dashboard.widgets.find((item) => item.id === widgetId);
    if (!widget) throw new NotFoundException('DASHBOARD_WIDGET_NOT_FOUND');
    return { widget: await this.renderWidget(scope, actor, dashboard, widget) };
  }

  async update(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    dto: UpdateDashboardDto,
  ) {
    this.assertPermission(actor, PermissionKeys.dashboardsEdit);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, false);
    this.assertCanManage(dashboard, actor, 'DASHBOARD_EDIT_DENIED');
    this.assertRevision(dashboard, dto.expectedRevision);
    if (dto.accessMembershipIds) await this.assertAccessMembers(scope, dto.accessMembershipIds);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.accessMembershipIds) await tx.dashboardAccess.deleteMany({ where: { dashboardId } });
      return tx.customDashboard.update({
        where: { id: dashboardId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.visibility ? { visibility: normalizeVisibility(scope, dto.visibility) } : {}),
          ...(dto.globalFilters ? { globalFilters: sanitizeFilters(dto.globalFilters) } : {}),
          revision: { increment: 1 },
          ...(dto.accessMembershipIds
            ? { accesses: { create: this.accessRows(scope, dto.accessMembershipIds) } }
            : {}),
        },
        include: {
          accesses: true,
          widgets: true,
          preferences: { where: { userId: actor.userId } },
        },
      });
    });
    await this.auditDashboard(scope, actor, 'dashboard.update', dashboardId, updated);
    return { dashboard: serializeDashboard(updated) };
  }

  async archive(scope: DashboardScope, actor: DashboardActor, dashboardId: string) {
    this.assertPermission(actor, PermissionKeys.dashboardsManage);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, false);
    this.assertCanManage(dashboard, actor, 'DASHBOARD_ARCHIVE_DENIED');
    const updated = await this.prisma.customDashboard.update({
      where: { id: dashboardId },
      data: {
        status: DashboardStatus.ARCHIVED,
        archivedAt: new Date(),
        revision: { increment: 1 },
        preferences: { deleteMany: { isDefault: true } },
      },
      include: { accesses: true, widgets: true, preferences: { where: { userId: actor.userId } } },
    });
    await this.auditDashboard(scope, actor, 'dashboard.archive', dashboardId, updated);
    return { dashboard: serializeDashboard(updated) };
  }

  async restore(scope: DashboardScope, actor: DashboardActor, dashboardId: string) {
    this.assertPermission(actor, PermissionKeys.dashboardsManage);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, false);
    this.assertCanManage(dashboard, actor, 'DASHBOARD_RESTORE_DENIED');
    const updated = await this.prisma.customDashboard.update({
      where: { id: dashboardId },
      data: { status: DashboardStatus.ACTIVE, archivedAt: null, revision: { increment: 1 } },
      include: { accesses: true, widgets: true, preferences: { where: { userId: actor.userId } } },
    });
    await this.auditDashboard(scope, actor, 'dashboard.restore', dashboardId, updated);
    return { dashboard: serializeDashboard(updated) };
  }

  async duplicate(scope: DashboardScope, actor: DashboardActor, dashboardId: string) {
    this.assertPermission(actor, PermissionKeys.dashboardsCreate);
    const source = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanRead(source, actor);
    const visibility =
      scope.type === AnalyticsScopeType.WORKSPACE
        ? DashboardVisibility.PRIVATE
        : DashboardVisibility.SCOPE;
    const duplicate = await this.prisma.customDashboard.create({
      data: {
        scopeType: scope.type,
        scopeId: scope.id,
        workspaceId: scope.workspaceId,
        agencyId: scope.agencyId,
        superAgencyId: scope.superAgencyId,
        createdByUserId: actor.userId,
        createdByWorkspaceMembershipId: actor.workspaceMembershipId ?? null,
        createdByAgencyMembershipId: actor.agencyMembershipId ?? null,
        createdBySuperAgencyMembershipId: actor.superAgencyMembershipId ?? null,
        name: `${source.name} Copy`.slice(0, 160),
        description: source.description,
        visibility,
        globalFilters: inputJson(source.globalFilters),
        widgets: {
          create: source.widgets.map((widget) => ({
            type: widget.type,
            title: widget.title,
            description: widget.description,
            dataSourceType: widget.dataSourceType,
            configuration: inputJson(widget.configuration),
            layout: inputJson(widget.layout),
            refreshSeconds: widget.refreshSeconds,
          })),
        },
      },
      include: { accesses: true, widgets: true, preferences: { where: { userId: actor.userId } } },
    });
    await this.auditDashboard(scope, actor, 'dashboard.duplicate', duplicate.id, {
      sourceDashboardId: dashboardId,
    });
    return { dashboard: serializeDashboard(duplicate) };
  }

  async addWidget(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    dto: CreateDashboardWidgetDto,
  ) {
    this.assertPermission(actor, PermissionKeys.dashboardsEdit);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanManage(dashboard, actor, 'DASHBOARD_EDIT_DENIED');
    if (dashboard.widgets.length >= MAX_WIDGETS_PER_DASHBOARD) {
      throw new BadRequestException('DASHBOARD_WIDGET_LIMIT_EXCEEDED');
    }
    this.validateWidget(scope, dto);
    const widget = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dashboardWidget.create({
        data: { dashboardId, ...this.widgetCreateData(scope, dto) },
      });
      await tx.customDashboard.update({
        where: { id: dashboardId },
        data: { revision: { increment: 1 } },
      });
      return created;
    });
    await this.auditDashboard(scope, actor, 'dashboard.widget_create', dashboardId, widget);
    return { widget: serializeWidget(widget) };
  }

  async updateWidget(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    widgetId: string,
    dto: UpdateDashboardWidgetDto,
  ) {
    this.assertPermission(actor, PermissionKeys.dashboardsEdit);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanManage(dashboard, actor, 'DASHBOARD_EDIT_DENIED');
    this.assertRevision(dashboard, dto.expectedRevision);
    const existing = dashboard.widgets.find((widget) => widget.id === widgetId);
    if (!existing) throw new NotFoundException('DASHBOARD_WIDGET_NOT_FOUND');
    const candidate = {
      type: dto.type ?? existing.type,
      dataSourceType: dto.dataSourceType ?? existing.dataSourceType,
      configuration: dto.configuration ?? (existing.configuration as DashboardWidgetConfigDto),
      layout: dto.layout ?? (existing.layout as unknown as CreateDashboardWidgetDto['layout']),
      title: dto.title ?? existing.title,
      refreshSeconds: dto.refreshSeconds ?? existing.refreshSeconds,
    } as CreateDashboardWidgetDto;
    this.validateWidget(scope, candidate);
    const updated = await this.prisma.$transaction(async (tx) => {
      const widget = await tx.dashboardWidget.update({
        where: { id: widgetId },
        data: {
          ...(dto.type ? { type: dto.type as DashboardWidgetType } : {}),
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.dataSourceType
            ? { dataSourceType: dto.dataSourceType as DashboardWidgetDataSourceType }
            : {}),
          ...(dto.configuration ? { configuration: sanitizeWidgetConfig(dto.configuration) } : {}),
          ...(dto.layout ? { layout: sanitizeLayout(dto.layout) } : {}),
          ...(dto.refreshSeconds !== undefined
            ? { refreshSeconds: dto.refreshSeconds ?? null }
            : {}),
        },
      });
      await tx.customDashboard.update({
        where: { id: dashboardId },
        data: { revision: { increment: 1 } },
      });
      return widget;
    });
    await this.auditDashboard(scope, actor, 'dashboard.widget_update', dashboardId, updated);
    return { widget: serializeWidget(updated) };
  }

  async removeWidget(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    widgetId: string,
  ) {
    this.assertPermission(actor, PermissionKeys.dashboardsEdit);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanManage(dashboard, actor, 'DASHBOARD_EDIT_DENIED');
    if (!dashboard.widgets.some((widget) => widget.id === widgetId)) {
      throw new NotFoundException('DASHBOARD_WIDGET_NOT_FOUND');
    }
    await this.prisma.$transaction([
      this.prisma.dashboardWidget.delete({ where: { id: widgetId } }),
      this.prisma.customDashboard.update({
        where: { id: dashboardId },
        data: { revision: { increment: 1 } },
      }),
    ]);
    await this.auditDashboard(scope, actor, 'dashboard.widget_remove', dashboardId, { widgetId });
    return { removed: true };
  }

  async updateLayout(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    dto: UpdateDashboardLayoutDto,
  ) {
    this.assertPermission(actor, PermissionKeys.dashboardsEdit);
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanManage(dashboard, actor, 'DASHBOARD_EDIT_DENIED');
    this.assertRevision(dashboard, dto.expectedRevision);
    const widgetIds = new Set(dashboard.widgets.map((widget) => widget.id));
    for (const item of dto.layouts) {
      if (!widgetIds.has(item.widgetId))
        throw new BadRequestException('DASHBOARD_LAYOUT_WIDGET_INVALID');
      validateLayout(item.layout);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of dto.layouts) {
        await tx.dashboardWidget.update({
          where: { id: item.widgetId },
          data: { layout: sanitizeLayout(item.layout) },
        });
      }
      return tx.customDashboard.update({
        where: { id: dashboardId },
        data: { revision: { increment: 1 } },
        include: {
          accesses: true,
          widgets: true,
          preferences: { where: { userId: actor.userId } },
        },
      });
    });
    await this.auditDashboard(scope, actor, 'dashboard.layout_update', dashboardId, {
      updatedWidgets: dto.layouts.length,
    });
    return { dashboard: serializeDashboard(updated) };
  }

  async setFavorite(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    dto: DashboardPreferenceDto,
  ) {
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanRead(dashboard, actor);
    await this.upsertPreference(scope, actor, dashboardId, { favorite: dto.enabled });
    return this.get(scope, actor, dashboardId);
  }

  async setDefault(scope: DashboardScope, actor: DashboardActor, dashboardId: string) {
    const dashboard = await this.findScopedDashboard(scope, actor, dashboardId, true);
    this.assertCanRead(dashboard, actor);
    const contextKey = preferenceContext(scope);
    await this.prisma.$transaction(async (tx) => {
      await tx.dashboardPreference.updateMany({
        where: { userId: actor.userId, contextKey },
        data: { isDefault: false },
      });
      await tx.dashboardPreference.upsert({
        where: { dashboardId_userId: { dashboardId, userId: actor.userId } },
        create: {
          dashboardId,
          scopeType: scope.type,
          scopeId: scope.id,
          userId: actor.userId,
          contextKey,
          isFavorite: false,
          isDefault: true,
        },
        update: { isDefault: true, scopeType: scope.type, scopeId: scope.id, contextKey },
      });
    });
    return this.get(scope, actor, dashboardId);
  }

  private async upsertPreference(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    changes: { favorite?: boolean },
  ) {
    const existing = await this.prisma.dashboardPreference.findUnique({
      where: { dashboardId_userId: { dashboardId, userId: actor.userId } },
    });
    const nextFavorite = changes.favorite ?? existing?.isFavorite ?? false;
    const nextDefault = existing?.isDefault ?? false;
    if (!nextFavorite && !nextDefault) {
      if (existing) await this.prisma.dashboardPreference.delete({ where: { id: existing.id } });
      return;
    }
    await this.prisma.dashboardPreference.upsert({
      where: { dashboardId_userId: { dashboardId, userId: actor.userId } },
      create: {
        dashboardId,
        scopeType: scope.type,
        scopeId: scope.id,
        userId: actor.userId,
        contextKey: preferenceContext(scope),
        isFavorite: nextFavorite,
        isDefault: nextDefault,
      },
      update: { isFavorite: nextFavorite, scopeType: scope.type, scopeId: scope.id },
    });
  }

  private async renderWidget(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboard: SerializableDashboard,
    widget: SerializableWidget,
  ) {
    try {
      if (widget.dataSourceType === DashboardWidgetDataSourceType.SAVED_REPORT) {
        const reportId = safeRecord(widget.configuration).reportId;
        if (typeof reportId !== 'string') throw new BadRequestException('DASHBOARD_REPORT_INVALID');
        this.assertPermission(actor, PermissionKeys.reportsView);
        const result = await (this.reports as unknown as ReportsPreview).preview(
          scope,
          actor,
          reportId,
        );
        return {
          widget: serializeWidget(widget),
          status: 'SUCCESS',
          data: result,
        };
      }
      this.assertAnalyticsPermission(scope, actor);
      const query = toAnalyticsQuery(
        scope,
        mergeFilters(
          dashboard.globalFilters as DashboardFiltersDto,
          widget.configuration as unknown as DashboardWidgetConfigDto,
        ),
      );
      const data = await this.executeAnalytics(scope, actor, query);
      return { widget: serializeWidget(widget), status: 'SUCCESS', data };
    } catch (error) {
      return {
        widget: serializeWidget(widget),
        status: unavailableStatus(error),
        errorCode: safeErrorCode(error),
      };
    }
  }

  private async executeAnalytics(
    scope: DashboardScope,
    actor: DashboardActor,
    query: AnalyticsQueryDto,
  ) {
    if (scope.type === AnalyticsScopeType.WORKSPACE) {
      return this.analytics.workspaceSummary(
        {
          userId: actor.userId,
          superAgencyId: scope.superAgencyId ?? undefined,
          agencyId: scope.agencyId ?? '',
          workspaceId: scope.id,
          workspaceMembershipId: actor.workspaceMembershipId ?? null,
          agencyMembershipId: actor.agencyMembershipId ?? null,
          roleId: '',
          roleName: '',
          permissions: actor.permissions,
          accessSource: 'WORKSPACE_MEMBERSHIP',
        },
        query,
      );
    }
    if (scope.type === AnalyticsScopeType.AGENCY) {
      return this.analytics.agencySummary(
        {
          userId: actor.userId,
          superAgencyId: scope.superAgencyId ?? undefined,
          agencyId: scope.id,
          agencyMembershipId: actor.agencyMembershipId ?? '',
          roleId: '',
          roleName: '',
          permissions: actor.permissions,
        },
        query,
      );
    }
    if (scope.type === AnalyticsScopeType.SUPER_AGENCY) {
      return this.analytics.superAgencySummary(
        {
          userId: actor.userId,
          superAgencyId: scope.id,
          superAgencyMembershipId: actor.superAgencyMembershipId ?? '',
          roleId: '',
          roleName: '',
          permissions: actor.permissions,
          status: 'ACTIVE',
        },
        query,
      );
    }
    return this.analytics.platformSummary(query);
  }

  private async resolveScope(type: AnalyticsScopeType, id: string): Promise<DashboardScope> {
    if (type === AnalyticsScopeType.WORKSPACE) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id },
        select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
      });
      if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
      return {
        type,
        id,
        workspaceId: id,
        agencyId: workspace.agencyId,
        superAgencyId: workspace.agency.superAgencyId,
      };
    }
    if (type === AnalyticsScopeType.AGENCY) {
      const agency = await this.prisma.agency.findUnique({
        where: { id },
        select: { id: true, superAgencyId: true },
      });
      if (!agency) throw new NotFoundException('AGENCY_NOT_FOUND');
      return { type, id, workspaceId: null, agencyId: id, superAgencyId: agency.superAgencyId };
    }
    const superAgency = await this.prisma.superAgency.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!superAgency) throw new NotFoundException('SUPER_AGENCY_NOT_FOUND');
    return { type, id, workspaceId: null, agencyId: null, superAgencyId: id };
  }

  private async findScopedDashboard(
    scope: DashboardScope,
    actor: DashboardActor,
    dashboardId: string,
    activeOnly: boolean,
  ) {
    const dashboard = await this.prisma.customDashboard.findFirst({
      where: {
        id: dashboardId,
        scopeType: scope.type,
        scopeId: scope.id,
        ...(activeOnly ? { status: DashboardStatus.ACTIVE } : {}),
      },
      include: {
        accesses: true,
        widgets: true,
        preferences: { where: { userId: actor.userId } },
      },
    });
    if (!dashboard) throw new NotFoundException('DASHBOARD_NOT_FOUND');
    return dashboard;
  }

  private validateWidget(scope: DashboardScope, widget: CreateDashboardWidgetDto) {
    rejectDangerousConfig(widget.configuration);
    validateLayout(widget.layout);
    if (widget.refreshSeconds !== undefined && widget.refreshSeconds !== null) {
      if (widget.refreshSeconds < MIN_REFRESH_SECONDS) {
        throw new BadRequestException('DASHBOARD_REFRESH_INTERVAL_TOO_LOW');
      }
    }
    if (widget.dataSourceType === 'SAVED_REPORT') {
      if (!widget.configuration.reportId)
        throw new BadRequestException('DASHBOARD_REPORT_REQUIRED');
      if (widget.configuration.metricKeys?.length) {
        throw new BadRequestException('DASHBOARD_REPORT_WIDGET_CONFIG_INVALID');
      }
      return;
    }
    const metricKeys = widget.configuration.metricKeys ?? [];
    if (!metricKeys.length) throw new BadRequestException('DASHBOARD_WIDGET_METRIC_REQUIRED');
    for (const key of metricKeys) {
      const metric = METRIC_REGISTRY_BY_KEY.get(key);
      if (!metric) throw new BadRequestException('DASHBOARD_WIDGET_METRIC_INVALID');
      if (metric.financialSensitivity && !isFinancialScope(scope)) {
        throw new ForbiddenException('DASHBOARD_FINANCIAL_WIDGET_DENIED');
      }
      if (!metric.supportedScopes.includes(scope.type)) {
        throw new BadRequestException('DASHBOARD_WIDGET_METRIC_SCOPE_INVALID');
      }
      if (
        widget.configuration.dimension &&
        !metric.supportedDimensions.includes(widget.configuration.dimension)
      ) {
        throw new BadRequestException('DASHBOARD_WIDGET_DIMENSION_INVALID');
      }
    }
    if (widget.type === 'TABLE' && !widget.configuration.dimension) {
      throw new BadRequestException('DASHBOARD_TABLE_DIMENSION_REQUIRED');
    }
    if (widget.type === 'GOAL_PROGRESS' && !metricKeys.every((key) => key.startsWith('goals.'))) {
      throw new BadRequestException('DASHBOARD_GOAL_WIDGET_METRIC_INVALID');
    }
    if (
      widget.type === 'GAMIFICATION_SUMMARY' &&
      !metricKeys.every((key) => key.startsWith('gamification.'))
    ) {
      throw new BadRequestException('DASHBOARD_GAMIFICATION_WIDGET_METRIC_INVALID');
    }
  }

  private widgetCreateData(scope: DashboardScope, widget: CreateDashboardWidgetDto) {
    this.validateWidget(scope, widget);
    return {
      type: widget.type as DashboardWidgetType,
      title: widget.title.trim(),
      description: widget.description?.trim() || null,
      dataSourceType: widget.dataSourceType as DashboardWidgetDataSourceType,
      configuration: sanitizeWidgetConfig(widget.configuration),
      layout: sanitizeLayout(widget.layout),
      refreshSeconds: widget.refreshSeconds ?? null,
    };
  }

  private assertCanRead(dashboard: ReadableDashboard, actor: DashboardActor) {
    if (!this.canRead(dashboard, actor)) throw new ForbiddenException('DASHBOARD_ACCESS_DENIED');
  }

  private assertCanManage(dashboard: ReadableDashboard, actor: DashboardActor, code: string) {
    if (!this.canManage(dashboard, actor)) throw new ForbiddenException(code);
  }

  private assertRevision(dashboard: { revision: number }, expectedRevision: number) {
    if (dashboard.revision !== expectedRevision) {
      throw new ConflictException({
        code: 'DASHBOARD_REVISION_CONFLICT',
        currentRevision: dashboard.revision,
      });
    }
  }

  private canRead(dashboard: ReadableDashboard, actor: DashboardActor) {
    if (this.canManage(dashboard, actor)) return true;
    if (
      dashboard.visibility === DashboardVisibility.WORKSPACE ||
      dashboard.visibility === DashboardVisibility.SCOPE
    ) {
      return true;
    }
    if (dashboard.createdByUserId === actor.userId) return true;
    if (dashboard.visibility === DashboardVisibility.SELECTED_MEMBERS) {
      return dashboard.accesses.some((access) =>
        Boolean(
          (actor.workspaceMembershipId &&
            access.workspaceMembershipId === actor.workspaceMembershipId) ||
          (actor.agencyMembershipId && access.agencyMembershipId === actor.agencyMembershipId) ||
          (actor.superAgencyMembershipId &&
            access.superAgencyMembershipId === actor.superAgencyMembershipId) ||
          access.userId === actor.userId,
        ),
      );
    }
    return false;
  }

  private canManage(dashboard: ReadableDashboard, actor: DashboardActor) {
    return (
      dashboard.createdByUserId === actor.userId ||
      actor.permissions.includes(PermissionKeys.dashboardsManage) ||
      actor.permissions.includes('*')
    );
  }

  private assertPermission(actor: DashboardActor, permission: string) {
    if (!actor.permissions.includes('*') && !actor.permissions.includes(permission)) {
      throw new ForbiddenException('DASHBOARD_PERMISSION_DENIED');
    }
  }

  private assertAnalyticsPermission(scope: DashboardScope, actor: DashboardActor) {
    const permission =
      scope.type === AnalyticsScopeType.WORKSPACE
        ? PermissionKeys.analyticsView
        : scope.type === AnalyticsScopeType.PLATFORM
          ? PermissionKeys.analyticsPlatformRead
          : PermissionKeys.analyticsParentRead;
    if (!actor.permissions.includes('*') && !actor.permissions.includes(permission)) {
      throw new ForbiddenException('DASHBOARD_ANALYTICS_PERMISSION_DENIED');
    }
  }

  private async assertAccessMembers(scope: DashboardScope, membershipIds: string[]) {
    if (!membershipIds.length) return;
    const uniqueCount = new Set(membershipIds).size;
    if (scope.type === AnalyticsScopeType.WORKSPACE) {
      const count = await this.prisma.workspaceMembership.count({
        where: {
          id: { in: membershipIds },
          workspaceId: scope.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      if (count !== uniqueCount) throw new BadRequestException('DASHBOARD_ACCESS_MEMBER_INVALID');
      return;
    }
    if (scope.type === AnalyticsScopeType.AGENCY) {
      const count = await this.prisma.agencyMembership.count({
        where: { id: { in: membershipIds }, agencyId: scope.id, status: MembershipStatus.ACTIVE },
      });
      if (count !== uniqueCount) throw new BadRequestException('DASHBOARD_ACCESS_MEMBER_INVALID');
      return;
    }
    if (scope.type === AnalyticsScopeType.SUPER_AGENCY) {
      const count = await this.prisma.superAgencyMembership.count({
        where: {
          id: { in: membershipIds },
          superAgencyId: scope.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      if (count !== uniqueCount) throw new BadRequestException('DASHBOARD_ACCESS_MEMBER_INVALID');
      return;
    }
    const count = await this.prisma.user.count({ where: { id: { in: membershipIds } } });
    if (count !== uniqueCount) throw new BadRequestException('DASHBOARD_ACCESS_MEMBER_INVALID');
  }

  private accessRows(scope: DashboardScope, membershipIds: string[]) {
    return [...new Set(membershipIds)].map((membershipId) => ({
      scopeType: scope.type,
      scopeId: scope.id,
      workspaceMembershipId: scope.type === AnalyticsScopeType.WORKSPACE ? membershipId : null,
      agencyMembershipId: scope.type === AnalyticsScopeType.AGENCY ? membershipId : null,
      superAgencyMembershipId: scope.type === AnalyticsScopeType.SUPER_AGENCY ? membershipId : null,
      userId: scope.type === AnalyticsScopeType.PLATFORM ? membershipId : null,
    }));
  }

  private auditDashboard(
    scope: DashboardScope,
    actor: DashboardActor,
    action: string,
    dashboardId: string,
    metadata: unknown,
  ) {
    return this.audit.record({
      superAgencyId: scope.superAgencyId,
      agencyId: scope.agencyId,
      workspaceId: scope.workspaceId,
      userId: actor.userId,
      action,
      entityType: 'CustomDashboard',
      entityId: dashboardId,
      metadata: {
        scopeType: scope.type,
        scopeId: scope.id,
        summary: auditSummary(metadata),
      },
    });
  }
}

function normalizeVisibility(scope: DashboardScope, visibility?: string) {
  const value = visibility ?? (scope.type === AnalyticsScopeType.WORKSPACE ? 'PRIVATE' : 'SCOPE');
  if (scope.type === AnalyticsScopeType.WORKSPACE) {
    if (!['PRIVATE', 'SELECTED_MEMBERS', 'WORKSPACE'].includes(value)) {
      throw new BadRequestException('DASHBOARD_VISIBILITY_INVALID');
    }
    return value as DashboardVisibility;
  }
  if (!['PRIVATE', 'SELECTED_MEMBERS', 'SCOPE'].includes(value)) {
    throw new BadRequestException('DASHBOARD_VISIBILITY_INVALID');
  }
  return value as DashboardVisibility;
}

function sanitizeFilters(filters?: DashboardFiltersDto): Prisma.InputJsonValue {
  if (!filters) return {};
  rejectDangerousConfig(filters);
  return {
    datePreset: filters.datePreset ?? null,
    start: filters.start ?? null,
    end: filters.end ?? null,
    workspaceId: filters.workspaceId ?? null,
    agencyId: filters.agencyId ?? null,
    departmentId: filters.departmentId ?? null,
    status: filters.status ?? null,
    priority: filters.priority ?? null,
  };
}

function sanitizeWidgetConfig(config: unknown): Prisma.InputJsonValue {
  rejectDangerousConfig(config);
  const widgetConfig = config as CreateDashboardWidgetDto['configuration'];
  return {
    metricKeys: [...new Set(widgetConfig.metricKeys ?? [])].map((metric) => metric.trim()),
    datePreset: widgetConfig.datePreset ?? null,
    start: widgetConfig.start ?? null,
    end: widgetConfig.end ?? null,
    bucket: widgetConfig.bucket ?? 'DAY',
    dimension: widgetConfig.dimension ?? null,
    filters: sanitizeFilters(widgetConfig.filters),
    inheritGlobalFilters: widgetConfig.inheritGlobalFilters ?? true,
    reportId: widgetConfig.reportId ?? null,
  };
}

function sanitizeLayout(layout: CreateDashboardWidgetDto['layout']): Prisma.InputJsonValue {
  validateLayout(layout);
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    breakpoint: layout.breakpoint ?? 'desktop',
    order: layout.order ?? layout.y * 12 + layout.x,
  };
}

function validateLayout(layout: CreateDashboardWidgetDto['layout']) {
  if (layout.x < 0 || layout.y < 0 || layout.width <= 0 || layout.height <= 0) {
    throw new BadRequestException('DASHBOARD_LAYOUT_INVALID');
  }
  if (layout.x + layout.width > 12 || layout.height > 24 || layout.y > 200) {
    throw new BadRequestException('DASHBOARD_LAYOUT_INVALID');
  }
}

function mergeFilters(globalFilters: DashboardFiltersDto, widgetConfig: DashboardWidgetConfigDto) {
  const inherit = widgetConfig.inheritGlobalFilters !== false;
  const local = widgetConfig.filters ?? {};
  return {
    ...widgetConfig,
    ...(inherit ? safeRecord(globalFilters) : {}),
    ...safeRecord(local),
    datePreset:
      widgetConfig.datePreset ?? local.datePreset ?? globalFilters.datePreset ?? 'LAST_30_DAYS',
    start: widgetConfig.start ?? local.start ?? globalFilters.start,
    end: widgetConfig.end ?? local.end ?? globalFilters.end,
  };
}

function toAnalyticsQuery(
  scope: DashboardScope,
  config: DashboardWidgetConfigDto & DashboardFiltersDto,
): AnalyticsQueryDto {
  return {
    metrics: [...new Set(config.metricKeys ?? [])].join(','),
    datePreset: config.datePreset ?? 'LAST_30_DAYS',
    start: config.start,
    end: config.end,
    bucket: config.bucket ?? 'DAY',
    dimension: config.dimension,
    workspaceId: scope.type === AnalyticsScopeType.WORKSPACE ? scope.id : config.workspaceId,
    agencyId: scope.type === AnalyticsScopeType.AGENCY ? scope.id : config.agencyId,
    departmentId: config.departmentId,
    status: config.status,
    priority: config.priority,
    page: 1,
    pageSize: 50,
  };
}

function isFinancialScope(scope: DashboardScope) {
  return (
    scope.type === AnalyticsScopeType.SUPER_AGENCY || scope.type === AnalyticsScopeType.PLATFORM
  );
}

function rejectDangerousConfig(value: unknown) {
  const stack = [value];
  const forbiddenKeys = new Set([
    'sql',
    'prisma',
    'formula',
    'html',
    'script',
    'iframe',
    'javascript',
  ]);
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (current && typeof current === 'object') {
      for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
        const lowered = key.toLowerCase();
        if (forbiddenKeys.has(lowered) || lowered.includes('customsql')) {
          throw new BadRequestException('DASHBOARD_WIDGET_CONFIG_FORBIDDEN');
        }
        stack.push(nested);
      }
      continue;
    }
    if (typeof current === 'string') {
      const text = current.toLowerCase();
      if (
        text.includes('<script') ||
        text.includes('javascript:') ||
        /\b(select|insert|update|delete|drop|alter)\b/.test(text)
      ) {
        throw new BadRequestException('DASHBOARD_WIDGET_CONFIG_FORBIDDEN');
      }
    }
  }
}

function inputJson(value: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compareWidgetLayout(a: SerializableWidget, b: SerializableWidget) {
  const left = safeRecord(a.layout);
  const right = safeRecord(b.layout);
  return (
    Number(left.order ?? 0) - Number(right.order ?? 0) ||
    Number(left.y ?? 0) - Number(right.y ?? 0) ||
    Number(left.x ?? 0) - Number(right.x ?? 0)
  );
}

function unavailableStatus(error: unknown) {
  if (error instanceof ForbiddenException) return 'ACCESS_REVOKED';
  if (error instanceof NotFoundException) return 'UNAVAILABLE';
  return 'ERROR';
}

function safeErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message).slice(0, 120);
  }
  return 'DASHBOARD_WIDGET_FAILED';
}

function preferenceContext(scope: DashboardScope) {
  return `${scope.type}:${scope.id}`;
}

function serializeDashboard(dashboard: SerializableDashboard) {
  const preference = dashboard.preferences?.[0];
  return {
    id: dashboard.id,
    scopeType: dashboard.scopeType,
    scopeId: dashboard.scopeId,
    name: dashboard.name,
    description: dashboard.description,
    visibility: dashboard.visibility,
    globalFilters: dashboard.globalFilters,
    revision: dashboard.revision,
    status: dashboard.status,
    archivedAt: dashboard.archivedAt,
    createdAt: dashboard.createdAt,
    updatedAt: dashboard.updatedAt,
    widgets: (dashboard.widgets ?? []).sort(compareWidgetLayout).map(serializeWidget),
    accessCount: dashboard.accesses?.length ?? 0,
    isFavorite: preference?.isFavorite ?? false,
    isDefault: preference?.isDefault ?? false,
  };
}

function serializeWidget(widget: SerializableWidget) {
  return {
    id: widget.id,
    dashboardId: widget.dashboardId,
    type: widget.type,
    title: widget.title,
    description: widget.description,
    dataSourceType: widget.dataSourceType,
    configuration: widget.configuration,
    layout: widget.layout,
    refreshSeconds: widget.refreshSeconds,
    createdAt: widget.createdAt,
    updatedAt: widget.updatedAt,
  };
}

function auditSummary(metadata: unknown): Prisma.InputJsonValue {
  if (!metadata || typeof metadata !== 'object') return {};
  const record = metadata as Record<string, unknown>;
  return {
    id: typeof record.id === 'string' ? record.id : null,
    status: typeof record.status === 'string' ? record.status : null,
    revision: typeof record.revision === 'number' ? record.revision : null,
    widgetCount: Array.isArray(record.widgets) ? record.widgets.length : null,
  };
}

function dashboardTemplates(scopeType: AnalyticsScopeType): Array<{
  key: string;
  name: string;
  description: string;
  widgets: CreateDashboardWidgetDto[];
}> {
  const parentDimension = 'WORKSPACE';
  const templates = [
    template(
      'team-performance',
      'Team Performance',
      ['tasks.completed', 'memberships.active'],
      parentDimension,
    ),
    template(
      'project-overview',
      'Project Overview',
      ['projects.active', 'projects.completed'],
      parentDimension,
    ),
    template(
      'ticket-operations',
      'Ticket Operations',
      ['tickets.open', 'tickets.resolved'],
      parentDimension,
    ),
    template(
      'gamification',
      'Gamification',
      ['gamification.xp_earned', 'gamification.badges_awarded'],
      parentDimension,
      'GAMIFICATION_SUMMARY',
    ),
    template(
      'automation',
      'Automation',
      ['automation.executions', 'automation.failed'],
      parentDimension,
    ),
    template(
      'goals',
      'Goals',
      ['goals.active', 'goals.completed'],
      parentDimension,
      'GOAL_PROGRESS',
    ),
    template('forms', 'Forms', ['forms.submissions'], parentDimension),
    template(
      'storage-api-usage',
      'Storage & API Usage',
      ['files.storage_bytes', 'api.requests'],
      parentDimension,
    ),
  ];
  if (scopeType === AnalyticsScopeType.SUPER_AGENCY || scopeType === AnalyticsScopeType.PLATFORM) {
    templates.push(
      template(
        'commercial-health',
        'Commercial Health',
        ['billing.active_subscriptions'],
        undefined,
      ),
    );
  }
  return templates;
}

function template(
  key: string,
  name: string,
  metrics: string[],
  dimension?: string,
  specialType?: (typeof dashboardWidgetTypes)[number],
) {
  return {
    key,
    name,
    description: `${name} dashboard`,
    widgets: [
      {
        type: (specialType ?? 'METRIC_CARD') as (typeof dashboardWidgetTypes)[number],
        title: name,
        dataSourceType: 'ANALYTICS_QUERY' as const,
        configuration: {
          metricKeys: metrics,
          datePreset: 'LAST_30_DAYS' as const,
          bucket: 'DAY' as const,
        },
        layout: { x: 0, y: 0, width: 4, height: 4, order: 0 },
      },
      {
        type: 'LINE_CHART' as const,
        title: `${name} Trend`,
        dataSourceType: 'ANALYTICS_QUERY' as const,
        configuration: {
          metricKeys: [metrics[0]!],
          datePreset: 'LAST_30_DAYS' as const,
          bucket: 'DAY' as const,
        },
        layout: { x: 4, y: 0, width: 8, height: 5, order: 1 },
      },
      ...(dimension
        ? [
            {
              type: 'TABLE' as const,
              title: `${name} Breakdown`,
              dataSourceType: 'ANALYTICS_QUERY' as const,
              configuration: {
                metricKeys: [metrics[0]!],
                datePreset: 'LAST_30_DAYS' as const,
                bucket: 'DAY' as const,
                dimension,
              },
              layout: { x: 0, y: 5, width: 12, height: 6, order: 2 },
            },
          ]
        : []),
    ] as CreateDashboardWidgetDto[],
  };
}
