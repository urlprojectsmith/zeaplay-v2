import { Global, Module } from '@nestjs/common';
import { MinioStorageAdapter } from './minio-storage.adapter';
import { STORAGE_ADAPTER } from './storage.tokens';

@Global()
@Module({
  providers: [{ provide: STORAGE_ADAPTER, useClass: MinioStorageAdapter }],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
