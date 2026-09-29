import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiAccessToken, setApiTenantContext } from '../services/api';
import { useSessionStore } from '../stores/session';

describe('account context session persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'zea_csrf=; Max-Age=0; path=/';
    vi.unstubAllGlobals();
    setApiAccessToken(null);
    setApiTenantContext(null, null);
    useSessionStore.setState({
      accessToken: null,
      csrfToken: null,
      user: null,
      superAgencies: [],
      agencies: [],
      selectedSuperAgencyId: null,
      selectedAgencyId: null,
      selectedWorkspaceId: null,
      hydrated: false,
    });
  });

  it('revalidates and restores a parent-switched Agency after refresh', async () => {
    document.cookie = 'zea_csrf=csrf-token; path=/';
    useSessionStore.setState({ selectedAgencyId: 'agency-child' });
    vi.stubGlobal(
      'fetch',
      fetchMock({
        validate: {
          targetType: 'AGENCY',
          targetId: 'agency-child',
          selectedSuperAgencyId: null,
          selectedAgencyId: 'agency-child',
          selectedWorkspaceId: null,
          superAgencyId: 'super-1',
          agencyId: 'agency-child',
          workspaceId: null,
          superAgency: null,
          agency: {
            id: 'agency-child',
            superAgencyId: 'super-1',
            name: 'Child Agency',
            slug: 'child-agency',
            status: 'ACTIVE',
            workspaces: [],
          },
          workspace: null,
        },
      }),
    );

    await useSessionStore.getState().refresh();

    expect(useSessionStore.getState().selectedAgencyId).toBe('agency-child');
    expect(useSessionStore.getState().agencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'agency-child' })]),
    );
  });

  it('drops tampered or revoked stored Subaccount context after refresh validation fails', async () => {
    document.cookie = 'zea_csrf=csrf-token; path=/';
    useSessionStore.setState({
      selectedAgencyId: 'agency-foreign',
      selectedWorkspaceId: 'workspace-disabled',
    });
    vi.stubGlobal('fetch', fetchMock({ validateStatus: 403 }));

    await useSessionStore.getState().refresh();

    expect(useSessionStore.getState().selectedAgencyId).toBeNull();
    expect(useSessionStore.getState().selectedWorkspaceId).toBeNull();
    expect(useSessionStore.getState().selectedSuperAgencyId).toBe('super-1');
  });

  it('lets validated Subaccount metadata replace stale local Workspace state after refresh', async () => {
    document.cookie = 'zea_csrf=csrf-token; path=/';
    useSessionStore.setState({
      selectedAgencyId: 'agency-child',
      selectedWorkspaceId: 'workspace-1',
      agencies: [
        {
          id: 'agency-child',
          name: 'Child Agency',
          slug: 'child-agency',
          status: 'ACTIVE',
          role: 'SUPER_AGENCY_CONTEXT',
          membershipId: null,
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-child',
              name: 'Old Subaccount',
              slug: 'old-subaccount',
              timezone: 'UTC',
              status: 'DISABLED',
              role: null,
              membershipId: null,
            },
          ],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      fetchMock({
        validate: {
          targetType: 'WORKSPACE',
          targetId: 'workspace-1',
          selectedSuperAgencyId: null,
          selectedAgencyId: 'agency-child',
          selectedWorkspaceId: 'workspace-1',
          superAgencyId: 'super-1',
          agencyId: 'agency-child',
          workspaceId: 'workspace-1',
          superAgency: null,
          agency: {
            id: 'agency-child',
            superAgencyId: 'super-1',
            name: 'Child Agency',
            slug: 'child-agency',
            status: 'ACTIVE',
            workspaces: [
              {
                id: 'workspace-1',
                agencyId: 'agency-child',
                name: 'Current Subaccount',
                slug: 'current-subaccount',
                timezone: 'UTC',
                status: 'ACTIVE',
              },
            ],
          },
          workspace: {
            id: 'workspace-1',
            agencyId: 'agency-child',
            name: 'Current Subaccount',
            slug: 'current-subaccount',
            timezone: 'UTC',
            status: 'ACTIVE',
          },
        },
      }),
    );

    await useSessionStore.getState().refresh();

    expect(
      useSessionStore
        .getState()
        .agencies.find((agency) => agency.id === 'agency-child')
        ?.workspaces.find((workspace) => workspace.id === 'workspace-1'),
    ).toMatchObject({ name: 'Current Subaccount', status: 'ACTIVE' });
  });

  it('keeps hierarchical Agency switches parent-scoped unless the legacy switcher asks for a Workspace', async () => {
    const agency = sessionAgency();
    useSessionStore.setState({
      accessToken: 'token',
      agencies: [agency],
      selectedAgencyId: 'agency-one',
      selectedWorkspaceId: 'workspace-one',
    });
    vi.stubGlobal('fetch', switchFetchMock());

    await useSessionStore.getState().switchToAgency('agency-two');

    expect(useSessionStore.getState().selectedAgencyId).toBe('agency-two');
    expect(useSessionStore.getState().selectedWorkspaceId).toBeNull();

    await useSessionStore.getState().switchToAgency('agency-two', { selectFirstWorkspace: true });

    expect(useSessionStore.getState().selectedAgencyId).toBe('agency-two');
    expect(useSessionStore.getState().selectedWorkspaceId).toBe('workspace-two');
  });
});

function fetchMock({
  validate,
  validateStatus = 200,
}: {
  validate?: unknown;
  validateStatus?: number;
}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/auth/refresh')) {
      return json({ data: { accessToken: 'fresh-token', csrfToken: 'csrf-token' } });
    }
    if (url.endsWith('/auth/me')) {
      return json({
        data: {
          id: 'user-1',
          email: 'owner@zeaplay.test',
          name: 'Owner',
          superAgencies: [
            {
              id: 'super-1',
              name: 'Super One',
              slug: 'super-one',
              status: 'ACTIVE',
              role: 'SUPER_AGENCY_OWNER',
              membershipId: 'super-membership-1',
              agencies: [
                { id: 'agency-child', name: 'Child Agency', slug: 'child', status: 'ACTIVE' },
              ],
            },
          ],
          agencies: [],
        },
      });
    }
    if (url.endsWith('/account-context/validate')) {
      if (validateStatus >= 400) {
        return json(
          {
            code: 'FORBIDDEN',
            message: 'Context access denied.',
            requestId: 'test-request',
          },
          validateStatus,
        );
      }
      return json({ data: validate });
    }
    return json({}, 404);
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionAgency() {
  return {
    id: 'agency-two',
    name: 'Agency Two',
    slug: 'agency-two',
    status: 'ACTIVE',
    role: 'OWNER',
    membershipId: 'agency-membership-two',
    workspaces: [
      {
        id: 'workspace-two',
        agencyId: 'agency-two',
        name: 'Workspace Two',
        slug: 'workspace-two',
        timezone: 'UTC',
        status: 'ACTIVE',
        role: 'OWNER',
        membershipId: 'workspace-membership-two',
      },
    ],
  };
}

function switchFetchMock() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/account-context/switch')) {
      return json({
        data: {
          targetType: 'AGENCY',
          targetId: 'agency-two',
          selectedSuperAgencyId: null,
          selectedAgencyId: 'agency-two',
          selectedWorkspaceId: null,
          superAgencyId: 'super-1',
          agencyId: 'agency-two',
          workspaceId: null,
          superAgency: null,
          agency: {
            id: 'agency-two',
            superAgencyId: 'super-1',
            name: 'Agency Two',
            slug: 'agency-two',
            status: 'ACTIVE',
          },
          workspace: null,
        },
      });
    }
    return json({}, 404);
  });
}
