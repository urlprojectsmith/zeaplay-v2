import type { Uuid } from '@zea-play/types';

export interface DomainEventEnvelope<TPayload = Record<string, unknown>> {
  eventId: Uuid;
  eventType: string;
  version: number;
  occurredAt: string;
  correlationId: string;
  agencyId: Uuid | null;
  workspaceId: Uuid | null;
  actorId: Uuid | null;
  payload: TPayload;
}

export const EVENT_ENVELOPE_VERSION = 1;
