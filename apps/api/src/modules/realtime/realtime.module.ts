import { Global, Module } from '@nestjs/common';
import { SecurityModule } from '../../common/security.module';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  imports: [DatabaseModule, SecurityModule],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
