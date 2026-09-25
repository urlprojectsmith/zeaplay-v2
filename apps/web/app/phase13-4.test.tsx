import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/language-provider';
import { WorkspaceFilesPage } from '../components/workspace/files/WorkspaceFilesPage';
import { useSessionStore } from '../stores/session';
import {
  normalizeFileListParams,
  workspaceFileKeys,
  type WorkspaceFile,
} from '../services/workspace-files';

const listWorkspaceFiles = vi.fn();
const getWorkspaceStorageUsage = vi.fn();
const getWorkspaceFileDownloadUrl = vi.fn();
const listWorkspaceRoles = vi.fn();
const getCloudProviders = vi.fn();
const getCloudConnections = vi.fn();
const listCloudDriveFiles = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/workspace-files', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-files')>(
    '../services/workspace-files',
  );
  return {
    ...actual,
    listWorkspaceFiles: (...args: unknown[]) => listWorkspaceFiles(...args),
    getWorkspaceStorageUsage: (...args: unknown[]) => getWorkspaceStorageUsage(...args),
    getWorkspaceFileDownloadUrl: (...args: unknown[]) => getWorkspaceFileDownloadUrl(...args),
  };
});

vi.mock('../services/workspace-roles', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-roles')>(
    '../services/workspace-roles',
  );
  return {
    ...actual,
    listWorkspaceRoles: (...args: unknown[]) => listWorkspaceRoles(...args),
  };
});

vi.mock('../services/workspace-cloud-drives', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-cloud-drives')>(
    '../services/workspace-cloud-drives',
  );
  return {
    ...actual,
    getCloudProviders: (...args: unknown[]) => getCloudProviders(...args),
    getCloudConnections: (...args: unknown[]) => getCloudConnections(...args),
    listCloudDriveFiles: (...args: unknown[]) => listCloudDriveFiles(...args),
  };
});

describe('Phase 13.4 workspace file browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'user-1', email: 'user@zeaplay.test' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'agency-member-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace',
              slug: 'workspace',
              timezone: 'UTC',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'member-1',
            },
            {
              id: 'workspace-2',
              agencyId: 'agency-1',
              name: 'Workspace Two',
              slug: 'workspace-two',
              timezone: 'UTC',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'member-2',
            },
          ],
        },
      ],
    });
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-1',
        key: 'OWNER',
        name: 'Owner',
        permissions: [
          { key: 'storage.view' },
          { key: 'storage.upload' },
          { key: 'storage.download' },
          { key: 'storage.manage' },
          { key: 'storage.cloud.view' },
          { key: 'storage.cloud.import' },
          { key: 'storage.cloud.export' },
        ],
      },
    ]);
    listWorkspaceFiles.mockResolvedValue({ items: [file()], page: 1, pageSize: 25, total: 1 });
    getWorkspaceStorageUsage.mockResolvedValue({
      usedBytes: 256,
      reservedBytes: 128,
      quotaBytes: 1024,
      availableBytes: 640,
      usagePercent: 37.5,
    });
    getCloudProviders.mockResolvedValue([
      { provider: 'GOOGLE_DRIVE', available: true, status: 'AVAILABLE' },
    ]);
    getCloudConnections.mockResolvedValue([]);
    listCloudDriveFiles.mockResolvedValue({ items: [], nextCursor: null });
    getWorkspaceFileDownloadUrl.mockResolvedValue({
      downloadUrl: 'https://files.test/workspace-1/creative-brief.pdf',
      expiresInSeconds: 300,
    });
  });

  it('scopes file query keys by workspace, filters, sort, and pagination', () => {
    const params = normalizeFileListParams({
      lifecycle: 'ACTIVE',
      search: ` ${'x'.repeat(160)} `,
      sourceModule: 'PROJECT',
      category: 'PDF',
      sort: 'SIZE_DESC',
      page: 2,
      pageSize: 500,
    });

    expect(params.search).toHaveLength(150);
    expect(params.pageSize).toBe(100);
    expect(workspaceFileKeys.list('workspace-1', params)).toEqual([
      'workspace',
      'workspace-1',
      'files',
      'list',
      params,
    ]);
  });

  it('renders the file browser, quota, list/grid controls, lifecycle tabs, and cloud entry point', async () => {
    renderFiles();

    expect(await screen.findByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(await screen.findByText(/256 B used/)).toBeInTheDocument();
    expect(await screen.findByText('creative-brief.pdf')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Archived' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recently Deleted' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cloud Drives' })).toBeInTheDocument();
    expect(screen.getByText('Upload Queue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Grid View' }));
    expect(screen.getByText('creative-brief.pdf')).toBeInTheDocument();
  });

  it('clears preview signed URL state when the Workspace changes', async () => {
    renderFiles();

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(await screen.findByTitle('creative-brief.pdf')).toBeInTheDocument();
    expect(getWorkspaceFileDownloadUrl).toHaveBeenCalledWith(
      'workspace-1',
      '00000000-0000-4000-8000-000000000010',
    );

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });

    await waitFor(() => {
      expect(screen.queryByTitle('creative-brief.pdf')).not.toBeInTheDocument();
    });
  });
});

function renderFiles() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <WorkspaceFilesPage />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

function file(overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    workspaceId: 'workspace-1',
    projectId: null,
    createdById: 'user-1',
    uploadedByMembershipId: 'member-1',
    originalFilename: 'creative-brief.pdf',
    displayName: 'creative-brief.pdf',
    mimeType: 'application/pdf',
    extension: 'pdf',
    sizeBytes: 256,
    checksum: null,
    status: 'READY',
    lifecycle: 'ACTIVE',
    sourceModule: 'GENERAL',
    sourceEntityType: null,
    sourceEntityId: null,
    sourceProvider: null,
    sourceConnectionId: null,
    sourceProviderFileId: null,
    uploadedByMembership: {
      id: 'member-1',
      user: { id: 'user-1', name: 'Ada', email: 'ada@zeaplay.test' },
    },
    archivedAt: null,
    pendingDeleteAt: null,
    deleteRequestedAt: null,
    purgeAfter: null,
    purgingStartedAt: null,
    purgedAt: null,
    purgeFailureCode: null,
    purgeFailureAt: null,
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    ...overrides,
  };
}
