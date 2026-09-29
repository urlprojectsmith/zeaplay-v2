import { Module } from '@nestjs/common';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { AccountContextController } from './account-context.controller';
import { AccountContextService } from './account-context.service';

@Module({
  controllers: [AccountContextController],
  providers: [AccountContextService, TenantContextService],
})
export class AccountContextModule {}
