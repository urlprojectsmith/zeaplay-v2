# Phase 17.2 Reports Architecture

Phase 17.2 adds saved analytics reports, CSV/XLSX exports, and scheduled report execution on top of the Phase 17.1 analytics foundation. Reports do not introduce a second analytics engine. Report preview, export, and schedule execution all call the existing `AnalyticsService` and store report metadata, execution history, and generated export files around those analytics results.

## Status

Phase 17.2 final certification is complete and passing. The certified migration inventory is 85 migrations with latest migration `0085_phase17_2_reports`.

Phase 17.3 Search, Phase 17.4 Custom Dashboards, Phase 17.5 final certification, and Phase 18+ are not implemented by this document.

## Implementation Surface

- API module: `apps/api/src/modules/reports`.
- API migration: `apps/api/prisma/migrations/0085_phase17_2_reports/migration.sql`.
- API registration: `apps/api/src/app.module.ts`.
- Queue constants: `REPORTS_QUEUE`, `REPORT_EXPORT_JOB_TYPE`, and `REPORT_SCHEDULE_SCAN_JOB_TYPE`.
- Worker processor: `apps/worker/src/processors/report-export.processor.ts`.
- Frontend routes:
  - `/workspace/reports`
  - `/agency/reports`
  - `/super-agency/reports`
  - `/super-admin/reports`
- Frontend service and shared page:
  - `apps/web/services/reports.ts`
  - `apps/web/components/reports/ReportsPage.tsx`

## Scope Model

Reports use the same `AnalyticsScopeType` values as analytics:

- `WORKSPACE`
- `AGENCY`
- `SUPER_AGENCY`
- `PLATFORM`

Every report stores:

- `scope_type`
- `scope_id`
- nullable lineage fields for `workspace_id`, `agency_id`, and `super_agency_id`

The migration adds a database check constraint named `reports_scope_consistency` so the lineage columns must match the selected scope:

- Workspace reports require `workspace_id = scope_id` plus parent Agency and Super Agency lineage.
- Agency reports require `agency_id = scope_id` plus parent Super Agency lineage.
- Super Agency reports require `super_agency_id = scope_id`.
- Platform reports cannot carry Workspace, Agency, or Super Agency lineage.

This keeps same-ID collisions across hierarchy levels from becoming authorization ambiguity.

## Authorization

Report routes are protected by the existing authentication, tenant, and permission guards.

Workspace routes use:

- `JwtAuthGuard`
- `WorkspaceTenantGuard`
- `PermissionGuard`
- `x-agency-id`
- `x-workspace-id`

Agency routes use:

- `JwtAuthGuard`
- `AgencyTenantGuard`
- `PermissionGuard`
- `x-agency-id`

Super Agency routes use:

- `JwtAuthGuard`
- `SuperAgencyTenantGuard`
- `PermissionGuard`
- `x-super-agency-id`

Platform routes use:

- `JwtAuthGuard`
- `ReportsPlatformGuard`

Report permissions inserted by migration `0085_phase17_2_reports` are:

- `reports.view`
- `reports.create`
- `reports.edit`
- `reports.export`
- `reports.schedule`
- `reports.manage`
- `reports.platform.read`

The frontend-supplied route IDs and tenant headers are not sufficient by themselves. Existing tenant guards derive the usable tenant context from the authenticated user and the server-side membership hierarchy before the report service receives a scope.

## Visibility and Access

Reports support these visibility modes:

- `PRIVATE`
- `SELECTED_MEMBERS`
- `SCOPE`

Creators and users with `reports.manage` can manage the report. `SCOPE` reports are readable by authorized users in the already-validated scope. `SELECTED_MEMBERS` reports use `report_access` rows bound to exactly one subject per row by the `report_access_one_subject` check constraint.

Selected-member access is scope-specific:

- Workspace reports validate active `WorkspaceMembership` IDs in the same Workspace.
- Agency reports validate active `AgencyMembership` IDs in the same Agency.
- Super Agency reports validate active `SuperAgencyMembership` IDs in the same Super Agency.
- Platform reports validate selected User IDs.

Recipient configuration for scheduled reports follows the same scope boundaries. Cross-scope recipient arrays are rejected before persistence.

## Report Configuration

Report definitions store sanitized analytics configuration only:

- metric keys, with duplicates removed
- date preset or explicit start/end
- bucket
- dimension
- analytics filter IDs and values
- page and page size

Report type is one of:

- `SUMMARY`
- `TABLE`
- `TIME_SERIES`

The service validates report configurations by executing the analytics query before saving or updating a report. Unsupported metrics, dimensions, filters, date ranges, and scope/financial restrictions remain owned by Phase 17.1 analytics validation.

Reports use optimistic revision checks on update. The caller must provide `expectedRevision`; stale edits receive `REPORT_REVISION_CONFLICT`.

## Execution History

Report preview, manual export, and scheduled export operations create `report_executions` rows containing:

- report ID
- scope type and scope ID
- report revision
- configuration snapshot
- execution type
- status
- requester information where applicable
- row count or safe error code

Execution snapshots preserve the report definition used for that run without making historical executions mutable.

## Export Pipeline

Manual exports support:

- `CSV`
- `XLSX`
- optional idempotency key
- sync generation for small tables
- queued generation for explicit async requests or tables over `REPORT_SYNC_EXPORT_ROW_LIMIT`

Export records store:

- report revision
- config snapshot
- filename
- MIME type
- row count
- storage metadata
- expiration timestamp
- safe error code

Generated exports are retained for 7 days via `REPORT_EXPORT_RETENTION_DAYS`.

Downloads recheck report read access, verify the export belongs to the requested report and scope, require `READY` status, mark expired exports as `EXPIRED`, and return a short-lived presigned download URL. Raw storage keys are not returned as the download contract.

## CSV and XLSX Safety

CSV and XLSX export rendering protects spreadsheet consumers from formula injection. String cells whose trimmed value begins with `=`, `+`, `-`, or `@` are prefixed with a single quote before serialization.

CSV escaping follows standard quoted-cell behavior for commas, quotes, and newlines. XLSX output uses `exceljs` with a single worksheet named `Report`.

## Storage

Report exports use the existing storage abstraction rather than adding a new object store. Stored export keys follow:

`generated/reports/{scopeType}/{scopeId}/{exportId}`

The API path sets `storageProvider` to `MINIO` after upload. Worker-side async export generation uses the worker storage service and the same key convention.

## Scheduled Reports

Schedules support:

- `DAILY`
- `WEEKLY`
- `MONTHLY`

Each schedule stores timezone, local time, optional day-of-week, optional day-of-month, recipient configuration, enabled state, next run time, and last run time.

`ReportsSchedulerService` registers a repeatable queue job every 60 seconds. `ReportsScheduleProcessor` runs due schedule dispatch through `ReportsService.dispatchDueSchedules`.

Schedule occurrence claiming is idempotent. `report_schedule_occurrences` has a unique `(schedule_id, occurrence_key)` index, so duplicate workers cannot execute the same occurrence twice. Monthly schedules clamp day-of-month to the target month's number of days.

Scheduled exports currently generate CSV output and store the result through the same export storage pipeline.

## Database Objects

Migration `0085_phase17_2_reports` creates:

- `reports`
- `report_access`
- `report_executions`
- `report_exports`
- `report_schedules`
- `report_schedule_occurrences`

It also creates report enums for type, visibility, status, execution type/status, export format/status, and schedule frequency.

Important indexes include:

- `reports_scope_status_updated_idx`
- `reports_workspace_status_idx`
- `reports_agency_status_idx`
- `reports_super_agency_status_idx`
- unique report access indexes per subject type
- `report_executions_occurrence_key`
- `report_exports_user_idempotency_key`
- `report_exports_scope_status_created_idx`
- `report_exports_status_expires_idx`
- `report_schedules_enabled_next_idx`
- `report_schedules_scope_enabled_idx`
- `report_schedule_occurrences_once_key`

These indexes support scoped report listing, export status/retention scans, idempotency, due schedule scanning, and duplicate-occurrence prevention.

## Audit Logging

Report create, update, archive, export queue/ready, download authorization, and schedule changes write audit events through `AuditService`.

Audit metadata records the scope and a compact summary. It does not log full analytics output, full report data, export content, or presigned download URLs.

## Frontend Behavior

The reports UI is intentionally a reporting workspace, not a marketing page. It allows users to:

- list saved reports for the selected scope
- create a report definition
- choose summary/table/time-series output
- choose private/scope/selected-member visibility
- preview a report
- request CSV or XLSX export

React Query keys include both scope type and scope ID:

`['reports', scope, scopeId]`

This prevents report lists from being reused across Workspace, Agency, Super Agency, or Platform contexts.

## Boundaries and Deferred Work

This phase does not implement:

- Phase 17.3 global search
- Phase 17.4 custom dashboards
- custom formulas
- user-editable metric definitions
- a second analytics engine
- a second storage engine
- email delivery provider verification
- live external-provider verification

Reports remain a saved/exported presentation layer over the Phase 17.1 analytics engine.

## Certification Notes

Final certification verified:

- `pnpm prisma:generate`: PASS.
- `pnpm prisma:validate`: PASS.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- `pnpm test`: PASS, 17 tasks; API PASS, 69 suites / 639 tests; worker PASS, 10 suites / 33 tests; web PASS, 28 files / 218 tests.
- `pnpm test:integration`: PASS on isolated migrated PostgreSQL; API PASS, 9 suites / 117 tests; worker PASS, 10 suites / 33 tests.
- `pnpm test:e2e`: PASS, 21 tests, with Playwright `reuseExistingServer: false` preserved.
- `pnpm build`: PASS, 11 tasks.
- `pnpm audit --audit-level high`: PASS; two moderate advisories remain below the high gate.
- `pnpm phase14:6:13:migration-compat`: PASS, 85 migrations through `0085_phase17_2_reports`; clean install, legacy upgrade, Phase 15, Phase 15.4, Phase 16.1, Phase 16.2, zero-agency, one-agency, and many-agency scratch fixtures passed.
- `git diff --check`: PASS.
- Shared development database status was checked read-only and not migrated.

Security certification added service-level report permission rechecks for view, create, edit, export, schedule, and manage operations. `reports.platform.read` and `analytics.platform.read` are platform-only permissions and cannot be inserted into tenant custom roles. Scheduled report dispatch now ignores archived reports and revalidates recipient membership at execution time before export generation.

Integration coverage includes real CSV export, real XLSX export parsed with ExcelJS, scoped export storage, download authorization, missing export permission denial, scheduled report dispatch, and schedule idempotency. Focused worker coverage verifies async report export processing. Frontend coverage verifies Workspace, Agency, Super Agency, and Platform report surfaces plus account-context cache behavior.

Known warnings:

- Shared development database remains pending migrations `0081` through `0085` and was intentionally not migrated.
- Build keeps the existing Next.js ESLint-plugin warning.
- Playwright may emit the existing `NO_COLOR` / `FORCE_COLOR` warning.
- Audit has two moderate advisories below the requested high-severity gate.

Shared development databases must remain read-only unless explicitly authorized for migration.
