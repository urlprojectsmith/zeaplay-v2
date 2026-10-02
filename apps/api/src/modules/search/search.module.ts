import { Module } from '@nestjs/common';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import {
  AgencySearchController,
  PlatformSearchController,
  SearchRegistryController,
  SuperAgencySearchController,
  WorkspaceSearchController,
} from './search.controller';
import { SearchPlatformGuard } from './search-platform.guard';
import { SearchService } from './search.service';

@Module({
  imports: [QueueModule, RedisModule],
  controllers: [
    SearchRegistryController,
    WorkspaceSearchController,
    AgencySearchController,
    SuperAgencySearchController,
    PlatformSearchController,
  ],
  providers: [SearchService, SearchPlatformGuard],
  exports: [SearchService],
})
export class SearchModule {}
