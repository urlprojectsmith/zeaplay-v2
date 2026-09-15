import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@zea-play/types';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '../middleware/correlation.middleware';

export const ReqContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request & { headers: Record<string, string> }>();
    return {
      requestId: String(request.headers[REQUEST_ID_HEADER] ?? ''),
      correlationId: String(request.headers[CORRELATION_ID_HEADER] ?? ''),
    };
  },
);
