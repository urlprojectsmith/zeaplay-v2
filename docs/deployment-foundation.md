# Deployment Foundation

Phase 1 prepares local development and CI foundations only. Production migration and deployment are intentionally not automatic from pull requests.

Deployment assumptions:

- App servers remain stateless.
- PostgreSQL remains the source of truth.
- Redis is replaceable and rebuildable.
- Object storage access goes through `StorageAdapter`.
- Integrations and automations run through queues/adapters in later phases.
- Docker Compose is a local development stack. Production deployments must use managed secrets,
  private networking, digest-pinned images, and environment-specific infrastructure.

Container images used by local development must be mirrored or replaced with organization-approved,
digest-pinned images before production deployment. PgBouncer currently uses the public
`bitnamilegacy/pgbouncer` image for local availability because the former free Bitnami Docker Hub
repository no longer publishes tags.
