import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AgencyStatus,
  MembershipStatus,
  PrismaClient,
  RoleScope,
  UserStatus,
  WorkspaceStatus,
} from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PasswordService } from '../src/common/auth/password.service';

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

describe('Phase 4 multi-tenant security integration', () => {
  let app: INestApplication;
  let agencyA: string;
  let agencyB: string;
  let workspaceA: string;
  let workspaceA2: string;
  let workspaceB: string;
  let projectA: string;
  let projectA2: string;
  let assetA: string;
  let uploadingAssetA: string;
  let assetA2: string;
  let userBToken: string;
  let ownerAToken: string;
  let memberAToken: string;
  let adminAToken: string;
  let suspendedToken: string;
  let memberMembershipId: string;
  let memberAgencyMembershipId: string;
  let ownerMembershipId: string;

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
    adminAToken = await accessTokenFor('admin-a@zeaplay.test');
    memberAToken = await accessTokenFor('member-a@zeaplay.test');
    userBToken = await accessTokenFor('user-b@zeaplay.test');
    suspendedToken = await accessTokenFor('suspended@zeaplay.test');
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    await drainTeardown();
  });

  it('rejects cross-workspace project access without leaking existence', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectA}`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectA}`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .send({ name: 'stolen' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectA}`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .expect(404);
  });

  it('rejects cross-tenant agency, workspace, project, and asset attacks', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/agencies/${agencyA}`)
      .set(auth(userBToken))
      .set({ 'x-agency-id': agencyB })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/agencies/${agencyA}`)
      .set(auth(userBToken))
      .set({ 'x-agency-id': agencyB })
      .send({ name: 'stolen' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA}`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA}`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .send({ name: 'stolen' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectA}/assets/${assetA}`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectA}/assets/${assetA}/download`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA}/assets/${uploadingAssetA}/upload-complete`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .send({ sizeBytes: 5 })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${projectA}/assets/${assetA}`)
      .set(auth(userBToken))
      .set(ctx(agencyB, workspaceB))
      .expect(404);
  });

  it('rejects same-agency cross-workspace access for non-agency-admin members', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}`)
      .set(auth(memberAToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectA2}`)
      .set(auth(memberAToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectA2}/assets/${assetA2}`)
      .set(auth(memberAToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(403);
  });

  it('allows agency admins to administratively access workspaces in their agency', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${workspaceA2}`)
      .set(auth(adminAToken))
      .set(ctx(agencyA, workspaceA2))
      .expect(200);
  });

  it('rejects privilege escalation through membership mutations', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA}/memberships/${memberMembershipId}`)
      .set(auth(adminAToken))
      .set(ctx(agencyA, workspaceA))
      .send({ role: 'OWNER' })
      .expect(422);

    await request(app.getHttpServer())
      .patch(`/api/v1/workspaces/${workspaceA}/memberships/${ownerMembershipId}`)
      .set(auth(adminAToken))
      .set(ctx(agencyA, workspaceA))
      .send({ role: 'ADMIN' })
      .expect(403);
  });

  it('denies suspended users, agencies, workspaces, and memberships', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(suspendedToken))
      .set(ctx(agencyA, workspaceA))
      .expect(401);
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.SUSPENDED },
    });
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(memberAToken))
      .set(ctx(agencyA, workspaceA))
      .expect(403);
    await prisma.workspaceMembership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.ACTIVE },
    });
    await prisma.agencyMembership.update({
      where: { id: memberAgencyMembershipId },
      data: { status: MembershipStatus.SUSPENDED },
    });
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(memberAToken))
      .set(ctx(agencyA, workspaceA))
      .expect(403);
    await prisma.agencyMembership.update({
      where: { id: memberAgencyMembershipId },
      data: { status: MembershipStatus.ACTIVE },
    });
    await prisma.workspace.update({
      where: { id: workspaceA },
      data: { status: WorkspaceStatus.SUSPENDED },
    });
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA))
      .expect(403);
    await prisma.workspace.update({
      where: { id: workspaceA },
      data: { status: WorkspaceStatus.ACTIVE },
    });
    await prisma.agency.update({
      where: { id: agencyA },
      data: { status: AgencyStatus.SUSPENDED },
    });
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(ownerAToken))
      .set(ctx(agencyA, workspaceA))
      .expect(403);
    await prisma.agency.update({ where: { id: agencyA }, data: { status: AgencyStatus.ACTIVE } });
  });

  it('rejects forged, missing, and invalid tenant context', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(userBToken))
      .set(ctx(agencyA, workspaceA))
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/projects').set(auth(ownerAToken)).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(ownerAToken))
      .set({ 'x-agency-id': agencyA, 'x-workspace-id': 'not-a-uuid' })
      .expect(422);
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(ownerAToken))
      .set({ 'x-agency-id': agencyA, 'x-workspace-id': workspaceB })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(ownerAToken))
      .set({ 'x-agency-id': agencyB, 'x-workspace-id': workspaceA })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(ownerAToken))
      .set({ 'x-agency-id': '00000000-0000-4000-8000-000000000099', 'x-workspace-id': workspaceA })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set(auth(ownerAToken))
      .set({ 'x-agency-id': agencyA, 'x-workspace-id': '00000000-0000-4000-8000-000000000098' })
      .expect(403);
  });

  it('enforces one agency membership and one workspace membership per user scope', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'member-a@zeaplay.test' } });
    await expect(
      prisma.agencyMembership.create({
        data: { userId: user.id, agencyId: agencyB, roleId: (await role('AGENCY_USER')).id },
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.workspaceMembership.create({
        data: { userId: user.id, workspaceId: workspaceA, roleId: (await role('MEMBER')).id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rotates refresh tokens and rejects reused or revoked refresh tokens', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner-a@zeaplay.test', password })
      .expect(201);
    const cookie = setCookies(login.headers['set-cookie']);
    const csrf = login.body.data.csrfToken as string;
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrf)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set(auth(login.body.data.accessToken))
      .set('Cookie', setCookies(rotated.headers['set-cookie']))
      .set('x-csrf-token', rotated.body.data.csrfToken)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', setCookies(rotated.headers['set-cookie']))
      .set('x-csrf-token', rotated.body.data.csrfToken)
      .expect(401);
  });

  async function seedFixtures() {
    const roles = await seedRoles();
    const [ownerA, adminA, memberA, suspended, userB] = await Promise.all([
      user('owner-a@zeaplay.test', 'Owner A'),
      user('admin-a@zeaplay.test', 'Admin A'),
      user('member-a@zeaplay.test', 'Member A'),
      user('suspended@zeaplay.test', 'Suspended', UserStatus.SUSPENDED),
      user('user-b@zeaplay.test', 'User B'),
    ]);
    const a = await prisma.agency.create({
      data: { name: 'Agency A', slug: 'agency-a', createdById: ownerA.id },
    });
    const b = await prisma.agency.create({
      data: { name: 'Agency B', slug: 'agency-b', createdById: userB.id },
    });
    const wa = await prisma.workspace.create({
      data: { agencyId: a.id, name: 'Workspace A', slug: 'workspace-a', createdById: ownerA.id },
    });
    const wa2 = await prisma.workspace.create({
      data: { agencyId: a.id, name: 'Workspace A2', slug: 'workspace-a2', createdById: ownerA.id },
    });
    const wb = await prisma.workspace.create({
      data: { agencyId: b.id, name: 'Workspace B', slug: 'workspace-b', createdById: userB.id },
    });
    agencyA = a.id;
    agencyB = b.id;
    workspaceA = wa.id;
    workspaceA2 = wa2.id;
    workspaceB = wb.id;
    await agencyMember(ownerA.id, agencyA, roles.AGENCY_OWNER.id);
    await agencyMember(adminA.id, agencyA, roles.AGENCY_ADMIN.id);
    const agencyMembership = await agencyMember(memberA.id, agencyA, roles.AGENCY_USER.id);
    await agencyMember(suspended.id, agencyA, roles.AGENCY_USER.id);
    await agencyMember(userB.id, agencyB, roles.AGENCY_OWNER.id);
    const ownerMembership = await workspaceMember(ownerA.id, workspaceA, roles.OWNER.id);
    const memberMembership = await workspaceMember(memberA.id, workspaceA, roles.MEMBER.id);
    await workspaceMember(ownerA.id, workspaceA2, roles.OWNER.id);
    await workspaceMember(suspended.id, workspaceA, roles.MEMBER.id);
    await workspaceMember(userB.id, workspaceB, roles.OWNER.id);
    ownerMembershipId = ownerMembership.id;
    memberMembershipId = memberMembership.id;
    memberAgencyMembershipId = agencyMembership.id;
    const project = await prisma.project.create({
      data: {
        workspaceId: workspaceA,
        createdById: ownerA.id,
        name: 'Project A',
        status: 'ACTIVE',
      },
    });
    projectA = project.id;
    const secondProject = await prisma.project.create({
      data: {
        workspaceId: workspaceA2,
        createdById: ownerA.id,
        name: 'Project A2',
        status: 'ACTIVE',
      },
    });
    projectA2 = secondProject.id;
    const readyAsset = await asset(workspaceA, projectA, ownerA.id, 'ready.txt', 'READY');
    const uploadingAsset = await asset(
      workspaceA,
      projectA,
      ownerA.id,
      'uploading.txt',
      'UPLOADING',
    );
    const secondAsset = await asset(workspaceA2, projectA2, ownerA.id, 'ready-a2.txt', 'READY');
    assetA = readyAsset.id;
    uploadingAssetA = uploadingAsset.id;
    assetA2 = secondAsset.id;
  }
});

async function seedRoles() {
  const permissions = [
    'agency.read',
    'agency.update',
    'agency.member.read',
    'agency.member.create',
    'agency.member.update',
    'workspace.read',
    'workspace.create',
    'workspace.update',
    'workspace.member.read',
    'workspace.member.create',
    'workspace.member.update',
    'roles.assign',
    'project.read',
    'project.create',
    'project.update',
    'project.delete',
    'asset.read',
    'asset.create',
    'asset.delete',
    'asset.download',
  ];
  for (const key of permissions) await prisma.permission.create({ data: { key } });
  const roles: Record<string, { id: string }> = {};
  const definitions = [
    ['AGENCY_OWNER', RoleScope.AGENCY, permissions],
    ['AGENCY_ADMIN', RoleScope.AGENCY, permissions],
    ['AGENCY_USER', RoleScope.AGENCY, ['agency.read', 'workspace.read']],
    ['OWNER', RoleScope.WORKSPACE, permissions],
    ['ADMIN', RoleScope.WORKSPACE, permissions.filter((key) => key !== 'agency.update')],
    ['MEMBER', RoleScope.WORKSPACE, ['workspace.read', 'project.read']],
  ] as const;
  for (const [key, scope, rolePermissions] of definitions) {
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
    prisma.taskRelatedTask.deleteMany(),
    prisma.taskDependency.deleteMany(),
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

async function user(email: string, name: string, status: UserStatus = UserStatus.ACTIVE) {
  return prisma.user.create({
    data: { email, name, status, passwordHash: passwords.hash(password) },
  });
}

async function agencyMember(userId: string, agencyId: string, roleId: string) {
  return prisma.agencyMembership.create({ data: { userId, agencyId, roleId } });
}

async function workspaceMember(userId: string, workspaceId: string, roleId: string) {
  return prisma.workspaceMembership.create({ data: { userId, workspaceId, roleId } });
}

async function asset(
  workspaceId: string,
  projectId: string,
  createdById: string,
  filename: string,
  status: 'READY' | 'UPLOADING',
) {
  return prisma.asset.create({
    data: {
      workspaceId,
      projectId,
      createdById,
      originalFilename: filename,
      displayName: filename,
      storageBucket: 'zea-play-dev',
      storageKey: `workspace/${workspaceId}/projects/${projectId}/assets/${filename}`,
      mimeType: 'text/plain',
      extension: 'txt',
      sizeBytes: 5,
      status,
      uploadExpiresAt: new Date(Date.now() + 60_000),
    },
  });
}

async function role(key: string) {
  return prisma.role.findUniqueOrThrow({ where: { key } });
}

async function accessTokenFor(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return jwt.sign({ sub: user.id, email: user.email }, accessSecret, {
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

function setCookies(value: string | string[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function drainTeardown() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}
