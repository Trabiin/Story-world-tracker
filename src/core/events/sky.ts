/**
 * TL-6: seasons and moon phases along the timeline. Season lengths can follow a place's latitude
 * and height (RC-10), and the hemisphere is respected (D-5).
 */
import { Hemisphere, fromDayNumber, toDayNumber } from '../dates';
import { EARTH_TILT, localSeasons } from '../terrain';

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';
export interface SeasonBand { season: SeasonName; from: number; to: number }

/** Day of the year (from 1 January) at the middle of winter and summer: about a month after the solstices. */
const MID_WINTER_NORTH = 20; // 20 January
const MID_SUMMER_NORTH = 201; // 20 July

/**
 * Season bands between two days. Without a latitude: calendar (meteorological) seasons for the
 * hemisphere. With one: winter (below 5 °C) and summer (above 15 °C) last as long as RC-10 says,
 * centred on the coldest and warmest weeks; spring and autumn fill the rest.
 */
export function seasonBands(from: number, to: number, opts: { hemisphere: Hemisphere; lat?: number; elevM?: number; tiltDeg?: number }): SeasonBand[] {
  const out: SeasonBand[] = [];
  const y0 = fromDayNumber(Math.floor(from)).year - 1, y1 = fromDayNumber(Math.ceil(to)).year + 1;
  if (opts.lat === undefined) {
    const south = opts.hemisphere === 'south';
    const starts: [number, SeasonName][] = [[3, south ? 'autumn' : 'spring'], [6, south ? 'winter' : 'summer'], [9, south ? 'spring' : 'autumn'], [12, south ? 'summer' : 'winter']];
    for (let y = y0; y <= y1; y++) {
      starts.forEach(([m, season], i) => {
        const a = toDayNumber({ year: y, month: m, day: 1 });
        const next = i < 3 ? toDayNumber({ year: y, month: starts[i + 1][0], day: 1 }) : toDayNumber({ year: y + 1, month: 3, day: 1 });
        out.push({ season, from: a, to: next - 1 });
      });
    }
  } else {
    const ls = localSeasons(opts.lat, opts.elevM ?? 0, opts.tiltDeg ?? EARTH_TILT);
    const south = opts.lat < 0;
    const winterMid = south ? MID_SUMMER_NORTH : MID_WINTER_NORTH;
    const summerMid = south ? MID_WINTER_NORTH : MID_SUMMER_NORTH;
    const w = Math.min(365, ls.winterDays), s = Math.min(365 - w, ls.summerDays);
    for (let y = y0; y <= y1; y++) {
      const jan1 = toDayNumber({ year: y, month: 1, day: 1 });
      if (w >= 365) { out.push({ season: 'winter', from: jan1, to: jan1 + 364 }); continue; }
      if (s >= 365) { out.push({ season: 'summer', from: jan1, to: jan1 + 364 }); continue; }
      // Lay one cycle starting at mid-winter of this year: half winter, spring, summer, autumn, half winter.
      const start = jan1 + winterMid - 1;
      const winEnd = start + Math.ceil(w / 2);
      const nextWin = start + 365 - Math.floor(w / 2);
      const sumFrom = Math.max(winEnd, jan1 + summerMid - 1 - Math.floor(s / 2) + (summerMid < winterMid ? 365 : 0));
      const sumTo = Math.min(nextWin, sumFrom + s);
      if (w > 0) out.push({ season: 'winter', from: start - Math.floor(w / 2), to: winEnd - 1 });
      if (sumFrom > winEnd) out.push({ season: 'spring', from: winEnd, to: sumFrom - 1 });
      if (sumTo > sumFrom) out.push({ season: 'summer', from: sumFrom, to: sumTo - 1 });
      if (nextWin > sumTo) out.push({ season: 'autumn', from: sumTo, to: nextWin - 1 });
    }
  }
  return out.filter((b) => b.to >= from && b.from <= to).sort((a, b) => a.from - b.from);
}

export type MoonPhase = 'new' | 'first-quarter' | 'full' | 'last-quarter';
export const MOON_ICON: Record<MoonPhase, string> = { new: '●', 'first-quarter': '◐', full: '○', 'last-quarter': '◑' };
/** Earth's moon: 29.53 days; a new moon on 6 January 2000. */
export const EARTH_MOON = { periodDays: 29.530589, newMoonDay: toDayNumber({ year: 2000, month: 1, day: 6 }) };

/** Main moon phases between two days, for a moon with this period and one known new moon. */
export function moonPhases(from: number, to: number, moon: { periodDays: number; newMoonDay: number }): { day: number; phase: MoonPhase }[] {
  const p = moon.periodDays;
  if (!(p > 1)) return [];
  const out: { day: number; phase: MoonPhase }[] = [];
  const phases: MoonPhase[] = ['new', 'first-quarter', 'full', 'last-quarter'];
  let k = Math.floor((from - moon.newMoonDay) / p) - 1;
  for (;;) {
    const base = moon.newMoonDay + k * p;
    if (base > to) break;
    phases.forEach((phase, i) => {
      const day = Math.round(base + (i * p) / 4);
      if (day >= from && day <= to) out.push({ day, phase });
    });
    k++;
  }
  return out;
}

/** The phase on a day, as a fraction of the cycle (0 = new, 0.5 = full). */
export function moonAge(day: number, moon: { periodDays: number; newMoonDay: number }): number {
  const f = ((day - moon.newMoonDay) / moon.periodDays) % 1;
  return f < 0 ? f + 1 : f;
}
