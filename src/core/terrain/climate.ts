/**
 * RC-7: a temperature band for every spot from its latitude and height, with band edges that
 * follow the planet's axial tilt (tropics at the tilt, polar circles at 90° − tilt).
 * RC-8: terrain types that clash with their band.
 */

export type ClimateBand = 'tropical' | 'subtropical' | 'temperate' | 'subarctic' | 'polar';
export const CLIMATE_BANDS: ClimateBand[] = ['tropical', 'subtropical', 'temperate', 'subarctic', 'polar'];

export const BAND_INFO: Record<ClimateBand, { name: string; color: string }> = {
  tropical: { name: 'Tropical', color: '#d9534f' },
  subtropical: { name: 'Subtropical', color: '#f0a33a' },
  temperate: { name: 'Temperate', color: '#7cb342' },
  subarctic: { name: 'Subarctic', color: '#4aa3c7' },
  polar: { name: 'Polar', color: '#a7b7e8' },
};

export const EARTH_TILT = 23.44;
/** Height makes a place colder: about 6.5 °C per km, the same as moving ~9° toward a pole. */
export const DEG_PER_KM = 9;

/** Latitudes (degrees from the equator) where each band ends, for a given axial tilt. */
export function bandEdges(tiltDeg: number): [number, number, number, number] {
  const t = Math.max(1, Math.min(44, tiltDeg));
  const mid = 90 - 2 * t;
  return [t, t + mid * 0.27, t + mid * 0.735, 90 - t];
}

/** The temperature band at a latitude and elevation (metres; water counts as sea level). */
export function climateBand(lat: number, elevM: number, tiltDeg = EARTH_TILT): ClimateBand {
  const eff = Math.abs(lat) + (Math.max(0, elevM) / 1000) * DEG_PER_KM;
  const [a, b, c, d] = bandEdges(tiltDeg);
  if (eff < a) return 'tropical';
  if (eff < b) return 'subtropical';
  if (eff < c) return 'temperate';
  if (eff < d) return 'subarctic';
  return 'polar';
}

/** Rough mean yearly temperature in °C, for hover hints. */
export function meanTemperatureC(lat: number, elevM: number): number {
  return 28 - 46 * Math.pow(Math.min(90, Math.abs(lat)) / 90, 1.6) - 6.5 * (Math.max(0, elevM) / 1000);
}

/** How strong seasons are, in words, from the axial tilt (MK-2). */
export function seasonStrength(tiltDeg: number): string {
  if (tiltDeg < 5) return 'almost no seasons';
  if (tiltDeg < 15) return 'mild seasons';
  if (tiltDeg < 30) return 'Earth-like seasons';
  if (tiltDeg < 45) return 'harsh seasons with long polar days and nights';
  return 'extreme seasons';
}

/** MK-7: an editable list of terrain types. Each one says which bands it is plausible in (RC-8). */
export interface Biome {
  id: number; // 1..255, stored in the terrain grid
  name: string;
  color: string;
  bands: ClimateBand[];
}

export const DEFAULT_BIOMES: Biome[] = [
  { id: 1, name: 'Grassland', color: '#b5c97a', bands: ['tropical', 'subtropical', 'temperate', 'subarctic'] },
  { id: 2, name: 'Forest', color: '#5f9156', bands: ['subtropical', 'temperate', 'subarctic'] },
  { id: 3, name: 'Rainforest', color: '#2f7445', bands: ['tropical', 'subtropical'] },
  { id: 4, name: 'Pine forest', color: '#4a6f5c', bands: ['temperate', 'subarctic'] },
  { id: 5, name: 'Farmland', color: '#dccf86', bands: ['tropical', 'subtropical', 'temperate'] },
  { id: 6, name: 'Desert', color: '#e6cf98', bands: ['tropical', 'subtropical', 'temperate'] },
  { id: 7, name: 'Swamp', color: '#7d9a6a', bands: ['tropical', 'subtropical', 'temperate', 'subarctic'] },
  { id: 8, name: 'Tundra', color: '#bfc2a8', bands: ['subarctic', 'polar'] },
  { id: 9, name: 'Ice', color: '#f3f6f8', bands: ['subarctic', 'polar'] },
  { id: 10, name: 'Bare rock', color: '#a39e93', bands: ['tropical', 'subtropical', 'temperate', 'subarctic', 'polar'] },
];

export function nextBiomeId(list: Biome[]): number {
  for (let i = 1; i < 256; i++) if (!list.some((b) => b.id === i)) return i;
  return -1;
}
