import { ConflictException, Injectable } from '@nestjs/common';
import { ApiIdempotencyStatus, Prisma } from '@prisma/client';
import { validateEnvironment } from '@zea-play/config';
import { createHash } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { PublicApiPrincipal } from './public-api.types';

@Injectable()
export class PublicApiIdempotencyService {
  private readonly env = validateEnvironment(process.env);

  constructor(private readonly prisma: PrismaService) {}

  async run<T extends { id?: string }>(
    principal: PublicApiPrincipal,
    input: {
      key: string | undefined;
      method: string;
      routeKey: string;
      body: unknown;
      handler: () => Promise<T>;
    },
  ): Promise<T> {
    if (!input.key) return input.handler();
    if (input.key.length > 200) throw new ConflictException('IDEMPOTENCY_KEY_INVALID');
    const idempotencyKeyHash = hash(input.key);
    const requestFingerprint = hash(stableStringify(input.body));
    const expiresAt = new Date(
      Date.now() + this.env.PUBLIC_API_IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${[
          principal.workspaceId,
          principal.apiKeyId,
          input.method,
          input.routeKey,
          idempotencyKeyHash,
        ].join(':')}))::text AS lock
      `;
      const existing = await tx.apiIdempotencyRecord.findUnique({
        where: {
          workspaceId_apiKeyId_idempotencyKeyHash_method_routeKey: {
            workspaceId: principal.workspaceId,
            apiKeyId: principal.apiKeyId,
            idempotencyKeyHash,
            method: input.method,
            routeKey: input.routeKey,
          },
        },
      });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        }
        if (
          existing.status === ApiIdempotencyStatus.COMPLETED &&
          existing.responseBody !== null &&
          existing.expiresAt > new Date()
        ) {
          return existing.responseBody as T;
        }
      } else {
        await tx.apiIdempotencyRecord.create({
          data: {
            workspaceId: principal.workspaceId,
            apiKeyId: principal.apiKeyId,
            idempotencyKeyHash,
            method: input.method,
            routeKey: input.routeKey,
            requestFingerprint,
            expiresAt,
          },
        });
      }

      const response = await input.handler();
      await tx.apiIdempotencyRecord.update({
        where: {
          workspaceId_apiKeyId_idempotencyKeyHash_method_routeKey: {
            workspaceId: principal.workspaceId,
            apiKeyId: principal.apiKeyId,
            idempotencyKeyHash,
            method: input.method,
            routeKey: input.routeKey,
          },
        },
        data: {
          status: ApiIdempotencyStatus.COMPLETED,
          responseResourceId: typeof response.id === 'string' ? response.id : null,
          responseBody: response as Prisma.InputJsonValue,
          expiresAt,
        },
      });
      return response;
    });
  }

  async cleanupExpired(limit = 500) {
    const records = await this.prisma.apiIdempotencyRecord.findMany({
      where: { expiresAt: { lt: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    if (!records.length) return { deleted: 0 };
    const result = await this.prisma.apiIdempotencyRecord.deleteMany({
      where: { id: { in: records.map((record) => record.id) } },
    });
    return { deleted: result.count };
  }
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
