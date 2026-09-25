import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AgencyStatus,
  IntegrationActionStatus,
  IntegrationAuthType,
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
  SuperAgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { validateEnvironment } from '@zea-play/config';
import { createHash, randomBytes } from 'node:crypto';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { sanitizeAuditMetadata } from '../audit/audit.service';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import type { PlanFeatureKey } from '../billing/billing.constants';
import {
  CreateIntegrationConnectionDto,
  ExecuteIntegrationActionDto,
  IntegrationListQueryDto,
  UpdateIntegrationConnectionDto,
} from './dto/integration.dto';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationProviderRegistry } from './integration-provider.registry';
import { IntegrationRateLimitService } from './integration-rate-limit.service';
import type { IntegrationCredentialPayload } from './integration.types';

@Injectable()
export class IntegrationsService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: IntegrationCredentialService,
    private readonly registry: IntegrationProviderRegistry,
    private readonly rateLimit: IntegrationRateLimitService,
    @Optional() private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  listProviders() {
    const encryptionConfigured = this.credentials.isConfigured();
    return this.registry.list().map((provider) => ({
      ...provider,
      configured:
        provider.configured &&
        (encryptionConfigured || provider.authTypes.includes(IntegrationAuthType.NONE)),
    }));
  }

  async list(tenant: WorkspaceTenantContext, query: IntegrationListQueryDto) {
    this.requireActiveWorkspaceMembership(tenant);
    const connections = await this.prisma.integrationConnection.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        ...(query.provider ? { provider: query.provider } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      select: connectionSelect,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 50,
    });
    return connections.map(serializeConnection);
  }

  async get(tenant: WorkspaceTenantContext, integrationId: string) {
    this.requireActiveWorkspaceMembership(tenant);
    const connection = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    return serializeConnection(connection);
  }

  async create(tenant: WorkspaceTenantContext, dto: CreateIntegrationConnectionDto) {
    await this.assertProviderFeatureAvailable(tenant, dto.provider);
    const membershipId = this.requireActiveWorkspaceMembership(tenant);
    if (dto.authType !== IntegrationAuthType.NONE && !this.credentials.isConfigured()) {
      throw new ServiceUnavailableException('INTEGRATION_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
    }
    const adapter = this.registry.get(dto.provider);
    if (!adapter.authTypes.includes(dto.authType)) {
      throw new BadRequestException('INTEGRATION_AUTH_TYPE_UNSUPPORTED');
    }
    const configuration = await adapter.validateConfiguration(dto.configuration ?? {});
    const credentialInput = dto.credentials ?? {};
    const encryptedCredentials =
      dto.authType === IntegrationAuthType.NONE ? null : this.credentials.encrypt(credentialInput);
    const credentialSummary =
      dto.authType === IntegrationAuthType.NONE
        ? { scopes: [], providerAccountId: null, providerAccountLabel: null }
        : summarizeCredentials(credentialInput);
    const connection = await this.prisma.$transaction(async (tx) => {
      await lockIntegrationWorkspace(tx, tenant.workspaceId);
      const existing = await tx.integrationConnection.count({
        where: {
          workspaceId: tenant.workspaceId,
          revokedAt: null,
          status: { notIn: [IntegrationStatus.DISCONNECTED] },
        },
      });
      if (existing >= this.env.INTEGRATION_CONNECTION_LIMIT) {
        throw new ConflictException('INTEGRATION_CONNECTION_LIMIT_REACHED');
      }
      const created = await tx.integrationConnection.create({
        data: {
          workspaceId: tenant.workspaceId,
          provider: dto.provider,
          name: dto.name.trim(),
          authType: dto.authType,
          encryptedCredentials,
          scopes: credentialSummary.scopes,
          capabilities: adapter.capabilities,
          configurationJson: configuration as Prisma.InputJsonValue,
          connectedByMembershipId: membershipId,
          providerAccountId: credentialSummary.providerAccountId,
          providerAccountLabel: credentialSummary.providerAccountLabel,
        },
        select: connectionSelect,
      });
      await auditIntegration(tx, tenant, 'INTEGRATION_CONNECTION_CREATED', created.id, {
        provider: created.provider,
        authType: created.authType,
      });
      return created;
    });
    return serializeConnection(connection);
  }

  async update(
    tenant: WorkspaceTenantContext,
    integrationId: string,
    dto: UpdateIntegrationConnectionDto,
  ) {
    this.requireActiveWorkspaceMembership(tenant);
    const current = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    await this.assertProviderFeatureAvailable(tenant, current.provider);
    const adapter = this.registry.get(current.provider);
    const configuration =
      dto.configuration === undefined
        ? undefined
        : await adapter.validateConfiguration(dto.configuration ?? {});
    const authType = dto.authType ?? current.authType;
    if (!adapter.authTypes.includes(authType)) {
      throw new BadRequestException('INTEGRATION_AUTH_TYPE_UNSUPPORTED');
    }
    if (
      authType !== IntegrationAuthType.NONE &&
      dto.credentials &&
      !this.credentials.isConfigured()
    ) {
      throw new ServiceUnavailableException('INTEGRATION_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
    }
    const encryptedCredentials =
      authType === IntegrationAuthType.NONE
        ? null
        : dto.credentials
          ? this.credentials.encrypt(dto.credentials)
          : undefined;
    const credentialSummary = dto.credentials ? summarizeCredentials(dto.credentials) : undefined;
    const updated = await this.prisma.integrationConnection.update({
      where: { id: current.id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        authType,
        ...(configuration ? { configurationJson: configuration as Prisma.InputJsonValue } : {}),
        ...(encryptedCredentials
          ? {
              encryptedCredentials,
              scopes: credentialSummary?.scopes ?? [],
              providerAccountId: credentialSummary?.providerAccountId,
              providerAccountLabel: credentialSummary?.providerAccountLabel,
              status: IntegrationStatus.CONNECTED,
              revokedAt: null,
              safeErrorCode: null,
            }
          : {}),
        ...(authType === IntegrationAuthType.NONE
          ? {
              encryptedCredentials: null,
              scopes: [],
              providerAccountId: null,
              providerAccountLabel: null,
              status: IntegrationStatus.CONNECTED,
              revokedAt: null,
              safeErrorCode: null,
            }
          : {}),
      },
      select: connectionSelect,
    });
    await auditIntegration(this.prisma, tenant, 'INTEGRATION_CONNECTION_UPDATED', updated.id, {
      provider: updated.provider,
      credentialsReplaced: Boolean(dto.credentials),
    });
    return serializeConnection(updated);
  }

  async disconnect(tenant: WorkspaceTenantContext, integrationId: string) {
    this.requireActiveWorkspaceMembership(tenant);
    await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    const updated = await this.prisma.integrationConnection.update({
      where: { id: integrationId },
      data: {
        status: IntegrationStatus.DISCONNECTED,
        encryptedCredentials: null,
        revokedAt: new Date(),
      },
      select: connectionSelect,
    });
    await auditIntegration(this.prisma, tenant, 'INTEGRATION_CONNECTION_DISCONNECTED', updated.id, {
      provider: updated.provider,
    });
    return serializeConnection(updated);
  }

  async testConnection(tenant: WorkspaceTenantContext, integrationId: string) {
    this.requireActiveWorkspaceMembership(tenant);
    const connection = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    await this.assertProviderFeatureAvailable(tenant, connection.provider);
    assertActiveHierarchy(connection);
    const adapter = this.registry.get(connection.provider);
    const decrypted =
      connection.authType === IntegrationAuthType.NONE
        ? {}
        : this.credentials.decrypt(connection.encryptedCredentials);
    const started = Date.now();
    try {
      const result = await adapter.testConnection({
        connection,
        credentials: credentialsForConnection(connection, decrypted),
      });
      await this.markSuccess(connection.id);
      await auditIntegration(this.prisma, tenant, 'INTEGRATION_CONNECTION_TESTED', connection.id, {
        provider: connection.provider,
        ok: true,
      });
      return { ok: true, durationMs: Date.now() - started, summary: result.summary };
    } catch (error) {
      await this.markFailure(connection.id, safeError(error));
      await auditIntegration(this.prisma, tenant, 'INTEGRATION_CONNECTION_TESTED', connection.id, {
        provider: connection.provider,
        ok: false,
        safeErrorCode: safeError(error),
      });
      throw error;
    }
  }

  async execute(
    tenant: WorkspaceTenantContext,
    integrationId: string,
    capability: string,
    dto: ExecuteIntegrationActionDto,
  ) {
    this.requireActiveWorkspaceMembership(tenant);
    const connection = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    await this.assertProviderFeatureAvailable(tenant, connection.provider);
    assertActiveHierarchy(connection);
    if (connection.status !== IntegrationStatus.CONNECTED || connection.revokedAt) {
      throw new ConflictException('INTEGRATION_CONNECTION_NOT_ACTIVE');
    }
    const adapter = this.registry.get(connection.provider);
    if (
      !connection.capabilities.includes(capability) ||
      !adapter.capabilities.includes(capability)
    ) {
      throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
    }
    await this.rateLimit.assertWithinLimit(tenant.workspaceId, connection.id);
    const input = dto.input ?? {};
    if (isMutationCapability(capability) && dto.idempotencyKey) {
      return this.executeIdempotent(tenant, connection, capability, dto.idempotencyKey, input);
    }
    return this.executeAndRecord(tenant, connection, capability, input);
  }

  async cleanupExpired(limit = 500) {
    const now = new Date();
    const boundedLimit = Math.min(Math.max(limit, 1), 500);
    const cutoff = new Date(
      now.getTime() - this.env.INTEGRATION_ACTION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    return withIntegrationCleanupLock(this.prisma, async () => {
      const [states, idempotency, executions] = await Promise.all([
        this.deleteExpiredOAuthStates(now, boundedLimit),
        this.deleteExpiredIdempotencyRecords(now, boundedLimit),
        this.deleteOldExecutions(cutoff, boundedLimit),
      ]);
      return {
        oauthStates: states,
        idempotencyRecords: idempotency,
        actionExecutions: executions,
      };
    });
  }

  private async executeIdempotent(
    tenant: WorkspaceTenantContext,
    connection: Prisma.IntegrationConnectionGetPayload<{ select: typeof connectionSelect }>,
    capability: string,
    idempotencyKey: string,
    input: Record<string, unknown>,
  ) {
    if (idempotencyKey.length > 200) throw new ConflictException('IDEMPOTENCY_KEY_INVALID');
    const keyHash = hash(idempotencyKey);
    const requestFingerprint = hash(stableStringify(input));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${[
          tenant.workspaceId,
          connection.id,
          capability,
          keyHash,
        ].join(':')}))::text AS lock
      `;
        const existing = await tx.integrationActionIdempotencyRecord.findUnique({
          where: {
            connectionId_capability_idempotencyKeyHash: {
              connectionId: connection.id,
              capability,
              idempotencyKeyHash: keyHash,
            },
          },
        });
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) {
            throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
          }
          if (existing.responseBody && existing.expiresAt > new Date())
            return existing.responseBody;
          throw new ConflictException('IDEMPOTENCY_REQUEST_IN_PROGRESS');
        }
        await tx.integrationActionIdempotencyRecord.create({
          data: {
            workspaceId: tenant.workspaceId,
            connectionId: connection.id,
            capability,
            idempotencyKeyHash: keyHash,
            requestFingerprint,
            expiresAt,
          },
        });
        return null;
      })
      .then(async (cached) => {
        if (cached) return cached;
        const response = await this.executeAndRecord(tenant, connection, capability, input);
        await this.prisma.integrationActionIdempotencyRecord.update({
          where: {
            connectionId_capability_idempotencyKeyHash: {
              connectionId: connection.id,
              capability,
              idempotencyKeyHash: keyHash,
            },
          },
          data: {
            status: IntegrationActionStatus.SUCCEEDED,
            executionId: response.executionId,
            responseBody: response as Prisma.InputJsonValue,
            expiresAt,
          },
        });
        return response;
      });
  }

  private async executeAndRecord(
    tenant: WorkspaceTenantContext,
    connection: Prisma.IntegrationConnectionGetPayload<{ select: typeof connectionSelect }>,
    capability: string,
    input: Record<string, unknown>,
  ) {
    const adapter = this.registry.get(connection.provider);
    const execution = await this.prisma.integrationActionExecution.create({
      data: {
        workspaceId: tenant.workspaceId,
        connectionId: connection.id,
        provider: connection.provider,
        capability,
        actorMembershipId:
          tenant.accessSource === 'WORKSPACE_MEMBERSHIP' ? tenant.workspaceMembershipId : null,
        requestSummaryJson: sanitizeRequest(input) as Prisma.InputJsonValue,
      },
    });
    const started = Date.now();
    try {
      const result = await adapter.execute({
        connection,
        credentials: credentialsForConnection(
          connection,
          connection.authType === IntegrationAuthType.NONE
            ? {}
            : this.credentials.decrypt(connection.encryptedCredentials),
        ),
        capability,
        input,
      });
      const body = {
        executionId: execution.id,
        status: IntegrationActionStatus.SUCCEEDED,
        provider: connection.provider,
        capability,
        summary: result.summary,
        data: result.data,
      };
      await this.prisma.integrationActionExecution.update({
        where: { id: execution.id },
        data: {
          status: IntegrationActionStatus.SUCCEEDED,
          responseSummaryJson: result.summary as Prisma.InputJsonValue,
          durationMs: Date.now() - started,
          completedAt: new Date(),
        },
      });
      await this.markSuccess(connection.id);
      await auditIntegration(this.prisma, tenant, 'INTEGRATION_ACTION_REQUESTED', execution.id, {
        connectionId: connection.id,
        provider: connection.provider,
        capability,
        status: IntegrationActionStatus.SUCCEEDED,
      });
      return body;
    } catch (error) {
      const code = safeError(error);
      await this.prisma.integrationActionExecution.update({
        where: { id: execution.id },
        data: {
          status: code === 'INTEGRATION_AMBIGUOUS_RESULT' ? 'AMBIGUOUS' : 'FAILED',
          safeErrorCode: code,
          durationMs: Date.now() - started,
          completedAt: new Date(),
        },
      });
      await this.markFailure(connection.id, code);
      await auditIntegration(this.prisma, tenant, 'INTEGRATION_ACTION_REQUESTED', execution.id, {
        connectionId: connection.id,
        provider: connection.provider,
        capability,
        status: code === 'INTEGRATION_AMBIGUOUS_RESULT' ? 'AMBIGUOUS' : 'FAILED',
        safeErrorCode: code,
      });
      throw error;
    }
  }

  private async deleteOldExecutions(cutoff: Date, limit: number) {
    const executions = await this.prisma.integrationActionExecution.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (!executions.length) return 0;
    const deleted = await this.prisma.integrationActionExecution.deleteMany({
      where: { id: { in: executions.map((execution) => execution.id) } },
    });
    return deleted.count;
  }

  private async deleteExpiredOAuthStates(now: Date, limit: number) {
    const states = await this.prisma.integrationOAuthState.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    if (!states.length) return 0;
    const deleted = await this.prisma.integrationOAuthState.deleteMany({
      where: { id: { in: states.map((state) => state.id) } },
    });
    return deleted.count;
  }

  private async deleteExpiredIdempotencyRecords(now: Date, limit: number) {
    const records = await this.prisma.integrationActionIdempotencyRecord.findMany({
      where: { expiresAt: { lt: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    if (!records.length) return 0;
    const deleted = await this.prisma.integrationActionIdempotencyRecord.deleteMany({
      where: { id: { in: records.map((record) => record.id) } },
    });
    return deleted.count;
  }

  private async markSuccess(connectionId: string) {
    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        status: IntegrationStatus.CONNECTED,
        lastValidatedAt: new Date(),
        lastSuccessAt: new Date(),
        safeErrorCode: null,
      },
    });
  }

  private async markFailure(connectionId: string, code: string) {
    const status =
      code === 'INTEGRATION_AUTH_FAILED' || code === 'INTEGRATION_TOKEN_MISSING'
        ? IntegrationStatus.REAUTH_REQUIRED
        : undefined;
    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: { lastFailureAt: new Date(), safeErrorCode: code, ...(status ? { status } : {}) },
    });
  }

  private async findConnectionOrThrow(workspaceId: string, id: string) {
    const connection = await this.prisma.integrationConnection.findFirst({
      where: { id, workspaceId },
      select: connectionSelect,
    });
    if (!connection) throw new NotFoundException('INTEGRATION_CONNECTION_NOT_FOUND');
    return connection;
  }

  private requireActiveWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId || tenant.accessSource !== 'WORKSPACE_MEMBERSHIP') {
      throw new BadRequestException('ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return tenant.workspaceMembershipId;
  }

  private async assertProviderFeatureAvailable(
    tenant: WorkspaceTenantContext,
    provider: IntegrationProvider,
  ) {
    const featureKey = providerFeatureKey(provider);
    if (!featureKey) return;
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(tenant.workspaceId, featureKey);
  }
}

const connectionSelect = {
  id: true,
  workspaceId: true,
  provider: true,
  name: true,
  status: true,
  authType: true,
  providerAccountId: true,
  providerAccountLabel: true,
  encryptedCredentials: true,
  scopes: true,
  capabilities: true,
  configurationJson: true,
  connectedByMembershipId: true,
  lastValidatedAt: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  safeErrorCode: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
  workspace: {
    select: {
      status: true,
      agency: {
        select: {
          status: true,
          superAgency: { select: { status: true } },
        },
      },
    },
  },
} satisfies Prisma.IntegrationConnectionSelect;

function serializeConnection(
  connection: Prisma.IntegrationConnectionGetPayload<{ select: typeof connectionSelect }>,
) {
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    provider: connection.provider,
    name: connection.name,
    status: connection.status,
    authType: connection.authType,
    providerAccountId: connection.providerAccountId,
    providerAccountLabel: connection.providerAccountLabel,
    scopes: connection.scopes,
    capabilities: connection.capabilities,
    configuration: connection.configurationJson,
    connectedByMembershipId: connection.connectedByMembershipId,
    lastValidatedAt: connection.lastValidatedAt,
    lastSuccessAt: connection.lastSuccessAt,
    lastFailureAt: connection.lastFailureAt,
    safeErrorCode: connection.safeErrorCode,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    revokedAt: connection.revokedAt,
    hasCredentials: Boolean(connection.encryptedCredentials),
  };
}

function summarizeCredentials(credentials: Record<string, unknown>) {
  return {
    scopes: Array.isArray(credentials.scopes)
      ? credentials.scopes.filter((scope): scope is string => typeof scope === 'string')
      : [],
    providerAccountId:
      typeof credentials.providerAccountId === 'string' ? credentials.providerAccountId : null,
    providerAccountLabel:
      typeof credentials.providerAccountLabel === 'string'
        ? credentials.providerAccountLabel
        : null,
  };
}

function sanitizeRequest(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/token|secret|password|key|authorization/i.test(key)) {
      output[key] = '[redacted]';
    } else if (typeof value === 'string') {
      output[key] = value.slice(0, 500);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function credentialsForConnection(
  connection: { authType: IntegrationAuthType },
  credentials: IntegrationCredentialPayload,
) {
  return connection.authType === IntegrationAuthType.NONE ? {} : credentials;
}

function isMutationCapability(capability: string) {
  return /\.(create|update|send|post|patch)$/.test(capability);
}

function safeError(error: unknown) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    }
  }
  return error instanceof Error ? error.message.slice(0, 120) : 'INTEGRATION_ACTION_FAILED';
}

function assertActiveHierarchy(connection: {
  workspace: {
    status: WorkspaceStatus;
    agency: { status: AgencyStatus; superAgency: { status: SuperAgencyStatus } };
  };
}) {
  if (
    connection.workspace.status !== WorkspaceStatus.ACTIVE ||
    connection.workspace.agency.status !== AgencyStatus.ACTIVE ||
    connection.workspace.agency.superAgency.status !== SuperAgencyStatus.ACTIVE
  ) {
    throw new ConflictException('TENANT_HIERARCHY_INACTIVE');
  }
}

function providerFeatureKey(provider: IntegrationProvider): PlanFeatureKey | null {
  switch (provider) {
    case IntegrationProvider.GOHIGHLEVEL:
      return 'integrations.ghl.enabled';
    case IntegrationProvider.SLACK:
      return 'integrations.slack.enabled';
    case IntegrationProvider.WEBEX:
      return 'integrations.webex.enabled';
    case IntegrationProvider.GENERIC_REST:
      return null;
  }
  return null;
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function createIntegrationStateToken() {
  return randomBytes(24).toString('base64url');
}

async function lockIntegrationWorkspace(
  tx: Prisma.TransactionClient | PrismaService,
  workspaceId: string,
) {
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${['integrations', workspaceId].join(':')}))::text AS lock
  `;
}

async function auditIntegration(
  tx: Prisma.TransactionClient | PrismaService,
  tenant: WorkspaceTenantContext,
  action: string,
  entityId: string,
  metadata: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType: 'IntegrationConnection',
      entityId,
      metadata: sanitizeAuditMetadata(metadata),
    },
  });
}

interface IntegrationCleanupResult {
  oauthStates: number;
  idempotencyRecords: number;
  actionExecutions: number;
}

async function withIntegrationCleanupLock(
  prisma: PrismaService,
  handler: () => Promise<IntegrationCleanupResult>,
): Promise<IntegrationCleanupResult> {
  const [row] = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtext('integration-cleanup')) AS locked
  `;
  if (!row?.locked) return { oauthStates: 0, idempotencyRecords: 0, actionExecutions: 0 };
  try {
    return await handler();
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('integration-cleanup'))`;
  }
}
