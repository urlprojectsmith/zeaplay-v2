'use client';

import { create } from 'zustand';
import { apiClient, setApiAccessToken } from '../services/api';

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: string;
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
  organizations: SessionOrganization[];
}

interface MeResponse extends SessionUser {
  organizations: SessionOrganization[];
}

interface SessionState {
  accessToken: string | null;
  csrfToken: string | null;
  user: SessionUser | null;
  organizations: SessionOrganization[];
  organizationId: string | null;
  hydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  setOrganization: (organizationId: string) => void;
}

const storageKey = 'zea-play-session-ui';
const csrfCookieName = 'zea_csrf';

export const useSessionStore = create<SessionState>((set, get) => ({
  accessToken: null,
  csrfToken: null,
  user: null,
  organizations: [],
  organizationId: null,
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
    const raw = localStorage.getItem(storageKey);
    const organizationId = raw ? safeParse(raw).organizationId : null;
    set({ organizationId, hydrated: true });
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
    const selected = get().organizationId;
    set({
      accessToken: response.data.accessToken,
      csrfToken: response.data.csrfToken,
      user: { id: me.data.id, email: me.data.email, name: me.data.name },
      organizations: me.data.organizations,
      organizationId:
        selected && me.data.organizations.some((organization) => organization.id === selected)
          ? selected
          : (me.data.organizations[0]?.id ?? null),
      hydrated: true,
    });
  },
  setOrganization(organizationId) {
    const current = get();
    if (!current.organizations.some((organization) => organization.id === organizationId)) return;
    localStorage.setItem(storageKey, JSON.stringify({ organizationId }));
    set({ organizationId });
  },
}));

function applySession(data: LoginResponse, set: (state: Partial<SessionState>) => void) {
  setApiAccessToken(data.accessToken);
  const organizationId = data.organizations[0]?.id ?? null;
  localStorage.setItem(storageKey, JSON.stringify({ organizationId }));
  set({
    accessToken: data.accessToken,
    csrfToken: data.csrfToken,
    user: data.user,
    organizations: data.organizations,
    organizationId,
    hydrated: true,
  });
}

function clearSession(set: (state: Partial<SessionState>) => void) {
  setApiAccessToken(null);
  localStorage.removeItem(storageKey);
  set({
    accessToken: null,
    csrfToken: null,
    user: null,
    organizations: [],
    organizationId: null,
    hydrated: true,
  });
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

function safeParse(raw: string): { organizationId: string | null } {
  try {
    const parsed = JSON.parse(raw) as { organizationId?: unknown };
    return {
      organizationId: typeof parsed.organizationId === 'string' ? parsed.organizationId : null,
    };
  } catch {
    return { organizationId: null };
  }
}
