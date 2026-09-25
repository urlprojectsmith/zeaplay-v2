# API Standards

The REST API is versioned under `/api/v1`.

Successful responses use:

```json
{
  "data": {},
  "requestId": "..."
}
```

Errors use:

```json
{
  "code": "STABLE_ERROR_CODE",
  "message": "Human-readable message.",
  "requestId": "...",
  "validation": []
}
```

Production responses must not expose stack traces. Every request receives `x-request-id` and `x-correlation-id`.

## Auth And Tenancy

Authentication endpoints:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Login returns an access token, CSRF token, user profile, and authorized tenant
contexts. The refresh token is set only as an HttpOnly cookie. Refresh and
logout use the cookie-backed refresh session and require `X-CSRF-Token`.

Tenant-owned endpoints require `Authorization: Bearer <accessToken>` plus the
explicit current scope:

- Super Agency routes: `x-super-agency-id`
- Agency routes: `x-agency-id`
- Workspace routes: `x-agency-id` and `x-workspace-id`

The API validates active membership and the effective Super Agency -> Agency ->
Workspace status chain before authorizing permissions. `Organization` is legacy
compatibility metadata only and is not a tenant root.

Super Agency management endpoints:

- `GET /api/v1/super-agencies/:superAgencyId`
- `PATCH /api/v1/super-agencies/:superAgencyId`
- `GET /api/v1/super-agencies/:superAgencyId/members`
- `POST /api/v1/super-agencies/:superAgencyId/invitations`

Agency and Workspace management endpoints are scoped by their parent tenant and
derive parent IDs server-side. Parent management is not impersonation and does
not create synthetic child memberships.

Project endpoints:

- `POST /api/v1/projects`
- `GET /api/v1/projects`
- `GET /api/v1/projects/:id`
- `PATCH /api/v1/projects/:id`
- `DELETE /api/v1/projects/:id`

Collection responses that page data return `{ items, page, pageSize, total }`
inside the standard response envelope. Validation failures use HTTP 422.

## Phase 3 Assets

Asset endpoints:

- `POST /api/v1/projects/:projectId/assets/upload-init`
- `POST /api/v1/projects/:projectId/assets/:assetId/upload-complete`
- `GET /api/v1/projects/:projectId/assets`
- `GET /api/v1/projects/:projectId/assets/:assetId`
- `GET /api/v1/projects/:projectId/assets/:assetId/download`
- `DELETE /api/v1/projects/:projectId/assets/:assetId`

Asset endpoints authorize by authenticated user, active Workspace membership,
project, asset, and permission. Responses do not expose object-storage
credentials, buckets, or object keys.
