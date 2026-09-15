import type { Readable } from 'node:stream';

export interface StorageObjectMetadata {
  key: string;
  size: number;
  contentType?: string;
  fileName?: string;
  etag?: string;
}

export interface StorageUploadOptions {
  contentType?: string;
  fileName?: string;
  metadata?: Record<string, string>;
}

export interface StorageAdapter {
  upload(key: string, body: Buffer | Readable, options?: StorageUploadOptions): Promise<void>;
  delete(key: string): Promise<void>;
  createPresignedUploadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  createPresignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getMetadata(key: string): Promise<StorageObjectMetadata>;
  getObject(key: string): Promise<Readable>;
  isHealthy(): Promise<boolean>;
}
