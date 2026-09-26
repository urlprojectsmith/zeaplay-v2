import { Module } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { AuditModule } from '../audit/audit.module';
import {
  AgencyGoalsOversightController,
  SuperAgencyGoalsOversightController,
  WorkspaceGoalsController,
} from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [AuditModule, AutomationModule],
  controllers: [
    WorkspaceGoalsController,
    AgencyGoalsOversightController,
    SuperAgencyGoalsOversightController,
  ],
  providers: [GoalsService],
  exports: [GoalsService],
})
export class GoalsModule {}
