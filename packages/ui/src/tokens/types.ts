export type ZeaTheme = 'light' | 'dark' | 'colorful';

export interface BrandTokens {
  agencyName?: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  loginBackground?: string;
  brandName?: string;
}

export interface SemanticTokenSet {
  background: string;
  foreground: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  input: string;
  ring: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  sidebarBackground: string;
  sidebarForeground: string;
  sidebarActive: string;
  sidebarBorder: string;
  headerBackground: string;
  cardBackground: string;
  cardBorder: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  xp: string;
  gold: string;
  silver: string;
  bronze: string;
  streak: string;
  achievement: string;
}
