import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from '../api-keys.service';

@Injectable()
export class PublicApiAuthGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { publicApi?: unknown; tenant?: unknown }>();
    const principal = await this.apiKeys.authenticate(request.header('authorization'));
    request.publicApi = principal;
    request.tenant = principal.tenant;
    await this.apiKeys.touchLastUsed(principal.apiKeyId).catch(() => undefined);
    return true;
  }
}
