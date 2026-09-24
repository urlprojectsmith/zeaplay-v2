import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../../common/middleware/correlation.middleware';

@Catch()
export class PublicApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const requestId = String(
      request.headers[REQUEST_ID_HEADER] ?? response.getHeader(REQUEST_ID_HEADER) ?? '',
    );

    if (status === HttpStatus.TOO_MANY_REQUESTS) response.setHeader('Retry-After', '60');

    response.status(status).json({
      error: {
        code: resolveCode(status, body),
        message: resolveMessage(status, body),
      },
      requestId,
    });
  }
}

function resolveCode(status: number, body: unknown) {
  if (typeof body === 'object' && body && 'code' in body && typeof body.code === 'string') {
    return body.code;
  }
  if (status === HttpStatus.UNAUTHORIZED) return 'PUBLIC_API_AUTHENTICATION_FAILED';
  if (status === HttpStatus.FORBIDDEN) return 'PUBLIC_API_SCOPE_REQUIRED';
  if (status === HttpStatus.NOT_FOUND) return 'RESOURCE_NOT_FOUND';
  if (status === HttpStatus.CONFLICT) return 'IDEMPOTENCY_KEY_REUSED';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMIT_EXCEEDED';
  if (status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY) {
    return 'VALIDATION_ERROR';
  }
  return 'PUBLIC_API_ERROR';
}

function resolveMessage(status: number, body: unknown) {
  if (typeof body === 'object' && body && 'message' in body) {
    const message = body.message;
    return Array.isArray(message) ? 'Validation failed.' : String(message);
  }
  if (status === HttpStatus.INTERNAL_SERVER_ERROR) return 'An unexpected error occurred.';
  return 'Request failed.';
}
