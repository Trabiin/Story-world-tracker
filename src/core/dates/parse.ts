/**
 * Parse typed dates in day/month/year order (TL-3).
 * Accepts: "3/5/1042", "3-5-1042", "3 May 1042", "May 1042", "5/1042",
 * "spring 1042", "late spring 1042", "early 1042", "1042", "~1042", "c. May 1042",
 * "about 3 May 1042", "300 BC".
 */
import { isValidYMD } from './calendar';
import { FuzzyDate, Part, Season } from './fuzzyDate';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const SEASONS: Record<string, Season> = { spring: 'spring', summer: 'summer', autumn: 'autumn', fall: 'autumn', winter: 'winter' };
const PARTS: Record<string, Part> = { early: 'early', mid: 'mid', middle: 'mid', late: 'late' };

function monthFromWord(w: string): number | undefined {
  if (w.length < 3) return undefined;
  return MONTHS[w.slice(0, 3)];
}

function parseYear(tokens: string[]): number | undefined {
  // last token(s): "1042", "300 bc", "1042 ad"
  if (tokens.length === 0) return undefined;
  let bc = false;
  const last = tokens[tokens.length - 1];
  if (last === 'bc' || last === 'bce') {
    bc = true;
    tokens.pop();
  } else if (last === 'ad' || last === 'ce') {
    tokens.pop();
  }
  const y = tokens.pop();
  if (!y || !/^-?\d+$/.test(y)) return undefined;
  const n = parseInt(y, 10);
  return bc ? 1 - n : n;
}

export function parseFuzzyDate(input: string): FuzzyDate | null {
  let s = input.trim().toLowerCase().replace(/,/g, ' ');
  if (!s) return null;
  let approximate = false;
  const approx = /^(~|c\.|ca\.|circa|about|approx\.?|approximately|around)\s*/;
  if (approx.test(s)) {
    approximate = true;
    s = s.replace(approx, '');
  }
  const ap = approximate ? { approximate: true } : {};

  // numeric d/m/y or m/y
  const num = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](-?\d+)$/);
  if (num) {
    const d = { year: +num[3], month: +num[2], day: +num[1] };
    return isValidYMD(d) ? { ...d, precision: 'day', ...ap } : null;
  }
  const my = s.match(/^(\d{1,2})[/.-](-?\d+)$/);
  if (my) {
    const month = +my[1];
    return month >= 1 && month <= 12 ? { year: +my[2], month, precision: 'month', ...ap } : null;
  }

  const tokens = s.split(/\s+/).filter((t) => t !== 'of');
  const year = parseYear(tokens);
  if (year === undefined) return null;

  let part: Part | undefined;
  if (tokens.length && PARTS[tokens[0]]) part = PARTS[tokens.shift()!];
  const pp = part ? { part } : {};

  if (tokens.length === 0) return { year, precision: 'year', ...pp, ...ap };
  if (tokens.length === 1 && SEASONS[tokens[0]]) return { year, precision: 'season', season: SEASONS[tokens[0]], ...pp, ...ap };
  if (tokens.length === 1) {
    const m = monthFromWord(tokens[0]);
    if (m) return { year, month: m, precision: 'month', ...pp, ...ap };
    return null;
  }
  if (tokens.length === 2 && !part) {
    const day = parseInt(tokens[0].replace(/(st|nd|rd|th)$/, ''), 10);
    const m = monthFromWord(tokens[1]);
    if (m && Number.isInteger(day)) {
      const d = { year, month: m, day };
      return isValidYMD(d) ? { ...d, precision: 'day', ...ap } : null;
    }
  }
  return null;
}
