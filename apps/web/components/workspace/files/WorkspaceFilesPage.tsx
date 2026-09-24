'use client';

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Download,
  Eye,
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Folder,
  Grid2X2,
  Image as ImageIcon,
  Import,
  List,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ApiClientError } from '@zea-play/api-client';
import { toast } from 'sonner';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import type { Locale } from '../../../lib/i18n';
import { listWorkspaceRoles, rolesKeys } from '../../../services/workspace-roles';
import {
  cloudDriveKeys,
  exportWorkspaceFileToCloud,
  getCloudConnections,
  getCloudProviders,
  importCloudDriveFile,
  listCloudDriveFiles,
  type CloudDriveConnection,
  type CloudDriveFile,
} from '../../../services/workspace-cloud-drives';
import {
  archiveWorkspaceFile,
  bulkWorkspaceFileAction,
  completeWorkspaceFileUpload,
  getWorkspaceFileDownloadUrl,
  getWorkspaceStorageUsage,
  initWorkspaceFileUpload,
  listWorkspaceFiles,
  moveWorkspaceFileToRecentlyDeleted,
  normalizeFileListParams,
  restoreWorkspaceFile,
  workspaceFileKeys,
  type BulkFileAction,
  type FileCategory,
  type FileLifecycle,
  type FileSort,
  type FileSourceModule,
  type WorkspaceFile,
} from '../../../services/workspace-files';
import { useSessionStore } from '../../../stores/session';

type BrowserTab = 'ACTIVE' | 'ARCHIVED' | 'PENDING_DELETE' | 'CLOUD';
type ViewMode = 'LIST' | 'GRID';
type QueueStatus = 'Queued' | 'Preparing' | 'Uploading' | 'Finalizing' | 'Complete' | 'Failed';

interface UploadQueueItem {
  id: string;
  workspaceId: string;
  file: File;
  status: QueueStatus;
  progress: number;
  error: string | null;
}

const noneValue = '__none__';
const pageSize = 25;
const maxUploadConcurrency = 3;
const sourceFilters: FileSourceModule[] = ['GENERAL', 'TASK', 'PROJECT', 'TICKET'];
const categoryFilters: FileCategory[] = [
  'IMAGE',
  'PDF',
  'DOCUMENT',
  'SPREADSHEET',
  'ARCHIVE',
  'OTHER',
];
const sortOptions: FileSort[] = [
  'NEWEST',
  'OLDEST',
  'NAME_ASC',
  'NAME_DESC',
  'SIZE_ASC',
  'SIZE_DESC',
];

export function WorkspaceFilesPage() {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const { accessToken, selectedWorkspaceId, hydrated, hydrate } = useSessionStore();
  const selectedWorkspace = useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === state.selectedWorkspaceId),
  );
  const previousWorkspaceId = useRef<string | null>(null);
  const activeUploads = useRef(0);
  const [tab, setTab] = useState<BrowserTab>('ACTIVE');
  const [viewMode, setViewMode] = useState<ViewMode>('LIST');
  const [search, setSearch] = useState('');
  const [sourceModule, setSourceModule] = useState<FileSourceModule | ''>('');
  const [category, setCategory] = useState<FileCategory | ''>('');
  const [uploader, setUploader] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sort, setSort] = useState<FileSort>('NEWEST');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailsFile, setDetailsFile] = useState<WorkspaceFile | null>(null);
  const [previewFile, setPreviewFile] = useState<WorkspaceFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportFile, setExportFile] = useState<WorkspaceFile | null>(null);
  const [exportConnectionId, setExportConnectionId] = useState('');
  const [exportFolderId, setExportFolderId] = useState('');
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [cloudConnectionId, setCloudConnectionId] = useState('');
  const [cloudFolder, setCloudFolder] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: 'Root' },
  ]);
  const [cloudCursor, setCloudCursor] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (previousWorkspaceId.current === null) {
      previousWorkspaceId.current = selectedWorkspaceId;
      return;
    }
    if (previousWorkspaceId.current === selectedWorkspaceId) return;
    previousWorkspaceId.current = selectedWorkspaceId;
    setSearch('');
    setSourceModule('');
    setCategory('');
    setUploader('');
    setCreatedFrom('');
    setCreatedTo('');
    setSort('NEWEST');
    setPage(1);
    setSelectedIds([]);
    setDetailsFile(null);
    setPreviewFile(null);
    setPreviewUrl(null);
    setExportFile(null);
    setExportConnectionId('');
    setExportFolderId('');
    setQueue([]);
    setCloudConnectionId('');
    setCloudFolder([{ id: null, name: 'Root' }]);
    setCloudCursor(null);
  }, [selectedWorkspaceId]);

  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && selectedWorkspace?.role),
    staleTime: 30_000,
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find(
      (item) => item.key.toLowerCase() === selectedWorkspace?.role?.toLowerCase(),
    );
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [rolesQuery.data, selectedWorkspace?.role]);
  const canUpload = hasPermission(permissions, 'storage.upload');
  const canDownload = hasPermission(permissions, 'storage.download');
  const canManage = hasPermission(permissions, 'storage.manage');
  const canCloudView = hasPermission(permissions, 'storage.cloud.view');
  const canCloudImport = hasPermission(permissions, 'storage.cloud.import');
  const canCloudExport = hasPermission(permissions, 'storage.cloud.export');

  const lifecycle: FileLifecycle =
    tab === 'ARCHIVED' ? 'ARCHIVED' : tab === 'PENDING_DELETE' ? 'PENDING_DELETE' : 'ACTIVE';
  const fileParams = normalizeFileListParams({
    lifecycle,
    search,
    sourceModule,
    category,
    uploader,
    createdFrom: createdFrom ? new Date(`${createdFrom}T00:00:00.000Z`).toISOString() : undefined,
    createdTo: createdTo ? new Date(`${createdTo}T23:59:59.999Z`).toISOString() : undefined,
    sort,
    page,
    pageSize,
  });
  const filesQuery = useQuery({
    queryKey: workspaceFileKeys.list(selectedWorkspaceId, fileParams),
    queryFn: () => listWorkspaceFiles(selectedWorkspaceId as string, fileParams),
    enabled: Boolean(accessToken && selectedWorkspaceId && tab !== 'CLOUD'),
  });
  const usageQuery = useQuery({
    queryKey: workspaceFileKeys.usage(selectedWorkspaceId),
    queryFn: () => getWorkspaceStorageUsage(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const providersQuery = useQuery({
    queryKey: cloudDriveKeys.providers(selectedWorkspaceId),
    queryFn: () => getCloudProviders(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && tab === 'CLOUD' && canCloudView),
  });
  const connectionsQuery = useQuery({
    queryKey: cloudDriveKeys.connections(selectedWorkspaceId),
    queryFn: () => getCloudConnections(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && tab === 'CLOUD' && canCloudView),
  });
  const activeCloudConnection = (connectionsQuery.data ?? []).find(
    (connection) => connection.id === cloudConnectionId,
  );
  const currentFolderId = cloudFolder.at(-1)?.id ?? null;
  const cloudFilesQuery = useQuery({
    queryKey: cloudDriveKeys.files(
      selectedWorkspaceId,
      cloudConnectionId || null,
      currentFolderId,
      cloudCursor,
    ),
    queryFn: () =>
      listCloudDriveFiles(selectedWorkspaceId as string, cloudConnectionId, {
        folderId: currentFolderId,
        cursor: cloudCursor,
        pageSize: 50,
      }),
    enabled: Boolean(
      accessToken &&
      selectedWorkspaceId &&
      tab === 'CLOUD' &&
      canCloudView &&
      activeCloudConnection?.status === 'CONNECTED',
    ),
  });

  const invalidateFiles = (workspaceId = selectedWorkspaceId) => {
    void queryClient.invalidateQueries({ queryKey: workspaceFileKeys.all(workspaceId) });
  };
  const lifecycleMutation = useMutation({
    mutationFn: ({
      action,
      fileId,
      workspaceId,
    }: {
      action: BulkFileAction;
      fileId: string;
      workspaceId: string;
    }) => {
      if (action === 'ARCHIVE') return archiveWorkspaceFile(workspaceId, fileId);
      if (action === 'DELETE') {
        return moveWorkspaceFileToRecentlyDeleted(workspaceId, fileId);
      }
      return restoreWorkspaceFile(workspaceId, fileId);
    },
    onSuccess: (_result, variables) => {
      invalidateFiles(variables.workspaceId);
      setSelectedIds([]);
      setDetailsFile(null);
    },
    onError: (error) => toast.error(fileErrorMessage(error, locale, t)),
  });
  const bulkMutation = useMutation({
    mutationFn: ({
      action,
      fileIds,
      workspaceId,
    }: {
      action: BulkFileAction;
      fileIds: string[];
      workspaceId: string;
    }) => bulkWorkspaceFileAction(workspaceId, action, fileIds.slice(0, 50)),
    onSuccess: (result, variables) => {
      const failed = result.results.filter((item) => !item.ok).length;
      toast.success(
        failed
          ? t(locale, 'files.bulkPartial').replace('{count}', String(failed))
          : t(locale, 'files.bulkComplete'),
      );
      invalidateFiles(variables.workspaceId);
      setSelectedIds([]);
    },
    onError: (error) => toast.error(fileErrorMessage(error, locale, t)),
  });
  const cloudImportMutation = useMutation({
    mutationFn: ({ file, workspaceId }: { file: CloudDriveFile; workspaceId: string }) =>
      importCloudDriveFile(workspaceId, file.connectionId, {
        providerFileId: file.providerFileId,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (_result, variables) => {
      toast.success(t(locale, 'files.importComplete'));
      invalidateFiles(variables.workspaceId);
      void queryClient.invalidateQueries({
        queryKey: workspaceFileKeys.usage(variables.workspaceId),
      });
    },
    onError: (error) => toast.error(fileErrorMessage(error, locale, t)),
  });
  const exportMutation = useMutation({
    mutationFn: ({
      connectionId,
      destinationFolderId,
      file,
      workspaceId,
    }: {
      connectionId: string;
      destinationFolderId: string | null;
      file: WorkspaceFile;
      workspaceId: string;
    }) =>
      exportWorkspaceFileToCloud(workspaceId, connectionId, {
        assetId: file.id,
        destinationFolderId,
        filename: file.displayName,
      }),
    onSuccess: () => {
      toast.success(t(locale, 'files.exportComplete'));
      setExportFile(null);
      setExportConnectionId('');
      setExportFolderId('');
    },
    onError: (error) => toast.error(fileErrorMessage(error, locale, t)),
  });

  useEffect(() => {
    pumpUploadQueue();
  }, [queue, selectedWorkspaceId]);

  if (!hydrated) return <FileShell>{t(locale, 'common.loading')}</FileShell>;
  if (!accessToken || !selectedWorkspaceId) {
    return <FileShell>{t(locale, 'workspaceProjects.redirecting')}</FileShell>;
  }

  const files = filesQuery.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((filesQuery.data?.total ?? 0) / pageSize));
  const connectedCloudConnections = (connectionsQuery.data ?? []).filter(
    (connection) => connection.status === 'CONNECTED',
  );
  const hasFilters = Boolean(
    search.trim() || sourceModule || category || uploader || createdFrom || createdTo,
  );

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    enqueueFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    enqueueFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function enqueueFiles(filesToUpload: File[]) {
    if (!filesToUpload.length || !canUpload || !selectedWorkspaceId) return;
    setQueue((current) => [
      ...current,
      ...filesToUpload.map((file) => ({
        id: crypto.randomUUID(),
        workspaceId: selectedWorkspaceId,
        file,
        status: 'Queued' as QueueStatus,
        progress: 0,
        error: null,
      })),
    ]);
  }

  function pumpUploadQueue() {
    const queued = queue.filter((item) => item.status === 'Queued');
    const slots = maxUploadConcurrency - activeUploads.current;
    queued.slice(0, slots).forEach((item) => {
      activeUploads.current += 1;
      void runUpload(item).finally(() => {
        activeUploads.current = Math.max(0, activeUploads.current - 1);
      });
    });
  }

  async function runUpload(item: UploadQueueItem) {
    updateQueue(item.id, { status: 'Preparing', error: null, progress: 0 });
    try {
      const reservation = await initWorkspaceFileUpload(item.workspaceId, {
        filename: item.file.name,
        displayName: item.file.name,
        mimeType: item.file.type || 'application/octet-stream',
        sizeBytes: item.file.size,
        sourceModule: 'GENERAL',
      });
      updateQueue(item.id, { status: 'Uploading', progress: 1 });
      await uploadToStorage(reservation.uploadUrl, item.file, (progress) =>
        updateQueue(item.id, { progress }),
      );
      updateQueue(item.id, { status: 'Finalizing', progress: 100 });
      await completeWorkspaceFileUpload(item.workspaceId, reservation.file.id, {
        sizeBytes: item.file.size,
      });
      updateQueue(item.id, { status: 'Complete', progress: 100 });
      invalidateFiles(item.workspaceId);
      void queryClient.invalidateQueries({
        queryKey: workspaceFileKeys.usage(item.workspaceId),
      });
    } catch (error) {
      updateQueue(item.id, {
        status: 'Failed',
        error: fileErrorMessage(error, locale, t),
      });
    }
  }

  function updateQueue(id: string, patch: Partial<UploadQueueItem>) {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function downloadFile(file: WorkspaceFile, preview = false) {
    try {
      const result = await getWorkspaceFileDownloadUrl(selectedWorkspaceId as string, file.id);
      if (preview) {
        setPreviewFile(file);
        setPreviewUrl(result.downloadUrl);
        return;
      }
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(fileErrorMessage(error, locale, t));
    }
  }

  function toggleSelected(fileId: string) {
    setSelectedIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId],
    );
  }

  return (
    <FileShell>
      <div className="grid gap-5">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {t(locale, 'navigation.files')}
            </p>
            <h1 className="text-2xl font-semibold tracking-normal">{t(locale, 'files.title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <QuotaSummary usage={usageQuery.data} locale={locale} t={t} />
            {canUpload ? (
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                <Upload className="h-4 w-4" />
                {t(locale, 'files.uploadFiles')}
                <input className="sr-only" multiple type="file" onChange={selectFiles} />
              </label>
            ) : null}
          </div>
        </header>

        <Tabs value={tab} onValueChange={(value) => setTab(value as BrowserTab)}>
          <TabsList aria-label={t(locale, 'files.lifecycleTabs')}>
            <TabsTrigger value="ACTIVE">{t(locale, 'files.myWorkspace')}</TabsTrigger>
            <TabsTrigger value="ARCHIVED">{t(locale, 'files.archived')}</TabsTrigger>
            <TabsTrigger value="PENDING_DELETE">{t(locale, 'files.recentlyDeleted')}</TabsTrigger>
            <TabsTrigger value="CLOUD">{t(locale, 'files.cloudDrives')}</TabsTrigger>
          </TabsList>

          <TabsContent value="ACTIVE">
            <FileResults
              canDownload={canDownload}
              canManage={canManage}
              canCloudExport={canCloudExport}
              files={files}
              filesQuery={filesQuery}
              hasFilters={hasFilters}
              lifecycle="ACTIVE"
              locale={locale}
              page={page}
              selectedIds={selectedIds}
              setDetailsFile={setDetailsFile}
              setExportFile={setExportFile}
              setPage={setPage}
              t={t}
              toggleSelected={toggleSelected}
              totalPages={totalPages}
              viewMode={viewMode}
              onAction={(action, fileId, workspaceId) =>
                lifecycleMutation.mutate({ action, fileId, workspaceId })
              }
              onDownload={(file) => {
                void downloadFile(file);
              }}
              onPreview={(file) => {
                void downloadFile(file, true);
              }}
              toolbar={
                <FileToolbar
                  category={category}
                  createdFrom={createdFrom}
                  createdTo={createdTo}
                  locale={locale}
                  search={search}
                  setCategory={setCategory}
                  setCreatedFrom={setCreatedFrom}
                  setCreatedTo={setCreatedTo}
                  setPage={setPage}
                  setSearch={setSearch}
                  setSort={setSort}
                  setSourceModule={setSourceModule}
                  setUploader={setUploader}
                  setViewMode={setViewMode}
                  sort={sort}
                  sourceModule={sourceModule}
                  t={t}
                  uploader={uploader}
                  viewMode={viewMode}
                />
              }
            />
          </TabsContent>

          <TabsContent value="ARCHIVED">
            <FileResults
              canDownload={canDownload}
              canManage={canManage}
              canCloudExport={canCloudExport}
              files={files}
              filesQuery={filesQuery}
              hasFilters={hasFilters}
              lifecycle="ARCHIVED"
              locale={locale}
              page={page}
              selectedIds={selectedIds}
              setDetailsFile={setDetailsFile}
              setExportFile={setExportFile}
              setPage={setPage}
              t={t}
              toggleSelected={toggleSelected}
              totalPages={totalPages}
              viewMode={viewMode}
              onAction={(action, fileId, workspaceId) =>
                lifecycleMutation.mutate({ action, fileId, workspaceId })
              }
              onDownload={(file) => {
                void downloadFile(file);
              }}
              onPreview={(file) => {
                void downloadFile(file, true);
              }}
              toolbar={
                <FileToolbar
                  category={category}
                  createdFrom={createdFrom}
                  createdTo={createdTo}
                  locale={locale}
                  search={search}
                  setCategory={setCategory}
                  setCreatedFrom={setCreatedFrom}
                  setCreatedTo={setCreatedTo}
                  setPage={setPage}
                  setSearch={setSearch}
                  setSort={setSort}
                  setSourceModule={setSourceModule}
                  setUploader={setUploader}
                  setViewMode={setViewMode}
                  sort={sort}
                  sourceModule={sourceModule}
                  t={t}
                  uploader={uploader}
                  viewMode={viewMode}
                />
              }
            />
          </TabsContent>

          <TabsContent value="PENDING_DELETE">
            <FileResults
              canDownload={false}
              canManage={canManage}
              canCloudExport={false}
              files={files}
              filesQuery={filesQuery}
              hasFilters={hasFilters}
              lifecycle="PENDING_DELETE"
              locale={locale}
              page={page}
              selectedIds={selectedIds}
              setDetailsFile={setDetailsFile}
              setExportFile={setExportFile}
              setPage={setPage}
              t={t}
              toggleSelected={toggleSelected}
              totalPages={totalPages}
              viewMode={viewMode}
              onAction={(action, fileId, workspaceId) =>
                lifecycleMutation.mutate({ action, fileId, workspaceId })
              }
              onDownload={(file) => {
                void downloadFile(file);
              }}
              onPreview={(file) => {
                void downloadFile(file, true);
              }}
              toolbar={
                <FileToolbar
                  category={category}
                  createdFrom={createdFrom}
                  createdTo={createdTo}
                  locale={locale}
                  search={search}
                  setCategory={setCategory}
                  setCreatedFrom={setCreatedFrom}
                  setCreatedTo={setCreatedTo}
                  setPage={setPage}
                  setSearch={setSearch}
                  setSort={setSort}
                  setSourceModule={setSourceModule}
                  setUploader={setUploader}
                  setViewMode={setViewMode}
                  sort={sort}
                  sourceModule={sourceModule}
                  t={t}
                  uploader={uploader}
                  viewMode={viewMode}
                />
              }
            />
          </TabsContent>

          <TabsContent value="CLOUD">
            <CloudBrowser
              canCloudImport={canCloudImport}
              cloudConnectionId={cloudConnectionId}
              cloudFiles={cloudFilesQuery.data?.items ?? []}
              cloudFilesLoading={cloudFilesQuery.isLoading}
              cloudFolder={cloudFolder}
              connections={connectionsQuery.data ?? []}
              importPending={cloudImportMutation.isPending}
              locale={locale}
              nextCursor={cloudFilesQuery.data?.nextCursor ?? null}
              providers={providersQuery.data ?? []}
              setCloudConnectionId={(value) => {
                setCloudConnectionId(value);
                setCloudFolder([{ id: null, name: 'Root' }]);
                setCloudCursor(null);
              }}
              setCloudCursor={setCloudCursor}
              setCloudFolder={setCloudFolder}
              t={t}
              onImport={(file) =>
                selectedWorkspaceId &&
                cloudImportMutation.mutate({ file, workspaceId: selectedWorkspaceId })
              }
            />
          </TabsContent>
        </Tabs>

        {selectedIds.length && tab !== 'CLOUD' && canManage ? (
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card p-3 shadow-sm">
            <span className="text-sm">
              {t(locale, 'files.selectedCount').replace('{count}', String(selectedIds.length))}
            </span>
            <div className="flex flex-wrap gap-2">
              {bulkActionsFor(lifecycle).map((action) => (
                <Button
                  key={action}
                  type="button"
                  variant="secondary"
                  disabled={bulkMutation.isPending || selectedIds.length > 50}
                  onClick={() =>
                    selectedWorkspaceId &&
                    bulkMutation.mutate({
                      action,
                      fileIds: selectedIds,
                      workspaceId: selectedWorkspaceId,
                    })
                  }
                >
                  {bulkActionIcon(action)}
                  {bulkActionLabel(action, locale, t)}
                </Button>
              ))}
              <Button type="button" variant="outline" onClick={() => setSelectedIds([])}>
                <X className="h-4 w-4" />
                {t(locale, 'common.close')}
              </Button>
            </div>
          </div>
        ) : null}

        {canUpload ? (
          <UploadQueue
            locale={locale}
            queue={queue}
            remove={(id) => setQueue((current) => current.filter((item) => item.id !== id))}
            retry={(id) => updateQueue(id, { status: 'Queued', progress: 0, error: null })}
            t={t}
            onDrop={handleDrop}
            onSelect={selectFiles}
          />
        ) : null}

        <FileDetailsDialog
          canCloudExport={canCloudExport}
          canDownload={canDownload}
          canManage={canManage}
          file={detailsFile}
          locale={locale}
          setExportFile={setExportFile}
          t={t}
          onAction={(action, fileId, workspaceId) =>
            lifecycleMutation.mutate({ action, fileId, workspaceId })
          }
          onClose={() => setDetailsFile(null)}
          onDownload={(file) => {
            void downloadFile(file);
          }}
          onPreview={(file) => {
            void downloadFile(file, true);
          }}
        />
        <PreviewDialog
          file={previewFile}
          locale={locale}
          previewUrl={previewUrl}
          t={t}
          onClose={() => {
            setPreviewFile(null);
            setPreviewUrl(null);
          }}
        />
        <ExportDialog
          connections={connectedCloudConnections}
          exportConnectionId={exportConnectionId}
          exportFolderId={exportFolderId}
          file={exportFile}
          locale={locale}
          pending={exportMutation.isPending}
          setExportConnectionId={setExportConnectionId}
          setExportFolderId={setExportFolderId}
          t={t}
          onClose={() => setExportFile(null)}
          onSubmit={() =>
            exportFile &&
            exportMutation.mutate({
              connectionId: exportConnectionId,
              destinationFolderId: exportFolderId.trim() || null,
              file: exportFile,
              workspaceId: exportFile.workspaceId,
            })
          }
        />
      </div>
    </FileShell>
  );
}

function FileShell({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</main>;
}

function FileToolbar(props: {
  category: FileCategory | '';
  createdFrom: string;
  createdTo: string;
  locale: Locale;
  search: string;
  setCategory: (value: FileCategory | '') => void;
  setCreatedFrom: (value: string) => void;
  setCreatedTo: (value: string) => void;
  setPage: (value: number) => void;
  setSearch: (value: string) => void;
  setSort: (value: FileSort) => void;
  setSourceModule: (value: FileSourceModule | '') => void;
  setUploader: (value: string) => void;
  setViewMode: (value: ViewMode) => void;
  sort: FileSort;
  sourceModule: FileSourceModule | '';
  t: (locale: Locale, key: `files.${string}` | `common.${string}`) => string;
  uploader: string;
  viewMode: ViewMode;
}) {
  return (
    <section
      className="grid gap-3 md:grid-cols-6"
      aria-label={props.t(props.locale, 'files.toolbar')}
    >
      <label className="md:col-span-2">
        <span className="mb-1 block text-sm font-medium">
          {props.t(props.locale, 'files.searchFiles')}
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            maxLength={150}
            value={props.search}
            onChange={(event) => {
              props.setPage(1);
              props.setSearch(event.target.value);
            }}
          />
        </div>
      </label>
      <Select
        value={props.sourceModule || noneValue}
        onValueChange={(value) => {
          props.setPage(1);
          props.setSourceModule(value === noneValue ? '' : (value as FileSourceModule));
        }}
      >
        <SelectTrigger label={props.t(props.locale, 'files.sourceFilter')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={noneValue}>{props.t(props.locale, 'files.allSources')}</SelectItem>
          {sourceFilters.map((value) => (
            <SelectItem key={value} value={value}>
              {sourceLabel(value, props.locale, props.t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={props.category || noneValue}
        onValueChange={(value) => {
          props.setPage(1);
          props.setCategory(value === noneValue ? '' : (value as FileCategory));
        }}
      >
        <SelectTrigger label={props.t(props.locale, 'files.typeFilter')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={noneValue}>{props.t(props.locale, 'files.allTypes')}</SelectItem>
          {categoryFilters.map((value) => (
            <SelectItem key={value} value={value}>
              {categoryLabel(value, props.locale, props.t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={props.sort}
        onValueChange={(value) => {
          props.setPage(1);
          props.setSort(value as FileSort);
        }}
      >
        <SelectTrigger label={props.t(props.locale, 'files.sort')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((value) => (
            <SelectItem key={value} value={value}>
              {sortLabel(value, props.locale, props.t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-end gap-2">
        <Button
          type="button"
          variant={props.viewMode === 'LIST' ? 'primary' : 'outline'}
          aria-label={props.t(props.locale, 'files.listView')}
          onClick={() => props.setViewMode('LIST')}
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={props.viewMode === 'GRID' ? 'primary' : 'outline'}
          aria-label={props.t(props.locale, 'files.gridView')}
          onClick={() => props.setViewMode('GRID')}
        >
          <Grid2X2 className="h-4 w-4" />
        </Button>
      </div>
      <label>
        <span className="mb-1 block text-sm font-medium">
          {props.t(props.locale, 'files.uploader')}
        </span>
        <Input
          value={props.uploader}
          placeholder="Membership ID"
          onChange={(event) => {
            props.setPage(1);
            props.setUploader(event.target.value.trim());
          }}
        />
      </label>
      <label>
        <span className="mb-1 block text-sm font-medium">
          {props.t(props.locale, 'files.from')}
        </span>
        <Input
          type="date"
          value={props.createdFrom}
          onChange={(event) => {
            props.setPage(1);
            props.setCreatedFrom(event.target.value);
          }}
        />
      </label>
      <label>
        <span className="mb-1 block text-sm font-medium">{props.t(props.locale, 'files.to')}</span>
        <Input
          type="date"
          value={props.createdTo}
          onChange={(event) => {
            props.setPage(1);
            props.setCreatedTo(event.target.value);
          }}
        />
      </label>
    </section>
  );
}

function FileResults({
  canCloudExport,
  canDownload,
  canManage,
  files,
  filesQuery,
  hasFilters,
  lifecycle,
  locale,
  page,
  selectedIds,
  setDetailsFile,
  setExportFile,
  setPage,
  t,
  toggleSelected,
  toolbar,
  totalPages,
  viewMode,
  onAction,
  onDownload,
  onPreview,
}: {
  canCloudExport: boolean;
  canDownload: boolean;
  canManage: boolean;
  files: WorkspaceFile[];
  filesQuery: { isError: boolean; isLoading: boolean; refetch: () => void };
  hasFilters: boolean;
  lifecycle: FileLifecycle;
  locale: Locale;
  page: number;
  selectedIds: string[];
  setDetailsFile: (file: WorkspaceFile) => void;
  setExportFile: (file: WorkspaceFile) => void;
  setPage: (value: number) => void;
  t: (locale: Locale, key: `files.${string}` | `common.${string}`) => string;
  toggleSelected: (fileId: string) => void;
  toolbar: ReactNode;
  totalPages: number;
  viewMode: ViewMode;
  onAction: (action: BulkFileAction, fileId: string, workspaceId: string) => void;
  onDownload: (file: WorkspaceFile) => void;
  onPreview: (file: WorkspaceFile) => void;
}) {
  return (
    <div className="mt-4 grid gap-4">
      {toolbar}
      {filesQuery.isError ? (
        <EmptyState
          title={t(locale, 'files.loadFailed')}
          description={t(locale, 'files.loadFailedDescription')}
          action={
            <Button type="button" variant="secondary" onClick={() => filesQuery.refetch()}>
              {t(locale, 'common.tryAgain')}
            </Button>
          }
        />
      ) : null}
      {filesQuery.isLoading ? (
        <div
          className={
            viewMode === 'GRID' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4' : 'grid gap-2'
          }
        >
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-20 rounded-md" />
          ))}
        </div>
      ) : null}
      {!filesQuery.isLoading && !filesQuery.isError && files.length === 0 ? (
        <EmptyState
          title={hasFilters ? t(locale, 'files.noSearchResults') : emptyTitle(lifecycle, locale, t)}
          description={t(locale, 'files.emptyDescription')}
        />
      ) : null}
      {!filesQuery.isLoading && files.length > 0 ? (
        viewMode === 'GRID' ? (
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {files.map((file) => (
              <FileCard
                key={file.id}
                canCloudExport={canCloudExport}
                canDownload={canDownload}
                canManage={canManage}
                file={file}
                locale={locale}
                selected={selectedIds.includes(file.id)}
                setDetailsFile={setDetailsFile}
                setExportFile={setExportFile}
                t={t}
                toggleSelected={toggleSelected}
                onAction={onAction}
                onDownload={onDownload}
                onPreview={onPreview}
              />
            ))}
          </section>
        ) : (
          <section className="overflow-hidden rounded-md border border-border">
            <div className="hidden grid-cols-[44px_1.6fr_0.7fr_0.7fr_0.9fr_0.9fr_1fr] gap-3 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span />
              <span>{t(locale, 'files.name')}</span>
              <span>{t(locale, 'files.type')}</span>
              <span>{t(locale, 'files.size')}</span>
              <span>{t(locale, 'files.source')}</span>
              <span>{t(locale, 'files.uploadedBy')}</span>
              <span>{t(locale, 'files.actions')}</span>
            </div>
            {files.map((file) => (
              <FileRow
                key={file.id}
                canCloudExport={canCloudExport}
                canDownload={canDownload}
                canManage={canManage}
                file={file}
                locale={locale}
                selected={selectedIds.includes(file.id)}
                setDetailsFile={setDetailsFile}
                setExportFile={setExportFile}
                t={t}
                toggleSelected={toggleSelected}
                onAction={onAction}
                onDownload={onDownload}
                onPreview={onPreview}
              />
            ))}
          </section>
        )
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {t(locale, 'files.pageOf')
            .replace('{page}', String(page))
            .replace('{total}', String(totalPages))}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            {t(locale, 'files.previous')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t(locale, 'files.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileRow(props: FileItemProps) {
  const { file, locale, selected, t, toggleSelected } = props;
  return (
    <article className="grid gap-3 border-t border-border p-3 md:grid-cols-[44px_1.6fr_0.7fr_0.7fr_0.9fr_0.9fr_1fr] md:items-center">
      <label className="flex items-center gap-2">
        <input
          aria-label={`${t(locale, 'files.selectFile')} ${file.displayName}`}
          checked={selected}
          className="h-4 w-4"
          type="checkbox"
          onChange={() => toggleSelected(file.id)}
        />
        <FileIcon file={file} />
      </label>
      <button
        type="button"
        className="min-w-0 text-left"
        onClick={() => props.setDetailsFile(file)}
      >
        <span className="block truncate text-sm font-medium">{file.displayName}</span>
        <span className="text-xs text-muted-foreground">{formatDate(file.updatedAt, locale)}</span>
      </button>
      <span className="text-sm">{categoryFromMime(file.mimeType)}</span>
      <span className="text-sm">{formatBytes(file.sizeBytes)}</span>
      <span className="text-sm">{safeSource(file)}</span>
      <span className="truncate text-sm">{memberLabel(file)}</span>
      <FileActions {...props} />
    </article>
  );
}

function FileCard(props: FileItemProps) {
  const { file, locale, selected, t, toggleSelected } = props;
  return (
    <article className="grid min-h-56 gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-md bg-muted p-3">
          <FileIcon file={file} />
        </div>
        <input
          aria-label={`${t(locale, 'files.selectFile')} ${file.displayName}`}
          checked={selected}
          className="h-4 w-4"
          type="checkbox"
          onChange={() => toggleSelected(file.id)}
        />
      </div>
      <button
        type="button"
        className="min-w-0 text-left"
        onClick={() => props.setDetailsFile(file)}
      >
        <h2 className="truncate text-sm font-semibold">{file.displayName}</h2>
        <p className="text-xs text-muted-foreground">{formatBytes(file.sizeBytes)}</p>
      </button>
      <dl className="grid gap-2 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>{t(locale, 'files.type')}</dt>
          <dd>{categoryFromMime(file.mimeType)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t(locale, 'files.updated')}</dt>
          <dd>{formatDate(file.updatedAt, locale)}</dd>
        </div>
      </dl>
      <FileActions {...props} />
    </article>
  );
}

interface FileItemProps {
  canCloudExport: boolean;
  canDownload: boolean;
  canManage: boolean;
  file: WorkspaceFile;
  locale: Locale;
  selected: boolean;
  setDetailsFile: (file: WorkspaceFile) => void;
  setExportFile: (file: WorkspaceFile) => void;
  t: (locale: Locale, key: `files.${string}` | `common.${string}`) => string;
  toggleSelected: (fileId: string) => void;
  onAction: (action: BulkFileAction, fileId: string, workspaceId: string) => void;
  onDownload: (file: WorkspaceFile) => void;
  onPreview: (file: WorkspaceFile) => void;
}

function FileActions(props: FileItemProps) {
  const { canCloudExport, canDownload, canManage, file, locale, t } = props;
  const canRestore =
    canManage && (file.lifecycle === 'ARCHIVED' || file.lifecycle === 'PENDING_DELETE');
  const canArchive = canManage && file.lifecycle === 'ACTIVE';
  const canDelete = canManage && (file.lifecycle === 'ACTIVE' || file.lifecycle === 'ARCHIVED');
  const canPreview = canDownload && file.lifecycle !== 'PENDING_DELETE' && isPreviewable(file);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        aria-label={t(locale, 'files.details')}
        onClick={() => props.setDetailsFile(file)}
      >
        <Eye className="h-4 w-4" />
      </Button>
      {canDownload ? (
        <Button
          type="button"
          variant="outline"
          aria-label={t(locale, 'files.download')}
          onClick={() => props.onDownload(file)}
        >
          <Download className="h-4 w-4" />
        </Button>
      ) : null}
      {canPreview ? (
        <Button
          type="button"
          variant="outline"
          aria-label={t(locale, 'files.preview')}
          onClick={() => props.onPreview(file)}
        >
          <FileText className="h-4 w-4" />
        </Button>
      ) : null}
      {canArchive ? (
        <Button
          type="button"
          variant="outline"
          aria-label={t(locale, 'files.archive')}
          onClick={() => props.onAction('ARCHIVE', file.id, file.workspaceId)}
        >
          <Archive className="h-4 w-4" />
        </Button>
      ) : null}
      {canRestore ? (
        <Button
          type="button"
          variant="outline"
          aria-label={t(locale, 'files.restore')}
          onClick={() => props.onAction('RESTORE', file.id, file.workspaceId)}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      ) : null}
      {canDelete ? (
        <Button
          type="button"
          variant="outline"
          aria-label={t(locale, 'files.moveToDeleted')}
          onClick={() =>
            confirm(t(locale, 'files.moveConfirm')) &&
            props.onAction('DELETE', file.id, file.workspaceId)
          }
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
      {canCloudExport && file.lifecycle === 'ACTIVE' ? (
        <Button
          type="button"
          variant="outline"
          aria-label={t(locale, 'files.exportToCloud')}
          onClick={() => props.setExportFile(file)}
        >
          <Send className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function UploadQueue({
  locale,
  queue,
  remove,
  retry,
  t,
  onDrop,
  onSelect,
}: {
  locale: Locale;
  queue: UploadQueueItem[];
  remove: (id: string) => void;
  retry: (id: string) => void;
  t: (locale: Locale, key: `files.${string}` | `common.${string}`) => string;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <section
      className="grid gap-3 rounded-md border border-dashed border-border p-4"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t(locale, 'files.uploadQueue')}</h2>
          <p className="text-sm text-muted-foreground">{t(locale, 'files.dropHint')}</p>
        </div>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input px-4 text-sm font-medium">
          <Upload className="h-4 w-4" />
          {t(locale, 'files.chooseFiles')}
          <input className="sr-only" multiple type="file" onChange={onSelect} />
        </label>
      </div>
      {queue.length ? (
        <div className="grid gap-2">
          {queue.map((item) => (
            <div key={item.id} className="grid gap-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{item.file.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.status} - {formatBytes(item.file.size)}
                </span>
              </div>
              <Progress value={item.progress} aria-label={`${item.file.name} ${item.status}`} />
              {item.error ? <p className="text-sm text-destructive">{item.error}</p> : null}
              <div className="flex gap-2">
                {item.status === 'Failed' ? (
                  <Button type="button" size="sm" onClick={() => retry(item.id)}>
                    <RefreshCw className="h-4 w-4" />
                    {t(locale, 'files.retry')}
                  </Button>
                ) : null}
                {item.status === 'Failed' || item.status === 'Complete' ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => remove(item.id)}>
                    <X className="h-4 w-4" />
                    {t(locale, 'common.close')}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CloudBrowser({
  canCloudImport,
  cloudConnectionId,
  cloudFiles,
  cloudFilesLoading,
  cloudFolder,
  connections,
  importPending,
  locale,
  nextCursor,
  providers,
  setCloudConnectionId,
  setCloudCursor,
  setCloudFolder,
  t,
  onImport,
}: {
  canCloudImport: boolean;
  cloudConnectionId: string;
  cloudFiles: CloudDriveFile[];
  cloudFilesLoading: boolean;
  cloudFolder: { id: string | null; name: string }[];
  connections: CloudDriveConnection[];
  importPending: boolean;
  locale: Locale;
  nextCursor: string | null;
  providers: Array<{ provider: string; available: boolean; status: string }>;
  setCloudConnectionId: (value: string) => void;
  setCloudCursor: (value: string | null) => void;
  setCloudFolder: (value: { id: string | null; name: string }[]) => void;
  t: (
    locale: Locale,
    key: `files.${string}` | `cloudDrives.${string}` | `common.${string}`,
  ) => string;
  onImport: (file: CloudDriveFile) => void;
}) {
  const selected = connections.find((connection) => connection.id === cloudConnectionId);
  return (
    <section className="mt-4 grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Select
          value={cloudConnectionId || noneValue}
          onValueChange={(value) => setCloudConnectionId(value === noneValue ? '' : value)}
        >
          <SelectTrigger label={t(locale, 'files.cloudConnection')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{t(locale, 'files.selectConnection')}</SelectItem>
            {connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                {providerLabel(connection.provider)} -{' '}
                {connection.providerAccountLabel ?? connection.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Link
          className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold"
          href={'/workspace/settings' as Route}
        >
          {t(locale, 'files.manageConnections')}
        </Link>
      </div>
      {!connections.length ? (
        <EmptyState
          title={t(locale, 'files.noCloudDrives')}
          description={
            providers.some((provider) => provider.available)
              ? t(locale, 'files.noCloudConnections')
              : t(locale, 'files.cloudUnavailable')
          }
        />
      ) : null}
      {selected && selected.status !== 'CONNECTED' ? (
        <EmptyState
          title={t(locale, 'files.reauthRequired')}
          description={t(locale, 'files.reauthDescription')}
        />
      ) : null}
      {selected?.status === 'CONNECTED' ? (
        <>
          <nav
            className="flex flex-wrap items-center gap-2 text-sm"
            aria-label={t(locale, 'files.cloudBreadcrumbs')}
          >
            {cloudFolder.map((folder, index) => (
              <Button
                key={`${folder.id ?? 'root'}-${index}`}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCloudFolder(cloudFolder.slice(0, index + 1));
                  setCloudCursor(null);
                }}
              >
                {folder.name}
              </Button>
            ))}
          </nav>
          {cloudFilesLoading ? (
            <div className="grid gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-md" />
              ))}
            </div>
          ) : cloudFiles.length ? (
            <div className="grid gap-2 rounded-md border border-border">
              {cloudFiles.map((file) => (
                <article
                  key={file.providerFileId}
                  className="grid gap-3 border-t border-border p-3 first:border-t-0 md:grid-cols-[1.4fr_0.6fr_0.6fr_1fr] md:items-center"
                >
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    onClick={() => {
                      if (!file.isFolder) return;
                      setCloudFolder([
                        ...cloudFolder,
                        { id: file.providerFileId, name: file.name },
                      ]);
                      setCloudCursor(null);
                    }}
                  >
                    {file.isFolder ? <Folder className="h-4 w-4" /> : <File className="h-4 w-4" />}
                    <span className="truncate text-sm font-medium">{file.name}</span>
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {file.isFolder ? t(locale, 'files.folder') : formatBytes(file.sizeBytes ?? 0)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {file.modifiedAt ? formatDate(file.modifiedAt, locale) : '-'}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {file.providerWebUrl ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          window.open(file.providerWebUrl ?? '', '_blank', 'noopener,noreferrer')
                        }
                      >
                        <Eye className="h-4 w-4" />
                        {t(locale, 'files.openProvider')}
                      </Button>
                    ) : null}
                    {!file.isFolder && file.downloadable && canCloudImport ? (
                      <Button type="button" disabled={importPending} onClick={() => onImport(file)}>
                        <Import className="h-4 w-4" />
                        {t(locale, 'files.importFromCloud')}
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t(locale, 'files.noCloudFiles')}
              description={t(locale, 'files.noCloudFilesDescription')}
            />
          )}
          {nextCursor ? (
            <Button type="button" variant="outline" onClick={() => setCloudCursor(nextCursor)}>
              {t(locale, 'files.loadMore')}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function FileDetailsDialog(props: {
  canCloudExport: boolean;
  canDownload: boolean;
  canManage: boolean;
  file: WorkspaceFile | null;
  locale: Locale;
  setExportFile: (file: WorkspaceFile) => void;
  t: (locale: Locale, key: `files.${string}`) => string;
  onAction: (action: BulkFileAction, fileId: string, workspaceId: string) => void;
  onClose: () => void;
  onDownload: (file: WorkspaceFile) => void;
  onPreview: (file: WorkspaceFile) => void;
}) {
  const file = props.file;
  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.t(props.locale, 'files.details')}</DialogTitle>
          <DialogDescription>{file?.displayName}</DialogDescription>
        </DialogHeader>
        {file ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <FileFact label={props.t(props.locale, 'files.type')} value={file.mimeType} />
            <FileFact
              label={props.t(props.locale, 'files.size')}
              value={formatBytes(file.sizeBytes)}
            />
            <FileFact label={props.t(props.locale, 'files.uploadedBy')} value={memberLabel(file)} />
            <FileFact label={props.t(props.locale, 'files.lifecycle')} value={file.lifecycle} />
            <FileFact label={props.t(props.locale, 'files.source')} value={safeSource(file)} />
            <FileFact
              label={props.t(props.locale, 'files.created')}
              value={formatDate(file.createdAt, props.locale)}
            />
            {file.purgeAfter ? (
              <FileFact
                label={props.t(props.locale, 'files.purgeAfter')}
                value={formatDate(file.purgeAfter, props.locale)}
              />
            ) : null}
          </dl>
        ) : null}
        {file ? (
          <DialogFooter>
            {props.canDownload && file.lifecycle !== 'PENDING_DELETE' ? (
              <Button type="button" variant="outline" onClick={() => props.onDownload(file)}>
                <Download className="h-4 w-4" />
                {props.t(props.locale, 'files.download')}
              </Button>
            ) : null}
            {props.canDownload && isPreviewable(file) && file.lifecycle !== 'PENDING_DELETE' ? (
              <Button type="button" variant="outline" onClick={() => props.onPreview(file)}>
                <Eye className="h-4 w-4" />
                {props.t(props.locale, 'files.preview')}
              </Button>
            ) : null}
            {props.canManage && file.lifecycle === 'ACTIVE' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onAction('ARCHIVE', file.id, file.workspaceId)}
              >
                <Archive className="h-4 w-4" />
                {props.t(props.locale, 'files.archive')}
              </Button>
            ) : null}
            {props.canManage &&
            (file.lifecycle === 'ARCHIVED' || file.lifecycle === 'PENDING_DELETE') ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onAction('RESTORE', file.id, file.workspaceId)}
              >
                <RotateCcw className="h-4 w-4" />
                {props.t(props.locale, 'files.restore')}
              </Button>
            ) : null}
            {props.canCloudExport && file.lifecycle === 'ACTIVE' ? (
              <Button type="button" onClick={() => props.setExportFile(file)}>
                <Send className="h-4 w-4" />
                {props.t(props.locale, 'files.exportToCloud')}
              </Button>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({
  file,
  locale,
  previewUrl,
  t,
  onClose,
}: {
  file: WorkspaceFile | null;
  locale: Locale;
  previewUrl: string | null;
  t: (locale: Locale, key: `files.${string}`) => string;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(file && previewUrl)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'files.preview')}</DialogTitle>
          <DialogDescription>{file?.displayName}</DialogDescription>
        </DialogHeader>
        {file && previewUrl && file.mimeType.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt={file.displayName}
            className="max-h-[70vh] w-full rounded-md object-contain"
          />
        ) : file && previewUrl && file.mimeType === 'application/pdf' ? (
          <iframe
            title={file.displayName}
            src={previewUrl}
            className="h-[70vh] w-full rounded-md border border-border"
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t(locale, 'files.previewUnavailable')}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExportDialog({
  connections,
  exportConnectionId,
  exportFolderId,
  file,
  locale,
  pending,
  setExportConnectionId,
  setExportFolderId,
  t,
  onClose,
  onSubmit,
}: {
  connections: CloudDriveConnection[];
  exportConnectionId: string;
  exportFolderId: string;
  file: WorkspaceFile | null;
  locale: Locale;
  pending: boolean;
  setExportConnectionId: (value: string) => void;
  setExportFolderId: (value: string) => void;
  t: (locale: Locale, key: `files.${string}`) => string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'files.exportToCloud')}</DialogTitle>
          <DialogDescription>{file?.displayName}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Select
            value={exportConnectionId || noneValue}
            onValueChange={(value) => setExportConnectionId(value === noneValue ? '' : value)}
          >
            <SelectTrigger label={t(locale, 'files.cloudConnection')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'files.selectConnection')}</SelectItem>
              {connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {providerLabel(connection.provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label>
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'files.destinationFolder')}
            </span>
            <Input
              value={exportFolderId}
              onChange={(event) => setExportFolderId(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'files.cancel')}
          </Button>
          <Button type="button" disabled={!exportConnectionId || pending} onClick={onSubmit}>
            <Send className="h-4 w-4" />
            {t(locale, 'files.exportToCloud')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuotaSummary({
  usage,
  locale,
  t,
}: {
  usage?: {
    usedBytes: number;
    reservedBytes: number;
    quotaBytes: number;
    availableBytes: number;
    usagePercent: number;
  };
  locale: Locale;
  t: (locale: Locale, key: `files.${string}`) => string;
}) {
  if (!usage) return <Skeleton className="h-10 w-56 rounded-md" />;
  return (
    <div className="min-w-64 rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span>{t(locale, 'files.storageUsed')}</span>
        <span>{usage.usagePercent}%</span>
      </div>
      <Progress
        value={Math.min(100, usage.usagePercent)}
        aria-label={t(locale, 'files.storageUsed')}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {formatBytes(usage.usedBytes)} {t(locale, 'files.used')} / {formatBytes(usage.quotaBytes)} -{' '}
        {formatBytes(usage.reservedBytes)} {t(locale, 'files.reserved')} -{' '}
        {formatBytes(usage.availableBytes)} {t(locale, 'files.available')}
      </p>
    </div>
  );
}

function FileFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words">{value}</dd>
    </div>
  );
}

function uploadToStorage(url: string, file: File, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    if (file.type) request.setRequestHeader('Content-Type', file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error('UPLOAD_FAILED'));
      }
    };
    request.onerror = () => reject(new Error('UPLOAD_FAILED'));
    request.send(file);
  });
}

function bulkActionsFor(lifecycle: FileLifecycle): BulkFileAction[] {
  if (lifecycle === 'ACTIVE') return ['ARCHIVE', 'DELETE'];
  if (lifecycle === 'ARCHIVED') return ['RESTORE', 'DELETE'];
  if (lifecycle === 'PENDING_DELETE') return ['RESTORE'];
  return [];
}

function bulkActionIcon(action: BulkFileAction) {
  if (action === 'ARCHIVE') return <Archive className="h-4 w-4" />;
  if (action === 'RESTORE') return <RotateCcw className="h-4 w-4" />;
  return <Trash2 className="h-4 w-4" />;
}

function bulkActionLabel(
  action: BulkFileAction,
  locale: Locale,
  t: (locale: Locale, key: `files.${string}`) => string,
) {
  if (action === 'ARCHIVE') return t(locale, 'files.archive');
  if (action === 'RESTORE') return t(locale, 'files.restore');
  return t(locale, 'files.moveToDeleted');
}

function FileIcon({ file }: { file: WorkspaceFile }) {
  const category = categoryFromMime(file.mimeType);
  if (category === 'IMAGE') return <ImageIcon className="h-5 w-5" aria-hidden="true" />;
  if (category === 'PDF' || category === 'DOCUMENT')
    return <FileText className="h-5 w-5" aria-hidden="true" />;
  if (category === 'SPREADSHEET') return <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />;
  if (category === 'ARCHIVE') return <FileArchive className="h-5 w-5" aria-hidden="true" />;
  return <File className="h-5 w-5" aria-hidden="true" />;
}

function categoryFromMime(mimeType: string): FileCategory {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType === 'application/pdf') return 'PDF';
  if (['text/plain', 'text/markdown', 'application/msword', 'application/rtf'].includes(mimeType)) {
    return 'DOCUMENT';
  }
  if (mimeType.includes('spreadsheet') || mimeType === 'text/csv' || mimeType.includes('excel')) {
    return 'SPREADSHEET';
  }
  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('gzip') ||
    mimeType.includes('7z')
  ) {
    return 'ARCHIVE';
  }
  return 'OTHER';
}

function isPreviewable(file: WorkspaceFile) {
  return file.mimeType.startsWith('image/') || file.mimeType === 'application/pdf';
}

function emptyTitle(
  lifecycle: FileLifecycle,
  locale: Locale,
  t: (locale: Locale, key: `files.${string}`) => string,
) {
  if (lifecycle === 'ARCHIVED') return t(locale, 'files.noArchivedFiles');
  if (lifecycle === 'PENDING_DELETE') return t(locale, 'files.noDeletedFiles');
  return t(locale, 'files.noFilesYet');
}

function sourceLabel(
  value: FileSourceModule,
  locale: Locale,
  t: (locale: Locale, key: `files.${string}`) => string,
) {
  const key: Record<FileSourceModule, `files.${string}`> = {
    GENERAL: 'files.general',
    TASK: 'files.task',
    PROJECT: 'files.project',
    TICKET: 'files.ticket',
  };
  return t(locale, key[value]);
}

function categoryLabel(
  value: FileCategory,
  locale: Locale,
  t: (locale: Locale, key: `files.${string}`) => string,
) {
  return t(locale, `files.${value.toLowerCase()}`);
}

function sortLabel(
  value: FileSort,
  locale: Locale,
  t: (locale: Locale, key: `files.${string}`) => string,
) {
  return t(locale, `files.${value.toLowerCase()}`);
}

function safeSource(file: WorkspaceFile) {
  if (file.sourceProvider) return providerLabel(file.sourceProvider);
  return file.sourceModule ?? 'GENERAL';
}

function providerLabel(provider: string) {
  if (provider === 'GOOGLE_DRIVE') return 'Google Drive';
  if (provider === 'ONEDRIVE') return 'OneDrive';
  if (provider === 'DROPBOX') return 'Dropbox';
  return provider;
}

function memberLabel(file: WorkspaceFile) {
  return file.uploadedByMembership?.user.name || file.uploadedByMembership?.user.email || '-';
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has('*') || permissions.has(permission);
}

function fileErrorMessage(
  error: unknown,
  locale: Locale,
  t: (locale: Locale, key: `files.${string}`) => string,
) {
  const code =
    error instanceof ApiClientError && typeof error.body.code === 'string'
      ? error.body.code
      : error instanceof Error
        ? error.message
        : 'UNKNOWN';
  const keyByCode: Record<string, `files.${string}`> = {
    STORAGE_QUOTA_EXCEEDED: 'files.quotaExceeded',
    FILE_TOO_LARGE: 'files.fileTooLarge',
    FILE_TYPE_NOT_ALLOWED: 'files.fileTypeNotAllowed',
    UPLOAD_RESERVATION_EXPIRED: 'files.uploadExpired',
    UPLOAD_OBJECT_MISSING: 'files.uploadObjectMissing',
    CLOUD_CONNECTION_REAUTH_REQUIRED: 'files.reauthRequired',
    CLOUD_PROVIDER_NOT_CONFIGURED: 'files.cloudProviderNotConfigured',
    CLOUD_FILE_TOO_LARGE: 'files.cloudFileTooLarge',
    CLOUD_IMPORT_QUOTA_EXCEEDED: 'files.cloudImportQuotaExceeded',
  };
  return t(locale, keyByCode[code] ?? 'files.actionFailed');
}
