import { expect, it } from 'vitest';
import { CANON, DEFAULT_BIOMES, DEFAULT_TRAVEL_MODES, World, emptyTerrain, WorldIndex, checkWorld, fromDay, toDayNumber, whereIs } from '../src/core';
import { worldToBytes, bytesToWorld } from '../src/storage';

/** PL-8: 1,000 characters, 2,000 places, 20,000 stays and journeys. */
export function bigWorld(): World {
  const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };
  const w: World = {
    settings: { name: 'Big', radiusKm: 6371, hemisphereForSeasons: 'north', defaultDetourFactor: 1.3, travelModes: DEFAULT_TRAVEL_MODES, disabledRules: [], axialTiltDeg: 23.44, biomes: DEFAULT_BIOMES },
    characters: [], places: [], groups: [], memberships: [], stays: [], journeys: [], mapImages: [], dismissals: [], books: [], chapters: [], scenes: [], manuscripts: [], links: [], mapSymbols: [], terrain: emptyTerrain(),
  } as World;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) w.places.push({ ...base, id: `p${i}`, name: `Place ${i}`, aliases: [], kind: 'town', location: { lat: rnd() * 60 - 30, lng: rnd() * 60 - 30 }, notes: '', isPlaceholder: false });
  for (let i = 0; i < 1000; i++) w.characters.push({ ...base, id: `c${i}`, name: `Char ${i}`, aliases: [], description: '', notes: '', tags: [], color: '#888', icon: '●', importance: 'minor', archived: false });
  const start = toDayNumber({ year: 1040, month: 1, day: 1 });
  for (let i = 0; i < 1000; i++) {
    let day = start + Math.floor(rnd() * 30);
    let place = Math.floor(rnd() * 2000);
    for (let k = 0; k < 10; k++) {
      const len = 5 + Math.floor(rnd() * 30);
      w.stays.push({ ...base, id: `s${i}-${k}`, subject: { kind: 'character', id: `c${i}` }, placeId: `p${place}`, arrival: fromDay(day), departure: fromDay(day + len), purpose: '', notes: '' });
      day += len;
      const next = Math.floor(rnd() * 2000);
      w.journeys.push({ ...base, id: `j${i}-${k}`, subject: { kind: 'character', id: `c${i}` }, originId: `p${place}`, destinationId: `p${next}`, waypointIds: [], departure: fromDay(day), arrival: fromDay(day + 10), modeId: 'magic', purpose: '', notes: '' });
      day += 10;
      place = next;
    }
  }
  return w;
}

it('stays fast at PL-8 scale', async () => {
  const w = bigWorld();
  expect(w.stays.length + w.journeys.length).toBe(20000);
  let t = performance.now();
  const warnings = checkWorld(w);
  const tCheck = performance.now() - t;
  t = performance.now();
  const ix = new WorldIndex(w);
  const day = toDayNumber({ year: 1040, month: 6, day: 1 });
  for (const c of w.characters) whereIs(ix, c.id, day);
  const tWhere = performance.now() - t;
  t = performance.now();
  const bytes = await worldToBytes(w);
  const tSave = performance.now() - t;
  t = performance.now();
  await bytesToWorld(bytes);
  const tLoad = performance.now() - t;
  console.log(JSON.stringify({ warnings: warnings.length, tCheck, tWhere, tSave, tLoad, mb: bytes.length / 1e6 }));
  expect(tCheck).toBeLessThan(1500);
  expect(tWhere).toBeLessThan(500);
  expect(tSave).toBeLessThan(3000);
});
