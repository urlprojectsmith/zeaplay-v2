import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { AccountContextService } from './account-context.service';
import {
  AccountContextAgencyQueryDto,
  AccountContextSubaccountQueryDto,
  ReturnAccountContextDto,
  SwitchAccountContextDto,
} from './dto/account-context.dto';

@ApiTags('account-context')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('account-context')
export class AccountContextController {
  constructor(private readonly accountContext: AccountContextService) {}

  @Get('agencies')
  listAgencies(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AccountContextAgencyQueryDto,
  ) {
    return this.accountContext.listAgencies(user, query);
  }

  @Get('subaccounts')
  listSubaccounts(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AccountContextSubaccountQueryDto,
  ) {
    return this.accountContext.listSubaccounts(user, query);
  }

  @Post('switch')
  switchContext(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchAccountContextDto,
    @Req() request: Request,
  ) {
    return this.accountContext.switchContext(user, dto, requestMeta(request));
  }

  @Post('validate')
  validateContext(@CurrentUser() user: AuthenticatedUser, @Body() dto: SwitchAccountContextDto) {
    return this.accountContext.validateContext(user, dto);
  }

  @Post('return')
  returnContext(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReturnAccountContextDto,
    @Req() request: Request,
  ) {
    return this.accountContext.returnContext(user, dto, requestMeta(request));
  }
}

function requestMeta(request: Request) {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent'),
  };
}
