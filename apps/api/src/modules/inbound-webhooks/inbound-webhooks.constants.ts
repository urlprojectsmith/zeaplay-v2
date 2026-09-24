export const INBOUND_WEBHOOK_SOURCE_LIMIT = 25;
export const INBOUND_WEBHOOK_SECRET_BYTES = 32;
export const INBOUND_WEBHOOK_PUBLIC_ID_BYTES = 24;
export const INBOUND_WEBHOOK_CLEANUP_BATCH_SIZE = 500;

export const INBOUND_WEBHOOK_HEADERS = {
  eventId: 'x-zeaplay-inbound-event-id',
  timestamp: 'x-zeaplay-inbound-timestamp',
  signature: 'x-zeaplay-inbound-signature',
} as const;

export const INBOUND_WEBHOOK_SOURCE_TYPES = ['GENERIC_HMAC_V1'] as const;
