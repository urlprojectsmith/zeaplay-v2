import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import {
  MembershipStatus,
  ReportExecutionStatus,
  RoleScope,
  StatusCategory,
  StatusEntityType,
} from '@prisma/client';
import ExcelJS from 'exceljs';
import type { WorkspaceTenantContext } from '../src/common/auth/auth.types';
import { PermissionKeys } from '../src/common/authorization/permissions';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import type { ReportConfigDto } from '../src/modules/reports/dto/reports.dto';
import { ReportsService } from '../src/modules/reports/reports.service';

loadApiEnv();

const redis = {
  cache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  },
};

describe('Phase 17.2 real Reports integration', () => {
  let prisma: PrismaService;
  let reports: ReportsService;
  let storage: StorageHarness;
  let ids: SeedIds;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    prisma = new PrismaService();
    await prisma.$connect();
    storage = new StorageHarness();
    reports = new ReportsService(
      prisma,
      new AnalyticsService(prisma, redis as never),
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      storage as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  afterAll(async () => {
    await cleanup(prisma, ids).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ids = makeIds();
    storage.clear();
    redis.cache.get.mockResolvedValue(null);
    redis.cache.set.mockClear();
    await cleanup(prisma, ids);
    await seedTenant(prisma, ids);
  });

  afterEach(async () => {
    await cleanup(prisma, ids);
  });

  it('previews, exports, downloads, and schedules a Workspace report with tenant revalidation', async () => {
    const scope = await reports.workspaceScope(tenant(ids));
    const actor = reports.workspaceActor(tenant(ids));
    const created = await reports.create(scope, actor, {
      name: 'Phase 17.2 Tasks',
      type: 'SUMMARY',
      visibility: 'SELECTED_MEMBERS',
      accessMembershipIds: [ids.workspaceMembership],
      configuration: reportConfig(),
    });
    const reportId = created.report.id;

    const preview = await reports.preview(scope, actor, reportId);
    expect(preview.table.rows).toEqual(
      expect.arrayContaining([expect.arrayContaining(['Tasks', 2])]),
    );

    const csv = await reports.export(scope, actor, reportId, {
      format: 'CSV',
      idempotencyKey: `csv-${ids.run}`,
    });
    expect(csv.queued).toBe(false);
    expect(storage.uploads.at(-1)?.body.toString('utf8')).toContain('Tasks,2');

    const xlsx = await reports.export(scope, actor, reportId, {
      format: 'XLSX',
      idempotencyKey: `xlsx-${ids.run}`,
    });
    const workbook = new ExcelJS.Workbook();
    const xlsxBody = storage.uploads.at(-1)?.body;
    expect(xlsxBody).toBeDefined();
    await workbook.xlsx.load(xlsxBody as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet('Report')?.getCell('A2').value).toBe('Tasks');

    const download = await reports.download(scope, actor, reportId, xlsx.export.id);
    expect(download.downloadUrl).toContain('/generated/reports/workspace/');
    await expect(
      reports.download(
        scope,
        {
          ...actor,
          permissions: actor.permissions.filter((key) => key !== PermissionKeys.reportsExport),
        },
        reportId,
        xlsx.export.id,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const schedule = await reports.createSchedule(scope, actor, reportId, {
      frequency: 'DAILY',
      timezone: 'Asia/Calcutta',
      localTime: '09:00',
      recipients: { workspaceMembershipIds: [ids.workspaceMembership] },
    });
    await prisma.reportSchedule.update({
      where: { id: schedule.schedule.id },
      data: { nextRunAt: new Date('2026-09-28T00:00:00.000Z') },
    });

    await expect(
      reports.dispatchDueSchedules(new Date('2026-09-28T00:01:00.000Z')),
    ).resolves.toMatchObject({ dispatched: 1 });
    await expect(
      reports.dispatchDueSchedules(new Date('2026-09-28T00:01:00.000Z')),
    ).resolves.toMatchObject({ dispatched: 0 });
    await expect(
      prisma.reportScheduleOccurrence.count({
        where: { scheduleId: schedule.schedule.id, status: ReportExecutionStatus.SUCCEEDED },
      }),
    ).resolves.toBe(1);
  });
});

class StorageHarness {
  uploads: Array<{ key: string; body: Buffer; contentType?: string; fileName?: string }> = [];

  upload(key: string, body: Buffer, options: { contentType?: string; fileName?: string }) {
    this.uploads.push({ key, body, ...options });
    return Promise.resolve();
  }

  createPresignedDownloadUrl(key: string, ttlSeconds: number) {
    return Promise.resolve(`https://storage.example.test/${key}?ttl=${ttlSeconds}`);
  }

  clear() {
    this.uploads = [];
  }
}

async function seedTenant(prisma: PrismaService, ids: SeedIds) {
  await prisma.user.create({
    data: { id: ids.user, email: `${ids.run}@example.test`, passwordHash: 'hash' },
  });
  await prisma.role.create({
    data: {
      id: ids.role,
      key: `phase17_2_${ids.run}`,
      name: 'Phase 17.2 Owner',
      scope: RoleScope.WORKSPACE,
    },
  });
  await prisma.superAgency.create({
    data: {
      id: ids.superAgency,
      name: 'Phase 17.2 Super Agency',
      slug: `phase17-2-sa-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.agency.create({
    data: {
      id: ids.agency,
      superAgencyId: ids.superAgency,
      name: 'Phase 17.2 Agency',
      slug: `phase17-2-agency-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.workspace.create({
    data: {
      id: ids.workspace,
      agencyId: ids.agency,
      name: 'Phase 17.2 Workspace',
      slug: `phase17-2-workspace-${ids.run}`,
      timezone: 'Asia/Calcutta',
      createdById: ids.user,
    },
  });
  await prisma.agencyMembership.create({
    data: {
      id: ids.agencyMembership,
      userId: ids.user,
      agencyId: ids.agency,
      roleId: ids.role,
    },
  });
  await prisma.workspaceMembership.create({
    data: {
      id: ids.workspaceMembership,
      userId: ids.user,
      workspaceId: ids.workspace,
      roleId: ids.role,
      status: MembershipStatus.ACTIVE,
    },
  });
  await prisma.statusDefinition.create({
    data: {
      id: ids.taskStatus,
      workspaceId: ids.workspace,
      entityType: StatusEntityType.TASK,
      name: 'Open',
      nameNormalized: 'open',
      color: '#64748b',
      position: 1,
      category: StatusCategory.TODO,
      isDefault: true,
      isTerminal: false,
      isSystem: true,
    },
  });
  await prisma.task.createMany({
    data: [
      {
        id: ids.taskOne,
        workspaceId: ids.workspace,
        title: 'Report task one',
        statusDefinitionId: ids.taskStatus,
        createdById: ids.user,
        createdAt: new Date('2026-09-28T00:00:00.000Z'),
      },
      {
        id: ids.taskTwo,
        workspaceId: ids.workspace,
        title: 'Report task two',
        statusDefinitionId: ids.taskStatus,
        createdById: ids.user,
        createdAt: new Date('2026-09-28T00:00:00.000Z'),
      },
    ],
  });
}

async function cleanup(prisma: PrismaService, ids?: SeedIds) {
  if (!ids) return;
  await prisma.reportScheduleOccurrence.deleteMany({
    where: { schedule: { report: { scopeId: ids.workspace } } },
  });
  await prisma.reportSchedule.deleteMany({ where: { scopeId: ids.workspace } });
  await prisma.reportExport.deleteMany({ where: { scopeId: ids.workspace } });
  await prisma.reportExecution.deleteMany({ where: { scopeId: ids.workspace } });
  await prisma.reportAccess.deleteMany({ where: { scopeId: ids.workspace } });
  await prisma.report.deleteMany({ where: { scopeId: ids.workspace } });
  await prisma.task.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.statusDefinition.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.agencyMembership.deleteMany({ where: { agencyId: ids.agency } });
  await prisma.workspace.deleteMany({ where: { id: ids.workspace } });
  await prisma.agency.deleteMany({ where: { id: ids.agency } });
  await prisma.superAgency.deleteMany({ where: { id: ids.superAgency } });
  await prisma.role.deleteMany({ where: { id: ids.role } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

function tenant(ids: SeedIds): WorkspaceTenantContext {
  return {
    userId: ids.user,
    superAgencyId: ids.superAgency,
    agencyId: ids.agency,
    workspaceId: ids.workspace,
    workspaceMembershipId: ids.workspaceMembership,
    agencyMembershipId: ids.agencyMembership,
    roleId: ids.role,
    roleName: 'Phase 17.2 Owner',
    permissions: [
      PermissionKeys.reportsView,
      PermissionKeys.reportsCreate,
      PermissionKeys.reportsEdit,
      PermissionKeys.reportsExport,
      PermissionKeys.reportsSchedule,
      PermissionKeys.reportsManage,
    ],
    accessSource: 'WORKSPACE_MEMBERSHIP',
  };
}

function reportConfig(): ReportConfigDto {
  return {
    metricKeys: ['tasks.total'],
    datePreset: 'CUSTOM',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-10-01T00:00:00.000Z',
    bucket: 'DAY',
    page: 1,
    pageSize: 50,
  };
}

function makeIds(): SeedIds {
  return {
    run: randomUUID(),
    user: randomUUID(),
    role: randomUUID(),
    superAgency: randomUUID(),
    agency: randomUUID(),
    workspace: randomUUID(),
    agencyMembership: randomUUID(),
    workspaceMembership: randomUUID(),
    taskStatus: randomUUID(),
    taskOne: randomUUID(),
    taskTwo: randomUUID(),
  };
}

function loadApiEnv() {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, '');
  }
}

interface SeedIds {
  run: string;
  user: string;
  role: string;
  superAgency: string;
  agency: string;
  workspace: string;
  agencyMembership: string;
  workspaceMembership: string;
  taskStatus: string;
  taskOne: string;
  taskTwo: string;
}
