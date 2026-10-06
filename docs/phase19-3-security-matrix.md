# Phase 19.3 Security Matrix

Status: MAIN IMPLEMENTATION COMPLETE / LOCAL WINDOWS VERIFICATION PASS EXCEPT ENVIRONMENT-LIMITED NEXT STANDALONE SYMLINK COPY.

| Control                       | Status | Evidence                                                                                                                        |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| User cache isolation          | PASS   | Cache key includes userId; focused test verifies User B cannot read User A cache.                                               |
| Tenant cache isolation        | PASS   | Cache key includes scopeType and scopeId; focused test verifies Workspace B cannot read Workspace A cache.                      |
| Logout purge                  | PASS   | Session logout calls `deleteOfflineUser`; focused test verifies purged user data is unavailable offline.                        |
| 401 behavior                  | PASS   | ApiClientError 401 path blocks fallback and clears affected scope.                                                              |
| 403 behavior                  | PASS   | Focused test verifies 403 does not fall back to previously cached project data.                                                 |
| 404 invalidation              | PASS   | Cache repository deletes matching detail record on 404.                                                                         |
| TTL                           | PASS   | Policy registry defines bounded TTLs per resource.                                                                              |
| Maximum stale age             | PASS   | Focused test verifies stale ticket cache beyond maximum stale age is rejected.                                                  |
| Field allowlists              | PASS   | Central sanitizer handles task, project, ticket, calendar, and queue-summary projections.                                       |
| Sensitive field exclusion     | PASS   | Focused test verifies ticket requester email/phone and private description are excluded.                                        |
| API CacheStorage exclusion    | PASS   | Service worker remains static-shell only; API JSON uses app-layer IndexedDB, not CacheStorage.                                  |
| Token exclusion               | PASS   | Cache metadata and sanitizers do not persist JWT, CSRF, refresh token, password, OTP, API key, OAuth token, or webhook secrets. |
| Session safety                | PASS   | Cache reads require active userId, accessToken presence, matching scope, and tenant status.                                     |
| Session expiry                | PASS   | No offline auth extension is implemented; absent/expired active token context disables private cached reads.                    |
| Tenant status chain           | PASS   | Known suspended/inactive tenant status blocks private offline cache use; focused test covers suspended workspace behavior.      |
| Read-only offline             | PASS   | ApiClient blocks non-GET browser requests while offline; no mutation queue exists.                                              |
| Offline mutation queue        | PASS   | Not implemented; Phase 19.4 boundary preserved.                                                                                 |
| Reconnect refresh             | PASS   | Existing PWA provider announces back-online and React Query remains authoritative on refetch. No mutation replay is added.      |
| Quota behavior                | PASS   | Cache write failures are caught and skipped without crashing online reads.                                                      |
| Pruning                       | PASS   | Repository prunes expired, incompatible schema, and per-policy excess records.                                                  |
| Multi-tab behavior            | PASS   | BroadcastChannel notifies tabs after offline user purge; tabs clear active query state where supported.                         |
| Gamification side effect      | PASS   | Offline cache read paths do not call gamification mutation or award APIs.                                                       |
| Docs body policy              | PASS   | Docs body content is not cached.                                                                                                |
| Forms policy                  | PASS   | Form responses/submissions are not cached.                                                                                      |
| Files policy                  | PASS   | File binaries, signed URLs, and MinIO objects are not cached.                                                                   |
| Developer/platform admin data | PASS   | No platform-global private cache policy is registered.                                                                          |
| XSS storage model             | PASS   | Docs state browser storage is not a secrets vault; tokens/secrets are excluded.                                                 |
| I18N                          | PASS   | EN and TA strings added for offline/cached/read-only/last-updated states.                                                       |
| Accessibility                 | PASS   | Offline cached indicator uses status semantics; PWA online/offline announcements remain aria-live.                              |
| Mobile/theme readability      | PASS   | Indicator uses existing Badge/text-muted tokens and responsive wrapping.                                                        |
| Service worker regression     | PASS   | No authenticated API CacheStorage caching was added.                                                                            |

Summary: 32 PASS / 0 FAIL / 0 DEFERRED.
