# Phase 17.4 Custom Dashboards Architecture

Status: Final Phase 17.4 certification complete/pass. Phase 17.5 and Phase 18+ remain not started.

## Ownership

Custom dashboards are saved presentation definitions. They do not own Tasks, Projects, Tickets, Docs, Forms, Goals, Gamification, Billing, Reports, Search, Assets, Notifications, or Analytics source data.

Supported scopes are `WORKSPACE`, `AGENCY`, `SUPER_AGENCY`, and `PLATFORM`, stored as explicit `scopeType + scopeId` with lineage columns for Workspace, Agency, and Super Agency. Developer users do not automatically receive tenant-private dashboards; Platform dashboards require platform dashboard permission.

Workspace dashboards support `PRIVATE`, `SELECTED_MEMBERS`, and `WORKSPACE` visibility. Parent and Platform dashboards support `PRIVATE`, `SELECTED_MEMBERS`, and `SCOPE`. Selected Workspace access is validated against active same-Workspace `WorkspaceMembership` records.

## Widget Catalog

Allowed widget types are:

- `METRIC_CARD`
- `LINE_CHART`
- `BAR_CHART`
- `AREA_CHART`
- `PIE_CHART`
- `DONUT_CHART`
- `TABLE`
- `GOAL_PROGRESS`
- `GAMIFICATION_SUMMARY`

Widgets may use only `ANALYTICS_QUERY` or `SAVED_REPORT` data sources. HTML, JavaScript, iframe, external URL, custom React, raw SQL, Prisma-field, and arbitrary formula widgets are explicitly rejected.

## Analytics And Reports Reuse

Analytics widgets call the Phase 17.1 `AnalyticsService`, Metric Registry, Dimension Registry, Filter Registry, date presets, comparison/range validation, metric limits, and financial metric checks. Widgets do not introduce a `DashboardAnalyticsEngine` or duplicate domain calculators.

Report widgets reference Phase 17.2 saved reports by ID and call `ReportsService.preview`, so report ACL, archived state, financial permission, and current report configuration are rechecked at load time. Dashboard load never copies report result data into dashboard storage. If the dashboard is readable but the report is not, the widget returns `ACCESS_REVOKED` or `UNAVAILABLE` without leaking previous data.

## Layout And Responsive Model

Each widget stores validated grid layout JSON: `x`, `y`, `width`, `height`, `breakpoint`, and `order`. The server rejects negative coordinates, zero sizes, excessive width/height, and widgets outside the dashboard. Desktop uses the stored grid. Tablet/mobile rendering stacks by deterministic `order`, then `y`, then `x`. Editors can drag/reorder widgets through the existing `@dnd-kit` dependency; viewers cannot mutate layout.

The technical widget limit is 30 per dashboard. It is enforced in service validation and by a database trigger. Forward-only migration `0088_phase17_4_dashboard_widget_limit_lock` adds a transaction-scoped advisory lock to the trigger so concurrent inserts cannot race a 29-widget dashboard past the 30-widget ceiling.

## Filters, Dates, And Refresh

Dashboard global filters support Phase 17.1 date ranges and safe registry-backed filters. A widget can inherit global filters or override supported filters in controlled configuration. Unsupported dimensions/filters are rejected by widget validation or by the underlying analytics service.

Auto refresh is opt-in per widget with a 60-second minimum. The frontend uses TanStack Query refetch intervals and does not refetch in inactive tabs/background mode. Live streaming, WebSocket widgets, presence dashboards, public dashboard links, public embeds, PDF/dashboard export, and admin-forced defaults are deferred.

## Concurrency

Dashboard and widget mutations participate in the dashboard `revision`. Updates require `expectedRevision`; stale updates return `DASHBOARD_REVISION_CONFLICT` rather than silently overwriting another editor. Layout updates use the same revision strategy.

## Preferences

Favorites and defaults are per user and per explicit scope context. Favorites do not grant access. Default dashboards are rechecked at load time; archived or inaccessible dashboards are not usable as defaults. Archive removes default preference rows.

## Duplication, Archive, And Templates

Duplicating a dashboard copies metadata, widgets, layout, and safe filters only. It does not copy cached data, report results, favorites, default preferences, or ACL rows. Workspace duplicates default to `PRIVATE`; parent/platform duplicates default to `SCOPE`.

Dashboards can be archived and restored. Routine hard delete is not implemented.

Code-owned starter templates are provided for Team Performance, Project Overview, Ticket Operations, Gamification, Automation, Goals, Forms, Storage & API Usage, and Commercial Health where the scope allows financial metrics. Workspace and Agency scopes expose 8 templates. Super Agency and Platform scopes expose those 8 plus Commercial Health, for 9 templates.

## Privacy And Security

Parent dashboards can show only safe aggregate analytics and authorized report widgets. They do not expose Form answers, signatures, private Docs, ticket conversations/internal notes, Goal manual notes, file object keys/signed URLs, integration credentials, payment methods, card data, Stripe customer identifiers, raw invoice payloads, or private child dashboards.

Workspace and Agency dashboards cannot use financial widgets. Super Agency and Platform can use the existing `billing.active_subscriptions` metric only when the Phase 17.1 metric permissions allow it.

Dashboard rendering does not create XP, Global Score, rewards, achievements, streaks, badges, leaderboard entries, Goal progress, notifications, report exports, or Search documents.

AuditLog records dashboard lifecycle and widget/layout mutations with compact metadata only. It does not log analytics output, report result data, or widget query payloads containing sensitive values.

## Commercial Decision

No new Phase 15 commercial entitlement key was added for Custom Dashboards. Existing restricted-mode, permission, analytics, reports, and billing authorities remain canonical.

## Final Verification

Final Phase 17.4 verification passed on September 30, 2026:

- `pnpm prisma:generate`: PASS.
- `pnpm prisma:validate`: PASS.
- Focused API dashboard regression: PASS, 1 suite / 5 tests.
- Real PostgreSQL dashboard integration: PASS, 1 suite / 5 tests.
- `pnpm test:integration`: PASS; API 11 suites / 130 tests, worker 11 suites / 35 tests.
- `pnpm test:e2e`: PASS, 21 tests.
- Fresh web suite: PASS, 30 files / 228 tests.
- `pnpm build`: PASS, 11 tasks.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- Root `pnpm test`: PASS, 17 tasks; API 71 suites / 653 tests, worker 11 suites / 35 tests, web 30 files / 228 tests.
- `pnpm phase14:6:13:migration-compat`: PASS, 88 migrations through `0088_phase17_4_dashboard_widget_limit_lock`.
- `pnpm audit --audit-level high`: PASS; 9 moderate advisories remain below the high gate.
- `git diff --check`: PASS; Windows line-ending warnings only.
- Targeted dashboard security/source search: PASS after review; hits were expected docs/test text and sanitizer rejection code.
- Shared development database was read-only and not migrated. Status reports `0081` through `0088` pending on shared `zea_play`.

## Deferred

Public sharing, realtime/live dashboards, dashboard exports/PDF, anonymous embeds, admin-forced defaults, custom formulas, Phase 17.5 final certification, and Phase 18+ remain deferred/not started.
