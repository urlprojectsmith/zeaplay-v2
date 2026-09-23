import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [AuditModule],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule {}
