import { Module } from '@nestjs/common';
import { DeveloperDiagnosticsGuard } from '../../common/authorization/developer-diagnostics.guard';
import { MailModule } from '../../infrastructure/mail/mail.module';
import { AgenciesModule } from '../agencies/agencies.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import {
  SuperAgenciesController,
  SuperAgencyInvitationsController,
  SuperAgencyTenantController,
} from './super-agencies.controller';
import { SuperAgenciesService } from './super-agencies.service';

@Module({
  imports: [MailModule, AgenciesModule, WorkspacesModule],
  controllers: [
    SuperAgenciesController,
    SuperAgencyTenantController,
    SuperAgencyInvitationsController,
  ],
  providers: [SuperAgenciesService, DeveloperDiagnosticsGuard],
  exports: [SuperAgenciesService],
})
export class SuperAgenciesModule {}
