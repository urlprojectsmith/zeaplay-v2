# Testing

Baseline test layers:

- Vitest for shared packages and frontend component smoke tests
- Jest and Supertest for NestJS API integration tests
- Jest for worker health and queue registration tests
- Playwright for browser-level route smoke tests

Commands:

- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`

Phase 2 and Phase 3 integration tests require Docker Compose PostgreSQL, Redis,
and MinIO to be running because they verify refresh-token rotation, CSRF, RBAC,
cross-tenant project/asset isolation, upload validation, idempotent completion,
and processing job creation against real persistence.

Worker tests cover asset-processing success, duplicate execution, invalid job
envelopes, missing assets, tenant mismatch, and storage failure handling.
