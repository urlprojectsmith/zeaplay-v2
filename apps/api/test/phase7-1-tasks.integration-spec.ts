import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DepartmentStatus,
  MembershipStatus,
  PrismaClient,
  ProjectStatus,
  RoleScope,
  StatusCategory,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PasswordService } from '../src/common/auth/password.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { initializeDefaultStatuses } from '../src/modules/statuses/status-templates';

process.env = {
  ...process.env,
  NODE_ENV: 'test',
  APP_ENV: 'test',
  WEB_APP_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:4000/api/v1',
  CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://zea:zea_password@localhost:6432/zea_play?schema=public',
  DIRECT_DATABASE_URL: 'postgresql://zea:zea_password@localhost:5432/zea_play?schema=public',
  REDIS_CACHE_URL: 'redis://localhost:6379',
  REDIS_QUEUE_URL: 'redis://localhost:6380',
  REDIS_REALTIME_URL: 'redis://localhost:6381',
  REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
  MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
  MINIO_BUCKET: 'zea-play-dev',
  MAX_UPLOAD_BYTES: '1024',
  ALLOWED_MIME_TYPES: 'text/plain,image/png',
  SMTP_HOST: 'localhost',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
};

const prisma = new PrismaClient();
const passwords = new PasswordService();
const password = 'DevelopmentPassword123!';
const accessSecret = 'test-access-secret-at-least-32-characters';

jest.setTimeout(30_000);

describe('Phase 7.1 task core backend integration', () => {
  let app: INestApplication;
  let agencyA: string;
  let agencyB: string;
  let workspaceA1: string;
  let workspaceA2: string;
  let workspaceB1: string;
  let ownerAToken: string;
  let adminToken: string;
  let memberToken: string;
  let viewerToken: string;
  let createOnlyToken: string;
  let updateOnlyToken: string;
  let assignOnlyToken: string;
  let updateAssignToken: string;
  let assignDeleteToken: string;
  let manageOnlyToken: string;
  let ownerBToken: string;
  let memberMembershipId: string;
  let adminMembershipId: string;
  let suspendedMembershipId: string;
  let foreignMembershipId: string;
  let betaMembershipId: string;
  let activeDepartmentId: string;
  let inactiveDepartmentId: string;
  let foreignDepartmentId: string;
  let activeProjectId: string;
  let secondProjectId: string;
  let archivedProjectId: string;
  let foreignProjectId: string;
  let betaProjectId: string;
  let taskDefaultStatusId: string;
  let taskReviewStatusId: string;
  let inactiveTaskStatusId: string;
  let projectStatusId: string;
  let ticketStatusId: string;

  beforeAll(async () => {
    await resetDatabase();
    await seedFixtures();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    ownerAToken = await accessTokenFor('owner-a@zeaplay.test');
    adminToken = await accessTokenFor('admin-a@zeaplay.test');
    memberToken = await accessTokenFor('member-a@zeaplay.test');
    viewerToken = await accessTokenFor('viewer-a@zeaplay.test');
    createOnlyToken = await accessTokenFor('task-create-a@zeaplay.test');
    updateOnlyToken = await accessTokenFor('task-update-a@zeaplay.test');
    assignOnlyToken = await accessTokenFor('task-assign-a@zeaplay.test');
    updateAssignToken = await accessTokenFor('task-update-assign-a@zeaplay.test');
    assignDeleteToken = await accessTokenFor('task-assign-delete-a@zeaplay.test');
    manageOnlyToken = await accessTokenFor('task-manage-a@zeaplay.test');
    ownerBToken = await accessTokenFor('owner-b@zeaplay.test');
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('creates tasks with default and explicit TASK status, validates core input, and audits creation', async () => {
    const created = await createTask({
      title: '  Ship first task  ',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      assigneeMembershipIds: [memberMembershipId],
    }).expect(201);
    expect(created.body.data.title).toBe('Ship first task');
    expect(created.body.data.status.id).toBe(taskDefaultStatusId);
    expect(created.body.data.assignees).toHaveLength(1);

    const explicit = await createTask({
      title: 'Explicit status task',
      priority: 'HIGH',
      statusDefinitionId: taskReviewStatusId,
      departmentId: activeDepartmentId,
      followerMembershipIds: [adminMembershipId],
      projectIds: [activeProjectId, secondProjectId],
    }).expect(201);
    expect(explicit.body.data.priority).toBe('HIGH');
    expect(explicit.body.data.status.id).toBe(taskReviewStatusId);
    expect(explicit.body.data.projects).toHaveLength(2);

    await createTask({ title: '   ' }).expect(400);
    await createTask({ title: 'Bad priority', priority: 'BLOCKER' }).expect(422);
    await createTask({ title: 'Forged creator', createdById: memberMembershipId }).expect(422);
    await createTask({ title: 'Invalid due date', dueAt: 'not-a-date' }).expect(422);
    await createTask({
      title: 'Offset due date',
      dueAt: '2027-01-02T10:30:00+05:30',
    }).expect(201);

    const audit = await prisma.auditLog.findMany({
      where: { workspaceId: workspaceA1, action: 'task.created' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('lists, searches, filters, gets, patches, changes status, and soft deletes tasks', async () => {
    const task = await createTask({
      title: 'Searchable billing task',
      priority: 'URGENT',
      statusDefinitionId: taskReviewStatusId,
      departmentId: activeDepartmentId,
      assigneeMembershipIds: [memberMembershipId, adminMembershipId],
      projectIds: [activeProjectId],
    }).expect(201);
    const taskId = task.body.data.id;

    await request(app.getHttpServer())
      .get('/api/v1/workspaces/not-a-uuid/tasks')
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);

    const page = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?page=1&pageSize=2&search=billing&priority=URGENT&statusDefinitionId=${taskReviewStatusId}&assigneeMembershipId=${memberMembershipId}&departmentId=${activeDepartmentId}&projectId=${activeProjectId}`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(page.body.data.total).toBeGreaterThanOrEqual(1);
    expect(page.body.data.items.some((item: { id: string }) => item.id === taskId)).toBe(true);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?pageSize=101`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(detail.body.data.assignees).toHaveLength(2);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Updated billing task', priority: 'LOW', dueAt: null })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ updatedById: memberMembershipId })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);
    const statusAuditCount = await prisma.auditLog.count({
      where: { workspaceId: workspaceA1, entityType: 'Task', action: 'task.status_changed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);
    await expect(
      prisma.auditLog.count({
        where: { workspaceId: workspaceA1, entityType: 'Task', action: 'task.status_changed' },
      }),
    ).resolves.toBe(statusAuditCount);

    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    const afterDelete = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?search=Updated`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(afterDelete.body.data.items).toHaveLength(0);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Deleted mutation' })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [adminMembershipId] })
      .expect(404);
    const deleteAuditCount = await prisma.auditLog.count({
      where: {
        workspaceId: workspaceA1,
        entityType: 'Task',
        action: 'task.deleted',
        entityId: taskId,
      },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await expect(
      prisma.auditLog.count({
        where: {
          workspaceId: workspaceA1,
          entityType: 'Task',
          action: 'task.deleted',
          entityId: taskId,
        },
      }),
    ).resolves.toBe(deleteAuditCount);

    const actions = (
      await prisma.auditLog.findMany({ where: { workspaceId: workspaceA1, entityType: 'Task' } })
    ).map((item) => item.action);
    expect(actions).toEqual(
      expect.arrayContaining(['task.updated', 'task.status_changed', 'task.deleted']),
    );
  });

  it('transactionally replaces assignees, followers, and projects while rejecting foreign or inactive relations', async () => {
    const created = await createTask({ title: 'Relation validation task' }).expect(201);
    const taskId = created.body.data.id;

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [adminMembershipId, memberMembershipId] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [adminMembershipId, adminMembershipId] })
      .expect(422);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [foreignMembershipId] })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [suspendedMembershipId] })
      .expect(400);
    await expectTaskRelationCounts(taskId, { assignees: 2 });

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/followers`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [adminMembershipId] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/followers`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [adminMembershipId, adminMembershipId] })
      .expect(422);
    const overlap = await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/followers`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [adminMembershipId, memberMembershipId] })
      .expect(200);
    expect(overlap.body.data.assignees.map((item: { id: string }) => item.id)).toContain(
      adminMembershipId,
    );
    expect(overlap.body.data.followers.map((item: { id: string }) => item.id)).toContain(
      adminMembershipId,
    );
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/followers`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [betaMembershipId] })
      .expect(404);
    await expectTaskRelationCounts(taskId, { followers: 2 });

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ projectIds: [activeProjectId, secondProjectId] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ projectIds: [activeProjectId, activeProjectId] })
      .expect(422);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ projectIds: [foreignProjectId] })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ projectIds: [archivedProjectId] })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ projectIds: [betaProjectId] })
      .expect(404);
    await expectTaskRelationCounts(taskId, { projects: 2 });
  });

  it('rejects foreign department and non-TASK or inactive statuses', async () => {
    await createTask({ title: 'Inactive department', departmentId: inactiveDepartmentId }).expect(
      400,
    );
    await createTask({ title: 'Foreign department', departmentId: foreignDepartmentId }).expect(
      404,
    );
    await createTask({ title: 'Project status', statusDefinitionId: projectStatusId }).expect(409);
    await createTask({ title: 'Ticket status', statusDefinitionId: ticketStatusId }).expect(409);
    await createTask({
      title: 'Inactive task status',
      statusDefinitionId: inactiveTaskStatusId,
    }).expect(409);

    const created = await createTask({ title: 'Patch validation task' }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${created.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: projectStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${created.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: '00000000-0000-4000-8000-000000000000' })
      .expect(409);
  });

  it('enforces RBAC and tenant isolation for task endpoints', async () => {
    const task = await createTask({ title: 'Tenant protected task' }).expect(201);
    const taskId = task.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Blocked create' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Blocked patch' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(createOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Create-only task' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(createOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Create cannot update' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Update-only can update' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [memberMembershipId] })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [memberMembershipId] })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(manageOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);

    for (const method of ['get', 'patch', 'delete'] as const) {
      const call = request(app.getHttpServer())
        [method](`/api/v1/workspaces/${workspaceA2}/tasks/${taskId}`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1));
      if (method === 'patch') call.send({ title: 'Cross workspace' });
      await call.expect(403);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}`)
      .set(auth(ownerBToken))
      .set(ctx(agencyB, workspaceB1))
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/assignees`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ membershipIds: [adminMembershipId] })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/followers`)
      .set(auth(adminToken))
      .set(ctx(agencyB, workspaceB1))
      .send({ membershipIds: [betaMembershipId] })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ projectIds: [foreignProjectId] })
      .expect(403);
    for (const forged of [
      ctx(agencyA, workspaceA2),
      ctx(agencyA, workspaceB1),
      ctx(agencyB, workspaceA1),
      ctx('00000000-0000-4000-8000-000000000000', workspaceA1),
      ctx(agencyA, '00000000-0000-4000-8000-000000000000'),
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/status`)
        .set(auth(adminToken))
        .set(forged)
        .send({ statusDefinitionId: taskReviewStatusId })
        .expect(403);
    }
  });

  it('bulk changes task status transactionally, idempotently, and only for valid TASK statuses', async () => {
    const first = await createTask({ title: 'Bulk status one' }).expect(201);
    const second = await createTask({
      title: 'Bulk status two',
      statusDefinitionId: taskReviewStatusId,
    }).expect(201);

    const auditBefore = await prisma.auditLog.count({
      where: { workspaceId: workspaceA1, action: 'task.bulk_status_changed' },
    });
    const changed = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [first.body.data.id, second.body.data.id],
        statusDefinitionId: taskReviewStatusId,
      })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      requestedCount: 2,
      changedCount: 1,
      unchangedCount: 1,
    });
    await expect(
      prisma.task.count({
        where: {
          id: { in: [first.body.data.id, second.body.data.id] },
          statusDefinitionId: taskReviewStatusId,
        },
      }),
    ).resolves.toBe(2);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [first.body.data.id, second.body.data.id],
        statusDefinitionId: taskReviewStatusId,
      })
      .expect(200)
      .expect((response) => expect(response.body.data.changedCount).toBe(0));
    await expect(
      prisma.auditLog.count({
        where: { workspaceId: workspaceA1, action: 'task.bulk_status_changed' },
      }),
    ).resolves.toBe(auditBefore + 1);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [], statusDefinitionId: taskReviewStatusId })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [first.body.data.id, first.body.data.id],
        statusDefinitionId: taskReviewStatusId,
      })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], statusDefinitionId: projectStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], statusDefinitionId: ticketStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], statusDefinitionId: inactiveTaskStatusId })
      .expect(409);

    const foreignStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA2, entityType: 'TASK', isDefault: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], statusDefinitionId: foreignStatus.id })
      .expect(409);

    const rollbackCandidate = await createTask({ title: 'Bulk status rollback' }).expect(201);
    const foreignTask = await createTaskInWorkspace(workspaceB1, agencyB, ownerBToken, {
      title: 'Foreign bulk status rollback',
    }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [rollbackCandidate.body.data.id, foreignTask.body.data.id],
        statusDefinitionId: taskReviewStatusId,
      })
      .expect(404);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: rollbackCandidate.body.data.id } }),
    ).resolves.toMatchObject({ statusDefinitionId: taskDefaultStatusId });
  });

  it('bulk changes priority with enum validation, idempotence, permissions, and rollback', async () => {
    const first = await createTask({ title: 'Bulk priority one', priority: 'LOW' }).expect(201);
    const second = await createTask({ title: 'Bulk priority two', priority: 'HIGH' }).expect(201);

    for (const priority of ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ taskIds: [first.body.data.id], priority })
        .expect(200);
    }

    const mixed = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id, second.body.data.id], priority: 'HIGH' })
      .expect(200);
    expect(mixed.body.data).toMatchObject({
      requestedCount: 2,
      changedCount: 1,
      unchangedCount: 1,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], priority: 'LOW' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], priority: 'BLOCKER' })
      .expect(422);

    const deleted = await createTask({ title: 'Bulk priority deleted' }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${deleted.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id, deleted.body.data.id], priority: 'LOW' })
      .expect(404);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: first.body.data.id } }),
    ).resolves.toMatchObject({ priority: 'HIGH' });
  });

  it('bulk adds and removes assignees idempotently with active membership and permission checks', async () => {
    const first = await createTask({ title: 'Bulk assignee one' }).expect(201);
    const second = await createTask({
      title: 'Bulk assignee two',
      assigneeMembershipIds: [adminMembershipId],
    }).expect(201);

    const added = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [first.body.data.id, second.body.data.id],
        membershipIds: [adminMembershipId, memberMembershipId],
      })
      .expect(201);
    expect(added.body.data).toMatchObject({
      requestedCount: 2,
      changedCount: 2,
      relationChangedCount: 3,
      relationUnchangedCount: 1,
    });
    await expectTaskRelationCounts(first.body.data.id, { assignees: 2 });
    await expectTaskRelationCounts(second.body.data.id, { assignees: 2 });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], membershipIds: [adminMembershipId] })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [first.body.data.id],
        membershipIds: [adminMembershipId, adminMembershipId],
      })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], membershipIds: [suspendedMembershipId] })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id], membershipIds: [foreignMembershipId] })
      .expect(404);

    const rollbackCandidate = await createTask({ title: 'Bulk assignee rollback' }).expect(201);
    const foreignTask = await createTaskInWorkspace(workspaceB1, agencyB, ownerBToken, {
      title: 'Foreign bulk assignee rollback',
    }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [rollbackCandidate.body.data.id, foreignTask.body.data.id],
        membershipIds: [adminMembershipId],
      })
      .expect(404);
    await expectTaskRelationCounts(rollbackCandidate.body.data.id, { assignees: 0 });

    const removed = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/remove`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [first.body.data.id, second.body.data.id],
        membershipIds: [memberMembershipId],
      })
      .expect(201);
    expect(removed.body.data).toMatchObject({ changedCount: 2, relationChangedCount: 2 });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/remove`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [first.body.data.id, second.body.data.id],
        membershipIds: [memberMembershipId],
      })
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(0));
  });

  it('bulk soft deletes tasks, hides them from reads, audits once, and rolls back mixed input', async () => {
    const first = await createTask({ title: 'Bulk delete one' }).expect(201);
    const second = await createTask({ title: 'Bulk delete two' }).expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id] })
      .expect(403);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id, second.body.data.id] })
      .expect(200);
    expect(deleted.body.data).toMatchObject({
      requestedCount: 2,
      changedCount: 2,
      unchangedCount: 0,
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${first.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [first.body.data.id] })
      .expect(404);
    await expect(
      prisma.auditLog.count({ where: { workspaceId: workspaceA1, action: 'task.bulk_deleted' } }),
    ).resolves.toBeGreaterThanOrEqual(1);

    const rollbackCandidate = await createTask({ title: 'Bulk delete rollback' }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [rollbackCandidate.body.data.id, '00000000-0000-4000-8000-000000000000'],
      })
      .expect(404);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: rollbackCandidate.body.data.id } }),
    ).resolves.toMatchObject({ deletedAt: null });
  });

  it('validates bulk payload boundaries and keeps bulk routes ahead of task-id routes', async () => {
    const task = await createTask({ title: 'Bulk payload boundary task' }).expect(201);
    const hundredUnknownIds = Array.from({ length: 100 }, () => randomUUID());
    const hundredOneUnknownIds = [...hundredUnknownIds, randomUUID()];

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: hundredUnknownIds, statusDefinitionId: taskReviewStatusId })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: hundredOneUnknownIds, statusDefinitionId: taskReviewStatusId })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: ['not-a-uuid'], priority: 'HIGH' })
      .expect(422);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [] })
      .expect(422);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id, task.body.data.id] })
      .expect(422);
  });

  it('updates only changed bulk status and priority rows with the authenticated actor', async () => {
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: 'task-update-a@zeaplay.test' },
    });
    const statusAlready = await createTask({
      title: 'Bulk status already',
      statusDefinitionId: taskReviewStatusId,
    }).expect(201);
    const statusChanged = await createTask({ title: 'Bulk status changed' }).expect(201);
    const statusAlreadyTwo = await createTask({
      title: 'Bulk status already two',
      statusDefinitionId: taskReviewStatusId,
    }).expect(201);
    const beforeStatusRows = await prisma.task.findMany({
      where: {
        id: {
          in: [
            statusAlready.body.data.id,
            statusChanged.body.data.id,
            statusAlreadyTwo.body.data.id,
          ],
        },
      },
      select: { id: true, updatedAt: true, updatedById: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const statusResponse = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [
          statusAlready.body.data.id,
          statusChanged.body.data.id,
          statusAlreadyTwo.body.data.id,
        ],
        statusDefinitionId: taskReviewStatusId,
      })
      .expect(200);
    expect(statusResponse.body.data).toMatchObject({
      requestedCount: 3,
      changedCount: 1,
      unchangedCount: 2,
    });
    const afterStatusRows = await prisma.task.findMany({
      where: {
        id: {
          in: [
            statusAlready.body.data.id,
            statusChanged.body.data.id,
            statusAlreadyTwo.body.data.id,
          ],
        },
      },
      select: { id: true, updatedAt: true, updatedById: true },
    });
    const beforeStatusById = new Map(beforeStatusRows.map((row) => [row.id, row]));
    const afterStatusById = new Map(afterStatusRows.map((row) => [row.id, row]));
    expect(afterStatusById.get(statusChanged.body.data.id)?.updatedById).toBe(actor.id);
    expect(afterStatusById.get(statusChanged.body.data.id)?.updatedAt.getTime()).toBeGreaterThan(
      beforeStatusById.get(statusChanged.body.data.id)?.updatedAt.getTime() ?? 0,
    );
    for (const id of [statusAlready.body.data.id, statusAlreadyTwo.body.data.id]) {
      expect(afterStatusById.get(id)?.updatedById).toBe(beforeStatusById.get(id)?.updatedById);
      expect(afterStatusById.get(id)?.updatedAt.toISOString()).toBe(
        beforeStatusById.get(id)?.updatedAt.toISOString(),
      );
    }

    const priorityAlready = await createTask({
      title: 'Bulk priority already',
      priority: 'HIGH',
    }).expect(201);
    const priorityChanged = await createTask({
      title: 'Bulk priority changed',
      priority: 'LOW',
    }).expect(201);
    const priorityAlreadyTwo = await createTask({
      title: 'Bulk priority already two',
      priority: 'HIGH',
    }).expect(201);
    const beforePriorityRows = await prisma.task.findMany({
      where: {
        id: {
          in: [
            priorityAlready.body.data.id,
            priorityChanged.body.data.id,
            priorityAlreadyTwo.body.data.id,
          ],
        },
      },
      select: { id: true, updatedAt: true, updatedById: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [
          priorityAlready.body.data.id,
          priorityChanged.body.data.id,
          priorityAlreadyTwo.body.data.id,
        ],
        priority: 'HIGH',
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          requestedCount: 3,
          changedCount: 1,
          unchangedCount: 2,
        });
      });
    const afterPriorityRows = await prisma.task.findMany({
      where: {
        id: {
          in: [
            priorityAlready.body.data.id,
            priorityChanged.body.data.id,
            priorityAlreadyTwo.body.data.id,
          ],
        },
      },
      select: { id: true, updatedAt: true, updatedById: true },
    });
    const beforePriorityById = new Map(beforePriorityRows.map((row) => [row.id, row]));
    const afterPriorityById = new Map(afterPriorityRows.map((row) => [row.id, row]));
    expect(afterPriorityById.get(priorityChanged.body.data.id)?.updatedById).toBe(actor.id);
    expect(
      afterPriorityById.get(priorityChanged.body.data.id)?.updatedAt.getTime(),
    ).toBeGreaterThan(
      beforePriorityById.get(priorityChanged.body.data.id)?.updatedAt.getTime() ?? 0,
    );
    for (const id of [priorityAlready.body.data.id, priorityAlreadyTwo.body.data.id]) {
      expect(afterPriorityById.get(id)?.updatedById).toBe(beforePriorityById.get(id)?.updatedById);
      expect(afterPriorityById.get(id)?.updatedAt.toISOString()).toBe(
        beforePriorityById.get(id)?.updatedAt.toISOString(),
      );
    }
  });

  it('rejects unsafe priority values without coercion', async () => {
    const task = await createTask({ title: 'Bulk priority enum safety' }).expect(201);
    for (const priority of ['low', 'HIGHER', '', 1]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ taskIds: [task.body.data.id], priority })
        .expect(422);
    }
  });

  it('rejects deleted and cross-tenant tasks transactionally across representative bulk actions', async () => {
    const active = await createTask({ title: 'Bulk tenant active' }).expect(201);
    const sameAgencyForeign = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Same agency foreign workspace task',
    }).expect(201);
    const crossAgencyForeign = await createTaskInWorkspace(workspaceB1, agencyB, ownerBToken, {
      title: 'Cross agency foreign workspace task',
    }).expect(201);

    for (const foreignId of [sameAgencyForeign.body.data.id, crossAgencyForeign.body.data.id]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ taskIds: [active.body.data.id, foreignId], statusDefinitionId: taskReviewStatusId })
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
        .set(auth(assignOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ taskIds: [active.body.data.id, foreignId], membershipIds: [adminMembershipId] })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ taskIds: [active.body.data.id, foreignId] })
        .expect(404);
    }
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: active.body.data.id } }),
    ).resolves.toMatchObject({ statusDefinitionId: taskDefaultStatusId, deletedAt: null });
    await expectTaskRelationCounts(active.body.data.id, { assignees: 0 });

    const deleted = await createTask({
      title: 'Bulk deleted member',
      assigneeMembershipIds: [adminMembershipId],
    }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${deleted.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    for (const [method, path, body] of [
      [
        'patch',
        `/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`,
        {
          taskIds: [active.body.data.id, deleted.body.data.id],
          statusDefinitionId: taskReviewStatusId,
        },
      ],
      [
        'patch',
        `/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`,
        { taskIds: [active.body.data.id, deleted.body.data.id], priority: 'URGENT' },
      ],
      [
        'post',
        `/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/remove`,
        {
          taskIds: [active.body.data.id, deleted.body.data.id],
          membershipIds: [adminMembershipId],
        },
      ],
      [
        'delete',
        `/api/v1/workspaces/${workspaceA1}/tasks/bulk`,
        { taskIds: [active.body.data.id, deleted.body.data.id] },
      ],
    ] as const) {
      await request(app.getHttpServer())
        [method](path)
        .set(
          auth(
            method === 'post'
              ? assignOnlyToken
              : method === 'delete'
                ? adminToken
                : updateOnlyToken,
          ),
        )
        .set(ctx(agencyA, workspaceA1))
        .send(body)
        .expect(404);
    }
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: active.body.data.id } }),
    ).resolves.toMatchObject({ priority: 'MEDIUM', deletedAt: null });
  });

  it('enforces bulk header forgery rejection and independent permission combinations', async () => {
    const task = await createTask({ title: 'Bulk permission matrix' }).expect(201);

    for (const forged of [
      ctx(agencyA, workspaceA2),
      ctx(agencyA, workspaceB1),
      ctx(agencyB, workspaceA1),
      ctx(agencyA, '00000000-0000-4000-8000-000000000000'),
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
        .set(auth(updateOnlyToken))
        .set(forged)
        .send({ taskIds: [task.body.data.id], priority: 'HIGH' })
        .expect(403);
    }

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateAssignToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id], statusDefinitionId: taskReviewStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
      .set(auth(updateAssignToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id], membershipIds: [adminMembershipId] })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(updateAssignToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id] })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(assignDeleteToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id], priority: 'LOW' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/remove`)
      .set(auth(assignDeleteToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id], membershipIds: [adminMembershipId] })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(assignDeleteToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id] })
      .expect(200);
  });

  it('preserves relations on bulk soft delete and records bounded success audit metadata', async () => {
    const task = await createTask({
      title: 'Bulk delete preserve relations',
      assigneeMembershipIds: [adminMembershipId],
      followerMembershipIds: [memberMembershipId],
      projectIds: [activeProjectId],
    }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id] })
      .expect(200);
    await expectTaskRelationCounts(task.body.data.id, {
      assignees: 1,
      followers: 1,
      projects: 1,
    });
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: task.body.data.id } }),
    ).resolves.toMatchObject({ deletedAt: expect.any(Date) });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: workspaceA1, action: 'task.bulk_deleted' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({
      agencyId: agencyA,
      workspaceId: workspaceA1,
      action: 'task.bulk_deleted',
      entityType: 'Task',
    });
    expect(audit.metadata).toMatchObject({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
      taskIds: [task.body.data.id],
    });
  });

  it('does not audit failed bulk priority transactions and rejects foreign remove memberships', async () => {
    const task = await createTask({
      title: 'Bulk failed audit active',
      assigneeMembershipIds: [adminMembershipId],
    }).expect(201);
    const foreignTask = await createTaskInWorkspace(workspaceB1, agencyB, ownerBToken, {
      title: 'Bulk failed audit foreign',
    }).expect(201);
    const beforeAudit = await prisma.auditLog.count({
      where: { workspaceId: workspaceA1, action: 'task.bulk_priority_changed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/priority`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id, foreignTask.body.data.id], priority: 'URGENT' })
      .expect(404);
    await expect(
      prisma.auditLog.count({
        where: { workspaceId: workspaceA1, action: 'task.bulk_priority_changed' },
      }),
    ).resolves.toBe(beforeAudit);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/remove`)
      .set(auth(assignOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [task.body.data.id], membershipIds: [foreignMembershipId] })
      .expect(404);
    await expectTaskRelationCounts(task.body.data.id, { assignees: 1 });
  });

  it('keeps concurrent duplicate bulk assignee add idempotent', async () => {
    const task = await createTask({ title: 'Bulk concurrent assignee add' }).expect(201);
    const calls = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
        .set(auth(assignOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ taskIds: [task.body.data.id], membershipIds: [adminMembershipId] }),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/assignees/add`)
        .set(auth(assignOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ taskIds: [task.body.data.id], membershipIds: [adminMembershipId] }),
    ]);
    expect(calls.map((response) => response.status)).toEqual([201, 201]);
    await expect(
      prisma.taskAssignee.count({
        where: { taskId: task.body.data.id, membershipId: adminMembershipId },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back failed create relations and handles default status configuration safely', async () => {
    const beforeFollowerFailure = await prisma.task.count({ where: { workspaceId: workspaceA1 } });
    await createTask({
      title: 'Rollback foreign follower',
      assigneeMembershipIds: [adminMembershipId],
      followerMembershipIds: [foreignMembershipId],
    }).expect(404);
    await expect(prisma.task.count({ where: { workspaceId: workspaceA1 } })).resolves.toBe(
      beforeFollowerFailure,
    );

    const beforeProjectFailure = await prisma.task.count({ where: { workspaceId: workspaceA1 } });
    await createTask({
      title: 'Rollback foreign project',
      followerMembershipIds: [adminMembershipId],
      projectIds: [foreignProjectId],
    }).expect(404);
    await expect(prisma.task.count({ where: { workspaceId: workspaceA1 } })).resolves.toBe(
      beforeProjectFailure,
    );

    await prisma.statusDefinition.update({
      where: { id: taskDefaultStatusId },
      data: { isActive: false },
    });
    await createTask({ title: 'No active TASK default' }).expect(409);
    await prisma.statusDefinition.update({
      where: { id: taskDefaultStatusId },
      data: { isActive: true },
    });
    await createTask({ title: 'Default restored' }).expect(201);
  });

  it('keeps search and filters workspace scoped and rejects unsafe pagination or sorting', async () => {
    const sharedTitle = 'Shared title isolation';
    const a1 = await createTask({
      title: sharedTitle,
      statusDefinitionId: taskReviewStatusId,
      priority: 'LOW',
      dueAt: '2027-02-01T00:00:00Z',
      assigneeMembershipIds: [adminMembershipId],
      departmentId: activeDepartmentId,
      projectIds: [activeProjectId],
    }).expect(201);
    await createTaskInWorkspace(workspaceB1, agencyB, ownerBToken, {
      title: sharedTitle,
      projectIds: [betaProjectId],
    }).expect(201);

    const scoped = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?search=${encodeURIComponent(
          sharedTitle,
        )}&dueFrom=2027-01-01T00:00:00Z&dueTo=2027-03-01T00:00:00Z&createdById=${
          a1.body.data.createdBy.id
        }&sortBy=title&sortDirection=asc`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(
      scoped.body.data.items.every(
        (item: { workspaceId: string }) => item.workspaceId === workspaceA1,
      ),
    ).toBe(true);
    expect(scoped.body.data.items.map((item: { id: string }) => item.id)).toContain(
      a1.body.data.id,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?assigneeMembershipId=${foreignMembershipId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?projectId=${betaProjectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?page=0`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?sortBy=deletedAt`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);
  });

  it('retains historical project and department links after later archive or deactivation', async () => {
    const created = await createTask({
      title: 'Historical relation task',
      departmentId: activeDepartmentId,
      projectIds: [activeProjectId],
    }).expect(201);
    await prisma.project.update({ where: { id: activeProjectId }, data: { status: 'ARCHIVED' } });
    await prisma.department.update({
      where: { id: activeDepartmentId },
      data: { status: DepartmentStatus.INACTIVE },
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(detail.body.data.department.id).toBe(activeDepartmentId);
    expect(detail.body.data.projects.map((item: { id: string }) => item.id)).toContain(
      activeProjectId,
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Historical relation task updated' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${created.body.data.id}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ projectIds: [activeProjectId] })
      .expect(400);

    await prisma.project.update({ where: { id: activeProjectId }, data: { status: 'ACTIVE' } });
    await prisma.department.update({
      where: { id: activeDepartmentId },
      data: { status: DepartmentStatus.ACTIVE },
    });
  });

  function createTask(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send(body);
  }

  function createTaskInWorkspace(
    workspaceId: string,
    agencyId: string,
    token: string,
    body: Record<string, unknown>,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tasks`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send(body);
  }

  async function expectTaskRelationCounts(
    taskId: string,
    expected: Partial<{ assignees: number; followers: number; projects: number }>,
  ) {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { _count: { select: { assignees: true, followers: true, projects: true } } },
    });
    if (expected.assignees !== undefined) expect(task._count.assignees).toBe(expected.assignees);
    if (expected.followers !== undefined) expect(task._count.followers).toBe(expected.followers);
    if (expected.projects !== undefined) expect(task._count.projects).toBe(expected.projects);
  }

  async function seedFixtures() {
    const permissions = [
      'agency.read',
      'workspace.read',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.delete',
      'tasks.assign',
      'tasks.manage',
    ];
    for (const key of permissions) await prisma.permission.create({ data: { key } });
    const roles: Record<string, { id: string }> = {};
    for (const [key, scope, rolePermissions] of [
      ['AGENCY_OWNER', RoleScope.AGENCY, permissions],
      ['AGENCY_ADMIN', RoleScope.AGENCY, permissions],
      ['AGENCY_USER', RoleScope.AGENCY, ['agency.read', 'workspace.read']],
      ['OWNER', RoleScope.WORKSPACE, permissions],
      ['ADMIN', RoleScope.WORKSPACE, permissions],
      ['MEMBER', RoleScope.WORKSPACE, ['workspace.read']],
      ['TASK_VIEWER', RoleScope.WORKSPACE, ['workspace.read', 'tasks.view']],
      ['TASK_CREATE_ONLY', RoleScope.WORKSPACE, ['workspace.read', 'tasks.create']],
      ['TASK_UPDATE_ONLY', RoleScope.WORKSPACE, ['workspace.read', 'tasks.update']],
      ['TASK_ASSIGN_ONLY', RoleScope.WORKSPACE, ['workspace.read', 'tasks.assign']],
      [
        'TASK_UPDATE_ASSIGN',
        RoleScope.WORKSPACE,
        ['workspace.read', 'tasks.update', 'tasks.assign'],
      ],
      [
        'TASK_ASSIGN_DELETE',
        RoleScope.WORKSPACE,
        ['workspace.read', 'tasks.assign', 'tasks.delete'],
      ],
      ['TASK_MANAGE_ONLY', RoleScope.WORKSPACE, ['workspace.read', 'tasks.manage']],
    ] as const) {
      const role = await prisma.role.create({ data: { key, name: key, scope } });
      roles[key] = role;
      for (const permissionKey of rolePermissions) {
        const permission = await prisma.permission.findUniqueOrThrow({
          where: { key: permissionKey },
        });
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }
    }

    const [
      ownerA,
      adminA,
      memberA,
      suspendedA,
      viewerA,
      createOnlyA,
      updateOnlyA,
      assignOnlyA,
      updateAssignA,
      assignDeleteA,
      manageOnlyA,
      ownerB,
    ] = await Promise.all([
      user('owner-a@zeaplay.test', 'Owner A'),
      user('admin-a@zeaplay.test', 'Admin A'),
      user('member-a@zeaplay.test', 'Member A'),
      user('suspended-a@zeaplay.test', 'Suspended A'),
      user('viewer-a@zeaplay.test', 'Viewer A'),
      user('task-create-a@zeaplay.test', 'Task Create A'),
      user('task-update-a@zeaplay.test', 'Task Update A'),
      user('task-assign-a@zeaplay.test', 'Task Assign A'),
      user('task-update-assign-a@zeaplay.test', 'Task Update Assign A'),
      user('task-assign-delete-a@zeaplay.test', 'Task Assign Delete A'),
      user('task-manage-a@zeaplay.test', 'Task Manage A'),
      user('owner-b@zeaplay.test', 'Owner B'),
    ]);
    const agency = await prisma.agency.create({
      data: { name: 'Agency A', slug: 'agency-a', createdById: ownerA.id },
    });
    const beta = await prisma.agency.create({
      data: { name: 'Agency B', slug: 'agency-b', createdById: ownerB.id },
    });
    agencyA = agency.id;
    agencyB = beta.id;
    const [wa, wa2, wb] = await Promise.all([
      prisma.workspace.create({
        data: {
          agencyId: agency.id,
          name: 'Workspace A1',
          slug: 'workspace-a1',
          createdById: ownerA.id,
        },
      }),
      prisma.workspace.create({
        data: {
          agencyId: agency.id,
          name: 'Workspace A2',
          slug: 'workspace-a2',
          createdById: ownerA.id,
        },
      }),
      prisma.workspace.create({
        data: {
          agencyId: beta.id,
          name: 'Workspace B1',
          slug: 'workspace-b1',
          createdById: ownerB.id,
        },
      }),
    ]);
    workspaceA1 = wa.id;
    workspaceA2 = wa2.id;
    workspaceB1 = wb.id;

    await agencyMember(ownerA.id, agency.id, roleId(roles, 'AGENCY_OWNER'));
    await agencyMember(adminA.id, agency.id, roleId(roles, 'AGENCY_ADMIN'));
    await agencyMember(memberA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(suspendedA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(viewerA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(createOnlyA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(updateOnlyA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(assignOnlyA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(updateAssignA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(assignDeleteA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(manageOnlyA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(ownerB.id, beta.id, roleId(roles, 'AGENCY_OWNER'));

    await workspaceMember(ownerA.id, wa.id, roleId(roles, 'OWNER'));
    adminMembershipId = (await workspaceMember(adminA.id, wa.id, roleId(roles, 'ADMIN'))).id;
    memberMembershipId = (await workspaceMember(memberA.id, wa.id, roleId(roles, 'MEMBER'))).id;
    suspendedMembershipId = (
      await workspaceMember(
        suspendedA.id,
        wa.id,
        roleId(roles, 'MEMBER'),
        MembershipStatus.SUSPENDED,
      )
    ).id;
    await workspaceMember(viewerA.id, wa.id, roleId(roles, 'TASK_VIEWER'));
    await workspaceMember(createOnlyA.id, wa.id, roleId(roles, 'TASK_CREATE_ONLY'));
    await workspaceMember(updateOnlyA.id, wa.id, roleId(roles, 'TASK_UPDATE_ONLY'));
    await workspaceMember(assignOnlyA.id, wa.id, roleId(roles, 'TASK_ASSIGN_ONLY'));
    await workspaceMember(updateAssignA.id, wa.id, roleId(roles, 'TASK_UPDATE_ASSIGN'));
    await workspaceMember(assignDeleteA.id, wa.id, roleId(roles, 'TASK_ASSIGN_DELETE'));
    await workspaceMember(manageOnlyA.id, wa.id, roleId(roles, 'TASK_MANAGE_ONLY'));
    foreignMembershipId = (await workspaceMember(ownerA.id, wa2.id, roleId(roles, 'OWNER'))).id;
    betaMembershipId = (await workspaceMember(ownerB.id, wb.id, roleId(roles, 'OWNER'))).id;

    await initializeDefaultStatuses(prisma, wa.id);
    await initializeDefaultStatuses(prisma, wa2.id);
    await initializeDefaultStatuses(prisma, wb.id);
    taskDefaultStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workspaceId: wa.id, entityType: 'TASK', isDefault: true },
      })
    ).id;
    taskReviewStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workspaceId: wa.id, entityType: 'TASK', name: 'Review' },
      })
    ).id;
    projectStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workspaceId: wa.id, entityType: 'PROJECT' },
      })
    ).id;
    ticketStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workspaceId: wa.id, entityType: 'TICKET' },
      })
    ).id;
    inactiveTaskStatusId = (
      await prisma.statusDefinition.create({
        data: {
          workspaceId: wa.id,
          entityType: 'TASK',
          name: 'Dormant',
          nameNormalized: 'dormant',
          color: '#64748B',
          position: 99,
          category: StatusCategory.TODO,
          isActive: false,
        },
      })
    ).id;

    activeDepartmentId = (
      await prisma.department.create({ data: { workspaceId: wa.id, name: 'Delivery' } })
    ).id;
    inactiveDepartmentId = (
      await prisma.department.create({
        data: { workspaceId: wa.id, name: 'Dormant Department', status: DepartmentStatus.INACTIVE },
      })
    ).id;
    foreignDepartmentId = (
      await prisma.department.create({ data: { workspaceId: wa2.id, name: 'Foreign Delivery' } })
    ).id;

    activeProjectId = (await project(wa.id, adminA.id, 'Active Project')).id;
    secondProjectId = (await project(wa.id, adminA.id, 'Second Project')).id;
    archivedProjectId = (
      await project(wa.id, adminA.id, 'Archived Project', ProjectStatus.ARCHIVED)
    ).id;
    foreignProjectId = (await project(wa2.id, ownerA.id, 'Foreign Project')).id;
    betaProjectId = (await project(wb.id, ownerB.id, 'Beta Project')).id;
  }
});

async function resetDatabase() {
  await prisma.$transaction([
    prisma.taskAssignee.deleteMany(),
    prisma.taskFollower.deleteMany(),
    prisma.taskProject.deleteMany(),
    prisma.task.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.processingJob.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.project.deleteMany(),
    prisma.workspaceMembership.deleteMany(),
    prisma.department.deleteMany(),
    prisma.statusDefinition.deleteMany(),
    prisma.agencyMembership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.agency.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.role.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function user(email: string, name: string) {
  return prisma.user.create({
    data: { email, name, passwordHash: passwords.hash(password) },
  });
}

async function agencyMember(userId: string, agencyId: string, roleId: string) {
  return prisma.agencyMembership.create({ data: { userId, agencyId, roleId } });
}

async function workspaceMember(
  userId: string,
  workspaceId: string,
  roleId: string,
  status: MembershipStatus = MembershipStatus.ACTIVE,
) {
  return prisma.workspaceMembership.create({ data: { userId, workspaceId, roleId, status } });
}

async function project(
  workspaceId: string,
  createdById: string,
  name: string,
  status: ProjectStatus = ProjectStatus.ACTIVE,
) {
  return prisma.project.create({ data: { workspaceId, createdById, name, status } });
}

function roleId(roles: Record<string, { id: string }>, key: string) {
  const role = roles[key];
  if (!role) throw new Error(`Missing fixture role ${key}`);
  return role.id;
}

async function accessTokenFor(email: string) {
  const tokenUser = await prisma.user.findUniqueOrThrow({ where: { email } });
  return jwt.sign({ sub: tokenUser.id, email: tokenUser.email }, accessSecret, {
    expiresIn: '15m',
    issuer: 'zea-play-api',
    audience: 'zea-play-web',
  });
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function ctx(agencyId: string, workspaceId: string) {
  return { 'x-agency-id': agencyId, 'x-workspace-id': workspaceId };
}
