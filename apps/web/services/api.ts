import { ApiClient } from '../../../packages/api-client/src';

let accessToken: string | null = null;

export const apiClient = new ApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
  credentials: 'include',
  getAccessToken: () => accessToken,
});

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}
