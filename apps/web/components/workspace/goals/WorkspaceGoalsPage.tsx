'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Archive, Goal, Plus, RotateCcw, Search, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';
import { useSessionStore } from '../../../stores/session';
import {
  addManualGoalProgress,
  archiveWorkspaceGoal,
  createWorkspaceGoal,
  getWorkspaceGoal,
  listWorkspaceGoals,
  reconcileWorkspaceGoal,
  workspaceGoalKeys,
  type GoalMetricType,
  type GoalOwnerType,
  type GoalPeriodType,
  type GoalStatus,
  type WorkspaceGoal,
} from '../../../services/workspace-goals';

const ownerTypes: GoalOwnerType[] = ['WORKSPACE', 'DEPARTMENT', 'USER'];
const metricTypes: GoalMetricType[] = [
  'TASKS_COMPLETED',
  'PROJECTS_COMPLETED',
  'TICKETS_RESOLVED',
  'XP_EARNED',
  'GLOBAL_SCORE',
  'CUSTOM_NUMERIC',
  'MANUAL_NUMERIC',
];
const periodTypes: GoalPeriodType[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
const statuses: GoalStatus[] = ['ACTIVE', 'COMPLETED', 'EXPIRED', 'ARCHIVED'];

export function WorkspaceGoalsPage() {
  const queryClient = useQueryClient();
  const { accessToken, selectedWorkspaceId, hydrated, hydrate } = useSessionStore();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<GoalStatus | 'ALL'>('ACTIVE');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: 'Monthly completion goal',
    ownerType: 'WORKSPACE' as GoalOwnerType,
    metricType: 'TASKS_COMPLETED' as GoalMetricType,
    periodType: 'MONTHLY' as GoalPeriodType,
    targetValue: 10,
  });
  const [manualDelta, setManualDelta] = useState(1);
  const [manualNote, setManualNote] = useState('');

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setSelectedGoalId(null);
  }, [selectedWorkspaceId]);

  const params = useMemo(
    () => ({ search, status: status === 'ALL' ? undefined : status, page: 1, pageSize: 100 }),
    [search, status],
  );
  const goalsQuery = useQuery({
    queryKey: workspaceGoalKeys.list(selectedWorkspaceId, params),
    queryFn: () => listWorkspaceGoals(selectedWorkspaceId as string, params),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const detailQuery = useQuery({
    queryKey: workspaceGoalKeys.detail(selectedWorkspaceId, selectedGoalId),
    queryFn: () => getWorkspaceGoal(selectedWorkspaceId as string, selectedGoalId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && selectedGoalId),
  });
  const goals = goalsQuery.data?.items ?? [];
  const selectedGoal = detailQuery.data ?? goals.find((goal) => goal.id === selectedGoalId) ?? null;

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspaceGoal(selectedWorkspaceId as string, {
        ...draft,
        targetValue: Number(draft.targetValue),
      }),
    onSuccess: (goal) => {
      setSelectedGoalId(goal.id);
      void queryClient.invalidateQueries({ queryKey: workspaceGoalKeys.all(selectedWorkspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const manualMutation = useMutation({
    mutationFn: () =>
      addManualGoalProgress(
        selectedWorkspaceId as string,
        selectedGoalId as string,
        Number(manualDelta),
        manualNote,
      ),
    onSuccess: (goal) => {
      queryClient.setQueryData(workspaceGoalKeys.detail(selectedWorkspaceId, goal.id), goal);
      void queryClient.invalidateQueries({ queryKey: workspaceGoalKeys.all(selectedWorkspaceId) });
      setManualNote('');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const reconcileMutation = useMutation({
    mutationFn: () =>
      reconcileWorkspaceGoal(selectedWorkspaceId as string, selectedGoalId as string),
    onSuccess: (goal) => {
      queryClient.setQueryData(workspaceGoalKeys.detail(selectedWorkspaceId, goal.id), goal);
      void queryClient.invalidateQueries({ queryKey: workspaceGoalKeys.all(selectedWorkspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const archiveMutation = useMutation({
    mutationFn: () => archiveWorkspaceGoal(selectedWorkspaceId as string, selectedGoalId as string),
    onSuccess: (goal) => {
      queryClient.setQueryData(workspaceGoalKeys.detail(selectedWorkspaceId, goal.id), goal);
      void queryClient.invalidateQueries({ queryKey: workspaceGoalKeys.all(selectedWorkspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!hydrated) return <Skeleton className="h-96 rounded-md" />;

  return (
    <PageContainer>
      <PageHeader
        title="Goals"
        description="Workspace goals, progress tracking, and existing gamification event integration."
      />
      {!selectedWorkspaceId ? (
        <EmptyState title="No Workspace" description="Select a Workspace to manage Goals." />
      ) : (
        <section className="grid min-h-[calc(100vh-12rem)] grid-cols-1 gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
          <aside className="rounded-md border border-border bg-card">
            <div className="grid gap-3 border-b border-border p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  aria-label="Search Goals"
                  placeholder="Search Goals"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as GoalStatus | 'ALL')}
              >
                <SelectTrigger aria-label="Goal status filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  {statuses.map((item) => (
                    <SelectItem key={item} value={item}>
                      {label(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {goalsQuery.isLoading ? (
              <div className="grid gap-2 p-3">
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
              </div>
            ) : goals.length ? (
              <div className="grid gap-1 p-3">
                {goals.map((goal) => (
                  <GoalListButton
                    key={goal.id}
                    goal={goal}
                    selected={selectedGoal?.id === goal.id}
                    onClick={() => setSelectedGoalId(goal.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No Goals"
                description="Create a goal to start tracking progress."
              />
            )}
          </aside>
          <main className="min-w-0 rounded-md border border-border bg-card p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <GoalDetail
                goal={selectedGoal}
                loading={detailQuery.isFetching}
                onManual={() => manualMutation.mutate()}
                onReconcile={() => reconcileMutation.mutate()}
                onArchive={() => archiveMutation.mutate()}
                manualDelta={manualDelta}
                manualNote={manualNote}
                setManualDelta={setManualDelta}
                setManualNote={setManualNote}
              />
              <GoalCreatePanel
                draft={draft}
                setDraft={setDraft}
                pending={createMutation.isPending}
                onCreate={() => createMutation.mutate()}
              />
            </div>
          </main>
        </section>
      )}
    </PageContainer>
  );
}

function GoalListButton({
  goal,
  selected,
  onClick,
}: {
  goal: WorkspaceGoal;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`min-h-20 rounded-md px-3 py-2 text-left text-sm ${
        selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
      }`}
      onClick={onClick}
    >
      <span className="flex items-center gap-2 font-medium">
        <Goal className="h-4 w-4" />
        <span className="min-w-0 truncate">{goal.title}</span>
      </span>
      <span className="mt-2 block h-2 rounded-full bg-muted">
        <span
          className="block h-2 rounded-full bg-current"
          style={{ width: `${Math.min(100, goal.percentComplete)}%` }}
        />
      </span>
      <span className="mt-1 block text-xs opacity-80">
        {goal.currentProgress} / {goal.targetValue} - {label(goal.metricType)}
      </span>
    </button>
  );
}

function GoalDetail({
  goal,
  loading,
  onManual,
  onReconcile,
  onArchive,
  manualDelta,
  manualNote,
  setManualDelta,
  setManualNote,
}: {
  goal: WorkspaceGoal | null;
  loading: boolean;
  onManual: () => void;
  onReconcile: () => void;
  onArchive: () => void;
  manualDelta: number;
  manualNote: string;
  setManualDelta: (value: number) => void;
  setManualNote: (value: string) => void;
}) {
  if (!goal)
    return <EmptyState title="Select a Goal" description="Choose a goal to review progress." />;
  return (
    <article className="grid gap-4">
      <header className="grid gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{goal.title}</h2>
            <p className="text-sm text-muted-foreground">
              {goal.description ?? label(goal.metricType)}
            </p>
          </div>
          <Badge>{label(goal.status)}</Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Progress" value={`${goal.currentProgress} / ${goal.targetValue}`} />
          <Metric label="Completion" value={`${goal.percentComplete}%`} />
          <Metric label="Owner" value={label(goal.ownerType)} />
        </div>
      </header>
      <div className="grid gap-3 sm:grid-cols-3">
        <Button type="button" variant="outline" onClick={onReconcile} disabled={loading}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reconcile
        </Button>
        <Button type="button" variant="outline" onClick={onArchive} disabled={loading}>
          <Archive className="mr-2 h-4 w-4" />
          Archive
        </Button>
      </div>
      {goal.metricType === 'MANUAL_NUMERIC' ? (
        <div className="grid gap-3 rounded-md border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Input
              type="number"
              value={manualDelta}
              aria-label="Manual progress delta"
              onChange={(event) => setManualDelta(Number(event.target.value))}
            />
            <Textarea
              value={manualNote}
              aria-label="Manual progress note"
              placeholder="Progress note"
              onChange={(event) => setManualNote(event.target.value)}
            />
          </div>
          <Button type="button" onClick={onManual}>
            <TrendingUp className="mr-2 h-4 w-4" />
            Add Progress
          </Button>
        </div>
      ) : null}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Progress ledger</h3>
        {goal.progressEvents?.length ? (
          <div className="grid gap-2">
            {goal.progressEvents.map((event) => (
              <div key={event.id} className="rounded-md border border-border p-3 text-sm">
                <span className="font-medium">{label(event.sourceType)}</span>
                <span className="ml-2 text-muted-foreground">
                  {event.delta > 0 ? '+' : ''}
                  {event.delta} to {event.valueAfter}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No progress events yet.</p>
        )}
      </section>
    </article>
  );
}

function GoalCreatePanel({
  draft,
  setDraft,
  pending,
  onCreate,
}: {
  draft: {
    title: string;
    ownerType: GoalOwnerType;
    metricType: GoalMetricType;
    periodType: GoalPeriodType;
    targetValue: number;
  };
  setDraft: (value: typeof draft) => void;
  pending: boolean;
  onCreate: () => void;
}) {
  return (
    <aside className="grid content-start gap-3 rounded-md border border-border p-3">
      <h3 className="text-sm font-semibold">Create goal</h3>
      <Input
        value={draft.title}
        aria-label="Goal title"
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
      />
      <Select
        value={draft.ownerType}
        onValueChange={(value) => setDraft({ ...draft, ownerType: value as GoalOwnerType })}
      >
        <SelectTrigger aria-label="Goal owner type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ownerTypes.map((item) => (
            <SelectItem key={item} value={item}>
              {label(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={draft.metricType}
        onValueChange={(value) => setDraft({ ...draft, metricType: value as GoalMetricType })}
      >
        <SelectTrigger aria-label="Goal metric type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {metricTypes.map((item) => (
            <SelectItem key={item} value={item}>
              {label(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={draft.periodType}
        onValueChange={(value) => setDraft({ ...draft, periodType: value as GoalPeriodType })}
      >
        <SelectTrigger aria-label="Goal period type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {periodTypes.map((item) => (
            <SelectItem key={item} value={item}>
              {label(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={1}
        value={draft.targetValue}
        aria-label="Goal target value"
        onChange={(event) => setDraft({ ...draft, targetValue: Number(event.target.value) })}
      />
      <Button type="button" onClick={onCreate} disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        Create
      </Button>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function label(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Goal operation failed';
}
