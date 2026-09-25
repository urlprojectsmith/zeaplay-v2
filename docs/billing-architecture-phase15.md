# Phase 15 Billing Architecture

Phase 15 establishes billing as a Platform-owned capability with the Super Agency as the primary commercial tenant.

## Locked Commercial Model

Platform defines and manages master plans. Super Agencies subscribe to those plans. Agencies receive allocation from their parent Super Agency only. Workspaces consume from their Agency and Super Agency context only.

There are no Agency, Workspace, or Organization subscription models in Phase 15.

Private, enterprise, internal, free, demo, and QA plans are supported as plan type data. Commercial names such as Starter or Professional are labels, not domain logic.

## Billing Owner

The Super Agency is the billing owner for Phase 15. Agencies and Workspaces must not hold Stripe customer identity, checkout state, subscription lifecycle state, or plan authority.

Billing state is separate from operational tenant status. `SuperAgency.status` remains an operational hierarchy field; subscription status lives on `SuperAgencySubscription`.

## Stripe Scope

Stripe is selected as the payment provider beginning in Phase 15.2. The integration uses Stripe-hosted Checkout and Stripe Customer Portal only.

No card data is collected or stored by Zea Play. Zea Play does not create browser-side payment method forms, custom card entry, PaymentIntent flows, SetupIntent flows, or Stripe Tax in Phase 15.2.

## Trial Policy

The product trial model is a 14-day no-card trial. Phase 15 stores explicit trial fields and supports explicit activation of a trialing Super Agency subscription. It does not auto-start trials during tenant creation, login, invitation acceptance, or workspace activity.

The product grace period is 7 days for trial-expiry or payment-failure recovery. Phase 15.2 implements trial grace and payment-failure grace transitions.

Restricted mode preserves login, read-only access, billing recovery, and all tenant data while blocking new writes after the configured billing grace has expired. Phase 15.2 adds central commercial restricted-mode write blocking for authenticated app writes, public API writes, inbound webhook ingestion, automation execution mutations, and worker-generated recurrence mutations.

## Master Plan Architecture

`MasterPlan` is the stable commercial plan identity. It contains the plan key, type, name, description, status, and audit timestamps.

Plan keys are canonical identifiers. Plan display labels may change without changing historical subscriptions.

## Plan Version Architecture

`MasterPlanVersion` stores immutable commercial terms for a plan version. A plan version may be `DRAFT`, `PUBLISHED`, or `ARCHIVED`.

Only draft versions can be edited. Published versions are immutable and are the only versions eligible for subscription provisioning. Archived versions remain historical records and are not editable.

## Entitlement Model

`PlanEntitlement` stores typed entitlements for each plan version.

Feature entitlements are boolean feature flags. Limit entitlements are typed numeric limits or explicit unlimited values. A plan version cannot contain duplicate entitlement keys.

Allowed feature keys:

- `tasks`
- `tasks.enabled`
- `projects`
- `projects.enabled`
- `tickets`
- `tickets.enabled`
- `gamification`
- `gamification.enabled`
- `automation`
- `automation.enabled`
- `notifications`
- `notifications.enabled`
- `calendar`
- `calendar.enabled`
- `assets`
- `files.enabled`
- `public_api`
- `api.enabled`
- `webhooks`
- `webhooks.enabled`
- `integrations`
- `integrations.ghl.enabled`
- `integrations.slack.enabled`
- `integrations.webex.enabled`

Allowed limit keys:

- `max_agencies`
- `max_workspaces`
- `max_users`
- `max_memberships`
- `storage_bytes`
- `max_active_automations`
- `automation_executions_per_month`
- `automation_executions_per_billing_period`
- `api_requests_per_month`
- `api_requests_per_billing_period`

Unlimited is explicit through `PlanEntitlementValueType.UNLIMITED`; it is not represented by null, negative numbers, or arbitrary sentinel values.

Membership capacity is membership-based. The same user may legitimately hold multiple workspace memberships, and those memberships can count separately for future capacity accounting. Unique-user reporting may exist separately.

Automation limits are modeled as separate concepts for active workflows and executions per billing period.

API security rate limits remain separate from future commercial API usage quotas.

Webhooks are feature entitlements only in the current architecture. Webhook delivery counts are not commercial billing meters in Phase 15.1.

Provider-specific integration entitlements are supported. A broad integration flag is not the only available control.

## Existing FeatureEntitlement Audit

The existing `FeatureEntitlement` model remains a direct tenant feature override / compatibility foundation from earlier phases. It is not removed, renamed, or repurposed in Phase 15.1.

## FeatureEntitlement Integration Decision

Phase 15.1 keeps master-plan entitlements separate from direct `FeatureEntitlement` overrides. Effective billing entitlement reads come from the current Super Agency subscription's published plan version. Direct feature override reconciliation, override precedence, and hard enforcement are deferred to later billing allocation/enforcement phases.

## Subscription Foundation

`SuperAgencySubscription` is the only subscription foundation. It links a Super Agency to a `MasterPlan`, immutable published `MasterPlanVersion`, optional `BillingPrice`, and provider subscription identifiers.

Current subscription status values are:

- `TRIALING`
- `ACTIVE`
- `PAST_DUE`
- `GRACE_PERIOD`
- `TRIAL_GRACE`
- `PAYMENT_GRACE`
- `RESTRICTED`
- `SUSPENDED`

Terminal or non-current values are:

- `CANCELED`
- `EXPIRED`

Only one current Super Agency subscription may exist per Super Agency.

Legacy Super Agencies may have no subscription. That state is allowed and resolves to an empty entitlement set without blocking existing application use.

## Allocation Foundation

The locked default Agency workspace allocation policy is 15 workspace slots. The default must never exceed the available Super Agency plan capacity when allocation enforcement is implemented.

Phase 15.1 does not enforce Agency allocation, Workspace allocation, membership allocation, storage allocation, active automation limits, automation execution quotas, or API commercial quotas. Phase 15.3 owns allocation, usage, and enforcement.

When Phase 15.3 implements allocation enforcement, aggregate Agency allocations must satisfy `SUM(Agency allocations) <= Super Agency plan capacity`. Over-allocation is a future hard-block policy for new allocation or creation flows only; Phase 15.1 establishes the configuration foundation without blocking current operations.

Future storage allocation flows from Super Agency storage pool to Agency allocation to Workspace allocation or consumption.

Downgrades must preserve existing Workspaces, members, Tasks, Projects, Tickets, files, Automations, XP, gamification history, and all historical data. Future enforcement may block only new resource creation above allowed limits.

Gamification history is permanently protected. Billing changes must not rewrite, delete, reset, or recalculate XP, levels, global score, badges, achievements, rewards, streaks, leaderboard history, gamification logs, or historical awards.

## Entitlement Resolution

The billing service resolves the current Super Agency subscription, reads the immutable published version, and exposes effective features and limits.

Feature resolution answers whether a feature key is enabled. Limit resolution returns a typed limit value or explicit unlimited. Phase 15.1 does not enforce task, project, ticket, storage, automation, API, Agency, Workspace, or user limits.

## Platform Management

Platform-only plan management endpoints allow master plan creation, draft version editing, publishing, next draft creation, archiving, manual Super Agency subscription provisioning, explicit trial activation, Stripe price creation, and explicit immediate Platform cancellation.

These APIs are protected by platform diagnostics / developer authority and are audited.

## Billing History

Billing History is immutable commercial lifecycle history. AuditLog remains the security/operator action record. They are intentionally separate.

Phase 15 records only genuine lifecycle events implemented in the active billing code. Phase 15.2 adds trial, checkout, subscription activation, payment failure/recovery, upgrade, downgrade scheduling/application, cancellation, restricted-mode, price creation, portal session, and Stripe webhook lifecycle entries.

## Super Agency Read

Super Agency billing APIs allow authorized Super Agency users to read current billing state and effective entitlements, start hosted Checkout for server-selected active prices, open the Stripe Customer Portal, request subscription changes, and self-cancel at period end.

Agency and Workspace dashboards do not receive purchase, checkout, payment, or subscription-management routes in Phase 15.2.

Locked-module UX is a future presentation concern. When implemented, locked states should be visible and recoverable rather than deleting or hiding data. Phase 15.1 does not hide or block production modules based on plan entitlement.

## Currency and Interval

Phase 15.2 supports USD pricing with monthly and annual intervals through `BillingPrice`. Tax, invoices UI, coupons, metered usage, overages, and allocation/usage enforcement remain deferred.

## Migration

Phase 15.1 adds migration `0076_phase15_1_billing_foundation`. Reconciliation adds forward migration `0077_phase15_1_billing_foundation_hardening`.

Phase 15.2 adds migration `0078_phase15_2_stripe_subscription_lifecycle`.

The migrations are additive and create only the billing schema required for master plans, plan versions, entitlements, Super Agency subscriptions, Super Agency billing accounts, billing prices, checkout attempts, Stripe event idempotency, plan type, grace/restricted status vocabulary, and Billing History.

Shared development database migration remained read-only during Phase 15.2. Final clean/legacy migration compatibility verification passed during Phase 15.2 focused refinement and final verification.

## Phase 15.3 Allocation, Usage, And Enforcement

Phase 15.3 adds hierarchical allocation and usage enforcement without creating a second billing system. `MasterPlanVersion` and `PlanEntitlement` remain the Super Agency pool authority. Agency and Workspace allocation rows constrain child growth only where allocation is configured.

Resource catalog dimensions are centralized:

- Live capacity: Agencies, Workspaces, Workspace memberships, storage bytes, and active Automations.
- Period metered: Automation executions and API requests.
- Feature only: Webhooks, GHL, Slack, Webex, and other module enablement flags.

Effective feature precedence is:

1. Platform-supported catalog key.
2. Current managed Super Agency plan entitlement.
3. Existing direct `FeatureEntitlement` override as a managed-plan disable override.

Direct `FeatureEntitlement` rows are preserved as compatibility records. They are not converted into plan rows. For unmanaged legacy Super Agencies with no current subscription, direct overrides may continue to describe compatibility feature state; no subscription is not interpreted as zero capacity.

Allocation hierarchy is:

- Super Agency pool: resolved from current plan limits.
- Agency allocation: stored in `AgencyResourceAllocation`.
- Workspace allocation: stored in `WorkspaceResourceAllocation`.

New Agency creation in managed commercial mode is transactionally protected by a PostgreSQL advisory lock. It verifies the Agency count limit and requires at least 15 unallocated Workspace slots before the Agency row is created. On success, the new Agency receives a 15 Workspace-slot allocation in the same transaction. If fewer than 15 slots remain, creation is rejected with `RESOURCE_LIMIT_EXCEEDED`; no partial allocation is created.

Existing legacy/unallocated Agencies remain compatible. Missing allocation rows do not mass-block existing tenants after migration. Once allocation rows are configured, new Workspace and active membership growth is enforced against those rows.

Usage rules:

- Workspace membership capacity counts active `WorkspaceMembership` rows. Multi-Workspace users count once per active Workspace membership.
- Pending invitations do not consume capacity; activation/reactivation paths must re-check capacity.
- Storage usage reads the existing Asset/reservation quota source. Existing list, preview, download, archive, delete, retention, and purge paths remain data-preserving operations.
- Active Automation usage counts published workflows. Existing published workflows are not disabled by downgrade or over-limit state.
- Automation execution and API request counters use UTC calendar-month periods. Annual subscriptions still use monthly metered periods.

Over-limit state is derived from `used > limit` in usage summaries. Downgrades and allocation reductions preserve existing Agencies, Workspaces, memberships, files, Automations, and historical data. New growth is blocked until usage drops below the configured allocation.

Billing grace remains full operation. Phase 15.2 restricted-mode read-only access remains authoritative before Phase 15.3 resource checks. Error codes are deterministic: `FEATURE_NOT_ENTITLED`, `RESOURCE_LIMIT_EXCEEDED`, `ALLOCATION_EXCEEDED`, `USAGE_QUOTA_EXCEEDED`, and `ACCOUNT_RESTRICTED`.

Allocation changes record AuditLog entries and BillingHistory `ALLOCATION_UPDATED` events. Usage reads and counter increments do not spam AuditLog.

Gamification protection remains permanent: plan changes, quota exhaustion, allocation reductions, over-limit state, and locked modules must not delete, rewrite, recalculate, reverse, or penalize XP, levels, global score, badges, achievements, streaks, rewards, leaderboards, or gamification logs. If a business action is blocked before domain mutation, no new XP is emitted because no work occurred.

UI surfaces added in Phase 15.3:

- Super Agency Billing usage summary with plan, allocation, and usage cards.
- Agency Plan & Usage page for allocation-only visibility and Workspace allocation management APIs.
- Workspace Usage & Limits page with read-only usage and over-limit state.

These pages intentionally do not add Phase 15.4 invoice, payment-method, tax, coupon, overage, or expanded payment-management UI.

## Phase 15.4 Billing UI, Invoices, And Payment Management

Phase 15.4 main implementation adds expanded Super Agency billing management on top of the existing Phase 15.1 through Phase 15.3 billing system. It does not create Agency, Workspace, Organization, or second parallel billing ownership.

The Super Agency billing page now has tabbed operational surfaces for overview, current plan, usage, Agency allocations, payment method summary, invoices, billing history, and subscription recovery actions. Agency and Workspace contexts remain usage/allocation-only and do not receive checkout, invoice, payment-method, Stripe customer, or subscription-management authority.

Invoices are stored as a minimal Super Agency-owned Stripe projection in `BillingInvoice`. The projection stores provider ids, invoice number, status, currency, nonnegative amount totals in minor units, provider timestamps, hosted invoice/PDF links, and sync timestamps. It deliberately avoids raw Stripe payload storage, card data, payment method secrets, tax calculation, coupons, overages, metered billing logic, or custom payment collection.

Stripe invoice webhook events update the projection through the existing billing service and Stripe gateway. Manual Super Agency invoice refresh lists recent provider invoices for the existing Super Agency billing account and upserts the same projection. Platform support can read invoice metadata for a Super Agency without exposing hosted invoice or PDF links.

Manual invoice refresh is rate-limited per Super Agency and user before Stripe/customer lookup. Invoice status filtering is allowlisted to supported invoice states before Prisma query construction.

Payment method management remains Stripe-hosted. Zea Play reads only a safe default payment method summary from Stripe Customer Portal context: provider, method type, display brand, last four digits, and expiry. Zea Play does not store card records and does not implement custom payment forms, PaymentIntent, SetupIntent, card update, card collection, or secret-bearing browser Stripe flows.

Billing history read APIs expose human-readable commercial lifecycle labels for the Super Agency. AuditLog remains the security/operator record; BillingHistory remains commercial lifecycle history.

Phase 15.4 adds migration `0080_phase15_4_invoice_projection`. The migration is additive and creates only the Super Agency invoice projection table plus nonnegative amount checks, Super Agency foreign key, provider invoice uniqueness, and invoice lookup indexes.

Final certification evidence:

- `pnpm prisma:validate`: PASS.
- `pnpm prisma:generate`: PASS.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- Focused API billing/schema/Stripe/enforcement tests: PASS, 5 suites / 52 tests.
- Focused web billing tests: PASS, 21 files / 187 tests.
- Phase 15.3/gamification regression tests: PASS, 3 suites / 109 tests. The requested `gamification.controller.spec.ts` pattern did not match a file in this checkout.
- Root `pnpm test`: PASS, 17 tasks; API PASS, 57 suites / 560 tests; worker PASS, 8 suites / 28 tests; web PASS, 21 files / 187 tests.
- Root `pnpm test:integration` with `TURBO_ENV_MODE=loose` on isolated fully migrated PostgreSQL: PASS, 8 tasks; API PASS, 6 suites / 109 tests; worker PASS, 8 suites / 28 tests.
- `pnpm phase14:6:13:migration-compat`: PASS through 80 migrations; latest `0080_phase15_4_invoice_projection`; clean install, legacy upgrade, Phase 15 fixture upgrade, zero-agency, one-agency, and many-agency scratch databases passed. Phase 15 fixture upgrade produced zero automatic invoice projections.
- `pnpm test:e2e`: PASS, 21 tests.
- `pnpm build`: PASS, 11 tasks with the existing Next.js ESLint plugin warning.
- `pnpm audit --audit-level high`: PASS; one moderate advisory remains below high threshold.
- `git diff --check`: PASS; Windows LF/CRLF warnings only.
- Focused security/scope grep: PASS; hits were expected docs, tests, provider-secret redaction examples, and existing non-billing domains.
- Read-only shared development migration status: 80 migrations found; `0080_phase15_4_invoice_projection` is pending and was not applied because shared-dev migration is forbidden in this phase.
- Stripe live/test external verification is NOT VERIFIED; no Stripe credentials were used.
- Stripe Customer Portal external configuration is NOT VERIFIED; no Stripe credentials were used.

Phase 15.4 Billing UI + Invoices + Payment Management is COMPLETE / PASS after focused refinement and final certification.

## Phase 15.5 Final Billing Security And Regression Certification

Phase 15.5 completes Phase 15 certification. It added no new billing features and no schema migration. The final migration state remains 80 migrations through `0080_phase15_4_invoice_projection`; no `0081` migration was created.

Final certification confirms:

- Commercial ownership remains Platform-defined plans/pricing with Super Agency as the only billing customer.
- Agency remains allocation-only and Workspace remains consumption-only.
- Organization remains legacy compatibility metadata only and is not billing authority.
- Super Agency custom roles cannot receive platform-only billing or diagnostics permissions.
- Checkout, Portal, subscription changes, cancellation, trial activation, and invoice refresh are permissioned, tenant-scoped, server-resolved, and rate-limited.
- Stripe integration remains server-side through hosted Checkout, hosted Customer Portal, signed webhooks, provider reconciliation, and safe projections only.
- BillingInvoice remains a minimal Super Agency-owned projection and never stores raw Stripe invoice JSON, payment objects, card data, PaymentIntent data, tax data, coupons, or overage charge payloads.
- Payment method management remains Customer Portal-only, with Zea Play exposing only safe summary fields.
- Restricted mode preserves data and billing recovery while blocking new business writes, without mutating `SuperAgency.status`.
- Phase 15.3 feature enforcement remains complete with 176 matrix rows and zero unclassified controlled mutation routes.
- Phase 15.5 security matrix has 44 reviewed rows and zero UNKNOWN, UNREVIEWED, or PARTIAL rows.
- Gamification history, XP, levels, global score, badges, achievements, streaks, rewards, leaderboards, and gamification logs remain protected from billing lifecycle and quota events.

Final verification evidence:

- `pnpm prisma:generate`: PASS.
- `pnpm prisma:validate`: PASS.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- Focused Phase 15.5 security tests: PASS, 8 suites / 68 tests.
- Focused gamification/core regression: PASS, 11 suites / 249 tests.
- Phase 15.3 PostgreSQL concurrency suite: PASS, 1 suite / 6 tests.
- Fresh full web stability suite: PASS, 21 files / 187 tests.
- Root `pnpm test`: PASS, 17 tasks; API 57 suites / 564 tests; worker 8 suites / 28 tests; web 21 files / 187 tests.
- Full isolated `pnpm test:integration`: PASS, 8 tasks; API 6 suites / 109 tests; worker 8 suites / 28 tests.
- `pnpm phase14:6:13:migration-compat`: PASS through 80 migrations across clean install, legacy upgrade, populated Phase 15.2 upgrade, zero-agency, one-agency, and many-agency scratch databases.
- `pnpm test:e2e`: PASS, 21 tests.
- `pnpm build`: PASS, 11 tasks with the existing Next.js ESLint plugin warning.
- `pnpm audit --audit-level high`: PASS; one moderate advisory remains below high threshold.
- `git diff --check`: PASS; Windows LF/CRLF warnings only.
- Shared development database status was checked read-only and reports the schema is up to date with 80 migrations; no shared-dev migration was applied by this certification pass.
- Stripe live/test external verification, Customer Portal live configuration, live Checkout, live invoice retrieval, and live payment-method retrieval remain NOT EXTERNALLY VERIFIED and are production deployment prerequisites.

Phase 15 is COMPLETE / CERTIFIED. Phase 16 is NOT STARTED.

## Next Phase

Phase 15.1 is foundation only: Platform master plans, immutable versions, typed entitlements, Super Agency subscription foundation, Billing History, read-only Super Agency billing state, and no operational enforcement.

Phase 15.2 is complete/pass after focused refinement and final verification.

Phase 15.3 owns allocation, usage, and enforcement and is complete/pass after focused refinement and final certification. Phase 15.4 owns expanded billing UI, invoices, and payment management and is complete/pass after focused refinement and final certification. Phase 15.5 owns final billing security/regression certification and is complete/pass. Phase 16 - Docs, Forms, and Goals is next but not started.

## Phase 15.1 Final Certification

Phase 15.1 final verification passed with 77 migrations through `0077_phase15_1_billing_foundation_hardening`.

Final certification confirms:

- Platform defines master plans globally.
- Super Agency is the primary commercial customer.
- Agency remains allocation-only.
- Workspace remains consumption-only.
- Stripe was deferred during Phase 15.1 and is integrated in Phase 15.2 main implementation.
- Trial foundation is 14-day no-card.
- Grace foundation is 7-day.
- Default Agency workspace allocation foundation is 15 slots.
- Membership capacity is membership-based.
- Storage allocation model remains Super Agency -> Agency -> Workspace.
- Automation limit foundation keeps active workflow and execution quota concepts distinct.
- Commercial API quota remains separate from existing API security rate limits.
- Webhooks remain feature entitlements only.
- Integrations support provider-specific entitlements.
- Gamification history is permanently protected.
- Downgrades preserve existing data and may only block future over-limit creation once enforcement exists.
- Billing History and AuditLog are both required and remain separate records.
- Private, enterprise, internal, free, demo, and QA plan types are supported.
- At Phase 15.1 final certification time, Phase 15.2, 15.3, 15.4, and 15.5 remained not started.

## Phase 15.2 Stripe Lifecycle Main Implementation

Phase 15.2 main implementation passed with 78 migrations through `0078_phase15_2_stripe_subscription_lifecycle`.

Implemented:

- 14-day explicit internal no-card trials; no Stripe customer or subscription is created merely to start trial.
- 7-day trial grace and 7-day payment-failure grace with full access plus warning during grace and read-only restricted mode after grace expiry.
- USD-only monthly and annual `BillingPrice` records linked to published plan versions.
- Stripe SDK usage centralized in the API billing gateway.
- Stripe-hosted Checkout with server-resolved Super Agency customer and server-resolved price.
- Stripe Customer Portal session creation with server-side configuration ID.
- Webhook signature verification using the raw request body and a Stripe event ledger for idempotency.
- Provider-confirmed subscription activation/recovery/cancellation transitions through webhooks.
- Immediate upgrade request using Stripe proration; internal entitlement changes wait for provider confirmation.
- Downgrade scheduling for the next billing period.
- Self-cancel at period end and explicit Platform immediate cancellation.
- Commercial restricted-mode write blocking for authenticated API writes, public API writes, inbound webhook ingestion, automation execution, and worker-generated recurrence mutations.
- Billing lifecycle worker scan for trial-grace and restricted-mode deadline transitions.
- Super Agency billing UI for plan checkout, access warnings, portal access, and period-end cancellation.

Out of scope and deferred:

- Resource allocation and usage enforcement remained deferred at Phase 15.2 closeout and is now partially implemented by Phase 15.3.
- Stripe Tax, custom card collection, PaymentIntent/SetupIntent flows, coupons, metered overages, invoice UI, and payment-method UI are not implemented.
- Full integration testing, clean/legacy migration compatibility, E2E, build, audit, and final Stripe lifecycle certification passed during Phase 15.2 focused refinement and final verification.
- Stripe live/test external verification and Stripe Customer Portal external configuration remain NOT VERIFIED because no Stripe credentials were used in this phase.

At Phase 15.2 closeout, Phase 15.3 and later work had not yet been started. Later sections supersede that historical status.

## Phase 15.2 Final Certification

Phase 15.2 final verification passed with 78 migrations through `0078_phase15_2_stripe_subscription_lifecycle`. No `0079` migration was required or created.

Final certification confirms:

- The commercial owner remains Super Agency only. Agencies and Workspaces do not hold billing accounts, subscriptions, checkout state, Stripe customer identity, or plan authority.
- Pricing is USD-only with monthly and annual `BillingPrice` intervals.
- Trials are explicit internal 14-day no-card trials and do not create Stripe customers or subscriptions.
- Trial grace and payment-failure grace are 7 days with full operation during grace, followed by read-only restricted mode after grace expiry.
- Checkout and Customer Portal use Stripe-hosted flows only. Zea Play does not collect card data and does not implement custom PaymentIntent, SetupIntent, payment-method, Stripe Tax, invoice UI, coupon, metered usage, or overage flows in Phase 15.2.
- Stripe SDK usage remains centralized in the API billing gateway. Webhooks verify signatures against the raw request body and use the Stripe event ledger for idempotency.
- Immediate upgrades use `pending_if_incomplete` / proration semantics and internal entitlement changes become authoritative only after provider price confirmation.
- Downgrades and same-tier interval changes are scheduled for the next billing period through explicit current/future subscription-schedule phases.
- New plan-change requests are rejected while a pending scheduled billing change exists.
- Super Agency self-cancel remains period-end only. Platform immediate cancellation is explicit. Cancellation paths clear pending scheduled change fields.
- Billing History records commercial lifecycle events while AuditLog remains the security/operator record.
- Restricted-mode write blocking covers authenticated app writes, public API writes, inbound webhook ingestion, automation execution mutations, and worker-generated recurrence mutations.
- Billing lifecycle worker processing handles trial-grace, payment-grace, and restricted-mode deadline transitions without deleting tenant data.
- Existing data, files, Tasks, Projects, Tickets, Automations, XP, global scores, gamification history, and historical records are preserved by billing changes and migration upgrades.
- Resource allocation and usage quota enforcement were deferred at Phase 15.2 closeout. Tax, invoice UI, custom card/payment UI, coupons, and overages remain deferred to later phases.
- Stripe live/test external verification is NOT VERIFIED.
- Stripe Customer Portal external configuration is NOT VERIFIED.

Final verification evidence:

- `pnpm prisma:generate`: PASS.
- `pnpm prisma:validate`: PASS.
- Focused API billing/schema/Stripe/permission/public API/inbound webhook/automation tests: PASS, 7 suites / 95 tests.
- Focused worker billing lifecycle / recurrence / storage tests: PASS, 3 suites / 10 tests.
- Focused web billing/navigation tests: PASS, 3 files / 13 tests.
- Fresh full web stability run: PASS, 18 files / 175 tests.
- Root `pnpm test`: PASS, 17 tasks; API PASS, 54 suites / 524 tests; worker PASS, 8 suites / 28 tests; web PASS, 18 files / 175 tests.
- Root `pnpm test:integration` on isolated fully migrated PostgreSQL: PASS, 8 tasks; API PASS, 5 suites / 103 tests; worker PASS, 8 suites / 28 tests.
- Clean isolated migration deploy/status: PASS, 78 migrations through `0078_phase15_2_stripe_subscription_lifecycle`.
- Explicit 0077-to-0078 populated upgrade fixture: PASS; seeded Super Agencies, Agencies, Workspaces, plans, versions, and subscriptions were preserved and no Stripe/customer/checkout/trial lifecycle rows were auto-created.
- `pnpm phase14:6:13:migration-compat`: PASS through 78 migrations across clean, legacy, zero-agency, one-agency, and many-agency scratch databases.
- `pnpm test:e2e`: PASS, 21 tests.
- `pnpm build`: PASS, 11 tasks.
- `pnpm audit --audit-level high`: PASS; one moderate advisory remains below high threshold.
- `git diff --check`: PASS; Windows LF/CRLF warnings only.
- Read-only shared development migration status: pending `0053` through `0078`; no shared-dev migration was applied.

Phase 15.2 is complete/pass. Phase 15.3 Hierarchical Allocation + Usage + Enforcement is complete/pass after focused refinement and final certification.

## Phase 15.3 Main Implementation Progress

Phase 15.3 remains partial. Migration count remains 79 through
`0079_phase15_3_allocation_usage_enforcement`; no `0080` migration was created for the current
remediation pass because the added enforcement uses the existing allocation and
`billing_usage_counters` schema.

Implemented/updated semantics:

- Workspace membership capacity is enforced through `BillingEntitlementService` at membership
  activation/reactivation. Pending invitations do not consume capacity; active WorkspaceMembership
  rows do. Same users in multiple Workspaces count once per active WorkspaceMembership.
- Live capacity checks now evaluate the hierarchy for commercially managed accounts: Super Agency
  plan limit, Agency allocation, and Workspace allocation are all ceilings where configured.
- Storage upload and Cloud Drive import now call the same commercial storage check before creating
  storage-consuming reservations. Existing file reads, downloads, archive, delete, and reduction
  flows remain available and do not delete data merely because an allocation is exceeded.
- Active automation publish/enable paths now enforce the commercial automation feature and active
  automation capacity. Disable and archive remain allowed recovery operations.
- Newly created AutomationExecution rows reserve monthly commercial usage in the same transaction
  as execution creation. Duplicate trigger execution creation returns the existing execution and
  worker retries do not meter again.
- Public API requests keep the existing API-key security rate limiter. After successful API-key
  authentication, tenant resolution, security rate-limit pass, and scope authorization, a commercial
  monthly API request unit is reserved before the business handler. Business validation errors after
  that point still count; invalid API keys and security-rate-limited requests do not.
- Commercial feature resolution continues to treat the Super Agency plan as a hard ceiling for
  managed subscriptions. Direct `FeatureEntitlement` rows may disable access but cannot enable a
  feature absent from the active commercial plan. Unmanaged legacy Super Agencies keep pre-billing
  direct entitlement compatibility.
- Agency and Workspace allocation management controls were added to the existing billing usage UI.
  They show child usage/allocation state, over-limit state, unlimited formatting, and scoped edit
  actions without exposing Stripe customer, invoice, card, payment method, or price details.

Remaining partial areas before Phase 15.3 main implementation can pass:

- Broad controller-level feature enforcement is not yet complete across every Task, Project,
  Ticket, Calendar, Webhook, provider integration, and Gamification mutation surface.
- Locked sidebar/direct-route behavior still needs complete coverage for every commercially
  disabled module.
- Some legacy attachment paths outside the central workspace file upload/import flow still need a
  final storage quota audit.
- Focused tests were run for touched backend/web surfaces, but the full required Phase 15.3
  focused matrix and root unit suite have not been completed in this pass.

## Phase 15.3 Main Implementation Blocker Remediation

This remediation keeps the migration count at 79 through
`0079_phase15_3_allocation_usage_enforcement`; no `0080` migration was required.

Completed hardening:

- Workspace membership activation paths in `WorkspacesService.addMembership` and
  `WorkspacesService.updateMembership` are the only current WorkspaceMembership activation paths.
  No Workspace invitation model exists in the current schema; Super Agency invitations create
  `SuperAgencyMembership`, not `WorkspaceMembership`. Membership activation is checked inside the
  final membership transaction, pending invitations are not counted, active memberships are counted
  as rows, and membership reduction remains allowed without a capacity check.
- Task, Project, and Ticket file attachment upload initialization now uses the same commercial
  storage authority as primary Asset uploads and cloud-drive stored imports. If the tenant is
  unmanaged, these paths fall back to the legacy workspace storage quota logic. URL attachments and
  external cloud-drive metadata links do not reserve ZeaPlay object-storage bytes.
- Workspace allocation updates now write both `AuditLog` and immutable `BillingHistory` with
  `ALLOCATION_UPDATED` metadata containing safe scope, resource, old/new target scope identifiers,
  allocation value, and unlimited state. Failed allocation validation still occurs before history is
  written.
- Commercial feature gates now use `BillingEntitlementService.assertWorkspaceFeatureAvailable`.
  Backend mutation paths were added for Tasks, Projects, Tickets, Calendar custom events,
  Automation authoring/activation, Public API requests, Webhooks, and provider-specific
  GHL/Slack/Webex Integration actions. Read paths remain data-preserving. Disable/archive/delete
  and other recovery/reduction operations remain available where they reduce usage or preserve
  historical data.
- Generic REST remains independent because the current commercial feature catalog has no
  provider-specific Generic REST key. It is not bound to GHL, Slack, or Webex entitlements.
- Commercial plan features remain a hard ceiling for managed Super Agencies. Direct
  `FeatureEntitlement` rows may disable a managed plan feature but cannot enable a feature absent
  from the active commercial plan. Unmanaged legacy tenants with no current subscription retain
  pre-billing compatibility instead of being treated as fully disabled.
- Prisma generate EPERM was diagnosed as the local project dev stack holding the generated Prisma
  query-engine DLL. The project dev process was stopped gracefully, `pnpm prisma:generate` and
  `pnpm prisma:validate` passed, and no schema migration was created for the file lock.

Still partial before Phase 15.3 main implementation should be certified:

- Locked sidebar and direct-route UX still need complete coverage across Super Agency, Agency, and
  Workspace shells.
- Allocation UI tenant-switch, late-response, permission-visibility, and validation tests still
  need dedicated coverage beyond the existing billing UI tests.
- Public API commercial quota boundary/concurrency and rate-limit separation have focused service
  coverage through the guard/service tests, but the full requested matrix of explicit GET/write
  boundary and concurrent request tests remains incomplete.
- Automation execution quota/idempotency coverage exists in service tests, but the requested
  boundary/concurrency matrix remains incomplete.
- Broad feature enforcement has representative backend mutation coverage, but every mutation route
  in every module has not been exhaustively certified.

## Phase 15.3 Final Main-Implementation Blocker Remediation Attempt

This remediation still keeps the migration count at 79 through
`0079_phase15_3_allocation_usage_enforcement`; no `0080` migration was created.

Completed in this attempt:

- Locked navigation now resolves commercial state through centralized navigation metadata rather
  than scattered component checks. Workspace operational modules with commercial feature keys remain
  discoverable as locked when plan-disabled, while RBAC-denied items remain hidden by the existing
  permission filters.
- Direct-route commercial locking was added through a shared dashboard route boundary for the
  Workspace module routes that exist today: Tasks, Projects, Tickets, Calendar, Files, Automation,
  and Workspace Gamification. The Super Agency Gamification route is also route-locked by
  commercial entitlement.
- Agency and Workspace billing entitlement reads were added as read-only, tenant-guarded APIs that
  return effective feature and limit state without exposing subscription, Stripe customer, invoice,
  card, payment-method, or price details to Agency/Workspace contexts.
- Allocation UI tests now cover Super Agency Agency allocation rendering, Agency Workspace
  allocation rendering, over-limit state, unlimited display, invalid finite edit rejection, scoped
  same-ID cache keys, and representative financial-privacy absence checks.
- Public API guard tests now prove insufficient scopes do not reserve commercial API quota, while
  authorized GET and write requests reserve quota after scope authorization.
- Automation execution tests now prove duplicate canonical trigger execution creation and
  idempotent replay do not double-meter usage. New replay creation consumes exactly one commercial
  unit.
- Active automation publish tests now explicitly exercise two publish attempts where the shared
  quota policy permits only the first attempt inside the workspace quota lock.
- Billing entitlement tests now cover automation quota off-by-one behavior at quota = 3, disabled
  API feature no-meter behavior, storage capacity locking on the canonical storage authority, and
  no BillingHistory spam for API/automation/storage usage increments.
- Allocation privacy wording was tightened so allocation screens do not render invoice, card,
  payment method, subscription price, or Stripe customer terms.

Current validation evidence from this remediation:

- `pnpm prisma:generate`: PASS.
- `pnpm prisma:validate`: PASS.
- Focused web locked-route/allocation tests: PASS, 20 files / 182 tests.
- Focused API billing/automation/API/storage/feature tests: PASS, 10 suites / 158 tests.
- Focused gamification API tests: PASS, 3 suites / 107 tests.
- Focused gamification web run: PASS, 20 files / 182 tests.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- Root `pnpm test`: PASS, 17 tasks; API PASS, 55 suites / 543 tests; worker PASS,
  8 suites / 28 tests; web PASS, 20 files / 182 tests.

Remaining reasons the Phase 15.3 main gate should not yet be certified PASS:

- Tenant-switch late-response race tests for Super Agency, Agency, and Workspace allocation views
  remain represented by scoped query-key coverage, not by explicit late A-resolves-after-B UI
  simulations.
- Public API and automation quota concurrency tests are still primarily service/policy-lock focused
  and do not yet prove true simultaneous database-level contention on a migrated PostgreSQL
  database.
- Storage concurrency coverage proves canonical authority and capacity locking in focused service
  tests, but does not yet include a true two-upload simultaneous reservation race against a real
  transaction boundary.
- Allocation edit dialogs still rely on backend authority for parent-capacity rejection; the
  frontend does not yet display a full parent allocated/remaining/requested-delta model for every
  resource.
- Backend feature enforcement has broad representative mutation coverage, but every mutation route
  in every module has not been exhaustively certified against disabled commercial features.

## Phase 15.3 Backend Feature Enforcement Gate Closure

This closure keeps the migration count at 79 through
`0079_phase15_3_allocation_usage_enforcement`; no `0080` migration was created.

The remaining main-gate blocker is remediated. Backend feature-enforcement route coverage is now
certified by a machine-readable matrix at
`apps/api/src/modules/billing/phase15-3-feature-enforcement.matrix.ts`, a markdown handoff artifact
at `docs/phase15-3-feature-enforcement-matrix.md`, and an executable reflection guard in
`phase15-3-feature-enforcement-matrix.spec.ts`.

Certified controlled domains:

- Tasks, Projects, Tickets, Calendar, Files/Assets, Automation, Public API, Webhooks,
  GHL/Slack/Webex provider integrations, Generic REST, Gamification active actions, and
  worker/internal bypass entry points.
- Reads remain allowed when commercially disabled so existing data stays recoverable.
- Reduction/recovery operations remain allowed where they disable, archive, delete, reduce usage,
  or preserve already-committed historical semantics.
- Generic REST remains `NOT-COMMERCIALLY-GATED` because the current commercial feature catalog has
  no Generic REST key. The Generic REST fixed-origin, SSRF, credential, and action safeguards remain
  authoritative.
- Gamification active manager/admin/reward/point-rule/reconciliation writes now enforce
  `gamification.enabled`. Historical XP reads and system XP ledger preservation remain available.

Validation evidence:

- Migration inventory: PASS, 79 directories, latest `0079_phase15_3_allocation_usage_enforcement`,
  no `0080`.
- `pnpm prisma:generate`: PASS.
- `pnpm prisma:validate`: PASS.
- Focused feature-enforcement and gamification tests: PASS, 2 suites / 106 tests.
- Focused backend matrix/domain tests: PASS, 14 suites / 296 tests.
- Phase 15.3 PostgreSQL concurrency integration: PASS, 1 suite / 6 tests.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- Root `pnpm test`: PASS, 17 tasks; API PASS, 56 suites / 550 tests; worker PASS,
  8 suites / 28 tests; web PASS, 20 files / 186 tests.

Phase 15.3 hierarchical allocation, usage, and enforcement is COMPLETE / PASS after focused
refinement and final certification. Phase 15.4 was not started.

Read-only shared development migration status at final certification time reported 79 migrations
and database schema up to date on `zea_play`; no shared-dev migration was applied during the
certification pass.
