import { TicketSlaBusinessMode } from '@prisma/client';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  validateSlaCalendar,
} from './ticket-sla-business-time';

const calendar = {
  businessMode: TicketSlaBusinessMode.BUSINESS_HOURS,
  timezone: 'America/New_York',
  businessHours: {
    '1': [{ start: '09:00', end: '17:00' }],
    '2': [{ start: '09:00', end: '17:00' }],
    '3': [{ start: '09:00', end: '17:00' }],
    '4': [{ start: '09:00', end: '17:00' }],
    '5': [{ start: '09:00', end: '17:00' }],
    '6': [],
    '7': [],
  },
  holidayDates: [],
};

describe('ticket SLA business time', () => {
  it('supports explicit 24x7 ALWAYS mode without business windows', () => {
    const due = addBusinessMinutes(new Date('2026-01-05T15:00:00.000Z'), 90, {
      businessMode: TicketSlaBusinessMode.ALWAYS,
      timezone: 'America/New_York',
      businessHours: {},
      holidayDates: ['2026-01-05'],
    });
    expect(due.toISOString()).toBe('2026-01-05T16:30:00.000Z');
  });

  it('rejects BUSINESS_HOURS calendars with an empty work week', () => {
    expect(() =>
      validateSlaCalendar({
        businessMode: TicketSlaBusinessMode.BUSINESS_HOURS,
        timezone: 'America/New_York',
        businessHours: {},
        holidayDates: [],
      }),
    ).toThrow('SLA_BUSINESS_HOURS_EMPTY');
  });

  it('adds inside the current working window', () => {
    const due = addBusinessMinutes(new Date('2026-01-05T15:00:00.000Z'), 60, calendar);
    expect(due.toISOString()).toBe('2026-01-05T16:00:00.000Z');
  });

  it('handles opening, closing, before-opening, and after-closing boundaries', () => {
    expect(
      addBusinessMinutes(new Date('2026-01-05T14:00:00.000Z'), 30, calendar).toISOString(),
    ).toBe('2026-01-05T14:30:00.000Z');
    expect(
      addBusinessMinutes(new Date('2026-01-05T13:30:00.000Z'), 30, calendar).toISOString(),
    ).toBe('2026-01-05T14:30:00.000Z');
    expect(
      addBusinessMinutes(new Date('2026-01-05T22:00:00.000Z'), 30, calendar).toISOString(),
    ).toBe('2026-01-06T14:30:00.000Z');
    expect(
      addBusinessMinutes(new Date('2026-01-05T23:00:00.000Z'), 30, calendar).toISOString(),
    ).toBe('2026-01-06T14:30:00.000Z');
  });

  it('skips closed periods and weekends', () => {
    const due = addBusinessMinutes(new Date('2026-01-09T21:30:00.000Z'), 120, calendar);
    expect(due.toISOString()).toBe('2026-01-12T15:30:00.000Z');
  });

  it('skips holiday dates in the policy timezone', () => {
    const due = addBusinessMinutes(new Date('2026-12-24T20:00:00.000Z'), 180, {
      ...calendar,
      holidayDates: ['2026-12-25'],
    });
    expect(due.toISOString()).toBe('2026-12-28T15:00:00.000Z');
  });

  it('counts business minutes across partial windows', () => {
    const minutes = businessMinutesBetween(
      new Date('2026-01-05T14:30:00.000Z'),
      new Date('2026-01-06T15:30:00.000Z'),
      calendar,
    );
    expect(minutes).toBe(540);
  });

  it('supports split shifts and adjacent windows deterministically', () => {
    const split = {
      ...calendar,
      businessHours: {
        ...calendar.businessHours,
        '1': [
          { start: '09:00', end: '12:00' },
          { start: '13:00', end: '17:00' },
        ],
        '2': [
          { start: '09:00', end: '12:00' },
          { start: '12:00', end: '17:00' },
        ],
      },
    };

    expect(addBusinessMinutes(new Date('2026-01-05T16:30:00.000Z'), 90, split).toISOString()).toBe(
      '2026-01-05T19:00:00.000Z',
    );
    expect(
      businessMinutesBetween(
        new Date('2026-01-05T14:00:00.000Z'),
        new Date('2026-01-06T15:30:00.000Z'),
        split,
      ),
    ).toBe(510);
  });

  it('normalizes duplicate holidays and leaves holidays on non-working days harmless', () => {
    const normalized = validateSlaCalendar({
      ...calendar,
      holidayDates: ['2026-01-10', '2026-01-10', '2026-01-12'],
    });
    expect(normalized.holidayDates).toEqual(['2026-01-10', '2026-01-12']);
    const due = addBusinessMinutes(new Date('2026-01-09T21:00:00.000Z'), 120, normalized);
    expect(due.toISOString()).toBe('2026-01-13T15:00:00.000Z');
  });

  it('is DST-safe across spring-forward and fall-back weekends', () => {
    const spring = addBusinessMinutes(new Date('2026-03-06T21:00:00.000Z'), 120, calendar);
    expect(spring.toISOString()).toBe('2026-03-09T14:00:00.000Z');

    const fall = addBusinessMinutes(new Date('2026-10-30T20:00:00.000Z'), 180, calendar);
    expect(fall.toISOString()).toBe('2026-11-02T16:00:00.000Z');
  });
});
