# Version 1 Security Matrix

Status: Phase 17.5 final certification PASS.

Scope: Zea Play Version 1, Phases 1 through 17. Phase 18+ features are Version 2 scope and remain not started.

| Area                                | Status | Evidence                                                                                                                                                    |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication                      | PASS   | JWT, refresh, logout, CSRF, session invalidation, and active-user checks remain in the existing Auth module and verified by auth/security tests.            |
| Sessions                            | PASS   | Refresh token state stays cookie-backed and logout clears session/client tenant context.                                                                    |
| 2FA and step-up                     | PASS   | Existing OTP/security step-up flows remain one-time and secret-safe; no weaker bypass was added.                                                            |
| RBAC                                | PASS   | Authorization uses permission keys and tenant guards, not role-name equality.                                                                               |
| Custom roles                        | PASS   | Tenant role permissions remain scoped, and platform-only permissions remain protected from tenant custom roles.                                             |
| Platform permissions                | PASS   | Platform analytics, reports, search, and dashboards require platform-specific guards/permissions.                                                           |
| Hierarchy                           | PASS   | Canonical hierarchy remains Platform -> Super Agency -> Agency -> Workspace.                                                                                |
| Organization compatibility          | PASS   | Organization remains legacy metadata only and is not tenant, RBAC, billing, or ownership authority.                                                         |
| Tenant isolation                    | PASS   | Workspace, Agency, Super Agency, and Platform surfaces use explicit scope validation and membership checks.                                                 |
| Same-ID safety                      | PASS   | Phase 17 Analytics, Reports, Search, and Dashboards use explicit `scopeType + scopeId`.                                                                     |
| Effective status chain              | PASS   | Workspace business access continues to honor Workspace -> Agency -> Super Agency effective status.                                                          |
| Developer environment               | PASS   | Developer remains internal and does not grant tenant-private dashboard/data access.                                                                         |
| Platform environment                | PASS   | Platform/Super Admin remains internal, permissioned, and distinct from Super Agency.                                                                        |
| Super Agency environment            | PASS   | Super Agency is the commercial parent and sees only authorized parent aggregates/financial metrics.                                                         |
| Agency environment                  | PASS   | Agency sees child aggregate/allocation surfaces only; no independent subscription/customer authority.                                                       |
| Workspace environment               | PASS   | Workspace remains operational owner for work, collaboration, credentials, and Assets.                                                                       |
| Tasks                               | PASS   | Workspace-owned; completion, recurrence, bulk actions, dependencies, and derived Phase 17 views preserve canonical authority.                               |
| Projects                            | PASS   | Workspace-owned; members/status/completion remain scope-safe and derived analytics/report/search/dashboard surfaces are read-only.                          |
| Tickets                             | PASS   | Workspace-owned; conversation/internal-note privacy is preserved in parent, search, report, and dashboard views.                                            |
| Gamification XP                     | PASS   | XP remains canonical ledger data; Phase 17 features do not award XP.                                                                                        |
| Global Score                        | PASS   | Global Score uses canonical normalized history; Phase 17 does not renormalize.                                                                              |
| Badges/Achievements/Streaks/Rewards | PASS   | Existing Gamification services remain authority; no duplicate Phase 17 award engine exists.                                                                 |
| Leaderboards                        | PASS   | Workspace local XP and parent/platform Global Score hierarchy semantics remain intact.                                                                      |
| Automation                          | PASS   | One Automation engine remains; Forms and Goals reuse existing domain events/actions.                                                                        |
| Automation retry                    | PASS   | Automation retries and replay remain idempotent and quota-aware.                                                                                            |
| Automation quota                    | PASS   | Phase 15 commercial usage authority remains the quota source.                                                                                               |
| Notifications                       | PASS   | One notification routing/email architecture remains; no duplicate dashboard/search/report notification engine.                                              |
| Realtime                            | PASS   | Existing realtime rooms remain Workspace/member scoped; no Custom Dashboard live WebSocket engine was added.                                                |
| Calendar                            | PASS   | Calendar remains Workspace scoped with existing visibility and participant checks.                                                                          |
| Assets                              | PASS   | Docs, Forms, normal Files, and Reports exports reuse the canonical Asset/storage architecture.                                                              |
| Storage quota                       | PASS   | Workspace storage usage remains authoritative through Asset/reservation accounting.                                                                         |
| Cloud Drives                        | PASS   | Cloud credentials remain Workspace-owned, encrypted, and unavailable to parent scopes.                                                                      |
| API Keys                            | PASS   | API keys remain Workspace-owned; raw secrets are not searchable, logged, or returned after creation.                                                        |
| Public API                          | PASS   | Existing API-key scope, rate-limit, and commercial quota enforcement remain authoritative.                                                                  |
| Webhooks                            | PASS   | Outbound/inbound webhooks remain Workspace-owned with HMAC, idempotency, and secret protection.                                                             |
| Integrations                        | PASS   | Integration credentials remain server-side/encrypted; Generic REST keeps fixed-origin SSRF controls.                                                        |
| Billing ownership                   | PASS   | Super Agency remains the only billing customer; Agency and Workspace are allocation/consumption only.                                                       |
| Trial/grace/restricted              | PASS   | 14-day internal trial, 7-day grace, and read-only restricted mode remain certified.                                                                         |
| Allocations                         | PASS   | Super Agency -> Agency -> Workspace allocation semantics remain the commercial capacity model.                                                              |
| Invoices/payment privacy            | PASS   | Financial details are limited to authorized Super Agency/Platform surfaces.                                                                                 |
| Docs                                | PASS   | Docs remain Workspace-owned with private/selected/workspace visibility and safe parent policy.                                                              |
| Doc public share                    | PASS   | Share token hashing, expiry, password, revocation, and noindex controls remain documented/certified.                                                        |
| Forms                               | PASS   | Forms remain Workspace-owned; public submission uses server validation and idempotency.                                                                     |
| Form PII                            | PASS   | Form answers/signatures/upload tokens are not exposed to parent/search/report/dashboard surfaces.                                                           |
| Form upload                         | PASS   | Public upload tokens bind form/version/field/asset/MIME/size/count and use canonical Assets.                                                                |
| Goals                               | PASS   | Goals remain Workspace-owned; progress uses canonical Task/Project/Ticket/XP/Global Score sources.                                                          |
| Goal privacy                        | PASS   | Parent views and Phase 17 layers expose aggregate Goal state, not manual notes/private owner data.                                                          |
| Analytics                           | PASS   | Analytics uses one metric registry over canonical source data with bounded queries and tenant-safe cache.                                                   |
| Analytics privacy                   | PASS   | Workspace/Agency financial metrics are denied; parent analytics is safe aggregate only.                                                                     |
| Reports                             | PASS   | Reports reuse AnalyticsService; CSV/XLSX exports are formula-safe and storage-authorized.                                                                   |
| Scheduled reports                   | PASS   | Schedules are idempotent and recipient authorization is rechecked.                                                                                          |
| Search                              | PASS   | Search uses PostgreSQL FTS/trigram derived SearchDocument only, with query-time authorization.                                                              |
| Search privacy                      | PASS   | Search excludes Form answers, secrets, signed URLs, private Docs, ticket notes, and credential material.                                                    |
| Search worker                       | PASS   | Worker reloads canonical rows and protects against stale jobs.                                                                                              |
| Custom Dashboards                   | PASS   | Dashboards reuse Analytics and Reports only, support 9 widget types, and enforce 30-widget limits.                                                          |
| Dashboard privacy                   | PASS   | Dashboards do not introduce public sharing, custom JS/SQL/formulas, or financial leakage.                                                                   |
| Parent privacy                      | PASS   | Parent views remain read-only and privacy-shaped across operational modules.                                                                                |
| Platform privacy                    | PASS   | Platform/internal access requires explicit platform permission.                                                                                             |
| Financial privacy                   | PASS   | Financial metrics and invoice/payment details remain Super Agency/Platform-only.                                                                            |
| Secrets                             | PASS   | Config/test hits are expected; runtime redaction avoids password, OTP, JWT, token, API key, webhook, integration, provider, Stripe, and signed URL leakage. |
| PII                                 | PASS   | PII remains excluded from parent/search/report/dashboard/AuditLog/queue payloads where certified.                                                           |
| Cache isolation                     | PASS   | Phase 17 cache/query keys include actor/scope where needed; tenant switching clears relevant state.                                                         |
| Tenant switching                    | PASS   | Workspace/Agency/Super Agency switches use scoped query keys and do not rely on headers alone.                                                              |
| Logout cleanup                      | PASS   | Auth state, tenant context, React Query/cache state, search, report, dashboard, and temp URL state are cleared by existing session boundaries.              |
| Worker idempotency                  | PASS   | Workers use durable IDs, PostgreSQL reloads, idempotency keys, and bounded batch sizes.                                                                     |
| Logging                             | PASS   | Audit/security redaction covers nested secrets, signed URLs, raw payloads, and provider errors.                                                             |
| AuditLog                            | PASS   | AuditLog keeps actor/target/lineage separation and compact metadata only.                                                                                   |
| Performance bounds                  | PASS   | Search/report/dashboard/analytics queries are bounded; workers use fixed scan/rebuild limits.                                                               |
| Phase 18 boundary                   | PASS   | White label/custom domains/PWA/offline/developer isolated space remain Version 2/deferred scope.                                                            |

Row count: 69.

Unknown rows: 0.

Partial rows: 0.

Fail rows: 0.
