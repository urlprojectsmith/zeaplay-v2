'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Skeleton,
} from '@zea-play/ui';
import { Search, Trash2 } from 'lucide-react';
import type { DashboardScope } from '../navigation/navigation-config';
import { useSessionStore } from '../../stores/session';
import type { AnalyticsScopeType } from '../../services/analytics';
import {
  clearRecentSearches,
  globalSearch,
  listRecentSearches,
  searchKeys,
  type SearchResult,
} from '../../services/search';

export function GlobalSearch({ scope }: { scope: DashboardScope }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedSuperAgencyId = useSessionStore((state) => state.selectedSuperAgencyId);
  const accessToken = useSessionStore((state) => state.accessToken);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchScope = resolveSearchScope(scope);
  const scopeId =
    searchScope === 'WORKSPACE'
      ? selectedWorkspaceId
      : searchScope === 'AGENCY'
        ? selectedAgencyId
        : searchScope === 'SUPER_AGENCY'
          ? selectedSuperAgencyId
          : searchScope === 'PLATFORM'
            ? 'platform'
            : null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const resultsQuery = useQuery({
    queryKey: searchScope && scopeId ? searchKeys.results(searchScope, scopeId, debounced) : [],
    queryFn: () =>
      globalSearch(searchScope as AnalyticsScopeType, scopeId as string, {
        q: debounced,
        pageSize: 8,
      }),
    enabled: Boolean(accessToken && open && searchScope && scopeId && debounced.length >= 2),
  });

  const recentQuery = useQuery({
    queryKey: searchScope && scopeId ? searchKeys.recent(searchScope, scopeId) : [],
    queryFn: () => listRecentSearches(searchScope as AnalyticsScopeType, scopeId as string),
    enabled: Boolean(accessToken && open && searchScope && scopeId && debounced.length < 2),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearRecentSearches(searchScope as AnalyticsScopeType, scopeId as string),
    onSuccess() {
      if (searchScope && scopeId) {
        void queryClient.invalidateQueries({ queryKey: searchKeys.recent(searchScope, scopeId) });
      }
    },
  });

  const results = resultsQuery.data?.results ?? [];
  const groupedResults = useMemo(() => groupResults(results), [results]);
  const unavailable = !searchScope || !scopeId;

  function openResult(result: SearchResult) {
    const href = typeof result.route.href === 'string' ? result.route.href : null;
    if (!href || href.startsWith('http')) return;
    setOpen(false);
    router.push(href as Parameters<typeof router.push>[0]);
  }

  return (
    <>
      <Button
        aria-label="Search"
        className="hidden min-w-64 justify-start gap-2 px-3 text-muted-foreground xl:inline-flex"
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" className="h-4 w-4" />
        <span className="truncate">Search</span>
      </Button>
      <Button
        aria-label="Search"
        className="xl:hidden"
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" className="h-5 w-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-4 py-4 sm:px-5">
            <DialogTitle>Search</DialogTitle>
          </DialogHeader>
          <div className="grid min-h-0 gap-3 overflow-y-auto p-4 sm:p-5">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                aria-label="Search query"
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {unavailable ? (
              <EmptyState title="No Scope" description="Select an authorized scope." />
            ) : debounced.length >= 2 ? (
              resultsQuery.isLoading ? (
                <SearchSkeleton />
              ) : results.length ? (
                <div className="max-h-[60dvh] overflow-auto">
                  {groupedResults.map(([type, items]) => (
                    <section key={type} className="mb-4 last:mb-0">
                      <div className="mb-2 text-xs font-medium uppercase tracking-normal text-muted-foreground">
                        {label(type)}
                      </div>
                      <div className="grid gap-2">
                        {items.map((result) => (
                          <button
                            key={result.id}
                            className="min-h-16 rounded-md border border-border bg-card px-3 py-3 text-left hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                            type="button"
                            onClick={() => openResult(result)}
                          >
                            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{result.title}</div>
                                {result.subtitle ? (
                                  <div className="truncate text-xs text-muted-foreground">
                                    {result.subtitle}
                                  </div>
                                ) : null}
                              </div>
                              <Badge variant={result.archived ? 'warning' : 'neutral'}>
                                {label(result.type)}
                              </Badge>
                            </div>
                            {result.snippet ? (
                              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                                {result.snippet}
                              </p>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <EmptyState title="No Results" description="No authorized results matched." />
              )
            ) : recentQuery.data?.length ? (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
                    Recent
                  </div>
                  <Button
                    aria-label="Clear search history"
                    size="icon"
                    type="button"
                    variant="ghost"
                    onClick={() => clearMutation.mutate()}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>
                {recentQuery.data.map((item) => (
                  <button
                    key={item.id}
                    className="min-h-11 rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary"
                    type="button"
                    onClick={() => setQuery(item.query)}
                  >
                    {item.query}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="No Recent Searches" description="Search history is empty." />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function resolveSearchScope(scope: DashboardScope): AnalyticsScopeType | null {
  if (scope === 'workspace') return 'WORKSPACE';
  if (scope === 'agency') return 'AGENCY';
  if (scope === 'super-agency') return 'SUPER_AGENCY';
  if (scope === 'super-admin') return 'PLATFORM';
  return null;
}

function groupResults(results: SearchResult[]) {
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    groups.set(result.type, [...(groups.get(result.type) ?? []), result]);
  }
  return Array.from(groups.entries());
}

function SearchSkeleton() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-20 rounded-md" />
      ))}
    </div>
  );
}

function label(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}
