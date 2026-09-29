import { ForbiddenException } from '@nestjs/common';
import { AccountContextService } from './account-context.service';

describe('AccountContextService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists only active Agencies below an authorized Super Agency', async () => {
    const prisma = minimalPrisma({
      agency: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'agency-1',
            superAgencyId: 'super-1',
            name: 'Agency One',
            slug: 'agency-one',
            status: 'ACTIVE',
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    });
    const tenantContext = {
      resolveSuperAgency: jest.fn().mockResolvedValue({ superAgencyId: 'super-1' }),
    };
    const service = new AccountContextService(
      prisma as never,
      tenantContext as never,
      audit() as never,
    );

    const result = await service.listAgencies(user(), {
      superAgencyId: 'super-1',
      page: 1,
      pageSize: 25,
    });

    expect(tenantContext.resolveSuperAgency).toHaveBeenCalledWith('user-1', 'super-1');
    expect(prisma.agency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { superAgencyId: 'super-1', status: 'ACTIVE' },
      }),
    );
    expect(result.items).toEqual([
      {
        id: 'agency-1',
        superAgencyId: 'super-1',
        name: 'Agency One',
        slug: 'agency-one',
        status: 'ACTIVE',
      },
    ]);
  });

  it('switches into an Agency only after server-side tenant validation and audit', async () => {
    const agencyFindUnique = jest.fn().mockResolvedValue({
      id: 'agency-1',
      superAgencyId: 'super-1',
      name: 'Agency One',
      slug: 'agency-one',
      status: 'ACTIVE',
    });
    const prisma = minimalPrisma({
      agency: {
        findUnique: agencyFindUnique,
      },
    });
    const tenantContext = {
      resolveAgency: jest.fn().mockResolvedValue({
        superAgencyId: 'super-1',
        agencyId: 'agency-1',
      }),
    };
    const auditService = audit();
    const service = new AccountContextService(
      prisma as never,
      tenantContext as never,
      auditService as never,
    );

    const result = await service.switchContext(
      user(),
      {
        targetType: 'AGENCY',
        targetId: 'agency-1',
        sourceType: 'SUPER_AGENCY',
        sourceId: 'super-1',
      },
      { ipAddress: '127.0.0.1', userAgent: 'jest' },
    );

    expect(tenantContext.resolveAgency).toHaveBeenCalledWith('user-1', 'agency-1');
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account_context.switch',
        superAgencyId: 'super-1',
        agencyId: 'agency-1',
        userId: 'user-1',
      }),
    );
    expect(result).toMatchObject({
      selectedSuperAgencyId: null,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: null,
    });
    expect(result.agency).not.toHaveProperty('workspaces');
    expect(agencyFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ workspaces: expect.anything() }),
      }),
    );
  });

  it('switches into a Subaccount by resolving its parent Agency before audit', async () => {
    const prisma = minimalPrisma({
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ agencyId: 'agency-1' }),
        findFirst: jest.fn().mockResolvedValue({
          id: 'workspace-1',
          agencyId: 'agency-1',
          name: 'Subaccount One',
          slug: 'subaccount-one',
          timezone: 'UTC',
          status: 'ACTIVE',
        }),
      },
      agency: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'agency-1',
          superAgencyId: 'super-1',
          name: 'Agency One',
          slug: 'agency-one',
          status: 'ACTIVE',
        }),
      },
    });
    const tenantContext = {
      resolveWorkspace: jest.fn().mockResolvedValue({
        superAgencyId: 'super-1',
        agencyId: 'agency-1',
        workspaceId: 'workspace-1',
      }),
    };
    const auditService = audit();
    const service = new AccountContextService(
      prisma as never,
      tenantContext as never,
      auditService as never,
    );

    const result = await service.switchContext(
      user(),
      { targetType: 'WORKSPACE', targetId: 'workspace-1' },
      {},
    );

    expect(tenantContext.resolveWorkspace).toHaveBeenCalledWith(
      'user-1',
      'agency-1',
      'workspace-1',
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'account_context.switch',
        agencyId: 'agency-1',
        workspaceId: 'workspace-1',
      }),
    );
    expect(result.selectedWorkspaceId).toBe('workspace-1');
    expect(result.workspace?.name).toBe('Subaccount One');
  });

  it('does not audit validation-only context restoration after refresh', async () => {
    const prisma = minimalPrisma({
      superAgency: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'super-1',
          name: 'Super One',
          slug: 'super-one',
          status: 'ACTIVE',
        }),
      },
    });
    const tenantContext = {
      resolveSuperAgency: jest.fn().mockResolvedValue({ superAgencyId: 'super-1' }),
    };
    const auditService = audit();
    const service = new AccountContextService(
      prisma as never,
      tenantContext as never,
      auditService as never,
    );

    await expect(
      service.validateContext(user(), { targetType: 'SUPER_AGENCY', targetId: 'super-1' }),
    ).resolves.toMatchObject({ selectedSuperAgencyId: 'super-1' });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('does not audit denied switches to foreign tenant ids', async () => {
    const tenantContext = {
      resolveAgency: jest.fn().mockRejectedValue(new ForbiddenException('Agency access denied.')),
    };
    const auditService = audit();
    const service = new AccountContextService(
      minimalPrisma({}) as never,
      tenantContext as never,
      auditService as never,
    );

    await expect(
      service.switchContext(user(), { targetType: 'AGENCY', targetId: 'agency-foreign' }, {}),
    ).rejects.toThrow(ForbiddenException);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('does not reveal whether a tampered Subaccount id exists when no Agency hint is supplied', async () => {
    const auditService = audit();
    const service = new AccountContextService(
      minimalPrisma({
        workspace: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
          count: jest.fn(),
          findFirst: jest.fn(),
        },
      }) as never,
      { resolveWorkspace: jest.fn() } as never,
      auditService as never,
    );

    await expect(
      service.switchContext(
        user(),
        {
          targetType: 'WORKSPACE',
          targetId: '00000000-0000-4000-8000-0000000000ff',
        },
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

function user() {
  return { id: 'user-1', email: 'owner@zeaplay.test' };
}

function audit() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function minimalPrisma(overrides: Record<string, unknown>) {
  return {
    $transaction: jest.fn((items: Promise<unknown>[]) => Promise.all(items)),
    superAgency: { findUnique: jest.fn() },
    agency: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    workspace: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    ...overrides,
  };
}
