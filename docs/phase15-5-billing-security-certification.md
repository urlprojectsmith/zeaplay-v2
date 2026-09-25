# Phase 15.5 Billing Security Certification

Date: 2026-09-25
Branch: developed
Scope: Prompt 1 security hardening plus Prompt 2 final Phase 15 certification
Status: Phase 15.5 COMPLETE / PASS; Phase 15 COMPLETE / CERTIFIED; Phase 16 NOT STARTED

## Scope

Phase 15.5 Prompt 1 reviewed and hardened the completed Phase 15.1 through 15.4 billing system. It did not add billing features and did not start Phase 16.

Reviewed areas include Platform plan/pricing management, manual provisioning, trial activation, Super Agency checkout, Customer Portal, subscription changes, cancellation, invoices, payment method summary, BillingHistory, Stripe webhooks, lifecycle worker processing, allocation and usage enforcement, commercial restricted mode, feature hard ceilings, tenant switching/cache behavior, role boundaries, redaction, migration safety, and regressions across the five dashboard environments.

## Security Boundaries

Commercial ownership remains:

- Platform defines global plans, pricing, and support operations.
- Super Agency is the only commercial customer and Stripe owner.
- Agency is allocation-only.
- Workspace is consumption-only.
- Organization remains legacy compatibility metadata only and is not billing authority.

Authenticated billing routes use JWT identity plus server-resolved tenant guards. Billing endpoints do not trust user ids, role names, Super Agency ids, Stripe customer ids, prices, amounts, redirect URLs, trial clocks, or provider ids from arbitrary client body fields.

## Tenant Ownership

Super Agency financial routes use `SuperAgencyTenantGuard` and permission checks. Agency and Workspace billing routes expose only entitlements, allocation, and usage views. They do not expose checkout, Customer Portal, invoices, invoice URLs, payment method summary, Stripe customer identity, subscription mutation, or financial BillingHistory.

Same-ID compatibility remains explicit: Super Agency, Agency, and Workspace ids are interpreted through scoped route namespaces, scoped headers, explicit model relations, and entity-typed audit records.

## Provider Trust Model

Stripe is trusted only through server-side SDK calls and signed webhooks. The browser can request safe internal selections such as plan version and billing interval, but the server resolves Stripe price id, Stripe customer id, Checkout return URLs, Portal return URL, and subscription ids.

Provider metadata alone is not tenant authority. Webhook invoice projection maps through stored Stripe customer or subscription records before attaching data to a Super Agency.

Stripe external live/test connectivity, Customer Portal live configuration, live invoice retrieval, and live payment method retrieval are not externally verified in this local Prompt 1 pass because no Stripe credentials were used. These remain production deployment prerequisites.

## Secret Handling

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only environment variables. No `NEXT_PUBLIC_STRIPE_*` usage exists. Config validation fails closed when `STRIPE_ENABLED=true` without the required secret, webhook secret, or portal configuration id.

Provider errors are not exposed raw to clients by the global exception filter. Stripe webhook failures store safe error codes in the event ledger.

## Webhook Model

Stripe webhook handling uses a dedicated raw-body middleware route before JSON parsing, bounded by `STRIPE_WEBHOOK_MAX_BODY_BYTES`. Missing signatures are rejected. Signature verification is centralized in the Stripe gateway.

Event idempotency is tracked in `StripeBillingEvent`. `PROCESSED` and `IGNORED` events short-circuit duplicates. Failed processing is marked `FAILED` after catching the error so later retries remain possible. Subscription and invoice processing retrieves current provider objects before mutation, reducing stale/out-of-order event risk.

Existing inbound webhook raw-body/HMAC behavior remains separate under `/api/v1/inbound` and is not replaced by the Stripe webhook route.

## Financial Privacy

`BillingInvoice` is a minimal Super Agency-owned projection. It stores provider invoice id, subscription id, invoice number, status, currency, minor-unit amount totals, provider timestamps, provider invoice links, and sync timestamps. It does not store raw Stripe invoice JSON, payment objects, PaymentIntent data, card data, customer email, tax details, coupons, or overage charge data.

Super Agency invoice reads may return provider invoice/PDF links after tenant authorization. Platform support invoice reads strip those links. Agency and Workspace surfaces never receive invoice/payment method data.

Payment method management remains Customer Portal-only. Zea Play reads only type, brand/display brand, last4, expiry, and default summary state. No attach, detach, replace, default-card, card collection, PaymentIntent, SetupIntent, or Stripe Elements endpoint was added.

## Quota And Concurrency

Phase 15.3 enforcement remains the authoritative quota layer. Agency and Workspace allocation updates use controlled resource keys and hierarchy validation. Usage counters and quota reservations remain PostgreSQL-backed. Redis is not billing authority.

Manual invoice refresh and high-risk billing provider actions are now rate-limited by Super Agency and user buckets before downstream provider/subscription work:

- checkout session creation
- Customer Portal session creation
- subscription change
- subscription cancellation
- platform trial activation
- manual invoice refresh

Production rate-limit storage failure fails closed for these actions.

## Restricted-Mode Enforcement

Commercial restricted mode remains separate from tenant operational status. Billing state does not mutate `SuperAgency.status`. Restricted mode blocks new business writes while preserving login, read-only access, data, and billing recovery routes.

Super Agency billing recovery routes remain accessible while restricted. Descendant Agency and Workspace contexts see usage/allocation or generic restricted state without financial details.

## Feature Enforcement

The Phase 15.3 feature enforcement reflection matrix remains the executable source of truth for controlled mutation routes. Prompt 1 reran the reflection test with zero unclassified controlled mutation routes.

Feature and limit keys remain allowlisted. Legacy unmanaged Super Agencies with no current subscription remain readable and compatible; no subscription is not interpreted as zero capacity for destructive retroactive blocking.

## Audit And Redaction

AuditLog actor semantics remain:

- Platform action -> platform actor.
- Super Agency user action -> real tenant actor.
- Stripe webhook -> provider/system ledger.
- Worker deadline transition -> worker/system metadata in BillingHistory.

BillingHistory remains commercial lifecycle history, separate from AuditLog. BillingHistory reads expose minimal labels and ids, not raw metadata, invoice URLs, card summary, provider payloads, secrets, or raw errors.

Audit metadata redaction remains covered for nested/array/case-insensitive secret keys including tokens, authorization, webhook secrets, provider credentials, client secrets, API keys, and signed URLs.

## Migration Status

Migration count remains 80. Latest migration remains `0080_phase15_4_invoice_projection`. No `0081` migration was created because Phase 15.5 hardening and final certification did not require schema changes.

Migrations `0076` through `0080` remain additive. They do not rewrite historical XP, gamification history, hierarchy ownership, Organization authority, or provider network state.

Shared development database remains read-only and was not migrated by Phase 15.5. The final read-only migration status check reported the shared `zea_play` schema is up to date with 80 migrations.

The migration compatibility harness passed against phase-named scratch databases only. It verified clean install, legacy upgrade, populated Phase 15.2 upgrade through current, zero-agency, one-agency, and many-agency cases. The populated Phase 15.2 upgrade preserved Super Agency, Agency, Workspace, subscription, price, entitlement, membership, Asset, API key, Automation, and XP fixture data and produced zero automatic Agency allocations, Workspace allocations, usage counters, or invoice projections.

## Regression Coverage

Prompt 1 focused verification covers:

- Billing service/security tests.
- Stripe gateway contract tests.
- Billing schema and permission-boundary tests.
- Super Agency custom-role boundary tests.
- Developer/platform authorization tests.
- PermissionGuard restricted-mode tests.
- Phase 15.3 feature matrix reflection.
- Web billing, allocation, cache/switch, route, and shell tests.
- Gamification regression through focused service and leaderboard tests.
- Core module regressions through root unit and type/lint gates.
- PostgreSQL concurrency through the Phase 15.3 real PostgreSQL concurrency suite.

Prompt 2 final verification additionally passed:

- `pnpm phase14:6:13:migration-compat`: PASS, 80 migrations through `0080_phase15_4_invoice_projection`.
- Full isolated integration on `zea_play_phase14613_clean` with direct PostgreSQL: PASS, 8 tasks; API 6 suites / 109 tests; worker 8 suites / 28 tests.
- `pnpm test:e2e`: PASS, 21 tests.
- `pnpm build`: PASS, 11 tasks with the accepted Next.js ESLint plugin warning.
- Root `pnpm test`: PASS, 17 tasks; API 57 suites / 564 tests; worker 8 suites / 28 tests; web 21 files / 187 tests.
- Fresh full web stability run: PASS, 21 files / 187 tests.
- Focused security tests: PASS, 8 suites / 68 tests.
- Focused gamification/core regression: PASS, 11 suites / 249 tests.
- Phase 15.3 PostgreSQL concurrency suite: PASS, 1 suite / 6 tests.
- `pnpm prisma:generate`: PASS.
- `pnpm prisma:validate`: PASS.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- `pnpm audit --audit-level high`: PASS; one moderate advisory remains below high threshold.
- `git diff --check`: PASS; Windows LF/CRLF warnings only.
- Post-build browser-output Stripe secret search: PASS; no hits.

## Known Warnings

- Stripe live/test external verification is not performed locally and remains a production deployment prerequisite.
- Stripe Customer Portal live configuration is not performed locally and remains a production deployment prerequisite.
- Shared development database is read-only for certification; final status currently reports up to date with 80 migrations.
- One moderate `pnpm audit` advisory remains below the high threshold.
- Existing Next.js ESLint plugin warning may appear during web build.
- Windows LF/CRLF warnings may appear in Git tooling.
- Existing Playwright `NO_COLOR` / `FORCE_COLOR` warning belongs to Prompt 2 final verification if E2E is rerun there.

## Remaining Deployment Prerequisites

- Configure real Stripe test/live keys and webhook secret per environment.
- Configure Stripe Customer Portal in Stripe and set `STRIPE_PORTAL_CONFIGURATION_ID`.
- Register production webhook endpoint with raw-body signature verification.
- Confirm production CORS origins and `WEB_APP_URL`.
- Confirm production Redis rate-limit availability because provider actions fail closed if rate limiting is unavailable.

## Phase Status

Phase 15.5 Prompt 1 Security Hardening / Main Audit: PASS.

Phase 15.5 Final Verification: PASS.

Phase 15.5 overall: COMPLETE / PASS.

Phase 15 overall: COMPLETE / CERTIFIED.

Phase 16: NOT STARTED.
