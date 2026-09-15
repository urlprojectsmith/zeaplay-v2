import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { map, Observable } from 'rxjs';
import { REQUEST_ID_HEADER } from '../middleware/correlation.middleware';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = String(request.headers[REQUEST_ID_HEADER] ?? '');

    if (request.path.endsWith('/metrics')) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'data' in data && 'requestId' in data) {
          return data;
        }

        return { data, requestId };
      }),
    );
  }
}
