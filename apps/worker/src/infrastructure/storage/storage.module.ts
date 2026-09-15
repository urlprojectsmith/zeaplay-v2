import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { WORKER_STORAGE } from './storage.tokens';

@Global()
@Module({
  providers: [StorageService, { provide: WORKER_STORAGE, useExisting: StorageService }],
  exports: [StorageService, WORKER_STORAGE],
})
export class StorageModule {}
