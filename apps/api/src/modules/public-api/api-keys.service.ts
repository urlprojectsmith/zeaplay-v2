import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AgencyStatus,
  ApiKeyStatus,
  Prisma,
  SuperAgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { validateEnvironment } from '@zea-play/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  PUBLIC_API_ACTIVE_KEY_LIMIT,
  PUBLIC_API_KEY_PREFIX,
  PUBLIC_API_LAST_USED_THROTTLE_SECONDS,
  PUBLIC_API_SCOPE_SET,
  type PublicApiScope,
} from './public-api.constants';
import type { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import type { PublicApiPrincipal } from './public-api.types';

const KEY_SECRET_BYTES = 32;
const KEY_ID_BYTES = 10;

@Injectable()
export class ApiKeysService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenant: WorkspaceTenantContext, dto: CreateApiKeyDto) {
    const membershipId = this.requireActiveWorkspaceMembership(tenant);
    const expiresAt = parseFutureExpiry(dto.expiresAt);
    const scopes = validateScopes(dto.scopes);
    const { publicIdentifier, prefix, plaintext, secretHash } = generateApiKey();

    const apiKey = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`api-key-cap:${tenant.workspaceId}`}))::text AS lock
      `;
      const activeCount = await tx.apiKey.count({
        where: {
          workspaceId: tenant.workspaceId,
          status: ApiKeyStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (activeCount >= PUBLIC_API_ACTIVE_KEY_LIMIT) {
        throw new ConflictException('API_KEY_LIMIT_REACHED');
      }
      return tx.apiKey.create({
        data: {
          workspaceId: tenant.workspaceId,
          name: dto.name,
          description: dto.description || null,
          publicIdentifier,
          prefix,
          secretHash,
          scopes,
          expiresAt,
          createdByMembershipId: membershipId,
        },
        select: apiKeySelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'api_key.created',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      metadata: {
        apiKeyId: apiKey.id,
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt?.toISOString() ?? null,
        createdByMembershipId: membershipId,
      },
    });

    return {
      ...serializeApiKey(apiKey),
      plaintextApiKey: plaintext,
    };
  }

  async list(tenant: WorkspaceTenantContext, query: { page: number; pageSize: number }) {
    this.requireActiveWorkspaceMembership(tenant);
    const where = { workspaceId: tenant.workspaceId } satisfies Prisma.ApiKeyWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.apiKey.findMany({
        where,
        select: apiKeySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.apiKey.count({ where }),
    ]);
    return {
      items: items.map(serializeApiKey),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async update(tenant: WorkspaceTenantContext, apiKeyId: string, dto: UpdateApiKeyDto) {
    this.requireActiveWorkspaceMembership(tenant);
    const scopes = dto.scopes ? validateScopes(dto.scopes) : undefined;
    const expiresAt = dto.expiresAt === undefined ? undefined : parseFutureExpiry(dto.expiresAt);
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, workspaceId: tenant.workspaceId },
      select: apiKeySelect,
    });
    if (!existing) throw new BadRequestException('API_KEY_NOT_FOUND');
    if (existing.status !== ApiKeyStatus.ACTIVE)
      throw new BadRequestException('API_KEY_NOT_ACTIVE');
    const updated = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(scopes ? { scopes } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      },
      select: apiKeySelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'api_key.updated',
      entityType: 'ApiKey',
      entityId: updated.id,
      metadata: {
        apiKeyId: updated.id,
        prefix: updated.prefix,
        scopes: updated.scopes,
        expiresAt: updated.expiresAt?.toISOString() ?? null,
      },
    });
    return serializeApiKey(updated);
  }

  async revoke(tenant: WorkspaceTenantContext, apiKeyId: string) {
    this.requireActiveWorkspaceMembership(tenant);
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, workspaceId: tenant.workspaceId },
      select: { id: true, status: true, prefix: true },
    });
    if (!existing) throw new BadRequestException('API_KEY_NOT_FOUND');
    if (existing.status === ApiKeyStatus.REVOKED)
      return { id: existing.id, status: existing.status };
    const revoked = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
      select: apiKeySelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'api_key.revoked',
      entityType: 'ApiKey',
      entityId: revoked.id,
      metadata: { apiKeyId: revoked.id, prefix: revoked.prefix },
    });
    return serializeApiKey(revoked);
  }

  async authenticate(authorization: string | undefined): Promise<PublicApiPrincipal> {
    const parsed = parseAuthorization(authorization);
    if (!parsed) throw new UnauthorizedException('PUBLIC_API_AUTHENTICATION_FAILED');
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { publicIdentifier: parsed.publicIdentifier },
      select: {
        ...apiKeySelect,
        secretHash: true,
        workspace: {
          select: {
            id: true,
            agencyId: true,
            status: true,
            agency: {
              select: {
                status: true,
                superAgency: { select: { status: true } },
              },
            },
          },
        },
        createdByMembership: {
          select: {
            id: true,
            userId: true,
            status: true,
            roleId: true,
            role: { select: { key: true } },
          },
        },
      },
    });
    if (!apiKey || !verifySecret(parsed.secret, apiKey.secretHash)) {
      throw new UnauthorizedException('PUBLIC_API_AUTHENTICATION_FAILED');
    }
    if (
      apiKey.status !== ApiKeyStatus.ACTIVE ||
      !hasActiveHierarchy(apiKey.workspace) ||
      (apiKey.expiresAt && apiKey.expiresAt <= new Date())
    ) {
      throw new UnauthorizedException('PUBLIC_API_AUTHENTICATION_FAILED');
    }

    const scopes = validateScopes(apiKey.scopes);
    const tenant: WorkspaceTenantContext = {
      userId: apiKey.createdByMembership.userId,
      agencyId: apiKey.workspace.agencyId,
      workspaceId: apiKey.workspaceId,
      workspaceMembershipId: apiKey.createdByMembership.id,
      agencyMembershipId: null,
      roleId: apiKey.createdByMembership.roleId,
      roleName: 'API_KEY',
      permissions: internalPermissionsForScopes(scopes),
      accessSource: 'WORKSPACE_MEMBERSHIP',
    };
    return {
      apiKeyId: apiKey.id,
      workspaceId: apiKey.workspaceId,
      agencyId: apiKey.workspace.agencyId,
      createdByMembershipId: apiKey.createdByMembership.id,
      createdByUserId: apiKey.createdByMembership.userId,
      prefix: apiKey.prefix,
      scopes,
      tenant,
    };
  }

  async touchLastUsed(apiKeyId: string) {
    const cutoff = new Date(Date.now() - PUBLIC_API_LAST_USED_THROTTLE_SECONDS * 1000);
    await this.prisma.apiKey.updateMany({
      where: {
        id: apiKeyId,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }],
      },
      data: { lastUsedAt: new Date() },
    });
  }

  async cleanupExpiredIdempotencyRecords(limit = 500) {
    const records = await this.prisma.apiIdempotencyRecord.findMany({
      where: { expiresAt: { lt: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    if (records.length === 0) return { deleted: 0 };
    const result = await this.prisma.apiIdempotencyRecord.deleteMany({
      where: { id: { in: records.map((record) => record.id) } },
    });
    return { deleted: result.count };
  }

  private requireActiveWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId || tenant.accessSource !== 'WORKSPACE_MEMBERSHIP') {
      throw new BadRequestException('ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return tenant.workspaceMembershipId;
  }
}

const apiKeySelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  prefix: true,
  status: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  createdByMembership: {
    select: {
      id: true,
      user: { select: { id: true, email: true, name: true } },
    },
  },
} satisfies Prisma.ApiKeySelect;

function generateApiKey() {
  const publicIdentifier = randomBytes(KEY_ID_BYTES).toString('base64url');
  const secret = randomBytes(KEY_SECRET_BYTES).toString('base64url');
  const prefix = `${PUBLIC_API_KEY_PREFIX}_${publicIdentifier}`;
  const plaintext = `${prefix}_${secret}`;
  return {
    publicIdentifier,
    prefix,
    plaintext,
    secretHash: hashSecret(secret),
  };
}

function parseAuthorization(value: string | undefined) {
  if (!value?.startsWith('Bearer ')) return null;
  const key = value.slice('Bearer '.length).trim();
  const match = /^zea_live_([A-Za-z0-9_-]{10,32})_([A-Za-z0-9_-]{32,80})$/.exec(key);
  if (!match) return null;
  return { publicIdentifier: match[1]!, secret: match[2]! };
}

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function verifySecret(secret: string, expectedHash: string) {
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validateScopes(scopes: string[]): PublicApiScope[] {
  const normalized = [...new Set(scopes)];
  if (normalized.length === 0 || normalized.some((scope) => !PUBLIC_API_SCOPE_SET.has(scope))) {
    throw new BadRequestException('PUBLIC_API_SCOPE_UNSUPPORTED');
  }
  return normalized.sort() as PublicApiScope[];
}

function parseFutureExpiry(value: string | null | undefined) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new BadRequestException('API_KEY_EXPIRY_INVALID');
  }
  return expiresAt;
}

function serializeApiKey(apiKey: Prisma.ApiKeyGetPayload<{ select: typeof apiKeySelect }>) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    description: apiKey.description,
    prefix: apiKey.prefix,
    maskedKey: `${apiKey.prefix}_...`,
    status: effectiveStatus(apiKey.status, apiKey.expiresAt),
    scopes: apiKey.scopes,
    expiresAt: apiKey.expiresAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    createdAt: apiKey.createdAt,
    createdBy: {
      membershipId: apiKey.createdByMembership.id,
      userId: apiKey.createdByMembership.user.id,
      email: apiKey.createdByMembership.user.email,
      name: apiKey.createdByMembership.user.name,
    },
  };
}

function effectiveStatus(status: ApiKeyStatus, expiresAt: Date | null) {
  if (status === ApiKeyStatus.ACTIVE && expiresAt && expiresAt <= new Date()) {
    return ApiKeyStatus.EXPIRED;
  }
  return status;
}

function hasActiveHierarchy(workspace: {
  status: WorkspaceStatus;
  agency: { status: AgencyStatus; superAgency: { status: SuperAgencyStatus } };
}) {
  return (
    workspace.status === WorkspaceStatus.ACTIVE &&
    workspace.agency.status === AgencyStatus.ACTIVE &&
    workspace.agency.superAgency.status === SuperAgencyStatus.ACTIVE
  );
}

function internalPermissionsForScopes(scopes: PublicApiScope[]) {
  const permissions = new Set<string>();
  for (const scope of scopes) {
    if (scope === 'tasks.read' || scope === 'tasks.write') permissions.add('tasks.view');
    if (scope === 'tasks.write') {
      permissions.add('tasks.create');
      permissions.add('tasks.update');
      permissions.add('tasks.assign');
    }
    if (scope === 'projects.read' || scope === 'projects.write') permissions.add('projects.view');
    if (scope === 'projects.write') {
      permissions.add('projects.create');
      permissions.add('projects.update');
      permissions.add('projects.manage_status');
      permissions.add('projects.manage_members');
      permissions.add('projects.manage_owner');
      permissions.add('tags.assign');
      permissions.add('tasks.assign');
    }
    if (scope === 'tickets.read' || scope === 'tickets.write') permissions.add('tickets.view');
    if (scope === 'tickets.write') {
      permissions.add('tickets.create');
      permissions.add('tickets.update');
      permissions.add('tickets.assign');
      permissions.add('tickets.manage_requester');
    }
  }
  return [...permissions];
}
