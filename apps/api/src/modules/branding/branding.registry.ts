export const PLATFORM_BRANDING_SCOPE_ID = '00000000-0000-0000-0000-000000000000';

export const BrandingFieldKeys = {
  appName: 'APP_NAME',
  companyName: 'COMPANY_NAME',
  logo: 'LOGO',
  darkLogo: 'DARK_LOGO',
  favicon: 'FAVICON',
  loginBackground: 'LOGIN_BACKGROUND',
  primaryColor: 'PRIMARY_COLOR',
  accentColor: 'ACCENT_COLOR',
  supportEmail: 'SUPPORT_EMAIL',
  supportUrl: 'SUPPORT_URL',
  footerText: 'FOOTER_TEXT',
  metaDescription: 'META_DESCRIPTION',
} as const;

export type BrandingFieldKey = (typeof BrandingFieldKeys)[keyof typeof BrandingFieldKeys];

export type BrandingFieldType = 'TEXT' | 'EMAIL' | 'URL' | 'COLOR' | 'ASSET';
export type BrandingScopeSupport = 'PLATFORM' | 'SUPER_AGENCY' | 'AGENCY' | 'WORKSPACE';
export type BrandingAssetCategory =
  'BRANDING_LOGO' | 'BRANDING_DARK_LOGO' | 'BRANDING_FAVICON' | 'BRANDING_LOGIN_BACKGROUND';

export interface BrandingFieldDefinition {
  key: BrandingFieldKey;
  storageKey: string;
  type: BrandingFieldType;
  supportedScopes: BrandingScopeSupport[];
  assetCategory?: BrandingAssetCategory;
  inherit: true;
  childOverridePermittable: boolean;
  publicSafe: boolean;
  maxLength?: number;
}

const allScopes: BrandingScopeSupport[] = ['PLATFORM', 'SUPER_AGENCY', 'AGENCY', 'WORKSPACE'];

export const BRANDING_FIELD_REGISTRY = [
  {
    key: BrandingFieldKeys.appName,
    storageKey: 'appName',
    type: 'TEXT',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
    maxLength: 80,
  },
  {
    key: BrandingFieldKeys.companyName,
    storageKey: 'companyName',
    type: 'TEXT',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
    maxLength: 120,
  },
  {
    key: BrandingFieldKeys.logo,
    storageKey: 'logo',
    type: 'ASSET',
    supportedScopes: allScopes,
    assetCategory: 'BRANDING_LOGO',
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.darkLogo,
    storageKey: 'darkLogo',
    type: 'ASSET',
    supportedScopes: allScopes,
    assetCategory: 'BRANDING_DARK_LOGO',
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.favicon,
    storageKey: 'favicon',
    type: 'ASSET',
    supportedScopes: allScopes,
    assetCategory: 'BRANDING_FAVICON',
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.loginBackground,
    storageKey: 'loginBackground',
    type: 'ASSET',
    supportedScopes: allScopes,
    assetCategory: 'BRANDING_LOGIN_BACKGROUND',
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.primaryColor,
    storageKey: 'primaryColor',
    type: 'COLOR',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.accentColor,
    storageKey: 'accentColor',
    type: 'COLOR',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.supportEmail,
    storageKey: 'supportEmail',
    type: 'EMAIL',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.supportUrl,
    storageKey: 'supportUrl',
    type: 'URL',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
  },
  {
    key: BrandingFieldKeys.footerText,
    storageKey: 'footerText',
    type: 'TEXT',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
    maxLength: 160,
  },
  {
    key: BrandingFieldKeys.metaDescription,
    storageKey: 'metaDescription',
    type: 'TEXT',
    supportedScopes: allScopes,
    inherit: true,
    childOverridePermittable: true,
    publicSafe: true,
    maxLength: 180,
  },
] as const satisfies readonly BrandingFieldDefinition[];

export const BRANDING_FIELD_KEYS = BRANDING_FIELD_REGISTRY.map((field) => field.key);
export const CHILD_OVERRIDABLE_BRANDING_FIELDS = BRANDING_FIELD_REGISTRY.filter(
  (field) => field.childOverridePermittable,
).map((field) => field.key);

export const brandingFieldSet = new Set<string>(BRANDING_FIELD_KEYS);

export function assertBrandingFieldKey(value: string): asserts value is BrandingFieldKey {
  if (!brandingFieldSet.has(value)) throw new Error(`Unsupported branding field: ${value}`);
}
