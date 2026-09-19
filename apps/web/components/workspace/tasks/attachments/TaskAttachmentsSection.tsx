'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Skeleton,
} from '@zea-play/ui';
import { Download, ExternalLink, Link, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listWorkspaceRoles, rolesKeys } from '../../../../services/workspace-roles';
import {
  addTaskUrlAttachment,
  completeTaskAttachmentUpload,
  downloadTaskAttachment,
  initTaskAttachmentUpload,
  listTaskAttachments,
  removeTaskAttachment,
  taskKeys,
  type TaskAttachmentSummary,
} from '../../../../services/workspace-tasks';
import { useSessionStore } from '../../../../stores/session';

const maxTaskAttachmentBytes = 25 * 1024 * 1024;
const driveSuggestionBytes = 2 * 1024 * 1024;

export function TaskAttachmentsSection({
  workspaceId,
  taskId,
  labels,
}: {
  workspaceId: string | null;
  taskId: string;
  labels: TaskAttachmentLabels;
}) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const selectedWorkspace = useSelectedWorkspace(workspaceId);
  const roleKey = selectedWorkspace?.role ?? null;
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const resetKey = `${workspaceId ?? 'no-workspace'}:${taskId}:${accessToken ?? 'signed-out'}`;

  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(workspaceId),
    queryFn: () => listWorkspaceRoles(workspaceId as string),
    enabled: Boolean(workspaceId && roleKey && accessToken),
    staleTime: 30_000,
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find((item) => item.key.toLowerCase() === roleKey?.toLowerCase());
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [roleKey, rolesQuery.data]);
  const canAdd = hasPermission(permissions, 'tasks.attachments.add');
  const canRemove = hasPermission(permissions, 'tasks.attachments.remove');
  const canDownload = hasPermission(permissions, 'tasks.attachments.download');

  const attachmentsQuery = useQuery({
    queryKey: taskKeys.attachments(workspaceId, taskId, { page: 1, pageSize: 20 }),
    queryFn: () => listTaskAttachments(workspaceId as string, taskId, { page: 1, pageSize: 20 }),
    enabled: Boolean(workspaceId && taskId && accessToken),
  });

  useEffect(() => {
    setUploadOpen(false);
    setLinkOpen(false);
  }, [resetKey]);

  return (
    <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold">{labels.attachments}</h4>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {labels.attachmentsDescription}
          </p>
        </div>
        {canAdd ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload aria-hidden="true" className="h-4 w-4" />
              {labels.uploadFile}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setLinkOpen(true)}>
              <Link aria-hidden="true" className="h-4 w-4" />
              {labels.addLink}
            </Button>
          </div>
        ) : null}
      </div>

      {attachmentsQuery.isLoading ? (
        <div className="grid gap-2" aria-label={labels.loadingAttachments}>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : attachmentsQuery.isError ? (
        <EmptyState
          title={labels.attachmentsLoadFailed}
          description={labels.networkError}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => void attachmentsQuery.refetch()}
            >
              {labels.retry}
            </Button>
          }
        />
      ) : attachmentsQuery.data?.items.length ? (
        <div className="grid gap-2">
          {attachmentsQuery.data.items.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              labels={labels}
              canDownload={canDownload}
              canRemove={canRemove}
              workspaceId={workspaceId}
              taskId={taskId}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noAttachments}</p>
      )}

      <UploadAttachmentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        workspaceId={workspaceId}
        taskId={taskId}
        labels={labels}
      />
      <UrlAttachmentDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        workspaceId={workspaceId}
        taskId={taskId}
        labels={labels}
      />
    </section>
  );
}

function AttachmentRow({
  attachment,
  labels,
  canDownload,
  canRemove,
  workspaceId,
  taskId,
}: {
  attachment: TaskAttachmentSummary;
  labels: TaskAttachmentLabels;
  canDownload: boolean;
  canRemove: boolean;
  workspaceId: string | null;
  taskId: string;
}) {
  const queryClient = useQueryClient();
  const removeMutation = useMutation({
    mutationFn: () => removeTaskAttachment(workspaceId as string, taskId, attachment.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: taskKeys.attachmentsBase(workspaceId, taskId),
      });
      toast.success(labels.attachmentRemoved);
    },
    onError: (error) => toast.error(safeAttachmentError(error, labels)),
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadTaskAttachment(workspaceId as string, taskId, attachment.id),
    onSuccess: (result) => {
      window.location.assign(result.downloadUrl);
    },
    onError: (error) => toast.error(safeAttachmentError(error, labels)),
  });

  return (
    <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <Paperclip
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{attachment.displayName}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {attachment.type === 'FILE'
              ? `${labels.fileAttachment} · ${formatBytes(attachment.file?.sizeBytes ?? 0)}`
              : labels.urlAttachment}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {attachment.type === 'URL' && attachment.url ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => window.open(attachment.url ?? '', '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {labels.openLink}
          </Button>
        ) : null}
        {attachment.type === 'FILE' && canDownload ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={downloadMutation.isPending || attachment.file?.status !== 'READY'}
            onClick={() => downloadMutation.mutate()}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {labels.download}
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={formatLabel(labels.removeAttachmentNamed, {
              name: attachment.displayName,
            })}
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            {labels.removeAttachment}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function UploadAttachmentDialog({
  open,
  onOpenChange,
  workspaceId,
  taskId,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  taskId: string;
  labels: TaskAttachmentLabels;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !file) return null;
      if (file.size > maxTaskAttachmentBytes) throw new Error(labels.fileTooLarge);
      const init = await initTaskAttachmentUpload(workspaceId, taskId, {
        filename: file.name,
        displayName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      await uploadToStorage(init.uploadUrl, file, setProgress);
      return completeTaskAttachmentUpload(workspaceId, taskId, init.attachment.id, {
        sizeBytes: file.size,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: taskKeys.attachmentsBase(workspaceId, taskId),
      });
      toast.success(labels.fileUploaded);
      setFile(null);
      setProgress(0);
      onOpenChange(false);
    },
    onError: (error) => toast.error(safeAttachmentError(error, labels)),
  });

  useEffect(() => {
    if (!open) {
      setFile(null);
      setProgress(0);
    }
  }, [open, workspaceId, taskId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.uploadFile}</DialogTitle>
          <DialogDescription>{labels.uploadFileDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            label={labels.file}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {file.name} - {formatBytes(file.size)}
            </p>
          ) : null}
          {file && file.size > driveSuggestionBytes ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {labels.largeFileSuggestion}
            </p>
          ) : null}
          {progress > 0 ? (
            <div className="h-2 rounded-full bg-[hsl(var(--surface-muted))]">
              <div
                className="h-2 rounded-full bg-[hsl(var(--primary))]"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={!file || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate()}
          >
            {uploadMutation.isPending ? labels.uploading : labels.uploadFile}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UrlAttachmentDialog({
  open,
  onOpenChange,
  workspaceId,
  taskId,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  taskId: string;
  labels: TaskAttachmentLabels;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const trimmedUrl = url.trim();
  const hasInvalidUrl = trimmedUrl.length > 0 && !isHttpUrl(trimmedUrl);
  const addMutation = useMutation({
    mutationFn: () =>
      addTaskUrlAttachment(workspaceId as string, taskId, {
        url: trimmedUrl,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: taskKeys.attachmentsBase(workspaceId, taskId),
      });
      toast.success(labels.linkAdded);
      setUrl('');
      setDisplayName('');
      onOpenChange(false);
    },
    onError: (error) => toast.error(safeAttachmentError(error, labels)),
  });

  useEffect(() => {
    if (!open) {
      setUrl('');
      setDisplayName('');
    }
  }, [open, workspaceId, taskId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.addLink}</DialogTitle>
          <DialogDescription>{labels.addLinkDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            label={labels.url}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
          />
          {hasInvalidUrl ? (
            <p className="text-sm text-[hsl(var(--destructive))]">{labels.invalidUrl}</p>
          ) : null}
          <Input
            label={labels.displayName}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={!trimmedUrl || hasInvalidUrl || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {addMutation.isPending ? labels.applying : labels.addLink}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function uploadToStorage(url: string, file: File, onProgress: (value: number) => void) {
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
        reject(new Error(`Upload failed with status ${request.status}`));
      }
    };
    request.onerror = () => reject(new Error('Upload failed.'));
    request.send(file);
  });
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatLabel(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (formatted, [key, value]) => formatted.replace(`{${key}}`, value),
    template,
  );
}

function safeAttachmentError(error: unknown, labels: TaskAttachmentLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (error instanceof Error && error.message === labels.fileTooLarge) return labels.fileTooLarge;
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.attachmentUnavailable;
  if (status === 409) return labels.attachmentNotReady;
  if (status === 413) return labels.fileTooLarge;
  if (status === 400 || status === 422) return labels.invalidUrl;
  if (error instanceof TypeError) return labels.networkError;
  return labels.attachmentActionFailed;
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has('*') || permissions.has(permission);
}

function useSelectedWorkspace(workspaceId: string | null) {
  return useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === workspaceId),
  );
}

export type TaskAttachmentLabels = Record<
  | 'attachments'
  | 'attachmentsDescription'
  | 'loadingAttachments'
  | 'attachmentsLoadFailed'
  | 'noAttachments'
  | 'uploadFile'
  | 'uploadFileDescription'
  | 'addLink'
  | 'addLinkDescription'
  | 'file'
  | 'url'
  | 'displayName'
  | 'largeFileSuggestion'
  | 'fileTooLarge'
  | 'uploading'
  | 'fileUploaded'
  | 'linkAdded'
  | 'fileAttachment'
  | 'urlAttachment'
  | 'download'
  | 'openLink'
  | 'removeAttachment'
  | 'removeAttachmentNamed'
  | 'attachmentRemoved'
  | 'attachmentUnavailable'
  | 'attachmentNotReady'
  | 'invalidAttachment'
  | 'invalidUrl'
  | 'attachmentActionFailed'
  | 'permissionDenied'
  | 'networkError'
  | 'retry'
  | 'applying',
  string
>;
