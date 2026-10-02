# Phase 18.1 White-Label Branding Security Matrix

Status: Phase 18.1 final certification PASS. All rows have source, focused unit, real PostgreSQL integration, migration compatibility, web, E2E, build, or security-search evidence.

| Area                 | Status | Evidence                                                                                                                |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Scope ownership      | PASS   | Branding rows use explicit `scopeType + scopeId`; Platform uses the zero UUID and tenant scopes use real hierarchy IDs. |
| Inheritance          | PASS   | Real PostgreSQL integration covers Platform -> Super Agency -> Agency -> Workspace resolution.                          |
| Null semantics       | PASS   | `NULL` remains inherit; reset behavior clears overrides instead of persisting empty text.                               |
| Policy               | PASS   | Server-side allowlists control Agency and Workspace override eligibility.                                               |
| Ancestor restriction | PASS   | Agency Workspace policy cannot grant fields prohibited by Super Agency policy.                                          |
| Platform permission  | PASS   | `branding.platform.manage` is platform-only and excluded from tenant custom roles.                                      |
| Custom roles         | PASS   | `branding.manage` follows existing tenant custom-role permission plumbing.                                              |
| Cross-tenant access  | PASS   | Tenant guards and integration tests reject foreign branding/assets.                                                     |
| Asset IDOR           | PASS   | Asset validation checks asset ownership and descendant Workspace eligibility before persistence.                        |
| Asset MIME           | PASS   | Field-specific MIME allowlists accept only approved raster/ICO image types.                                             |
| Asset size           | PASS   | Field-specific size caps are enforced for logo, dark logo, favicon, and login background.                               |
| Asset dimensions     | PASS   | Metadata dimensions are validated and oversized or invalid images are rejected.                                         |
| SVG                  | PASS   | SVG is explicitly rejected because no certified SVG sanitizer exists in this codebase.                                  |
| Colors               | PASS   | Colors normalize to `#RRGGBB` only; CSS functions, variables, URLs, and arbitrary style strings are rejected.           |
| Contrast             | PASS   | Server derives safe black/white foreground values for primary and accent colors.                                        |
| Text XSS             | PASS   | Text fields are bounded plain text and reject markup-like characters and `javascript:` patterns.                        |
| URL security         | PASS   | Support URLs must be HTTPS and must not contain embedded credentials.                                                   |
| Revision             | PASS   | Optimistic `revision` is enforced and stale updates are rejected.                                                       |
| Cache invalidation   | PASS   | Branding mutations clear effective-brand cache and frontend query keys include scope.                                   |
| Policy invalidation  | PASS   | Policy changes invalidate effective resolution and dormant overrides become effective only when allowed.                |
| Tenant switching     | PASS   | Existing session/query clearing plus scoped keys prevent branding reuse across tenant switches and logout.              |
| SSR/hydration        | PASS   | Branding provider falls back to ZeaPlay defaults during loading/logout without localStorage authority.                  |
| Restricted mode      | PASS   | Existing restricted-mode write blocking remains the commercial control; no new entitlement key was added.               |
| AuditLog             | PASS   | Branding mutations write bounded `branding.updated` audit metadata.                                                     |
| Logging              | PASS   | Audit/log metadata excludes signed URLs, storage keys, credentials, and payload data.                                   |
| V1 regression        | PASS   | Full unit, integration, E2E, build, and migration compatibility gates passed after Phase 18.1 changes.                  |
| Phase 18.2 boundary  | PASS   | Custom domains, DNS, SSL, and Nginx work remain deferred and unimplemented.                                             |
| Phase 18.3 boundary  | PASS   | Branded login, public Forms/Docs branding, email branding, and custom sender domains remain deferred and unimplemented. |

Row count: 28.

Unknown rows: 0.

Partial rows: 0.

Unreviewed rows: 0.

Fail rows: 0.
