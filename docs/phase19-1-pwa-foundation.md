# Phase 19.1 PWA Foundation

Status: MAIN IMPLEMENTATION COMPLETE / LOCAL WINDOWS VERIFICATION PASS EXCEPT ENVIRONMENT-LIMITED NEXT STANDALONE SYMLINK COPY / LINUX EXACT-SOURCE VERIFICATION REQUIRED.

## Implemented

- Dynamic Web App Manifest at `/site.webmanifest`.
- Manifest response uses private no-store revalidation and `Vary: Host` for host-safe white-label metadata.
- Canonical app metadata and mobile install metadata in the App Router root layout.
- Production-only service worker registration at `/sw.js`.
- Deterministic cache versioning and ZeaPlay-only stale cache cleanup.
- Static asset allowlist and API/auth cache exclusion.
- Lightweight `/offline` fallback shell.
- Shared PWA provider and hook for installability, installed mode, update availability, connectivity state, iOS guidance, and push capability detection.
- Existing profile menu install/update affordance.
- Online/offline status announcement and subtle offline banner.
- Logout and tenant-switch service worker cache-clear events.
- Placeholder `push` and safe `notificationclick` architecture.
- Platform fallback PNG icons for 192x192, 512x512, and maskable 512x512.
- EN/TA strings for install, iOS instructions, update, refresh, offline, and back-online state.

## Not Implemented In Phase 19.1

- Full Web Push delivery, VAPID keys, push subscription storage, or notification permission prompts.
- Offline private data storage or background sync.
- Aggressive bundle precaching.
- Live custom-domain DNS/NPM/TLS changes.
- Database migration.

## Tenant Safety

Manifest identity is resolved from trusted host context through the existing public branding resolver. It does not accept tenant IDs from query strings, localStorage, arbitrary headers, or membership fallback.

The service worker does not cache authenticated API responses, auth routes, authorization headers, or tenant business data. Tenant cache namespaces are prepared for later phases but unused for private data in Phase 19.1.

## Validation Targets

- `apps/web/app/phase19-1-pwa.test.tsx` covers manifest fields, host-safe manifest architecture, service worker registration path, static cache allowlist, API/auth exclusion, cache versioning, tenant namespace preparation, notification click safety, source guards, and EN/TA strings.
- Focused PWA test: PASS, 1 file / 8 tests.
- Icon validation: PASS. `zeaplay-icon-192.png` is PNG 192x192; `zeaplay-icon-512.png` is PNG 512x512; `zeaplay-maskable-512.png` is PNG 512x512.
- `pnpm format`: PASS.
- `pnpm lint`: PASS, 17 tasks.
- `pnpm typecheck`: PASS, 17 tasks.
- `pnpm test`: PASS, 17 tasks; API 75 suites / 678 tests; worker 12 suites / 37 tests; web 34 files / 251 tests.
- `pnpm audit --prod --audit-level high`: PASS; 7 moderate production advisories remain below the high gate.
- `pnpm build`: PARTIAL on Windows. API and worker build tasks passed; Next.js web compiled, typechecked, generated 74/74 static pages, then failed during standalone traced-file copy because Windows denied symlink creation (`EPERM`).
- Linux exact-source `pnpm build`, `pnpm typecheck`, `pnpm test`, runtime manifest/SW/offline checks, and final certification remain REQUIRED.

## Future Phase Notes

- Phase 19.2: mobile UX refinements and app-shell ergonomics.
- Phase 19.3: carefully scoped offline data and sync strategy.
- Phase 19.4: full Web Push subscription, delivery, permissions, and notification workflows.
