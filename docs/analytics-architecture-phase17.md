# Phase 17.1 Analytics Architecture

Status: Phase 17.1 main implementation in progress. Final certification is deferred to Phase 17.1 Prompt 2.

## Ownership

Analytics is read and aggregation infrastructure only. It does not own Tasks, Projects, Tickets, Gamification, Automation, Forms, Goals, Files, API usage, Memberships, Billing, or subscription state.

The hierarchy remains:

Platform / Super Admin -> Super Agency -> Agency -> Workspace / Sub-account.

- Workspace owns operational analytics scope.
- Agency receives only descendant Workspace aggregates.
- Super Agency receives descendant Agency/Workspace aggregates plus its own commercial billing aggregate metrics.
- Platform receives global aggregate analytics through platform-only permission.

`Organization` remains legacy compatibility metadata only.

## Repository Audit

Phase 17.1 reuses existing canonical sources:

- Task and Project status semantics use `StatusDefinition.isTerminal`.
- Ticket resolved/open status uses existing Ticket status definitions.
- Task/Project/Ticket parent aggregate patterns already exist in `ParentOversightService`.
- Workspace timezone is stored on `Workspace.timezone`; parent scopes use deterministic UTC rollup/display boundaries.
- Gamification XP reads `GamificationXpEntry`; global score reads `GamificationGlobalScoreEvent.normalizedScore`.
- Automation metrics read `AutomationExecution` and published `AutomationWorkflow`.
- Form metrics read `FormSubmission` only; answer values are not queried.
- Goal metrics read `Goal` status/progress metadata only; manual notes are not queried.
- File/storage usage follows canonical Asset quota semantics: active, archived, pending-delete, and purging Assets count until physical purge, plus active reservations.
- API usage reads Phase 15 `BillingUsageCounter` for `API_REQUESTS`.
- Membership analytics read active `WorkspaceMembership`.
- Billing analytics are limited to current subscription counts/statuses. MRR/ARR is not implemented because the current local projection is not sufficient for a precise formula.

## Metric Registry

The registry is code-defined at `apps/api/src/modules/analytics/analytics.registry.ts`. Clients may request only registered metric keys. Clients cannot send SQL, Prisma fields, table names, columns, raw expressions, aggregation functions, raw sort fields, or raw filters.

Registered metrics include:

- `tasks.total`, `tasks.completed`, `tasks.open`, `tasks.overdue`
- `projects.total`, `projects.completed`, `projects.active`
- `tickets.total`, `tickets.resolved`, `tickets.open`
- `gamification.xp_earned`, `gamification.global_score`, `gamification.badges_awarded`, `gamification.achievements_awarded`
- `automation.executions`, `automation.successful`, `automation.failed`, `automation.active_workflows`
- `forms.submissions`
- `goals.active`, `goals.completed`, `goals.expired`, `goals.completion_rate`
- `files.storage_bytes`, `files.assets`
- `api.requests`
- `memberships.active`
- `billing.active_subscriptions`

## Dimensions And Filters

The controlled dimension catalog is:

`DATE`, `HOUR`, `DAY`, `WEEK`, `MONTH`, `WORKSPACE`, `AGENCY`, `DEPARTMENT`, `STATUS`, `PRIORITY`, `PLAN`, `SUBSCRIPTION_STATUS`.

The controlled filter catalog is:

`DATE_RANGE`, `WORKSPACE`, `AGENCY`, `DEPARTMENT`, `STATUS`, `PRIORITY`, `PLAN`, `SUBSCRIPTION_STATUS`.

Every metric declares supported dimensions and filters. Unsupported filters and dimensions are rejected rather than ignored.

## Date And Timezone Policy

Canonical timestamps remain UTC. Analytics queries use half-open intervals:

`start <= occurredAt < end`

Workspace analytics uses `Workspace.timezone` for preset boundaries when a valid Workspace timezone exists. Agency, Super Agency, and Platform use UTC boundaries for deterministic parent aggregation. Browser timezone is never authority.

Supported presets are:

`TODAY`, `YESTERDAY`, `LAST_7_DAYS`, `LAST_30_DAYS`, `THIS_WEEK`, `LAST_WEEK`, `THIS_MONTH`, `LAST_MONTH`, `THIS_QUARTER`, `LAST_QUARTER`, `THIS_YEAR`, and `CUSTOM`.

Supported buckets are `HOUR`, `DAY`, `WEEK`, and `MONTH`.

## Freshness And Rollups

Cheap metrics use direct PostgreSQL aggregation with short Redis cache. Expensive and historical metrics are eligible for rebuildable rollups. Redis is cache only and is never analytics authority.

Migration `0084_phase17_1_analytics_foundation` adds `AnalyticsRollup` only. Rollups store explicit `scopeType + scopeId`, metric key, bucket window, optional dimension, value, version, and rebuild timestamp. This prevents same-ID collisions across Super Agency, Agency, and Workspace scopes.

No migration backfill is performed. Backfill/rebuild is explicit, bounded, idempotent, and worker/service driven.

The worker adds an `analytics-rollup` repeatable scan. It rebuilds recent daily `api.requests` Workspace rollups under a PostgreSQL advisory lock. The worker deletes and recreates the target bucket, making late-event repair and repeat rebuilds deterministic.

## Cache Model

Analytics responses cache briefly in Redis with keys containing scope type, scope id, metric keys, range, bucket, and dimension. A same UUID under a different scope type cannot share cached analytics. Cache staleness is intentionally short and never authoritative.

## Parent Privacy

Parent analytics returns safe aggregates only. It does not select or return:

- Form answers, signatures, upload tokens, or Asset IDs
- Doc content, comments, ACLs, versions, or share tokens
- Goal manual notes or owner membership details
- Ticket conversations, requester-private payloads, internal notes, or attachments
- File contents, object keys, signed URLs, buckets, or cloud credentials
- Integration credentials or provider secrets
- Card, payment method, Stripe customer, invoice URL, or raw provider payload data

## Financial Boundaries

Workspace and Agency analytics cannot request financial billing metrics.

Super Agency analytics may request its own commercial aggregate billing metrics with `analytics.parent.read`.

Platform analytics may request global billing aggregates with `analytics.platform.read`.

`billing.active_subscriptions` is the only billing metric in 17.1. MRR, ARR, invoice amount, tax, overage, payment-method, and card analytics remain unimplemented.

## Permissions

- Workspace route: `GET /api/v1/workspaces/:workspaceId/analytics/summary`, `analytics.view`
- Agency route: `GET /api/v1/agencies/:agencyId/analytics/summary`, `analytics.parent.read`
- Super Agency route: `GET /api/v1/super-agencies/:superAgencyId/analytics/summary`, `analytics.parent.read`
- Super Agency rebuild route: `POST /api/v1/super-agencies/:superAgencyId/analytics/rollups/rebuild`, `analytics.rebuild`
- Platform route: `GET /api/v1/platform/analytics/summary`, `analytics.platform.read`
- Registry route: `GET /api/v1/analytics/registry`

Restricted mode blocks writes through existing guards. Analytics summary reads remain available. Rollup rebuild is a privileged maintenance operation.

No Phase 15.3 commercial feature key was added for Analytics; existing billing allocation, usage, and restricted-mode authorities remain canonical.

## Frontend

Routes:

- `/workspace/analytics`
- `/agency/analytics`
- `/super-agency/analytics`
- `/super-admin/analytics`

The frontend uses scope-prefixed TanStack Query keys. Workspace and Agency requests omit billing metrics. Super Agency and Platform requests may include `billing.active_subscriptions`.

## Deferred

Phase 17.2 Reports, Phase 17.3 Search, Phase 17.4 Custom Dashboards, Phase 17.5 final certification, and Phase 18+ are not started.

Analytics does not add a report model, export system, search index, custom dashboard model, widget system, custom formula registry, or user-editable metric definition table in 17.1.
