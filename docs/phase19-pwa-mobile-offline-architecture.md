# Phase 19 PWA, Mobile, Offline, and Push Architecture

Status: Phase 19.1 foundation implemented and locally verified on Windows, with Linux exact-source build/runtime verification still required because the local Windows Next standalone traced-file copy fails on symlink creation after successful compile, typecheck, and page generation. Phase 19.2 mobile UX main implementation is complete locally. Phase 19.3 offline read cache main implementation is complete locally with the same Windows standalone symlink build limitation. Phase 19.4 full Web Push remains future work.

## Scope Boundaries

- Phase 19.1 makes the existing Next.js App Router application installable as one responsive PWA.
- Phase 19.2 keeps the same application responsive across phone, tablet, desktop, and standalone PWA contexts.
- Phase 19.3 adds app-layer, read-only IndexedDB offline snapshots for selected safe workspace read models.
- No second frontend, native mobile app, database migration, or backend subscription flow is introduced.
- Service worker caching is limited to safe static assets, platform icons, the manifest, and the offline fallback shell.
- Authenticated API JSON is still not cached by the service worker. Phase 19.3 business-data snapshots use a separate app-layer IndexedDB repository with user/tenant namespaces, TTLs, field allowlists, stale indicators, and logout purge.

## Installability

- Manifest endpoint: `/site.webmanifest`.
- Service worker scope: `/`, on the frontend origin only.
- Offline fallback: `/offline`.
- Platform PNG icons are served from `/icons/*` for stable install metadata.
- Browser install prompt state is handled by the shared PWA provider and surfaced through the existing profile menu.

## White-Label Identity

The manifest route resolves public branding through the existing Phase 18 public branding path and trusted request host. It never uses query-string tenant IDs, localStorage, arbitrary headers, or first-membership fallback.

Browser manifest metadata is cached differently across Chrome, Edge, Safari, and Firefox. For this reason, Phase 19.1 varies only safe fields such as app name, description, and theme/background colors by trusted host. Icons remain platform fallback PNGs to avoid signed-URL expiry, cross-tenant leakage, and browser install-cache confusion. Custom host branding is architectural support, not a promise of instant per-tenant install metadata refresh.

Canonical host or unknown custom host resolves to Platform branding via the backend public branding resolver.

The manifest route sends `Cache-Control: private, no-store, max-age=0, must-revalidate` and `Vary: Host` so HTTP caches do not reuse one hostname's generated manifest for another hostname. Browser install metadata may still have user-agent-specific refresh behavior after installation, so the platform does not promise instant installed-name/icon refresh.

## Service Worker Strategy

- Registration is production-only to avoid local development stale-cache confusion.
- Cache names are deterministic: `zeaplay-static-v19-1` and `zeaplay-shell-v19-1`.
- Activation removes stale ZeaPlay caches only, leaving unrelated browser caches untouched.
- Navigation requests use network-first behavior and fall back to `/offline` only on network failure.
- Static assets use cache-first behavior only for same-origin safe paths.
- Static cache writes require successful same-origin basic responses and reject redirected responses.
- Cross-origin API traffic such as `https://api.play.zeacrm.com/api/v1` is not intercepted.

## Update Flow

The app detects a waiting service worker and shows a user-triggered refresh action. `skipWaiting` is sent only from the explicit refresh path, avoiding surprise reloads while a user is editing data.

## Logout And Tenant Switch Safety

The session store posts `CLEAR_TENANT_CACHES` to the service worker on logout and account-context changes. Phase 19.1 does not create tenant data caches, but the event architecture is ready for future tenant-scoped offline namespaces.

## Web Push Readiness

Phase 19.1 includes only capability detection and placeholder service worker event architecture for `push` and `notificationclick`.

Phase 19.1 does not generate VAPID keys, store subscriptions, send notifications, or call `Notification.requestPermission()` on page load. Permission prompts must remain user-triggered in Phase 19.4.

## Phase 19.2 Mobile UX

- The application shell uses one shared responsive DashboardShell.
- Mobile navigation uses the same filtered DashboardConfig as desktop, preserving RBAC and role-specific hierarchy.
- The mobile sidebar is a Radix Dialog drawer with explicit menu/close controls, route-close behavior, and account context switching.
- Shared controls, dialogs, dropdowns, selects, tabs, offline banners, and install dialogs are safe-area and touch-target aware.
- Search, notifications, profile/logout, PWA install/update, and tenant switching remain reachable from mobile.
- Full Web Push remains Phase 19.4 and offline business-data caching remains Phase 19.3.

## Phase 19.3 Offline Read Cache

- Offline private data uses `zea-play-offline` IndexedDB records, not service-worker CacheStorage.
- Cache keys include schema version, authenticated user, scope type, scope ID, resource type, resource ID, and normalized query hash.
- Initial cacheable workspace resources are task list/detail/calendar summary, project list/detail, ticket list/detail, and ticket queue summary.
- Sanitizers apply strict field allowlists and exclude comments, private notes, attachments, signed URLs, requester contact PII, secrets, credentials, Docs bodies, Form responses, file binaries, audit payloads, and automation payloads.
- Cached data is shown only while the same user/session context, same tenant scope, acceptable local tenant status, schema version, and maximum stale age are valid.
- 401 and 403 never fall back to cached private data. 404 invalidates matching detail cache.
- Offline mode is read-only. Browser non-GET API calls are blocked while offline and no mutation queue or replay exists.
- Logout purges offline private data for the authenticated user and BroadcastChannel clears active query state in other tabs where supported.
- Phase 19.4 remains responsible for mutation queues, conflict resolution, background replay, and full Web Push.
