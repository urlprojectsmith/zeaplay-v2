import { randomUUID } from 'node:crypto';
import { AssetLifecycle, AssetStatus, RoleScope, WhiteLabelScopeType } from '@prisma/client';
import { AuditService } from '../src/modules/audit/audit.service';
import { BrandingService } from '../src/modules/branding/branding.service';
import { PLATFORM_BRANDING_SCOPE_ID } from '../src/modules/branding/branding.registry';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import type { StorageAdapter } from '../src/infrastructure/storage/storage-adapter';

jest.setTimeout(90_000);

const createPresignedDownloadUrl = jest.fn((storageKey: string) =>
  Promise.resolve(`https://storage.example.test/${encodeURIComponent(storageKey)}`),
);
const storage = { createPresignedDownloadUrl } as unknown as StorageAdapter;

describe('Phase 18.1 real PostgreSQL Branding integration', () => {
  let prisma: PrismaService;
  let branding: BrandingService;
  let ids: SeedIds;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    prisma = new PrismaService();
    await prisma.$connect();
    branding = new BrandingService(prisma, new AuditService(prisma), storage);
  });

  afterAll(async () => {
    await cleanup(prisma, ids).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ids = makeIds();
    await cleanup(prisma, ids);
    await seedTenant(prisma, ids);
    createPresignedDownloadUrl.mockClear();
  });

  afterEach(async () => {
    await cleanup(prisma, ids);
  });

  it('resolves hierarchy, policy, dormant overrides, same-ID scope safety, assets, revisions, and audit logs', async () => {
    await expect(
      branding.resolveForScope(workspaceScope(ids), { includeSources: true }),
    ).resolves.toMatchObject({
      appName: 'ZeaPlay',
      companyName: 'ZeaPlay',
      primaryColor: '#1F7A68',
      sources: { APP_NAME: 'INHERITED_FROM_PLATFORM' },
    });

    const platform = await branding.updateForScope(platformScope(), actor(ids), {
      expectedRevision: 0,
      appName: 'Platform Brand',
      companyName: 'Platform Company',
      primaryColor: '#123456',
    });
    expect(platform.revision).toBe(1);

    await branding.updateForScope(superAgencyScope(ids), actor(ids), {
      expectedRevision: 0,
      appName: 'Super Brand',
      companyName: 'Super Company',
      primaryColor: '#234567',
      agencyAllowedOverrides: ['APP_NAME', 'PRIMARY_COLOR'],
      workspaceAllowedOverrides: ['APP_NAME', 'PRIMARY_COLOR', 'LOGO'],
    });
    await branding.updateForScope(agencyScope(ids), actor(ids), {
      expectedRevision: 0,
      appName: 'Agency Brand',
      workspaceAllowedOverrides: ['APP_NAME', 'PRIMARY_COLOR', 'LOGO'],
    });
    const workspaceConfig = await branding.updateForScope(workspaceScope(ids), actor(ids), {
      expectedRevision: 0,
      appName: 'Workspace Brand',
      primaryColor: '#345678',
      logo: { assetId: ids.asset, workspaceId: ids.workspace },
    });

    expect(workspaceConfig.revision).toBe(1);
    await expect(
      branding.resolveForScope(workspaceScope(ids), { includeSources: true }),
    ).resolves.toMatchObject({
      appName: 'Workspace Brand',
      companyName: 'Super Company',
      primaryColor: '#345678',
      logo: expect.objectContaining({
        assetId: ids.asset,
        workspaceId: ids.workspace,
        url: expect.stringContaining('branding%2Flogo.png'),
      }),
      sources: {
        APP_NAME: 'OVERRIDDEN_HERE',
        COMPANY_NAME: 'INHERITED_FROM_SUPER_AGENCY',
        PRIMARY_COLOR: 'OVERRIDDEN_HERE',
        LOGO: 'OVERRIDDEN_HERE',
      },
      policy: {
        agencyAllowedOverrides: ['APP_NAME', 'PRIMARY_COLOR'],
        workspaceAllowedOverrides: ['APP_NAME', 'PRIMARY_COLOR', 'LOGO'],
      },
    });

    await expect(
      branding.updateForScope(workspaceScope(ids), actor(ids), {
        expectedRevision: 1,
        supportUrl: 'https://workspace.example.test/help',
      }),
    ).rejects.toMatchObject({ status: 403 });

    await branding.updateForScope(agencyScope(ids), actor(ids), {
      expectedRevision: 1,
      workspaceAllowedOverrides: ['APP_NAME'],
    });
    await expect(
      branding.resolveForScope(workspaceScope(ids), { includeSources: true }),
    ).resolves.toMatchObject({
      primaryColor: '#234567',
      sources: { PRIMARY_COLOR: 'INHERITED_FROM_SUPER_AGENCY' },
      policy: { workspaceAllowedOverrides: ['APP_NAME'] },
    });

    await branding.updateForScope(agencyScope(ids), actor(ids), {
      expectedRevision: 2,
      workspaceAllowedOverrides: ['APP_NAME', 'PRIMARY_COLOR', 'LOGO'],
    });
    await expect(
      branding.resolveForScope(workspaceScope(ids), { includeSources: true }),
    ).resolves.toMatchObject({
      primaryColor: '#345678',
      sources: { PRIMARY_COLOR: 'OVERRIDDEN_HERE' },
      policy: { workspaceAllowedOverrides: ['APP_NAME', 'PRIMARY_COLOR', 'LOGO'] },
    });

    await expect(
      branding.updateForScope(workspaceScope(ids), actor(ids), {
        expectedRevision: 0,
        appName: 'Stale write',
      }),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      branding.updateForScope(workspaceScope(ids), actor(ids), {
        expectedRevision: 1,
        logo: { assetId: ids.foreignAsset, workspaceId: ids.foreignWorkspace },
      }),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      branding.updateForScope(workspaceScope(ids), actor(ids), {
        expectedRevision: 1,
        logo: { assetId: ids.svgAsset, workspaceId: ids.workspace },
      }),
    ).rejects.toMatchObject({ status: 422 });

    const superBrand = await branding.getConfig(superAgencyScope(ids));
    const agencyBrand = await branding.getConfig(agencyScope(ids));
    expect(superBrand.scopeType).toBe(WhiteLabelScopeType.SUPER_AGENCY);
    expect(agencyBrand.scopeType).toBe(WhiteLabelScopeType.AGENCY);
    expect(superBrand.scopeId).toBe(ids.sharedScope);
    expect(agencyBrand.scopeId).toBe(ids.sharedScope);
    expect(superBrand.revision).toBe(1);
    expect(agencyBrand.revision).toBe(3);

    await expect(
      prisma.whiteLabelBranding.count({
        where: { scopeId: ids.sharedScope },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'branding.updated',
          entityType: 'WhiteLabelBranding',
          userId: ids.user,
        },
      }),
    ).resolves.toBe(6);
    expect(createPresignedDownloadUrl).toHaveBeenCalledWith(
      'branding/logo.png',
      expect.any(Number),
    );
  });
});

interface SeedIds {
  run: string;
  short: string;
  user: string;
  roleWorkspace: string;
  roleAgency: string;
  roleSuperAgency: string;
  sharedScope: string;
  workspace: string;
  foreignSuperAgency: string;
  foreignAgency: string;
  foreignWorkspace: string;
  asset: string;
  svgAsset: string;
  foreignAsset: string;
}

function makeIds(): SeedIds {
  const run = randomUUID();
  return {
    run,
    short: run.slice(0, 8),
    user: randomUUID(),
    roleWorkspace: randomUUID(),
    roleAgency: randomUUID(),
    roleSuperAgency: randomUUID(),
    sharedScope: randomUUID(),
    workspace: randomUUID(),
    foreignSuperAgency: randomUUID(),
    foreignAgency: randomUUID(),
    foreignWorkspace: randomUUID(),
    asset: randomUUID(),
    svgAsset: randomUUID(),
    foreignAsset: randomUUID(),
  };
}

function actor(ids: SeedIds) {
  return { id: ids.user, email: `${ids.short}@example.test` };
}

function platformScope() {
  return { type: WhiteLabelScopeType.PLATFORM, id: PLATFORM_BRANDING_SCOPE_ID };
}

function superAgencyScope(ids: SeedIds) {
  return {
    type: WhiteLabelScopeType.SUPER_AGENCY,
    id: ids.sharedScope,
    superAgencyId: ids.sharedScope,
  };
}

function agencyScope(ids: SeedIds) {
  return {
    type: WhiteLabelScopeType.AGENCY,
    id: ids.sharedScope,
    superAgencyId: ids.sharedScope,
    agencyId: ids.sharedScope,
  };
}

function workspaceScope(ids: SeedIds) {
  return {
    type: WhiteLabelScopeType.WORKSPACE,
    id: ids.workspace,
    superAgencyId: ids.sharedScope,
    agencyId: ids.sharedScope,
    workspaceId: ids.workspace,
  };
}

async function seedTenant(prisma: PrismaService, ids: SeedIds) {
  await prisma.user.create({
    data: {
      id: ids.user,
      email: `phase18-${ids.short}@example.test`,
      passwordHash: 'hash',
    },
  });
  await prisma.role.createMany({
    data: [
      {
        id: ids.roleWorkspace,
        key: `p181_workspace_${ids.short}`,
        name: 'Phase 18.1 Workspace',
        scope: RoleScope.WORKSPACE,
      },
      {
        id: ids.roleAgency,
        key: `p181_agency_${ids.short}`,
        name: 'Phase 18.1 Agency',
        scope: RoleScope.AGENCY,
      },
      {
        id: ids.roleSuperAgency,
        key: `p181_super_${ids.short}`,
        name: 'Phase 18.1 Super',
        scope: RoleScope.SUPER_AGENCY,
      },
    ],
  });
  await prisma.superAgency.create({
    data: {
      id: ids.sharedScope,
      name: 'Phase 18.1 Super Agency',
      slug: `p181-super-${ids.short}`,
      createdById: ids.user,
    },
  });
  await prisma.superAgency.create({
    data: {
      id: ids.foreignSuperAgency,
      name: 'Phase 18.1 Foreign Super Agency',
      slug: `p181-super-foreign-${ids.short}`,
      createdById: ids.user,
    },
  });
  await prisma.agency.create({
    data: {
      id: ids.sharedScope,
      superAgencyId: ids.sharedScope,
      name: 'Phase 18.1 Agency',
      slug: `p181-agency-${ids.short}`,
      createdById: ids.user,
    },
  });
  await prisma.agency.create({
    data: {
      id: ids.foreignAgency,
      superAgencyId: ids.foreignSuperAgency,
      name: 'Phase 18.1 Foreign Agency',
      slug: `p181-agency-foreign-${ids.short}`,
      createdById: ids.user,
    },
  });
  await prisma.workspace.create({
    data: {
      id: ids.workspace,
      agencyId: ids.sharedScope,
      name: 'Phase 18.1 Workspace',
      slug: `p181-workspace-${ids.short}`,
      timezone: 'UTC',
      createdById: ids.user,
    },
  });
  await prisma.workspace.create({
    data: {
      id: ids.foreignWorkspace,
      agencyId: ids.foreignAgency,
      name: 'Phase 18.1 Foreign Workspace',
      slug: `p181-workspace-foreign-${ids.short}`,
      timezone: 'UTC',
      createdById: ids.user,
    },
  });
  await prisma.superAgencyMembership.create({
    data: {
      userId: ids.user,
      superAgencyId: ids.sharedScope,
      roleId: ids.roleSuperAgency,
    },
  });
  await prisma.agencyMembership.create({
    data: {
      userId: ids.user,
      agencyId: ids.sharedScope,
      roleId: ids.roleAgency,
    },
  });
  await prisma.workspaceMembership.create({
    data: {
      userId: ids.user,
      workspaceId: ids.workspace,
      roleId: ids.roleWorkspace,
    },
  });
  await prisma.asset.createMany({
    data: [
      asset(ids.asset, ids.workspace, ids.user, 'branding/logo.png', 'image/png', {
        width: 640,
        height: 180,
      }),
      asset(ids.svgAsset, ids.workspace, ids.user, 'branding/logo.svg', 'image/svg+xml', {
        width: 640,
        height: 180,
      }),
      asset(
        ids.foreignAsset,
        ids.foreignWorkspace,
        ids.user,
        'branding/foreign-logo.png',
        'image/png',
        { width: 640, height: 180 },
      ),
    ],
  });
}

function asset(
  id: string,
  workspaceId: string,
  createdById: string,
  storageKey: string,
  mimeType: string,
  metadata: Record<string, number>,
) {
  return {
    id,
    workspaceId,
    createdById,
    originalFilename: storageKey.split('/').at(-1) ?? 'branding.png',
    displayName: storageKey.split('/').at(-1) ?? 'branding.png',
    storageBucket: 'test',
    storageKey,
    mimeType,
    extension: storageKey.split('.').at(-1) ?? 'png',
    sizeBytes: 1024n,
    status: AssetStatus.READY,
    lifecycle: AssetLifecycle.ACTIVE,
    metadata,
    uploadExpiresAt: new Date(Date.now() + 60_000),
  };
}

async function cleanup(prisma: PrismaService, ids: SeedIds | undefined) {
  if (!ids) return;
  await prisma.auditLog.deleteMany({ where: { userId: ids.user } });
  await prisma.whiteLabelBranding.deleteMany({
    where: {
      OR: [
        { scopeType: WhiteLabelScopeType.PLATFORM, scopeId: PLATFORM_BRANDING_SCOPE_ID },
        { scopeId: { in: [ids.sharedScope, ids.workspace] } },
      ],
    },
  });
  await prisma.asset.deleteMany({
    where: { id: { in: [ids.asset, ids.svgAsset, ids.foreignAsset] } },
  });
  await prisma.workspaceMembership.deleteMany({ where: { userId: ids.user } });
  await prisma.agencyMembership.deleteMany({ where: { userId: ids.user } });
  await prisma.superAgencyMembership.deleteMany({ where: { userId: ids.user } });
  await prisma.workspace.deleteMany({
    where: { id: { in: [ids.workspace, ids.foreignWorkspace] } },
  });
  await prisma.agency.deleteMany({ where: { id: { in: [ids.sharedScope, ids.foreignAgency] } } });
  await prisma.superAgency.deleteMany({
    where: { id: { in: [ids.sharedScope, ids.foreignSuperAgency] } },
  });
  await prisma.role.deleteMany({
    where: { id: { in: [ids.roleWorkspace, ids.roleAgency, ids.roleSuperAgency] } },
  });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}
