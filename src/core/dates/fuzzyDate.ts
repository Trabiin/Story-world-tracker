/**
 * Fuzzy dates (DM-1, TL-3). Every stored date is year/month/day plus a precision.
 * For comparison each date becomes an inclusive [earliest, latest] window of day numbers.
 */
import { YMD, daysInMonth, fromDayNumber, toDayNumber } from './calendar';

export type Precision = 'day' | 'month' | 'season' | 'year';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Part = 'early' | 'mid' | 'late';
export type Hemisphere = 'north' | 'south';

export interface FuzzyDate {
  year: number;
  /** Required for 'day' and 'month' precision. */
  month?: number;
  /** Required for 'day' precision. */
  day?: number;
  precision: Precision;
  /** Required for 'season' precision. */
  season?: Season;
  /** Narrows a month/season/year to its first, middle or last third ("late spring"). */
  part?: Part;
  /** "Approximately": widens the window by a margin that depends on precision. */
  approximate?: boolean;
}

export interface DayWindow {
  earliest: number;
  latest: number;
}

/** Margin in days added on each side for approximate dates. */
export const APPROX_MARGIN: Record<Precision, number> = { day: 3, month: 15, season: 30, year: 180 };

/**
 * Meteorological seasons. Winter of year Y runs from December of Y into February of Y+1.
 * In the southern hemisphere the months are shifted by six.
 */
function seasonRange(year: number, season: Season, hemisphere: Hemisphere): [YMD, YMD] {
  const northStart: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };
  let startMonth = northStart[season];
  if (hemisphere === 'south') startMonth = ((startMonth + 6 - 1) % 12) + 1;
  let endMonth = startMonth + 2;
  let endYear = year;
  if (endMonth > 12) {
    endMonth -= 12;
    endYear++;
  }
  return [
    { year, month: startMonth, day: 1 },
    { year: endYear, month: endMonth, day: daysInMonth(endYear, endMonth) },
  ];
}

function narrow(w: DayWindow, part: Part | undefined): DayWindow {
  if (!part) return w;
  const len = w.latest - w.earliest + 1;
  const third = Math.floor(len / 3);
  if (part === 'early') return { earliest: w.earliest, latest: w.earliest + third - 1 };
  if (part === 'late') return { earliest: w.latest - third + 1, latest: w.latest };
  return { earliest: w.earliest + third, latest: w.latest - third };
}

export function toWindow(d: FuzzyDate, hemisphere: Hemisphere = 'north'): DayWindow {
  let w: DayWindow;
  switch (d.precision) {
    case 'day': {
      const n = toDayNumber({ year: d.year, month: d.month!, day: d.day! });
      w = { earliest: n, latest: n };
      break;
    }
    case 'month': {
      const m = d.month!;
      w = {
        earliest: toDayNumber({ year: d.year, month: m, day: 1 }),
        latest: toDayNumber({ year: d.year, month: m, day: daysInMonth(d.year, m) }),
      };
      break;
    }
    case 'season': {
      const [a, b] = seasonRange(d.year, d.season!, hemisphere);
      w = { earliest: toDayNumber(a), latest: toDayNumber(b) };
      break;
    }
    case 'year':
      w = {
        earliest: toDayNumber({ year: d.year, month: 1, day: 1 }),
        latest: toDayNumber({ year: d.year, month: 12, day: 31 }),
      };
      break;
  }
  if (d.precision !== 'day') w = narrow(w, d.part);
  if (d.approximate) {
    const m = APPROX_MARGIN[d.precision];
    w = { earliest: w.earliest - m, latest: w.latest + m };
  }
  return w;
}

export function exactDate(year: number, month: number, day: number): FuzzyDate {
  return { year, month, day, precision: 'day' };
}

export function fromDay(n: number): FuzzyDate {
  const { year, month, day } = fromDayNumber(n);
  return exactDate(year, month, day);
}

/** Midpoint day, used where a single representative day is needed (e.g. drawing). */
export function midpoint(w: DayWindow): number {
  return Math.floor((w.earliest + w.latest) / 2);
}

/** Two windows may overlap (possibly the same moment). */
export function windowsCanOverlap(a: DayWindow, b: DayWindow): boolean {
  return a.earliest <= b.latest && b.earliest <= a.latest;
}

/** a is certainly before b: no possible reading puts a at or after b. */
export function certainlyBefore(a: DayWindow, b: DayWindow): boolean {
  return a.latest < b.earliest;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function yearLabel(y: number): string {
  return y <= 0 ? `${1 - y} BC` : String(y);
}

/** Human label in day/month/year order (Ojon's preference), e.g. "3 May 1042", "~late spring 1042". */
export function formatFuzzy(d: FuzzyDate): string {
  const parts: string[] = [];
  if (d.part && d.precision !== 'day') parts.push(d.part);
  switch (d.precision) {
    case 'day':
      parts.push(`${d.day} ${MONTH_NAMES[d.month! - 1]} ${yearLabel(d.year)}`);
      break;
    case 'month':
      parts.push(`${MONTH_NAMES[d.month! - 1]} ${yearLabel(d.year)}`);
      break;
    case 'season':
      parts.push(`${d.season} ${yearLabel(d.year)}`);
      break;
    case 'year':
      parts.push(yearLabel(d.year));
      break;
  }
  return (d.approximate ? '~' : '') + parts.join(' ');
}

/** Short numeric day/month/year form used in tables, e.g. "03/05/1042". */
export function formatDayNumber(n: number): string {
  const { year, month, day } = fromDayNumber(n);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${yearLabel(year)}`;
}
