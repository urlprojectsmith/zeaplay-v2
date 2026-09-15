import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DepartmentStatus, MembershipStatus, PrismaClient, RoleScope } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PasswordService } from '../src/common/auth/password.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

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

let ownerRoleId!: string;
let adminRoleId!: string;
let managerRoleId!: string;
let memberRoleId!: string;
let agencyUserRoleId!: string;
let usersViewPermissionId!: string;
let usersManagePermissionId!: string;
let departmentsViewPermissionId!: string;
let wildcardPermissionId!: string;

describe('Phase 6.1 users and departments integration', () => {
  let app: INestApplication;
  let agencyA: string;
  let agencyB: string;
  let workspaceA1: string;
  let workspaceA2: string;
  let workspaceB1: string;
  let ownerA: string;
  let memberA: string;
  let memberA2: string;
  let qaUser: string;
  let ownerB: string;
  let adminToken: string;
  let memberToken: string;
  let qaToken: string;
  let limitedAdminToken: string;
  let ownerToken: string;
  let adminMembershipId!: string;
  let limitedAdminMembershipId!: string;
  let memberMembershipId: string;
  let managerMembershipId: string;
  let departmentA1: string;
  let inactiveDepartmentA1: string;
  let departmentB1: string;
  let customRoleA1!: string;
  let customRoleA2!: string;
  let inactiveRoleA1!: string;

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
    memberToken = await accessTokenFor('member-a@zeaplay.test');
    qaToken = await accessTokenFor('qa-a@zeaplay.test');
    limitedAdminToken = await accessTokenFor('limited-admin-a@zeaplay.test');
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    await drainTeardown();
  });

  it('paginates, searches, and filters workspace users server-side', async () => {
    const page = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/users?page=1&pageSize=2&search=member&role=MEMBER`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(page.body.data.total).toBe(1);
    expect(page.body.data.items[0].email).toBe('member-a@zeaplay.test');

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/users?page=1&pageSize=101`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(422);
  });

  it('rejects foreign role and foreign department membership mutation', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ role: 'FOREIGN' })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: departmentB1 })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: inactiveDepartmentA1 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${ownerB}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ role: 'MEMBER' })
      .expect(404);
  });

  it('manages workspace custom roles with tenant-scoped CRUD and cloning', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({
        name: 'QA Lead',
        description: 'Owns test practice.',
        permissionIds: [usersViewPermissionId],
      })
      .expect(201);
    expect(created.body.data.name).toBe('QA Lead');
    expect(created.body.data.isSystem).toBe(false);
    const roleId = created.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: ' qa lead ', permissionIds: [] })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'QA LEAD', permissionIds: [] })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'OWNER', permissionIds: [usersViewPermissionId] })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Wildcard Test', permissionIds: [wildcardPermissionId] })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${roleId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'QA Lead Senior', description: null })
      .expect(200);

    const cloned = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles/${roleId}/clone`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(201);
    expect(cloned.body.data.name).toBe('QA Lead Senior Copy');
    expect(cloned.body.data.permissions.map((item: { id: string }) => item.id)).toContain(
      usersViewPermissionId,
    );
    expect(cloned.body.data.id).not.toBe(roleId);
    expect(cloned.body.data.workspaceId).toBe(workspaceA1);
    expect(cloned.body.data.key).not.toBe('OWNER');
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${cloned.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${cloned.body.data.id}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: true })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${ownerRoleId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Custom Owner' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${ownerRoleId}`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: false })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${ownerRoleId}/permissions`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [usersViewPermissionId] })
      .expect(404);
    for (const systemRoleId of [adminRoleId, managerRoleId, memberRoleId]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/workspaces/${workspaceA1}/roles/${systemRoleId}`)
        .set(auth(adminToken))
        .set(ctx(agencyA, workspaceA1))
        .send({ isActive: false })
        .expect(404);
    }
    const clonedOwner = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles/${ownerRoleId}/clone`)
      .set(auth(ownerToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(201);
    expect(clonedOwner.body.data.key).not.toBe('OWNER');
    expect(clonedOwner.body.data.workspaceId).toBe(workspaceA1);
    expect(
      clonedOwner.body.data.permissions.some(
        (permission: { key: string }) => permission.key === '*',
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ name: 'QA Lead', permissionIds: [usersViewPermissionId] })
      .expect(201);
  });

  it('safely replaces custom role permissions and rejects permission injection', async () => {
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [usersViewPermissionId, usersManagePermissionId] })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [usersViewPermissionId, usersViewPermissionId] })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);

    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [wildcardPermissionId] })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: ['*'] })
      .expect(422);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: ['wildcard', 'wildcard'] })
      .expect(422);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: 'not-an-array' })
      .expect(422);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: Array.from({ length: 64 }, () => usersViewPermissionId) })
      .expect(400);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [usersViewPermissionId, usersManagePermissionId] })
      .expect(200);
    const catalog = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(catalog.body.data.some((permission: { key: string }) => permission.key === '*')).toBe(
      false,
    );

    const unchanged = await prisma.rolePermission.findMany({
      where: { roleId: customRoleA1 },
      select: { permissionId: true },
    });
    expect(unchanged.map((item) => item.permissionId).sort()).toEqual(
      [usersViewPermissionId, usersManagePermissionId].sort(),
    );
  });

  it('propagates custom role permission and membership role changes into authorization', async () => {
    const usersOnlyRole = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Runtime QA Users', permissionIds: [usersViewPermissionId] })
      .expect(201);
    const departmentsOnlyRole = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Runtime QA Departments', permissionIds: [departmentsViewPermissionId] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${qaUser}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: usersOnlyRole.body.data.id })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/users`)
      .set(auth(qaToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/departments`)
      .set(auth(qaToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(qaToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ status: 'SUSPENDED' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${qaUser}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: departmentsOnlyRole.body.data.id })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/users`)
      .set(auth(qaToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/departments`)
      .set(auth(qaToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/api/v1/workspaces/${workspaceA1}/roles/${departmentsOnlyRole.body.data.id}/permissions`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [departmentsViewPermissionId, usersViewPermissionId] })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/users`)
      .set(auth(qaToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/api/v1/workspaces/${workspaceA1}/roles/${departmentsOnlyRole.body.data.id}/permissions`,
      )
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [departmentsViewPermissionId] })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/users`)
      .set(auth(qaToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
  });

  it('blocks cross-workspace, cross-agency, inactive, and self-escalating role attacks', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA2}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA2}/clone`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA2}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Stolen Role' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA2}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: false })
      .expect(404);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA2}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [usersViewPermissionId] })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/roles/${customRoleA1}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyB, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx(agencyA, '00000000-0000-4000-8000-000000000000'))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(adminToken))
      .set(ctx('00000000-0000-4000-8000-000000000000', workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/workspaces/${workspaceA2}/roles/${customRoleA1}/permissions`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ permissionIds: [usersViewPermissionId] })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: customRoleA2 })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: inactiveRoleA1 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: agencyUserRoleId })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: customRoleA1 })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/roles/${customRoleA1}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ isActive: false })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: customRoleA1 })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/memberships/${limitedAdminMembershipId}`)
      .set(auth(limitedAdminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: customRoleA1 })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/memberships/${adminMembershipId}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ roleId: customRoleA1 })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/roles`)
      .set(auth(limitedAdminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Escalation Role', permissionIds: [usersManagePermissionId] })
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceB1}/roles/${customRoleA1}`)
      .set(auth(adminToken))
      .set(ctx(agencyB, workspaceB1))
      .expect(403);
  });

  it('preserves owner safety and blocks suspended membership tenant resolution', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${ownerA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ role: 'MEMBER' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${ownerA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ status: 'SUSPENDED' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ role: 'ADMIN' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ status: 'SUSPENDED' })
      .expect(403);
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.SUSPENDED },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/users`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.ACTIVE },
    });
  });

  it('creates departments and validates manager workspace scope', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Support', managerUserId: memberA })
      .expect(201);
    expect(created.body.data.manager.email).toBe('member-a@zeaplay.test');
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Invalid', managerUserId: ownerA, status: 'ACTIVE' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Bad manager', managerUserId: ownerB })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: 'Inactive Managed', managerUserId: memberA, status: 'INACTIVE' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA1}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ name: ' design ' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA2}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA2))
      .send({ name: 'Design' })
      .expect(201);
  });

  it('hides departments across workspaces and filters by status', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/departments/${departmentB1}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(404);
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA1}/departments?status=ACTIVE&pageSize=1`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(200);
    expect(filtered.body.data.items.length).toBeLessThanOrEqual(1);
  });

  it('blocks cross-agency and cross-workspace user access plus forged route/header combinations', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceB1}/users`)
      .set(auth(memberToken))
      .set(ctx(agencyB, workspaceB1))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceB1}/users/${ownerB}`)
      .set(auth(memberToken))
      .set(ctx(agencyB, workspaceB1))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceB1}/users/${ownerB}/membership`)
      .set(auth(memberToken))
      .set(ctx(agencyB, workspaceB1))
      .send({ role: 'MEMBER' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/users/${memberA2}`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/users`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .expect(403);
  });

  it('clears suspended department managers and records audit events', async () => {
    const managed = await prisma.department.create({
      data: {
        workspaceId: workspaceA1,
        name: 'Managed',
        managerMembershipId,
      },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ status: 'SUSPENDED' })
      .expect(200);
    const cleared = await prisma.department.findUniqueOrThrow({ where: { id: managed.id } });
    expect(cleared.managerMembershipId).toBeNull();
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/departments/${departmentA1}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ managerUserId: memberA })
      .expect(400);
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.ACTIVE },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ role: 'MANAGER', departmentId: departmentA1, status: 'ACTIVE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ departmentId: null })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA1}/departments/${departmentA1}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA1))
      .send({ description: 'Updated', status: 'INACTIVE', managerUserId: null })
      .expect(200);
    const actions = await prisma.auditLog.findMany({
      where: {
        workspaceId: workspaceA1,
        action: {
          in: [
            'workspace.user.suspended',
            'workspace.user.activated',
            'workspace.user.role_changed',
            'workspace.user.department_assigned',
            'workspace.user.department_removed',
            'department.updated',
            'department.status_changed',
            'department.manager_changed',
            'role.created',
            'role.updated',
            'role.cloned',
            'role.activated',
            'role.deactivated',
            'role.permissions_changed',
          ],
        },
      },
      select: { action: true, agencyId: true, workspaceId: true, userId: true, entityId: true },
    });
    for (const action of [
      'workspace.user.suspended',
      'workspace.user.activated',
      'workspace.user.role_changed',
      'workspace.user.department_assigned',
      'workspace.user.department_removed',
      'department.updated',
      'department.status_changed',
      'department.manager_changed',
      'role.created',
      'role.updated',
      'role.cloned',
      'role.activated',
      'role.deactivated',
      'role.permissions_changed',
    ]) {
      expect(actions.some((item) => item.action === action)).toBe(true);
    }
    expect(
      actions.every((item) => item.agencyId === agencyA && item.workspaceId === workspaceA1),
    ).toBe(true);
    expect(actions.every((item) => item.userId && item.entityId)).toBe(true);
  });

  async function seedFixtures() {
    const roles = await seedRoles();
    const [owner, admin, member, secondMember, betaOwner, limitedAdmin, qa] = await Promise.all([
      user('owner-a@zeaplay.test', 'Owner A'),
      user('admin-a@zeaplay.test', 'Admin A'),
      user('member-a@zeaplay.test', 'Member A'),
      user('member-a2@zeaplay.test', 'Member A2'),
      user('owner-b@zeaplay.test', 'Owner B'),
      user('limited-admin-a@zeaplay.test', 'Limited Admin A'),
      user('qa-a@zeaplay.test', 'QA A'),
    ]);
    ownerA = owner.id;
    memberA = member.id;
    memberA2 = secondMember.id;
    qaUser = qa.id;
    ownerB = betaOwner.id;
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
    await agencyMember(secondMember.id, agency.id, roles.AGENCY_USER.id);
    await agencyMember(limitedAdmin.id, agency.id, roles.AGENCY_USER.id);
    await agencyMember(qa.id, agency.id, roles.AGENCY_USER.id);
    await agencyMember(betaOwner.id, beta.id, roles.AGENCY_OWNER.id);
    await workspaceMember(owner.id, wa.id, roles.OWNER.id);
    const adminMembership = await workspaceMember(admin.id, wa.id, roles.ADMIN.id);
    adminMembershipId = adminMembership.id;
    const memberMembership = await workspaceMember(member.id, wa.id, roles.MEMBER.id);
    memberMembershipId = memberMembership.id;
    managerMembershipId = memberMembership.id;
    await workspaceMember(owner.id, wb.id, roles.OWNER.id);
    await workspaceMember(admin.id, wb.id, roles.ADMIN.id);
    await workspaceMember(secondMember.id, wb.id, roles.MEMBER.id);
    await workspaceMember(betaOwner.id, wb1.id, roles.OWNER.id);
    const roleManagerRole = await customRole(wa.id, 'Role Manager', [
      'workspace.read',
      'roles.view',
      'roles.create',
      'roles.update',
      'roles.manage_permissions',
      'users.view',
    ]);
    const limitedMembership = await workspaceMember(limitedAdmin.id, wa.id, roleManagerRole.id);
    limitedAdminMembershipId = limitedMembership.id;
    await workspaceMember(qa.id, wa.id, roles.MEMBER.id);
    customRoleA1 = (await customRole(wa.id, 'Support Lead', ['users.view'])).id;
    customRoleA2 = (await customRole(wb.id, 'Support Lead', ['users.view'])).id;
    inactiveRoleA1 = (await customRole(wa.id, 'Inactive Lead', ['users.view'], false)).id;
    departmentA1 = (
      await prisma.department.create({ data: { workspaceId: wa.id, name: 'Design' } })
    ).id;
    inactiveDepartmentA1 = (
      await prisma.department.create({
        data: { workspaceId: wa.id, name: 'Paused', status: DepartmentStatus.INACTIVE },
      })
    ).id;
    await prisma.department.create({ data: { workspaceId: wb.id, name: 'Sales' } });
    departmentB1 = (
      await prisma.department.create({ data: { workspaceId: wb1.id, name: 'Sales' } })
    ).id;
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { departmentId: departmentA1 },
    });
  }
});

async function seedRoles() {
  const permissions = [
    'agency.read',
    'workspace.read',
    'users.view',
    'users.manage',
    'departments.view',
    'departments.create',
    'departments.update',
    'departments.manage_members',
    'roles.view',
    'roles.create',
    'roles.update',
    'roles.manage_permissions',
    'roles.assign',
    '*',
  ];
  for (const key of permissions) await prisma.permission.create({ data: { key } });
  const roles: Record<string, { id: string }> = {};
  for (const [key, scope, rolePermissions] of [
    ['AGENCY_OWNER', RoleScope.AGENCY, permissions],
    ['AGENCY_ADMIN', RoleScope.AGENCY, permissions],
    ['AGENCY_USER', RoleScope.AGENCY, ['agency.read', 'workspace.read']],
    ['OWNER', RoleScope.WORKSPACE, permissions],
    ['ADMIN', RoleScope.WORKSPACE, permissions],
    ['MANAGER', RoleScope.WORKSPACE, ['workspace.read', 'users.view', 'departments.view']],
    ['MEMBER', RoleScope.WORKSPACE, ['workspace.read', 'users.view', 'departments.view']],
  ] as const) {
    const role = await prisma.role.create({ data: { key, name: key, scope } });
    roles[key] = role;
    if (key === 'OWNER') ownerRoleId = role.id;
    if (key === 'ADMIN') adminRoleId = role.id;
    if (key === 'MANAGER') managerRoleId = role.id;
    if (key === 'MEMBER') memberRoleId = role.id;
    if (key === 'AGENCY_USER') agencyUserRoleId = role.id;
    for (const permissionKey of rolePermissions) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
  usersViewPermissionId = (
    await prisma.permission.findUniqueOrThrow({ where: { key: 'users.view' } })
  ).id;
  usersManagePermissionId = (
    await prisma.permission.findUniqueOrThrow({ where: { key: 'users.manage' } })
  ).id;
  departmentsViewPermissionId = (
    await prisma.permission.findUniqueOrThrow({ where: { key: 'departments.view' } })
  ).id;
  wildcardPermissionId = (await prisma.permission.findUniqueOrThrow({ where: { key: '*' } })).id;
  return roles as Record<
    'AGENCY_OWNER' | 'AGENCY_ADMIN' | 'AGENCY_USER' | 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER',
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
  return prisma.user.create({ data: { email, name, passwordHash: passwords.hash(password) } });
}

async function agencyMember(userId: string, agencyId: string, roleId: string) {
  return prisma.agencyMembership.create({ data: { userId, agencyId, roleId } });
}

async function workspaceMember(userId: string, workspaceId: string, roleId: string) {
  return prisma.workspaceMembership.create({ data: { userId, workspaceId, roleId } });
}

async function customRole(
  workspaceId: string,
  name: string,
  permissionKeys: string[],
  isActive = true,
) {
  const role = await prisma.role.create({
    data: {
      key: `workspace:${workspaceId}:${name.toLowerCase().replace(/\s+/g, '-')}`,
      workspaceId,
      name,
      nameNormalized: name.toLowerCase(),
      scope: RoleScope.WORKSPACE,
      isSystem: false,
      isActive,
    },
  });
  for (const permissionKey of permissionKeys) {
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  }
  return role;
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
