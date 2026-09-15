# Design System

`packages/ui` is the reusable Zea Play design-system package. It exports primitives for buttons, inputs, textarea, select, checkbox, radio, switch, cards, badges, avatar, tabs, dropdown menu, dialog, tooltip, popover, pagination, skeleton, separator, progress, empty state, and status indicators.

Components consume semantic CSS variables such as `--background`, `--surface`, `--primary`, `--border`, `--card-background`, and gamification tokens like `--xp`, `--gold`, and `--achievement`. Repeated hardcoded brand colors should stay out of components.

App-specific components belong in `apps/web/components`, including `DashboardShell`, `AppHeader`, tenant switchers, profile menus, brand providers, and dashboard foundation demos.

Storybook is configured in `packages/ui` with stories for core Phase 5 primitives and theme previews for Light, Dark, and Colorful.
