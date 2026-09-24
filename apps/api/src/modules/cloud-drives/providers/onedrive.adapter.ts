import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudDriveProvider } from '@prisma/client';
import type {
  CloudDriveFile,
  CloudDriveProviderAdapter,
  CloudDriveTokenSet,
  CloudDriveUploadInput,
} from './cloud-drive-provider.interface';
import { baseCapabilities } from './cloud-drive-provider.interface';
import { authHeaders, fetchJson, fetchStream, formBody, safeWebUrl } from './provider-http';

const GRAPH_SCOPE = 'offline_access Files.ReadWrite';

@Injectable()
export class OneDriveAdapter implements CloudDriveProviderAdapter {
  readonly provider = CloudDriveProvider.ONEDRIVE;
  readonly capabilities = { ...baseCapabilities, revoke: false };

  configured() {
    return Boolean(process.env.ONEDRIVE_CLIENT_ID && process.env.ONEDRIVE_CLIENT_SECRET);
  }

  getAuthorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }) {
    const tenant = process.env.ONEDRIVE_TENANT || 'common';
    const url = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
    );
    url.searchParams.set('client_id', process.env.ONEDRIVE_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GRAPH_SCOPE);
    url.searchParams.set('state', input.state);
    if (input.codeChallenge) {
      url.searchParams.set('code_challenge', input.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }) {
    return this.toTokenSet(
      await fetchJson<OneDriveTokenResponse>(this.tokenUrl(), {
        method: 'POST',
        body: formBody({
          client_id: process.env.ONEDRIVE_CLIENT_ID,
          client_secret: process.env.ONEDRIVE_CLIENT_SECRET,
          code: input.code,
          redirect_uri: input.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: input.codeVerifier ?? undefined,
        }),
      }),
    );
  }

  async refreshAccessToken(refreshToken: string) {
    return this.toTokenSet(
      await fetchJson<OneDriveTokenResponse>(this.tokenUrl(), {
        method: 'POST',
        body: formBody({
          client_id: process.env.ONEDRIVE_CLIENT_ID,
          client_secret: process.env.ONEDRIVE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      }),
    );
  }

  revokeConnection() {
    return Promise.resolve();
  }

  async listFiles(input: {
    accessToken: string;
    folderId?: string | null;
    cursor?: string | null;
    pageSize: number;
    foldersOnly?: boolean;
  }) {
    const url = input.cursor
      ? new URL(requireSafeGraphCursor(input.cursor))
      : new URL(
          input.folderId
            ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(input.folderId)}/children`
            : 'https://graph.microsoft.com/v1.0/me/drive/root/children',
        );
    url.searchParams.set('$top', String(Math.min(input.pageSize, 100)));
    if (input.foldersOnly) url.searchParams.set('$filter', 'folder ne null');
    const result = await fetchJson<OneDriveListResponse>(url.toString(), {
      headers: authHeaders(input.accessToken),
    });
    return {
      items: (result.value ?? []).map((file) => normalizeOneDriveFile(file)),
      nextCursor: safeGraphCursor(result['@odata.nextLink']),
    };
  }

  async getFileMetadata(accessToken: string, providerFileId: string) {
    return normalizeOneDriveFile(
      await fetchJson<OneDriveItem>(
        `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(providerFileId)}`,
        { headers: authHeaders(accessToken) },
      ),
    );
  }

  downloadFileStream(accessToken: string, providerFileId: string) {
    return fetchStream(
      `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(providerFileId)}/content`,
      { headers: authHeaders(accessToken) },
    );
  }

  async uploadFile(accessToken: string, input: CloudDriveUploadInput) {
    const parent = input.destinationFolderId
      ? `/me/drive/items/${encodeURIComponent(input.destinationFolderId)}:/${encodeURIComponent(input.filename)}:/content`
      : `/me/drive/root:/${encodeURIComponent(input.filename)}:/content`;
    const result = await fetchJson<OneDriveItem>(`https://graph.microsoft.com/v1.0${parent}`, {
      method: 'PUT',
      headers: authHeaders(accessToken, { 'content-type': input.mimeType }),
      body: input.body as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit);
    return { providerFileId: result.id, providerWebUrl: safeWebUrl(result.webUrl) };
  }

  private tokenUrl() {
    const tenant = process.env.ONEDRIVE_TENANT || 'common';
    return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  }

  private toTokenSet(token: OneDriveTokenResponse): CloudDriveTokenSet {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? GRAPH_SCOPE.split(/\s+/),
    };
  }
}

interface OneDriveTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface OneDriveItem {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  lastModifiedDateTime?: string;
  parentReference?: { id?: string };
  webUrl?: string;
}

interface OneDriveListResponse {
  value?: OneDriveItem[];
  '@odata.nextLink'?: string;
}

function normalizeOneDriveFile(file: OneDriveItem): CloudDriveFile {
  const isFolder = Boolean(file.folder);
  return {
    providerFileId: file.id,
    name: file.name,
    mimeType: file.file?.mimeType ?? (isFolder ? 'folder' : null),
    sizeBytes: typeof file.size === 'number' ? file.size : null,
    isFolder,
    modifiedAt: file.lastModifiedDateTime ? new Date(file.lastModifiedDateTime) : null,
    parentId: file.parentReference?.id ?? null,
    providerWebUrl: safeWebUrl(file.webUrl),
    downloadable: !isFolder,
  };
}

function safeGraphCursor(value: unknown) {
  const url = safeWebUrl(value);
  return url?.startsWith('https://graph.microsoft.com/') ? url : null;
}

function requireSafeGraphCursor(value: string) {
  const cursor = safeGraphCursor(value);
  if (!cursor) throw new BadRequestException('CLOUD_PROVIDER_CURSOR_INVALID');
  return cursor;
}
