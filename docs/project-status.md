# Zea Play Project Status

Current: Phase 8.8 - Project UI Integration - COMPLETE / PASS
Next: Phase 8.9 - Final Project Security + Performance Audit; do not start automatically

This document is the compact handoff source of truth for future Codex sessions. Code and tests remain authoritative if this document ever disagrees with implementation.

Do not implement Phase 6 from this document alone. Use it to avoid rescanning completed Phase 1-5 work.

## Completed

### Phase 1 - PASS

Foundation / monorepo / infrastructure.

### Phase 2 - PASS

Authentication / security / JWT / refresh rotation / CSRF / RBAC / audit.

### Phase 3 - PASS

Assets / MinIO / presigned uploads/downloads / worker processing / quota.

### Phase 4 - PASS

Agency -> Workspace tenancy / memberships / scoped RBAC / feature entitlement foundation.

### Phase 5 - PASS

Design system / dashboard shells / Light-Dark-Colorful themes / protected frontend routing / responsive navigation / Agency-Workspace switching / white-label UI foundation / English-Tamil i18n / Storybook.

### Phase 6.1 - PASS

Workspace Users + Departments foundation.

Implemented:

- `/workspace/users` with paginated server-side workspace membership search, status/role/department filters, detail panel, role/status actions, and department assignment/removal.
- `/workspace/departments` with workspace-scoped department list, create/edit, activate/deactivate, manager assignment, member counts, and member visibility API.
- Workspace-scoped `/api/v1/workspaces/:workspaceId/users` and `/api/v1/workspaces/:workspaceId/departments` APIs.
- `Department` model plus optional `WorkspaceMembership.departmentId` assignment.
- Minimal stable permissions: `users.view`, `users.manage`, `departments.view`, `departments.create`, `departments.update`, `departments.manage_members`.

Security invariants:

- `x-agency-id` and `x-workspace-id` must agree with route params through the existing workspace tenant guard.
- Workspace membership mutations are scoped by `(userId, workspaceId)`.
- Foreign department assignment and foreign manager assignment are rejected.
- Workspace OWNER membership cannot be changed through Phase 6.1 user actions.
- Suspended memberships remain blocked by tenant resolution.
- Department managers must have an active membership in the same Workspace.
- Inactive Departments may retain existing members, but cannot receive new member assignments or managers.

Known limitations:

- User identity creation/invitation, final Agency/Super Admin user management, and custom role management remain deferred.
- Department hierarchy/nesting and many-to-many department membership are intentionally not implemented.

### Phase 6.2A - PASS

Workspace custom Roles + Permission Management backend foundation.

Implemented:

- Workspace-scoped role APIs for list, get, create custom role, update, clone, activate/deactivate, and permission replacement.
- Workspace-scoped permission catalog API backed by server-controlled `Permission` records.
- `Role.isActive` and normalized workspace role-name uniqueness for case/whitespace duplicate rejection.
- Custom role assignment through workspace membership mutation by `roleId`, with same-workspace, active-role, and workspace-scope validation.
- Minimal stable role-management permissions: `roles.view`, `roles.create`, `roles.update`, `roles.manage_permissions`, `roles.assign`.
- Protected system role behavior for `OWNER`, `ADMIN`, `MANAGER`, and `MEMBER`; system roles cannot be mutated through custom-role APIs.
- Privilege delegation guard: non-OWNER callers cannot grant permissions they do not already possess, and wildcard permission assignment is rejected.
- Workspace permission catalog responses omit wildcard permissions; OWNER-derived clones copy only explicit safe permissions.
- Workspace membership role changes are self-change protected across both users and membership APIs.
- Audit events for role creation, update, clone, activation/deactivation, permission replacement, and membership role changes.

Security invariants:

- Custom roles belong to exactly one Workspace and are hidden from other Workspaces and Agencies.
- Workspace route params, `x-agency-id`, `x-workspace-id`, and role ownership remain checked by the existing workspace tenant guard plus service-level ownership filters.
- Inactive roles cannot be assigned; deactivation is rejected while active memberships still reference the role.
- Workspace OWNER wildcard behavior remains key-based and cannot be cloned into custom roles.

Known limitations:

- Agency custom roles, platform/developer/super-admin roles, and invitations remain deferred.

### Phase 6.2B - PASS

Workspace Role Management + Permission Matrix UI.

Implemented:

- `/workspace/roles` route with searchable/filterable system and custom role list.
- Role detail panel with protected system-role read-only state and editable custom role metadata/status.
- Permission matrix grouped by module with permission-level toggles, module select-all/partial state, select all, clear, reset, and save.
- Create-role and clone-role dialogs backed by the Phase 6.2A role APIs.
- Active custom roles are available in `/workspace/users` role assignment while inactive roles and OWNER remain excluded.
- Tenant-aware React Query keys keep Agency/Workspace switching isolated and clear stale role detail state.
- English and Tamil labels for the role management UI.

Security invariants:

- The frontend only calls workspace-scoped backend APIs; backend authorization remains authoritative.
- System roles remain visually and functionally read-only for metadata/status/permission edits.
- Permission updates are delegated to the backend permission replacement endpoint instead of client-side trust.

Known limitations:

- Phase 6.2B is UI-only on top of Phase 6.2A; it does not introduce Agency/platform custom roles.
- Invitation flows, destructive custom-role deletion, and bulk role assignment remain deferred.

### Phase 6.2C - PASS

Final Roles + Permissions integration/security audit.

Verified:

- Permission catalog -> custom Role -> permission assignment -> WorkspaceMembership role assignment -> tenant context resolution -> PermissionGuard -> API authorization flow.
- Role permission changes propagate on the next backend-authorized request without cache staleness.
- WorkspaceMembership role changes propagate on the next backend-authorized request.
- Custom Roles cannot obtain OWNER wildcard behavior through naming, cloning, permission replacement, wildcard payloads, or system-role mutation paths.
- Non-OWNER permission delegation cannot exceed caller permissions.
- Inactive Roles cannot be newly assigned and cannot be deactivated while active memberships still reference them.
- Cross-Workspace, cross-Agency, header-forgery, and foreign role-id injection attacks are rejected.
- Workspace Roles page continues to use backend catalog data, tenant-scoped query keys, protected system-role UI, dirty-state confirmation, and responsive layouts.
- Mutation audit records are present for role creation, clone, metadata/status changes, permission changes, and membership role changes.

Phase 6.2 complete invariants:

- Workspace custom Roles are tenant scoped.
- Permission catalog is backend authoritative.
- Custom Roles cannot obtain OWNER wildcard.
- Permission delegation cannot exceed caller delegation authority.
- Role changes propagate to backend authorization.
- Inactive Roles cannot be newly assigned.
- Workspace switching cannot leak Role/Permission state.

### Phase 6.3A - PASS

Shared Status/Pipeline Management backend foundation.

Implemented:

- One Workspace-scoped `StatusDefinition` model for `TASK`, `PROJECT`, and `TICKET`.
- Strong entity-type and semantic category enums for shared status behavior.
- Status fields for normalized name uniqueness, description, safe HEX color, explicit position, default, terminal, active, and system flags.
- Forward migration with workspace/entity/name uniqueness, hot-path ordering index, and PostgreSQL partial unique index preventing multiple active defaults per Workspace/entity type.
- Idempotent default initialization for new and seeded Workspaces.
- Default templates:
  - TASK: To Do, In Progress, Review, Completed.
  - PROJECT: Initial Meeting, Requirement Analysis, Development, Testing, Client Review, Deployment, Completed.
  - TICKET: New, Assigned, In Progress, Waiting, Resolved, Closed.
- Workspace status APIs for list, get, create, update, activate/deactivate, set default, reorder, and default initialization.
- Minimal shared permissions: `statuses.view`, `statuses.create`, `statuses.update`, `statuses.reorder`, `statuses.manage`.
- Audit events for status creation, update, activation/deactivation, default changes, reorder, and default initialization.

Security invariants:

- Status definitions are scoped to exactly one Workspace and entity type.
- Status APIs use the existing JWT -> WorkspaceTenantGuard -> PermissionGuard chain.
- Status names are normalized per Workspace/entity type; duplicate casing/spacing is rejected.
- Status colors accept strict `#RRGGBB` values only.
- Exactly one active default is preserved per initialized Workspace/entity type.
- Default statuses cannot be deactivated or unset directly.
- Entity-type, foreign Workspace, cross-Agency, duplicate reorder, missing reorder, and status-limit attacks are rejected.
- New status permissions flow through the existing backend permission catalog and custom-role delegation rules.

Project compatibility decision:

- Existing `Project.status` enum remains authoritative for current Project APIs.
- `Project.statusDefinitionId` was added as an optional same-Workspace relation for future Project pipeline migration/override work.
- Phase 6.3A does not implement Project-specific pipeline overrides or redesign Project Management.

Known limitations:

- No Status Management frontend yet.
- No Task/Ticket models, Kanban, transitions, automation, gamification, or Redis status cache.
- Existing Project APIs still use the legacy `Project.status` enum until a future migration phase adopts `StatusDefinition`.

### Phase 6.3B - PASS

Status Management UI on top of the Phase 6.3A backend.

Implemented:

- `/workspace/statuses` route linked from the Workspace sidebar as Status Management.
- One shared UI for `TASK`, `PROJECT`, and `TICKET` status definitions.
- Entity-specific labels: Task Statuses, Project Pipeline, and Ticket Statuses.
- Create/edit dialogs with name, optional description, strict HEX color input, curated color palette, semantic category, and terminal toggle.
- Explicit Set as Default confirmation that shows current and target default statuses.
- Active/inactive filtering, protected current-default deactivation UI, reactivation, and default initialization empty state.
- Position ordering through Move Up/Move Down controls using the full backend reorder payload.
- React Query keys scoped by Workspace and entity type to avoid stale Workspace leakage.
- English and Tamil labels for the status management UI.
- Frontend unit coverage for tabs, create/edit validation, duplicate/error handling, default changes, active/inactive actions, reorder rollback, status cap, Workspace switching, Tamil labels, and theme contexts.
- E2E coverage for authenticated status management lifecycle across task/project/ticket tabs.

Security invariants:

- The frontend only calls Workspace-scoped Phase 6.3A APIs; backend tenant authorization and permission checks remain authoritative.
- Status IDs are sent only to the backend endpoints that validate Workspace/entity ownership.
- Reorder controls operate only from the full All-statuses list so the backend receives a complete ordered ID set.
- Create is disabled from the full entity count when the backend limit of 50 statuses is reached.

Known limitations:

- Phase 6.3B is UI-only and does not migrate Project APIs to `statusDefinitionId`.
- No Task/Ticket models, Kanban, workflow transitions, automation, gamification, Redis cache, reset-defaults action, or drag/drop dependency.

### Phase 6.3C - PASS

Final Status Management integration and security audit.

Verified:

- Workspace -> TASK/PROJECT/TICKET configuration -> Status API -> Status Management UI -> RBAC -> tenant isolation -> persistence.
- Status API list/create/edit/default/deactivate/reactivate/reorder flows remain Workspace-scoped and entity-type scoped.
- Cross-Workspace, cross-Agency, header-forgery, wrong entity-type, foreign status-id, inactive default, duplicate reorder, partial reorder, missing reorder, extra reorder, and status-limit attacks are rejected.
- Status names are normalized for duplicate rejection per Workspace/entity type, while matching names across different Workspaces or entity types remain allowed.
- Unsafe colors are rejected by both frontend validation and backend DTO validation; backend accepts only strict `#RRGGBB`.
- Terminal state remains separate from semantic category, allowing multiple terminal categories such as Completed and Cancelled.
- Initialize Defaults is idempotent and does not reset customized existing statuses.
- Exactly one active default is preserved per initialized Workspace/entity type.
- Reorder persistence uses a complete ordered ID set, rolls back failed frontend optimistic updates, and preserves contiguous positions.
- Status RBAC permissions are present in the permission catalog and custom Roles can delegate status view permission without granting mutations.
- Status audit records cover create, update, color/category changes, default changes, deactivate/reactivate, reorder, and initialize defaults with actor, Agency, Workspace, entity type, and status id where relevant.
- Frontend query keys are Workspace/entity aware; ordinary mutations invalidate only the current Workspace/entity list, while Initialize Defaults invalidates the current Workspace status subtree.
- Existing Project APIs still use legacy `Project.status`; `statusDefinitionId` remains non-user-facing for future migration work.
- No Task/Ticket models or APIs were introduced.
- English/Tamil labels and Light/Dark/Colorful theme coverage remain intact.
- Phase 6.1 Users/Departments and Phase 6.2 Roles/Permissions/Permission Matrix regressions remain passing.

Phase 6.3 complete invariants:

- Shared Workspace status engine covers TASK, PROJECT, and TICKET configuration.
- Status definitions are tenant scoped and entity-type isolated.
- Exactly one active default is preserved for each initialized Workspace/entity type.
- Ordering is transactional and complete-list based.
- RBAC and permission-catalog integration remain backend authoritative.
- Frontend status cache is Workspace/entity aware.
- Status Management UI supports English/Tamil and Light/Dark/Colorful themes.

### Phase 6.3 - COMPLETE / PASS

Shared Status/Pipeline Management is complete for Phase 6.

### Phase 6 - COMPLETE / PASS

Workspace Users/Departments, Workspace custom Roles/Permissions, and shared Status Management are complete for Phase 6.

### Foundation Deep Audit 6.4A - PASS

Phase 4 multi-tenant foundation revalidation.

Verified:

- Active tenant hierarchy remains Platform/global seed data -> Agency -> Workspace -> WorkspaceMembership -> Role/Permission -> Workspace data.
- Tenant context is resolved server-side from authenticated user, active Agency membership, active Workspace membership or Agency admin authority, and route/header agreement.
- Frontend tenant selection is only UI preference; backend guards remain authoritative for Agency and Workspace access.
- Agency admins can administratively access Workspaces inside their Agency; ordinary Agency users require active Workspace membership.
- OWNER and AGENCY_OWNER wildcard authorization remains bounded by resolved tenant context.
- Departments, statuses, projects, assets, processing jobs, feature entitlements, audit logs, and storage quota accounting were rechecked for Workspace/Agency scoping.
- Legacy `Organization` references are compatibility-only in schema, audit history, permission constants, persisted frontend fallback, and stale docs; no active runtime tenant guard depends on `x-organization-id`.
- Feature entitlement hierarchy preserves platform -> agency -> workspace denial precedence and has database constraints for agency/workspace consistency.
- No tenant-owned Redis cache keys were found; Redis remains auth rate-limit, health, and queue infrastructure only.

Fixed:

- Worker processing job state transitions are now scoped by the complete job tenant tuple: `jobId`, `workspaceId`, `projectId`, and `assetId`.
- A forged or mismatched worker job envelope can no longer claim, succeed, fail, cancel, or requeue a processing job by `jobId` alone.
- Added worker regression coverage for mismatched processing-job tenant tuples.

Deferred:

- Plan/billing productization on top of feature entitlements.
- Final Organization compatibility removal and stale Organization documentation cleanup.
- Formal tenant cache namespace rules when product data caches are introduced.
- Broader offboarding/deprovisioning flows beyond existing active/suspended membership controls.

### Foundation Deep Audit 6.4B - PASS

Phase 5 frontend foundation revalidation after Phase 6 product UI.

Verified:

- Dashboard route scopes remain separated as `/developer`, `/super-admin`, `/agency`, and `/workspace`.
- Shared shell architecture remains centralized through `DashboardRouteChrome`, `ProtectedDashboardBoundary`, `DashboardShell`, `AppHeader`, `AppSidebar`, `MobileSidebar`, `PageHeader`, `PageContainer`, and `Breadcrumbs`.
- Developer and Super Admin dashboards remain structural foundations only and explicitly do not grant backend platform authorization.
- Workspace Phase 6 pages for Users, Departments, Roles/Permissions, and Status Management remain tenant-query-keyed and Workspace-scoped.
- Access token remains memory-only; persisted frontend state is limited to tenant selection, theme, language, and sidebar preference.
- Session hydration reconciles stale persisted Agency/Workspace IDs against `/auth/me`.
- API calls remain centralized through `ApiClient` with `/api/v1`, credentials, bearer token, CSRF handoff, correlation IDs, and `x-agency-id`/`x-workspace-id`.
- TanStack Query client is stable and avoids retries for deterministic 400/401/403/404/422 responses.
- UI primitives are present for Button, Input, Textarea, Select, Checkbox, Radio, Switch, Card, Badge, Avatar, Tabs, Dialog, DropdownMenu, Tooltip, Popover, Pagination, Skeleton, Progress, Separator, EmptyState, and StatusIndicator.
- Light, Dark, and Colorful themes use semantic tokens and continue to cover real Phase 6 management pages.
- Tamil localization is present for shell navigation and Phase 6 management pages, with document `lang` updated from the active locale.
- Storybook remains backend-independent for generic UI components.

Fixed:

- Agency `Roles & Permissions` navigation no longer links into the Workspace-owned `/workspace/roles` page; it is now correctly marked as deferred Agency foundation.
- White-label `logoUrl`, `faviconUrl`, and `loginBackground` values are sanitized to safe relative, HTTP, or HTTPS URLs before use.
- The intentional `BrandLogo` `<img>` usage is narrowly lint-suppressed because arbitrary tenant logo hosts should not require unsafe Next image remote allowlists.
- Playwright/Next dev-origin warning for `127.0.0.1` is fixed through a narrow `allowedDevOrigins` entry.
- Shared dashboard/error/profile/mobile-shell strings were routed through existing English/Tamil i18n.
- Added frontend regression coverage for white-label asset URL sanitization and Agency roles navigation ownership.

Dashboard page inventory summary:

- Developer: Dashboard is IMPLEMENTED; Agencies, Sub-Accounts, Modules, Feature Flags, Templates, Isolated Space, Releases, Deployments, System Health, Logs, API & Webhooks, Database, Jobs, Security, and Settings are INTENTIONALLY DEFERRED.
- Super Admin: Dashboard is IMPLEMENTED; Agencies, Sub-Accounts, Users, Plans & Billing, Feature Management, Modules, Isolated Space, Global Leaderboard, API Management, Webhooks, Audit Logs, Notifications, Developer Access, and System Settings are INTENTIONALLY DEFERRED.
- Agency: Dashboard is IMPLEMENTED; Sub-Accounts, Users, Departments, Roles & Permissions, Plans & Usage, Feature Controls, Agency Leaderboard, Reports, API & Webhooks, Integrations, Notifications, and Settings are INTENTIONALLY DEFERRED.
- Workspace: Dashboard, Users, Departments, Roles & Permissions, Status Management, Tasks, and Projects are IMPLEMENTED; Tickets, Gamification, Calendar, Automation, Docs, Forms, Goals, Reports, Custom Dashboard, Notifications, Integrations, and Settings are INTENTIONALLY DEFERRED. Legacy `/dashboard/projects` redirects to the canonical Workspace Project route.

Warnings:

- Next build still reports flat-config plugin detection warning even though `@next/eslint-plugin-next` is configured and lint passes.
- Storybook still reports upstream Rolldown/direct-`eval` and chunk-size warnings.
- `pnpm audit --audit-level high` still passes while reporting one moderate Storybook transitive advisory: `@storybook/addon-actions -> uuid@9.0.1`; patched `uuid >=11.1.1` is outside the addon's current semver range and fixing cleanly requires a future Storybook major/minor dependency review.

Deferred:

- Developer backend authorization, Super Admin backend authorization, Agency-level product pages, final white-label backend, global search, notifications backend, integrations, billing, PWA, and future product modules.
- Formal permission-aware hiding for future feature-gated navigation once feature entitlements are wired into frontend navigation.

### Foundation Deep Audit 6.4C - PASS

Final Phase 4 + Phase 5 + Phase 6 foundation integration revalidation.

Verified:

- Full chain remains coherent: authenticated User -> Agency -> Workspace -> WorkspaceMembership -> Role -> Permission -> tenant context -> frontend Workspace selection -> Workspace Users/Departments/Roles/Statuses -> backend tenant enforcement.
- Existing Phase 4 and Phase 6 integration suites continue to reject cross-Workspace, cross-Agency, forged-header, suspended-tenant, role-escalation, foreign-role, foreign-department, foreign-status, wrong-entity, project, and asset access attacks.
- Frontend session restoration, protected routing, tenant switching, theme/language persistence, sidebar navigation, and Phase 6 management pages remain integrated.
- Custom Roles remain Workspace-scoped; permission catalog data remains backend authoritative; permission and role changes propagate to backend authorization on the next request.
- Shared statuses remain Workspace- and entity-type scoped across TASK, PROJECT, and TICKET, while current Project APIs intentionally remain compatible with legacy `Project.status`.
- Legacy `Organization` usage remains compatibility-only and is not part of active tenant authorization.
- Feature entitlement foundation remains compatible with the Workspace navigation and backend tenant model without implying future product pages are implemented.

Fixed:

- Tenant React Query cache is now cleared centrally when the authenticated session is lost after hydration.
- Workspace Users clears stale user, department, selected-detail, and pagination state on Workspace switch.
- Workspace Departments clears stale department, user, editor, dialog, and form state on Workspace switch.
- Workspace Roles closes stale create/clone dialogs and clears local draft/dirty state on Workspace switch.
- Added frontend regressions for session-loss cache clearing and selected user-detail isolation across Workspace switches.

Deferred:

- Task/Ticket/Gamification/Automation/Billing/Docs/Forms/Goals/PWA/Developer backend/Super Admin backend/Isolated Space/SSO/final white-label backend work remains deferred.
- Storybook moderate transitive advisory and upstream eval/chunk warnings remain deferred to a future dependency review because high-severity audit still passes.

### Foundation v1 - STABLE

Phase 4, Phase 5, and Phase 6 foundations are validated together.

Ready for Phase 7 Task Management to build on Workspace tenancy, users, departments, custom Roles, permission catalog/guards, TASK StatusDefinitions, assets, audit logging, dashboard shell, theme/i18n, TanStack Query, centralized API client, and existing cross-tenant attack coverage.

### Phase 7.1 - COMPLETE / PASS

Task Core Backend foundation.

Implemented:

- Workspace-scoped `Task` model with `TaskPriority`, due datetime storage, created/updated user tracking, archive/delete lifecycle fields, and bounded list indexes.
- TASK `StatusDefinition` integration with active same-Workspace TASK status validation and default TASK status fallback.
- Multiple assignees and followers through WorkspaceMembership-based join tables with active same-Workspace validation.
- Multiple Project links through a TaskProject join table; linked Projects must be same-Workspace and non-archived when assigned.
- Optional same-Workspace active Department assignment.
- Workspace-scoped Task APIs for create, list, get, update, status update, assignee replacement, follower replacement, project-link replacement, and soft delete.
- Stable Task permissions: `tasks.view`, `tasks.create`, `tasks.update`, `tasks.delete`, `tasks.assign`, `tasks.manage`.
- Audit records for create, update, status change, assignee/follower/project changes, and soft delete.
- Development seed Tasks across Alpha Main, Alpha Secondary, and Beta Main.

Security invariants:

- Task APIs use JWT -> WorkspaceTenantGuard -> PermissionGuard.
- Route Workspace, `x-agency-id`, and `x-workspace-id` must match resolved tenant context.
- Task ownership and all joins are Workspace-scoped.
- Foreign assignee, follower, project, department, and status references are rejected.
- Suspended memberships cannot be assigned or followed.
- Task creation with relation payloads is transactional; invalid relation input leaves no partial Task.
- Dedicated status updates are idempotent when the requested status is already current and avoid extra status-change audit noise.
- Duplicate assignee, follower, and project replacement payloads are rejected consistently.
- `tasks.manage` is reserved and does not grant implicit Task wildcard access in Phase 7.1.
- Existing TaskProject and Task Department history is retained if a linked Project is later archived or Department later becomes inactive; new assignment to archived/inactive resources remains rejected.
- Soft-deleted Tasks are excluded from normal list/get.

Known limitations:

- No Task attachments; existing Asset remains Project-required.
- No subtasks, dependencies, comments, tags, recurrence, templates, approvals, timers, workload scoring, Kanban, Calendar, Gantt, gamification, or automation.

### Phase 7.2 - COMPLETE / PASS

Task Creation Experience foundation.

Implemented:

- `/workspace/tasks` route using `PageContainer`, `PageHeader`, and the existing Workspace dashboard shell.
- Enabled the Workspace Tasks navigation item at `/workspace/tasks` without enabling unrelated future modules.
- Simple quick-create rule: default Task creation shows only required Title, Assignee, and Due Date.
- Optional Add more details area for Phase 7.1-supported fields only: Description, Priority, Status, Additional Assignees, Followers, Department, Projects, and Due Time.
- Lightweight Live Preview for unsaved form state when advanced details are open.
- Workspace-scoped Task service and query keys for create, recent Tasks, eligible active Workspace users, active TASK statuses, active Departments, and bounded Project search.
- Temporary due-date helper: local date-only selection converts to browser-local end-of-day and then UTC ISO; optional due time combines local date and time exactly once before UTC conversion.
- Dialog dirty-state confirmation and mandatory Workspace-switch reset/close behavior so stale Workspace A relation IDs cannot submit into Workspace B.
- English and Tamil Phase 7.2 labels, theme-compatible form/select/chip/preview styling, and responsive single-column/mobile plus desktop preview layout.

Security/tenant UX:

- Backend remains authoritative for `tasks.create` and all relation ownership checks.
- Backend default TASK status remains authoritative when the create form does not send a status.
- Frontend selector data is loaded from real Workspace-scoped APIs and query keys include Workspace identity.
- Selector caches and selected chips are reset on Workspace switch and cannot submit stale tenant-bound IDs.
- Live Preview uses local unsaved state only, displays selected relation names, and avoids raw UTC/date payload strings.
- Create errors map permission, validation, stale/foreign relation, conflict, and network failures to user-facing feedback.
- Duplicate create submission is blocked while create is pending.

Known deferred Task features:

- Phase 7.3 All Tasks list/grid/table/filter/sort/bulk experience.
- Attachments, tags, comments, subtasks, dependencies, recurrence, templates, completion proof, approvals, timer, workload, Kanban, Calendar, Gantt, gamification, and automation.

### Phase 7.3A - COMPLETE / PASS

All Tasks List/Table Foundation.

Implemented:

- `/workspace/tasks` now combines Quick Create with an All Tasks browsing area.
- Server-side Task pagination with page-size controls for 10, 25, and 50 rows.
- Server-side search with debounced URL-backed `search` state.
- Server-side filters for TASK status, priority, assignee, department, project, and due date range.
- Backend allowlisted sorting for Task title, due date, created date, and updated date.
- URL-backed list state for search, filters, sorting, page, and page size, with malformed values sanitized back to safe defaults.
- Workspace-scoped Task query-key factory with `all`, `list`, and `detail` keys that include Workspace identity.
- Read-only Task detail dialog backed by `GET /workspaces/:workspaceId/tasks/:taskId`.
- Responsive desktop table plus mobile list-card rendering for the same List/Table mode.
- Create Task success invalidates current Workspace Task lists without touching unrelated Workspaces.

Security/tenant UX:

- Backend `tasks.view` authorization remains authoritative for list and detail.
- Task detail closes on Workspace switch.
- Tenant-bound URL filters for status, assignee, department, project, and created-by are cleared on Workspace switch.
- Search is preserved on Workspace switch, but Workspace-owned filters are removed and pagination resets to page 1.
- Query keys and placeholder behavior must not leak Task list or detail data across Workspaces.
- List rows render only compact summaries and do not issue detail requests until a Task is opened.
- Due-range conversion reuses centralized local-date boundary helpers.
- Terminal/completed TASK statuses do not display misleading overdue badges.

Known deferred Task features:

- No Grid, Compact view, Bulk Actions, Kanban, editing redesign, comments, attachments, tags, subtasks, dependencies, recurrence, templates, approvals, time tracking, workload, Calendar, Gantt, gamification, or automation.

### Phase 7.3B - COMPLETE / PASS

All Tasks Grid + Compact Views.

Implemented:

- All Tasks supports exactly three presentation modes: List, Grid, and Compact, with stable URL values `list`, `grid`, and `compact`.
- The existing List/Table mode remains the detailed browsing view.
- Grid renders compact responsive Task cards with title, status, priority, due state, assignee summary, department, and project summary.
- Compact renders dense Task rows with title, status, priority, assignee summary, due date/state, and compact department/project context.
- View switching is URL-backed through `view` and persists a tenant-neutral UI preference in localStorage.
- URL view wins over stored preference; invalid URL or stored view values fall back safely to List.
- List/Grid/Compact share the same server-side Task list query, search, filters, sorting, pagination, empty/error handling, and Task detail dialog.
- Focused refinement verified URL validation, stored preference validation, active-renderer-only behavior, long-content truncation, due-state consistency, and no view-only Task list refetches.

Security/tenant UX:

- View is presentation state only and is not included in Task list query keys or backend request params.
- View never fragments the server-data cache; List/Grid/Compact share one `taskKeys.list(workspaceId, normalizedParams)` architecture.
- Only the active Task view renderer mounts; inactive view DOM is not hidden with CSS.
- No Grid-specific or Compact-specific backend API was introduced.
- Task detail continues to use the existing Workspace + Task detail query and is fetched only when a visible Task is opened.
- One Task detail implementation is reused by List, Grid, and Compact.
- Workspace-neutral view preference may survive Workspace switch.
- Tenant-bound filters for status, assignee, department, project, and created-by still reset on Workspace switch.
- URL view values and stored preferences are validated; invalid URL values resolve safely to List under the current precedence policy.
- Task data, tenant IDs, access tokens, and business data are not persisted in the view preference.

Known deferred Task features:

- No Bulk Actions, Kanban, inline editing, comments, attachments, tags, subtasks, dependencies, recurrence, templates, approvals, time tracking, workload, Calendar, Gantt, gamification, or automation.

### Phase 7.3C1 - COMPLETE / PASS

Task Bulk Action Backend Engine.

Implemented:

- Workspace-scoped bulk Task status API: `PATCH /api/v1/workspaces/:workspaceId/tasks/bulk/status`.
- Workspace-scoped bulk Task priority API: `PATCH /api/v1/workspaces/:workspaceId/tasks/bulk/priority`.
- Workspace-scoped bulk Task assignee add API: `POST /api/v1/workspaces/:workspaceId/tasks/bulk/assignees/add`.
- Workspace-scoped bulk Task assignee remove API: `POST /api/v1/workspaces/:workspaceId/tasks/bulk/assignees/remove`.
- Workspace-scoped bulk Task soft-delete API: `DELETE /api/v1/workspaces/:workspaceId/tasks/bulk`.
- Bulk APIs accept explicit, bounded `taskIds[]` only, with minimum 1, maximum 100, UUID validation, and duplicate rejection.
- Bulk assignee APIs accept explicit, bounded `membershipIds[]` only, with minimum 1, maximum 100, UUID validation, and duplicate rejection.
- Bulk status and priority updates are idempotent and avoid redundant Task updates or audit rows when every requested Task is already unchanged.
- Bulk assignee add skips already-assigned relations; bulk assignee remove skips missing relations.
- Bulk delete uses Task soft deletion through `deletedAt`; relation rows are not hard-deleted.

Security and transaction invariants:

- Bulk routes use existing JWT, Workspace tenant, and permission guards.
- Bulk status and priority require `tasks.update`.
- Bulk assignee add/remove require `tasks.assign`.
- Bulk delete requires `tasks.delete`.
- `tasks.view`, `tasks.update`, `tasks.assign`, `tasks.delete`, and reserved `tasks.manage` remain separated; `tasks.manage` is not a wildcard.
- Combined permission roles remain independent: update+assign does not imply delete, and assign+delete does not imply update.
- All bulk operations are all-or-nothing for unknown, foreign, cross-Workspace, cross-Agency, or already-deleted Tasks.
- Bulk status accepts only active same-Workspace `TASK` statuses and rejects `PROJECT`, `TICKET`, inactive, unknown, or foreign statuses.
- Bulk assignee add/remove accept only active memberships in the same Workspace and reject unknown, suspended, foreign, or duplicate membership input.
- Current Task assignee invariant is preserved: assignee replacement already permits zero assignees, so bulk remove also permits zero assignees.
- Tenant isolation remains enforced by route/header matching plus Workspace-scoped service filters.
- Bulk mutations use bounded, set-based validation and mutation patterns instead of an N PATCH loop.
- Critical mutation queries include Workspace/deleted-state predicates and success audit is written only after mutation counts are verified.

Audit:

- Bulk audit actions: `task.bulk_status_changed`, `task.bulk_priority_changed`, `task.bulk_assignees_added`, `task.bulk_assignees_removed`, and `task.bulk_deleted`.
- Audit metadata records requested count, changed count, unchanged count, relation counts where relevant, bounded changed Task IDs, and target status/priority/memberships where relevant.
- Failed validation or failed all-or-nothing transactions do not emit misleading success audit rows.

Known deferred Task features:

- No frontend bulk selection, toolbar, dialogs, Kanban, inline editing, comments, attachments, tags, subtasks, dependencies, recurrence, templates, approvals, time tracking, workload, Calendar, Gantt, gamification, or automation.

### Phase 7.3C2 - COMPLETE / PASS

Task Bulk Selection UX.

Implemented:

- Current-page-only selection on `/workspace/tasks`, capped by the existing frontend page-size maximum of 50.
- One shared in-memory selection state across List, Grid, and Compact views; switching views preserves selection and does not refetch.
- Selection is intentionally not stored in URL, localStorage, or global stores.
- Selection clears on search/filter/sort/page/page-size dataset changes, Workspace switch, and session loss.
- Bulk toolbar with status, priority, add assignees, remove assignees, delete, and clear-selection actions.
- Bulk dialogs call the Phase 7.3C1 backend endpoints with one request per action; no per-task frontend mutation loop.
- Successful bulk actions clear selection and invalidate current Workspace task queries; failed bulk actions preserve selection.
- Bulk delete closes selected task detail when the deleted task was open.
- Responsive desktop inline toolbar and mobile action menu, with accessible checkbox labels and dialog controls.
- English and Tamil labels for bulk selection/actions/messages.
- Focused React/Vitest coverage for shared selection, current-page select-all, bulk status/priority/assignee/delete flows, failure preservation, reset behavior, i18n, and themes.
- Playwright coverage for current-page bulk priority and bulk delete using the workspace-scoped C1 bulk endpoints.

Security and UX invariants:

- Backend tenant authorization, permission checks, all-or-nothing validation, and audit/event behavior remain authoritative from Phase 7.3C1.
- The UI sends explicit selected Task IDs only, never filter-based "all matching" bulk payloads.
- Current-page select-all never selects tasks outside the rendered page.
- Bulk assignee selection uses Workspace-scoped membership lookup and lets the backend reject stale/foreign membership IDs.
- Bulk status selection uses active Workspace TASK statuses and lets the backend reject stale/foreign status IDs.

Known deferred Task features:

- No select-all-across-all-pages behavior.
- No Kanban, inline editing, comments, attachments, tags, subtasks, dependencies, recurrence, templates, approvals, time tracking, workload, Calendar, Gantt, gamification, or automation.

### Phase 7.3C3 - PASS

Final Bulk + All Tasks security / performance / integration audit.

Verified:

- Workspace-scoped All Tasks remains server-side paginated, searched, filtered, and sorted.
- List, Grid, and Compact share one Workspace-scoped Task list query and one read-only Task detail flow.
- Current-page-only bulk selection is in memory only; view switching preserves selection, while dataset, tenant, and session changes clear selection.
- Bulk status, priority, assignee add/remove, and delete use one backend request per operation.
- Bulk backend operations are bounded, transactional, tenant scoped, permission scoped, and audit only successful mutations.
- Same-Agency cross-Workspace, cross-Agency, unknown Task, soft-deleted Task, forged-header, invalid status, invalid priority, stale membership, and unauthorized bulk attempts are rejected without partial mutation.
- Bulk assignee add remains idempotent under concurrent duplicate requests and reports counts from actual database inserts.
- Bulk soft delete sets `deletedAt`, preserves TaskAssignee, TaskFollower, TaskProject, and audit history, and normal lists continue to exclude deleted Tasks.
- Query keys include Workspace identity for list/detail/selector data; successful bulk mutations invalidate only current Workspace task queries.
- Relation rendering uses list summaries and does not issue per-row detail requests.
- No local business persistence was added; only the tenant-neutral view preference remains intentional presentation persistence.
- Quick Create remains unchanged: Title, Assignee, and Due Date are the initial fields.

Phase 7.3 complete invariants:

- Workspace-scoped paginated All Tasks.
- Server-side search/filter/sort.
- List/Grid/Compact share one query.
- Read-only Task detail.
- Current-page-only bulk selection.
- View switching preserves selection.
- Dataset/tenant changes clear selection.
- Transactional bulk status/priority/assignee/delete.
- One bulk request per operation.
- Independent Task permissions.
- Tenant-correct audit.
- Bounded query/database behavior.
- No cross-Workspace cache/selection leakage.

Known deferred Task features:

- Phase 7.4 Task Relationships are complete/pass.
- No recurrence, templates, approvals, completion proof, time tracking, workload, Kanban, Calendar, Gantt, gamification, or automation.

### Phase 7.3C - COMPLETE / PASS

Task Bulk Backend Engine, Bulk Selection UX, and final Bulk + All Tasks audit are complete for Phase 7.3.

### Phase 7.3 - ALL TASKS - COMPLETE / PASS

All Tasks foundation is complete for Phase 7, including Quick Create integration, List/Grid/Compact, search, filters, sort, pagination, URL state, read-only detail, bulk selection, bulk backend operations, tenant/security checks, audit, and performance boundaries.

### Phase 7.4A1 - Nested Task Hierarchy Backend - COMPLETE / PASS

Implemented:

- Optional same-Workspace `parentTaskId` on Task with restrictive self relation and no cascade delete.
- Unlimited logical nesting through direct parent links; normal Task creation remains root creation by default.
- Dedicated backend APIs for creating direct subtasks, listing direct subtasks with pagination, and reparenting/detaching Tasks.
- Task detail hierarchy summary with parent summary and direct subtask count.
- Cycle prevention for self-parenting and deep descendant reparent attempts.
- Same-Workspace parent enforcement; foreign Workspace, cross-Agency, unknown, and soft-deleted parents are rejected.
- Terminal parent invariant: parent Tasks cannot move terminal while active descendants remain non-terminal.
- Terminal ancestor reopen invariant: active descendants cannot move non-terminal while an active terminal ancestor remains terminal.
- Bulk status prospective validation so parent/child terminal or reopen transitions can succeed atomically when the committed state is valid.
- Parent soft-delete behavior detaches surviving direct children to root without deleting descendants.
- Bulk delete detaches surviving direct children of any deleted parent in the same transaction.
- Task creation audit includes `parentTaskId` for subtask creation, while parent changes, detach, and deletion side-effect counts remain traceable.

Security/performance invariants:

- Hierarchy APIs use existing `tasks.view`, `tasks.create`, `tasks.update`, and `tasks.delete` permissions.
- Database-level same-Workspace parent FK and self-parent check protect Task hierarchy if service validation is bypassed.
- Recursive validation is Workspace scoped, cycle guarded with path tracking, and uses PostgreSQL recursive CTEs instead of one query per depth level.
- Deep, self, and representative concurrent reparent cycle attempts are rejected or conflict safely; final committed hierarchy remains acyclic.
- Logical nesting remains unlimited; no product depth cap is enforced.
- Direct subtask reads return active direct children only, are paginated, and do not recursively hydrate descendants.
- Normal All Tasks list/search/filter/sort behavior remains unchanged and does not recursively hydrate trees.
- Task detail exposes only an immediate active parent summary and active direct subtask count.
- Terminal parent checks inspect the full active moved subtree before attach/reparent.
- Terminal completion checks inspect all active descendants, and terminal ancestors block descendant reopen.
- Bulk status validates the prospective hierarchy state atomically for deep terminal/reopen transitions.
- Task deletion and bulk deletion detach surviving direct children to root; descendants never cascade-delete.
- Hierarchy writes remain tenant/RBAC/audit safe, including forged-header rejection and retryable conflict handling.
- Quick Create remains unchanged and does not expose a Parent field.

Known deferred Task features:

- No Task Relationships frontend yet.
- No comments, mentions, tags, attachments, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, gamification, or automation.

### Phase 7.4A2 - Dependencies + Related Tasks Backend - COMPLETE / PASS

Implemented:

- Directed `TaskDependency` graph stored as one Workspace-scoped blocker -> blocked edge.
- Symmetric `TaskRelatedTask` graph stored as one canonical Workspace-scoped pair.
- Dedicated backend APIs for paginated `blocked-by`, `blocks`, and `related` reads.
- Explicit add/remove APIs for blocked-by dependencies and related links with bounded 1-100 task IDs.
- Same-Workspace composite DB relations for dependency and related endpoints.
- DB-level no-self constraints for dependencies and related links, plus canonical ordering check for related pairs.
- Dependency cycle prevention with Workspace-scoped recursive CTE traversal over the active graph.
- Concurrent dependency cycle races remain acyclic through transactional validation.
- Concurrent graph writes preserve dependency validity; terminal/status writes and dependency adds cannot commit an invalid terminal blocked Task.
- Related pair races create exactly one canonical row without duplicate relation exposure.
- Task detail exposes active `blockedByCount`, `blocksCount`, and `relatedTaskCount` without adding graph arrays.
- Terminal Task transitions are blocked by active direct non-terminal blockers.
- Terminal Tasks cannot accept new active non-terminal blockers.
- Bulk status validates prospective dependency state together with hierarchy rules.
- No reverse reopen rule: reopening a blocker does not automatically reopen or reject terminal dependents.
- Soft-deleted dependency/related rows are preserved for history and ignored by active graph/read rules.
- Dependency and related mutation audit records include bounded task IDs and changed counts.

Security/performance invariants:

- Relationship APIs reuse `tasks.view` for reads and `tasks.update` for add/remove mutations.
- New relationships reject self, unknown, deleted, foreign Workspace, and cross-Agency Tasks.
- Route/header tenant forgery is rejected before mutation.
- Failed cycle, tenant, deleted-target, and invalid relation requests do not create success audit records.
- All graph traversals are Workspace scoped and parameterized; no one-query-per-depth traversal is used.
- Normal All Tasks list/search/filter/sort behavior remains unchanged and does not load dependency or related graphs.
- Task delete and bulk delete preserve dependency/related rows for future restore compatibility.

Known deferred Task features:

- No Task Relationships frontend yet.
- No dependency UI, related-task UI, comments, mentions, tags, attachments, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, gamification, or automation.

### Phase 7.4A3 - Relationship Backend Final Audit - PASS

Audit result:

- Hierarchy, dependency, and related graphs remain distinct backend concepts.
- Same-Workspace composite protection exists for parent links, dependency endpoints, and related endpoints.
- Hierarchy and dependency cycles are prevented, including representative concurrent writes.
- Related links remain canonical, symmetric, and informational only.
- Status transitions enforce hierarchy descendants plus direct active blockers.
- Prospective bulk status enforces both hierarchy and dependency graph state atomically.
- No reverse dependency reopen rule exists; blockers may reopen unless hierarchy independently forbids it.
- Soft-delete preserves graph history while normal reads ignore deleted graph endpoints.
- Surviving hierarchy children detach correctly on single and bulk soft delete.
- Graph APIs are paginated, bounded, tenant/RBAC guarded, and audit-safe.
- Normal All Tasks list/grid/compact hot paths do not hydrate hierarchy trees, dependency graphs, or related graphs.
- Safe business errors are returned for cycles, terminal-state violations, foreign/unknown Tasks, and serialization conflicts.

### Phase 7.4A - RELATIONSHIP BACKEND - COMPLETE / PASS

Backend relationship foundation is ready for Phase 7.4B Task Relationships UX.

Available backend contracts:

- Direct subtasks API.
- Parent/reparent API.
- Blocked-by API.
- Blocks API.
- Related Tasks API.
- Paginated direct relationship reads.
- Workspace-isolated relationship writes.
- Hierarchy/dependency status enforcement.
- Relationship audit events and changed-only no-op behavior.

Known deferred Task features:

- No Task Relationships frontend yet.
- No comments, mentions, tags, attachments, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, gamification, or automation.

### Phase 7.4B1 - Task Detail Relationship Shell + Subtask Tree UX - COMPLETE / PASS

Task relationship UX foundation is in place on the existing All Tasks detail dialog.

Implemented:

- One Task detail shell is reused for parent, child, and parent-summary navigation.
- Overview is the default tab whenever a Task detail opens or switches to a different Task.
- Task detail tabs for Overview, Subtasks, Dependencies, and Related.
- Overview preserves existing Task detail fields and adds parent summary plus direct subtask count.
- Subtasks tab lazy-loads direct children only; nested expansion fetches only the requested node.
- Direct child lists are paginated and keyed by Workspace, parent Task, and pagination params.
- Quick Create-style subtask form starts with title, assignee, and due date; backend remains default-status authority.
- Move / Change Parent is explicit, supports detach to root, prevents detectable no-op moves, and does not add drag/drop reparenting.
- Hierarchy mutations use targeted invalidation for moved/parent/new-parent direct child queries and details.
- Workspace switch and session loss clear selected detail, drafts, move state, expansion state, and usable relationship IDs.
- Dependency and Related tabs are placeholders only; their management UI remains deferred.
- B1 does not fetch dependency or related relationship data.
- English and Tamil copy added for relationship shell, subtask tree, move, and hierarchy error states.
- Playwright timeout increase from the initial B1 pass was removed; E2E now runs without full parallelism because failures were caused by existing parallel contention against one Next dev server, not legitimate per-test workload.

Known deferred Task features:

- Dependencies UI and Related Tasks UI remain deferred.
- Comments, mentions, tags, attachments, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, gamification, and automation remain deferred.

### Phase 7.4B2 - Dependencies + Related Tasks UX - COMPLETE / PASS

Task dependency and related-task UX is implemented inside the existing Task detail tabs.

Implemented:

- Dependencies tab replaces the placeholder with real Blocked By and Blocks sections.
- Blocked By and Blocks remain directional: A blocks B; B shows A under Blocked By, and A shows B under Blocks.
- Related tab replaces the placeholder with symmetric Related Tasks management and no directional language.
- Relationship tab data lazy-loads only when the relevant tab opens: Overview/Subtasks do not fetch dependency or related data.
- Blocked By, Blocks, and Related lists stay backend paginated with independent page state.
- Add Blocker and Add Related Task use bounded server-side Task search/selectors with current Task exclusion where easy.
- Remove Blocker and Remove Related Task call explicit relationship removal endpoints and never delete Tasks.
- Backend remains authoritative for dependency cycles, terminal blocker rules, tenant isolation, deleted/stale Tasks, idempotency, and concurrency.
- Relationship mutation success feedback uses actual changed/unchanged counts.
- Query keys include Workspace, Task, and pagination/search identity.
- Successful mutations use targeted invalidation for current/counterpart relationship lists and task detail counts instead of invalidating all Workspace Tasks.
- Workspace switch and task switch reset relationship dialogs, candidate search, and selected candidate state.
- English/Tamil labels cover dependency, related, search, empty, loading, success, no-op, and safe error states.
- Relationship rows and dialogs are responsive and theme-token based for Light, Dark, and Colorful themes.

Focused refinement verified:

- Dependency direction is end-to-end stable: `Blocked By` means another Task blocks the current Task, while `Blocks` means the current Task blocks another Task.
- Dependencies and Related tabs lazy-load independently, keep independent pagination, and do not fetch relationship data from Overview or Subtasks.
- Related relationships remain symmetric and use neutral copy, neutral success/no-op messaging, and explicit remove actions.
- Relationship search remains bounded and server-side; selected chips preserve Task titles across search changes.
- Relationship selection is capped at 100 Tasks and cannot exceed backend bulk limits.
- Backend relationship APIs remain graph authority for cycles, terminal restrictions, tenant ownership, stale candidates, idempotency, and concurrency.
- Mutations use submit/remove locks to avoid duplicate rapid requests and clear stale dialog state on Workspace, Task, or session changes.
- Successful mutations use targeted invalidation for current lists, counterpart relationship lists, and detail counts without per-row fan-out or global Workspace Task invalidation.
- Safe permission/business errors are mapped for stale Tasks, cycle rejection, terminal blocker restrictions, and retryable conflicts.
- English and Tamil labels preserve dependency direction semantics.
- No Playwright global timeout or fixed-wait workaround was added for this refinement.

Known deferred Task features:

- Comments, mentions, tags, attachments, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, gamification, automation, visual dependency graph, and drag/drop relationship editing remain deferred.

### Phase 7.4B3 - Final Task Relationships UX Audit - COMPLETE / PASS

Final audit verified the B1/B2 Task detail relationship experience as production-safe.

Verified invariants:

- One Task detail shell serves Overview, Subtasks, Dependencies, and Related.
- Overview remains the default on Task/Workspace switch and does not eager-load relationship data.
- Subtasks load direct children on demand; nested expansion loads only that node's children.
- Subtask tree pagination, repeated-ID defense, explicit Create Subtask, reparent, and detach-to-root remain bounded and targeted.
- Dependencies and Related tabs lazy-load independently; relationship lists remain backend-paginated.
- Blocked By / Blocks direction is proven across labels, service calls, payloads, remove actions, success feedback, and Tamil copy.
- Related Tasks remain symmetric and avoid dependency/status semantics.
- Add/remove blocker and add/remove related mutations use one backend request per mutation with duplicate-submit protection.
- Backend remains hierarchy and graph authority for cycles, terminal-state rules, stale candidates, tenant ownership, idempotency, concurrency, and RBAC.
- All relationship queries include Workspace, Task, pagination, and search identity as applicable.
- Relationship mutations use targeted cache invalidation for affected details, lists, parents, and counterparts.
- Task, Workspace, and session changes clear temporary relationship state, dialogs, searches, selected candidates, drafts, and expansion state.
- Normal All Tasks list/grid/compact hot paths do not hydrate subtask trees, dependency graphs, related graphs, or per-row relationship counts.
- Mobile, accessibility, English/Tamil i18n, Light/Dark/Colorful themes, and Playwright relationship flows were verified.

### Phase 7.4B - TASK RELATIONSHIPS UX - COMPLETE / PASS

Task Relationships UX is complete across Overview, Subtasks, nested lazy tree, Create Subtask, Move/Detach, Dependencies, Blocked By, Blocks, Related, relationship search, mutations, pagination, tenant safety, responsive/accessibility, i18n, themes, and performance.

Known deferred Task features:

- Phase 7.4C1 Refinement remains next.
- Attachments, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, gamification, automation, visual dependency graph, and drag/drop relationship editing remain deferred.

### Phase 7.4C1 - Comments + Mentions + Reactions Backend - COMPLETE / PASS

Implemented:

- Workspace-scoped `TaskComment`, `TaskCommentMention`, and `TaskCommentReaction` models with tenant-preserving composite relations.
- Root comments and direct reply endpoints with unlimited logical nesting through `parentCommentId`.
- Paginated root comment and direct-reply reads; no recursive eager hydration.
- `NORMAL` and `INTERNAL` comment visibility, with internal comments hidden from callers without `tasks.comments.internal`.
- Soft-delete tombstones for comments; replies remain preserved and readable according to visibility.
- Mention metadata for active same-Workspace memberships only; duplicate mention payloads are normalized, and no notification side effects are emitted.
- Controlled reaction types: `LIKE`, `LOVE`, `CELEBRATE`, `EYES`, and `CHECK`.
- One reaction per membership per reaction type per comment, with idempotent add/remove behavior.
- Comment audit events for create, reply, update, delete, reaction add, and reaction remove.
- Explicit comment permissions: `tasks.comments.view`, `tasks.comments.create`, `tasks.comments.update_own`, `tasks.comments.delete_own`, `tasks.comments.moderate`, and `tasks.comments.internal`.

Security/performance invariants:

- All comment APIs require normal Task visibility plus comment-specific permission checks.
- Internal comments are excluded before totals, reply counts, and parent discovery for non-internal callers.
- Author edit/delete requires own permissions; moderators can edit/delete any visible comment in the Workspace.
- Deleted comments cannot receive new replies or reactions.
- Mentions reject suspended, foreign Workspace, and cross-Agency memberships.
- Same-Workspace database FKs protect comment, mention, reaction, task, membership, and parent-comment ownership.
- Direct reply counts and reaction counts are scoped to the current page and current caller visibility.
- Normal All Tasks list/grid/compact paths remain unchanged and do not hydrate comments.

Known deferred Task features:

- No comments frontend yet.
- No tags, attachments, notifications, automation hooks, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, or gamification.

### Phase 7.4C2 - Workspace Tags Backend - COMPLETE / PASS

Implemented:

- Workspace-scoped reusable `WorkspaceTag` catalog.
- `TaskTag` many-to-many join between Workspace Tags and Tasks.
- Normalized case-insensitive Tag uniqueness per Workspace.
- Optional safe `#RRGGBB` Tag color.
- `ACTIVE` / `ARCHIVED` Tag lifecycle with archive/reactivate APIs.
- Archived Tags preserve existing Task relationships and remain visible on Task Tag reads.
- Archived Tags cannot be newly assigned to Tasks.
- Explicit Task Tag add/remove APIs with idempotent changed/unchanged counts.
- Same-Workspace composite DB safety for TaskTag -> Task and TaskTag -> WorkspaceTag.
- Server-side paginated/searchable Tag catalog.
- Single `tagId` Task list filter foundation.
- Explicit Tag RBAC: `tags.view`, `tags.create`, `tags.update`, `tags.archive`, `tags.assign`.
- Audit events for Tag create/update/archive/reactivate and Task Tag add/remove.

Security/performance invariants:

- Tag catalog operations are Workspace scoped through existing tenant guards.
- Workspace Tags use case-insensitive normalized uniqueness while preserving trimmed display casing.
- Same display names are allowed across different Workspaces.
- Tag colors are optional and restricted to deterministic safe `#RRGGBB` HEX storage.
- ACTIVE/ARCHIVED lifecycle is idempotent and serializable for archive/reactivate.
- Task Tag reads require `tasks.view`; Task Tag add/remove require `tasks.update` plus `tags.assign`.
- Foreign Workspace and cross-Agency Tag assignment/removal are rejected without partial mutation.
- Archived Tags preserve TaskTag history, remain readable/filterable, and cannot be newly assigned.
- Archive-vs-assign overlap is protected by serializable set-based active-status assignment.
- Task Tag add/remove is explicit, idempotent, all-or-nothing for invalid Tag sets, and bounded to 50 IDs.
- Task list `tagId` filtering uses the indexed `TaskTag` join and does not filter in memory.
- Task Tag reads use one bounded relation query and include archived historical Tags.
- Normal All Tasks hot paths do not hydrate Tag objects unless the explicit Task Tag read route is used.
- Tag create/update/archive/reactivate and Task Tag add/remove success audit is bounded and suppressed for no-ops/failures.
- No Tags frontend, comment frontend, attachments, notifications, or automation were added.

Focused refinement verified:

- Same-Workspace composite database fences reject cross-Workspace `TaskTag` links even if services are bypassed.
- Concurrent duplicate create, rename conflict, two-way rename collision, archive/reactivate, archive-vs-assign, and duplicate TaskTag add paths return safe final state or retryable conflict.
- Tag catalog remains server-side paginated/searchable with allowlisted sorting.
- Active and archived Task Tag relationships remain server-side filterable through `tagId`.
- Tag permissions remain independent: `tags.view`, `tags.create`, `tags.update`, `tags.archive`, and `tags.assign` do not imply one another.

Known deferred Task features:

- No Tags frontend yet.
- No comment frontend, attachments, notifications, automation, recurrence, templates, completion proof, approvals, time tracking, workload, Kanban, Calendar, Gantt, or gamification.

### Phase 7.4C3A - Comments + Mentions + Reactions UX - COMPLETE / PASS

Implemented:

- Comments tab added to the existing Task Detail shell after Overview, Subtasks, Dependencies, and Related.
- Root comments lazy-load only when the Comments tab opens.
- Direct replies lazy-load per expanded comment with independent pagination and unlimited logical thread depth.
- Comment composer defaults to NORMAL visibility, with INTERNAL comment UX for clearly privileged Workspace sessions and backend authority preserved.
- Active Workspace member @mention picker uses server-side bounded search; selected membership IDs are authoritative and manual @text alone does not create mention metadata.
- Author edit/delete UX, soft-delete tombstones, and reply preservation are supported.
- Controlled reactions support LIKE, LOVE, CELEBRATE, EYES, and CHECK with independent toggles/counts.
- Workspace/task/session changes clear comment drafts, reply/edit state, mention search, expanded replies, and pending reaction state through scoped component state and tenant query keys.
- English/Tamil labels, Light/Dark/Colorful theme compatibility, responsive wrapping, and accessibility labels were added.

Security/performance invariants:

- All comment/reply query keys include Workspace and Task identity.
- Opening Overview/Subtasks/Dependencies/Related does not fetch comments.
- Root comment rendering does not fan out author, mention, reaction, or reply network requests per row.
- Comment bodies are rendered as text, not HTML.
- No attachments, notifications, or Tags frontend were added.

Focused refinement verified:

- Comments fetch only on Comments tab activation, with one root request for the active Task page.
- Root comments and direct replies remain independently paginated and lazy-loaded.
- The frontend imposes no logical thread-depth cap; visual indentation is capped for layout only.
- Fresh root and reply composers default to NORMAL and reset to NORMAL after successful create.
- Backend responses control INTERNAL visibility; the frontend does not fetch INTERNAL rows then hide them.
- INTERNAL composer affordance is based on returned role permissions, not hardcoded role names.
- Selected Workspace membership IDs are the only mention authority; plain @text creates no mention metadata.
- Visibility is immutable during edit, and edit sends body only.
- Tombstones preserve existing replies and do not show reply/edit/reaction controls.
- Controlled reaction UX supports LIKE, LOVE, CELEBRATE, EYES, and CHECK as independent toggles.
- Comment/reply/reaction mutations invalidate only the current Task comment/reply scope.
- Rendering comments uses summary payloads and does not create per-comment author, mention, reaction, or reply fan-out.
- Task, Workspace, and session changes clear drafts, reply state, edit state, mention state, expanded replies, and pending reaction state.
- No Tags UI, attachments, notifications, automation, or gamification were added.

### Phase 7.4C3B - Task Tags UX - COMPLETE / PASS

Implemented:

- Task Tags render inside Task Detail Overview using the existing Phase 7.4C2 backend APIs.
- Attached tag chips show name, validated color dot, archived historical state, and remove controls when `tasks.update` + `tags.assign` are present.
- Add Tags dialog uses active-only catalog search, selected chips, duplicate prevention, a 50-tag cap, and one bulk add request.
- Manage Tags dialog supports paginated/searchable catalog browsing, status filter, create, edit name/color, archive, and reactivate without hard delete.
- All Tasks gained a server-backed `tagId` URL filter with active filter chip labeling and Workspace switch cleanup.
- React Query keys are Workspace/Task scoped; tag catalog loading stays lazy so normal All Tasks hot paths do not fetch Tags unless the tag filter is used.
- English/Tamil labels, theme-compatible styling, responsive wrapping, and accessible row-action names were added.

Security/performance invariants:

- Tag assignment/removal uses explicit RBAC-derived affordances and backend authority remains final.
- Archived tags remain visible when historically attached and removable from a Task, but Add Tags only queries ACTIVE tags.
- Workspace/session/task changes close tag dialogs and clear tag-local state.
- Tag mutations invalidate only scoped task-tag/catalog queries.
- No attachments, notifications, automation/gamification, or new Task tabs were added.

Verified:

- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm prisma:validate`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- Focused refinement verified active/archived Task Tag display, active-only assignment, explicit idempotent add/remove feedback, inline Manage Tags lifecycle UX, no hard-delete UI, server-side paginated/searchable catalog, server-side `tagId` All Tasks filtering, archived historical filtering, Workspace/task/session cleanup, targeted invalidation, no Task-row Tag hydration, unambiguous Tag search accessibility names, English/Tamil copy, themes, and mobile E2E coverage.
- `pnpm test:e2e` passes 16/16.

### Phase 7.4C3 - Final Comments / Mentions / Reactions / Tags Integration Audit - PASS

Verified:

- Task Detail has one implementation with Overview, Subtasks, Dependencies, Related, and Comments tabs; Tags remain inside Overview.
- Comments lazy-load only on the Comments tab; Overview/Subtasks/Dependencies/Related do not fetch comments.
- Task Tags load only on Overview/Tag UI surfaces; Add Tags, Manage Tags, and All Tasks tag catalog queries stay lazy and scoped.
- Comments and Tags remain Task/Workspace scoped through backend tenant guards, composite database fences, and Workspace/Task-aware frontend query keys.
- INTERNAL comments remain server-filtered before items, totals, reply counts, mention data, and reaction data; the frontend does not rely on client-side hiding.
- Selected Workspace membership IDs are the only mention authority; plain `@text` does not create mention metadata.
- Comment threads return roots only and direct replies only; unlimited logical nesting is preserved while visual indentation is capped.
- Comments soft-delete to tombstones with body hidden, existing replies preserved, and no new reply/reaction/edit controls on tombstones.
- Controlled reactions remain enum-bound and idempotent; same-reaction duplicates do not create duplicate rows, while different reaction types by the same user remain allowed.
- Workspace Tags use ACTIVE/ARCHIVED lifecycle; archived Tags preserve TaskTag history, remain visible/removable/filterable, and cannot be newly assigned.
- All Tasks `tagId` filtering remains server-side, tenant-safe, and composed with existing search/filter/sort/pagination parameters.
- Normal All Tasks hot paths do not fetch comments, replies, Task Tags per row, Tag objects per row, or per-row comment/tag counts.
- Comment/tag permission systems remain independent and backend authoritative, including `tasks.comments.*`, `tasks.update`, and `tags.*`.
- Comment/tag audit records only committed meaningful changes; no success audit is emitted for no-ops, permission failures, hidden resources, foreign resources, or rollback/conflict paths.
- English/Tamil labels, Light/Dark/Colorful themes, mobile widths, and accessibility states remain verified for combined Comments and Tags UX.
- No Attachments, Notifications, Automation/Gamification, recurrence, templates, proof/approval, time tracking, Kanban, Calendar, or Gantt work was introduced.

Regression verification:

- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm prisma:validate`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 16/16.

### Phase 7.4C - COMMENTS / MENTIONS / REACTIONS / TAGS - COMPLETE / PASS

Phase 7.4C is complete across backend, UX, focused refinements, and final integration/security/performance audit.

### Phase 7.4D - Task Attachment Architecture - COMPLETE / PASS

Implemented:

- First-class `Attachment` model with explicit `TaskAttachment` and `ProjectAttachment` link tables.
- `Asset.projectId` is optional so stored files are Workspace-owned physical records, while Project compatibility is preserved through `ProjectAttachment`.
- Existing Project Assets are migrated into `Attachment` + `ProjectAttachment` rows without moving MinIO objects.
- New Task file uploads use generic Workspace storage keys under `workspace/{workspaceId}/assets/...`.
- Task URL attachments are stored as `AttachmentType.URL` rows without MinIO objects.
- Removing a Task or Project attachment is a soft unlink; physical MinIO objects and quota remain tied to the Asset.
- Task attachment APIs support list, presigned file upload init/finalize, URL attach, reusable attachment linking, download authorization, and remove.
- Explicit permissions were added: `tasks.attachments.view`, `tasks.attachments.add`, `tasks.attachments.remove`, and `tasks.attachments.download`.
- Worker asset processing no longer requires `projectId`; project-backed jobs keep tuple safety, while Workspace-owned Task assets process by `(workspaceId, assetId)`.
- Task Detail Overview now includes an Attachments section with Upload File and Add Link flows, English/Tamil labels, scoped query keys, and no All Tasks row attachment hydration.

Security/performance invariants:

- Attachments are Workspace scoped and linked through composite Workspace-aware relations.
- Task attachment routes use the existing JWT -> WorkspaceTenantGuard -> PermissionGuard chain plus Task ownership assertions.
- Foreign Workspace Attachment, Task, Asset, or Project IDs resolve as not found and do not leak tenant details.
- File upload hard limit is 25 MB for Task attachments; backend validates size and MIME type, frontend pre-checks size.
- Frontend shows a non-blocking Drive/OneDrive suggestion for files over 2 MB.
- URL attachments accept only HTTP/HTTPS URLs.
- Quota is charged per physical `Asset`, not per Task/Project link; unlinking does not decrement quota.
- Pending file uploads are not linked to a Task until upload finalization succeeds.
- Task attachment list queries include Attachment and Asset data in one query shape, avoiding per-row attachment N+1.
- Normal All Tasks list/grid/compact views do not hydrate attachment data per row.
- Presigned upload/download URLs and MinIO object keys remain server-only.
- Comment, tag, dependency, and relationship systems were not extended with attachments in this phase.

Verified:

- `pnpm prisma:generate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm prisma:validate`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- Focused worker test verifies Workspace-owned assets process without a Project tuple.
- Focused E2E verifies deterministic Task URL attachment addition inside Task Detail.
- `pnpm test:e2e` passes 16/16.

### Phase 7.4E - Final Task Relationships Audit - COMPLETE / PASS

Verified:

- Task Detail remains one implementation with Overview, Subtasks, Dependencies, Related, and Comments tabs.
- Overview contains core Task details plus Tags and Attachments; no Tags or Attachments tab was added.
- Task hierarchy is Workspace-safe and cycle-free.
- Terminal parent/descendant rules are enforced backend-side for single and bulk status changes.
- Dependency graph is directed and cycle-safe, with blocked completion rules enforced backend-side.
- Related Tasks remain symmetric and canonical without dependency semantics.
- Comments are Task scoped, root/reply queries are lazy and direct-child bounded, and tombstones preserve reply history.
- INTERNAL visibility remains backend-filtered before items, totals, reply counts, mentions, and reactions.
- Mentions use selected same-Workspace active memberships only.
- Reactions remain controlled and idempotent.
- Tags use the ACTIVE/ARCHIVED lifecycle; archived Tags remain historically visible/filterable/removable but not newly assignable.
- All Tasks `tagId` filtering remains server-side and composes with existing filters.
- Asset is Workspace-owned physical storage; Attachment supports FILE/URL and Task/Project links are explicit.
- Attachment reuse does not double-charge quota, and unlink does not physically delete storage.
- Phase 7.4 server state is tenant-safe through Workspace/Task/comment-aware query keys and scoped invalidation.
- Task Detail remains surface-lazy; Overview loads only core detail, Tags, and Attachments.
- All Tasks hot path remains lean with no eager hierarchy, dependency, related, comment, tag, attachment, or presigned URL hydration.
- Permission checks remain permission-key/custom-role compatible, with no backend role-name authorization.
- Audit only records committed meaningful changes and does not log presigned URLs, MinIO credentials, large comment bodies, or unsafe URL payload data.
- No Phase 7.5+ scope was introduced.

Regression verification:

- `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm --filter @zea-play/worker test` passes.
- Focused E2E now verifies Task Detail 7.4 coexistence: Overview Tags/Attachments render, each relationship tab opens and returns, and lazy request counts do not fan out.
- `pnpm test:e2e` passes 16/16.

### Phase 7.4 - TASK RELATIONSHIPS - COMPLETE / PASS

Phase 7.4 is complete across relationship backend, relationship UX, comments/mentions/reactions/tags, attachment architecture, focused refinements, and final integration/security/performance audit.

### Phase 7.5 - KANBAN - COMPLETE / PASS

Implemented:

- Kanban board view added to All Tasks alongside List, Grid, and Compact.
- Columns are generated from active Workspace TASK `StatusDefinition` records; no duplicate status engine was introduced.
- Column order follows existing status ordering.
- Persistent `Task.kanbanRank` ordering was added for server-authoritative card order.
- New Tasks, ordinary status changes, bulk status changes, and Kanban moves keep rank state coherent.
- Cross-column Kanban moves reuse existing Task status transition rules.
- Drag/drop works for pointer and keyboard sensors, with a mobile-safe status select fallback on each card.
- WIP limits are stored per Workspace/status column and remain informational, not hard-blocking.
- Kanban columns load bounded server-side pages and compose with existing All Tasks filters/search.
- Workspace switch clears tenant-bound Kanban board UI state.

Security/performance invariants:

- Kanban settings and moves are Workspace-scoped and permission-key/custom-role compatible.
- Cross-Workspace task/status/placement anchors are rejected by backend ownership checks.
- Rank changes are computed server-side in a transaction; client-provided rank values are not accepted.
- Card order is persisted through server-authoritative Decimal ranks.
- Rebalance is deterministic and bounded to the destination Workspace/status column.
- Cross-column moves update `statusDefinitionId` and `kanbanRank` atomically.
- Existing Task hierarchy/dependency transition rules remain authoritative for Kanban moves.
- Filtered-board reorder uses backend anchor placement against the full destination column, so hidden cards are not corrupted.
- WIP limits are informative and overrideable; backend totals drive column counts and WIP state.
- Each column remains independently bounded and paginated.
- Kanban filters stay server-side.
- Mobile/non-drag status-move fallback exists and uses the same backend move path.
- Workspace/session switching clears board-local state.
- All Tasks non-Kanban hot path remains unchanged and does not hydrate Kanban columns.
- No Phase 7.6+ recurrence, templates, approvals, timers, Calendar, Gantt, gamification, or automation scope was introduced.

Regression verification:

- `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 17/17.
- High-threshold audit passes while reporting one moderate advisory.

### Phase 7.6 - Recurring Tasks + Templates - COMPLETE / PASS

Implemented:

- Workspace-scoped recurrence series model with explicit schedule fields, lifecycle state, generation cursor, occurrence count, and safe blueprint relations.
- Nullable Task recurrence metadata so every generated occurrence remains a normal independent Task linked to its Series.
- Schedule-driven recurrence for DAILY, WEEKDAYS, WEEKLY selected weekdays, MONTHLY, and CUSTOM DAY/WEEK/MONTH intervals.
- IANA timezone validation and Luxon-based local wall-clock recurrence calculation, including DST behavior and monthly date clamping.
- First occurrence creation during Task create and existing Task -> recurring conversion without duplicate first occurrence.
- Pause, resume, and end lifecycle endpoints; resume advances to the first valid future occurrence instead of backfilling intentionally paused dates.
- One system-level BullMQ recurrence dispatch job registered by the API, with a worker-side bounded PostgreSQL scanner.
- Worker generation uses database locking and the Task occurrence unique identity as final duplicate protection.
- Workspace-scoped Task Templates with ACTIVE/ARCHIVED lifecycle, create/edit/archive/reactivate/use, and Save Task As Template.
- Templates copy only creation-safe Task fields: title, description, priority, status, department, assignees, followers, projects, and tags.
- Normal Task create now supports create-time Tag assignment through the existing Task create validation path.
- Task Create advanced fields now include recurrence configuration for Does not repeat, Daily, Weekdays, Weekly, Monthly, and Custom patterns.
- Task Detail overview now shows recurring Series summary and pause/resume/end controls for recurring tasks.
- Existing non-recurring Tasks can be converted with a Make Recurring dialog using the same recurrence controls.
- Recurring Task edits require an explicit scope choice: This task only, This and future tasks, or Entire Series.
- Task Detail includes Save as Template with copy-scope helper text.
- `/workspace/tasks/recurring` lists recurring Series with server-side search/status/page parameters and lifecycle actions.
- `/workspace/tasks/templates` lists templates with server-side search/status/page parameters, create/edit/archive/reactivate actions, and Use Template opening the existing Task Create dialog prefilled for user review.
- Template stale-reference risk is surfaced safely before reuse.
- Recurrence/template frontend services use Workspace-scoped React Query keys.
- English/Tamil labels were added for visible recurrence/template UX.

Security/performance invariants:

- Recurrence is schedule-driven, not completion-driven.
- PostgreSQL is recurrence source of truth.
- BullMQ only triggers the bounded scanner; there is no one-BullMQ-job-per-Series design.
- The scanner is bounded, indexed, and multi-worker safe through row claiming and database uniqueness.
- Occurrence generation is transactional and idempotent.
- Each generated occurrence is a normal independent Task.
- Task occurrence identity is unique per Series.
- Local wall-clock schedules use explicit IANA timezones retained on the Series.
- Monthly recurrence retains the intended anchor day and clamps only per occurrence.
- DST and nonexistent/ambiguous local times are handled through Luxon.
- Missed ACTIVE occurrences catch up in bounded batches.
- Intentional PAUSE does not backfill skipped dates.
- Catch-up remains bounded and later scans continue unprocessed backlog.
- Series supports Never, On Date, and After Count ending.
- The first Task is occurrence #1 for both create-time recurrence and Make Recurring.
- Generated Tasks use normal Task creation invariants for status, tenant relations, tags, and Kanban rank.
- Individual occurrence edits do not mutate Series by default.
- Edit scope is explicit in the visible Task Detail editing path.
- Historical occurrences remain snapshots.
- Completing, deleting, or editing one occurrence does not alter the Series without an explicit Series action.
- Templates are Workspace scoped.
- Template names are case-insensitively unique per Workspace.
- Templates use ACTIVE/ARCHIVED lifecycle; no hard-delete Template UX was added.
- Template relations use Workspace-safe relational integrity.
- Template creation reuses normal Task create flow.
- Save As Template copies creation-safe fields only.
- Use Template pre-fills the existing Task Create flow and never auto-submits.
- Stale Template references cannot create invalid Tasks because final persistence goes through normal Task validation.
- Template changes never mutate already-created Tasks.
- Recurrence/template permissions are backend authoritative and permission-key/custom-role compatible.
- No role-name authorization was added.
- Comments, mentions, reactions, subtasks, dependencies, related Tasks, attachments, history, Kanban rank, recurrence history, notifications, automation, and gamification are not copied into Templates.
- Existing Task, All Tasks, and Kanban hot paths remain lean; recurrence/template catalogs are not fetched by normal All Tasks/Kanban rendering.
- English/Tamil, Light/Dark/Colorful, responsive widths, and recurrence/template accessibility paths are covered by focused UI/E2E verification.

Verification:

- `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 19/19, including the deterministic Project UI route/create/tab journey.
- `pnpm test:integration` passes 83/83 API integration tests plus worker integration tests.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 10 worker tests.
- Focused recurrence schedule tests cover daily, weekdays, weekly selected days, monthly clamp, custom day/week/month intervals, On Date, After Count, timezone validation, and DST behavior.
- Focused worker tests cover skipped row-claim behavior so a locked Series is not generated by another worker.
- Focused recurrence/template E2E coverage passes for create-time recurrence, Task Detail summary and lifecycle actions, Make Recurring, explicit edit scope, recurring Series list, template catalog lifecycle, Use Template prefill, and Save Task As Template.

### Phase 7.7 - Completion Proof + Approval - COMPLETE / PASS

Implemented:

- Workspace-scoped Task completion policies with proof requirement mode, required proof types, approval mode, creator approver source, permission-based approver source, and explicit approver relation support.
- Immutable/versioned Task completion submissions with requested terminal status snapshot, previous status snapshot, proof requirement snapshot, approval mode snapshot, submitter, proof items, approver snapshots, and approval decisions.
- Proof item support for TEXT, URL, CHECKLIST_CONFIRMATION, and ATTACHMENT; attachment proof links reuse the Phase 7.4D Attachment/Asset architecture through an explicit proof relation.
- Pending approval is modeled as workflow state on `Task.pendingCompletionSubmissionId`, not as a `StatusDefinition`.
- Approval-required submissions keep the Task in its previous non-terminal status until final approval.
- Approval-free submissions apply the requested terminal status immediately through the normal Task status transition path.
- Rejection keeps historical submission/proof records, clears pending state, and requires a new submission attempt for the next version.
- Final approval reuses existing terminal transition validation, dependency/hierarchy rules, and Kanban rank assignment.
- Task status update and Kanban terminal moves accept completion payloads for backend-authoritative terminal completion.
- Terminal transitions that need proof/approval return structured `COMPLETION_FLOW_REQUIRED` errors with safe task/status/policy details.
- Kanban terminal drag and All Tasks terminal completion entry points route into the shared completion dialog.
- The shared completion dialog supports text, URL, checklist, and file/image proof. File/image proof uses existing Attachment upload-init -> presigned upload -> finalize flow and submits only the finalized `attachmentId`.
- Bulk terminal status actions are guarded: tasks requiring proof/approval must use the completion flow instead of silent bulk completion.
- Task Detail overview includes completion policy management, terminal completion submission, completion history, and the current task's approval queue.
- Recurring Series store explicit completion-policy blueprints, including same-Workspace explicit approver relations, and generated future occurrences receive independent `TaskCompletionPolicy` snapshots.
- English/Tamil labels were added for visible completion and approval UX.

Security/performance invariants:

- Completion policies, submissions, proof items, proof attachments, approver snapshots, and approval decisions are Workspace scoped.
- DB relations use same-Workspace composite foreign keys for Task, StatusDefinition, WorkspaceMembership, and Attachment ownership.
- Completion policy and decision APIs use permission-key/custom-role authorization; no role-name authorization was added.
- Proof attachment validation accepts only active same-Workspace READY file attachments.
- External proof URLs accept http/https only.
- Completion submission versioning is immutable; rejected proof/history is retained.
- At most one pending completion submission can exist per Task.
- Approval decisions are idempotency-protected per approver/submission through a unique relation.
- Double-submit and approval/rejection races are guarded by transaction row locks and serializable writes.
- Creator approval uses the Task creator's active same-Workspace membership.
- Permission approvers are resolved from active same-Workspace memberships with `tasks.completion.approve`.
- Project owner/manager approver source remains structurally represented but intentionally not resolved because the current Project foundation has no authoritative owner/manager membership semantics.
- All Tasks and Kanban hot paths expose only pending completion summary and do not hydrate proof history or policies per row/card.
- Recurring Task approval is per occurrence; completion does not mutate the Series.
- Recurring generated Tasks inherit completion policy only; submission/proof/decision history is never inherited.
- No notifications, automation, gamification, timers, workload, Calendar, or Gantt scope was introduced.

Verification:

- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy`, `pnpm prisma:validate`, `pnpm prisma:generate`, `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 19/19, including the deterministic Project UI route/create/tab journey.
- `pnpm test:integration` passes 87/87 API integration tests plus 11/11 worker integration tests.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 11 worker tests.
- Build passes with the existing Next ESLint-plugin detection warning.

### Phase 7.8 - Time Tracking + Workload - COMPLETE / PASS

Implemented:

- Workspace-scoped Task time entries with TIMER and MANUAL entry types, duration tracking, soft delete metadata, and explicit stop reasons.
- Database-enforced global running-timer uniqueness through a partial unique index on running TIMER rows per user.
- Live timer start, stop, and explicit switch APIs, including cross-Workspace switch safety for a global user.
- Global active timer API and Workspace header indicator with local elapsed ticking and no per-second persistence or polling writes.
- Manual time create/edit/delete APIs with permission-key authorization and same-Workspace membership validation.
- Manual time remains allowed on completed Tasks, while live timers cannot start on terminal Tasks.
- Terminal Task transitions, bulk terminal transitions, Task delete, and completion approval finalization auto-stop running timers in the same transaction.
- `Task.estimatedMinutes`, recurrence blueprint estimates, and template estimate support.
- Task workload allocations with explicit per-assignee planned minutes, automatic equal remainder distribution, and estimate ceiling enforcement.
- Workspace member capacity overrides scoped to `WorkspaceMembership`; default capacity is 40h/week without creating override rows.
- Authoritative Workspace IANA timezone stored on `Workspace.timezone`, validated on create/update, surfaced in session/workspace settings, and defaulting to UTC.
- Workload day/week reporting from estimates and allocations only; actual tracked time is intentionally not used.
- Workload day/week windows use the Workspace timezone and separate scheduled member load, unallocated work, unscheduled work, and overdue backlog.
- Time reports use Workspace-timezone date boundaries, server-side filtered totals across the full dataset, and date-range overlap clipping.
- New recurrence schedules default to the current Workspace timezone when no explicit timezone is submitted; existing recurrence series keep their stored timezone snapshot.
- Time tracking, workload, and Workspace settings frontend routes, navigation entries, English/Tamil labels, and responsive summary tables/forms.

Security/performance invariants:

- Global timer uniqueness is enforced by the database and guarded by user row locks during timer writes.
- Same-Workspace and cross-Workspace simultaneous starts are protected; explicit switch stops the old timer and starts the new timer atomically.
- Server timestamps all live timer stops.
- All time/allocation/capacity APIs are Workspace-tenant scoped and use permission keys/custom roles, not role-name authorization.
- Cross-Workspace time entry, workload allocation, and capacity mutation attacks are rejected by same-Workspace lookups and composite relations.
- Recurring generated Tasks copy estimates and completion policy blueprints only; TimeEntries are never copied.
- All Tasks and Kanban hot paths do not hydrate TimeEntry history.
- Workload uses set-based membership/task queries and paginates member results.
- Workload states use locked utilization thresholds.
- Workspace timezone is server-authoritative for workload and time report calendar interpretation; clients no longer pass workload timezone query parameters.
- No surveillance, payroll, billing, gamification, notifications, Calendar, or Gantt scope was introduced.

Known limitations:

- Task Detail has backend and service support for time entry actions, but the most complete visible UX is currently the global timer, Time Tracking page, and Workload page.
- The Time Tracking and Workload pages are intentionally operational summaries; richer inline allocation/capacity editors remain deferred.

Verification:

- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy`, `pnpm prisma:validate`, `pnpm prisma:generate`, `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 19/19, including the deterministic Project UI route/create/tab journey.
- `pnpm test:integration` passes 92/92 API integration tests plus 11/11 worker integration tests.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 11 worker tests.
- Focused Phase 7.8 integration coverage verifies global timer switching, terminal auto-stop, manual time on completed Tasks, report clipping across the full filtered dataset, Workspace-timezone workload/report boundaries, recurrence timezone defaults/snapshots, workload allocation math, unallocated/unscheduled/overdue buckets, and capacity overrides.
- Build passes with the existing Next ESLint-plugin detection warning.

### Phase 7.9 - Task Views - COMPLETE / PASS

Implemented:

- Calendar - COMPLETE / PASS
- Gantt - COMPLETE / PASS
- Team - COMPLETE / PASS
- Reports - COMPLETE / PASS
- Activity Logs - COMPLETE / PASS
- Nullable `Task.plannedStartAt` with safe migration, Prisma mapping, create/edit/schedule validation, and Gantt scheduling support.
- Calendar view under `/workspace/tasks?view=calendar`, driven by `dueAt`, with server-authoritative Workspace timezone windows, fixed month summaries, bounded day/week detail loading, and derived urgency separate from priority.
- Gantt view under `/workspace/tasks?view=gantt`, requiring `plannedStartAt + dueAt`, keeping missing-boundary work unscheduled, reusing `TaskDependency` for display, and applying schedule updates through the server.
- Team view at `/workspace/tasks/team`, reusing Phase 7.8 Workload calculation and capacity/allocation semantics.
- Reports view at `/workspace/tasks/reports`, backed by server-side summary and CSV export for the current filters with formula-injection mitigation.
- Activity Logs view at `/workspace/tasks/activity`, reusing `AuditLog` with server-side filters, pagination, and CSV export.
- Task navigation, English/Tamil labels, planned-start create/detail visibility, and responsive view switching for List/Grid/Compact/Kanban/Calendar/Gantt.

Security/performance invariants:

- Workspace timezone remains authoritative; clients cannot choose arbitrary Calendar/Gantt/Reports timezone.
- Day/week/month boundaries are computed server-side using Workspace-local calendar boundaries, including DST-safe `luxon` windows.
- Calendar Month/Week uses Workspace timezone; Month cells remain fixed and summary-driven.
- Calendar day detail is separately loaded and paginated by Workspace-local date.
- Calendar urgency is derived from deadline state and remains separate from priority.
- Terminal overdue Tasks never show overdue urgency.
- Gantt uses `plannedStartAt + dueAt`; incomplete schedules remain Unscheduled.
- Gantt reuses `TaskDependency`, has no second dependency graph, and does not auto-schedule dependent Tasks.
- Gantt mutations are server-authoritative and validate the final date pair atomically.
- Team reuses Phase 7.8 workload/capacity with no second workload formula.
- Reports are server aggregated and KPI values use one consistent filtered Task population.
- Completion trend uses reliable AuditLog completion evidence only and avoids duplicate counts when status-change and approval evidence refer to the same Task/date completion.
- Tracked-time report metrics respect Time permissions.
- CSV exports follow active filters and prevent formula injection.
- Activity Logs use the existing immutable Audit system only.
- Activity DTO metadata is allowlisted/safe; filtering/export is server-side.
- All Task Views are Workspace/timezone safe and load lazily.
- List/Grid/Compact/Kanban hot paths remain unchanged.
- No role-name authorization and no Phase 7.10+/Phase 10+ scope was introduced.
- Gantt is display/update only and does not auto-reschedule dependencies.
- Team view continues to use Workload, not actual tracked time.
- Reports and Activity are server-side filtered and aggregated/exported; browser all-data aggregation is not introduced.
- All new routes remain Workspace-tenant scoped and permission-key based, with no role-name authorization.
- All Tasks/Kanban hot paths continue to avoid TimeEntry history hydration.
- List/Grid/Compact/Kanban task browser behavior remains intact.

Verification:

- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy`, `pnpm prisma:validate`, `pnpm prisma:generate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 18/18.
- `pnpm test:integration` passes 93/93 API integration tests plus 11/11 worker integration tests.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 11 worker tests.
- Focused Phase 7.9 integration coverage verifies planned-start interval rejection, server schedule updates, cross-Workspace schedule fences, Calendar month summaries plus separately paginated day detail, Workspace timezone/DST boundaries, terminal overdue SAFE urgency, Gantt dependency display and unscheduled counts, report aggregation/export, duplicate-safe completion trend evidence, activity pagination, and CSV formula mitigation.
- Build passes with the existing Next ESLint-plugin detection warning.

### Phase 7.10 - Final Task Security + Performance + Integration Audit - COMPLETE / PASS

Implemented:

- Final Task Management module audit and hardening across Task CRUD, create, All Tasks, bulk actions, hierarchy, dependencies, related Tasks, comments, internal comments, mentions, reactions, Tags, attachments, Kanban, recurrence, Templates, completion proof, approvals, time tracking, workload, Calendar, Gantt, Team, Reports, Activity Logs, audit, query/cache isolation, concurrency, database constraints, performance, routing, responsive/accessibility/i18n/theme, storage, and workers.
- Time report totals now use a set-based database aggregate for clipped overlap duration instead of loading every matching TimeEntry row.
- Reports and Activity CSV exports now enforce an explicit 10,000-row full-filter maximum and return machine-readable `TASK_EXPORT_TOO_LARGE` instead of silently truncating.
- Task query DTOs now bound Task search and Activity action filters.
- Login now routes into the current scope-aware dashboard shell (`/workspace/dashboard` when a Workspace is selected, otherwise `/agency/dashboard`) instead of the legacy `/dashboard` placeholder.
- Focused integration coverage now verifies the explicit oversized Activity export failure.

Final Phase 7 invariants:

- Task data is Workspace isolated.
- Custom-role RBAC remains backend authoritative.
- No role-name authorization is used for Task module authorization.
- Task creation and bulk operations are transactional.
- All Tasks remains server-side and bounded.
- Relationships are tenant-safe and cycle-safe.
- Comments, Internal comments, Mentions, and Reactions remain isolated.
- Tags retain ACTIVE/ARCHIVED lifecycle semantics.
- Attachments reuse Workspace physical storage safely.
- Kanban reuses StatusDefinition and server-owned Decimal rank.
- Recurrence is PostgreSQL-authoritative and idempotent.
- Templates create independent Task snapshots.
- Completion proof and approval are immutable and concurrency-safe.
- StatusDefinition remains the sole Task status engine.
- Global timer uniqueness is database enforced.
- Terminal transitions atomically stop active Task timers.
- Workload uses planned estimates, not tracked time.
- Workspace timezone is authoritative.
- Calendar, Gantt, Team, Reports, and Activity remain server-driven/lazy.
- Reports and Activity CSVs are tenant-safe and formula-injection protected.
- AuditLog remains immutable and Activity remains read-only.
- Task hot paths avoid N+1/request fan-out.
- Query keys remain Workspace safe.
- Migrations validate from a clean migration chain.
- Task frontend surfaces remain responsive/accessibility/i18n/theme safe.
- Phase 7 introduces no premature Phase 8+ features.

Verification:

- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy`, `pnpm prisma:validate`, `pnpm prisma:generate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 18/18.
- `pnpm test:integration` passes 93/93 API integration tests plus 11/11 worker integration tests.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 11 worker tests.
- Build passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.

### Phase 7 - Task Management - COMPLETE / PASS

The full Phase 7 Task Management module is production-safe for the audited scope. The next phase is Phase 8 - Project Management System. Do not start Phase 8 automatically.

### Phase 8.1 - Project Core + Status Migration - COMPLETE / PASS

Implemented:

- Existing `Project` model retained as the Project foundation; no parallel Project system was introduced.
- Project belongs to exactly one Workspace, and Workspace remains the Project tenant boundary through canonical `/api/v1/workspaces/:workspaceId/projects` APIs.
- Project lifecycle now uses Workspace-scoped `StatusDefinition` records with `entityType = PROJECT`.
- Legacy `Project.status` is no longer runtime business authority; it is retained temporarily for compatibility and deterministic archival mapping.
- Existing legacy Project status data is preserved and migrated deterministically into `statusDefinitionId`: `DRAFT` -> Initial Meeting, `ACTIVE` -> Development, `ARCHIVED` -> Completed.
- Project core fields now include `priority`, `plannedStartAt`, `dueAt`, and optional `departmentId`.
- Project CRUD is Workspace scoped, permission-key based, and audited.
- Project list is server-side paginated and filterable by search, PROJECT status, priority, department, planned-start range, due range, and bounded sort options.
- Minimal `/workspace/projects` UX supports list, create, detail, edit, status change, and soft delete.
- Workspace Tasks project selectors now read from the canonical Workspace-scoped Project API.
- Legacy `/api/v1/projects` routes remain as thin compatibility wrappers over the same service.

Security/performance invariants:

- Project status assignment accepts only active same-Workspace `StatusDefinition(PROJECT)` rows.
- TASK/TICKET/foreign/inactive/missing statuses are rejected for Project lifecycle mutations.
- Task `StatusDefinition` rows cannot be used by Projects.
- Project priority accepts LOW, MEDIUM, HIGH, and URGENT without affecting status semantics.
- `plannedStartAt` and `dueAt` are stored as UTC timestamps and validated as a final pair on create and patch.
- Project department assignment accepts only active same-Workspace Departments.
- Project list, search, filter, sort, and pagination are server-side and bounded.
- Project list/detail return Status/Department summaries without per-Project preload of Tasks, Files, Members, Activity, Reports, Kanban, or Gantt.
- Project delete is a soft archive and does not cascade into Tasks, Assets, or attachments.
- No role-name authorization is used.
- No Project owner/member/visibility/tag/progress functionality was added.
- `TaskProject` remains unchanged.
- `ProjectAttachment` compatibility remains unchanged.
- Project asset routes remain compatibility-scoped and were not redesigned in Phase 8.1.
- No Phase 8.2+ features were introduced.

Verification:

- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy`, `pnpm prisma:validate`, `pnpm prisma:generate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:e2e` passes 18/18.
- `pnpm test:integration` passes 94/94 API integration tests plus 11/11 worker integration tests.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 11 worker tests.
- Build passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.

Phase 8.1 is complete/pass. Do not start Phase 8.2 automatically.

### Phase 8.2 - Project Owner + Members + Visibility - COMPLETE / PASS

Implemented:

- Existing `Project` model extended; no second Project model or second status system was introduced.
- Projects now have `ownerMembershipId` referencing `WorkspaceMembership` in the same Workspace.
- Projects now support `visibility = WORKSPACE | RESTRICTED`.
- New `ProjectMember` model stores same-Workspace project membership through `WorkspaceMembership`.
- Project create/update/detail/list serialization includes owner, visibility, and member count metadata.
- Workspace-scoped Project member APIs support paginated list, add, idempotent remove, and owner changes.
- New permission keys: `projects.view_all`, `projects.manage_members`, and `projects.manage_owner`.
- `/workspace/projects` UX supports owner selection, visibility selection, and minimal member management.
- Task Project summaries now suppress restricted Project metadata unless the viewer can access that Project.
- Permission resolution and `PermissionGuard` no longer grant access by role name or OWNER wildcard derivation.
- Focused refinement hardened duplicate member races, batch atomicity, direct-ID mutation security, selector leakage, immediate frontend access-loss handling, and no-op audit behavior.

Security/performance invariants:

- Project owner and members are always `WorkspaceMembership` records, never raw User-only ownership.
- Project owner assignment accepts only active same-Workspace `WorkspaceMembership` records; existing Projects remain intact if the owner membership later becomes inactive.
- Foreign Workspace, inactive, missing, and owner-as-member Project memberships are rejected or ignored according to the API contract.
- Restricted Projects are visible only to their owner membership, Project members, or callers with `projects.view_all`.
- Owner/member visibility does not replace RBAC mutation permissions.
- `projects.view_all` is a Workspace-bounded visibility bypass only and does not imply update/delete/member-management permissions.
- Project creator is not a permanent restricted-Project bypass.
- Project visibility is applied before list count, pagination, search, filters, and sort.
- Project list search and access predicates compose under `AND` so search cannot overwrite visibility restrictions.
- Project visibility affects Project access only; Task ACL remains independent.
- Task Project metadata is filtered per linked Project without deleting historical `TaskProject` rows.
- Task Project selectors exclude inaccessible restricted Projects.
- Member mutations are bounded, transactional/idempotent, and backed by database uniqueness.
- Project owner/member/visibility changes handle likely immediate self-access loss by clearing detail cache and navigating to the Project list.
- Workspace switching remains isolated through Workspace-scoped query keys and reset detail/edit state.
- Phase 8.2 did not introduce tags, progress/completion, Kanban/Gantt, Project files redesign, activity feeds, reports, or templates.

Verification:

- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy` applied migration `0025_phase8_2_project_owner_members_visibility`.
- `pnpm prisma:validate` passes.
- `pnpm --filter @zea-play/api typecheck` passes.
- `pnpm --filter @zea-play/web typecheck` passes.
- `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` pass.
- `pnpm test:integration` passes 96/96 API integration tests plus 11/11 worker integration tests.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 11 worker tests.
- `pnpm test:e2e` passes 18/18.
- Build passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.

Phase 8.2 is complete/pass. Do not start Phase 8.3 automatically.

### Phase 8.3 - Project Tags + Progress + Completion - COMPLETE / PASS

Implemented:

- Project tags reuse the existing `WorkspaceTag` catalog; no second tag catalog was introduced.
- New explicit `ProjectTag` join model links Projects to same-Workspace `WorkspaceTag` records with unique `(projectId, tagId)`.
- Project tag APIs list, add, and remove Project tags through Workspace-scoped Project routes.
- Active `WorkspaceTag` records can be assigned to Projects; archived tags remain visible/filterable/removable but cannot be newly assigned.
- Project list supports server-side `tagId` filtering composed with existing visibility, search, status, priority, department, date, pagination, and sorting predicates.
- Project serialization now includes `calculatedProgress`, nullable `manualProgressPercent`, `effectiveProgress`, and task counts for total/open/completed/overdue linked active tasks.
- Calculated progress is derived from linked non-deleted `TaskProject` tasks using current `StatusDefinition(TASK).isTerminal`.
- Empty non-terminal Projects calculate to 0%; empty terminal Projects calculate to 100%.
- Manual progress override is nullable 0-100 and gated by `projects.manage_progress`.
- Terminal Project status transition is blocked while any active linked Task is non-terminal; empty Projects may complete.
- Completion does not mutate linked Tasks; reopening a Project does not reopen Tasks; reopening a Task does not auto-reopen a completed Project.
- `/workspace/projects` shows server-derived Project progress on list/detail, server-side tag filtering, Project tag add/remove, archived tag labels, and manual progress override/reset.
- English and Tamil i18n strings were added for Project tags, progress, completion errors, and related task counts.

Security/performance invariants:

- Project tags are tenant-safe through same-Workspace foreign keys on Project and WorkspaceTag.
- Foreign Workspace tags and archived tags are rejected on assignment.
- Duplicate Project tag relationships are impossible at the database layer and idempotent at the API layer.
- Project tag and progress routes use permission keys only; no role-name authorization was introduced.
- Restricted Project access is checked before tag/progress reads or mutations.
- Tag filtering composes after restricted Project visibility, so inaccessible Projects are excluded before count/pagination.
- Progress summaries are computed in one batch query per Project list/detail call, avoiding Project list N+1 task-count queries.
- Manual progress cannot bypass terminal Project completion rules.
- Phase 8.3 did not add Project task management UI, link/create task UX, Kanban/Gantt, Project files redesign, activity feeds, reports, templates, notifications, automation, or gamification.

Verification:

- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy` applied migration `0026_phase8_3_project_tags_progress_completion`.
- `pnpm prisma:validate` passes.
- `pnpm prisma:generate` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes root unit/app tests, including 106 web tests, 23 API tests, and 11 worker tests.
- `pnpm test:integration` passes 97/97 API integration tests plus 11/11 worker integration tests.
- `pnpm test:e2e` passes 18/18.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes.
- `pnpm --filter @zea-play/api test:integration -- phase6-3-statuses.integration-spec.ts` passes 12/12 tests, including Phase 8.1, Phase 8.2, and focused Phase 8.3 regressions.
- Final formatting-gate refinement passes `pnpm format` after formatting the tracked repository README and VS Code settings.

Phase 8.3 is complete/pass. Do not start Phase 8.4 automatically.

### Phase 8.4 - Project Tasks Integration - COMPLETE / PASS

Implemented:

- Project Tasks surface reuses the existing Task engine and `TaskProject` many-to-many relation.
- Project Tasks use the existing server-side Task list endpoint with a forced `projectId` filter; no client-side Workspace-task filtering or duplicate ProjectTask model was introduced.
- The Project Tasks tab lazy-loads; Project Overview makes zero Project task-list requests.
- Create Task inside Project reuses the normal Task Create dialog and preselects the current Project.
- Link Existing Task uses bounded server-side Task search and a single transactional Project relation request.
- Duplicate links are idempotent through the existing unique `TaskProject` key and `createMany(...skipDuplicates)`.
- Remove from Project deletes only the `TaskProject` relation and never deletes, archives, or mutates the Task.
- Tasks may belong to zero or multiple Projects.
- Project membership does not create a Task ACL; Project visibility and Task access are independently enforced.
- Restricted Project access is enforced independently on Project task relation endpoints.
- Task Project metadata remains visibility-safe through existing Task serialization.
- Project progress/counts refresh from derived Task state after create/link/unlink.
- Terminal Projects may later receive or contain reopened Tasks without auto-reopening the Project.
- Project Tasks avoid Project list N+1 behavior and avoid fetching hidden Project selector data inside Project context.
- No role-name authorization was added.
- No Phase 8.5+ Project Kanban, Timeline/Gantt, Files UI, Activity, Reports, or Templates functionality was added.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm --filter @zea-play/api exec dotenv -e ../../.env.example -- prisma migrate deploy` passes with no pending migrations.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes root unit/app tests, including 108 web tests, 23 API tests, and 11 worker tests.
- `pnpm test:integration` passes 99/99 API integration tests plus 11/11 worker integration tests.
- `pnpm test:e2e` passes 18/18.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes.
- `pnpm --filter @zea-play/api test:integration -- phase6-3-statuses.integration-spec.ts` passes 14/14 tests, including Phase 8.1, Phase 8.2, Phase 8.3, Phase 8.4, and focused access-boundary regressions.
- Phase 8.4 focused refinement passed with final invariants: `TaskProject` remains the only Project/Task many-to-many relation; no duplicate `ProjectTask` model exists; Project Tasks use the existing Task list with server-side `projectId`; Project membership does not create Task ACL; Project and Task access remain independently enforced; Create Task inside Project reuses normal Task Create and remains transactional; Link Existing uses bounded server-side Task search; batch linking is transactional/idempotent; cross-Workspace Task linking is impossible; unlink removes only `TaskProject` and never deletes Tasks; Tasks may have zero/multiple Projects; Project progress/counts derive correctly after relation changes; terminal Projects may receive/reopen open Tasks without auto-reopen; Tasks tab/search load lazily; no Project Task N+1 or role-name authorization was introduced; no Phase 8.5+ functionality was introduced.

Phase 8.4 is complete/pass. Do not start Phase 8.5 automatically.

### Phase 8.5 - Project Kanban + Timeline - COMPLETE / PASS

Implemented:

- Project Kanban reuses the Phase 7.5 Task Kanban surface with a forced server-side `projectId` filter.
- Project Timeline reuses the Phase 7.9 Task Gantt/Timeline surface with a forced server-side `projectId` filter.
- Project detail adds lazy-loaded Project Kanban and Project Timeline tabs; Overview and Project Tasks do not load these views until selected.
- Task Kanban moves from the Project tab mutate the real Task status/rank globally through the existing Task Kanban API.
- Terminal Task completion rules remain authoritative; terminal status moves still use the existing Task completion flow.
- Project progress/list/detail summaries refresh after Project Kanban Task status changes.
- Project Timeline schedule edits mutate the real Task `plannedStartAt`/`dueAt` through the existing Task schedule API.
- Project Timeline exposes a bounded accessible unscheduled list from the same server-side Task Gantt query; missing `plannedStartAt` or `dueAt` does not invent dates.
- Timeline date-only edits invalidate Task Gantt/detail cache without forcing Project progress refresh.
- Timeline dependencies remain `TaskDependency` only; no Project dependency or Project schedule model was introduced.
- Off-Project dependencies do not auto-link outside Tasks or fan out the full dependency graph; Task Detail remains the authoritative dependency UI.
- Multi-Project Tasks use the same Task state across all Projects and Task views.
- Project-filtered Task list, Kanban, calendar, reports, and timeline queries now require visible same-Workspace Project access when `projectId` is supplied.
- Restricted Project visibility is enforced inside Project-filtered Task queries, preventing direct Task list/timeline route leakage.
- Project view and `projects.view_all` do not grant Task view/update or Kanban/Timeline mutation authority.
- Project and Workspace switches clear Project-context Task browser state, schedule editors, Kanban pagination, drag/completion dialogs, and local filters.
- No Project-specific task model, task status model, rank model, WIP model, dependency model, scheduling model, or Project Task ACL was introduced.
- English and Tamil i18n labels were added for Project Kanban and Project Timeline tabs.
- No role-name authorization was added.
- No Phase 8.6+ Files, Activity, Reports, Templates, Notifications, Automation, Billing, or Gamification scope was added.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- No Prisma schema or migration files changed; previous clean migration deploy remains valid for Phase 8.5.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes root unit/app tests, including 110 web tests, 23 API tests, and 11 worker tests.
- `pnpm test:integration` passes 100/100 API integration tests plus 11/11 worker integration tests.
- `pnpm test:e2e` passes 18/18.
- `pnpm build` passes when rerun after E2E; an earlier concurrent build overlapped with the Playwright `next dev` web server and failed with a transient `/_document` page collection error.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes.
- `pnpm --filter @zea-play/api test:integration -- phase6-3-statuses.integration-spec.ts` passes 15/15 tests, including Phase 8.1 through Phase 8.5 Project access regressions.
- `pnpm --filter @zea-play/web test -- phase7-2.test.tsx` passes 110/110 web tests, including Project Kanban/Timeline lazy-load and shared schedule mutation coverage.
- Phase 8.5 focused refinement passes with final invariants: Project Kanban is the existing Task Kanban filtered by `projectId`; `StatusDefinition(TASK)`, `Task.kanbanRank`, and Workspace Task WIP remain global Task authority; Project access does not grant Task mutation access; Project-filtered Kanban counts/pagination are server-side; Task moves mutate the real Task globally; multi-Project Tasks share status/rank; Task completion/approval rules remain authoritative; Project Timeline is the existing Task Gantt filtered by `projectId`; `plannedStartAt`/`dueAt` remain global Task scheduling fields; `TaskDependency` remains the only dependency graph; off-Project dependencies do not auto-link/fan out; no dependent auto-scheduling exists; multi-Project Tasks share schedule; Kanban and Timeline are independently lazy; no card/bar N+1 exists; Project progress remains server-derived after status changes; no role-name authorization was added; no Phase 8.6+ functionality was added.

Phase 8.5 is complete/pass. Do not start Phase 8.6 automatically.

### Phase 8.6 - Project Files + Members UI + Activity - COMPLETE / PASS

Implemented:

- Project Files tab reuses existing `ProjectAttachment`, `Attachment`, and `Asset` records; no duplicate Project file model or migration was introduced.
- Project Files upload uses the existing presigned MinIO upload architecture, workspace quota accounting, asset processing queue, and server-authorized download URL pattern.
- Project URL attachments use `Attachment(URL)` with strict http/https validation.
- Project file unlink updates `ProjectAttachment.removedAt`; it does not delete `Attachment` or physically delete `Asset` objects.
- Project attachment list/search is server-side, Workspace scoped, Project scoped, and restricted-Project access checked before query/count.
- Project file upload, finalize, link-existing API, URL add, download, and unlink endpoints are gated by Project file permission keys and visible Project access.
- Members UI is now a lazy-loaded Project Members tab that reuses Phase 8.2 owner/member APIs; owner remains separate from `ProjectMember`.
- Project Files, Members, and Activity tabs lazy-load independently; Overview, Tasks, Kanban, and Timeline do not preload them.
- Project Activity tab reads `AuditLog` only; no `ProjectActivity` table or event stream model was introduced.
- Project Activity is restricted to allowlisted Project audit actions and safe metadata fields, with Project visibility checked before any activity query.
- Project Activity filters include server-backed action, user, and date range filters; date-only filters remain Workspace-timezone aware on the backend.
- Project Files UI actions are permission-key controlled for add, remove, and download; backend permission guards remain authoritative.
- Member add UI supports selecting multiple active WorkspaceMembership rows and submits one batched Project member mutation.
- Member selections and Project Files/Activity filter state clear on Project/Workspace switch.
- English and Tamil i18n labels were added for Project Files, Members, and Activity surfaces.
- No role-name authorization was added.
- No Phase 8.7 Reports/CSV/Templates, comments, notifications, automation, gamification, billing, or storage-management scope was added.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- No Prisma schema/model changed.
- Migration `0027_phase8_6_project_files_activity` adds deployable Project files/activity permission catalog rows.
- Migration `0028_phase8_6_system_role_permissions` grants those permissions only to repository-owned Workspace system roles, not arbitrary custom roles.
- Clean migration deploy passes and applied `0027_phase8_6_project_files_activity` and `0028_phase8_6_system_role_permissions`.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes root unit/app tests, including 111 web tests, 23 API tests, and 11 worker tests.
- `pnpm test:integration` passes 100/100 API integration tests plus 11/11 worker integration tests.
- `pnpm test:e2e` passes 18/18.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- `pnpm --filter @zea-play/web test -- phase7-2.test.tsx` passes 111/111 web tests, including Project Files/Members/Activity lazy-load coverage.
- `pnpm --filter @zea-play/api test -- projects.service.spec.ts` passes 1/1 API unit test.

Final invariants:

- Project Files reuse `ProjectAttachment` / `Attachment` / `Asset`.
- No duplicate Project storage model exists.
- Project file authorization is independently enforced.
- Uploads reuse presigned MinIO architecture.
- File download is authorized and generated on demand.
- Presigned URLs are never prefetched, logged, or persisted.
- Project unlink never deletes physical `Asset`.
- Quota changes only for physical `Asset` creation.
- Members UI reuses Phase 8.2 WorkspaceMembership-backed architecture.
- Owner remains separate from `ProjectMember`.
- Member/owner changes preserve RESTRICTED access rules.
- Member searches remain server-side and bounded.
- Project Activity uses immutable `AuditLog` only.
- Project Activity includes direct Project events only.
- Activity response is allowlisted and does not expose unsafe raw metadata.
- Files, Members, and Activity tabs are independently lazy.
- All list queries are bounded/paginated.
- No role-name authorization was added.
- No Phase 8.7+ functionality was added.

Phase 8.6 is complete/pass. Do not start Phase 8.7 automatically.

### Phase 8.7 - Project Reports + CSV - COMPLETE / PASS

Implemented:

- Project Reports backend is derived server-side from the fixed `Project -> TaskProject -> Task` population.
- Project Reports require visible Project access plus `projects.reports.view`; `projects.view_all` remains Project visibility only.
- Permission migration `0029_phase8_7_project_reports_permission` adds `projects.reports.view` and grants it only to repository-owned Workspace system roles.
- Project report filters support date range, Task status, priority, assignee, department, tag, and search; Project ID comes only from the route.
- Report date filters use Task `dueAt` boundaries in the Workspace timezone, matching Phase 7.9 Task Reports semantics.
- One consistent filtered Project Task population powers KPIs, distributions, completion trend, time totals, and CSV export.
- KPIs include total/open/completed/overdue/pending approval, completion rate, estimated minutes, and permission-aware tracked seconds.
- Project progress reporting reuses Phase 8.3 `progressSummaryForProjects`; calculated, manual override, and effective progress are returned separately.
- Status, priority, assignee, and department breakdowns are server aggregated from the filtered Project Task population.
- Completion trend uses Phase 7.9 AuditLog completion evidence semantics and deduplicates same-day status-change/approval evidence.
- Estimated time sums `Task.estimatedMinutes`; tracked time reuses Phase 7.8 `TaskTimeEntry` aggregation.
- Tracked time returns unavailable/null for users without all-time visibility rather than returning a misleading zero.
- Multi-Project Tasks contribute fully to each linked Project report by design.
- Project CSV export uses the exact active filters, exports all authorized matching rows up to the server cap, is UTF-8, and protects formula-leading cells.
- CSV omits comments, completion proof bodies, rejection reasons, attachments, presigned URLs, raw audit metadata, and time-entry notes.
- Reports tab is lazy-loaded on Project detail; Overview, Tasks, Kanban, Timeline, Files, Members, and Activity do not preload report data.
- Reports query keys include Workspace, Project, and every report filter.
- Reports UI includes KPI cards, progress, status/priority/assignee/department breakdowns, completion events, estimated/tracked time, filters, restricted-time messaging, and CSV export.
- English and Tamil i18n labels were added for Project Reports.
- No role-name authorization was added.
- No Phase 8.8+ functionality was added.
- Focused refinement hardened report authorization, requiring Project access plus `projects.reports.view` plus `tasks.view`.
- Focused refinement moved Project report estimated minutes, status distribution, priority distribution, and department breakdown to server-side aggregate queries using the same filtered Project Task population.
- Focused refinement removed the CSV export cap from normal report viewing; the cap remains explicit for CSV export only.
- Focused refinement preserved CSV filter/authorization semantics and tracked-time permission behavior.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- Clean migration deploy passes and applied `0029_phase8_7_project_reports_permission`.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes root unit/app tests, including 111 web tests, 23 API tests, and 11 worker tests.
- `pnpm test:integration` passes 101/101 API integration tests plus 11/11 worker integration tests.
- `pnpm test:e2e` passes 18/18.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.

Final invariants:

- Project Reports are derived server-side and no Project report snapshot/cache model exists.
- Project Reports require Project access, `projects.reports.view`, and `tasks.view`.
- Project visibility and Task visibility filters are enforced before report results.
- Project report permission is separate from Project visibility.
- Project progress matches Project Overview semantics.
- Project KPIs and status/priority/department/estimate values are server aggregated from one authorized filtered Project Task population.
- Assignee breakdown uses Task assignment semantics, not a unique partition of total Tasks.
- Completion trend remains AuditLog-based and Workspace-timezone bucketed.
- Tracked time reuses Phase 7.8 `TaskTimeEntry` aggregation and respects Time permissions.
- Multi-Project Tasks contribute fully to each relevant Project report.
- CSV is tenant-safe, filter-consistent, not current-page-only, and formula-injection protected.
- CSV remains UTF-8 and omits sensitive comments, proof bodies, rejection reasons, presigned URLs, raw audit metadata, credentials, and attachment content.
- Reports tab lazy-loads and does not affect other Project detail tabs.
- No role-name authorization was added.
- No Phase 8.8+ features were introduced.

Phase 8.7 is complete/pass. Do not start Phase 8.8 automatically.

### Phase 8.8 - Project UI Integration - COMPLETE / PASS

Implemented:

- `/workspace/projects` is the canonical Workspace Project route in scope-aware navigation.
- Legacy `/dashboard/projects` and `/dashboard/projects/[projectId]` now redirect to the modern Workspace Project routes and no longer render the stale Project UI.
- One Project Detail implementation exists at `/workspace/projects/[projectId]`.
- Project Detail tabs remain locked as Overview, Tasks, Kanban, Timeline, Files, Members, Activity, and Reports.
- Project tab state is URL/deep-link compatible with `?tab=` values and tab changes use browser history.
- Each heavy Project tab lazy-loads independently; Overview loads only bounded Project summary/tag data.
- Project list remains backed by the Phase 8 server-paginated Project list API.
- Project list supports server-side search, status, priority, department, tag, planned date, due date, sort, and pagination parameters.
- Project list cards show bounded summary data: name, status, priority, owner, visibility, progress, due date, department, updated date, and task summary.
- Project list distinguishes no Projects, no matching Projects, loading, and retryable error states.
- Project Create keeps compact visible fields for name, owner, due date, and visibility, with advanced status, priority, planned start, department, description, and initial member assignment.
- Successful Project creation resets the create form and opens the created Project detail route.
- Project Detail header shows compact primary context: status, priority, owner, effective/calculated/manual progress, due date, and visibility.
- Overview consolidates Project summary, progress, tags, and counts without loading Tasks, Kanban, Timeline, Files, Members, Activity, or Reports tab datasets.
- Existing Task list/Kanban/Gantt, Project Files, Members, Activity, and Reports services/components remain reused.
- Reports tab visibility now requires both `projects.reports.view` and `tasks.view`, matching backend enforcement.
- Restricted access loss cleanup still clears Project detail cache and returns safely to Project list.
- Project/Workspace switching clears tenant-bound transient Project UI state.
- English and Tamil Project UI labels were completed for added Project list filters and states.
- Mobile Project tabs remain horizontally scrollable through the existing tab list behavior.

Focused refinement:

- Canonical Project navigation remains `/workspace/projects`; the legacy protected dashboard link now opens that Workspace route.
- Project list search/filter/sort/page state is URL-backed and Workspace switch cleanup clears tenant-bound Project list state.
- Project Create is permission-gated by `projects.create`; Project update/delete/status/progress/tag/file/activity/member/owner actions remain permission-key gated with backend authority.
- Invalid or unauthorized Project tab URLs fall back safely to Overview without loading hidden tab datasets.
- Restricted access-loss paths are covered for visibility changes, current-member removal, and owner transfer.
- Heavy Project tabs remain independently lazy-loaded; Overview does not request Tasks, Kanban, Timeline, Files, Members, Activity, or Reports data.
- Focused React and Playwright coverage was added for canonical routing, create/detail/tab URL behavior, lazy loading, permission gating, access-loss cleanup, and mobile tab visibility.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:integration` passes.
- `pnpm test:e2e` passes 19/19, including the deterministic Project UI route/create/tab journey.
- `pnpm build` passes on solo rerun after the initial parallel run collided with the active E2E `next dev` server.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.

Final invariants:

- No Project business logic was moved into the frontend.
- No role-name authorization was added; UI tab/action gating remains permission-key based with backend authority.
- No duplicate Project Detail implementation was introduced.
- Project list and tab query keys remain Workspace/Project scoped.
- Legacy dashboard Projects route does not hijack modern Workspace Project navigation.
- No Phase 8.9 or future feature work was introduced.

Phase 8.8 is complete/pass after focused refinement. Do not start Phase 8.9 automatically.

## Architecture Invariants

- PostgreSQL is source of truth.
- Agency -> Workspace is active tenant hierarchy.
- Workspace is operational data boundary.
- Backend tenant authorization is authoritative.
- Workspace users/departments, roles/permissions, and statuses are tenant-scoped Workspace resources.
- Shared statuses are entity-type isolated across TASK, PROJECT, and TICKET.
- Project lifecycle is backed by Workspace-scoped `StatusDefinition(PROJECT)` records.
- Legacy `Project.status` is compatibility-only and must not be restored as Project lifecycle authority.
- Project CRUD and listing must remain Workspace scoped.
- Project ownership and Project members must use same-Workspace `WorkspaceMembership`.
- Project restricted visibility must be enforced before list pagination/count/search/filter/sort.
- Project tags must use the existing same-Workspace `WorkspaceTag` catalog through `ProjectTag`.
- Project progress is derived from linked active Tasks unless a nullable manual override is present.
- Terminal Project status transitions must reject active non-terminal linked Tasks.
- Project Kanban and Project Timeline must reuse the existing Task Kanban/Gantt engines with server-side `projectId` filters.
- Project-filtered Task views must enforce both Task access and visible Project access; Project membership must not create Task ACL.
- Project Files must reuse `ProjectAttachment` / `Attachment` / `Asset`; unlink must remove only the Project relation and must not physically delete stored assets.
- Project Activity must read from `AuditLog` with allowlisted Project actions and safe metadata only.
- Project `plannedStartAt` and `dueAt` are UTC timestamps and must be validated as a final pair.
- `TaskProject` and `ProjectAttachment` compatibility must be preserved while extending Project features.
- Each initialized Workspace/entity type has exactly one active default status.
- Status ordering is transactional and complete-list based.
- Frontend tenant caches must include Workspace identity, and status caches must include entity type.
- Tenant React Query cache must be cleared on session loss after hydration.
- Workspace pages must clear selected details, open editors, and draft dialogs on Workspace switch.
- Access token remains memory-only.
- Refresh token remains HttpOnly.
- CSRF protection remains enabled.
- `x-agency-id` and `x-workspace-id` are centralized.
- Permission checks are permission-key based; role names do not grant authorization.
- MinIO credentials never reach browser.
- External work must eventually use queue/adapter architecture.
- Redis is not source of truth.
- Existing cross-tenant attack tests must remain passing.
- Phase 1-5 passing functionality must not be casually rewritten.

## Current Database Tenant Model

- Agency
- Workspace
- AgencyMembership
- WorkspaceMembership
- Department
- ProjectMember
- Role
- Permission
- StatusDefinition
- Task / TaskAssignee / TaskFollower / TaskProject / TaskKanbanColumnSetting / TaskRecurrenceSeries / TaskRecurrenceCompletionApprover / TaskCompletionPolicy / TaskCompletionPolicyApprover / TaskCompletionSubmission / TaskCompletionProofItem / TaskCompletionProofAttachment / TaskCompletionSubmissionApprover / TaskCompletionApprovalDecision / WorkspaceTag / TaskTag / ProjectTag / TaskComment / TaskCommentMention / TaskCommentReaction / Attachment / TaskAttachment / ProjectAttachment
- FeatureDefinition / FeatureEntitlement
- Project
- Asset
- ProcessingJob
- AuditLog

Do not infer or invent model fields from this list.

## Known Deferred Items

- Magic-byte asset inspection.
- Stale pending upload cleanup.
- Production Docker digest pinning.
- Next ESLint detection warning.
- Final Developer/Super Admin backend authorization.
- Final white-label backend.
- PWA.
- Business modules not yet implemented.

## Phase History

| Phase         | Status | Latest stable Git tag            |
| ------------- | ------ | -------------------------------- |
| Phase 1       | PASS   | Not identifiable in current tags |
| Phase 2       | PASS   | Not identifiable in current tags |
| Phase 3       | PASS   | `phase-3-stable`                 |
| Phase 4       | PASS   | `phase-4-stable`                 |
| Phase 5       | PASS   | `phase-5-stable`                 |
| Phase 6.1     | PASS   | Not tagged                       |
| Phase 6.2A    | PASS   | Not tagged                       |
| Phase 6.2B    | PASS   | Not tagged                       |
| Phase 6.2C    | PASS   | Not tagged                       |
| Phase 6.2     | PASS   | Not tagged                       |
| Phase 6.3A    | PASS   | Not tagged                       |
| Phase 6.3B    | PASS   | Not tagged                       |
| Phase 6.3C    | PASS   | Not tagged                       |
| Phase 6.3     | PASS   | Not tagged                       |
| Phase 6       | PASS   | Not tagged                       |
| Phase 6.4A    | PASS   | Not tagged                       |
| Phase 6.4B    | PASS   | Not tagged                       |
| Phase 6.4C    | PASS   | Not tagged                       |
| Foundation v1 | STABLE | Not tagged                       |
| Phase 7.1     | PASS   | Not tagged                       |
| Phase 7.2     | PASS   | Not tagged                       |
| Phase 7.3A    | PASS   | Not tagged                       |
| Phase 7.3B    | PASS   | Not tagged                       |
| Phase 7.3C1   | PASS   | Not tagged                       |
| Phase 7.3C2   | PASS   | Not tagged                       |
| Phase 7.3C3   | PASS   | Not tagged                       |
| Phase 7.3C    | PASS   | Not tagged                       |
| Phase 7.3     | PASS   | Not tagged                       |
| Phase 7.4A1   | PASS   | Not tagged                       |
| Phase 7.4A2   | PASS   | Not tagged                       |
| Phase 7.4A3   | PASS   | Not tagged                       |
| Phase 7.4A    | PASS   | Not tagged                       |
| Phase 7.4B1   | PASS   | Not tagged                       |
| Phase 7.4B2   | PASS   | Not tagged                       |
| Phase 7.4B3   | PASS   | Not tagged                       |
| Phase 7.4B    | PASS   | Not tagged                       |
| Phase 7.4C1   | PASS   | Not tagged                       |
| Phase 7.4C2   | PASS   | Not tagged                       |
| Phase 7.4C3A  | PASS   | Not tagged                       |
| Phase 7.4C3B  | PASS   | Not tagged                       |
| Phase 7.4C3   | PASS   | Not tagged                       |
| Phase 7.4C    | PASS   | Not tagged                       |
| Phase 7.4D    | PASS   | Not tagged                       |
| Phase 7.4E    | PASS   | Not tagged                       |
| Phase 7.4     | PASS   | Not tagged                       |
| Phase 7.5     | PASS   | Not tagged                       |
| Phase 7.6     | PASS   | Not tagged                       |
| Phase 7.7     | PASS   | Not tagged                       |
| Phase 7.8     | PASS   | Not tagged                       |
| Phase 7.9     | PASS   | Not tagged                       |
| Phase 7.10    | PASS   | Not tagged                       |
| Phase 7       | PASS   | Not tagged                       |
| Phase 8.1     | PASS   | Not tagged                       |
| Phase 8.2     | PASS   | Not tagged                       |
| Phase 8.3     | PASS   | Not tagged                       |
| Phase 8.4     | PASS   | Not tagged                       |
| Phase 8.5     | PASS   | Not tagged                       |
| Phase 8.6     | PASS   | Not tagged                       |
| Phase 8.7     | PASS   | Not tagged                       |
| Phase 8.8     | PASS   | Complete/pass; not tagged        |

## Current Warnings

Confirmed current warnings:

- Next build reports: "The Next.js plugin was not detected in your ESLint configuration."
- Storybook build reports upstream Storybook/Rolldown direct `eval` warnings and chunk-size warnings.
- `pnpm audit --audit-level high` passes, while reporting 1 moderate vulnerability.

## Handoff Notes

- Phase 5 acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, high-threshold audit, and Storybook build.
- Phase 6.1 acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, and high-threshold audit.
- Phase 6.1 refinement added integration coverage for cross-Agency/cross-Workspace isolation, inactive Department rules, suspended manager cleanup, audit events, and clean integration-test teardown.
- Phase 6.2B acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, and high-threshold audit.
- Phase 6.2C acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, high-threshold audit, and whitespace diff checks.
- Phase 6.3A acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, high-threshold audit, and whitespace diff checks.
- Phase 6.3B acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, high-threshold audit, and whitespace diff checks.
- Phase 6.3C acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, high-threshold audit, and whitespace diff checks.
- Phase 6.4A acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, high-threshold audit, and whitespace diff checks.
- Phase 6.4B acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, high-threshold audit, Storybook build, and whitespace diff checks.
- Phase 6.4C acceptance passed with formatting, lint, typecheck, unit tests, integration tests, E2E tests, production build, Prisma validation, high-threshold audit, Storybook build, and whitespace diff checks.
- Phase 7.3C1 Task Bulk Action Backend Engine and focused refinement are complete/pass.
- Phase 7.3C2 Task Bulk Selection UX is complete/pass.
- Phase 7.3C3 Final Bulk + All Tasks security/performance/integration audit is complete/pass.
- Phase 7.3 All Tasks is complete/pass.
- Phase 7.4A Relationship Backend is complete/pass.
- Phase 7.4B1 Task Detail Relationship Shell + Subtask Tree UX is complete/pass.
- Phase 7.4B2 Dependencies + Related Tasks UX and focused refinement are complete/pass.
- Phase 7.4B3 Final Task Relationships UX security/performance/integration audit is complete/pass.
- Phase 7.4B Task Relationships UX is complete/pass.
- Phase 7.4C1 Task Comments + Mentions + Reactions Backend is complete/pass.
- Phase 7.4C2 Workspace Tags Backend and focused refinement are complete/pass; the next phase is Phase 7.4C3 Comments, Mentions, Reactions & Tags UX.
- Phase 7.4C3A Comments + Mentions + Reactions UX and focused refinement are complete/pass; the next phase is Phase 7.4C3B Task Tags UX.
- Phase 7.4C3B Task Tags UX and focused refinement are complete/pass; the next phase is Phase 7.4C3 Final Comments/Mentions/Reactions/Tags Integration Audit.
- Phase 7.4C3 Final Comments/Mentions/Reactions/Tags integration audit is complete/pass.
- Phase 7.4C Comments/Mentions/Reactions/Tags is complete/pass; the next phase is Phase 7.4D Task Attachment Architecture.
- Phase 7.4D Task Attachment Architecture and focused refinement are complete/pass.
- Phase 7.4E Final Task Relationships Audit is complete/pass.
- Phase 7.4 Task Relationships is complete/pass.
- Phase 7.5 Kanban implementation and focused refinement are complete/pass.
- Phase 7.6 Recurring Tasks + Templates implementation and final focused refinement are complete/pass.
- Phase 7.8 Time Tracking + Workload, including the Workspace timezone refinement, is complete/pass.
- Phase 7.9 Task Views final focused refinement is complete/pass.
- Phase 7.10 Final Task Security + Performance + Integration Audit is complete/pass.
- Phase 7 Task Management is complete/pass; the next phase is Phase 8 Project Management System.
- Phase 8.1 Project Core + Status Migration is complete/pass.
- Phase 8.2 Project Owner + Members + Visibility is complete/pass.
- Phase 8.3 Project Tags + Progress + Completion is complete/pass, including the final repository formatting gate; do not start Phase 8.4 automatically.
- Phase 8.4 Project Tasks Integration is complete/pass; the next step is Phase 8.5 Project Kanban + Timeline, and it must not start automatically.
- Phase 8.5 Project Kanban + Timeline is complete/pass; the next step is Phase 8.6 Project Files + Members UI + Activity, and it must not start automatically.
- Phase 8.6 Project Files + Members UI + Activity is complete/pass; the next step is Phase 8.7 Project Reports + CSV, and it must not start automatically.
- Phase 8.7 Project Reports + CSV is complete/pass; the next step is Phase 8.8 Project UI Integration, and it must not start automatically.
- Phase 8.8 Project UI Integration is complete/pass after focused refinement; the next step is Phase 8.9 Final Project Security + Performance Audit, and it must not start automatically.
- E2E auth uses real protected frontend routing with mocked API responses; the previous dev-only frontend session bypass was removed.
- Future phases should extend from the existing tenant, auth, dashboard shell, theme, i18n, queue, and storage boundaries instead of replacing them.
