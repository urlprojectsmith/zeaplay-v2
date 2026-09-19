import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ErrorCodes } from '../constants/error-codes';
import { REQUEST_ID_HEADER } from '../middleware/correlation.middleware';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = String(
      request.headers[REQUEST_ID_HEADER] ?? response.getHeader(REQUEST_ID_HEADER) ?? '',
    );
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    response.status(status).json({
      code: this.resolveCode(status, exceptionResponse),
      message: this.resolveMessage(exceptionResponse, status),
      requestId,
      validation: this.resolveValidation(exceptionResponse),
      details: this.resolveDetails(exceptionResponse),
    });
  }

  private resolveCode(status: number, exceptionResponse: unknown) {
    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse &&
      'code' in exceptionResponse &&
      typeof (exceptionResponse as { code: unknown }).code === 'string'
    ) {
      return (exceptionResponse as { code: string }).code;
    }
    if (status === HttpStatus.BAD_REQUEST) return ErrorCodes.VALIDATION_ERROR;
    if (status === HttpStatus.UNAUTHORIZED) return ErrorCodes.UNAUTHENTICATED;
    if (status === HttpStatus.FORBIDDEN) return ErrorCodes.UNAUTHORIZED;
    if (status === HttpStatus.NOT_FOUND) return ErrorCodes.NOT_FOUND;
    if (status === HttpStatus.CONFLICT) return ErrorCodes.CONFLICT;
    if (status === HttpStatus.TOO_MANY_REQUESTS) return ErrorCodes.RATE_LIMITED;
    if (status === HttpStatus.UNPROCESSABLE_ENTITY) return ErrorCodes.VALIDATION_ERROR;
    return ErrorCodes.INTERNAL_SERVER_ERROR;
  }

  private resolveMessage(exceptionResponse: unknown, status: number) {
    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse &&
      'message' in exceptionResponse
    ) {
      const message = (exceptionResponse as { message: unknown }).message;
      return Array.isArray(message) ? 'Validation failed.' : String(message);
    }
    return status === HttpStatus.INTERNAL_SERVER_ERROR
      ? 'An unexpected error occurred.'
      : 'Request failed.';
  }

  private resolveValidation(exceptionResponse: unknown) {
    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse &&
      'message' in exceptionResponse
    ) {
      const message = (exceptionResponse as { message: unknown }).message;
      return Array.isArray(message) ? message : undefined;
    }
    return undefined;
  }

  private resolveDetails(exceptionResponse: unknown) {
    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse &&
      'details' in exceptionResponse
    ) {
      return (exceptionResponse as { details: unknown }).details;
    }
    return undefined;
  }
}
