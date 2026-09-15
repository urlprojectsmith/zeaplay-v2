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

## Phase 2 Auth And Tenancy

Authentication endpoints:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Login returns an access token, CSRF token, user profile, and active organizations.
The refresh token is set only as an HttpOnly cookie. Refresh and logout use the
cookie-backed refresh session and require `X-CSRF-Token`.

Tenant-owned endpoints require `Authorization: Bearer <accessToken>` and
`X-Organization-Id: <organization UUID>`. The API validates that the user has an
active membership in that organization before authorizing permissions.

Organization endpoints:

- `POST /api/v1/organizations`
- `GET /api/v1/organizations`
- `GET /api/v1/organizations/:id`
- `PATCH /api/v1/organizations/:id`

Membership endpoints:

- `GET /api/v1/organizations/:organizationId/memberships`
- `POST /api/v1/organizations/:organizationId/memberships`
- `PATCH /api/v1/organizations/:organizationId/memberships/:id`
- `DELETE /api/v1/organizations/:organizationId/memberships/:id`

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

Asset endpoints authorize by authenticated user, organization context, project,
asset, and permission. Responses do not expose object-storage credentials,
buckets, or object keys.
