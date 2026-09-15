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
  let ownerB: string;
  let adminToken: string;
  let memberToken: string;
  let memberMembershipId: string;
  let managerMembershipId: string;
  let departmentA1: string;
  let inactiveDepartmentA1: string;
  let departmentB1: string;

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
    adminToken = await accessTokenFor('admin-a@zeaplay.test');
    memberToken = await accessTokenFor('member-a@zeaplay.test');
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
    const [owner, admin, member, secondMember, betaOwner] = await Promise.all([
      user('owner-a@zeaplay.test', 'Owner A'),
      user('admin-a@zeaplay.test', 'Admin A'),
      user('member-a@zeaplay.test', 'Member A'),
      user('member-a2@zeaplay.test', 'Member A2'),
      user('owner-b@zeaplay.test', 'Owner B'),
    ]);
    ownerA = owner.id;
    memberA = member.id;
    memberA2 = secondMember.id;
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
    await agencyMember(betaOwner.id, beta.id, roles.AGENCY_OWNER.id);
    await workspaceMember(owner.id, wa.id, roles.OWNER.id);
    await workspaceMember(admin.id, wa.id, roles.ADMIN.id);
    const memberMembership = await workspaceMember(member.id, wa.id, roles.MEMBER.id);
    memberMembershipId = memberMembership.id;
    managerMembershipId = memberMembership.id;
    await workspaceMember(owner.id, wb.id, roles.OWNER.id);
    await workspaceMember(admin.id, wb.id, roles.ADMIN.id);
    await workspaceMember(secondMember.id, wb.id, roles.MEMBER.id);
    await workspaceMember(betaOwner.id, wb1.id, roles.OWNER.id);
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
