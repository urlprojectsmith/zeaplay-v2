# Zea Play Project Status

Current: Phase 10.11 — GLOBAL SCORE NORMALIZATION ENGINE COMPLETE / PASS
Next: Phase 10.12 — Agency + Super Admin Global Leaderboards

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

### Phase 8.9 - Final Project Security + Performance + Integration Audit - COMPLETE / PASS

Verified:

- Phase 8.1 through Phase 8.8 Project surfaces were audited together across backend tenant isolation, RBAC, visibility, owner/member access, tags, progress, completion, Task links, Kanban, Timeline, Files, Activity, Reports, CSV, routing, query keys, and UI integration.
- Project uses one Workspace-scoped `Project` model; no duplicate Project/ProjectTask/ProjectFile/ProjectActivity/ProjectV2 model was introduced.
- Project lifecycle uses Workspace-scoped `StatusDefinition(PROJECT)` records; legacy `Project.status` has no runtime authority.
- Owner and member relations use same-Workspace `WorkspaceMembership` records.
- `WORKSPACE` and `RESTRICTED` visibility are backend enforced for list/search/count/detail/direct routes and related Project tab APIs.
- Custom-role RBAC remains permission-key based; role names do not grant Project authorization.
- Legacy singular `project.*` permission aliases cannot authorize Phase 8 Project runtime routes that require plural `projects.*` permissions.
- Hidden Restricted Projects cannot leak through lists, search, Task DTO Project names, selectors, filters, reports, or CSV.
- `WorkspaceTag` is shared by Task and Project through explicit join relations; archived tags remain visible/removable/filterable while new archived assignments are rejected.
- Project progress is server-derived from active linked Task terminal state; manual progress override remains separate and bounded.
- Project completion validates open linked Tasks and never mutates Task status; Project reopen also never mutates Task status.
- `TaskProject` remains the many-to-many Project/Task authority; Project Tasks reuse the existing Task engine.
- Project Kanban reuses Task Kanban, Project Timeline reuses Task Gantt and `TaskDependency`, and both use server-side `projectId` filtering.
- Project Files reuse `ProjectAttachment` / `Attachment` / `Asset`; downloads are authorization-gated and generated on demand.
- Project Activity uses immutable `AuditLog` only with allowlisted safe metadata.
- Project Reports are server aggregated from consistently filtered Project-linked Tasks.
- Project CSV export uses active filters, is not current-page-only, is tenant safe, preserves UTF-8/Tamil, and protects against spreadsheet formula injection.
- Tracked-time reporting respects Time permissions.
- One Project Detail shell integrates all eight Project tabs; heavy tabs lazy-load independently.
- Query/cache keys are Workspace/Project scoped and mutation invalidation is targeted.
- Project runtime has no demonstrated N+1 or request fan-out regression.
- Phase 7 regressions remain green.
- Clean migrations pass.
- No Phase 9+ scope was introduced.

Issues found and fixed:

- Added regression coverage proving legacy singular `project.*` permissions cannot bypass modern plural Phase 8 `projects.*` Project permissions.
- Added a coherent Phase 8 lifecycle integration scenario across Project, Task, Files, Activity, and Reports APIs.
- Aligned the Phase 4 security integration fixture with modern plural Project permissions so tenant isolation reaches service-level 404 checks instead of stale permission 403 checks.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- Clean migration deploy passes with 29 migrations and no pending migrations.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:integration` passes 102/102 API integration tests and 11/11 worker integration tests.
- `pnpm --filter @zea-play/worker test` passes 11/11 worker tests.
- `pnpm test:e2e` passes 19/19 Playwright tests, including the Project UI journey.
- `pnpm build` passes.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.

Phase 8 is complete/pass. Do not start Phase 9 automatically.

### Phase 9.1 - Ticket Core + Status Engine - COMPLETE / PASS

Implemented:

- One Workspace-scoped `Ticket` model for Ticket core records; no duplicate Ticket model or future Ticket tables were introduced.
- Ticket primary identity remains UUID, while human-readable `ticketNumber` is Workspace scoped and generated as `TKT-000001` style.
- Ticket numbering uses an atomic PostgreSQL-backed per-Workspace `WorkspaceTicketCounter`.
- Ticket numbers are unique per Workspace and sequence numbers restart independently per Workspace.
- `StatusDefinition(TICKET)` is the only Ticket lifecycle authority.
- Default Ticket statuses are `New`, `Open`, `In Progress`, `Waiting on Requester`, `Resolved`, and `Closed`.
- Default TICKET statuses are provisioned for existing Workspaces by migration and for future Workspaces through the shared default-status templates.
- Ticket status assignment rejects inactive, foreign-Workspace, foreign-Agency, and non-TICKET status definitions.
- Ticket priority uses the existing `LOW`, `MEDIUM`, `HIGH`, and `URGENT` priority enum.
- `createdByMembershipId` records creator membership only and is not requester, assignee, owner, watcher, or participant logic.
- Requester, assignment, SLA, conversations, attachments, reports, and automation are intentionally deferred.
- Workspace-scoped Ticket CRUD APIs were added under `/api/v1/workspaces/:workspaceId/tickets`.
- Ticket list is server-side paginated, searchable by Ticket number and subject, and filterable by status and priority.
- Ticket deletion is soft delete only; deleted Tickets are excluded from list and detail reads.
- Ticket runtime authorization uses `tickets.view`, `tickets.create`, `tickets.update`, and `tickets.delete` permission keys.
- Ticket create/update/delete/status events use `AuditLog` with bounded safe metadata.
- Workspace Ticket query keys include Workspace identity and avoid cross-Workspace cache reuse.
- Minimal Workspace Ticket list/detail/create/edit/delete UI was added at `/workspace/tickets` and `/workspace/tickets/[ticketId]`.
- Ticket UI supports English/Tamil labels and Light/Dark/Colorful theme inheritance.

Verified:

- Ticket creation rejects client-supplied `ticketNumber` and `createdByMembershipId`.
- Ticket creation rejects client-supplied `sequenceNumber`.
- Ticket update rejects immutable fields including `workspaceId`, `ticketNumber`, `sequenceNumber`, and `createdByMembershipId`.
- Concurrent Ticket creation produces unique committed Ticket numbers per Workspace for the tested batch.
- Multi-Workspace concurrent Ticket creation keeps counters isolated.
- Cross-Workspace and cross-Agency Ticket detail, update, status update, and delete route attacks are rejected.
- Custom-role authorization uses permission keys only; role names do not grant Ticket authorization.
- View-only, create-only, update-only, and delete-only custom role combinations were verified.
- No-op and failed Ticket mutations do not create success audit records.
- Historical Tickets referencing inactive TICKET statuses remain readable, while inactive destination statuses cannot be newly assigned.
- Terminal-to-active Ticket status changes are allowed without hardcoded status-name restrictions.
- Deleted Tickets are excluded from detail, search, status filter, and priority filter surfaces.
- Ticket list/detail do not preload requester, department, assignee, SLA, conversation, attachment, escalation, or report data.
- No `MAX + 1`, count-derived, frontend-derived, Redis-derived, or time-derived Ticket numbering path exists.
- No requester, assignee, SLA, conversation, attachment, report, escalation, queue, or notification scope was added.
- Phase 7 and Phase 8 regressions remain green.
- Clean migration deploy passes against an isolated empty PostgreSQL schema with all 30 migrations applied.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:integration` passes 103/103 API integration tests and includes 11/11 worker integration tests.
- `pnpm --filter @zea-play/worker test:integration` passes 11/11 worker tests.
- `pnpm test:e2e` passes 20/20 Playwright tests, including the Ticket core journey with search, status filter, priority filter, update, status change, and soft delete.
- `pnpm build` passes on solo rerun after the initial parallel run collided with the active E2E `next dev` server.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.

Final invariants:

- One Workspace-scoped `Ticket` model exists.
- UUID is the Ticket primary identity.
- Ticket number is an immutable Workspace-scoped human identity.
- Ticket numbering uses a PostgreSQL-backed atomic per-Workspace counter.
- No `MAX + 1` or `COUNT + 1` numbering exists.
- Ticket counter behavior is concurrency safe.
- `StatusDefinition(TICKET)` is the sole Ticket lifecycle authority.
- Runtime business logic never depends on Ticket status names.
- Default Ticket statuses exist for existing and future Workspaces.
- TASK and PROJECT statuses cannot be assigned to Ticket.
- Foreign and inactive TICKET statuses cannot be newly assigned.
- Priority is `LOW`, `MEDIUM`, `HIGH`, and `URGENT`.
- `createdByMembershipId` identifies creator only.
- Requester, Department, and assignee remain deferred to Phase 9.2.
- Ticket CRUD is Workspace scoped.
- Ticket deletion is soft delete.
- Ticket list/search/filter/pagination are server-side and bounded.
- `tickets.view`, `tickets.create`, `tickets.update`, and `tickets.delete` use the permission engine.
- Custom Roles remain authoritative.
- No role-name authorization exists.
- `AuditLog` remains the Ticket mutation history source.
- Ticket query keys are Workspace scoped.
- Minimal Ticket UI contains only actual Phase 9.1 fields.
- No SLA, conversation, assignment, report, attachment, queue, escalation, portal, email, or WhatsApp scope was introduced.
- Phase 7 remains green.
- Phase 8 remains green.

Phase 9.1 is complete/pass. Do not start Phase 9.2 automatically.

### Phase 9.2 - Requester + Department + Assignment - COMPLETE / PASS

Implemented:

- `TicketRequester` is a Ticket-scoped requester relation, not a CRM Contact system.
- Existing Phase 9.1 Tickets are not backfilled from creator and may remain requester-null.
- New user-created Tickets require an explicit requester.
- Ticket creator remains separate from requester, assignee, owner, watcher, and access-control logic.
- Requester can be `INTERNAL` or `EXTERNAL`.
- INTERNAL requester references an active same-Workspace `WorkspaceMembership`.
- EXTERNAL requester requires name plus email or phone; email is trimmed/lowercased and phone is conservatively validated.
- Requester changes use a dedicated endpoint and require `tickets.manage_requester` plus Ticket access.
- Ticket Department reuses the existing Phase 6 `Department` model and `WorkspaceMembership.departmentId` membership authority.
- Ticket may sit in a Department with no assigned agent.
- Assigned agent requires a Department and must be an active same-Workspace member of that Department.
- Assignment changes use a dedicated endpoint and require `tickets.assign` plus Ticket access.
- `tickets.view` remains the base permission.
- `tickets.view_all` expands visibility to all non-deleted Workspace Tickets.
- Without `tickets.view_all`, Ticket visibility is based on active internal requester, valid assigned agent, or active Department membership.
- `createdByMembershipId` does not grant Ticket visibility.
- Visibility filtering occurs before pagination, counts, search, and direct detail access.
- Hidden Tickets do not leak through exact search.
- `tickets.view_all` does not imply update, delete, assign, or requester-management permissions.
- Requester/assignment audit metadata avoids external email and phone PII.
- Requester, Department, and assignee selectors reuse bounded server-side Workspace user/Department APIs.
- Minimal Ticket UI shows requester, Department, and assigned agent and supports requester/assignment mutations.
- No queue, SLA, conversation, escalation, attachment, reporting, CSV, portal, email, WhatsApp, or notification functionality was introduced.

Focused refinement:

- Creator and requester remain independent concepts; `createdByMembershipId` is creator metadata only and never grants Ticket visibility.
- Legacy requester-null Tickets remain valid and render safely as requester not set.
- `TicketRequester` remains the only Ticket requester relation.
- INTERNAL requester assignment requires an active same-Workspace `WorkspaceMembership`.
- EXTERNAL requester remains lightweight Ticket-scoped contact data and requires name plus email or phone.
- External requester PII is excluded from Audit metadata, list DTO contact fields, logs, URLs, and query keys.
- Ticket Department reuses the existing `Department` architecture.
- `WorkspaceMembership.departmentId` remains the Department membership authority.
- Ticket may have a Department without an assigned agent.
- Assigned agent requires a Department and must be an active same-Workspace current Department member when assigned.
- Department/assignee final pair is transactionally revalidated and audit metadata records the committed final pair.
- Historical inactive requester, assignee, and Department relations remain readable but do not create effective access.
- `tickets.view` remains mandatory for Ticket visibility.
- `tickets.view_all` expands visibility only inside the current Workspace.
- Scoped visibility is internal requester, active Department membership, or valid assignment.
- Visibility is applied before pagination, counts, and search.
- Hidden Ticket exact number and exact subject search do not leak existence.
- `tickets.view_all` does not imply update, delete, requester-management, or assignment mutation permission.
- Requester changes require `tickets.manage_requester`.
- Assignment changes require `tickets.assign`.
- Ticket creation requires an explicit requester.
- Create-time assignment requires `tickets.assign`.
- Ticket, requester, and optional assignment creation remains atomic.
- Requester and assignment mutations are atomic and suppress no-op audit noise.
- List DTOs avoid unnecessary external requester contact PII.
- Requester, Department, and assignee selectors are server-side bounded; assignee selector keys include Workspace and Department.
- No queues, SLA, conversation, reply, notes, escalation, attachment UI, reporting, CSV, portal, email, WhatsApp, or notification behavior was introduced.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:integration` passes 103/103 API integration tests and 11/11 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests, including the Ticket requester/assignment journey.
- `pnpm build` passes.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean migration reset/deploy passes against isolated schema `phase_9_2_refinement_clean` with all 31 migrations applied.

Phase 9.2 is complete/pass. Do not start Phase 9.3 automatically.

### Phase 9.3 - Ticket Conversation + Internal Notes - COMPLETE / PASS

Implemented:

- One Ticket-scoped `TicketConversationEntry` model stores both `PUBLIC_REPLY` and `INTERNAL_NOTE` entries.
- Public replies and internal notes share one chronological stream ordered deterministically by `createdAt` plus `id`.
- Conversation history is immutable in Phase 9.3; no edit/delete conversation routes were introduced.
- Conversation entries are Workspace/Ticket fenced through same-Workspace relations and service validation.
- Authors are authenticated active same-Workspace `WorkspaceMembership` records at posting time.
- Historical inactive authors remain readable through safe author summaries.
- Public replies require `tickets.reply` in addition to current Ticket visibility.
- Internal note creation requires `tickets.notes.create`.
- Internal note visibility requires `tickets.notes.view`.
- Internal notes are filtered server-side before pagination and count metadata.
- Internal-note existence does not leak through pagination totals for actors without note-view permission.
- Ticket visibility remains the Phase 9.2 authority for conversation list and post operations.
- `tickets.view_all` expands Ticket visibility only and does not grant reply or note permissions.
- Creator, requester, Department, and assignee state do not bypass conversation RBAC.
- Message body is trimmed, bounded to 12,000 characters, stored as text, and rendered as plain text with preserved line breaks.
- Raw HTML is not executed; HTML-like strings remain text in the UI.
- Conversation text is excluded from `AuditLog` metadata.
- Posting conversation emits dedicated `ticket.public_reply_added` or `ticket.internal_note_added` audit events.
- Posting conversation does not auto-change Ticket status, auto-assign Ticket, change requester, or create SLA side effects.
- No email, SMS, WhatsApp, portal, notification, attachment, report, CSV, queue, escalation, or SLA behavior was introduced.
- Conversation retrieval is bounded and paginated.
- Author summaries are loaded with the entry query; no per-entry request fan-out was introduced.
- Ticket conversation query keys are Workspace + Ticket scoped.
- Conversation drafts are component-local and are not persisted to localStorage.
- Minimal Ticket detail conversation UI supports load-older behavior, public reply posting, internal note posting, permission-gated composer options, English/Tamil labels, and Light/Dark/Colorful theme inheritance.

Focused refinement:

- `TicketConversationEntry` remains the only Ticket conversation model.
- `PUBLIC_REPLY` and `INTERNAL_NOTE` share one immutable stream.
- Conversation entries cannot be edited or deleted through Phase 9.3 APIs.
- Workspace/Ticket/author tenant fencing remains enforced by DB relations plus service checks.
- Author must be an active same-Workspace membership at posting time.
- Historical inactive authors remain readable and show safe inactive state.
- `tickets.reply` controls Public Reply creation.
- `tickets.notes.create` controls Internal Note creation.
- `tickets.notes.view` controls Internal Note visibility.
- `tickets.view` and current Ticket visibility remain mandatory.
- `tickets.view_all` expands Ticket visibility only and does not grant conversation-action permissions.
- Requester, Department, and assignee visibility do not bypass conversation RBAC.
- Internal Notes are removed server-side before pagination and count.
- Hidden Internal Notes do not leak through totals or visible pagination metadata.
- Conversation ordering is deterministic by `createdAt` plus `id`.
- Conversation history retrieval is bounded and paginated.
- No per-entry author N+1 exists.
- Body is required, trimmed for validation, bounded, Unicode-preserving, and rendered safely as non-executable text.
- Body, requester PII, and raw DTOs are excluded from Audit metadata, logs, and query keys.
- Posting conversation does not change status, requester, Department, or assignee.
- Conversation posting has no SLA side effects.
- `PUBLIC_REPLY` does not imply external delivery.
- No attachment support was added.
- Query/cache keys remain Workspace + Ticket scoped.
- Draft content is not persisted in localStorage or sessionStorage.
- Defense-in-depth UI filtering prevents Internal Note rendering when `tickets.notes.view` is absent even if a bad mock/response includes a note row.
- Phase 7, Phase 8, Phase 9.1, and Phase 9.2 remain green.
- No Phase 9.4+ functionality was introduced.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:integration` passes 103/103 API integration tests and 11/11 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests, including the Ticket conversation journey.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean migration deploy passes on isolated scratch database `zea_play_phase93_refine_clean_*` with all 32 migrations applied.

Phase 9.3 is complete/pass. Do not start Phase 9.4 automatically.

### Phase 9.4 - SLA Policies + Timers - COMPLETE / PASS

Implemented:

- First Response and Resolution are separate SLA metrics on one Ticket SLA state record.
- Workspace-scoped SLA policies use `TicketSlaPolicy`, `TicketSlaRule`, `TicketSlaPauseStatus`, and `TicketSlaState`.
- At most one active default SLA policy can exist per Workspace.
- LOW, MEDIUM, HIGH, and URGENT priorities require explicit target minutes for both SLA metrics.
- SLA target values are validated and bounded.
- SLA calendars use validated IANA timezone identifiers.
- Business-hour calendars validate weekly open intervals and skip closed periods and configured holidays.
- DST behavior is covered for spring-forward and fall-back transitions.
- Pause statuses reference same-Workspace `StatusDefinition(TICKET)` IDs only; TASK, PROJECT, foreign, inactive, or terminal statuses are rejected.
- New Tickets snapshot the effective SLA policy immutably at creation when an active default policy exists.
- Editing a policy does not change existing Ticket SLA deadlines or target snapshots.
- Ticket priority changes do not silently rewrite the active SLA state.
- Historical Tickets without a default policy remain unconfigured rather than receiving synthetic deadlines.
- Ticket creation and SLA initialization are atomic inside the Ticket create transaction.
- Ticket creation still works when no default SLA policy exists.
- First Response starts from Ticket creation and completes on the first qualifying internal `PUBLIC_REPLY`.
- `INTERNAL_NOTE` never completes First Response.
- An INTERNAL requester self-reply does not complete First Response.
- First Response completion is one-shot.
- Resolution completes on the first transition into a terminal same-Workspace `StatusDefinition(TICKET)`.
- Resolution completion is one-shot and does not restart on reopen.
- Pause stores remaining business minutes and prevents breach while paused.
- Resume recalculates due dates from the stored remaining business minutes.
- Completion after due date records breach against the logical due time.
- Worker outage does not lose breach detection because breach scans compare persisted due dates.
- Breach timestamps represent the logical SLA due time, not worker runtime.
- The worker uses one bounded, idempotent recurring scanner and no one-delayed-job-per-Ticket design.
- SLA behavior does not create per-second backend writes.
- `tickets.sla.view` and `tickets.sla.manage` permissions are migration-backed and enforced by permission keys.
- SLA state due/breach/completion fields are server-owned; clients cannot set them directly.
- No SLA-triggered notification, escalation, status change, assignment change, queue feature, report, or CSV scope was introduced.
- Minimal Ticket UI shows SLA state and a bounded policy creation surface with English/Tamil labels and theme inheritance.

Focused refinement:

- One Workspace-scoped Ticket SLA policy architecture exists; no duplicate SLA policy model was introduced.
- Maximum one active default policy per Workspace is enforced by database uniqueness and serialized default flips.
- Inactive policies cannot remain effective defaults for new Ticket initialization.
- LOW/MEDIUM/HIGH/URGENT each have explicit First Response and Resolution targets.
- First Response and Resolution targets are positive bounded integers and remain independent service commitments.
- BUSINESS_HOURS with an empty work week is rejected; ALWAYS remains the explicit 24/7 mode.
- Weekly schedules validate start/end order, overlap, split shifts, adjacent windows, and unsupported overnight windows.
- Holidays are policy/snapshot scoped, timezone-local date strings, normalized unique, and harmless on non-working days.
- Business-time arithmetic uses policy IANA timezone and is interval-based rather than minute-loop based.
- Opening, closing, before-opening, after-closing, split-shift, holiday, and DST behavior is covered by unit tests.
- Mutable policy configuration never controls existing Ticket SLA commitments.
- Each Ticket SLA preserves immutable effective targets, calendar, holiday, timezone, and pause-status snapshots.
- Ticket priority changes do not rewrite current SLA targets or snapshot priority.
- Historical Tickets without SLA remain valid and unconfigured.
- New Ticket SLA initialization remains atomic when a default policy exists.
- Direct terminal Ticket creation marks First Response not applicable and completes Resolution without faking a reply.
- First Response starts at Ticket creation.
- First qualifying internal `PUBLIC_REPLY` completes First Response.
- `INTERNAL_NOTE` never completes First Response.
- Current INTERNAL requester self-reply does not complete First Response.
- First Response is one-shot and late completion records breach without waiting for the worker.
- First terminal Ticket status completes Resolution using `StatusDefinition.isTerminal`; status names/renames are irrelevant.
- Resolution remains completed after reopen and later terminal transitions do not overwrite the first completion.
- Pause/resume preserves remaining business time, paused metrics cannot breach, and breached metrics cannot be paused into mixed state.
- Pausing at or after the due boundary records breach against the logical due time.
- `breachedAt` records logical dueAt, not worker execution time.
- The SLA scanner is bounded, idempotent, outage-safe, and uses safe claim/update semantics.
- No per-Ticket delayed job architecture or per-second backend writes exist.
- SLA state is server-authoritative and cannot be directly client-mutated.
- `tickets.sla.view` and `tickets.sla.manage` use the permission engine with no role-name authorization.
- Policy listing is Workspace-scoped and bounded.
- Ticket list has no per-row SLA request fan-out.
- Minimal UI creates policies without silently destroying richer backend SLA calendars.
- No notifications, escalations, queues, saved views, reports, CSV, portal, email, WhatsApp, SMS, or automation were introduced.
- Phase 7, Phase 8, Phase 9.1, Phase 9.2, and Phase 9.3 remain green.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean migration deploy passes on isolated scratch database `zea_play_phase94_refine_clean_*` with all 33 migrations applied.

Phase 9.4 is complete/pass. Do not start Phase 9.5 automatically.

### Phase 9.5 - Queues + Ticket Views + Filters - COMPLETE / PASS

Implemented:

- Extended the existing Ticket list engine rather than creating a second Ticket search path.
- Built-in immutable queue IDs: `ALL_VISIBLE`, `MY_ASSIGNED`, `MY_REQUESTED`, `MY_DEPARTMENT`, `UNASSIGNED_MY_DEPARTMENT`, and `SLA_BREACHED`.
- Server-side queue summary endpoint returns all built-in queue counts in one bounded response.
- Extended Ticket filters for search, TICKET status, priority, requester type, internal requester, Department, assignee, assignment state, created/updated date ranges, SLA metric/state, and SLA due range.
- Ticket sorting remains whitelisted and deterministic.
- Pagination remains server-side and bounded.
- `TicketSavedView` stores Workspace-scoped validated filter/sort configuration only.
- PERSONAL saved views are owner-scoped to one `WorkspaceMembership`; WORKSPACE saved views are shared definitions.
- Saved-view JSON is versioned with `filterSchemaVersion = 1` and parsed through a strict allowlist before persistence.
- Saved-view create/update/delete permissions use `tickets.views.manage` and `tickets.views.manage_shared`.
- Ticket list state is URL-backed for queue/filter/sort/page/view deep links, with React Query keys including Workspace and normalized query state.
- Minimal queue/filter/saved-view UI was added to `/workspace/tickets` with English/Tamil labels, active filter chips, and accessible textual SLA/queue states.
- Workspace switching clears tenant-bound URL view/filter IDs while preserving safe built-in queue context.
- Shared saved-view edit/delete controls are hidden from users without `tickets.views.manage_shared`.

Final invariants:

- Queues are derived Ticket views, not Ticket copies.
- Built-in queues do not persist Ticket membership.
- Every queue/view applies current Ticket visibility before filtering/count/pagination.
- `tickets.view` remains mandatory.
- `tickets.view_all` remains Workspace bounded.
- Creator does not become queue/visibility authority.
- Built-in queues include All Visible, My Assigned, My Requested, My Department, Unassigned My Department, and SLA Breached.
- Queue counts are server aggregated and hidden Tickets never affect counts.
- Extended filters are server-side and composable.
- Foreign filter IDs cannot leak data.
- SLA filters use authoritative persisted `TicketSlaState`.
- Ticket sorting is whitelisted and deterministic.
- Pagination remains bounded/server-side.
- `TicketSavedView` stores validated filter/sort configuration only.
- Saved views never store authoritative Ticket IDs.
- Saved-view JSON is versioned/strictly validated.
- PERSONAL views are owner scoped.
- WORKSPACE views are shared without broadening Ticket visibility.
- Shared views created by privileged users remain safely filtered for scoped users.
- `tickets.views.manage` / `tickets.views.manage_shared` use the permission engine.
- No role-name authorization was introduced.
- Built-in queues are immutable.
- Saved-view mutations never silently happen from temporary filter edits.
- Queue/view/filter state is URL/deep-link compatible.
- Workspace switching clears tenant-bound filter/view IDs.
- Temporary filter clearing and filter chips do not silently mutate saved views and do not drop the selected built-in queue.
- Query keys include Workspace and normalized queue/view/filter state.
- No list/queue N+1 or frontend request fan-out exists for queue counts.
- No queue materialization worker or Redis dependency exists.
- No escalation, auto-assignment, notifications, reports, or CSV were introduced.
- Phase 7, Phase 8, and Phase 9.1-9.4 remain green.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean migration deploy passes on isolated scratch database `zea_play_phase95_refine_clean_*` with all 34 migrations applied and no pending migrations.

Phase 9.5 is complete/pass. Do not start Phase 9.6 automatically.

### Phase 9.6 — ESCALATION + ASSIGNMENT WORKFLOW — COMPLETE / PASS

Implemented:

- Added structural current Ticket escalation state with `TicketEscalationLevel` enum values `NONE`, `LEVEL_1`, `LEVEL_2`, and `LEVEL_3`.
- Added current escalation metadata on Ticket: changed timestamp, changed-by Workspace membership, and bounded latest reason.
- Added migration-backed `tickets.claim` and `tickets.escalate` permissions.
- Added self-claim endpoint for visible, unassigned Tickets with a Department.
- Hardened assignment updates with stale-write protection while preserving the Phase 9.2 assignment validator as the assignment authority.
- Added manual escalation endpoint using action + expectedLevel + bounded reason; server derives the next level.
- Added AuditLog events for successful claim and escalation changes.
- Added Ticket detail/list escalation display without per-row escalation requests.
- Added frontend claim action, assignment workflow continuity, and escalation/de-escalation/clear reason dialog.
- Extended the deterministic Ticket Playwright journey to cover claim and manual escalation actions.
- Hardened focused checklist coverage for claim stale writes, assigned-ticket takeover rejection, active Department membership requirement, and duplicate escalation stale rejection.

Final invariants:

- Phase 9.2 assignment model remains the single Ticket assignment authority.
- `tickets.assign` continues to control manual assignment/reassignment/unassignment/Department transfer.
- `tickets.claim` controls self-claim only.
- Claim requires visible unassigned Ticket with Department.
- Claimant must be active current member of Ticket Department.
- Claim never permits takeover of already-assigned Ticket.
- Claim is concurrency-safe and exactly one concurrent claimant wins; stale Department/assignment changes reject with conflict.
- Claim does not require `tickets.assign`.
- `tickets.claim` cannot assign another user.
- Assignment final Department/assignee pair remains transactionally validated.
- No automatic assignment algorithm exists.
- Escalation state is independent from Ticket status/priority/SLA/assignment.
- Escalation levels are `NONE`/`LEVEL_1`/`LEVEL_2`/`LEVEL_3`.
- `ESCALATE`/`DEESCALATE` move one level only.
- `CLEAR` may return any escalated Ticket directly to `NONE`.
- Every actual escalation change requires bounded reason.
- `tickets.escalate` controls escalation mutation.
- Client cannot directly set escalation target level.
- Escalation mutations require `expectedLevel` to prevent stale/double transitions.
- Concurrent duplicate escalation cannot accidentally advance two levels.
- Escalation history uses AuditLog, not a duplicate history table.
- Escalation Audit history retains bounded reasons.
- SLA breach does not automatically escalate.
- Status changes do not automatically escalate/clear escalation.
- Assignment changes do not automatically change escalation.
- Conversation changes do not automatically change escalation.
- No notification side effects exist.
- Derived Phase 9.5 queues remain derived; claim merely changes authoritative assignment.
- No queue membership storage is introduced.
- Current escalation level is available without per-row request fan-out.
- No role-name authorization exists.
- All claim/assignment/escalation operations remain Workspace fenced.
- No Phase 9.7+ functionality was introduced.
- Phase 7, Phase 8, and Phase 9.1-9.5 remain green.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 50 API unit tests, 117 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean migration deploy passes on isolated scratch database `zea_play_phase96_final_clean_*` with all 35 migrations applied, including `0035_phase9_6_escalation_assignment_workflow`, and no pending migrations.

Phase 9.6 is complete/pass. The next step is Phase 9.7 — Attachments + Activity, and it must not start automatically.

### Phase 9.7 — TICKET ATTACHMENTS + ACTIVITY — COMPLETE / PASS

Implemented:

- Added Ticket attachment link storage through `TicketAttachment` and conversation attachment link storage through `TicketConversationAttachment`.
- Reused the existing `Attachment`/`Asset`/MinIO/upload/presign/processing-job architecture; no duplicate Ticket file storage model was introduced.
- Added migration-backed `tickets.attachments.view`, `tickets.attachments.add`, `tickets.attachments.remove`, and `tickets.activity.view` permissions.
- Added Ticket attachment list, upload-init, upload-complete, URL attach, reuse/link, download, and unlink endpoints.
- Added conversation `attachmentIds` support with max-10 validated same-Workspace attachments and atomic entry/link creation.
- Added conversation attachment download authorization through the containing visible Ticket and visible conversation entry.
- Added Ticket activity API backed by `AuditLog`, with note/attachment activity filtered by capability before count and pagination.
- Added safe activity metadata serialization; storage keys, external requester PII, internal note body, and escalation reasons are not surfaced.
- Added Ticket detail UI for attachments, conversation attachment selection/rendering, and lazy activity loading.
- Added focused service tests for attachment listing without presign fan-out, activity privacy filtering before pagination, workspace-scoped actor membership filters, activity action allowlisting, and safe URL attachment audit metadata.
- Focused refinement changed Ticket Activity actor filtering to `actorMembershipId` with same-Workspace validation.
- Focused refinement keeps default URL attachment display labels free of remote query/hash data while preserving the actual URL attachment target.
- Focused refinement added accessible labels to attachment open/download/remove controls and uses `noopener,noreferrer` for URL opens.
- Stabilized a date-sensitive Project reports integration fixture by moving report due dates out of the current date window.

Final invariants:

- Existing `Attachment`/`Asset`/MinIO remains the Ticket physical-storage authority.
- No `TicketFile`, `TicketAsset`, `TicketDocument`, `TicketUpload`, `TicketActivity`, `TicketHistory`, `TicketActivityLog`, or `TicketEvent` model exists.
- Ticket attachments are relation links to existing attachments, not a second storage model.
- `TicketAttachment` is the Ticket-level relation; `TicketConversationAttachment` is the immutable conversation relation.
- Workspace fencing applies to Ticket and conversation attachment relations through composite workspace foreign keys.
- FILE/URL Attachment invariants remain unchanged.
- Ticket-level removal unlinks only; it does not physically delete assets or decrement quota.
- Physical storage quota changes only for new Asset creation; link/reuse/unlink do not alter physical quota.
- Conversation attachments are immutable after post.
- Conversation entry, attachment links, and success audit commit atomically.
- File downloads produce presigned URLs only from explicit download endpoints.
- Presigned URLs are never returned in list DTOs, audit metadata, logs, or persisted frontend state.
- Ticket and conversation attachment download authorization is scoped by current Ticket visibility and attachment permissions.
- Attachment ID alone never authorizes download.
- URL attachments accept only `http`/`https`.
- File attachment reuse requires same Workspace and ready file assets.
- Internal note activity is hidden without `tickets.notes.view`.
- Internal Note attachments require `tickets.notes.view` through conversation visibility to read or download.
- Attachment activity is hidden without `tickets.attachments.view`.
- Hidden note/attachment events are removed before Activity count, pagination, and `hasMore` semantics.
- Activity is `AuditLog`-backed; no `TicketActivity` table exists.
- `tickets.activity.view` independently gates Activity and Ticket visibility remains mandatory.
- Activity DTO metadata is per-event allowlisted and excludes conversation bodies, requester PII, secrets, storage keys, presigned URLs, and raw audit metadata.
- Attachments and Activity remain bounded/lazy with Workspace/Ticket-scoped query keys and no Asset/actor/conversation-attachment request fan-out.
- Permission checks remain permission-key based; no role-name authorization exists.
- No notification side effects were added.
- No reports, CSV, notifications, automation, cloud-drive, malware-scanner, or Phase 9.8 functionality was introduced.
- Phase 7, Phase 8, and Phase 9.1-9.6 remain green.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 54 API unit tests, 117 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean migration deploy passes on isolated scratch database `zea_play_phase97_refine_clean_*` with all 36 migrations applied, including `0036_phase9_7_ticket_attachments_activity`, and no pending migrations.

Phase 9.7 is complete/pass. The next step is Phase 9.8 — SERVICE DESK REPORTS + CSV, and it must not start automatically.

### Phase 9.8 — SERVICE DESK REPORTS + CSV — COMPLETE / PASS

Implemented:

- Added migration-backed `tickets.reports.view` and `tickets.reports.export` permissions with intended Workspace system-role grants only.
- Added Workspace Ticket report summary API and CSV export API under `/workspaces/:workspaceId/tickets/reports`.
- Reused the Phase 9.5 `ticketWhere()` path for report and CSV population, including current visibility, queue predicates, server filters, search, date filters, SLA filters, and foreign-ID validation.
- Added current-state KPIs for total, open, terminal, unassigned, escalated, SLA breached, and SLA not configured Tickets.
- Added server-derived status, priority, requester-type, escalation, Department, and assignee breakdowns.
- Added Ticket creation trend from `Ticket.createdAt` and first terminal-resolution trend from reliable `ticket.status_changed` AuditLog evidence.
- Added First Response and Resolution SLA summaries using `TicketSlaState`, with compliance based only on MET and BREACHED outcomes.
- Added CSV export for authorized filtered Ticket rows with formula-injection protection, UTF-8 BOM, safe quoting, explicit 10,000-row cap, and conservative field selection.
- Added minimal `/workspace/tickets/reports` UI with KPI cards, textual breakdowns, trend lists, SLA summaries, filters, and Export CSV.
- Added English/Tamil report labels and Workspace navigation entry.
- Added focused API tests for report authorization and CSV safety.

Final invariants:

- Service Desk Reports are server-derived and do not duplicate Ticket data.
- No report snapshot/cache/materialization table or report worker was introduced.
- One authorized filtered Ticket population drives report metrics and CSV export.
- Phase 9.2 Ticket visibility remains mandatory before aggregation.
- `tickets.view` remains required.
- `tickets.reports.view` independently gates reports.
- `tickets.reports.export` independently gates CSV export.
- `tickets.view_all` remains Workspace bounded.
- Queues never broaden report visibility.
- Current Ticket KPIs use current Ticket state.
- Terminal semantics use `StatusDefinition(TICKET).isTerminal`, never status names.
- Status, priority, Department, assignee, requester-type, and escalation breakdowns are server aggregated.
- Creation trend uses `Ticket.createdAt`.
- Resolution trend is truthfully labelled as first terminal resolution and uses reliable terminal AuditLog evidence.
- Resolution trend determines the first terminal transition per Ticket before applying the report date window, so reopen/re-resolve activity cannot double-count first resolution.
- Ticket SLA reporting uses authoritative `TicketSlaState`, not mutable current SLA policy.
- First Response and Resolution SLA summaries remain independent.
- SLA compliance excludes running, paused, not applicable, and not configured metrics from the completed denominator.
- A metric completed after breach remains BREACHED.
- Report filters remain server-side and tenant-safe.
- Foreign filter IDs cannot leak data.
- Reports UI uses bounded server aggregates, not browser full-data calculations.
- CSV uses exact active Report filters and current authorization.
- CSV is not current-page-only.
- CSV protects against spreadsheet formula injection.
- CSV preserves UTF-8/Tamil and correct quoting.
- CSV excludes requester contact PII, conversations, attachments, presigned URLs, raw Audit metadata, and escalation reason.
- Export caps/errors are explicit and never silently truncate.
- Report query keys are Workspace/filter scoped.
- Ticket list/detail do not preload Reports.
- No per-Ticket SLA/Audit/assignee frontend request fan-out exists.
- No scheduled, PDF, email, notification, AI, or Phase 9.9+ report scope was introduced.
- No role-name authorization exists.
- Phase 7, Phase 8, and Phase 9.1-9.7 remain green.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 57 API unit tests, 117 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean migration deploy passes on isolated scratch database `zea_play_phase98_final_clean_*` with all 37 migrations applied, including `0037_phase9_8_ticket_reports_csv_permissions`, and no pending migrations.

Phase 9.8 is complete/pass. The next step is Phase 9.9 — Ticket UI Integration, and it must not start automatically.

### Phase 9.9 — TICKET UI INTEGRATION — COMPLETE / PASS

Implemented:

- Kept `/workspace/tickets` as the canonical Workspace Ticket list route.
- Kept `/workspace/tickets/:ticketId` as the canonical Ticket detail route.
- Kept `/workspace/tickets/reports` as the canonical Workspace Service Desk Reports route.
- Preserved one Workspace Ticket list implementation and one Ticket detail shell.
- Integrated Ticket list navigation with built-in queues, queue summary counts, Saved Views, server filters, active filter chips, sort, pagination, and URL state.
- Added a permission-gated Ticket Reports action from the Ticket list without preloading reports.
- Expanded the desktop Ticket list to show implemented Ticket fields: Ticket Number, Subject, Requester, Department, Assigned To, Status, Priority, Escalation, and Updated.
- Converted Ticket detail into a single URL-backed tab shell with Overview, Conversation, Attachments, and Activity.
- Kept SLA in Overview and removed the individual Ticket detail SLA policy editor surface.
- Made Conversation, Attachments, and Activity independently lazy by active detail tab.
- Updated Ticket tests and e2e flow to use the modern tabbed detail contract.
- Added English/Tamil labels for Ticket detail tab navigation.

Focused refinement:

- Verified canonical Ticket routes and found no legacy competing Ticket route hits for `/dashboard/tickets`, `/support/tickets`, `/service-desk`, `/service-desk-v2`, or `/ticket-v2`.
- Kept one Workspace Ticket list implementation and one modern Ticket detail shell.
- Tightened detail tabs with explicit `tab`/`tabpanel` relationships while preserving URL-backed deep links and invalid-tab fallback.
- Kept inactive detail panels unmounted and gated the SLA card request to the active Overview tab.
- Preserved Conversation, Attachments, and Activity lazy loading by active tab.
- Clarified built-in queue and escalation display labels without changing machine IDs or backend enums.
- Replaced unknown activity action display fallback with safe localized Ticket activity text instead of exposing raw AuditLog action keys.
- Updated focused React/Vitest and Playwright assertions for tab lazy loading and the Not Escalated label.

Final invariants:

- `/workspace/tickets` is the canonical Workspace Ticket route.
- `/workspace/tickets/:ticketId` is the canonical Ticket detail route.
- `/workspace/tickets/reports` is the canonical Service Desk Reports route.
- One Ticket list implementation exists.
- One Ticket detail shell exists.
- Ticket list integrates queues, Saved Views, filters, sort, pagination, active chips, and URL state.
- Built-in queues remain server-derived and immutable.
- Saved Views remain explicit configuration and never broaden Ticket visibility.
- Ticket create integrates explicit requester and optional permission-gated assignment.
- Creator does not receive implicit visibility.
- Overview integrates requester, Department, assignment, claim, escalation, and SLA using existing services.
- Claim, assign, requester, escalation, SLA, notes, attachments, activity, reports, and CSV permissions remain independent frontend gates while backend remains authoritative.
- Escalation submits action, reason, and current `expectedLevel`; no target-level mutation was introduced.
- SLA remains server-authoritative and policy management is not embedded into Ticket detail.
- Conversation reuses the Phase 9.3 chronological stream.
- Internal Notes remain capability-protected.
- Attachments reuse the Phase 9.7 Attachment architecture.
- Conversation attachments remain immutable after post.
- Activity remains AuditLog-backed and privacy-filtered.
- Reports remain Workspace-level and server-aggregated.
- CSV remains server-authorized/export-safe.
- Detail tab state is deep-link/refresh compatible through `tab` URL state.
- Conversation, Attachments, and Activity remain independently lazy.
- Overview does not preload Conversation, Attachments, Activity, or Reports.
- SLA data is requested only for the active Overview tab and only when `tickets.sla.view` is present.
- Reports are not preloaded from Ticket list/detail.
- Clear Filters preserves the active built-in queue.
- Saved View temporary edits never silently persist.
- No sensitive Ticket PII/body/presigned URL is persisted in URL/query keys/localStorage.
- Workspace/Ticket switching clears tenant-bound transient dialogs/forms.
- Ticket access loss clears sensitive detail state and navigates safely.
- Permission loss removes capability-specific sensitive UI.
- Query keys remain Workspace/Ticket/filter scoped.
- Mutation invalidation remains targeted to Ticket detail/list/queue/activity surfaces.
- No role-name authorization exists.
- No client-side business authority was introduced.
- Ticket list/detail have no demonstrated per-row/heavy-tab request fan-out.
- Responsive/accessibility/English-Tamil/Light-Dark-Colorful coverage remains in the existing Ticket and shell tests.
- No Phase 9.10/future features were introduced.
- Phase 7, Phase 8, and Phase 9.1-9.8 remain green.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 57 API unit tests, 117 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- No migration was introduced for Phase 9.9, so no clean migration deploy was required.

Phase 9.9 is complete/pass. The next step is Phase 9.10 — Final Ticket Security + Performance Audit, and it must not start automatically.

### Phase 9.10 — FINAL TICKET SECURITY + PERFORMANCE AUDIT — COMPLETE / PASS

Final audit:

- Audited the Phase 9 Ticket / Service Desk module across tenant isolation, Ticket numbering, StatusDefinition(TICKET), requester, Department, assignment, claim, visibility, conversation, Internal Notes, SLA, queues, Saved Views, escalation, attachments, Activity, Reports, CSV, frontend routing/state, query/cache isolation, AuditLog, concurrency, database constraints, migrations, worker safety, performance, responsive/accessibility, English/Tamil, Light/Dark/Colorful, and Phase 7/8 regression.
- Static audit found no duplicate Ticket business model, Ticket V2 route, Ticket queue membership storage, client-side Ticket numbering authority, status-name lifecycle authority, or Phase 10 scope.
- Clean migration deploy passed on isolated scratch database `zea_play_phase910_final_clean_20260921021222` with all 37 migrations applied, including Phase 9 migrations `0030` through `0037`, and `prisma migrate status` reported the schema up to date.
- No product functionality change was required for Phase 9.10.

Final Phase 9 invariants:

- One Workspace-scoped Ticket model exists; Ticket UUID remains primary identity.
- Workspace-scoped `TKT-000001` numbering is PostgreSQL-backed through `WorkspaceTicketCounter` and remains concurrency safe.
- `StatusDefinition(TICKET)` remains the sole lifecycle engine; terminal behavior never depends on status names.
- Ticket deletion remains soft delete.
- Creator remains provenance only and never grants visibility.
- Requester is INTERNAL or EXTERNAL and remains independent from creator.
- Ticket Department reuses shared Department.
- Assignment uses `WorkspaceMembership` and current Department validity.
- `tickets.view` remains mandatory; `tickets.view_all` remains Workspace bounded.
- Scoped Ticket visibility is current requester, Department, or valid assignment.
- Visibility is enforced before search, count, filter, pagination, queues, reports, and CSV.
- Hidden Tickets cannot leak through exact search, counts, queue totals, reports, or CSV.
- Custom-role RBAC remains authoritative and no role-name authorization exists.
- Claim remains self-claim only and concurrency safe.
- Manual assignment remains Phase 9.2 authority.
- Ticket conversation remains one immutable `PUBLIC_REPLY` / `INTERNAL_NOTE` stream.
- Internal Note visibility is filtered before pagination and count.
- Conversation body never leaks into Audit metadata.
- SLA uses immutable policy snapshots and business-time/IANA timezone arithmetic.
- SLA First Response and Resolution remain independent one-shot metrics.
- SLA pause behavior references `StatusDefinition(TICKET)` IDs.
- SLA worker is bounded, idempotent, and outage safe.
- SLA breach never auto-escalates, auto-assigns, or notifies.
- Queues remain derived Ticket views with no queue membership storage.
- Saved Views store validated filter/sort configuration only and never transfer creator privileges.
- Escalation remains structurally independent from status, priority, SLA, and assignment.
- `expectedLevel` prevents stale/double escalation; escalation history uses `AuditLog`.
- Attachment/Asset remains physical storage authority.
- `TicketAttachment` and `TicketConversationAttachment` are relation models only; unlink never physically deletes shared Asset.
- Internal Note attachments inherit note privacy.
- Presigned download URLs are on-demand and never persisted/logged.
- Ticket Activity uses `AuditLog` only; privacy filters hidden note/file events before count/pagination and returns allowlisted safe metadata only.
- Reports are server aggregated from one authorized filtered Ticket population.
- Resolution trend uses first reliable terminal Audit event before date-window filtering.
- SLA reporting uses `TicketSlaState` authority.
- CSV uses exact active filters/current authorization, is not page-only, protects against formula injection, and omits requester contact PII, conversation, attachment secrets, and raw Audit data.
- `/workspace/tickets`, `/workspace/tickets/:ticketId`, and `/workspace/tickets/reports` are the canonical Ticket routes.
- One Ticket list and one Ticket detail shell exist.
- Overview, Conversation, Attachments, and Activity integrate Phase 9 systems; heavy detail surfaces lazy-load independently.
- SLA loads only where intended; reports never preload from Ticket list/detail.
- Workspace/Ticket switching clears tenant-bound transient state.
- Access/capability loss clears sensitive cached UI.
- Ticket query keys remain Workspace/Ticket/source/filter scoped.
- Normal mutations use targeted cache invalidation.
- No demonstrated Ticket list/detail/report N+1 or request fan-out remains.
- No unnecessary Redis/worker/materialization architecture was introduced.
- Complete Service Desk UI is responsive/accessibility safe.
- English/Tamil cover Service Desk UI.
- Light/Dark/Colorful cover Service Desk UI.
- Clean migration chain passes.
- Phase 7 and Phase 8 remain green.
- No Phase 10+ functionality was introduced.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 57 API unit tests, 117 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 20/20 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase910_final_clean_20260921021222`; no pending migrations remain.

### Phase 9 — TICKET / SERVICE DESK SYSTEM — COMPLETE / PASS

Phase 9 is complete/pass across Ticket Core + Status Engine, Requester + Department + Assignment, Conversation + Internal Notes, SLA Policies + Timers, Queues + Ticket Views + Filters, Escalation + Assignment Workflow, Ticket Attachments + Activity, Service Desk Reports + CSV, Ticket UI Integration, and the final Ticket security/performance/integration audit.

The next phase is Phase 10 — Gamification, XP, Rewards & Leaderboards, and it must not start automatically.

### Phase 10.1 — GAMIFICATION CORE + XP LEDGER Implementation — PASS

Implemented:

- Added a Workspace-scoped immutable `GamificationXpEntry` ledger.
- XP targets and actors use `WorkspaceMembership` identity, not `User` alone.
- XP entries are bounded, nonzero signed integer deltas with server-side entry/source/event validation.
- XP entry types are `EARN`, `DEDUCT`, `REVERSAL`, and `ADJUSTMENT`.
- XP source types are `TASK`, `PROJECT`, `TICKET`, `STREAK`, `ACHIEVEMENT`, `MANUAL`, and `SYSTEM` for future central-service integrations only.
- Current XP is derived by summing ledger entries; no stored mutable balance exists.
- Lifetime earned and deducted totals are server aggregates.
- Idempotency is enforced with a Workspace/member/idempotency-key unique constraint and same-semantics replay.
- Negative XP is allowed only when the resulting aggregate balance remains at or above zero.
- Reversal infrastructure creates a bounded compensating `REVERSAL` entry and prevents reversal chains or duplicate reversal of the same entry.
- New XP entries require an active target Workspace membership.
- Actor membership, when supplied, must belong to the same Workspace.
- Public APIs are read-only: `GET /workspaces/:workspaceId/gamification/me/xp` and `GET /workspaces/:workspaceId/gamification/me/xp/history`.
- No public XP write API was introduced.
- `gamification.view` is the only Phase 10.1 runtime permission and is enforced independently through RBAC.
- Minimal `/workspace/gamification` UI was added with Overview and History tabs only.
- The UI uses server summary/history APIs, Workspace-scoped query keys, English/Tamil copy, and Light/Dark/Colorful theme inheritance.

Final Phase 10.1 invariants:

- `GamificationXpEntry` is append-only by service contract; XP balance is never updated in place.
- Database constraints enforce nonzero amount, amount bounds, entry/source enums, nonblank bounded text, idempotency uniqueness, one reversal per original entry, same-Workspace target membership, and same-Workspace actor membership.
- Central `GamificationService` is the only XP write surface for future modules.
- Idempotency keys cannot silently apply a different amount, entry type, source type, source event, source entity, or reversal target.
- Balance floor checks occur inside the write transaction after locking the target membership row.
- Summary and history endpoints are self-scoped to the authenticated Workspace membership.
- History pagination is server-side with deterministic `createdAt desc, id desc` ordering.
- XP reason/idempotency internals are not placed into frontend URL state or local storage.
- No levels, reward points, badges, achievements, streak tracking, leaderboards, manual admin adjust/reset UI, XP rule configuration UI, pressure score integration, task/project/ticket automatic XP award, worker, Redis, or Phase 10.2 scope was introduced.

Verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 64 API unit tests, 119 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase101_clean_20260921025854` with all 38 migrations applied, including `0038_phase10_1_gamification_xp_ledger`; no pending migrations remain.

Phase 10.1 implementation is pass. The next step is Phase 10.1 Focused Refinement, and it must not start automatically.

Focused checklist refinement:

- Added database-level `UPDATE` and `DELETE` prevention triggers for `gamification_xp_entries`, preserving append-only ledger immutability beyond the service contract.
- Added focused unit coverage proving the same user can hold independent XP through different Workspace memberships.
- Added focused unit coverage proving inactive historical memberships can still read XP summary/history while new XP writes are rejected.
- Reconfirmed no public arbitrary-XP write API exists.
- Reconfirmed no direct Task/Project/Ticket XP row insertion path exists.
- Reconfirmed no levels, reward points, streak computation, badges, achievements, leaderboards, pressure score integration, automatic business XP awards, Redis XP authority, XP worker, or Phase 10.2+ scope was introduced.

Focused verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 66 API unit tests, 119 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase101_focused_clean_20260921030450` with all 39 migrations applied, including `0038_phase10_1_gamification_xp_ledger` and `0039_phase10_1_xp_ledger_immutability`; no pending migrations remain.
- Scratch database trigger audit confirms `gamification_xp_entries_prevent_update` and `gamification_xp_entries_prevent_delete` are installed.

Phase 10.1 focused checklist is pass. The next step is Phase 10.1 Final Completion Verification, and it must not start automatically.

Final completion verification:

- XP belongs to `WorkspaceMembership`, never global `User`.
- The same user can have independent XP across Workspaces through separate Workspace memberships.
- Immutable `GamificationXpEntry` ledger is the XP source of truth.
- XP ledger immutability is enforced in application code and by database triggers from `0039_phase10_1_xp_ledger_immutability`.
- No mutable `user.xp`, `membership.xp`, or `xpBalance` field is authoritative.
- Current XP is server-derived from committed signed ledger entries.
- XP balance cannot fall below zero.
- Concurrent deductions preserve the zero floor through transaction-scoped membership locking and aggregate floor checks.
- Positive concurrent awards remain valid.
- Mixed earn/deduct races commit only valid non-negative final balances.
- One central Gamification XP service owns XP writes.
- Task, Project, and Ticket modules do not directly insert XP entries.
- No arbitrary public XP-write API exists.
- System XP writes are idempotent.
- Duplicate concurrent events produce one XP effect through database-backed idempotency uniqueness.
- Conflicting idempotency payloads are rejected.
- Exact reversal infrastructure exists.
- One original entry may be reversed at most once.
- Reversals remain subject to the XP floor and reversal chains are rejected.
- XP history is append-only and cannot be mutated or deleted.
- Same-Workspace target and actor membership fences remain enforced.
- Inactive memberships retain history but cannot receive new XP.
- `gamification.view` independently gates own Workspace XP summary/history.
- Normal users cannot inspect arbitrary membership XP.
- XP summary is server aggregated.
- XP history is bounded, server-paginated, and stably ordered by `createdAt DESC`, `id DESC`.
- History does not hydrate Task, Project, or Ticket details per row.
- `/workspace/gamification` remains the single Gamification route.
- Only Overview and History exist in Phase 10.1.
- Gamification navigation and page access are permission-key gated by `gamification.view`, with no role-name UI authorization.
- No Level, Badge, Achievement, Streak, Reward, or Leaderboard implementation exists.
- Pressure Score remains separate from Gamification XP.
- No automatic business XP awards or XP values exist yet.
- No Redis XP authority or XP worker exists.
- No role-name authorization exists.
- Phase 7, Phase 8, and Phase 9 remain green.

Final verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 66 API unit tests, 120 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase101_final_clean_20260921032317` with all 39 migrations applied, including `0038_phase10_1_gamification_xp_ledger` and `0039_phase10_1_xp_ledger_immutability`; no pending migrations remain.
- Scratch database trigger audit confirms `gamification_xp_entries_prevent_update` and `gamification_xp_entries_prevent_delete` are installed.

Phase 10.1 is complete/pass. The next step is Phase 10.2 — Levels + Progression, and it must not start automatically.

### Phase 10.2 — LEVELS + PROGRESSION Implementation — PASS

Implemented:

- Added Workspace-scoped `GamificationLevel` configuration with name, normalized name, description, level number, XP threshold, active flag, timestamps, tenant FK, uniqueness, indexes, and bounded database checks.
- Added migration `0040_phase10_2_gamification_levels`, including `gamification.levels.manage` permission and system-role grants for OWNER, ADMIN, and MANAGER.
- Extended `GamificationService.getMyXpSummary` to derive current level, next level, XP into current level, XP to next level, progress percent, max-level state, and no-config state from current ledger XP plus active Workspace thresholds.
- Added Workspace-scoped level list/create/update endpoints under `/workspaces/:workspaceId/gamification/levels`.
- Added `/workspace/gamification` Levels tab while keeping the single Gamification route with Overview, Levels, and History only.
- Added viewer active-path display and manager create/archive/reactivate controls behind `gamification.levels.manage`.
- Added English and Tamil labels for level/progression UI.

Phase 10.2 invariants established:

- XP ledger remains the only source of XP truth.
- No member/user current level is persisted.
- Levels belong to Workspace configuration, not global users.
- No default levels are inserted automatically.
- No configured active levels returns `levelsConfigured=false` and null current/next/progress fields.
- Active levels are ordered by `levelNumber`; gaps are allowed.
- Active thresholds must be strictly increasing by active `levelNumber`.
- A valid active progression requires a zero-threshold base.
- Inactive levels are retained but excluded from viewer lists and progression derivation.
- Current and next level are server-derived from current WorkspaceMembership XP.
- Max-level state returns 100 percent progress and null XP-to-next.
- `gamification.view` gates own progression and active definitions.
- `gamification.levels.manage` independently gates configuration mutation and inactive visibility.
- No role-name authorization exists.
- Workspace locks serialize level configuration validation.
- Level config changes are recorded through `AuditLog` with bounded metadata and no per-member audit fanout.
- Query keys include Workspace and inactive/manage state; Workspace switching resets active tab/page state.
- No rewards, reward points, badges, achievements, streaks, leaderboards, manual XP, XP reset, notification, Redis authority, level worker, or Phase 10.3 scope was introduced.

Final verification:

- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- Focused API gamification tests pass 14/14.
- `pnpm test` passes 71 API unit tests, 121 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase102_clean_20260921035014` with all 40 migrations applied, including `0040_phase10_2_gamification_levels`; no pending migrations remain.

Phase 10.2 implementation is pass. The next step is Phase 10.2 Focused Refinement, and it must not start automatically.

### Phase 10.2 — LEVELS + PROGRESSION Focused Checklist — PASS

Focused refinements:

- Added focused coverage for exact-threshold level selection.
- Added focused coverage for deduction-driven level-down derivation from ledger XP.
- Added focused coverage that archiving a level does not modify XP entries.
- Added focused coverage that cross-Workspace level mutation fails.

Focused checklist reconfirmed:

- Level definitions remain Workspace scoped with configurable XP thresholds.
- No hardcoded level formula, mutable member/user current level, or per-member progression table exists.
- Current level, next level, XP-to-next, progress percent, max-level state, and unconfigured state come from the backend.
- Same user can derive different levels across Workspaces through separate WorkspaceMembership XP totals.
- Active thresholds remain strictly increasing, deterministic, and require a 0-XP base.
- Archived levels stop participating in progression and do not change XP.
- Level configuration operations remain atomic and serialized by Workspace lock.
- `gamification.levels.manage` remains migration-backed and independent from `gamification.view`.
- `/workspace/gamification` remains the only route with Overview, Levels, and History tabs only.
- No reward points, streaks, badges, achievements, leaderboards, pressure-score integration, automatic XP awards, Redis level authority, level worker, or Phase 10.3+ scope was introduced.

Focused verification:

- Focused API gamification tests pass 16/16.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 73 API unit tests, 121 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase102_focused_clean_20260921035833` with all 40 migrations applied, including `0040_phase10_2_gamification_levels`; no pending migrations remain.

Phase 10.2 focused checklist is pass. The next step is Phase 10.2 Final Completion Verification, and it must not start automatically.

### Phase 10.2 — LEVELS + PROGRESSION — COMPLETE / PASS

Final invariants:

- Gamification Levels are Workspace scoped.
- Current Level is always derived from the Phase 10.1 XP ledger total plus active Workspace Level definitions.
- No User or WorkspaceMembership current-level field is authoritative.
- No per-member Level row exists.
- Level thresholds are explicit configurable values, not a hardcoded formula.
- Active Level thresholds remain strictly increasing.
- Level order is deterministic.
- Valid progression has a zero-XP active base Level.
- Exact XP threshold resolves to that Level.
- XP between thresholds resolves to the highest active threshold below or equal to XP.
- XP deduction can derive a lower current Level.
- Level config changes never mutate XP.
- Archived Levels stop participating in progression.
- Level archival does not update every Workspace membership.
- No Levels configured returns an explicit unconfigured state.
- Current Level, next Level, progress, and XP-to-next are calculated server-side.
- Max-Level behavior is explicit.
- Level config mutations are atomic and concurrency safe.
- Cross-Workspace Level mutation is impossible.
- `gamification.view` remains the progression-read permission.
- `gamification.levels.manage` independently controls Level configuration.
- No role-name authorization exists.
- No member-level recalculation worker exists.
- No Redis Level authority exists.
- `/workspace/gamification` remains the one Gamification route.
- Implemented tabs are Overview, Levels, and History.
- Normal users see the active progression path.
- Management controls remain permission-gated in the Levels tab.
- No Badge, Achievement, Streak, Reward, or Leaderboard implementation exists.
- Pressure Score remains separate.
- No automatic Task, Project, or Ticket XP awards exist.
- Phase 7, Phase 8, Phase 9, and Phase 10.1 remain green.

Final verification:

- Focused API gamification tests pass 16/16.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 73 API unit tests, 121 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase102_focused_clean_20260921035833` with all 40 migrations applied, including `0040_phase10_2_gamification_levels`; no pending migrations remain.
- Security search found no authoritative member/user current-level state, no per-member Level table, no hardcoded Level formula, no Level worker, no Redis Level authority, no automatic business XP award path, and no Badge/Achievement/Streak/Reward/Leaderboard implementation.

Phase 10.2 is complete/pass. The next step is Phase 10.3 — Badges + Achievements, and it must not start automatically.

### Phase 10.3 — BADGES + ACHIEVEMENTS Implementation — PASS

Implemented:

- Added separate Workspace-scoped `GamificationBadgeDefinition` and `GamificationAchievementDefinition` models.
- Added strict `GamificationAchievementCriterionType` values for `XP_TOTAL_AT_LEAST`, `TASK_COMPLETED_COUNT`, `PROJECT_COMPLETED_COUNT`, and `TICKET_RESOLVED_COUNT`.
- Added immutable one-time `GamificationAchievementAward` and `GamificationBadgeAward` models tied to `WorkspaceMembership`, not global User.
- Added migration `0041_phase10_3_badges_achievements`, including award immutability triggers, Workspace fences, uniqueness, bounded values, and `gamification.achievements.manage` permission grants for OWNER, ADMIN, and MANAGER.
- Added Badge and Achievement definition APIs under the existing Workspace Gamification route.
- Added own Badge/Achievement read surfaces and server-derived Achievement progress.
- Added central Gamification achievement evaluation service methods for XP, Task completion, Project completion, and Ticket resolution events.
- Wired Task, Project, and Ticket modules to request central evaluation after committed terminal events; those modules do not insert awards directly.
- Ticket terminal status-change audit metadata now records assigned agent evidence for forward-safe first-resolution credit.
- Achievement XP rewards use the Phase 10.1 central XP service with stable idempotency.
- `/workspace/gamification` remains the single Gamification route and now has Overview, Levels, Badges, Achievements, and History tabs.
- Added English and Tamil labels for Badge and Achievement surfaces.

Phase 10.3 implementation invariants established:

- Badge definitions and Achievement definitions are separate Workspace-scoped concepts.
- `AchievementDefinition` owns typed qualification criteria.
- `BadgeDefinition` has no qualification logic.
- Supported criteria are `XP_TOTAL_AT_LEAST`, `TASK_COMPLETED_COUNT`, `PROJECT_COMPLETED_COUNT`, and `TICKET_RESOLVED_COUNT` only.
- No arbitrary code, expression, SQL, webhook, or rule-builder criteria exists.
- `AchievementAward` is immutable and one-time per WorkspaceMembership plus Achievement.
- `BadgeAward` is immutable and one-time per WorkspaceMembership plus Badge.
- Awards belong to WorkspaceMembership, not global User.
- Achievement evaluation goes through one central Gamification achievement service.
- Task, Project, and Ticket modules never insert awards directly.
- Automatic historical mass backfill does not occur.
- Existing qualifiers earn only on a future relevant event in Phase 10.3.
- Achievement may optionally grant one Badge.
- Achievement may optionally grant positive XP.
- Achievement XP reward uses Phase 10.1 central XP service and idempotency.
- Achievement XP reward cannot duplicate on repeated evaluation.
- Chained XP achievements are bounded/idempotent and cannot recurse infinitely.
- No Reward Points are awarded.
- Task completion count uses distinct qualifying completed Tasks.
- Task recompletion does not double count distinct completed Task progress.
- Project completion credit uses Project owner semantic only.
- Ticket resolution uses distinct first reliable resolution credit from terminal AuditLog evidence with assignment metadata.
- Ticket reresolution does not double count distinct Ticket progress.
- `XP_TOTAL_AT_LEAST` criteria use authoritative XP ledger total.
- Earned Achievements/Badges remain after XP drops or source entity reopens.
- Archived definitions prevent new awards but retain historical awards.
- Historical AchievementAward stores immutable criterion/name/reward snapshot data.
- Normal users can view only their own award/progress context.
- `gamification.achievements.manage` independently gates Badge/Achievement definition management.
- No role-name authorization exists.
- `/workspace/gamification` remains the only Gamification route.
- Tabs are Overview, Levels, Badges, Achievements, and History only.
- No Streak, Reward, Reward Point, or Leaderboard implementation exists.
- No manual award, reset, or backfill UI exists.
- No Achievement worker or Redis authority exists.
- No notification side effects exist.
- Phase 7, Phase 8, Phase 9, Phase 10.1, and Phase 10.2 remain green.

Verification:

- Focused API gamification service tests pass 16/16.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 73 API unit tests, 121 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase103_clean_20260921044435` with all 41 migrations applied, including `0041_phase10_3_badges_achievements`; no pending migrations remain.

Phase 10.3 implementation is pass. The next step is Phase 10.3 Focused Refinement, and it must not start automatically.

### Phase 10.3 — BADGES + ACHIEVEMENTS Focused Checklist — PASS

Focused refinement:

- Fixed Ticket-resolution Achievement progress to select the first reliable terminal Ticket AuditLog transition for each Ticket before applying assigned-membership credit.
- Reopen/reresolve flows cannot double count a Ticket or credit a later assignee for a Ticket whose first resolution belonged to another membership.
- Award writes remain centralized in `GamificationService`; Task, Project, and Ticket modules request evaluation only and do not insert awards directly.
- Badge and Achievement definitions remain separate, Workspace scoped, and criteria remain typed/allowlisted to XP, Task, Project, and Ticket sources only.
- Achievement and Badge awards remain immutable and one-time per WorkspaceMembership.
- Achievement XP rewards continue to use the Phase 10.1 XP ledger write path with idempotent event keys.
- Existing qualifiers still award only on the next relevant event; no historical mass backfill or worker exists.
- `/workspace/gamification` remains the single UI route with Overview, Levels, Badges, Achievements, and History tabs only.
- No Reward Points, Streaks, Leaderboards, manual awards, resets, notifications, Redis authority, Achievement worker, or Phase 10.4+ scope was introduced.

Focused verification:

- Focused API gamification service tests pass 16/16.
- `pnpm typecheck` passes.
- `pnpm lint` passes.
- `pnpm format` passes.
- `pnpm test` passes 73 API unit tests, 121 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Security search confirms direct AchievementAward and BadgeAward writes remain limited to the central Gamification service.

Phase 10.3 focused checklist is pass. The next step is Phase 10.3 Final Completion Verification, and it must not start automatically.

### Phase 10.3 — BADGES + ACHIEVEMENTS — COMPLETE / PASS

Final invariants:

- BadgeDefinition and AchievementDefinition remain separate Workspace-scoped concepts.
- AchievementDefinition owns typed qualification criteria.
- BadgeDefinition contains no qualification logic.
- Supported criteria are `XP_TOTAL_AT_LEAST`, `TASK_COMPLETED_COUNT`, `PROJECT_COMPLETED_COUNT`, and `TICKET_RESOLVED_COUNT` only.
- No arbitrary executable, expression, SQL, JavaScript, webhook, Streak, or Level criteria exist.
- AchievementAward is immutable and one-time per WorkspaceMembership plus Achievement.
- BadgeAward is immutable and one-time per WorkspaceMembership plus Badge.
- Awards belong to WorkspaceMembership, not global User.
- The central Gamification Achievement service owns evaluation and awards.
- Task, Project, and Ticket modules never directly insert award rows.
- No historical mass backfill, one-job-per-member scanner, or backfill worker exists.
- Existing qualifiers are evaluated only on future relevant events.
- Task Achievement progress counts distinct qualifying completed Tasks and Task reopen/recomplete never double counts.
- Project completion credit uses Project owner semantic and Project reopen/recomplete never double counts.
- Ticket resolution progress uses the first reliable terminal Ticket AuditLog transition per Ticket.
- The first terminal Ticket transition is selected before membership credit.
- Ticket reopen/reresolve never double counts and later assignees cannot receive credit for an earlier first resolution.
- `XP_TOTAL_AT_LEAST` uses Phase 10.1 XP ledger authority.
- Achievement may optionally grant one Badge.
- Achievement may optionally grant positive XP.
- Achievement XP reward uses the Phase 10.1 central XP service and stable idempotency.
- Chained XP Achievements are bounded and cannot infinitely recurse.
- No Reward Points are involved.
- Historical earned awards remain after XP drop or source reopen.
- Archived definitions retain historical awards.
- Historical award snapshots keep award meaning understandable after definition edits.
- Inactive memberships cannot receive new awards.
- `gamification.view` controls own Badge/Achievement/progress reads.
- `gamification.achievements.manage` controls definition management.
- No role-name authorization exists.
- Normal users cannot inspect arbitrary other-member awards.
- Cross-Workspace definition, Badge linkage, award, and membership access are blocked.
- `/workspace/gamification` remains the single Gamification route.
- Tabs are Overview, Levels, Badges, Achievements, and History only.
- No Streak, Reward, Reward Point, Leaderboard, manual award, reset, backfill, notification, Achievement worker, Redis Achievement authority, or Phase 10.4+ functionality exists.
- Phase 7, Phase 8, Phase 9, Phase 10.1, and Phase 10.2 remain green.

Final verification:

- Focused API gamification service tests pass 17/17, including the first-terminal Ticket resolution regression.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 74 API unit tests, 121 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase103_final_clean_20260921101415` with all 41 migrations applied, including `0041_phase10_3_badges_achievements`; `prisma migrate status` reports the schema is up to date.
- Security search confirms direct AchievementAward and BadgeAward writes remain limited to the central Gamification service and XP reward writes use the central XP ledger service path.
- No historical migration file was modified.

Phase 10.3 is complete/pass. The next step is Phase 10.4 — Daily Streaks, and it must not start automatically.

### Phase 10.4 — DAILY STREAKS Implementation — PASS

Implemented:

- Added Workspace-scoped `GamificationStreakConfig` with enable/disable state, bounded daily XP reward configuration, timestamps, and one config row per Workspace.
- Added immutable `GamificationStreakDay` records scoped to WorkspaceMembership with local Workspace date, qualification type, source entity, qualification timestamp, timezone snapshot, and reward snapshot.
- Added migration `0042_phase10_4_daily_streaks`, including `gamification.streaks.manage` permission grants for OWNER, ADMIN, and MANAGER system Workspace roles.
- Added self-scoped Streak summary/history APIs and permission-gated Streak configuration APIs under the existing Workspace Gamification route.
- Added central Gamification service qualification from Task completion and first reliable Ticket resolution events.
- Added optional daily XP rewards through the Phase 10.1 central XP ledger service with stable idempotency.
- Added `/workspace/gamification` Streaks tab while keeping the single Gamification route with Overview, Levels, Badges, Achievements, Streaks, and History tabs.
- Added Overview Streak summary cards and English/Tamil labels for Streak surfaces.

Phase 10.4 implementation invariants established:

- Daily Streak state belongs to WorkspaceMembership, not global User.
- Same User can have independent Streaks across Workspaces.
- Streak days are immutable event records and no mutable member/user current-streak field is authoritative.
- Current Streak and Longest Streak are derived server-side from StreakDay rows.
- Workspace timezone is the authority for local Streak dates.
- Timezone and configured daily XP reward are snapshotted per Streak day.
- Enabling Streaks starts future qualification only and does not backfill historical activity.
- Disabling Streaks stops new qualification without deleting historical Streak days.
- Task qualification is limited to `TASK_COMPLETED`.
- Ticket qualification is limited to first reliable `TICKET_RESOLVED` terminal evidence.
- Project qualification, manual check-in, freeze, grace day, vacation mode, leaderboard, reward-point, and notification behavior were not introduced.
- Duplicate same source events and same-member same-local-date events cannot create duplicate Streak days.
- Daily XP reward is optional, positive-or-zero, bounded, snapshotted, and paid through central XP ledger idempotency.
- Inactive memberships cannot receive new Streak days.
- Cross-Workspace Streak config, summary, history, source, and membership access are blocked.
- `gamification.view` gates own Streak summary/history/config reads.
- `gamification.streaks.manage` independently gates Streak config mutation.
- No role-name authorization exists.
- Streak config mutation is audited.
- No Streak worker, Redis Streak authority, or scheduled Streak process exists.
- Query keys include Workspace and Streak dimensions; Workspace switching cannot reuse tenant-bound Streak state.
- Phase 7, Phase 8, Phase 9, Phase 10.1, Phase 10.2, and Phase 10.3 remain green.

Implementation verification:

- Focused API gamification service tests pass 20/20.
- Focused web gamification tests pass as part of 122/122 web tests.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 77 API unit tests, 122 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase104_clean_20260921115135` with all 42 migrations applied, including `0042_phase10_4_daily_streaks`; `prisma migrate status` reports the schema is up to date.
- No historical migration file was modified.

Phase 10.4 implementation is pass. The next step is Phase 10.4 Focused Refinement, and it must not start automatically.

### Phase 10.4 — DAILY STREAKS Focused Checklist — PASS

Focused refinements:

- Added focused coverage for Workspace-local Streak date authority independent from browser/device timezone.
- Added focused coverage that current and longest Streak values are derived from immutable StreakDay rows.
- Added focused coverage for keeping yesterday's chain alive during today, missed-day current-streak reset, `needsActionToday`, and historical longest Streak preservation.
- Added focused coverage that events before `enabledAt` do not create StreakDays.
- Added focused coverage that Task completion qualifies active assignees independently while followers and inactive memberships do not qualify.
- Added focused coverage that Project completion does not create StreakDays.
- Added focused coverage that unassigned first Ticket resolution does not invent Streak credit.
- Added focused coverage that same Task/Ticket source reuse cannot create duplicate StreakDays or duplicate daily XP.
- Added focused coverage that Streak XP flows through the central Phase 10.1 XP service and can trigger existing `XP_TOTAL_AT_LEAST` Achievements without adding a Streak Achievement criterion.
- Strengthened the Gamification service unit-test harness to model Prisma unique errors, filtered AuditLog lookups, and multi-assignee Task evaluation accurately.

Focused checklist reconfirmed:

- Streaks remain WorkspaceMembership scoped.
- Workspace timezone remains the calendar authority.
- Browser/device timezone is not authoritative.
- StreakDay uses immutable local calendar date.
- No mutable currentStreak or longestStreak authority exists.
- One member has at most one StreakDay per local date.
- Task completion and Ticket first resolution qualify.
- Project completion does not qualify.
- Task followers do not qualify.
- Multi-assignee Tasks handle each qualifying active assignee independently.
- Task reopen/recomplete cannot reuse the same Task source.
- Ticket reopen/reresolve cannot reuse the same Ticket source.
- Ticket later assignee cannot receive earlier-resolution Streak credit.
- Unassigned first Ticket resolution does not invent Streak credit.
- Inactive membership receives no new day.
- Streak feature can be enabled/disabled by Workspace.
- Enabling/re-enabling does not historical-backfill or disabled-period-backfill.
- Event before `enabledAt` cannot create a StreakDay.
- Same-day Task plus Ticket contention creates only one day.
- Optional daily XP defaults to zero, uses the central Phase 10.1 XP service, occurs at most once per day, and is idempotent/concurrency safe through StreakDay uniqueness plus XP idempotency.
- Existing XP_TOTAL Achievement integration can react to Streak XP.
- No Streak Achievement criterion exists.
- No midnight reset job, Streak worker, Redis Streak authority, grace, freeze, vacation, repair, Reward Points, Rewards, Leaderboard, notification, or Phase 10.5+ scope exists.
- StreakDay update/delete path does not exist, and database immutability exists consistently with the XP ledger pattern.
- `gamification.streaks.manage` remains migration-backed.
- `gamification.view` remains own-read permission.
- No role-name authorization exists.
- Cross-Workspace access fails and normal users cannot inspect another member's Streak.
- `/workspace/gamification` remains one page with Overview, Levels, Badges, Achievements, Streaks, and History tabs only.
- No separate Streak route exists.
- Phase 7, Phase 8, Phase 9, Phase 10.1, Phase 10.2, and Phase 10.3 remain green.

Focused verification:

- Focused API gamification service tests pass 30/30.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 87 API unit tests, 122 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase104_focused_clean_20260921120303` with all 42 migrations applied, including `0042_phase10_4_daily_streaks`; `prisma migrate status` reports the schema is up to date.
- Focused scope search found no Streak worker, Redis Streak authority, manual check-in, Project-to-Streak qualification, grace/freeze/vacation/repair, StreakDay update/delete/upsert/createMany path, dedicated Streak route, or Phase 10.5 functionality.

Phase 10.4 focused checklist is pass. The next step is Phase 10.4 Final Completion Verification, and it must not start automatically.

### Phase 10.4 — DAILY STREAKS — COMPLETE / PASS

Final invariants:

- Daily Streaks are WorkspaceMembership scoped.
- Same User may have independent Streak histories in different Workspaces.
- Workspace timezone is the sole Streak calendar authority.
- Browser/device timezone, server OS timezone, and raw UTC calendar dates are not Streak authority.
- IANA timezone conversion is used; no fixed-offset shortcut exists.
- GamificationStreakDay is immutable historical authority.
- `currentStreak` and `longestStreak` are derived, not stored authority.
- One membership has at most one StreakDay per Workspace-local date.
- Qualifying sources are Task completion and first reliable Ticket resolution only.
- Project completion does not qualify.
- Task followers do not qualify.
- Active Task assignees qualify independently.
- The same Task cannot be reused after reopen/recomplete.
- Ticket Streak credit uses the first reliable terminal-resolution membership.
- Ticket reopen/reresolve cannot reuse the Ticket source.
- Later Ticket assignees cannot receive first-resolution Streak credit.
- Unassigned first Ticket resolution does not invent credit.
- Inactive/suspended memberships cannot receive new StreakDays.
- Existing historical StreakDays remain readable.
- Streak configuration is Workspace scoped with one config maximum per Workspace.
- Missing config safely means `enabled=false` and `dailyXpReward=0`.
- Disabled Streaks create no new days.
- `enabledAt`/current activation boundary prevents historical replay.
- Enabling/re-enabling never performs historical backfill or disabled-period backfill.
- No Workspace-wide historical Task, Ticket, AuditLog, or member scan exists.
- No Backfill/Recalculate button exists.
- `dailyXpReward` is configurable, integer, non-negative, bounded, and may be zero.
- Daily XP is granted once maximum for each successful new StreakDay.
- Streak XP uses the Phase 10.1 central XP service.
- Streak XP remains idempotent and concurrency safe.
- Streak XP may trigger existing `XP_TOTAL_AT_LEAST` Achievements.
- XP from Streak cannot itself create another StreakDay.
- No Streak-specific Achievement criterion exists.
- Historical reward snapshots remain unchanged after reward configuration edits.
- Yesterday's consecutive chain remains current during today until today is missed.
- Missing a full calendar day resets `currentStreak` to zero naturally.
- `longestStreak` remains historical and derived from immutable localDate sequences.
- Historical localDate values are not recalculated when Workspace timezone changes.
- Future qualifying events use the current Workspace timezone.
- No midnight reset cron, delayed per-member reset job, Streak worker, or Redis Streak authority exists.
- PostgreSQL remains authoritative.
- No freeze, grace day, skip token, vacation mode, repair, manual edit, manual check-in, or public Streak write endpoint exists.
- `gamification.view` gates own Streak data.
- `gamification.streaks.manage` independently gates configuration and is migration-backed.
- No role-name authorization exists.
- Normal users cannot inspect another membership's Streak.
- Cross-Workspace config/read/event/reward access remains blocked.
- `/workspace/gamification` remains the single Gamification route.
- Tabs are Overview, Levels, Badges, Achievements, Streaks, and History.
- No Reward Points, Rewards Store, Leaderboard, notification side effect, automation integration, or Phase 10.5 functionality exists.
- Phase 7, Phase 8, Phase 9, Phase 10.1, Phase 10.2, and Phase 10.3 remain green.

Final verification:

- Focused API gamification service tests pass 30/30.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes 87 API unit tests, 122 web tests, and 13 worker tests.
- `pnpm test:integration` passes 103/103 API integration tests and 13/13 worker integration tests.
- `pnpm test:e2e` passes 21/21 Playwright tests.
- `pnpm build` passes with the existing Next ESLint-plugin detection warning.
- `pnpm audit --audit-level high` passes while reporting the existing moderate advisory.
- `git diff --check` passes with Git line-ending normalization warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase104_focused_clean_20260921120303` with all 42 migrations applied, including `0042_phase10_4_daily_streaks`; `prisma migrate status` reports the schema is up to date.
- Final migration inspection confirms 42 migration directories, `0042_phase10_4_daily_streaks` exists, Streak permission migration is included, no historical migration file was modified, and no historical StreakDay data is generated by migration.
- Final security search found no authoritative stored user/member Streak counters, no public/manual Streak write path, no StreakDay write outside the central Gamification service, no direct XP write workaround outside central XP service paths, no Project-to-Streak qualification, no Streak-specific Achievement criterion, no historical backfill, no mass membership scan, no midnight reset cron, no Streak worker, no Redis Streak authority, no role-name Streak authorization, no Reward Points/Rewards/Leaderboard, no freeze/grace/vacation/repair/manual-edit semantics, and no notification side effect.

Phase 10.4 is complete/pass. The next step is Phase 10.5 — Reward Points + Rewards, and it must not start automatically.

### Phase 10.5 — REWARD POINTS + REWARDS — COMPLETE / PASS

Final invariants:

- XP and Reward Points remain completely separate economies.
- Reward Points are WorkspaceMembership scoped, and the same User may have different Reward Point balances across Workspaces.
- The immutable Reward Point ledger is the balance source of truth; no mutable User or WorkspaceMembership Reward Point balance is authoritative.
- Reward Point balance can never become negative, and concurrent spend/redemption cannot overdraw a membership balance.
- All Reward Point mutations go through one central Reward Point service.
- System Reward Point changes are idempotent.
- Reward Point ledger supports EARN, SPEND, REFUND, ADJUSTMENT, and REVERSAL semantics.
- No public/manual Reward Point adjustment or reset exists in Phase 10.5.
- Achievement may optionally grant Reward Points.
- Streak may optionally grant Reward Points.
- Achievement and Streak Reward Point rewards are idempotent and snapshot-safe.
- Task, Project, and Ticket events do not directly award Reward Points.
- Historical Achievements and StreakDays are not retroactively paid.
- Reward definitions are Workspace scoped.
- Reward cost is a positive integer.
- Rewards support UNLIMITED and LIMITED inventory.
- Limited inventory cannot oversell under concurrency.
- Successful redemption atomically and retry-safely creates PENDING state, spends points, and reserves limited stock.
- Redemption requests are idempotent.
- Insufficient balance cannot create a redemption, spend, or stock mutation.
- Out-of-stock Reward cannot create a redemption or spend.
- PENDING may transition only to FULFILLED or CANCELLED.
- FULFILLED is final in Phase 10.5.
- Fulfillment does not mutate Reward Point balance or inventory.
- Cancellation refunds exactly the historical pointsCostSnapshot once.
- Cancellation restores limited inventory exactly once.
- Duplicate cancellation cannot double-refund or double-restore stock.
- Fulfill/cancel races resolve to one valid final state.
- Reward archive blocks new redemptions while preserving existing pending redemptions.
- Reward/redemption snapshots protect historical name, cost, and inventory semantics.
- Inventory mode cannot change while pending redemptions exist.
- No Reward Point transfers exist.
- No Reward Point expiration or reset exists.
- No cash conversion or payment integration exists.
- No shipping/coupon fulfillment system exists.
- `gamification.view` gates own Reward Point, catalog, and redemption reads.
- `gamification.rewards.redeem` independently gates redemption.
- `gamification.rewards.manage` independently gates Reward and redemption management.
- No role-name authorization exists.
- Users cannot inspect another membership's Reward Point ledger/redemptions.
- Cross-Workspace Reward/redemption access is blocked.
- `/workspace/gamification` remains the single Gamification route.
- Tabs are Overview, Levels, Badges, Achievements, Streaks, Rewards, and History.
- UI clearly distinguishes XP from Reward Points.
- No Leaderboard implementation exists.
- No Reward worker exists.
- No Redis Reward Point authority exists.
- No notification side effects exist.
- Phase 7 through Phase 10.4 remain green.

Final verification:

- Focused API gamification service tests pass 38/38.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes: API 95/95, Web 122/122, Worker 13/13.
- `pnpm test:integration` passes: API 103/103, Worker 13/13.
- `pnpm test:e2e` passes 21/21.
- `pnpm build` passes.
- `pnpm audit --audit-level high` passes with one existing moderate advisory.
- `git diff --check` passes with existing LF-to-CRLF warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase105_focused_clean_20260921125954` with all 43 migrations applied, including `0043_phase10_5_reward_points_rewards`; `prisma migrate status` reports the schema is up to date.

Phase 10.5 is complete/pass. The next step is Phase 10.6 — Leaderboards, and it must not start automatically.

### Phase 10.6 — LEADERBOARDS Implementation — PASS

Implemented:

- Added Workspace-scoped `GamificationLeaderboardConfig` with disabled-by-default master, Workspace, and Department leaderboard toggles.
- Added WorkspaceMembership-scoped `GamificationLeaderboardPreference` with `SHOW_NAME`, `SHOW_DISPLAY_NAME`, `ANONYMOUS`, and `OPT_OUT` privacy modes.
- Added migration-backed `gamification.leaderboards.view` and `gamification.leaderboards.manage` permissions.
- Added server APIs for Leaderboard configuration, self privacy preference, Workspace leaderboard, My Department leaderboard, and manager Department leaderboard within the existing Workspace Gamification route.
- Added set-based SQL leaderboard ranking over current XP from the immutable XP ledger with dense/shared ranks, deterministic tie display ordering, Top 100 result bounding, and separate current-user position.
- Added `/workspace/gamification` Leaderboard tab with privacy controls, manager configuration controls, Workspace leaderboard, and My Department leaderboard.
- Added focused API service coverage for dense ranking, Top 100 plus self position, opt-out exclusion, anonymous identity redaction, Department scoping, disabled defaults, and self-owned privacy updates.

Final implementation invariants:

- Phase 10.6 supports Workspace and Department individual Leaderboards only.
- Agency/global/cross-Workspace Leaderboards do not exist.
- All-Time current XP is the sole ranking authority.
- Reward Points never affect rank.
- Level/Streak/Badge/Achievement counts never directly affect rank.
- Rank is server-derived and never stored as mutable authority.
- Equal XP uses shared dense ranking.
- Deterministic tie ordering never changes shared rank.
- Active WorkspaceMemberships only participate.
- OPT_OUT members are excluded before ranking.
- ANONYMOUS members participate but identity is redacted.
- SHOW_NAME and SHOW_DISPLAY_NAME reuse existing safe identity data.
- No email/phone fallback is used for Leaderboard identity.
- Leaderboard privacy is WorkspaceMembership scoped.
- Users control only their own privacy preference.
- Managers cannot override another user's privacy in Phase 10.6.
- Leaderboards are disabled by default/no-config state.
- Workspace and Department scopes may be enabled independently.
- Workspace Leaderboard returns bounded Top 100 plus current user position.
- Current user outside Top 100 does not require fetching all prior rows.
- Department Leaderboard ranks individuals inside one Department.
- Normal users view only their own Department scope.
- Users without a Department receive explicit unavailable state.
- Department movement changes Department ranking membership without changing XP.
- `gamification.leaderboards.view` independently gates Leaderboard reads.
- `gamification.leaderboards.manage` independently gates Workspace configuration.
- No role-name authorization exists.
- No Leaderboard snapshot/history table exists.
- No Rank rewards/XP/Reward Points/Badge/Achievement side effects exist.
- No Leaderboard notifications exist.
- No Redis Leaderboard authority exists.
- No Leaderboard worker exists.
- `/workspace/gamification` remains the single Gamification route.
- Tabs are Overview, Levels, Badges, Achievements, Streaks, Rewards, Leaderboard, and History.
- No Daily/Weekly/Monthly period selector exists.
- No separate Leaderboard route exists.
- Phase 7 through Phase 10.5 remain green.

Implementation verification:

- Focused API gamification service tests pass 42/42.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes: API 99/99, Web 122/122, Worker 13/13.
- `pnpm test:integration` passes: API 103/103, Worker 13/13.
- `pnpm test:e2e` passes 21/21.
- `pnpm build` passes.
- `pnpm audit --audit-level high` passes with one existing moderate advisory.
- `git diff --check` passes with existing LF-to-CRLF warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase106_clean_20260921203903` with all 44 migrations applied, including `0044_phase10_6_leaderboards`; `prisma migrate status` reports the schema is up to date.

Phase 10.6 implementation is pass. The next step is Phase 10.6 Focused Refinement, and it must not start automatically.

### Phase 10.6 — LEADERBOARDS Focused Checklist — PASS

Focused refinements:

- Hardened Workspace and Department leaderboard Top 100 selection so dense/shared ranks remain correct while entries are capped at 100 even when many members tie at the boundary.
- Kept deterministic display ordering for ties by rank and membership id without changing the shared dense rank.
- Preserved separate current-user position lookup so a member outside the Top 100 can see their own rank without fetching all preceding rows.
- Reconfirmed zero-XP active members participate, inactive memberships do not participate, and OPT_OUT members are excluded before ranking.
- Reconfirmed privacy defaults and anonymous entries do not leak raw user id, membership id, email, phone, or other contact PII.
- Added service-level `gamification.leaderboards.view` and `gamification.leaderboards.manage` permission checks as defense in depth; controller RBAC remains independently enforced.
- Reconfirmed Workspace configuration remains disabled by default, Workspace/Department scopes are independently toggled, and users can mutate only their own leaderboard privacy preference.
- Reconfirmed Department leaderboards are tenant-scoped, same-Department scoped for normal users, manager-scoped only through the configured Department endpoint, and Workspace bounded.
- Reconfirmed All-Time current XP from the immutable XP ledger is the only ranking source; Reward Points, Levels, Streaks, Badges, and Achievements do not affect rank.
- Reconfirmed no leaderboard snapshot/history table, Redis authority, worker, notification, rank reward, period selector, global leaderboard, agency leaderboard, team leaderboard, project/task/ticket leaderboard, or Phase 10.7 scope exists.

Focused verification:

- Focused API gamification service tests pass 49/49.
- Focused web gamification tests pass inside the web suite; full web unit suite passes 123/123.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes: API 106/106, Web 123/123, Worker 13/13.
- `pnpm test:integration` passes: API 103/103, Worker 13/13.
- `pnpm test:e2e` passes 21/21.
- `pnpm build` passes.
- `pnpm audit --audit-level high` passes with one existing moderate advisory.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase106_focused_clean_20260921213440` with all 44 migrations applied, including `0044_phase10_6_leaderboards`; `prisma migrate status` reports the schema is up to date.
- Security search found no `rank <=` boundary query, no row-number ranking, no leaderboard rank cache, no leaderboard snapshot/history table, no leaderboard Redis authority, no leaderboard worker, no leaderboard notification side effect, no role-name leaderboard authorization, and no Reward Point ranking path.
- No tracked historical migration file was modified.

Phase 10.6 focused checklist is pass. The next step is Phase 10.6 Final Completion Verification, and it must not start automatically.

### Phase 10.6 — LEADERBOARDS — COMPLETE / PASS

Final invariants:

- Phase 10.6 supports Workspace and Department individual Leaderboards only.
- No Agency, global, or cross-Workspace Leaderboard exists.
- All-Time current XP is the sole ranking authority.
- XP comes from the Phase 10.1 immutable XP ledger.
- Reward Points never affect rank.
- Level, Streak, Badge, Achievement, and Pressure Score metrics never directly determine rank.
- Rank is server-derived and never stored as mutable authority.
- DENSE_RANK shared-rank semantics are authoritative.
- Deterministic tie ordering never changes shared rank.
- Rank is computed across the eligible population before the Top-100 limit.
- Leaderboard result is capped at 100 even across a tie boundary.
- Self position is computed independently and works outside Top 100.
- Self outside Top 100 may share rank with a returned boundary member.
- Active WorkspaceMemberships only participate.
- Zero-XP active members remain eligible and share dense rank when tied.
- Inactive or suspended members are excluded before ranking.
- OPT_OUT is removed before rank calculation and exposes no hidden rank.
- ANONYMOUS remains in the ranking population with identity fully redacted.
- Anonymous response exposes no raw identity, contact, member, user, or avatar fields.
- No preference row resolves to the safe ANONYMOUS default.
- SHOW_NAME and SHOW_DISPLAY_NAME never fall back to email or phone.
- Privacy preference is WorkspaceMembership scoped.
- Users control only their own privacy preference.
- Managers cannot override another user's privacy in Phase 10.6.
- No-config Leaderboard state is disabled.
- Workspace and Department scopes are independently configurable.
- `gamification.leaderboards.view` independently gates Leaderboard reads.
- `gamification.leaderboards.manage` independently gates configuration management and manager Department queries.
- No role-name authorization exists.
- Normal Department scope is resolved server-side from the authenticated membership.
- Users without a Department receive explicit unavailable state.
- Manager Department queries remain same-Workspace only.
- Department movement changes participation without modifying XP.
- Set-based XP aggregation remains in place.
- Ranking SQL remains parameterized and Workspace fenced.
- Level display creates no per-row Level query fan-out.
- No leaderboard rank rewards exist.
- No rank notifications exist.
- No period Leaderboards exist.
- No Leaderboard snapshots/history exists.
- No Redis ranking authority exists.
- No Leaderboard worker exists.
- `/workspace/gamification` remains the single Gamification route.
- Tabs are Overview, Levels, Badges, Achievements, Streaks, Rewards, Leaderboard, and History.
- Phase 7 through Phase 10.5 remain green.

Final verification:

- Focused API gamification service tests pass 49/49.
- `pnpm prisma:generate` passes.
- `pnpm prisma:validate` passes.
- `pnpm format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm test` passes: API 106/106, Web 123/123, Worker 13/13.
- `pnpm test:integration` passes: API 103/103, Worker 13/13.
- `pnpm test:e2e` passes 21/21.
- `pnpm build` passes.
- `pnpm audit --audit-level high` passes with one existing moderate advisory.
- `git diff --check` passes with existing LF-to-CRLF warnings only.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase106_final_clean_20260921222844` with all 44 migrations applied, including `0044_phase10_6_leaderboards`; `prisma migrate status` reports the schema is up to date.
- Final security search found no mutable rank authority, no row-number displayed rank, no Reward Point/Level/Streak/Badge/Achievement/Pressure Score ranking authority, no Agency/global/period Leaderboard implementation, no rank reward, no rank notification, no Leaderboard worker, no Redis Leaderboard authority, no role-name Leaderboard authorization, no manager privacy override, no leaderboard membershipId/userId/email/phone/avatar exposure, and no client-side rank authority.
- No tracked historical migration file was modified.

Phase 10.6 is complete/pass. The next step is Phase 10.7 — Admin Adjustments + Reset Security, and it must not start automatically.

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
- Project Reports must remain server aggregated, tenant safe, and filtered through visible Project-linked Tasks.
- Project CSV exports must be formula-injection protected and must not expose inaccessible or sensitive data.
- Project runtime permissions must use permission keys; legacy role names or singular permission aliases must not authorize Phase 8 Project actions.
- One Project Detail shell must integrate Project Overview, Tasks, Kanban, Timeline, Files, Members, Activity, and Reports.
- Heavy Project tabs must lazy-load independently without Overview request fan-out.
- Project query/cache keys must remain Workspace/Project scoped with targeted mutation invalidation.
- Phase 8 Project code must not introduce Phase 9 Ticket / Service Desk behavior.
- Ticket core uses one Workspace-scoped `Ticket` model and one `WorkspaceTicketCounter`; no duplicate Ticket core/status/counter table should be added.
- Ticket primary identity is UUID; human Ticket numbers are Workspace-scoped `TKT-000001` style identifiers.
- Ticket numbering must remain PostgreSQL-backed and atomic per Workspace; no `MAX + 1`, count-derived, frontend-derived, Redis-derived, or time-derived numbering path.
- Ticket lifecycle must use same-Workspace `StatusDefinition(TICKET)` records only.
- Ticket runtime must not depend on status names for authorization or core lifecycle validation.
- Ticket default statuses must be provisioned for existing and future Workspaces.
- Ticket priority remains `LOW`, `MEDIUM`, `HIGH`, and `URGENT`.
- `createdByMembershipId` is creator metadata only and must not become requester, assignee, owner, watcher, participant, or access-control logic.
- Ticket CRUD and list operations must remain Workspace scoped and exclude soft-deleted Tickets.
- Ticket permissions must use `tickets.view`, `tickets.view_all`, `tickets.create`, `tickets.update`, `tickets.delete`, `tickets.assign`, `tickets.manage_requester`, `tickets.reply`, `tickets.notes.view`, and `tickets.notes.create`; role names must not grant Ticket authorization.
- Ticket audit events must use `AuditLog` with bounded safe metadata.
- Ticket query/cache keys must include Workspace identity.
- Ticket requester can be INTERNAL or EXTERNAL; creator remains separate and legacy requester-null Tickets remain valid.
- Ticket Department must reuse the existing Department model, and assignee eligibility must use `WorkspaceMembership.departmentId`.
- Scoped Ticket visibility must be enforced before list pagination/count/search and direct detail access.
- Ticket conversation uses one Ticket-scoped `TicketConversationEntry` stream for `PUBLIC_REPLY` and `INTERNAL_NOTE` entries.
- Ticket conversation entries are immutable in Phase 9.3, same-Workspace fenced, and authored by active Workspace memberships at posting time while historical inactive authors remain readable.
- Internal notes must be filtered server-side before count and pagination and must require `tickets.notes.view`.
- Public reply and internal note creation must use dedicated permission keys and must not be granted by `tickets.view_all`, creator/requester/Department/assignee state, or role names.
- Conversation text must remain out of Audit metadata, logs, URLs, and query keys.
- Ticket conversation posting must not auto-change Ticket status, auto-assign Ticket, change requester, or create SLA/notification/delivery side effects.
- Ticket SLA uses separate First Response and Resolution metrics, Workspace-scoped policy/rule/pause-status tables, immutable per-Ticket policy snapshots, and one `TicketSlaState` per Ticket.
- Ticket SLA pause rules must reference same-Workspace `StatusDefinition(TICKET)` IDs, never status names.
- Ticket SLA completion must be one-shot, breach detection must be idempotent and based on persisted due dates, and SLA events must never mutate Ticket status or assignment.
- Ticket SLA worker processing must remain bounded recurring scan work, with no one-delayed-job-per-Ticket or per-second write architecture.
- Phase 9 Ticket code must not introduce attachments, reporting, escalation, portal, email, WhatsApp, or notification behavior before their explicit phases.
- Gamification XP uses one Workspace-scoped append-only `GamificationXpEntry` ledger.
- XP targets and actors must use same-Workspace `WorkspaceMembership` IDs; `User` IDs alone are never XP identity.
- Current XP must remain a server aggregate over ledger amounts; no stored mutable XP balance should be introduced.
- Future XP writers must call `GamificationService`; public APIs remain read-only until an explicit later phase.
- XP writes must preserve idempotency, active target membership validation, same-Workspace actor validation, transaction-scoped balance floor checks, and bounded reversal semantics.
- Phase 10.1 code must not introduce levels, rewards, badges, achievements, streak computation, leaderboards, XP rule UI, automatic task/project/ticket XP awards, pressure score integration, workers, Redis, or Phase 10.2 scope.
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
- Ticket / TicketRequester / TicketConversationEntry / TicketConversationAttachment / TicketSlaPolicy / TicketSlaRule / TicketSlaPauseStatus / TicketSlaState / TicketAttachment / TicketSavedView / WorkspaceTicketCounter
- GamificationXpEntry
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
| Phase 8.9     | PASS   | Complete/pass; not tagged        |
| Phase 8       | PASS   | Complete/pass; not tagged        |
| Phase 9.1     | PASS   | Complete/pass; not tagged        |
| Phase 9.2     | PASS   | Complete/pass; not tagged        |
| Phase 9.3     | PASS   | Complete/pass; not tagged        |
| Phase 9.4     | PASS   | Complete/pass; not tagged        |
| Phase 9.5     | PASS   | Complete/pass; not tagged        |
| Phase 9.6     | PASS   | Complete/pass; not tagged        |
| Phase 9.7     | PASS   | Complete/pass; not tagged        |
| Phase 9.8     | PASS   | Complete/pass; not tagged        |
| Phase 9.9     | PASS   | Complete/pass; not tagged        |
| Phase 9.10    | PASS   | Complete/pass; not tagged        |
| Phase 9       | PASS   | Complete/pass; not tagged        |
| Phase 10.1    | PASS   | Complete/pass; not tagged        |
| Phase 10.2    | PASS   | Complete/pass; not tagged        |
| Phase 10.3    | PASS   | Complete/pass; not tagged        |
| Phase 10.4    | PASS   | Complete/pass; not tagged        |
| Phase 10.5    | PASS   | Complete/pass; not tagged        |
| Phase 10.6    | PASS   | Complete/pass; not tagged        |
| Phase 10.7    | PASS   | Complete/pass; not tagged        |

## Current Warnings

Confirmed current warnings:

- Next build reports: "The Next.js plugin was not detected in your ESLint configuration."
- Storybook build reports upstream Storybook/Rolldown direct `eval` warnings and chunk-size warnings.
- `pnpm audit --audit-level high` passes, while reporting 1 moderate vulnerability.
- API Jest unit run reports the existing open-handle warning after passing.
- Initial parallel `pnpm build` can collide with an active Playwright `next dev` server; solo rerun passes.

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
- Phase 8.9 Final Project Security + Performance + Integration Audit is complete/pass.
- Phase 8 Project Management System is complete/pass; the next step is Phase 9 Ticket / Service Desk System, and it must not start automatically.
- Phase 9.1 Ticket Core + Status Engine is complete/pass.
- Phase 9.2 Requester + Department + Assignment is complete/pass; the next step is Phase 9.3 Ticket Conversation + Internal Notes, and it must not start automatically.
- Phase 9.3 Ticket Conversation + Internal Notes is complete/pass; the next step is Phase 9.4 SLA Policies + Timers, and it must not start automatically.
- Phase 9.4 SLA Policies + Timers is complete/pass; the next step is Phase 9.5 Queues + Ticket Views + Filters, and it must not start automatically.
- Phase 9.5 Queues + Ticket Views + Filters is complete/pass; the next step is Phase 9.6 Escalation + Assignment Workflow, and it must not start automatically.
- Phase 9.6 Escalation + Assignment Workflow is complete/pass; the next step is Phase 9.7 Attachments + Activity, and it must not start automatically.
- Phase 9.7 Ticket Attachments + Activity is complete/pass; the next step is Phase 9.8 Service Desk Reports + CSV, and it must not start automatically.
- Phase 9.8 Service Desk Reports + CSV is complete/pass; the next step is Phase 9.9 Ticket UI Integration, and it must not start automatically.
- Phase 9.9 Ticket UI Integration is complete/pass after focused refinement; the next step is Phase 9.10 Final Ticket Security + Performance Audit, and it must not start automatically.
- Phase 9.10 Final Ticket Security + Performance + Integration Audit is complete/pass.
- Phase 9 Ticket / Service Desk System is complete/pass; the next step is Phase 10 Gamification, XP, Rewards & Leaderboards, and it must not start automatically.
- Phase 10.1 Gamification Core + XP Ledger is complete/pass; the next step is Phase 10.2 Levels + Progression, and it must not start automatically.
- Phase 10.2 Levels + Progression implementation is pass; the next step is Phase 10.2 Focused Refinement, and it must not start automatically.
- Phase 10.2 Levels + Progression focused checklist is pass; the next step is Phase 10.2 Final Completion Verification, and it must not start automatically.
- Phase 10.2 Levels + Progression is complete/pass; the next step is Phase 10.3 Badges + Achievements, and it must not start automatically.
- Phase 10.3 Badges + Achievements implementation is pass; the next step is Phase 10.3 Focused Refinement, and it must not start automatically.
- Phase 10.3 Badges + Achievements focused checklist is pass; the next step is Phase 10.3 Final Completion Verification, and it must not start automatically.
- Phase 10.3 Badges + Achievements is complete/pass; the next step is Phase 10.4 Daily Streaks, and it must not start automatically.
- Phase 10.4 Daily Streaks implementation is pass; the next step is Phase 10.4 Focused Refinement, and it must not start automatically.
- Phase 10.4 Daily Streaks focused checklist is pass; the next step is Phase 10.4 Final Completion Verification, and it must not start automatically.
- Phase 10.4 Daily Streaks is complete/pass; the next step is Phase 10.5 Reward Points + Rewards, and it must not start automatically.
- Phase 10.5 Reward Points + Rewards implementation is pass; the next step is Phase 10.5 Focused Refinement, and it must not start automatically.
- Phase 10.5 adds a WorkspaceMembership-scoped immutable Reward Point ledger, Achievement/Streak reward point hooks, Workspace-scoped reward definitions, pending/fulfilled/cancelled redemptions, spend/refund inventory semantics, independent `gamification.rewards.redeem` and `gamification.rewards.manage` permissions, and a single-route `/workspace/gamification` Rewards tab.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase105_clean_20260921125244` with all 43 migrations applied, including `0043_phase10_5_reward_points_rewards`; `prisma migrate status` reports the schema is up to date.
- Phase 10.5 verification passed: `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.5 Reward Points + Rewards focused checklist is pass; the next step is Phase 10.5 Final Completion Verification, and it must not start automatically.
- Focused coverage confirms Reward Points stay separate from XP, balances cannot go negative, idempotency prevents duplicate earnings/redemptions, redemption spend/refund/inventory changes are atomic, reward archive blocks new redemption without rewriting pending snapshots, fulfillment does not mutate balance/stock, double cancel cannot double refund, and Task/Project/Ticket events do not directly award Reward Points.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase105_focused_clean_20260921125954` with all 43 migrations applied, including `0043_phase10_5_reward_points_rewards`; `prisma migrate status` reports the schema is up to date.
- Phase 10.5 focused verification passed: focused API gamification tests 38/38, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.5 Reward Points + Rewards is complete/pass; the next step is Phase 10.6 Leaderboards, and it must not start automatically.
- Phase 10.6 Leaderboards implementation is pass; the next step is Phase 10.6 Focused Refinement, and it must not start automatically.
- Phase 10.6 adds disabled-by-default Workspace and Department individual Leaderboards ranked only by current XP, dense/shared ranks, Top 100 plus self position, WorkspaceMembership-scoped privacy preferences, independent leaderboard view/manage permissions, and the existing single-route `/workspace/gamification` Leaderboard tab.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase106_clean_20260921203903` with all 44 migrations applied, including `0044_phase10_6_leaderboards`; `prisma migrate status` reports the schema is up to date.
- Phase 10.6 implementation verification passed: focused API gamification tests 42/42, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.6 Leaderboards focused checklist is pass; the next step is Phase 10.6 Final Completion Verification, and it must not start automatically.
- Focused coverage confirms dense/shared ranks remain gapless, deterministic tie display order does not change rank, Top 100 is capped even at a tied boundary, self position is returned separately when outside the Top 100, zero-XP active members participate, inactive and OPT_OUT memberships are excluded before rank, anonymous entries do not leak raw identity, Reward Points do not affect rank, and leaderboard reads/config updates enforce independent permissions without role-name shortcuts.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase106_focused_clean_20260921213440` with all 44 migrations applied, including `0044_phase10_6_leaderboards`; `prisma migrate status` reports the schema is up to date.
- Phase 10.6 focused verification passed: focused API gamification tests 49/49, focused web gamification coverage inside the 123/123 web unit suite, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, and `pnpm audit --audit-level high`.
- Phase 10.6 Leaderboards is complete/pass; the next step is Phase 10.7 Admin Adjustments + Reset Security, and it must not start automatically.
- Final invariants confirm Workspace and Department individual Leaderboards only, All-Time current XP as sole ranking authority, DENSE_RANK shared-rank semantics, Top-100 cap after full eligible ranking, independent self position, active/non-OPT_OUT participation only, anonymous identity redaction, safe anonymous default privacy, user-owned privacy mutation only, independent leaderboard view/manage permissions, same-Workspace Department scoping, set-based parameterized ranking SQL, no rank rewards, no rank notifications, no period Leaderboards, no snapshots/history, no Redis authority, no Leaderboard worker, and the single `/workspace/gamification` route.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase106_final_clean_20260921222844` with all 44 migrations applied, including `0044_phase10_6_leaderboards`; `prisma migrate status` reports the schema is up to date.
- Phase 10.6 final verification passed: focused API gamification tests 49/49, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.7 Admin Adjustments + Reset Security implementation is pass; the next step is Phase 10.7 Focused Refinement, and it must not start automatically.
- Phase 10.7 adds append-only admin XP and Reward Point adjustments, compensating point-in-time resets to zero, reset-specific step-up grants bound to user/session/Workspace/target/economy/purpose, independent `gamification.adjustments.manage` and `gamification.reset` permissions, safe AuditLog projections, and admin-only controls inside the existing single `/workspace/gamification` route.
- Phase 10.7 invariants confirm XP and Reward Points remain separate WorkspaceMembership-scoped ledgers, adjustment/reset entries preserve history, balances cannot go negative, resets create no zero-amount ledger entry when already zero, resets are idempotent and one-time step-up protected, target memberships must be active in the same Workspace, Levels and Leaderboards stay derived from ledgers, Reward redemptions/history remain intact, and no notification, worker, Redis authority, transfer, expiration, cash conversion, or Phase 10.8 scope was introduced.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase107_clean_20260921230409` with all 45 migrations applied, including `0045_phase10_7_admin_adjustments_reset_security`; `prisma migrate status` reports the schema is up to date.
- Phase 10.7 implementation verification passed: focused API auth/gamification tests 56/56, focused web gamification suite 125/125, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.7 OTP/2FA blocker fix is pass; the next step is Phase 10.7 Focused Refinement / Final Completion Verification, and Phase 10.8 must not start automatically.
- Phase 10.7 OTP/2FA blocker fix adds production email OTP step-up for Gamification admin resets, with password plus OTP required before a final `SecurityStepUpGrant` can be created.
- Email delivery is behind a single backend mail abstraction with explicit `EMAIL_PROVIDER=resend|smtp` selection, Resend API-key validation, SMTP host/auth validation, and no automatic provider failover or frontend-exposed provider secrets.
- OTP security invariants confirm server-generated six-digit codes use Node crypto randomness, only HMAC digests are persisted with `OTP_PEPPER`, challenges expire, verification attempts and sends are bounded/rate-limited, stale challenges are invalidated on resend, and codes/proofs are not stored in localStorage/sessionStorage.
- Step-up invariants confirm final grants remain user-bound, refresh-session-bound, Workspace-bound, targetMembership-bound, economy-bound, purpose-bound, five-minute expiring, and one-time reset-consumed.
- Reset integration confirms admin balance reset still consumes only the final `SecurityStepUpGrant`; raw OTP values never enter Gamification reset APIs, AuditLog metadata, query keys, URLs, or persisted frontend state.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase107_otp_clean_20260921235653` with all 46 migrations applied, including `0045_phase10_7_admin_adjustments_reset_security` and `0046_phase10_7_email_otp_step_up`; `prisma migrate status` reports the schema is up to date.
- Phase 10.7 OTP/2FA blocker verification passed: focused API auth/mail tests 8/8, focused web gamification suite 125/125, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.7 Admin Adjustments + Reset Security focused checklist is pass; the next step is Phase 10.7 Final Completion Verification, and it must not start automatically.
- Focused refinements confirm manual XP and Reward Point adjustments use existing central ledger services, old ledger entries remain immutable, adjustment/reset business operations are idempotent, idempotency conflicts are rejected, and exact idempotent retries do not duplicate ledger or AuditLog effects.
- Focused reset refinements confirm reset remains a point-in-time compensating ledger operation, balance floors remain non-negative under membership locks, reset preserves Gamification history, Achievements, Badges, StreakDays, Reward definitions, Reward redemptions, Reward Point history, Level definitions, Leaderboard privacy/config, and future XP/Reward Point earnings remain possible after reset.
- Focused idempotency refinements confirm exact reset retries can return the committed result without a second usable grant, while changed target/economy/reason conflicts are rejected as `ADMIN_IDEMPOTENCY_CONFLICT`.
- Focused OTP refinements confirm protected reset requires exact `RESET` confirmation, password re-verification plus Email OTP, authenticated-actor email delivery only, cryptographic six-digit OTP generation, no plaintext OTP persistence, keyed HMAC verification with `OTP_PEPPER`, backend expiry at five minutes or less, bounded attempts, server-enforced resend cooldown, send/verify rate limits, and user/session/Workspace/target/economy/purpose challenge binding.
- Focused grant refinements confirm successful OTP verification is the only path to the final `SecurityStepUpGrant`, OTP challenges and final grants are one-time/replay protected, revoked/logout sessions cannot complete reset, and step-up grant proof is absent from OTP AuditLog metadata.
- Focused provider refinements confirm Resend and SMTP remain behind one mail abstraction, `EMAIL_PROVIDER` selects exactly one provider with no automatic fallback, provider failures leave challenges unusable, SMTP does not disable TLS verification, and provider internals/secrets are not exposed to browser responses.
- Focused frontend refinements confirm Admin Controls remain permission-gated, reset requires password and OTP state before submit, Workspace/target/economy changes clear reset security state, successful reset clears transient OTP/proof state, and `/verify-otp` is connected to the real backend verification endpoint without storing OTP/proof in localStorage/sessionStorage.
- Focused security search confirms no role-name authorization, no bulk adjustment/reset, no full Gamification reset, no TOTP/SMS/magic-link scope, no notification/automation side effects, no new Redis authority, and no worker was introduced.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase107_focused_clean_20260922013111` with all 46 migrations applied, including `0045_phase10_7_admin_adjustments_reset_security` and `0046_phase10_7_email_otp_step_up`; `prisma migrate status` reports the schema is up to date.
- Phase 10.7 focused verification passed: focused API auth/gamification/mail tests 67/67, API unit 123/123, Web unit 125/125, Worker unit 13/13, API integration 103/103, Worker integration 13/13, E2E 21/21, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.7 Admin Adjustments + Reset Security is complete/pass; the next step is Phase 10.8 Gamification UI Integration, and it must not start automatically.
- Final Phase 10.7 invariants confirm manual XP and Reward Point adjustments remain WorkspaceMembership scoped, all manual ledger changes use existing central ledger services, historical ledger rows remain immutable, adjustment/reset operations remain idempotent, conflicting idempotency keys are rejected, duplicate retries do not duplicate ledger or AuditLog effects, and balance floors remain concurrency safe.
- Final reset invariants confirm reset remains a point-in-time compensating ledger operation, never deletes Gamification history, never revokes earned Achievements/Badges, never deletes StreakDays, never mutates Reward Redemptions, and future legitimate earnings/refunds remain possible after reset.
- Final derived-state invariants confirm XP changes naturally affect Level/Leaderboard, positive manual XP may naturally trigger existing `XP_TOTAL_AT_LEAST` Achievements, and no direct Level/rank/Achievement award bypass was introduced.
- Final permission and tenancy invariants confirm `gamification.adjustments.manage` and `gamification.reset` remain separate, targets must be active same-Workspace memberships, and no role-name authorization exists.
- Final protected-reset invariants confirm reset requires reason, exact `RESET` confirmation, password re-verification plus Email OTP, password-only reset is impossible, Email OTP goes to the authenticated actor only, and successful OTP verification creates the final one-time `SecurityStepUpGrant`.
- Final mail/OTP invariants confirm mail delivery is abstracted behind Resend/SMTP providers, `EMAIL_PROVIDER` selects one provider with no automatic fallback, OTP is cryptographically generated, plaintext OTP is never persisted, keyed HMAC protects OTP storage, OTP expires within five minutes, OTP attempts/resends are bounded, OTP send/verify are rate-limited, and OTP challenges are actor/session/Workspace/target/economy/purpose bound.
- Final secret-safety invariants confirm OTP/provider/session secrets are absent from logs, AuditLog, and browser storage; `/verify-otp` is connected to the real backend flow; no TOTP/SMS/magic-link was added.
- Final scope invariants confirm no bulk adjustment/reset, no full Gamification reset, Admin Controls remain within `/workspace/gamification`, no notification/automation side effects, and no reset worker or Redis balance authority exists.
- Final Phase 10.7 migration status reconfirmed on isolated scratch database `zea_play_phase107_focused_clean_20260922013111`: 46 migrations found and database schema up to date with no pending migrations.
- E2E auth uses real protected frontend routing with mocked API responses; the previous dev-only frontend session bypass was removed.
- Future phases should extend from the existing tenant, auth, dashboard shell, theme, i18n, queue, and storage boundaries instead of replacing them.
- Phase 10.8 Point Management System implementation is pass; the next step is Phase 10.8 Focused Refinement, and it must not start automatically.
- Phase 10.8 adds Workspace-default and Department-override point rules for Task, Project, and Ticket completion, plus role-based creation point rules, while leaving XP wiring disabled until a later phase.
- Point rule invariants confirm Department overrides inherit from Workspace defaults only when no override exists, disabled overrides block inherited awards, legal category sets are work-type scoped, and all point math is handled by a pure backend calculator.
- Base XP, early bonus, and late penalty invariants confirm bounded integer inputs, explicit early threshold semantics, deadline-based penalties capped below the base award, and no negative calculated award.
- Creation XP invariants confirm Project `xpCategory` is distinct from priority, Task/Ticket categories reuse existing category authority, role rules support Workspace custom roles, no multiple-role award heuristic is implemented, and no XP ledger write occurs in Phase 10.8.
- Permission and tenancy invariants confirm independent `gamification.points.view`, `gamification.points.manage_workspace`, and `gamification.points.manage_department` permissions, no role-name authorization, active same-Workspace membership checks, and Department managers scoped to their own Department overrides.
- Frontend invariants confirm Point Management remains inside the single `/workspace/gamification` route, is permission gated, uses batched point-rule reads, supports Workspace/Department scope management, includes Tamil labels, and introduces no separate route or Phase 10.9 functionality.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase108_clean_202609220248` with all 47 migrations applied, including `0047_phase10_8_point_management_system`; `prisma migrate status` reports the schema is up to date.
- Phase 10.8 implementation verification passed: focused API point management/calculator tests 64/64, focused web gamification suite 126/126, API unit 130/130, Web unit 126/126, Worker unit 13/13, API integration 103/103, Worker integration 13/13, E2E 21/21, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.8 Point Management System focused checklist is pass; the next step is Phase 10.8 Final Completion Verification, and Phase 10.9 must not start automatically.
- Focused verification confirms Workspace default Point Rules, Department overrides, Department-over-Workspace inheritance, disabled override blocking, override removal restoring inheritance, Task/Ticket LOW/MEDIUM/HIGH/URGENT categories, Project HIGH/MEDIUM/LONG_TERM XP categories separate from priority, no guessed historical Project XP category, and Ticket `URGENT` remaining the backend enum while displaying as Emergency in Point Management.
- Focused calculator verification confirms configurable Base XP, fixed Early Bonus XP, early threshold, late penalty percent, penalty interval, max penalty cap, max penalty not exceeding Base XP, integer XP output, correct no-deadline behavior, and shared pure calculator usage.
- Focused creation-rule verification confirms Creation XP is separate, varies by role, supports dynamic custom roles, supports Department overrides over Workspace creation rules, rejects cross-Workspace Department/Role rules, and introduces no unsafe multiple-role heuristic.
- Focused permission and operations verification confirms migration-backed Workspace/Department management permissions, Department managers are limited to their own Department, no role-name authorization, uniqueness/concurrency protection, configuration AuditLog entries, and no Point Rule worker or Redis Point authority.
- Focused no-award verification confirms no Task, Project, Ticket, Creation, bonus, penalty, or reopen-reversal XP ledger entries are awarded yet; no global normalization, Agency/Super Admin global leaderboard, Developer Dashboard, or Phase 10.9+ scope was introduced.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase108_focused_clean_202609220300` with all 47 migrations applied, including `0047_phase10_8_point_management_system`; `prisma migrate status` reports the schema is up to date.
- Phase 10.8 focused verification passed: focused API point management/calculator tests 64/64, focused web gamification suite 126/126, API unit 130/130, Web unit 126/126, Worker unit 13/13, API integration 103/103, Worker integration 13/13, E2E 21/21, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.8 Point Management System is complete/pass; the next step is Phase 10.9 XP Engine + Task / Project / Ticket Integration, and it must not start automatically.
- Final Point Management invariants confirm configuration is Workspace/Subaccount scoped, Workspace defaults are authoritative fallback rules, Department overrides are explicit and dynamic, explicit disabled Department overrides win over Workspace defaults, and removing an override restores Workspace inheritance.
- Final work classification invariants confirm Task and Ticket rules reuse LOW/MEDIUM/HIGH/URGENT priority, Ticket `URGENT` is presented as Emergency only in Point Management, Project XP Category is separate from operational Project priority, Project XP Categories are HIGH/MEDIUM/LONG_TERM, and historical Projects are not guessed or backfilled into XP categories.
- Final completion-rule invariants confirm rules contain Base XP, fixed Early Bonus XP, Early Threshold, Late Penalty %, Penalty Interval, and Max Penalty XP; late penalties are integer-safe percentage-of-Base-XP per configured interval, capped, cannot exceed Base XP, and no-deadline completion receives no timing bonus or penalty.
- Final calculator and preview invariants confirm the central pure Point calculator is authoritative for non-mutating preview and future Phase 10.9 use, returning Base XP, Bonus XP, Penalty XP, Estimated XP, timing state, and rule source without writing XP.
- Final creation-rule invariants confirm Creation XP is configured independently, is role-based, supports custom roles dynamically, supports Department overrides over Workspace Creation XP, and implements no unsafe multiple-role award-resolution heuristic.
- Final permission and tenant invariants confirm `gamification.points.view` gates Point Management reads, `gamification.points.manage_workspace` controls Workspace/all-Department configuration, `gamification.points.manage_department` controls only the actor's own Department, no runtime role-name authorization exists, and cross-Workspace Department/Role rules are blocked.
- Final operations invariants confirm configuration mutations are audited, no Point Management configuration or preview action writes XP, no Task/Project/Ticket/Creation XP award exists yet, no Early Bonus/Late Penalty ledger integration exists yet, no reopen reversal exists yet, no global normalization exists, no Agency/Super Admin global leaderboard work exists, and no Developer Dashboard Gamification work exists.
- Final frontend invariants confirm `/workspace/gamification` remains the single Workspace Gamification route, Point Management is integrated as a permission-aware Gamification tab, Workspace/Department rule reads are bounded and batched, and no Point Rule worker or Redis authority exists.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase108_final_clean_202609220330` with all 47 migrations applied, including `0047_phase10_8_point_management_system`; `prisma migrate status` reports the schema is up to date.
- Phase 10.8 final verification passed: focused API point management/calculator tests 64/64, focused web gamification suite 126/126, API unit 130/130, Web unit 126/126, Worker unit 13/13, API integration 103/103, Worker integration 13/13, E2E 21/21, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, and `pnpm audit --audit-level high`.
- Phase 10.9 XP Engine + Task / Project / Ticket Integration implementation is pass; the next step is Phase 10.9 Focused Refinement, and Phase 10.10 must not start automatically.
- Phase 10.9 adds a central backend Work XP Engine that resolves Phase 10.8 Point Rules at event time, records immutable `GamificationWorkXpEvent` history, links deterministic XP ledger components to each work event, and wires Task/Project/Ticket creation, completion, soft-delete creation reversal, and awarded-cycle reopen reversal through the existing central Gamification XP service.
- Creation XP invariants confirm Task, Project, and Ticket creation awards configured Creation XP to the creator only, uses dynamic custom-role creation rules, is idempotent, records explicit skipped events for missing/disabled rules or inactive/missing creators, reverses creation awards exactly once on soft delete/archive/delete, and restore cannot farm creation XP.
- Completion XP invariants confirm Task completion awards active assignees only, Project completion awards the owner only, Ticket completion awards the reliable resolver/current-cycle assignee only, followers/project members/non-recipients receive no completion XP, work Department controls rule resolution, Workspace defaults apply only without Department override, Project `xpCategory` drives Project XP, and current rules are snapshotted at event time.
- Component and cycle invariants confirm Base XP, Early Bonus, and Late Penalty are separate XP ledger entries linked to one durable Work XP Event, the Phase 10.8 calculator is reused, no-deadline completion receives Base only, component commits are transactionally atomic, reopen is a compensating reversal rather than a penalty, and recompletion creates a new cycle using current rule and target/deadline.
- Reopen and reset-safety invariants confirm reopen reverses the previous awarded completion cycle exactly, reverses original recipients rather than current recipients, never reverses Creation XP, requires a new future target/deadline when an XP-awarded cycle exists, double reversal cannot occur, partial reversal is forbidden, XP floor protection remains active, and post-reset reopen records a neutralized skipped event instead of deducting unrelated later XP.
- Ticket-specific invariants confirm Ticket SLA history remains untouched, reopened Tickets use `gamificationResolutionTargetAt` as the separate Gamification target for the next resolution cycle, and the target can be supplied only on qualifying reopen rather than silently mutating future Ticket XP calculations.
- Derived-state and isolation invariants confirm existing Achievement and Streak semantics remain intact, positive XP can naturally trigger existing `XP_TOTAL_AT_LEAST` Achievements, Levels and Leaderboards remain derived from the XP ledger, Reward Points are not awarded directly by Task/Project/Ticket events, Task/Project/Ticket services do not write XP ledger rows directly, and no public arbitrary XP Engine endpoint exists.
- Security and scope search confirms cross-Workspace work relations are rejected by existing tenant fences, no role-name authorization was introduced, no Redis XP authority, XP worker, Reward Point work award, historical XP backfill, notification, automation, or Phase 10.10 scope was introduced.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase109_clean_20260922` with all 48 migrations applied, including `0048_phase10_9_xp_engine_work_events`; `prisma migrate status` reports the schema is up to date.
- Phase 10.9 implementation verification passed: focused API gamification tests 67/67, API unit 136/136, Web unit 126/126, Worker unit 13/13, API integration 103/103, Worker integration 13/13, E2E 21/21, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.9 XP Engine + Task / Project / Ticket Integration focused checklist is pass; the next step is Phase 10.9 Final Completion Verification, and Phase 10.10 must not start automatically.
- Focused XP Engine coverage confirms automatic configured Creation XP for Task/Project/Ticket, creator-only creation awards, custom-role Creation XP, idempotent creation awards, exact once-only creation reversal on delete/archive, and restore attempts do not farm additional Creation XP.
- Focused completion coverage confirms Task completion awards qualifying active assignees only, Project completion awards Owner only, Ticket completion awards the reliable current-cycle resolver only, followers/project members do not receive completion XP, no-deadline completion receives Base only, and Base/Bonus/Penalty components link to the same durable Work XP Event.
- Focused rule and snapshot coverage confirms Work Department controls Point Rule resolution, Workspace defaults apply only without Department override, Department overrides snapshot rule source and values, Project `xpCategory` drives Project XP, and historical Work XP Events are not rewritten by later rule edits.
- Focused reopen/recompletion coverage confirms reopen is a compensating reversal rather than a penalty, reverses the previous cycle exactly, reverses original awarded entries, does not reverse Creation XP, duplicate reopen cannot double reverse, recompletion creates a new cycle using current rule and a new deadline/target, and post-reset reopen does not deduct unrelated later XP.
- Focused isolation coverage confirms existing Achievement/Streak semantics remain intact, `XP_TOTAL_AT_LEAST` Achievements can react naturally, Levels and Leaderboards remain derived, no direct Reward Point award occurs, Task/Project/Ticket services do not write XP ledger rows directly, no public arbitrary XP Engine endpoint exists, no historical backfill/worker/Redis authority exists, and no Phase 10.10 scope was introduced.
- Clean Prisma migration deploy passes on isolated scratch database `zea_play_phase109_focused_clean_20260922` with all 48 migrations applied, including `0048_phase10_9_xp_engine_work_events`; `prisma migrate status` reports the schema is up to date.
- Phase 10.9 focused verification passed: focused API gamification tests 72/72, API unit 141/141, Web unit 126/126, Worker unit 13/13, API integration 103/103, Worker integration 13/13, E2E 21/21, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check`.
- Phase 10.9 XP ENGINE + TASK / PROJECT / TICKET INTEGRATION is complete/pass; the next step is Phase 10.10 XP Control Center + Analyzer + Reconciliation, and it must not start automatically.
- Final Phase 10.9 verification confirms real Task/Project/Ticket lifecycle events automatically drive XP through the central Work XP Engine and immutable XP ledger; no manual employee Claim XP action or public arbitrary XP write endpoint exists.
- Final Creation XP invariants confirm eligible internal creators receive role-specific Creation XP once per entity lifetime, custom roles remain supported, restore does not re-award Creation XP, and soft-delete/void reverses Creation XP exactly once without mutating historical rows.
- Final Completion XP invariants confirm Task completion XP goes to qualifying active assignees, Project completion XP goes to Project Owner only, Ticket completion XP goes to the reliable resolver for each XP completion cycle, and Task approval semantics remain authoritative.
- Final rule/category invariants confirm work-item Department determines Point Rule scope, effective rules resolve at event time with Department override over Workspace default over not configured, Task priority drives Task XP category, Project `xpCategory` drives Project XP category, and Ticket priority drives Ticket XP category.
- Final Work XP Event invariants confirm `GamificationWorkXpEvent` is durable append-only source-calculation history, records applied and skipped outcomes, snapshots historical rules/calculations, and deterministically links generated XP ledger components without becoming current balance authority.
- Final component invariants confirm Base, Bonus, and Penalty are separate ledger components, completion components commit atomically, Phase 10.8 Point Calculator remains the timing authority, no-deadline completion receives Base only, missing/disabled rules create explicit skipped outcomes, and timing penalties cannot consume unrelated prior XP.
- Final historical invariants confirm no mass XP backfill exists, existing open work may earn future Completion XP, historical completed work is not mass-awarded, and historical snapshots are not rewritten by later rule changes.
- Final reopen/recompletion invariants confirm completion-cycle identity remains deterministic, reopen is not a penalty, reopen reverses exact prior completion-cycle XP for original historical recipients, reopen never reverses Creation XP, reopen requires a new future target/deadline, terminal-to-nonterminal paths enforce reopen invariants, double reversal and unsafe partial reversal are impossible, XP reset neutralization prevents unrelated later XP deductions, unresolved exact-reversal floor conflict blocks safely, and recompletion creates a new cycle using current rules/context.
- Final Ticket invariants confirm historical SLA semantics remain preserved and reopened Tickets use a separate `gamificationResolutionTargetAt` target for future Gamification timing.
- Final regression invariants confirm Task/Project/Ticket Achievement semantics remain unchanged, Streak semantics remain unchanged, XP_TOTAL Achievements may naturally react to resulting XP, Levels and Workspace Leaderboards remain derived, and work events do not directly award Reward Points.
- Final isolation/scope invariants confirm source module authorization remains authoritative, cross-Workspace XP relations are fenced, no XP worker/Redis authority/new event bus/microservice was introduced, no XP Control Center/Reconciliation UI exists yet, no global score normalization exists yet, no Agency/Super Admin global leaderboard exists yet, no Developer Gamification dashboard exists yet, and Phase 7 through Phase 10.8 remain green.
- Final security search found no direct Task/Project/Ticket `GamificationXpEntry` inserts, no client-authoritative XP amounts or completion timestamps for awards, no follower/project-member/requester completion XP path, no Project priority XP-category mixup, no Ticket EMERGENCY enum, no duplicated timing calculator, no standalone late penalty, no reopen-as-penalty path, no historical XP backfill, no manual XP claim button, no direct Reward Point work award, and no Phase 10.10+ UI surface.
- Final migration status on local database `zea_play`: 48 migrations found, including `0048_phase10_9_xp_engine_work_events`, and `prisma migrate status` reports the database schema is up to date with no pending migrations.
- Phase 10.9 final verification passed: focused API gamification tests 72/72, API unit 141/141, Web unit 126/126, Worker unit 13/13, API integration 103/103, Worker integration 13/13, E2E 21/21, `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`, `pnpm audit --audit-level high`, `git diff --check`, and migration status.

### Phase 10.10 - PASS

XP Control Center + Analyzer + Reconciliation.

Implemented:

- Added Workspace XP Control Center APIs under existing `/workspaces/:workspaceId/gamification/xp-control/*`, guarded by `gamification.xp_control.view` and `gamification.xp_control.reconcile`.
- Added analyzer rows with User, Claimed XP, Stored XP, Current XP, Delta, Status, and Action. Claimed XP is derived from immutable `GamificationWorkXpEvent` snapshots; Stored XP is limited to linked work XP ledger rows plus reconciliation corrections; Current XP remains the full XP ledger balance.
- Added durable `GamificationXpReconciliation` records and deterministic ledger links through `GamificationXpEntry.reconciliationId`, with migration, seed permissions, and immutable applied/no-change reconciliation guard.
- Added preview/apply reconciliation flow with explicit `RECONCILE`, reason, stale snapshot reanalysis, floor conflict checks, idempotency, audit logging, and central Gamification XP service ledger insertion.
- Added XP Control Center tab inside existing `/workspace/gamification`, including analyzer filters, detail/source breakdown, XP log categories, preview, and apply controls. Manual add/deduct/reset remain in the existing Admin tab.

Security and scope invariants:

- Reconciliation never mutates historical work events or old XP ledger rows; it writes a new correction entry linked to an immutable reconciliation record.
- Work mismatch uses `delta = claimedXp - storedXp`; current XP is displayed and protected by floor checks but is not used to compute mismatch.
- Achievement, Streak, manual adjustment, reset, legacy, and other non-work XP remain visible in logs/breakdown/current balances but do not create Work XP mismatches.
- No auto-fix, worker/Redis XP authority, Agency/Super Admin global view, Developer dashboard, global score normalization, or Phase 10.11 scope was introduced.

Verification:

- `pnpm prisma:generate`
- `pnpm prisma:validate`
- `pnpm --filter @zea-play/api typecheck`
- `pnpm --filter @zea-play/web typecheck`
- `pnpm --filter @zea-play/web test -- phase10-1.test.tsx` (6 files, 127 tests passed)
- `pnpm --filter @zea-play/api test -- gamification.service.spec.ts --runInBand` (72 tests passed)

Phase 10.10 XP CONTROL CENTER + ANALYZER + RECONCILIATION is complete/pass; the next step is Phase 10.10 Focused Refinement.

### Phase 10.10 Focused Checklist - PASS

XP Control Center + Analyzer + Reconciliation focused hardening.

Refinements:

- Reconciliation apply now uses a server-signed preview token instead of client-authoritative claimed/stored/current/delta values.
- Server re-analysis compares signed claimed, stored, current, delta, status, and anomaly snapshot fields immediately before new correction.
- Exact idempotent reconciliation retry now replays the existing reconciliation before stale-state rejection, preventing duplicate ledger or audit effects.
- Review-required anomalies now derive `NEEDS_REVIEW` before `MISMATCH`, and reconciliation preview/apply rejects unprovable rows.
- XP log Task/Project/Ticket filters now use linked `GamificationWorkXpEvent.workType` instead of source-type guessing.
- Legacy XP filtering now excludes reset, manual, classified non-work, and reconciliation rows so unclassified XP stays honest.
- XP Control frontend apply sends only target, signed preview token, reason, confirmation, and idempotency key.
- XP Control reconcile controls are shown only for `MISMATCH` rows with reconcile permission.
- Stale reconciliation errors clear the old preview/confirmation state; admins must refresh analysis.
- Workspace switch clears XP Control filters, pagination, selected member, log category/page, reason, preview, and confirmation.
- Main table tooltips now state Claimed, Stored, and Current XP semantics.

Focused invariants:

- Claimed XP is immutable expected source XP, never current XP.
- Stored XP is actual reconcilable linked ledger XP plus valid reconciliation corrections.
- Current XP is the complete immutable XP ledger balance.
- Delta is strictly Claimed minus Stored.
- Manual, reset, Achievement, and Streak XP never create false work-source mismatches.
- Historical Work XP Event snapshots remain calculation authority; current Point Rules are never used to recalculate historical XP.
- Intentional skipped work events do not become fake mismatches.
- Ambiguous/unprovable anomalies become `NEEDS_REVIEW`.
- Analyzer status is derived from current source/ledger state, and historical `RECONCILED` state cannot mask a new mismatch.
- Analyzer list remains set-based, Workspace fenced, bounded, and server paginated; mismatch/status filters are applied before pagination.
- Member detail summary matches main analyzer.
- XP source breakdown avoids Base/Bonus/Penalty/Reversal double counting.
- XP log is server paginated and deterministically ordered.
- Legacy XP remains visible without guessed source mapping.
- Reconciliation preview is server-authoritative.
- Server re-analysis is mandatory immediately before new correction.
- Stale analysis is rejected even when Delta coincidentally remains unchanged.
- Correction amount is server-derived current proven Delta.
- Negative floor conflict rejects without partial correction.
- Reconciliation is one-member-at-a-time and human confirmed; no automatic, bulk, or Fix-All reconciliation exists.
- Reconciliation uses the central XP service.
- Existing Work XP Events and ledger rows remain immutable.
- One durable reconciliation record maps to one corrective ledger effect.
- Valid cumulative reconciliation corrections participate in Stored XP accounting.
- Reconciliation is idempotent and duplicate audits are prevented.
- Reconciliation does not grant manual-adjust/reset privileges.
- Inactive membership reconciliation is denied.
- Cross-Workspace analysis/reconciliation is blocked by tenant fencing and membership lookup.
- Existing Phase 10.7 manual adjustment and OTP reset flows are reused.
- `/workspace/gamification` remains the single route.
- XP Control Center remains functional, while Phase 10.14 still owns final UI consolidation.
- No Global Score Normalization, Agency/Super Admin Global Leaderboard, Developer Gamification dashboard, analyzer/reconciliation worker, or Redis authority exists.
- Phase 7 through Phase 10.9 remain green.

Verification:

- Focused API gamification tests: 77/77.
- Focused Web XP Control tests: Phase 10 web suite 127/127.
- API unit: 146/146.
- Web unit: 127/127.
- Worker unit: 13/13.
- API integration: 103/103.
- Worker integration: 13/13.
- E2E: 21/21.
- `pnpm prisma:generate`: pass.
- `pnpm prisma:validate`: pass.
- `pnpm format`: pass.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm test`: pass.
- `pnpm test:integration`: pass.
- `pnpm test:e2e`: pass.
- `pnpm build`: pass.
- `pnpm audit --audit-level high`: pass with one moderate advisory.
- Clean migration deploy: pass, no pending migrations.
- Migration status: database schema up to date, 49 migrations.
- `git diff --check`: pass with LF-to-CRLF warnings only.

Phase 10.10 XP CONTROL CENTER + ANALYZER + RECONCILIATION Focused Checklist is pass; the next step is Phase 10.10 Final Completion Verification, and it must not start automatically.

### Phase 10.10 Final Completion Verification - PASS

XP Control Center + Analyzer + Reconciliation is complete/pass.

Final invariants:

- XP Control Center remains Workspace/Subaccount scoped.
- Primary analyzer columns are User / Claimed XP / Stored XP / Current XP / Delta / Status / Action.
- Claimed XP is immutable expected reconcilable source XP.
- Stored XP is actual source-linked ledger XP plus valid reconciliation corrections.
- Current XP is the complete immutable XP ledger balance.
- Delta is strictly Claimed minus Stored.
- Current Point Rules never recalculate historical Work XP.
- Intentional source skips do not create false mismatches.
- Unprovable anomalies are `NEEDS_REVIEW`, and `NEEDS_REVIEW` takes precedence over guessed mismatch.
- Achievement, Streak, manual, and reset XP never create false work-source mismatch.
- Analyzer remains set-based, server-authoritative, Workspace fenced, bounded, and server paginated.
- Filters/status/mismatch semantics are applied before pagination.
- Member detail summary matches analyzer.
- XP source breakdown avoids double counting.
- Work XP log classification uses relational Work XP Event semantics.
- Legacy/unclassified XP remains honest and is not guessed.
- Reconciliation preview is server-generated.
- Signed preview state prevents client correction authority.
- Server re-analysis is mandatory before reconcile.
- Stale analysis is rejected even if Delta coincidentally matches.
- Correction amount is current server-proven Delta.
- Floor conflicts reject with no clamp or partial correction.
- Reconciliation uses the central XP service.
- Original Work XP Events and ledger rows remain immutable.
- Valid reconciliation corrections participate in effective Stored XP.
- Reconciliation records and corrective ledger entries are deterministically linked.
- Reconciliation is idempotent; exact retries return the prior committed result without duplicate audit.
- Conflicting idempotency keys are rejected.
- No automatic, bulk, or Fix-All reconciliation exists.
- Manual Add/Deduct still uses Phase 10.7 controls.
- Reset still uses Phase 10.7 password + Email OTP security.
- Permissions remain separated between view, reconcile, adjust, and reset.
- Inactive membership reconciliation is denied.
- Cross-Workspace analysis/reconciliation is blocked.
- `/workspace/gamification` remains the single Workspace Gamification route.
- XP Control Center remains a functional tab.
- No Global Score Normalization exists yet.
- No Agency/Super Admin Global Leaderboard work exists yet.
- No Developer Gamification Dashboard exists yet.
- No analyzer/reconciliation worker or Redis authority exists.
- Phase 7 through Phase 10.9 remain green.

Final verification:

- Focused XP Control / Analyzer / Reconciliation / XP log API tests: 77/77.
- Focused frontend XP Control tests: Phase 10 web suite 127/127.
- API unit: 146/146.
- Web unit: 127/127.
- Worker unit: 13/13.
- API integration: 103/103.
- Worker integration: 13/13.
- E2E: 21/21.
- `pnpm prisma:generate`: pass.
- `pnpm prisma:validate`: pass.
- `pnpm format`: pass.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm test`: pass.
- `pnpm test:integration`: pass.
- `pnpm test:e2e`: pass.
- `pnpm build`: pass.
- `pnpm audit --audit-level high`: pass with one moderate advisory.
- Clean Prisma migration deploy: pass, no pending migrations.
- Migration status: database schema is up to date, 49 migrations.
- `git diff --check`: pass with LF-to-CRLF warnings only.

Phase 10.10 XP CONTROL CENTER + ANALYZER + RECONCILIATION is complete/pass; the next step is Phase 10.11 Global Score Normalization Engine, and it must not start automatically.

### Phase 10.11 - PASS

GLOBAL SCORE NORMALIZATION ENGINE implementation is complete/pass.

Implemented:

- Platform/global immutable `GamificationGlobalScoreBaseline` snapshots with no Workspace ownership.
- Immutable `GamificationGlobalScoreEvent` history linked deterministically one-to-one to `GamificationWorkXpEvent`.
- Completion baselines from enabled active Workspace-default point rules only, grouped by `workType + category + COMPLETION`.
- Creation baselines from enabled active Workspace-default creation rules, role-neutralized by averaging roles inside each Workspace before global averaging.
- Minimum two eligible Workspace contributions required for READY baselines; otherwise INSUFFICIENT_SAMPLE snapshots are recorded.
- Deterministic integer half-up rounding for baseline averages.
- Synchronous baseline recalculation after meaningful Workspace-default point rule changes only.
- Department overrides remain local and do not recalculate global baselines.
- Global normalizer consumes trusted Work XP Events, not raw Task/Project/Ticket DTOs.
- Applied creation events use the creation baseline and ignore local creation XP amounts.
- Applied completion events reuse the Phase 10.8 completion point calculator against normalized baseline snapshots and historical due/completed snapshots.
- Local NOT_CONFIGURED, RULE_DISABLED, and role-neutral eligible creation skip events can still normalize globally when the real work event is valid.
- Missing category, inactive/no-recipient, unsupported skip, and no-baseline cases are recorded honestly as skipped normalized evaluations.
- Reversal events reverse the exact prior applied Global Score Event and do not use the current baseline.
- Recompletion awards use the latest READY baseline and never recalculate prior normalized history.
- Global Score aggregates are derived as signed sums of APPLIED Global Score Events for member, Workspace, and agency foundation helper scopes.
- No Global Score XP ledger writes, public arbitrary normalization endpoint, UI tab, Agency/Super Admin leaderboard, Developer Dashboard, worker, or Redis authority was introduced.

Invariants:

- Local XP remains unchanged and continues to control levels, Workspace leaderboards, achievements, admin adjustment/reset, and XP Control reconciliation.
- Achievement XP, Streak XP, manual XP, reset XP, reconciliation corrections, Reward Points, redemptions, level/badge/leaderboard state, and legacy/unclassified XP do not feed Global Score.
- Historical global score events snapshot their baseline id/version and normalized values; historical rules are never recalculated with current Point Rules.
- Work XP Event history remains immutable.
- Old XP ledger rows remain immutable.
- Baseline and Global Score Event rows are append-only with database immutability triggers.
- Reversal links are unique; duplicate retries create one normalized effect.
- No global score floor is applied.
- Cross-Workspace tenant fences remain on Workspace-scoped source events and aggregate helpers.
- `/workspace/gamification` remains the only Workspace Gamification route; no 10.12 scope was introduced.

Verification:

- Focused normalization service tests: 83/83.
- API unit: 152/152.
- Web unit: 127/127.
- Worker unit: 13/13.
- API integration: 103/103.
- Worker integration: 13/13.
- E2E: 21/21.
- `pnpm prisma:generate`: pass.
- `pnpm prisma:validate`: pass.
- `pnpm format`: pass.
- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- `pnpm test`: pass.
- `pnpm test:integration`: pass after applying migration 0050 to the local integration database.
- `pnpm test:e2e`: pass.
- `pnpm build`: pass.
- `pnpm audit --audit-level high`: pass with one moderate advisory.
- Clean Prisma migration deploy: pass; migration 0050 applied successfully.
- Migration status: database schema is up to date, 50 migrations.
- `git diff --check`: pass with LF-to-CRLF warnings only.

Phase 10.11 GLOBAL SCORE NORMALIZATION ENGINE Implementation is complete/pass; the next step is Phase 10.11 Focused Refinement, and Phase 10.12 must not start automatically.

### Phase 10.11 Focused Refinement - PASS

GLOBAL SCORE NORMALIZATION ENGINE focused checklist is complete/pass.

Focused invariants verified:

- Local XP remains unchanged and normalized Global Score is separate from XP.
- Only Task/Project/Ticket real work contributes through trusted Work XP Events.
- Achievement XP, Streak XP, manual XP, reset XP, XP reconciliation, Reward Points, redemptions, levels, badges, and local leaderboards do not feed Global Score.
- Completion baselines are separated by Work Type + Category and use enabled active Workspace-default rules only.
- Department overrides do not feed global baselines.
- Each Workspace counts once per Completion bucket.
- Missing/disabled rules are excluded rather than treated as zero.
- Minimum two eligible Workspaces are required for READY baselines.
- All Completion rule parameters are averaged with deterministic integer half-up rounding.
- Phase 10.8 completion calculator remains the normalized completion scoring engine.
- Creation baselines average roles inside each Workspace first, then average Workspace contributions globally.
- Custom role names are not compared across tenants, and Workspaces with more roles are not overweighted.
- Baseline versions and normalized score events are immutable/idempotent.
- Historical normalized scores snapshot exact baseline version and values.
- Baseline changes affect future events only.
- One Work XP Event gets at most one normalized evaluation.
- Local `RULE_DISABLED` and `NOT_CONFIGURED` real work can still normalize globally.
- Missing Project category is not guessed.
- Inactive recipients are not globally scored.
- Reopen and creation delete reverse the exact prior normalized score and do not use the current baseline.
- Recompletion uses the current READY baseline.
- Restore does not re-award creation XP or Global Score.
- Pre-10.11 work is not backfilled.
- XP reset, manual XP, and reconciliation corrections do not affect Global Score.
- Workspace and Department leaderboards remain local-XP based.
- User Global Score is the signed normalized-event sum.
- Workspace Global Score is the all-user normalized-event sum.
- Agency score helper foundation exists without leaderboard UI.
- No user-count or Workspace-size normalization exists.
- Baseline queries are set-based with no N+1 Workspace baseline query.
- Cross-tenant Point Rule details are not exposed through Global Score APIs.
- No global leaderboard UI, Developer Dashboard UI, Redis Global Score authority, or Phase 10.12+ scope was introduced.

Focused additions:

- Added tests proving missing Project category and inactive recipient Work XP Events record skipped Global Score evaluations without applying score.
- Added tests proving manual XP and reset XP do not create Global Score events.

Verification:

- Focused Global Score / Gamification service tests: 85/85.
- API unit: 154/154.
- Web unit: 127/127.
- Worker unit: 13/13.
- `pnpm format`: pass.
- `pnpm typecheck`: pass.
- `pnpm test`: pass.
- Prisma migration status: schema is up to date, 50 migrations.

Phase 10.11 GLOBAL SCORE NORMALIZATION ENGINE Focused Refinement is complete/pass; the next step is Phase 10.11 Final Completion Verification, and Phase 10.12 must not start automatically.

### Phase 10.11 Final Completion Verification - PASS

Phase 10.11 — GLOBAL SCORE NORMALIZATION ENGINE is COMPLETE / PASS.

Final reconfirmed invariants:

- No historical Global Score backfill exists.
- Department overrides do not contribute to global baselines.
- Manual, reset, reconciliation, Achievement, and Streak XP do not contribute to Global Score.
- No Agency/Super Admin leaderboard UI was introduced.
- No Developer Dashboard scope was introduced.
- No Redis Global Score authority was introduced.
- No Phase 10.12 code was introduced during Phase 10.11 final verification.

Final verification:

- API integration: 103/103.
- Worker integration: 13/13.
- E2E: 21/21.
- `pnpm build`: pass.
- `pnpm audit --audit-level high`: pass with one moderate advisory.
- Clean Prisma migrate deploy: pass on isolated scratch database `zea_play_phase1011_final_clean_20260922`, all 50 migrations applied through `0050_phase10_11_global_score_normalization`.
- Prisma migrate status: database schema is up to date, 50 migrations.

Phase 10.11 — GLOBAL SCORE NORMALIZATION ENGINE is COMPLETE / PASS. Next: Phase 10.12 — Agency + Super Admin Global Leaderboards.
