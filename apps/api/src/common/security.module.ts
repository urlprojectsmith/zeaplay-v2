import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { JwtTokenService } from './auth/jwt.service';
import { PasswordService } from './auth/password.service';
import { PermissionGuard } from './authorization/permission.guard';
import { TenantContextGuard } from './tenant/tenant-context.guard';
import { TenantContextService } from './tenant/tenant-context.service';

@Global()
@Module({
  providers: [
    JwtTokenService,
    PasswordService,
    JwtAuthGuard,
    TenantContextService,
    TenantContextGuard,
    PermissionGuard,
  ],
  exports: [
    JwtTokenService,
    PasswordService,
    JwtAuthGuard,
    TenantContextService,
    TenantContextGuard,
    PermissionGuard,
  ],
})
export class SecurityModule {}
