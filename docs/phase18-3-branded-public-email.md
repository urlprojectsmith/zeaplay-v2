# Phase 18.3 Branded Public And Email Architecture

Status: Phase 18.3 certified by Phase 18.4 core functional verification. Phase 18.2 live DNS/NPM/TLS verification remains DEFERRED UNTIL AFTER PHASE 22.

## Scope

Phase 18.3 extends the certified Phase 18.1 white-label branding resolver to:

- public auth/login surfaces
- public Doc share pages
- public Forms
- security OTP email
- notification email templates

No new branding table, asset store, custom CSS system, custom sender-domain system, Nginx Proxy Manager integration, DNS automation, or TLS provisioning was added.

## Resolution Model

Auth pages resolve branding server-side through `GET /branding/public`. The API uses the incoming `Host` only with the Phase 18.2 `CustomDomainResolverService`. Canonical ZeaPlay hosts, unknown hosts, inactive domains, and unavailable owner chains return Platform defaults.

Public Docs and Forms do not trust host, query tenant IDs, local storage, or client headers for branding. Their API responses attach public-safe branding only after the existing public share/form lookup succeeds, using the Workspace that already owns the authorized public resource.

## Public Branding DTO

The public DTO contains only:

- `appName`
- `companyName`
- `logo`
- `darkLogo`
- `favicon`
- `loginBackground`
- `primaryColor`
- `primaryForeground`
- `accentColor`
- `accentForeground`
- `supportEmail`
- `supportUrl`
- `footerText`
- `metaDescription`
- `fingerprint`

It excludes policy internals, inheritance provenance, raw asset IDs, Workspace IDs, object keys, credentials, storage paths, signed upload data, and custom-domain state.

## Web Surfaces

`PublicBrandShell` wraps auth, public Docs, and public Forms. It maps the public DTO into the existing `BrandProvider`, applies safe CSS variables through the existing brand token sanitizer, uses bounded logo/background rendering, and preserves the existing public resource behavior.

Auth pages use server-side metadata generation for title, description, favicon, and basic Open Graph branding where available.

Public/auth UI strings added by Phase 18.3 use the existing English/Tamil i18n system. Logo images expose brand-aware alt text, password-gated public Docs use a visible password label, public form errors use alert semantics, and upload/signature status messages use polite live regions.

## Email Branding

Email branding extends the existing mail infrastructure. `MailService.sendSecurityOtp` and notification email templates accept a public-safe brand input and escape all brand-controlled text before HTML output.

Tenant branding may affect email body, subject prefix, logo, colors, footer, support email, and support URL. It does not automatically change the trusted provider-owned `From` address or domain.

## Deferred Boundaries

Phase 18.2 remains deferred for live DNS, NPM, TLS, and production custom-domain verification.

Phase 18.3 does not implement custom sender domains, dynamic OAuth callback registration, live custom-domain certification, custom CSS, custom HTML, or custom JavaScript.

## Local Verification

- API typecheck: PASS.
- Web typecheck: PASS.
- Root typecheck: PASS, 17 tasks.
- API build: PASS.
- Web lint: PASS.
- Focused API branding/email/docs/forms/auth tests: PASS, 6 suites / 40 tests.
- Focused web public branding/login tests: PASS, 2 files / 7 tests.
- Full web app tests: PASS, 33 files / 243 tests.
- Root `pnpm test`: PASS, 17 tasks. API PASS, 75 suites / 678 tests. Worker PASS, 12 suites / 37 tests. Web PASS, 33 files / 243 tests.
- `pnpm format`: PASS.
- `git diff --check`: PASS.
- Phase 18.4 records the Phase 18.3 Linux baseline as Web Linux build PASS, API Linux build PASS, and API Linux typecheck PASS.
- The stale `@zea-play/config` dist declaration issue was resolved by rebuilding `pnpm --filter @zea-play/config build`; root build ordering is verified in Phase 18.4.
