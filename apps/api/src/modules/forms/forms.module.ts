import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { AssetsModule } from '../assets/assets.module';
import { AutomationModule } from '../automation/automation.module';
import { BrandingModule } from '../branding/branding.module';
import {
  AgencyFormsOversightController,
  PublicFormsController,
  SuperAgencyFormsOversightController,
  WorkspaceFormsController,
} from './forms.controller';
import { FormsCaptchaService } from './forms-captcha.service';
import { FormsRateLimitService } from './forms-rate-limit.service';
import { FormsService } from './forms.service';

@Module({
  imports: [AssetsModule, AutomationModule, RedisModule, BrandingModule],
  controllers: [
    WorkspaceFormsController,
    PublicFormsController,
    AgencyFormsOversightController,
    SuperAgencyFormsOversightController,
  ],
  providers: [FormsService, FormsRateLimitService, FormsCaptchaService],
  exports: [FormsService],
})
export class FormsModule {}
