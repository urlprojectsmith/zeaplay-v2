# Phase 19.1 Security Matrix

| Area                             | Status   | Evidence                                                                                                  |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Manifest required fields         | PASS     | `/site.webmanifest` includes name, short name, description, start URL, scope, display, colors, and icons. |
| Tenant manifest source           | PASS     | Manifest uses trusted host/public branding resolver only.                                                 |
| Manifest cache safety            | PASS     | Manifest response uses private no-store revalidation and `Vary: Host`.                                    |
| Query-string tenant IDs          | PASS     | No manifest tenant selection from search params.                                                          |
| Local storage tenant IDs         | PASS     | Manifest route is server-side and does not read localStorage.                                             |
| Unknown host fallback            | PASS     | Existing public branding resolver falls back to Platform branding.                                        |
| Platform icon fallback           | PASS     | Manifest icons use stable same-origin PNG assets.                                                         |
| Signed URL icon leakage          | PASS     | Runtime tenant asset URLs are not used for install icons in Phase 19.1.                                   |
| Service worker scope             | PASS     | Registered at `/sw.js` with frontend-origin `/` scope only.                                               |
| Development stale cache risk     | PASS     | Service worker registration is production-only.                                                           |
| Cache versioning                 | PASS     | `zeaplay-static-v19-1` and `zeaplay-shell-v19-1`.                                                         |
| Stale cache cleanup              | PASS     | Activation deletes stale ZeaPlay caches only.                                                             |
| Static asset caching             | PASS     | Same-origin static/icon/manifest assets only.                                                             |
| API response caching             | PASS     | API paths and cross-origin API traffic are excluded.                                                      |
| Auth route caching               | PASS     | Login, logout, refresh, OTP, and reset routes are excluded.                                               |
| HTTP method safety               | PASS     | Service worker cache/fetch logic operates only on GET requests and has no mutation replay.                |
| Cache poisoning safety           | PASS     | Cache writes require same-origin successful basic responses and reject redirected responses.              |
| Authorization header caching     | PASS     | Requests with Authorization are not cached.                                                               |
| JWT/session storage in SW        | PASS     | Service worker does not store tokens.                                                                     |
| Private Docs/Forms/Files caching | PASS     | No private application data cache is implemented.                                                         |
| Tenant cache collision           | PASS     | Future tenant namespace helper includes scope type and scope ID.                                          |
| Logout cleanup hook              | PASS     | Session logout posts `CLEAR_TENANT_CACHES`.                                                               |
| Tenant switch cleanup hook       | PASS     | Account-context switching posts `CLEAR_TENANT_CACHES`.                                                    |
| Update flow                      | PASS     | Waiting service worker refresh is user-triggered.                                                         |
| Skip waiting safety              | PASS     | `SKIP_WAITING` is sent only through explicit refresh logic.                                               |
| Offline fallback data            | PASS     | `/offline` contains no tenant/business data.                                                              |
| Notification permission          | PASS     | `Notification.requestPermission()` is not called in Phase 19.1.                                           |
| Push delivery                    | DEFERRED | Phase 19.4. Placeholder event only.                                                                       |
| Notification click open redirect | PASS     | Service worker opens same-origin, non-API, non-auth URLs only.                                            |
| CSP weakening                    | PASS     | No unsafe inline script was added for PWA.                                                                |
| HSTS/frame/referrer weakening    | PASS     | No security header relaxation introduced.                                                                 |
| iOS install guidance             | PASS     | iOS guidance is manual and scoped to iOS Safari conditions.                                               |
| Icon validation                  | PASS     | 192x192, 512x512, and maskable 512x512 files are valid PNGs with expected dimensions.                     |
| EN/TA localization               | PASS     | PWA strings exist in existing i18n registry.                                                              |
| Accessibility                    | PASS     | Offline banner uses status/live regions; controls are keyboard buttons/menu items.                        |
| Full Web Push                    | DEFERRED | Phase 19.4.                                                                                               |
