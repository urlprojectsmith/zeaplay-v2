# Zea Play Project Status

Current: Phase 7.3C2 - COMPLETE / PASS
Next: Phase 7.3C2 Refinement - Focused Bulk Selection UX polish/audit

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
- Workspace: Dashboard, Users, Departments, Roles & Permissions, and Status Management are IMPLEMENTED; Tasks, Projects, Tickets, Gamification, Calendar, Automation, Docs, Forms, Goals, Reports, Custom Dashboard, Notifications, Integrations, and Settings are INTENTIONALLY DEFERRED. Legacy `/dashboard/projects` remains working.

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
- Phase 7.3C is not marked complete until the requested Phase 7.3C2 refinement/final audit is complete.

## Architecture Invariants

- PostgreSQL is source of truth.
- Agency -> Workspace is active tenant hierarchy.
- Workspace is operational data boundary.
- Backend tenant authorization is authoritative.
- Workspace users/departments, roles/permissions, and statuses are tenant-scoped Workspace resources.
- Shared statuses are entity-type isolated across TASK, PROJECT, and TICKET.
- Each initialized Workspace/entity type has exactly one active default status.
- Status ordering is transactional and complete-list based.
- Frontend tenant caches must include Workspace identity, and status caches must include entity type.
- Tenant React Query cache must be cleared on session loss after hydration.
- Workspace pages must clear selected details, open editors, and draft dialogs on Workspace switch.
- Access token remains memory-only.
- Refresh token remains HttpOnly.
- CSRF protection remains enabled.
- `x-agency-id` and `x-workspace-id` are centralized.
- OWNER wildcards never cross tenant boundaries.
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
- Role
- Permission
- StatusDefinition
- Task / TaskAssignee / TaskFollower / TaskProject
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
- Phase 7.3C2 Task Bulk Selection UX is complete/pass; the next phase is Phase 7.3C2 Refinement, not Phase 7.3C3.
- E2E auth uses real protected frontend routing with mocked API responses; the previous dev-only frontend session bypass was removed.
- Future phases should extend from the existing tenant, auth, dashboard shell, theme, i18n, queue, and storage boundaries instead of replacing them.
