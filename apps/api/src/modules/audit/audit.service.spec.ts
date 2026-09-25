import { AuditService, sanitizeAuditMetadata } from './audit.service';

describe('AuditService', () => {
  function buildService() {
    const prisma = {
      workspace: {
        findUnique: jest.fn(),
      },
      agency: {
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };
    return { prisma, service: new AuditService(prisma as never) };
  }

  it('resolves canonical Super Agency and Agency lineage from Workspace audit scope', async () => {
    const { prisma, service } = buildService();
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      agencyId: 'agency-1',
      agency: { superAgencyId: 'super-agency-1' },
    });

    await service.record({
      superAgencyId: 'wrong-super',
      agencyId: 'wrong-agency',
      workspaceId: 'workspace-1',
      userId: 'actor-user',
      action: 'workspace.updated',
      entityType: 'Workspace',
      entityId: 'workspace-1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        superAgencyId: 'super-agency-1',
        agencyId: 'agency-1',
        workspaceId: 'workspace-1',
        userId: 'actor-user',
      }),
    });
    expect(prisma.agency.findUnique).not.toHaveBeenCalled();
  });

  it('resolves Super Agency lineage from Agency audit scope without using Organization authority', async () => {
    const { prisma, service } = buildService();
    prisma.agency.findUnique.mockResolvedValue({ superAgencyId: 'super-agency-1' });

    await service.record({
      organizationId: 'legacy-organization',
      agencyId: 'agency-1',
      userId: 'actor-user',
      action: 'agency.updated',
      entityType: 'Agency',
      entityId: 'agency-1',
    });

    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    expect(prisma.agency.findUnique).toHaveBeenCalledWith({
      where: { id: 'agency-1' },
      select: { superAgencyId: true },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'legacy-organization',
        superAgencyId: 'super-agency-1',
        agencyId: 'agency-1',
      }),
    });
  });

  it('redacts nested secrets, PII, and provider error details before persistence', async () => {
    const { prisma, service } = buildService();
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      agencyId: 'agency-1',
      agency: { superAgencyId: 'super-agency-1' },
    });

    await service.record({
      workspaceId: 'workspace-1',
      userId: 'actor-user',
      action: 'integration.tested',
      entityType: 'IntegrationConnection',
      entityId: 'connection-1',
      metadata: {
        provider: 'GENERIC_REST',
        email: 'target@example.com',
        request: {
          headers: { authorization: 'Bearer live-secret' },
          nested: [{ refreshToken: 'refresh-secret' }],
        },
        providerError: 'authorization: Bearer live-secret',
      },
    });

    const metadata = prisma.auditLog.create.mock.calls[0][0].data.metadata;
    expect(JSON.stringify(metadata)).not.toContain('target@example.com');
    expect(JSON.stringify(metadata)).not.toContain('live-secret');
    expect(JSON.stringify(metadata)).not.toContain('refresh-secret');
    expect(metadata).toMatchObject({
      provider: 'GENERIC_REST',
      email: '[REDACTED_PII]',
      request: {
        headers: { authorization: '[REDACTED]' },
        nested: [{ refreshToken: '[REDACTED]' }],
      },
      providerError: '[REDACTED]',
    });
  });

  it('bounds oversized audit metadata', () => {
    const metadata = sanitizeAuditMetadata({
      ...Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [`blob${index}`, 'x'.repeat(1000)]),
      ),
    });

    expect(metadata).toEqual({
      truncated: true,
      originalByteLength: expect.any(Number),
      reason: 'AUDIT_METADATA_SIZE_LIMIT',
    });
  });

  it('redacts mixed-case secret keys, array entries, signed URLs, and circular objects safely', () => {
    const circular: Record<string, unknown> = {
      AccessToken: 'access-secret',
      ACCESS_TOKEN: 'upper-secret',
      refresh_token: 'refresh-secret',
      authorizationHeader: 'Bearer header-secret',
      client_secret: 'client-secret',
      api_key: 'api-secret',
      signedUrl: 'https://storage.example/file?X-Amz-Signature=signed-secret',
      tokenCount: 42,
      items: [{ token: 'array-secret' }, { nested: { password: 'nested-secret' } }],
    };
    circular.self = circular;

    const metadata = sanitizeAuditMetadata(circular);
    const serialized = JSON.stringify(metadata);

    expect(serialized).not.toContain('access-secret');
    expect(serialized).not.toContain('upper-secret');
    expect(serialized).not.toContain('refresh-secret');
    expect(serialized).not.toContain('header-secret');
    expect(serialized).not.toContain('client-secret');
    expect(serialized).not.toContain('api-secret');
    expect(serialized).not.toContain('signed-secret');
    expect(serialized).not.toContain('array-secret');
    expect(serialized).not.toContain('nested-secret');
    expect(metadata).toMatchObject({
      AccessToken: '[REDACTED]',
      ACCESS_TOKEN: '[REDACTED]',
      refresh_token: '[REDACTED]',
      authorizationHeader: '[REDACTED]',
      client_secret: '[REDACTED]',
      api_key: '[REDACTED]',
      signedUrl: '[REDACTED]',
      tokenCount: 42,
      items: [{ token: '[REDACTED]' }, { nested: { password: '[REDACTED]' } }],
      self: '[CIRCULAR]',
    });
  });
});
