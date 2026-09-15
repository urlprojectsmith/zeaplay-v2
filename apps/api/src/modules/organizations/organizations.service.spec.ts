import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  it('normalizes organization slugs on create', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'organization-id' });
    const service = new OrganizationsService(
      {
        user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
        role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-id' }) },
        organization: { create },
      } as never,
      {} as never,
      { record: jest.fn() } as never,
    );

    await service.create({ id: 'user-id', email: 'owner@zeaplay.test' }, { name: 'Acme Studio!' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'acme-studio' }),
      }),
    );
  });
});
