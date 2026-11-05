import { CANON, DEFAULT_BIOMES, DEFAULT_TRAVEL_MODES, EARTH_TILT, Place, World, emptyTerrain } from '../core';

export const UNKNOWN_PLACE_ID = 'unknown-place';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function recordBase() {
  const t = nowIso();
  return { id: newId(), scenarioId: CANON, status: 'canon' as const, createdAt: t, updatedAt: t };
}

/** A fresh world with the built-in "unknown place" placeholder (WH-12). */
export function createEmptyWorld(name: string): World {
  const unknown: Place = {
    ...recordBase(),
    id: UNKNOWN_PLACE_ID,
    name: 'Unknown / on the road',
    aliases: [],
    kind: 'unknown',
    notes: 'Use when a character is somewhere you have not decided yet. Counts as accounted for in gap checks.',
    isPlaceholder: true,
  };
  return {
    settings: {
      name,
      radiusKm: 6371,
      hemisphereForSeasons: 'north',
      defaultDetourFactor: 1.3,
      travelModes: DEFAULT_TRAVEL_MODES.map((m) => ({ ...m })),
      disabledRules: [],
      axialTiltDeg: EARTH_TILT,
      biomes: DEFAULT_BIOMES.map((b) => ({ ...b, bands: [...b.bands] })),
    },
    characters: [],
    places: [unknown],
    groups: [],
    memberships: [],
    stays: [],
    journeys: [],
    mapImages: [],
    dismissals: [],
    books: [],
    chapters: [],
    scenes: [],
    manuscripts: [],
    links: [],
    mapSymbols: [],
    terrain: emptyTerrain(),
  };
}

/** Fill in collections that older files or exports do not have yet. */
export function normalizeWorld(w: World): World {
  const empty = createEmptyWorld(w.settings?.name ?? 'World');
  const out = { ...empty, ...w, settings: { ...empty.settings, ...w.settings } } as World;
  for (const k of Object.keys(empty) as (keyof World)[]) {
    if (k !== 'settings' && k !== 'terrain' && !Array.isArray(out[k])) (out as unknown as Record<string, unknown>)[k] = [];
  }
  if (!out.terrain || typeof out.terrain !== 'object' || !out.terrain.tiles) out.terrain = emptyTerrain();
  return out;
}
