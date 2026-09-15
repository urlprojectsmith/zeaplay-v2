import { ApiClient } from '../../../packages/api-client/src';

let accessToken: string | null = null;
let agencyId: string | null = null;
let workspaceId: string | null = null;

export const apiClient = new ApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
  credentials: 'include',
  getAccessToken: () => accessToken,
  getTenantContext: () => ({ agencyId, workspaceId }),
});

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

export function setApiTenantContext(nextAgencyId: string | null, nextWorkspaceId: string | null) {
  agencyId = nextAgencyId;
  workspaceId = nextWorkspaceId;
}
