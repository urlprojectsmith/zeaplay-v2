import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TicketSlaSchedulerService } from './ticket-sla-scheduler.service';
import { TicketSlaService } from './ticket-sla.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AuditModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketSlaService, TicketSlaSchedulerService],
  exports: [TicketSlaService],
})
export class TicketsModule {}
