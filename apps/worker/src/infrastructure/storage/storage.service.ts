import { Injectable } from '@nestjs/common';
import { Client } from 'minio';
import type { Readable } from 'node:stream';
import { validateEnvironment } from '@zea-play/config';

@Injectable()
export class StorageService {
  private readonly env = validateEnvironment(process.env);
  private readonly client = new Client({
    endPoint: this.env.MINIO_ENDPOINT,
    port: this.env.MINIO_PORT,
    useSSL: this.env.MINIO_USE_SSL,
    accessKey: this.env.MINIO_ACCESS_KEY,
    secretKey: this.env.MINIO_SECRET_KEY,
  });

  async statObject(key: string) {
    return this.client.statObject(this.env.MINIO_BUCKET, key);
  }

  async getObject(key: string): Promise<Readable> {
    return this.client.getObject(this.env.MINIO_BUCKET, key);
  }

  async upload(
    key: string,
    body: Buffer | Readable,
    options?: { contentType?: string; fileName?: string },
  ): Promise<void> {
    await this.client.putObject(
      this.env.MINIO_BUCKET,
      key,
      body,
      body instanceof Buffer ? body.length : undefined,
      {
        'Content-Type': options?.contentType ?? 'application/octet-stream',
        ...(options?.fileName
          ? { 'Content-Disposition': `attachment; filename="${options.fileName}"` }
          : {}),
      },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.removeObject(this.env.MINIO_BUCKET, key);
  }
}
