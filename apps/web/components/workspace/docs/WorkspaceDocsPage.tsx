'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@zea-play/api-client';
import {
  Bold,
  Code,
  FileText,
  FolderPlus,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MessageSquare,
  RotateCcw,
  Save,
  Share2,
  Star,
  Table2,
  Underline as UnderlineIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useSessionStore } from '../../../stores/session';
import {
  createDocComment,
  createDocFolder,
  createDocShare,
  createWorkspaceDoc,
  getWorkspaceDoc,
  listDocComments,
  listDocFolders,
  listWorkspaceDocs,
  updateWorkspaceDoc,
  workspaceDocKeys,
  type DocVisibility,
  type WorkspaceDoc,
} from '../../../services/workspace-docs';

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
export function WorkspaceDocsPage() {
  const queryClient = useQueryClient();
  const { accessToken, selectedWorkspaceId, hydrated, hydrate } = useSessionStore();
  const [search, setSearch] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<DocVisibility>('WORKSPACE');
  const [revision, setRevision] = useState(1);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'conflict'>(
    'idle',
  );
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const contextRef = useRef({ workspaceId: selectedWorkspaceId, docId: selectedDocId });

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    contextRef.current = { workspaceId: selectedWorkspaceId, docId: selectedDocId };
  }, [selectedWorkspaceId, selectedDocId]);

  useEffect(() => {
    setSelectedDocId(null);
    setTitle('');
    setRevision(1);
    setSaveState('idle');
    editor?.commands.setContent(emptyDoc, false);
  }, [selectedWorkspaceId]);

  const listParams = useMemo(
    () => ({ search, status: 'ACTIVE' as const, page: 1, pageSize: 100 }),
    [search],
  );
  const docsQuery = useQuery({
    queryKey: workspaceDocKeys.list(selectedWorkspaceId, listParams),
    queryFn: () => listWorkspaceDocs(selectedWorkspaceId as string, listParams),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const foldersQuery = useQuery({
    queryKey: workspaceDocKeys.folders(selectedWorkspaceId),
    queryFn: () => listDocFolders(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const detailQuery = useQuery({
    queryKey: workspaceDocKeys.detail(selectedWorkspaceId, selectedDocId),
    queryFn: () => getWorkspaceDoc(selectedWorkspaceId as string, selectedDocId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && selectedDocId),
  });
  const commentsQuery = useQuery({
    queryKey: workspaceDocKeys.comments(selectedWorkspaceId, selectedDocId),
    queryFn: () => listDocComments(selectedWorkspaceId as string, selectedDocId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && selectedDocId),
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        protocols: ['http', 'https', 'mailto'],
        validate: (href) => !/^javascript:/i.test(href),
      }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: 'Start writing...' }),
    ],
    content: emptyDoc,
    onUpdate: () => {
      if (selectedDocId) setSaveState('dirty');
    },
  });

  useEffect(() => {
    const doc = detailQuery.data;
    if (!doc || !editor) return;
    setTitle(doc.title);
    setVisibility(doc.visibility);
    setRevision(doc.contentRevision);
    editor.commands.setContent(doc.content ?? emptyDoc, false);
    setSaveState('saved');
  }, [detailQuery.data?.id, detailQuery.data?.contentRevision, editor]);

  const createDocMutation = useMutation({
    mutationFn: () =>
      createWorkspaceDoc(selectedWorkspaceId as string, {
        title: 'Untitled Doc',
        content: emptyDoc,
        visibility: 'PRIVATE',
      }),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: workspaceDocKeys.all(selectedWorkspaceId) });
      setSelectedDocId(doc.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveMutation = useMutation({
    mutationFn: ({
      workspaceId,
      docId,
      expectedRevision,
      nextTitle,
      content,
      nextVisibility,
    }: {
      workspaceId: string;
      docId: string;
      expectedRevision: number;
      nextTitle: string;
      content: Record<string, unknown>;
      nextVisibility: DocVisibility;
    }) =>
      updateWorkspaceDoc(workspaceId, docId, {
        expectedRevision,
        title: nextTitle,
        content,
        visibility: nextVisibility,
      }),
    onSuccess: (doc, variables) => {
      if (
        contextRef.current.workspaceId !== variables.workspaceId ||
        contextRef.current.docId !== variables.docId
      ) {
        return;
      }
      setRevision(doc.contentRevision);
      setSaveState('saved');
      void queryClient.invalidateQueries({ queryKey: workspaceDocKeys.all(variables.workspaceId) });
      queryClient.setQueryData(
        workspaceDocKeys.detail(variables.workspaceId, variables.docId),
        doc,
      );
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.body.code === 'DOC_VERSION_CONFLICT') {
        setSaveState('conflict');
        return;
      }
      setSaveState('dirty');
      toast.error(errorMessage(error));
    },
  });
  const folderMutation = useMutation({
    mutationFn: () => createDocFolder(selectedWorkspaceId as string, { name: newFolderName }),
    onSuccess: () => {
      setFolderDialogOpen(false);
      setNewFolderName('');
      void queryClient.invalidateQueries({
        queryKey: workspaceDocKeys.folders(selectedWorkspaceId),
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const shareMutation = useMutation({
    mutationFn: () =>
      createDocShare(selectedWorkspaceId as string, selectedDocId as string, {
        password: sharePassword || null,
      }),
    onSuccess: (share) => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setShareUrl(`${origin}${share.url}`);
      setSharePassword('');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const commentMutation = useMutation({
    mutationFn: () =>
      createDocComment(selectedWorkspaceId as string, selectedDocId as string, commentBody),
    onSuccess: () => {
      setCommentBody('');
      void queryClient.invalidateQueries({
        queryKey: workspaceDocKeys.comments(selectedWorkspaceId, selectedDocId),
      });
    },
  });

  useEffect(() => {
    if (!editor || !selectedWorkspaceId || !selectedDocId || saveState !== 'dirty') return;
    const workspaceId = selectedWorkspaceId;
    const docId = selectedDocId;
    const timer = window.setTimeout(() => {
      if (contextRef.current.workspaceId !== workspaceId || contextRef.current.docId !== docId) {
        return;
      }
      setSaveState('saving');
      saveMutation.mutate({
        workspaceId,
        docId,
        expectedRevision: revision,
        nextTitle: title,
        content: editor.getJSON() as Record<string, unknown>,
        nextVisibility: visibility,
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [editor, saveState, selectedWorkspaceId, selectedDocId, revision, title, visibility]);

  if (!hydrated)
    return (
      <DocsShell>
        <Skeleton className="h-40 rounded-md" />
      </DocsShell>
    );
  if (!accessToken || !selectedWorkspaceId) {
    return (
      <DocsShell>
        <EmptyState title="No Workspace" description="Select a Workspace to open Docs." />
      </DocsShell>
    );
  }

  const docs = docsQuery.data?.items ?? [];
  const templates = docs.filter((doc) => doc.type === 'TEMPLATE');
  const favorites = docs.filter((doc) => doc.favorite);

  return (
    <DocsShell>
      <div className="grid min-h-[calc(100vh-9rem)] grid-cols-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)_19rem]">
        <aside className="rounded-md border border-border bg-card">
          <div className="grid gap-3 border-b border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">Workspace</p>
                <h1 className="text-xl font-semibold tracking-normal">Docs</h1>
              </div>
              <Button type="button" onClick={() => createDocMutation.mutate()}>
                <FileText className="h-4 w-4" />
                New
              </Button>
            </div>
            <Input
              value={search}
              placeholder="Search docs"
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setFolderDialogOpen(true)}>
                <FolderPlus className="h-4 w-4" />
                Folder
              </Button>
            </div>
          </div>
          <DocSection
            title="Favorites"
            docs={favorites}
            selectedDocId={selectedDocId}
            onSelect={setSelectedDocId}
          />
          <DocSection
            title="Pages"
            docs={docs.filter((doc) => doc.type === 'PAGE')}
            selectedDocId={selectedDocId}
            onSelect={setSelectedDocId}
          />
          <DocSection
            title="Templates"
            docs={templates}
            selectedDocId={selectedDocId}
            onSelect={setSelectedDocId}
          />
          {foldersQuery.data?.length ? (
            <div className="border-t border-border p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Folders</p>
              <div className="grid gap-1">
                {foldersQuery.data.map((folder) => (
                  <div
                    key={folder.id}
                    className="truncate rounded-md px-2 py-1 text-sm text-muted-foreground"
                  >
                    {folder.name}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <main className="min-w-0 rounded-md border border-border bg-card">
          {selectedDocId ? (
            <>
              <header className="grid gap-3 border-b border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Input
                    className="max-w-2xl text-lg font-semibold"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setSaveState('dirty');
                    }}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={saveState === 'conflict' ? 'danger' : 'neutral'}>
                      {saveState === 'dirty'
                        ? 'Unsaved'
                        : saveState === 'saving'
                          ? 'Saving'
                          : saveState === 'conflict'
                            ? 'Conflict'
                            : 'Saved'}
                    </Badge>
                    <Select
                      value={visibility}
                      onValueChange={(value) => {
                        setVisibility(value as DocVisibility);
                        setSaveState('dirty');
                      }}
                    >
                      <SelectTrigger className="w-44" label="Visibility">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PRIVATE">Private</SelectItem>
                        <SelectItem value="SELECTED_MEMBERS">Selected</SelectItem>
                        <SelectItem value="WORKSPACE">Workspace</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShareDialogOpen(true)}
                    >
                      <Share2 className="h-4 w-4" />
                      Share
                    </Button>
                  </div>
                </div>
                <Toolbar editor={editor} />
                {saveState === 'conflict' ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    This doc changed elsewhere. Copy your current draft, then reload the latest
                    revision.
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            JSON.stringify(editor?.getJSON() ?? emptyDoc, null, 2),
                          )
                        }
                      >
                        Copy draft JSON
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          void detailQuery.refetch();
                          setSaveState('saved');
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reload latest
                      </Button>
                    </div>
                  </div>
                ) : null}
              </header>
              <EditorContent
                editor={editor}
                className="min-h-[34rem] max-w-none p-5 text-sm leading-7 outline-none [&_.ProseMirror]:min-h-[32rem] [&_.ProseMirror]:outline-none [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-3xl [&_h2]:text-2xl [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2"
              />
            </>
          ) : (
            <EmptyState title="No Doc Selected" description="Create or select a Doc to begin." />
          )}
        </main>

        <aside className="rounded-md border border-border bg-card p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Comments</h2>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </div>
          {selectedDocId ? (
            <div className="grid gap-3">
              <Textarea
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
              />
              <Button
                type="button"
                disabled={!commentBody.trim()}
                onClick={() => commentMutation.mutate()}
              >
                Comment
              </Button>
              <div className="grid gap-2">
                {(commentsQuery.data ?? []).map((comment) => (
                  <article key={comment.id} className="rounded-md border border-border p-2 text-sm">
                    <p className="font-medium">
                      {comment.createdByMembership.user.name ??
                        comment.createdByMembership.user.email}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{comment.body}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select a Doc.</p>
          )}
        </aside>
      </div>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <Input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} />
          <DialogFooter>
            <Button
              type="button"
              disabled={!newFolderName.trim()}
              onClick={() => folderMutation.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Public Share</DialogTitle>
          </DialogHeader>
          <Input
            value={sharePassword}
            type="password"
            placeholder="Optional password"
            onChange={(event) => setSharePassword(event.target.value)}
          />
          {shareUrl ? <Input readOnly value={shareUrl} /> : null}
          <DialogFooter>
            <Button type="button" disabled={!selectedDocId} onClick={() => shareMutation.mutate()}>
              <Share2 className="h-4 w-4" />
              Create link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DocsShell>
  );
}

function DocsShell({ children }: { children: React.ReactNode }) {
  return <section className="grid gap-4 p-4">{children}</section>;
}

function DocSection({
  title,
  docs,
  selectedDocId,
  onSelect,
}: {
  title: string;
  docs: WorkspaceDoc[];
  selectedDocId: string | null;
  onSelect: (docId: string) => void;
}) {
  return (
    <div className="border-t border-border p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      {docs.length ? (
        <div className="grid gap-1">
          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={`flex min-h-10 items-center justify-between gap-2 rounded-md px-2 text-left text-sm ${
                selectedDocId === doc.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
              onClick={() => onSelect(doc.id)}
            >
              <span className="min-w-0 truncate">{doc.title}</span>
              {doc.favorite ? <Star className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">None</p>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap gap-1">
      <ToolButton label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolButton>
      <ToolButton label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolButton>
      <ToolButton label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon />
      </ToolButton>
      <ToolButton label="Code" onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code />
      </ToolButton>
      <ToolButton
        label="Heading 1"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 />
      </ToolButton>
      <ToolButton
        label="Heading 2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolButton>
      <ToolButton
        label="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolButton>
      <ToolButton
        label="Ordered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolButton>
      <ToolButton label="Checklist" onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <Save />
      </ToolButton>
      <ToolButton
        label="Table"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <Table2 />
      </ToolButton>
      <ToolButton
        label="Link"
        onClick={() => {
          const href = window.prompt('URL');
          if (href && !/^javascript:/i.test(href)) editor.chain().focus().setLink({ href }).run();
        }}
      >
        <LinkIcon />
      </ToolButton>
      <ToolButton
        label="Image"
        onClick={() => {
          const src = window.prompt('Image URL');
          if (src && /^https?:\/\//i.test(src)) editor.chain().focus().setImage({ src }).run();
        }}
      >
        <ImageIcon />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{children}</span>
    </Button>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.body.code || error.body.message;
  if (error instanceof Error) return error.message;
  return 'Action failed';
}
