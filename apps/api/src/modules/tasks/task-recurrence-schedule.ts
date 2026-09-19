import { BadRequestException } from '@nestjs/common';
import {
  TaskRecurrenceCustomUnit,
  TaskRecurrenceEndMode,
  TaskRecurrenceFrequency,
} from '@prisma/client';
import { DateTime } from 'luxon';
import { isValidIanaTimezone } from '../../common/timezones';

export const MAX_RECURRENCE_INTERVAL = 366;
export const MAX_RECURRENCE_OCCURRENCES = 10_000;
export const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 7] as const;

export interface RecurrenceScheduleInput {
  timezone: string;
  frequency: TaskRecurrenceFrequency;
  interval: number;
  customIntervalUnit?: TaskRecurrenceCustomUnit | null;
  startLocalDate: string;
  localTime: string;
  selectedWeekdays?: number[];
  monthlyDay?: number | null;
  endMode: TaskRecurrenceEndMode;
  untilLocalDate?: string | null;
  maxOccurrences?: number | null;
}

export function validateRecurrenceSchedule(input: RecurrenceScheduleInput) {
  if (!isValidIanaTimezone(input.timezone)) {
    throw new BadRequestException('Recurrence timezone must be a valid IANA timezone.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startLocalDate)) {
    throw new BadRequestException('Recurrence start date is invalid.');
  }
  if (!/^[0-2]\d:[0-5]\d$/.test(input.localTime)) {
    throw new BadRequestException('Recurrence time is invalid.');
  }
  const [hour, minute] = input.localTime.split(':').map(Number);
  if (hour! > 23 || minute! > 59) throw new BadRequestException('Recurrence time is invalid.');
  if (
    !Number.isInteger(input.interval) ||
    input.interval < 1 ||
    input.interval > MAX_RECURRENCE_INTERVAL
  ) {
    throw new BadRequestException('Recurrence interval is invalid.');
  }
  const start = localDateTime(input.startLocalDate, input.localTime, input.timezone);
  if (!start.isValid) throw new BadRequestException('Recurrence start date is invalid.');

  const weekdays = uniqueWeekdays(input.selectedWeekdays ?? []);
  if (input.frequency === TaskRecurrenceFrequency.WEEKLY && weekdays.length === 0) {
    throw new BadRequestException('Weekly recurrence requires at least one weekday.');
  }
  if (input.frequency !== TaskRecurrenceFrequency.WEEKLY && weekdays.length > 0) {
    throw new BadRequestException('Selected weekdays are only supported for weekly recurrence.');
  }
  if (input.frequency === TaskRecurrenceFrequency.CUSTOM && !input.customIntervalUnit) {
    throw new BadRequestException('Custom recurrence requires an interval unit.');
  }
  if (input.frequency !== TaskRecurrenceFrequency.CUSTOM && input.customIntervalUnit) {
    throw new BadRequestException('Custom interval unit is only supported for custom recurrence.');
  }
  if (input.monthlyDay !== null && input.monthlyDay !== undefined) {
    if (!Number.isInteger(input.monthlyDay) || input.monthlyDay < 1 || input.monthlyDay > 31) {
      throw new BadRequestException('Monthly recurrence day is invalid.');
    }
    if (input.frequency !== TaskRecurrenceFrequency.MONTHLY) {
      throw new BadRequestException('Monthly day is only supported for monthly recurrence.');
    }
  }
  if (input.endMode === TaskRecurrenceEndMode.ON_DATE) {
    if (!input.untilLocalDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.untilLocalDate)) {
      throw new BadRequestException('Recurrence end date is invalid.');
    }
    const until = DateTime.fromISO(input.untilLocalDate, { zone: input.timezone }).startOf('day');
    if (!until.isValid || until < start.startOf('day')) {
      throw new BadRequestException('Recurrence end date cannot be before the start date.');
    }
  } else if (input.untilLocalDate) {
    throw new BadRequestException('End date is only supported for On Date recurrence.');
  }
  if (input.endMode === TaskRecurrenceEndMode.AFTER_COUNT) {
    if (
      !Number.isInteger(input.maxOccurrences) ||
      !input.maxOccurrences ||
      input.maxOccurrences < 1 ||
      input.maxOccurrences > MAX_RECURRENCE_OCCURRENCES
    ) {
      throw new BadRequestException('Recurrence occurrence count is invalid.');
    }
  } else if (input.maxOccurrences !== null && input.maxOccurrences !== undefined) {
    throw new BadRequestException('Occurrence count is only supported for After Count recurrence.');
  }
  return {
    start,
    selectedWeekdays: weekdays,
    monthlyDay:
      input.monthlyDay ?? (input.frequency === TaskRecurrenceFrequency.MONTHLY ? start.day : null),
  };
}

export function firstOccurrence(input: RecurrenceScheduleInput) {
  const normalized = validateRecurrenceSchedule(input);
  const candidate =
    input.frequency === TaskRecurrenceFrequency.WEEKLY
      ? nextWeeklyOccurrence(
          input,
          normalized.start.minus({ days: 1 }),
          normalized.selectedWeekdays,
        )
      : normalizeMonthlyIfNeeded(input, normalized.start, normalized.monthlyDay);
  return withinEnd(candidate, input) ? candidate : null;
}

export function nextOccurrenceAfter(
  input: RecurrenceScheduleInput,
  previousOrCursor: Date,
  generatedCount: number,
) {
  validateRecurrenceSchedule(input);
  if (
    input.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
    input.maxOccurrences &&
    generatedCount >= input.maxOccurrences
  ) {
    return null;
  }
  const cursor = DateTime.fromJSDate(previousOrCursor, { zone: input.timezone });
  let candidate: DateTime;
  switch (input.frequency) {
    case TaskRecurrenceFrequency.DAILY:
      candidate = nextDaily(input, cursor);
      break;
    case TaskRecurrenceFrequency.WEEKDAYS:
      candidate = nextWeekday(input, cursor);
      break;
    case TaskRecurrenceFrequency.WEEKLY:
      candidate = nextWeeklyOccurrence(input, cursor, uniqueWeekdays(input.selectedWeekdays ?? []));
      break;
    case TaskRecurrenceFrequency.MONTHLY:
      candidate = nextMonthly(input, cursor, input.monthlyDay ?? cursor.day);
      break;
    case TaskRecurrenceFrequency.CUSTOM:
      candidate = nextCustom(input, cursor);
      break;
  }
  return withinEnd(candidate, input) ? candidate : null;
}

export function firstFutureOccurrenceAfter(
  input: RecurrenceScheduleInput,
  after: Date,
  generatedCount: number,
) {
  const normalized = validateRecurrenceSchedule(input);
  if (
    input.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
    input.maxOccurrences &&
    generatedCount >= input.maxOccurrences
  ) {
    return null;
  }
  let candidate =
    input.frequency === TaskRecurrenceFrequency.WEEKLY
      ? nextWeeklyOccurrence(
          input,
          normalized.start.minus({ days: 1 }),
          normalized.selectedWeekdays,
        )
      : normalizeMonthlyIfNeeded(input, normalized.start, normalized.monthlyDay);
  let sequence = 1;
  const cursor = DateTime.fromJSDate(after, { zone: input.timezone });
  while (candidate <= cursor && sequence < MAX_RECURRENCE_OCCURRENCES) {
    sequence += 1;
    const next = nextOccurrenceAfter(input, candidate.toJSDate(), sequence - 1);
    if (!next) return null;
    candidate = next;
  }
  if (
    input.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
    input.maxOccurrences &&
    sequence > input.maxOccurrences
  ) {
    return null;
  }
  return candidate;
}

export function localDateTime(localDate: string, localTime: string, timezone: string) {
  return DateTime.fromISO(`${localDate}T${localTime}`, { zone: timezone }).setZone(timezone);
}

export function localDateString(date: DateTime | Date, timezone: string) {
  const value =
    date instanceof Date ? DateTime.fromJSDate(date, { zone: timezone }) : date.setZone(timezone);
  return value.toISODate()!;
}

function nextDaily(input: RecurrenceScheduleInput, cursor: DateTime) {
  const nextDate = cursor.setZone(input.timezone).plus({ days: input.interval }).toISODate()!;
  return localDateTime(nextDate, input.localTime, input.timezone);
}

function nextWeekday(input: RecurrenceScheduleInput, cursor: DateTime) {
  let candidate = cursor.setZone(input.timezone).plus({ days: 1 });
  for (let i = 0; i < 14; i += 1) {
    if (candidate.weekday <= 5)
      return localDateTime(candidate.toISODate()!, input.localTime, input.timezone);
    candidate = candidate.plus({ days: 1 });
  }
  return localDateTime(candidate.toISODate()!, input.localTime, input.timezone);
}

function nextWeeklyOccurrence(
  input: RecurrenceScheduleInput,
  cursor: DateTime,
  weekdays: number[],
) {
  let candidate = cursor.setZone(input.timezone).plus({ days: 1 });
  const startWeek = localDateTime(input.startLocalDate, input.localTime, input.timezone).startOf(
    'week',
  );
  for (let i = 0; i < 370; i += 1) {
    const weeksSinceStart = Math.floor(candidate.startOf('week').diff(startWeek, 'weeks').weeks);
    if (
      weeksSinceStart >= 0 &&
      weeksSinceStart % input.interval === 0 &&
      weekdays.includes(candidate.weekday)
    ) {
      return localDateTime(candidate.toISODate()!, input.localTime, input.timezone);
    }
    candidate = candidate.plus({ days: 1 });
  }
  throw new BadRequestException('Unable to calculate weekly recurrence.');
}

function nextMonthly(input: RecurrenceScheduleInput, cursor: DateTime, monthlyDay: number) {
  const next = cursor.setZone(input.timezone).plus({ months: input.interval });
  return localDateTime(
    clampedMonthDate(next.year, next.month, monthlyDay),
    input.localTime,
    input.timezone,
  );
}

function nextCustom(input: RecurrenceScheduleInput, cursor: DateTime) {
  if (input.customIntervalUnit === TaskRecurrenceCustomUnit.DAY) {
    return localDateTime(
      cursor.plus({ days: input.interval }).toISODate()!,
      input.localTime,
      input.timezone,
    );
  }
  if (input.customIntervalUnit === TaskRecurrenceCustomUnit.WEEK) {
    return localDateTime(
      cursor.plus({ weeks: input.interval }).toISODate()!,
      input.localTime,
      input.timezone,
    );
  }
  const next = cursor.plus({ months: input.interval });
  const anchorDay = localDateTime(input.startLocalDate, input.localTime, input.timezone).day;
  return localDateTime(
    clampedMonthDate(next.year, next.month, anchorDay),
    input.localTime,
    input.timezone,
  );
}

function normalizeMonthlyIfNeeded(
  input: RecurrenceScheduleInput,
  start: DateTime,
  monthlyDay: number | null,
) {
  if (input.frequency !== TaskRecurrenceFrequency.MONTHLY || !monthlyDay) return start;
  return localDateTime(
    clampedMonthDate(start.year, start.month, monthlyDay),
    input.localTime,
    input.timezone,
  );
}

function clampedMonthDate(year: number, month: number, day: number) {
  const end = DateTime.local(year, month).endOf('month').day;
  return DateTime.local(year, month, Math.min(day, end)).toISODate()!;
}

function withinEnd(candidate: DateTime, input: RecurrenceScheduleInput) {
  if (input.endMode !== TaskRecurrenceEndMode.ON_DATE || !input.untilLocalDate) return true;
  const until = DateTime.fromISO(input.untilLocalDate, { zone: input.timezone }).endOf('day');
  return candidate <= until;
}

function uniqueWeekdays(values: number[]) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.some((value) => !Number.isInteger(value) || value < 1 || value > 7)) {
    throw new BadRequestException('Recurrence weekdays are invalid.');
  }
  return unique;
}
