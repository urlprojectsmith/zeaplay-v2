import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AssetStatus, MembershipStatus, PrismaClient, UserStatus } from '@prisma/client';
import { Client as MinioClient } from 'minio';
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import type { Response } from 'supertest';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PasswordService } from '../src/common/auth/password.service';

const passwords = new PasswordService();
const password = 'DevelopmentPassword123!';
let prisma: PrismaClient;
let minio: MinioClient;

jest.setTimeout(30_000);

describe('Phase 2 security integration', () => {
  let app: INestApplication;
  let orgA: string;
  let orgB: string;
  let memberMembershipId: string;
  let ownerToken: string;
  let adminToken: string;
  let memberToken: string;
  let otherOwnerToken: string;
  let suspendedUserId: string;
  let suspendedUserToken: string;

  beforeAll(async () => {
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

    prisma = new PrismaClient();
    minio = new MinioClient({
      endPoint: 'localhost',
      port: 9000,
      useSSL: false,
      accessKey: 'zea-play-dev-minio-access',
      secretKey: 'zea-play-dev-minio-secret-at-least-32-chars',
    });
    await resetDatabase();
    await seedSecurityFixtures();

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
    otherOwnerToken = await accessTokenFor('owner-b@zeaplay.test');
    suspendedUserToken = await accessTokenFor('soon-suspended@zeaplay.test');
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('rotates refresh tokens and rejects reuse of old/revoked tokens', async () => {
    const login = await loginAs('owner-a@zeaplay.test');
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', login.cookie)
      .set('x-csrf-token', login.csrfToken)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', login.cookie)
      .set('x-csrf-token', login.csrfToken)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('authorization', `Bearer ${login.accessToken}`)
      .set('Cookie', cookiesFrom(rotated))
      .set('x-csrf-token', rotated.body.data.csrfToken)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookiesFrom(rotated))
      .set('x-csrf-token', rotated.body.data.csrfToken)
      .expect(401);
  });

  it('does not expose refresh tokens in auth response bodies and requires CSRF for refresh', async () => {
    const login = await loginAs('owner-a@zeaplay.test');
    expect(login.raw.refreshToken).toBeUndefined();

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', login.cookie)
      .expect(401);
  });

  it('rejects incorrect CSRF, missing refresh cookies, malformed refresh cookies, and expired refresh tokens', async () => {
    const login = await loginAs('owner-a@zeaplay.test');

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', login.cookie)
      .set('x-csrf-token', 'incorrect-csrf-token')
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('x-csrf-token', login.csrfToken)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', ['zea_refresh=malformed-refresh-token'])
      .set('x-csrf-token', login.csrfToken)
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', ['zea_refresh=%E0%A4%A'])
      .set('x-csrf-token', login.csrfToken)
      .expect(401);

    const refreshToken = cookieValue(login.cookie, 'zea_refresh');
    await prisma.refreshToken.update({
      where: { tokenHash: sha256(refreshToken) },
      data: { expiresAt: new Date(0) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', login.cookie)
      .set('x-csrf-token', login.csrfToken)
      .expect(401);
  });

  it('prevents cross-tenant project access by ID', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ name: 'Tenant A Project' })
      .expect(201);

    const id = created.body.data.id as string;
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${id}`)
      .set('authorization', `Bearer ${otherOwnerToken}`)
      .set('x-organization-id', orgB)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${id}`)
      .set('authorization', `Bearer ${otherOwnerToken}`)
      .set('x-organization-id', orgB)
      .send({ name: 'Stolen' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${id}`)
      .set('authorization', `Bearer ${otherOwnerToken}`)
      .set('x-organization-id', orgB)
      .expect(404);
  });

  it('rejects forged organization headers without granting tenant context', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('authorization', `Bearer ${otherOwnerToken}`)
      .set('x-organization-id', orgA)
      .expect(403);
  });

  it('rejects missing organization context on tenant endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('authorization', `Bearer ${ownerToken}`)
      .expect(401);
  });

  it('rejects invalid organization context on tenant endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', 'not-a-uuid')
      .expect(422);
  });

  it('rejects member access to admin-only endpoints', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/organizations/${orgA}/memberships`)
      .set('authorization', `Bearer ${memberToken}`)
      .set('x-organization-id', orgA)
      .send({ email: 'owner-b@zeaplay.test', role: 'MEMBER' })
      .expect(403);
  });

  it('rejects admin promotion to owner', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/organizations/${orgA}/memberships/${memberMembershipId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('x-organization-id', orgA)
      .send({ role: 'OWNER' })
      .expect(403);
  });

  it('rejects admin access to owner-only membership deletion', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/organizations/${orgA}/memberships/${memberMembershipId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('x-organization-id', orgA)
      .expect(403);
  });

  it('rejects access tokens after the user is suspended', async () => {
    await prisma.user.update({
      where: { id: suspendedUserId },
      data: { status: UserStatus.SUSPENDED },
    });

    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('authorization', `Bearer ${suspendedUserToken}`)
      .set('x-organization-id', orgA)
      .expect(401);
  });

  it('rejects access tokens for users that no longer exist', async () => {
    const token = jwt.sign(
      { sub: randomUUID(), email: 'deleted-user@zeaplay.test' },
      'test-access-secret-at-least-32-characters',
      {
        algorithm: 'HS256',
        expiresIn: 900,
        issuer: 'zea-play-api',
        audience: 'zea-play-web',
        jwtid: randomUUID(),
      },
    );

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects tenant access when the organization is suspended', async () => {
    await prisma.organization.update({ where: { id: orgB }, data: { status: 'SUSPENDED' } });

    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('authorization', `Bearer ${otherOwnerToken}`)
      .set('x-organization-id', orgB)
      .expect(403);

    await prisma.organization.update({ where: { id: orgB }, data: { status: 'ACTIVE' } });
  });

  it('protects asset operations from cross-tenant access and BOLA', async () => {
    const projectA = await createProject(orgA, 'Asset A Project');
    const projectB = await createProject(orgB, 'Asset B Project');
    const asset = await createReadyAsset(orgA, projectA.id);

    for (const method of ['get', 'delete'] as const) {
      await request(app.getHttpServer())
        [method](`/api/v1/projects/${projectA.id}/assets/${asset.id}`)
        .set('authorization', `Bearer ${otherOwnerToken}`)
        .set('x-organization-id', orgB)
        .expect(404);
    }

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectA.id}/assets/${asset.id}/download`)
      .set('authorization', `Bearer ${otherOwnerToken}`)
      .set('x-organization-id', orgB)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectA.id}/assets/${asset.id}/upload-complete`)
      .set('authorization', `Bearer ${otherOwnerToken}`)
      .set('x-organization-id', orgB)
      .send({ sizeBytes: 5 })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectB.id}/assets/${asset.id}`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .expect(404);
  });

  it('validates upload init input and rejects unsafe files', async () => {
    const project = await createProject(orgA, 'Validation Project');
    for (const filename of [
      '../secret.txt',
      '..\\secret.txt',
      'nested/file.txt',
      'nested\\file.txt',
      '%2e%2e%2fsecret.txt',
      '%252e%252e%252fsecret.txt',
      'null\u0000byte.txt',
      'unicode\u2215separator.txt',
      'unicode\u2044separator.txt',
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${project.id}/assets/upload-init`)
        .set('authorization', `Bearer ${ownerToken}`)
        .set('x-organization-id', orgA)
        .send({ filename, mimeType: 'text/plain', sizeBytes: 5 })
        .expect(422);
    }

    const valid = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/upload-init`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ filename: `${'a'.repeat(240)}.txt`, mimeType: 'text/plain', sizeBytes: 5 })
      .expect(201);
    const validAsset = await prisma.asset.findUniqueOrThrow({
      where: { id: valid.body.data.asset.id },
    });
    expect(validAsset.storageKey).toMatch(
      new RegExp(
        `^organizations/${orgA}/projects/${project.id}/assets/${validAsset.id}/asset.txt$`,
      ),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/upload-init`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ filename: 'empty.txt', mimeType: 'text/plain', sizeBytes: 0 })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/upload-init`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ filename: 'large.txt', mimeType: 'text/plain', sizeBytes: 2048 })
      .expect(413);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/upload-init`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ filename: 'script.html', mimeType: 'text/html', sizeBytes: 5 })
      .expect(422);
  });

  it('rejects upload completion before object exists or with mismatched stored size', async () => {
    const project = await createProject(orgA, 'Storage Validation Project');
    const missing = await createUploadingAsset(orgA, project.id);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/${missing.id}/upload-complete`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ sizeBytes: 5 })
      .expect(503);

    const mismatched = await createUploadingAsset(orgA, project.id);
    await minio.putObject('zea-play-dev', mismatched.storageKey, Buffer.from('hello!'));
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/${mismatched.id}/upload-complete`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ sizeBytes: 5 })
      .expect(400);
  });

  it('makes upload completion idempotent and prevents duplicate processing jobs', async () => {
    const project = await createProject(orgA, 'Upload Complete Project');
    const init = await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/upload-init`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ filename: 'hello.txt', mimeType: 'text/plain', sizeBytes: 5 })
      .expect(201);
    const assetId = init.body.data.asset.id as string;
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    await minio.putObject('zea-play-dev', asset.storageKey, Buffer.from('hello'));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/${assetId}/upload-complete`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ sizeBytes: 5 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/${assetId}/upload-complete`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ sizeBytes: 5 })
      .expect(201);

    await expect(
      prisma.processingJob.count({ where: { assetId, type: 'asset.metadata' } }),
    ).resolves.toBe(1);
  });

  it('rejects expired upload state, archived projects, and deleted assets', async () => {
    const project = await createProject(orgA, 'State Project');
    const asset = await createUploadingAsset(orgA, project.id, { uploadExpiresAt: new Date(0) });
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/${asset.id}/upload-complete`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ sizeBytes: 5 })
      .expect(410);

    await prisma.project.update({ where: { id: project.id }, data: { status: 'ARCHIVED' } });
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/assets/upload-init`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .send({ filename: 'after.txt', mimeType: 'text/plain', sizeBytes: 5 })
      .expect(404);

    const activeProject = await createProject(orgA, 'Deleted Asset Project');
    const deletedAsset = await createUploadingAsset(orgA, activeProject.id, {
      status: AssetStatus.DELETED,
    });
    await prisma.asset.update({ where: { id: deletedAsset.id }, data: { deletedAt: new Date() } });
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${activeProject.id}/assets/${deletedAsset.id}`)
      .set('authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgA)
      .expect(404);
  });

  it('rejects suspended membership tenant access', async () => {
    await prisma.membership.update({
      where: { id: memberMembershipId },
      data: { status: MembershipStatus.SUSPENDED },
    });

    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('authorization', `Bearer ${memberToken}`)
      .set('x-organization-id', orgA)
      .expect(403);
  });

  async function loginAs(email: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const csrfToken = response.body.data.csrfToken as string;
    return {
      raw: response.body.data as { accessToken: string; refreshToken?: string; csrfToken: string },
      accessToken: response.body.data.accessToken as string,
      csrfToken,
      cookie: cookiesFrom(response),
    };
  }

  async function accessTokenFor(email: string) {
    return (await loginAs(email)).accessToken;
  }

  async function seedSecurityFixtures() {
    const permissionKeys = [
      'organization.read',
      'organization.update',
      'member.read',
      'member.create',
      'member.update',
      'member.delete',
      'project.read',
      'project.create',
      'project.update',
      'project.delete',
      'asset.read',
      'asset.create',
      'asset.delete',
      'asset.download',
    ];
    for (const key of permissionKeys) {
      await prisma.permission.create({ data: { key } });
    }
    const permissions = await prisma.permission.findMany();
    const owner = await createRole(
      'OWNER',
      permissions.map((item) => item.id),
    );
    const admin = await createRole(
      'ADMIN',
      permissions.filter((item) => item.key !== 'member.delete').map((item) => item.id),
    );
    const member = await createRole(
      'MEMBER',
      permissions
        .filter((item) => ['organization.read', 'member.read', 'project.read'].includes(item.key))
        .map((item) => item.id),
    );
    const hash = passwords.hash(password);
    const ownerA = await prisma.user.create({
      data: { email: 'owner-a@zeaplay.test', passwordHash: hash },
    });
    const adminA = await prisma.user.create({
      data: { email: 'admin-a@zeaplay.test', passwordHash: hash },
    });
    const memberA = await prisma.user.create({
      data: { email: 'member-a@zeaplay.test', passwordHash: hash },
    });
    const soonSuspended = await prisma.user.create({
      data: { email: 'soon-suspended@zeaplay.test', passwordHash: hash },
    });
    const ownerB = await prisma.user.create({
      data: { email: 'owner-b@zeaplay.test', passwordHash: hash },
    });
    suspendedUserId = soonSuspended.id;
    const a = await prisma.organization.create({ data: { name: 'Tenant A', slug: 'tenant-a' } });
    const b = await prisma.organization.create({ data: { name: 'Tenant B', slug: 'tenant-b' } });
    orgA = a.id;
    orgB = b.id;
    await prisma.membership.create({
      data: { userId: ownerA.id, organizationId: orgA, roleId: owner.id },
    });
    await prisma.membership.create({
      data: { userId: ownerA.id, organizationId: orgB, roleId: member.id },
    });
    await prisma.membership.create({
      data: { userId: adminA.id, organizationId: orgA, roleId: admin.id },
    });
    const memberMembership = await prisma.membership.create({
      data: { userId: memberA.id, organizationId: orgA, roleId: member.id },
    });
    memberMembershipId = memberMembership.id;
    await prisma.membership.create({
      data: { userId: soonSuspended.id, organizationId: orgA, roleId: member.id },
    });
    await prisma.membership.create({
      data: { userId: ownerB.id, organizationId: orgB, roleId: owner.id },
    });
  }

  async function createRole(name: string, permissionIds: string[]) {
    const role = await prisma.role.create({ data: { name } });
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
    });
    return role;
  }
});

function cookiesFrom(response: Response) {
  const value = response.headers['set-cookie'];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function cookieValue(cookies: string[], name: string) {
  const match = cookies
    .flatMap((cookie) => cookie.split(';'))
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith(`${name}=`));
  if (!match) throw new Error(`Missing cookie ${name}.`);
  return decodeURIComponent(match.slice(name.length + 1));
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function resetDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.processingJob.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.project.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
}

async function createProject(organizationId: string, name: string) {
  const user = await prisma.membership.findFirstOrThrow({ where: { organizationId } });
  return prisma.project.create({
    data: { organizationId, createdById: user.userId, name, status: 'ACTIVE' },
  });
}

async function createReadyAsset(organizationId: string, projectId: string) {
  return createUploadingAsset(organizationId, projectId, { status: AssetStatus.READY });
}

async function createUploadingAsset(
  organizationId: string,
  projectId: string,
  overrides: Partial<{ status: AssetStatus; uploadExpiresAt: Date }> = {},
) {
  const user = await prisma.membership.findFirstOrThrow({ where: { organizationId } });
  const id = randomUUID();
  return prisma.asset.create({
    data: {
      id,
      organizationId,
      projectId,
      createdById: user.userId,
      originalFilename: 'hello.txt',
      displayName: 'hello.txt',
      storageBucket: 'zea-play-dev',
      storageKey: `organizations/${organizationId}/projects/${projectId}/assets/${id}/asset.txt`,
      mimeType: 'text/plain',
      extension: 'txt',
      sizeBytes: 5,
      status: overrides.status ?? AssetStatus.UPLOADING,
      uploadExpiresAt: overrides.uploadExpiresAt ?? new Date(Date.now() + 60_000),
    },
  });
}
