# Phase 14.6.1 - Full Phase 1-14 Hierarchy Gap Audit

## A. Canonical hierarchy

The canonical hierarchy for all remediation work is:

`Developer / Platform -> Super Agency -> Agency -> Sub-account / Workspace`

Definitions:

- Developer / Platform: product operator scope for diagnostics, global administration, global configuration, platform-only reports, and cross-tenant safety controls.
- Super Agency: parent commercial/account-management tenant that owns one or more Agencies.
- Agency: operating tenant below a Super Agency. Agencies own Sub-accounts / Workspaces.
- Sub-account / Workspace: execution tenant for work, projects, tasks, tickets, files, automations, API access, webhooks, integrations, gamification events, notifications, calendar data, and most user-facing collaboration objects.

The remediation must preserve the semantic difference between Super Agency, Agency, and Workspace. Existing `Agency` references must not be blindly renamed to Super Agency.

## B. Current repository hierarchy

The current repository implements this effective hierarchy:

`Developer / Platform style routes and legacy Organization -> Agency -> Workspace`

Observed structure:

- `Agency` is currently the top commercial tenant in Prisma.
- `Workspace` belongs to `Agency` through `Workspace.agencyId`.
- `Organization` and `Membership` still exist as legacy or compatibility models, but they are not the canonical parent of `Agency` or `Workspace`.
- `AgencyMembership` and `WorkspaceMembership` are the active tenant membership models.
- `AgencyTenantGuard` resolves only `agencyId`.
- `WorkspaceTenantGuard` resolves `agencyId` and `workspaceId`.
- Frontend session state persists selected Agency and selected Workspace. It does not model a selected Super Agency.
- Dashboard navigation contains Developer, Super Admin, Agency, and Workspace scopes. It does not contain a Super Agency scope.

Missing from the current repository:

- No `SuperAgency` Prisma model.
- No `Agency.superAgencyId`.
- No Super Agency membership model.
- No Super Agency tenant context.
- No Super Agency guard.
- No Super Agency invitation or onboarding path.
- No Super Agency dashboard shell or route group.
- No Super Agency reporting partition for global, agency, workspace, or user rollups.

## C. Gap summary

Critical gaps:

- Platform/global leaderboard endpoints are guarded by agency tenant context and can run all-agency aggregation queries. This must be split into Platform-only and Super Agency-scoped variants before hierarchy certification.
- Developer diagnostics authorization can be derived from agency or workspace permission state. Platform/developer diagnostics need a platform authority boundary.
- Agency creation currently creates a top-level agency directly under user identity. It must become parented under a Super Agency or be restricted to Platform/Super Agency authority.
- No persistent Super Agency parent exists, so cross-agency aggregation, membership, invitation, reporting, and audit scoping cannot be enforced at the required hierarchy level.

Required gaps:

- Add Super Agency schema, relationships, indexes, and backfill strategy.
- Add Super Agency membership, role scope, permission evaluation, guards, and tenant context.
- Update auth/session payloads to expose `superAgencies -> agencies -> workspaces`.
- Add dashboard shell, routes, navigation, switcher behavior, and settings for Super Agency.
- Add parent-scope validation to agency, workspace, task, project, ticket, gamification, automation, notification, realtime, calendar, storage, public API, webhook, inbound webhook, integration, audit, and reporting surfaces.
- Add Super Agency dimension to audit and reporting models where parent-level filtering is required.
- Add backward compatibility for existing agency/workspace clients.

Compatibility gaps:

- Existing Agency IDs must remain valid.
- Existing Workspace IDs and `x-agency-id` / `x-workspace-id` flows must continue to work.
- Existing API, webhook, integration, and worker jobs must remain workspace-authoritative.
- Existing migrations must not be rewritten. New migrations must backfill safely.
- Existing legacy Organization data must either remain compatibility-only or be explicitly mapped in a new migration plan.

## D. Phase findings 1-14

### Phase 1 - Foundation

The monorepo foundation, package layout, Prisma usage, and app separation are compatible with hierarchy remediation. Documentation and environment examples still describe the repository from the current Agency/Workspace point of view and need terminology updates after schema work.

### Phase 2 - Auth, Users, Membership, RBAC

Auth currently authenticates user identity and then derives agency or workspace tenancy from membership tables. The hierarchy gap is structural: there is no Super Agency membership, Super Agency role scope, Super Agency tenant context, or Super Agency invitation flow. RBAC must gain a parent-level scope without weakening existing workspace and agency checks.

### Phase 3 - Assets and Core Workspace Objects

Assets and related processing are workspace-owned. This remains correct. Parent-level reporting, quota, and audit views must aggregate through `Workspace -> Agency -> SuperAgency` after the parent relation exists.

### Phase 4 - Agency and Workspace Model

This is the primary architectural gap. Agency is currently modeled as the top commercial tenant. Workspace/Sub-account correctly belongs to Agency, but Agency does not belong to Super Agency.

### Phase 5 - Dashboard Shells and Navigation

Developer, Super Admin, Agency, and Workspace shells exist. Super Admin reads as a Platform shell, not a Super Agency shell. A distinct Super Agency dashboard, route scope, navigation entries, settings area, and selection state are missing.

### Phase 6 - Workspace/Sub-account Management

Workspace management is correctly agency-scoped today. After remediation, workspace operations must also prove that the agency belongs to the selected Super Agency when called from parent-level surfaces.

### Phase 7 - Tasks

Tasks are workspace-owned and correctly require workspace tenant context. Parent views must only aggregate tasks through the authorized hierarchy path and must not use ad hoc agency or workspace filters without parent validation.

### Phase 8 - Projects

Projects are workspace-owned and align with the target bottom-level ownership. Parent reporting, exports, and dashboards require Super Agency-aware filters.

### Phase 9 - Tickets

Tickets are workspace-owned and align with Workspace/Sub-account execution ownership. Parent visibility must be derived from Super Agency -> Agency -> Workspace relationships.

### Phase 10 - Gamification

Gamification events are workspace-owned, but global score and leaderboard surfaces require remediation. Platform leaderboard behavior currently depends on agency tenant context and all-agency aggregation. Super Agency leaderboards and platform-only leaderboards must be split and permissioned separately.

### Phase 11 - Automation

Automation definitions and execution are workspace-owned. Worker envelopes and queue payloads remain compatible for workspace jobs, but parent-level automation management or reporting must include Super Agency validation.

### Phase 12 - Notifications, Realtime, Calendar

Notifications, realtime rooms, and calendar events are workspace-oriented. Parent dashboards must aggregate only through authorized Super Agency and Agency membership paths. Broadcast and subscription paths must not leak across parent boundaries.

### Phase 13 - Storage, Files, Cloud Drives

Storage assets and drive linkages are workspace-owned. Lifecycle, quota, archive, restore, purge, and cloud-drive views require parent-level aggregation only after Workspace -> Agency -> SuperAgency is available.

### Phase 14 - API, Webhooks, External Integrations

Public API keys, webhooks, inbound webhooks, and external integrations are workspace-scoped and should remain workspace-authoritative. Management dashboards and audit/reporting surfaces must add Super Agency partitioning without changing existing delivery semantics.

## E. Model ownership matrix

| Area                         | Current owner                         | Required owner                                    | Remediation                                                      |
| ---------------------------- | ------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| User                         | Global identity                       | Global identity                                   | Keep global, add Super Agency membership relations               |
| Organization                 | Legacy compatibility                  | Compatibility or deprecated platform construct    | Do not treat as Super Agency without explicit migration design   |
| Agency                       | Top commercial tenant                 | Child of Super Agency                             | Add `superAgencyId`, indexes, constraints, backfill              |
| Workspace                    | Agency child                          | Agency child / Workspace execution tenant         | Keep direct agency owner; validate agency parent in parent flows |
| Membership                   | Organization legacy                   | Compatibility only                                | Preserve or migrate deliberately                                 |
| AgencyMembership             | Agency                                | Agency                                            | Keep, but evaluate with Super Agency parent where required       |
| WorkspaceMembership          | Workspace                             | Workspace                                         | Keep                                                             |
| SuperAgencyMembership        | Missing                               | Super Agency                                      | Add                                                              |
| Role / Permission            | Platform/Agency/Workspace style       | Platform/Super Agency/Agency/Workspace            | Add Super Agency scope and permission checks                     |
| Invitations                  | Missing from schema audit             | Super Agency, Agency, Workspace as needed         | Add or document deferred invitation model                        |
| FeatureEntitlement           | Agency or Workspace                   | Super Agency, Agency, Workspace                   | Add Super Agency policy layer                                    |
| AuditLog                     | Organization, Agency, Workspace, User | Super Agency, Agency, Workspace, User             | Add `superAgencyId` and parent-report filters                    |
| Tasks                        | Workspace                             | Workspace                                         | Keep; validate parent aggregation                                |
| Projects                     | Workspace                             | Workspace                                         | Keep; validate parent aggregation                                |
| Tickets                      | Workspace                             | Workspace                                         | Keep; validate parent aggregation                                |
| Assets / Storage             | Workspace                             | Workspace                                         | Keep; add parent reporting                                       |
| Automations                  | Workspace                             | Workspace                                         | Keep; add parent reporting                                       |
| Notifications                | Workspace/User                        | Workspace/User                                    | Keep; add parent-safe dashboard filtering                        |
| Calendar                     | Workspace                             | Workspace                                         | Keep                                                             |
| Public API keys              | Workspace                             | Workspace                                         | Keep                                                             |
| Outbound webhooks            | Workspace                             | Workspace                                         | Keep                                                             |
| Inbound webhooks             | Workspace                             | Workspace                                         | Keep                                                             |
| External integrations        | Workspace                             | Workspace                                         | Keep                                                             |
| Gamification events          | Workspace                             | Workspace                                         | Keep                                                             |
| Global scores / leaderboards | Platform/Agency/Workspace aggregation | Platform and Super Agency partitioned aggregation | Split routes, guards, and queries                                |
| Workers / queues             | Workspace job authority               | Workspace job authority                           | Keep current jobs; add parent metadata only for parent jobs      |

## F. Dashboard matrix

| Dashboard             | Current state                   | Required state                 | Finding                                                   |
| --------------------- | ------------------------------- | ------------------------------ | --------------------------------------------------------- |
| Developer / Platform  | Present                         | Present                        | Must use platform authority, not agency-derived authority |
| Super Admin           | Present as platform-style scope | Platform admin or renamed role | Do not confuse with Super Agency                          |
| Super Agency          | Missing                         | Required                       | Add shell, route, nav, settings, selection state          |
| Agency                | Present                         | Required under Super Agency    | Add parent context awareness                              |
| Workspace/Sub-account | Present                         | Required under Agency          | Keep; validate parent path when entered from parent scope |

## G. Auth/RBAC gaps

- `AgencyTenantContext` has no Super Agency parent.
- `WorkspaceTenantContext` has no Super Agency parent.
- `WorkspaceAccessSource` only distinguishes direct workspace membership and agency administration.
- `RoleScope` does not provide a Super Agency scope.
- Permission checks can authorize broad behavior from agency/workspace context where platform or Super Agency context is required.
- JWT identity is usable, but tenancy must be resolved into the full hierarchy for parent operations.

## H. Backend/service gaps

- Agency creation is not parented.
- Agency listing is user membership based and not grouped by Super Agency.
- Workspace services validate Agency -> Workspace but cannot validate Super Agency -> Agency -> Workspace.
- Feature entitlement services do not have a Super Agency layer.
- Reporting and aggregation services cannot partition by Super Agency.
- Audit services cannot store or query by Super Agency.
- Public API, webhook, inbound webhook, and integration services are workspace-safe but parent management views need hierarchy-aware filters.

## I. Worker gaps

Current worker jobs are mostly safe because they are workspace-authoritative:

- Asset processing uses workspace/project/asset ownership checks.
- Webhook delivery validates subscription and event workspace consistency.
- Queue names are not hierarchy-specific and can remain stable.

Required future worker work:

- Add Super Agency metadata only for parent-scope reporting or parent jobs.
- Ensure any new parent worker job validates Super Agency -> Agency -> Workspace before processing.
- Do not weaken existing workspace ownership checks.

## J. Frontend gaps

- Session state lacks Super Agency selection.
- Auth `/me` client shape lacks `superAgencies -> agencies -> workspaces`.
- Dashboard scope types lack Super Agency.
- Navigation lacks Super Agency dashboard, management, reporting, settings, and switcher entries.
- Agency dashboards assume Agency is the highest customer tenant.
- Workspace screens are mostly compatible but need parent breadcrumb and parent validation paths.

## K. Migration/backfill requirements

Required migration sequence:

- Create `SuperAgency` model with status, slug/name constraints, audit timestamps, and owner/creator fields as needed.
- Add `Agency.superAgencyId` as nullable for expand phase.
- Backfill existing agencies into one or more default Super Agencies. The default strategy must be explicit and reversible before production.
- Add indexes and foreign keys for `SuperAgency -> Agency`.
- Add Super Agency membership and invitation tables.
- Add Role/RBAC Super Agency scope.
- Add `AuditLog.superAgencyId` or an equivalent parent audit link.
- Add Super Agency support to feature entitlements.
- Add query backfills and compatibility views where necessary.
- Contract nullable fields only after application code is deployed and validated.

Rules:

- Do not edit historical migrations.
- Do not apply migrations to the shared development database during audit.
- Use new forward migrations only.
- Preserve existing Agency and Workspace IDs.

Phase 14.6.2 implementation decision:

- `Organization` is retained as a legacy compatibility model. It is not renamed to Super Agency and is not treated as canonical tenant authority.
- `SuperAgency` is the canonical persisted parent tenant for Agency.
- `Agency.superAgencyId` is required in the final schema.
- `Workspace` remains owned by `Agency`; `Workspace.superAgencyId` was intentionally not added.
- `SuperAgencyMembership` was added as structural membership foundation only. Full membership behavior, invitations, and permission evaluation remain Phase 14.6.3.
- `RoleScope.SUPER_AGENCY` was added as schema foundation only.
- `AuditLog.superAgencyId` was added as nullable parent-scope audit foundation.
- `FeatureEntitlement.superAgencyId` was added so existing pre-billing feature controls can evaluate Platform -> Super Agency -> Agency -> Workspace without adding plans, subscriptions, pricing, or billing.
- `TenantHierarchyService` centralizes parent lookups and relationship assertions. It is hierarchy truth, not authorization policy.
- Migration `0074_phase14_6_2_super_agency_hierarchy` creates one compatibility Super Agency per existing Agency by using the existing Agency ID as the synthetic parent ID. This preserves isolation and avoids placing all legacy Agencies under one shared default parent.
- Existing Agency, Workspace, User, Membership, Task, Project, Ticket, API key, webhook, integration, and worker-owned IDs are preserved.
- Existing `x-agency-id` and `x-workspace-id` flows remain compatible. No `x-super-agency-id` is required for existing workspace requests.
- Platform Super Agency management uses the existing backend `/platform` route namespace because Phase 10 already exposes `/platform/gamification/global-leaderboard`. The frontend `/super-admin` shell remains a Platform/Super Admin UI concept and is not the Super Agency tenant.
- Super Agency list access is server-paginated with a maximum page size of 100. Status and search filters are safe bounded filters.
- Super Agency status is persisted as foundation data only. Descendant auth/session effects for `SUSPENDED` or `ARCHIVED` are explicitly deferred to Phase 14.6.3.

Phase 14.6.3 implementation decision:

- `x-super-agency-id` is the explicit Super Agency context header for Super Agency-scoped backend requests. Existing `x-agency-id` and `x-workspace-id` remain unchanged for Agency and Workspace routes.
- `TenantContextService.resolveSuperAgency` creates Super Agency tenant context only after JWT authentication, active user validation, active Super Agency membership validation, `RoleScope.SUPER_AGENCY` validation, active role validation, and active Super Agency status validation.
- `TenantContextService.resolveAgency` and `resolveWorkspace` now enforce effective parent status, so suspended or archived Super Agencies block normal descendant Agency and Workspace tenant requests without deleting descendant data.
- `SuperAgencyTenantGuard` and `PermissionGuard` authorize Super Agency routes with permission keys, not role names.
- Platform/Super Admin authority remains distinct from Super Agency membership. `SuperAgencyMembership` does not grant Platform authority.
- Super Agency membership lifecycle supports bounded listing, add/reactivate, role/status update, duplicate active membership rejection, role-scope validation, and last-owner protection.
- Super Agency default roles are `SUPER_AGENCY_OWNER`, `SUPER_AGENCY_ADMIN`, `SUPER_AGENCY_MANAGER`, and `SUPER_AGENCY_MEMBER`. Role names are templates only; permissions remain authority.
- Super Agency permissions added for this phase are `super_agency.view`, `super_agency.manage`, `super_agency.members.view`, `super_agency.members.invite`, `super_agency.members.manage`, `super_agency.roles.view`, `super_agency.roles.manage`, `super_agency.audit.view`, and `agency.create`.
- Custom Super Agency roles are scoped by tenant-prefixed role keys because the current Role table has no dedicated `superAgencyId` column. System Super Agency roles remain shared templates.
- Agency creation by normal users now requires a resolved Super Agency context and `agency.create`; the request body `superAgencyId` must match the resolved context.
- Super Agency invitations use `super_agency_invitations`, are tenant-bound, role-bound, single-use, expiring, revocable, and store only token hashes. Invitation audit metadata excludes plaintext tokens.
- Super Agency invitation API responses do not return plaintext tokens. The one-time token is delivered only through the invitation email body, while persisted storage uses `tokenHash`.
- Super Agency invitation acceptance atomically claims a still-pending, unexpired invitation before creating or reactivating membership. Reuse and concurrent second claims fail without creating a second membership.
- Super Agency invitation listing is tenant-scoped, bounded, paginated, searchable by normalized email, status-filterable, and excludes token hashes.
- Migration `0075_phase14_6_3_super_agency_auth_rbac` adds only invitation infrastructure. It does not auto-promote legacy Agency users or infer Super Agency memberships from Agency memberships.
- `/auth/me` exposes active Super Agency memberships and descendant Agency summaries while JWTs remain stable user/session identity. Tenant permissions are resolved server-side per request.
- Public API keys, outbound webhooks, inbound webhooks, integrations, storage, Tasks, Projects, and Tickets remain Workspace-owned and were not widened by Super Agency membership.
- Super Agency dashboard UI, navigation/sidebar, parent reporting, leaderboards, and Phase 15 billing/plans/payments remain deferred.

Phase 14.6.4 implementation decision:

- The five dashboard environments are distinct: Developer, Super Admin / Platform, Super Agency, Agency, and Workspace / Sub-account.
- `/super-agency` is the canonical frontend route for the Super Agency tenant shell. `/super-admin` remains the Platform / Super Admin environment and was not renamed or converted.
- The Super Agency shell uses the existing App Router and shared `DashboardRouteChrome`/dashboard shell architecture with a dedicated `super-agency` navigation scope.
- Super Agency navigation is limited to Dashboard, Agencies foundation, Members, Roles, and Settings. Billing, plans, payments, white-label, developer tools, workspace files, automations, calendar, notifications, gamification, public API, webhooks, and integrations are not exposed as Super Agency modules.
- Super Agency context selection is explicit. A stored `selectedSuperAgencyId` is a UX preference only; permissions and role authority are not persisted and backend context is revalidated through the tenant-scoped API.
- Users with multiple Super Agency memberships must explicitly select context. Single-membership streamlining remains backend-validated and does not grant authority from client state.
- Switching Super Agency clears selected child Agency and Workspace state. Super Agency React Query keys include `superAgencyId`, keeping members, roles, invitations, settings, and context cache entries tenant-scoped. Member search and invitation dialog state also reset on Super Agency switch.
- Super Agency service calls send `x-super-agency-id` only on Super Agency-scoped requests and skip inherited Agency/Workspace headers. Existing `x-agency-id` and `x-workspace-id` flows remain scoped to Agency and Workspace services.
- Super Agency header uses the Super Agency switcher, theme switcher, language switcher, and profile menu. Workspace notification center and global timer are intentionally omitted because Phase 12 notifications/realtime/timers are WorkspaceMembership-oriented.
- The Super Agency dashboard landing page shows safe tenant identity, backend-validated context, and bounded aggregate counts returned by a tenant-scoped backend endpoint. Child Agency foundation counts/lists are hidden unless the caller has parent Agency-management permission. It does not fetch all descendant Workspace data client-side.
- Members, invitations, roles, and settings pages use the Phase 14.6.3 backend authority. Invitation token and token hash fields are not modeled or displayed in frontend DTOs.
- Settings are read-only foundation fields for this phase. Status changes remain Platform-controlled; tenant users cannot unsuspend, archive, or reactivate themselves through the Super Agency shell.
- Realtime, calendar, gamification, automation, files, public API, webhooks, integrations, parent reporting, and full child Agency/Workspace management remain deferred to later 14.6 steps.

Phase 14.6.5 implementation decision:

- Super Agency parent management uses Super Agency tenant context for child Agency list, create, detail, and safe update routes. It does not require or create AgencyMembership for the parent actor.
- Child Agency list/detail queries are constrained by `Agency.superAgencyId = current Super Agency`, are server paginated, and use bounded search/status filters plus explicit sort modes.
- Agency creation through the Super Agency parent route server-assigns `superAgencyId` from the current Super Agency context. Client parent selection is not part of the UI, and foreign parent override is rejected.
- Agency updates remain safe metadata/status updates only. `superAgencyId`, Organization authority, billing fields, plan fields, and subscription fields are not updateable through this phase.
- Normal Agency-owned Workspace management keeps using Agency tenant context and existing Workspace permissions. Workspace creation assigns `agencyId` from current Agency context, and inactive Agencies cannot create child Workspaces.
- Workspace remains Agency-owned through `Workspace.agencyId`. `Workspace.superAgencyId` was not added; Super Agency parent is derived through `Workspace -> Agency -> SuperAgency`.
- Super Agency descendant Workspace visibility is metadata-only and parent-scoped through child Agency ownership validation. It exposes safe Workspace identity/status/count metadata only and does not expose Tasks, Projects, Tickets, files, calendar, automation, API keys, webhook secrets, or integration credentials.
- Parent management does not grant operational Agency or Workspace shell access. Users still need real AgencyMembership and WorkspaceMembership for ordinary child tenant shells.
- Super Agency Agency management UI lives under `/super-agency/agencies` and `/super-agency/agencies/[agencyId]`, with query/cache keys scoped by `superAgencyId` and child `agencyId`.
- Organization remains legacy compatibility data and is not used as parent authority.
- Task, Project, and Ticket parent-scope validation remains deferred to Phase 14.6.6.

Phase 14.6.5 final verification decision:

- The final parent route model remains `SuperAgencyTenantGuard` plus `PermissionGuard` for Super Agency parent management and existing Agency/Workspace tenant guards for ordinary child operational shells.
- No synthetic AgencyMembership or WorkspaceMembership is created by parent Agency management or descendant Workspace metadata views.
- Agency parent immutability is enforced by explicit update field mapping; ordinary and parent-management updates do not accept `superAgencyId` as mutable data.
- Workspace parent immutability remains enforced by Agency-context service logic; Workspace create derives `agencyId` from the current Agency context and ordinary update does not transfer parentage.
- Descendant Workspace metadata remains bounded and safe: identity, status, timezone, Agency parent summary, and member counts only. It does not expose Tasks, Projects, Tickets, files, calendar events, automation definitions, API keys, webhook secrets, integration credentials, cloud tokens, or signed URLs.
- Parent actor AuditLog metadata uses Super Agency actor context for parent Agency operations; normal Agency Workspace operations keep Agency/Workspace actor semantics.
- Child Agency and descendant Workspace lists use server-side bounded pagination, search, status filtering, allowlisted sort modes, and server-scoped aggregate counts.
- Frontend parent management now includes parent breadcrumbs, context labeling, cache keys scoped by `superAgencyId` plus child IDs and pagination params, accessible pagination controls, and distinct Agency Member versus Workspace Member labels.
- Clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`; no Phase 14.6.5 migration was added.
- Phase 14.6.6 remaining work is parent-scope validation for Tasks, Projects, and Tickets. No Phase 14.6.6 or Phase 15 implementation was started.

Phase 14.6.6 implementation decision:

- Task, Project, and Ticket remain Workspace-owned only. No `Task.superAgencyId`, `Project.superAgencyId`, `Ticket.superAgencyId`, or redundant parent ownership column was added.
- Parent visibility for Tasks, Projects, and Tickets is implemented as explicit read-only oversight routes, not as operational Workspace route widening.
- Agency parent oversight is scoped through descendant Workspaces where `Workspace.agencyId` equals the current Agency tenant context.
- Super Agency parent oversight is scoped through `Workspace -> Agency -> SuperAgency`, using the current Super Agency tenant context.
- Parent oversight uses explicit permissions: `tasks.parent.read`, `projects.parent.read`, and `tickets.parent.read`.
- Parent oversight DTOs expose safe metadata only. Task comments/proof/time entries, Project assets/files/activity/task links, and Ticket requester/conversation/internal notes/attachments are not selected.
- Parent oversight supports bounded pagination, bounded search, allowlisted sort fields, tenant-validated filters, and server-side status/priority counts.
- Client `agencyId` and `workspaceId` filters are filters only; they cannot replace tenant authority. A foreign Agency filter under Agency context resolves to an empty Workspace fence.
- Parent oversight is read-only and has no create/update/delete/reply/comment/export/file-signing side effects.
- Existing Workspace operational Task, Project, and Ticket APIs keep their normal Workspace tenant guard behavior and were not converted to parent membership access.
- No synthetic WorkspaceMembership or AgencyMembership is created for parent Task/Project/Ticket visibility.
- No frontend Super Agency Task/Project/Ticket navigation was added because this main implementation only establishes the backend read-only oversight surface and current Super Agency navigation does not expose those modules.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Phase 14.6.6 focused/final verification remains responsible for root integration, worker/e2e/build/audit, and any explicitly approved export refinement.

Phase 14.6.6 final verification decision:

- Parent Task, Project, and Ticket oversight is COMPLETE / PASS.
- Task, Project, and Ticket remain Workspace-owned only; parent scope is derived through `resource.workspaceId -> Workspace.agencyId -> Agency.superAgencyId`.
- Ordinary Workspace Task, Project, and Ticket routes remain guarded by Workspace tenant context and ordinary Workspace permissions. Parent permissions do not grant Workspace operational access.
- Agency parent oversight requires current Agency context plus the relevant parent-read permission and returns only descendant Workspace records.
- Super Agency parent oversight requires current Super Agency context plus the relevant parent-read permission and returns only records under descendant Agencies and Workspaces.
- Parent filters for Agency, Workspace, status, department, assignee, owner, and ticket assignee are filters inside the server-derived hierarchy fence. They cannot widen tenant authority.
- Parent DTOs expose safe metadata only and omit user email addresses, comments, task proof, files/assets, ticket requester detail, ticket conversations, internal notes, attachments, object keys, signed URLs, and raw operational/private relations.
- Parent list totals, status counts, and priority counts use the same hierarchy `where` fence as the list query.
- Parent oversight remains read-only: no parent create, edit, assign, status change, complete, reply, internal-note, delete, export, file-signing, storage, Automation, Notification, Realtime, Gamification, XP, GlobalScore, or AuditLog side effect was added.
- Parent-read permissions are seeded for Agency Owner/Admin and Super Agency Owner/Admin default roles only. Agency Manager/User, Super Agency Manager/Member, Workspace roles, and Platform permissions do not receive these parent-read permissions by default.
- Existing frontend Agency/Super Agency scope has no parent Task/Project/Ticket oversight product surface, so no new top-level Super Agency operational module was invented. Existing Workspace UI remains the only Task/Project/Ticket mutation surface.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Root integration remains expected-fail on stale shared development DB, which is intentionally pending migrations `0053` through `0075`; scratch API integration passed after applying all 75 migrations.
- Phase 14.6.7 next work is Gamification + Global Scores + Hierarchical Leaderboards. It was not started.

## L. Security risks

- Cross-tenant leaderboard and reporting leakage is the highest risk until Platform and Super Agency aggregations are separated.
- Agency-derived authorization must not unlock Platform/developer operations.
- Super Agency users must not see agencies outside their parent tenant.
- Agency admins must not gain Super Agency privileges automatically.
- Workspace users must not infer sibling workspaces or agencies through reports, search, realtime, storage, API, webhooks, or integration metadata.
- Backfill defaults must not accidentally group unrelated production agencies under one visible Super Agency without an access migration plan.

## M. Exact remediation sequence 14.6.2 onward

### Phase 14.6.2 - Core Tenant Schema + Super Agency Relationships

Add Super Agency schema, Agency parent relation, indexes, constraints, expand/backfill/contract plan, and compatibility strategy.

### Phase 14.6.3 - Authentication + RBAC + Membership + Invitations

Add Super Agency membership, RoleScope, permissions, guards, tenant context, invitation flows, and auth/session hierarchy payloads.

Remaining from Phase 14.6.2:

- Implement full Super Agency RBAC permission evaluation.
- Implement Super Agency invitation and onboarding flows.
- Decide final Platform authority model instead of relying on existing platform/developer guard behavior.
- Tighten tenant context requirements after legacy tests and internal callers are migrated to explicit parent context.

### Phase 14.6.4 - Dashboard Shells + Routes + Navigation + Settings

Add Super Agency dashboard shell, route scope, navigation, settings, switcher, breadcrumbs, and parent-aware frontend session state.

### Phase 14.6.5 - Agency + Workspace/Sub-account Management

Parent agency management under Super Agency. Preserve workspace creation under Agency while validating Super Agency ownership for parent calls.

### Phase 14.6.6 - Tasks + Projects + Tickets Parent-Scope Validation

Validate parent aggregation and reporting for workspace-owned work objects.

### Phase 14.6.7 - Gamification + Global Scores + Hierarchical Leaderboards

Split Platform, Super Agency, Agency, and Workspace leaderboard scopes. Harden global-score aggregation and permission checks.

Phase 14.6.7 implementation decision:

- Workspace XP leaderboards remain Workspace-local and continue to rank local XP only.
- Agency, Super Agency, and Platform Global Leaderboards all reuse the existing canonical Global Score source: signed `APPLIED` `GamificationGlobalScoreEvent.normalizedScore` summed through descendant Workspaces.
- No scoring formula, baseline calculation, minimum-sample behavior, historical ledger, XP formula, XP control, reward, badge, achievement, streak, or admin-adjustment behavior was changed.
- No `GlobalScore.superAgencyId`, `GamificationXpEntry.superAgencyId`, or other duplicate score-authority column was added.
- Super Agency leaderboard scope is derived through `gamification_global_score_events.workspace_id -> workspaces.agency_id -> agencies.super_agency_id`.
- Platform leaderboard scope now includes a Super Agencies tab derived through `super_agencies -> agencies -> workspaces -> gamification_global_score_events`.
- Super Agency leaderboard routes are read-only and protected by `SuperAgencyTenantGuard` plus `gamification.global_leaderboard.view_super_agency`.
- Super Agency default Owner/Admin roles receive the parent leaderboard permission; Manager/Member roles do not receive it by default.
- User Global Leaderboards continue to use `WorkspaceMembership` as the ranking unit, not user identity, so one user in multiple Workspaces ranks independently per membership.
- User rows continue to exclude inactive memberships and `OPT_OUT` preferences before ranking, and anonymous users are redacted without email, phone, or raw user metadata.
- Organization totals continue to include historical applied Global Score events and do not substitute local XP, reward points, badges, levels, or streak state.
- Frontend query keys include Super Agency tenant id and tab/filter params to avoid cache bleed during tenant switching.
- Super Agency UI adds a read-only `/super-agency/gamification` Global Leaderboard with Agencies, Subaccounts, and Users tabs; no XP Control Center or mutation controls were added.
- Platform UI adds a Super Agencies leaderboard tab while preserving Agencies, Subaccounts, and Users tabs.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Focused refinement/final verification remains responsible for root integration, build/e2e/audit, and any follow-up defects discovered by broader runs.

Phase 14.6.7 final verification decision:

- Gamification, Global Scores, and Hierarchical Leaderboards are COMPLETE / PASS for Phase 14.6.7.
- Workspace XP remains local XP only; parent Global Leaderboards do not read local XP, reward points, badges, levels, streaks, or admin-adjustment state as score authority.
- Agency, Super Agency, and Platform Global Leaderboards use the same canonical formula: sum signed `APPLIED` `GamificationGlobalScoreEvent.normalizedScore` through descendant Workspaces, then rank with dense ranking and deterministic secondary ordering.
- Super Agency leaderboard scope is derived through `workspace -> agency -> superAgency`; Platform leaderboard scope is global and does not depend on selected Agency or Workspace frontend state.
- Platform Global Leaderboard routes now use Platform permission-key authority without Agency tenant headers; frontend Platform query keys exclude selected tenant context.
- User boards continue to rank `WorkspaceMembership` rows, exclude inactive and `OPT_OUT` memberships before ranking, and redact anonymous users without exposing email, phone, or raw user metadata.
- Minimum sample and baseline behavior remains unchanged. No parent query changes the insufficient-sample path.
- No Global Score historical backfill, recompute, double-normalization, baseline rewrite, or normalized-score mutation was added.
- No `superAgencyId` was added to Global Score events, XP entries, or Workspace-owned score records; parent scope is derived from existing hierarchy relations.
- Parent leaderboard reads are read-only and have no XP, reward, badge, Global Score, audit, notification, realtime, storage, automation, API, webhook, or integration side effects.
- Query/cache isolation is tenant-appropriate: Super Agency keys include Super Agency context, Agency keys remain Agency/Workspace aware where needed, and Platform keys are global.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Root integration remains expected-fail on stale shared development DB, which is intentionally pending migrations `0053` through `0075`; scratch API integration passed after applying all 75 migrations.
- Phase 14.6.8 next work is Automation + Workers + Background Processing. It was not started.

### Phase 14.6.8 - Automation + Workers + Background Processing

Validate workspace job authority and add parent-aware processing only where parent jobs are introduced.

Phase 14.6.8 implementation decision:

- Automation remains Workspace-owned. `AutomationWorkflow.workspaceId` remains the canonical owner for workflows, versions, domain events, trigger matches, executions, step executions, templates, and runtime policy.
- No `AutomationWorkflow.superAgencyId`, `AutomationExecution.superAgencyId`, `AutomationWorkflow.agencyId`, or other parent ownership column was added.
- PostgreSQL is the worker tenant/status authority. Redis/BullMQ payloads remain transport hints and do not authorize tenant scope.
- Automation execution jobs continue to carry only the authoritative `executionId`.
- The automation worker re-checks effective `Workspace -> Agency -> Super Agency` status after claiming execution and before each uncompleted business action step.
- Suspended Workspace, Agency, or Super Agency blocks queued automation business mutation as `TENANT_SUSPENDED`. Archived or unavailable hierarchy blocks as `TENANT_INACTIVE`.
- Hierarchy status failures are non-transient: execution and step are marked failed with safe error code/message and are not retried forever.
- Multi-step behavior is deterministic: completed steps are not rolled back; if hierarchy becomes blocked before a later action, the next uncompleted action fails safely and no further mutation occurs.
- Tenant reactivation does not automatically replay failed automation executions. Existing explicit Workspace replay remains the only replay path.
- Automation domain events now validate that the Task, Project, or Ticket entity belongs to the supplied Workspace before event persistence and matching.
- Event matching remains published, active, same-Workspace workflow matching only. Draft, disabled, archived, sibling Workspace, sibling Agency, and foreign Super Agency workflows are not matched.
- Automation actions remain constrained to the execution Workspace and continue to call canonical Task, Project, and Ticket services rather than direct Prisma writes for hierarchy convenience.
- CREATE_TASK cannot target a sibling Workspace; update/assign/status actions continue to require target Task, Project, Ticket, membership, status, and tag records in the execution Workspace.
- Depth, correlation, causation, invocation-key idempotency, replay idempotency, condition/branch determinism, template clone, workflow clone, and runtime policy semantics remain unchanged.
- No new automation trigger types, external action types, unsupported delay execution, ticket-tag action support, Super Agency builder, parent publish, parent replay, or parent edit route was added.
- Parent automation monitoring was not added because the existing product surface is Workspace automation monitoring only. No Agency or Super Agency parent monitoring route/UI existed to extend.
- Worker queue audit classification:
  - Automation execution: Workspace business mutation; DB execution row is authority; status checked before action.
  - Task recurrence: Workspace business mutation; worker helper checks effective hierarchy before generating Tasks.
  - Ticket SLA scanner: system timer/state reconciliation; no tenant payload authority.
  - Asset processing: Workspace delivery/processing; DB processing job and asset Workspace match remain authority.
  - Storage retention: retention/cleanup; continues for system integrity, including suspended tenants.
  - Webhook delivery: external delivery; delivery, subscription, and event Workspace consistency is rechecked from DB.
  - Inbound webhook maintenance: system cleanup; tenant suspension does not block cleanup.
  - Notification email/reminder workers: Workspace communication; Phase 14.6.9 owns notification hierarchy/fanout audit.
- Worker health remains infrastructure-only. No tenant IDs, names, queue payloads, secrets, or credentials were added to `/health`.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Phase 14.6.9 next work is Notifications + Realtime + Calendar. It was not started.

Phase 14.6.8 final verification decision:

- Automation, workers, and background processing hierarchy remediation is COMPLETE / PASS for Phase 14.6.8.
- Automation remains Workspace-owned. No `AutomationWorkflow.superAgencyId`, `AutomationWorkflow.agencyId`, `AutomationExecution.superAgencyId`, `AutomationExecution.agencyId`, or parent ownership column was added.
- DomainEvent source entity Workspace is verified before durable automation event persistence for Task, Project, and Ticket events. A source entity cannot be reassigned to a sibling or foreign Workspace by payload.
- Trigger matching remains same-Workspace, published active version, correct trigger, and runtime-eligible only. Draft, disabled, historical ineligible, sibling Workspace, sibling Agency, and foreign Super Agency workflows are excluded.
- PostgreSQL remains worker tenant/status authority. Worker hierarchy checks derive effective `Workspace -> Agency -> Super Agency` status from database relations, not from job payload hints.
- BullMQ and Redis carry minimal identifiers and are transport only. Automation execution jobs carry `executionId` only; recurrence scan jobs carry scanner metadata only.
- Queued, replayed, recovered, and recurring business mutations re-check effective hierarchy before mutation. Parent suspension/archive after enqueue or replay request blocks the mutation.
- Suspended parents produce `TENANT_SUSPENDED`; archived, inactive, or unavailable hierarchy produces `TENANT_INACTIVE`. These hierarchy blocks are non-transient and do not retry forever.
- Tenant reactivation does not auto-replay failed automation executions and does not auto-catch-up blocked recurrence mutations. Existing explicit Workspace replay remains the only replay path and creates a new immutable execution.
- Multi-step executions preserve completed steps and block future uncompleted action steps safely if hierarchy changes mid-run. No fake rollback is attempted.
- Automation actions cannot target sibling or foreign Workspaces. Task, Project, Ticket, membership, status, tag, and action target checks remain Workspace fenced through canonical services and selectors.
- CREATE_TASK preserves automation invocation-key idempotency and creates in the execution Workspace. UPDATE/ASSIGN/STATUS/TAG actions preserve existing Workspace fences.
- Canonical Task, Project, and Ticket services remain mutation authority. The hierarchy remediation did not add direct Prisma business writes for action mutations.
- Execution claim, idempotency, depth, correlation, causation, replay, conditions, branching, template, clone, and runtime policy semantics remain unchanged.
- Safe variable roots remain `event`, `trigger`, `execution`, and `steps`. Resolver hardening continues to reject dangerous path segments and unsupported roots such as `process.env`.
- Task recurrence is hierarchy-aware and uses the existing transaction client after the recurrence row lock for the status lookup and recurrence state update.
- Maintenance, retention, recovery, stale-record cleanup, and inbound cleanup jobs continue for system integrity. Storage retention is not blocked by suspended tenants.
- Worker queue classification remains:
  - Automation execution: BUSINESS MUTATION; Workspace execution row is authority; hierarchy checked before action.
  - Task recurrence: BUSINESS MUTATION; hierarchy checked before Task generation.
  - Ticket SLA scanner: SYSTEM MAINTENANCE / timer reconciliation; no tenant payload authority added.
  - Asset processing: DELIVERY / processing; DB job and asset Workspace tuple remain authority.
  - Storage retention: RETENTION / CLEANUP; continues for suspended tenants.
  - Webhook delivery: DELIVERY; delivery, subscription, and event Workspace consistency remains DB-authoritative.
  - Inbound webhook maintenance: SYSTEM MAINTENANCE; cleanup continues.
  - Notification email/reminder workers: Workspace communication; Phase 14.6.9 owns hierarchy/fanout audit.
- Worker logging remains safe diagnostic IDs and status codes only; no workflow variable payloads, Task/Ticket bodies, tokens, provider credentials, or webhook secrets were added to logs.
- Worker health remains infrastructure-only. No tenant IDs, tenant names, customer data, queue payloads, secrets, or credentials are exposed by `/health` JSON or HTML.
- Parent workflow builder, edit, publish, replay, bulk replay, parent automation monitoring, Super Agency automation room, and descendant fanout were not added because no existing parent automation product surface required remediation.
- Platform/developer diagnostics and existing Workspace monitoring remain unchanged.
- No Super Agency execution limits, Agency commercial limits, plans, billing, Stripe, subscription lifecycle, white-label, or Phase 15 functionality was added.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Root integration remains expected-fail on stale shared development DB, which is intentionally pending migrations `0053` through `0075`; scratch API integration passed after applying all 75 migrations.
- Phase 14.6.9 next work is Notifications + Realtime + Calendar. It was not started.

### Phase 14.6.9 - Notifications + Realtime + Calendar

Validate parent dashboard aggregation, subscriptions, broadcasts, and calendar filtering.

Phase 14.6.9 main implementation decision:

- Notifications, preferences, email deliveries, reminders, and calendar events remain Workspace-owned. No Agency or Super Agency ownership columns were added.
- Notification creation, listing, preferences, read/unread mutations, and notification center cache keys remain WorkspaceMembership-scoped.
- Notification email delivery is committed delivery work after durable creation. The email worker validates active WorkspaceMembership plus active user before sending; it does not treat already-created delivery rows as new parent-hierarchy business mutations.
- Customer-visible reminder notification firing rechecks effective Workspace -> Agency -> Super Agency status from PostgreSQL before routing.
- Reminders under inactive hierarchy are marked `SKIPPED` and do not retry forever.
- Realtime Workspace subscription authorization now requires active WorkspaceMembership, Workspace, Agency, and Super Agency status.
- Periodic socket auth recheck revalidates joined Workspace membership and parent status. Revoked access leaves Workspace/member rooms without disconnecting a still-authenticated user.
- Stale realtime member rooms are repaired using only server-generated room names.
- Redis realtime fanout remains transport only and never business authority.
- Frontend realtime subscription is route-scoped to `/workspace`. Agency and Super Agency shells do not subscribe to the last selected Workspace room.
- Calendar ownership, visibility, participant scope, source aggregation, timezone, and range behavior remain Workspace-scoped and unchanged.
- Super Agency and Agency shells continue to hide Workspace notification widgets.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- No Phase 14.6.10, Phase 15 billing, plans, subscriptions, Stripe, white-label, or future scope was started.
- Phase 14.6.9 focused refinement and final verification remain next and were not started.

Phase 14.6.9 final verification decision:

- Notifications remain WorkspaceMembership scoped. No `Notification.agencyId`, `Notification.superAgencyId`, parent recipient, parent Notification Center, or user-wide notification stream exists.
- NotificationPreference remains WorkspaceMembership/category scoped. Mute and critical SYSTEM bypass semantics remain Phase 12 semantics only; hierarchy level is not a bypass.
- Multi-Workspace users keep isolated notification lists, unread counts, read/read-all mutations, preferences, realtime invalidations, and cache keys by Workspace and WorkspaceMembership.
- Notification routing targets valid WorkspaceMembership recipients in the resource Workspace. Super Agency and Agency parent memberships alone do not receive descendant Workspace Task, Ticket, Automation, Gamification, or Reminder notifications.
- Email delivery policy is committed durable delivery after valid notification/delivery creation. Delivery jobs carry only `deliveryId`, reload DB state, and enforce active WorkspaceMembership plus active User before send.
- Revoked recipient membership or inactive recipient User is skipped safely with `INVALID_RECIPIENT`; stale `SENDING`, terminal, `AMBIGUOUS`, retry, and duplicate delivery protections remain intact.
- Parent suspension after durable email creation does not create duplicate delivery and does not create a retry storm. Parent hierarchy IDs are not queue authority.
- Reminder firing rechecks effective Workspace -> Agency -> Super Agency status from PostgreSQL after selecting bounded due rows. Suspended/archived/unavailable hierarchy marks reminders `SKIPPED` and does not retry forever.
- Reactivation does not resurrect already skipped hierarchy-blocked reminders. Future scheduling continues through the canonical Task/Project/Ticket lifecycle.
- Task due soon, Task overdue, Project due soon, and Ticket SLA warning reminders remain canonical. Ticket SLA warning uses stored `slaState.resolutionDueAt` and does not recompute SLA during notification processing.
- Realtime rooms remain only `workspace:<workspaceId>` and `member:<workspaceId>:<membershipId>`. No Super Agency, Agency, all-descendant, or parent fanout rooms exist.
- Realtime subscribe and bounded auth recheck validate active WorkspaceMembership, Workspace, Agency, and Super Agency status from PostgreSQL. Revoked parent or membership access removes both Workspace and member rooms.
- Realtime auth recheck uses one timer per socket and cleans it on disconnect. Redis fanout remains transport only; degraded Redis does not bypass auth.
- Realtime payloads remain minimal invalidation payloads and socket handlers do not mutate business entities.
- Calendar remains Workspace-owned. No `CalendarEvent.agencyId`, `CalendarEvent.superAgencyId`, parent combined calendar, or parent calendar aggregation exists.
- Calendar participants remain same-Workspace WorkspaceMembership scoped. AgencyMembership, SuperAgencyMembership, and User ID alone are not participant authority.
- Parent hierarchy does not bypass WORKSPACE, PARTICIPANTS_ONLY, or PRIVATE visibility. Task/Project/Ticket-derived calendar rows remain read-only from Calendar UI.
- Calendar range remains bounded at 93 days and Workspace IANA timezone remains authority.
- Workspace -> parent route transitions clean Workspace realtime state. Super Agency, Agency, Platform, and Developer shells do not bootstrap Workspace NotificationCenter, Workspace realtime subscription, Workspace Calendar data, or running timer widgets.
- Query/cache keys for notifications and calendar remain tenant scoped. No PII-bearing parent notification/calendar aggregation exists.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Verification passed focused tests, full unit tests, isolated API integration, worker integration, E2E, build, high-threshold audit, clean isolated migration deploy/status, security search, and diff check.
- Shared development database remains intentionally pending migrations `0053` through `0075` and was not migrated.
- Phase 14.6.10 Storage + Files + Cloud Drives is next. It was not started.

### Phase 14.6.10 - Storage + Files + Cloud Drives

Validate parent reporting for storage, lifecycle, cloud drives, quotas, and asset visibility.

Phase 14.6.10 main implementation decision:

- Files/assets remain Workspace-owned. No parent ownership columns were added to Asset or related storage tables.
- Cloud-drive connections remain Workspace-owned. No Agency or Super Agency cloud account ownership was introduced.
- Agency and Super Agency relationship alone does not grant file list, file detail, signed URL, archive, restore, retention policy, cloud connection, cloud browse, import, export, or disconnect access.
- User-facing file and cloud-drive content operations require a direct active WorkspaceMembership in addition to the existing Workspace guard, hierarchy status, and permission checks.
- Signed download URLs are created only after the Asset is resolved through the current Workspace and direct Workspace membership is validated.
- Upload initialization and finalization remain Workspace-derived; client-supplied Workspace, Agency, Super Agency, object key, or filename path is not tenant authority.
- Object keys remain server-controlled. Serialized file DTOs continue omitting storage bucket and storage key.
- Workspace file browser query/cache keys include Workspace context, list params, usage context, and cloud-drive context.
- Workspace switch clears file filters, selected files, detail dialogs, preview file, preview signed URL, export state, upload queue state, cloud connection state, cloud folder navigation, and cursor state.
- Quota remains Workspace scoped and counts active/reserved Workspace storage according to Phase 13 semantics. No Super Agency quota pool, Agency quota allocation, plan limit, billing, or subscription logic was added.
- Archive, delete request, restore, and retention policy remain Workspace-scoped.
- Retention and purge remain system maintenance and continue from PostgreSQL lifecycle state; tenant suspension is not used to strand cleanup.
- Task, Project, Ticket, conversation, and completion proof attachment ownership remains same-Workspace through existing composite relations. Parent oversight surfaces continue excluding files, proofs, attachments, signed URLs, object keys, and provider credentials.
- Cloud credentials remain encrypted and server-only. Safe connection DTOs exclude access tokens, refresh tokens, encrypted token material, client secrets, and authorization codes.
- OAuth state is random, hashed in storage, Workspace-bound, actor-membership-bound, PKCE-protected, short-lived, and single-use.
- OAuth callback resolves tenant context from stored state only and now rejects callbacks if the actor membership, user, Workspace, Agency, or Super Agency is no longer active before provider token exchange or connection write.
- Cloud file import and export require same-Workspace CloudDriveConnection plus same-Workspace Asset where applicable.
- Google Drive, OneDrive, and Dropbox adapter behavior remains foundation-only; live provider OAuth was not externally verified.
- No parent file browser, parent cloud browser, parent signed URL route, cross-Workspace movement, new provider, storage billing, storage plan, Stripe, white-label storage, or Phase 15 functionality was added.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Phase 14.6.10 focused refinement and final verification remain next and were not started.
- Phase 14.6.11 was not started.

Phase 14.6.10 final verification decision:

- Files/assets remain Workspace-owned. No parent ownership columns exist for `Asset`.
- Cloud-drive connections remain Workspace-owned. No Agency or Super Agency cloud connection ownership exists.
- Agency and Super Agency relationship alone does not grant file list, file detail, signed URL, upload finalization, quota, archive, restore, retention policy, cloud connection, cloud browse, import, export, or disconnect access.
- Direct active WorkspaceMembership is required for user-facing file and cloud-drive content operations, including signed URL issuance and cloud export.
- Signed download URLs remain Workspace-authorized, temporary, and logged through existing audit flow. No signed URL revocation layer was added beyond TTL and lifecycle authorization.
- Object keys remain server-generated and server-only; serialized file DTOs do not expose storage bucket or object key.
- Upload initialization and finalization remain Workspace-derived and cannot use client-supplied Workspace, Agency, Super Agency, filename path, or object key as tenant authority.
- Quota remains Workspace scoped, counts active bytes plus live reservations, and uses transactional locking/reservation semantics for concurrent paths.
- Archive, restore, retention, purge, and purge idempotency remain DB lifecycle authoritative and Workspace scoped.
- Task, Project, Ticket, and completion proof attachments remain same-Workspace through existing composite relations. Parent oversight surfaces continue excluding files, proofs, attachments, signed URLs, object keys, and provider credentials.
- Cloud safe DTOs exclude access tokens, refresh tokens, encrypted token material, secrets, and authorization codes.
- Cloud credentials remain encrypted and server-only.
- OAuth state remains random, hashed, Workspace-bound, actor-membership-bound, PKCE-protected, short-lived, and single-use.
- OAuth callback revalidates active actor WorkspaceMembership, active user, active Workspace, active Agency, and active Super Agency before provider token exchange or connection write, including revocation and suspension cases.
- Google Drive, OneDrive, and Dropbox adapters remain foundation-level. Live provider OAuth was not externally verified.
- Cloud import/export require same-Workspace CloudDriveConnection and same-Workspace Asset where applicable. Mixed Workspace export is rejected before Asset lookup or object read.
- Workspace file browser clears preview signed URL and cloud/file state on Workspace switch, and query/cache keys remain Workspace scoped.
- Super Agency, Agency, Platform, Developer, and parent oversight scopes do not receive descendant file content access.
- Notification/realtime/calendar and automation/worker hierarchy regressions were covered by existing focused and broad tests; no new regression was found.
- Cross-Super-Agency, sibling Agency, and sibling Workspace isolation remain enforced through schema ownership, tenant guards, service membership checks, and integration/security tests.
- Verification passed focused API, worker, and web tests; full unit tests; clean isolated API integration; explicit worker integration; E2E; build; high-threshold audit; clean isolated migration deploy/status; security search; and diff check.
- Root integration against shared dev remains expected-fail because shared dev is intentionally stale and missing `automation_trigger_matches`; shared dev was not migrated.
- No database migration was added; clean migration remains 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`.
- Phase 14.6.10 is complete/pass. Phase 14.6.11 Public API + Webhooks + External Integrations is next and was not started.

### Phase 14.6.11 - Public API + Webhooks + External Integrations

Keep runtime ownership workspace-scoped. Add parent management visibility, audit, reporting, and security regression tests.

Phase 14.6.11 main implementation decision:

- Public API keys remain Workspace-owned. No parent API key ownership, parent credential inheritance, or parent API key UI was added.
- API key authentication derives tenant authority from the stored key Workspace and rejects otherwise-valid keys when the owning Workspace, Agency, or Super Agency hierarchy is inactive.
- Public API callers cannot override tenant authority with parent context or client-supplied Workspace headers.
- Public API scope enforcement remains explicit and allowlisted; no wildcard scope was introduced.
- Public API write behavior continues through canonical Task, Project, and Ticket services instead of direct duplicate business mutation paths.
- Public API rate limits remain isolated by API key and Workspace context.
- Public API idempotency remains Workspace/key/route scoped and was not globalized across tenants.
- API key plaintext is one-time only, is not persisted, is not redisplayed, and is cleared from the Workspace settings UI on Workspace switch.
- Outbound webhook subscriptions, events, and deliveries remain Workspace-owned and PostgreSQL-authoritative.
- Outbound queue payloads remain delivery-ID based. The worker reloads delivery, subscription, event, Workspace, Agency, and Super Agency state from PostgreSQL before external delivery.
- Outbound HMAC signing continues over exact JSON bytes with timestamped signatures.
- Webhook HTTPS/TLS validation, SSRF protection, DNS rebinding protection, and no-redirect policy remain intact.
- Queued outbound deliveries whose Workspace, Agency, or Super Agency becomes inactive are marked permanently failed with `TENANT_HIERARCHY_INACTIVE` before URL validation, secret decrypt, HMAC signing, POST, or retry scheduling.
- Webhook maintenance and cleanup remain DB-state maintenance and are not stranded by tenant suspension.
- Inbound webhook sources and events remain Workspace-owned.
- Inbound source public IDs remain the only public identifier; internal IDs and secrets are not used as public route authority.
- Inbound HMAC, timestamp tolerance, replay protection, and idempotency remain intact.
- Inbound receipt rejects inactive Workspace, Agency, or Super Agency hierarchy before rate limiting, signature verification, replay/idempotency writes, event persistence, or normalization.
- Inbound webhook processing remains normalization-only and does not mutate Tasks, Projects, Tickets, integrations, automation, or other business records.
- Integration connections and actions remain Workspace-owned. No parent provider accounts, parent integrations, or parent credentials were added.
- Integration credentials remain encrypted and server-only. DTOs and logs do not expose plaintext or encrypted credential material.
- Integration test and execute paths reject inactive hierarchy before credential decrypt or provider adapter calls.
- GHL, Slack, and Webex adapters remain fixed-host/fixed-origin adapters with server-side credential usage.
- Generic REST remains fixed HTTPS origin with relative paths, SSRF protection, DNS rebinding protection, and disabled redirects.
- Live GHL, Slack, Webex, and Generic REST provider connectivity was not externally verified.
- Workspace settings clears one-time API key plaintext, webhook/inbound secrets, selected delivery/event details, integration credential forms, and integration action/test state on Workspace switch.
- Super Agency and Agency context does not grant credential access, API key access, webhook secret access, inbound source secret access, or integration execution access without direct Workspace membership.
- No background sync, GraphQL, arbitrary JavaScript, new provider, billing, plans, subscriptions, Stripe, files scope, white-label, Phase 14.6.12, or Phase 15 functionality was added.
- No database migration was added; clean migration count remains 75 through `0075_phase14_6_3_super_agency_auth_rbac`.
- Phase 14.6.11 focused refinement and final verification remain next and were not started.

Phase 14.6.11 final verification decision:

- API keys remain Workspace-owned and API key list/update/revoke management now explicitly requires direct active WorkspaceMembership. Parent Agency or Super Agency context cannot manage Workspace API keys.
- API key authentication derives public tenant authority solely from the stored API key Workspace. Caller tenant headers, body fields, and query fields cannot override that Workspace.
- API key plaintext is cryptographically random, shown once, never stored, never redisplayed, and ordinary DTOs expose only safe metadata.
- API key verification stores a SHA-256 verifier and uses timing-safe comparison for supported verifier lengths.
- Public API reads and writes are blocked when the Workspace, Agency, or Super Agency hierarchy is inactive, including suspended and archived parent cases.
- Public API remains a machine/API-key path backed by the stored key record and existing canonical tenant context; no new parent membership authority or synthetic parent credential ownership was introduced.
- Explicit Task, Project, and Ticket scopes remain unchanged. There is no wildcard, parent, admin, root, or all scope.
- Public writes continue through canonical Task, Project, and Ticket services so existing audit, automation, notifications, gamification, and realtime side effects remain domain-owned and are not duplicated.
- Public API rate limits remain API-key-ID and Workspace-ID scoped. They do not use plaintext key material or caller-supplied tenant headers.
- Idempotency remains Workspace/API-key/method/route/key scoped with request-fingerprint conflict rejection. Current authentication, hierarchy, rate-limit, and scope guards run before any idempotent response can be replayed.
- Outbound webhook resources remain Workspace-owned. Events only match subscriptions in the same Workspace.
- Webhook delivery queue payloads contain delivery identifiers only. PostgreSQL remains authority for destination, secret, payload, tenant, hierarchy, and delivery state.
- Exact-byte HMAC remains: the serialized JSON bytes used for the signature are the bytes posted.
- Queued outbound deliveries blocked by inactive hierarchy perform no external POST, do not decrypt/sign, fail permanently with `TENANT_HIERARCHY_INACTIVE`, and do not retry forever.
- Tenant reactivation does not auto replay hierarchy-blocked deliveries. Eligible network failures still preserve existing retry/at-least-once semantics.
- HTTPS/TLS, no redirects, SSRF, IPv4/IPv6 private/link-local/loopback blocks, IPv4-mapped IPv6 handling, DNS multi-answer validation, DNS binding, SNI/Host preservation, response-size caps, and restricted header behavior remain intact.
- Inbound sources remain Workspace-owned. Public IDs are random public identifiers and are not treated as the only authentication factor.
- Inbound exact raw-body HMAC, timestamp tolerance, timing-safe signature comparison, source/external-event idempotency, body-size caps, and content-type/encoding checks remain intact.
- Inbound security order is bounded: source lookup is unique-indexed, existing source/workspace rate limits run before inactive hierarchy rejection, and inactive hierarchy returns the same safe not-found response used for unavailable sources.
- Blocked hierarchy cannot persist inbound events, decrypt/check signatures, normalize payloads, mutate domain records, or emit automation triggers.
- Inbound remains normalization-only.
- Integrations remain Workspace-owned. Agency and Super Agency parent membership grants no credential authority.
- Provider credentials remain encrypted and server-only. DTOs, logs, audit metadata, request summaries, and response summaries do not expose plaintext credentials or encrypted credential material.
- Inactive hierarchy blocks integration test/execute before credential decrypt and before provider network calls.
- GHL, Slack, and Webex keep fixed provider hosts. Generic REST keeps a fixed validated HTTPS origin, relative paths only, no origin escape, no redirects, SSRF/DNS protections, and restricted headers.
- Workspace switching clears transient API key plaintext, webhook/inbound secrets, selected delivery/event state, integration credential forms, and integration action/test results. No logout-persistent secret state was added.
- Live GHL, Slack, Webex, and Generic REST provider connectivity remains pending external verification.
- No database migration was added. Clean isolated migration deploy/status passed with all 75 migrations, and shared dev was left read-only with migrations `0053` through `0075` pending intentionally.
- Phase 14.6.11 is complete/pass. Phase 14.6.12 AuditLog + Security + Parent-Level Reporting Scope is next and was not started.

### Phase 14.6.12 - AuditLog + Security + Parent-Level Reporting Scope

Add Super Agency audit scope, parent reports, cross-tenant security tests, and route hardening for Platform vs Super Agency.

Phase 14.6.12 main implementation decision:

- AuditLog writes now preserve actor and target separation while carrying canonical tenant lineage. Central AuditService records resolve Workspace -> Agency -> Super Agency and Agency -> Super Agency before insert, overriding stale caller-supplied parent IDs when a Workspace is present.
- Organization remains legacy compatibility metadata only and is not hierarchy authority for AuditLog scope, filtering, or lineage.
- Audit metadata is recursively sanitized before persistence, including nested passwords, tokens, API keys, authorization/cookie/session fields, OTP/code/signature fields, encrypted credential fields, raw bodies, provider error strings containing secrets, and direct email/phone/address-style PII.
- Audit metadata is bounded by string length, array length, object key count, nesting depth, circular reference handling, and total serialized byte size. Oversized metadata is replaced with a safe truncation summary.
- Super Agency invitation audit metadata avoids invitee email and token persistence; it records email domain, role, and expiration only.
- Direct transactional audit writes for auth step-up OTP verification, integration actions/tests, gamification admin/reconciliation paths, task transactional paths, ticket conversation paths, ticket SLA policies, and worker storage purges now carry Super Agency lineage when the tenant or Workspace parent is available.
- Automation/system and worker audit remains actorless where no user actor exists, but tenant lineage remains explicit for target Workspace, Agency, and Super Agency.
- Parent oversight reporting remains read-only for descendant Tasks, Projects, and Tickets. Agency scope cannot replace the current Agency fence; Super Agency scope is fenced through descendant Agency ownership.
- Parent reporting filters, search, sort, pagination, list queries, total counts, and grouped counts use the same Workspace hierarchy fence. Sort fields remain allowlisted and page size remains bounded.
- Parent reporting DTOs remain metadata-only and exclude requester detail, conversations, notes, comments, files, attachments, proofs, signed URLs, object keys, provider credentials, secrets, raw payloads, and Phase 17 report-builder surfaces.
- Workspace, Agency, Super Agency, and Platform audit scope are supported through canonical lineage fields; no Organization-root or first-membership authority was introduced.
- Query/cache isolation and tenant switching behavior from prior 14.6 phases remains unchanged; no parent UI mutation surface was added.
- No billing, plans, subscriptions, Stripe, parent mutation, parent credential access, parent file access, synthetic memberships, Phase 14.6.13, Phase 15, or Phase 17 functionality was added.
- No database migration was added; clean migration count remains 75 through `0075_phase14_6_3_super_agency_auth_rbac`.
- Verification passed `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, focused API/worker tests, and full `pnpm test`.
- Focused refinement fixed audit redaction edge cases, signed URL/provider error redaction, integration transactional audit sanitizer reuse, and audit-derived `[NULL]` membership sentinel handling in gamification replay.
- Final verification passed Prisma generate/validate, format, lint, typecheck, focused API/worker/web regressions, full unit tests, isolated API and worker integration, E2E, build, high-threshold audit, diff check, clean isolated migration deploy/status, read-only shared-dev migration status, and security search.
- Shared development database remains intentionally pending migrations `0053` through `0075`; no shared-dev migration was applied.
- Phase 14.6.12 is complete/pass. Phase 14.6.13 Migration + Backfill + Backward Compatibility is next and was not started.

### Phase 14.6.13 - Migration + Backfill + Backward Compatibility

Run isolated migration verification, backfill tests, compatibility response tests, and downgrade-free deployment checks.

Phase 14.6.13 main implementation decision:

- Added a focused scratch-database compatibility harness at `scripts/phase14-6-13-migration-compatibility.mjs`, exposed through `pnpm phase14:6:13:migration-compat`.
- The harness uses only phase-named scratch databases, `zea_play_phase14613_clean` and `zea_play_phase14613_legacy`, and refuses non-phase database names.
- Clean install verification applies all 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`, runs seed twice, verifies no Agency lacks a Super Agency, verifies Workspace has no `super_agency_id` ownership column, and confirms Prisma migrate status is up to date.
- Legacy upgrade verification applies migrations through `0073_phase14_5_integration_audit_hardening`, inserts a broad pre-0074 fixture, then applies the current migrations through `0075`.
- The legacy fixture covers 3 Agencies, 4 Workspaces, Organization compatibility rows, AgencyMembership, WorkspaceMembership, Department, StatusDefinition, Task, Project, Ticket, Asset, storage reservation, processing job, API key, outbound webhook, inbound webhook, integration action/idempotency, cloud drive connection, calendar event, notification, gamification work XP/global score, automation workflow/version/domain event/trigger match/execution/step, feature entitlement, and AuditLog rows.
- The locked backfill strategy is verified: each existing legacy Agency receives one distinct same-ID compatibility Super Agency; there is no global/default parent and no grouping by Organization, name, domain, or user.
- SuperAgencyMembership remains non-synthetic for legacy Agencies. The legacy fixture produced zero SuperAgencyMembership auto-promotions after upgrade and seed.
- Organization remains legacy compatibility metadata only and is not used as hierarchy authority.
- Agency IDs, Workspace IDs, operational IDs, Workspace -> Agency FKs, AgencyMemberships, WorkspaceMemberships, role links, timestamps, object keys, queue rows, encrypted credential fields, webhook secrets, inbound signing secrets, API key verifier hashes, and cloud drive encrypted tokens are preserved across upgrade.
- Historical AuditLog rows remain compatible with nullable Super Agency lineage, and new AuditLog records can carry Super Agency + Agency + Workspace lineage after migration.
- Operational tables remain Workspace-owned. No new operational Super Agency ownership column exists outside intended lineage tables (`agencies`, `super_agency_memberships`, `super_agency_invitations`, `feature_entitlements`, and `audit_logs`).
- Constraint validation, not-null transition safety, unique constraint safety, enum compatibility, seed idempotency, queued job compatibility, Redis/cache independence, tenant header compatibility, JWT compatibility, and frontend route compatibility remain consistent with the Phase 14.6 canonical hierarchy.
- No migration `0076_phase14_6_13_hierarchy_compatibility_hardening` was needed or created.
- Historical migrations `0074_phase14_6_2_super_agency_hierarchy` and `0075_phase14_6_3_super_agency_auth_rbac` were not modified, reordered, deleted, squashed, or rewritten.
- Shared development database remains intentionally pending migrations `0053` through `0075`; no shared-dev migration was applied.
- Verification passed `pnpm prisma:generate`, `pnpm prisma:validate`, `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm phase14:6:13:migration-compat`, and full `pnpm test`.
- Phase 14.6.13 focused refinement and final verification completed after the main implementation pass. Phase 14.6.14 and Phase 15 were not started.

Phase 14.6.13 final verification decision:

- Clean install certification is PASS. Isolated scratch database `zea_play_phase14613_clean` applied all 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`, seeded idempotently, reported Prisma migrate status up to date, and retained zero orphan Agencies after broad verification.
- Legacy upgrade certification is PASS. Isolated pre-0074 fixture upgrade from `0073_phase14_5_integration_audit_hardening` through `0075` preserved existing Agency, Workspace, membership, Task, Project, Ticket, asset, queue, credential, webhook, inbound, integration, cloud-drive, notification, calendar, automation, gamification, entitlement, and audit rows.
- The compatibility parent strategy remains one compatibility Super Agency per legacy Agency, using the same UUID in a distinct table. No global parent, default parent, Organization grouping, name grouping, domain grouping, or user grouping was introduced.
- Same-ID compatibility is safe only when tenant UUIDs are always paired with scope/type. Routes remain type-specific, audit rows carry entity type plus ID, cache/query keys remain scope-prefixed, and parent-child authorization uses explicit relationship checks.
- Organization remains ignored for parent mapping and hierarchy authority. It is legacy compatibility metadata only.
- No legacy Agency user was auto-promoted to SuperAgencyMembership. Existing AgencyMembership and WorkspaceMembership rows remain the user-authority records for legacy tenants.
- ID/history/credential preservation is PASS. Agency IDs, Workspace IDs, operational IDs, Workspace -> Agency FKs, role links, timestamps, object keys, queued job rows, API key verifier hashes, webhook secrets, inbound secrets, integration credentials, and cloud-drive encrypted tokens were not rewritten, rotated, re-encrypted, or recomputed.
- Historical AuditLog compatibility is PASS with nullable Super Agency lineage for old rows and canonical Super Agency + Agency + Workspace lineage for new rows.
- Queued job compatibility is PASS. Queue payloads remain ID-based and reload tenant/hierarchy state from PostgreSQL instead of relying on migrated embedded parent context.
- Seed behavior is PASS. Repeated seed on a clean migrated schema remains idempotent for permissions, roles, demo hierarchy, and Super Agency role names.
- Migration harness safety is PASS. The harness reads local env-derived scratch connection defaults, refuses non-local hosts, refuses unsafe/shared database names, uses only phase-named scratch databases, redacts generated URLs in errors, validates migration inventory, and includes zero/one/many legacy Agency edge cases.
- No `0076_phase14_6_13_hierarchy_compatibility_hardening` migration was required or created because no compatibility defect required a new forward migration.
- Historical migrations `0074_phase14_6_2_super_agency_hierarchy` and `0075_phase14_6_3_super_agency_auth_rbac` were not modified, reordered, deleted, squashed, or rewritten during final verification.
- Production deployment guidance: take a backup first, deploy application code that understands nullable Super Agency lineage and compatibility parents, run migrations in a controlled maintenance window with normal database locking/monitoring, verify migration status and orphan checks after deploy, then enable traffic. Mixed-version deployment where old code writes hierarchy-sensitive records during or after the migration remains unsupported.
- Rollback policy is restore-from-backup. No downgrade migration, destructive rollback, or historical migration rewrite was added.
- Shared development database remains intentionally read-only and pending migrations `0053` through `0075`; no shared-dev migration was applied.
- Final verification passed Prisma generate/validate, format, lint, typecheck, migration compatibility harness, full unit tests, clean isolated API integration, normalized legacy-upgraded API integration, worker integration, E2E, build, high-threshold audit, diff check, migration inventory check, clean/legacy scratch migrate status checks, read-only shared-dev migration status, and security search.
- Phase 14.6.13 is complete/pass. Phase 14.6.14 Full Phase 1-14 Regression + Documentation is next. Phase 15 was not started.

### Phase 14.6.14 - Full Phase 1-14 Regression + Documentation

Run focused and broad regression, update docs, and confirm no Phase 15+ scope entered.

Phase 14.6.14 main regression decision:

- Full Phase 1-14 architecture regression is PASS for the main implementation audit.
- The canonical hierarchy remains Platform / Super Admin -> Super Agency -> Agency -> Workspace / Sub-account.
- Developer and Platform authority remains internal and non-tenant. Super Admin / Platform is not Super Agency.
- Organization remains legacy compatibility metadata only and is not hierarchy authority.
- The five application environments remain distinct: Developer, Platform / Super Admin, Super Agency, Agency, and Workspace / Sub-account.
- Authentication, JWT/session behavior, RBAC, tenant context resolution, and effective Workspace -> Agency -> Super Agency status checks remain intact. JWT remains identity/session focused and tenant authority remains server-resolved.
- No first-membership authorization fallback was found. The reviewed `memberships[0]` usage is response shaping over a pre-filtered active current-user WorkspaceMembership relation, not tenant authority.
- Platform scope, Super Agency scope, Agency scope, and Workspace scope remain separate. Parent management does not create synthetic child memberships and does not grant child-shell impersonation.
- Dashboard shells, navigation, query keys, tenant switching, rapid switching, logout cleanup, theme support, i18n labels, and responsive/accessibility coverage remain consistent with the corrected hierarchy.
- Agency/Workspace management remains server-derived for parent IDs. Super Agency manages child Agencies; Agency manages child Workspaces; parent transfer remains blocked.
- Tasks, Projects, Tickets, Automation, Notifications, Realtime, Calendar, Storage/Files, CloudDriveConnections, Public API keys, Webhooks, Inbound Webhooks, Integrations, and operational credentials remain Workspace-owned.
- Parent Task/Project/Ticket oversight remains read-only safe metadata and excludes comments, conversations, internal notes, files, attachments, proofs, signed URLs, object keys, requester private data beyond safe report semantics, secrets, credentials, and raw payloads.
- Workspace and Department gamification continue to use local XP. Agency, Super Agency, and Platform leaderboards continue to use canonical normalized Global Score without formula changes, double normalization, or backfill.
- Automation remains Workspace-owned, workers remain PostgreSQL-authoritative before mutation, queue payloads remain durable IDs, parent suspension blocks mutation as non-transient, and recurrence remains hierarchy-aware.
- Notifications remain WorkspaceMembership scoped; email/reminders remain recipient/user gated; realtime remains Workspace/member-room scoped; Calendar remains Workspace-owned and visibility-limited.
- File/signed URL/cloud-drive authority continues requiring direct active WorkspaceMembership. Parent hierarchy does not grant file, credential, signed URL, object key, API key, webhook secret, inbound secret, integration credential, or cloud credential access.
- Public API, outbound webhooks, inbound webhooks, integrations, rate limits, idempotency, raw HMAC, exact-byte HMAC, fixed provider hosts, and Generic REST SSRF/origin protections remain Workspace-owned and hierarchy-gated.
- AuditLog continues preserving real actor/target separation, canonical lineage, transaction rollback behavior, and bounded secret redaction.
- Performance review found no confirmed unbounded parent hot path requiring code change. Parent endpoints remain paginated/bounded and set-based enough for the current phase target; workers continue loading compact durable IDs and hierarchy status.
- Validation, pagination, sort allowlists, health endpoints, Helmet, CORS origin parsing, and security headers remain intact. Swagger metadata now includes `x-super-agency-id` alongside Agency and Workspace headers.
- Confirmed fixes were documentation and API documentation metadata only: current hierarchy wording in `docs/architecture.md`, `docs/api-standards.md`, and `docs/frontend-architecture.md`, plus Super Agency header metadata in `apps/api/src/main.ts`.
- Migration compatibility remains PASS with 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`; no `0076` was created.
- Shared development database remains intentionally untouched and pending migrations `0053` through `0075`.
- Live external provider verification remains not performed for Google Drive, OneDrive, Dropbox, GHL, Slack, and Webex.
- Verification passed focused API, worker, and frontend regressions; Prisma generate/validate; format; lint; typecheck; full unit tests; and the migration compatibility harness.
- Phase 14.6.14 main implementation is pass. Phase 14.6.14 focused refinement and final verification completed after this main pass. Phase 14.7 and Phase 15 were not started.

Phase 14.6.14 final verification and remediation closure:

- Phase 14.6.14 is COMPLETE / PASS after focused and broad Phase 1-14 regression, documentation closure, and migration compatibility confirmation.
- Final remediation was documentation-only: `docs/dashboard-shells.md` now documents all five dashboard environments and includes Super Agency in the dashboard/navigation architecture. No source code or migration remediation was required during final closure.
- Canonical hierarchy remains Platform / Super Admin -> Super Agency -> Agency -> Workspace / Sub-account. Developer and Platform authority remains internal and non-tenant, and Super Admin / Platform is not Super Agency.
- Organization remains legacy compatibility metadata only. It is not parent authority, tenant authority, scope authority, Super Agency authority, or tenant-header authority.
- Tenant header contract remains `x-super-agency-id`, `x-agency-id`, and `x-workspace-id`; legacy `x-organization-id` is not an active authorization input.
- Authentication, JWT/session behavior, RBAC, membership resolution, invitations, effective status checks, dashboard shells, navigation, shared header, theme, i18n, responsive behavior, and accessibility regressions remain pass.
- No first-membership authorization fallback was introduced. Parent management remains management/reporting only and does not create synthetic child memberships, parent transfer, child-shell impersonation, parent credential access, parent file access, or parent operational mutation.
- Tasks, Projects, Tickets, Automation, Workers, Notifications, Realtime, Calendar, Storage/Files, Cloud Drives, Public API, API keys, webhooks, inbound webhooks, integrations, credentials, and AuditLog remain Workspace-owned or canonical-lineage scoped according to the final Phase 14.6 design.
- Parent Task/Project/Ticket oversight remains read-only safe metadata and excludes comments, conversations, internal notes, files, attachments, proofs, signed URLs, object keys, requester-private operational payloads, secrets, and credentials.
- Workspace and Department gamification continue to use local XP. Agency, Super Agency, and Platform leaderboards continue to use normalized Global Score without formula changes, double normalization, or backfill.
- Migration compatibility is PASS with 75 migrations through `0075_phase14_6_3_super_agency_auth_rbac`; no `0076` was created. Historical migrations `0074_phase14_6_2_super_agency_hierarchy` and `0075_phase14_6_3_super_agency_auth_rbac` were not edited during final verification.
- Final verification passed focused API regression (46 suites / 468 tests), focused worker regression (6 suites / 25 tests), focused frontend regression (16 files / 170 tests), Prisma generate/validate, format, lint, typecheck, full unit tests, migration compatibility, normalized legacy-upgraded API integration, worker integration, E2E, build, high-threshold audit, git diff check, migration inventory, read-only shared-dev migration status, and final stale hierarchy/future-phase searches.
- Shared development database remains intentionally read-only and pending migrations `0053` through `0075`; no shared-dev migration was applied.
- Hierarchy Remediation 14.6 is complete/pass. Phase 14.7 Final Hierarchy Certification is ready to start only when explicitly requested. Phase 15 remains frozen until after Phase 14.7 passes.

### Phase 14.7 - Final Hierarchy Certification

Certify the hierarchy only after schema, auth, frontend, services, workers, tests, backfill, and documentation are complete.

## N. Deferred Phase 15-22

The following areas are intentionally excluded from this Phase 14.6.1 audit:

- Plans, billing, trials, payments, pricing, invoices, and subscription lifecycle.
- Future Phase 15-22 feature work.
- Any implementation beyond the 14.6.2-14.7 remediation plan.
- Any production migration execution.
- Any shared development database migration.

These future phases must consume the final certified hierarchy after Phase 14.7, not the current Agency -> Workspace approximation.
