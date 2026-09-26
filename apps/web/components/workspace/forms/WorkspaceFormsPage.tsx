'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@zea-play/api-client';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from '@zea-play/ui';
import { ArrowDown, ArrowUp, Eye, FilePlus2, ListPlus, Send, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSessionStore } from '../../../stores/session';
import {
  createWorkspaceForm,
  emptyFormSchema,
  getWorkspaceForm,
  listFormSubmissions,
  listWorkspaceForms,
  publishWorkspaceForm,
  submitWorkspaceForm,
  updateWorkspaceFormDraft,
  workspaceFormKeys,
  type FormField,
  type FormFieldType,
  type FormSchema,
  type WorkspaceForm,
} from '../../../services/workspace-forms';

const fieldTypes: Array<{ type: FormFieldType; label: string }> = [
  { type: 'TEXT', label: 'Text' },
  { type: 'TEXTAREA', label: 'Long Text' },
  { type: 'EMAIL', label: 'Email' },
  { type: 'NUMBER', label: 'Number' },
  { type: 'DROPDOWN', label: 'Dropdown' },
  { type: 'CHECKBOX', label: 'Checkbox' },
  { type: 'FILE_UPLOAD', label: 'File' },
  { type: 'SIGNATURE', label: 'Signature' },
];

export function WorkspaceFormsPage() {
  const queryClient = useQueryClient();
  const { accessToken, selectedWorkspaceId, hydrated, hydrate } = useSessionStore();
  const [search, setSearch] = useState('');
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [schema, setSchema] = useState<FormSchema>(emptyFormSchema());
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>({});
  const [activeTab, setActiveTab] = useState<'builder' | 'preview' | 'submissions' | 'templates'>(
    'builder',
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setSelectedFormId(null);
    setDraftTitle('');
    setDraftDescription('');
    setSchema(emptyFormSchema());
    setPreviewAnswers({});
  }, [selectedWorkspaceId]);

  const listParams = useMemo(() => ({ search, page: 1, pageSize: 100 }), [search]);
  const formsQuery = useQuery({
    queryKey: workspaceFormKeys.list(selectedWorkspaceId, listParams),
    queryFn: () => listWorkspaceForms(selectedWorkspaceId as string, listParams),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const detailQuery = useQuery({
    queryKey: workspaceFormKeys.detail(selectedWorkspaceId, selectedFormId),
    queryFn: () => getWorkspaceForm(selectedWorkspaceId as string, selectedFormId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && selectedFormId),
  });
  const submissionsQuery = useQuery({
    queryKey: ['workspace', selectedWorkspaceId, 'forms', selectedFormId, 'submissions'],
    queryFn: () => listFormSubmissions(selectedWorkspaceId as string, selectedFormId as string),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && selectedFormId && activeTab === 'submissions',
    ),
  });

  useEffect(() => {
    const form = detailQuery.data;
    if (!form) return;
    const latest = form.versions?.[0];
    setDraftTitle(form.title);
    setDraftDescription(form.description ?? '');
    setSchema((latest?.schema as FormSchema | undefined) ?? emptyFormSchema());
  }, [detailQuery.data?.id, detailQuery.data?.updatedAt]);

  const createMutation = useMutation({
    mutationFn: () => createWorkspaceForm(selectedWorkspaceId as string, {}),
    onSuccess: (form) => {
      setSelectedFormId(form.id);
      void queryClient.invalidateQueries({ queryKey: workspaceFormKeys.all(selectedWorkspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveMutation = useMutation({
    mutationFn: () =>
      updateWorkspaceFormDraft(selectedWorkspaceId as string, selectedFormId as string, {
        title: draftTitle,
        description: draftDescription || null,
        schema,
        settings: { successMessage: 'Thanks. Your response was submitted.' },
      }),
    onSuccess: (form) => {
      queryClient.setQueryData(workspaceFormKeys.detail(selectedWorkspaceId, form.id), form);
      void queryClient.invalidateQueries({ queryKey: workspaceFormKeys.all(selectedWorkspaceId) });
      toast.success('Draft saved');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const publishMutation = useMutation({
    mutationFn: (publicEnabled: boolean) =>
      publishWorkspaceForm(selectedWorkspaceId as string, selectedFormId as string, publicEnabled),
    onSuccess: (form) => {
      queryClient.setQueryData(workspaceFormKeys.detail(selectedWorkspaceId, form.id), form);
      void queryClient.invalidateQueries({ queryKey: workspaceFormKeys.all(selectedWorkspaceId) });
      toast.success('Form published');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const submitMutation = useMutation({
    mutationFn: () =>
      submitWorkspaceForm(selectedWorkspaceId as string, selectedFormId as string, previewAnswers),
    onSuccess: () => {
      setPreviewAnswers({});
      void submissionsQuery.refetch();
      toast.success('Submission received');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!hydrated)
    return (
      <section className="p-4">
        <Skeleton className="h-40 rounded-md" />
      </section>
    );
  if (!accessToken || !selectedWorkspaceId) {
    return (
      <section className="p-4">
        <EmptyState title="No Workspace" description="Select a Workspace to open Forms." />
      </section>
    );
  }

  const forms = formsQuery.data?.items ?? [];
  const selectedForm = detailQuery.data ?? forms.find((form) => form.id === selectedFormId) ?? null;
  const templates = forms.filter((form) => form.type === 'TEMPLATE');

  return (
    <section className="grid gap-4 p-4">
      <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 gap-4 xl:grid-cols-[21rem_minmax(0,1fr)_18rem]">
        <aside className="rounded-md border border-border bg-card">
          <div className="grid gap-3 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">Workspace</p>
                <h1 className="text-xl font-semibold tracking-normal">Forms</h1>
              </div>
              <Button type="button" onClick={() => createMutation.mutate()}>
                <FilePlus2 className="h-4 w-4" />
                New
              </Button>
            </div>
            <Input
              value={search}
              placeholder="Search forms"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <FormList
            title="Published"
            forms={forms.filter((form) => form.status === 'PUBLISHED')}
            selectedFormId={selectedFormId}
            onSelect={setSelectedFormId}
          />
          <FormList
            title="Drafts"
            forms={forms.filter((form) => form.status === 'DRAFT')}
            selectedFormId={selectedFormId}
            onSelect={setSelectedFormId}
          />
          <FormList
            title="Templates"
            forms={templates}
            selectedFormId={selectedFormId}
            onSelect={setSelectedFormId}
          />
        </aside>

        <main className="min-w-0 rounded-md border border-border bg-card">
          {selectedForm ? (
            <>
              <header className="grid gap-3 border-b border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 flex-1 gap-2">
                    <Input
                      className="max-w-3xl text-lg font-semibold"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                    />
                    <Textarea
                      value={draftDescription}
                      placeholder="Description"
                      onChange={(event) => setDraftDescription(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="neutral">{selectedForm.status}</Badge>
                    <Button type="button" variant="outline" onClick={() => saveMutation.mutate()}>
                      Save
                    </Button>
                    <Button type="button" onClick={() => publishMutation.mutate(false)}>
                      Publish
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => publishMutation.mutate(true)}
                    >
                      <Share2 className="h-4 w-4" />
                      Public
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['builder', 'preview', 'submissions', 'templates'] as const).map((tab) => (
                    <Button
                      key={tab}
                      type="button"
                      variant={activeTab === tab ? 'primary' : 'outline'}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tabLabel(tab)}
                    </Button>
                  ))}
                </div>
              </header>
              {activeTab === 'builder' ? (
                <Builder schema={schema} onChange={setSchema} />
              ) : activeTab === 'preview' ? (
                <FormRenderer
                  schema={schema}
                  answers={previewAnswers}
                  onChange={setPreviewAnswers}
                  onSubmit={() => submitMutation.mutate()}
                />
              ) : activeTab === 'submissions' ? (
                <Submissions items={submissionsQuery.data?.items ?? []} />
              ) : (
                <Templates templates={templates} />
              )}
            </>
          ) : (
            <EmptyState title="No Form Selected" description="Create or select a Form to begin." />
          )}
        </main>

        <aside className="rounded-md border border-border bg-card p-3">
          <h2 className="font-semibold">Field Palette</h2>
          <div className="mt-3 grid gap-2">
            {fieldTypes.map((item) => (
              <Button
                key={item.type}
                type="button"
                variant="outline"
                disabled={!selectedForm}
                onClick={() => setSchema((current) => addField(current, item.type))}
              >
                <ListPlus className="h-4 w-4" />
                {item.label}
              </Button>
            ))}
          </div>
          {selectedForm?.publicEnabled ? (
            <div className="mt-4 rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Public Link</p>
              <p className="mt-1 break-all text-muted-foreground">/forms/{selectedForm.publicId}</p>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function FormList({
  title,
  forms,
  selectedFormId,
  onSelect,
}: {
  title: string;
  forms: WorkspaceForm[];
  selectedFormId: string | null;
  onSelect: (formId: string) => void;
}) {
  return (
    <div className="border-t border-border p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <div className="grid gap-1">
        {forms.map((form) => (
          <button
            key={form.id}
            type="button"
            className={`min-h-12 rounded-md px-2 text-left text-sm ${
              selectedFormId === form.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
            }`}
            onClick={() => onSelect(form.id)}
          >
            <span className="block truncate font-medium">{form.title}</span>
            <span className="text-xs opacity-80">{form._count?.submissions ?? 0} submissions</span>
          </button>
        ))}
        {!forms.length ? <p className="text-sm text-muted-foreground">None</p> : null}
      </div>
    </div>
  );
}

function Builder({
  schema,
  onChange,
}: {
  schema: FormSchema;
  onChange: (schema: FormSchema) => void;
}) {
  return (
    <div className="grid gap-3 p-4">
      {schema.fields.map((field, index) => (
        <div
          key={field.id}
          className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[1fr_10rem_8rem]"
        >
          <Input
            value={field.label}
            aria-label={`${field.id} label`}
            onChange={(event) =>
              onChange(updateField(schema, index, { label: event.target.value }))
            }
          />
          <Select
            value={field.type}
            onValueChange={(value) =>
              onChange(updateField(schema, index, { type: value as FormFieldType }))
            }
          >
            <SelectTrigger label="Field type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fieldTypes.map((item) => (
                <SelectItem key={item.type} value={item.type}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onChange(moveField(schema, index, -1))}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onChange(moveField(schema, index, 1))}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onChange(removeField(schema, index))}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FormRenderer({
  schema,
  answers,
  onChange,
  onSubmit,
}: {
  schema: FormSchema;
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="grid max-w-3xl gap-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {schema.fields.map((field) => (
        <label key={field.id} className="grid gap-2 text-sm">
          <span className="font-medium">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          {field.type === 'TEXTAREA' ? (
            <Textarea
              value={inputValue(answers[field.id])}
              onChange={(event) => onChange({ ...answers, [field.id]: event.target.value })}
            />
          ) : field.type === 'CHECKBOX' ? (
            <input
              type="checkbox"
              checked={Boolean(answers[field.id])}
              onChange={(event) => onChange({ ...answers, [field.id]: event.target.checked })}
            />
          ) : (
            <Input
              type={
                field.type === 'NUMBER' || field.type === 'RATING'
                  ? 'number'
                  : field.type === 'DATE'
                    ? 'date'
                    : 'text'
              }
              value={inputValue(answers[field.id])}
              onChange={(event) => onChange({ ...answers, [field.id]: event.target.value })}
            />
          )}
        </label>
      ))}
      <Button type="submit">
        <Send className="h-4 w-4" />
        Submit
      </Button>
    </form>
  );
}

function Submissions({ items }: { items: Array<Record<string, unknown>> }) {
  return (
    <div className="grid gap-2 p-4">
      {items.map((item) => (
        <article key={String(item.id)} className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">{String(item.source)} submission</p>
          <p className="text-muted-foreground">{String(item.submittedAt)}</p>
        </article>
      ))}
      {!items.length ? (
        <EmptyState title="No Submissions" description="Submitted answers appear here." />
      ) : null}
    </div>
  );
}

function Templates({ templates }: { templates: WorkspaceForm[] }) {
  return (
    <div className="grid gap-2 p-4">
      {templates.map((template) => (
        <article key={template.id} className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">{template.title}</p>
          <p className="text-muted-foreground">{template.description ?? 'Template'}</p>
        </article>
      ))}
      {!templates.length ? (
        <EmptyState title="No Templates" description="Published form templates appear here." />
      ) : null}
    </div>
  );
}

function addField(schema: FormSchema, type: FormFieldType): FormSchema {
  const id = `${type.toLowerCase()}_${schema.fields.length + 1}`.replace(/[^a-z0-9_]/g, '_');
  const field: FormField = {
    id,
    type,
    label: fieldTypes.find((item) => item.type === type)?.label ?? type,
  };
  if (type === 'FILE_UPLOAD') {
    field.accept = ['image/png', 'image/jpeg', 'application/pdf'];
    field.maxFiles = 1;
    field.maxSizeBytes = 5 * 1024 * 1024;
  }
  if (type === 'SIGNATURE') {
    field.accept = ['image/png', 'image/webp'];
    field.maxFiles = 1;
    field.maxSizeBytes = 1024 * 1024;
  }
  return { ...schema, fields: [...schema.fields, field] };
}

function updateField(schema: FormSchema, index: number, patch: Partial<FormField>) {
  return {
    ...schema,
    fields: schema.fields.map((field, current) =>
      current === index ? { ...field, ...patch } : field,
    ),
  };
}

function moveField(schema: FormSchema, index: number, offset: number) {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= schema.fields.length) return schema;
  const fields = [...schema.fields];
  const [field] = fields.splice(index, 1);
  if (!field) return schema;
  fields.splice(nextIndex, 0, field);
  return { ...schema, fields };
}

function removeField(schema: FormSchema, index: number) {
  return { ...schema, fields: schema.fields.filter((_, current) => current !== index) };
}

function tabLabel(tab: 'builder' | 'preview' | 'submissions' | 'templates') {
  return `${tab.charAt(0).toUpperCase()}${tab.slice(1)}`;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.body.code || error.body.message;
  if (error instanceof Error) return error.message;
  return 'Action failed';
}

function inputValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
