import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { JwtTokenService } from './auth/jwt.service';
import { PasswordService } from './auth/password.service';
import { PermissionGuard } from './authorization/permission.guard';
import {
  AgencyTenantGuard,
  SuperAgencyTenantGuard,
  TenantContextGuard,
} from './tenant/tenant-context.guard';
import { TenantContextService } from './tenant/tenant-context.service';
import { TenantHierarchyService } from './tenant/tenant-hierarchy.service';

@Global()
@Module({
  providers: [
    JwtTokenService,
    PasswordService,
    JwtAuthGuard,
    TenantContextService,
    TenantHierarchyService,
    TenantContextGuard,
    AgencyTenantGuard,
    SuperAgencyTenantGuard,
    PermissionGuard,
  ],
  exports: [
    JwtTokenService,
    PasswordService,
    JwtAuthGuard,
    TenantContextService,
    TenantHierarchyService,
    TenantContextGuard,
    AgencyTenantGuard,
    SuperAgencyTenantGuard,
    PermissionGuard,
  ],
})
export class SecurityModule {}
