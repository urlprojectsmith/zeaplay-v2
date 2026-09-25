# Dashboard Shells

The five dashboard environments share `DashboardShell`, `AppHeader`, `AppSidebar`, `MobileSidebar`, `PageHeader`, and `PageContainer` where appropriate: Developer, Platform / Super Admin, Super Agency, Agency, and Workspace / Sub-account.

Navigation is configuration-driven in `apps/web/components/navigation/navigation-config.ts` for Developer, Platform / Super Admin, Super Agency, Agency, and Workspace scopes. Future routes are declared as disabled navigation items with optional `featureKey` values. The dormant `canShowFeature(featureKey)` helper is ready for backend feature-entitlement data when exposed.

Desktop navigation supports expanded and collapsed modes with persisted preference in `zea-play-sidebar-collapsed`. Collapsed items expose accessible tooltips. Mobile navigation uses a dialog drawer with Escape close and focus management.

Dashboard pages demonstrate the shell using real session context only: selected Super Agency, selected Agency, selected Workspace, current theme, current language, session status, and configured navigation modules. Developer and Platform / Super Admin pages remain internal non-tenant environments and do not fake tenant authorization.
