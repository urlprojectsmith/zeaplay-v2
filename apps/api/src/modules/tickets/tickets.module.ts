import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AutomationModule } from '../automation/automation.module';
import { GamificationModule } from '../gamification/gamification.module';
import { TicketSlaSchedulerService } from './ticket-sla-scheduler.service';
import { TicketSlaService } from './ticket-sla.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AuditModule, GamificationModule, AutomationModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketSlaService, TicketSlaSchedulerService],
  exports: [TicketSlaService],
})
export class TicketsModule {}
