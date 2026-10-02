# Phase 18.2 Custom Domain Architecture

Status: Phase 18.2 main implementation in progress. Live DNS, live Nginx Proxy Manager provisioning, live TLS issuance, end-to-end browser validation, clean/legacy migration certification, production deployment changes, and Phase 18 final certification remain deferred.

## Scope Ownership

Custom domains are owned by the same certified hierarchy as branding:

Platform -> Super Agency -> Agency -> Workspace.

`Organization` remains legacy compatibility metadata only. It is not a domain owner, hostname authority, routing authority, billing authority, RBAC authority, or hierarchy parent.

Supported custom-domain scopes are:

- `SUPER_AGENCY`
- `AGENCY`
- `WORKSPACE`

Platform uses canonical ZeaPlay domains and does not get a tenant custom-domain route. Only one non-removed custom domain may exist per scope, and a normalized hostname may belong to only one non-removed scope. Aliases and wildcards are intentionally unsupported.

## Persistence

Migration `0090_phase18_2_custom_domains` creates:

- `CustomDomainScopeType`
- `CustomDomainStatus`
- `custom_domains`
- `custom_domains_active_hostname_key`
- `custom_domains_active_scope_key`
- Permission `custom_domains.manage`

The table stores explicit `scope_type + scope_id`, lineage columns, normalized/display hostnames, status timestamps, hashed verification token, Nginx Proxy Manager identifiers, failure metadata, optimistic `revision`, and removal state.

The plaintext verification token is returned only at creation or rotation time. The database stores only a SHA-256 hash.

## Hostname Normalization

Custom-domain writes accept a hostname only. The API rejects:

- schemes, paths, fragments, query strings, credentials, and ports
- IPv4 and IPv6 literals
- `localhost`, single-label hosts, and internal suffixes such as `.local`, `.internal`, and `.invalid`
- metadata-service style hosts
- invalid labels or invalid public TLDs

Hostnames are IDNA-normalized with `domainToASCII`, stored lowercase as `normalized_hostname`, and returned as a Unicode display hostname where possible.

## DNS Ownership

Ownership is verified with TXT records only:

- Record name: `_zeaplay-verification.<hostname>`
- Record value: `zea-play-domain-verification=<token>`

The verifier reads DNS TXT records through Node DNS resolution. It does not fetch customer domains over HTTP and does not use customer-provided URLs as a verification callback.

Verification tokens expire based on `CUSTOM_DOMAIN_TOKEN_TTL_HOURS`. Rotation invalidates the previous token hash and returns the domain to `PENDING_VERIFICATION`.

## State Machine

Allowed lifecycle:

`PENDING_VERIFICATION -> DNS_VERIFIED -> ROUTING_PENDING -> SSL_PENDING -> ACTIVE`

Failure/removal paths:

- verification or provisioning may move to `FAILED`
- owner action may move to `REMOVING`
- worker removal completes as `REMOVED`
- suspension is explicit and does not imply deletion

Direct activation from `PENDING_VERIFICATION` is rejected. A previously active domain may be moved back to `PENDING_VERIFICATION` only when ownership must be re-proven through token rotation.

## Host Resolution

Runtime host resolution treats canonical ZeaPlay hosts as platform-owned and returns no custom-domain binding.

For custom hosts, the resolver:

- normalizes the incoming `Host`
- resolves only `ACTIVE` and non-removed `custom_domains`
- verifies the owner chain remains active
- caches positive and negative results for short TTLs
- invalidates cache on create, token rotation, verification, activation, removal, and worker reconciliation

Tenant guards also check active custom-domain bindings. A Workspace custom host can only be used with its exact Workspace context; an Agency custom host can only be used with its exact Agency context; a Super Agency custom host can only be used with its exact Super Agency context. Parent custom domains do not implicitly host descendants.

## CORS, Cookies, CSP, And Host Safety

CORS keeps canonical origins from `CORS_ORIGINS` and additionally allows active custom-domain origins only over HTTPS. Unknown hosts and inactive domains are not allowed as dynamic custom-domain origins.

Password reset, OAuth callback, and public callback URLs remain based on configured canonical application/API URLs, not arbitrary request `Host` headers.

The implementation does not add custom CSS, custom HTML, custom JavaScript, iframe injection, public Docs branding, public Forms branding, email branding, custom sender domains, wildcard routing, or alias routing.

## Nginx Proxy Manager Boundary

Nginx Proxy Manager is treated as an external TLS/proxy control plane:

- Docker image: `jc21/nginx-proxy-manager:latest`
- Public listener ports: `80` and `443`
- Admin UI/API port: `81`
- Host Certbot: not installed and not used
- TLS owner: Nginx Proxy Manager and its Let's Encrypt integration

The application only talks to NPM through `NpmDomainProvisioner`. It does not write host Nginx files, does not mount or access the Docker socket, does not shell out to Docker/Nginx/Certbot, and does not require host Certbot.

Provisioning defaults to:

`CUSTOM_DOMAIN_PROVISIONING_MODE=dry-run`

Live mode requires:

- `NPM_API_URL`
- `NPM_ADMIN_EMAIL`
- `NPM_ADMIN_PASSWORD`
- `NPM_LETS_ENCRYPT_EMAIL`
- `NPM_UPSTREAM_SCHEME`
- `NPM_UPSTREAM_HOST`
- `NPM_UPSTREAM_PORT`

The frontend and API upstream ports are configuration, not hard-coded infrastructure assumptions.

## Worker Provisioning

The worker owns the provisioning queue:

- Queue: `custom-domain-provisioning`
- Provision job: `custom-domain.provision`
- Reconcile job: `custom-domain.reconcile`

Worker jobs use a PostgreSQL advisory lock per domain and compare the expected `revision` before mutating state, so stale jobs cannot activate or remove a superseded domain. In dry-run mode, the worker records deterministic dry-run proxy/certificate identifiers without contacting NPM.

## DNS Routing Checks

Routing inspection checks:

- direct `A` or `AAAA` matches against `CUSTOM_DOMAIN_PUBLIC_IPS`
- `CNAME` matches against `CUSTOM_DOMAIN_APPROVED_CNAME_HOSTS`
- proxied-provider cases where public DNS does not reveal the VPS IP

Proxied DNS is reported as unconfirmed, not automatically failed solely because public resolvers return CDN/proxy IPs.

## Deployment Notes

Production deployment must keep NPM admin port `81` private or access-controlled. This implementation records that risk but does not change firewall, Docker, or host bindings.

Live verification must confirm:

- customer DNS TXT ownership
- customer DNS A/AAAA/CNAME routing
- NPM proxy host creation
- Let's Encrypt certificate issuance and renewal
- HTTPS access through the custom hostname
- canonical ZeaPlay hostname behavior remains unchanged

## Deferred Boundaries

Phase 18.3 remains NOT STARTED:

- branded login by hostname
- public Forms branding
- public Docs branding
- email branding
- custom sender domains

Phase 18.4 final certification remains NOT STARTED.

Phase 19+ remains NOT STARTED.
