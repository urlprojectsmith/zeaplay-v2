import type { Readable } from 'node:stream';
import { CloudDriveProvider } from '@prisma/client';

export interface CloudDriveCapabilities {
  oauth: boolean;
  refreshToken: boolean;
  revoke: boolean;
  listFiles: boolean;
  listFolders: boolean;
  getFileMetadata: boolean;
  downloadFile: boolean;
  uploadFile: boolean;
  createFolder: boolean;
}

export interface CloudDriveAuthorizationRequest {
  state: string;
  redirectUri: string;
  codeChallenge?: string;
}

export interface CloudDriveTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes: string[];
  providerAccountId?: string | null;
  providerAccountLabel?: string | null;
}

export interface CloudDriveFile {
  providerFileId: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  isFolder: boolean;
  modifiedAt: Date | null;
  parentId: string | null;
  providerWebUrl: string | null;
  downloadable: boolean;
}

export interface CloudDriveListResult {
  items: CloudDriveFile[];
  nextCursor: string | null;
}

export interface CloudDriveUploadInput {
  filename: string;
  mimeType: string;
  body: Readable;
  destinationFolderId?: string | null;
}

export interface CloudDriveUploadResult {
  providerFileId: string;
  providerWebUrl: string | null;
}

export interface CloudDriveProviderAdapter {
  readonly provider: CloudDriveProvider;
  readonly capabilities: CloudDriveCapabilities;
  configured(): boolean;
  getAuthorizationUrl(input: CloudDriveAuthorizationRequest): string;
  exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string | null;
  }): Promise<CloudDriveTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<CloudDriveTokenSet>;
  revokeConnection(accessToken: string, refreshToken?: string | null): Promise<void>;
  listFiles(input: {
    accessToken: string;
    folderId?: string | null;
    cursor?: string | null;
    pageSize: number;
    foldersOnly?: boolean;
  }): Promise<CloudDriveListResult>;
  getFileMetadata(accessToken: string, providerFileId: string): Promise<CloudDriveFile>;
  downloadFileStream(accessToken: string, providerFileId: string): Promise<Readable>;
  uploadFile(accessToken: string, input: CloudDriveUploadInput): Promise<CloudDriveUploadResult>;
}

export const baseCapabilities: CloudDriveCapabilities = {
  oauth: true,
  refreshToken: true,
  revoke: false,
  listFiles: true,
  listFolders: true,
  getFileMetadata: true,
  downloadFile: true,
  uploadFile: true,
  createFolder: false,
};
