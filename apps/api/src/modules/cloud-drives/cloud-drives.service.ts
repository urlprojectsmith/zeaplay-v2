import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  Optional,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  AssetLifecycle,
  AssetStatus,
  AgencyStatus,
  CloudDriveConnectionStatus,
  CloudDriveProvider,
  MembershipStatus,
  Prisma,
  SuperAgencyStatus,
  UserStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import { AuditService } from '../audit/audit.service';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import { CloudDriveProviderRegistry } from './cloud-drive-provider.registry';
import { CloudDriveTokenEncryptionService } from './cloud-drive-token-encryption.service';
import type { CloudDriveFile } from './providers/cloud-drive-provider.interface';
import { isProviderAuthError } from './providers/provider-http';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;
const IMPORT_RESERVATION_TTL_MS = 60 * 60 * 1000;
const STORAGE_PROVIDER_MINIO = 'MINIO';
const ACTIVE_STORAGE_STATUSES: AssetStatus[] = [
  AssetStatus.UPLOADED,
  AssetStatus.PROCESSING,
  AssetStatus.READY,
];
const QUOTA_COUNTING_LIFECYCLES: AssetLifecycle[] = [
  AssetLifecycle.ACTIVE,
  AssetLifecycle.ARCHIVED,
  AssetLifecycle.PENDING_DELETE,
  AssetLifecycle.PURGING,
];

@Injectable()
export class CloudDrivesService {
  private readonly env = validateEnvironment(process.env);
  private readonly allowedMimeTypes = new Set(
    this.env.ALLOWED_MIME_TYPES.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CloudDriveProviderRegistry,
    private readonly encryption: CloudDriveTokenEncryptionService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Optional() private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  providerStatuses() {
    return this.registry.listStatus();
  }

  async listConnections(tenant: WorkspaceTenantContext) {
    await this.requireActiveWorkspaceMembership(tenant);
    const connections = await this.prisma.cloudDriveConnection.findMany({
      where: { workspaceId: tenant.workspaceId },
      orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
      select: connectionSafeSelect,
    });
    return connections.map(serializeConnection);
  }

  async startConnection(
    tenant: WorkspaceTenantContext,
    provider: CloudDriveProvider,
    redirectPath?: string,
  ) {
    const adapter = this.requireAvailableAdapter(provider);
    const membershipId = await this.requireActiveWorkspaceMembership(tenant);
    await this.cleanupExpiredOAuthStates(tenant.workspaceId, provider);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = this.oauthRedirectUri();
    await this.prisma.cloudDriveOAuthState.create({
      data: {
        stateHash: stateHash(state),
        workspaceId: tenant.workspaceId,
        provider,
        actorMembershipId: membershipId,
        redirectPath: sanitizeRedirectPath(redirectPath),
        encryptedPkceVerifier: this.encryption.encrypt(verifier),
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
      },
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'cloud.connection_initiated',
      entityType: 'CloudDriveConnection',
      metadata: { provider },
    });
    return {
      provider,
      authorizationUrl: adapter.getAuthorizationUrl({
        state,
        redirectUri,
        codeChallenge: challenge,
      }),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    };
  }

  async completeOAuthCallback(input: { code: string; state: string }) {
    const hash = stateHash(input.state);
    const state = await this.prisma.$transaction(async (tx) => {
      const found = await tx.cloudDriveOAuthState.findUnique({
        where: { stateHash: hash },
        select: {
          id: true,
          workspaceId: true,
          provider: true,
          actorMembershipId: true,
          encryptedPkceVerifier: true,
          expiresAt: true,
          consumedAt: true,
          redirectPath: true,
          workspace: {
            select: {
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
          actorMembership: {
            select: {
              userId: true,
              status: true,
              user: { select: { status: true } },
            },
          },
        },
      });
      if (
        !found ||
        found.consumedAt ||
        found.expiresAt <= new Date() ||
        !isActiveOAuthCallbackContext(found)
      ) {
        throw new BadRequestException('CLOUD_OAUTH_STATE_INVALID');
      }
      const consumed = await tx.cloudDriveOAuthState.updateMany({
        where: { id: found.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new BadRequestException('CLOUD_OAUTH_STATE_INVALID');
      return found;
    });
    const adapter = this.requireAvailableAdapter(state.provider);
    const tokenSet = await adapter.exchangeAuthorizationCode({
      code: input.code,
      redirectUri: this.oauthRedirectUri(),
      codeVerifier: state.encryptedPkceVerifier
        ? this.encryption.decrypt(state.encryptedPkceVerifier)
        : null,
    });
    const connection = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lock: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${`${state.workspaceId}:${state.provider}`}))::text AS lock
      `;
      const existing = await tx.cloudDriveConnection.findFirst({
        where: {
          workspaceId: state.workspaceId,
          provider: state.provider,
          revokedAt: null,
          status: { not: CloudDriveConnectionStatus.REVOKED },
        },
        select: { id: true },
      });
      const data = {
        displayName: providerLabel(state.provider),
        status: CloudDriveConnectionStatus.CONNECTED,
        providerAccountId: tokenSet.providerAccountId ?? null,
        providerAccountLabel: tokenSet.providerAccountLabel ?? tokenSet.providerAccountId ?? null,
        encryptedAccessToken: this.encryption.encrypt(tokenSet.accessToken),
        encryptedRefreshToken: tokenSet.refreshToken
          ? this.encryption.encrypt(tokenSet.refreshToken)
          : null,
        tokenExpiresAt: tokenSet.expiresAt ?? null,
        scopes: tokenSet.scopes,
        connectedByMembershipId: state.actorMembershipId,
        lastValidatedAt: new Date(),
        revokedAt: null,
      };
      return existing
        ? tx.cloudDriveConnection.update({
            where: { id: existing.id },
            data,
            select: connectionSafeSelect,
          })
        : tx.cloudDriveConnection.create({
            data: { workspaceId: state.workspaceId, provider: state.provider, ...data },
            select: connectionSafeSelect,
          });
    });
    await this.audit.record({
      agencyId: state.workspace.agencyId,
      workspaceId: state.workspaceId,
      userId: state.actorMembership.userId,
      action: 'cloud.connected',
      entityType: 'CloudDriveConnection',
      entityId: connection.id,
      metadata: { provider: state.provider, connectionId: connection.id },
    });
    return {
      connection: serializeConnection(connection),
      redirectPath: state.redirectPath ?? '/workspace/settings',
    };
  }

  async disconnect(tenant: WorkspaceTenantContext, connectionId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    const connection = await this.findConnectionForOperation(
      tenant.workspaceId,
      connectionId,
      true,
    );
    const adapter = this.registry.get(connection.provider);
    if (connection.encryptedAccessToken && adapter.capabilities.revoke) {
      await adapter
        .revokeConnection(
          this.encryption.decrypt(connection.encryptedAccessToken),
          connection.encryptedRefreshToken
            ? this.encryption.decrypt(connection.encryptedRefreshToken)
            : null,
        )
        .catch(() => undefined);
    }
    const updated = await this.prisma.cloudDriveConnection.update({
      where: { id_workspaceId: { id: connectionId, workspaceId: tenant.workspaceId } },
      data: {
        status: CloudDriveConnectionStatus.REVOKED,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        tokenExpiresAt: null,
        revokedAt: new Date(),
      },
      select: connectionSafeSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'cloud.disconnected',
      entityType: 'CloudDriveConnection',
      entityId: connectionId,
      metadata: { provider: updated.provider, connectionId },
    });
    return serializeConnection(updated);
  }

  async listFiles(
    tenant: WorkspaceTenantContext,
    connectionId: string,
    input: {
      folderId?: string | null;
      cursor?: string | null;
      pageSize: number;
      foldersOnly?: boolean;
    },
  ) {
    await this.requireActiveWorkspaceMembership(tenant);
    const { connection, accessToken } = await this.authorizedAccessToken(
      tenant.workspaceId,
      connectionId,
    );
    const adapter = this.registry.get(connection.provider);
    const result = await adapter.listFiles({
      accessToken,
      folderId: input.folderId,
      cursor: input.cursor,
      pageSize: Math.min(input.pageSize, 100),
      foldersOnly: input.foldersOnly,
    });
    return {
      items: result.items.map((item) => normalizeCloudFile(connectionId, item)),
      nextCursor: result.nextCursor,
    };
  }

  async importFile(
    tenant: WorkspaceTenantContext,
    connectionId: string,
    input: { providerFileId: string; idempotencyKey?: string },
  ) {
    const membershipId = await this.requireActiveWorkspaceMembership(tenant);
    const { connection, accessToken } = await this.authorizedAccessToken(
      tenant.workspaceId,
      connectionId,
    );
    const adapter = this.registry.get(connection.provider);
    const metadata = await adapter.getFileMetadata(accessToken, input.providerFileId);
    if (metadata.isFolder || !metadata.downloadable)
      throw new BadRequestException('CLOUD_FILE_NOT_DOWNLOADABLE');
    const filename = sanitizeFilename(metadata.name);
    const mimeType = sanitizeMimeType(metadata.mimeType ?? 'application/octet-stream');
    if (!this.allowedMimeTypes.has(mimeType))
      throw new UnprocessableEntityException('CLOUD_FILE_TYPE_NOT_ALLOWED');
    if (metadata.sizeBytes === null) throw new BadRequestException('CLOUD_FILE_SIZE_UNKNOWN');
    if (metadata.sizeBytes > this.env.MAX_UPLOAD_BYTES)
      throw new PayloadTooLargeException('CLOUD_FILE_TOO_LARGE');
    const assetId = randomUUID();
    const storageKey = `workspaces/${tenant.workspaceId}/files/${assetId}/original`;
    const sizeBytes = BigInt(metadata.sizeBytes ?? 0);
    const reservationExpiresAt = new Date(Date.now() + IMPORT_RESERVATION_TTL_MS);
    const reserved = await this.prisma.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        await tx.$queryRaw<Array<{ lock: string }>>`
          SELECT pg_advisory_xact_lock(hashtext(${[
            tenant.workspaceId,
            connection.id,
            metadata.providerFileId,
            input.idempotencyKey,
          ].join(':')}))::text AS lock
        `;
        const existing = await tx.asset.findFirst({
          where: {
            workspaceId: tenant.workspaceId,
            sourceConnectionId: connection.id,
            sourceProviderFileId: metadata.providerFileId,
            metadata: { path: ['cloudImportIdempotencyKey'], equals: input.idempotencyKey },
            deletedAt: null,
          },
          select: assetSafeSelect,
        });
        if (existing) return { created: false as const, asset: existing };
      }
      await this.assertQuotaAvailable(tx, tenant.workspaceId, sizeBytes);
      await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          createdById: tenant.userId,
          uploadedByMembershipId: membershipId,
          originalFilename: filename,
          displayName: filename,
          storageBucket: this.env.MINIO_BUCKET,
          storageProvider: STORAGE_PROVIDER_MINIO,
          storageKey,
          mimeType,
          extension: extractExtension(filename),
          sizeBytes,
          status: AssetStatus.UPLOADING,
          lifecycle: AssetLifecycle.ACTIVE,
          uploadExpiresAt: reservationExpiresAt,
          sourceModule: 'CLOUD_DRIVE',
          sourceEntityType: 'CLOUD_FILE',
          sourceProvider: connection.provider,
          sourceConnectionId: connection.id,
          sourceProviderFileId: metadata.providerFileId,
          metadata: withoutUndefined({
            cloudImportIdempotencyKey: input.idempotencyKey,
            cloudModifiedAt: metadata.modifiedAt?.toISOString(),
            providerWebUrl: metadata.providerWebUrl,
          }),
        },
      });
      await tx.storageUploadReservation.create({
        data: {
          workspaceId: tenant.workspaceId,
          fileId: assetId,
          membershipId,
          reservedBytes: sizeBytes,
          expiresAt: reservationExpiresAt,
        },
      });
      return { created: true as const, asset: null };
    });

    if (!reserved.created && reserved.asset) return serializeAsset(reserved.asset);

    try {
      const body = await adapter.downloadFileStream(accessToken, input.providerFileId);
      await this.storage.upload(storageKey, body, { contentType: mimeType, fileName: filename });
      const stored = await this.storage.getMetadata(storageKey);
      if (stored.key !== storageKey || stored.size !== metadata.sizeBytes) {
        throw new ServiceUnavailableException('CLOUD_IMPORT_STORAGE_VERIFY_FAILED');
      }
      const asset = await this.prisma.$transaction(async (tx) => {
        const reservation = await tx.storageUploadReservation.findUnique({
          where: { fileId: assetId },
          select: { id: true, consumedAt: true, releasedAt: true, expiresAt: true },
        });
        if (!reservation || reservation.releasedAt || reservation.expiresAt <= new Date()) {
          throw new ConflictException('CLOUD_IMPORT_RESERVATION_EXPIRED');
        }
        if (!reservation.consumedAt) {
          await tx.storageUploadReservation.update({
            where: { id: reservation.id },
            data: { consumedAt: new Date() },
          });
        }
        return tx.asset.update({
          where: { id_workspaceId: { id: assetId, workspaceId: tenant.workspaceId } },
          data: {
            status: AssetStatus.READY,
          },
          select: assetSafeSelect,
        });
      });
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'cloud.file_imported',
        entityType: 'Asset',
        entityId: asset.id,
        metadata: {
          provider: connection.provider,
          connectionId: connection.id,
          providerFileId: metadata.providerFileId,
        },
      });
      return serializeAsset(asset);
    } catch (error) {
      await this.storage.deleteObject(storageKey).catch(() => undefined);
      await this.prisma.$transaction(async (tx) => {
        await tx.storageUploadReservation.updateMany({
          where: { fileId: assetId, consumedAt: null, releasedAt: null },
          data: { releasedAt: new Date() },
        });
        await tx.asset.updateMany({
          where: { id: assetId, workspaceId: tenant.workspaceId, status: AssetStatus.UPLOADING },
          data: { status: AssetStatus.FAILED },
        });
      });
      throw error;
    }
  }

  async exportAsset(
    tenant: WorkspaceTenantContext,
    connectionId: string,
    input: { assetId: string; destinationFolderId?: string | null; filename?: string },
  ) {
    await this.requireActiveWorkspaceMembership(tenant);
    const { connection, accessToken } = await this.authorizedAccessToken(
      tenant.workspaceId,
      connectionId,
    );
    const asset = await this.prisma.asset.findFirst({
      where: {
        id: input.assetId,
        workspaceId: tenant.workspaceId,
        deletedAt: null,
      },
      select: assetPrivateSelect,
    });
    if (!asset) throw new NotFoundException('FILE_NOT_FOUND');
    if (
      !ACTIVE_STORAGE_STATUSES.includes(asset.status) ||
      asset.lifecycle !== AssetLifecycle.ACTIVE
    ) {
      throw new ConflictException('FILE_NOT_EXPORTABLE');
    }
    const body = await this.storage.getObject(asset.storageKey);
    const filename = sanitizeFilename(input.filename ?? asset.displayName);
    const result = await this.registry.get(connection.provider).uploadFile(accessToken, {
      filename,
      mimeType: asset.mimeType,
      body,
      destinationFolderId: input.destinationFolderId,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'cloud.file_exported',
      entityType: 'Asset',
      entityId: asset.id,
      metadata: {
        provider: connection.provider,
        connectionId: connection.id,
        providerFileId: result.providerFileId,
      },
    });
    return result;
  }

  private requireAvailableAdapter(provider: CloudDriveProvider) {
    const adapter = this.registry.get(provider);
    if (!adapter?.configured())
      throw new ServiceUnavailableException('CLOUD_PROVIDER_NOT_CONFIGURED');
    if (!this.encryption.isConfigured())
      throw new ServiceUnavailableException('CLOUD_TOKEN_ENCRYPTION_NOT_CONFIGURED');
    return adapter;
  }

  private async authorizedAccessToken(workspaceId: string, connectionId: string) {
    const connection = await this.findConnectionForOperation(workspaceId, connectionId, false);
    if (!connection.encryptedAccessToken)
      throw new ConflictException('CLOUD_CONNECTION_REAUTH_REQUIRED');
    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() <= Date.now() + TOKEN_REFRESH_SKEW_MS
    ) {
      return this.refreshConnectionToken(workspaceId, connectionId);
    }
    return { connection, accessToken: this.encryption.decrypt(connection.encryptedAccessToken) };
  }

  private async refreshConnectionToken(workspaceId: string, connectionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lock: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${connectionId}))::text AS lock
      `;
      const current = await tx.cloudDriveConnection.findUnique({
        where: { id_workspaceId: { id: connectionId, workspaceId } },
        select: connectionPrivateSelect,
      });
      if (!current) throw new NotFoundException('CLOUD_CONNECTION_NOT_FOUND');
      if (
        current.status !== CloudDriveConnectionStatus.CONNECTED ||
        !current.encryptedAccessToken
      ) {
        throw new ConflictException('CLOUD_CONNECTION_REAUTH_REQUIRED');
      }
      if (
        current.tokenExpiresAt &&
        current.tokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_SKEW_MS
      ) {
        return {
          connection: current,
          accessToken: this.encryption.decrypt(current.encryptedAccessToken),
        };
      }
      if (!current.encryptedRefreshToken) {
        await tx.cloudDriveConnection.update({
          where: { id: current.id },
          data: { status: CloudDriveConnectionStatus.REAUTH_REQUIRED },
        });
        throw new ConflictException('CLOUD_CONNECTION_REAUTH_REQUIRED');
      }
      try {
        const refreshed = await this.registry
          .get(current.provider)
          .refreshAccessToken(this.encryption.decrypt(current.encryptedRefreshToken));
        const updated = await tx.cloudDriveConnection.update({
          where: { id: current.id },
          data: {
            encryptedAccessToken: this.encryption.encrypt(refreshed.accessToken),
            encryptedRefreshToken: refreshed.refreshToken
              ? this.encryption.encrypt(refreshed.refreshToken)
              : current.encryptedRefreshToken,
            tokenExpiresAt: refreshed.expiresAt ?? current.tokenExpiresAt,
            scopes: refreshed.scopes.length ? refreshed.scopes : current.scopes,
            status: CloudDriveConnectionStatus.CONNECTED,
            lastValidatedAt: new Date(),
          },
          select: connectionPrivateSelect,
        });
        return { connection: updated, accessToken: refreshed.accessToken };
      } catch (error) {
        if (isProviderAuthError(error)) {
          await tx.cloudDriveConnection.update({
            where: { id: current.id },
            data: { status: CloudDriveConnectionStatus.REAUTH_REQUIRED },
          });
          throw new ConflictException('CLOUD_CONNECTION_REAUTH_REQUIRED');
        }
        throw error;
      }
    });
  }

  private async findConnectionForOperation(
    workspaceId: string,
    connectionId: string,
    allowNonConnected: boolean,
  ) {
    const connection = await this.prisma.cloudDriveConnection.findUnique({
      where: { id_workspaceId: { id: connectionId, workspaceId } },
      select: connectionPrivateSelect,
    });
    if (!connection) throw new NotFoundException('CLOUD_CONNECTION_NOT_FOUND');
    if (
      !allowNonConnected &&
      (connection.status !== CloudDriveConnectionStatus.CONNECTED || connection.revokedAt)
    ) {
      throw new ConflictException('CLOUD_CONNECTION_REAUTH_REQUIRED');
    }
    return connection;
  }

  private async requireActiveWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId)
      throw new BadRequestException('WORKSPACE_MEMBERSHIP_REQUIRED');
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: {
        id_workspaceId: {
          id: tenant.workspaceMembershipId,
          workspaceId: tenant.workspaceId,
        },
      },
      select: { id: true, status: true },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new BadRequestException('WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return membership.id;
  }

  private async assertQuotaAvailable(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    requestedBytes: bigint,
  ) {
    if (
      await this.billingEntitlements?.assertWorkspaceStorageAvailableTx(
        tx,
        workspaceId,
        requestedBytes,
      )
    ) {
      return;
    }
    await tx.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text AS lock
    `;
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { storageLimitBytes: true },
    });
    const [used, reserved] = await Promise.all([
      tx.asset.aggregate({
        where: {
          workspaceId,
          deletedAt: null,
          status: { in: ACTIVE_STORAGE_STATUSES },
          lifecycle: { in: QUOTA_COUNTING_LIFECYCLES },
        },
        _sum: { sizeBytes: true },
      }),
      tx.storageUploadReservation.aggregate({
        where: {
          workspaceId,
          consumedAt: null,
          releasedAt: null,
          expiresAt: { gt: new Date() },
        },
        _sum: { reservedBytes: true },
      }),
    ]);
    if (
      (used._sum.sizeBytes ?? 0n) + (reserved._sum.reservedBytes ?? 0n) + requestedBytes >
      workspace.storageLimitBytes
    ) {
      throw new PayloadTooLargeException('CLOUD_IMPORT_QUOTA_EXCEEDED');
    }
  }

  private oauthRedirectUri() {
    return `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}/cloud-drives/oauth/callback`;
  }

  private async cleanupExpiredOAuthStates(workspaceId: string, provider: CloudDriveProvider) {
    const expired = await this.prisma.cloudDriveOAuthState.findMany({
      where: { workspaceId, provider, expiresAt: { lt: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
    if (!expired.length) return;
    await this.prisma.cloudDriveOAuthState.deleteMany({
      where: { id: { in: expired.map((item) => item.id) } },
    });
  }
}

const connectionSafeSelect = {
  id: true,
  workspaceId: true,
  provider: true,
  displayName: true,
  status: true,
  providerAccountId: true,
  providerAccountLabel: true,
  tokenExpiresAt: true,
  scopes: true,
  rootFolderId: true,
  connectedByMembershipId: true,
  createdAt: true,
  updatedAt: true,
  lastValidatedAt: true,
  revokedAt: true,
} satisfies Prisma.CloudDriveConnectionSelect;

const connectionPrivateSelect = {
  ...connectionSafeSelect,
  encryptedAccessToken: true,
  encryptedRefreshToken: true,
} satisfies Prisma.CloudDriveConnectionSelect;

const assetSafeSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  createdById: true,
  uploadedByMembershipId: true,
  originalFilename: true,
  displayName: true,
  mimeType: true,
  extension: true,
  sizeBytes: true,
  checksum: true,
  status: true,
  lifecycle: true,
  sourceModule: true,
  sourceEntityType: true,
  sourceEntityId: true,
  sourceProvider: true,
  sourceConnectionId: true,
  sourceProviderFileId: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssetSelect;

const assetPrivateSelect = {
  ...assetSafeSelect,
  storageKey: true,
  storageBucket: true,
} satisfies Prisma.AssetSelect;

type SafeConnection = Prisma.CloudDriveConnectionGetPayload<{
  select: typeof connectionSafeSelect;
}>;
type AssetSafe = Prisma.AssetGetPayload<{ select: typeof assetSafeSelect }>;

function serializeConnection(connection: SafeConnection) {
  return connection;
}

function serializeAsset(asset: AssetSafe) {
  return { ...asset, sizeBytes: Number(asset.sizeBytes) };
}

function isActiveOAuthCallbackContext(state: {
  workspace: {
    status: WorkspaceStatus;
    agency: { status: AgencyStatus; superAgency: { status: SuperAgencyStatus } };
  };
  actorMembership: { status: MembershipStatus; user: { status: UserStatus } };
}) {
  return (
    state.actorMembership.status === MembershipStatus.ACTIVE &&
    state.actorMembership.user.status === UserStatus.ACTIVE &&
    state.workspace.status === WorkspaceStatus.ACTIVE &&
    state.workspace.agency.status === AgencyStatus.ACTIVE &&
    state.workspace.agency.superAgency.status === SuperAgencyStatus.ACTIVE
  );
}

function normalizeCloudFile(connectionId: string, file: CloudDriveFile) {
  return {
    connectionId,
    providerFileId: file.providerFileId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    isFolder: file.isFolder,
    modifiedAt: file.modifiedAt,
    parentId: file.parentId,
    providerWebUrl: file.providerWebUrl,
    downloadable: file.downloadable,
  };
}

function stateHash(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

function sanitizeRedirectPath(value?: string) {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const candidate = value.slice(0, 512);
  try {
    const decoded = decodeURIComponent(candidate).trim().toLowerCase();
    if (
      decoded.startsWith('//') ||
      decoded.startsWith('/\\') ||
      decoded.startsWith('javascript:') ||
      decoded.startsWith('/javascript:') ||
      decoded.startsWith('data:') ||
      decoded.startsWith('/data:')
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return candidate;
}

function providerLabel(provider: CloudDriveProvider) {
  if (provider === CloudDriveProvider.GOOGLE_DRIVE) return 'Google Drive';
  if (provider === CloudDriveProvider.ONEDRIVE) return 'OneDrive';
  return 'Dropbox';
}

function sanitizeFilename(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (
    !normalized ||
    normalized.includes('..') ||
    /%(?:25)*(?:2e|2f|5c)/i.test(normalized) ||
    /[\\/\u2044\u2215\u2216\u29f5\u29f8\uFE68\uFF0F\uFF3C]/u.test(normalized) ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    throw new UnprocessableEntityException('INVALID_FILENAME');
  }
  return normalized.slice(0, 255);
}

function sanitizeMimeType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i.test(normalized)) {
    throw new UnprocessableEntityException('INVALID_MIME_TYPE');
  }
  return normalized;
}

function extractExtension(filename: string) {
  const last = filename.lastIndexOf('.');
  if (last <= 0 || last === filename.length - 1) return null;
  const extension = filename
    .slice(last + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return extension ? extension.slice(0, 24) : null;
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined,
    ),
  );
}
