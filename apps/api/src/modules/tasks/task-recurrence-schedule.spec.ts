import {
  TaskRecurrenceCustomUnit,
  TaskRecurrenceEndMode,
  TaskRecurrenceFrequency,
} from '@prisma/client';
import {
  firstFutureOccurrenceAfter,
  firstOccurrence,
  nextOccurrenceAfter,
} from './task-recurrence-schedule';

const base = {
  timezone: 'America/New_York',
  interval: 1,
  customIntervalUnit: null,
  selectedWeekdays: [],
  monthlyDay: null,
  endMode: TaskRecurrenceEndMode.NEVER,
  untilLocalDate: null,
  maxOccurrences: null,
};

describe('task recurrence schedule', () => {
  it('calculates daily occurrences by local wall-clock time', () => {
    const input = {
      ...base,
      frequency: TaskRecurrenceFrequency.DAILY,
      startLocalDate: '2026-01-10',
      localTime: '09:30',
    };
    const first = firstOccurrence(input)!;
    const second = nextOccurrenceAfter(input, first.toJSDate(), 1)!;
    expect(first.setZone(input.timezone).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-01-10 09:30');
    expect(second.setZone(input.timezone).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-01-11 09:30');
  });

  it('skips weekends for weekday recurrence', () => {
    const input = {
      ...base,
      frequency: TaskRecurrenceFrequency.WEEKDAYS,
      startLocalDate: '2026-01-02',
      localTime: '10:00',
    };
    const friday = firstOccurrence(input)!;
    const monday = nextOccurrenceAfter(input, friday.toJSDate(), 1)!;
    expect(friday.weekday).toBe(5);
    expect(monday.setZone(input.timezone).toISODate()).toBe('2026-01-05');
  });

  it('supports weekly selected weekdays', () => {
    const input = {
      ...base,
      frequency: TaskRecurrenceFrequency.WEEKLY,
      startLocalDate: '2026-01-05',
      localTime: '11:00',
      selectedWeekdays: [1, 3, 5],
    };
    const monday = firstOccurrence(input)!;
    const wednesday = nextOccurrenceAfter(input, monday.toJSDate(), 1)!;
    expect(wednesday.weekday).toBe(3);
  });

  it('clamps monthly dates and returns to the configured day when possible', () => {
    const input = {
      ...base,
      frequency: TaskRecurrenceFrequency.MONTHLY,
      startLocalDate: '2026-01-31',
      localTime: '08:00',
      monthlyDay: 31,
    };
    const jan = firstOccurrence(input)!;
    const feb = nextOccurrenceAfter(input, jan.toJSDate(), 1)!;
    const mar = nextOccurrenceAfter(input, feb.toJSDate(), 2)!;
    expect(feb.setZone(input.timezone).toISODate()).toBe('2026-02-28');
    expect(mar.setZone(input.timezone).toISODate()).toBe('2026-03-31');
  });

  it('supports custom day, week, and month intervals', () => {
    const daily = {
      ...base,
      frequency: TaskRecurrenceFrequency.CUSTOM,
      customIntervalUnit: TaskRecurrenceCustomUnit.DAY,
      interval: 3,
      startLocalDate: '2026-01-01',
      localTime: '08:00',
    };
    const weekly = { ...daily, customIntervalUnit: TaskRecurrenceCustomUnit.WEEK, interval: 2 };
    const monthly = {
      ...daily,
      customIntervalUnit: TaskRecurrenceCustomUnit.MONTH,
      interval: 2,
    };
    expect(nextOccurrenceAfter(daily, firstOccurrence(daily)!.toJSDate(), 1)!.toISODate()).toBe(
      '2026-01-04',
    );
    expect(nextOccurrenceAfter(weekly, firstOccurrence(weekly)!.toJSDate(), 1)!.toISODate()).toBe(
      '2026-01-15',
    );
    expect(nextOccurrenceAfter(monthly, firstOccurrence(monthly)!.toJSDate(), 1)!.toISODate()).toBe(
      '2026-03-01',
    );
  });

  it('honors inclusive on-date and after-count endings', () => {
    const onDate = {
      ...base,
      frequency: TaskRecurrenceFrequency.DAILY,
      startLocalDate: '2026-01-01',
      localTime: '09:00',
      endMode: TaskRecurrenceEndMode.ON_DATE,
      untilLocalDate: '2026-01-02',
    };
    const first = firstOccurrence(onDate)!;
    const second = nextOccurrenceAfter(onDate, first.toJSDate(), 1)!;
    expect(nextOccurrenceAfter(onDate, second.toJSDate(), 2)).toBeNull();

    const afterCount = {
      ...onDate,
      endMode: TaskRecurrenceEndMode.AFTER_COUNT,
      untilLocalDate: null,
      maxOccurrences: 1,
    };
    expect(nextOccurrenceAfter(afterCount, firstOccurrence(afterCount)!.toJSDate(), 1)).toBeNull();
  });

  it('preserves local wall-clock time across DST changes', () => {
    const input = {
      ...base,
      frequency: TaskRecurrenceFrequency.DAILY,
      startLocalDate: '2026-03-07',
      localTime: '02:30',
    };
    const mar7 = firstOccurrence(input)!;
    const mar8 = nextOccurrenceAfter(input, mar7.toJSDate(), 1)!;
    const novInput = { ...input, startLocalDate: '2026-10-31', localTime: '01:30' };
    const oct31 = firstOccurrence(novInput)!;
    const nov1 = nextOccurrenceAfter(novInput, oct31.toJSDate(), 1)!;
    expect(mar8.setZone(input.timezone).toISODate()).toBe('2026-03-08');
    expect(mar8.setZone(input.timezone).hour).toBeGreaterThanOrEqual(2);
    expect(nov1.setZone(input.timezone).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-11-01 01:30');
  });

  it('rejects fixed-offset timezone strings', () => {
    expect(() =>
      firstOccurrence({
        ...base,
        timezone: 'UTC+0530',
        frequency: TaskRecurrenceFrequency.DAILY,
        startLocalDate: '2026-01-01',
        localTime: '09:00',
      }),
    ).toThrow('Recurrence timezone must be a valid IANA timezone.');
  });

  it('finds the first future schedule without skipping same-day resume windows', () => {
    const input = {
      ...base,
      frequency: TaskRecurrenceFrequency.DAILY,
      startLocalDate: '2026-01-01',
      localTime: '09:00',
    };
    const beforeTodayRun = new Date('2026-01-05T13:00:00.000Z');
    const afterTodayRun = new Date('2026-01-05T15:00:00.000Z');

    expect(
      firstFutureOccurrenceAfter(input, beforeTodayRun, 2)!
        .setZone(input.timezone)
        .toFormat('yyyy-MM-dd HH:mm'),
    ).toBe('2026-01-05 09:00');
    expect(
      firstFutureOccurrenceAfter(input, afterTodayRun, 2)!
        .setZone(input.timezone)
        .toFormat('yyyy-MM-dd HH:mm'),
    ).toBe('2026-01-06 09:00');
  });
});
