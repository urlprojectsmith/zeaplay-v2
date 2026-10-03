# Phase 18 Integration Matrix

Status: Phase 18.4 main certification evidence. Core functional integrations are PASS. Live custom-domain infrastructure remains DEFERRED UNTIL AFTER PHASE 22.

| Integration                            | Status   | Evidence                                                                                                                                                     |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branding -> Auth                       | PASS     | Auth pages call `getPublicBrandingForRequest`, render `PublicBrandShell`, and use metadata generated from public branding.                                   |
| Branding -> Docs                       | PASS     | Public Docs include branding only after existing share token/password authorization succeeds.                                                                |
| Branding -> Forms                      | PASS     | Public Forms include branding after public lookup and keep submission, upload, validation, idempotency, and rate-limit behavior unchanged.                   |
| Branding -> Email                      | PASS     | Security OTP and notification templates accept normalized public brand input while preserving trusted sender configuration.                                  |
| Branding -> Assets                     | PASS     | Branding asset references reuse Asset/MinIO ownership, lifecycle, MIME, dimensions, and signed URL generation.                                               |
| Branding -> Themes                     | PASS     | Public branding maps to existing BrandProvider tokens and approved CSS variables.                                                                            |
| Branding -> i18n                       | PASS     | Phase 18 public/auth strings are present in EN and TA; tenant brand strings are safety-normalized, not translated.                                           |
| Branding -> Cache                      | PASS     | Branding effective responses use bounded cache/fingerprints and scoped frontend query keys.                                                                  |
| Custom Domains -> Resolver             | PASS     | Host resolution uses normalized ACTIVE custom domains with status-chain checks and canonical-host fallback.                                                  |
| Custom Domains -> CORS                 | PASS     | CORS allows configured canonical origins and active HTTPS custom origins only, rejecting unknown, inactive, HTTP, and explicit-port custom origins.          |
| Custom Domains -> Worker               | PASS     | Worker jobs use domain id/revision/action payloads, advisory locks, stale-job skips, and idempotent dry-run transitions.                                     |
| Custom Domains -> Audit                | PASS     | Domain create, verify, token regenerate, remove, and state changes are audited without plaintext verification tokens.                                        |
| Custom Domains -> NPM adapter          | PASS     | Adapter is dry-run by default; live mode requires validated environment credentials and validated upstream mapping.                                          |
| Status chain -> Public pages           | PASS     | Public host branding falls back when domain owner chain is inactive; public Docs/Forms resource authorization remains source of truth.                       |
| RBAC -> Branding                       | PASS     | Branding mutations require tenant guards and `branding.manage`; platform defaults require platform-only permission.                                          |
| RBAC -> Domains                        | PASS     | Domain management requires tenant guards and `custom_domains.manage`; Platform has no tenant custom-domain route.                                            |
| Database migrations -> Phase 18        | PASS     | `0089` and `0090` remain additive and latest; 0090 permission seeding matches the existing `permissions` schema after pre-persistent-application correction. |
| Build order -> Workspace packages      | PASS     | Turbo `build` depends on `^build`; API/worker depend on `@zea-play/config`, so clean root builds rebuild config before consumers.                            |
| Live DNS/NPM/TLS -> Production routing | DEFERRED | Deferred until after Phase 22; no live provider or VPS state was changed.                                                                                    |

Matrix count: 18 PASS / 1 DEFERRED / 0 FAIL.
