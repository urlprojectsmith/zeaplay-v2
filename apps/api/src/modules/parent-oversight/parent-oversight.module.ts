import { Module } from '@nestjs/common';
import {
  AgencyParentOversightController,
  SuperAgencyParentOversightController,
} from './parent-oversight.controller';
import { ParentOversightService } from './parent-oversight.service';

@Module({
  controllers: [AgencyParentOversightController, SuperAgencyParentOversightController],
  providers: [ParentOversightService],
})
export class ParentOversightModule {}
