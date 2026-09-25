import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface AuditEvent {
  organizationId?: string | null;
  superAgencyId?: string | null;
  agencyId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

const REDACTED = '[REDACTED]';
const REDACTED_PII = '[REDACTED_PII]';
const TRUNCATED = '[TRUNCATED]';
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 8;

const piiKeyPattern = /(^|[-_])(email|phone|mobile|address|full[-_]?name)($|[-_])/i;
const sensitiveStringPattern =
  /(bearer\s+[a-z0-9._~-]+|basic\s+[a-z0-9+/=._~-]+|postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|password=|token=|secret=|api[-_]?key=|x-amz-signature=|signature=|authorization:|set-cookie:)/i;

const sensitiveKeys = new Set([
  'apikey',
  'apikeyhash',
  'apikeysecret',
  'accesstoken',
  'authorization',
  'authorizationheader',
  'bearer',
  'clientsecret',
  'code',
  'cookie',
  'credential',
  'credentials',
  'encryptedcredential',
  'encryptedcredentials',
  'encryptedaccesstoken',
  'encryptedrefreshtoken',
  'jwt',
  'otp',
  'otpcode',
  'password',
  'passwordhash',
  'privatekey',
  'rawbody',
  'refresh',
  'refreshtoken',
  'secret',
  'session',
  'sessiontoken',
  'signature',
  'signedurl',
  'token',
  'twofactorsecret',
  'webhooksecret',
]);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent) {
    const lineage = await this.resolveLineage(event);
    await this.prisma.auditLog.create({
      data: {
        organizationId: event.organizationId,
        superAgencyId: lineage.superAgencyId,
        agencyId: lineage.agencyId,
        workspaceId: lineage.workspaceId,
        userId: event.userId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: sanitizeAuditMetadata(event.metadata),
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
      },
    });
  }

  private async resolveLineage(event: AuditEvent) {
    let workspaceId = event.workspaceId ?? undefined;
    let agencyId = event.agencyId ?? undefined;
    let superAgencyId = event.superAgencyId ?? undefined;

    if (workspaceId) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
      });
      if (workspace) {
        workspaceId = workspace.id;
        agencyId = workspace.agencyId;
        superAgencyId = workspace.agency.superAgencyId;
      }
    }

    if (agencyId && !superAgencyId) {
      const agency = await this.prisma.agency.findUnique({
        where: { id: agencyId },
        select: { superAgencyId: true },
      });
      superAgencyId = agency?.superAgencyId ?? superAgencyId;
    }

    return {
      workspaceId: workspaceId ?? event.workspaceId,
      agencyId: agencyId ?? event.agencyId,
      superAgencyId: superAgencyId ?? event.superAgencyId,
    };
  }
}

export function sanitizeAuditMetadata(metadata: unknown): Prisma.InputJsonValue | undefined {
  if (metadata === undefined) return undefined;
  const sanitized = sanitizeValue(metadata, [], 0, new WeakSet<object>());
  if (sanitized === undefined) return undefined;
  const byteLength = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
  if (byteLength <= MAX_METADATA_BYTES) return sanitized;
  return {
    truncated: true,
    originalByteLength: byteLength,
    reason: 'AUDIT_METADATA_SIZE_LIMIT',
  };
}

function sanitizeValue(
  value: unknown,
  path: string[],
  depth: number,
  seen: WeakSet<object>,
): Prisma.InputJsonValue | undefined {
  const key = path.at(-1) ?? '';
  if (isSensitiveKey(key)) return REDACTED;
  if (piiKeyPattern.test(key)) return REDACTED_PII;
  if (value === undefined) return undefined;
  if (value === null) return '[NULL]';
  if (value instanceof Date) return value.toISOString();

  switch (typeof value) {
    case 'string':
      return sanitizeString(value);
    case 'number':
      return Number.isFinite(value) ? value : '[NON_FINITE_NUMBER]';
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return '[UNSERIALIZABLE]';
  }

  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item, index) => sanitizeValue(item, [...path, String(index)], depth + 1, seen))
      .map((item) => item ?? '[UNDEFINED]');
    if (value.length > MAX_ARRAY_ITEMS) items.push(TRUNCATED);
    seen.delete(value);
    return items;
  }

  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [entryKey, entryValue] of entries) {
    const sanitized = sanitizeValue(entryValue, [...path, entryKey], depth + 1, seen);
    if (sanitized !== undefined) output[entryKey] = sanitized;
  }
  if (Object.keys(value as Record<string, unknown>).length > MAX_OBJECT_KEYS) {
    output.truncated = true;
  }
  seen.delete(value);
  return output;
}

function sanitizeString(value: string) {
  if (sensitiveStringPattern.test(value)) return REDACTED;
  if (value.length > MAX_STRING_LENGTH) return `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATED}`;
  return value;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sensitiveKeys.has(normalized);
}
