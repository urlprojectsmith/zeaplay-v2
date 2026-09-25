'use client';

import { create } from 'zustand';
import { apiClient, setApiAccessToken, setApiTenantContext } from '../services/api';

export interface SessionWorkspace {
  id: string;
  agencyId: string;
  name: string;
  slug: string;
  timezone: string;
  status: string;
  role: string | null;
  membershipId: string | null;
}

export interface SessionAgency {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  membershipId: string;
  workspaces: SessionWorkspace[];
}

export interface SessionSuperAgency {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  membershipId: string;
  agencies: {
    id: string;
    name: string;
    slug: string;
    status: string;
  }[];
}

interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
}

interface LoginResponse {
  accessToken: string;
  csrfToken: string;
  user: SessionUser;
  superAgencies: SessionSuperAgency[];
  agencies: SessionAgency[];
}

interface MeResponse extends SessionUser {
  superAgencies: SessionSuperAgency[];
  agencies: SessionAgency[];
}

interface SessionState {
  accessToken: string | null;
  csrfToken: string | null;
  user: SessionUser | null;
  superAgencies: SessionSuperAgency[];
  agencies: SessionAgency[];
  selectedSuperAgencyId: string | null;
  selectedAgencyId: string | null;
  selectedWorkspaceId: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  setSuperAgency: (superAgencyId: string) => void;
  setAgency: (agencyId: string) => void;
  setWorkspace: (workspaceId: string) => void;
}

const storageKey = 'zea-play-session-ui';
const csrfCookieName = 'zea_csrf';

export const useSessionStore = create<SessionState>((set, get) => ({
  accessToken: null,
  csrfToken: null,
  user: null,
  superAgencies: [],
  agencies: [],
  selectedSuperAgencyId: null,
  selectedAgencyId: null,
  selectedWorkspaceId: null,
  hydrated: false,
  async login(email, password) {
    const response = await apiClient.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    applySession(response.data, set);
  },
  async logout() {
    const { accessToken, csrfToken } = get();
    if (accessToken) {
      await apiClient
        .request('/auth/logout', {
          method: 'POST',
          headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
        })
        .catch(() => undefined);
    }
    clearSession(set);
  },
  async hydrate() {
    if (get().hydrated) return;
    const stored = safeParse(localStorage.getItem(storageKey));
    setTenant(
      stored.selectedSuperAgencyId ? null : stored.selectedAgencyId,
      stored.selectedSuperAgencyId ? null : stored.selectedWorkspaceId,
    );
    set(stored);
    await get()
      .refresh()
      .catch(() => clearSession(set));
  },
  async refresh() {
    const csrfToken = readCookie(csrfCookieName);
    if (!csrfToken) throw new Error('CSRF token missing.');
    const response = await apiClient.request<{ accessToken: string; csrfToken: string }>(
      '/auth/refresh',
      {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      },
    );
    setApiAccessToken(response.data.accessToken);
    const me = await apiClient.request<MeResponse>('/auth/me');
    const superAgencies = me.data.superAgencies ?? [];
    const selected = normalizeSelection(
      superAgencies,
      me.data.agencies,
      get().selectedSuperAgencyId,
      get().selectedAgencyId,
      get().selectedWorkspaceId,
    );
    setTenant(
      selected.selectedSuperAgencyId ? null : selected.selectedAgencyId,
      selected.selectedSuperAgencyId ? null : selected.selectedWorkspaceId,
    );
    persistSelection(selected);
    set({
      accessToken: response.data.accessToken,
      csrfToken: response.data.csrfToken,
      user: { id: me.data.id, email: me.data.email, name: me.data.name },
      superAgencies,
      agencies: me.data.agencies,
      ...selected,
      hydrated: true,
    });
  },
  setSuperAgency(superAgencyId) {
    const superAgency = get().superAgencies.find((item) => item.id === superAgencyId);
    if (!superAgency) return;
    const next = {
      selectedSuperAgencyId: superAgency.id,
      selectedAgencyId: null,
      selectedWorkspaceId: null,
    };
    setTenant(null, null);
    persistSelection(next);
    set(next);
  },
  setAgency(agencyId) {
    const agency = get().agencies.find((item) => item.id === agencyId);
    if (!agency) return;
    const next = {
      selectedSuperAgencyId: null,
      selectedAgencyId: agency.id,
      selectedWorkspaceId: agency.workspaces[0]?.id ?? null,
    };
    setTenant(next.selectedAgencyId, next.selectedWorkspaceId);
    persistSelection(next);
    set(next);
  },
  setWorkspace(workspaceId) {
    const current = get();
    const agency = current.agencies.find((item) => item.id === current.selectedAgencyId);
    if (!agency?.workspaces.some((workspace) => workspace.id === workspaceId)) return;
    const next = {
      selectedSuperAgencyId: null,
      selectedAgencyId: agency.id,
      selectedWorkspaceId: workspaceId,
    };
    setTenant(next.selectedAgencyId, next.selectedWorkspaceId);
    persistSelection(next);
    set(next);
  },
}));

function applySession(data: LoginResponse, set: (state: Partial<SessionState>) => void) {
  setApiAccessToken(data.accessToken);
  const superAgencies = data.superAgencies ?? [];
  const selected = normalizeSelection(superAgencies, data.agencies, null, null, null);
  setTenant(
    selected.selectedSuperAgencyId ? null : selected.selectedAgencyId,
    selected.selectedSuperAgencyId ? null : selected.selectedWorkspaceId,
  );
  persistSelection(selected);
  set({
    accessToken: data.accessToken,
    csrfToken: data.csrfToken,
    user: data.user,
    superAgencies,
    agencies: data.agencies,
    ...selected,
    hydrated: true,
  });
}

function clearSession(set: (state: Partial<SessionState>) => void) {
  setApiAccessToken(null);
  setTenant(null, null);
  localStorage.removeItem(storageKey);
  set({
    accessToken: null,
    csrfToken: null,
    user: null,
    superAgencies: [],
    agencies: [],
    selectedSuperAgencyId: null,
    selectedAgencyId: null,
    selectedWorkspaceId: null,
    hydrated: true,
  });
}

function normalizeSelection(
  superAgencies: SessionSuperAgency[],
  agencies: SessionAgency[],
  superAgencyId: string | null,
  agencyId: string | null,
  workspaceId: string | null,
) {
  const storedSuperAgency = superAgencies.find((item) => item.id === superAgencyId) ?? null;
  const onlySuperAgency =
    superAgencies.length === 1 ? (superAgencies.find(() => true) ?? null) : null;
  const selectedSuperAgency = storedSuperAgency ?? onlySuperAgency;
  if (selectedSuperAgency) {
    return {
      selectedSuperAgencyId: selectedSuperAgency.id,
      selectedAgencyId: null,
      selectedWorkspaceId: null,
    };
  }
  const agency = agencies.find((item) => item.id === agencyId) ?? agencies[0] ?? null;
  const workspace =
    agency?.workspaces.find((item) => item.id === workspaceId) ?? agency?.workspaces[0] ?? null;
  return {
    selectedSuperAgencyId: null,
    selectedAgencyId: agency?.id ?? null,
    selectedWorkspaceId: workspace?.id ?? null,
  };
}

function persistSelection(selection: {
  selectedSuperAgencyId: string | null;
  selectedAgencyId: string | null;
  selectedWorkspaceId: string | null;
}) {
  localStorage.setItem(storageKey, JSON.stringify(selection));
}

function setTenant(agencyId: string | null, workspaceId: string | null) {
  setApiTenantContext(agencyId, workspaceId);
}

function readCookie(name: string) {
  return document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

function safeParse(raw: string | null): {
  selectedSuperAgencyId: string | null;
  selectedAgencyId: string | null;
  selectedWorkspaceId: string | null;
} {
  if (!raw)
    return { selectedSuperAgencyId: null, selectedAgencyId: null, selectedWorkspaceId: null };
  try {
    const parsed = JSON.parse(raw) as {
      selectedSuperAgencyId?: unknown;
      selectedAgencyId?: unknown;
      selectedWorkspaceId?: unknown;
      organizationId?: unknown;
    };
    return {
      selectedSuperAgencyId:
        typeof parsed.selectedSuperAgencyId === 'string' ? parsed.selectedSuperAgencyId : null,
      selectedAgencyId:
        typeof parsed.selectedAgencyId === 'string'
          ? parsed.selectedAgencyId
          : typeof parsed.organizationId === 'string'
            ? parsed.organizationId
            : null,
      selectedWorkspaceId:
        typeof parsed.selectedWorkspaceId === 'string' ? parsed.selectedWorkspaceId : null,
    };
  } catch {
    return { selectedSuperAgencyId: null, selectedAgencyId: null, selectedWorkspaceId: null };
  }
}
