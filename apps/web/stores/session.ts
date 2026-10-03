'use client';

import { create } from 'zustand';
import {
  returnAccountContext,
  switchAccountContext,
  validateAccountContext,
  type AccountContextResponse,
  type AccountContextTargetType,
} from '../services/account-context';
import { apiClient, setApiAccessToken, setApiTenantContext } from '../services/api';
import { resolveDomainBoundSwitchRedirect } from '../services/custom-domains';
import { clearTenantBoundPwaCaches } from '../services/pwa';

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
  membershipId: string | null;
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
  accountContextPermissions: string[];
  accountContextAccessSource: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  setSuperAgency: (superAgencyId: string) => void;
  setAgency: (agencyId: string) => void;
  setWorkspace: (workspaceId: string) => void;
  switchToSuperAgency: (superAgencyId: string) => Promise<void>;
  switchToAgency: (agencyId: string, options?: { selectFirstWorkspace?: boolean }) => Promise<void>;
  switchToWorkspace: (workspaceId: string, agencyId?: string) => Promise<void>;
  returnToSuperAgency: (superAgencyId: string) => Promise<void>;
  returnToAgency: (agencyId: string) => Promise<void>;
}

const storageKey = 'zea-play-session-ui';
const csrfCookieName = 'zea_csrf';
let contextSwitchSequence = 0;

export const useSessionStore = create<SessionState>((set, get) => ({
  accessToken: null,
  csrfToken: null,
  user: null,
  superAgencies: [],
  agencies: [],
  selectedSuperAgencyId: null,
  selectedAgencyId: null,
  selectedWorkspaceId: null,
  accountContextPermissions: [],
  accountContextAccessSource: null,
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
    setTenant(null, null);
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
    const restored = await validateStoredSelection({
      selectedSuperAgencyId: get().selectedSuperAgencyId,
      selectedAgencyId: get().selectedAgencyId,
      selectedWorkspaceId: get().selectedWorkspaceId,
    }).catch(() => null);
    const agencies = restored?.agency
      ? upsertAgency(me.data.agencies, restored.agency)
      : me.data.agencies;
    const selected = restored
      ? {
          selectedSuperAgencyId: restored.selectedSuperAgencyId,
          selectedAgencyId: restored.selectedAgencyId,
          selectedWorkspaceId: restored.selectedWorkspaceId,
        }
      : normalizeSelection(
          superAgencies,
          agencies,
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
      agencies,
      ...selected,
      accountContextPermissions: restored?.permissions ?? [],
      accountContextAccessSource: restored?.accessSource ?? null,
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
      accountContextPermissions: [],
      accountContextAccessSource: null,
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
      accountContextPermissions: [],
      accountContextAccessSource: null,
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
      accountContextPermissions: [],
      accountContextAccessSource: null,
    };
    setTenant(next.selectedAgencyId, next.selectedWorkspaceId);
    persistSelection(next);
    set(next);
  },
  async switchToSuperAgency(superAgencyId) {
    const current = get();
    const sequence = beginContextSwitch();
    const response = await switchAccountContext({
      targetType: 'SUPER_AGENCY',
      targetId: superAgencyId,
      ...currentSource(current),
    });
    if (!isLatestContextSwitch(sequence)) return;
    if (await redirectDomainBoundSwitch(response)) return;
    applyAccountContext(response, current, set);
  },
  async switchToAgency(agencyId, options) {
    const current = get();
    const sequence = beginContextSwitch();
    const response = await switchAccountContext({
      targetType: 'AGENCY',
      targetId: agencyId,
      ...currentSource(current),
    });
    if (!isLatestContextSwitch(sequence)) return;
    if (await redirectDomainBoundSwitch(response)) return;
    applyAccountContext(response, current, set, options);
  },
  async switchToWorkspace(workspaceId, agencyId) {
    const current = get();
    const sequence = beginContextSwitch();
    const response = await switchAccountContext({
      targetType: 'WORKSPACE',
      targetId: workspaceId,
      agencyId: agencyId ?? current.selectedAgencyId ?? undefined,
      ...currentSource(current),
    });
    if (!isLatestContextSwitch(sequence)) return;
    if (await redirectDomainBoundSwitch(response)) return;
    applyAccountContext(response, current, set);
  },
  async returnToSuperAgency(superAgencyId) {
    const current = get();
    const sequence = beginContextSwitch();
    const response = await returnAccountContext({
      targetType: 'SUPER_AGENCY',
      targetId: superAgencyId,
      ...currentSource(current),
    });
    if (!isLatestContextSwitch(sequence)) return;
    if (await redirectDomainBoundSwitch(response)) return;
    applyAccountContext(response, current, set);
  },
  async returnToAgency(agencyId) {
    const current = get();
    const sequence = beginContextSwitch();
    const response = await returnAccountContext({
      targetType: 'AGENCY',
      targetId: agencyId,
      ...currentSource(current),
    });
    if (!isLatestContextSwitch(sequence)) return;
    if (await redirectDomainBoundSwitch(response)) return;
    applyAccountContext(response, current, set);
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
    accountContextPermissions: [],
    accountContextAccessSource: null,
    hydrated: true,
  });
}

function clearSession(set: (state: Partial<SessionState>) => void) {
  setApiAccessToken(null);
  setTenant(null, null);
  clearTenantBoundPwaCaches();
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
    accountContextPermissions: [],
    accountContextAccessSource: null,
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

async function redirectDomainBoundSwitch(context: AccountContextResponse) {
  const redirectUrl = await resolveDomainBoundSwitchRedirect(context);
  if (!redirectUrl) return false;
  persistSelection({
    selectedSuperAgencyId: context.selectedSuperAgencyId,
    selectedAgencyId: context.selectedAgencyId,
    selectedWorkspaceId: context.selectedWorkspaceId,
  });
  window.location.assign(redirectUrl);
  return true;
}

function setTenant(agencyId: string | null, workspaceId: string | null) {
  setApiTenantContext(agencyId, workspaceId);
}

function applyAccountContext(
  context: AccountContextResponse,
  current: SessionState,
  set: (state: Partial<SessionState>) => void,
  options: { selectFirstWorkspace?: boolean } = {},
) {
  const agencies = context.agency
    ? upsertAgency(current.agencies, context.agency)
    : current.agencies;
  const agency = agencies.find((item) => item.id === context.selectedAgencyId);
  const selectedWorkspaceId =
    options.selectFirstWorkspace && !context.selectedSuperAgencyId
      ? (context.selectedWorkspaceId ?? agency?.workspaces[0]?.id ?? null)
      : context.selectedWorkspaceId;
  const next = {
    selectedSuperAgencyId: context.selectedSuperAgencyId,
    selectedAgencyId: context.selectedAgencyId,
    selectedWorkspaceId,
    accountContextPermissions: context.permissions,
    accountContextAccessSource: context.accessSource ?? null,
  };
  setTenant(
    next.selectedSuperAgencyId ? null : next.selectedAgencyId,
    next.selectedSuperAgencyId ? null : next.selectedWorkspaceId,
  );
  persistSelection(next);
  set({ ...next, agencies });
}

async function validateStoredSelection(selection: {
  selectedSuperAgencyId: string | null;
  selectedAgencyId: string | null;
  selectedWorkspaceId: string | null;
}) {
  if (selection.selectedWorkspaceId) {
    return validateAccountContext({
      targetType: 'WORKSPACE',
      targetId: selection.selectedWorkspaceId,
      agencyId: selection.selectedAgencyId ?? undefined,
    });
  }
  if (selection.selectedAgencyId) {
    return validateAccountContext({
      targetType: 'AGENCY',
      targetId: selection.selectedAgencyId,
    });
  }
  if (selection.selectedSuperAgencyId) {
    return validateAccountContext({
      targetType: 'SUPER_AGENCY',
      targetId: selection.selectedSuperAgencyId,
    });
  }
  return null;
}

function beginContextSwitch() {
  contextSwitchSequence += 1;
  notifyTenantCacheClear();
  return contextSwitchSequence;
}

function isLatestContextSwitch(sequence: number) {
  return sequence === contextSwitchSequence;
}

function notifyTenantCacheClear() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('zea-play-tenant-changing'));
  clearTenantBoundPwaCaches();
}

function upsertAgency(
  agencies: SessionAgency[],
  agency: NonNullable<AccountContextResponse['agency']>,
) {
  const incoming: SessionAgency = {
    id: agency.id,
    name: agency.name,
    slug: agency.slug,
    status: agency.status,
    role: 'SUPER_AGENCY_CONTEXT',
    membershipId: null,
    workspaces: (agency.workspaces ?? []).map((workspace) => ({
      id: workspace.id,
      agencyId: workspace.agencyId,
      name: workspace.name,
      slug: workspace.slug,
      timezone: workspace.timezone,
      status: workspace.status,
      role: null,
      membershipId: null,
    })),
  };
  const existing = agencies.find((item) => item.id === agency.id);
  if (!existing) return [...agencies, incoming];
  const workspaces =
    incoming.workspaces.length > 0
      ? mergeWorkspaces(existing.workspaces, incoming.workspaces)
      : existing.workspaces;
  return agencies.map((item) =>
    item.id === agency.id
      ? {
          ...item,
          name: incoming.name,
          slug: incoming.slug,
          status: incoming.status,
          workspaces,
        }
      : item,
  );
}

function mergeWorkspaces(existing: SessionWorkspace[], incoming: SessionWorkspace[]) {
  const byId = new Map(existing.map((workspace) => [workspace.id, workspace]));
  for (const workspace of incoming) {
    byId.set(workspace.id, { ...byId.get(workspace.id), ...workspace });
  }
  return Array.from(byId.values());
}

function currentSource(state: SessionState): {
  sourceType?: AccountContextTargetType;
  sourceId?: string;
} {
  if (state.selectedWorkspaceId) {
    return { sourceType: 'WORKSPACE', sourceId: state.selectedWorkspaceId };
  }
  if (state.selectedAgencyId) {
    return { sourceType: 'AGENCY', sourceId: state.selectedAgencyId };
  }
  if (state.selectedSuperAgencyId) {
    return { sourceType: 'SUPER_AGENCY', sourceId: state.selectedSuperAgencyId };
  }
  return {};
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
