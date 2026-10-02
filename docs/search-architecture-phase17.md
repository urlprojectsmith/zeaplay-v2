# Phase 17.3 Search Architecture

Status: Phase 17.3 final certification PASS. PostgreSQL global search, worker indexing, parent/platform-safe search, migration compatibility, performance evidence, and final gates are verified.

## Engine And Index Decision

Search V1 uses PostgreSQL only:

- PostgreSQL full-text search with the `simple` text-search configuration.
- `pg_trgm` trigram indexes for bounded typo tolerance.
- GIN indexes on `search_vector`, title trigram, and safe search text trigram.
- No Elasticsearch, OpenSearch, Meilisearch, Algolia, Typesense, or external search cluster.

Phase 17.3 uses a central derived `SearchDocument` index instead of only direct domain queries. The decision is intentional because global search needs consistent cross-module ranking, deterministic pagination, recent-search behavior, safe snippets, rebuild/reconciliation, worker/job tracking, and identical scope enforcement across modules. Canonical domain tables remain authoritative. `SearchDocument` is rebuildable derived data and is never permission authority.

## Scope Model

Every search request and index row has explicit `scopeType + scopeId`.

Supported scopes:

- `WORKSPACE`
- `AGENCY`
- `SUPER_AGENCY`
- `PLATFORM`

UUIDs are never interpreted without `scopeType`. Same-ID Agency/Super Agency compatibility remains safe because cache keys, index uniqueness, recent history, and query predicates all include both values.

Workspace search covers authorized workspace operational results. Agency and Super Agency search use parent-safe metadata rows only. Platform search requires platform search permission and returns platform-safe metadata only by default.

## Result Types

The server-owned registry supports:

`TASK`, `PROJECT`, `TICKET`, `DOC`, `FORM`, `GOAL`, `FILE`, `MEMBER`, `AUTOMATION`, `API_KEY`, `WEBHOOK`, `INTEGRATION`, `BILLING_METADATA`, `SUPER_AGENCY`, `AGENCY`, `WORKSPACE`.

Clients can request only registered result types. Server code owns route metadata, ranking, fuzzy thresholds, privacy classification, and type permissions.

## Indexed Fields

Workspace rows may index safe operational text:

- Tasks: title, description, priority/status metadata.
- Projects: name, description, status, visibility.
- Tickets: ticket number, subject, description. Conversation bodies and internal notes are not indexed for parent search.
- Docs: title and deterministic plain text extracted from structured JSON. Share tokens, passwords, signed URLs, comments, and executable HTML are not indexed.
- Forms: definition title and description only. Submission answers, email/phone/signature/upload answers, hidden values, and public upload tokens are not indexed.
- Goals: title, description, metric and period labels. Manual/private progress notes are not indexed.
- Files: metadata only, such as display name, original filename, extension, and MIME type. No OCR, PDF parsing, binary body indexing, or external Drive document-body indexing.
- Members: WorkspaceMembership-visible name/email only.
- Automations: workflow name, description, and status. Execution payloads, secrets, and credentials are not indexed.
- API keys: name, description, public identifier, and status. Secret hashes and raw tokens are not indexed.
- Webhooks: name, description, event types, and status. Signing secrets and delivery payloads are not indexed.
- Integrations: provider, connection display name, account label, and status. Access tokens, refresh tokens, credentials, and encrypted credential material are not indexed.
- Billing metadata: invoice number/provider/status only for Super Agency or Platform safe surfaces.

Parent scopes index safe management metadata only: Workspaces, Agencies, Super Agencies, and authorized billing metadata. Parent docs/forms/goals/tasks/projects/tickets use parent-safe rows and query-time permissions.

## Ranking

Ranking is server-owned:

- Exact title match has the highest boost.
- Title prefix match is next.
- PostgreSQL FTS rank contributes relevance.
- Trigram similarity contributes typo tolerance for queries with 3+ characters.
- Recency is a small tie-breaker only.

The client cannot provide ranking weights, SQL, Prisma fields, trigram thresholds, or raw filters.

## Query Limits

Defaults:

- Minimum query length: 2 characters.
- Fuzzy minimum query length: 3 characters.
- Maximum query length: 160 characters.
- Maximum requested result types: 8.
- Maximum page size: 25.
- Empty search does not execute broad database scans.

Pagination is bounded offset pagination with deterministic ordering by score, source update time, and index row ID.

Search queries run inside a PostgreSQL transaction-local statement timeout of `1500ms`. This timeout is limited to the expensive FTS/trigram query path and does not change global database settings or lightweight recent-search CRUD. Timeout failures are mapped to a safe `SEARCH_QUERY_TIMEOUT` application response.

Search endpoints also enforce server-side rate limiting through the existing Redis rate-limit connection with a non-production in-memory fallback. Limits are scoped by action, actor, scope type, and scope ID:

- search query: 90 requests per minute
- recent-search clear: 30 requests per minute
- platform/internal rebuild enqueue: 5 requests per minute

## Privacy And Authorization

Search authorization has three layers:

1. Tenant guards validate the selected Workspace, Agency, Super Agency, or Platform scope.
2. `search.view` opens search, but result types still require module permissions or parent-read permissions.
3. ACL-sensitive rows are rechecked against canonical domain tables before response serialization.

Examples:

- Private or selected-member Docs are returned only to creators or explicit Doc ACL members.
- Restricted Projects recheck owner/member access.
- Parent search never returns private Docs, selected-member Docs, Form submissions, ticket conversation bodies, internal notes, goal private/manual notes, file contents, or credential material.
- Stale index rows cannot authorize open-time access. Result routes must continue to use the existing canonical module guards.

## Snippets And XSS

The database produces bounded snippets from indexed safe text. The API strips HTML-like tags and `javascript:` before returning snippets. The frontend renders titles, snippets, and metadata as React text, not as HTML.

## Cache

Search cache is Redis-backed and short-lived. Cache keys include:

- scope type
- scope ID
- actor user ID
- actor membership ID when present
- normalized query
- result type set
- page/page size
- archive flag

Actor-sensitive cache keys prevent private/selected Doc leakage between two users in the same Workspace. Redis is cache only and never search authority.

## Recent Searches

Recent searches are stored in PostgreSQL in `recent_searches`, keyed by user plus explicit `scopeType + scopeId`. They are bounded to 10 per user/scope, deduplicated by normalized query, and clearable per scope. Saved searches, popular searches, and search analytics are deferred.

## Index Worker And Rebuild

`search_index_jobs` records index/rebuild work with operation, status, source identity, attempts, timestamps, and safe error code. The API enqueues rebuild jobs to the existing worker application on the `search-index` BullMQ queue. Worker payloads carry safe routing/freshness metadata only: operation, scope/entity IDs, source updated time/version, type list, and correlation ID. Full Doc content, Form answers, PII, credentials, secrets, tokens, and signed URLs are never queued.

The `SearchIndexProcessor` reloads canonical entities from PostgreSQL before writing derived index rows. Multi-worker safety relies on PostgreSQL, not process-local locks: `search_documents` has a scoped unique key, and writes use source version/source updated time freshness predicates so older jobs cannot overwrite newer derived rows. Deletes and parent-row removal use the same freshness predicate.

Index rows are unique by `scopeType + scopeId + entityType + entityId`. Source `updatedAt` and `sourceVersion` support stale-event protection and reconciliation. Archive/delete handling is represented by the derived row `archived` flag or by deleting/rebuilding scope rows from canonical data.

Tenant rebuild endpoints are not exposed. Rebuild/repair is a platform/internal operation only; tenant `search.manage` is not sufficient to launch repair/backfill. Rebuild work remains bounded by scope and requested result types.

Parent indexing is privacy-shaped. Agency and Super Agency rows can include safe Task/Project/Ticket/Form/Goal metadata and eligible Workspace-visible Doc content, but never selected-member/private Docs, Form submissions, ticket conversations/internal notes, credential material, signed URLs, or file bodies.

## Tamil Compatibility

The text-search config is `simple` because ZeaPlay supports English and Tamil UI. This preserves Tamil Unicode and supports exact, prefix, and trigram matching, but it does not claim Tamil linguistic stemming.

## Frontend

The dashboard header exposes global search for Workspace, Agency, Super Agency, and Platform/Super Admin scopes. The palette supports:

- Ctrl/Cmd+K open behavior.
- Mobile search button.
- Debounced query.
- Grouped result types.
- Keyboard focus through native controls.
- Recent searches and clear history.
- Tenant-switch cache cleanup through the existing session query boundary.

Developer dashboard search remains disabled in V1 because Developer is internal diagnostics authority, not a tenant search scope.

## Final Certification Evidence

Final Phase 17.3 certification verified:

- Migration inventory: 86 migrations, latest `0086_phase17_3_global_search`.
- Migration compatibility: clean install, legacy upgrade, seeded Phase 15/16 paths, populated `0085_phase17_2_reports` to `0086`, seed twice, edge cases, and `pg_trgm` all PASS.
- Populated `0085` fixture: 19 entity categories preserved; `SearchDocument` remains derived and empty after upgrade until indexed/rebuilt.
- Real PostgreSQL Search integration: 1 suite / 8 tests, covering module coverage, worker canonical reload, multi-worker concurrency, stale jobs, destructive stale protection, backfill batching/idempotency, rebuild authorization, reconciliation, parent/platform privacy, query plans, FTS/trigram/scope index usage, cache/recent history, rate limits, and statement timeout.
- Full integration: API 10 suites / 125 tests and worker 11 suites / 35 tests PASS.
- Unit regression: root `pnpm test` passes without `NODE_OPTIONS`; API 70 suites / 648 tests, worker 11 suites / 35 tests, web 29 files / 224 tests.
- API Jest OOM remediation: API unit Jest is bounded to `maxWorkers: 1`; no heap override is required.
- Fresh web: 29 files / 224 tests PASS.
- E2E: 21 tests PASS.
- Build: PASS.
- Audit high: PASS; 9 moderate advisories remain below the high gate.
- Prisma generate/validate: PASS.

Phase 17.4 Custom Dashboards, Phase 17.5 final certification, and Phase 18+ remain not started.
