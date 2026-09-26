'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Input, Skeleton } from '@zea-play/ui';
import { ClipboardList, Search } from 'lucide-react';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';
import { useSessionStore } from '../../../stores/session';
import {
  listAgencyParentForms,
  listSuperAgencyParentForms,
  parentFormKeys,
  type ParentForm,
} from '../../../services/workspace-forms';

const pageSize = 25;

export function AgencyFormsOversightPage() {
  const { accessToken, selectedAgencyId, agencies } = useSessionStore();
  const selectedAgency = agencies.find((agency) => agency.id === selectedAgencyId);
  return (
    <ParentFormsOversightPage
      scope="agency"
      scopeId={selectedAgencyId}
      enabled={Boolean(accessToken && selectedAgencyId)}
      title="Forms Oversight"
      description={
        selectedAgency
          ? `${selectedAgency.name} Workspace Forms metadata`
          : 'Select an Agency to review Workspace Forms metadata.'
      }
    />
  );
}

export function SuperAgencyFormsOversightPage() {
  const { accessToken, selectedSuperAgencyId, superAgencies } = useSessionStore();
  const selectedSuperAgency = superAgencies.find((item) => item.id === selectedSuperAgencyId);
  return (
    <ParentFormsOversightPage
      scope="super-agency"
      scopeId={selectedSuperAgencyId}
      enabled={Boolean(accessToken && selectedSuperAgencyId)}
      title="Forms Oversight"
      description={
        selectedSuperAgency
          ? `${selectedSuperAgency.name} descendant Workspace Forms metadata`
          : 'Select a Super Agency to review descendant Workspace Forms metadata.'
      }
    />
  );
}

function ParentFormsOversightPage({
  scope,
  scopeId,
  enabled,
  title,
  description,
}: {
  scope: 'agency' | 'super-agency';
  scopeId: string | null;
  enabled: boolean;
  title: string;
  description: string;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const params = useMemo(() => ({ search, page, pageSize }), [search, page]);
  const formsQuery = useQuery({
    queryKey:
      scope === 'agency'
        ? parentFormKeys.agency(scopeId, params)
        : parentFormKeys.superAgency(scopeId, params),
    queryFn: () =>
      scope === 'agency'
        ? listAgencyParentForms(scopeId as string, params)
        : listSuperAgencyParentForms(scopeId as string, params),
    enabled,
  });
  const forms = formsQuery.data?.items ?? [];
  const selectedForm = forms.find((form) => form.id === selectedFormId) ?? forms[0] ?? null;
  const total = formsQuery.data?.total ?? 0;

  useEffect(() => {
    setSelectedFormId(null);
    setPage(1);
  }, [scopeId]);

  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      {!enabled ? (
        <EmptyState title="No Parent Scope" description="Select a parent tenant to review Forms." />
      ) : (
        <section className="grid min-h-[calc(100vh-12rem)] grid-cols-1 gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <aside className="rounded-md border border-border bg-card">
            <div className="grid gap-3 border-b border-border p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  aria-label="Search Forms"
                  placeholder="Search Forms"
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <p className="text-sm text-muted-foreground">{total} Forms</p>
            </div>
            {formsQuery.isLoading ? (
              <div className="grid gap-2 p-3">
                <Skeleton className="h-12 rounded-md" />
                <Skeleton className="h-12 rounded-md" />
              </div>
            ) : forms.length ? (
              <div className="grid gap-1 p-3">
                {forms.map((form) => (
                  <button
                    key={form.id}
                    type="button"
                    className={`min-h-16 rounded-md px-3 py-2 text-left text-sm ${
                      selectedForm?.id === form.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedFormId(form.id)}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <ClipboardList className="h-4 w-4" />
                      <span className="min-w-0 truncate">{form.title}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs opacity-80">
                      {form.workspace.name} - {form.workspace.agency.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="No Forms" description="No parent-readable Forms were found." />
            )}
            <div className="flex items-center justify-between border-t border-border p-3">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">Page {page}</span>
              <Button
                type="button"
                variant="outline"
                disabled={page * pageSize >= total}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </aside>
          <main className="min-w-0 rounded-md border border-border bg-card p-4">
            {selectedForm ? <ParentFormDetail form={selectedForm} /> : null}
          </main>
        </section>
      )}
    </PageContainer>
  );
}

function ParentFormDetail({ form }: { form: ParentForm }) {
  return (
    <article className="grid gap-4">
      <header className="grid gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {form.workspace.name} - {form.workspace.agency.name}
            </p>
            <h2 className="text-2xl font-semibold tracking-normal">{form.title}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral">{form.status}</Badge>
            <Badge variant="neutral">{form.type}</Badge>
            <Badge variant="neutral">{form.publicEnabled ? 'PUBLIC' : 'INTERNAL'}</Badge>
          </div>
        </div>
        <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="font-medium text-foreground">Submissions</dt>
            <dd>{form._count?.submissions ?? 0}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Published Version</dt>
            <dd>{form.publishedVersionNumber ?? 'Draft only'}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Updated</dt>
            <dd>{new Date(form.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </header>
      <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
        {form.description ?? 'No description.'}
      </p>
    </article>
  );
}
