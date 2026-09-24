# Inbound Webhooks

Phase 14.3 supports one inbound source type: `GENERIC_HMAC_V1`.

Inbound webhooks use this public endpoint pattern:

```text
POST /api/v1/inbound/{publicIdentifier}
```

The public identifier routes the request to a Workspace source. It is not a secret. Every request must include a valid HMAC signature.

## Headers

Send these headers with every request:

```text
X-ZeaPlay-Inbound-Event-Id: external-event-id
X-ZeaPlay-Inbound-Timestamp: unix-seconds
X-ZeaPlay-Inbound-Signature: v1=<hex-hmac-sha256>
Content-Type: application/json
```

The event id must be stable for sender retries and must be at most 200 characters.

Requests must use `Content-Type: application/json`. Compressed request bodies are not supported; `gzip`, `br`, and `deflate` content encodings are rejected.

## Signature

The signature uses HMAC-SHA256 over the exact raw request body bytes:

```text
v1=HMAC_SHA256(secret, timestamp + "." + rawBody)
```

Do not sign re-serialized JSON. Whitespace and property order are part of the signed bytes.

## Timestamp

`X-ZeaPlay-Inbound-Timestamp` is Unix seconds. By default, requests must be within 5 minutes of the server clock. A captured old request outside the timestamp window is rejected even if the event id was previously accepted.

## Payload

`GENERIC_HMAC_V1` accepts JSON bodies up to 256 KB by default. The server enforces this with `INBOUND_WEBHOOK_MAX_BODY_BYTES`.

```json
{
  "type": "external.some_event",
  "version": "1",
  "data": {
    "example": true
  }
}
```

`type` is descriptive data only. ZeaPlay treats payload fields such as `workspaceId`, `tenantId`, or `agencyId` as ordinary data; the Workspace always comes from the configured inbound source. In Phase 14.3, inbound events do not directly create or update Tasks, Projects, Tickets, XP, notifications, or Automation executions. No provider-specific inbound adapters are supported yet.

## Idempotency

ZeaPlay deduplicates by source plus `X-ZeaPlay-Inbound-Event-Id`.

Sender retries should keep the same event id and body. A retry may use a fresh timestamp/signature. If the same event id arrives with a different raw body hash, ZeaPlay rejects it with `INBOUND_EVENT_ID_REUSED`.

Idempotency is retained for the configured retention window. After an old event is legitimately deleted by retention cleanup, the same external event id may be accepted again.

## Responses

A newly accepted and normalized event returns a safe response containing the ZeaPlay event id and status. A same-body retry returns the same event id with replay semantics. Invalid signatures, stale timestamps, unsupported content types, malformed payloads, and rate limits return safe machine errors without exposing secrets or signature internals.

Common safe error codes include `INBOUND_SOURCE_NOT_FOUND`, `INBOUND_SIGNATURE_INVALID`, `INBOUND_TIMESTAMP_INVALID`, `INBOUND_TIMESTAMP_OUT_OF_TOLERANCE`, `INBOUND_EVENT_ID_REQUIRED`, `INBOUND_EVENT_ID_REUSED`, `INBOUND_PAYLOAD_INVALID`, `INBOUND_CONTENT_TYPE_UNSUPPORTED`, `INBOUND_CONTENT_ENCODING_UNSUPPORTED`, `INBOUND_BODY_TOO_LARGE`, and `INBOUND_RATE_LIMIT_EXCEEDED`.

## Rotation

Secret rotation is immediate in Phase 14.3. After rotation, senders must use the new signing secret. Old secrets are invalid.

## Rate Limits

Inbound webhook traffic is rate-limited per source and per Workspace. Senders may retry on `429`, `5xx`, or network failures using the same event id and body.

## Retention

Inbound event metadata and normalized records are retained for `INBOUND_WEBHOOK_EVENT_RETENTION_DAYS`, 30 days by default. Cleanup is scheduled by a repeatable maintenance job and processed in bounded batches by the worker.
