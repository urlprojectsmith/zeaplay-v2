import { FeaturesService } from './features.service';

describe('FeaturesService', () => {
  const agencyId = '00000000-0000-4000-8000-000000000001';
  const workspaceId = '00000000-0000-4000-8000-000000000002';

  it.each([
    {
      name: 'platform on, agency on, workspace on',
      defaults: true,
      rows: [row(null, null, true), row(agencyId, null, true), row(agencyId, workspaceId, true)],
      expected: true,
    },
    {
      name: 'platform on, agency on, workspace off',
      defaults: true,
      rows: [row(null, null, true), row(agencyId, null, true), row(agencyId, workspaceId, false)],
      expected: false,
    },
    {
      name: 'platform on, agency off, workspace on',
      defaults: true,
      rows: [row(null, null, true), row(agencyId, null, false), row(agencyId, workspaceId, true)],
      expected: false,
    },
    {
      name: 'platform off, agency on, workspace on',
      defaults: true,
      rows: [row(null, null, false), row(agencyId, null, true), row(agencyId, workspaceId, true)],
      expected: false,
    },
  ])('$name => $expected', async ({ defaults, rows, expected }) => {
    const service = new FeaturesService({
      featureDefinition: {
        findUnique: jest.fn().mockResolvedValue({
          enabledByDefault: defaults,
          entitlements: rows,
        }),
      },
    } as never);

    await expect(service.isEnabled('projects', agencyId, workspaceId)).resolves.toBe(expected);
  });
});

function row(agencyId: string | null, workspaceId: string | null, enabled: boolean) {
  return { agencyId, workspaceId, enabled };
}
