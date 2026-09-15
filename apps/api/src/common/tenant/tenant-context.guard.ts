import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithAuth } from '../auth/auth.types';
import { ORGANIZATION_HEADER } from './tenant-context.decorator';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithAuth>();
    if (!request.user) throw new UnauthorizedException('Authentication required.');
    const organizationId = request.header(ORGANIZATION_HEADER);
    if (!organizationId) throw new UnauthorizedException('Organization context required.');
    request.tenant = await this.tenantContext.resolve(request.user.id, organizationId);
    if (
      request.params?.organizationId &&
      request.params.organizationId !== request.tenant.organizationId
    ) {
      throw new ForbiddenException('Organization context does not match the requested resource.');
    }
    return true;
  }
}
