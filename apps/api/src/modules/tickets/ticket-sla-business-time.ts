import { BadRequestException } from '@nestjs/common';
import { TicketSlaBusinessMode } from '@prisma/client';
import { DateTime } from 'luxon';
import { isValidIanaTimezone } from '../../common/timezones';

export const SLA_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const MAX_SLA_TARGET_MINUTES = 525_600;

export interface TicketSlaBusinessInterval {
  start: string;
  end: string;
}

export type TicketSlaWeeklyHours = Record<string, TicketSlaBusinessInterval[]>;

export interface TicketSlaCalendarSnapshot {
  businessMode: TicketSlaBusinessMode;
  timezone: string;
  businessHours: TicketSlaWeeklyHours;
  holidayDates: string[];
}

export function validateSlaCalendar(input: TicketSlaCalendarSnapshot): TicketSlaCalendarSnapshot {
  if (!isValidIanaTimezone(input.timezone)) {
    throw new BadRequestException('SLA_TIMEZONE_INVALID');
  }
  const holidayDates = [...new Set(input.holidayDates ?? [])].sort();
  for (const date of holidayDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('SLA_HOLIDAY_INVALID');
    const parsed = DateTime.fromISO(date, { zone: input.timezone });
    if (!parsed.isValid) throw new BadRequestException('SLA_HOLIDAY_INVALID');
  }
  if (input.businessMode === TicketSlaBusinessMode.ALWAYS) {
    return {
      businessMode: input.businessMode,
      timezone: input.timezone,
      businessHours: normalizeBusinessHours({}),
      holidayDates,
    };
  }
  const hasWorkingWindow = Object.values(input.businessHours ?? {}).some(
    (intervals) => intervals.length > 0,
  );
  if (!hasWorkingWindow) throw new BadRequestException('SLA_BUSINESS_HOURS_EMPTY');
  return {
    businessMode: input.businessMode,
    timezone: input.timezone,
    businessHours: normalizeBusinessHours(input.businessHours),
    holidayDates,
  };
}

export function addBusinessMinutes(
  startInstant: Date,
  minutes: number,
  calendar: TicketSlaCalendarSnapshot,
) {
  validateTargetMinutes(minutes);
  const normalized = validateSlaCalendar(calendar);
  if (normalized.businessMode === TicketSlaBusinessMode.ALWAYS) {
    return DateTime.fromJSDate(startInstant).toUTC().plus({ minutes }).toJSDate();
  }
  let remaining = minutes;
  let cursor = DateTime.fromJSDate(startInstant).setZone(normalized.timezone);
  for (let guard = 0; guard < 3700; guard += 1) {
    const interval = currentOrNextInterval(cursor, normalized);
    if (!interval) throw new BadRequestException('SLA_BUSINESS_HOURS_EMPTY');
    if (cursor < interval.start) cursor = interval.start;
    const available = Math.max(0, Math.floor(interval.end.diff(cursor, 'minutes').minutes));
    if (remaining <= available) return cursor.plus({ minutes: remaining }).toUTC().toJSDate();
    remaining -= available;
    cursor = interval.end.plus({ milliseconds: 1 });
  }
  throw new BadRequestException('SLA_DEADLINE_OUT_OF_RANGE');
}

export function businessMinutesBetween(
  startInstant: Date,
  endInstant: Date,
  calendar: TicketSlaCalendarSnapshot,
) {
  const normalized = validateSlaCalendar(calendar);
  let start = DateTime.fromJSDate(startInstant).setZone(normalized.timezone);
  const end = DateTime.fromJSDate(endInstant).setZone(normalized.timezone);
  if (end <= start) return 0;
  if (normalized.businessMode === TicketSlaBusinessMode.ALWAYS) {
    return Math.floor(end.diff(start, 'minutes').minutes);
  }
  let total = 0;
  for (let guard = 0; guard < 3700 && start < end; guard += 1) {
    const interval = currentOrNextInterval(start, normalized);
    if (!interval) return total;
    if (interval.start >= end) return total;
    const effectiveStart = start > interval.start ? start : interval.start;
    const effectiveEnd = end < interval.end ? end : interval.end;
    if (effectiveEnd > effectiveStart) {
      total += Math.floor(effectiveEnd.diff(effectiveStart, 'minutes').minutes);
    }
    start = interval.end.plus({ milliseconds: 1 });
  }
  return total;
}

export function validateTargetMinutes(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SLA_TARGET_MINUTES) {
    throw new BadRequestException('SLA_TARGET_MINUTES_INVALID');
  }
}

export function defaultBusinessHours(): TicketSlaWeeklyHours {
  return normalizeBusinessHours({
    '1': [{ start: '09:00', end: '17:00' }],
    '2': [{ start: '09:00', end: '17:00' }],
    '3': [{ start: '09:00', end: '17:00' }],
    '4': [{ start: '09:00', end: '17:00' }],
    '5': [{ start: '09:00', end: '17:00' }],
  });
}

function normalizeBusinessHours(input: Record<string, TicketSlaBusinessInterval[]>) {
  const normalized: TicketSlaWeeklyHours = {};
  for (const weekday of SLA_WEEKDAYS) {
    const intervals = [...(input[String(weekday)] ?? [])].map((interval) => ({
      start: normalizeTime(interval.start),
      end: normalizeTime(interval.end),
    }));
    intervals.sort((a, b) => a.start.localeCompare(b.start));
    let previousEnd: string | null = null;
    for (const interval of intervals) {
      if (interval.start >= interval.end) throw new BadRequestException('SLA_INTERVAL_INVALID');
      if (previousEnd && interval.start < previousEnd) {
        throw new BadRequestException('SLA_INTERVAL_OVERLAP');
      }
      previousEnd = interval.end;
    }
    normalized[String(weekday)] = intervals;
  }
  return normalized;
}

function normalizeTime(value: string) {
  if (!/^[0-2]\d:[0-5]\d$/.test(value)) throw new BadRequestException('SLA_TIME_INVALID');
  const [hour, minute] = value.split(':').map(Number);
  if (hour! > 23 || minute! > 59) throw new BadRequestException('SLA_TIME_INVALID');
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function currentOrNextInterval(cursor: DateTime, calendar: TicketSlaCalendarSnapshot) {
  let day = cursor.setZone(calendar.timezone);
  for (let offset = 0; offset < 370; offset += 1) {
    const localDate = day.toISODate()!;
    const intervals = calendar.holidayDates.includes(localDate)
      ? []
      : (calendar.businessHours[String(day.weekday)] ?? []);
    for (const interval of intervals) {
      const start = DateTime.fromISO(`${localDate}T${interval.start}`, {
        zone: calendar.timezone,
      });
      const end = DateTime.fromISO(`${localDate}T${interval.end}`, { zone: calendar.timezone });
      if (cursor <= end) return { start, end };
    }
    day = day.plus({ days: 1 }).startOf('day');
    cursor = day;
  }
  return null;
}
