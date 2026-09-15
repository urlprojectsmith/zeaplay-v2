# Frontend Architecture

Zea Play uses the Next.js App Router with Server Components by default. Client Components are limited to stateful surfaces such as session hydration, theme/language selection, tenant switchers, dialogs, menus, and responsive navigation.

`packages/ui` contains reusable primitives only. App-specific dashboard composition, navigation configuration, session-aware selectors, branding providers, and protected route boundaries live in `apps/web`.

Session state remains in `apps/web/stores/session.ts`: access tokens stay in memory, refresh uses the HttpOnly cookie and CSRF cookie, and agency/workspace selections continue to drive `x-agency-id` and `x-workspace-id` through the centralized API client.

TanStack Query remains an app provider with conservative retry defaults: client errors such as 401, 403, 404, and validation failures are not aggressively retried.
