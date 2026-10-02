'use client';

import { useState } from 'react';
import { Copy, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
} from '@zea-play/ui';
import type { AnalyticsScopeType } from '../../services/analytics';
import {
  createCustomDomain,
  customDomainKeys,
  listCustomDomains,
  removeCustomDomain,
  rotateCustomDomainToken,
  verifyCustomDomain,
  type CustomDomain,
} from '../../services/custom-domains';

export function CustomDomainSettingsPanel({
  scope,
  scopeId,
}: {
  scope: AnalyticsScopeType;
  scopeId: string | null;
}) {
  const [hostname, setHostname] = useState('');
  const [freshRecord, setFreshRecord] = useState<CustomDomain | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: customDomainKeys.list(scope, scopeId),
    queryFn: () => listCustomDomains(scope, scopeId as string),
    enabled: Boolean(scopeId) && scope !== 'PLATFORM',
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: customDomainKeys.list(scope, scopeId) });
  };
  const createMutation = useMutation({
    mutationFn: () => createCustomDomain(scope, scopeId as string, hostname),
    onSuccess: async (domain) => {
      setFreshRecord(domain);
      setHostname('');
      await invalidate();
    },
  });
  const verifyMutation = useMutation({
    mutationFn: (domain: CustomDomain) => verifyCustomDomain(scope, scopeId as string, domain.id),
    onSuccess: invalidate,
  });
  const rotateMutation = useMutation({
    mutationFn: (domain: CustomDomain) =>
      rotateCustomDomainToken(scope, scopeId as string, domain.id),
    onSuccess: async (domain) => {
      setFreshRecord(domain);
      await invalidate();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (domain: CustomDomain) => removeCustomDomain(scope, scopeId as string, domain),
    onSuccess: invalidate,
  });

  if (!scopeId) return <EmptyState title="Select a tenant scope" />;
  if (query.isLoading)
    return <div className="h-48 animate-pulse rounded-md bg-[hsl(var(--muted))]" />;
  if (query.isError || !query.data) return <EmptyState title="Custom domains unavailable" />;

  const active = query.data.items.find((domain) => !domain.removedAt) ?? null;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add Domain</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Input
            label="Domain Name"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="portal.example.com"
            disabled={Boolean(active)}
          />
          <Button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!hostname.trim() || Boolean(active)}
            loading={createMutation.isPending}
          >
            Add Domain
          </Button>
        </CardContent>
      </Card>

      {freshRecord?.txtRecordValue ? <DnsInstructions domain={freshRecord} /> : null}

      {query.data.items.length === 0 ? (
        <EmptyState title="No custom domain configured" />
      ) : (
        query.data.items.map((domain) => (
          <Card key={domain.id}>
            <CardHeader>
              <CardTitle>{domain.displayHostname ?? domain.normalizedHostname}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    domain.status === 'ACTIVE'
                      ? 'success'
                      : domain.status === 'FAILED'
                        ? 'danger'
                        : 'info'
                  }
                >
                  {statusLabel(domain.status)}
                </Badge>
                <Badge variant="neutral">Revision {domain.revision}</Badge>
                {domain.failureCode ? <Badge variant="danger">{domain.failureCode}</Badge> : null}
              </div>
              {domain.failureMessageSafe ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {domain.failureMessageSafe}
                </p>
              ) : null}
              <div className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-3">
                <span className="text-sm font-semibold">DNS Verification</span>
                <RecordRow label="TXT Record" value={domain.txtRecordName} />
                <RecordRow
                  label="Record Value"
                  value={
                    freshRecord?.id === domain.id
                      ? (freshRecord.txtRecordValue ?? '')
                      : 'Generate New Verification Record'
                  }
                />
              </div>
              <div className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-3 md:grid-cols-3">
                <StatusCell
                  label="Routing"
                  value={domain.routingVerifiedAt ? 'Verified' : 'Awaiting DNS'}
                />
                <StatusCell
                  label="SSL Certificate"
                  value={domain.sslActiveAt ? 'Active' : 'Certificate Pending'}
                />
                <StatusCell label="Provisioning" value={domain.status} />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => rotateMutation.mutate(domain)}
                  disabled={rotateMutation.isPending}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Generate New Verification Record
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => verifyMutation.mutate(domain)}
                  disabled={verifyMutation.isPending || Boolean(domain.removedAt)}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Verify Domain
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => removeMutation.mutate(domain)}
                  disabled={removeMutation.isPending || Boolean(domain.removedAt)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove Domain
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function DnsInstructions({ domain }: { domain: CustomDomain }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>DNS Verification</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <RecordRow label="Record Name" value={domain.txtRecordName} />
        <RecordRow label="Record Value" value={domain.txtRecordValue ?? ''} />
      </CardContent>
    </Card>
  );
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-[10rem_1fr_auto] md:items-center">
      <span className="text-sm font-medium">{label}</span>
      <code className="overflow-x-auto rounded bg-[hsl(var(--muted))] px-2 py-1 text-xs">
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        onClick={() => void navigator.clipboard?.writeText(value)}
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        Copy
      </Button>
    </div>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs uppercase text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}
