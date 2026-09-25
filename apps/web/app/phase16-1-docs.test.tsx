import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@zea-play/api-client';
import { Providers } from '../contexts/providers';
import { messages } from '../lib/i18n';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { WorkspaceDocsPage } from '../components/workspace/docs/WorkspaceDocsPage';
import {
  AgencyDocsOversightPage,
  SuperAgencyDocsOversightPage,
} from '../components/workspace/docs/ParentDocsOversightPage';
import { useSessionStore } from '../stores/session';
import { parentDocKeys, workspaceDocKeys } from '../services/workspace-docs';

const listWorkspaceDocs = vi.fn();
const listDocFolders = vi.fn();
const getWorkspaceDoc = vi.fn();
const updateWorkspaceDoc = vi.fn();
const createWorkspaceDoc = vi.fn();
const createDocFolder = vi.fn();
const createDocShare = vi.fn();
const listDocComments = vi.fn();
const createDocComment = vi.fn();
const listAgencyParentDocs = vi.fn();
const listSuperAgencyParentDocs = vi.fn();
const toastError = vi.fn();

let editorJson: Record<string, unknown> = emptyContent('Loaded content');
const commandMocks = {
  setContent: vi.fn((content: Record<string, unknown>) => {
    editorJson = content;
    return true;
  }),
  toggleBold: vi.fn(),
  toggleItalic: vi.fn(),
  toggleUnderline: vi.fn(),
  toggleCode: vi.fn(),
  toggleHeading: vi.fn(),
  toggleBulletList: vi.fn(),
  toggleOrderedList: vi.fn(),
  toggleTaskList: vi.fn(),
  insertTable: vi.fn(),
  setLink: vi.fn(),
  setImage: vi.fn(),
  focus: vi.fn(),
  run: vi.fn(() => true),
};
const editor = {
  commands: { setContent: commandMocks.setContent },
  chain: () => ({
    focus: () => ({
      toggleBold: () => commandMocks,
      toggleItalic: () => commandMocks,
      toggleUnderline: () => commandMocks,
      toggleCode: () => commandMocks,
      toggleHeading: () => commandMocks,
      toggleBulletList: () => commandMocks,
      toggleOrderedList: () => commandMocks,
      toggleTaskList: () => commandMocks,
      insertTable: () => commandMocks,
      setLink: () => commandMocks,
      setImage: () => commandMocks,
    }),
  }),
  getJSON: () => editorJson,
};

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/docs',
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@tiptap/react', () => ({
  useEditor: () => editor,
  EditorContent: () => <div role="textbox" aria-label="Doc editor" data-testid="doc-editor" />,
}));
vi.mock('@tiptap/starter-kit', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-underline', () => ({ default: {} }));
vi.mock('@tiptap/extension-link', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-image', () => ({ default: {} }));
vi.mock('@tiptap/extension-task-list', () => ({ default: {} }));
vi.mock('@tiptap/extension-task-item', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table', () => ({ default: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-table-row', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-cell', () => ({ default: {} }));
vi.mock('@tiptap/extension-table-header', () => ({ default: {} }));
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }));

vi.mock('../services/workspace-docs', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-docs')>(
    '../services/workspace-docs',
  );
  return {
    ...actual,
    listWorkspaceDocs: (...args: unknown[]) => listWorkspaceDocs(...args),
    listDocFolders: (...args: unknown[]) => listDocFolders(...args),
    getWorkspaceDoc: (...args: unknown[]) => getWorkspaceDoc(...args),
    updateWorkspaceDoc: (...args: unknown[]) => updateWorkspaceDoc(...args),
    createWorkspaceDoc: (...args: unknown[]) => createWorkspaceDoc(...args),
    createDocFolder: (...args: unknown[]) => createDocFolder(...args),
    createDocShare: (...args: unknown[]) => createDocShare(...args),
    listDocComments: (...args: unknown[]) => listDocComments(...args),
    createDocComment: (...args: unknown[]) => createDocComment(...args),
    listAgencyParentDocs: (...args: unknown[]) => listAgencyParentDocs(...args),
    listSuperAgencyParentDocs: (...args: unknown[]) => listSuperAgencyParentDocs(...args),
  };
});

describe('Phase 16.1 Docs UI main gate', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'light';
    vi.useRealTimers();
    editorJson = emptyContent('Loaded content');
    Object.values(commandMocks).forEach((mock) => mock.mockClear());
    listWorkspaceDocs.mockReset();
    listDocFolders.mockReset();
    getWorkspaceDoc.mockReset();
    updateWorkspaceDoc.mockReset();
    createWorkspaceDoc.mockReset();
    createDocFolder.mockReset();
    createDocShare.mockReset();
    listDocComments.mockReset();
    createDocComment.mockReset();
    listAgencyParentDocs.mockReset();
    listSuperAgencyParentDocs.mockReset();
    toastError.mockReset();
    listWorkspaceDocs.mockResolvedValue({
      items: [workspaceDoc('doc-a', 'Alpha Plan', 'workspace-a')],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    listDocFolders.mockResolvedValue([{ id: 'folder-1', name: 'Specs', parentFolderId: null }]);
    getWorkspaceDoc.mockResolvedValue(workspaceDoc('doc-a', 'Alpha Plan', 'workspace-a'));
    listDocComments.mockResolvedValue([
      {
        id: 'comment-1',
        docId: 'doc-a',
        parentCommentId: null,
        body: 'Looks good',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdByMembership: {
          id: 'member-a',
          user: { id: 'user-a', name: 'Ada', email: 'a@test' },
        },
      },
    ]);
    createWorkspaceDoc.mockResolvedValue(workspaceDoc('doc-new', 'Untitled Doc', 'workspace-a'));
    createDocFolder.mockResolvedValue({ id: 'folder-new', name: 'New Folder' });
    createDocShare.mockResolvedValue({
      id: 'share-1',
      token: 'plain-token',
      url: '/docs/share/plain-token',
    });
    createDocComment.mockResolvedValue({});
    listAgencyParentDocs.mockResolvedValue({
      items: [parentDoc('doc-parent-a', 'Agency Visible Doc', 'workspace-a', 'Agency One')],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    listSuperAgencyParentDocs.mockResolvedValue({
      items: [parentDoc('doc-parent-s', 'Super Visible Doc', 'workspace-s', 'Agency One')],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    seedWorkspaceSession();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the Workspace Docs route with list, tree, editor toolbar, comments, and empty states', async () => {
    render(
      <Providers>
        <WorkspaceDocsPage />
      </Providers>,
    );

    expect(await screen.findByRole('heading', { name: 'Docs' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search docs')).toBeInTheDocument();
    expect(screen.getByText('No Doc Selected')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /alpha plan/i }));

    expect(await screen.findByDisplayValue('Alpha Plan')).toBeInTheDocument();
    expect(screen.getByTestId('doc-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument();
    expect(screen.getByText('Comments')).toBeInTheDocument();
    expect(await screen.findByText('Looks good')).toBeInTheDocument();
    expect(screen.getByText('Specs')).toBeInTheDocument();
  });

  it('autosaves deterministically through saving, saved, failure, and revision conflict states', async () => {
    const save = deferred<unknown>();
    getWorkspaceDoc
      .mockResolvedValueOnce(workspaceDoc('doc-a', 'Alpha Plan', 'workspace-a'))
      .mockResolvedValue(workspaceDoc('doc-a', 'Alpha Plan Updated', 'workspace-a', 2));
    updateWorkspaceDoc.mockReturnValueOnce(save.promise).mockRejectedValueOnce(
      new ApiClientError(409, {
        code: 'DOC_VERSION_CONFLICT',
        message: 'Conflict',
        requestId: 'req-1',
      }),
    );
    render(
      <Providers>
        <WorkspaceDocsPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /alpha plan/i }));
    await screen.findByDisplayValue('Alpha Plan');
    vi.useFakeTimers();
    fireEvent.change(screen.getByDisplayValue('Alpha Plan'), {
      target: { value: 'Alpha Plan Updated' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByText('Saving')).toBeInTheDocument();

    act(() => {
      save.resolve(workspaceDoc('doc-a', 'Alpha Plan Updated', 'workspace-a', 2));
    });
    await act(async () => Promise.resolve());
    expect(screen.getByText('Saved')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Alpha Plan Updated'), {
      target: { value: 'Alpha Conflict' },
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await act(async () => Promise.resolve());
    expect(screen.getByText('Conflict')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy draft json/i })).toBeInTheDocument();
  });

  it('keeps late Workspace tenant responses scoped to the current Workspace', async () => {
    const workspaceA = deferred<unknown>();
    const workspaceB = deferred<unknown>();
    listWorkspaceDocs.mockImplementation((workspaceId: string) =>
      workspaceId === 'workspace-a' ? workspaceA.promise : workspaceB.promise,
    );
    render(
      <Providers>
        <WorkspaceDocsPage />
      </Providers>,
    );

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-b' });
    });
    act(() => {
      workspaceB.resolve({
        items: [workspaceDoc('doc-b', 'Beta Plan', 'workspace-b')],
        page: 1,
        pageSize: 100,
        total: 1,
      });
    });
    expect(await screen.findByRole('button', { name: /beta plan/i })).toBeInTheDocument();

    act(() => {
      workspaceA.resolve({
        items: [workspaceDoc('doc-a', 'Alpha Late', 'workspace-a')],
        page: 1,
        pageSize: 100,
        total: 1,
      });
    });
    await waitFor(() => expect(screen.queryByText('Alpha Late')).not.toBeInTheDocument());
  });

  it('keeps rapid Workspace switches isolated to the final Workspace', async () => {
    const responses = {
      'workspace-a': deferred<unknown>(),
      'workspace-b': deferred<unknown>(),
      'workspace-c': deferred<unknown>(),
    };
    listWorkspaceDocs.mockImplementation(
      (workspaceId: keyof typeof responses) => responses[workspaceId].promise,
    );
    render(
      <Providers>
        <WorkspaceDocsPage />
      </Providers>,
    );

    act(() => useSessionStore.setState({ selectedWorkspaceId: 'workspace-b' }));
    act(() => useSessionStore.setState({ selectedWorkspaceId: 'workspace-c' }));
    act(() => {
      responses['workspace-c'].resolve({
        items: [workspaceDoc('doc-c', 'Charlie Final', 'workspace-c')],
        page: 1,
        pageSize: 100,
        total: 1,
      });
      responses['workspace-b'].resolve({
        items: [workspaceDoc('doc-b', 'Beta Late', 'workspace-b')],
        page: 1,
        pageSize: 100,
        total: 1,
      });
      responses['workspace-a'].resolve({
        items: [workspaceDoc('doc-a', 'Alpha Late', 'workspace-a')],
        page: 1,
        pageSize: 100,
        total: 1,
      });
    });

    expect(await screen.findByRole('button', { name: /charlie final/i })).toBeInTheDocument();
    expect(screen.queryByText('Beta Late')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha Late')).not.toBeInTheDocument();
  });

  it('keeps pending autosave and logout late responses from polluting the next context', async () => {
    const pendingSave = deferred<unknown>();
    updateWorkspaceDoc.mockReturnValueOnce(pendingSave.promise);
    render(
      <Providers>
        <WorkspaceDocsPage />
      </Providers>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /alpha plan/i }));
    await screen.findByDisplayValue('Alpha Plan');
    vi.useFakeTimers();
    fireEvent.change(screen.getByDisplayValue('Alpha Plan'), {
      target: { value: 'Alpha Draft' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByText('Saving')).toBeInTheDocument();

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-b' });
      pendingSave.resolve(workspaceDoc('doc-a', 'Alpha Draft', 'workspace-a', 2));
    });
    await act(async () => Promise.resolve());
    expect(screen.getByText('No Doc Selected')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Alpha Draft')).not.toBeInTheDocument();

    const lateList = deferred<unknown>();
    listWorkspaceDocs.mockReturnValueOnce(lateList.promise);
    act(() => {
      useSessionStore.setState({ accessToken: null, selectedWorkspaceId: null });
      lateList.resolve({
        items: [workspaceDoc('doc-a', 'Protected Late', 'workspace-a')],
        page: 1,
        pageSize: 100,
        total: 1,
      });
    });
    expect(screen.getByText('No Workspace')).toBeInTheDocument();
    expect(screen.queryByText('Protected Late')).not.toBeInTheDocument();
  });

  it('renders Agency and Super Agency oversight as read-only descendant Doc views', async () => {
    const agencyView = render(
      <Providers>
        <AgencyDocsOversightPage />
      </Providers>,
    );
    expect((await screen.findAllByText('Agency Visible Doc')).length).toBeGreaterThan(0);
    expect(screen.getByText('Parent preview text')).toBeInTheDocument();
    expect(screen.queryByText('Private Doc')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /share|comment|create link|bold/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/attachment|signed url|download/i)).not.toBeInTheDocument();

    agencyView.unmount();
    act(() => {
      useSessionStore.setState({
        selectedSuperAgencyId: 'super-agency-1',
        selectedAgencyId: null,
        selectedWorkspaceId: null,
      });
    });
    render(
      <Providers>
        <SuperAgencyDocsOversightPage />
      </Providers>,
    );
    expect((await screen.findAllByText('Super Visible Doc')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Foreign Super Agency Doc')).not.toBeInTheDocument();
    expect(listAgencyParentDocs).toHaveBeenCalledWith(
      'agency-1',
      expect.objectContaining({ page: 1, pageSize: 25 }),
    );
    expect(listSuperAgencyParentDocs).toHaveBeenCalledWith(
      'super-agency-1',
      expect.objectContaining({ page: 1, pageSize: 25 }),
    );
  });

  it('keeps Docs query keys isolated by tenant scope and same IDs', () => {
    expect(workspaceDocKeys.list('same-id', { page: 1 })).toEqual([
      'workspace',
      'same-id',
      'docs',
      'list',
      { page: 1 },
    ]);
    expect(parentDocKeys.agency('same-id', { page: 1 })).toEqual([
      'agency',
      'same-id',
      'docs',
      {
        page: 1,
        pageSize: 25,
        search: undefined,
        type: undefined,
        agencyId: undefined,
        workspaceId: undefined,
      },
    ]);
    expect(parentDocKeys.superAgency('same-id', { page: 1 })).toEqual([
      'super-agency',
      'same-id',
      'docs',
      {
        page: 1,
        pageSize: 25,
        search: undefined,
        type: undefined,
        agencyId: undefined,
        workspaceId: undefined,
      },
    ]);
  });

  it('declares parent Docs navigation, i18n labels, public noindex metadata, accessibility, and theme compatibility', async () => {
    const publicRoute = await import('./(public)/docs/share/[token]/page');
    expect(publicRoute.metadata.robots).toEqual({ index: false, follow: false });
    expect(messages.en.navigation.docs).toBe('Docs');
    expect(messages.ta.navigation.docs).toBe('ஆவணங்கள்');
    expect(dashboardConfigs.agency.groups.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/agency/docs',
          requiredPermissions: ['docs.parent.read'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/docs',
          requiredPermissions: ['docs.parent.read'],
        }),
      ]),
    );

    for (const theme of ['light', 'dark', 'colorful'] as const) {
      localStorage.setItem('zea-play-theme', theme);
      const view = render(
        <Providers>
          <WorkspaceDocsPage />
        </Providers>,
      );
      expect(await screen.findByRole('button', { name: /alpha plan/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search docs')).toBeInTheDocument();
      view.unmount();
    }
  });
});

function seedWorkspaceSession() {
  useSessionStore.setState({
    hydrated: true,
    accessToken: 'token',
    csrfToken: 'csrf-token',
    user: { id: 'user-1', email: 'owner@example.test' },
    superAgencies: [
      {
        id: 'super-agency-1',
        name: 'Super Agency',
        slug: 'super-agency',
        status: 'ACTIVE',
        role: 'OWNER',
        membershipId: 'super-member-1',
        agencies: [{ id: 'agency-1', name: 'Agency One', slug: 'agency-one', status: 'ACTIVE' }],
      },
    ],
    agencies: [
      {
        id: 'agency-1',
        name: 'Agency One',
        slug: 'agency-one',
        status: 'ACTIVE',
        role: 'ADMIN',
        membershipId: 'agency-member-1',
        workspaces: [
          {
            id: 'workspace-a',
            agencyId: 'agency-1',
            name: 'Workspace A',
            slug: 'workspace-a',
            timezone: 'UTC',
            status: 'ACTIVE',
            role: 'ADMIN',
            membershipId: 'member-a',
          },
          {
            id: 'workspace-b',
            agencyId: 'agency-1',
            name: 'Workspace B',
            slug: 'workspace-b',
            timezone: 'UTC',
            status: 'ACTIVE',
            role: 'ADMIN',
            membershipId: 'member-b',
          },
          {
            id: 'workspace-c',
            agencyId: 'agency-1',
            name: 'Workspace C',
            slug: 'workspace-c',
            timezone: 'UTC',
            status: 'ACTIVE',
            role: 'ADMIN',
            membershipId: 'member-c',
          },
        ],
      },
    ],
    selectedSuperAgencyId: null,
    selectedAgencyId: 'agency-1',
    selectedWorkspaceId: 'workspace-a',
  });
}

function workspaceDoc(id: string, title: string, workspaceId: string, revision = 1) {
  return {
    id,
    workspaceId,
    folderId: null,
    parentDocId: null,
    title,
    content: emptyContent(`${title} content`),
    contentRevision: revision,
    visibility: 'WORKSPACE',
    type: 'PAGE',
    status: 'ACTIVE',
    sortOrder: 0,
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    _count: { comments: 1, attachments: 0 },
  };
}

function parentDoc(id: string, title: string, workspaceId: string, agencyName: string) {
  return {
    ...workspaceDoc(id, title, workspaceId),
    content: emptyContent('Parent preview text'),
    createdByMembership: {
      id: 'member-author',
      user: { id: 'user-author', name: 'Author User', email: 'author@example.test' },
    },
    workspace: {
      id: workspaceId,
      name: workspaceId === 'workspace-s' ? 'Workspace S' : 'Workspace A',
      slug: workspaceId,
      agency: {
        id: 'agency-1',
        name: agencyName,
        slug: 'agency-one',
        superAgencyId: 'super-agency-1',
      },
    },
  };
}

function emptyContent(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
