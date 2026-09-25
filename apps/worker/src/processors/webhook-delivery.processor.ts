import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  AgencyStatus,
  SuperAgencyStatus,
  WebhookDeliveryStatus,
  WebhookSubscriptionStatus,
  WorkspaceStatus,
} from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { createDecipheriv, createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { validateEnvironment } from '@zea-play/config';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE,
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_DELIVERY_RECOVERY_JOB_TYPE,
} from '../queue/queue.constants';

const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const PROCESSING_TTL_MS = 2 * 60_000;
const SCAN_LIMIT = 100;
const CLEANUP_LIMIT = 500;
const RESPONSE_SNIPPET_BYTES = 4096;

interface WebhookDeliveryJob {
  deliveryId: string;
}

@Injectable()
@Processor(WEBHOOK_DELIVERY_QUEUE)
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<WebhookDeliveryJob>) {
    if (job.name === WEBHOOK_DELIVERY_RECOVERY_JOB_TYPE) {
      await this.recoverDueDeliveries();
      await this.cleanupRetainedDeliveries();
      return;
    }
    if (job.name !== WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE) return;
    if (!job.data?.deliveryId) throw new Error('Invalid webhook delivery job.');
    await this.dispatch(job.data.deliveryId);
  }

  async recoverDueDeliveries(now = new Date()) {
    const staleCutoff = new Date(now.getTime() - PROCESSING_TTL_MS);
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        OR: [
          { status: WebhookDeliveryStatus.RETRY_SCHEDULED, nextAttemptAt: { lte: now } },
          { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: now } },
          { status: WebhookDeliveryStatus.PROCESSING, processingUntil: { lte: staleCutoff } },
        ],
      },
      select: { id: true },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    for (const row of due) await this.dispatch(row.id);
    return { queued: due.length };
  }

  async cleanupRetainedDeliveries(now = new Date()) {
    const cutoff = new Date(
      now.getTime() - this.env.WEBHOOK_DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: {
        createdAt: { lt: cutoff },
        status: {
          in: [
            WebhookDeliveryStatus.SUCCEEDED,
            WebhookDeliveryStatus.FAILED,
            WebhookDeliveryStatus.DEAD_LETTERED,
          ],
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: CLEANUP_LIMIT,
    });
    if (deliveries.length === 0) return { deliveriesDeleted: 0, eventsDeleted: 0 };
    const deliveryResult = await this.prisma.webhookDelivery.deleteMany({
      where: { id: { in: deliveries.map((delivery) => delivery.id) } },
    });
    const events = await this.prisma.webhookEvent.findMany({
      where: { createdAt: { lt: cutoff }, deliveries: { none: {} } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: CLEANUP_LIMIT,
    });
    const eventResult =
      events.length === 0
        ? { count: 0 }
        : await this.prisma.webhookEvent.deleteMany({
            where: { id: { in: events.map((event) => event.id) } },
          });
    return { deliveriesDeleted: deliveryResult.count, eventsDeleted: eventResult.count };
  }

  async dispatch(deliveryId: string, now = new Date()) {
    const claimed = await this.claimDelivery(deliveryId, now);
    if (!claimed) return { status: 'SKIPPED' as const };

    const row = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        workspaceId: true,
        attemptCount: true,
        subscription: {
          select: {
            id: true,
            workspaceId: true,
            status: true,
            endpointUrl: true,
            encryptedSecret: true,
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
          },
        },
        event: {
          select: {
            id: true,
            workspaceId: true,
            eventType: true,
            payloadJson: true,
          },
        },
      },
    });
    if (
      !row ||
      row.subscription.workspaceId !== row.workspaceId ||
      row.event.workspaceId !== row.workspaceId
    ) {
      await this.failPermanently(deliveryId, 'WEBHOOK_DELIVERY_INTEGRITY_FAILED');
      return { status: 'FAILED' as const };
    }
    if (row.subscription.status !== WebhookSubscriptionStatus.ACTIVE) {
      await this.failPermanently(deliveryId, 'WEBHOOK_SUBSCRIPTION_DISABLED');
      return { status: 'FAILED' as const };
    }
    if (!hasActiveHierarchy(row.subscription.workspace)) {
      await this.failPermanently(deliveryId, 'TENANT_HIERARCHY_INACTIVE');
      return { status: 'FAILED' as const };
    }

    const started = Date.now();
    try {
      const validatedEndpoint = await assertSafeWebhookUrl(row.subscription.endpointUrl, {
        allowLocalHttp: this.env.WEBHOOK_ALLOW_LOCAL_HTTP,
      });
      const rawBody = JSON.stringify(row.event.payloadJson);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const secret = decryptSecret(row.subscription.encryptedSecret);
      const response = await postWebhook(
        validatedEndpoint,
        rawBody,
        {
          'Content-Type': 'application/json',
          'User-Agent': 'ZeaPlay-Webhooks/1.0',
          'X-ZeaPlay-Event-Id': row.event.id,
          'X-ZeaPlay-Delivery-Id': row.id,
          'X-ZeaPlay-Event-Type': row.event.eventType,
          'X-ZeaPlay-Timestamp': timestamp,
          'X-ZeaPlay-Attempt': String(row.attemptCount + 1),
          'X-ZeaPlay-Signature': `v1=${sign(secret, timestamp, rawBody)}`,
        },
        this.env.WEBHOOK_REQUEST_TIMEOUT_MS,
      );
      const duration = Date.now() - started;
      if (response.status >= 200 && response.status < 300) {
        await this.prisma.$transaction([
          this.prisma.webhookDelivery.update({
            where: { id: row.id },
            data: {
              status: WebhookDeliveryStatus.SUCCEEDED,
              attemptCount: { increment: 1 },
              deliveredAt: new Date(),
              lastAttemptAt: new Date(),
              nextAttemptAt: null,
              processingUntil: null,
              httpStatus: response.status,
              safeErrorCode: null,
              responseDurationMs: duration,
              responseSnippet: response.snippet,
            },
          }),
          this.prisma.webhookSubscription.update({
            where: { id: row.subscription.id },
            data: { lastSuccessAt: new Date() },
          }),
        ]);
        return { status: 'SUCCEEDED' as const };
      }
      await this.recordFailure(row.id, row.subscription.id, row.attemptCount + 1, {
        httpStatus: response.status,
        safeErrorCode: retryableStatus(response.status)
          ? 'HTTP_RETRYABLE_STATUS'
          : 'HTTP_PERMANENT_STATUS',
        responseDurationMs: duration,
        responseSnippet: response.snippet,
        retryable: retryableStatus(response.status),
      });
      return { status: 'FAILED' as const };
    } catch (error) {
      await this.recordFailure(row.id, row.subscription.id, row.attemptCount + 1, {
        safeErrorCode: safeErrorCode(error),
        responseDurationMs: Date.now() - started,
        retryable: isRetryableError(error),
      });
      return { status: 'FAILED' as const };
    }
  }

  private async claimDelivery(deliveryId: string, now: Date) {
    const updated = await this.prisma.webhookDelivery.updateMany({
      where: {
        id: deliveryId,
        OR: [
          { status: WebhookDeliveryStatus.PENDING },
          { status: WebhookDeliveryStatus.RETRY_SCHEDULED, nextAttemptAt: { lte: now } },
          { status: WebhookDeliveryStatus.PROCESSING, processingUntil: { lte: now } },
        ],
      },
      data: {
        status: WebhookDeliveryStatus.PROCESSING,
        processingUntil: new Date(now.getTime() + PROCESSING_TTL_MS),
        safeErrorCode: null,
      },
    });
    return updated.count === 1;
  }

  private async recordFailure(
    deliveryId: string,
    subscriptionId: string,
    attemptCount: number,
    result: {
      httpStatus?: number;
      safeErrorCode: string;
      responseDurationMs?: number;
      responseSnippet?: string;
      retryable: boolean;
    },
  ) {
    const nextDelay = result.retryable ? RETRY_DELAYS_MS[attemptCount - 1] : undefined;
    const terminal = !nextDelay || attemptCount >= MAX_ATTEMPTS;
    const status = result.retryable
      ? terminal
        ? WebhookDeliveryStatus.DEAD_LETTERED
        : WebhookDeliveryStatus.RETRY_SCHEDULED
      : WebhookDeliveryStatus.FAILED;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status,
          attemptCount,
          nextAttemptAt: terminal ? null : new Date(now.getTime() + nextDelay),
          processingUntil: null,
          lastAttemptAt: now,
          httpStatus: result.httpStatus,
          safeErrorCode: result.safeErrorCode,
          responseDurationMs: result.responseDurationMs,
          responseSnippet: result.responseSnippet,
        },
      }),
      this.prisma.webhookSubscription.update({
        where: { id: subscriptionId },
        data: { lastFailureAt: now },
      }),
    ]);
    if (!terminal && nextDelay) {
      await this.deliveryQueue.add(
        WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE,
        { deliveryId },
        {
          jobId: `${WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE}:${deliveryId}:${attemptCount}`,
          delay: nextDelay,
        },
      );
      this.logger.warn({ deliveryId, safeErrorCode: result.safeErrorCode, nextDelay });
    }
  }

  private async failPermanently(deliveryId: string, safeErrorCode: string) {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.FAILED,
        processingUntil: null,
        lastAttemptAt: new Date(),
        safeErrorCode,
      },
    });
  }
}

async function postWebhook(
  endpoint: ValidatedWebhookEndpoint,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
) {
  const client = endpoint.url.protocol === 'https:' ? https : http;
  return new Promise<{ status: number; snippet: string }>((resolve, reject) => {
    const request = client.request(
      endpoint.url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body, 'utf8').toString(),
        },
        timeout: timeoutMs,
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options?.all) {
            callback(null, [{ address: endpoint.address, family: endpoint.family }]);
            return;
          }
          callback(null, endpoint.address, endpoint.family);
        },
        ...(endpoint.url.protocol === 'https:' ? { servername: endpoint.url.hostname } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          if (bytes >= RESPONSE_SNIPPET_BYTES) return;
          const remaining = RESPONSE_SNIPPET_BYTES - bytes;
          const slice = chunk.subarray(0, remaining);
          chunks.push(slice);
          bytes += slice.length;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            snippet: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(Object.assign(new Error('WEBHOOK_TIMEOUT'), { code: 'WEBHOOK_TIMEOUT' }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

interface ValidatedWebhookEndpoint {
  url: URL;
  address: string;
  family: 4 | 6;
}

async function assertSafeWebhookUrl(
  input: string,
  options: { allowLocalHttp?: boolean },
): Promise<ValidatedWebhookEndpoint> {
  const url = new URL(input);
  if (url.username || url.password || url.hash) throw new Error('WEBHOOK_URL_INVALID');
  if (url.protocol !== 'https:') {
    if (!(options.allowLocalHttp && url.protocol === 'http:' && isLocalhostName(url.hostname))) {
      throw new Error('WEBHOOK_URL_HTTPS_REQUIRED');
    }
  }
  if (
    options.allowLocalHttp &&
    process.env.NODE_ENV !== 'production' &&
    url.protocol === 'http:' &&
    isLocalhostName(url.hostname)
  ) {
    return { url, address: '127.0.0.1', family: 4 };
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => isBlockedAddress(address.address))) {
    throw new Error('WEBHOOK_URL_PRIVATE_ADDRESS');
  }
  const first = addresses[0];
  if (!first || (first.family !== 4 && first.family !== 6))
    throw new Error('WEBHOOK_URL_DNS_FAILED');
  return { url, address: first.address, family: first.family };
}

function decryptSecret(payload: string) {
  const key = resolveEncryptionKey();
  const [version, iv, authTag, ciphertext] = payload.split('.');
  if (version !== 'v1' || !iv || !authTag || !ciphertext) throw new Error('WEBHOOK_SECRET_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function resolveEncryptionKey() {
  const value = process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!value) throw new Error('WEBHOOK_SECRET_ENCRYPTION_NOT_CONFIGURED');
  if (/^[A-Za-z0-9_-]{43,44}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length === 32) return decoded;
  }
  if (/^[A-Fa-f0-9]{64}$/.test(value)) return Buffer.from(value, 'hex');
  if (value.length >= 32) return createHash('sha256').update(value).digest();
  throw new Error('WEBHOOK_SECRET_ENCRYPTION_NOT_CONFIGURED');
}

function sign(secret: string, timestamp: string, rawBody: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function retryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function isRetryableError(error: unknown) {
  const code = safeErrorCode(error);
  return ['WEBHOOK_TIMEOUT', 'WEBHOOK_NETWORK_ERROR', 'WEBHOOK_DNS_FAILED'].includes(code);
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'WEBHOOK_TIMEOUT';
    if ((error as { code?: unknown }).code === 'WEBHOOK_TIMEOUT') return 'WEBHOOK_TIMEOUT';
    if (/dns|enotfound|eai_again/i.test(error.message)) return 'WEBHOOK_DNS_FAILED';
    if (/WEBHOOK_URL_|WEBHOOK_SECRET_/.test(error.message)) return error.message;
  }
  return 'WEBHOOK_NETWORK_ERROR';
}

function isLocalhostName(hostname: string) {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

function isBlockedAddress(address: string) {
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return true;
}

function isBlockedIpv4(address: string) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string) {
  const lower = address.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('ff') ||
    lower.startsWith('2001:db8')
  );
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
