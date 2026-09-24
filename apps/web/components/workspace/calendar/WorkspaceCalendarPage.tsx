'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from '@zea-play/ui';
import { CalendarDays, ChevronLeft, ChevronRight, Edit, Plus, RotateCcw, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../../contexts/language-provider';
import type { Locale } from '../../../lib/i18n';
import {
  calendarKeys,
  cancelWorkspaceCalendarEvent,
  createWorkspaceCalendarEvent,
  getWorkspaceCalendar,
  updateWorkspaceCalendarEvent,
  type CalendarItem,
  type CalendarQueryParams,
  type CalendarSourceType,
  type CalendarView,
} from '../../../services/workspace-calendar';
import { listDepartments, listWorkspaceUsers } from '../../../services/workspace-management';
import { listWorkspaceStatuses } from '../../../services/workspace-statuses';
import type { TaskPriority } from '../../../services/workspace-tasks';
import { useSessionStore } from '../../../stores/session';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';

const sources: CalendarSourceType[] = ['TASK', 'PROJECT', 'TICKET', 'CUSTOM_EVENT'];
const priorities: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const views: CalendarView[] = ['month', 'week', 'day'];
type CalendarTranslator = (locale: Locale, key: `calendar.${string}`) => string;

export interface EventFormState {
  title: string;
  description: string;
  date: string;
  start: string;
  endDate: string;
  end: string;
  allDay: boolean;
  visibility: 'WORKSPACE' | 'PARTICIPANTS_ONLY' | 'PRIVATE';
  participantMembershipIds: string[];
}

const emptyForm: EventFormState = {
  title: '',
  description: '',
  date: todayKey(),
  start: '09:00',
  endDate: todayKey(),
  end: '10:00',
  allDay: false,
  visibility: 'WORKSPACE',
  participantMembershipIds: [],
};

export function WorkspaceCalendarPage() {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedWorkspace = useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === state.selectedWorkspaceId),
  );
  const workspaceTimezone = selectedWorkspace?.timezone ?? 'UTC';
  const view = normalizeView(searchParams.get('view'));
  const date = normalizeDate(searchParams.get('date'));
  const [sourceTypes, setSourceTypes] = useState<CalendarSourceType[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<TaskPriority[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [dateDetail, setDateDetail] = useState<string | null>(null);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarItem | null>(null);
  const [form, setForm] = useState<EventFormState>(emptyForm);

  useEffect(() => {
    setSourceTypes([]);
    setMemberIds([]);
    setDepartmentIds([]);
    setSelectedPriorities([]);
    setStatuses([]);
    setSelectedItem(null);
    setDateDetail(null);
  }, [workspaceId]);

  const range = useMemo(() => calendarRange(view, date), [date, view]);
  const params = useMemo<CalendarQueryParams>(
    () => ({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      sourceTypes: sourceTypes.length ? sourceTypes : undefined,
      memberIds: memberIds.length ? memberIds : undefined,
      departmentIds: departmentIds.length ? departmentIds : undefined,
      priorities: selectedPriorities.length ? selectedPriorities : undefined,
      statuses: statuses.length ? statuses : undefined,
    }),
    [departmentIds, memberIds, range.from, range.to, selectedPriorities, sourceTypes, statuses],
  );
  const calendarQuery = useQuery({
    queryKey: calendarKeys.range(workspaceId, view, date, params),
    queryFn: () => getWorkspaceCalendar(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const usersQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'calendar', 'members'],
    queryFn: () =>
      listWorkspaceUsers({ workspaceId: workspaceId as string, page: 1, pageSize: 100 }),
    enabled: Boolean(workspaceId),
  });
  const departmentsQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'calendar', 'departments'],
    queryFn: () => listDepartments({ workspaceId: workspaceId as string, page: 1, pageSize: 100 }),
    enabled: Boolean(workspaceId),
  });
  const taskStatuses = useQuery({
    queryKey: ['workspace', workspaceId, 'calendar', 'statuses', 'TASK'],
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId),
  });
  const projectStatuses = useQuery({
    queryKey: ['workspace', workspaceId, 'calendar', 'statuses', 'PROJECT'],
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'PROJECT', 'ACTIVE'),
    enabled: Boolean(workspaceId),
  });
  const ticketStatuses = useQuery({
    queryKey: ['workspace', workspaceId, 'calendar', 'statuses', 'TICKET'],
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TICKET', 'ACTIVE'),
    enabled: Boolean(workspaceId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspaceCalendarEvent(workspaceId as string, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        startAt: formToStartIso(form, workspaceTimezone),
        endAt: form.allDay ? null : formToEndIso(form, workspaceTimezone),
        allDay: form.allDay,
        timezone: workspaceTimezone,
        visibility: form.visibility,
        participantMembershipIds: form.participantMembershipIds,
      }),
    onSuccess: async () => {
      setEventFormOpen(false);
      setEditingEvent(null);
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    },
  });
  const updateMutation = useMutation({
    mutationFn: () =>
      updateWorkspaceCalendarEvent(workspaceId as string, editingEvent!.sourceId, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        startAt: formToStartIso(form, workspaceTimezone),
        endAt: form.allDay ? null : formToEndIso(form, workspaceTimezone),
        allDay: form.allDay,
        timezone: workspaceTimezone,
        visibility: form.visibility,
        participantMembershipIds: form.participantMembershipIds,
      }),
    onSuccess: async (updated) => {
      setEventFormOpen(false);
      setEditingEvent(null);
      setSelectedItem(updated);
      await queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (eventId: string) => cancelWorkspaceCalendarEvent(workspaceId as string, eventId),
    onSuccess: async () => {
      setSelectedItem(null);
      await queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    },
  });

  const items = calendarQuery.data?.items ?? [];
  const detailItems = dateDetail ? itemsForDate(items, dateDetail, workspaceTimezone) : [];
  const allStatuses = [
    ...(taskStatuses.data ?? []),
    ...(projectStatuses.data ?? []),
    ...(ticketStatuses.data ?? []),
  ];

  function setRoute(nextView: CalendarView, nextDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', nextView);
    params.set('date', nextDate);
    router.replace(`${pathname}?${params.toString()}` as never);
  }

  function openCreate(day = date) {
    setEditingEvent(null);
    setForm({ ...emptyForm, date: day, endDate: day });
    setEventFormOpen(true);
  }

  function openEdit(item: CalendarItem) {
    setEditingEvent(item);
    setForm(itemToForm(item, workspaceTimezone));
    setEventFormOpen(true);
  }

  function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) return;
    if (editingEvent) updateMutation.mutate();
    else createMutation.mutate();
  }

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'calendar.title')}
        description={`${t(locale, 'calendar.timezone')}: ${workspaceTimezone}`}
      />
      <div className="grid gap-4">
        <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRoute(view, shiftDate(view, date, -1))}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRoute(view, todayKey())}>
                {t(locale, 'calendar.today')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRoute(view, shiftDate(view, date, 1))}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <h2 className="text-base font-semibold">
                {formatHeading(date, view, locale, workspaceTimezone)}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md border border-[hsl(var(--border))] p-1">
                {views.map((item) => (
                  <button
                    key={item}
                    className={`rounded px-3 py-1 text-sm ${view === item ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : ''}`}
                    onClick={() => setRoute(item, date)}
                    type="button"
                  >
                    {t(locale, `calendar.${item}`)}
                  </button>
                ))}
              </div>
              <Button onClick={() => openCreate()} size="sm">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                {t(locale, 'calendar.newEvent')}
              </Button>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-5">
            <FilterSelect
              label={t(locale, 'calendar.source')}
              values={sourceTypes}
              onChange={(values) => setSourceTypes(values as CalendarSourceType[])}
              options={sources.map((source) => ({
                value: source,
                label: sourceLabel(source, t, locale),
              }))}
            />
            <FilterSelect
              label={t(locale, 'calendar.participants')}
              values={memberIds}
              onChange={setMemberIds}
              options={(usersQuery.data?.items ?? []).map((user) => ({
                value: user.membershipId,
                label: user.name || user.email,
              }))}
            />
            <FilterSelect
              label={t(locale, 'calendar.department')}
              values={departmentIds}
              onChange={setDepartmentIds}
              options={(departmentsQuery.data?.items ?? []).map((department) => ({
                value: department.id,
                label: department.name,
              }))}
            />
            <FilterSelect
              label={t(locale, 'calendar.priority')}
              values={selectedPriorities}
              onChange={(values) => setSelectedPriorities(values as TaskPriority[])}
              options={priorities.map((priority) => ({ value: priority, label: priority }))}
            />
            <FilterSelect
              label={t(locale, 'calendar.status')}
              values={statuses}
              onChange={setStatuses}
              options={allStatuses.map((status) => ({ value: status.id, label: status.name }))}
            />
          </div>
        </section>
        {calendarQuery.isLoading ? (
          <CalendarSkeleton />
        ) : calendarQuery.isError ? (
          <div className="rounded-md border border-[hsl(var(--border))] p-6 text-sm">
            {t(locale, 'calendar.unableToLoad')}
            <Button
              className="ml-3"
              size="sm"
              variant="outline"
              onClick={() => {
                void calendarQuery.refetch();
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
              {t(locale, 'common.tryAgain')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-[hsl(var(--border))] p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
            <CalendarDays className="mx-auto mb-2 h-8 w-8" aria-hidden />
            {t(locale, 'calendar.noEvents')}
          </div>
        ) : view === 'month' ? (
          <MonthView
            date={date}
            items={items}
            timezone={workspaceTimezone}
            onDate={(day) => setDateDetail(day)}
            onItem={setSelectedItem}
          />
        ) : view === 'week' ? (
          <WeekView
            days={weekDays(date)}
            items={items}
            locale={locale}
            timezone={workspaceTimezone}
            onItem={setSelectedItem}
          />
        ) : (
          <DayView
            day={date}
            items={itemsForDate(items, date, workspaceTimezone)}
            locale={locale}
            timezone={workspaceTimezone}
            onItem={setSelectedItem}
          />
        )}
      </div>
      {dateDetail ? (
        <aside className="fixed inset-y-0 right-0 z-40 grid w-full max-w-md gap-3 overflow-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              {formatDateLabel(dateDetail, locale, workspaceTimezone)}
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDateDetail(null)}
              aria-label={t(locale, 'common.close')}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <Button variant="outline" onClick={() => openCreate(dateDetail)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            {t(locale, 'calendar.newEvent')}
          </Button>
          <EventList
            items={detailItems}
            locale={locale}
            timezone={workspaceTimezone}
            onItem={setSelectedItem}
          />
        </aside>
      ) : null}
      {selectedItem ? (
        <aside className="fixed inset-y-0 right-0 z-50 grid w-full max-w-md content-start gap-4 overflow-auto border-l border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">
                {sourceLabel(selectedItem.sourceType, t, locale)}
              </span>
              <h2 className="text-xl font-semibold">{selectedItem.title}</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedItem(null)}
              aria-label={t(locale, 'common.close')}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <dl className="grid gap-2 text-sm">
            <Detail
              label={t(locale, 'calendar.start')}
              value={formatDateTime(selectedItem.startAt, locale, workspaceTimezone)}
            />
            <Detail
              label={t(locale, 'calendar.end')}
              value={
                selectedItem.endAt
                  ? formatDateTime(selectedItem.endAt, locale, workspaceTimezone)
                  : t(locale, 'calendar.due')
              }
            />
            <Detail label={t(locale, 'calendar.priority')} value={selectedItem.priority ?? '-'} />
            <Detail label={t(locale, 'calendar.status')} value={statusLabel(selectedItem.status)} />
            <Detail
              label={t(locale, 'calendar.visibility')}
              value={visibilityLabel(selectedItem.visibility, t, locale)}
            />
          </dl>
          <div className="flex flex-wrap gap-2">
            {sourceHref(selectedItem) ? (
              <a
                className="inline-flex h-10 items-center rounded-md border border-[hsl(var(--border))] px-4 text-sm font-medium hover:bg-[hsl(var(--accent))]"
                href={sourceHref(selectedItem)!}
              >
                {t(locale, 'calendar.openSource')}
              </a>
            ) : null}
            {selectedItem.sourceType === 'CUSTOM_EVENT' && selectedItem.editable ? (
              <>
                <Button onClick={() => openEdit(selectedItem)}>
                  <Edit className="mr-2 h-4 w-4" aria-hidden />
                  {t(locale, 'calendar.editEvent')}
                </Button>
                <Button
                  variant="danger"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(selectedItem.sourceId)}
                >
                  {t(locale, 'calendar.cancelEvent')}
                </Button>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}
      <Dialog open={eventFormOpen} onOpenChange={setEventFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingEvent ? t(locale, 'calendar.editEvent') : t(locale, 'calendar.newEvent')}
            </DialogTitle>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={submitEvent}>
            <label className="grid gap-1 text-sm font-medium">
              {t(locale, 'calendar.titleField')}
              <Input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                maxLength={160}
                required
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t(locale, 'calendar.description')}
              <Textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                maxLength={2000}
              />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(event) => setForm({ ...form, allDay: event.target.checked })}
              />
              {t(locale, 'calendar.allDay')}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                {t(locale, 'calendar.start')}
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      date: event.target.value,
                      endDate: form.endDate || event.target.value,
                    })
                  }
                  required
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                {t(locale, 'calendar.startTime')}
                <Input
                  type="time"
                  value={form.start}
                  disabled={form.allDay}
                  onChange={(event) => setForm({ ...form, start: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                {t(locale, 'calendar.end')}
                <Input
                  type="date"
                  value={form.endDate}
                  disabled={form.allDay}
                  onChange={(event) => setForm({ ...form, endDate: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                {t(locale, 'calendar.endTime')}
                <Input
                  type="time"
                  value={form.end}
                  disabled={form.allDay}
                  onChange={(event) => setForm({ ...form, end: event.target.value })}
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm font-medium">
              {t(locale, 'calendar.visibility')}
              <select
                className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3"
                value={form.visibility}
                onChange={(event) =>
                  setForm({
                    ...form,
                    visibility: event.target.value as EventFormState['visibility'],
                  })
                }
              >
                <option value="WORKSPACE">{t(locale, 'calendar.workspaceVisibility')}</option>
                <option value="PARTICIPANTS_ONLY">{t(locale, 'calendar.participantsOnly')}</option>
                <option value="PRIVATE">{t(locale, 'calendar.private')}</option>
              </select>
            </label>
            <FilterSelect
              label={t(locale, 'calendar.participants')}
              values={form.participantMembershipIds}
              onChange={(values) => setForm({ ...form, participantMembershipIds: values })}
              options={(usersQuery.data?.items ?? []).map((user) => ({
                value: user.membershipId,
                label: user.name || user.email,
              }))}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEventFormOpen(false)}>
                {t(locale, 'common.close')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {t(locale, 'workspaceSettings.save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function MonthView({
  date,
  items,
  timezone,
  onDate,
  onItem,
}: {
  date: string;
  items: CalendarItem[];
  timezone: string;
  onDate: (date: string) => void;
  onItem: (item: CalendarItem) => void;
}) {
  const days = monthGrid(date);
  return (
    <section className="grid grid-cols-7 overflow-hidden rounded-md border border-[hsl(var(--border))]">
      {days.map((day) => {
        const dayItems = itemsForDate(items, day.key, timezone);
        const counts = priorityCounts(dayItems);
        return (
          <button
            key={day.key}
            className={`min-h-28 border-b border-r border-[hsl(var(--border))] p-2 text-left ${day.inMonth ? 'bg-[hsl(var(--surface))]' : 'bg-[hsl(var(--muted))]/30'}`}
            onClick={() => onDate(day.key)}
            type="button"
          >
            <span className="text-xs font-semibold">
              {new Date(`${day.key}T12:00:00Z`).getUTCDate()}
            </span>
            <div className="mt-2 grid gap-1">
              {dayItems.slice(0, 3).map((item) => (
                <span
                  key={item.id}
                  className="truncate rounded bg-[hsl(var(--accent))] px-1.5 py-1 text-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    onItem(item);
                  }}
                >
                  {sourceShort(item.sourceType)} {item.title}
                </span>
              ))}
              {dayItems.length > 3 ? (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  +{dayItems.length - 3}
                </span>
              ) : null}
              {counts ? (
                <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{counts}</span>
              ) : null}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function WeekView(props: {
  days: string[];
  items: CalendarItem[];
  locale: string;
  timezone: string;
  onItem: (item: CalendarItem) => void;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-7">
      {props.days.map((day) => (
        <div
          key={day}
          className="min-h-72 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3"
        >
          <h3 className="mb-2 text-sm font-semibold">
            {formatDateLabel(day, props.locale, props.timezone)}
          </h3>
          <EventList
            items={itemsForDate(props.items, day, props.timezone)}
            locale={props.locale}
            timezone={props.timezone}
            onItem={props.onItem}
          />
        </div>
      ))}
    </section>
  );
}

function DayView(props: {
  day: string;
  items: CalendarItem[];
  locale: string;
  timezone: string;
  onItem: (item: CalendarItem) => void;
}) {
  return (
    <section className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <h2 className="mb-3 text-lg font-semibold">
        {formatDateLabel(props.day, props.locale, props.timezone)}
      </h2>
      <EventList {...props} />
    </section>
  );
}

function EventList({
  items,
  locale,
  timezone,
  onItem,
}: {
  items: CalendarItem[];
  locale: string;
  timezone: string;
  onItem: (item: CalendarItem) => void;
}) {
  if (items.length === 0)
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No Events</p>;
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          className="rounded-md border border-[hsl(var(--border))] p-3 text-left hover:bg-[hsl(var(--accent))]"
          onClick={() => onItem(item)}
          type="button"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase">{sourceShort(item.sourceType)}</span>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {item.allDay ? 'All Day' : formatTime(item.startAt, locale, timezone)}
            </span>
          </div>
          <p className="truncate text-sm font-medium">{item.title}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {statusLabel(item.status)} {item.priority ? `• ${item.priority}` : ''}
          </p>
        </button>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      {label}
      <select
        multiple
        className="min-h-20 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 text-sm"
        value={values}
        onChange={(event) =>
          onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
        }
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <dt className="text-[hsl(var(--muted-foreground))]">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CalendarSkeleton() {
  return <div className="h-[520px] animate-pulse rounded-md bg-[hsl(var(--muted))]" />;
}

function normalizeView(value: string | null): CalendarView {
  return views.includes(value as CalendarView) ? (value as CalendarView) : 'month';
}

function normalizeDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function calendarRange(view: CalendarView, date: string) {
  const base = new Date(`${date}T00:00:00.000Z`);
  if (view === 'day') return { from: base, to: addDays(base, 1) };
  if (view === 'week') {
    const start = addDays(base, -base.getUTCDay());
    return { from: start, to: addDays(start, 7) };
  }
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  return { from: start, to: new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1)) };
}

function monthGrid(date: string) {
  const base = new Date(`${date}T00:00:00.000Z`);
  const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const start = addDays(first, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(start, index);
    return {
      key: day.toISOString().slice(0, 10),
      inMonth: day.getUTCMonth() === base.getUTCMonth(),
    };
  });
}

function weekDays(date: string) {
  const base = new Date(`${date}T00:00:00.000Z`);
  const start = addDays(base, -base.getUTCDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index).toISOString().slice(0, 10));
}

function shiftDate(view: CalendarView, date: string, direction: number) {
  const base = new Date(`${date}T00:00:00.000Z`);
  const next =
    view === 'month'
      ? new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + direction, base.getUTCDate()))
      : addDays(base, direction * (view === 'week' ? 7 : 1));
  return next.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function itemsForDate(items: CalendarItem[], date: string, timezone: string) {
  return items
    .filter((item) => {
      const start = dateKeyInZone(item.startAt, timezone);
      const end = item.endAt ? dateKeyInZone(item.endAt, timezone) : start;
      return start <= date && date <= end;
    })
    .sort(calendarItemSort);
}

export function dateKeyInZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function formatHeading(date: string, view: CalendarView, locale: string, timezone: string) {
  const value = new Date(`${date}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: view === 'month' ? undefined : 'medium',
    month: view === 'month' ? 'long' : undefined,
    year: 'numeric',
    timeZone: timezone,
  }).format(value);
}

function formatDateLabel(date: string, locale: string, timezone: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone }).format(
    new Date(`${date}T12:00:00.000Z`),
  );
}

function formatDateTime(value: string, locale: string, timezone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

function formatTime(value: string, locale: string, timezone: string) {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: timezone }).format(
    new Date(value),
  );
}

export function formToStartIso(form: EventFormState, timezone = 'UTC') {
  return form.allDay
    ? zonedDateTimeToUtcIso(form.date, '00:00', timezone)
    : zonedDateTimeToUtcIso(form.date, form.start || '00:00', timezone);
}

export function formToEndIso(form: EventFormState, timezone = 'UTC') {
  return zonedDateTimeToUtcIso(
    form.endDate || form.date,
    form.end || form.start || '00:00',
    timezone,
  );
}

function itemToForm(item: CalendarItem, timezone: string): EventFormState {
  const startDate = dateKeyInZone(item.startAt, timezone);
  return {
    title: item.title,
    description: String(item.metadata.description ?? ''),
    date: startDate,
    start: timeInput(item.startAt, timezone),
    endDate: item.endAt ? dateKeyInZone(item.endAt, timezone) : startDate,
    end: item.endAt ? timeInput(item.endAt, timezone) : timeInput(item.startAt, timezone),
    allDay: item.allDay,
    visibility:
      item.visibility === 'PARTICIPANTS_ONLY' || item.visibility === 'PRIVATE'
        ? item.visibility
        : 'WORKSPACE',
    participantMembershipIds: item.participantMembershipIds,
  };
}

function timeInput(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === 'hour')?.value}:${parts.find((part) => part.type === 'minute')?.value}`;
}

function sourceLabel(source: CalendarSourceType, t: CalendarTranslator, locale: Locale) {
  const key =
    source === 'CUSTOM_EVENT' ? 'calendar.events' : (`calendar.${source.toLowerCase()}s` as const);
  return t(locale, key);
}

function sourceShort(source: CalendarSourceType) {
  return source === 'CUSTOM_EVENT' ? 'Event' : source[0] + source.slice(1).toLowerCase();
}

function statusLabel(status: CalendarItem['status']) {
  if (!status) return '-';
  return typeof status === 'string' ? status : status.name;
}

function visibilityLabel(
  visibility: CalendarItem['visibility'],
  t: CalendarTranslator,
  locale: Locale,
) {
  if (visibility === 'PARTICIPANTS_ONLY') return t(locale, 'calendar.participantsOnly');
  if (visibility === 'PRIVATE') return t(locale, 'calendar.private');
  if (visibility === 'WORKSPACE') return t(locale, 'calendar.workspaceVisibility');
  return visibility;
}

function sourceHref(item: CalendarItem) {
  if (item.sourceType === 'TASK') return `/workspace/tasks?taskId=${item.sourceId}`;
  if (item.sourceType === 'PROJECT') return `/workspace/projects/${item.sourceId}`;
  if (item.sourceType === 'TICKET') return `/workspace/tickets/${item.sourceId}`;
  return null;
}

function priorityCounts(items: CalendarItem[]) {
  const counts = priorities
    .map(
      (priority) => [priority, items.filter((item) => item.priority === priority).length] as const,
    )
    .filter(([, count]) => count > 0);
  return counts.map(([priority, count]) => `${priority[0]} ${count}`).join(' ');
}

function zonedDateTimeToUtcIso(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!year || !month || !day) return new Date(`${date}T00:00:00.000Z`).toISOString();
  const utcGuess = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0, 0);
  const offset = timezoneOffsetMs(new Date(utcGuess), timezone);
  const firstPass = new Date(utcGuess - offset);
  const correctedOffset = timezoneOffsetMs(firstPass, timezone);
  return new Date(utcGuess - correctedOffset).toISOString();
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
  return asUtc - date.getTime();
}

function calendarItemSort(left: CalendarItem, right: CalendarItem) {
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
  return (
    left.startAt.localeCompare(right.startAt) ||
    left.sourceType.localeCompare(right.sourceType) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}
