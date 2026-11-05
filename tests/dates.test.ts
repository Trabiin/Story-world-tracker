import { describe, expect, it } from 'vitest';
import { ageOn, formatFuzzy, fromDayNumber, parseFuzzyDate, toDayNumber, toWindow, formatDayNumber } from '../src/core';

describe('calendar', () => {
  it('round-trips day numbers including negative years and leap days', () => {
    for (const ymd of [{ year: 1970, month: 1, day: 1 }, { year: 2000, month: 2, day: 29 }, { year: -500, month: 3, day: 1 }, { year: 1042, month: 5, day: 3 }, { year: 99999, month: 12, day: 31 }]) {
      expect(fromDayNumber(toDayNumber(ymd))).toEqual(ymd);
    }
    expect(toDayNumber({ year: 1970, month: 1, day: 1 })).toBe(0);
    expect(toDayNumber({ year: 1900, month: 3, day: 1 }) - toDayNumber({ year: 1900, month: 2, day: 28 })).toBe(1);
  });
  it('computes age', () => {
    expect(ageOn({ year: 1020, month: 6, day: 10 }, { year: 1042, month: 6, day: 9 })).toBe(21);
    expect(ageOn({ year: 1020, month: 6, day: 10 }, { year: 1042, month: 6, day: 10 })).toBe(22);
  });
});

describe('fuzzy windows', () => {
  const day = (y: number, m: number, d: number) => toDayNumber({ year: y, month: m, day: d });
  it('spring 1042 is 1 Mar to 31 May', () => {
    expect(toWindow({ year: 1042, precision: 'season', season: 'spring' })).toEqual({ earliest: day(1042, 3, 1), latest: day(1042, 5, 31) });
  });
  it('winter crosses the year and southern hemisphere shifts', () => {
    expect(toWindow({ year: 1042, precision: 'season', season: 'winter' })).toEqual({ earliest: day(1042, 12, 1), latest: day(1043, 2, 28) });
    expect(toWindow({ year: 1042, precision: 'season', season: 'winter' }, 'south')).toEqual({ earliest: day(1042, 6, 1), latest: day(1042, 8, 31) });
  });
  it('late spring is the last third and approximate widens', () => {
    const w = toWindow({ year: 1042, precision: 'season', season: 'spring', part: 'late' });
    expect(w.latest).toBe(day(1042, 5, 31));
    expect(w.latest - w.earliest + 1).toBe(30);
    expect(toWindow({ year: 1042, precision: 'year', approximate: true }).earliest).toBe(day(1042, 1, 1) - 180);
  });
  it('formats in day/month/year order', () => {
    expect(formatFuzzy({ year: 1042, month: 5, day: 3, precision: 'day' })).toBe('3 May 1042');
    expect(formatFuzzy({ year: 1042, precision: 'season', season: 'spring', part: 'late', approximate: true })).toBe('~late spring 1042');
    expect(formatDayNumber(day(1042, 5, 3))).toBe('03/05/1042');
    expect(formatFuzzy({ year: -299, precision: 'year' })).toBe('300 BC');
  });
});

describe('parsing', () => {
  it.each([
    ['3/5/1042', { year: 1042, month: 5, day: 3, precision: 'day' }],
    ['3 May 1042', { year: 1042, month: 5, day: 3, precision: 'day' }],
    ['May 1042', { year: 1042, month: 5, precision: 'month' }],
    ['5/1042', { year: 1042, month: 5, precision: 'month' }],
    ['late spring 1042', { year: 1042, precision: 'season', season: 'spring', part: 'late' }],
    ['~1042', { year: 1042, precision: 'year', approximate: true }],
    ['early 1042', { year: 1042, precision: 'year', part: 'early' }],
    ['300 BC', { year: -299, precision: 'year' }],
    ['about 1st September 1042', { year: 1042, month: 9, day: 1, precision: 'day', approximate: true }],
  ])('%s', (input, expected) => {
    expect(parseFuzzyDate(input)).toEqual(expected);
  });
  it('rejects invalid dates', () => {
    expect(parseFuzzyDate('31/2/1042')).toBeNull();
    expect(parseFuzzyDate('hello')).toBeNull();
    expect(parseFuzzyDate('')).toBeNull();
  });
});
