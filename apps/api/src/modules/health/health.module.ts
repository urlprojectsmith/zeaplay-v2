import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MonitoringModule } from '../../infrastructure/monitoring/monitoring.module';

@Module({
  imports: [MonitoringModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
