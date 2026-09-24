import { Injectable } from '@nestjs/common';
import { CloudDriveProvider } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  baseCapabilities,
  type CloudDriveFile,
  type CloudDriveProviderAdapter,
  type CloudDriveTokenSet,
  type CloudDriveUploadInput,
  type CloudDriveUploadResult,
} from './cloud-drive-provider.interface';
import { authHeaders, fetchJson, fetchStream, formBody, safeWebUrl } from './provider-http';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

@Injectable()
export class GoogleDriveAdapter implements CloudDriveProviderAdapter {
  readonly provider = CloudDriveProvider.GOOGLE_DRIVE;
  readonly capabilities = { ...baseCapabilities, revoke: true };

  configured() {
    return Boolean(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET);
  }

  getAuthorizationUrl(input: { state: string; redirectUri: string; codeChallenge?: string }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_DRIVE_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', DRIVE_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
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
    const token = await fetchJson<GoogleTokenResponse>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: formBody({
        client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
        client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
        code: input.code,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: input.codeVerifier ?? undefined,
      }),
    });
    return this.toTokenSet(token);
  }

  async refreshAccessToken(refreshToken: string) {
    const token = await fetchJson<GoogleTokenResponse>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: formBody({
        client_id: process.env.GOOGLE_DRIVE_CLIENT_ID,
        client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    return this.toTokenSet(token);
  }

  async revokeConnection(accessToken: string, refreshToken?: string | null) {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken ?? accessToken)}`,
      {
        method: 'POST',
      },
    ).catch(() => undefined);
  }

  async listFiles(input: {
    accessToken: string;
    folderId?: string | null;
    cursor?: string | null;
    pageSize: number;
    foldersOnly?: boolean;
  }) {
    const parent = input.folderId || 'root';
    const query = [`'${escapeDriveQuery(parent)}' in parents`, 'trashed = false'];
    if (input.foldersOnly) query.push(`mimeType = '${FOLDER_MIME}'`);
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set(
      'fields',
      'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink)',
    );
    url.searchParams.set('pageSize', String(Math.min(input.pageSize, 100)));
    url.searchParams.set('q', query.join(' and '));
    if (input.cursor) url.searchParams.set('pageToken', input.cursor);
    const result = await fetchJson<GoogleListResponse>(url.toString(), {
      headers: authHeaders(input.accessToken),
    });
    return {
      items: (result.files ?? []).map((file) => normalizeGoogleFile(file)),
      nextCursor: result.nextPageToken ?? null,
    };
  }

  async getFileMetadata(accessToken: string, providerFileId: string) {
    const url = new URL(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(providerFileId)}`,
    );
    url.searchParams.set('fields', 'id,name,mimeType,size,modifiedTime,parents,webViewLink');
    return normalizeGoogleFile(
      await fetchJson<GoogleFile>(url.toString(), { headers: authHeaders(accessToken) }),
    );
  }

  downloadFileStream(accessToken: string, providerFileId: string) {
    return fetchStream(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(providerFileId)}?alt=media`,
      { headers: authHeaders(accessToken) },
    );
  }

  async uploadFile(
    accessToken: string,
    input: CloudDriveUploadInput,
  ): Promise<CloudDriveUploadResult> {
    const metadata = {
      name: input.filename,
      parents: input.destinationFolderId ? [input.destinationFolderId] : undefined,
    };
    const boundary = `zea-${randomUUID()}`;
    const prefix = Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\ncontent-type: ${input.mimeType}\r\n\r\n`,
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = ReadableStreamFromParts(prefix, input.body, suffix);
    const url =
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
    const result = await fetchJson<{ id: string; webViewLink?: string }>(url, {
      method: 'POST',
      headers: authHeaders(accessToken, {
        'content-type': `multipart/related; boundary=${boundary}`,
      }),
      body: body as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit);
    return { providerFileId: result.id, providerWebUrl: safeWebUrl(result.webViewLink) };
  }

  private toTokenSet(token: GoogleTokenResponse): CloudDriveTokenSet {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [DRIVE_SCOPE],
    };
  }
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

interface GoogleFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
}

interface GoogleListResponse {
  files?: GoogleFile[];
  nextPageToken?: string;
}

function normalizeGoogleFile(file: GoogleFile): CloudDriveFile {
  const isFolder = file.mimeType === FOLDER_MIME;
  return {
    providerFileId: file.id,
    name: file.name,
    mimeType: file.mimeType ?? null,
    sizeBytes: file.size ? Number(file.size) : null,
    isFolder,
    modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
    parentId: file.parents?.[0] ?? null,
    providerWebUrl: safeWebUrl(file.webViewLink),
    downloadable: !isFolder,
  };
}

function escapeDriveQuery(value: string) {
  return value.replace(/['\\]/g, '\\$&');
}

function ReadableStreamFromParts(prefix: Buffer, body: NodeJS.ReadableStream, suffix: Buffer) {
  return (async function* () {
    yield prefix;
    for await (const chunk of body) yield chunk;
    yield suffix;
  })();
}
