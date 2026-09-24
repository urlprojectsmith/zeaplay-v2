import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  IntegrationActionStatus,
  IntegrationProvider,
  IntegrationStatus,
  Prisma,
} from '@prisma/client';
import { validateEnvironment } from '@zea-play/config';
import { createHash, randomBytes } from 'node:crypto';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  CreateIntegrationConnectionDto,
  ExecuteIntegrationActionDto,
  IntegrationListQueryDto,
  UpdateIntegrationConnectionDto,
} from './dto/integration.dto';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationProviderRegistry } from './integration-provider.registry';
import { IntegrationRateLimitService } from './integration-rate-limit.service';

@Injectable()
export class IntegrationsService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: IntegrationCredentialService,
    private readonly registry: IntegrationProviderRegistry,
    private readonly rateLimit: IntegrationRateLimitService,
  ) {}

  listProviders() {
    const encryptionConfigured = this.credentials.isConfigured();
    return this.registry.list().map((provider) => ({
      ...provider,
      configured: provider.configured && encryptionConfigured,
    }));
  }

  async list(tenant: WorkspaceTenantContext, query: IntegrationListQueryDto) {
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
    const connection = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    return serializeConnection(connection);
  }

  async create(tenant: WorkspaceTenantContext, dto: CreateIntegrationConnectionDto) {
    const membershipId = this.requireActiveWorkspaceMembership(tenant);
    if (!this.credentials.isConfigured()) {
      throw new ServiceUnavailableException('INTEGRATION_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
    }
    const existing = await this.prisma.integrationConnection.count({
      where: { workspaceId: tenant.workspaceId, revokedAt: null },
    });
    if (existing >= this.env.INTEGRATION_CONNECTION_LIMIT) {
      throw new ConflictException('INTEGRATION_CONNECTION_LIMIT_REACHED');
    }
    const adapter = this.registry.get(dto.provider);
    if (!adapter.authTypes.includes(dto.authType)) {
      throw new BadRequestException('INTEGRATION_AUTH_TYPE_UNSUPPORTED');
    }
    const configuration = await adapter.validateConfiguration(dto.configuration ?? {});
    const encryptedCredentials = this.credentials.encrypt(dto.credentials);
    const credentialSummary = summarizeCredentials(dto.credentials);
    const connection = await this.prisma.integrationConnection.create({
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
    return serializeConnection(connection);
  }

  async update(
    tenant: WorkspaceTenantContext,
    integrationId: string,
    dto: UpdateIntegrationConnectionDto,
  ) {
    const current = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    const adapter = this.registry.get(current.provider);
    const configuration =
      dto.configuration === undefined
        ? undefined
        : await adapter.validateConfiguration(dto.configuration ?? {});
    const updated = await this.prisma.integrationConnection.update({
      where: { id: current.id },
      data: {
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(configuration ? { configurationJson: configuration as Prisma.InputJsonValue } : {}),
      },
      select: connectionSelect,
    });
    return serializeConnection(updated);
  }

  async disconnect(tenant: WorkspaceTenantContext, integrationId: string) {
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
    return serializeConnection(updated);
  }

  async testConnection(tenant: WorkspaceTenantContext, integrationId: string) {
    const connection = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    const adapter = this.registry.get(connection.provider);
    const decrypted = this.credentials.decrypt(connection.encryptedCredentials);
    const started = Date.now();
    try {
      const result = await adapter.testConnection({ connection, credentials: decrypted });
      await this.markSuccess(connection.id);
      return { ok: true, durationMs: Date.now() - started, summary: result.summary };
    } catch (error) {
      await this.markFailure(connection.id, safeError(error));
      throw error;
    }
  }

  async execute(
    tenant: WorkspaceTenantContext,
    integrationId: string,
    capability: string,
    dto: ExecuteIntegrationActionDto,
  ) {
    const connection = await this.findConnectionOrThrow(tenant.workspaceId, integrationId);
    if (connection.status !== IntegrationStatus.CONNECTED || connection.revokedAt) {
      throw new ConflictException('INTEGRATION_CONNECTION_NOT_ACTIVE');
    }
    if (!connection.capabilities.includes(capability)) {
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
    const cutoff = new Date(
      now.getTime() - this.env.INTEGRATION_ACTION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const [states, idempotency, executions] = await Promise.all([
      this.prisma.integrationOAuthState.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.integrationActionIdempotencyRecord.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
      this.deleteOldExecutions(cutoff, limit),
    ]);
    return {
      oauthStates: states.count,
      idempotencyRecords: idempotency.count,
      actionExecutions: executions,
    };
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
    const existing = await this.prisma.integrationActionIdempotencyRecord.findUnique({
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
      if (existing.responseBody && existing.expiresAt > new Date()) return existing.responseBody;
    } else {
      await this.prisma.integrationActionIdempotencyRecord.create({
        data: {
          workspaceId: tenant.workspaceId,
          connectionId: connection.id,
          capability,
          idempotencyKeyHash: keyHash,
          requestFingerprint,
          expiresAt,
        },
      });
    }
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
        credentials: this.credentials.decrypt(connection.encryptedCredentials),
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
    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: { lastFailureAt: new Date(), safeErrorCode: code },
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

function isMutationCapability(capability: string) {
  return /\.(create|update|send|post|patch)$/.test(capability);
}

function safeError(error: unknown) {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (typeof response === 'string') return response;
  }
  return error instanceof Error ? error.message.slice(0, 120) : 'INTEGRATION_ACTION_FAILED';
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
