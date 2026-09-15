# Themes

Zea Play supports explicit `light`, `dark`, and `colorful` themes through `ThemeProvider`.

The selected theme is persisted in `localStorage` under `zea-play-theme`. System preference is used only as an initial fallback when the user has not selected a theme. The provider writes `data-theme` on the document root so semantic CSS variables switch globally.

White-label branding is represented by `BrandTokens`: `agencyName`, `logoUrl`, `faviconUrl`, `primaryColor`, `secondaryColor`, `accentColor`, `loginBackground`, and `brandName`. Agency branding can influence semantic brand tokens through `BrandProvider`; workspaces inherit agency branding and do not define independent branding.
