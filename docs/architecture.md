# Architecture

Zea Play Phase 1 is a modular monolith in a pnpm/Turborepo monorepo. The API is a single NestJS application, the frontend is a Next.js App Router application, and background execution is handled by a separate NestJS worker application.

The modular monolith keeps deployment and data ownership understandable while allowing clear module boundaries for auth, agencies, workspaces, users, roles, permissions, and features. Business modules must not reach into another module's database implementation directly.

PostgreSQL is the single source of truth. Redis is used only as an acceleration and coordination layer for cache, queues, realtime, and rate limiting. It must never become the primary data store.

The worker application is separate so request paths remain stateless and responsive. Future integrations, automations, webhooks, reports, file processing, and notification workloads should flow through queues rather than blocking HTTP requests.

Storage uses an S3-compatible `StorageAdapter`. MinIO is the local implementation, but product code should depend on the adapter contract so production can use any compatible object storage.

## Tenant Domain Boundary

The current canonical hierarchy is Platform / Super Admin -> Super Agency ->
Agency -> Workspace / Sub-account. Developer and Platform authority is internal
and non-tenant. `Organization` remains legacy compatibility metadata only and
is not tenant authority.

Tenant-owned reads and writes must include the appropriate explicit scope:
`x-super-agency-id` for Super Agency routes, `x-agency-id` for Agency routes,
and `x-workspace-id` for Workspace routes. The API resolves and validates tenant
context centrally from the authenticated user plus the relevant scope header or
route parameter. Controllers use permission metadata and guards; they do not
trust frontend route state for authorization.

## Phase 3 Domain Boundary

Phase 3 adds private project assets, direct MinIO uploads, processing jobs, and
the first real worker processor. The API owns authorization, metadata, quota
reservation, presigned URL creation, and idempotent job creation. The worker
reloads database state before touching object storage and treats queue payloads
as untrusted hints.
