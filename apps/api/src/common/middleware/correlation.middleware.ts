import type { NextFunction, Request, Response } from 'express';
import { Injectable, NestMiddleware } from '@nestjs/common';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const inboundCorrelation = req.header(CORRELATION_ID_HEADER);
    const requestId = safeRequestIdentifier(req.header(REQUEST_ID_HEADER)) ?? crypto.randomUUID();
    const correlationId = safeRequestIdentifier(inboundCorrelation) ?? requestId;

    req.headers[REQUEST_ID_HEADER] = requestId;
    req.headers[CORRELATION_ID_HEADER] = correlationId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  }
}

function safeRequestIdentifier(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}
