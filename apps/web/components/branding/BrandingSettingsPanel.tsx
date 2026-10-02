'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Input,
} from '@zea-play/ui';
import type { AnalyticsScopeType } from '../../services/analytics';
import {
  brandingKeys,
  getBrandingConfig,
  updateBrandingConfig,
  type BrandingFieldKey,
  type UpdateBrandingConfig,
} from '../../services/branding';
import { BrandLogo } from './BrandLogo';

const fieldOptions: { key: BrandingFieldKey; label: string }[] = [
  { key: 'APP_NAME', label: 'App name' },
  { key: 'COMPANY_NAME', label: 'Company name' },
  { key: 'LOGO', label: 'Logo' },
  { key: 'DARK_LOGO', label: 'Dark logo' },
  { key: 'FAVICON', label: 'Favicon' },
  { key: 'LOGIN_BACKGROUND', label: 'Login background' },
  { key: 'PRIMARY_COLOR', label: 'Primary color' },
  { key: 'ACCENT_COLOR', label: 'Accent color' },
  { key: 'SUPPORT_EMAIL', label: 'Support email' },
  { key: 'SUPPORT_URL', label: 'Support URL' },
  { key: 'FOOTER_TEXT', label: 'Footer text' },
  { key: 'META_DESCRIPTION', label: 'Meta description' },
];

const scalarFields = [
  ['appName', 'App name', 'APP_NAME'],
  ['companyName', 'Company name', 'COMPANY_NAME'],
  ['primaryColor', 'Primary color', 'PRIMARY_COLOR'],
  ['accentColor', 'Accent color', 'ACCENT_COLOR'],
  ['supportEmail', 'Support email', 'SUPPORT_EMAIL'],
  ['supportUrl', 'Support URL', 'SUPPORT_URL'],
  ['footerText', 'Footer text', 'FOOTER_TEXT'],
  ['metaDescription', 'Meta description', 'META_DESCRIPTION'],
] as const;

const assetFields = [
  ['logo', 'Logo', 'LOGO'],
  ['darkLogo', 'Dark logo', 'DARK_LOGO'],
  ['favicon', 'Favicon', 'FAVICON'],
  ['loginBackground', 'Login background', 'LOGIN_BACKGROUND'],
] as const;

const emptyDraft = {
  appName: '',
  companyName: '',
  primaryColor: '',
  accentColor: '',
  supportEmail: '',
  supportUrl: '',
  footerText: '',
  metaDescription: '',
};

export function BrandingSettingsPanel({
  scope,
  scopeId,
}: {
  scope: AnalyticsScopeType;
  scopeId: string | null;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: brandingKeys.config(scope, scopeId),
    queryFn: () => getBrandingConfig(scope, scopeId as string),
    enabled: Boolean(scopeId),
  });
  const [draft, setDraft] = useState(emptyDraft);
  const [assetDraft, setAssetDraft] = useState<
    Record<string, { assetId: string; workspaceId: string }>
  >({});
  const [agencyPolicy, setAgencyPolicy] = useState<BrandingFieldKey[]>([]);
  const [workspacePolicy, setWorkspacePolicy] = useState<BrandingFieldKey[]>([]);

  useEffect(() => {
    const config = query.data;
    if (!config) return;
    const overrides = config.overrides as Record<string, unknown>;
    setDraft({
      appName: stringValue(overrides.appName),
      companyName: stringValue(overrides.companyName),
      primaryColor: stringValue(overrides.primaryColor),
      accentColor: stringValue(overrides.accentColor),
      supportEmail: stringValue(overrides.supportEmail),
      supportUrl: stringValue(overrides.supportUrl),
      footerText: stringValue(overrides.footerText),
      metaDescription: stringValue(overrides.metaDescription),
    });
    const nextAssets: Record<string, { assetId: string; workspaceId: string }> = {};
    for (const [property] of assetFields) {
      const value = overrides[property];
      nextAssets[property] = assetValue(value);
    }
    setAssetDraft(nextAssets);
    setAgencyPolicy(config.agencyAllowedOverrides);
    setWorkspacePolicy(config.workspaceAllowedOverrides);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: UpdateBrandingConfig) =>
      updateBrandingConfig(scope, scopeId as string, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: brandingKeys.config(scope, scopeId) }),
        queryClient.invalidateQueries({ queryKey: brandingKeys.effective(scope, scopeId) }),
      ]);
    },
  });

  const effectiveBrand = useMemo(() => {
    if (!query.data) return null;
    return {
      brandName: query.data.effective.appName,
      agencyName: query.data.effective.companyName,
      logoUrl: query.data.effective.logo?.url,
      primaryColor: query.data.effective.primaryColor,
      accentColor: query.data.effective.accentColor,
    };
  }, [query.data]);

  if (!scopeId) return <EmptyState title="Select a scope" />;
  if (query.isLoading)
    return <div className="h-48 animate-pulse rounded-md bg-[hsl(var(--muted))]" />;
  if (query.isError || !query.data) return <EmptyState title="Branding unavailable" />;

  const save = () => {
    const body: UpdateBrandingConfig = {
      expectedRevision: query.data.revision,
      ...Object.fromEntries(
        Object.entries(draft).map(([key, value]) => [key, value.trim() ? value.trim() : null]),
      ),
      agencyAllowedOverrides: scope === 'SUPER_AGENCY' ? agencyPolicy : undefined,
      workspaceAllowedOverrides:
        scope === 'SUPER_AGENCY' || scope === 'AGENCY' ? workspacePolicy : undefined,
    };
    for (const [property] of assetFields) {
      const value = assetDraft[property];
      body[property] =
        value?.assetId && value.workspaceId
          ? { assetId: value.assetId.trim(), workspaceId: value.workspaceId.trim() }
          : null;
    }
    mutation.mutate(body);
  };

  const resetAll = () => {
    mutation.mutate({
      expectedRevision: query.data.revision,
      appName: null,
      companyName: null,
      logo: null,
      darkLogo: null,
      favicon: null,
      loginBackground: null,
      primaryColor: null,
      accentColor: null,
      supportEmail: null,
      supportUrl: null,
      footerText: null,
      metaDescription: null,
    });
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {effectiveBrand ? (
            <div className="flex items-center justify-between rounded-md border border-[hsl(var(--border))] p-3">
              <BrandLogo />
              <div className="flex gap-2">
                <ColorSwatch value={query.data.effective.primaryColor} />
                <ColorSwatch value={query.data.effective.accentColor} />
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral">Revision {query.data.revision}</Badge>
            <Badge variant="info">{query.data.effective.fingerprint}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand Fields</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {scalarFields.map(([key, label, fieldKey]) => (
            <div key={key} className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
              <Input
                label={`${label} (${sourceLabel(query.data.effective.sources?.[fieldKey])})`}
                value={draft[key]}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, [key]: event.target.value }))
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft((current) => ({ ...current, [key]: '' }))}
              >
                Reset
              </Button>
            </div>
          ))}
          {assetFields.map(([key, label, fieldKey]) => (
            <div key={key} className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {label} ({sourceLabel(query.data.effective.sources?.[fieldKey])})
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setAssetDraft((current) => ({
                      ...current,
                      [key]: { assetId: '', workspaceId: '' },
                    }))
                  }
                >
                  Reset
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label="Asset ID"
                  value={assetDraft[key]?.assetId ?? ''}
                  onChange={(event) =>
                    setAssetDraft((current) => ({
                      ...current,
                      [key]: {
                        ...(current[key] ?? { workspaceId: '' }),
                        assetId: event.target.value,
                      },
                    }))
                  }
                />
                <Input
                  label="Asset Workspace ID"
                  value={assetDraft[key]?.workspaceId ?? ''}
                  onChange={(event) =>
                    setAssetDraft((current) => ({
                      ...current,
                      [key]: {
                        ...(current[key] ?? { assetId: '' }),
                        workspaceId: event.target.value,
                      },
                    }))
                  }
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {scope === 'SUPER_AGENCY' || scope === 'AGENCY' ? (
        <Card>
          <CardHeader>
            <CardTitle>Override Policy</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {scope === 'SUPER_AGENCY' ? (
              <PolicyList
                title="Agency overrides"
                value={agencyPolicy}
                onChange={setAgencyPolicy}
              />
            ) : null}
            <PolicyList
              title="Workspace overrides"
              value={workspacePolicy}
              onChange={setWorkspacePolicy}
            />
          </CardContent>
        </Card>
      ) : null}

      {mutation.isError ? <EmptyState title="Branding save failed" /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={resetAll} disabled={mutation.isPending}>
          Reset All
        </Button>
        <Button type="button" onClick={save} loading={mutation.isPending}>
          Save Branding
        </Button>
      </div>
    </div>
  );
}

function PolicyList({
  onChange,
  title,
  value,
}: {
  onChange: (fields: BrandingFieldKey[]) => void;
  title: string;
  value: BrandingFieldKey[];
}) {
  const selected = new Set(value);
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {fieldOptions.map((field) => (
        <Checkbox
          key={field.key}
          checked={selected.has(field.key)}
          label={field.label}
          onCheckedChange={(checked) => {
            const next = new Set(selected);
            if (checked) next.add(field.key);
            else next.delete(field.key);
            onChange([...next]);
          }}
        />
      ))}
    </div>
  );
}

function ColorSwatch({ value }: { value: string }) {
  return (
    <span
      className="h-8 w-8 rounded-md border border-[hsl(var(--border))]"
      style={{ backgroundColor: value }}
    />
  );
}

function sourceLabel(value: string | undefined) {
  return value ? value.replace(/_/g, ' ') : 'INHERITED';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function assetValue(value: unknown) {
  if (!value || typeof value !== 'object') return { assetId: '', workspaceId: '' };
  const record = value as Record<string, unknown>;
  return {
    assetId: stringValue(record.assetId),
    workspaceId: stringValue(record.workspaceId),
  };
}
