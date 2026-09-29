# Local Development

1. Copy `.env.example` to `.env` and replace placeholder secrets.
2. Start dependencies with `docker compose up -d`.
3. Install packages with `pnpm install`.
4. Run all apps with `pnpm dev`.

Useful endpoints:

- Web: `http://localhost:7100`
- API health: `http://localhost:7111/api/v1/health`
- API docs: `http://localhost:7111/api/v1/docs`
- MinIO console: `http://localhost:7901`
- Mailpit: `http://localhost:7825`
- Prometheus: `http://localhost:7390`
- Grafana: `http://localhost:7301`

All Compose ports bind to `127.0.0.1` for local development. Do not expose these dependency ports
directly in production.

The `minio-init` one-shot service creates the local `zea-play-dev` bucket after MinIO is healthy.

## Phase 2 Seed Data

After migrations are applied, seed deterministic development data:

```bash
pnpm --filter @zea-play/api prisma:seed
```

Development users use the password `DevelopmentPassword123!`:

- `owner@zeaplay.test`
- `admin@zeaplay.test`
- `member@zeaplay.test`
- `other-owner@zeaplay.test`

Use `/login` in the web app, then `/dashboard` to validate session handling,
organization selection, and logout.

Use `/dashboard/projects` to open the Phase 3 project workspace. Asset uploads
use API-issued presigned MinIO URLs, then call upload completion so the worker
can move assets to `READY`. Refresh tokens are stored in HttpOnly API cookies,
not browser localStorage.
