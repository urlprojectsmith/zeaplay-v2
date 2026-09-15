# Dashboard Shells

The four dashboard shells share `DashboardShell`, `AppHeader`, `AppSidebar`, `MobileSidebar`, `PageHeader`, and `PageContainer`.

Navigation is configuration-driven in `apps/web/components/navigation/navigation-config.ts` for Developer, Super Admin, Agency, and Workspace scopes. Future routes are declared as disabled navigation items with optional `featureKey` values. The dormant `canShowFeature(featureKey)` helper is ready for backend feature-entitlement data when exposed.

Desktop navigation supports expanded and collapsed modes with persisted preference in `zea-play-sidebar-collapsed`. Collapsed items expose accessible tooltips. Mobile navigation uses a dialog drawer with Escape close and focus management.

Dashboard pages demonstrate the shell using real session context only: selected agency, selected workspace, current theme, current language, session status, and configured navigation modules. Developer and Super Admin pages are documented as awaiting future platform-scope backend authorization and do not fake authorization.
