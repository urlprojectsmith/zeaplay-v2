# Docker Production Architecture

Status: production app-container preparation. This does not switch traffic away from the current PM2 deployment.

## Current Production Boundary

Production currently runs:

- `zeaplay-web` through PM2 on port `7100`
- `zeaplay-api` through PM2 on port `7111`
- Nginx Proxy Manager separately in Docker
- public frontend `https://play.zeacrm.com`
- public API `https://api.play.zeacrm.com/api/v1`

The Docker migration files intentionally publish temporary loopback-only ports:

- Web: `127.0.0.1:7200 -> 7100`
- API: `127.0.0.1:7211 -> 7111`

No Nginx Proxy Manager config, DNS, PM2 process, production port, PostgreSQL migration, or production secret is changed by these files.

## Files

- `apps/web/Dockerfile.prod`
- `apps/api/Dockerfile.prod`
- `docker-compose.prod.yml`
- `.dockerignore`

## Runtime Topology

```text
Nginx Proxy Manager
        |
        +--> current PM2 production apps (unchanged)

Docker validation path, loopback only:

127.0.0.1:7200 --> zeaplay-web container:7100
                         |
                         +--> https://api.play.zeacrm.com/api/v1

127.0.0.1:7211 --> zeaplay-api container:7111
                         |
                         +--> PostgreSQL, Redis, MinIO, SMTP, and providers from runtime env
```

## Container Hardening

- Runtime images use the current Node 22 Alpine patch line used by this Docker implementation.
- Containers run as non-root users.
- Compose enables `init: true` so Node receives shutdown signals cleanly and child processes are reaped.
- Compose sets `stop_grace_period: 30s` for graceful Nest shutdown hooks and Next shutdown.
- Linux capabilities are dropped with `cap_drop: ALL`.
- `no-new-privileges` is enabled.
- `/tmp` is mounted as tmpfs.
- Docker JSON logs are rotated.
- Next telemetry is disabled in the web build/runtime image.

## Environment

Images do not copy `.env`. Compose uses `env_file: .env` at runtime.

If production `.env` uses `localhost` for PostgreSQL, Redis, or MinIO endpoints, containers should be started with Docker-specific overrides that point at reachable host or service names. The compose file supports:

- `DOCKER_DATABASE_URL`
- `DOCKER_DIRECT_DATABASE_URL`
- `DOCKER_REDIS_CACHE_URL`
- `DOCKER_REDIS_QUEUE_URL`
- `DOCKER_REDIS_REALTIME_URL`
- `DOCKER_REDIS_RATE_LIMIT_URL`

On Linux Docker, `host.docker.internal` is mapped through `host-gateway` for the API container. Use that only for private host services that are intentionally reachable from local containers.

`NEXT_PUBLIC_API_URL` remains `https://api.play.zeacrm.com/api/v1` unless explicitly overridden at build/runtime.

## Redis Decision

Redis is already part of ZeaPlay architecture:

- cache client
- queue client
- realtime fanout client
- rate-limit client
- BullMQ queues
- Socket.IO Redis adapter support

This compose file does not add a new Redis service because the current production worker remains PM2-managed. A separate container-only Redis for the API would isolate jobs from the existing worker and create operational drift. During this parallel migration phase, Docker API should connect to the same intended Redis endpoints as the current production API/worker.

If a future full container cutover includes API, worker, web, and Redis together, Redis should be added as internal-only services with no public host ports, authentication where required, memory limits, and persistence only for queue/durable use cases.

## PostgreSQL And PgBouncer Decision

The existing development compose already includes PgBouncer. The application uses a single Nest `PrismaService` per API process and no repeated PrismaClient construction in normal runtime modules.

Do not introduce another PgBouncer layer in this app-compose phase. Revisit PgBouncer when scaling multiple API/worker replicas against production PostgreSQL connection limits.

## Performance Findings

Critical:

- Container API must not use `localhost` database/Redis URLs unless those services run in the same container. Use Docker service names or `host.docker.internal` overrides.
- Do not split BullMQ producers and workers across different Redis queue backends.

Recommended:

- Keep Redis as existing shared infrastructure for cache, queue, realtime, and rate-limit paths.
- Keep Docker logs rotated with `json-file` limits.
- Use Next standalone output for smaller web runtime images.
- Keep API health checks on `/api/v1/health`; use readiness `/api/v1/health/ready` for dependency diagnostics after basic startup is confirmed.
- Review slow production queries before adding schema indexes. Candidate areas are reports, analytics, dashboards, search, ticket filters, and gamification summaries.

Optional:

- Add PgBouncer or tune Prisma connection URLs when API/worker replicas increase.
- Add resource limits after observing `docker stats` under normal traffic.
- Add a containerized worker service in a later full Docker cutover.

Not needed now:

- New Redis service for app-only parallel testing.
- Public database or Redis ports.
- Nginx Proxy Manager replacement.
- Host Certbot.
- Production traffic switch.

## Validation Commands

Build:

```bash
docker compose -f docker-compose.prod.yml build
```

Start temporary app containers:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Check:

```bash
docker compose -f docker-compose.prod.yml ps
curl -I http://127.0.0.1:7200
curl -i http://127.0.0.1:7211/api/v1/health
docker stats --no-stream zeaplay-prod-app-zeaplay-web-1 zeaplay-prod-app-zeaplay-api-1
```

Stop only the Docker validation stack:

```bash
docker compose -f docker-compose.prod.yml down
```

Do not stop or restart PM2 as part of this validation.
