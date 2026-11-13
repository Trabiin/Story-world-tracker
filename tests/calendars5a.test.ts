import { describe, expect, it } from 'vitest';
import {
  CustomCalendar, calendarProblems, calendarTemplate, customDayLabel, customToDay, customYearDays, dayInCalendars, dayToCustom, formatDayNumber,
  fromDayNumber, isCustomLeap, isLeapYear, parseCustomDay, parseFuzzyDate, toDayNumber,
} from '../src/core';

const EPOCH = toDayNumber({ year: 724, month: 3, day: 1 }); // year 1 AR starts on 1 March 724
const thirteen = (): CustomCalendar => calendarTemplate('thirteen', 'cal-13', EPOCH);

describe('TL-2 custom calendar arithmetic', () => {
  it('a Gregorian-shaped calendar matches the Gregorian one day for day', () => {
    const g: CustomCalendar = { ...calendarTemplate('twelve', 'g', toDayNumber({ year: 1, month: 1, day: 1 })) };
    for (const y of [1, 4, 100, 400, 1042, 2000]) expect(isCustomLeap(g, y)).toBe(isLeapYear(y));
    for (const n of [toDayNumber({ year: 1042, month: 5, day: 3 }), toDayNumber({ year: 2000, month: 2, day: 29 }), toDayNumber({ year: 1900, month: 3, day: 1 }), toDayNumber({ year: -50, month: 7, day: 9 })]) {
      expect(dayToCustom(g, n)).toEqual(fromDayNumber(n));
      expect(customToDay(g, fromDayNumber(n))).toBe(n);
    }
  });
  it('round-trips every day across many years, before and after year 1', () => {
    const c = thirteen();
    for (let n = EPOCH - 3000; n < EPOCH + 200000; n += 37) expect(customToDay(c, dayToCustom(c, n))).toBe(n);
    expect(dayToCustom(c, EPOCH)).toEqual({ year: 1, month: 1, day: 1 });
    expect(dayToCustom(c, EPOCH - 1)).toEqual({ year: 0, month: 14, day: customYearDays(c, 0) - 13 * 28 });
    expect(customYearDays(c, 1)).toBe(365);
    expect(customYearDays(c, 4)).toBe(366);
  });
  it('flags unusable calendars', () => {
    expect(calendarProblems(thirteen())).toEqual([]);
    expect(calendarProblems({ ...thirteen(), months: [{ name: 'A', days: 0 }, { name: 'a', days: 3 }] })).toEqual(['A: days must be a whole number from 1 to 400.', 'Two months have the same name.']);
  });
});

describe('TL-2 converter (dates stay Gregorian)', () => {
  it('shows a day in every calendar, with the weekday', () => {
    const c = thirteen();
    const day = customToDay(c, { year: 318, month: 2, day: 3 });
    const all = dayInCalendars([c, { ...c, id: 'bad', name: '', months: [] }], day);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'cal-13', name: 'Thirteen moons' });
    expect(all[0].label).toMatch(/^\w+, 3 Thaw 318 AR$/);
    expect(customDayLabel(c, EPOCH - 1)).toMatch(/Yearsend 1 BR$/);
  });
  it('reads a day typed in a custom calendar', () => {
    const c = thirteen();
    const want = customToDay(c, { year: 318, month: 2, day: 3 });
    expect(parseCustomDay(c, '3 Thaw 318 AR')).toBe(want);
    expect(parseCustomDay(c, '3 thaw 318')).toBe(want);
    expect(parseCustomDay(c, '3/2/318')).toBe(want);
    expect(parseCustomDay(c, '1 deepf 2 BR')).toBe(customToDay(c, { year: -1, month: 1, day: 1 }));
    expect(parseCustomDay(c, '29 Thaw 318')).toBeUndefined();
    expect(parseCustomDay(c, '3 Floop 318')).toBeUndefined();
  });
  it('leaves the app\'s own dates alone', () => {
    expect(parseFuzzyDate('3/5/1042')).toEqual({ year: 1042, month: 5, day: 3, precision: 'day' });
    expect(formatDayNumber(toDayNumber({ year: 1042, month: 5, day: 3 }))).toBe('03/05/1042');
  });
});
