import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayoutDashboard } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  TooltipProvider,
} from '@zea-play/ui';
import { LanguageProvider, useLanguage } from '../contexts/language-provider';
import { Providers } from '../contexts/providers';
import { ThemeProvider, useTheme } from '../contexts/theme-provider';
import { DashboardRouteChrome } from '../components/layout/DashboardRouteChrome';
import { ProtectedDashboardBoundary } from '../components/layout/ProtectedDashboardBoundary';
import { BrandProvider } from '../components/branding/BrandProvider';
import { NavigationGroup } from '../components/navigation/NavigationGroup';
import { canShowFeature, dashboardConfigs } from '../components/navigation/navigation-config';
import { useSessionStore, type SessionAgency } from '../stores/session';

const replace = vi.fn();
let mockedPathname = '/workspace/dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => mockedPathname,
}));

function ThemeProbe() {
  const { theme, setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme('colorful')}>
      {theme}
    </button>
  );
}

function LanguageProbe() {
  const { locale, setLocale, t } = useLanguage();
  return (
    <button type="button" onClick={() => setLocale('ta')}>
      {locale}:{t(locale, 'dashboard.foundationReady')}
    </button>
  );
}

function QueryCacheProbe() {
  const queryClient = useQueryClient();
  const queryKey = ['workspace', 'workspace-1', 'users'] as const;
  const [cached, setCached] = React.useState(false);
  React.useEffect(
    () =>
      queryClient.getQueryCache().subscribe(() => {
        setCached(Boolean(queryClient.getQueryData(queryKey)));
      }),
    [queryClient, queryKey],
  );
  return (
    <button
      type="button"
      onClick={() => {
        queryClient.setQueryData(queryKey, [{ id: 'user-1' }]);
      }}
    >
      {cached ? 'cached' : 'empty'}
    </button>
  );
}

const agencies: SessionAgency[] = [
  {
    id: 'agency-1',
    name: 'Agency One',
    slug: 'agency-one',
    status: 'active',
    role: 'owner',
    membershipId: 'membership-1',
    workspaces: [
      {
        id: 'workspace-1',
        agencyId: 'agency-1',
        name: 'Workspace One',
        slug: 'workspace-one',
        status: 'active',
        role: 'admin',
        membershipId: 'workspace-membership-1',
      },
    ],
  },
  {
    id: 'agency-2',
    name: 'Agency Two',
    slug: 'agency-two',
    status: 'active',
    role: 'admin',
    membershipId: 'membership-2',
    workspaces: [
      {
        id: 'workspace-2',
        agencyId: 'agency-2',
        name: 'Workspace Two',
        slug: 'workspace-two',
        status: 'active',
        role: 'member',
        membershipId: 'workspace-membership-2',
      },
    ],
  },
];

describe('phase 5 foundations', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'zea_csrf=; Max-Age=0; path=/';
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.removeProperty('--primary');
    document.documentElement.style.removeProperty('--secondary');
    document.documentElement.style.removeProperty('--accent');
    mockedPathname = '/workspace/dashboard';
    replace.mockClear();
    vi.unstubAllGlobals();
    useSessionStore.setState({
      accessToken: null,
      csrfToken: null,
      user: null,
      agencies: [],
      selectedAgencyId: null,
      selectedWorkspaceId: null,
      hydrated: false,
    });
  });

  it('switches and persists the explicit theme selection', async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'light' }));
    await waitFor(() => expect(localStorage.getItem('zea-play-theme')).toBe('colorful'));
    expect(document.documentElement.dataset.theme).toBe('colorful');
  });

  it('switches language and renders Tamil text', async () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(localStorage.getItem('zea-play-locale')).toBe('ta'));
    expect(screen.getByText(/டாஷ்போர்டு அடித்தளம் தயார்/)).toBeInTheDocument();
  });

  it('clears invalid workspace by selecting a valid workspace when agency changes', () => {
    useSessionStore.setState({
      agencies,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
    });
    useSessionStore.getState().setAgency('agency-2');
    expect(useSessionStore.getState().selectedAgencyId).toBe('agency-2');
    expect(useSessionStore.getState().selectedWorkspaceId).toBe('workspace-2');
  });

  it('rejects workspace selections outside the selected agency', () => {
    useSessionStore.setState({
      agencies,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
    });
    useSessionStore.getState().setWorkspace('workspace-2');
    expect(useSessionStore.getState().selectedWorkspaceId).toBe('workspace-1');
  });

  it('redirects unauthenticated protected dashboard visitors after hydration', async () => {
    useSessionStore.setState({ hydrated: true, accessToken: null, user: null });
    render(
      <ProtectedDashboardBoundary>
        <p>private</p>
      </ProtectedDashboardBoundary>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });

  it('waits for a valid refresh before rendering protected dashboard content', async () => {
    document.cookie = 'zea_csrf=csrf-token; path=/';
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/auth/refresh')) {
        return new Response(
          JSON.stringify({ data: { accessToken: 'fresh-token', csrfToken: 'csrf-token' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/auth/me')) {
        return new Response(
          JSON.stringify({
            data: {
              id: 'user-1',
              email: 'owner@zeaplay.test',
              name: 'Owner',
              agencies,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ProtectedDashboardBoundary>
        <p>private</p>
      </ProtectedDashboardBoundary>,
    );

    expect(screen.queryByText('private')).not.toBeInTheDocument();
    expect(await screen.findByText('private')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalledWith('/login');
  });

  it('clears tenant query cache when the authenticated session is lost', async () => {
    useSessionStore.setState({
      hydrated: true,
      accessToken: 'token',
      user: { id: 'user-1', email: 'owner@zeaplay.test' },
    });
    render(
      <Providers>
        <QueryCacheProbe />
      </Providers>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'empty' }));
    expect(screen.getByRole('button', { name: 'cached' })).toBeInTheDocument();

    act(() => {
      useSessionStore.setState({ accessToken: null, user: null });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'empty' })).toBeInTheDocument());
  });

  it('sanitizes brand colors and falls back for invalid values', async () => {
    render(
      <BrandProvider
        brand={{
          primaryColor: '0 0% 0%; color:red',
          secondaryColor: '#336699',
          accentColor: '327 80% 54%',
        }}
      >
        <p>brand</p>
      </BrandProvider>,
    );

    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--primary')).toBe('176 72% 28%'),
    );
    expect(document.documentElement.style.getPropertyValue('--secondary')).toBe('210 50% 40%');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('327 80% 54%');
  });

  it('sanitizes white-label asset URLs and keeps agency roles navigation deferred', async () => {
    render(
      <BrandProvider
        brand={{
          logoUrl: 'javascript:alert(1)',
          faviconUrl: 'data:text/html,<svg onload=alert(1)>',
          loginBackground: 'https://cdn.example.test/background.png',
        }}
      >
        <p>brand</p>
      </BrandProvider>,
    );

    const agencyItems = dashboardConfigs.agency.groups.flatMap((group) => group.items);
    const agencyRoles = agencyItems.find((item) => item.labelKey === 'navigation.rolesPermissions');

    await waitFor(() => expect(document.querySelector('img')).not.toBeInTheDocument());
    expect(agencyRoles).toMatchObject({ disabled: true, href: '#' });
  });

  it('keeps feature visibility dormant and supports nested active routes', () => {
    mockedPathname = '/workspace/dashboard/details';
    expect(canShowFeature('projects')).toBe(false);
    expect(canShowFeature()).toBe(true);

    render(
      <LanguageProvider>
        <NavigationGroup
          collapsed={false}
          group={{
            label: 'Workspace',
            items: [
              {
                labelKey: 'navigation.dashboard',
                href: '/workspace/dashboard',
                icon: LayoutDashboard,
              },
            ],
          }}
        />
      </LanguageProvider>,
    );

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('persists sidebar collapsed preference', async () => {
    useSessionStore.setState({
      hydrated: true,
      accessToken: 'token',
      user: { id: 'user-1', email: 'owner@zeaplay.test' },
      agencies,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
    });
    render(
      <ThemeProvider>
        <LanguageProvider>
          <BrandProvider>
            <TooltipProvider>
              <DashboardRouteChrome scope="workspace">
                <p>workspace content</p>
              </DashboardRouteChrome>
            </TooltipProvider>
          </BrandProvider>
        </LanguageProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    await waitFor(() => expect(localStorage.getItem('zea-play-sidebar-collapsed')).toBe('true'));
  });

  it('opens and closes mobile navigation', async () => {
    useSessionStore.setState({
      hydrated: true,
      accessToken: 'token',
      user: { id: 'user-1', email: 'owner@zeaplay.test' },
      agencies,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
    });
    render(
      <ThemeProvider>
        <LanguageProvider>
          <BrandProvider>
            <TooltipProvider>
              <DashboardRouteChrome scope="workspace">
                <p>workspace content</p>
              </DashboardRouteChrome>
            </TooltipProvider>
          </BrandProvider>
        </LanguageProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close navigation/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('renders button variants and dialog keyboard close behavior', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="danger">Delete</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm delete</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
