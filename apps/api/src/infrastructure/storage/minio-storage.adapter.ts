import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { Client } from 'minio';
import { validateEnvironment } from '@zea-play/config';
import type {
  StorageAdapter,
  StorageObjectMetadata,
  StorageUploadOptions,
} from './storage-adapter';

const MAX_OBJECT_KEY_LENGTH = 512;
const MIN_PRESIGNED_EXPIRY_SECONDS = 60;
const MAX_PRESIGNED_EXPIRY_SECONDS = 3_600;

@Injectable()
export class MinioStorageAdapter implements StorageAdapter {
  private readonly env = validateEnvironment(process.env);
  private readonly bucket = this.env.MINIO_BUCKET;
  private readonly client = new Client({
    endPoint: this.env.MINIO_ENDPOINT,
    port: this.env.MINIO_PORT,
    useSSL: this.env.MINIO_USE_SSL,
    accessKey: this.env.MINIO_ACCESS_KEY,
    secretKey: this.env.MINIO_SECRET_KEY,
  });

  async upload(
    key: string,
    body: Buffer | Readable,
    options: StorageUploadOptions = {},
  ): Promise<void> {
    const safeKey = normalizeObjectKey(key);
    await this.client.putObject(this.bucket, safeKey, body, undefined, buildMetadata(options));
  }

  async delete(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, normalizeObjectKey(key));
  }

  createPresignedUploadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return this.client.presignedPutObject(
      this.bucket,
      normalizeObjectKey(key),
      normalizeExpiry(expiresInSeconds),
    );
  }

  createPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return this.client.presignedGetObject(
      this.bucket,
      normalizeObjectKey(key),
      normalizeExpiry(expiresInSeconds),
    );
  }

  async getMetadata(key: string): Promise<StorageObjectMetadata> {
    const safeKey = normalizeObjectKey(key);
    const metadata = await this.client.statObject(this.bucket, safeKey);
    return {
      key: safeKey,
      size: metadata.size,
      contentType: metadata.metaData?.['content-type'],
      fileName: metadata.metaData?.['x-amz-meta-file-name'],
      etag: metadata.etag,
    };
  }

  async getObject(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, normalizeObjectKey(key));
  }

  async isHealthy(): Promise<boolean> {
    await this.client.bucketExists(this.bucket);
    return true;
  }
}

function normalizeObjectKey(key: string): string {
  const normalized = key.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_OBJECT_KEY_LENGTH ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('..') ||
    hasControlCharacters(normalized)
  ) {
    throw new Error('Invalid storage object key.');
  }

  return normalized;
}

function normalizeExpiry(expiresInSeconds: number): number {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < MIN_PRESIGNED_EXPIRY_SECONDS ||
    expiresInSeconds > MAX_PRESIGNED_EXPIRY_SECONDS
  ) {
    throw new Error('Presigned URL expiry must be between 60 and 3600 seconds.');
  }

  return expiresInSeconds;
}

function buildMetadata(options: StorageUploadOptions): Record<string, string> | undefined {
  const metadata: Record<string, string> = {};

  if (options.contentType) {
    metadata['content-type'] = sanitizeHeaderValue(options.contentType);
  }

  if (options.fileName) {
    metadata['x-amz-meta-file-name'] = sanitizeFileName(options.fileName);
  }

  for (const [key, value] of Object.entries(options.metadata ?? {})) {
    if (/^[a-z0-9-]{1,64}$/i.test(key)) {
      metadata[`x-amz-meta-${key.toLowerCase()}`] = sanitizeHeaderValue(value);
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sanitizeFileName(fileName: string): string {
  return sanitizeHeaderValue(fileName.replace(/[\\/]/g, '').trim()).slice(0, 255);
}

function sanitizeHeaderValue(value: string): string {
  return Array.from(value)
    .filter((character) => !hasControlCharacters(character))
    .join('')
    .trim();
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}
