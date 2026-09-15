# Zea Play Project Status

Current: Phase 6.2 - COMPLETE / PASS
Next: Phase 6.3 - Status Management

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

## Architecture Invariants

- PostgreSQL is source of truth.
- Agency -> Workspace is active tenant hierarchy.
- Workspace is operational data boundary.
- Backend tenant authorization is authoritative.
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
- E2E auth uses real protected frontend routing with mocked API responses; the previous dev-only frontend session bypass was removed.
- Future phases should extend from the existing tenant, auth, dashboard shell, theme, i18n, queue, and storage boundaries instead of replacing them.
