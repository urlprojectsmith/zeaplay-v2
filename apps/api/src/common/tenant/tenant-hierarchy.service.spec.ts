import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantHierarchyService } from './tenant-hierarchy.service';

describe('TenantHierarchyService', () => {
  const superAgencyId = '00000000-0000-4000-8000-000000000001';
  const otherSuperAgencyId = '00000000-0000-4000-8000-000000000002';
  const agencyId = '00000000-0000-4000-8000-000000000011';
  const otherAgencyId = '00000000-0000-4000-8000-000000000012';
  const workspaceId = '00000000-0000-4000-8000-000000000021';
  const otherWorkspaceId = '00000000-0000-4000-8000-000000000022';

  it('derives Super Agency from Agency', async () => {
    const service = new TenantHierarchyService({
      agency: {
        findUnique: jest.fn().mockResolvedValue({
          id: agencyId,
          superAgency: {
            id: superAgencyId,
            name: 'Super Agency A',
            slug: 'super-a',
            status: 'ACTIVE',
          },
        }),
      },
    } as never);

    await expect(service.getSuperAgencyForAgency(agencyId)).resolves.toMatchObject({
      id: superAgencyId,
    });
  });

  it('derives Agency and Super Agency from Workspace', async () => {
    const service = new TenantHierarchyService({
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: workspaceId,
            agency: {
              id: agencyId,
              name: 'Agency A1',
              slug: 'a1',
              status: 'ACTIVE',
              superAgencyId,
            },
          })
          .mockResolvedValueOnce({
            id: workspaceId,
            agency: {
              superAgency: {
                id: superAgencyId,
                name: 'Super Agency A',
                slug: 'super-a',
                status: 'ACTIVE',
              },
            },
          }),
      },
    } as never);

    await expect(service.getAgencyForWorkspace(workspaceId)).resolves.toMatchObject({
      id: agencyId,
      superAgencyId,
    });
    await expect(service.getSuperAgencyForWorkspace(workspaceId)).resolves.toMatchObject({
      id: superAgencyId,
    });
  });

  it('rejects missing Agency and Workspace hierarchy lookups', async () => {
    const service = new TenantHierarchyService({
      agency: { findUnique: jest.fn().mockResolvedValue(null) },
      workspace: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.getSuperAgencyForAgency(agencyId)).rejects.toThrow(NotFoundException);
    await expect(service.getAgencyForWorkspace(workspaceId)).rejects.toThrow(NotFoundException);
  });

  it('asserts Agency belongs to its actual Super Agency only', async () => {
    const agencyFindFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: agencyId, superAgencyId })
      .mockResolvedValueOnce(null);
    const service = new TenantHierarchyService({
      agency: { findFirst: agencyFindFirst },
    } as never);

    await expect(
      service.assertAgencyBelongsToSuperAgency(agencyId, superAgencyId),
    ).resolves.toEqual({
      id: agencyId,
      superAgencyId,
    });
    await expect(
      service.assertAgencyBelongsToSuperAgency(agencyId, otherSuperAgencyId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('asserts Workspace belongs to its actual Agency only', async () => {
    const workspaceFindFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: workspaceId, agencyId })
      .mockResolvedValueOnce(null);
    const service = new TenantHierarchyService({
      workspace: { findFirst: workspaceFindFirst },
    } as never);

    await expect(service.assertWorkspaceBelongsToAgency(workspaceId, agencyId)).resolves.toEqual({
      id: workspaceId,
      agencyId,
    });
    await expect(
      service.assertWorkspaceBelongsToAgency(workspaceId, otherAgencyId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('asserts Workspace belongs to its actual Super Agency only', async () => {
    const workspaceFindFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: workspaceId, agencyId, agency: { superAgencyId } })
      .mockResolvedValueOnce(null);
    const service = new TenantHierarchyService({
      workspace: { findFirst: workspaceFindFirst },
    } as never);

    await expect(
      service.assertWorkspaceBelongsToSuperAgency(workspaceId, superAgencyId),
    ).resolves.toMatchObject({ id: workspaceId });
    await expect(
      service.assertWorkspaceBelongsToSuperAgency(workspaceId, otherSuperAgencyId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lists Agency and Workspace IDs through bounded relational queries', async () => {
    const service = new TenantHierarchyService({
      agency: {
        findMany: jest.fn().mockResolvedValue([{ id: agencyId }, { id: otherAgencyId }]),
      },
      workspace: {
        findMany: jest.fn().mockResolvedValue([{ id: workspaceId }, { id: otherWorkspaceId }]),
      },
    } as never);

    await expect(service.listAgencyIdsForSuperAgency(superAgencyId)).resolves.toEqual([
      agencyId,
      otherAgencyId,
    ]);
    await expect(service.listWorkspaceIdsForAgency(agencyId)).resolves.toEqual([
      workspaceId,
      otherWorkspaceId,
    ]);
  });
});
