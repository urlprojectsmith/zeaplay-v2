'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, EmptyState, Input, Skeleton } from '@zea-play/ui';
import { FileText, Search } from 'lucide-react';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';
import { useSessionStore } from '../../../stores/session';
import {
  listAgencyParentDocs,
  listSuperAgencyParentDocs,
  parentDocKeys,
  type ParentDoc,
} from '../../../services/workspace-docs';

const pageSize = 25;

export function AgencyDocsOversightPage() {
  const { accessToken, selectedAgencyId, agencies } = useSessionStore();
  const selectedAgency = agencies.find((agency) => agency.id === selectedAgencyId);
  return (
    <ParentDocsOversightPage
      scope="agency"
      scopeId={selectedAgencyId}
      enabled={Boolean(accessToken && selectedAgencyId)}
      title="Docs Oversight"
      description={
        selectedAgency
          ? `${selectedAgency.name} Workspace-visible Docs`
          : 'Select an Agency to review Workspace-visible Docs.'
      }
    />
  );
}

export function SuperAgencyDocsOversightPage() {
  const { accessToken, selectedSuperAgencyId, superAgencies } = useSessionStore();
  const selectedSuperAgency = superAgencies.find((item) => item.id === selectedSuperAgencyId);
  return (
    <ParentDocsOversightPage
      scope="super-agency"
      scopeId={selectedSuperAgencyId}
      enabled={Boolean(accessToken && selectedSuperAgencyId)}
      title="Docs Oversight"
      description={
        selectedSuperAgency
          ? `${selectedSuperAgency.name} descendant Workspace Docs`
          : 'Select a Super Agency to review descendant Workspace-visible Docs.'
      }
    />
  );
}

function ParentDocsOversightPage({
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
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const params = useMemo(() => ({ search, page, pageSize }), [search, page]);
  const docsQuery = useQuery({
    queryKey:
      scope === 'agency'
        ? parentDocKeys.agency(scopeId, params)
        : parentDocKeys.superAgency(scopeId, params),
    queryFn: () =>
      scope === 'agency'
        ? listAgencyParentDocs(scopeId as string, params)
        : listSuperAgencyParentDocs(scopeId as string, params),
    enabled,
  });
  const docs = docsQuery.data?.items ?? [];
  const selectedDoc = docs.find((doc) => doc.id === selectedDocId) ?? docs[0] ?? null;
  const total = docsQuery.data?.total ?? 0;

  useEffect(() => {
    setSelectedDocId(null);
    setPage(1);
  }, [scopeId]);

  useEffect(() => {
    if (selectedDocId && !docs.some((doc) => doc.id === selectedDocId)) setSelectedDocId(null);
  }, [docs, selectedDocId]);

  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      {!enabled ? (
        <EmptyState title="No Parent Scope" description="Select a parent tenant to review Docs." />
      ) : (
        <section className="grid min-h-[calc(100vh-12rem)] grid-cols-1 gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <aside className="rounded-md border border-border bg-card">
            <div className="grid gap-3 border-b border-border p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  aria-label="Search Docs"
                  placeholder="Search Docs"
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <p className="text-sm text-muted-foreground">{total} Workspace-visible Docs</p>
            </div>
            {docsQuery.isLoading ? (
              <div className="grid gap-2 p-3">
                <Skeleton className="h-12 rounded-md" />
                <Skeleton className="h-12 rounded-md" />
                <Skeleton className="h-12 rounded-md" />
              </div>
            ) : docs.length ? (
              <div className="grid gap-1 p-3">
                {docs.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className={`min-h-16 rounded-md px-3 py-2 text-left text-sm ${
                      selectedDoc?.id === doc.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedDocId(doc.id)}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <FileText className="h-4 w-4" />
                      <span className="min-w-0 truncate">{doc.title}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs opacity-80">
                      {doc.workspace.name} - {doc.workspace.agency.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="No Docs" description="No parent-readable Docs were found." />
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
            {selectedDoc ? <ParentDocDetail doc={selectedDoc} /> : null}
          </main>
        </section>
      )}
    </PageContainer>
  );
}

function ParentDocDetail({ doc }: { doc: ParentDoc }) {
  return (
    <article className="grid gap-4">
      <header className="grid gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {doc.workspace.name} - {doc.workspace.agency.name}
            </p>
            <h2 className="text-2xl font-semibold tracking-normal">{doc.title}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral">{doc.visibility}</Badge>
            <Badge variant="neutral">{doc.status}</Badge>
            <Badge variant="neutral">{doc.type}</Badge>
          </div>
        </div>
        <dl className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
          <div>
            <dt className="font-medium text-foreground">Author</dt>
            <dd>{displayAuthor(doc)}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Updated</dt>
            <dd>{new Date(doc.updatedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Revision</dt>
            <dd>{doc.contentRevision}</dd>
          </div>
        </dl>
      </header>
      <section
        aria-label="Read-only Doc preview"
        className="max-w-4xl whitespace-pre-wrap text-sm leading-7"
      >
        {extractPreviewText(doc.content) || 'This Doc has no text content.'}
      </section>
    </article>
  );
}

function displayAuthor(doc: ParentDoc) {
  const user = doc.createdByMembership?.user;
  return user?.name ?? user?.email ?? 'Unknown';
}

function extractPreviewText(value: unknown): string {
  const lines: string[] = [];
  visitContent(value, lines);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 8000);
}

function visitContent(value: unknown, lines: string[]) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitContent(item, lines));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') lines.push(record.text);
  if (Array.isArray(record.content)) visitContent(record.content, lines);
}
