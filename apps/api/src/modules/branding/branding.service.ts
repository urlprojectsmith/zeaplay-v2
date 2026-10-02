import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AssetLifecycle,
  AssetStatus,
  CustomDomainScopeType,
  Prisma,
  WhiteLabelScopeType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import { AuditService } from '../audit/audit.service';
import { CustomDomainResolverService } from '../custom-domains/custom-domain-resolver.service';
import type { UpdateWhiteLabelBrandingDto } from './dto/branding.dto';
import {
  BRANDING_FIELD_KEYS,
  BRANDING_FIELD_REGISTRY,
  BrandingFieldKeys,
  CHILD_OVERRIDABLE_BRANDING_FIELDS,
  PLATFORM_BRANDING_SCOPE_ID,
  type BrandingFieldKey,
  brandingFieldSet,
} from './branding.registry';

type SourceLabel =
  | 'INHERITED_FROM_PLATFORM'
  | 'INHERITED_FROM_SUPER_AGENCY'
  | 'INHERITED_FROM_AGENCY'
  | 'OVERRIDDEN_HERE';

type AssetOverride = { assetId: string; workspaceId: string };

interface BrandingScope {
  type: WhiteLabelScopeType;
  id: string;
  superAgencyId?: string;
  agencyId?: string;
  workspaceId?: string;
}

interface BrandingValues {
  appName?: string | null;
  companyName?: string | null;
  logo?: AssetValue | null;
  darkLogo?: AssetValue | null;
  favicon?: AssetValue | null;
  loginBackground?: AssetValue | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  footerText?: string | null;
  metaDescription?: string | null;
}

interface AssetValue {
  assetId: string;
  workspaceId: string;
  mimeType: string;
  sizeBytes: number;
  displayName: string;
  url?: string;
  expiresInSeconds?: number;
}

export interface PublicBrandingDto {
  appName: string;
  companyName: string;
  logo: PublicBrandingAssetDto | null;
  darkLogo: PublicBrandingAssetDto | null;
  favicon: PublicBrandingAssetDto | null;
  loginBackground: PublicBrandingAssetDto | null;
  primaryColor: string;
  primaryForeground: string;
  accentColor: string;
  accentForeground: string;
  supportEmail: string;
  supportUrl: string;
  footerText: string;
  metaDescription: string;
  fingerprint: string;
}

export interface PublicBrandingAssetDto {
  url: string;
  mimeType: string;
  displayName: string;
  expiresInSeconds?: number;
}

const DEFAULT_BRAND = {
  appName: 'ZeaPlay',
  companyName: 'ZeaPlay',
  primaryColor: '#1F7A68',
  accentColor: '#7C3AED',
  supportEmail: 'support@zeaplay.test',
  supportUrl: 'https://zeaplay.test/support',
  footerText: 'Powered by ZeaPlay',
  metaDescription: 'ZeaPlay workspace platform',
};

const assetFieldColumns = {
  logo: ['logoAssetId', 'logoAssetWorkspaceId'],
  darkLogo: ['darkLogoAssetId', 'darkLogoAssetWorkspaceId'],
  favicon: ['faviconAssetId', 'faviconAssetWorkspaceId'],
  loginBackground: ['loginBackgroundAssetId', 'loginBackgroundAssetWorkspaceId'],
} as const;

const fieldToProperty: Record<BrandingFieldKey, keyof BrandingValues> = {
  APP_NAME: 'appName',
  COMPANY_NAME: 'companyName',
  LOGO: 'logo',
  DARK_LOGO: 'darkLogo',
  FAVICON: 'favicon',
  LOGIN_BACKGROUND: 'loginBackground',
  PRIMARY_COLOR: 'primaryColor',
  ACCENT_COLOR: 'accentColor',
  SUPPORT_EMAIL: 'supportEmail',
  SUPPORT_URL: 'supportUrl',
  FOOTER_TEXT: 'footerText',
  META_DESCRIPTION: 'metaDescription',
};

const propertyToField = Object.fromEntries(
  Object.entries(fieldToProperty).map(([key, value]) => [value, key]),
) as Record<keyof BrandingValues, BrandingFieldKey>;

const assetLimits = {
  logo: {
    maxBytes: 2 * 1024 * 1024,
    maxWidth: 4096,
    maxHeight: 4096,
    mimeTypes: new Set(['image/png', 'image/jpeg', 'image/webp']),
  },
  darkLogo: {
    maxBytes: 2 * 1024 * 1024,
    maxWidth: 4096,
    maxHeight: 4096,
    mimeTypes: new Set(['image/png', 'image/jpeg', 'image/webp']),
  },
  favicon: {
    maxBytes: 512 * 1024,
    maxWidth: 1024,
    maxHeight: 1024,
    mimeTypes: new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon']),
  },
  loginBackground: {
    maxBytes: 5 * 1024 * 1024,
    maxWidth: 8192,
    maxHeight: 8192,
    mimeTypes: new Set(['image/png', 'image/jpeg', 'image/webp']),
  },
} as const;

@Injectable()
export class BrandingService {
  private readonly env = validateEnvironment(process.env);
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Optional() private readonly customDomains?: CustomDomainResolverService,
  ) {}

  getRegistry() {
    return {
      fields: BRANDING_FIELD_REGISTRY,
      fieldCount: BRANDING_FIELD_REGISTRY.length,
      unsupported: ['CUSTOM_CSS', 'CUSTOM_HTML', 'CUSTOM_JS', 'CUSTOM_SCRIPT', 'CUSTOM_IFRAME'],
    };
  }

  async resolveForScope(scope: BrandingScope, options: { includeSources?: boolean } = {}) {
    const cacheKey = `effective:${scope.type}:${scope.id}:${options.includeSources ? 'sources' : 'plain'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const chain = await this.resolveChain(scope);
    const effectivePolicy = this.effectivePolicy(chain);
    const output = await this.composeEffectiveBrand(scope, chain, effectivePolicy, options);
    this.cache.set(cacheKey, { expiresAt: Date.now() + 30_000, value: output });
    return output;
  }

  async resolvePublicForHost(host: string | undefined | null): Promise<PublicBrandingDto> {
    const resolved = await this.customDomains?.resolveHost(host);
    if (!resolved) return this.toPublicBranding(await this.resolveForScope(this.platformScope()));
    if (resolved.scopeType === CustomDomainScopeType.SUPER_AGENCY) {
      return this.toPublicBranding(
        await this.resolveForScope({
          type: WhiteLabelScopeType.SUPER_AGENCY,
          id: resolved.scopeId,
          superAgencyId: resolved.scopeId,
        }),
      );
    }
    if (resolved.scopeType === CustomDomainScopeType.AGENCY) {
      return this.toPublicBranding(
        await this.resolveForScope({ type: WhiteLabelScopeType.AGENCY, id: resolved.scopeId }),
      );
    }
    if (resolved.scopeType === CustomDomainScopeType.WORKSPACE) {
      return this.toPublicBranding(
        await this.resolveForScope({ type: WhiteLabelScopeType.WORKSPACE, id: resolved.scopeId }),
      );
    }
    return this.toPublicBranding(await this.resolveForScope(this.platformScope()));
  }

  async resolvePublicForWorkspace(workspaceId: string): Promise<PublicBrandingDto> {
    return this.toPublicBranding(
      await this.resolveForScope({ type: WhiteLabelScopeType.WORKSPACE, id: workspaceId }),
    );
  }

  async getConfig(scope: BrandingScope) {
    const row = await this.findBrand(scope);
    const effective = await this.resolveForScope(scope, { includeSources: true });
    return {
      scopeType: scope.type,
      scopeId: scope.id,
      revision: row?.revision ?? 0,
      overrides: row ? await this.rowToValues(row, false) : {},
      agencyAllowedOverrides: row?.agencyAllowedOverrides ?? [],
      workspaceAllowedOverrides: row?.workspaceAllowedOverrides ?? [],
      effective,
      registry: this.getRegistry(),
      nullSemantics: 'NULL_INHERITS_FROM_PARENT',
      storedDisabledOverrideDecision:
        'STORED_OVERRIDE_BECOMES_EFFECTIVE_AGAIN_WHEN_POLICY_REENABLES',
    };
  }

  async updateForScope(
    scope: BrandingScope,
    actor: AuthenticatedUser | undefined,
    dto: UpdateWhiteLabelBrandingDto,
  ) {
    if (!actor) throw new ForbiddenException('Authentication required.');
    const existing = await this.findBrand(scope);
    const currentRevision = existing?.revision ?? 0;
    if (dto.expectedRevision !== currentRevision) {
      throw new ConflictException('BRANDING_REVISION_CONFLICT');
    }

    const chain = await this.resolveChain(scope);
    const policy = this.effectivePolicy(chain);
    const mutation = await this.normalizeMutation(scope, dto, policy, chain);

    const saved = existing
      ? await this.prisma.whiteLabelBranding.update({
          where: { id: existing.id },
          data: {
            ...mutation,
            updatedById: actor.id,
            revision: { increment: 1 },
          } as Prisma.WhiteLabelBrandingUncheckedUpdateInput,
        })
      : await this.prisma.whiteLabelBranding.create({
          data: {
            ...mutation,
            scopeType: scope.type,
            scopeId: scope.id,
            updatedById: actor.id,
            createdById: actor.id,
            revision: 1,
          } as Prisma.WhiteLabelBrandingUncheckedCreateInput,
        });

    this.invalidateCache();
    await this.audit.record({
      superAgencyId: scope.superAgencyId,
      agencyId: scope.agencyId,
      workspaceId: scope.workspaceId,
      userId: actor.id,
      action: 'branding.updated',
      entityType: 'WhiteLabelBranding',
      entityId: saved.id,
      metadata: {
        scopeType: scope.type,
        scopeId: scope.id,
        fieldsChanged: Object.keys(mutation),
        revision: saved.revision,
      },
    });
    return this.getConfig(scope);
  }

  platformScope(): BrandingScope {
    return { type: WhiteLabelScopeType.PLATFORM, id: PLATFORM_BRANDING_SCOPE_ID };
  }

  superAgencyScope(tenant: SuperAgencyTenantContext): BrandingScope {
    return {
      type: WhiteLabelScopeType.SUPER_AGENCY,
      id: tenant.superAgencyId,
      superAgencyId: tenant.superAgencyId,
    };
  }

  agencyScope(tenant: AgencyTenantContext): BrandingScope {
    return {
      type: WhiteLabelScopeType.AGENCY,
      id: tenant.agencyId,
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
    };
  }

  workspaceScope(tenant: WorkspaceTenantContext): BrandingScope {
    return {
      type: WhiteLabelScopeType.WORKSPACE,
      id: tenant.workspaceId,
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
    };
  }

  toPublicBranding(input: unknown): PublicBrandingDto {
    const brand = input as {
      appName?: string;
      companyName?: string;
      logo?: AssetValue | null;
      darkLogo?: AssetValue | null;
      favicon?: AssetValue | null;
      loginBackground?: AssetValue | null;
      primaryColor?: string;
      primaryForeground?: string;
      accentColor?: string;
      accentForeground?: string;
      supportEmail?: string;
      supportUrl?: string;
      footerText?: string;
      metaDescription?: string;
      fingerprint?: string;
    };
    return {
      appName: brand.appName ?? DEFAULT_BRAND.appName,
      companyName: brand.companyName ?? DEFAULT_BRAND.companyName,
      logo: publicAsset(brand.logo),
      darkLogo: publicAsset(brand.darkLogo),
      favicon: publicAsset(brand.favicon),
      loginBackground: publicAsset(brand.loginBackground),
      primaryColor: brand.primaryColor ?? DEFAULT_BRAND.primaryColor,
      primaryForeground:
        brand.primaryForeground ??
        accessibleForeground(brand.primaryColor ?? DEFAULT_BRAND.primaryColor),
      accentColor: brand.accentColor ?? DEFAULT_BRAND.accentColor,
      accentForeground:
        brand.accentForeground ??
        accessibleForeground(brand.accentColor ?? DEFAULT_BRAND.accentColor),
      supportEmail: brand.supportEmail ?? DEFAULT_BRAND.supportEmail,
      supportUrl: brand.supportUrl ?? DEFAULT_BRAND.supportUrl,
      footerText: brand.footerText ?? DEFAULT_BRAND.footerText,
      metaDescription: brand.metaDescription ?? DEFAULT_BRAND.metaDescription,
      fingerprint: brand.fingerprint ?? this.fingerprint(DEFAULT_BRAND, [0]),
    };
  }

  private async resolveChain(scope: BrandingScope) {
    const lineage = await this.resolveLineage(scope);
    const scopes = [
      { type: WhiteLabelScopeType.PLATFORM, id: PLATFORM_BRANDING_SCOPE_ID },
      lineage.superAgencyId
        ? { type: WhiteLabelScopeType.SUPER_AGENCY, id: lineage.superAgencyId }
        : null,
      lineage.agencyId ? { type: WhiteLabelScopeType.AGENCY, id: lineage.agencyId } : null,
      lineage.workspaceId ? { type: WhiteLabelScopeType.WORKSPACE, id: lineage.workspaceId } : null,
    ].filter((item): item is { type: WhiteLabelScopeType; id: string } => Boolean(item));
    const rows = await this.prisma.whiteLabelBranding.findMany({
      where: { OR: scopes.map((item) => ({ scopeType: item.type, scopeId: item.id })) },
      orderBy: { createdAt: 'asc' },
    });
    return scopes.map((item) => ({
      scope: item,
      row: rows.find((row) => row.scopeType === item.type && row.scopeId === item.id) ?? null,
    }));
  }

  private async resolveLineage(scope: BrandingScope) {
    if (scope.type === WhiteLabelScopeType.PLATFORM) return {};
    if (scope.type === WhiteLabelScopeType.SUPER_AGENCY) return { superAgencyId: scope.id };
    if (scope.type === WhiteLabelScopeType.AGENCY) {
      const agency = await this.prisma.agency.findUnique({
        where: { id: scope.id },
        select: { id: true, superAgencyId: true },
      });
      if (!agency) throw new NotFoundException('AGENCY_NOT_FOUND');
      return { superAgencyId: agency.superAgencyId, agencyId: agency.id };
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: scope.id },
      select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
    });
    if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    return {
      superAgencyId: workspace.agency.superAgencyId,
      agencyId: workspace.agencyId,
      workspaceId: workspace.id,
    };
  }

  private async findBrand(scope: BrandingScope) {
    return this.prisma.whiteLabelBranding.findUnique({
      where: { scopeType_scopeId: { scopeType: scope.type, scopeId: scope.id } },
    });
  }

  private async composeEffectiveBrand(
    target: BrandingScope,
    chain: Awaited<ReturnType<BrandingService['resolveChain']>>,
    policy: ReturnType<BrandingService['effectivePolicy']>,
    options: { includeSources?: boolean },
  ) {
    const values: BrandingValues = {
      appName: DEFAULT_BRAND.appName,
      companyName: DEFAULT_BRAND.companyName,
      primaryColor: DEFAULT_BRAND.primaryColor,
      accentColor: DEFAULT_BRAND.accentColor,
      supportEmail: DEFAULT_BRAND.supportEmail,
      supportUrl: DEFAULT_BRAND.supportUrl,
      footerText: DEFAULT_BRAND.footerText,
      metaDescription: DEFAULT_BRAND.metaDescription,
    };
    const sources = Object.fromEntries(
      BRANDING_FIELD_KEYS.map((key) => [key, 'INHERITED_FROM_PLATFORM' as SourceLabel]),
    ) as Record<BrandingFieldKey, SourceLabel>;

    for (const entry of chain) {
      if (!entry.row) continue;
      const rowValues = await this.rowToValues(entry.row, true);
      for (const [property, value] of Object.entries(rowValues) as [
        keyof BrandingValues,
        BrandingValues[keyof BrandingValues],
      ][]) {
        if (value === null || value === undefined) continue;
        const field = propertyToField[property];
        if (!this.fieldAppliesToTarget(entry.scope.type, target.type, field, policy)) continue;
        values[property] = value as never;
        sources[field] =
          entry.scope.type === target.type
            ? 'OVERRIDDEN_HERE'
            : entry.scope.type === WhiteLabelScopeType.SUPER_AGENCY
              ? 'INHERITED_FROM_SUPER_AGENCY'
              : entry.scope.type === WhiteLabelScopeType.AGENCY
                ? 'INHERITED_FROM_AGENCY'
                : 'INHERITED_FROM_PLATFORM';
      }
    }

    await Promise.all(
      (['logo', 'darkLogo', 'favicon', 'loginBackground'] as const).map(async (property) => {
        const asset = values[property];
        if (!asset) return;
        values[property] = {
          ...asset,
          url: await this.storage.createPresignedDownloadUrl(
            await this.storageKeyForAsset(asset),
            this.env.DOWNLOAD_URL_TTL_SECONDS,
          ),
          expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS,
        };
      }),
    );

    const fingerprint = this.fingerprint(
      values,
      chain.map((entry) => entry.row?.revision ?? 0),
    );
    const primaryForeground = accessibleForeground(
      values.primaryColor ?? DEFAULT_BRAND.primaryColor,
    );
    const accentForeground = accessibleForeground(values.accentColor ?? DEFAULT_BRAND.accentColor);
    return {
      scopeType: target.type,
      scopeId: target.id,
      appName: values.appName ?? DEFAULT_BRAND.appName,
      companyName: values.companyName ?? DEFAULT_BRAND.companyName,
      logo: values.logo ?? null,
      darkLogo: values.darkLogo ?? null,
      favicon: values.favicon ?? null,
      loginBackground: values.loginBackground ?? null,
      primaryColor: values.primaryColor ?? DEFAULT_BRAND.primaryColor,
      primaryForeground,
      accentColor: values.accentColor ?? DEFAULT_BRAND.accentColor,
      accentForeground,
      supportEmail: values.supportEmail ?? DEFAULT_BRAND.supportEmail,
      supportUrl: values.supportUrl ?? DEFAULT_BRAND.supportUrl,
      footerText: values.footerText ?? DEFAULT_BRAND.footerText,
      metaDescription: values.metaDescription ?? DEFAULT_BRAND.metaDescription,
      fingerprint,
      sources: options.includeSources ? sources : undefined,
      policy,
    };
  }

  private effectivePolicy(chain: Awaited<ReturnType<BrandingService['resolveChain']>>) {
    const superAgency = chain.find(
      (entry) => entry.scope.type === WhiteLabelScopeType.SUPER_AGENCY,
    )?.row;
    const agency = chain.find((entry) => entry.scope.type === WhiteLabelScopeType.AGENCY)?.row;
    const agencyAllowed = new Set(validFieldKeys(superAgency?.agencyAllowedOverrides ?? []));
    const superWorkspaceAllowed = new Set(
      validFieldKeys(superAgency?.workspaceAllowedOverrides ?? []),
    );
    const agencyWorkspaceRestriction = validFieldKeys(agency?.workspaceAllowedOverrides ?? []);
    const workspaceAllowed =
      agencyWorkspaceRestriction.length > 0
        ? intersection(superWorkspaceAllowed, new Set(agencyWorkspaceRestriction))
        : superWorkspaceAllowed;
    return {
      agencyAllowedOverrides: [...agencyAllowed],
      workspaceAllowedOverrides: [...workspaceAllowed],
    };
  }

  private fieldAppliesToTarget(
    sourceType: WhiteLabelScopeType,
    targetType: WhiteLabelScopeType,
    field: BrandingFieldKey,
    policy: { agencyAllowedOverrides: string[]; workspaceAllowedOverrides: string[] },
  ) {
    if (
      sourceType === WhiteLabelScopeType.PLATFORM ||
      sourceType === WhiteLabelScopeType.SUPER_AGENCY
    ) {
      return true;
    }
    if (sourceType === WhiteLabelScopeType.AGENCY) {
      if (targetType === WhiteLabelScopeType.AGENCY)
        return policy.agencyAllowedOverrides.includes(field);
      if (targetType === WhiteLabelScopeType.WORKSPACE) return true;
    }
    if (sourceType === WhiteLabelScopeType.WORKSPACE) {
      return policy.workspaceAllowedOverrides.includes(field);
    }
    return sourceType === targetType;
  }

  private async normalizeMutation(
    scope: BrandingScope,
    dto: UpdateWhiteLabelBrandingDto,
    policy: { agencyAllowedOverrides: string[]; workspaceAllowedOverrides: string[] },
    chain: Awaited<ReturnType<BrandingService['resolveChain']>>,
  ) {
    const data: Partial<Prisma.WhiteLabelBrandingUncheckedCreateInput> = {};
    const fieldPolicy = this.allowedFieldsForMutation(scope.type, policy);
    for (const [property, field] of Object.entries(propertyToField) as [
      keyof BrandingValues,
      BrandingFieldKey,
    ][]) {
      if (!(property in dto)) continue;
      if (!fieldPolicy.has(field)) throw new ForbiddenException('BRANDING_FIELD_OVERRIDE_DENIED');
      const raw = dto[property as keyof UpdateWhiteLabelBrandingDto] as unknown;
      if (isAssetProperty(property)) {
        await this.assignAssetField(scope, data, property, raw as AssetOverride | null | undefined);
      } else {
        data[property] = normalizeScalar(field, raw) as never;
      }
    }

    if (dto.agencyAllowedOverrides !== undefined) {
      if (scope.type !== WhiteLabelScopeType.SUPER_AGENCY) {
        throw new ForbiddenException('BRANDING_POLICY_SCOPE_DENIED');
      }
      data.agencyAllowedOverrides = normalizePolicy(dto.agencyAllowedOverrides);
    }
    if (dto.workspaceAllowedOverrides !== undefined) {
      const normalized = normalizePolicy(dto.workspaceAllowedOverrides);
      if (scope.type === WhiteLabelScopeType.SUPER_AGENCY) {
        data.workspaceAllowedOverrides = normalized;
      } else if (scope.type === WhiteLabelScopeType.AGENCY) {
        const superAgency = chain.find(
          (entry) => entry.scope.type === WhiteLabelScopeType.SUPER_AGENCY,
        )?.row;
        const superAllowed = new Set(validFieldKeys(superAgency?.workspaceAllowedOverrides ?? []));
        if (normalized.some((field) => !superAllowed.has(field))) {
          throw new ForbiddenException('BRANDING_ANCESTOR_POLICY_DENIED');
        }
        data.workspaceAllowedOverrides = normalized;
      } else {
        throw new ForbiddenException('BRANDING_POLICY_SCOPE_DENIED');
      }
    }
    return data;
  }

  private allowedFieldsForMutation(
    scopeType: WhiteLabelScopeType,
    policy: { agencyAllowedOverrides: string[]; workspaceAllowedOverrides: string[] },
  ) {
    if (
      scopeType === WhiteLabelScopeType.PLATFORM ||
      scopeType === WhiteLabelScopeType.SUPER_AGENCY
    ) {
      return new Set(BRANDING_FIELD_KEYS);
    }
    if (scopeType === WhiteLabelScopeType.AGENCY) return new Set(policy.agencyAllowedOverrides);
    return new Set(policy.workspaceAllowedOverrides);
  }

  private async assignAssetField(
    scope: BrandingScope,
    data: Prisma.WhiteLabelBrandingUncheckedUpdateInput,
    property: keyof typeof assetFieldColumns,
    raw: AssetOverride | null | undefined,
  ) {
    const [idColumn, workspaceColumn] = assetFieldColumns[property];
    if (raw === null) {
      data[idColumn] = null;
      data[workspaceColumn] = null;
      return;
    }
    if (!raw) return;
    if (!raw.assetId || !raw.workspaceId) {
      throw new UnprocessableEntityException('BRANDING_ASSET_REFERENCE_REQUIRED');
    }
    const asset = await this.prisma.asset.findUnique({
      where: { id_workspaceId: { id: raw.assetId, workspaceId: raw.workspaceId } },
      select: {
        id: true,
        workspaceId: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        lifecycle: true,
        deletedAt: true,
        displayName: true,
        metadata: true,
        workspace: { select: { agencyId: true, agency: { select: { superAgencyId: true } } } },
      },
    });
    if (!asset || asset.deletedAt) throw new NotFoundException('BRANDING_ASSET_NOT_FOUND');
    if (asset.status !== AssetStatus.READY || asset.lifecycle !== AssetLifecycle.ACTIVE) {
      throw new ConflictException('BRANDING_ASSET_NOT_READY');
    }
    this.assertAssetScope(scope, asset);
    const limit = assetLimits[property];
    if (!limit.mimeTypes.has(asset.mimeType)) {
      throw new UnprocessableEntityException('BRANDING_ASSET_MIME_DENIED');
    }
    if (asset.mimeType === 'image/svg+xml')
      throw new UnprocessableEntityException('SVG_NOT_SUPPORTED');
    if (asset.sizeBytes > BigInt(limit.maxBytes)) {
      throw new UnprocessableEntityException('BRANDING_ASSET_TOO_LARGE');
    }
    this.assertAssetDimensions(property, asset.metadata);
    data[idColumn] = asset.id;
    data[workspaceColumn] = asset.workspaceId;
  }

  private assertAssetDimensions(
    property: keyof typeof assetLimits,
    metadata: Prisma.JsonValue | null,
  ) {
    const limit = assetLimits[property];
    const width =
      readMetadataNumber(metadata, 'width') ?? readMetadataNumber(metadata, 'imageWidth');
    const height =
      readMetadataNumber(metadata, 'height') ?? readMetadataNumber(metadata, 'imageHeight');
    if (width === null || height === null) return;
    if (width < 1 || height < 1 || width > limit.maxWidth || height > limit.maxHeight) {
      throw new UnprocessableEntityException('BRANDING_ASSET_DIMENSIONS_DENIED');
    }
  }

  private assertAssetScope(
    scope: BrandingScope,
    asset: {
      workspaceId: string;
      workspace: { agencyId: string; agency: { superAgencyId: string } };
    },
  ) {
    if (scope.type === WhiteLabelScopeType.PLATFORM) return;
    if (
      scope.type === WhiteLabelScopeType.SUPER_AGENCY &&
      asset.workspace.agency.superAgencyId === scope.id
    ) {
      return;
    }
    if (scope.type === WhiteLabelScopeType.AGENCY && asset.workspace.agencyId === scope.id) return;
    if (scope.type === WhiteLabelScopeType.WORKSPACE && asset.workspaceId === scope.id) return;
    throw new ForbiddenException('BRANDING_ASSET_SCOPE_DENIED');
  }

  private async rowToValues(
    row: Prisma.WhiteLabelBrandingGetPayload<object>,
    includeAssetMetadata: boolean,
  ): Promise<BrandingValues> {
    const values: BrandingValues = {
      appName: row.appName,
      companyName: row.companyName,
      primaryColor: row.primaryColor,
      accentColor: row.accentColor,
      supportEmail: row.supportEmail,
      supportUrl: row.supportUrl,
      footerText: row.footerText,
      metaDescription: row.metaDescription,
    };
    for (const property of ['logo', 'darkLogo', 'favicon', 'loginBackground'] as const) {
      const [assetIdColumn, workspaceIdColumn] = assetFieldColumns[property];
      const assetId = row[assetIdColumn];
      const workspaceId = row[workspaceIdColumn];
      if (!assetId || !workspaceId) {
        values[property] = null;
        continue;
      }
      values[property] = includeAssetMetadata
        ? await this.assetValue(assetId, workspaceId)
        : {
            assetId,
            workspaceId,
            mimeType: '',
            sizeBytes: 0,
            displayName: '',
          };
    }
    return values;
  }

  private async assetValue(assetId: string, workspaceId: string): Promise<AssetValue | null> {
    const asset = await this.prisma.asset.findUnique({
      where: { id_workspaceId: { id: assetId, workspaceId } },
      select: {
        id: true,
        workspaceId: true,
        mimeType: true,
        sizeBytes: true,
        displayName: true,
        status: true,
        lifecycle: true,
        deletedAt: true,
      },
    });
    if (!asset || asset.deletedAt || asset.status !== AssetStatus.READY) return null;
    return {
      assetId: asset.id,
      workspaceId: asset.workspaceId,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      displayName: asset.displayName,
    };
  }

  private async storageKeyForAsset(asset: AssetValue) {
    const row = await this.prisma.asset.findUnique({
      where: { id_workspaceId: { id: asset.assetId, workspaceId: asset.workspaceId } },
      select: { storageKey: true },
    });
    if (!row) throw new NotFoundException('BRANDING_ASSET_NOT_FOUND');
    return row.storageKey;
  }

  private fingerprint(values: BrandingValues, revisions: number[]) {
    return createHash('sha256')
      .update(JSON.stringify({ values, revisions }))
      .digest('hex')
      .slice(0, 32);
  }

  private invalidateCache() {
    this.cache.clear();
  }
}

function normalizeScalar(field: BrandingFieldKey, raw: unknown) {
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new UnprocessableEntityException('BRANDING_FIELD_INVALID');
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value) return null;
  if (/[<>]/.test(value) || /javascript:/i.test(value)) {
    throw new UnprocessableEntityException('BRANDING_TEXT_UNSAFE');
  }
  if (field === BrandingFieldKeys.primaryColor || field === BrandingFieldKeys.accentColor) {
    const color = value.toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(color))
      throw new UnprocessableEntityException('BRANDING_COLOR_INVALID');
    return color;
  }
  if (field === BrandingFieldKeys.supportEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new UnprocessableEntityException('BRANDING_EMAIL_INVALID');
    }
    return value.toLowerCase();
  }
  if (field === BrandingFieldKeys.supportUrl) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new UnprocessableEntityException('BRANDING_URL_INVALID');
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new UnprocessableEntityException('BRANDING_URL_DENIED');
    }
    return url.href;
  }
  return value;
}

function normalizePolicy(fields: string[]) {
  const unique = [...new Set(fields)];
  if (unique.some((field) => !brandingFieldSet.has(field))) {
    throw new UnprocessableEntityException('BRANDING_POLICY_FIELD_INVALID');
  }
  return unique.filter((field): field is BrandingFieldKey =>
    CHILD_OVERRIDABLE_BRANDING_FIELDS.includes(field as BrandingFieldKey),
  );
}

function validFieldKeys(fields: string[]) {
  return fields.filter((field): field is BrandingFieldKey => brandingFieldSet.has(field));
}

function intersection<T>(left: Set<T>, right: Set<T>) {
  return new Set([...left].filter((item) => right.has(item)));
}

function isAssetProperty(
  property: keyof BrandingValues,
): property is keyof typeof assetFieldColumns {
  return property in assetFieldColumns;
}

function accessibleForeground(color: string) {
  const rgb = hexToRgb(color);
  const white = contrast(rgb, [255, 255, 255]);
  const black = contrast(rgb, [0, 0, 0]);
  return white >= black ? '#FFFFFF' : '#000000';
}

function hexToRgb(color: string): [number, number, number] {
  const normalized = /^#[0-9A-Fa-f]{6}$/.test(color) ? color.slice(1) : '1F7A68';
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function contrast(left: [number, number, number], right: [number, number, number]) {
  const l1 = luminance(left) + 0.05;
  const l2 = luminance(right) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}

function luminance([red, green, blue]: [number, number, number]) {
  return [red, green, blue]
    .map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
}

function readMetadataNumber(metadata: Prisma.JsonValue | null, key: string) {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, Prisma.JsonValue>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function publicAsset(asset: AssetValue | null | undefined): PublicBrandingAssetDto | null {
  if (!asset?.url) return null;
  return {
    url: asset.url,
    mimeType: asset.mimeType,
    displayName: asset.displayName,
    expiresInSeconds: asset.expiresInSeconds,
  };
}
