import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { TasksService } from './tasks.service';

@ApiTags('user time tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/time-tracking')
export class MeTimeTrackingController {
  constructor(private readonly tasks: TasksService) {}

  @Get('active')
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.getActiveTimer(user.id);
  }

  @Post('active/stop')
  stop(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.stopMyActiveTimer(user.id);
  }
}
