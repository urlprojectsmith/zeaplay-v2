import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface NormalizedInboundWebhookEvent {
  type: string;
  version: string;
  occurredAt: Date | null;
  data: Prisma.InputJsonValue;
  correlationId: string | null;
}

export interface InboundWebhookNormalizerAdapter {
  readonly type: 'GENERIC_HMAC_V1';
  normalize(payload: unknown): NormalizedInboundWebhookEvent;
}

@Injectable()
export class GenericHmacV1InboundWebhookAdapter implements InboundWebhookNormalizerAdapter {
  readonly type = 'GENERIC_HMAC_V1' as const;

  normalize(payload: unknown): NormalizedInboundWebhookEvent {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('INBOUND_PAYLOAD_INVALID');
    }
    const source = payload as Record<string, unknown>;
    const type = normalizeString(source.type, 150, 'INBOUND_EVENT_TYPE_INVALID');
    if (!/^[a-z0-9][a-z0-9_.:-]*$/.test(type)) {
      throw new BadRequestException('INBOUND_EVENT_TYPE_INVALID');
    }
    const version =
      source.version === undefined
        ? '1'
        : normalizeString(source.version, 20, 'INBOUND_EVENT_VERSION_INVALID');
    const data = source.data;
    if (data === undefined || data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('INBOUND_EVENT_DATA_INVALID');
    }
    const occurredAt = parseOptionalDate(source.occurredAt);
    const correlationId =
      source.correlationId === undefined
        ? null
        : normalizeString(source.correlationId, 120, 'INBOUND_CORRELATION_ID_INVALID');
    return {
      type,
      version,
      occurredAt,
      data: data as Prisma.InputJsonValue,
      correlationId,
    };
  }
}

@Injectable()
export class InboundWebhookAdapterRegistry {
  constructor(private readonly generic: GenericHmacV1InboundWebhookAdapter) {}

  get(type: 'GENERIC_HMAC_V1') {
    if (type === this.generic.type) return this.generic;
    throw new BadRequestException('INBOUND_SOURCE_TYPE_UNSUPPORTED');
  }
}

function normalizeString(value: unknown, maxLength: number, code: string) {
  if (typeof value !== 'string') throw new BadRequestException(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new BadRequestException(code);
  return normalized;
}

function parseOptionalDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('INBOUND_OCCURRED_AT_INVALID');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('INBOUND_OCCURRED_AT_INVALID');
  return parsed;
}
