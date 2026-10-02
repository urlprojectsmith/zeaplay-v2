import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AssetLifecycle, AssetStatus, WhiteLabelScopeType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { BrandingService } from './branding.service';
import { PLATFORM_BRANDING_SCOPE_ID } from './branding.registry';

function brandRow(overrides: Record<string, unknown>) {
  return {
    id: `brand-${String(overrides.scopeType)}-${String(overrides.scopeId)}`,
    scopeType: overrides.scopeType,
    scopeId: overrides.scopeId,
    appName: null,
    companyName: null,
    logoAssetId: null,
    logoAssetWorkspaceId: null,
    darkLogoAssetId: null,
    darkLogoAssetWorkspaceId: null,
    faviconAssetId: null,
    faviconAssetWorkspaceId: null,
    loginBackgroundAssetId: null,
    loginBackgroundAssetWorkspaceId: null,
    primaryColor: null,
    accentColor: null,
    supportEmail: null,
    supportUrl: null,
    footerText: null,
    metaDescription: null,
    agencyAllowedOverrides: [],
    workspaceAllowedOverrides: [],
    revision: 1,
    createdById: null,
    updatedById: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function serviceWithPrisma(prisma: Record<string, unknown>) {
  const storage = {
    createPresignedDownloadUrl: jest.fn((key: string) => `https://storage.test/${key}`),
  };
  const audit = { record: jest.fn() } as unknown as AuditService;
  return new BrandingService(prisma as never, audit, storage as never);
}

describe('BrandingService', () => {
  beforeEach(() => {
    process.env.ALLOWED_MIME_TYPES ??= 'image/png,image/jpeg,image/webp,image/x-icon';
    process.env.MINIO_BUCKET ??= 'local';
    process.env.DOWNLOAD_URL_TTL_SECONDS ??= '900';
    process.env.UPLOAD_URL_TTL_SECONDS ??= '600';
    process.env.MAX_UPLOAD_BYTES ??= '26214400';
    process.env.STORAGE_DELETE_GRACE_DAYS ??= '30';
  });

  it('resolves workspace inheritance with field source metadata', async () => {
    const superAgencyId = '11111111-1111-4111-8111-111111111111';
    const agencyId = '22222222-2222-4222-8222-222222222222';
    const workspaceId = '33333333-3333-4333-8333-333333333333';
    const service = serviceWithPrisma({
      workspace: {
        findUnique: jest.fn(() => ({
          id: workspaceId,
          agencyId,
          agency: { superAgencyId },
        })),
      },
      whiteLabelBranding: {
        findMany: jest.fn(() => [
          brandRow({
            scopeType: WhiteLabelScopeType.PLATFORM,
            scopeId: PLATFORM_BRANDING_SCOPE_ID,
            primaryColor: '#2563EB',
          }),
          brandRow({
            scopeType: WhiteLabelScopeType.SUPER_AGENCY,
            scopeId: superAgencyId,
            appName: 'Acme Work',
            agencyAllowedOverrides: ['PRIMARY_COLOR'],
            workspaceAllowedOverrides: ['ACCENT_COLOR'],
          }),
          brandRow({
            scopeType: WhiteLabelScopeType.AGENCY,
            scopeId: agencyId,
            primaryColor: '#DC2626',
          }),
          brandRow({
            scopeType: WhiteLabelScopeType.WORKSPACE,
            scopeId: workspaceId,
            accentColor: '#16A34A',
          }),
        ]),
      },
    });

    const result = (await service.resolveForScope(
      { type: WhiteLabelScopeType.WORKSPACE, id: workspaceId },
      { includeSources: true },
    )) as {
      appName: string;
      primaryColor: string;
      accentColor: string;
      sources: Record<string, string>;
    };

    expect(result.appName).toBe('Acme Work');
    expect(result.primaryColor).toBe('#DC2626');
    expect(result.accentColor).toBe('#16A34A');
    expect(result.sources.APP_NAME).toBe('INHERITED_FROM_SUPER_AGENCY');
    expect(result.sources.PRIMARY_COLOR).toBe('INHERITED_FROM_AGENCY');
    expect(result.sources.ACCENT_COLOR).toBe('OVERRIDDEN_HERE');
  });

  it('ignores a stored child override when ancestor policy disables that field', async () => {
    const superAgencyId = '11111111-1111-4111-8111-111111111111';
    const agencyId = '22222222-2222-4222-8222-222222222222';
    const service = serviceWithPrisma({
      agency: { findUnique: jest.fn(() => ({ id: agencyId, superAgencyId })) },
      whiteLabelBranding: {
        findMany: jest.fn(() => [
          brandRow({
            scopeType: WhiteLabelScopeType.SUPER_AGENCY,
            scopeId: superAgencyId,
            appName: 'Parent Brand',
            agencyAllowedOverrides: ['PRIMARY_COLOR'],
          }),
          brandRow({
            scopeType: WhiteLabelScopeType.AGENCY,
            scopeId: agencyId,
            appName: 'Denied Agency Name',
            primaryColor: '#DC2626',
          }),
        ]),
      },
    });

    const result = (await service.resolveForScope({
      type: WhiteLabelScopeType.AGENCY,
      id: agencyId,
    })) as { appName: string; primaryColor: string };

    expect(result.appName).toBe('Parent Brand');
    expect(result.primaryColor).toBe('#DC2626');
  });

  it('rejects stale branding revisions', async () => {
    const service = serviceWithPrisma({
      whiteLabelBranding: {
        findUnique: jest.fn(() =>
          brandRow({
            revision: 2,
            scopeType: WhiteLabelScopeType.PLATFORM,
            scopeId: PLATFORM_BRANDING_SCOPE_ID,
          }),
        ),
      },
    });

    await expect(
      service.updateForScope(
        service.platformScope(),
        { id: 'user-1', email: 'owner@example.com' },
        { expectedRevision: 1, appName: 'New' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows an agency to re-enable workspace fields still allowed by the super agency', async () => {
    const superAgencyId = '11111111-1111-4111-8111-111111111111';
    const agencyId = '22222222-2222-4222-8222-222222222222';
    const update = jest.fn(() =>
      brandRow({
        scopeType: WhiteLabelScopeType.AGENCY,
        scopeId: agencyId,
        revision: 2,
        workspaceAllowedOverrides: ['APP_NAME', 'LOGO'],
      }),
    );
    const service = serviceWithPrisma({
      agency: { findUnique: jest.fn(() => ({ id: agencyId, superAgencyId })) },
      whiteLabelBranding: {
        findUnique: jest.fn(() =>
          brandRow({
            scopeType: WhiteLabelScopeType.AGENCY,
            scopeId: agencyId,
            revision: 1,
            workspaceAllowedOverrides: ['APP_NAME'],
          }),
        ),
        findMany: jest.fn(() => [
          brandRow({
            scopeType: WhiteLabelScopeType.SUPER_AGENCY,
            scopeId: superAgencyId,
            workspaceAllowedOverrides: ['APP_NAME', 'LOGO'],
          }),
          brandRow({
            scopeType: WhiteLabelScopeType.AGENCY,
            scopeId: agencyId,
            workspaceAllowedOverrides: ['APP_NAME'],
          }),
        ]),
        update,
      },
    });

    await service.updateForScope(
      { type: WhiteLabelScopeType.AGENCY, id: agencyId, superAgencyId, agencyId },
      { id: 'user-1', email: 'owner@example.com' },
      { expectedRevision: 1, workspaceAllowedOverrides: ['APP_NAME', 'LOGO'] },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceAllowedOverrides: ['APP_NAME', 'LOGO'] }),
      }),
    );
  });

  it('rejects unsafe URL, non-hex color, and denied agency field override', async () => {
    const superAgencyId = '11111111-1111-4111-8111-111111111111';
    const agencyId = '22222222-2222-4222-8222-222222222222';
    const service = serviceWithPrisma({
      agency: { findUnique: jest.fn(() => ({ id: agencyId, superAgencyId })) },
      whiteLabelBranding: {
        findUnique: jest.fn(() => null),
        findMany: jest.fn(() => [
          brandRow({
            scopeType: WhiteLabelScopeType.SUPER_AGENCY,
            scopeId: superAgencyId,
            agencyAllowedOverrides: ['PRIMARY_COLOR'],
          }),
        ]),
      },
    });

    await expect(
      service.updateForScope(
        { type: WhiteLabelScopeType.AGENCY, id: agencyId, superAgencyId, agencyId },
        { id: 'user-1', email: 'owner@example.com' },
        { expectedRevision: 0, supportUrl: 'javascript:alert(1)' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.updateForScope(
        { type: WhiteLabelScopeType.AGENCY, id: agencyId, superAgencyId, agencyId },
        { id: 'user-1', email: 'owner@example.com' },
        { expectedRevision: 0, primaryColor: 'rgb(1,2,3)' },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects cross-workspace branding assets', async () => {
    const workspaceId = '33333333-3333-4333-8333-333333333333';
    const otherWorkspaceId = '44444444-4444-4444-8444-444444444444';
    const service = serviceWithPrisma({
      workspace: {
        findUnique: jest.fn(() => ({
          id: workspaceId,
          agencyId: 'agency-1',
          agency: { superAgencyId: 'super-1' },
        })),
      },
      whiteLabelBranding: {
        findUnique: jest.fn(() => null),
        findMany: jest.fn(() => [
          brandRow({
            scopeType: WhiteLabelScopeType.SUPER_AGENCY,
            scopeId: 'super-1',
            workspaceAllowedOverrides: ['LOGO'],
          }),
        ]),
      },
      asset: {
        findUnique: jest.fn(() => ({
          id: '55555555-5555-4555-8555-555555555555',
          workspaceId: otherWorkspaceId,
          mimeType: 'image/png',
          sizeBytes: 1000n,
          status: AssetStatus.READY,
          lifecycle: AssetLifecycle.ACTIVE,
          deletedAt: null,
          displayName: 'logo.png',
          workspace: { agencyId: 'other-agency', agency: { superAgencyId: 'other-super' } },
        })),
      },
    });

    await expect(
      service.updateForScope(
        {
          type: WhiteLabelScopeType.WORKSPACE,
          id: workspaceId,
          workspaceId,
          agencyId: 'agency-1',
          superAgencyId: 'super-1',
        },
        { id: 'user-1', email: 'owner@example.com' },
        {
          expectedRevision: 0,
          logo: {
            assetId: '55555555-5555-4555-8555-555555555555',
            workspaceId: otherWorkspaceId,
          },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects branding assets with unsafe image dimensions', async () => {
    const workspaceId = '33333333-3333-4333-8333-333333333333';
    const service = serviceWithPrisma({
      workspace: {
        findUnique: jest.fn(() => ({
          id: workspaceId,
          agencyId: 'agency-1',
          agency: { superAgencyId: 'super-1' },
        })),
      },
      whiteLabelBranding: {
        findUnique: jest.fn(() => null),
        findMany: jest.fn(() => [
          brandRow({
            scopeType: WhiteLabelScopeType.SUPER_AGENCY,
            scopeId: 'super-1',
            workspaceAllowedOverrides: ['LOGIN_BACKGROUND'],
          }),
        ]),
      },
      asset: {
        findUnique: jest.fn(() => ({
          id: '66666666-6666-4666-8666-666666666666',
          workspaceId,
          mimeType: 'image/png',
          sizeBytes: 1000n,
          status: AssetStatus.READY,
          lifecycle: AssetLifecycle.ACTIVE,
          deletedAt: null,
          displayName: 'background.png',
          metadata: { width: 9000, height: 2000 },
          workspace: { agencyId: 'agency-1', agency: { superAgencyId: 'super-1' } },
        })),
      },
    });

    await expect(
      service.updateForScope(
        {
          type: WhiteLabelScopeType.WORKSPACE,
          id: workspaceId,
          workspaceId,
          agencyId: 'agency-1',
          superAgencyId: 'super-1',
        },
        { id: 'user-1', email: 'owner@example.com' },
        {
          expectedRevision: 0,
          loginBackground: {
            assetId: '66666666-6666-4666-8666-666666666666',
            workspaceId,
          },
        },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
