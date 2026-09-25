# External Integrations

Phase 14.4 adds the foundation for workspace-scoped external integrations.

## Supported Providers

- `GOHIGHLEVEL`
- `SLACK`
- `WEBEX`
- `GENERIC_REST`

No other providers are registered in this phase.

## Security Model

- Credentials are encrypted at rest with `CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY`.
- API responses never include plaintext credentials.
- Integration actions require workspace RBAC permissions.
- OAuth is not advertised for provider adapters in Phase 14.4; GHL, Slack, and Webex use bearer tokens, while Generic REST supports no auth, bearer token, API key, and basic auth.
- Generic REST connections validate their base URL through the existing SSRF guard and bind the outbound connection to the validated DNS result.
- Generic REST actions accept only relative paths and reject traversal, scheme-relative URLs, control characters, bounded-query violations, oversized JSON bodies, and restricted credential header names.
- Provider HTTP calls use bounded timeouts, reject redirects, and enforce a response-size limit.
- Mutation transport failures are recorded as ambiguous by the action service rather than blindly retried.
- Management/action intent is recorded in `AuditLog` with bounded metadata and no credential material.

## Configuration

Important environment keys:

- `INTEGRATION_CONNECTION_LIMIT`
- `INTEGRATION_CONNECTION_RATE_LIMIT_PER_MINUTE`
- `INTEGRATION_WORKSPACE_RATE_LIMIT_PER_MINUTE`
- `INTEGRATION_ACTION_HISTORY_RETENTION_DAYS`
- `INTEGRATION_PROVIDER_RESPONSE_MAX_BYTES`
- `INTEGRATION_REQUEST_TIMEOUT_MS`

## API Surface

All routes are under `/api/v1/workspaces/:workspaceId/integrations`.

- `GET /providers`
- `GET /`
- `POST /`
- `GET /:integrationId`
- `PATCH /:integrationId`
- `POST /:integrationId/test`
- `POST /:integrationId/disconnect`
- `POST /:integrationId/actions/:capability`

## Capabilities

HighLevel:

- `contacts.list`
- `contacts.get`
- `contacts.create`
- `contacts.update`
- `opportunities.list`
- `opportunities.create`
- `opportunities.update`

Slack:

- `channels.list`
- `messages.send`

Webex:

- `spaces.list`
- `messages.send`

Generic REST:

- `connection.test`
- `http.get`
- `http.post`
- `http.patch`

## Operational Notes

This phase implements the foundation and scoped action execution. Provider credentials were not live-verified against external services during local implementation. Background sync, arbitrary connector code, OAuth exchange, provider marketplace behavior, and additional providers are intentionally out of scope.
