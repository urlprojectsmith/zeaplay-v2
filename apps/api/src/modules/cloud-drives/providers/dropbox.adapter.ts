import { Injectable } from '@nestjs/common';
import { CloudDriveProvider } from '@prisma/client';
import type {
  CloudDriveFile,
  CloudDriveProviderAdapter,
  CloudDriveTokenSet,
  CloudDriveUploadInput,
} from './cloud-drive-provider.interface';
import { baseCapabilities } from './cloud-drive-provider.interface';
import { authHeaders, fetchJson, fetchStream, formBody, safeWebUrl } from './provider-http';

const DROPBOX_SCOPE =
  'files.metadata.read files.content.read files.content.write account_info.read';

@Injectable()
export class DropboxAdapter implements CloudDriveProviderAdapter {
  readonly provider = CloudDriveProvider.DROPBOX;
  readonly capabilities = { ...baseCapabilities, revoke: true };

  configured() {
    return Boolean(process.env.DROPBOX_CLIENT_ID && process.env.DROPBOX_CLIENT_SECRET);
  }

  getAuthorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }) {
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.searchParams.set('client_id', process.env.DROPBOX_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('token_access_type', 'offline');
    url.searchParams.set('scope', DROPBOX_SCOPE);
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
      await fetchJson<DropboxTokenResponse>('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        body: formBody({
          client_id: process.env.DROPBOX_CLIENT_ID,
          client_secret: process.env.DROPBOX_CLIENT_SECRET,
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
      await fetchJson<DropboxTokenResponse>('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        body: formBody({
          client_id: process.env.DROPBOX_CLIENT_ID,
          client_secret: process.env.DROPBOX_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      }),
    );
  }

  async revokeConnection(accessToken: string) {
    await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
      method: 'POST',
      headers: authHeaders(accessToken),
    }).catch(() => undefined);
  }

  async listFiles(input: {
    accessToken: string;
    folderId?: string | null;
    cursor?: string | null;
    pageSize: number;
    foldersOnly?: boolean;
  }) {
    const endpoint = input.cursor
      ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
      : 'https://api.dropboxapi.com/2/files/list_folder';
    const result = await fetchJson<DropboxListResponse>(endpoint, {
      method: 'POST',
      headers: authHeaders(input.accessToken, { 'content-type': 'application/json' }),
      body: JSON.stringify(
        input.cursor
          ? { cursor: input.cursor }
          : {
              path: input.folderId ?? '',
              limit: Math.min(input.pageSize, 100),
              recursive: false,
              include_deleted: false,
            },
      ),
    });
    const entries = (result.entries ?? []).map((file) => normalizeDropboxFile(file));
    return {
      items: input.foldersOnly ? entries.filter((item) => item.isFolder) : entries,
      nextCursor: result.has_more ? (result.cursor ?? null) : null,
    };
  }

  async getFileMetadata(accessToken: string, providerFileId: string) {
    return normalizeDropboxFile(
      await fetchJson<DropboxEntry>('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: authHeaders(accessToken, { 'content-type': 'application/json' }),
        body: JSON.stringify({ path: providerFileId, include_deleted: false }),
      }),
    );
  }

  downloadFileStream(accessToken: string, providerFileId: string) {
    return fetchStream('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: authHeaders(accessToken, {
        'dropbox-api-arg': JSON.stringify({ path: providerFileId }),
      }),
    });
  }

  async uploadFile(accessToken: string, input: CloudDriveUploadInput) {
    const parent = input.destinationFolderId?.replace(/\/$/, '') ?? '';
    const path = `${parent}/${input.filename}`;
    const result = await fetchJson<DropboxEntry>('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: authHeaders(accessToken, {
        'content-type': 'application/octet-stream',
        'dropbox-api-arg': JSON.stringify({ path, mode: 'add', autorename: true }),
      }),
      body: input.body as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit);
    return { providerFileId: result.id ?? result.path_lower ?? path, providerWebUrl: null };
  }

  private toTokenSet(token: DropboxTokenResponse): CloudDriveTokenSet {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? DROPBOX_SCOPE.split(/\s+/),
      providerAccountId: token.account_id ?? null,
    };
  }
}

interface DropboxTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  account_id?: string;
}

interface DropboxEntry {
  '.tag': 'file' | 'folder';
  id?: string;
  name: string;
  path_lower?: string;
  size?: number;
  client_modified?: string;
}

interface DropboxListResponse {
  entries?: DropboxEntry[];
  cursor?: string;
  has_more?: boolean;
}

function normalizeDropboxFile(file: DropboxEntry): CloudDriveFile {
  const isFolder = file['.tag'] === 'folder';
  return {
    providerFileId: file.id ?? file.path_lower ?? file.name,
    name: file.name,
    mimeType: isFolder ? 'folder' : null,
    sizeBytes: typeof file.size === 'number' ? file.size : null,
    isFolder,
    modifiedAt: file.client_modified ? new Date(file.client_modified) : null,
    parentId: null,
    providerWebUrl: safeWebUrl(null),
    downloadable: !isFolder,
  };
}
