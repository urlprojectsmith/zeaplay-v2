# Phase 18.1 White-Label Branding Architecture

Status: Phase 18.1 final certification COMPLETE / PASS. Phase 18.2 custom-domain main implementation is tracked separately in `docs/custom-domain-architecture-phase18.md`. Public/login/email branding and final Phase 18 certification remain deferred to later phases.

## Scope Ownership

White-label branding uses the certified hierarchy:

Platform -> Super Agency -> Agency -> Workspace.

`Organization` remains legacy compatibility metadata only and is not a branding parent, tenant authority, RBAC authority, or domain authority.

Super Agency is the primary tenant branding authority. Agency and Workspace scopes may override only fields permitted by ancestor policy. Platform owns safe ZeaPlay defaults and optional platform DB overrides.

## Field Registry

The server-owned registry lives in `apps/api/src/modules/branding/branding.registry.ts`. Clients cannot submit arbitrary branding keys.

Phase 18.1 fields:

- `APP_NAME`
- `COMPANY_NAME`
- `LOGO`
- `DARK_LOGO`
- `FAVICON`
- `LOGIN_BACKGROUND`
- `PRIMARY_COLOR`
- `ACCENT_COLOR`
- `SUPPORT_EMAIL`
- `SUPPORT_URL`
- `FOOTER_TEXT`
- `META_DESCRIPTION`

Explicitly unsupported in Phase 18.1:

- `CUSTOM_CSS`
- `CUSTOM_HTML`
- `CUSTOM_JS`
- `CUSTOM_SCRIPT`
- `CUSTOM_IFRAME`

## Persistence

Migration `0089_phase18_1_white_label_branding` creates `white_label_branding` with explicit `scope_type + scope_id` uniqueness, nullable override fields, asset ID plus asset Workspace ID pairs, field-level child override policy arrays, and optimistic `revision`.

The Platform scope uses the zero UUID `00000000-0000-0000-0000-000000000000`. All non-Platform scopes use their real Super Agency, Agency, or Workspace UUID. This avoids nullable uniqueness ambiguity.

`NULL` means inherit from parent. Explicit empty text is not persisted as an override; normalized empty input resets the field to `NULL`.

## Inheritance

Resolution order:

- Platform: Platform defaults plus optional Platform DB override.
- Super Agency: Platform -> Super Agency.
- Agency: Platform -> Super Agency -> Agency.
- Workspace: Platform -> Super Agency -> Agency -> Workspace.

The centralized resolver is `BrandingService`. Controllers and frontend code do not duplicate inheritance calculations.

The effective DTO returns resolved values, safe source metadata for configuration users, derived black/white foreground colors for primary/accent colors, and a deterministic fingerprint based on resolved values and revision chain.

## Override Policy

Super Agency stores:

- `agencyAllowedOverrides`
- `workspaceAllowedOverrides`

Agency may further restrict Workspace overrides with `workspaceAllowedOverrides`, but it cannot grant a field prohibited by Super Agency. Effective Workspace policy is intersection-safe.

Stored disabled child overrides are dormant, not deleted. If an ancestor re-enables the field later, the stored child override becomes effective again.

## Asset Architecture

Branding images reuse the canonical Phase 13 `Asset` plus MinIO storage architecture. No `BrandingFile`, `WhiteLabelBlob`, second bucket, or base64 storage was added.

Current Asset ownership remains Workspace-based. Branding records therefore store each asset ID with the asset's Workspace ID and the resolver validates:

- Workspace branding asset must belong to that Workspace.
- Agency branding asset must belong to a descendant Workspace of that Agency.
- Super Agency branding asset must belong to a descendant Workspace of that Super Agency.
- Platform branding may reference any valid Asset through platform authority.

This preserves canonical storage/quota/retention behavior and avoids faking parent ownership. Parent-level dedicated branding upload UX can be added later by extending the canonical Asset upload surface, not by adding a second storage system.

Allowed Phase 18.1 formats:

- Logo and dark logo: PNG, JPEG, WEBP, up to 2 MB.
- Favicon: PNG or ICO, up to 512 KB.
- Login background: PNG, JPEG, WEBP, up to 5 MB.

When canonical Asset metadata includes dimensions, branding validation rejects zero/negative dimensions and rejects images above the configured field limits: 4096x4096 for logo/dark logo, 1024x1024 for favicon, and 8192x8192 for login background.

SVG is rejected because no proven SVG sanitization architecture is certified in this codebase.

Branding effective responses use short-lived signed storage URLs and never expose raw MinIO bucket, object key, credentials, or storage paths.

## Color And Text Safety

Colors are normalized `#RRGGBB` only. CSS functions, `url(...)`, `var(...)`, expressions, alpha values, and arbitrary style strings are rejected.

The server derives accessible black/white foreground colors for branded button-style surfaces. Existing Light, Dark, and Colorful theme tokens remain authoritative; white-label colors layer on approved token surfaces instead of replacing the theme engine.

Text fields are trimmed, length-bounded, plain text only, and reject markup-like `<` or `>` plus `javascript:` patterns. Support URL must be HTTPS and must not contain username/password credentials. Support email is normalized and syntax-checked.

## Permissions

Tenant branding mutation requires `branding.manage` after the relevant tenant guard validates the scope:

- Super Agency: `SuperAgencyTenantGuard`
- Agency: `AgencyTenantGuard`
- Workspace: `WorkspaceTenantGuard`

Platform default branding requires `branding.platform.manage` through `BrandingPlatformGuard`. `branding.platform.manage` is listed in `PLATFORM_ONLY_PERMISSION_KEYS` so tenant custom roles cannot acquire platform branding authority.

Effective branding reads are authenticated and scope-guarded for tenant scopes.

## Audit And Logging

Branding mutations write `AuditLog` action `branding.updated` with scope, changed field names, and revision only. Signed URLs, raw asset storage keys, credentials, and file payload data are not written to AuditLog metadata.

## Cache Strategy

`BrandingService` uses a short 30-second in-process effective-brand cache and clears it on mutation. The frontend uses TanStack Query keys scoped by `scopeType + scopeId`. Existing tenant-switch cache clearing resets branding queries, preventing a previous tenant's logo or colors from being reused after a switch or logout.

## Frontend Integration

The existing `BrandProvider` and `BrandLogo` are reused. No second theme engine was introduced.

Authenticated shell branding fetches one effective-brand request for the selected Super Agency, Agency, or Workspace scope. While loading or after logout it falls back to ZeaPlay defaults.

Brand colors set approved CSS variables only:

- `--primary`
- `--primary-foreground`
- `--accent`
- `--accent-foreground`

Existing Light, Dark, and Colorful modes remain active.

Settings surfaces exist for Platform, Super Agency, Agency, and Workspace branding. They expose current overrides, inherited source labels, reset behavior, policy controls where applicable, asset ID/workspace references, preview, and revision-safe save.

## Commercial Decision

No Phase 15 commercial entitlement key was added for white-label branding in Phase 18.1. Existing restricted-mode write blocking, permission guards, and billing authorities remain canonical.

## Deferred Boundaries

Phase 18.2 owns and now has a main implementation surface for:

- custom domains
- DNS TXT ownership verification
- SSL certificate orchestration through Nginx Proxy Manager
- Nginx Proxy Manager adapter integration
- hostname routing

Phase 18.3 owns:

- branded login by hostname
- public Forms branding
- public Docs branding
- email branding
- custom sender domains

Phase 18.2 does not change public Forms/Docs, branded login, email templates, custom sender domains, live server firewall rules, live NPM state, or host Certbot.

## Final Certification Evidence

Phase 18.1 final certification is recorded in `docs/phase18-1-certification.md`.

Phase 18.1 security matrix is recorded in `docs/phase18-1-branding-security-matrix.md` with 28 PASS rows, 0 unknown, 0 partial, 0 unreviewed, and 0 fail.
