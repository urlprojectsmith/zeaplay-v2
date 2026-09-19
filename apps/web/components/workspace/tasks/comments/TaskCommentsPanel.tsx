'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Checkbox, EmptyState, Input, Skeleton, Textarea } from '@zea-play/ui';
import { Check, CornerDownRight, Pencil, Reply, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '../../../../contexts/language-provider';
import { listWorkspaceUsers, type WorkspaceUser } from '../../../../services/workspace-management';
import { listWorkspaceRoles, rolesKeys } from '../../../../services/workspace-roles';
import {
  addWorkspaceTaskCommentReaction,
  createWorkspaceTaskComment,
  createWorkspaceTaskCommentReply,
  deleteWorkspaceTaskComment,
  listWorkspaceTaskCommentReplies,
  listWorkspaceTaskComments,
  removeWorkspaceTaskCommentReaction,
  taskCreationKeys,
  taskKeys,
  updateWorkspaceTaskComment,
  type TaskCommentPayload,
  type TaskCommentReactionType,
  type TaskCommentSummary,
  type TaskCommentVisibility,
  type WorkspaceTask,
} from '../../../../services/workspace-tasks';
import { useSessionStore } from '../../../../stores/session';

const pageSize = 10;
const commentBodyMaxLength = 4000;
const internalCommentPermission = 'tasks.comments.internal';
const reactionTypes = ['LIKE', 'LOVE', 'CELEBRATE', 'EYES', 'CHECK'] as const;
const reactionGlyphs: Record<TaskCommentReactionType, string> = {
  LIKE: '👍',
  LOVE: '❤️',
  CELEBRATE: '🎉',
  EYES: '👀',
  CHECK: '✅',
};

export function TaskCommentsPanel({
  workspaceId,
  task,
  active,
}: {
  workspaceId: string | null;
  task: WorkspaceTask;
  active: boolean;
}) {
  const { locale, t } = useLanguage();
  const labels = commentLabels(locale, t);
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((state) => state.accessToken);
  const [page, setPage] = useState(1);
  const selectedWorkspace = useSelectedWorkspace(workspaceId);
  const currentRoleKey = selectedWorkspace?.role ?? null;
  const resetKey = `${workspaceId ?? 'no-workspace'}:${task.id}:${accessToken ?? 'signed-out'}`;
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(workspaceId),
    queryFn: () => listWorkspaceRoles(workspaceId as string),
    enabled: Boolean(active && workspaceId && currentRoleKey && accessToken),
    staleTime: 30_000,
  });
  const currentRole = rolesQuery.data?.find(
    (role) => role.key.toLowerCase() === currentRoleKey?.toLowerCase(),
  );
  const canUseInternal = Boolean(
    currentRole?.permissions.some(
      (permission) => permission.key === '*' || permission.key === internalCommentPermission,
    ),
  );

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const commentsQuery = useQuery({
    queryKey: taskKeys.comments(workspaceId, task.id, { page, pageSize }),
    queryFn: () => listWorkspaceTaskComments(workspaceId as string, task.id, { page, pageSize }),
    enabled: Boolean(active && workspaceId && task.id),
  });

  const invalidateRoots = () =>
    queryClient.invalidateQueries({ queryKey: taskKeys.commentsBase(workspaceId, task.id) });

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil((commentsQuery.data?.total ?? 0) / pageSize));
    if (commentsQuery.isSuccess && page > totalPages) setPage(totalPages);
  }, [commentsQuery.data?.total, commentsQuery.isSuccess, page]);

  return (
    <section aria-label={labels.comments} className="grid gap-4">
      <TaskCommentComposer
        workspaceId={workspaceId}
        taskId={task.id}
        labels={labels}
        canUseInternal={canUseInternal}
        resetKey={resetKey}
        submitLabel={labels.postComment}
        onSubmit={(payload) =>
          createWorkspaceTaskComment(workspaceId as string, task.id, payload).then(async () => {
            await invalidateRoots();
            toast.success(labels.commentPosted);
          })
        }
        enabled={Boolean(workspaceId)}
      />

      {commentsQuery.isLoading ? (
        <div className="grid gap-3" aria-label={labels.loadingComments}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : commentsQuery.isError ? (
        <EmptyState
          title={labels.commentsLoadFailed}
          description={labels.networkError}
          action={
            <Button type="button" variant="secondary" onClick={() => void commentsQuery.refetch()}>
              {labels.retry}
            </Button>
          }
        />
      ) : commentsQuery.data?.items.length ? (
        <div className="grid gap-3">
          {commentsQuery.data.items.map((comment) => (
            <TaskCommentItem
              key={comment.id}
              workspaceId={workspaceId}
              taskId={task.id}
              comment={comment}
              labels={labels}
              canUseInternal={canUseInternal}
              resetKey={resetKey}
              depth={0}
              visitedIds={new Set()}
            />
          ))}
          <CommentPagination
            labels={labels}
            page={page}
            pageSize={commentsQuery.data.pageSize}
            total={commentsQuery.data.total}
            onPage={setPage}
          />
        </div>
      ) : (
        <EmptyState title={labels.noComments} description={labels.noCommentsDescription} />
      )}
    </section>
  );
}

function TaskCommentItem({
  workspaceId,
  taskId,
  comment,
  labels,
  canUseInternal,
  resetKey,
  depth,
  visitedIds,
}: {
  workspaceId: string | null;
  taskId: string;
  comment: TaskCommentSummary;
  labels: CommentLabels;
  canUseInternal: boolean;
  resetKey: string;
  depth: number;
  visitedIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const currentMembershipId = useCurrentMembershipId(workspaceId);
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyPage, setReplyPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body ?? '');
  const [pendingReaction, setPendingReaction] = useState<TaskCommentReactionType | null>(null);
  const repeated = visitedIds.has(comment.id);
  const nextVisited = useMemo(() => new Set([...visitedIds, comment.id]), [visitedIds, comment.id]);
  const canChange = currentMembershipId === comment.author.membershipId;
  const canReply = !comment.deleted && !repeated;
  const replyQuery = useQuery({
    queryKey: taskKeys.replies(workspaceId, taskId, comment.id, { page: replyPage, pageSize }),
    queryFn: () =>
      listWorkspaceTaskCommentReplies(workspaceId as string, taskId, comment.id, {
        page: replyPage,
        pageSize,
      }),
    enabled: Boolean(expanded && workspaceId && !repeated),
  });

  useEffect(() => {
    setExpanded(false);
    setReplyOpen(false);
    setEditing(false);
    setEditBody(comment.body ?? '');
    setReplyPage(1);
    setPendingReaction(null);
  }, [comment.body, resetKey]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil((replyQuery.data?.total ?? 0) / pageSize));
    if (replyQuery.isSuccess && replyPage > totalPages) setReplyPage(totalPages);
  }, [replyPage, replyQuery.data?.total, replyQuery.isSuccess]);

  const invalidateCommentScope = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskKeys.commentsBase(workspaceId, taskId) }),
      queryClient.invalidateQueries({
        queryKey: taskKeys.repliesBase(workspaceId, taskId, comment.id),
      }),
      comment.parentCommentId
        ? queryClient.invalidateQueries({
            queryKey: taskKeys.repliesBase(workspaceId, taskId, comment.parentCommentId),
          })
        : Promise.resolve(),
    ]);
  };

  const editMutation = useMutation({
    mutationFn: () =>
      updateWorkspaceTaskComment(workspaceId as string, taskId, comment.id, { body: editBody }),
    onSuccess: async () => {
      setEditing(false);
      await invalidateCommentScope();
      toast.success(labels.commentUpdated);
    },
    onError: () => toast.error(labels.commentUpdateFailed),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkspaceTaskComment(workspaceId as string, taskId, comment.id),
    onSuccess: async () => {
      await invalidateCommentScope();
      toast.success(labels.commentDeletedFeedback);
    },
    onError: () => toast.error(labels.commentDeleteFailed),
  });

  async function toggleReaction(reactionType: TaskCommentReactionType) {
    if (!workspaceId || pendingReaction === reactionType) return;
    setPendingReaction(reactionType);
    try {
      if (comment.currentUserReactions.includes(reactionType)) {
        await removeWorkspaceTaskCommentReaction(workspaceId, taskId, comment.id, reactionType);
      } else {
        await addWorkspaceTaskCommentReaction(workspaceId, taskId, comment.id, reactionType);
      }
      await invalidateCommentScope();
    } catch {
      toast.error(labels.reactionFailed);
    } finally {
      setPendingReaction(null);
    }
  }

  return (
    <article
      aria-label={`${labels.commentBy} ${displayCommentAuthor(comment.author)}`}
      className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3"
      style={{ marginLeft: `${Math.min(depth, 3) * 0.75}rem` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{displayCommentAuthor(comment.author)}</span>
            <time
              className="text-xs text-[hsl(var(--muted-foreground))]"
              dateTime={comment.createdAt}
            >
              {formatCommentDate(comment.createdAt)}
            </time>
            {comment.editedAt ? <Badge variant="neutral">{labels.edited}</Badge> : null}
            {comment.visibility === 'INTERNAL' ? (
              <Badge variant="danger">{labels.internal}</Badge>
            ) : null}
          </div>
          {comment.visibility === 'INTERNAL' ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{labels.internalHelper}</p>
          ) : null}
        </div>
      </div>

      {repeated ? (
        <p className="text-sm text-[hsl(var(--destructive))]">{labels.threadStopped}</p>
      ) : comment.deleted ? (
        <p className="rounded-md bg-[hsl(var(--muted))] px-3 py-2 text-sm italic text-[hsl(var(--muted-foreground))]">
          {labels.commentDeleted}
        </p>
      ) : editing ? (
        <div className="grid gap-2">
          <Textarea
            aria-label={labels.editComment}
            value={editBody}
            onChange={(event) => setEditBody(event.target.value)}
            rows={4}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                !editBody.trim() ||
                editBody.trim() === (comment.body ?? '').trim() ||
                editMutation.isPending
              }
              onClick={() => editMutation.mutate()}
            >
              <Check aria-hidden="true" className="h-4 w-4" />
              {labels.save}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditBody(comment.body ?? '');
                setEditing(false);
              }}
            >
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <CommentBody body={comment.body ?? ''} mentions={comment.mentions} />
      )}

      {!comment.deleted ? (
        <div className="flex flex-wrap gap-2" aria-label={labels.reactions}>
          {reactionTypes.map((reactionType) => {
            const pressed = comment.currentUserReactions.includes(reactionType);
            const count = comment.reactionCounts[reactionType] ?? 0;
            return (
              <Button
                key={reactionType}
                type="button"
                size="sm"
                variant={pressed ? 'primary' : 'secondary'}
                aria-pressed={pressed}
                aria-label={`${pressed ? labels.removeReaction : labels.reactWith} ${reactionLabel(labels, reactionType)}`}
                disabled={pendingReaction === reactionType}
                onClick={() => void toggleReaction(reactionType)}
              >
                <span aria-hidden="true">{reactionGlyphs[reactionType]}</span>
                <span>{count}</span>
              </Button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canReply ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setReplyOpen((value) => !value)}
          >
            <Reply aria-hidden="true" className="h-4 w-4" />
            {labels.reply}
          </Button>
        ) : null}
        {canChange && !comment.deleted ? (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" className="h-4 w-4" />
              {labels.edit}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!deleteMutation.isPending && window.confirm(labels.deleteConfirmation))
                  deleteMutation.mutate();
              }}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              {labels.deleteComment}
            </Button>
          </>
        ) : null}
        {comment.directReplyCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <CornerDownRight aria-hidden="true" className="h-4 w-4" />
            {expanded
              ? labels.hideReplies
              : labels.viewReplies.replace('{count}', String(comment.directReplyCount))}
          </Button>
        ) : null}
      </div>

      {replyOpen ? (
        <TaskCommentComposer
          workspaceId={workspaceId}
          taskId={taskId}
          labels={labels}
          canUseInternal={canUseInternal}
          resetKey={resetKey}
          parentVisibility={comment.visibility}
          submitLabel={labels.postReply}
          enabled={Boolean(workspaceId)}
          onSubmit={(payload) =>
            createWorkspaceTaskCommentReply(
              workspaceId as string,
              taskId,
              comment.id,
              payload,
            ).then(async () => {
              setReplyOpen(false);
              setExpanded(true);
              await invalidateCommentScope();
              toast.success(labels.replyPosted);
            })
          }
        />
      ) : null}

      {expanded ? (
        <div role="region" aria-label={labels.replies} className="grid gap-3">
          {replyQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : replyQuery.isError ? (
            <div className="rounded-md border border-[hsl(var(--border))] p-3">
              <p className="text-sm text-[hsl(var(--destructive))]">{labels.repliesLoadFailed}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void replyQuery.refetch()}
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                {labels.retry}
              </Button>
            </div>
          ) : (
            <>
              {replyQuery.data?.items.map((reply) => (
                <TaskCommentItem
                  key={reply.id}
                  workspaceId={workspaceId}
                  taskId={taskId}
                  comment={reply}
                  labels={labels}
                  canUseInternal={canUseInternal}
                  resetKey={resetKey}
                  depth={depth + 1}
                  visitedIds={nextVisited}
                />
              ))}
              {replyQuery.data ? (
                <CommentPagination
                  labels={labels}
                  page={replyPage}
                  pageSize={replyQuery.data.pageSize}
                  total={replyQuery.data.total}
                  onPage={setReplyPage}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}

function TaskCommentComposer({
  workspaceId,
  taskId,
  labels,
  canUseInternal,
  resetKey,
  parentVisibility,
  submitLabel,
  enabled,
  onSubmit,
}: {
  workspaceId: string | null;
  taskId: string;
  labels: CommentLabels;
  canUseInternal: boolean;
  resetKey: string;
  parentVisibility?: TaskCommentVisibility;
  submitLabel: string;
  enabled: boolean;
  onSubmit: (payload: TaskCommentPayload) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<TaskCommentVisibility>('NORMAL');
  const [search, setSearch] = useState('');
  const [selectedMentions, setSelectedMentions] = useState<WorkspaceUser[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const submitLocked = useRef(false);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const mutation = useMutation({
    mutationFn: () =>
      onSubmit({
        body,
        visibility,
        mentionedMembershipIds: selectedMentions.map((mention) => mention.membershipId),
      }),
    onSuccess: () => {
      submitLocked.current = false;
      setBody('');
      setVisibility('NORMAL');
      setSearch('');
      setSelectedMentions([]);
      setPickerOpen(false);
    },
    onError: () => {
      submitLocked.current = false;
      toast.error(labels.commentFailed);
    },
    onSettled: () => {
      submitLocked.current = false;
    },
  });
  const mentionQuery = useQuery({
    queryKey: taskCreationKeys.users(workspaceId, `mentions:${debouncedSearch}`),
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 8,
        search: debouncedSearch.length >= 1 ? debouncedSearch : undefined,
        status: 'ACTIVE',
      }),
    enabled: Boolean(workspaceId && pickerOpen && debouncedSearch.length >= 1),
  });

  useEffect(() => {
    setBody('');
    setVisibility('NORMAL');
    setSearch('');
    setSelectedMentions([]);
    setPickerOpen(false);
    submitLocked.current = false;
  }, [resetKey]);

  function selectMention(user: WorkspaceUser) {
    setSelectedMentions((current) =>
      current.some((item) => item.membershipId === user.membershipId)
        ? current
        : [...current, user],
    );
    setBody(
      (current) =>
        `${current.replace(/@[\w\s.-]*$/, '').trimEnd()} @${displayWorkspaceUser(user)} `,
    );
    setSearch('');
    setPickerOpen(false);
  }

  return (
    <form
      className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (enabled && body.trim() && !mutation.isPending && !submitLocked.current) {
          submitLocked.current = true;
          mutation.mutate();
        }
      }}
    >
      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor={`comment-${taskId}-${submitLabel}`}>
          {submitLabel === labels.postReply ? labels.writeReply : labels.writeComment}
        </label>
        <Textarea
          id={`comment-${taskId}-${submitLabel}`}
          value={body}
          rows={4}
          maxLength={commentBodyMaxLength}
          placeholder={labels.writeAComment}
          onChange={(event) => {
            const value = event.target.value;
            setBody(value);
            const match = value.match(/@([^\s@]{0,40})$/);
            if (match) {
              setPickerOpen(true);
              setSearch(match[1] ?? '');
            }
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setPickerOpen((value) => !value);
            setSearch('');
          }}
        >
          <Search aria-hidden="true" className="h-4 w-4" />
          {labels.mentionPeople}
        </Button>
        {canUseInternal ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={visibility === 'INTERNAL'}
              onCheckedChange={(checked) => setVisibility(checked ? 'INTERNAL' : 'NORMAL')}
            />
            <span>{labels.internalComment}</span>
          </label>
        ) : null}
        {parentVisibility === 'INTERNAL' ? <Badge variant="danger">{labels.internal}</Badge> : null}
      </div>
      {canUseInternal ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{labels.internalHelper}</p>
      ) : null}

      {pickerOpen ? (
        <div
          className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-2"
          role="listbox"
          aria-label={labels.mentionPeople}
        >
          <Input
            aria-label={labels.mentionPeople}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.searchPeople}
            autoFocus
          />
          {mentionQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : mentionQuery.data?.items.length ? (
            <div className="grid gap-1">
              {mentionQuery.data.items
                .filter((user) => user.membershipStatus === 'ACTIVE')
                .map((user) => (
                  <button
                    key={user.membershipId}
                    type="button"
                    role="option"
                    className="rounded-md px-2 py-2 text-left text-sm hover:bg-[hsl(var(--muted))] focus:bg-[hsl(var(--muted))] focus:outline-none"
                    onClick={() => selectMention(user)}
                  >
                    {displayWorkspaceUser(user)}
                  </button>
                ))}
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noMentionMatches}</p>
          )}
        </div>
      ) : null}

      {selectedMentions.length ? (
        <div className="flex flex-wrap gap-2" aria-label={labels.selectedMentions}>
          {selectedMentions.map((mention) => (
            <Badge key={mention.membershipId} variant="neutral" className="gap-1">
              @{displayWorkspaceUser(mention)}
              <button
                type="button"
                aria-label={`${labels.removeMention}: ${displayWorkspaceUser(mention)}`}
                onClick={() =>
                  setSelectedMentions((current) =>
                    current.filter((item) => item.membershipId !== mention.membershipId),
                  )
                }
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" disabled={!body.trim() || mutation.isPending || !enabled}>
          {mutation.isPending ? labels.posting : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function CommentBody({
  body,
  mentions,
}: {
  body: string;
  mentions: TaskCommentSummary['mentions'];
}) {
  return (
    <div className="grid gap-2">
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{body}</p>
      {mentions.length ? (
        <div className="flex flex-wrap gap-2">
          {mentions.map((mention) => (
            <Badge key={mention.membershipId} variant="neutral">
              @{mention.name ?? mention.email}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CommentPagination({
  labels,
  page,
  pageSize,
  total,
  onPage,
}: {
  labels: CommentLabels;
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-sm text-[hsl(var(--muted-foreground))]">
        {labels.page} {page} / {pageCount}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {labels.previous}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        {labels.loadMore}
      </Button>
    </div>
  );
}

function useSelectedWorkspace(workspaceId: string | null) {
  return useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === workspaceId),
  );
}

function useCurrentMembershipId(workspaceId: string | null) {
  return useSelectedWorkspace(workspaceId)?.membershipId ?? null;
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function displayWorkspaceUser(user: WorkspaceUser) {
  return user.name ?? user.email;
}

function displayCommentAuthor(author: TaskCommentSummary['author']) {
  return author.name ?? author.email;
}

function formatCommentDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function reactionLabel(labels: CommentLabels, reactionType: TaskCommentReactionType) {
  return labels[`reaction${reactionType}`];
}

type CommentLabels = ReturnType<typeof commentLabels>;

function commentLabels(
  locale: Parameters<ReturnType<typeof useLanguage>['t']>[0],
  t: ReturnType<typeof useLanguage>['t'],
) {
  const keys = [
    'comments',
    'writeComment',
    'writeReply',
    'writeAComment',
    'postComment',
    'postReply',
    'posting',
    'reply',
    'replies',
    'viewReplies',
    'hideReplies',
    'edit',
    'editComment',
    'save',
    'cancel',
    'deleteComment',
    'deleteConfirmation',
    'commentDeleted',
    'edited',
    'internal',
    'internalComment',
    'internalHelper',
    'mentionPeople',
    'selectedMentions',
    'noMentionMatches',
    'noComments',
    'noCommentsDescription',
    'loadMore',
    'page',
    'previous',
    'retry',
    'searchPeople',
    'commentPosted',
    'commentUpdated',
    'commentDeletedFeedback',
    'replyPosted',
    'permissionDenied',
    'networkError',
    'commentFailed',
    'commentUpdateFailed',
    'commentDeleteFailed',
    'reactionFailed',
    'staleDeletedComment',
    'retryConflict',
    'removeMention',
    'reactions',
    'reactWith',
    'removeReaction',
    'reactionLIKE',
    'reactionLOVE',
    'reactionCELEBRATE',
    'reactionEYES',
    'reactionCHECK',
    'commentsLoadFailed',
    'loadingComments',
    'repliesLoadFailed',
    'commentBy',
    'threadStopped',
  ] as const;
  return Object.fromEntries(keys.map((key) => [key, t(locale, `workspaceTasks.${key}`)])) as Record<
    (typeof keys)[number],
    string
  >;
}
