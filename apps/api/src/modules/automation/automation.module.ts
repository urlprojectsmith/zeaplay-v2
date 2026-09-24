import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AutomationActionService } from './automation-action.service';
import { AutomationDomainEventsService } from './automation-domain-events.service';
import { AutomationExecutionProcessor } from './automation-execution.processor';
import { AutomationTemplateController } from './automation-template.controller';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationPolicyService } from './automation-policy.service';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [AuditModule, NotificationsModule, WebhooksModule],
  controllers: [AutomationController, AutomationTemplateController],
  providers: [
    AutomationService,
    AutomationDomainEventsService,
    AutomationActionService,
    AutomationExecutionService,
    AutomationPolicyService,
    AutomationExecutionProcessor,
  ],
  exports: [
    AutomationDomainEventsService,
    AutomationActionService,
    AutomationExecutionService,
    AutomationPolicyService,
  ],
})
export class AutomationModule {}
