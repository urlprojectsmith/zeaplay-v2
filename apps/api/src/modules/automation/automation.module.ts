import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationActionService } from './automation-action.service';
import { AutomationDomainEventsService } from './automation-domain-events.service';
import { AutomationExecutionProcessor } from './automation-execution.processor';
import { AutomationTemplateController } from './automation-template.controller';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [AuditModule],
  controllers: [AutomationController, AutomationTemplateController],
  providers: [
    AutomationService,
    AutomationDomainEventsService,
    AutomationActionService,
    AutomationExecutionService,
    AutomationExecutionProcessor,
  ],
  exports: [AutomationDomainEventsService, AutomationActionService, AutomationExecutionService],
})
export class AutomationModule {}
