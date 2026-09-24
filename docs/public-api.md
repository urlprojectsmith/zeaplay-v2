# ZeaPlay Public REST API

Phase 14.1 introduces the public REST API foundation for server-to-server integrations.

## Base Path

All public endpoints are versioned under:

```text
/api/v1/public
```

There is no unversioned or `latest` public API alias. Existing internal web/JWT routes remain outside the public contract.

## Authentication

Send API keys with:

```text
Authorization: Bearer zea_live_<public-id>_<secret>
```

API keys are Workspace scoped. The Workspace is derived from the API key, not from request headers, query parameters, body fields, or URL tenant parameters.

Do not use API keys in browser frontend applications. They are long-lived server-to-server secrets.

API keys are Workspace-owned credentials. If the original human creator later becomes inactive, an otherwise active and unexpired key remains valid while its Workspace remains active. Public API activity is identified with the API key id and Workspace context.

## Scopes

Initial allowlisted scopes:

- `tasks.read`
- `tasks.write`
- `projects.read`
- `projects.write`
- `tickets.read`
- `tickets.write`

Write scopes imply read for the same resource only. There is no wildcard scope.

## Rate Limits

Default limits:

- Per API key: 120 requests per minute.
- Per Workspace: 600 requests per minute.

These are configurable with:

- `PUBLIC_API_KEY_RATE_LIMIT_PER_MINUTE`
- `PUBLIC_API_WORKSPACE_RATE_LIMIT_PER_MINUTE`

Rate-limit identifiers use API key ID and Workspace ID. They never include the plaintext API key secret.

## Responses

Success:

```json
{
  "data": {}
}
```

List:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "total": 0
  }
}
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed."
  },
  "requestId": "request-id"
}
```

## Pagination

Public list endpoints use `page` and `pageSize`.

The maximum `pageSize` is 100.

## Idempotency

Create endpoints accept:

```text
Idempotency-Key: <client-generated-key>
```

The same API key, method, route, idempotency key, and request fingerprint reuses the original result. Reusing the same idempotency key with a different request returns `409 IDEMPOTENCY_KEY_REUSED`.

Records expire after `PUBLIC_API_IDEMPOTENCY_TTL_HOURS`, default 24 hours.

## Endpoints

Tasks:

- `GET /api/v1/public/tasks`
- `GET /api/v1/public/tasks/:id`
- `POST /api/v1/public/tasks`
- `PATCH /api/v1/public/tasks/:id`

Projects:

- `GET /api/v1/public/projects`
- `GET /api/v1/public/projects/:id`
- `POST /api/v1/public/projects`
- `PATCH /api/v1/public/projects/:id`

Tickets:

- `GET /api/v1/public/tickets`
- `GET /api/v1/public/tickets/:id`
- `POST /api/v1/public/tickets`
- `PATCH /api/v1/public/tickets/:id`

## API Key Management

Workspace-authenticated users with API-key permissions manage keys through internal Workspace routes:

```text
/workspaces/:workspaceId/api-keys
```

Plaintext API keys are returned once at creation. Later list/update responses return only safe metadata and masked key prefixes.
