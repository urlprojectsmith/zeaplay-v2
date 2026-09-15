import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MembershipStatus, PrismaClient, RoleScope } from '@prisma/client';
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
  let workspaceA: string;
  let ownerA: string;
  let memberA: string;
  let adminToken: string;
  let memberMembershipId: string;
  let departmentA: string;
  let departmentB: string;

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
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('paginates, searches, and filters workspace users server-side', async () => {
    const page = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA}/users?page=1&pageSize=2&search=member&role=MEMBER`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .expect(200);
    expect(page.body.data.total).toBe(1);
    expect(page.body.data.items[0].email).toBe('member-a@zeaplay.test');
  });

  it('rejects foreign role and foreign department membership mutation', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .send({ role: 'FOREIGN' })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA}/users/${memberA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .send({ departmentId: departmentB })
      .expect(404);
  });

  it('preserves owner safety and blocks suspended membership tenant resolution', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA}/users/${ownerA}/membership`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .send({ role: 'MEMBER' })
      .expect(403);
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.SUSPENDED },
    });
    const memberToken = await accessTokenFor('member-a@zeaplay.test');
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA}/users`)
      .set(auth(memberToken))
      .set(ctx(agencyA, workspaceA))
      .expect(403);
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.ACTIVE },
    });
  });

  it('creates departments and validates manager workspace scope', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .send({ name: 'Support', managerUserId: memberA })
      .expect(201);
    expect(created.body.data.manager.email).toBe('member-a@zeaplay.test');
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .send({ name: 'Invalid', managerUserId: ownerA, status: 'ACTIVE' })
      .expect(201);
    const otherUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'owner-b@zeaplay.test' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceA}/departments`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .send({ name: 'Bad manager', managerUserId: otherUser.id })
      .expect(404);
  });

  it('hides departments across workspaces and filters by status', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA}/departments/${departmentB}`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .expect(404);
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA}/departments?status=ACTIVE&pageSize=1`)
      .set(auth(adminToken))
      .set(ctx(agencyA, workspaceA))
      .expect(200);
    expect(filtered.body.data.items.length).toBeLessThanOrEqual(1);
  });

  async function seedFixtures() {
    const roles = await seedRoles();
    const [owner, admin, member, ownerB] = await Promise.all([
      user('owner-a@zeaplay.test', 'Owner A'),
      user('admin-a@zeaplay.test', 'Admin A'),
      user('member-a@zeaplay.test', 'Member A'),
      user('owner-b@zeaplay.test', 'Owner B'),
    ]);
    ownerA = owner.id;
    memberA = member.id;
    const agency = await prisma.agency.create({
      data: { name: 'Agency A', slug: 'agency-a', createdById: owner.id },
    });
    agencyA = agency.id;
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
    workspaceA = wa.id;
    await agencyMember(owner.id, agency.id, roles.AGENCY_OWNER.id);
    await agencyMember(admin.id, agency.id, roles.AGENCY_ADMIN.id);
    await agencyMember(member.id, agency.id, roles.AGENCY_USER.id);
    await agencyMember(ownerB.id, agency.id, roles.AGENCY_USER.id);
    await workspaceMember(owner.id, wa.id, roles.OWNER.id);
    await workspaceMember(admin.id, wa.id, roles.ADMIN.id);
    memberMembershipId = (await workspaceMember(member.id, wa.id, roles.MEMBER.id)).id;
    await workspaceMember(ownerB.id, wb.id, roles.OWNER.id);
    departmentA = (await prisma.department.create({ data: { workspaceId: wa.id, name: 'Design' } }))
      .id;
    departmentB = (await prisma.department.create({ data: { workspaceId: wb.id, name: 'Sales' } }))
      .id;
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { departmentId: departmentA },
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
    prisma.department.deleteMany(),
    prisma.workspaceMembership.deleteMany(),
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
