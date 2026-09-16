import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, RoleScope, StatusCategory, StatusEntityType } from '@prisma/client';
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
let statusesViewPermissionId!: string;

jest.setTimeout(30_000);

describe('Phase 6.3A shared statuses integration', () => {
  let app: INestApplication;
  let agencyA: string;
  let agencyB: string;
  let workspaceA1: string;
  let workspaceA2: string;
  let workspaceB1: string;
  let ownerToken: string;
  let adminToken: string;
  let limitedToken: string;
  let memberToken: string;
  let limitedUserId: string;

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

    ownerToken = await accessTokenFor('owner-a@zeaplay.test');
    adminToken = await accessTokenFor('admin-a@zeaplay.test');
    limitedToken = await accessTokenFor('limited-a@zeaplay.test');
    memberToken = await accessTokenFor('member-a@zeaplay.test');
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    await drainTeardown();
  });

  it('initializes default TASK, PROJECT, and TICKET statuses idempotently', async () => {
    const before = await prisma.statusDefinition.count({ where: { workspaceId: workspaceA1 } });
    await initializeDefaultStatuses(prisma, workspaceA1);
    const after = await prisma.statusDefinition.count({ where: { workspaceId: workspaceA1 } });
    expect(after).toBe(before);

    const response = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/statuses`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(
      response.body.data.map((status: { entityType: StatusEntityType }) => status.entityType),
    ).toEqual(expect.arrayContaining(['TASK', 'PROJECT', 'TICKET']));

    for (const entityType of Object.values(StatusEntityType)) {
      const defaults = response.body.data.filter(
        (status: { entityType: StatusEntityType; isActive: boolean; isDefault: boolean }) =>
          status.entityType === entityType && status.isActive && status.isDefault,
      );
      expect(defaults).toHaveLength(1);
    }

    const review = await prisma.statusDefinition.update({
      where: {
        workspaceId_entityType_nameNormalized: {
          workspaceId: workspaceA1,
          entityType: 'TASK',
          nameNormalized: 'review',
        },
      },
      data: { name: 'Custom Review', nameNormalized: 'custom review', color: '#111111' },
    });
    await initializeDefaultStatuses(prisma, workspaceA1);
    const customized = await prisma.statusDefinition.findUniqueOrThrow({
      where: { id: review.id },
    });
    expect(customized.name).toBe('Custom Review');
    expect(customized.color).toBe('#111111');

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/statuses/initialize-defaults`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(201);
    const initializedAudit = await prisma.auditLog.findFirst({
      where: {
        agencyId: agencyA,
        workspaceId: workspaceA1,
        action: 'statuses.defaults_initialized',
        entityType: 'StatusDefinition',
      },
    });
    expect(initializedAudit).toBeTruthy();
  });

  it('creates statuses for each entity type and enforces normalized name/color rules', async () => {
    const task = await createStatus('TASK', 'Blocked', StatusCategory.REVIEW, '#DC2626');
    expect(task.body.data.name).toBe('Blocked');
    expect(task.body.data.color).toBe('#DC2626');
    await createStatus('PROJECT', 'Blocked', StatusCategory.REVIEW, '#DC2626').expect(201);
    await createStatus('TICKET', 'Blocked', StatusCategory.REVIEW, '#DC2626').expect(201);
    await createStatus('TASK', ' blocked ', StatusCategory.REVIEW, '#DC2626').expect(409);
    await createStatus('TASK', 'BLOCKED', StatusCategory.REVIEW, '#DC2626').expect(409);
    await createStatus('TASK', 'Blank Name', StatusCategory.REVIEW, '#16a34a').expect(201);
    const unsafeColors = [
      'url(javascript:1)',
      'rgb(1,2,3)',
      '#FFF',
      '#123456;background:red',
      '<script>alert(1)</script>',
      `#${'A'.repeat(500)}`,
    ];
    for (const [index, color] of unsafeColors.entries()) {
      await createStatus('TASK', `Unsafe Color ${index}`, StatusCategory.TODO, color).expect(422);
    }

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/statuses/TASK`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ name: 'Blocked', color: '#DC2626', category: 'REVIEW' })
      .expect(201);
  });

  it('updates, deactivates, sets default, and records audit events', async () => {
    const created = await createStatus('TASK', 'QA Review', StatusCategory.REVIEW, '#9333EA');
    const statusId = created.body.data.id as string;
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${statusId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'QA Gate', color: '#7C3AED', category: 'CANCELLED', isTerminal: false })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${statusId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ category: 'DONE' })
      .expect(422);
    const defaulted = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${statusId}/set-default`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(201);
    expect(defaulted.body.data.isDefault).toBe(true);
    await expectExactlyOneActiveDefault(workspaceA1, 'TASK');

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${statusId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: false })
      .expect(400);

    const completed = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', name: 'Completed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${completed.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${completed.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: true })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${completed.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    const actions = await prisma.auditLog.findMany({
      where: {
        workspaceId: workspaceA1,
        entityType: 'StatusDefinition',
        action: {
          in: [
            'status.created',
            'status.updated',
            'status.default_changed',
            'status.deactivated',
            'status.activated',
          ],
        },
      },
      select: {
        action: true,
        agencyId: true,
        workspaceId: true,
        userId: true,
        entityId: true,
        metadata: true,
      },
    });
    for (const action of [
      'status.created',
      'status.updated',
      'status.default_changed',
      'status.deactivated',
      'status.activated',
    ]) {
      expect(actions.some((item) => item.action === action)).toBe(true);
    }
    expect(
      actions.every((item) => item.agencyId === agencyA && item.workspaceId === workspaceA1),
    ).toBe(true);
    expect(actions.every((item) => item.userId)).toBe(true);
    const taskActions = actions.filter(
      (item) => item.entityId === statusId || item.entityId === completed.id,
    );
    expect(taskActions.length).toBeGreaterThanOrEqual(5);
    expect(
      taskActions.every((item) => (item.metadata as { entityType?: string }).entityType === 'TASK'),
    ).toBe(true);
  });

  it('switches defaults transactionally under concurrent requests', async () => {
    const first = await createStatus('PROJECT', 'Default Race A', StatusCategory.TODO, '#0EA5E9');
    const second = await createStatus('PROJECT', 'Default Race B', StatusCategory.TODO, '#22C55E');
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/${first.body.data.id}/set-default`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1)),
      request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/${second.body.data.id}/set-default`,
        )
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1)),
    ]);
    expect(responses.every((response) => [201, 409].includes(response.status))).toBe(true);
    await expectExactlyOneActiveDefault(workspaceA1, 'PROJECT');
  });

  it('reorders transactionally and rejects duplicate, missing, unknown, extra, foreign, and wrong-type ids', async () => {
    const statuses = await prisma.statusDefinition.findMany({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT' },
      orderBy: { position: 'asc' },
    });
    const reversed = statuses.map((status) => status.id).reverse();
    const reordered = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: reversed })
      .expect(200);
    expect(reordered.body.data.map((status: { id: string }) => status.id)).toEqual(reversed);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: [reversed[0], reversed[0]] })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: reversed.slice(1) })
      .expect(400);
    await expectProjectOrder(reversed);

    const unknownId = '00000000-0000-4000-8000-000000000001';
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: [unknownId, ...reversed.slice(1)] })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: [...reversed, unknownId] })
      .expect(400);

    const foreign = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA2, entityType: 'PROJECT' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: [foreign.id, ...reversed.slice(1)] })
      .expect(400);
    await expectProjectOrder(reversed);

    const taskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK' },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/${taskStatus.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/${taskStatus.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Wrong Type' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/${taskStatus.id}/set-default`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: [taskStatus.id, ...reversed.slice(1)] })
      .expect(400);

    for (const entityType of Object.values(StatusEntityType)) {
      const wrong = await prisma.statusDefinition.findFirstOrThrow({
        where: {
          workspaceId: workspaceA1,
          entityType: { not: entityType },
        },
      });
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceA1}/statuses/${entityType}/${wrong.id}`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .expect(404);
    }

    const current = await prisma.statusDefinition.findMany({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT' },
      orderBy: { position: 'asc' },
    });
    const forward = current.map((status) => status.id);
    const backward = [...forward].reverse();
    const concurrent = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ orderedStatusIds: forward }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/statuses/PROJECT/reorder`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ orderedStatusIds: backward }),
    ]);
    expect(concurrent.every((response) => [200, 409].includes(response.status))).toBe(true);
    await expectContiguousPositions(workspaceA1, 'PROJECT');
  });

  it('rejects cross-workspace, cross-agency, inactive default, and status-limit attacks', async () => {
    const a1Status = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TICKET' },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/statuses/TICKET/${a1Status.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TICKET/${a1Status.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyB, workspaceB1))
      .send({ name: 'Cross Agency' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA2}/statuses/TICKET/${a1Status.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ name: 'Cross Workspace Update' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA2}/statuses/TICKET/${a1Status.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ isActive: false })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/statuses/TICKET/${a1Status.id}/set-default`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA2}/statuses/TICKET/reorder`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ orderedStatusIds: [a1Status.id] })
      .expect(400);

    const inactive = await prisma.statusDefinition.create({
      data: {
        workspaceId: workspaceA1,
        entityType: 'TICKET',
        name: 'Dormant',
        nameNormalized: 'dormant',
        color: '#475569',
        position: 99,
        category: 'CANCELLED',
        isActive: false,
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/statuses/TICKET/${inactive.id}/set-default`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(400);

    const sparseWorkspace = await createWorkspaceFixture('Sparse Status Workspace', false);
    const solo = await prisma.statusDefinition.create({
      data: {
        workspaceId: sparseWorkspace,
        entityType: 'TASK',
        name: 'Only Active',
        nameNormalized: 'only active',
        color: '#64748B',
        position: 1,
        category: 'TODO',
        isActive: true,
      },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${sparseWorkspace}/statuses/TASK/${solo.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, sparseWorkspace))
      .send({ isActive: false })
      .expect(400);

    const limitWorkspace = await createWorkspaceFixture('Limit Status Workspace');
    const count = await prisma.statusDefinition.count({
      where: { workspaceId: limitWorkspace, entityType: 'TICKET' },
    });
    for (let index = count; index < 49; index += 1) {
      await prisma.statusDefinition.create({
        data: {
          workspaceId: limitWorkspace,
          entityType: 'TICKET',
          name: `Limit ${index}`,
          nameNormalized: `limit ${index}`,
          color: '#64748B',
          position: 100 + index,
          category: 'TODO',
        },
      });
    }
    await createStatusForWorkspace(
      limitWorkspace,
      'TICKET',
      'Limit 49 Accepted',
      StatusCategory.TODO,
      '#64748B',
    ).expect(201);
    await createStatusForWorkspace(
      limitWorkspace,
      'TICKET',
      'Limit 50 Rejected',
      StatusCategory.TODO,
      '#64748B',
    ).expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA2}/statuses/TICKET/${a1Status.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Forged Route Header' })
      .expect(403);
  });

  it('authorizes OWNER and custom status roles while exposing status permissions in catalog', async () => {
    await createStatus('TASK', 'Owner Created', StatusCategory.TODO, '#2563EB', ownerToken).expect(
      201,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/statuses/TASK`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);

    const catalog = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(catalog.body.data.map((permission: { key: string }) => permission.key)).toEqual(
      expect.arrayContaining([
        'statuses.view',
        'statuses.create',
        'statuses.update',
        'statuses.reorder',
        'statuses.manage',
      ]),
    );

    const statusViewerRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:status-viewer`,
        workspaceId: workspaceA1,
        name: 'Status Viewer',
        nameNormalized: 'status viewer',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.create({
      data: { roleId: statusViewerRole.id, permissionId: statusesViewPermissionId },
    });
    await prisma.workspaceMembership.update({
      where: { userId_workspaceId: { userId: limitedUserId, workspaceId: workspaceA1 } },
      data: { roleId: statusViewerRole.id },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/statuses/TASK`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await createStatus(
      'TASK',
      'Blocked By Auth',
      StatusCategory.TODO,
      '#2563EB',
      limitedToken,
    ).expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/reorder`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ orderedStatusIds: [] })
      .expect(403);
    const firstTask = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${firstTask.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ color: '#2563EB' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/statuses/TASK/${firstTask.id}/set-default`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/statuses/initialize-defaults`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);

    const delegated = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Delegated Status Viewer', permissionIds: [statusesViewPermissionId] })
      .expect(201);
    expect(
      delegated.body.data.permissions.map((permission: { key: string }) => permission.key),
    ).toContain('statuses.view');

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/statuses/TASK`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
  });

  it('initializes statuses automatically for API-created workspaces', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/agencies/${agencyA}/workspaces`)
      .set(auth(ownerToken))
      .set({ 'x-agency-id': agencyA })
      .send({ name: 'API Created Status Workspace', slug: 'api-created-status-workspace' })
      .expect(201);
    for (const entityType of Object.values(StatusEntityType)) {
      await expectExactlyOneActiveDefault(created.body.data.id, entityType);
    }
  });

  it('keeps existing project APIs compatible with legacy Project.status', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Compatibility Project', description: 'Legacy project status remains.' })
      .expect(201);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.statusDefinitionId).toBeUndefined();

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ status: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: '00000000-0000-4000-8000-000000000001' })
      .expect(422);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
  });

  function createStatus(
    entityType: keyof typeof StatusEntityType,
    name: string,
    category: StatusCategory,
    color: string,
    token = adminToken,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/statuses/${entityType}`)
      .set(auth(token))
      .set(ctx(agencyA, workspaceA1))
      .send({ name, color, category });
  }

  function createStatusForWorkspace(
    workspaceId: string,
    entityType: keyof typeof StatusEntityType,
    name: string,
    category: StatusCategory,
    color: string,
    token = adminToken,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/statuses/${entityType}`)
      .set(auth(token))
      .set(ctx(agencyA, workspaceId))
      .send({ name, color, category });
  }

  async function expectExactlyOneActiveDefault(
    workspaceId: string,
    entityType: keyof typeof StatusEntityType,
  ) {
    const defaults = await prisma.statusDefinition.findMany({
      where: { workspaceId, entityType, isActive: true, isDefault: true },
    });
    expect(defaults).toHaveLength(1);
  }

  async function expectProjectOrder(expectedIds: string[]) {
    const statuses = await prisma.statusDefinition.findMany({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT' },
      orderBy: { position: 'asc' },
    });
    expect(statuses.map((status) => status.id)).toEqual(expectedIds);
    await expectContiguousPositions(workspaceA1, 'PROJECT');
  }

  async function expectContiguousPositions(
    workspaceId: string,
    entityType: keyof typeof StatusEntityType,
  ) {
    const positions = (
      await prisma.statusDefinition.findMany({
        where: { workspaceId, entityType },
        select: { position: true },
        orderBy: { position: 'asc' },
      })
    ).map((status) => status.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(positions).toEqual(
      Array.from({ length: positions.length }, (_value, index) => index + 1),
    );
  }

  async function createWorkspaceFixture(name: string, initialize = true) {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const adminRole = await prisma.role.findFirstOrThrow({
      where: { key: 'ADMIN', scope: RoleScope.WORKSPACE },
    });
    const workspace = await prisma.workspace.create({
      data: {
        agencyId: agencyA,
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        createdById: admin.id,
      },
    });
    await workspaceMember(admin.id, workspace.id, adminRole.id);
    if (initialize) await initializeDefaultStatuses(prisma, workspace.id);
    return workspace.id;
  }

  async function seedFixtures() {
    const roles = await seedRoles();
    const [owner, admin, member, limited, betaOwner] = await Promise.all([
      user('owner-a@zeaplay.test', 'Owner A'),
      user('admin-a@zeaplay.test', 'Admin A'),
      user('member-a@zeaplay.test', 'Member A'),
      user('limited-a@zeaplay.test', 'Limited A'),
      user('owner-b@zeaplay.test', 'Owner B'),
    ]);
    limitedUserId = limited.id;
    const agency = await prisma.agency.create({
      data: { name: 'Agency A', slug: 'agency-a', createdById: owner.id },
    });
    const beta = await prisma.agency.create({
      data: { name: 'Agency B', slug: 'agency-b', createdById: betaOwner.id },
    });
    agencyA = agency.id;
    agencyB = beta.id;
    const wa = await prisma.workspace.create({
      data: {
        agencyId: agency.id,
        name: 'Workspace A',
        slug: 'workspace-a',
        createdById: owner.id,
      },
    });
    const wb = await prisma.workspace.create({
      data: {
        agencyId: agency.id,
        name: 'Workspace B',
        slug: 'workspace-b',
        createdById: owner.id,
      },
    });
    const wb1 = await prisma.workspace.create({
      data: {
        agencyId: beta.id,
        name: 'Workspace B1',
        slug: 'workspace-b1',
        createdById: betaOwner.id,
      },
    });
    workspaceA1 = wa.id;
    workspaceA2 = wb.id;
    workspaceB1 = wb1.id;

    await agencyMember(owner.id, agency.id, roles.AGENCY_OWNER.id);
    await agencyMember(admin.id, agency.id, roles.AGENCY_ADMIN.id);
    await agencyMember(member.id, agency.id, roles.AGENCY_USER.id);
    await agencyMember(limited.id, agency.id, roles.AGENCY_USER.id);
    await agencyMember(betaOwner.id, beta.id, roles.AGENCY_OWNER.id);
    await workspaceMember(owner.id, wa.id, roles.OWNER.id);
    await workspaceMember(admin.id, wa.id, roles.ADMIN.id);
    await workspaceMember(member.id, wa.id, roles.MEMBER.id);
    await workspaceMember(limited.id, wa.id, roles.MEMBER.id);
    await workspaceMember(owner.id, wb.id, roles.OWNER.id);
    await workspaceMember(admin.id, wb.id, roles.ADMIN.id);
    await workspaceMember(betaOwner.id, wb1.id, roles.OWNER.id);

    await initializeDefaultStatuses(prisma, workspaceA1);
    await initializeDefaultStatuses(prisma, workspaceA2);
    await initializeDefaultStatuses(prisma, workspaceB1);
  }
});

async function seedRoles() {
  const permissions = [
    'agency.read',
    'workspace.read',
    'workspace.create',
    'roles.view',
    'roles.create',
    'project.read',
    'project.create',
    'project.update',
    'project.delete',
    'statuses.view',
    'statuses.create',
    'statuses.update',
    'statuses.reorder',
    'statuses.manage',
  ];
  for (const key of permissions) await prisma.permission.create({ data: { key } });
  statusesViewPermissionId = (
    await prisma.permission.findUniqueOrThrow({ where: { key: 'statuses.view' } })
  ).id;
  const roles: Record<string, { id: string }> = {};
  for (const [key, scope, rolePermissions] of [
    ['AGENCY_OWNER', RoleScope.AGENCY, permissions],
    ['AGENCY_ADMIN', RoleScope.AGENCY, permissions],
    ['AGENCY_USER', RoleScope.AGENCY, ['agency.read', 'workspace.read']],
    ['OWNER', RoleScope.WORKSPACE, permissions],
    ['ADMIN', RoleScope.WORKSPACE, permissions],
    ['MEMBER', RoleScope.WORKSPACE, ['workspace.read']],
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
  return roles as Record<
    'AGENCY_OWNER' | 'AGENCY_ADMIN' | 'AGENCY_USER' | 'OWNER' | 'ADMIN' | 'MEMBER',
    { id: string }
  >;
}

async function resetDatabase() {
  await prisma.$transaction([
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

async function workspaceMember(userId: string, workspaceId: string, roleId: string) {
  return prisma.workspaceMembership.create({ data: { userId, workspaceId, roleId } });
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

function drainTeardown() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}
