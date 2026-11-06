/**
 * RC-10: how long winter and summer last at a spot, from its latitude, height and the planet's
 * axial tilt. A simple yearly temperature curve: the mean from meanTemperatureC, and a swing that
 * grows towards the poles and with the tilt. Winter = days below 5 °C, summer = days above 15 °C.
 * The calendar's seasons (TL-6) can use this for each place.
 */
import { EARTH_TILT, meanTemperatureC } from './climate';

export interface LocalSeasons {
  winterDays: number;
  summerDays: number;
  /** Half the gap between the warmest and coldest day, °C. */
  swingC: number;
  meanC: number;
  midnightSun: boolean;
  /** "Winter lasts about 7 months, summer about 2." */
  text: string;
}

export const WINTER_BELOW_C = 5;
export const SUMMER_ABOVE_C = 15;

/** Share of the year a cosine curve (mean m, swing a) spends below t. */
function shareBelow(m: number, a: number, t: number): number {
  if (a <= 0) return m < t ? 1 : 0;
  const c = (t - m) / a;
  if (c <= -1) return 0;
  if (c >= 1) return 1;
  return 1 - Math.acos(c) / Math.PI;
}

export function seasonSwingC(lat: number, tiltDeg = EARTH_TILT): number {
  const s = Math.sin((Math.min(90, Math.abs(lat)) * Math.PI) / 180);
  return (Math.max(0, Math.min(60, tiltDeg)) / EARTH_TILT) * (1 + 17 * s);
}

export function localSeasons(lat: number, elevM: number, tiltDeg = EARTH_TILT): LocalSeasons {
  const meanC = meanTemperatureC(lat, elevM);
  const swingC = seasonSwingC(lat, tiltDeg);
  const winterDays = Math.round(365 * shareBelow(meanC, swingC, WINTER_BELOW_C));
  const summerDays = Math.round(365 * (1 - shareBelow(meanC, swingC, SUMMER_ABOVE_C)));
  const midnightSun = tiltDeg > 0 && Math.abs(lat) >= 90 - tiltDeg;
  const months = (d: number) => {
    const m = Math.round(d / 30.4);
    return m <= 0 ? 'less than a month' : m === 1 ? 'about a month' : `about ${m} months`;
  };
  let text: string;
  if (winterDays === 0 && summerDays >= 360) text = 'Warm all year; no real winter.';
  else if (winterDays >= 360) text = summerDays ? `Cold almost all year; summer lasts ${months(summerDays)}.` : 'Cold all year; no real summer.';
  else if (winterDays === 0) text = `No real winter; summer lasts ${months(summerDays)}.`;
  else if (summerDays === 0) text = `Winter lasts ${months(winterDays)}; no real summer.`;
  else text = `Winter lasts ${months(winterDays)}, summer ${months(summerDays)}.`;
  if (midnightSun) text += ' Midnight sun in summer, polar night in winter.';
  return { winterDays, summerDays, swingC, meanC, midnightSun, text };
}
