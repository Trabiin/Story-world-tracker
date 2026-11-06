import { CANON, DEFAULT_BIOMES, DEFAULT_TRAVEL_MODES, emptyTerrain, FuzzyDate, Journey, Place, Stay, World, exactDate } from '../src/core';

const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };

export function world(): World {
  return {
    settings: { name: 'Test', radiusKm: 6371, hemisphereForSeasons: 'north', defaultDetourFactor: 1.3, travelModes: DEFAULT_TRAVEL_MODES, disabledRules: [], axialTiltDeg: 23.44, biomes: DEFAULT_BIOMES },
    characters: [
      { ...base, id: 'kaela', name: 'Kaela', aliases: [], description: '', notes: '', tags: [], color: '#c33', icon: 'person', importance: 'main', archived: false },
      { ...base, id: 'bren', name: 'Bren', aliases: [], description: '', notes: '', tags: [], color: '#33c', icon: 'person', importance: 'main', archived: false },
    ],
    places: [
      place('varn', 'Varn', { lat: 50, lng: 10 }),
      place('thornwick', 'Thornwick', { lat: 50, lng: 12 }), // ~143 km east of Varn
      place('castle', 'Varn Castle', undefined, 'varn'),
      place('hall', 'Great Hall', undefined, 'castle'),
      { ...place('nowhere', 'On the road somewhere'), kind: 'unknown', isPlaceholder: true },
    ],
    groups: [{ ...base, id: 'party', name: 'The Party', description: '', color: '#3c3' }],
    memberships: [],
    stays: [],
    journeys: [],
    mapImages: [],
    dismissals: [],
    books: [], chapters: [], scenes: [], manuscripts: [], links: [], mapSymbols: [], mapFeatures: [], mapLayers: [], detailMaps: [], regionLayers: [], regions: [], events: [], relationships: [], secrets: [], threads: [], scenarios: [], terrain: emptyTerrain(),
  };
}

export function place(id: string, name: string, location?: { lat: number; lng: number }, parentId?: string): Place {
  return { ...base, id, name, aliases: [], kind: 'city', parentId, location, notes: '', isPlaceholder: false };
}

let n = 0;
export function stay(who: string, placeId: string, arrival: FuzzyDate, departure?: FuzzyDate, group = false): Stay {
  return { ...base, id: `s${++n}`, subject: { kind: group ? 'group' : 'character', id: who }, placeId, arrival, departure, purpose: '', notes: '' };
}

export function journey(who: string, originId: string, destinationId: string, departure: FuzzyDate, arrival?: FuzzyDate, modeId = 'horse', group = false): Journey {
  return { ...base, id: `j${++n}`, subject: { kind: group ? 'group' : 'character', id: who }, originId, destinationId, waypointIds: [], departure, arrival, modeId, purpose: '', notes: '' };
}

export const d = exactDate;
