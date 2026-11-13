/**
 * TL-2: custom in-world calendars. Every date is still stored against the proleptic Gregorian day
 * count (DM-1); a custom calendar only changes how days are named, shown and typed.
 *
 * A calendar is a list of months (each with its length, plus extra days in leap years), an optional
 * week, an era name, the Gregorian day that is day 1 of month 1 of year 1, and a leap rule
 * ("every 4 years, except every 100, unless every 400"). Years before year 1 are numbered 0, -1, …
 * internally and shown as "1 <before-era>", "2 <before-era>", … like BC.
 *
 * Ojon's choice (2026-11-13): dates stay day/month/year everywhere; custom calendars are shown
 * alongside and in a converter, never instead.
 */
import type { YMD } from './calendar';

export interface CalendarMonth {
  name: string;
  days: number;
  /** Days added to this month in a leap year (usually 0 or 1). */
  leapDays?: number;
}

export interface LeapRule {
  /** A leap year every N years (0 or absent: no leap years). */
  every: number;
  /** …except every M years (like 100 in the Gregorian rule). */
  except?: number;
  /** …but still every K years (like 400). */
  unless?: number;
  /** Shift the cycle: year (y + offset) is tested. */
  offset?: number;
}

export interface CustomCalendar {
  id: string;
  name: string;
  months: CalendarMonth[];
  /** Weekday names; empty = no week shown. */
  weekdays: string[];
  /** Index into weekdays of day 1 of month 1 of year 1. */
  firstWeekday?: number;
  /** Era after year 1 ("AR") and before it ("BR"); empty = plain numbers. */
  era: string;
  beforeEra?: string;
  /** Gregorian day number (days since 1970-01-01) of day 1, month 1, year 1. */
  epoch: number;
  leap?: LeapRule;
}


export function isCustomLeap(cal: CustomCalendar, year: number): boolean {
  const r = cal.leap;
  if (!r || !r.every || r.every < 1) return false;
  const y = year + (r.offset ?? 0);
  const mod = (a: number, b: number) => ((a % b) + b) % b;
  if (mod(y, r.every) !== 0) return false;
  if (r.except && mod(y, r.except) === 0) return !!r.unless && mod(y, r.unless) === 0;
  return true;
}

export function customMonthDays(cal: CustomCalendar, year: number, month: number): number {
  const m = cal.months[month - 1];
  if (!m) return 0;
  return m.days + (isCustomLeap(cal, year) ? m.leapDays ?? 0 : 0);
}

export function customYearDays(cal: CustomCalendar, year: number): number {
  let n = 0;
  for (let m = 1; m <= cal.months.length; m++) n += customMonthDays(cal, year, m);
  return n;
}

/** Days from day 1 of year 1 to day 1 of `year` (negative before year 1). Exact for any leap rule. */
function yearStart(cal: CustomCalendar, year: number): number {
  const base = cal.months.reduce((n, m) => n + m.days, 0);
  const leapExtra = cal.months.reduce((n, m) => n + (m.leapDays ?? 0), 0);
  // Count leap years in [1, year) (or (year, 1] negated) with the cycle arithmetic.
  const leapsBefore = (y: number) => {
    // Leap years in [1 + offset … y - 1 + offset] for a rule on the shifted year.
    const r = cal.leap;
    if (!r || !r.every || r.every < 1 || !leapExtra) return 0;
    const count = (k: number) => (n: number) => Math.floor(n / k); // multiples of k in [1, n] for n >= 0, floor works for negatives too
    const upto = (n: number) => {
      let c = count(r.every)(n);
      if (r.except) { c -= count(lcm(r.every, r.except))(n); if (r.unless) c += count(lcm(lcm(r.every, r.except), r.unless))(n); }
      return c;
    };
    const off = r.offset ?? 0;
    // Shifted years s = y + off; leap years with s in [1 + off, y - 1 + off] = upto(y - 1 + off) - upto(off).
    return upto(y - 1 + off) - upto(off);
  };
  return (year - 1) * base + leapsBefore(year) * leapExtra;
}

function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : Math.abs(a); }
function lcm(a: number, b: number): number { return (a / gcd(a, b)) * b; }

export function isValidCustom(cal: CustomCalendar, d: YMD): boolean {
  return Number.isInteger(d.year) && Number.isInteger(d.month) && Number.isInteger(d.day) && d.month >= 1 && d.month <= cal.months.length && d.day >= 1 && d.day <= customMonthDays(cal, d.year, d.month);
}

/** Calendar date → Gregorian day number. */
export function customToDay(cal: CustomCalendar, d: YMD): number {
  let n = cal.epoch + yearStart(cal, d.year);
  for (let m = 1; m < d.month; m++) n += customMonthDays(cal, d.year, m);
  return n + d.day - 1;
}

/** Gregorian day number → calendar date. */
export function dayToCustom(cal: CustomCalendar, day: number): YMD {
  const n = Math.floor(day) - cal.epoch;
  const avg = customYearDays(cal, 1) || 1;
  let year = Math.floor(n / avg) + 1;
  // Correct the estimate (leap days make it drift by at most a year or so).
  while (yearStart(cal, year) > n) year--;
  while (yearStart(cal, year + 1) <= n) year++;
  let rest = n - yearStart(cal, year);
  let month = 1;
  while (month < cal.months.length && rest >= customMonthDays(cal, year, month)) { rest -= customMonthDays(cal, year, month); month++; }
  return { year, month, day: rest + 1 };
}

export function customWeekday(cal: CustomCalendar, day: number): string | undefined {
  if (!cal.weekdays.length) return undefined;
  const k = cal.weekdays.length;
  return cal.weekdays[((((Math.floor(day) - cal.epoch + (cal.firstWeekday ?? 0)) % k) + k) % k)];
}

export function customYearLabel(cal: CustomCalendar, y: number): string {
  if (y <= 0) return `${1 - y}${cal.beforeEra ? ` ${cal.beforeEra}` : ' before'}`;
  return `${y}${cal.era ? ` ${cal.era}` : ''}`;
}

/** Problems that make a calendar unusable (shown in Settings). */
export function calendarProblems(cal: CustomCalendar): string[] {
  const out: string[] = [];
  if (!cal.name.trim()) out.push('Give the calendar a name.');
  if (!cal.months.length) out.push('Add at least one month.');
  cal.months.forEach((m, i) => {
    if (!m.name.trim()) out.push(`Month ${i + 1} has no name.`);
    if (!Number.isInteger(m.days) || m.days < 1 || m.days > 400) out.push(`${m.name || `Month ${i + 1}`}: days must be a whole number from 1 to 400.`);
    if (m.leapDays && (!Number.isInteger(m.leapDays) || m.leapDays < 0 || m.leapDays > 31)) out.push(`${m.name || `Month ${i + 1}`}: leap days must be 0 to 31.`);
  });
  const names = cal.months.map((m) => m.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) out.push('Two months have the same name.');
  if (cal.leap?.every && (cal.leap.every < 1 || !Number.isInteger(cal.leap.every))) out.push('Leap years: "every" must be a whole number of years.');
  if (!Number.isFinite(cal.epoch)) out.push('Say which day year 1 starts on.');
  return out;
}

/** Starting points for a new calendar. */
export function calendarTemplate(kind: 'twelve' | 'thirteen' | 'ten', id: string, epoch: number): CustomCalendar {
  if (kind === 'thirteen') {
    return {
      id, name: 'Thirteen moons', era: 'AR', beforeEra: 'BR', epoch, weekdays: ['Firstday', 'Seconday', 'Thirday', 'Fourthday', 'Fifthday', 'Sixthday', 'Restday'],
      months: [...['Deepfrost', 'Thaw', 'Seedtime', 'Rains', 'Blossom', 'Highsun', 'Midsummer', 'Harvest', 'Gleaning', 'Leaffall', 'Mists', 'Longnight', 'Hearth'].map((name) => ({ name, days: 28 })), { name: 'Yearsend', days: 1, leapDays: 1 }],
      leap: { every: 4, except: 100, unless: 400 },
    };
  }
  if (kind === 'ten') {
    return {
      id, name: 'Ten-month reckoning', era: '', epoch, weekdays: [],
      months: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'].map((name, i) => ({ name, days: i % 2 ? 36 : 37, ...(i === 9 ? { leapDays: 1 } : {}) })),
      leap: { every: 4 },
    };
  }
  return {
    id, name: 'New calendar', era: '', epoch, weekdays: ['Moonday', 'Tiwsday', 'Wodensday', 'Thunorsday', 'Frigsday', 'Saturnday', 'Sunday'],
    months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((days, i) => ({ name: `Month ${i + 1}`, days, ...(i === 1 ? { leapDays: 1 } : {}) })),
    leap: { every: 4, except: 100, unless: 400 },
  };
}

// ---------------------------------------------------------------- converting (D-16: dates stay Gregorian)

/** A Gregorian day in a custom calendar, e.g. "Restday, 3 Thaw 318 AR". */
export function customDayLabel(cal: CustomCalendar, day: number): string {
  const d = dayToCustom(cal, day);
  const wd = customWeekday(cal, day);
  return `${wd ? `${wd}, ` : ''}${d.day} ${cal.months[d.month - 1]?.name ?? '?'} ${customYearLabel(cal, d.year)}`;
}

/** A day in every usable calendar of the world (for the date bar and the converter). */
export function dayInCalendars(calendars: CustomCalendar[] | undefined, day: number): { id: string; name: string; label: string }[] {
  return (calendars ?? []).filter((c) => !calendarProblems(c).length).map((c) => ({ id: c.id, name: c.name, label: customDayLabel(c, day) }));
}

/** Read a date typed in a custom calendar: "3 Thaw 318 AR", "3/2/318", "3 thaw 2 BR". Undefined if it is not one. */
export function parseCustomDay(cal: CustomCalendar, input: string): number | undefined {
  const s = input.trim().toLowerCase().replace(/,/g, ' ');
  const era = cal.era.trim().toLowerCase(), before = cal.beforeEra?.trim().toLowerCase();
  const yearOf = (t: string, suffix?: string) => {
    if (!/^-?\d+$/.test(t)) return undefined;
    const n = parseInt(t, 10);
    if (suffix && (suffix === before || suffix === 'before')) return 1 - n;
    return n;
  };
  const tokens = s.split(/\s+/).filter(Boolean);
  let suffix: string | undefined;
  const last = tokens[tokens.length - 1];
  if (last && ((era && last === era) || (before && last === before) || last === 'before')) { suffix = last; tokens.pop(); }
  let y: number | undefined, m: number | undefined, d: number | undefined;
  const num = tokens.length === 1 ? /^(\d{1,3})[/.-](\d{1,2})[/.-](-?\d+)$/.exec(tokens[0]) : null;
  if (num) { d = +num[1]; m = +num[2]; y = yearOf(num[3], suffix); }
  else if (tokens.length >= 3) {
    d = parseInt(tokens[0].replace(/(st|nd|rd|th)$/, ''), 10);
    y = yearOf(tokens[tokens.length - 1], suffix);
    const word = tokens.slice(1, -1).join(' ');
    const names = cal.months.map((x) => x.name.trim().toLowerCase());
    m = names.indexOf(word) + 1 || undefined;
    if (!m && word.length >= 3) { const hits = names.map((n, i) => (n.startsWith(word) ? i + 1 : 0)).filter(Boolean); if (hits.length === 1) m = hits[0]; }
  }
  if (y === undefined || !m || !d || !isValidCustom(cal, { year: y, month: m, day: d })) return undefined;
  return customToDay(cal, { year: y, month: m, day: d });
}
