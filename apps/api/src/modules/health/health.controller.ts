import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  healthCheck() {
    return this.health.basic();
  }

  @Get('live')
  liveness() {
    return this.health.live();
  }

  @Get('ready')
  readiness() {
    return this.health.ready();
  }
}
