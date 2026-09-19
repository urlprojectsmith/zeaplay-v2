import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AssetStatus,
  AttachmentType,
  DepartmentStatus,
  MembershipStatus,
  PrismaClient,
  RoleScope,
  StatusCategory,
  StatusEntityType,
} from '@prisma/client';
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
  let ownerBToken: string;
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
    ownerBToken = await accessTokenFor('owner-b@zeaplay.test');
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

  it('keeps legacy project routes compatible while using PROJECT StatusDefinition authority', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Compatibility Project', description: 'Legacy project status remains.' })
      .expect(201);
    expect(created.body.data.status).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
    });
    expect(created.body.data.statusDefinitionId).toBe(created.body.data.status.id);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ status: 'ACTIVE' })
      .expect(422);
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
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
  });

  it('hardens Project core status, tenant, date, department, list, no-op, and link behavior', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const defaultProjectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: {
        workspaceId: workspaceA1,
        entityType: 'PROJECT',
        isDefault: true,
        isActive: true,
      },
    });
    const developmentStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: {
        workspaceId: workspaceA1,
        entityType: 'PROJECT',
        nameNormalized: 'development',
      },
    });
    const a2ProjectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA2, entityType: 'PROJECT', isActive: true },
    });
    const b1ProjectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceB1, entityType: 'PROJECT', isActive: true },
    });
    const taskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', isActive: true },
    });
    const inactiveProjectStatus = await prisma.statusDefinition.create({
      data: {
        workspaceId: workspaceA1,
        entityType: 'PROJECT',
        name: 'Dormant Project Status',
        nameNormalized: 'dormant project status',
        color: '#334155',
        position: 100,
        category: StatusCategory.TODO,
        isActive: false,
      },
    });
    const activeDepartment = await prisma.department.create({
      data: { workspaceId: workspaceA1, name: 'Project Refinement Active' },
    });
    const inactiveDepartment = await prisma.department.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Project Refinement Inactive',
        status: DepartmentStatus.INACTIVE,
      },
    });
    const a2Department = await prisma.department.create({
      data: { workspaceId: workspaceA2, name: 'Project Refinement A2' },
    });
    const b1Department = await prisma.department.create({
      data: { workspaceId: workspaceB1, name: 'Project Refinement B1' },
    });

    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: 'Project Core Refinement',
        priority: 'URGENT',
        plannedStartAt: '2026-09-20T00:00:00.000Z',
        dueAt: '2026-09-30T00:00:00.000Z',
        departmentId: activeDepartment.id,
      })
      .expect(201);
    const projectId = created.body.data.id as string;
    expect(created.body.data.statusDefinitionId).toBe(defaultProjectStatus.id);
    expect(created.body.data.priority).toBe('URGENT');
    expect(created.body.data.department.id).toBe(activeDepartment.id);

    for (const priority of ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/projects`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ name: `Priority ${priority}`, priority })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Malformed priority', priority: 'BLOCKER' })
      .expect(422);

    for (const payload of [
      { name: 'Start Only', plannedStartAt: '2026-09-20T00:00:00.000Z' },
      { name: 'Due Only', dueAt: '2026-09-30T00:00:00.000Z' },
      { name: 'Neither Date' },
      {
        name: 'Equal Dates',
        plannedStartAt: '2026-09-30T00:00:00.000Z',
        dueAt: '2026-09-30T00:00:00.000Z',
      },
      {
        name: 'Ordered Dates',
        plannedStartAt: '2026-09-20T00:00:00.000Z',
        dueAt: '2026-09-30T00:00:00.000Z',
      },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/projects`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send(payload)
        .expect(201);
    }

    const projectCountBeforeInvalidCreates = await prisma.project.count({
      where: { workspaceId: workspaceA1 },
    });
    for (const payload of [
      { name: 'Task status rejected', statusDefinitionId: taskStatus.id },
      { name: 'A2 status rejected', statusDefinitionId: a2ProjectStatus.id },
      { name: 'B1 status rejected', statusDefinitionId: b1ProjectStatus.id },
      { name: 'Inactive status rejected', statusDefinitionId: inactiveProjectStatus.id },
      { name: 'A2 department rejected', departmentId: a2Department.id },
      { name: 'B1 department rejected', departmentId: b1Department.id },
      { name: 'Unknown department rejected', departmentId: '00000000-0000-4000-8000-000000000099' },
      { name: 'Inactive department rejected', departmentId: inactiveDepartment.id },
      {
        name: 'Invalid date rejected',
        plannedStartAt: '2026-10-05T00:00:00.000Z',
        dueAt: '2026-09-30T00:00:00.000Z',
      },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/projects`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send(payload)
        .expect(400);
    }
    await expect(prisma.project.count({ where: { workspaceId: workspaceA1 } })).resolves.toBe(
      projectCountBeforeInvalidCreates,
    );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ plannedStartAt: '2026-10-05T00:00:00.000Z' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ dueAt: '2026-09-10T00:00:00.000Z' })
      .expect(400);

    const beforeFailedPatch = await prisma.project.findUniqueOrThrow({
      where: { id_workspaceId: { id: projectId, workspaceId: workspaceA1 } },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Should Not Persist', priority: 'LOW', departmentId: a2Department.id })
      .expect(400);
    const afterFailedPatch = await prisma.project.findUniqueOrThrow({
      where: { id_workspaceId: { id: projectId, workspaceId: workspaceA1 } },
    });
    expect(afterFailedPatch.name).toBe(beforeFailedPatch.name);
    expect(afterFailedPatch.priority).toBe(beforeFailedPatch.priority);
    expect(afterFailedPatch.departmentId).toBe(beforeFailedPatch.departmentId);

    const updateAuditBefore = await prisma.auditLog.count({
      where: { entityId: projectId, action: 'project.updated' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: beforeFailedPatch.name,
        priority: beforeFailedPatch.priority,
        plannedStartAt: beforeFailedPatch.plannedStartAt?.toISOString(),
        dueAt: beforeFailedPatch.dueAt?.toISOString(),
        departmentId: beforeFailedPatch.departmentId,
      })
      .expect(200);
    await expect(
      prisma.auditLog.count({ where: { entityId: projectId, action: 'project.updated' } }),
    ).resolves.toBe(updateAuditBefore);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: developmentStatus.id })
      .expect(200);
    const statusAuditBefore = await prisma.auditLog.count({
      where: { entityId: projectId, action: 'project.status_changed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: developmentStatus.id })
      .expect(200);
    await expect(
      prisma.auditLog.count({ where: { entityId: projectId, action: 'project.status_changed' } }),
    ).resolves.toBe(statusAuditBefore);

    const filtered = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/projects?page=1&pageSize=2&search=core&statusDefinitionId=${developmentStatus.id}&priority=URGENT&departmentId=${activeDepartment.id}&plannedFrom=2026-09-01T00:00:00.000Z&plannedTo=2026-09-25T00:00:00.000Z&dueFrom=2026-09-25T00:00:00.000Z&dueTo=2026-10-01T00:00:00.000Z&sortBy=dueAt&sortDirection=asc`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(filtered.body.data.page).toBe(1);
    expect(filtered.body.data.pageSize).toBe(2);
    expect(filtered.body.data.items.map((item: { id: string }) => item.id)).toContain(projectId);
    expect(filtered.body.data.items[0].status.name).toBe(developmentStatus.name);
    expect(filtered.body.data.items[0].department.name).toBe(activeDepartment.name);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?page=0`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?pageSize=101`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?sortBy=status;DROP`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?statusDefinitionId=${a2ProjectStatus.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.items).toHaveLength(0));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?departmentId=${a2Department.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.items).toHaveLength(0));

    for (const [token, agencyId, workspaceId, statusId] of [
      [adminToken, agencyA, workspaceA2, a2ProjectStatus.id],
      [ownerBToken, agencyB, workspaceB1, b1ProjectStatus.id],
    ] as const) {
      await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspaceId}/projects/${projectId}`)
        .set(auth(token))
        .set(ctx(agencyId, workspaceId))
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceId}/projects/${projectId}`)
        .set(auth(token))
        .set(ctx(agencyId, workspaceId))
        .send({ name: 'Tenant Escape' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/status`)
        .set(auth(token))
        .set(ctx(agencyId, workspaceId))
        .send({ statusDefinitionId: statusId })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/v1/workspaces/${workspaceId}/projects/${projectId}`)
        .set(auth(token))
        .set(ctx(agencyId, workspaceId))
        .expect(404);
    }

    const task = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Project link survives archive',
        statusDefinitionId: taskStatus.id,
        createdById: admin.id,
      },
    });
    await prisma.taskProject.create({
      data: { workspaceId: workspaceA1, taskId: task.id, projectId },
    });
    const asset = await prisma.asset.create({
      data: {
        workspaceId: workspaceA1,
        projectId,
        createdById: admin.id,
        originalFilename: 'project.txt',
        displayName: 'project.txt',
        storageBucket: 'zea-play-dev',
        storageKey: `workspace/${workspaceA1}/projects/${projectId}/assets/refinement.txt`,
        mimeType: 'text/plain',
        extension: 'txt',
        sizeBytes: 12n,
        status: AssetStatus.READY,
        uploadExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const attachment = await prisma.attachment.create({
      data: {
        workspaceId: workspaceA1,
        type: AttachmentType.FILE,
        assetId: asset.id,
        displayName: 'project.txt',
        createdById: admin.id,
      },
    });
    await prisma.projectAttachment.create({
      data: {
        workspaceId: workspaceA1,
        projectId,
        attachmentId: attachment.id,
        attachedById: admin.id,
      },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await expect(
      prisma.taskProject.findUnique({
        where: { taskId_projectId: { taskId: task.id, projectId } },
      }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.projectAttachment.findUnique({
        where: { projectId_attachmentId: { projectId, attachmentId: attachment.id } },
      }),
    ).resolves.not.toBeNull();
    await expect(prisma.asset.findUnique({ where: { id: asset.id } })).resolves.not.toBeNull();
    await expect(prisma.task.findUnique({ where: { id: task.id } })).resolves.not.toBeNull();
  });

  it('enforces project owner, members, visibility, and tenant-safe membership rules', async () => {
    const memberships = await prisma.workspaceMembership.findMany({
      where: { workspaceId: { in: [workspaceA1, workspaceA2] } },
      include: { user: true },
    });
    const ownerMembership = memberships.find(
      (membership) =>
        membership.workspaceId === workspaceA1 && membership.user.email === 'owner-a@zeaplay.test',
    );
    const memberMembership = memberships.find(
      (membership) =>
        membership.workspaceId === workspaceA1 && membership.user.email === 'member-a@zeaplay.test',
    );
    const limitedMembership = memberships.find(
      (membership) =>
        membership.workspaceId === workspaceA1 &&
        membership.user.email === 'limited-a@zeaplay.test',
    );
    const foreignMembership = memberships.find(
      (membership) =>
        membership.workspaceId === workspaceA2 && membership.user.email === 'owner-a@zeaplay.test',
    );
    expect(ownerMembership).toBeTruthy();
    expect(memberMembership).toBeTruthy();
    expect(limitedMembership).toBeTruthy();
    expect(foreignMembership).toBeTruthy();

    const projectViewerPermissions = await prisma.permission.findMany({
      where: { key: { in: ['workspace.read', 'projects.view', 'projects.create'] } },
    });
    const projectCreatorRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:project-creator-no-view-all`,
        workspaceId: workspaceA1,
        name: 'Project Creator No View All',
        nameNormalized: 'project creator no view all',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: projectViewerPermissions.map((permission) => ({
        roleId: projectCreatorRole.id,
        permissionId: permission.id,
      })),
    });
    const projectViewerRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:project-viewer-no-view-all`,
        workspaceId: workspaceA1,
        name: 'Project Viewer No View All',
        nameNormalized: 'project viewer no view all',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    const viewPermissions = await prisma.permission.findMany({
      where: { key: { in: ['workspace.read', 'projects.view'] } },
    });
    await prisma.rolePermission.createMany({
      data: viewPermissions.map((permission) => ({
        roleId: projectViewerRole.id,
        permissionId: permission.id,
      })),
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership!.id },
      data: { roleId: projectCreatorRole.id },
    });
    await prisma.workspaceMembership.update({
      where: { id: memberMembership!.id },
      data: { roleId: projectViewerRole.id },
    });

    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: 'Restricted Owner Membership Project',
        visibility: 'RESTRICTED',
        ownerMembershipId: ownerMembership!.id,
      })
      .expect(201);
    const projectId = created.body.data.id as string;
    expect(created.body.data.visibility).toBe('RESTRICTED');
    expect(created.body.data.ownerMembershipId).toBe(ownerMembership!.id);

    await prisma.workspaceMembership.update({
      where: { id: limitedMembership!.id },
      data: { status: MembershipStatus.SUSPENDED },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/owner`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ workspaceMembershipId: limitedMembership!.id })
      .expect(400);
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership!.id },
      data: { status: MembershipStatus.ACTIVE },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    const hiddenList = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/projects?search=Restricted%20Owner&page=1&pageSize=20`,
      )
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(hiddenList.body.data.total).toBe(0);
    expect(hiddenList.body.data.items).toHaveLength(0);

    const beforeAtomicCreate = await prisma.project.count({
      where: { workspaceId: workspaceA1, name: 'Atomic Project Create Failure' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: 'Duplicate Create Member Failure',
        ownerMembershipId: ownerMembership!.id,
        memberMembershipIds: [memberMembership!.id, memberMembership!.id],
      })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: 'Atomic Project Create Failure',
        ownerMembershipId: ownerMembership!.id,
        memberMembershipIds: [memberMembership!.id, foreignMembership!.id],
      })
      .expect(400);
    await expect(
      prisma.project.count({
        where: { workspaceId: workspaceA1, name: 'Atomic Project Create Failure' },
      }),
    ).resolves.toBe(beforeAtomicCreate);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/members`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [memberMembership!.id] })
      .expect(201);
    const duplicateAdds = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/members`)
        .set(auth(ownerToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ membershipIds: [memberMembership!.id] }),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/members`)
        .set(auth(ownerToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ membershipIds: [memberMembership!.id] }),
    ]);
    expect(duplicateAdds.every((response) => response.status === 201)).toBe(true);
    await expect(
      prisma.projectMember.count({
        where: { projectId, workspaceMembershipId: memberMembership!.id },
      }),
    ).resolves.toBe(1);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    const hiddenAndVisible = await Promise.all(
      [
        { name: 'Visible Total One', visibility: 'WORKSPACE' },
        { name: 'Visible Total Two', visibility: 'WORKSPACE' },
        { name: 'Visible Total Three', visibility: 'WORKSPACE' },
        { name: 'Secret Apollo One', visibility: 'RESTRICTED' },
        { name: 'Secret Apollo Two', visibility: 'RESTRICTED' },
      ].map((payload) =>
        request(app.getHttpServer())
          .post(`/api/v1/workspaces/${workspaceA1}/projects`)
          .set(auth(adminToken))
          .set(ctx(agencyA, workspaceA1))
          .send({ ...payload, ownerMembershipId: ownerMembership!.id }),
      ),
    );
    expect(hiddenAndVisible.every((response) => response.status === 201)).toBe(true);
    const totalCheck = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?search=Total&page=1&pageSize=20`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(totalCheck.body.data.total).toBe(3);
    expect(totalCheck.body.data.items).toHaveLength(3);
    const secretSearch = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?search=Apollo&page=1&pageSize=20`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(secretSearch.body.data.total).toBe(0);
    expect(secretSearch.body.data.items).toHaveLength(0);

    const memberVisibleList = await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/projects?search=Restricted%20Owner&page=1&pageSize=20`,
      )
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(memberVisibleList.body.data.total).toBe(1);

    const beforeFailedMemberChange = await prisma.projectMember.count({ where: { projectId } });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/members`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ membershipIds: [limitedMembership!.id, foreignMembership!.id] })
      .expect(400);
    await expect(prisma.projectMember.count({ where: { projectId } })).resolves.toBe(
      beforeFailedMemberChange,
    );
    await request(app.getHttpServer())
      .delete(
        `/api/v1/workspaces/${workspaceA1}/projects/${projectId}/members/${ownerMembership!.id}`,
      )
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(400);
    const membershipBeforeRemove = await prisma.workspaceMembership.count({
      where: { id: memberMembership!.id },
    });
    await request(app.getHttpServer())
      .delete(
        `/api/v1/workspaces/${workspaceA1}/projects/${projectId}/members/${memberMembership!.id}`,
      )
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await expect(
      prisma.workspaceMembership.count({ where: { id: memberMembership!.id } }),
    ).resolves.toBe(membershipBeforeRemove);
    await request(app.getHttpServer())
      .delete(
        `/api/v1/workspaces/${workspaceA1}/projects/${projectId}/members/${memberMembership!.id}`,
      )
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Unauthorized direct mutation' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/owner`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ workspaceMembershipId: foreignMembership!.id })
      .expect(400);
    const ownerChanged = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/owner`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ workspaceMembershipId: memberMembership!.id })
      .expect(200);
    expect(ownerChanged.body.data.ownerMembershipId).toBe(memberMembership!.id);
    const ownerAuditBeforeNoop = await prisma.auditLog.count({
      where: { entityId: projectId, action: 'project.owner_changed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/owner`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ workspaceMembershipId: memberMembership!.id })
      .expect(200);
    await expect(
      prisma.auditLog.count({ where: { entityId: projectId, action: 'project.owner_changed' } }),
    ).resolves.toBe(ownerAuditBeforeNoop);

    const raceProject = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: 'Concurrent Owner Change',
        visibility: 'RESTRICTED',
        ownerMembershipId: ownerMembership!.id,
      })
      .expect(201);
    const ownerRaces = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/projects/${raceProject.body.data.id}/owner`)
        .set(auth(ownerToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ workspaceMembershipId: memberMembership!.id }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/projects/${raceProject.body.data.id}/owner`)
        .set(auth(ownerToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ workspaceMembershipId: limitedMembership!.id }),
    ]);
    expect(ownerRaces.every((response) => response.status === 200)).toBe(true);
    const finalOwner = await prisma.project.findUniqueOrThrow({
      where: { id: raceProject.body.data.id },
      select: { ownerMembershipId: true },
    });
    expect([memberMembership!.id, limitedMembership!.id]).toContain(finalOwner.ownerMembershipId);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ visibility: 'WORKSPACE' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(limitedToken))
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
    'projects.view',
    'projects.create',
    'projects.update',
    'projects.delete',
    'projects.manage_status',
    'projects.view_all',
    'projects.manage_members',
    'projects.manage_owner',
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
    prisma.taskCommentReaction.deleteMany(),
    prisma.taskCommentMention.deleteMany(),
    prisma.taskComment.deleteMany(),
    prisma.taskTimeEntry.deleteMany(),
    prisma.taskWorkloadAllocation.deleteMany(),
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
    prisma.taskTemplateAssignee.deleteMany(),
    prisma.taskTemplateFollower.deleteMany(),
    prisma.taskTemplateProject.deleteMany(),
    prisma.taskTemplateTag.deleteMany(),
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
    prisma.projectMember.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.task.deleteMany(),
    prisma.taskTemplate.deleteMany(),
    prisma.taskRecurrenceCompletionApprover.deleteMany(),
    prisma.taskRecurrenceSeries.deleteMany(),
    prisma.taskKanbanColumnSetting.deleteMany(),
    prisma.workspaceTag.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.processingJob.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.project.deleteMany(),
    prisma.workspaceMemberCapacity.deleteMany(),
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
