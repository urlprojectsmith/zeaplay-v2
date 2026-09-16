# Zea Play Project Status

Current: Phase 6 - COMPLETE / PASS
Next: Foundation Deep Audit (Phase 4 + Phase 5 + Phase 6 revalidation)

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
- `allowedDevOrigins` warning.
- Final Developer/Super Admin backend authorization.
- Final white-label backend.
- PWA.
- Business modules not yet implemented.

## Phase History

| Phase      | Status | Latest stable Git tag            |
| ---------- | ------ | -------------------------------- |
| Phase 1    | PASS   | Not identifiable in current tags |
| Phase 2    | PASS   | Not identifiable in current tags |
| Phase 3    | PASS   | `phase-3-stable`                 |
| Phase 4    | PASS   | `phase-4-stable`                 |
| Phase 5    | PASS   | `phase-5-stable`                 |
| Phase 6.1  | PASS   | Not tagged                       |
| Phase 6.2A | PASS   | Not tagged                       |
| Phase 6.2B | PASS   | Not tagged                       |
| Phase 6.2C | PASS   | Not tagged                       |
| Phase 6.2  | PASS   | Not tagged                       |
| Phase 6.3A | PASS   | Not tagged                       |
| Phase 6.3B | PASS   | Not tagged                       |
| Phase 6.3C | PASS   | Not tagged                       |
| Phase 6.3  | PASS   | Not tagged                       |
| Phase 6    | PASS   | Not tagged                       |

## Current Warnings

Confirmed current warnings:

- Next build reports: "The Next.js plugin was not detected in your ESLint configuration."
- `BrandLogo.tsx` uses `<img>` for arbitrary white-label logo URLs, producing the Next `@next/next/no-img-element` warning.
- Playwright/Next dev server reports future `allowedDevOrigins` configuration warning for `127.0.0.1` cross-origin `/_next/*` assets.
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
- E2E auth uses real protected frontend routing with mocked API responses; the previous dev-only frontend session bypass was removed.
- Future phases should extend from the existing tenant, auth, dashboard shell, theme, i18n, queue, and storage boundaries instead of replacing them.
