# Phase 19.3 Offline Read Cache

Status: MAIN IMPLEMENTATION COMPLETE / LOCAL WINDOWS VERIFICATION PASS EXCEPT ENVIRONMENT-LIMITED NEXT STANDALONE SYMLINK COPY.

## Scope

Phase 19.3 adds a read-only application-layer offline cache for selected safe workspace data. It does not add offline login, offline mutations, mutation replay, conflict resolution, background sync, Web Push subscriptions, VAPID keys, notification permission prompts, or service-worker API JSON caching.

No database migration is required.

## Architecture

- Storage database: `zea-play-offline`.
- Schema version: `1`.
- Storage backend: IndexedDB in supported browsers, with an in-memory fallback for unsupported/test environments.
- Repository: `apps/web/services/offline-cache.ts`.
- Central policy registry: `apps/web/services/offline-cache-policy.ts`.
- Service worker policy remains separate and does not cache authenticated API JSON or Authorization-bearing requests.

Offline cache records are keyed by:

```text
schemaVersion + userId + scopeType + scopeId + resourceType + resourceId + normalizedQueryHash
```

This prevents another user or another tenant on the same browser from inheriting cached private data.

## Cacheable Resources

- Workspace task list.
- Workspace task minimal detail.
- Workspace task calendar summary.
- Workspace project list.
- Workspace project minimal detail.
- Workspace ticket list.
- Workspace ticket minimal detail.
- Workspace ticket queue summary.

Dashboard, Developer, Platform, Super Admin, API key, webhook, integration, billing, audit, Docs body, Form response, file binary, cloud-drive credential, and automation-secret surfaces are not cached.

## Field Allowlists

Tasks cache only display-safe summary/detail fields such as id, title, priority, status, department, planned/due dates, safe assignee names, safe project names, counts, completion summary, createdAt, and updatedAt. It excludes comments, internal comments, proof body values, attachment URLs, audit activity, tokens, secrets, and raw payloads.

Projects cache only summary/detail metadata such as id, name, status, priority, visibility, progress, task counts, department, owner display metadata, member count, createdAt, and updatedAt. Project description is intentionally nulled in offline storage.

Tickets use the most conservative allowlist: id, workspaceId, sequence/ticket number, subject, status, priority, department, assignee display metadata, escalation level, createdAt, updatedAt, and SLA state/due timestamps. Requester contact fields, external email/phone, conversation, internal notes, attachments, audit payloads, and escalation reasons are excluded.

## TTL And Stale Limits

- Task lists/details: 30 minute TTL, 2 hour maximum stale age.
- Task calendar: 15 minute TTL, 1 hour maximum stale age.
- Project lists/details: 45 minute TTL, 2 hour maximum stale age.
- Ticket lists/details: 20 minute TTL, 1 hour maximum stale age.
- Ticket queue summary: 10 minute TTL, 30 minute maximum stale age.

Cached data is visibly labeled as offline, cached, read-only, and last updated. Data older than the maximum stale age is not displayed.

## Read Flow

Online:

1. Request authoritative data from the API.
2. Server authorization remains the source of truth.
3. Sanitize response through the policy registry.
4. Write a bounded offline snapshot asynchronously.
5. Render the authoritative response.

Offline:

1. Only use cache on genuine connectivity failure.
2. Verify authenticated user context, scope type, scope ID, tenant status, schema version, resource policy, and maximum stale age.
3. Render the cached snapshot with a stale/offline indicator.
4. If validation fails, leave the normal offline/error fallback in place.

HTTP 401 and 403 never fall back to cached private data. HTTP 404 invalidates the matching cached detail record.

## Logout And Tenant Switch

Logout deletes all offline records for the authenticated user even if the network logout request fails. Tenant/context changes clear the active React Query view and swap the offline namespace before rendering matching data. BroadcastChannel is used where available so another tab clears active query state after offline cache cleanup.

## Quota And Pruning

The repository prunes:

- expired records,
- incompatible schema records,
- old per-policy records beyond maxRecords,
- old records from other users after a retention window.

Quota write failures skip the cache write and keep online behavior working. Cached record bodies are never logged in production.

## Non-Cacheable Resources

Phase 19.3 does not persist:

- JWTs, refresh/session secrets, OTP/reset tokens, passwords, API keys, webhook secrets, OAuth tokens, or integration credentials.
- Billing payment details.
- Audit payloads.
- Private file binaries or MinIO objects.
- Private Docs body content.
- Form submissions or PII responses.
- Cloud-drive credentials.
- Automation payloads, webhook bodies, or secret headers.
- Global search indexes.

Docs and Forms list metadata may be considered in a later phase with an explicit policy, but body/submission caching is out of scope here.

## Known Limitation

Membership can be revoked while a device is offline. Phase 19.3 mitigates this with short TTLs, maximum stale limits, no offline mutation authority, 401/403 cache blocking, tenant status checks from local session state, and server authority immediately after reconnect.

## Phase 19.4 Boundary

Phase 19.4 remains responsible for offline mutation queues, background replay, conflict merge UI, Web Push subscription persistence, VAPID keys, push delivery, notification permission flow, and push worker behavior.

## Validation

- Focused Phase 19.3 web test: PASS, 1 file / 7 tests.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- Root `pnpm test`: PASS, 17 tasks; web 36 files / 266 tests, API 75 suites / 678 tests, worker 12 suites / 37 tests.
- `pnpm test:e2e`: PASS, 21 tests.
- `pnpm audit --prod --audit-level high`: PASS; 9 moderate production advisories remain below the high gate.
- `git diff --check`: PASS; Windows LF/CRLF warning only.
- Root `pnpm build`: PARTIAL on Windows. API, worker, and package builds passed; Next.js web compiled, typechecked, collected data, generated 74/74 static pages, then failed while copying standalone traced files because Windows denied symlink creation (`EPERM`).
