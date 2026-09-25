import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AssetStatus,
  AttachmentType,
  DepartmentStatus,
  MembershipStatus,
  PrismaClient,
  Prisma,
  ProjectStatus,
  ProjectVisibility,
  RoleScope,
  StatusCategory,
  TaskCompletionApproverMode,
  TaskCompletionProofRequirementMode,
  TaskCompletionProofType,
  TaskCommentReactionType,
  TaskCommentVisibility,
  WorkspaceTagStatus,
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
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://zea:zea_password@localhost:6432/zea_play?schema=public',
  DIRECT_DATABASE_URL:
    process.env.DIRECT_DATABASE_URL ??
    'postgresql://zea:zea_password@localhost:5432/zea_play?schema=public',
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

jest.setTimeout(90_000);

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
  let commentViewerToken: string;
  let commentCreateToken: string;
  let tagViewerToken: string;
  let tagCreateToken: string;
  let tagUpdateToken: string;
  let tagArchiveToken: string;
  let tagAssignToken: string;
  let tagAssignOnlyToken: string;
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
  let taskCompletedStatusId: string;
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
    commentViewerToken = await accessTokenFor('comment-viewer-a@zeaplay.test');
    commentCreateToken = await accessTokenFor('comment-create-a@zeaplay.test');
    tagViewerToken = await accessTokenFor('tag-viewer-a@zeaplay.test');
    tagCreateToken = await accessTokenFor('tag-create-a@zeaplay.test');
    tagUpdateToken = await accessTokenFor('tag-update-a@zeaplay.test');
    tagArchiveToken = await accessTokenFor('tag-archive-a@zeaplay.test');
    tagAssignToken = await accessTokenFor('tag-assign-a@zeaplay.test');
    tagAssignOnlyToken = await accessTokenFor('tag-assign-only-a@zeaplay.test');
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

  it('supports Kanban columns, ranking, WIP settings, transition rules, and tenant fences', async () => {
    const first = await createTask({ title: 'Kanban first' }).expect(201);
    const second = await createTask({ title: 'Kanban second' }).expect(201);
    const third = await createTask({ title: 'Kanban third' }).expect(201);
    expect(third.body.data.kanbanRank).toBeTruthy();

    const settings = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/kanban/settings`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(
      settings.body.data.columns.map((column: { status: { id: string } }) => column.status.id),
    ).toEqual(
      expect.arrayContaining([taskDefaultStatusId, taskReviewStatusId, taskCompletedStatusId]),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/kanban/columns/${taskReviewStatusId}`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ wipLimit: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/kanban/columns/${taskReviewStatusId}`)
      .set(auth(manageOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ wipLimit: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${third.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId, beforeTaskId: first.body.data.id })
      .expect(200);
    const defaultColumn = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?statusDefinitionId=${taskDefaultStatusId}&sortBy=kanbanRank&sortDirection=asc&pageSize=25`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    const defaultColumnIds = defaultColumn.body.data.items.map((task: { id: string }) => task.id);
    expect(defaultColumnIds).toContain(third.body.data.id);
    expect(defaultColumnIds).toContain(first.body.data.id);
    expect(defaultColumnIds.indexOf(third.body.data.id)).toBeLessThan(
      defaultColumnIds.indexOf(first.body.data.id),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${third.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskReviewStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${second.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskReviewStatusId })
      .expect(200);
    const reviewColumn = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?statusDefinitionId=${taskReviewStatusId}&sortBy=kanbanRank&sortDirection=asc&pageSize=10`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(reviewColumn.body.data.total).toBeGreaterThanOrEqual(2);

    const auditCount = await prisma.auditLog.count({
      where: {
        workspaceId: workspaceA1,
        action: 'task.kanban_moved',
        entityId: third.body.data.id,
      },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${third.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskReviewStatusId })
      .expect(200);
    await expect(
      prisma.auditLog.count({
        where: {
          workspaceId: workspaceA1,
          action: 'task.kanban_moved',
          entityId: third.body.data.id,
        },
      }),
    ).resolves.toBe(auditCount);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${first.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: inactiveTaskStatusId })
      .expect(409);

    const foreign = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Foreign Kanban task',
    }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${foreign.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskReviewStatusId })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA2}/tasks/${foreign.body.data.id}/kanban-position`)
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ statusDefinitionId: taskReviewStatusId })
      .expect(409);

    const parent = await createTask({ title: 'Kanban blocked parent' }).expect(201);
    await createSubtask(parent.body.data.id, { title: 'Kanban active child' }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);
  });

  it('keeps Kanban Decimal ordering stable across tight gaps, null ranks, and paginated columns', async () => {
    const a = await createTask({ title: 'Kanban rank A' }).expect(201);
    const b = await createTask({ title: 'Kanban rank B' }).expect(201);
    const c = await createTask({ title: 'Kanban rank C' }).expect(201);
    const untouchedReview = await createTask({
      title: 'Kanban rank review untouched',
      statusDefinitionId: taskReviewStatusId,
    }).expect(201);
    const untouchedReviewRank = await prisma.task.findUniqueOrThrow({
      where: { id: untouchedReview.body.data.id },
      select: { kanbanRank: true },
    });

    await prisma.task.update({
      where: { id: a.body.data.id },
      data: { kanbanRank: new Prisma.Decimal('1.000000000001') },
    });
    await prisma.task.update({
      where: { id: b.body.data.id },
      data: { kanbanRank: new Prisma.Decimal('1.000000000002') },
    });
    await prisma.task.update({
      where: { id: c.body.data.id },
      data: { kanbanRank: null },
    });

    const nullRankPage = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?statusDefinitionId=${taskDefaultStatusId}&sortBy=kanbanRank&sortDirection=asc&pageSize=25`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    const nullRankIds = nullRankPage.body.data.items.map((task: { id: string }) => task.id);
    expect(nullRankIds.indexOf(c.body.data.id)).toBeGreaterThan(
      nullRankIds.indexOf(b.body.data.id),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${c.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId, beforeTaskId: b.body.data.id })
      .expect(200);

    const reordered = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?statusDefinitionId=${taskDefaultStatusId}&sortBy=kanbanRank&sortDirection=asc&pageSize=2`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(reordered.body.data.total).toBeGreaterThanOrEqual(3);
    expect(reordered.body.data.items.map((task: { id: string }) => task.id)).toEqual([
      a.body.data.id,
      c.body.data.id,
    ]);

    const fullColumn = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?statusDefinitionId=${taskDefaultStatusId}&sortBy=kanbanRank&sortDirection=asc&pageSize=25`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    const fullColumnIds = fullColumn.body.data.items.map((task: { id: string }) => task.id);
    expect(fullColumnIds.indexOf(a.body.data.id)).toBeLessThan(
      fullColumnIds.indexOf(c.body.data.id),
    );
    expect(fullColumnIds.indexOf(c.body.data.id)).toBeLessThan(
      fullColumnIds.indexOf(b.body.data.id),
    );
    await expect(
      prisma.task.findUniqueOrThrow({
        where: { id: untouchedReview.body.data.id },
        select: { kanbanRank: true },
      }),
    ).resolves.toEqual(untouchedReviewRank);
  });

  it('keeps Kanban WIP warning-only and assigns ranks from non-Kanban status changes', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/kanban/columns/${taskReviewStatusId}`)
      .set(auth(manageOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ wipLimit: 2 })
      .expect(200);

    const first = await createTask({ title: 'Kanban WIP one' }).expect(201);
    const second = await createTask({ title: 'Kanban WIP two' }).expect(201);
    const third = await createTask({ title: 'Kanban WIP three' }).expect(201);
    for (const task of [first, second, third]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/kanban-position`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: taskReviewStatusId })
        .expect(200);
    }

    const overLimit = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks?statusDefinitionId=${taskReviewStatusId}&sortBy=kanbanRank&sortDirection=asc&pageSize=25`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    const overLimitIds = overLimit.body.data.items.map((task: { id: string }) => task.id);
    expect(overLimit.body.data.total).toBeGreaterThan(2);
    expect(overLimitIds).toEqual(
      expect.arrayContaining([first.body.data.id, second.body.data.id, third.body.data.id]),
    );

    const bulkOne = await createTask({ title: 'Kanban bulk one' }).expect(201);
    const bulkTwo = await createTask({ title: 'Kanban bulk two' }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [bulkOne.body.data.id, bulkTwo.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(200);
    await expect(
      prisma.task.findMany({
        where: { id: { in: [bulkOne.body.data.id, bulkTwo.body.data.id] } },
        select: { statusDefinitionId: true, kanbanRank: true },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statusDefinitionId: taskCompletedStatusId,
          kanbanRank: expect.anything(),
        }),
        expect.objectContaining({
          statusDefinitionId: taskCompletedStatusId,
          kanbanRank: expect.anything(),
        }),
      ]),
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${bulkOne.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({
        where: { id: bulkOne.body.data.id },
        select: { statusDefinitionId: true, kanbanRank: true },
      }),
    ).resolves.toMatchObject({
      statusDefinitionId: taskDefaultStatusId,
      kanbanRank: expect.anything(),
    });
  });

  it('rejects stale Kanban anchors and preserves task state on transition rejection', async () => {
    const moving = await createTask({ title: 'Kanban anchor moving' }).expect(201);
    const sameColumnAnchor = await createTask({ title: 'Kanban anchor wrong column' }).expect(201);
    const deletedAnchor = await createTask({ title: 'Kanban anchor deleted' }).expect(201);
    const foreignAnchor = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Kanban foreign anchor',
    }).expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${deletedAnchor.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${moving.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskReviewStatusId, beforeTaskId: sameColumnAnchor.body.data.id })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${moving.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId, beforeTaskId: deletedAnchor.body.data.id })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${moving.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId, beforeTaskId: foreignAnchor.body.data.id })
      .expect(404);

    const parent = await createTask({ title: 'Kanban rollback parent' }).expect(201);
    await createSubtask(parent.body.data.id, { title: 'Kanban rollback child' }).expect(201);
    const before = await prisma.task.findUniqueOrThrow({
      where: { id: parent.body.data.id },
      select: { statusDefinitionId: true, kanbanRank: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/kanban-position`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);
    await expect(
      prisma.task.findUniqueOrThrow({
        where: { id: parent.body.data.id },
        select: { statusDefinitionId: true, kanbanRank: true },
      }),
    ).resolves.toEqual(before);
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
    expect(calls.reduce((total, response) => total + response.body.data.changedCount, 0)).toBe(1);
    expect(
      calls.reduce((total, response) => total + response.body.data.relationChangedCount, 0),
    ).toBe(1);
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

  it('supports direct subtasks, parent summaries, detach, and valid reparenting', async () => {
    const root = await createTask({ title: 'Hierarchy root' }).expect(201);
    const otherRoot = await createTask({ title: 'Hierarchy other root' }).expect(201);
    const child = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks`)
      .set(auth(createOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Hierarchy child', dueAt: '2027-01-01T00:00:00Z' })
      .expect(201);
    const grandchild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Hierarchy grandchild' })
      .expect(201);

    expect(child.body.data.parentTaskId).toBe(root.body.data.id);
    expect(child.body.data.parent.id).toBe(root.body.data.id);
    const rootDetail = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(rootDetail.body.data.directSubtaskCount).toBe(1);

    const directChildren = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(directChildren.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      child.body.data.id,
    ]);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: null })
      .expect(200)
      .expect((response) => expect(response.body.data.parentTaskId).toBeNull());
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: otherRoot.body.data.id })
      .expect(200)
      .expect((response) => expect(response.body.data.parentTaskId).toBe(otherRoot.body.data.id));
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: grandchild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: child.body.data.id });
  });

  it('enforces hierarchy database constraints and safe direct-subtask reads', async () => {
    const root = await createTask({ title: 'DB hierarchy root' }).expect(201);
    const childA = await createSubtask(root.body.data.id, { title: 'DB hierarchy child A' }).expect(
      201,
    );
    const childB = await createSubtask(root.body.data.id, { title: 'DB hierarchy child B' }).expect(
      201,
    );
    const grandchild = await createSubtask(childA.body.data.id, {
      title: 'DB hierarchy grandchild',
    }).expect(201);
    const foreign = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'DB foreign parent',
    }).expect(201);

    await expect(
      prisma.task.update({
        where: { id: root.body.data.id },
        data: { parentTaskId: root.body.data.id },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.task.update({
        where: { id: childA.body.data.id },
        data: { parentTaskId: foreign.body.data.id },
      }),
    ).rejects.toThrow();

    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${childB.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    const firstPage = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks?page=1&pageSize=1`,
      )
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(firstPage.body.data.total).toBe(1);
    expect(firstPage.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      childA.body.data.id,
    ]);
    expect(firstPage.body.data.items.map((item: { id: string }) => item.id)).not.toContain(
      grandchild.body.data.id,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks?page=0`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(detail.body.data.directSubtaskCount).toBe(1);

    const historicalParent = await createTask({ title: 'Historical deleted parent' }).expect(201);
    const historicalChild = await createSubtask(historicalParent.body.data.id, {
      title: 'Historical child',
    }).expect(201);
    await prisma.task.update({
      where: { id: historicalParent.body.data.id },
      data: { deletedAt: new Date() },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${historicalChild.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.parent).toBeNull());
  });

  it('rejects hierarchy cycles, foreign parents, deleted parents, forged headers, and weak RBAC', async () => {
    const root = await createTask({ title: 'Cycle root' }).expect(201);
    const child = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Cycle child' })
      .expect(201);
    const grandchild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Cycle grandchild' })
      .expect(201);
    const sameAgencyForeign = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Foreign workspace parent',
    }).expect(201);
    const crossAgencyForeign = await createTaskInWorkspace(workspaceB1, agencyB, ownerBToken, {
      title: 'Cross agency parent',
    }).expect(201);
    const deletedParent = await createTask({ title: 'Deleted parent' }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${deletedParent.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: root.body.data.id })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: grandchild.body.data.id })
      .expect(409);

    let deepParentId = root.body.data.id;
    const deepIds: string[] = [];
    for (const title of ['Cycle D', 'Cycle E']) {
      const created = await createSubtask(deepParentId, { title }).expect(201);
      deepIds.push(created.body.data.id);
      deepParentId = created.body.data.id;
    }
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: deepIds[deepIds.length - 1] })
      .expect(409);

    for (const parentTaskId of [
      sameAgencyForeign.body.data.id,
      crossAgencyForeign.body.data.id,
      randomUUID(),
      deletedParent.body.data.id,
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ parentTaskId })
        .expect(404);
    }
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ parentTaskId: root.body.data.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks`)
      .set(auth(ownerBToken))
      .set(ctx(agencyA, workspaceB1))
      .send({ title: 'Forged workspace subtask' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
      .set(auth(ownerBToken))
      .set(ctx(agencyB, workspaceA1))
      .send({ parentTaskId: root.body.data.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Viewer cannot create subtask' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/subtasks`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Update-only cannot create subtask' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: null })
      .expect(403);
  });

  it('keeps concurrent hierarchy reparent races acyclic with safe conflicts', async () => {
    const reciprocalA = await createTask({ title: 'Concurrent reciprocal A' }).expect(201);
    const reciprocalB = await createTask({ title: 'Concurrent reciprocal B' }).expect(201);

    const reciprocalResults = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${reciprocalA.body.data.id}/parent`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ parentTaskId: reciprocalB.body.data.id }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${reciprocalB.body.data.id}/parent`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ parentTaskId: reciprocalA.body.data.id }),
    ]);
    expect(reciprocalResults.map((response) => response.status).sort()).toEqual([200, 409]);
    await expectNoCycle([reciprocalA.body.data.id, reciprocalB.body.data.id]);

    const a = await createTask({ title: 'Concurrent deep A' }).expect(201);
    const b = await createTask({ title: 'Concurrent deep B' }).expect(201);
    const c = await createTask({ title: 'Concurrent deep C' }).expect(201);
    const deepResults = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${a.body.data.id}/parent`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ parentTaskId: b.body.data.id }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${b.body.data.id}/parent`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ parentTaskId: c.body.data.id }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${c.body.data.id}/parent`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ parentTaskId: a.body.data.id }),
    ]);
    expect(deepResults.every((response) => [200, 409].includes(response.status))).toBe(true);
    await expectNoCycle([a.body.data.id, b.body.data.id, c.body.data.id]);
  });

  it('keeps reparent and detach idempotent without noisy hierarchy audits', async () => {
    const parent = await createTask({ title: 'Idempotent parent' }).expect(201);
    const child = await createTask({ title: 'Idempotent child' }).expect(201);
    const subtask = await createSubtask(parent.body.data.id, {
      title: 'Audited subtask creation',
    }).expect(201);

    const subtaskAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'task.created', entityId: subtask.body.data.id },
      orderBy: { createdAt: 'desc' },
    });
    expect((subtaskAudit.metadata as { parentTaskId?: string }).parentTaskId).toBe(
      parent.body.data.id,
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: parent.body.data.id })
      .expect(200);
    const afterReparent = await prisma.task.findUniqueOrThrow({
      where: { id: child.body.data.id },
    });
    const parentChangedAudits = await prisma.auditLog.count({
      where: { action: 'task.parent_changed', entityId: child.body.data.id },
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: parent.body.data.id })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: child.body.data.id } }),
    ).resolves.toMatchObject({ updatedAt: afterReparent.updatedAt });
    await expect(
      prisma.auditLog.count({
        where: { action: 'task.parent_changed', entityId: child.body.data.id },
      }),
    ).resolves.toBe(parentChangedAudits);

    const root = await createTask({ title: 'Idempotent root detach' }).expect(201);
    const beforeDetach = await prisma.task.findUniqueOrThrow({ where: { id: root.body.data.id } });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${root.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: null })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: root.body.data.id } }),
    ).resolves.toMatchObject({ updatedAt: beforeDetach.updatedAt });

    const sameStatus = await createTask({ title: 'Idempotent status update' }).expect(201);
    const beforeStatus = await prisma.task.findUniqueOrThrow({
      where: { id: sameStatus.body.data.id },
    });
    const statusAuditCount = await prisma.auditLog.count({
      where: { action: 'task.status_changed', entityId: sameStatus.body.data.id },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${sameStatus.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${sameStatus.body.data.id}`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: sameStatus.body.data.id } }),
    ).resolves.toMatchObject({ updatedAt: beforeStatus.updatedAt });
    await expect(
      prisma.auditLog.count({
        where: { action: 'task.status_changed', entityId: sameStatus.body.data.id },
      }),
    ).resolves.toBe(statusAuditCount);
  });

  it('enforces terminal parent and terminal ancestor status invariants deeply', async () => {
    const parent = await createTask({ title: 'Terminal parent' }).expect(201);
    const child = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Terminal child' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);

    const deepParent = await createTask({ title: 'Deep terminal parent' }).expect(201);
    const deepChild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${deepParent.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Deep terminal child' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${deepChild.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Deep non-terminal grandchild' })
      .expect(201);
    await prisma.task.update({
      where: { id: deepChild.body.data.id },
      data: { statusDefinitionId: taskCompletedStatusId },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${deepParent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);

    const corruptParent = await createTask({ title: 'Corrupt ancestor parent' }).expect(201);
    const corruptMiddle = await createSubtask(corruptParent.body.data.id, {
      title: 'Corrupt ancestor middle',
    }).expect(201);
    const corruptLeaf = await createSubtask(corruptMiddle.body.data.id, {
      title: 'Corrupt ancestor leaf',
      statusDefinitionId: taskCompletedStatusId,
    }).expect(201);
    await prisma.task.update({
      where: { id: corruptParent.body.data.id },
      data: { statusDefinitionId: taskCompletedStatusId },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${corruptLeaf.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(409);
  });

  it('validates bulk status with prospective hierarchy state', async () => {
    const parent = await createTask({ title: 'Bulk hierarchy parent' }).expect(201);
    const child = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Bulk hierarchy child' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [parent.body.data.id], statusDefinitionId: taskCompletedStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [parent.body.data.id, child.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [child.body.data.id], statusDefinitionId: taskDefaultStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [parent.body.data.id, child.body.data.id],
        statusDefinitionId: taskDefaultStatusId,
      })
      .expect(200);

    const deepParent = await createTask({ title: 'Deep bulk parent' }).expect(201);
    const deepChild = await createSubtask(deepParent.body.data.id, {
      title: 'Deep bulk child',
    }).expect(201);
    const deepGrandchild = await createSubtask(deepChild.body.data.id, {
      title: 'Deep bulk grandchild',
    }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [deepParent.body.data.id, deepChild.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [deepParent.body.data.id, deepChild.body.data.id, deepGrandchild.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [deepChild.body.data.id, deepGrandchild.body.data.id],
        statusDefinitionId: taskDefaultStatusId,
      })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [deepGrandchild.body.data.id], statusDefinitionId: taskDefaultStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [deepParent.body.data.id, deepChild.body.data.id, deepGrandchild.body.data.id],
        statusDefinitionId: taskDefaultStatusId,
      })
      .expect(200);
  });

  it('guards terminal parent create/reparent rules and detaches surviving children on delete', async () => {
    const terminalParent = await createTask({
      title: 'Terminal parent for attach',
      statusDefinitionId: taskCompletedStatusId,
    }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${terminalParent.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Open child under terminal parent' })
      .expect(409);
    const terminalChild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${terminalParent.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        title: 'Terminal child under terminal parent',
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(201);
    const openMove = await createTask({ title: 'Open task moved under terminal' }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${openMove.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: terminalParent.body.data.id })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${openMove.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${openMove.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: terminalParent.body.data.id })
      .expect(200);
    expect(terminalChild.body.data.parentTaskId).toBe(terminalParent.body.data.id);

    const terminalSubtreeRoot = await createTask({ title: 'Terminal subtree root' }).expect(201);
    await createSubtask(terminalSubtreeRoot.body.data.id, {
      title: 'Open descendant in terminal subtree',
    }).expect(201);
    await prisma.task.update({
      where: { id: terminalSubtreeRoot.body.data.id },
      data: { statusDefinitionId: taskCompletedStatusId },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${terminalSubtreeRoot.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: terminalParent.body.data.id })
      .expect(409);

    const nonTerminalParent = await createTask({ title: 'Non-terminal reparent target' }).expect(
      201,
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${terminalChild.body.data.id}/parent`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ parentTaskId: nonTerminalParent.body.data.id })
      .expect(200);

    const deleteParent = await createTask({ title: 'Delete hierarchy parent' }).expect(201);
    const deleteChild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${deleteParent.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Delete hierarchy child' })
      .expect(201);
    const deleteGrandchild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${deleteChild.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Delete hierarchy grandchild' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${deleteParent.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: deleteChild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: deleteGrandchild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: deleteChild.body.data.id, deletedAt: null });

    const bulkParent = await createTask({ title: 'Bulk delete hierarchy parent' }).expect(201);
    const bulkChild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${bulkParent.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Bulk delete hierarchy child' })
      .expect(201);
    const bulkGrandchild = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${bulkChild.body.data.id}/subtasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ title: 'Bulk delete hierarchy grandchild' })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [bulkParent.body.data.id, bulkChild.body.data.id] })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: bulkGrandchild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });

    const middleParent = await createTask({ title: 'Delete middle parent' }).expect(201);
    const middle = await createSubtask(middleParent.body.data.id, {
      title: 'Delete middle node',
    }).expect(201);
    const middleChild = await createSubtask(middle.body.data.id, {
      title: 'Delete middle child',
    }).expect(201);
    const middleGrandchild = await createSubtask(middleChild.body.data.id, {
      title: 'Delete middle grandchild',
    }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${middle.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: middleParent.body.data.id } }),
    ).resolves.toMatchObject({ deletedAt: null });
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: middleChild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: middleGrandchild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: middleChild.body.data.id, deletedAt: null });

    const leafParent = await createTask({ title: 'Delete leaf parent' }).expect(201);
    const leaf = await createSubtask(leafParent.body.data.id, { title: 'Delete leaf' }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${leaf.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: leafParent.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });

    const nonContiguousParent = await createTask({ title: 'Bulk non-contiguous parent' }).expect(
      201,
    );
    const nonContiguousChild = await createSubtask(nonContiguousParent.body.data.id, {
      title: 'Bulk non-contiguous child',
    }).expect(201);
    const nonContiguousGrandchild = await createSubtask(nonContiguousChild.body.data.id, {
      title: 'Bulk non-contiguous grandchild',
    }).expect(201);
    const nonContiguousGreatGrandchild = await createSubtask(nonContiguousGrandchild.body.data.id, {
      title: 'Bulk non-contiguous great grandchild',
    }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [nonContiguousParent.body.data.id, nonContiguousGrandchild.body.data.id],
      })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: nonContiguousChild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: nonContiguousGreatGrandchild.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });

    const orderParentOne = await createTask({ title: 'Bulk order parent one' }).expect(201);
    const orderChildOne = await createSubtask(orderParentOne.body.data.id, {
      title: 'Bulk order child one',
    }).expect(201);
    const orderGrandchildOne = await createSubtask(orderChildOne.body.data.id, {
      title: 'Bulk order grandchild one',
    }).expect(201);
    const orderParentTwo = await createTask({ title: 'Bulk order parent two' }).expect(201);
    const orderChildTwo = await createSubtask(orderParentTwo.body.data.id, {
      title: 'Bulk order child two',
    }).expect(201);
    const orderGrandchildTwo = await createSubtask(orderChildTwo.body.data.id, {
      title: 'Bulk order grandchild two',
    }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [orderParentOne.body.data.id, orderChildOne.body.data.id] })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/bulk`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [orderChildTwo.body.data.id, orderParentTwo.body.data.id] })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: orderGrandchildOne.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: orderGrandchildTwo.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });

    const deleteAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'task.deleted', entityId: deleteParent.body.data.id },
      orderBy: { createdAt: 'desc' },
    });
    expect((deleteAudit.metadata as { detachedChildCount?: number }).detachedChildCount).toBe(1);
  });

  it('manages directed dependencies with pagination, idempotency, cycles, and completion rules', async () => {
    const a = await createTask({ title: 'Dependency A' }).expect(201);
    const b = await createTask({ title: 'Dependency B' }).expect(201);
    const c = await createTask({ title: 'Dependency C' }).expect(201);
    const d = await createTask({ title: 'Dependency D' }).expect(201);

    await addBlockedBy(c.body.data.id, [a.body.data.id, b.body.data.id])
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({ requestedCount: 2, changedCount: 2 }),
      );
    const dependencyAddAuditCount = await prisma.auditLog.count({
      where: { action: 'task.dependencies_added', entityId: c.body.data.id },
    });
    await addBlockedBy(c.body.data.id, [a.body.data.id])
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({ requestedCount: 1, changedCount: 0 }),
      );
    await expect(
      prisma.auditLog.count({
        where: { action: 'task.dependencies_added', entityId: c.body.data.id },
      }),
    ).resolves.toBe(dependencyAddAuditCount);

    const blockedBy = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${c.body.data.id}/blocked-by?page=1&pageSize=1`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(blockedBy.body.data.total).toBe(2);
    expect(blockedBy.body.data.items).toHaveLength(1);

    await addBlockedBy(b.body.data.id, [a.body.data.id]).expect(201);
    const blocks = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${a.body.data.id}/blocks`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(blocks.body.data.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [b.body.data.id, c.body.data.id].sort(),
    );

    await addBlockedBy(a.body.data.id, [c.body.data.id]).expect(409);
    await addBlockedBy(d.body.data.id, [c.body.data.id]).expect(201);
    await addBlockedBy(a.body.data.id, [d.body.data.id]).expect(409);
    await expect(
      prisma.taskDependency.count({
        where: { blockerTaskId: d.body.data.id, blockedTaskId: a.body.data.id },
      }),
    ).resolves.toBe(0);
    await addBlockedBy(a.body.data.id, [a.body.data.id]).expect(400);
    await expect(
      prisma.taskDependency.update({
        where: {
          blockerTaskId_blockedTaskId: {
            blockerTaskId: a.body.data.id,
            blockedTaskId: c.body.data.id,
          },
        },
        data: { blockedTaskId: a.body.data.id },
      }),
    ).rejects.toThrow();

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${c.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [a.body.data.id, c.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [a.body.data.id, b.body.data.id, c.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${a.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskDefaultStatusId })
      .expect(200);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: c.body.data.id } }),
    ).resolves.toMatchObject({ statusDefinitionId: taskCompletedStatusId });

    await removeBlockedBy(c.body.data.id, [a.body.data.id, b.body.data.id])
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(2));
    await removeBlockedBy(c.body.data.id, [a.body.data.id])
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(0));
  });

  it('rejects invalid blockers for terminal tasks and combines hierarchy plus dependency validation', async () => {
    const terminalBlocked = await createTask({
      title: 'Terminal blocked task',
      statusDefinitionId: taskCompletedStatusId,
    }).expect(201);
    const openBlocker = await createTask({ title: 'Open blocker for terminal task' }).expect(201);
    const terminalBlocker = await createTask({
      title: 'Terminal blocker for terminal task',
      statusDefinitionId: taskCompletedStatusId,
    }).expect(201);

    await addBlockedBy(terminalBlocked.body.data.id, [openBlocker.body.data.id]).expect(409);
    await expect(
      prisma.taskDependency.count({
        where: { blockedTaskId: terminalBlocked.body.data.id },
      }),
    ).resolves.toBe(0);
    await addBlockedBy(terminalBlocked.body.data.id, [terminalBlocker.body.data.id]).expect(201);

    const parent = await createTask({ title: 'Combined parent' }).expect(201);
    const child = await createSubtask(parent.body.data.id, { title: 'Combined child' }).expect(201);
    const blocker = await createTask({ title: 'Combined blocker' }).expect(201);
    await addBlockedBy(parent.body.data.id, [blocker.body.data.id]).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${blocker.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
  });

  it('keeps dependency rows historical across soft delete and ignores deleted blockers', async () => {
    const blocker = await createTask({ title: 'Deleted dependency blocker' }).expect(201);
    const blocked = await createTask({ title: 'Deleted dependency blocked' }).expect(201);
    const deletedBlocked = await createTask({ title: 'Deleted blocked dependency target' }).expect(
      201,
    );
    await addBlockedBy(blocked.body.data.id, [blocker.body.data.id]).expect(201);
    await addBlockedBy(deletedBlocked.body.data.id, [blocker.body.data.id]).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${blocker.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await expect(
      prisma.taskDependency.count({ where: { blockedTaskId: blocked.body.data.id } }),
    ).resolves.toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${blocked.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${blocked.body.data.id}/blocked-by`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));

    const activeBlocker = await createTask({ title: 'Active blocker for deleted blocked' }).expect(
      201,
    );
    await addBlockedBy(deletedBlocked.body.data.id, [activeBlocker.body.data.id]).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${deletedBlocked.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${activeBlocker.body.data.id}/blocks`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
  });

  it('manages symmetric related tasks canonically with tenant, RBAC, delete history, and audits', async () => {
    const a = await createTask({ title: 'Related A' }).expect(201);
    const b = await createTask({ title: 'Related B' }).expect(201);
    const c = await createTask({ title: 'Related C' }).expect(201);
    const foreign = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Foreign related',
    }).expect(201);

    await addRelated(a.body.data.id, [b.body.data.id, c.body.data.id])
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(2));
    const relatedAddAuditCount = await prisma.auditLog.count({
      where: { action: 'task.related_added', entityId: a.body.data.id },
    });
    await addRelated(b.body.data.id, [a.body.data.id])
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(0));
    await expect(
      prisma.auditLog.count({ where: { action: 'task.related_added', entityId: a.body.data.id } }),
    ).resolves.toBe(relatedAddAuditCount);
    await expect(
      prisma.taskRelatedTask.count({
        where: {
          OR: [
            { taskAId: a.body.data.id, taskBId: b.body.data.id },
            { taskAId: b.body.data.id, taskBId: a.body.data.id },
          ],
        },
      }),
    ).resolves.toBe(1);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${b.body.data.id}/related`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.items.map((item: { id: string }) => item.id)).toContain(
          a.body.data.id,
        ),
      );
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${a.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await addRelated(a.body.data.id, [a.body.data.id]).expect(400);
    const dbCheckCreator = (
      await prisma.task.findUniqueOrThrow({
        where: { id: a.body.data.id },
        select: { createdById: true },
      })
    ).createdById;
    await expect(
      prisma.taskRelatedTask.create({
        data: {
          workspaceId: workspaceA1,
          taskAId: a.body.data.id,
          taskBId: a.body.data.id,
          createdById: dbCheckCreator,
        },
      }),
    ).rejects.toThrow();
    const canonicalX = await createTask({ title: 'Canonical DB X' }).expect(201);
    const canonicalY = await createTask({ title: 'Canonical DB Y' }).expect(201);
    const [higherTaskId, lowerTaskId] =
      canonicalX.body.data.id > canonicalY.body.data.id
        ? [canonicalX.body.data.id, canonicalY.body.data.id]
        : [canonicalY.body.data.id, canonicalX.body.data.id];
    await expect(
      prisma.taskRelatedTask.create({
        data: {
          workspaceId: workspaceA1,
          taskAId: higherTaskId,
          taskBId: lowerTaskId,
          createdById: dbCheckCreator,
        },
      }),
    ).rejects.toThrow();
    await addRelated(a.body.data.id, [foreign.body.data.id]).expect(404);
    await addRelated(a.body.data.id, [b.body.data.id], createOnlyToken).expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${a.body.data.id}/related`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${c.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await expect(
      prisma.taskRelatedTask.count({
        where: { OR: [{ taskAId: c.body.data.id }, { taskBId: c.body.data.id }] },
      }),
    ).resolves.toBe(1);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${a.body.data.id}/related`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.items.map((item: { id: string }) => item.id)).not.toContain(
          c.body.data.id,
        ),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${a.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.relatedTaskCount).toBe(1));

    await removeRelated(a.body.data.id, [b.body.data.id])
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(1));
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'task.related_added', entityId: a.body.data.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({ agencyId: agencyA, workspaceId: workspaceA1 });
    expect((audit.metadata as { changedCount?: number }).changedCount).toBe(2);
  });

  it('rejects dependency and related tenant attacks without success audit', async () => {
    const base = await createTask({ title: 'Relationship tenant base' }).expect(201);
    const foreign = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Relationship foreign workspace',
    }).expect(201);
    const crossAgency = await createTaskInWorkspace(workspaceB1, agencyB, ownerBToken, {
      title: 'Relationship cross agency',
    }).expect(201);
    const deleted = await createTask({ title: 'Relationship deleted target' }).expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${deleted.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    for (const targetId of [
      foreign.body.data.id,
      crossAgency.body.data.id,
      randomUUID(),
      deleted.body.data.id,
    ]) {
      await addBlockedBy(base.body.data.id, [targetId]).expect(404);
      await addRelated(base.body.data.id, [targetId]).expect(404);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${base.body.data.id}/blocked-by`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ taskIds: [base.body.data.id] })
      .expect(403);
    await expect(
      prisma.auditLog.count({
        where: {
          action: { in: ['task.dependencies_added', 'task.related_added'] },
          entityId: base.body.data.id,
        },
      }),
    ).resolves.toBe(0);
  });

  it('keeps concurrent dependency and related writes safe', async () => {
    const a = await createTask({ title: 'Concurrent dependency A' }).expect(201);
    const b = await createTask({ title: 'Concurrent dependency B' }).expect(201);
    const reciprocal = await Promise.all([
      addBlockedBy(b.body.data.id, [a.body.data.id]),
      addBlockedBy(a.body.data.id, [b.body.data.id]),
    ]);
    expect(reciprocal.every((response) => [201, 409].includes(response.status))).toBe(true);
    await expectDependencyAcyclic([a.body.data.id, b.body.data.id]);

    const related = await Promise.all([
      addRelated(a.body.data.id, [b.body.data.id]),
      addRelated(b.body.data.id, [a.body.data.id]),
    ]);
    expect(related.every((response) => response.status === 201)).toBe(true);
    await expect(
      prisma.taskRelatedTask.count({
        where: {
          OR: [
            { taskAId: a.body.data.id, taskBId: b.body.data.id },
            { taskAId: b.body.data.id, taskBId: a.body.data.id },
          ],
        },
      }),
    ).resolves.toBe(1);
  });

  it('keeps relationship DB fences and graph semantics independent', async () => {
    const parent = await createTask({ title: 'Independent graph parent' }).expect(201);
    const child = await createSubtask(parent.body.data.id, {
      title: 'Independent graph child',
    }).expect(201);
    const foreign = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Independent graph foreign',
    }).expect(201);
    const creatorId = (
      await prisma.task.findUniqueOrThrow({
        where: { id: parent.body.data.id },
        select: { createdById: true },
      })
    ).createdById;

    await expect(
      prisma.taskDependency.create({
        data: {
          workspaceId: workspaceA1,
          blockerTaskId: foreign.body.data.id,
          blockedTaskId: parent.body.data.id,
          createdById: creatorId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.taskRelatedTask.create({
        data: {
          workspaceId: workspaceA1,
          taskAId: parent.body.data.id,
          taskBId: foreign.body.data.id,
          createdById: creatorId,
        },
      }),
    ).rejects.toThrow();

    await addBlockedBy(parent.body.data.id, [child.body.data.id]).expect(201);
    await addRelated(parent.body.data.id, [child.body.data.id]).expect(201);
    await expectNoCycle([parent.body.data.id, child.body.data.id]);
    await expectDependencyAcyclic([parent.body.data.id, child.body.data.id]);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${child.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);

    const relatedOnly = await createTask({ title: 'Related informational source' }).expect(201);
    const relatedTarget = await createTask({ title: 'Related informational target' }).expect(201);
    await addRelated(relatedOnly.body.data.id, [relatedTarget.body.data.id]).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${relatedOnly.body.data.id}/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
  });

  it('manages task comments, threaded replies, tombstones, mentions, and internal visibility', async () => {
    const task = await createTask({ title: 'Comment visibility task' }).expect(201);
    const root = await createComment(task.body.data.id, {
      body: '  Please review this thread  ',
      mentionedMembershipIds: [memberMembershipId, memberMembershipId, adminMembershipId],
    }).expect(201);

    expect(root.body.data).toMatchObject({
      body: 'Please review this thread',
      deleted: false,
      visibility: TaskCommentVisibility.NORMAL,
    });
    expect(root.body.data.mentions).toHaveLength(2);

    const reply = await createReply(task.body.data.id, root.body.data.id, {
      body: 'Direct reply',
    }).expect(201);
    const grandchild = await createReply(task.body.data.id, reply.body.data.id, {
      body: 'Nested reply',
    }).expect(201);
    await createReply(task.body.data.id, root.body.data.id, {
      body: 'Internal direct reply',
      visibility: TaskCommentVisibility.INTERNAL,
    }).expect(201);

    await createComment(task.body.data.id, {
      body: 'Internal root',
      visibility: TaskCommentVisibility.INTERNAL,
    }).expect(201);

    const adminList = await listComments(task.body.data.id).expect(200);
    expect(adminList.body.data.total).toBe(2);
    expect(
      adminList.body.data.items.find((item: { id: string }) => item.id === root.body.data.id)
        .directReplyCount,
    ).toBe(2);

    const viewerList = await listComments(task.body.data.id, commentViewerToken).expect(200);
    expect(viewerList.body.data.total).toBe(1);
    expect(viewerList.body.data.items[0]).toMatchObject({
      id: root.body.data.id,
      directReplyCount: 1,
    });

    const rootReplies = await listReplies(task.body.data.id, root.body.data.id, commentViewerToken)
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(1));
    expect(rootReplies.body.data.items[0].id).toBe(reply.body.data.id);

    await listReplies(task.body.data.id, reply.body.data.id, commentViewerToken)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(1);
        expect(response.body.data.items[0].id).toBe(grandchild.body.data.id);
      });

    await createComment(
      task.body.data.id,
      {
        body: 'Normal creator comment',
      },
      commentCreateToken,
    ).expect(201);
    await createComment(
      task.body.data.id,
      { body: 'Hidden creator comment', visibility: TaskCommentVisibility.INTERNAL },
      commentCreateToken,
    ).expect(403);
    await createReply(
      task.body.data.id,
      adminList.body.data.items.find(
        (item: { visibility: TaskCommentVisibility }) =>
          item.visibility === TaskCommentVisibility.INTERNAL,
      ).id,
      { body: 'Cannot discover hidden parent' },
      commentCreateToken,
    ).expect(404);

    await deleteComment(task.body.data.id, root.body.data.id).expect(200);
    const afterDelete = await listComments(task.body.data.id, commentViewerToken).expect(200);
    const tombstone = afterDelete.body.data.items.find(
      (item: { id: string }) => item.id === root.body.data.id,
    );
    expect(tombstone).toMatchObject({ body: null, deleted: true, directReplyCount: 1 });
    await createReply(task.body.data.id, root.body.data.id, { body: 'After delete' }).expect(404);
  });

  it('serializes comment delete and reply races without creating replies after tombstone', async () => {
    const task = await createTask({ title: 'Comment delete reply race task' }).expect(201);
    const parent = await createComment(task.body.data.id, { body: 'Race parent' }).expect(201);

    const [deleteResponse, replyResponse] = await Promise.all([
      deleteComment(task.body.data.id, parent.body.data.id),
      createReply(task.body.data.id, parent.body.data.id, { body: 'Race reply' }),
    ]);

    expect([200, 409]).toContain(deleteResponse.status);
    expect([201, 404, 409]).toContain(replyResponse.status);

    if (deleteResponse.status === 409) {
      await deleteComment(task.body.data.id, parent.body.data.id).expect(200);
    }

    const parentAfterRace = await prisma.taskComment.findUniqueOrThrow({
      where: { id: parent.body.data.id },
      select: { deletedAt: true },
    });
    expect(parentAfterRace.deletedAt).toBeTruthy();

    if (replyResponse.status === 201) {
      const replyAfterRace = await prisma.taskComment.findUniqueOrThrow({
        where: { id: replyResponse.body.data.id },
        select: { createdAt: true },
      });
      expect(replyAfterRace.createdAt.getTime()).toBeLessThanOrEqual(
        parentAfterRace.deletedAt!.getTime(),
      );
    }

    await createReply(task.body.data.id, parent.body.data.id, { body: 'Post-race reply' }).expect(
      404,
    );
  });

  it('enforces comment ownership, moderation, mention validation, reactions, tenant fences, and audits', async () => {
    const task = await createTask({ title: 'Comment moderation task' }).expect(201);
    const comment = await createComment(task.body.data.id, { body: 'Original comment' }).expect(
      201,
    );

    await patchComment(
      task.body.data.id,
      comment.body.data.id,
      { body: 'Unauthorized edit' },
      commentCreateToken,
    ).expect(403);

    await patchComment(task.body.data.id, comment.body.data.id, { body: 'Admin edit' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.body).toBe('Admin edit');
        expect(response.body.data.editedAt).toBeTruthy();
      });
    await patchComment(
      task.body.data.id,
      comment.body.data.id,
      { body: 'Owner moderation edit' },
      ownerAToken,
    ).expect(200);

    await deleteComment(task.body.data.id, comment.body.data.id, commentCreateToken).expect(403);

    await createComment(task.body.data.id, {
      body: 'Invalid suspended mention',
      mentionedMembershipIds: [suspendedMembershipId],
    }).expect(400);
    await createComment(task.body.data.id, {
      body: 'Invalid foreign mention',
      mentionedMembershipIds: [foreignMembershipId],
    }).expect(404);

    const secondTask = await createTask({ title: 'Comment route fence task' }).expect(201);
    await listReplies(secondTask.body.data.id, comment.body.data.id).expect(404);

    const reactionComment = await createComment(task.body.data.id, { body: 'React here' }).expect(
      201,
    );
    await addReaction(task.body.data.id, reactionComment.body.data.id, TaskCommentReactionType.LIKE)
      .expect(201)
      .expect((response) => expect(response.body.data.changed).toBe(true));
    await addReaction(task.body.data.id, reactionComment.body.data.id, TaskCommentReactionType.LIKE)
      .expect(201)
      .expect((response) => expect(response.body.data.changed).toBe(false));
    await addReaction(task.body.data.id, reactionComment.body.data.id, TaskCommentReactionType.LOVE)
      .expect(201)
      .expect((response) => expect(response.body.data.changed).toBe(true));
    await removeReaction(
      task.body.data.id,
      reactionComment.body.data.id,
      TaskCommentReactionType.LIKE,
    )
      .expect(200)
      .expect((response) => expect(response.body.data.changed).toBe(true));
    await removeReaction(
      task.body.data.id,
      reactionComment.body.data.id,
      TaskCommentReactionType.LIKE,
    )
      .expect(200)
      .expect((response) => expect(response.body.data.changed).toBe(false));
    await removeReaction(
      task.body.data.id,
      reactionComment.body.data.id,
      TaskCommentReactionType.LOVE,
      commentCreateToken,
    )
      .expect(200)
      .expect((response) => expect(response.body.data.changed).toBe(false));

    const internalComment = await createComment(task.body.data.id, {
      body: 'Internal reactions',
      visibility: TaskCommentVisibility.INTERNAL,
    }).expect(201);
    await addReaction(
      task.body.data.id,
      internalComment.body.data.id,
      TaskCommentReactionType.EYES,
      commentViewerToken,
    ).expect(404);

    await deleteComment(task.body.data.id, reactionComment.body.data.id).expect(200);
    await addReaction(
      task.body.data.id,
      reactionComment.body.data.id,
      TaskCommentReactionType.CHECK,
    ).expect(404);

    await expect(
      prisma.auditLog.count({
        where: {
          action: {
            in: [
              'task.comment_created',
              'task.comment_updated',
              'task.comment_deleted',
              'task.comment_reaction_added',
              'task.comment_reaction_removed',
            ],
          },
          entityType: 'TaskComment',
        },
      }),
    ).resolves.toBeGreaterThanOrEqual(5);
  });

  it('manages workspace tag catalog with normalization, color validation, lifecycle, RBAC, and audit', async () => {
    const bug = await createTag({ name: ' Bug ', color: '#2563eb' }).expect(201);
    expect(bug.body.data).toMatchObject({
      name: 'Bug',
      color: '#2563EB',
      status: WorkspaceTagStatus.ACTIVE,
    });

    await createTag({ name: 'bug' }).expect(409);
    await createTag({ name: 'BUG' }).expect(409);
    await createTag({ name: ' bug ' }).expect(409);
    await createTag({ name: 'Bug', color: 'url(javascript:alert(1))' }).expect(422);
    await createTag({ name: 'Bug', color: '#12345G' }).expect(422);
    await createTag({ name: 'Bug', color: '#123456' }, ownerAToken, workspaceA2, agencyA).expect(
      201,
    );

    const concurrent = await Promise.all([
      createTag({ name: 'Concurrent Tag' }),
      createTag({ name: ' concurrent tag ' }),
    ]);
    expect(concurrent.filter((response) => response.status === 201)).toHaveLength(1);
    expect(concurrent.filter((response) => response.status === 409)).toHaveLength(1);
    await expect(
      prisma.workspaceTag.count({
        where: { workspaceId: workspaceA1, nameNormalized: 'concurrent tag' },
      }),
    ).resolves.toBe(1);

    await listTags(tagViewerToken, '?search=bu&page=1&pageSize=5&status=ACTIVE')
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBeGreaterThanOrEqual(1);
        expect(response.body.data.items.map((item: { id: string }) => item.id)).toContain(
          bug.body.data.id,
        );
      });

    await updateTag(bug.body.data.id, { name: 'Product Bug', color: '#16a34a' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({ name: 'Product Bug', color: '#16A34A' });
      });
    const noOpAuditCount = await prisma.auditLog.count({
      where: { action: 'tag.updated', entityId: bug.body.data.id },
    });
    await updateTag(bug.body.data.id, { name: 'Product Bug', color: '#16A34A' }).expect(200);
    await expect(
      prisma.auditLog.count({ where: { action: 'tag.updated', entityId: bug.body.data.id } }),
    ).resolves.toBe(noOpAuditCount);

    await archiveTag(bug.body.data.id, tagArchiveToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.data.status).toBe(WorkspaceTagStatus.ARCHIVED);
      });
    const archivedAuditCount = await prisma.auditLog.count({
      where: { action: 'tag.archived', entityId: bug.body.data.id },
    });
    await archiveTag(bug.body.data.id, tagArchiveToken).expect(201);
    await expect(
      prisma.auditLog.count({ where: { action: 'tag.archived', entityId: bug.body.data.id } }),
    ).resolves.toBe(archivedAuditCount);
    await reactivateTag(bug.body.data.id, tagArchiveToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.data.status).toBe(WorkspaceTagStatus.ACTIVE);
      });

    await createTag({ name: 'Create without permission' }, tagViewerToken).expect(403);
    await updateTag(bug.body.data.id, { name: 'No update permission' }, tagCreateToken).expect(403);
    await archiveTag(bug.body.data.id, tagUpdateToken).expect(403);
    await listTags(tagCreateToken).expect(403);
  });

  it('adds, removes, preserves archived task tags, filters tasks by tag, and blocks tenant attacks', async () => {
    const task = await createTask({ title: 'Tagged task primary' }).expect(201);
    const otherTask = await createTask({ title: 'Tagged task secondary' }).expect(201);
    const bug = await createTag({ name: 'Task Bug', color: '#DC2626' }).expect(201);
    const urgent = await createTag({ name: 'Urgent Review', color: '#D97706' }).expect(201);
    const foreign = await createTag(
      { name: 'Foreign Tag' },
      ownerAToken,
      workspaceA2,
      agencyA,
    ).expect(201);
    const beta = await createTag({ name: 'Beta Tag' }, ownerBToken, workspaceB1, agencyB).expect(
      201,
    );

    await addTaskTags(task.body.data.id, [bug.body.data.id], tagAssignToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          requestedCount: 1,
          changedCount: 1,
          unchangedCount: 0,
        });
      });
    await addTaskTags(task.body.data.id, [bug.body.data.id, urgent.body.data.id], tagAssignToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          requestedCount: 2,
          changedCount: 1,
          unchangedCount: 1,
        });
      });
    await addTaskTags(
      task.body.data.id,
      [bug.body.data.id, bug.body.data.id],
      tagAssignToken,
    ).expect(422);
    await addTaskTags(task.body.data.id, [foreign.body.data.id], tagAssignToken).expect(404);
    await addTaskTags(task.body.data.id, [beta.body.data.id], tagAssignToken).expect(404);
    await addTaskTags(
      task.body.data.id,
      [urgent.body.data.id, foreign.body.data.id],
      tagAssignToken,
    ).expect(404);
    await expect(
      prisma.taskTag.findUnique({
        where: { taskId_tagId: { taskId: task.body.data.id, tagId: urgent.body.data.id } },
      }),
    ).resolves.not.toBeNull();
    await addTaskTags(task.body.data.id, [bug.body.data.id], tagViewerToken).expect(403);
    await addTaskTags(task.body.data.id, [urgent.body.data.id], updateOnlyToken).expect(403);
    await addTaskTags(task.body.data.id, [urgent.body.data.id], tagAssignOnlyToken).expect(403);

    await listTaskTags(task.body.data.id, viewerToken).expect(200);
    await listTaskTags(task.body.data.id, tagViewerToken).expect(403);
    await listTaskTags(task.body.data.id)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.map((tag: { id: string }) => tag.id).sort()).toEqual(
          [bug.body.data.id, urgent.body.data.id].sort(),
        );
      });

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?tagId=${bug.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.items.map((item: { id: string }) => item.id)).toContain(
          task.body.data.id,
        );
        expect(response.body.data.items.map((item: { id: string }) => item.id)).not.toContain(
          otherTask.body.data.id,
        );
      });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?tagId=${foreign.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));

    await archiveTag(bug.body.data.id).expect(201);
    await addTaskTags(otherTask.body.data.id, [bug.body.data.id], tagAssignToken).expect(400);
    await addTaskTags(
      otherTask.body.data.id,
      [urgent.body.data.id, bug.body.data.id],
      tagAssignToken,
    ).expect(400);
    await expect(
      prisma.taskTag.findUnique({
        where: { taskId_tagId: { taskId: otherTask.body.data.id, tagId: urgent.body.data.id } },
      }),
    ).resolves.toBeNull();
    await listTaskTags(task.body.data.id)
      .expect(200)
      .expect((response) => {
        const archived = response.body.data.find(
          (tag: { id: string }) => tag.id === bug.body.data.id,
        );
        expect(archived.status).toBe(WorkspaceTagStatus.ARCHIVED);
      });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?tagId=${bug.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(1));

    await removeTaskTags(
      task.body.data.id,
      [bug.body.data.id, foreign.body.data.id],
      tagAssignToken,
    ).expect(404);
    await removeTaskTags(task.body.data.id, [bug.body.data.id], tagAssignToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          requestedCount: 1,
          changedCount: 1,
          unchangedCount: 0,
        });
      });
    await removeTaskTags(task.body.data.id, [bug.body.data.id], tagAssignToken)
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          requestedCount: 1,
          changedCount: 0,
          unchangedCount: 1,
        });
      });

    await reactivateTag(bug.body.data.id).expect(201);
    await addTaskTags(otherTask.body.data.id, [bug.body.data.id], tagAssignToken).expect(201);
  });

  it('hardens task tag database fences, rename conflicts, color contract, and concurrency', async () => {
    const task = await createTask({ title: 'Tag hardening task' }).expect(201);
    const foreignTask = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Foreign tag hardening task',
    }).expect(201);
    const bug = await createTag({ name: 'Hardening Bug', color: '#ff0000' }).expect(201);
    const review = await createTag({ name: 'Hardening Review' }).expect(201);
    const foreign = await createTag(
      { name: 'Hardening Foreign' },
      ownerAToken,
      workspaceA2,
      agencyA,
    ).expect(201);

    expect(bug.body.data).toMatchObject({ name: 'Hardening Bug', color: '#FF0000' });
    for (const color of [
      '#FFF',
      'rgb(255, 0, 0)',
      'rgba(255, 0, 0, 1)',
      'url(javascript:alert(1))',
      'var(--red)',
      'javascript:',
      '<b>#FF0000</b>',
      '#12345678',
      '',
    ]) {
      await createTag({ name: `Bad color ${color || 'blank'}`, color }).expect(422);
    }

    await updateTag(review.body.data.id, { name: ' hardening bug ' }).expect(409);
    await expect(
      prisma.workspaceTag.findUniqueOrThrow({ where: { id: review.body.data.id } }),
    ).resolves.toMatchObject({ name: 'Hardening Review' });

    const swap = await Promise.all([
      updateTag(bug.body.data.id, { name: 'Hardening Review' }),
      updateTag(review.body.data.id, { name: 'Hardening Bug' }),
    ]);
    expect(swap.every((response) => [200, 409].includes(response.status))).toBe(true);
    await expect(
      prisma.workspaceTag.count({
        where: { workspaceId: workspaceA1, nameNormalized: 'hardening bug' },
      }),
    ).resolves.toBeLessThanOrEqual(1);
    await expect(
      prisma.workspaceTag.count({
        where: { workspaceId: workspaceA1, nameNormalized: 'hardening review' },
      }),
    ).resolves.toBeLessThanOrEqual(1);

    const createdBy = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin-a@zeaplay.test' },
      select: { id: true },
    });
    await expect(
      prisma.taskTag.create({
        data: {
          workspaceId: workspaceA1,
          taskId: task.body.data.id,
          tagId: foreign.body.data.id,
          createdById: createdBy.id,
        },
      }),
    ).rejects.toBeTruthy();
    await expect(
      prisma.taskTag.create({
        data: {
          workspaceId: workspaceA1,
          taskId: foreignTask.body.data.id,
          tagId: bug.body.data.id,
          createdById: createdBy.id,
        },
      }),
    ).rejects.toBeTruthy();

    await addTaskTags(task.body.data.id, [review.body.data.id], tagAssignToken).expect(201);
    const duplicateAdd = await Promise.all([
      addTaskTags(task.body.data.id, [bug.body.data.id], tagAssignToken),
      addTaskTags(task.body.data.id, [bug.body.data.id], tagAssignToken),
    ]);
    expect(duplicateAdd.every((response) => [201, 409].includes(response.status))).toBe(true);
    await expect(
      prisma.taskTag.count({
        where: { workspaceId: workspaceA1, taskId: task.body.data.id, tagId: bug.body.data.id },
      }),
    ).resolves.toBe(1);

    await removeTaskTags(
      task.body.data.id,
      [review.body.data.id, foreign.body.data.id],
      tagAssignToken,
    ).expect(404);
    await expect(
      prisma.taskTag.findUnique({
        where: { taskId_tagId: { taskId: task.body.data.id, tagId: review.body.data.id } },
      }),
    ).resolves.not.toBeNull();

    const raceTag = await createTag({ name: 'Archive Assign Race' }).expect(201);
    const raceTask = await createTask({ title: 'Archive assign race task' }).expect(201);
    const race = await Promise.all([
      archiveTag(raceTag.body.data.id),
      addTaskTags(raceTask.body.data.id, [raceTag.body.data.id], tagAssignToken),
    ]);
    expect(race.every((response) => [201, 400, 409].includes(response.status))).toBe(true);
    await expect(
      prisma.taskTag.count({
        where: {
          workspaceId: workspaceA1,
          taskId: raceTask.body.data.id,
          tagId: raceTag.body.data.id,
        },
      }),
    ).resolves.toBeLessThanOrEqual(1);
  });

  it('audits changed tag actions without noisy no-op task tag audit rows', async () => {
    const task = await createTask({ title: 'Tag audit task' }).expect(201);
    const tag = await createTag({ name: 'Audit Tag' }).expect(201);

    const addAuditCount = await prisma.auditLog.count({
      where: { action: 'task.tags_added', entityId: task.body.data.id },
    });
    await addTaskTags(task.body.data.id, [tag.body.data.id]).expect(201);
    await expect(
      prisma.auditLog.count({ where: { action: 'task.tags_added', entityId: task.body.data.id } }),
    ).resolves.toBe(addAuditCount + 1);
    await addTaskTags(task.body.data.id, [tag.body.data.id]).expect(201);
    await expect(
      prisma.auditLog.count({ where: { action: 'task.tags_added', entityId: task.body.data.id } }),
    ).resolves.toBe(addAuditCount + 1);

    const removeAuditCount = await prisma.auditLog.count({
      where: { action: 'task.tags_removed', entityId: task.body.data.id },
    });
    await removeTaskTags(task.body.data.id, [tag.body.data.id]).expect(201);
    await expect(
      prisma.auditLog.count({
        where: { action: 'task.tags_removed', entityId: task.body.data.id },
      }),
    ).resolves.toBe(removeAuditCount + 1);
    await removeTaskTags(task.body.data.id, [tag.body.data.id]).expect(201);
    await expect(
      prisma.auditLog.count({
        where: { action: 'task.tags_removed', entityId: task.body.data.id },
      }),
    ).resolves.toBe(removeAuditCount + 1);
  });

  it('supports task URL attachments with explicit RBAC, soft unlink, and tenant fences', async () => {
    const task = await createTask({ title: 'Attachment URL task' }).expect(201);
    const foreignTask = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Foreign attachment task',
    }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/attachments/url`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ url: 'https://example.com/no-permission' })
      .expect(403);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/attachments/url`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ url: 'https://example.com/phase-7-4d', displayName: 'Phase 7.4D URL' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      taskId: task.body.data.id,
      type: 'URL',
      displayName: 'Phase 7.4D URL',
      url: 'https://example.com/phase-7-4d',
      file: null,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/attachments/url`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ url: 'javascript:alert(1)' })
      .expect(422);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/attachments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(1);
        expect(response.body.data.items[0].id).toBe(created.body.data.id);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${foreignTask.body.data.id}/attachments/link`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ attachmentIds: [created.body.data.id] })
      .expect(404);

    await request(app.getHttpServer())
      .delete(
        `/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/attachments/${created.body.data.id}`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.changed).toBe(true));
    await expect(
      prisma.attachment.findUnique({ where: { id: created.body.data.id } }),
    ).resolves.not.toBeNull();
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/attachments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/attachments/link`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ attachmentIds: [created.body.data.id] })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          requestedCount: 1,
          changedCount: 1,
          unchangedCount: 0,
        });
      });
  });

  it('enforces attachment DB invariants, URL schemes, file reuse, quota, and download fences', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const primaryTask = await createTask({ title: 'Reusable attachment primary' }).expect(201);
    const secondaryTask = await createTask({ title: 'Reusable attachment secondary' }).expect(201);
    const unlinkedTask = await createTask({ title: 'Reusable attachment unlinked' }).expect(201);

    const invalidFileWithoutAsset = randomUUID();
    await expect(
      prisma.$executeRaw`
        INSERT INTO "attachments" ("id", "workspace_id", "type", "display_name", "created_by_id", "updated_at")
        VALUES (${invalidFileWithoutAsset}::uuid, ${workspaceA1}::uuid, 'FILE'::"AttachmentType", 'Invalid file', ${admin.id}::uuid, NOW())
      `,
    ).rejects.toThrow();
    const invalidUrlWithAsset = randomUUID();
    await expect(
      prisma.$executeRaw`
        INSERT INTO "attachments" ("id", "workspace_id", "type", "asset_id", "url", "display_name", "created_by_id", "updated_at")
        VALUES (${invalidUrlWithAsset}::uuid, ${workspaceA1}::uuid, 'URL'::"AttachmentType", ${invalidUrlWithAsset}::uuid, 'https://example.com', 'Invalid url', ${admin.id}::uuid, NOW())
      `,
    ).rejects.toThrow();

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/url`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ url: 'ftp://example.com/file' })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/url`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ url: 'data:text/plain,hello' })
      .expect(422);

    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/upload-init`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        filename: 'exact-boundary.txt',
        displayName: 'Exact boundary',
        mimeType: 'text/plain',
        sizeBytes: 25 * 1024 * 1024,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/upload-init`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        filename: 'too-large.txt',
        displayName: 'Too large',
        mimeType: 'text/plain',
        sizeBytes: 25 * 1024 * 1024 + 1,
      })
      .expect(413);

    const beforeQuota = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceA1 },
      select: { storageUsedBytes: true },
    });
    const asset = await prisma.asset.create({
      data: {
        workspaceId: workspaceA1,
        projectId: null,
        createdById: admin.id,
        originalFilename: 'reusable.txt',
        displayName: 'Reusable File',
        storageBucket: 'zea-play-dev',
        storageKey: `test/${randomUUID()}/reusable.txt`,
        mimeType: 'text/plain',
        extension: 'txt',
        sizeBytes: BigInt(128),
        status: AssetStatus.READY,
        uploadExpiresAt: new Date(Date.now() + 60_000),
        metadata: { fixture: true },
      },
    });
    const attachment = await prisma.attachment.create({
      data: {
        id: asset.id,
        workspaceId: workspaceA1,
        type: AttachmentType.FILE,
        assetId: asset.id,
        displayName: 'Reusable File',
        createdById: admin.id,
      },
    });
    const invalidFileWithUrl = randomUUID();
    await expect(
      prisma.$executeRaw`
        INSERT INTO "attachments" ("id", "workspace_id", "type", "asset_id", "url", "display_name", "created_by_id", "updated_at")
        VALUES (${invalidFileWithUrl}::uuid, ${workspaceA1}::uuid, 'FILE'::"AttachmentType", ${asset.id}::uuid, 'https://example.com/file', 'Invalid file payload', ${admin.id}::uuid, NOW())
      `,
    ).rejects.toThrow();
    const invalidUrlWithoutUrl = randomUUID();
    await expect(
      prisma.$executeRaw`
        INSERT INTO "attachments" ("id", "workspace_id", "type", "display_name", "created_by_id", "updated_at")
        VALUES (${invalidUrlWithoutUrl}::uuid, ${workspaceA1}::uuid, 'URL'::"AttachmentType", 'Invalid url payload', ${admin.id}::uuid, NOW())
      `,
    ).rejects.toThrow();
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceA1}/tasks/${secondaryTask.body.data.id}/attachments/${attachment.id}/upload-complete`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ sizeBytes: 128 })
      .expect(404);
    await prisma.projectAttachment.create({
      data: {
        workspaceId: workspaceA1,
        projectId: activeProjectId,
        attachmentId: attachment.id,
        attachedById: admin.id,
      },
    });

    await expect(
      prisma.projectAttachment.findUnique({
        where: {
          projectId_attachmentId: { projectId: activeProjectId, attachmentId: attachment.id },
        },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.asset.findUniqueOrThrow({
        where: { id: asset.id },
        select: { projectId: true },
      }),
    ).resolves.toMatchObject({ projectId: null });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/link`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ attachmentIds: [attachment.id] })
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(1));
    const duplicateAuditCount = await prisma.auditLog.count({
      where: { action: 'task.attachments_linked', entityId: primaryTask.body.data.id },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/link`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ attachmentIds: [attachment.id] })
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(0));
    await expect(
      prisma.auditLog.count({
        where: { action: 'task.attachments_linked', entityId: primaryTask.body.data.id },
      }),
    ).resolves.toBe(duplicateAuditCount);

    const concurrentLinks = await Promise.all([
      request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${workspaceA1}/tasks/${secondaryTask.body.data.id}/attachments/link`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ attachmentIds: [attachment.id] }),
      request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${workspaceA1}/tasks/${secondaryTask.body.data.id}/attachments/link`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ attachmentIds: [attachment.id] }),
    ]);
    expect(concurrentLinks.map((response) => response.status).sort()).toEqual([201, 201]);
    expect(
      concurrentLinks.reduce(
        (total, response) => total + Number(response.body.data.changedCount),
        0,
      ),
    ).toBe(1);
    await expect(
      prisma.taskAttachment.count({
        where: { taskId: secondaryTask.body.data.id, attachmentId: attachment.id },
      }),
    ).resolves.toBe(1);

    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/${attachment.id}/download`,
      )
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/${unlinkedTask.body.data.id}/attachments/${attachment.id}/download`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/${attachment.id}/download`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.downloadUrl).toEqual(expect.stringMatching(/^https?:\/\//));
      });

    await request(app.getHttpServer())
      .delete(
        `/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/${attachment.id}`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/${primaryTask.body.data.id}/attachments/${attachment.id}/download`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await expect(prisma.asset.findUnique({ where: { id: asset.id } })).resolves.not.toBeNull();
    await expect(
      prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceA1 },
        select: { storageUsedBytes: true },
      }),
    ).resolves.toMatchObject({ storageUsedBytes: beforeQuota.storageUsedBytes });
  });

  it('validates combined hierarchy and dependency bulk status transitions atomically', async () => {
    const p = await createTask({ title: 'Deep combined parent' }).expect(201);
    const a = await createSubtask(p.body.data.id, { title: 'Deep combined child' }).expect(201);
    const b = await createSubtask(a.body.data.id, { title: 'Deep combined grandchild' }).expect(
      201,
    );
    const x = await createTask({ title: 'Deep combined blocker P' }).expect(201);
    const y = await createTask({ title: 'Deep combined blocker A' }).expect(201);
    await addBlockedBy(p.body.data.id, [x.body.data.id]).expect(201);
    await addBlockedBy(a.body.data.id, [y.body.data.id]).expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [p.body.data.id, a.body.data.id, b.body.data.id, y.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(409);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: p.body.data.id } }),
    ).resolves.toMatchObject({ statusDefinitionId: taskDefaultStatusId });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [p.body.data.id, a.body.data.id, x.body.data.id, y.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(409);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: a.body.data.id } }),
    ).resolves.toMatchObject({ statusDefinitionId: taskDefaultStatusId });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(updateOnlyToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        taskIds: [p.body.data.id, a.body.data.id, b.body.data.id, x.body.data.id, y.body.data.id],
        statusDefinitionId: taskCompletedStatusId,
      })
      .expect(200);
  });

  it('preserves graph history while active reads and counts ignore deleted endpoints', async () => {
    const p = await createTask({ title: 'Delete graph parent' }).expect(201);
    const a = await createSubtask(p.body.data.id, { title: 'Delete graph child' }).expect(201);
    const b = await createSubtask(a.body.data.id, { title: 'Delete graph grandchild' }).expect(201);
    const x = await createTask({ title: 'Delete graph blocker' }).expect(201);
    const y = await createTask({ title: 'Delete graph blocked' }).expect(201);
    const z = await createTask({ title: 'Delete graph related' }).expect(201);
    await addBlockedBy(p.body.data.id, [x.body.data.id]).expect(201);
    await addBlockedBy(y.body.data.id, [a.body.data.id]).expect(201);
    await addRelated(p.body.data.id, [z.body.data.id]).expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tasks/${p.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${p.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: a.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: null, deletedAt: null });
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: b.body.data.id } }),
    ).resolves.toMatchObject({ parentTaskId: a.body.data.id, deletedAt: null });
    await expect(
      prisma.taskDependency.count({
        where: {
          OR: [
            { blockerTaskId: x.body.data.id, blockedTaskId: p.body.data.id },
            { blockerTaskId: a.body.data.id, blockedTaskId: y.body.data.id },
          ],
        },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.taskRelatedTask.count({
        where: { OR: [{ taskAId: p.body.data.id }, { taskBId: p.body.data.id }] },
      }),
    ).resolves.toBe(1);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${x.body.data.id}/blocks`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${z.body.data.id}/related`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${y.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.blockedByCount).toBe(1));
  });

  it('keeps status and relationship races from committing invalid graph states', async () => {
    const blocker = await createTask({ title: 'Race blocker' }).expect(201);
    const blocked = await createTask({ title: 'Race blocked' }).expect(201);
    const dependencyRace = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${blocked.body.data.id}/status`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: taskCompletedStatusId }),
      addBlockedBy(blocked.body.data.id, [blocker.body.data.id]),
    ]);
    expect(dependencyRace.filter((response) => response.status === 409)).toHaveLength(1);
    expect(dependencyRace.filter((response) => [200, 201].includes(response.status))).toHaveLength(
      1,
    );
    const blockedAfterRace = await prisma.task.findUniqueOrThrow({
      where: { id: blocked.body.data.id },
      select: { statusDefinition: { select: { isTerminal: true } } },
    });
    const activeBlockers = await prisma.taskDependency.count({
      where: {
        blockedTaskId: blocked.body.data.id,
        blockerTask: { deletedAt: null, statusDefinition: { isTerminal: false } },
      },
    });
    expect(blockedAfterRace.statusDefinition.isTerminal && activeBlockers > 0).toBe(false);

    const parent = await createTask({ title: 'Race parent' }).expect(201);
    const childRace = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${parent.body.data.id}/status`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: taskCompletedStatusId }),
      createSubtask(parent.body.data.id, { title: 'Race child' }),
    ]);
    expect(childRace.filter((response) => response.status === 409)).toHaveLength(1);
    expect(childRace.filter((response) => [200, 201].includes(response.status))).toHaveLength(1);
    await expectNoTerminalParentWithOpenDescendant(parent.body.data.id);

    const reparentTarget = await createTask({ title: 'Race reparent target' }).expect(201);
    const movingRoot = await createTask({ title: 'Race moving root' }).expect(201);
    await createSubtask(movingRoot.body.data.id, { title: 'Race moving child' }).expect(201);
    const reparentRace = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${reparentTarget.body.data.id}/status`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: taskCompletedStatusId }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${movingRoot.body.data.id}/parent`)
        .set(auth(updateOnlyToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ parentTaskId: reparentTarget.body.data.id }),
    ]);
    expect(reparentRace.filter((response) => response.status === 409)).toHaveLength(1);
    expect(reparentRace.filter((response) => response.status === 200)).toHaveLength(1);
    await expectNoTerminalParentWithOpenDescendant(reparentTarget.body.data.id);
  });

  it('bounds graph mutation inputs, read pagination, and all-tasks graph hydration', async () => {
    const base = await createTask({ title: 'Bounded graph base' }).expect(201);
    const creatorId = (
      await prisma.task.findUniqueOrThrow({
        where: { id: base.body.data.id },
        select: { createdById: true },
      })
    ).createdById;
    await addBlockedBy(base.body.data.id, []).expect(422);
    await addRelated(base.body.data.id, []).expect(422);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${base.body.data.id}/blocked-by?page=0`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${base.body.data.id}/related?pageSize=101`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);

    const rows = Array.from({ length: 101 }, (_, index) => ({
      workspaceId: workspaceA1,
      title: `Bounded graph blocker ${index.toString().padStart(3, '0')}`,
      statusDefinitionId: taskDefaultStatusId,
      createdById: creatorId,
    }));
    await prisma.task.createMany({ data: rows });
    const blockers = await prisma.task.findMany({
      where: { workspaceId: workspaceA1, title: { startsWith: 'Bounded graph blocker ' } },
      select: { id: true },
      orderBy: { title: 'asc' },
    });
    expect(blockers).toHaveLength(101);
    await addBlockedBy(
      base.body.data.id,
      blockers.slice(0, 100).map((task) => task.id),
    )
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(100));
    await addRelated(
      base.body.data.id,
      blockers.slice(0, 100).map((task) => task.id),
    )
      .expect(201)
      .expect((response) => expect(response.body.data.changedCount).toBe(100));
    await addBlockedBy(
      base.body.data.id,
      blockers.map((task) => task.id),
    ).expect(422);
    await addRelated(
      base.body.data.id,
      blockers.map((task) => task.id),
    ).expect(422);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?page=1&pageSize=1`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(listed.body.data.items[0]).not.toHaveProperty('blockedByCount');
    expect(listed.body.data.items[0]).not.toHaveProperty('blocksCount');
    expect(listed.body.data.items[0]).not.toHaveProperty('relatedTaskCount');
    expect(listed.body.data.items[0].counts).not.toHaveProperty('subtasks');
    expect(listed.body.data.items[0].counts).not.toHaveProperty('blockedByDependencies');
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

  it('does not leak restricted project metadata through task project summaries', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const viewer = await prisma.user.findUniqueOrThrow({
      where: { email: 'viewer-a@zeaplay.test' },
    });
    const viewerMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: viewer.id, workspaceId: workspaceA1 } },
    });
    const projectViewPermission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'projects.view' },
    });
    await prisma.rolePermission.create({
      data: { roleId: viewerMembership.roleId, permissionId: projectViewPermission.id },
    });
    const restrictedProject = await project(
      workspaceA1,
      admin.id,
      'Restricted Task Summary Project',
      ProjectStatus.ACTIVE,
      ProjectVisibility.RESTRICTED,
    );
    const visibleProject = await project(workspaceA1, admin.id, 'Visible Task Selector Project');
    const linked = await createTask({
      title: 'Restricted project task summary',
      projectIds: [restrictedProject.id, visibleProject.id],
    }).expect(201);
    expect(linked.body.data.projects.map((item: { id: string }) => item.id)).toContain(
      restrictedProject.id,
    );

    const hiddenDetail = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${linked.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(hiddenDetail.body.data.projects.map((item: { id: string }) => item.id)).toEqual([
      visibleProject.id,
    ]);

    const hiddenList = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?search=Restricted%20project%20task%20summary`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(hiddenList.body.data.items[0].projects.map((item: { id: string }) => item.id)).toEqual([
      visibleProject.id,
    ]);

    const selector = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?search=Task%20Selector&page=1&pageSize=20`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(selector.body.data.items.map((item: { id: string }) => item.id)).toEqual([
      visibleProject.id,
    ]);

    await prisma.projectMember.create({
      data: {
        workspaceId: workspaceA1,
        projectId: restrictedProject.id,
        workspaceMembershipId: viewerMembership.id,
        addedByMembershipId: adminMembershipId,
      },
    });
    const visibleDetail = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks/${linked.body.data.id}`)
      .set(auth(viewerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(visibleDetail.body.data.projects.map((item: { id: string }) => item.id)).toContain(
      restrictedProject.id,
    );
  });

  it('enforces global live timers, atomic switching, terminal auto-stop, and manual time on completed tasks', async () => {
    const primary = await createTask({
      title: 'Phase 7.8 timer primary',
      assigneeMembershipIds: [adminMembershipId],
    }).expect(201);
    const secondary = await createTaskInWorkspace(workspaceA2, agencyA, ownerAToken, {
      title: 'Phase 7.8 timer secondary',
    }).expect(201);

    const started = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${primary.body.data.id}/time/start`)
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA1))
      .send({})
      .expect(201);
    expect(started.body.data).toMatchObject({
      taskId: primary.body.data.id,
      entryType: 'TIMER',
      endedAt: null,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/tasks/${secondary.body.data.id}/time/start`)
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA2))
      .send({})
      .expect(409);

    const switched = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/tasks/${secondary.body.data.id}/time/start`)
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ replaceRunning: true })
      .expect(201);
    expect(switched.body.data.taskId).toBe(secondary.body.data.id);
    await expect(
      prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: started.body.data.id } }),
    ).resolves.toMatchObject({
      endedAt: expect.any(Date),
      stopReason: 'SWITCHED_TASK',
    });
    await expect(
      prisma.taskTimeEntry.count({
        where: { userId: switched.body.data.userId, endedAt: null, deletedAt: null },
      }),
    ).resolves.toBe(1);

    const workspaceA2Completed = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA2, entityType: 'TASK', name: 'Completed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA2}/tasks/${secondary.body.data.id}/status`)
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ statusDefinitionId: workspaceA2Completed.id })
      .expect(200);
    await expect(
      prisma.taskTimeEntry.findUniqueOrThrow({ where: { id: switched.body.data.id } }),
    ).resolves.toMatchObject({
      endedAt: expect.any(Date),
      stopReason: 'TASK_TERMINAL',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/tasks/${secondary.body.data.id}/time/start`)
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA2))
      .send({})
      .expect(409);

    const completed = await createTask({ title: 'Phase 7.8 manual completed' }).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${completed.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${completed.body.data.id}/time`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        startedAt: '2026-09-18T10:00:00.000Z',
        endedAt: '2026-09-18T10:30:00.000Z',
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          taskId: completed.body.data.id,
          entryType: 'MANUAL',
          durationSeconds: 1800,
        });
      });
  });

  it('clips time-report totals across the full filtered dataset, independent of loaded page', async () => {
    const task = await createTask({ title: 'Phase 7.8 report clipping' }).expect(201);
    for (const [startedAt, endedAt] of [
      ['2026-09-18T10:00:00.000Z', '2026-09-18T11:00:00.000Z'],
      ['2026-09-18T10:20:00.000Z', '2026-09-18T10:50:00.000Z'],
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/time`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ startedAt, endedAt })
        .expect(201);
    }

    const report = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/time/report?taskId=${task.body.data.id}&from=2026-09-18T10:15:00.000Z&to=2026-09-18T10:45:00.000Z&page=1&pageSize=1`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(report.body.data.items).toHaveLength(1);
    expect(report.body.data.total).toBe(2);
    expect(report.body.data.summary.totalDurationSeconds).toBe(3300);
  });

  it('calculates workload from estimates, explicit allocations, automatic remainder, and member capacity', async () => {
    const dueAt = '2026-09-22T12:00:00.000Z';
    const split = await createTask({
      title: 'Phase 7.8 workload split',
      estimatedMinutes: 120,
      dueAt,
      assigneeMembershipIds: [adminMembershipId, memberMembershipId],
    }).expect(201);
    const custom = await createTask({
      title: 'Phase 7.8 workload custom',
      estimatedMinutes: 100,
      dueAt,
      assigneeMembershipIds: [adminMembershipId, memberMembershipId],
    }).expect(201);
    const unallocated = await createTask({
      title: 'Phase 7.8 workload unallocated',
      estimatedMinutes: 45,
      dueAt,
    }).expect(201);
    await createTask({
      title: 'Phase 7.8 workload unscheduled',
      estimatedMinutes: 30,
      assigneeMembershipIds: [adminMembershipId],
    }).expect(201);
    await createTask({
      title: 'Phase 7.8 workload overdue',
      estimatedMinutes: 15,
      dueAt: '2026-09-15T12:00:00.000Z',
      assigneeMembershipIds: [adminMembershipId],
    }).expect(201);

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${custom.body.data.id}/workload-allocations`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ allocations: [{ workspaceMembershipId: adminMembershipId, plannedMinutes: 30 }] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${custom.body.data.id}/workload-allocations`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ allocations: [{ workspaceMembershipId: adminMembershipId, plannedMinutes: 101 }] })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/workload/capacity/${adminMembershipId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ weeklyCapacityMinutes: 150 })
      .expect(200);

    const workload = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/workload?view=WEEK&date=2026-09-22T00:00:00.000Z&page=1&pageSize=100`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    const admin = workload.body.data.items.find(
      (item: { membershipId: string }) => item.membershipId === adminMembershipId,
    );
    const member = workload.body.data.items.find(
      (item: { membershipId: string }) => item.membershipId === memberMembershipId,
    );
    expect(admin).toMatchObject({
      plannedMinutes: 90,
      capacityMinutes: 150,
      weeklyCapacityMinutes: 150,
      state: 'BALANCED',
    });
    expect(member).toMatchObject({
      plannedMinutes: 130,
      capacityMinutes: 2400,
      weeklyCapacityMinutes: 2400,
      state: 'AVAILABLE',
    });
    expect(workload.body.data.summary).toMatchObject({
      unallocatedMinutes: 45,
      unscheduledMinutes: 30,
      overdueMinutes: 15,
    });
    expect(workload.body.data.total).toBeGreaterThanOrEqual(2);

    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA2}/tasks/workload?view=WEEK&date=2026-09-22T00:00:00.000Z`,
      )
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.summary.unallocatedMinutes).toBe(0);
      });

    await expect(
      prisma.taskTimeEntry.count({
        where: { taskId: { in: [split.body.data.id, unallocated.body.data.id] } },
      }),
    ).resolves.toBe(0);
  });

  it('uses the workspace timezone for workload and time report calendar boundaries', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ timezone: 'UTC+05:30' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ timezone: 'Asia/Kolkata' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.timezone).toBe('Asia/Kolkata');
      });

    try {
      await createTask({
        title: 'Phase 7.8 timezone workload local day',
        estimatedMinutes: 60,
        dueAt: '2032-03-09T19:00:00.000Z',
        assigneeMembershipIds: [adminMembershipId],
      }).expect(201);
      await createTask({
        title: 'Phase 7.8 timezone workload next local day',
        estimatedMinutes: 45,
        dueAt: '2032-03-10T18:45:00.000Z',
        assigneeMembershipIds: [adminMembershipId],
      }).expect(201);

      const workload = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA1}/tasks/workload?view=DAY&date=2032-03-10`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      const admin = workload.body.data.items.find(
        (item: { membershipId: string }) => item.membershipId === adminMembershipId,
      );
      expect(workload.body.data.window).toMatchObject({ timezone: 'Asia/Kolkata' });
      expect(admin).toMatchObject({ plannedMinutes: 60 });

      const task = await createTask({ title: 'Phase 7.8 timezone time report' }).expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/time`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          startedAt: '2024-04-30T18:00:00.000Z',
          endedAt: '2024-04-30T19:00:00.000Z',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/time`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          startedAt: '2024-04-30T19:00:00.000Z',
          endedAt: '2024-04-30T19:30:00.000Z',
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/time`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          startedAt: '2024-05-01T18:45:00.000Z',
          endedAt: '2024-05-01T19:15:00.000Z',
        })
        .expect(201);

      const report = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/tasks/time/report?taskId=${task.body.data.id}&from=2024-05-01&to=2024-05-01&page=1&pageSize=1`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(report.body.data.total).toBe(2);
      expect(report.body.data.summary).toMatchObject({
        timezone: 'Asia/Kolkata',
        totalDurationSeconds: 3600,
      });
    } finally {
      await prisma.workspace.update({ where: { id: workspaceA1 }, data: { timezone: 'UTC' } });
    }
  });

  it('defaults new recurrence schedules from workspace timezone without mutating existing series', async () => {
    await prisma.workspace.update({
      where: { id: workspaceA1 },
      data: { timezone: 'Europe/Berlin' },
    });
    try {
      const recurringAtCreate = await createTask({
        title: 'Phase 7.8 recurrence create timezone',
        recurrence: {
          frequency: 'DAILY',
          startLocalDate: '2032-06-01',
          localTime: '09:00',
          endMode: 'NEVER',
        },
      }).expect(201);
      const first = await prisma.taskRecurrenceSeries.findUniqueOrThrow({
        where: { id: recurringAtCreate.body.data.recurrenceSeriesId },
      });
      expect(first.timezone).toBe('Europe/Berlin');

      await prisma.workspace.update({
        where: { id: workspaceA1 },
        data: { timezone: 'Asia/Tokyo' },
      });
      await expect(
        prisma.taskRecurrenceSeries.findUniqueOrThrow({ where: { id: first.id } }),
      ).resolves.toMatchObject({ timezone: 'Europe/Berlin' });

      const task = await createTask({ title: 'Phase 7.8 recurrence make timezone' }).expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/${task.body.data.id}/recurrence`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          frequency: 'DAILY',
          startLocalDate: '2032-06-02',
          localTime: '10:00',
          endMode: 'NEVER',
        })
        .expect(201);
      const updatedTask = await prisma.task.findUniqueOrThrow({
        where: { id: task.body.data.id },
        select: { recurrenceSeriesId: true },
      });
      await expect(
        prisma.taskRecurrenceSeries.findUniqueOrThrow({
          where: { id: updatedTask.recurrenceSeriesId! },
        }),
      ).resolves.toMatchObject({ timezone: 'Asia/Tokyo' });
    } finally {
      await prisma.workspace.update({ where: { id: workspaceA1 }, data: { timezone: 'UTC' } });
    }
  });

  it('serves Phase 7.9 task views with authoritative workspace time, scheduling, CSV, and tenant fences', async () => {
    await prisma.workspace.update({
      where: { id: workspaceA1 },
      data: { timezone: 'America/New_York' },
    });
    try {
      const plannedStartAt = '2026-03-07T15:00:00.000Z';
      const dueAt = '2026-03-08T06:30:00.000Z';
      await createTask({
        title: 'Invalid planned interval',
        plannedStartAt: '2026-03-09T00:00:00.000Z',
        dueAt,
      }).expect(400);

      const scheduled = await createTask({
        title: '=Phase 7.9 scheduled',
        plannedStartAt,
        dueAt,
        priority: 'HIGH',
        assigneeMembershipIds: [memberMembershipId],
      }).expect(201);
      expect(scheduled.body.data.plannedStartAt).toBe(plannedStartAt);

      const dependent = await createTask({
        title: 'Phase 7.9 dependent',
        plannedStartAt: '2026-03-08T12:00:00.000Z',
        dueAt: '2026-03-09T12:00:00.000Z',
      }).expect(201);
      await addBlockedBy(dependent.body.data.id, [scheduled.body.data.id]).expect(201);

      const unscheduled = await createTask({
        title: 'Phase 7.9 unscheduled',
        dueAt: '2026-03-08T18:00:00.000Z',
      }).expect(201);
      await createTask({
        title: 'Phase 7.9 calendar paged one',
        dueAt: '2026-03-08T19:00:00.000Z',
      }).expect(201);
      await createTask({
        title: 'Phase 7.9 calendar paged two',
        dueAt: '2026-03-08T20:00:00.000Z',
      }).expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${dependent.body.data.id}/status`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: taskReviewStatusId })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${scheduled.body.data.id}/status`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: taskCompletedStatusId })
        .expect(200);
      await prisma.auditLog.create({
        data: {
          agencyId: agencyA,
          workspaceId: workspaceA1,
          action: 'task.completion_approved',
          entityType: 'TaskCompletionSubmission',
          entityId: randomUUID(),
          metadata: { taskId: scheduled.body.data.id, completed: true },
        },
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${unscheduled.body.data.id}/schedule`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          plannedStartAt: '2026-03-10T00:00:00.000Z',
          dueAt: '2026-03-09T00:00:00.000Z',
        })
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA2}/tasks/${scheduled.body.data.id}/schedule`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA2))
        .send({ plannedStartAt, dueAt })
        .expect(404);

      const calendar = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA1}/tasks/calendar?view=MONTH&date=2026-03-08`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(calendar.body.data.window.timezone).toBe('America/New_York');
      const localDay = calendar.body.data.days.find(
        (day: { date: string }) => day.date === '2026-03-08',
      );
      expect(localDay.total).toBeGreaterThanOrEqual(2);
      expect(localDay.tasks).toHaveLength(0);

      const weekDetail = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/tasks/calendar?view=WEEK&date=2026-03-08&page=1&pageSize=5`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      const scheduledCalendarTask = weekDetail.body.data.days
        .flatMap((day: { tasks: Array<{ id: string; urgency: string }> }) => day.tasks)
        .find((task: { id: string; urgency: string }) => task.id === scheduled.body.data.id);
      expect(scheduledCalendarTask?.urgency).toBe('SAFE');

      const dayPageOne = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/tasks/calendar?view=DAY&date=2026-03-08&page=1&pageSize=1`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      const dayPageTwo = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/tasks/calendar?view=DAY&date=2026-03-08&page=2&pageSize=1`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(dayPageOne.body.data.days).toHaveLength(1);
      expect(dayPageOne.body.data.total).toBeGreaterThan(1);
      expect(dayPageOne.body.data.days[0].tasks).toHaveLength(1);
      expect(dayPageTwo.body.data.days[0].tasks).toHaveLength(1);
      expect(dayPageTwo.body.data.days[0].tasks[0].id).not.toBe(
        dayPageOne.body.data.days[0].tasks[0].id,
      );

      const gantt = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA1}/tasks/gantt?from=2026-03-07&to=2026-03-10`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(gantt.body.data.window.timezone).toBe('America/New_York');
      expect(
        gantt.body.data.items.some((item: { id: string }) => item.id === scheduled.body.data.id),
      ).toBe(true);
      expect(gantt.body.data.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blockerTaskId: scheduled.body.data.id,
            blockedTaskId: dependent.body.data.id,
          }),
        ]),
      );
      expect(gantt.body.data.unscheduledCount).toBeGreaterThanOrEqual(1);

      const report = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/tasks/reports/summary?from=2026-03-08&to=2026-03-08`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(report.body.data.timezone).toBe('America/New_York');
      expect(report.body.data.kpis.totalTasks).toBeGreaterThanOrEqual(2);

      const trend = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA1}/tasks/reports/summary?search=scheduled`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      const trendTotal = trend.body.data.completionTrend.reduce(
        (sum: number, item: { count: number }) => sum + item.count,
        0,
      );
      expect(trendTotal).toBe(1);

      const csv = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA1}/tasks/reports/export?from=2026-03-08&to=2026-03-08`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(csv.body.data.csv).toContain("'=Phase 7.9 scheduled");

      const activity = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/tasks/activity?action=task.created&page=1&pageSize=5`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(activity.body.data.items.length).toBeGreaterThan(0);

      await prisma.auditLog.createMany({
        data: Array.from({ length: 10_001 }, () => ({
          agencyId: agencyA,
          workspaceId: workspaceA1,
          userId: scheduled.body.data.createdBy.id,
          action: 'phase7.export_limit',
          entityType: 'Task',
          entityId: scheduled.body.data.id,
          metadata: {},
        })),
      });
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA1}/tasks/activity/export?action=phase7.export_limit`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(HttpStatus.PAYLOAD_TOO_LARGE)
        .expect((response) => {
          expect(response.body).toMatchObject({
            code: 'TASK_EXPORT_TOO_LARGE',
            message: 'TASK_EXPORT_TOO_LARGE',
            details: { maxRows: 10_000 },
          });
        });
    } finally {
      await prisma.workspace.update({ where: { id: workspaceA1 }, data: { timezone: 'UTC' } });
    }
  });

  it('serves Phase 8.7 project reports with fixed project scope, audit completion trend, time permissions, and safe CSV', async () => {
    await prisma.workspace.update({
      where: { id: workspaceA1 },
      data: { timezone: 'America/New_York' },
    });
    try {
      const prefix = 'Phase 8.7 project report';
      const open = await createTask({
        title: `+cmd ${prefix} open`,
        projectIds: [activeProjectId],
        dueAt: '2099-09-20T12:00:00.000Z',
        priority: 'HIGH',
        departmentId: activeDepartmentId,
        assigneeMembershipIds: [adminMembershipId, memberMembershipId],
        estimatedMinutes: 45,
      }).expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${open.body.data.id}`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ title: `+cmd ${prefix} open` })
        .expect(200);

      const completed = await createTask({
        title: `${prefix} தமிழ் completed`,
        projectIds: [activeProjectId, secondProjectId],
        dueAt: '2099-09-20T18:00:00.000Z',
        priority: 'LOW',
        estimatedMinutes: 15,
      }).expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${completed.body.data.id}/status`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: taskCompletedStatusId })
        .expect(200);
      await prisma.auditLog.create({
        data: {
          agencyId: agencyA,
          workspaceId: workspaceA1,
          action: 'task.completion_approved',
          entityType: 'TaskCompletionSubmission',
          entityId: randomUUID(),
          metadata: { taskId: completed.body.data.id, completed: true },
        },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tasks/${completed.body.data.id}/time`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          startedAt: '2026-04-10T13:00:00.000Z',
          endedAt: '2026-04-10T13:20:00.000Z',
        })
        .expect(201);

      const report = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/projects/${activeProjectId}/reports?search=${encodeURIComponent(
            prefix,
          )}`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);

      expect(report.body.data.timezone).toBe('America/New_York');
      expect(report.body.data.kpis).toMatchObject({
        totalTasks: 2,
        openTasks: 1,
        completedTasks: 1,
        overdueTasks: 0,
        completionRate: 50,
        estimatedMinutes: 60,
        trackedSeconds: 1200,
        trackedTimeAvailable: true,
      });
      expect(report.body.data.progress.effectiveProgress).toBeGreaterThanOrEqual(0);
      expect(report.body.data.distributions.priority).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ priority: 'HIGH', count: 1 }),
          expect.objectContaining({ priority: 'LOW', count: 1 }),
        ]),
      );
      expect(report.body.data.distributions.assignees).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            membershipId: adminMembershipId,
            taskAssignmentCount: 1,
            openTaskCount: 1,
          }),
          expect.objectContaining({
            membershipId: memberMembershipId,
            taskAssignmentCount: 1,
            openTaskCount: 1,
          }),
        ]),
      );
      expect(
        report.body.data.completionTrend.reduce(
          (sum: number, item: { count: number }) => sum + item.count,
          0,
        ),
      ).toBe(1);

      const restrictedTime = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/projects/${activeProjectId}/reports?search=${encodeURIComponent(
            prefix,
          )}`,
        )
        .set(auth(viewerToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(403);
      expect(restrictedTime.body.code).toBeTruthy();

      const viewer = await prisma.user.findUniqueOrThrow({
        where: { email: 'viewer-a@zeaplay.test' },
      });
      const viewerMembership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { userId_workspaceId: { userId: viewer.id, workspaceId: workspaceA1 } },
      });
      const reportPermission = await prisma.permission.findUniqueOrThrow({
        where: { key: 'projects.reports.view' },
      });
      const projectViewPermission = await prisma.permission.findUniqueOrThrow({
        where: { key: 'projects.view' },
      });
      const memberMembership = await prisma.workspaceMembership.findUniqueOrThrow({
        where: { id: memberMembershipId },
      });
      await prisma.rolePermission.createMany({
        data: [
          { roleId: memberMembership.roleId, permissionId: projectViewPermission.id },
          { roleId: memberMembership.roleId, permissionId: reportPermission.id },
        ],
        skipDuplicates: true,
      });
      await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/projects/${activeProjectId}/reports?search=${encodeURIComponent(
            prefix,
          )}`,
        )
        .set(auth(memberToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(403);
      await prisma.rolePermission.deleteMany({
        where: {
          roleId: memberMembership.roleId,
          permissionId: { in: [projectViewPermission.id, reportPermission.id] },
        },
      });

      await prisma.rolePermission.create({
        data: { roleId: viewerMembership.roleId, permissionId: reportPermission.id },
      });
      await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/projects/${activeProjectId}/reports?search=${encodeURIComponent(
            prefix,
          )}`,
        )
        .set(auth(viewerToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200)
        .expect((response) => {
          expect(response.body.data.kpis.trackedTimeAvailable).toBe(false);
          expect(response.body.data.kpis.trackedSeconds).toBeNull();
        });
      await prisma.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: viewerMembership.roleId,
            permissionId: reportPermission.id,
          },
        },
      });

      const csv = await request(app.getHttpServer())
        .get(
          `/api/v1/workspaces/${workspaceA1}/projects/${activeProjectId}/reports/export?search=${encodeURIComponent(
            prefix,
          )}`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(200);
      expect(csv.body.data.csv).toContain(`'+cmd ${prefix} open`);
      expect(csv.body.data.csv).toContain('தமிழ்');
      expect(csv.body.data.csv).toContain('Tracked Seconds');
      expect(csv.body.data.csv).not.toContain('comments');

      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA2}/projects/${activeProjectId}/reports`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA2))
        .expect(404);
    } finally {
      await prisma.workspace.update({ where: { id: workspaceA1 }, data: { timezone: 'UTC' } });
    }
  });

  it('returns structured completion-required errors and keeps bulk terminal changes atomic', async () => {
    const task = await createTask({ title: 'Completion gate structured error' }).expect(201);
    const taskId = task.body.data.id;
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-policy`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        proofRequirementMode: TaskCompletionProofRequirementMode.ANY,
        approvalRequired: false,
      })
      .expect(200);

    const direct = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: taskCompletedStatusId })
      .expect(409);
    expect(direct.body).toMatchObject({
      code: 'COMPLETION_FLOW_REQUIRED',
      message: 'COMPLETION_FLOW_REQUIRED',
      details: {
        taskId,
        requestedTerminalStatusDefinitionId: taskCompletedStatusId,
        proofRequirementMode: TaskCompletionProofRequirementMode.ANY,
        approvalRequired: false,
      },
    });

    const bulkPeer = await createTask({ title: 'Bulk peer remains open' }).expect(201);
    const bulk = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/bulk/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [taskId, bulkPeer.body.data.id], statusDefinitionId: taskCompletedStatusId })
      .expect(409);
    expect(bulk.body).toMatchObject({
      code: 'COMPLETION_FLOW_REQUIRED',
      details: { requestedTerminalStatusDefinitionId: taskCompletedStatusId },
    });
    expect(bulk.body.details.taskIds).toContain(taskId);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: bulkPeer.body.data.id } }),
    ).resolves.toMatchObject({ statusDefinitionId: taskDefaultStatusId });
  });

  it('prevents duplicate pending completion submissions under concurrency', async () => {
    const task = await createTask({ title: 'Completion double submit' }).expect(201);
    const taskId = task.body.data.id;
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-policy`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        proofRequirementMode: TaskCompletionProofRequirementMode.ANY,
        approvalRequired: true,
        approverMode: TaskCompletionApproverMode.ANY_ONE,
        explicitApproverMembershipIds: [adminMembershipId],
      })
      .expect(200);

    const submit = () =>
      request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-submissions?statusDefinitionId=${taskCompletedStatusId}`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ proofItems: [{ type: TaskCompletionProofType.TEXT, textValue: 'done' }] });
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    await expect(
      prisma.taskCompletionSubmission.count({
        where: { workspaceId: workspaceA1, taskId, status: 'PENDING_APPROVAL' },
      }),
    ).resolves.toBe(1);
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(stored.pendingCompletionSubmissionId).toBeTruthy();
  });

  it('rejects foreign statuses and invalid attachment proof candidates', async () => {
    const task = await createTask({ title: 'Completion security proof' }).expect(201);
    const taskId = task.body.data.id;
    const foreignCompletedStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA2, entityType: 'TASK', name: 'Completed' },
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-submissions?statusDefinitionId=${foreignCompletedStatus.id}`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ proofItems: [{ type: TaskCompletionProofType.TEXT, textValue: 'done' }] })
      .expect(409);
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-submissions?statusDefinitionId=${taskDefaultStatusId}`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ proofItems: [{ type: TaskCompletionProofType.TEXT, textValue: 'done' }] })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-policy`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        proofRequirementMode: TaskCompletionProofRequirementMode.SPECIFIC,
        requiredProofTypes: [TaskCompletionProofType.ATTACHMENT],
        approvalRequired: false,
      })
      .expect(200);
    const admin = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { id_workspaceId: { id: adminMembershipId, workspaceId: workspaceA1 } },
      select: { userId: true },
    });
    const foreign = await createRawAttachment(workspaceA2, admin.userId, AssetStatus.READY);
    const pending = await createRawAttachment(workspaceA1, admin.userId, AssetStatus.PENDING);

    for (const attachmentId of [foreign.attachmentId, pending.attachmentId]) {
      await request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-submissions?statusDefinitionId=${taskCompletedStatusId}`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ proofItems: [{ type: TaskCompletionProofType.ATTACHMENT, attachmentId }] })
        .expect(404);
    }
    await expect(
      prisma.taskCompletionSubmission.count({ where: { workspaceId: workspaceA1, taskId } }),
    ).resolves.toBe(0);
  });

  it('snapshots completion policies to recurrence series blueprints by scope', async () => {
    const task = await createTask({ title: 'Recurring completion blueprint' }).expect(201);
    const taskId = task.body.data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/recurrence`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        frequency: 'DAILY',
        interval: 1,
        timezone: 'UTC',
        startLocalDate: '2026-09-18',
        localTime: '09:00',
        endMode: 'NEVER',
      })
      .expect(201);
    const recurring = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(recurring.recurrenceSeriesId).toBeTruthy();

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-policy`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        proofRequirementMode: TaskCompletionProofRequirementMode.SPECIFIC,
        requiredProofTypes: [TaskCompletionProofType.TEXT],
        approvalRequired: true,
        approverMode: TaskCompletionApproverMode.ALL_REQUIRED,
        explicitApproverMembershipIds: [adminMembershipId],
        recurrenceEditScope: 'THIS_AND_FUTURE',
      })
      .expect(200);
    const series = await prisma.taskRecurrenceSeries.findUniqueOrThrow({
      where: { id: recurring.recurrenceSeriesId! },
      include: { completionApprovers: true },
    });
    expect(series).toMatchObject({
      completionProofRequirementMode: TaskCompletionProofRequirementMode.SPECIFIC,
      completionRequiredProofTypes: [TaskCompletionProofType.TEXT],
      completionApprovalRequired: true,
      completionApproverMode: TaskCompletionApproverMode.ALL_REQUIRED,
    });
    expect(series.completionApprovers.map((item) => item.membershipId)).toEqual([
      adminMembershipId,
    ]);

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/completion-policy`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        proofRequirementMode: TaskCompletionProofRequirementMode.NONE,
        approvalRequired: false,
        recurrenceEditScope: 'THIS_OCCURRENCE',
      })
      .expect(200);
    await expect(
      prisma.taskRecurrenceSeries.findUniqueOrThrow({
        where: { id: recurring.recurrenceSeriesId! },
      }),
    ).resolves.toMatchObject({
      completionProofRequirementMode: TaskCompletionProofRequirementMode.SPECIFIC,
      completionApprovalRequired: true,
    });
  });

  function createTask(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send(body);
  }

  async function createRawAttachment(
    workspaceId: string,
    createdById: string,
    status: AssetStatus,
  ) {
    const asset = await prisma.asset.create({
      data: {
        workspaceId,
        createdById,
        originalFilename: `${randomUUID()}.txt`,
        displayName: 'proof.txt',
        storageBucket: 'zea-play-dev',
        storageKey: `test/${workspaceId}/${randomUUID()}.txt`,
        mimeType: 'text/plain',
        extension: 'txt',
        sizeBytes: 12,
        status,
        uploadExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const attachment = await prisma.attachment.create({
      data: {
        workspaceId,
        type: AttachmentType.FILE,
        assetId: asset.id,
        displayName: 'proof.txt',
        createdById,
      },
    });
    return { assetId: asset.id, attachmentId: attachment.id };
  }

  function createSubtask(
    parentTaskId: string,
    body: Record<string, unknown>,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tasks/${parentTaskId}/subtasks`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send(body);
  }

  function addBlockedBy(taskId: string, taskIds: string[], token = updateOnlyToken) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/blocked-by`)
      .set(auth(token))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds });
  }

  function removeBlockedBy(taskId: string, taskIds: string[], token = updateOnlyToken) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/blocked-by/remove`)
      .set(auth(token))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds });
  }

  function addRelated(taskId: string, taskIds: string[], token = updateOnlyToken) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/related`)
      .set(auth(token))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds });
  }

  function removeRelated(taskId: string, taskIds: string[], token = updateOnlyToken) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks/${taskId}/related/remove`)
      .set(auth(token))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds });
  }

  function createComment(
    taskId: string,
    body: Record<string, unknown>,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send(body);
  }

  function listComments(
    taskId: string,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments?page=1&pageSize=20`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId));
  }

  function createReply(
    taskId: string,
    commentId: string,
    body: Record<string, unknown>,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/replies`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send(body);
  }

  function listReplies(
    taskId: string,
    commentId: string,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/replies?page=1&pageSize=20`,
      )
      .set(auth(token))
      .set(ctx(agencyId, workspaceId));
  }

  function patchComment(
    taskId: string,
    commentId: string,
    body: Record<string, unknown>,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send(body);
  }

  function deleteComment(
    taskId: string,
    commentId: string,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId));
  }

  function addReaction(
    taskId: string,
    commentId: string,
    reactionType: TaskCommentReactionType,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/reactions`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send({ reactionType });
  }

  function removeReaction(
    taskId: string,
    commentId: string,
    reactionType: TaskCommentReactionType,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/reactions/remove`,
      )
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send({ reactionType });
  }

  function createTag(
    body: Record<string, unknown>,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tags`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send(body);
  }

  function listTags(token = adminToken, query = '', workspaceId = workspaceA1, agencyId = agencyA) {
    return request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/tags${query}`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId));
  }

  function updateTag(
    tagId: string,
    body: Record<string, unknown>,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceId}/tags/${tagId}`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send(body);
  }

  function archiveTag(
    tagId: string,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tags/${tagId}/archive`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId));
  }

  function reactivateTag(
    tagId: string,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tags/${tagId}/reactivate`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId));
  }

  function listTaskTags(
    taskId: string,
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/tags`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId));
  }

  function addTaskTags(
    taskId: string,
    tagIds: string[],
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/tags/add`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send({ tagIds });
  }

  function removeTaskTags(
    taskId: string,
    tagIds: string[],
    token = adminToken,
    workspaceId = workspaceA1,
    agencyId = agencyA,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/tasks/${taskId}/tags/remove`)
      .set(auth(token))
      .set(ctx(agencyId, workspaceId))
      .send({ tagIds });
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

  async function expectNoCycle(taskIds: string[]) {
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, parentTaskId: true },
    });
    const parentById = new Map(tasks.map((task) => [task.id, task.parentTaskId]));
    for (const taskId of taskIds) {
      const seen = new Set<string>();
      let cursor: string | null | undefined = taskId;
      while (cursor) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = parentById.get(cursor);
      }
    }
  }

  async function expectDependencyAcyclic(taskIds: string[]) {
    const dependencies = await prisma.taskDependency.findMany({
      where: { blockerTaskId: { in: taskIds }, blockedTaskId: { in: taskIds } },
      select: { blockerTaskId: true, blockedTaskId: true },
    });
    const blockedByBlocker = new Map<string, string[]>();
    for (const dependency of dependencies) {
      const existing = blockedByBlocker.get(dependency.blockerTaskId) ?? [];
      existing.push(dependency.blockedTaskId);
      blockedByBlocker.set(dependency.blockerTaskId, existing);
    }
    for (const taskId of taskIds) {
      const stack = [{ id: taskId, path: new Set<string>() }];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        expect(current.path.has(current.id)).toBe(false);
        const path = new Set(current.path);
        path.add(current.id);
        for (const next of blockedByBlocker.get(current.id) ?? []) {
          stack.push({ id: next, path });
        }
      }
    }
  }

  async function expectNoTerminalParentWithOpenDescendant(rootTaskId: string) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      WITH RECURSIVE descendants(id, path) AS (
        SELECT child.id, ARRAY[child.id]
        FROM tasks child
        WHERE child.parent_task_id = ${rootTaskId}::uuid
          AND child.workspace_id = ${workspaceA1}::uuid
          AND child.deleted_at IS NULL
        UNION ALL
        SELECT child.id, descendants.path || child.id
        FROM tasks child
        JOIN descendants ON child.parent_task_id = descendants.id
        WHERE child.workspace_id = ${workspaceA1}::uuid
          AND child.deleted_at IS NULL
          AND NOT child.id = ANY(descendants.path)
      )
      SELECT child.id
      FROM tasks parent
      JOIN status_definitions parent_status
        ON parent_status.id = parent.status_definition_id
        AND parent_status.workspace_id = parent.workspace_id
        AND parent_status.entity_type = 'TASK'::"StatusEntityType"
      JOIN descendants child ON true
      JOIN tasks child_task
        ON child_task.id = child.id
        AND child_task.workspace_id = parent.workspace_id
        AND child_task.deleted_at IS NULL
      JOIN status_definitions child_status
        ON child_status.id = child_task.status_definition_id
        AND child_status.workspace_id = child_task.workspace_id
        AND child_status.entity_type = 'TASK'::"StatusEntityType"
      WHERE parent.id = ${rootTaskId}::uuid
        AND parent.workspace_id = ${workspaceA1}::uuid
        AND parent.deleted_at IS NULL
        AND parent_status.is_terminal = true
        AND child_status.is_terminal = false
      LIMIT 1
    `;
    expect(rows).toHaveLength(0);
  }

  async function seedFixtures() {
    const permissions = [
      'agency.read',
      'workspace.read',
      'workspace.update',
      'tasks.view',
      'tasks.create',
      'tasks.update',
      'tasks.delete',
      'tasks.assign',
      'tasks.manage',
      'tasks.comments.view',
      'tasks.comments.create',
      'tasks.comments.update_own',
      'tasks.comments.delete_own',
      'tasks.comments.moderate',
      'tasks.comments.internal',
      'tasks.attachments.view',
      'tasks.attachments.add',
      'tasks.attachments.remove',
      'tasks.attachments.download',
      'tasks.completion.view',
      'tasks.completion.submit',
      'tasks.completion.manage_policy',
      'tasks.completion.approve',
      'tasks.time.view_own',
      'tasks.time.track',
      'tasks.time.edit_own',
      'tasks.time.delete_own',
      'tasks.time.view_all',
      'tasks.time.manage',
      'projects.view',
      'projects.reports.view',
      'tags.view',
      'tags.create',
      'tags.update',
      'tags.archive',
      'tags.assign',
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
      [
        'TASK_COMMENT_VIEWER',
        RoleScope.WORKSPACE,
        ['workspace.read', 'tasks.view', 'tasks.comments.view'],
      ],
      [
        'TASK_COMMENT_CREATE',
        RoleScope.WORKSPACE,
        ['workspace.read', 'tasks.view', 'tasks.comments.view', 'tasks.comments.create'],
      ],
      ['TAG_VIEWER', RoleScope.WORKSPACE, ['workspace.read', 'tags.view']],
      ['TAG_CREATE', RoleScope.WORKSPACE, ['workspace.read', 'tags.create']],
      ['TAG_UPDATE', RoleScope.WORKSPACE, ['workspace.read', 'tags.update']],
      ['TAG_ARCHIVE', RoleScope.WORKSPACE, ['workspace.read', 'tags.archive']],
      ['TAG_ASSIGN_ONLY', RoleScope.WORKSPACE, ['workspace.read', 'tags.assign']],
      [
        'TAG_ASSIGN',
        RoleScope.WORKSPACE,
        ['workspace.read', 'tasks.view', 'tasks.update', 'tags.assign'],
      ],
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
      commentViewerA,
      commentCreateA,
      tagViewerA,
      tagCreateA,
      tagUpdateA,
      tagArchiveA,
      tagAssignOnlyA,
      tagAssignA,
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
      user('comment-viewer-a@zeaplay.test', 'Comment Viewer A'),
      user('comment-create-a@zeaplay.test', 'Comment Create A'),
      user('tag-viewer-a@zeaplay.test', 'Tag Viewer A'),
      user('tag-create-a@zeaplay.test', 'Tag Create A'),
      user('tag-update-a@zeaplay.test', 'Tag Update A'),
      user('tag-archive-a@zeaplay.test', 'Tag Archive A'),
      user('tag-assign-only-a@zeaplay.test', 'Tag Assign Only A'),
      user('tag-assign-a@zeaplay.test', 'Tag Assign A'),
      user('owner-b@zeaplay.test', 'Owner B'),
    ]);
    const superAgencyA = await prisma.superAgency.create({
      data: { name: 'Super Agency A', slug: 'super-agency-a', createdById: ownerA.id },
    });
    const superAgencyB = await prisma.superAgency.create({
      data: { name: 'Super Agency B', slug: 'super-agency-b', createdById: ownerB.id },
    });
    const agency = await prisma.agency.create({
      data: {
        superAgencyId: superAgencyA.id,
        name: 'Agency A',
        slug: 'agency-a',
        createdById: ownerA.id,
      },
    });
    const beta = await prisma.agency.create({
      data: {
        superAgencyId: superAgencyB.id,
        name: 'Agency B',
        slug: 'agency-b',
        createdById: ownerB.id,
      },
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
    await agencyMember(commentViewerA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(commentCreateA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(tagViewerA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(tagCreateA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(tagUpdateA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(tagArchiveA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(tagAssignOnlyA.id, agency.id, roleId(roles, 'AGENCY_USER'));
    await agencyMember(tagAssignA.id, agency.id, roleId(roles, 'AGENCY_USER'));
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
    await workspaceMember(commentViewerA.id, wa.id, roleId(roles, 'TASK_COMMENT_VIEWER'));
    await workspaceMember(commentCreateA.id, wa.id, roleId(roles, 'TASK_COMMENT_CREATE'));
    await workspaceMember(tagViewerA.id, wa.id, roleId(roles, 'TAG_VIEWER'));
    await workspaceMember(tagCreateA.id, wa.id, roleId(roles, 'TAG_CREATE'));
    await workspaceMember(tagUpdateA.id, wa.id, roleId(roles, 'TAG_UPDATE'));
    await workspaceMember(tagArchiveA.id, wa.id, roleId(roles, 'TAG_ARCHIVE'));
    await workspaceMember(tagAssignOnlyA.id, wa.id, roleId(roles, 'TAG_ASSIGN_ONLY'));
    await workspaceMember(tagAssignA.id, wa.id, roleId(roles, 'TAG_ASSIGN'));
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
    taskCompletedStatusId = (
      await prisma.statusDefinition.findFirstOrThrow({
        where: { workspaceId: wa.id, entityType: 'TASK', name: 'Completed' },
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "gamification_work_xp_events", "gamification_xp_entries" CASCADE',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "automation_trigger_matches", "automation_domain_events" CASCADE',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "automation_step_executions", "automation_executions", "automation_workflow_templates", "automation_workflow_versions", "automation_workflows", "automation_workspace_policies" CASCADE',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "billing_usage_counters", "billing_history", "billing_checkout_attempts", "stripe_billing_events", "super_agency_billing_accounts", "super_agency_subscriptions", "billing_prices", "plan_entitlements", "master_plan_versions", "master_plans", "agency_resource_allocations", "workspace_resource_allocations" CASCADE',
  );
  await prisma.$transaction([
    prisma.taskCommentReaction.deleteMany(),
    prisma.taskCommentMention.deleteMany(),
    prisma.taskComment.deleteMany(),
    prisma.taskTimeEntry.deleteMany(),
    prisma.taskWorkloadAllocation.deleteMany(),
    prisma.taskAttachment.deleteMany(),
    prisma.task.updateMany({ data: { pendingCompletionSubmissionId: null } }),
    prisma.taskCompletionApprovalDecision.deleteMany(),
    prisma.taskCompletionSubmissionApprover.deleteMany(),
    prisma.taskCompletionProofAttachment.deleteMany(),
    prisma.taskCompletionProofItem.deleteMany(),
    prisma.taskCompletionSubmission.deleteMany(),
    prisma.taskCompletionPolicyApprover.deleteMany(),
    prisma.taskCompletionPolicy.deleteMany(),
    prisma.projectAttachment.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.processingJob.deleteMany(),
    prisma.storageUploadReservation.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.ticketSlaState.deleteMany(),
    prisma.ticketSlaPauseStatus.deleteMany(),
    prisma.ticketSlaRule.deleteMany(),
    prisma.ticketSlaPolicy.deleteMany(),
    prisma.ticketConversationEntry.deleteMany(),
    prisma.ticketRequester.deleteMany(),
    prisma.ticket.deleteMany(),
    prisma.taskTag.deleteMany(),
    prisma.taskRelatedTask.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.taskAssignee.deleteMany(),
    prisma.taskFollower.deleteMany(),
    prisma.taskProject.deleteMany(),
    prisma.taskRecurrenceAssignee.deleteMany(),
    prisma.taskRecurrenceFollower.deleteMany(),
    prisma.taskRecurrenceProject.deleteMany(),
    prisma.taskRecurrenceTag.deleteMany(),
    prisma.taskRecurrenceCompletionApprover.deleteMany(),
    prisma.taskTemplateAssignee.deleteMany(),
    prisma.taskTemplateFollower.deleteMany(),
    prisma.taskTemplateProject.deleteMany(),
    prisma.taskTemplateTag.deleteMany(),
    prisma.task.deleteMany(),
    prisma.taskTemplate.deleteMany(),
    prisma.taskRecurrenceSeries.deleteMany(),
    prisma.taskKanbanColumnSetting.deleteMany(),
    prisma.projectTag.deleteMany(),
    prisma.workspaceTag.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.processingJob.deleteMany(),
    prisma.storageUploadReservation.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.projectMember.deleteMany(),
    prisma.project.deleteMany(),
    prisma.workspaceTicketCounter.deleteMany(),
    prisma.workspaceMemberCapacity.deleteMany(),
    prisma.workspaceMembership.deleteMany(),
    prisma.department.deleteMany(),
    prisma.statusDefinition.deleteMany(),
    prisma.agencyMembership.deleteMany(),
    prisma.superAgencyMembership.deleteMany(),
    prisma.featureEntitlement.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.agency.deleteMany(),
    prisma.superAgency.deleteMany(),
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
  visibility: ProjectVisibility = ProjectVisibility.WORKSPACE,
) {
  const ownerMembership = await prisma.workspaceMembership.findUniqueOrThrow({
    where: { userId_workspaceId: { userId: createdById, workspaceId } },
  });
  return prisma.project.create({
    data: {
      workspaceId,
      createdById,
      ownerMembershipId: ownerMembership.id,
      name,
      status,
      visibility,
    },
  });
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
