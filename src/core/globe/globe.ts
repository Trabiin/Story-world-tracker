/** Globe geometry (DM-3). All positions are latitude/longitude in degrees on a sphere. */

export interface LatLng {
  lat: number; // -90..90
  lng: number; // -180..180 (wrapped)
}

export const EARTH_RADIUS_KM = 6371;
/** WH-8: straight-line distance is multiplied by this until drawn routes exist. */
export const DEFAULT_DETOUR_FACTOR = 1.3;

const RAD = Math.PI / 180;

export function wrapLng(lng: number): number {
  const w = ((((lng + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lng > 0 ? 180 : w;
}

export function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

/** Great-circle distance in km (haversine). */
export function greatCircleKm(a: LatLng, b: LatLng, radiusKm = EARTH_RADIUS_KM): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total great-circle length of a path through the given points (MP-10). */
export function pathLengthKm(points: LatLng[], radiusKm = EARTH_RADIUS_KM): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += greatCircleKm(points[i - 1], points[i], radiusKm);
  return sum;
}

/** Points along the great circle from a to b, for drawing journeys on a flat map. */
export function interpolateGreatCircle(a: LatLng, b: LatLng, steps = 32): LatLng[] {
  const φ1 = a.lat * RAD, λ1 = a.lng * RAD, φ2 = b.lat * RAD, λ2 = b.lng * RAD;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [a, b];
  const out: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    out.push({ lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, lng: Math.atan2(y, x) / RAD });
  }
  return out;
}

/** WH-8: suggested travel days = distance × detour ÷ speed, rounded up to whole days. */
export function travelDays(distanceKm: number, speedKmPerDay: number, detourFactor = DEFAULT_DETOUR_FACTOR): number {
  if (speedKmPerDay <= 0) return Infinity;
  return Math.max(1, Math.ceil((distanceKm * detourFactor) / speedKmPerDay));
}
