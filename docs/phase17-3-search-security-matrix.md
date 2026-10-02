# Phase 17.3 Search Security Matrix

Status: Phase 17.3 final certification PASS. All rows have real-source, real PostgreSQL integration, migration, worker, or runtime gate evidence.

| Area                       | Status | Evidence                                                                                                                              |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Scope isolation            | PASS   | Search integration proves Workspace/Agency/Super Agency/Platform scope isolation with explicit `scopeType + scopeId`.                 |
| Same-ID Agency/SuperAgency | PASS   | Migration/index model and integration queries use scope type in uniqueness, predicates, recent searches, and cache keys.              |
| Task                       | PASS   | Real Task rows are indexed through the worker; workspace search returns safe details and parent rows return safe metadata only.       |
| Project                    | PASS   | Real Project row is indexed and searched with permission/scope checks and safe DTO output.                                            |
| Ticket                     | PASS   | Real Ticket row is indexed; distinctive conversation/internal-note values are not searchable through parent search.                   |
| Docs private               | PASS   | Private Doc stale-index and parent-search tests deny results after canonical visibility checks.                                       |
| Docs selected members      | PASS   | Selected-member Doc cache/ACL tests require current canonical DocAccess membership.                                                   |
| Docs Workspace visibility  | PASS   | Workspace-visible Doc is eligible for parent-safe search while private and selected docs are denied.                                  |
| Forms PII                  | PASS   | Real Form/FormVersion/FormSubmission fixture proves email, phone, hidden answer, and normal answer values are not searchable.         |
| Goals private data         | PASS   | Real Goal and GoalProgressEvent fixture proves safe Goal metadata is searchable and private/manual note text is not searchable.       |
| Files metadata             | PASS   | Real Asset fixture proves filename metadata is searchable and simulated binary/extracted secret metadata is not searchable.           |
| Members                    | PASS   | Real WorkspaceMembership fixture proves authorized member metadata search, foreign Workspace isolation, and inactive-member behavior. |
| Automation secrets         | PASS   | Real Automation workflow/execution fixture proves workflow metadata is searchable and execution secret/payload text is not.           |
| API key secrets            | PASS   | Real API key fixture proves safe key metadata is searchable and secret hash text is not searchable.                                   |
| Webhook secrets            | PASS   | Real WebhookSubscription fixture proves safe webhook metadata is searchable and signing secret text is not searchable.                |
| Integration credentials    | PASS   | Real IntegrationConnection fixture proves provider/display metadata is searchable and OAuth credential text is not searchable.        |
| Billing boundaries         | PASS   | Real BillingInvoice fixture proves Workspace/Agency denial, Super Agency own-only access, cross-Super denial, and Platform access.    |
| Query-time authorization   | PASS   | Search service tests recheck Doc ACL/visibility and module permissions before returning indexed rows.                                 |
| Stale index                | PASS   | Stale index tests prove private Doc changes and stale worker jobs cannot reintroduce searchable state.                                |
| Module permission removal  | PASS   | Search integration proves result types are filtered by current actor permissions.                                                     |
| Parent privacy             | PASS   | Agency/Super Agency tests prove descendant safe search only and no Workspace A3/B1 leakage outside authorized hierarchy.              |
| Platform privacy           | PASS   | Platform search tests require explicit platform permission and exclude private docs, submissions, ticket notes, goal notes, secrets.  |
| Cache isolation            | PASS   | Integration tests prove actor-sensitive cache isolation for selected-member Doc results.                                              |
| Actor-sensitive cache      | PASS   | Cache key behavior is exercised with two Workspace actors against selected-member content.                                            |
| Recent search privacy      | PASS   | Recent-search integration proves user/scope isolation and per-actor history separation.                                               |
| Rate limit                 | PASS   | Integration test executes the server-side search rate limit and verifies 429 after the configured budget.                             |
| Statement timeout          | PASS   | Integration test verifies transaction-local PostgreSQL `statement_timeout` on the query path.                                         |
| Worker DB reload           | PASS   | Real SearchIndexProcessor integration reloads canonical DB rows for create, update, archive, restore, and delete behavior.            |
| Stale jobs                 | PASS   | Real stale V1/V2 job integration proves older updates cannot overwrite newer or destructive archived/deleted state.                   |
| Multi-worker               | PASS   | Real PostgreSQL concurrent processor test proves one logical SearchDocument with current content.                                     |
| Rebuild authorization      | PASS   | Integration proves tenant rebuild is rejected and Platform/internal rebuild queue path recreates canonical state.                     |
| XSS/highlight              | PASS   | Search service sanitizes snippets/titles and web tests render results as React text.                                                  |
| Open redirect              | PASS   | Search result routes are server-generated relative application routes.                                                                |
| Restricted mode            | PASS   | Search remains protected by existing JWT, tenant, permission, and platform guards.                                                    |
| Commercial compatibility   | PASS   | Migration/service review confirms no new billing customer authority or commercial feature key was added.                              |

Row count: 35.

Unknown rows: 0.

Partial rows: 0.

Unreviewed rows: 0.

Fail rows: 0.
