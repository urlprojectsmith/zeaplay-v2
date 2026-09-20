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

  it('serves Phase 9.1 Ticket core with tenant-safe numbering, TICKET statuses, permissions, audit, and soft delete', async () => {
    const ticketStatuses = await prisma.statusDefinition.findMany({
      where: { workspaceId: workspaceA1, entityType: 'TICKET' },
      orderBy: { position: 'asc' },
    });
    expect(ticketStatuses.slice(0, 6).map((status) => status.name)).toEqual([
      'New',
      'Open',
      'In Progress',
      'Waiting on Requester',
      'Resolved',
      'Closed',
    ]);
    await expectExactlyOneActiveDefault(workspaceA1, 'TICKET');
    await expectExactlyOneActiveDefault(workspaceA2, 'TICKET');
    await expectExactlyOneActiveDefault(workspaceB1, 'TICKET');

    const openStatus = ticketStatuses.find((status) => status.name === 'Open')!;
    const inProgressStatus = ticketStatuses.find((status) => status.name === 'In Progress')!;
    const waitingStatus = ticketStatuses.find((status) => status.name === 'Waiting on Requester')!;
    const resolvedStatus = ticketStatuses.find((status) => status.name === 'Resolved')!;
    const taskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', isActive: true },
    });
    const projectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT', isActive: true },
    });
    const foreignTicketStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA2, entityType: 'TICKET', isActive: true },
    });
    const betaTicketStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceB1, entityType: 'TICKET', isActive: true },
    });
    const [ownerUser, adminUser, memberUser, betaOwnerUser] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email: 'owner-a@zeaplay.test' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'member-a@zeaplay.test' } }),
      prisma.user.findUniqueOrThrow({ where: { email: 'owner-b@zeaplay.test' } }),
    ]);
    const [
      ownerMembershipA1,
      adminMembershipA1,
      adminMembershipA2,
      memberMembershipA1,
      betaOwnerMembership,
    ] = await Promise.all([
      prisma.workspaceMembership.findUniqueOrThrow({
        where: { userId_workspaceId: { userId: ownerUser.id, workspaceId: workspaceA1 } },
        select: { id: true },
      }),
      prisma.workspaceMembership.findUniqueOrThrow({
        where: { userId_workspaceId: { userId: adminUser.id, workspaceId: workspaceA1 } },
        select: { id: true },
      }),
      prisma.workspaceMembership.findUniqueOrThrow({
        where: { userId_workspaceId: { userId: adminUser.id, workspaceId: workspaceA2 } },
        select: { id: true },
      }),
      prisma.workspaceMembership.findUniqueOrThrow({
        where: { userId_workspaceId: { userId: memberUser.id, workspaceId: workspaceA1 } },
        select: { id: true },
      }),
      prisma.workspaceMembership.findUniqueOrThrow({
        where: { userId_workspaceId: { userId: betaOwnerUser.id, workspaceId: workspaceB1 } },
        select: { id: true },
      }),
    ]);
    const requesterA1 = { type: 'INTERNAL', membershipId: adminMembershipA1.id };
    const requesterA2 = { type: 'INTERNAL', membershipId: adminMembershipA2.id };
    const requesterB1 = { type: 'INTERNAL', membershipId: betaOwnerMembership.id };

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'No permission ticket' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: '  Printer is offline  ',
        description: 'Initial issue description',
        priority: 'HIGH',
        ticketNumber: 'TKT-999999',
        createdByMembershipId: '00000000-0000-4000-8000-000000000001',
      })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'Client sequence injection',
        sequenceNumber: 999999,
      })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'A'.repeat(201) })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Valid subject', description: 'D'.repeat(4001) })
      .expect(422);

    const beforeInvalidCreateCount = await prisma.ticket.count({
      where: { workspaceId: workspaceA1 },
    });
    const beforeInvalidCreateAuditCount = await prisma.auditLog.count({
      where: { action: 'ticket.created' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Bad priority', priority: 'CRITICAL' })
      .expect(422);
    await expect(prisma.ticket.count({ where: { workspaceId: workspaceA1 } })).resolves.toBe(
      beforeInvalidCreateCount,
    );
    await expect(prisma.auditLog.count({ where: { action: 'ticket.created' } })).resolves.toBe(
      beforeInvalidCreateAuditCount,
    );

    const first = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: '  Printer is offline  ',
        description: 'Initial issue description',
        priority: 'HIGH',
        requester: requesterA1,
      })
      .expect(201);
    expect(first.body.data).toMatchObject({
      ticketNumber: 'TKT-000001',
      sequenceNumber: 1,
      subject: 'Printer is offline',
      priority: 'HIGH',
      status: { name: 'New' },
    });
    expect(first.body.data.createdBy.id).toEqual(expect.any(String));

    const betaFirst = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceB1}/tickets`)
      .set(auth(ownerBToken))
      .set(ctx(agencyB, workspaceB1))
      .send({ subject: 'Beta workspace first ticket', requester: requesterB1 })
      .expect(201);
    expect(betaFirst.body.data.ticketNumber).toBe('TKT-000001');

    const explicit = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'VPN access',
        priority: 'URGENT',
        statusDefinitionId: openStatus.id,
        requester: requesterA1,
      })
      .expect(201);
    expect(explicit.body.data).toMatchObject({
      ticketNumber: 'TKT-000002',
      priority: 'URGENT',
      statusDefinitionId: openStatus.id,
    });

    for (const invalidStatusDefinitionId of [
      taskStatus.id,
      projectStatus.id,
      foreignTicketStatus.id,
      betaTicketStatus.id,
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ subject: 'Invalid status', statusDefinitionId: invalidStatusDefinitionId })
        .expect(400);
    }

    const concurrent = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        request(app.getHttpServer())
          .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
          .set(auth(ownerToken))
          .set(ctx(agencyA, workspaceA1))
          .send({
            subject: `Concurrent ticket ${index}`,
            requester: { type: 'INTERNAL', membershipId: ownerMembershipA1.id },
          })
          .expect(201),
      ),
    );
    const numbers = concurrent.map((response) => response.body.data.sequenceNumber as number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.sort((a, b) => a - b)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
    const concurrentTicketNumbers = concurrent.map(
      (response) => response.body.data.ticketNumber as string,
    );
    expect(new Set(concurrentTicketNumbers).size).toBe(concurrentTicketNumbers.length);

    const multiWorkspaceConcurrent = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
        .set(auth(ownerToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          subject: 'A1 isolated counter',
          requester: { type: 'INTERNAL', membershipId: ownerMembershipA1.id },
        })
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA2}/tickets`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA2))
        .send({ subject: 'A2 isolated counter', requester: requesterA2 })
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceB1}/tickets`)
        .set(auth(ownerBToken))
        .set(ctx(agencyB, workspaceB1))
        .send({ subject: 'B1 isolated counter', requester: requesterB1 })
        .expect(201),
    ]);
    expect(multiWorkspaceConcurrent[0].body.data.ticketNumber).toBe('TKT-000023');
    expect(multiWorkspaceConcurrent[1].body.data.ticketNumber).toBe('TKT-000001');
    expect(multiWorkspaceConcurrent[2].body.data.ticketNumber).toBe('TKT-000002');
    await expect(
      prisma.workspaceTicketCounter.findUniqueOrThrow({
        where: { workspaceId: workspaceA1 },
        select: { lastNumber: true },
      }),
    ).resolves.toEqual({ lastNumber: 23 });
    await expect(
      prisma.workspaceTicketCounter.findUniqueOrThrow({
        where: { workspaceId: workspaceA2 },
        select: { lastNumber: true },
      }),
    ).resolves.toEqual({ lastNumber: 1 });
    await expect(
      prisma.workspaceTicketCounter.findUniqueOrThrow({
        where: { workspaceId: workspaceB1 },
        select: { lastNumber: true },
      }),
    ).resolves.toEqual({ lastNumber: 2 });

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.configured).toBe(false);
        expect(response.body.data.firstResponse.state).toBe('NOT_CONFIGURED');
      });

    const defaultSlaPayload = {
      name: 'Default Support SLA',
      isActive: true,
      isDefault: true,
      timezone: 'America/New_York',
      businessMode: 'ALWAYS',
      businessHours: {},
      holidayDates: ['2026-12-25'],
      rules: [
        { priority: 'LOW', firstResponseMinutes: 480, resolutionMinutes: 2400 },
        { priority: 'MEDIUM', firstResponseMinutes: 240, resolutionMinutes: 1440 },
        { priority: 'HIGH', firstResponseMinutes: 120, resolutionMinutes: 480 },
        { priority: 'URGENT', firstResponseMinutes: 30, resolutionMinutes: 240 },
      ],
      pauseStatuses: [
        {
          statusDefinitionId: waitingStatus.id,
          pauseFirstResponse: true,
          pauseResolution: true,
        },
      ],
    };
    const createdPolicy = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send(defaultSlaPayload)
      .expect(201);
    expect(createdPolicy.body.data).toMatchObject({ isDefault: true, isActive: true });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        ...defaultSlaPayload,
        name: 'Empty business week',
        isDefault: false,
        businessMode: 'BUSINESS_HOURS',
        businessHours: {},
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        ...defaultSlaPayload,
        name: 'Duplicate holidays',
        isDefault: false,
        holidayDates: ['2026-12-25', '2026-12-25', '2026-01-01'],
      })
      .expect(201)
      .expect((response) =>
        expect(response.body.data.holidayDates).toEqual(['2026-01-01', '2026-12-25']),
      );
    const policyUpdateAuditCount = await prisma.auditLog.count({
      where: {
        workspaceId: workspaceA1,
        action: 'ticket.sla_policy_updated',
        entityId: createdPolicy.body.data.id,
      },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies/${createdPolicy.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send(defaultSlaPayload)
      .expect(200);
    await expect(
      prisma.auditLog.count({
        where: {
          workspaceId: workspaceA1,
          action: 'ticket.sla_policy_updated',
          entityId: createdPolicy.body.data.id,
        },
      }),
    ).resolves.toBe(policyUpdateAuditCount);
    for (const invalidPauseStatusId of [taskStatus.id, projectStatus.id, foreignTicketStatus.id]) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({
          ...defaultSlaPayload,
          name: `Invalid pause ${invalidPauseStatusId}`,
          isDefault: false,
          pauseStatuses: [{ statusDefinitionId: invalidPauseStatusId, pauseFirstResponse: true }],
        })
        .expect(400);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        ...defaultSlaPayload,
        name: 'Missing priority rule',
        isDefault: false,
        rules: defaultSlaPayload.rules.slice(0, 3),
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        ...defaultSlaPayload,
        name: 'Invalid target',
        isDefault: false,
        rules: defaultSlaPayload.rules.map((rule) =>
          rule.priority === 'LOW' ? { ...rule, firstResponseMinutes: 0 } : rule,
        ),
      })
      .expect(422);

    const slaTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'SLA initialized ticket',
        priority: 'HIGH',
        statusDefinitionId: openStatus.id,
        requester: requesterA1,
      })
      .expect(201);
    const initialSla = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(initialSla.body.data).toMatchObject({
      configured: true,
      priority: 'HIGH',
      firstResponse: { state: 'RUNNING', targetMinutes: 120 },
      resolution: { state: 'RUNNING', targetMinutes: 480 },
    });
    const originalFirstDueAt = initialSla.body.data.firstResponse.dueAt;
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies/${createdPolicy.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        ...defaultSlaPayload,
        name: 'Edited Default Support SLA',
        rules: defaultSlaPayload.rules.map((rule) =>
          rule.priority === 'HIGH'
            ? { ...rule, firstResponseMinutes: 1, resolutionMinutes: 2 }
            : rule,
        ),
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ priority: 'LOW' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.firstResponse.targetMinutes).toBe(120);
        expect(response.body.data.firstResponse.dueAt).toBe(originalFirstDueAt);
        expect(response.body.data.priority).toBe('HIGH');
      });
    const nextSnapshotTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'SLA latest policy ticket',
        priority: 'HIGH',
        statusDefinitionId: openStatus.id,
        requester: requesterA1,
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${nextSnapshotTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.firstResponse.targetMinutes).toBe(1);
        expect(response.body.data.resolution.targetMinutes).toBe(2);
      });
    const terminalCreate = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'Direct terminal SLA ticket',
        priority: 'HIGH',
        statusDefinitionId: resolvedStatus.id,
        requester: requesterA1,
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${terminalCreate.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.firstResponse.state).toBe('NOT_APPLICABLE');
        expect(response.body.data.resolution.state).toBe('MET');
      });
    const lateReplyTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'Late first response SLA ticket',
        priority: 'HIGH',
        statusDefinitionId: openStatus.id,
        requester: requesterA1,
      })
      .expect(201);
    const lateFirstDueAt = new Date(Date.now() - 60_000);
    await prisma.ticketSlaState.update({
      where: { ticketId: lateReplyTicket.body.data.id },
      data: { firstResponseDueAt: lateFirstDueAt },
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceA1}/tickets/${lateReplyTicket.body.data.id}/conversation`,
      )
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Late agent response' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${lateReplyTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.firstResponse.state).toBe('BREACHED');
        expect(response.body.data.firstResponse.breachedAt).toBe(lateFirstDueAt.toISOString());
        expect(response.body.data.firstResponse.completedAt).toBeTruthy();
      });
    const overduePauseTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'Overdue pause SLA ticket',
        priority: 'HIGH',
        statusDefinitionId: openStatus.id,
        requester: requesterA1,
      })
      .expect(201);
    const overduePauseDueAt = new Date(Date.now() - 60_000);
    await prisma.ticketSlaState.update({
      where: { ticketId: overduePauseTicket.body.data.id },
      data: { firstResponseDueAt: overduePauseDueAt },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${overduePauseTicket.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: waitingStatus.id })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${overduePauseTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.firstResponse.state).toBe('BREACHED');
        expect(response.body.data.firstResponse.pausedAt).toBeNull();
      });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Requester self reply' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.firstResponse.state).toBe('RUNNING'));
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/conversation`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Agent response' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/conversation`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'INTERNAL_NOTE', body: 'Does not affect first response' })
      .expect(201);
    const firstResponseMet = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(firstResponseMet.body.data.firstResponse.state).toBe('MET');
    const firstCompletedAt = firstResponseMet.body.data.firstResponse.completedAt;
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/conversation`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Second agent response' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.firstResponse.completedAt).toBe(firstCompletedAt),
      );
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: resolvedStatus.id })
      .expect(200);
    const resolvedSla = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(resolvedSla.body.data.resolution.state).toBe('MET');
    const resolutionCompletedAt = resolvedSla.body.data.resolution.completedAt;
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: openStatus.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: resolvedStatus.id })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.resolution.completedAt).toBe(resolutionCompletedAt),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceB1}/tickets/${slaTicket.body.data.id}/sla`)
      .set(auth(ownerBToken))
      .set(ctx(agencyB, workspaceB1))
      .expect(404);
    const [defaultA, defaultB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ ...defaultSlaPayload, name: 'Concurrent default A', isDefault: true })
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets/sla/policies`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ ...defaultSlaPayload, name: 'Concurrent default B', isDefault: true })
        .expect(201),
    ]);
    const activeDefaults = await prisma.ticketSlaPolicy.findMany({
      where: { workspaceId: workspaceA1, isActive: true, isDefault: true },
      select: { id: true },
    });
    expect(activeDefaults).toHaveLength(1);
    expect([defaultA.body.data.id, defaultB.body.data.id]).toContain(activeDefaults[0]?.id);

    const externalEmailTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'External requester email',
        requester: { type: 'EXTERNAL', name: '  External Alice  ', email: 'ALICE@EXAMPLE.COM' },
      })
      .expect(201);
    expect(externalEmailTicket.body.data.requester).toMatchObject({
      type: 'EXTERNAL',
      displayName: 'External Alice',
    });
    expect(externalEmailTicket.body.data.requester.externalEmail).toBe('alice@example.com');

    const externalPhoneTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'External requester phone',
        requester: { type: 'EXTERNAL', name: 'External Phone', phone: '+91 98765 43210' },
      })
      .expect(201);
    expect(externalPhoneTicket.body.data.requester.externalPhone).toBe('+91 98765 43210');

    const externalFullTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'External requester email and phone',
        requester: {
          type: 'EXTERNAL',
          name: 'External Full',
          email: 'full@example.com',
          phone: '+1 555 0100',
        },
      })
      .expect(201);
    expect(externalFullTicket.body.data.requester).toMatchObject({
      externalEmail: 'full@example.com',
      externalPhone: '+1 555 0100',
    });

    const legacyTicket = await prisma.ticket.create({
      data: {
        workspaceId: workspaceA1,
        sequenceNumber: 900001,
        ticketNumber: 'TKT-900001',
        subject: 'Legacy requester null',
        statusDefinitionId: openStatus.id,
        priority: 'LOW',
        createdByMembershipId: adminMembershipA1.id,
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${legacyTicket.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.requester).toBeNull());

    for (const payload of [
      { subject: 'Missing requester' },
      {
        subject: 'External no name',
        requester: { type: 'EXTERNAL', email: 'no-name@example.com' },
      },
      { subject: 'External no contact', requester: { type: 'EXTERNAL', name: 'No Contact' } },
      { subject: 'Internal no membership', requester: { type: 'INTERNAL' } },
      { subject: 'Foreign internal requester', requester: requesterA2 },
      {
        subject: 'Mixed invalid requester',
        requester: { type: 'INTERNAL', membershipId: adminMembershipA1.id, name: 'Stale' },
      },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send(payload)
        .expect(400);
    }

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?search=TKT-000001`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(1);
        expect(response.body.data.items[0].description).toBeUndefined();
      });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?search=printer`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(1));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?priority=URGENT`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.items.map((ticket: { id: string }) => ticket.id)).toContain(
          explicit.body.data.id,
        ),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?statusDefinitionId=${openStatus.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.items.map((ticket: { id: string }) => ticket.id)).toContain(
          explicit.body.data.id,
        ),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?statusDefinitionId=${foreignTicketStatus.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/tickets?search=Printer`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));

    const auditCountBeforeNoop = await prisma.auditLog.count({
      where: { action: { in: ['ticket.updated', 'ticket.status_changed'] } },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'VPN access', priority: 'URGENT', statusDefinitionId: openStatus.id })
      .expect(200);
    await expect(
      prisma.auditLog.count({
        where: { action: { in: ['ticket.updated', 'ticket.status_changed'] } },
      }),
    ).resolves.toBe(auditCountBeforeNoop);

    const beforeImmutablePatch = await prisma.ticket.findUniqueOrThrow({
      where: { id_workspaceId: { id: explicit.body.data.id, workspaceId: workspaceA1 } },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'Should not persist',
        ticketNumber: 'TKT-424242',
        sequenceNumber: 424242,
        workspaceId: workspaceA2,
        createdByMembershipId: beforeImmutablePatch.createdByMembershipId,
      })
      .expect(422);
    await expect(
      prisma.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id: explicit.body.data.id, workspaceId: workspaceA1 } },
        select: {
          subject: true,
          ticketNumber: true,
          sequenceNumber: true,
          workspaceId: true,
          createdByMembershipId: true,
        },
      }),
    ).resolves.toMatchObject({
      subject: beforeImmutablePatch.subject,
      ticketNumber: beforeImmutablePatch.ticketNumber,
      sequenceNumber: beforeImmutablePatch.sequenceNumber,
      workspaceId: beforeImmutablePatch.workspaceId,
      createdByMembershipId: beforeImmutablePatch.createdByMembershipId,
    });

    const beforeInvalidPatch = await prisma.ticket.findUniqueOrThrow({
      where: { id_workspaceId: { id: explicit.body.data.id, workspaceId: workspaceA1 } },
      select: { subject: true, priority: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Partial update must not persist', priority: 'CRITICAL' })
      .expect(422);
    await expect(
      prisma.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id: explicit.body.data.id, workspaceId: workspaceA1 } },
        select: { subject: true, priority: true },
      }),
    ).resolves.toEqual(beforeInvalidPatch);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'VPN access for finance',
        description: null,
        priority: 'LOW',
        statusDefinitionId: inProgressStatus.id,
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.subject).toBe('VPN access for finance');
        expect(response.body.data.description).toBeNull();
        expect(response.body.data.priority).toBe('LOW');
        expect(response.body.data.statusDefinitionId).toBe(inProgressStatus.id);
      });
    await expect(
      prisma.auditLog.findMany({
        where: {
          entityId: explicit.body.data.id,
          action: { in: ['ticket.updated', 'ticket.status_changed'] },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'ticket.updated' }),
        expect.objectContaining({ action: 'ticket.status_changed' }),
      ]),
    );

    await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/status`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: openStatus.id }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/status`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ statusDefinitionId: waitingStatus.id }),
    ]);
    const raced = await prisma.ticket.findUniqueOrThrow({
      where: { id_workspaceId: { id: explicit.body.data.id, workspaceId: workspaceA1 } },
      select: { statusDefinitionId: true },
    });
    expect([openStatus.id, waitingStatus.id]).toContain(raced.statusDefinitionId);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: openStatus.id })
      .expect(200);
    await prisma.statusDefinition.update({
      where: { id: waitingStatus.id },
      data: { isActive: false },
    });
    await prisma.ticket.update({
      where: { id_workspaceId: { id: explicit.body.data.id, workspaceId: workspaceA1 } },
      data: { statusDefinitionId: waitingStatus.id },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.statusDefinitionId).toBe(waitingStatus.id);
        expect(response.body.data.status.active).toBe(false);
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: openStatus.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: waitingStatus.id })
      .expect(400);
    await prisma.statusDefinition.update({
      where: { id: waitingStatus.id },
      data: { isActive: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: resolvedStatus.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: openStatus.id })
      .expect(200);

    for (const method of ['get', 'patch', 'delete'] as const) {
      const attack = request(app.getHttpServer())
        [method](`/api/v1/workspaces/${workspaceA2}/tickets/${first.body.data.id}`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA2));
      if (method === 'patch') attack.send({ subject: 'Cross workspace attack' });
      await attack.expect(404);
    }
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA2}/tickets/${first.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ statusDefinitionId: foreignTicketStatus.id })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceB1}/tickets/${first.body.data.id}`)
      .set(auth(ownerBToken))
      .set(ctx(agencyB, workspaceB1))
      .expect(404);

    const supportDepartment = await prisma.department.create({
      data: { workspaceId: workspaceA1, name: 'Ticket Support', status: DepartmentStatus.ACTIVE },
    });
    const salesDepartment = await prisma.department.create({
      data: { workspaceId: workspaceA1, name: 'Ticket Sales', status: DepartmentStatus.ACTIVE },
    });
    const inactiveDepartment = await prisma.department.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Ticket Inactive',
        status: DepartmentStatus.INACTIVE,
      },
    });
    const foreignDepartment = await prisma.department.create({
      data: {
        workspaceId: workspaceA2,
        name: 'Foreign Ticket Support',
        status: DepartmentStatus.ACTIVE,
      },
    });
    await prisma.workspaceMembership.update({
      where: { id: adminMembershipA1.id },
      data: { departmentId: supportDepartment.id },
    });
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipA1.id },
      data: { departmentId: salesDepartment.id },
    });

    const requesterAuditBeforeNoop = await prisma.auditLog.count({
      where: { action: 'ticket.requester_changed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/requester`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ requester: requesterA1 })
      .expect(200);
    await expect(
      prisma.auditLog.count({ where: { action: 'ticket.requester_changed' } }),
    ).resolves.toBe(requesterAuditBeforeNoop);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/requester`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        requester: {
          type: 'EXTERNAL',
          name: 'Finance Contact',
          email: 'FINANCE@EXAMPLE.COM',
          phone: '+1 555 0123',
        },
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.requester).toMatchObject({
          type: 'EXTERNAL',
          externalEmail: 'finance@example.com',
          externalPhone: '+1 555 0123',
        });
      });
    const requesterAfterExternal = await prisma.ticketRequester.findUniqueOrThrow({
      where: { ticketId: explicit.body.data.id },
      select: { externalName: true, externalEmail: true, externalPhone: true },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/requester`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ requester: { type: 'EXTERNAL', name: 'Invalid Replacement' } })
      .expect(400);
    await expect(
      prisma.ticketRequester.findUniqueOrThrow({
        where: { ticketId: explicit.body.data.id },
        select: { externalName: true, externalEmail: true, externalPhone: true },
      }),
    ).resolves.toEqual(requesterAfterExternal);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/requester`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ requester: requesterA1 })
      .expect(200);
    const requesterAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'ticket.requester_changed', entityId: explicit.body.data.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(requesterAudit.metadata)).not.toContain('finance@example.com');
    expect(JSON.stringify(requesterAudit.metadata)).not.toContain('+1 555 0123');

    const assignmentAuditBeforeNoop = await prisma.auditLog.count({
      where: { action: 'ticket.assignment_changed' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: null, assignedToMembershipId: null })
      .expect(200);
    await expect(
      prisma.auditLog.count({ where: { action: 'ticket.assignment_changed' } }),
    ).resolves.toBe(assignmentAuditBeforeNoop);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: supportDepartment.id, assignedToMembershipId: null })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.department.id).toBe(supportDepartment.id);
        expect(response.body.data.assignedTo).toBeNull();
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: supportDepartment.id, assignedToMembershipId: adminMembershipA1.id })
      .expect(200)
      .expect((response) => expect(response.body.data.assignedTo.id).toBe(adminMembershipA1.id));
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ assignedToMembershipId: null })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.departmentId).toBe(supportDepartment.id);
        expect(response.body.data.assignedTo).toBeNull();
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: null, assignedToMembershipId: null })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.department).toBeNull();
        expect(response.body.data.assignedTo).toBeNull();
      });
    const assignmentRaceResponses = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ departmentId: supportDepartment.id, assignedToMembershipId: adminMembershipA1.id }),
      request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ departmentId: salesDepartment.id, assignedToMembershipId: memberMembershipA1.id }),
    ]);
    expect(assignmentRaceResponses.map((response) => response.status).sort()).toEqual([200, 409]);
    const assignmentAfterRace = await prisma.ticket.findUniqueOrThrow({
      where: { id_workspaceId: { id: explicit.body.data.id, workspaceId: workspaceA1 } },
      select: {
        departmentId: true,
        assignedToMembership: { select: { departmentId: true, status: true } },
      },
    });
    expect(assignmentAfterRace.assignedToMembership?.status).toBe(MembershipStatus.ACTIVE);
    expect(assignmentAfterRace.assignedToMembership?.departmentId).toBe(
      assignmentAfterRace.departmentId,
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: null, assignedToMembershipId: null })
      .expect(200);
    for (const payload of [
      { departmentId: null, assignedToMembershipId: adminMembershipA1.id },
      { departmentId: foreignDepartment.id, assignedToMembershipId: null },
      { departmentId: inactiveDepartment.id, assignedToMembershipId: null },
      { departmentId: supportDepartment.id, assignedToMembershipId: adminMembershipA2.id },
      { departmentId: supportDepartment.id, assignedToMembershipId: memberMembershipA1.id },
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${explicit.body.data.id}/assignment`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send(payload)
        .expect(400);
    }

    const limitedMembershipA1 = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: limitedUserId, workspaceId: workspaceA1 } },
      select: { id: true, roleId: true, departmentId: true },
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { departmentId: supportDepartment.id },
    });
    const scopedTicketViewerRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-scoped-viewer`,
        workspaceId: workspaceA1,
        name: 'Ticket Scoped Viewer',
        nameNormalized: 'ticket scoped viewer',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    const scopedViewPermissions = await prisma.permission.findMany({
      where: { key: { in: ['workspace.read', 'tickets.view'] } },
    });
    await prisma.rolePermission.createMany({
      data: scopedViewPermissions.map((permission) => ({
        roleId: scopedTicketViewerRole.id,
        permissionId: permission.id,
      })),
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: scopedTicketViewerRole.id },
    });
    const [limitedRequesterTicket, limitedDepartmentTicket, limitedHiddenTicket] =
      await Promise.all([
        prisma.ticket.create({
          data: {
            workspaceId: workspaceA1,
            sequenceNumber: 910001,
            ticketNumber: 'TKT-910001',
            subject: 'Limited requester visible',
            statusDefinitionId: openStatus.id,
            priority: 'LOW',
            createdByMembershipId: adminMembershipA1.id,
          },
          select: { id: true },
        }),
        prisma.ticket.create({
          data: {
            workspaceId: workspaceA1,
            sequenceNumber: 910002,
            ticketNumber: 'TKT-910002',
            subject: 'Limited department visible',
            statusDefinitionId: openStatus.id,
            priority: 'LOW',
            departmentId: supportDepartment.id,
            createdByMembershipId: adminMembershipA1.id,
          },
          select: { id: true },
        }),
        prisma.ticket.create({
          data: {
            workspaceId: workspaceA1,
            sequenceNumber: 910003,
            ticketNumber: 'TKT-910003',
            subject: 'Limited creator hidden',
            statusDefinitionId: openStatus.id,
            priority: 'LOW',
            departmentId: salesDepartment.id,
            createdByMembershipId: limitedMembershipA1.id,
          },
          select: { id: true },
        }),
      ]);
    await prisma.ticketRequester.createMany({
      data: [
        {
          workspaceId: workspaceA1,
          ticketId: limitedRequesterTicket.id,
          type: 'INTERNAL',
          internalMembershipId: limitedMembershipA1.id,
        },
        {
          workspaceId: workspaceA1,
          ticketId: limitedDepartmentTicket.id,
          type: 'EXTERNAL',
          externalName: 'Department Caller',
          externalEmail: 'department@example.com',
        },
        {
          workspaceId: workspaceA1,
          ticketId: limitedHiddenTicket.id,
          type: 'EXTERNAL',
          externalName: 'Hidden Caller',
          externalEmail: 'hidden@example.com',
        },
      ],
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?search=Limited&page=1&pageSize=20`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        const subjects = response.body.data.items.map(
          (ticket: { subject: string }) => ticket.subject,
        );
        expect(subjects).toContain('Limited requester visible');
        expect(subjects).toContain('Limited department visible');
        expect(subjects).not.toContain('Limited creator hidden');
        expect(response.body.data.total).toBe(2);
      });
    const hiddenTicket = await prisma.ticket.findFirstOrThrow({
      where: { workspaceId: workspaceA1, subject: 'Limited creator hidden' },
      select: { id: true, ticketNumber: true },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${hiddenTicket.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?search=${hiddenTicket.ticketNumber}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tickets?search=${encodeURIComponent(
          'Limited creator hidden',
        )}`,
      )
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tickets?search=${encodeURIComponent(
          'Limited department visible',
        )}`,
      )
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(1);
        expect(JSON.stringify(response.body.data.items)).not.toContain('department@example.com');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: ' Public reply one ' })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          type: 'PUBLIC_REPLY',
          body: 'Public reply one',
          author: { displayName: 'Admin A', inactive: false },
        });
      });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: '<script>alert("x")</script>' })
      .expect(201);
    await Promise.all(
      Array.from({ length: 5 }, (_value, index) =>
        request(app.getHttpServer())
          .post(
            `/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`,
          )
          .set(auth(adminToken))
          .set(ctx(agencyA, workspaceA1))
          .send({ type: 'INTERNAL_NOTE', body: `Internal note ${index}` })
          .expect(201),
      ),
    );
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(7);
        expect(response.body.data.items.map((entry: { type: string }) => entry.type)).toContain(
          'INTERNAL_NOTE',
        );
      });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(2);
        expect(
          response.body.data.items.every(
            (entry: { type: string }) => entry.type === 'PUBLIC_REPLY',
          ),
        ).toBe(true);
        expect(JSON.stringify(response.body.data)).not.toContain('Internal note');
      });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'No reply permission' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'INTERNAL_NOTE', body: 'No note permission' })
      .expect(403);

    const [
      conversationWorkspaceReadPermission,
      conversationTicketViewPermission,
      ticketReplyPermission,
      ticketNotesViewPermission,
      ticketNotesCreatePermission,
    ] = await Promise.all([
      prisma.permission.findUniqueOrThrow({ where: { key: 'workspace.read' } }),
      prisma.permission.findUniqueOrThrow({ where: { key: 'tickets.view' } }),
      prisma.permission.findUniqueOrThrow({ where: { key: 'tickets.reply' } }),
      prisma.permission.findUniqueOrThrow({ where: { key: 'tickets.notes.view' } }),
      prisma.permission.findUniqueOrThrow({ where: { key: 'tickets.notes.create' } }),
    ]);
    const replyRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-reply-only`,
        workspaceId: workspaceA1,
        name: 'Ticket Reply Only',
        nameNormalized: 'ticket reply only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: replyRole.id, permissionId: conversationWorkspaceReadPermission.id },
        { roleId: replyRole.id, permissionId: conversationTicketViewPermission.id },
        { roleId: replyRole.id, permissionId: ticketReplyPermission.id },
      ],
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: replyRole.id },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Scoped public reply' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'INTERNAL_NOTE', body: 'Still cannot note' })
      .expect(403);

    const notesCreateRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-notes-create-only`,
        workspaceId: workspaceA1,
        name: 'Ticket Notes Create Only',
        nameNormalized: 'ticket notes create only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: notesCreateRole.id, permissionId: conversationWorkspaceReadPermission.id },
        { roleId: notesCreateRole.id, permissionId: conversationTicketViewPermission.id },
        { roleId: notesCreateRole.id, permissionId: ticketNotesCreatePermission.id },
      ],
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: notesCreateRole.id },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'INTERNAL_NOTE', body: 'Create but cannot view' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(3);
        expect(JSON.stringify(response.body.data)).not.toContain('Create but cannot view');
      });

    const notesViewCreateRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-notes-view-create`,
        workspaceId: workspaceA1,
        name: 'Ticket Notes View Create',
        nameNormalized: 'ticket notes view create',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: notesViewCreateRole.id, permissionId: conversationWorkspaceReadPermission.id },
        { roleId: notesViewCreateRole.id, permissionId: conversationTicketViewPermission.id },
        { roleId: notesViewCreateRole.id, permissionId: ticketNotesViewPermission.id },
        { roleId: notesViewCreateRole.id, permissionId: ticketNotesCreatePermission.id },
      ],
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: notesViewCreateRole.id },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(9);
        expect(JSON.stringify(response.body.data)).toContain('Create but cannot view');
      });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedHiddenTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'INTERNAL_NOTE', body: 'Hidden ticket note' })
      .expect(404);
    const latestConversationAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'ticket.internal_note_added', entityId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    expect(JSON.stringify(latestConversationAudit.metadata)).not.toContain(
      'Create but cannot view',
    );
    expect(latestConversationAudit.action).toBe('ticket.internal_note_added');

    await request(app.getHttpServer())
      .patch(
        `/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation/${latestConversationAudit.entityId}`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ body: 'Edited history' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(
        `/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation/${latestConversationAudit.entityId}`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'BANANA', body: 'Unknown type' })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: '   ' })
      .expect(400);
    const maxConversationBody = 'அ'.repeat(12_000);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: maxConversationBody })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.body).toBe(maxConversationBody);
      });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'x'.repeat(12_001) })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        id: '00000000-0000-4000-8000-00000000feed',
        workspaceId: workspaceA2,
        ticketId: limitedHiddenTicket.id,
        authorMembershipId: limitedMembershipA1.id,
        createdAt: '2000-01-01T00:00:00.000Z',
        type: 'PUBLIC_REPLY',
        body: 'Client field injection',
      })
      .expect(422);

    const failedAuditCount = await prisma.auditLog.count({
      where: {
        action: { in: ['ticket.public_reply_added', 'ticket.internal_note_added'] },
        metadata: { path: ['ticketId'], equals: limitedRequesterTicket.id },
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Rejected post audit probe' })
      .expect(403);
    await expect(
      prisma.auditLog.count({
        where: {
          action: { in: ['ticket.public_reply_added', 'ticket.internal_note_added'] },
          metadata: { path: ['ticketId'], equals: limitedRequesterTicket.id },
        },
      }),
    ).resolves.toBe(failedAuditCount);

    const notesViewRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-notes-view-only`,
        workspaceId: workspaceA1,
        name: 'Ticket Notes View Only',
        nameNormalized: 'ticket notes view only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: notesViewRole.id, permissionId: conversationWorkspaceReadPermission.id },
        { roleId: notesViewRole.id, permissionId: conversationTicketViewPermission.id },
        { roleId: notesViewRole.id, permissionId: ticketNotesViewPermission.id },
      ],
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: notesViewRole.id },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.items.map((entry: { type: string }) => entry.type)).toContain(
          'INTERNAL_NOTE',
        );
      });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'INTERNAL_NOTE', body: 'Cannot create with notes view only' })
      .expect(403);

    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: notesCreateRole.id },
    });
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation?page=1&pageSize=2`,
      )
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(4);
        expect(response.body.data.items).toHaveLength(2);
        expect(
          response.body.data.items.every(
            (entry: { type: string }) => entry.type === 'PUBLIC_REPLY',
          ),
        ).toBe(true);
      });
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation?page=2&pageSize=2`,
      )
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(4);
        expect(response.body.data.items).toHaveLength(2);
        expect(
          response.body.data.items.every(
            (entry: { type: string }) => entry.type === 'PUBLIC_REPLY',
          ),
        ).toBe(true);
      });

    const [parallelPublic, parallelInternal] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ type: 'PUBLIC_REPLY', body: 'Concurrent public reply' })
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ type: 'INTERNAL_NOTE', body: 'Concurrent internal note' })
        .expect(201),
    ]);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        const ids = response.body.data.items.map((entry: { id: string }) => entry.id);
        expect(ids).toContain(parallelPublic.body.data.id);
        expect(ids).toContain(parallelInternal.body.data.id);
      });

    const deletedConversationTicket = await prisma.ticket.create({
      data: {
        workspaceId: workspaceA1,
        sequenceNumber: 910099,
        ticketNumber: 'TKT-910099',
        subject: 'Deleted conversation ticket',
        statusDefinitionId: openStatus.id,
        priority: 'LOW',
        createdByMembershipId: adminMembershipA1.id,
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    await request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${workspaceA1}/tickets/${deletedConversationTicket.id}/conversation`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Should not post to deleted ticket' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ type: 'PUBLIC_REPLY', body: 'Cross workspace conversation attack' })
      .expect(404);

    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: notesViewCreateRole.id, status: MembershipStatus.SUSPENDED },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        const historicalNote = response.body.data.items.find(
          (entry: { body: string }) => entry.body === 'Create but cannot view',
        );
        expect(historicalNote.author.inactive).toBe(true);
      });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets/${limitedRequesterTicket.id}/conversation`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ type: 'PUBLIC_REPLY', body: 'Suspended author post' })
      .expect(403);
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: notesViewCreateRole.id, status: MembershipStatus.ACTIVE },
    });

    const assignedScopedTicket = await prisma.ticket.create({
      data: {
        workspaceId: workspaceA1,
        sequenceNumber: 910004,
        ticketNumber: 'TKT-910004',
        subject: 'Limited assignee visible',
        statusDefinitionId: openStatus.id,
        priority: 'LOW',
        departmentId: supportDepartment.id,
        assignedToMembershipId: limitedMembershipA1.id,
        createdByMembershipId: adminMembershipA1.id,
      },
      select: { id: true },
    });
    await prisma.ticketRequester.create({
      data: {
        workspaceId: workspaceA1,
        ticketId: assignedScopedTicket.id,
        type: 'EXTERNAL',
        externalName: 'Assigned Caller',
        externalEmail: 'assigned@example.com',
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${assignedScopedTicket.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { departmentId: salesDepartment.id },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${assignedScopedTicket.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await prisma.workspaceMembership.update({
      where: { id: limitedMembershipA1.id },
      data: { roleId: limitedMembershipA1.roleId, departmentId: limitedMembershipA1.departmentId },
    });

    const limitedMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: limitedUserId, workspaceId: workspaceA1 } },
      select: { id: true, roleId: true },
    });
    const ticketViewerRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-viewer`,
        workspaceId: workspaceA1,
        name: 'Ticket Viewer',
        nameNormalized: 'ticket viewer',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    const ticketViewPermissions = await prisma.permission.findMany({
      where: { key: { in: ['workspace.read', 'tickets.view'] } },
    });
    const workspaceReadPermission = ticketViewPermissions.find(
      (permission) => permission.key === 'workspace.read',
    )!;
    const ticketViewPermission = ticketViewPermissions.find(
      (permission) => permission.key === 'tickets.view',
    )!;
    await prisma.rolePermission.createMany({
      data: ticketViewPermissions.map((permission) => ({
        roleId: ticketViewerRole.id,
        permissionId: permission.id,
      })),
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership.id },
      data: { roleId: ticketViewerRole.id },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Viewer cannot create' })
      .expect(403);

    const ticketCreatePermission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'tickets.create' },
    });
    const ticketUpdatePermission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'tickets.update' },
    });
    const ticketDeletePermission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'tickets.delete' },
    });
    const createOnlyRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-create-only`,
        workspaceId: workspaceA1,
        name: 'Ticket Create Only',
        nameNormalized: 'ticket create only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: createOnlyRole.id, permissionId: workspaceReadPermission.id },
        { roleId: createOnlyRole.id, permissionId: ticketViewPermission.id },
        { roleId: createOnlyRole.id, permissionId: ticketCreatePermission.id },
      ],
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership.id },
      data: { roleId: createOnlyRole.id },
    });
    const createOnlyTicket = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'Create only ticket',
        requester: { type: 'INTERNAL', membershipId: limitedMembership.id },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        subject: 'Create only cannot assign',
        requester: { type: 'INTERNAL', membershipId: limitedMembership.id },
        departmentId: supportDepartment.id,
      })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${createOnlyTicket.body.data.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Creator cannot update without permission' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tickets/${createOnlyTicket.body.data.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);

    const updateOnlyRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-update-only`,
        workspaceId: workspaceA1,
        name: 'Ticket Update Only',
        nameNormalized: 'ticket update only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: updateOnlyRole.id, permissionId: workspaceReadPermission.id },
        { roleId: updateOnlyRole.id, permissionId: ticketViewPermission.id },
        { roleId: updateOnlyRole.id, permissionId: ticketUpdatePermission.id },
      ],
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership.id },
      data: { roleId: updateOnlyRole.id },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${createOnlyTicket.body.data.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Updated by update-only role' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tickets`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Update-only cannot create' })
      .expect(403);

    const deleteOnlyRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:ticket-delete-only`,
        workspaceId: workspaceA1,
        name: 'Ticket Delete Only',
        nameNormalized: 'ticket delete only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: [
        { roleId: deleteOnlyRole.id, permissionId: workspaceReadPermission.id },
        { roleId: deleteOnlyRole.id, permissionId: ticketViewPermission.id },
        { roleId: deleteOnlyRole.id, permissionId: ticketDeletePermission.id },
      ],
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership.id },
      data: { roleId: deleteOnlyRole.id },
    });
    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tickets/${createOnlyTicket.body.data.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership.id },
      data: { roleId: limitedMembership.roleId },
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/workspaces/${workspaceA1}/tickets/${first.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets/${first.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await expect(
      prisma.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id: first.body.data.id, workspaceId: workspaceA1 } },
        select: { deletedAt: true, deletedByMembershipId: true },
      }),
    ).resolves.toMatchObject({
      deletedAt: expect.any(Date),
      deletedByMembershipId: expect.any(String),
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tickets/${first.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ subject: 'Deleted ticket cannot update' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?search=${first.body.data.ticketNumber}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.total).toBe(0));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tickets?priority=HIGH`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(
          response.body.data.items.some(
            (ticket: { id: string }) => ticket.id === first.body.data.id,
          ),
        ).toBe(false),
      );
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

    const limitedMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: limitedUserId, workspaceId: workspaceA1 } },
      select: { id: true, roleId: true },
    });
    const legacyOnlyRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:legacy-project-permissions-only`,
        workspaceId: workspaceA1,
        name: 'Legacy Project Permissions Only',
        nameNormalized: 'legacy project permissions only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    const legacyPermissions = await prisma.permission.findMany({
      where: {
        key: {
          in: [
            'workspace.read',
            'project.read',
            'project.create',
            'project.update',
            'project.delete',
          ],
        },
      },
    });
    await prisma.rolePermission.createMany({
      data: legacyPermissions.map((permission) => ({
        roleId: legacyOnlyRole.id,
        permissionId: permission.id,
      })),
    });
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership.id },
      data: { roleId: legacyOnlyRole.id },
    });
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Legacy Alias Create Bypass' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Legacy Alias Update Bypass' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${created.body.data.id}/status`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: created.body.data.statusDefinitionId })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${created.body.data.id}`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await prisma.workspaceMembership.update({
      where: { id: limitedMembership.id },
      data: { roleId: limitedMembership.roleId },
    });

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

  it('manages project tags, progress, and completion rules tenant-safely', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const activeProjectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT', isDefault: true },
    });
    const completedProjectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT', name: 'Completed' },
    });
    const openTaskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', isDefault: true },
    });
    const completedTaskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', name: 'Completed' },
    });

    const project = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Phase 8.3 Progress Project' })
      .expect(201);
    const projectId = project.body.data.id as string;
    expect(project.body.data.calculatedProgress).toBe(0);
    expect(project.body.data.effectiveProgress).toBe(0);
    expect(project.body.data.taskCounts.totalTasks).toBe(0);

    const activeTag = await prisma.workspaceTag.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Launch',
        nameNormalized: 'launch',
        color: '#2563EB',
        createdById: admin.id,
      },
    });
    const reviewTag = await prisma.workspaceTag.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Review',
        nameNormalized: 'review',
        color: '#16A34A',
        createdById: admin.id,
      },
    });
    const archivedTag = await prisma.workspaceTag.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Archived Only',
        nameNormalized: 'archived only',
        status: 'ARCHIVED',
        createdById: admin.id,
      },
    });
    const foreignTag = await prisma.workspaceTag.create({
      data: {
        workspaceId: workspaceA2,
        name: 'Foreign Project Tag',
        nameNormalized: 'foreign project tag',
        createdById: admin.id,
      },
    });

    const added = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [activeTag.id, reviewTag.id] })
      .expect(201);
    expect(added.body.data).toMatchObject({ requestedCount: 2, changedCount: 2 });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [activeTag.id] })
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({ requestedCount: 1, changedCount: 0 }),
      );
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [archivedTag.id] })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [foreignTag.id] })
      .expect(400);
    const tagCountBeforeRollback = await prisma.projectTag.count({ where: { projectId } });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [activeTag.id, foreignTag.id] })
      .expect(400);
    await expect(prisma.projectTag.count({ where: { projectId } })).resolves.toBe(
      tagCountBeforeRollback,
    );
    const duplicateTag = await prisma.workspaceTag.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Duplicate Race',
        nameNormalized: 'duplicate race',
        createdById: admin.id,
      },
    });
    const duplicateAdds = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ tagIds: [duplicateTag.id] }),
      request(app.getHttpServer())
        .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ tagIds: [duplicateTag.id] }),
    ]);
    expect(duplicateAdds.every((response) => response.status === 201)).toBe(true);
    await expect(
      prisma.projectTag.count({ where: { projectId, tagId: duplicateTag.id } }),
    ).resolves.toBe(1);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tags/${archivedTag.id}/reactivate`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [archivedTag.id] })
      .expect(201);

    await prisma.workspaceTag.update({ where: { id: reviewTag.id }, data: { status: 'ARCHIVED' } });
    const listedTags = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(listedTags.body.data.map((tag: { status: string }) => tag.status)).toEqual(
      expect.arrayContaining(['ACTIVE', 'ARCHIVED']),
    );
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects?tagId=${reviewTag.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.items.map((item: { id: string }) => item.id)).toContain(
          projectId,
        ),
      );
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/remove`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [reviewTag.id] })
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({ requestedCount: 1, changedCount: 1 }),
      );
    const removeAuditBefore = await prisma.auditLog.count({
      where: { entityId: projectId, action: 'project.tag_removed' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/remove`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [reviewTag.id] })
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({ requestedCount: 1, changedCount: 0 }),
      );
    await expect(
      prisma.auditLog.count({ where: { entityId: projectId, action: 'project.tag_removed' } }),
    ).resolves.toBe(removeAuditBefore);

    const completedTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Completed linked task',
        statusDefinitionId: completedTaskStatus.id,
        createdById: admin.id,
      },
    });
    const openTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Open linked task',
        statusDefinitionId: openTaskStatus.id,
        dueAt: new Date('2026-01-01T00:00:00.000Z'),
        createdById: admin.id,
      },
    });
    const deletedTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Soft deleted linked task',
        statusDefinitionId: openTaskStatus.id,
        deletedAt: new Date(),
        createdById: admin.id,
      },
    });
    await prisma.taskProject.createMany({
      data: [completedTask.id, openTask.id, deletedTask.id].map((taskId) => ({
        workspaceId: workspaceA1,
        taskId,
        projectId,
      })),
    });

    const progress = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(progress.body.data.calculatedProgress).toBe(50);
    expect(progress.body.data.effectiveProgress).toBe(50);
    expect(progress.body.data.taskCounts).toMatchObject({
      totalTasks: 2,
      completedTasks: 1,
      openTasks: 1,
      overdueTasks: 1,
    });
    const oneThirdProject = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'One Third Progress Project' })
      .expect(201);
    const twoThirdsProject = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Two Thirds Progress Project' })
      .expect(201);
    const thirdTasks = await Promise.all(
      [
        { title: 'Third completed one', statusDefinitionId: completedTaskStatus.id },
        { title: 'Third completed two', statusDefinitionId: completedTaskStatus.id },
        { title: 'Third open one', statusDefinitionId: openTaskStatus.id },
        { title: 'Third open two', statusDefinitionId: openTaskStatus.id },
      ].map((data) =>
        prisma.task.create({
          data: { workspaceId: workspaceA1, createdById: admin.id, ...data },
        }),
      ),
    );
    await prisma.taskProject.createMany({
      data: [
        { projectId: oneThirdProject.body.data.id, taskId: thirdTasks[0]!.id },
        { projectId: oneThirdProject.body.data.id, taskId: thirdTasks[2]!.id },
        { projectId: oneThirdProject.body.data.id, taskId: thirdTasks[3]!.id },
        { projectId: twoThirdsProject.body.data.id, taskId: thirdTasks[0]!.id },
        { projectId: twoThirdsProject.body.data.id, taskId: thirdTasks[1]!.id },
        { projectId: twoThirdsProject.body.data.id, taskId: thirdTasks[2]!.id },
      ].map((link) => ({ workspaceId: workspaceA1, ...link })),
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${oneThirdProject.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.calculatedProgress).toBe(33));
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${twoThirdsProject.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => expect(response.body.data.calculatedProgress).toBe(67));

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/progress`)
      .set(auth(limitedToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ manualProgressPercent: 75 })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/progress`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ manualProgressPercent: 101 })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/progress`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ manualProgressPercent: -1 })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/progress`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ manualProgressPercent: 10.5 })
      .expect(422);
    const overridden = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/progress`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ manualProgressPercent: 75 })
      .expect(200);
    expect(overridden.body.data.calculatedProgress).toBe(50);
    expect(overridden.body.data.effectiveProgress).toBe(75);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/progress`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ manualProgressPercent: 100 })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.calculatedProgress).toBe(50);
        expect(response.body.data.effectiveProgress).toBe(100);
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedProjectStatus.id })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('PROJECT_HAS_OPEN_TASKS');
        expect(response.body.details).toEqual({ openTaskCount: 1 });
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/progress`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ manualProgressPercent: null })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.manualProgressPercent).toBeNull();
        expect(response.body.data.effectiveProgress).toBe(50);
      });

    await prisma.task.update({
      where: { id: openTask.id },
      data: { statusDefinitionId: completedTaskStatus.id },
    });
    const completedProject = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedProjectStatus.id })
      .expect(200);
    expect(completedProject.body.data.status.terminal).toBe(true);
    await expect(
      prisma.task.findUniqueOrThrow({ where: { id: openTask.id } }),
    ).resolves.toMatchObject({ statusDefinitionId: completedTaskStatus.id });

    await prisma.task.update({
      where: { id: openTask.id },
      data: { statusDefinitionId: openTaskStatus.id },
    });
    const taskReopenedProject = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(taskReopenedProject.body.data.status.terminal).toBe(true);
    expect(taskReopenedProject.body.data.calculatedProgress).toBe(50);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: activeProjectStatus.id })
      .expect(200);
    const reopenedTaskProject = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(reopenedTaskProject.body.data.status.terminal).toBe(false);
    expect(reopenedTaskProject.body.data.calculatedProgress).toBe(50);

    const emptyProject = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Empty Completion Project' })
      .expect(201);
    const emptyCompleted = await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${emptyProject.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedProjectStatus.id })
      .expect(200);
    expect(emptyCompleted.body.data.calculatedProgress).toBe(100);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        title: 'Open task can link terminal project after completion',
        statusDefinitionId: openTaskStatus.id,
        projectIds: [emptyProject.body.data.id],
      })
      .expect(201);
    const terminalTask = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        title: 'Terminal task can link terminal project',
        statusDefinitionId: completedTaskStatus.id,
        projectIds: [emptyProject.body.data.id],
      })
      .expect(201);
    expect(terminalTask.body.data.projects.map((project: { id: string }) => project.id)).toContain(
      emptyProject.body.data.id,
    );
    const replaceOpenTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Replace link open task',
        statusDefinitionId: openTaskStatus.id,
        createdById: admin.id,
      },
    });
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/tasks/${replaceOpenTask.id}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ projectIds: [emptyProject.body.data.id] })
      .expect(200);
  });

  it('integrates Project Tasks through TaskProject without cloning or leaking tenant data', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const openTaskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', isDefault: true },
    });
    const completedTaskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', name: 'Completed' },
    });
    const completedProjectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT', name: 'Completed' },
    });

    const project = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Phase 8.4 Task Project' })
      .expect(201);
    const projectId = project.body.data.id as string;

    const createdInProject = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        title: 'Created inside project',
        statusDefinitionId: openTaskStatus.id,
        projectIds: [projectId],
      })
      .expect(201);
    expect(createdInProject.body.data.projects.map((item: { id: string }) => item.id)).toContain(
      projectId,
    );

    const projectTasks = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?projectId=${projectId}&page=1&pageSize=10`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(projectTasks.body.data.items.map((item: { id: string }) => item.id)).toContain(
      createdInProject.body.data.id,
    );

    const linkOne = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Link one',
        statusDefinitionId: completedTaskStatus.id,
        createdById: admin.id,
      },
    });
    const linkTwo = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Link two',
        statusDefinitionId: openTaskStatus.id,
        createdById: admin.id,
      },
    });
    const linkResult = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [linkOne.id, linkTwo.id] })
      .expect(201);
    expect(linkResult.body.data).toMatchObject({
      requestedCount: 2,
      changedCount: 2,
      unchangedCount: 0,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [linkOne.id] })
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({
          requestedCount: 1,
          changedCount: 0,
          unchangedCount: 1,
        }),
      );

    await expect(
      prisma.taskProject.count({
        where: { workspaceId: workspaceA1, projectId, taskId: linkOne.id },
      }),
    ).resolves.toBe(1);

    const progress = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(progress.body.data.taskCounts.totalTasks).toBe(3);
    expect(progress.body.data.calculatedProgress).toBe(33);

    const foreignTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA2,
        title: 'Foreign task',
        statusDefinitionId: (
          await prisma.statusDefinition.findFirstOrThrow({
            where: { workspaceId: workspaceA2, entityType: 'TASK', isDefault: true },
          })
        ).id,
        createdById: admin.id,
      },
    });
    const beforeForeignBatch = await prisma.taskProject.count({ where: { projectId } });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [linkOne.id, foreignTask.id] })
      .expect(400);
    await expect(prisma.taskProject.count({ where: { projectId } })).resolves.toBe(
      beforeForeignBatch,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks/remove`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [linkOne.id] })
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({
          requestedCount: 1,
          changedCount: 1,
          unchangedCount: 0,
        }),
      );
    await expect(prisma.task.findUnique({ where: { id: linkOne.id } })).resolves.toBeTruthy();
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks/remove`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [linkOne.id] })
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({
          requestedCount: 1,
          changedCount: 0,
          unchangedCount: 1,
        }),
      );

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedProjectStatus.id })
      .expect(400);
    await prisma.task.update({
      where: { id: linkTwo.id },
      data: { statusDefinitionId: completedTaskStatus.id },
    });
    await prisma.task.update({
      where: { id: createdInProject.body.data.id },
      data: { statusDefinitionId: completedTaskStatus.id },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedProjectStatus.id })
      .expect(200);
    const lateOpenTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Late open task',
        statusDefinitionId: openTaskStatus.id,
        createdById: admin.id,
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [lateOpenTask.id] })
      .expect(201);
    const terminalAfterLink = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(terminalAfterLink.body.data.status.terminal).toBe(true);
    expect(terminalAfterLink.body.data.calculatedProgress).toBeLessThan(100);
  });

  it('proves a coherent Phase 8 Project lifecycle across Project, Task, Files, Activity, and Reports APIs', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const ownerMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: admin.id, workspaceId: workspaceA1 } },
    });
    const memberUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'member-a@zeaplay.test' },
    });
    const memberMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: memberUser.id, workspaceId: workspaceA1 } },
    });
    const projectDefaultStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT', isDefault: true },
    });
    const completedProjectStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'PROJECT', name: 'Completed' },
    });
    const openTaskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', isDefault: true },
    });
    const reviewTaskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: {
        workspaceId: workspaceA1,
        entityType: 'TASK',
        isDefault: false,
        isTerminal: false,
        isActive: true,
      },
    });
    const completedTaskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', name: 'Completed' },
    });
    const tag = await prisma.workspaceTag.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Lifecycle',
        nameNormalized: `lifecycle-${Date.now()}`,
        color: '#2563EB',
        createdById: admin.id,
      },
    });

    const project = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: 'Phase 8.9 Lifecycle Project',
        visibility: 'RESTRICTED',
        ownerMembershipId: ownerMembership.id,
        statusDefinitionId: projectDefaultStatus.id,
        memberMembershipIds: [memberMembership.id],
      })
      .expect(201);
    const projectId = project.body.data.id as string;

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceB1}/projects/${projectId}`)
      .set(auth(ownerBToken))
      .set(ctx(agencyB, workspaceB1))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tags/add`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ tagIds: [tag.id] })
      .expect(201);

    const openTask = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        title: 'Lifecycle open task',
        statusDefinitionId: openTaskStatus.id,
        estimatedMinutes: 30,
      })
      .expect(201);
    const completedTask = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        title: 'Lifecycle completed task',
        statusDefinitionId: completedTaskStatus.id,
        estimatedMinutes: 60,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [openTask.body.data.id, completedTask.body.data.id] })
      .expect(201)
      .expect((response) =>
        expect(response.body.data).toMatchObject({
          requestedCount: 2,
          changedCount: 2,
          unchangedCount: 0,
        }),
      );

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.visibility).toBe('RESTRICTED');
        expect(response.body.data.memberCount).toBeGreaterThanOrEqual(1);
        expect(response.body.data.calculatedProgress).toBe(50);
        expect(response.body.data.effectiveProgress).toBe(50);
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${openTask.body.data.id}/kanban-position`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: reviewTaskStatus.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${openTask.body.data.id}/schedule`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        plannedStartAt: '2026-10-01T00:00:00.000Z',
        dueAt: '2026-10-05T00:00:00.000Z',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/attachments/url`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ url: 'https://example.com/lifecycle-brief', displayName: 'Lifecycle Brief' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/attachments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.items).toHaveLength(1);
        expect(response.body.data.items[0].type).toBe(AttachmentType.URL);
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedProjectStatus.id })
      .expect(400);
    await expect(
      prisma.task.findUniqueOrThrow({
        where: { id: openTask.body.data.id },
        select: { statusDefinitionId: true },
      }),
    ).resolves.toMatchObject({ statusDefinitionId: reviewTaskStatus.id });

    const reportBeforeCompletion = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/reports`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(reportBeforeCompletion.body.data.kpis).toMatchObject({
      totalTasks: 2,
      openTasks: 1,
      completedTasks: 1,
      estimatedMinutes: 90,
    });
    expect(reportBeforeCompletion.body.data.progress).toMatchObject({
      calculatedProgress: 50,
      manualProgressPercent: null,
      effectiveProgress: 50,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/tasks/${openTask.body.data.id}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedTaskStatus.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/status`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ statusDefinitionId: completedProjectStatus.id })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status.terminal).toBe(true);
        expect(response.body.data.calculatedProgress).toBe(100);
      });

    await expect(
      prisma.task.findMany({
        where: { id: { in: [openTask.body.data.id, completedTask.body.data.id] } },
        select: { statusDefinitionId: true },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        { statusDefinitionId: completedTaskStatus.id },
        { statusDefinitionId: completedTaskStatus.id },
      ]),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/activity`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        const actions = response.body.data.items.map((item: { action: string }) => item.action);
        expect(actions).toEqual(
          expect.arrayContaining([
            'project.created',
            'project.tag_added',
            'project.task_linked',
            'project.attachment_url_added',
            'project.status_changed',
          ]),
        );
      });
  });

  it('keeps Project membership from becoming Task access or link authority', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const member = await prisma.user.findUniqueOrThrow({
      where: { email: 'member-a@zeaplay.test' },
    });
    const memberMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: member.id, workspaceId: workspaceA1 } },
    });
    const taskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', isDefault: true },
    });

    const restrictedProject = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Restricted task boundary', visibility: 'RESTRICTED' })
      .expect(201);
    const projectId = restrictedProject.body.data.id as string;
    const linkedTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Linked but not visible through project membership',
        statusDefinitionId: taskStatus.id,
        createdById: admin.id,
      },
      select: { id: true },
    });
    await prisma.taskProject.create({
      data: {
        workspaceId: workspaceA1,
        projectId,
        taskId: linkedTask.id,
      },
    });
    await prisma.projectMember.create({
      data: {
        workspaceId: workspaceA1,
        projectId,
        workspaceMembershipId: memberMembership.id,
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?projectId=${projectId}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects/${projectId}/tasks`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ taskIds: [linkedTask.id] })
      .expect(403);
  });

  it('requires Project visibility for Project-filtered Task list and timeline views', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin-a@zeaplay.test' } });
    const member = await prisma.user.findUniqueOrThrow({
      where: { email: 'member-a@zeaplay.test' },
    });
    const memberMembership = await prisma.workspaceMembership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: member.id, workspaceId: workspaceA1 } },
    });
    const taskStatus = await prisma.statusDefinition.findFirstOrThrow({
      where: { workspaceId: workspaceA1, entityType: 'TASK', isDefault: true },
    });
    const permissions = await prisma.permission.findMany({
      where: { key: { in: ['workspace.read', 'tasks.view'] } },
    });
    const tasksOnlyRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:phase8-5-tasks-only`,
        workspaceId: workspaceA1,
        name: 'Phase 8.5 Tasks Only',
        nameNormalized: 'phase 8.5 tasks only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: tasksOnlyRole.id,
        permissionId: permission.id,
      })),
    });
    await prisma.workspaceMembership.update({
      where: { id: memberMembership.id },
      data: { roleId: tasksOnlyRole.id },
    });

    const project = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/projects`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Project filtered task boundary' })
      .expect(201);
    const scheduledTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Project filtered scheduled task',
        statusDefinitionId: taskStatus.id,
        createdById: admin.id,
        plannedStartAt: new Date('2026-01-10T00:00:00.000Z'),
        dueAt: new Date('2026-01-12T00:00:00.000Z'),
      },
      select: { id: true },
    });
    const unscheduledTask = await prisma.task.create({
      data: {
        workspaceId: workspaceA1,
        title: 'Project filtered unscheduled task',
        statusDefinitionId: taskStatus.id,
        createdById: admin.id,
        plannedStartAt: null,
        dueAt: new Date('2026-01-15T00:00:00.000Z'),
      },
      select: { id: true },
    });
    await prisma.taskProject.create({
      data: {
        workspaceId: workspaceA1,
        projectId: project.body.data.id,
        taskId: scheduledTask.id,
      },
    });
    await prisma.taskProject.create({
      data: {
        workspaceId: workspaceA1,
        projectId: project.body.data.id,
        taskId: unscheduledTask.id,
      },
    });

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?projectId=${project.body.data.id}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(0);
        expect(response.body.data.items).toHaveLength(0);
      });
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/gantt?projectId=${project.body.data.id}&from=2026-01-01&to=2026-02-01`,
      )
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(0);
        expect(response.body.data.items).toHaveLength(0);
        expect(response.body.data.unscheduledCount).toBe(0);
        expect(response.body.data.unscheduledItems).toHaveLength(0);
      });
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/gantt?projectId=${project.body.data.id}&from=2026-01-01&to=2026-02-01`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.items.map((item: { id: string }) => item.id)).toContain(
          scheduledTask.id,
        );
        expect(
          response.body.data.unscheduledItems.map((item: { id: string }) => item.id),
        ).toContain(unscheduledTask.id);
        expect(response.body.data.unscheduledCount).toBeGreaterThanOrEqual(1);
      });

    const projectOnlyPermissions = await prisma.permission.findMany({
      where: { key: { in: ['workspace.read', 'projects.view', 'projects.view_all'] } },
    });
    const projectOnlyRole = await prisma.role.create({
      data: {
        key: `workspace:${workspaceA1}:phase8-5-project-only`,
        workspaceId: workspaceA1,
        name: 'Phase 8.5 Project Only',
        nameNormalized: 'phase 8.5 project only',
        scope: RoleScope.WORKSPACE,
        isSystem: false,
      },
    });
    await prisma.rolePermission.createMany({
      data: projectOnlyPermissions.map((permission) => ({
        roleId: projectOnlyRole.id,
        permissionId: permission.id,
      })),
    });
    await prisma.workspaceMembership.update({
      where: { id: memberMembership.id },
      data: { roleId: projectOnlyRole.id },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/projects/${project.body.data.id}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/tasks?projectId=${project.body.data.id}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${workspaceA1}/tasks/gantt?projectId=${project.body.data.id}&from=2026-01-01&to=2026-02-01`,
      )
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
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
    'projects.manage_progress',
    'projects.files.view',
    'projects.files.add',
    'projects.files.remove',
    'projects.files.download',
    'projects.activity.view',
    'projects.reports.view',
    'tickets.view',
    'tickets.view_all',
    'tickets.create',
    'tickets.update',
    'tickets.delete',
    'tickets.assign',
    'tickets.manage_requester',
    'tickets.reply',
    'tickets.notes.view',
    'tickets.notes.create',
    'tickets.sla.view',
    'tickets.sla.manage',
    'tags.view',
    'tags.create',
    'tags.update',
    'tags.archive',
    'tags.assign',
    'tasks.view',
    'tasks.create',
    'tasks.update',
    'tasks.assign',
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
    prisma.projectTag.deleteMany(),
    prisma.projectMember.deleteMany(),
    prisma.ticketSlaState.deleteMany(),
    prisma.ticketSlaPauseStatus.deleteMany(),
    prisma.ticketSlaRule.deleteMany(),
    prisma.ticketSlaPolicy.deleteMany(),
    prisma.ticketConversationEntry.deleteMany(),
    prisma.ticketRequester.deleteMany(),
    prisma.ticket.deleteMany(),
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
    prisma.workspaceTicketCounter.deleteMany(),
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
