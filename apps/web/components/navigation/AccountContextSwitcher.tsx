'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronsUpDown, Loader2, Search, Store } from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type React from 'react';
import { useMemo, useState } from 'react';
import { Badge, Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from '@zea-play/ui';
import {
  accountContextKeys,
  listAccountContextAgencies,
  listAccountContextSubaccounts,
} from '../../services/account-context';
import { useSessionStore } from '../../stores/session';

export function AccountContextSwitcher({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    agencies,
    selectedAgencyId,
    selectedSuperAgencyId,
    selectedWorkspaceId,
    superAgencies,
    returnToAgency,
    returnToSuperAgency,
    switchToAgency,
    switchToSuperAgency,
    switchToWorkspace,
  } = useSessionStore();

  const selectedSuperAgency =
    superAgencies.find((item) => item.id === selectedSuperAgencyId) ?? null;
  const selectedAgency = agencies.find((item) => item.id === selectedAgencyId) ?? null;
  const selectedWorkspace =
    selectedAgency?.workspaces.find((item) => item.id === selectedWorkspaceId) ?? null;
  const owningSuperAgency = selectedAgency
    ? (superAgencies.find((item) =>
        item.agencies.some((agency) => agency.id === selectedAgency.id),
      ) ?? null)
    : null;
  const current = selectedWorkspace ?? selectedAgency ?? selectedSuperAgency;
  const currentKind = selectedWorkspace
    ? 'Subaccount'
    : selectedAgency
      ? 'Agency'
      : selectedSuperAgency
        ? 'Super Agency'
        : 'Account';

  const agencyQuery = useQuery({
    queryKey: accountContextKeys.agencies(selectedSuperAgencyId, search),
    queryFn: () => listAccountContextAgencies(selectedSuperAgencyId as string, search),
    enabled: open && Boolean(selectedSuperAgencyId),
    retry: false,
  });
  const subaccountQuery = useQuery({
    queryKey: accountContextKeys.subaccounts(selectedAgencyId, search),
    queryFn: () => listAccountContextSubaccounts(selectedAgencyId as string, search),
    enabled: open && Boolean(selectedAgencyId),
    retry: false,
  });
  const filteredSuperAgencies = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return superAgencies;
    return superAgencies.filter(
      (item) => item.name.toLowerCase().includes(term) || item.slug.toLowerCase().includes(term),
    );
  }, [search, superAgencies]);
  const switching = Boolean(pendingId);

  async function runSwitch(targetId: string, callback: () => Promise<void>, href: Route) {
    setPendingId(targetId);
    setError(null);
    try {
      await callback();
      setOpen(false);
      setSearch('');
      router.replace(href);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Context switch failed.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label="Switch account context"
          className={cn(
            'h-auto w-full justify-start gap-3 border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/0.55)] px-3 py-2 text-left hover:bg-[hsl(var(--sidebar-accent))]',
            collapsed && 'aspect-square justify-center px-0',
          )}
          type="button"
          variant="ghost"
        >
          <Building2 aria-hidden="true" className="h-4 w-4 shrink-0" />
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  {currentKind}
                </span>
                <span className="block truncate text-sm font-semibold">
                  {current?.name ?? 'Select account'}
                </span>
              </span>
              <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-70" />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-[hsl(var(--border))] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{current?.name ?? 'Account context'}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{currentKind}</p>
            </div>
            <Badge variant="neutral">{currentKind}</Badge>
          </div>
          <div className="mt-3">
            <Input
              aria-label="Search accounts"
              className="pl-9"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Search
              aria-hidden="true"
              className="pointer-events-none -mt-7 ml-3 h-4 w-4 text-[hsl(var(--muted-foreground))]"
            />
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {selectedWorkspace && selectedAgency ? (
            <ContextButton
              icon={<ChevronLeft aria-hidden="true" className="h-4 w-4" />}
              label={selectedAgency.name}
              meta="Return to Agency"
              disabled={switching}
              pending={pendingId === selectedAgency.id}
              onClick={() =>
                void runSwitch(
                  selectedAgency.id,
                  () => returnToAgency(selectedAgency.id),
                  '/agency/dashboard',
                )
              }
            />
          ) : null}
          {selectedAgency && owningSuperAgency ? (
            <ContextButton
              icon={<ChevronLeft aria-hidden="true" className="h-4 w-4" />}
              label={owningSuperAgency.name}
              meta="Return to Super Agency"
              disabled={switching}
              pending={pendingId === owningSuperAgency.id}
              onClick={() =>
                void runSwitch(
                  owningSuperAgency.id,
                  () => returnToSuperAgency(owningSuperAgency.id),
                  '/super-agency',
                )
              }
            />
          ) : null}

          {selectedSuperAgencyId ? (
            <OptionSection
              empty="No agencies found."
              error={agencyQuery.error}
              loading={agencyQuery.isLoading}
            >
              {(agencyQuery.data?.items ?? []).map((agency) => (
                <ContextButton
                  key={agency.id}
                  icon={<Building2 aria-hidden="true" className="h-4 w-4" />}
                  label={agency.name}
                  meta="Agency"
                  disabled={switching}
                  pending={pendingId === agency.id}
                  onClick={() =>
                    void runSwitch(agency.id, () => switchToAgency(agency.id), '/agency/dashboard')
                  }
                />
              ))}
            </OptionSection>
          ) : null}

          {selectedAgencyId ? (
            <OptionSection
              empty="No subaccounts found."
              error={subaccountQuery.error}
              loading={subaccountQuery.isLoading}
            >
              {(subaccountQuery.data?.items ?? []).map((workspace) => (
                <ContextButton
                  key={workspace.id}
                  icon={<Store aria-hidden="true" className="h-4 w-4" />}
                  label={workspace.name}
                  meta="Subaccount"
                  disabled={switching}
                  pending={pendingId === workspace.id}
                  onClick={() =>
                    void runSwitch(
                      workspace.id,
                      () => switchToWorkspace(workspace.id, workspace.agencyId),
                      '/workspace/dashboard',
                    )
                  }
                />
              ))}
            </OptionSection>
          ) : null}

          {!selectedSuperAgencyId && !selectedAgencyId ? (
            <OptionSection empty="No Super Agencies found." error={null} loading={false}>
              {filteredSuperAgencies.map((superAgency) => (
                <ContextButton
                  key={superAgency.id}
                  icon={<Building2 aria-hidden="true" className="h-4 w-4" />}
                  label={superAgency.name}
                  meta="Super Agency"
                  disabled={switching}
                  pending={pendingId === superAgency.id}
                  onClick={() =>
                    void runSwitch(
                      superAgency.id,
                      () => switchToSuperAgency(superAgency.id),
                      '/super-agency',
                    )
                  }
                />
              ))}
            </OptionSection>
          ) : null}

          {error ? (
            <p className="px-2 py-1 text-xs font-semibold text-[hsl(var(--danger))]">{error}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OptionSection({
  children,
  empty,
  error,
  loading,
}: {
  children: React.ReactNode;
  empty: string;
  error: unknown;
  loading: boolean;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2 py-3 text-sm text-[hsl(var(--muted-foreground))]">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Loading
      </div>
    );
  }
  if (error) {
    return <p className="px-2 py-3 text-sm text-[hsl(var(--danger))]">Unable to load accounts.</p>;
  }
  if (!hasChildren) {
    return <p className="px-2 py-3 text-sm text-[hsl(var(--muted-foreground))]">{empty}</p>;
  }
  return <div className="grid gap-1">{children}</div>;
}

function ContextButton({
  icon,
  label,
  meta,
  onClick,
  pending,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
  onClick: () => void;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-[hsl(var(--muted))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[hsl(var(--muted))]">
        {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="block text-xs text-[hsl(var(--muted-foreground))]">{meta}</span>
      </span>
    </button>
  );
}
