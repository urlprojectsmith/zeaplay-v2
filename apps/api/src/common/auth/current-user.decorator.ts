import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser, RequestWithAuth } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined =>
    ctx.switchToHttp().getRequest<RequestWithAuth>().user,
);
