# ZeaPlay Run And Update Commands

This project currently uses Docker Compose for backing services and PM2 for the API/web production processes.

Do not use default public service ports on the VPS. The current safe local-only ports are:

- Web app: `7100`
- API: `7111`
- PostgreSQL direct: `7543`
- PgBouncer: `7432`
- Redis cache/queue/realtime/rate-limit: `7379`, `7380`, `7381`, `7382`
- MinIO API/console: `7900`, `7901`
- Mailpit SMTP/UI: `7125`, `7825`
- Prometheus/Grafana: `7390`, `7301`

Production domains:

- Frontend: `https://play.zeacrm.com`
- Backend: `https://api.play.zeacrm.com`
- API base URL: `https://api.play.zeacrm.com/api/v1`

## 1. Local Update, Test, Commit, Push

Run these on your local Windows machine.

```powershell
# Go to the project
cd F:\Projects\Zeaplay-V2

# Check current branch and changed files
git branch --show-current
git status

# Install exact dependencies from lockfile
pnpm install --frozen-lockfile

# Start Docker backing services locally if needed
docker compose up -d

# Check Docker services
docker compose ps

# Generate Prisma client
pnpm prisma:generate

# Run quality checks before pushing
pnpm format
pnpm lint
pnpm typecheck
pnpm test

# Build API and web locally
pnpm --filter @zea-play/api build
pnpm --filter @zea-play/web build

# Review final changed files
git status
git diff --stat

# Add the files you changed
# Replace the paths below with the real files you changed
git add .

# Commit your update
git commit -m "Your update message"

# Push to the developed branch used by the VPS
git push origin developed
```

If there is nothing to commit, Git will show `nothing to commit, working tree clean`. That means the server can only pull changes that are already pushed.

## 2. VPS Environment Check

Run these on the VPS.

```bash
# Go to the deployed project
cd /opt/zeaplay

# Check current branch and local changes
git branch --show-current
git status

# Backup .env before editing
cp .env .env.backup.$(date +%Y%m%d-%H%M%S)
chmod 600 .env

# Edit production env
nano .env
```

Important `.env` values for production:

```env
APP_ENV=production

WEB_PORT=7100
API_PORT=7111
WORKER_PORT=7112

WEB_APP_URL=https://play.zeacrm.com
API_PUBLIC_URL=https://api.play.zeacrm.com/api/v1
NEXT_PUBLIC_API_URL=https://api.play.zeacrm.com/api/v1
CORS_ORIGINS=https://play.zeacrm.com

DATABASE_URL=postgresql://zea:<POSTGRES_PASSWORD>@localhost:7432/zea_play?schema=public
DIRECT_DATABASE_URL=postgresql://zea:<POSTGRES_PASSWORD>@localhost:7543/zea_play?schema=public

REDIS_CACHE_URL=redis://localhost:7379
REDIS_QUEUE_URL=redis://localhost:7380
REDIS_REALTIME_URL=redis://localhost:7381
REDIS_RATE_LIMIT_URL=redis://localhost:7382
```

Do not paste markdown links into `.env`. Use plain URLs only, without `[ ]` or `( )`.

## 3. First-Time VPS Docker Start

Use this section for a fresh server or when Docker services are stopped.

```bash
cd /opt/zeaplay

# Pull images and start backing services
docker compose pull
docker compose up -d

# Check containers
docker compose ps

# Check Postgres from host
pnpm exec dotenv -e .env -- bash -lc 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 7543 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1;"'

# Check Redis ports
redis-cli -p 7379 ping
redis-cli -p 7380 ping
redis-cli -p 7381 ping
redis-cli -p 7382 ping
```

## 4. VPS Future Update Pull And Deploy

Run this every time you push new code from local.

```bash
cd /opt/zeaplay

# Pull latest code from the deployed branch
git fetch origin
git checkout developed
git pull origin developed

# Install exact dependencies from lockfile
pnpm install --frozen-lockfile

# Ensure Docker backing services are running
docker compose up -d
docker compose ps

# Generate Prisma client for production env
pnpm prisma:generate:prod

# Check migration status
pnpm prisma:migrate:status:prod

# Apply pending migrations
pnpm prisma:migrate:deploy:prod

# Build API and web
pnpm --filter @zea-play/api build
pnpm exec dotenv -e .env -- pnpm --filter @zea-play/web build

# Restart PM2 apps with updated env
pm2 restart zeaplay-api --update-env
pm2 restart zeaplay-web --update-env

# If PM2 says the process is broken or already exists, recreate it
pm2 delete zeaplay-api || true
pm2 delete zeaplay-web || true
pm2 start ecosystem.config.cjs --only zeaplay-api
pm2 start ecosystem.config.cjs --only zeaplay-web

# Save PM2 process list for reboot
pm2 save
```

## 5. Seed Database

Use seed only for a fresh/demo database or when you intentionally want demo data.

```bash
cd /opt/zeaplay

# Run production seed
pnpm prisma:seed:prod

# Restart API after seed
pm2 restart zeaplay-api --update-env
```

Seeded development login:

```text
Email: owner@zeaplay.test
Password: DevelopmentPassword123!
```

Other seeded users with the same password:

```text
admin@zeaplay.test
member@zeaplay.test
other-owner@zeaplay.test
```

## 6. Nginx Proxy Manager Setup

Create two Proxy Hosts in Nginx Proxy Manager.

Frontend:

```text
Domain Names: play.zeacrm.com
Scheme: http
Forward Hostname / IP: 127.0.0.1
Forward Port: 7100
Websockets Support: enabled
SSL: request new certificate
Force SSL: enabled
HTTP/2 Support: enabled
```

Backend:

```text
Domain Names: api.play.zeacrm.com
Scheme: http
Forward Hostname / IP: 127.0.0.1
Forward Port: 7111
Websockets Support: enabled
SSL: request new certificate
Force SSL: enabled
HTTP/2 Support: enabled
```

## 7. Final Health Tests

Run these on the VPS after every deploy.

```bash
cd /opt/zeaplay

# PM2 status
pm2 status

# API logs
pm2 logs zeaplay-api --lines 80 --nostream

# Web logs
pm2 logs zeaplay-web --lines 80 --nostream

# Local API health
curl http://127.0.0.1:7111/api/v1/health

# Public API health
curl https://api.play.zeacrm.com/api/v1/health

# Frontend headers
curl -I https://play.zeacrm.com

# Backend headers
curl -I https://api.play.zeacrm.com/api/v1/health
```

Browser test:

```text
Open: https://play.zeacrm.com/login
Login: owner@zeaplay.test
Password: DevelopmentPassword123!
```

If login tries `localhost:4000`, rebuild the web app with `.env` loaded:

```bash
cd /opt/zeaplay

grep -R "localhost:4000" apps/web/.next | head
pnpm exec dotenv -e .env -- pnpm --filter @zea-play/web build
pm2 restart zeaplay-web --update-env
```

## 8. Useful Troubleshooting

```bash
cd /opt/zeaplay

# Check listeners
ss -ltnp | grep -E '7100|7111|7432|7543|7379|7380|7381|7382|7900|7901' || true

# Restart Docker backing services
docker compose restart

# Restart app processes
pm2 restart zeaplay-api --update-env
pm2 restart zeaplay-web --update-env

# Show recent app logs
pm2 logs zeaplay-api --lines 120 --nostream
pm2 logs zeaplay-web --lines 120 --nostream

# Check migration status
pnpm prisma:migrate:status:prod

# Apply migrations
pnpm prisma:migrate:deploy:prod
```

Do not commit `.env`. Keep real passwords, JWT secrets, OTP pepper, MinIO keys, SMTP keys, Resend keys, and Stripe keys only on the VPS.
