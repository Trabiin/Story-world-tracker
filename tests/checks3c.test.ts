import { describe, expect, it } from 'vitest';
import {
  MapFeature, TerrainEditor, TerrainReader, addCoastDetail, addDetailToFeatures, applyDab, applyFix, checkWater, checkWorld, emptyTerrain, findRainShadows,
  localSeasons, removeCoastDetail, removeDetailFromFeatures, suggestBiomes, wiggleLine, windFrom,
} from '../src/core';
import { bytesToWorld, worldToBytes } from '../src/storage';
import { place, world } from './fixtures';

const R = 6371;
const base = { scenarioId: 'canon', status: 'canon' as const, createdAt: '', updatedAt: '', notes: '' };
const feat = (id: string, kind: MapFeature['kind'], pts: [number, number][], extra: Partial<MapFeature> = {}): MapFeature =>
  ({ ...base, id, shape: kind === 'river' || kind === 'road' ? 'line' : 'area', kind, name: id, points: pts.map(([lat, lng]) => ({ lat, lng })), ...extra });
let n = 0;
const make = () => ({ id: `new${++n}`, scenarioId: 'canon', status: 'canon' as const, createdAt: '', updatedAt: '' });

/** Land at 40–50°N, 0–20°E rising eastward from the coast at 1°E (20 m + 60 m per degree). */
function sloped() {
  const w = world();
  const ed = new TerrainEditor(emptyTerrain());
  for (let gy = 800; gy < 1000; gy++) for (let gx = 3600; gx < 4000; gx++) {
    const lng = -180 + (gx + 0.5) * 0.05;
    ed.setCell(gx, gy, lng < 1 ? -50 : 20 + lng * 60);
  }
  w.terrain = ed.commit();
  return w;
}

describe('water checks (RC-4, RC-5, RC-6, RC-11)', () => {
  it('a lake needs one outlet unless it is salty, and the fix adds one downhill', () => {
    const w = sloped();
    const lake = feat('mere', 'lake', [[46, 10], [46, 11], [47, 11], [47, 10]]);
    w.mapFeatures = [lake, feat('in', 'river', [[46.5, 14], [46.5, 11.5], [46.5, 10.9]])];
    const issues = checkWater(w).filter((i) => i.rule === 'lake-outlet');
    expect(issues).toHaveLength(1);
    expect(issues[0].fix).toEqual({ kind: 'trace-outlet', lakeId: 'mere' });
    const fixed = applyFix(w, issues[0].fix!, make)!;
    const out = fixed.mapFeatures.find((f) => f.name === 'mere outflow')!;
    expect(fixed.mapFeatures.find((f) => f.id === 'mere')!.outletId).toBe(out.id);
    expect(out.points[out.points.length - 1].lng).toBeLessThan(1.1); // reaches the west coast
    expect(fixed.places.some((p) => p.id === out.placeId)).toBe(true);
    expect(checkWater(fixed).filter((i) => i.rule === 'lake-outlet')).toHaveLength(0);
    // two outlets
    const two = { ...w, mapFeatures: [lake, feat('a', 'river', [[46.2, 10.1], [46.2, 5]]), feat('b', 'river', [[46.8, 10.1], [46.8, 5]])] };
    expect(checkWater(two).find((i) => i.rule === 'lake-outlet')!.key).toBe('lake-outlet:mere:many');
    // salt lake is fine without one
    expect(checkWater({ ...w, mapFeatures: [{ ...lake, salt: true }] }).filter((i) => i.rule === 'lake-outlet')).toHaveLength(0);
  });

  it('rivers must not run into mountains or through each other', () => {
    const w = world();
    w.mapFeatures = [
      feat('range', 'mountains', [[45, 5], [45, 6], [50, 6], [50, 5]]),
      feat('lowland', 'river', [[47, 2], [47, 8]]), // runs into the range from the west
      feat('highland', 'river', [[47.5, 5.5], [47.5, 9]]), // starts in it: fine
      feat('cross', 'river', [[46, 7], [48, 7.2]]), // crosses "lowland" in the middle
    ];
    const keys = checkWater(w).filter((i) => i.rule === 'river-crossing').map((i) => i.key);
    expect(keys).toContain('river-crossing:lowland:range');
    expect(keys).not.toContain('river-crossing:highland:range');
    expect(keys.some((k) => k.includes('cross') && k.includes('lowland'))).toBe(true);
    const ok = applyFix(w, { kind: 'mark-crossing', riverId: 'lowland' }, make)!;
    expect(checkWater(ok).filter((i) => i.key === 'river-crossing:lowland:range')).toHaveLength(0);
  });

  it('a river rising on low, dry ground is flagged; a spring or a hill source is fine', () => {
    const w = sloped();
    w.mapFeatures = [feat('low', 'river', [[45, 1.6], [45, 1.05]])];
    expect(checkWater(w).map((i) => i.rule)).toContain('river-source');
    w.mapFeatures = [feat('low', 'river', [[45, 1.6], [45, 1.05]], { spring: true }), feat('high', 'river', [[45, 12], [45, 1.05]])];
    expect(checkWater(w).filter((i) => i.rule === 'river-source')).toHaveLength(0);
  });

  it('a city far from water is flagged; a port on the coast is not', () => {
    const w = sloped();
    w.places = [{ ...place('inland', 'Drywell', { lat: 45, lng: 15 }), kind: 'city' }, { ...place('port', 'Saltmouth', { lat: 45, lng: 1.1 }), kind: 'port' }, { ...place('hamlet', 'Hamlet', { lat: 45, lng: 16 }), kind: 'village' }];
    const flagged = checkWater(w).filter((i) => i.rule === 'settlement-water').map((i) => i.placeId);
    expect(flagged).toEqual(['inland']);
    const warn = checkWorld(w).find((x) => x.rule === 'settlement-water')!;
    expect(warn.message).toContain('Drywell');
  });
});

describe('climate (RC-9, RC-10)', () => {
  it('Earth-like winds and a rain shadow behind a range', () => {
    expect(windFrom(10, 'earth')).toBe(90);
    expect(windFrom(45, 'earth')).toBe(270);
    expect(windFrom(70, 'earth')).toBe(90);
    const w = world();
    const ed = new TerrainEditor(emptyTerrain());
    for (let gy = 800; gy < 1000; gy++) for (let gx = 3600; gx < 4000; gx++) {
      const lng = -180 + (gx + 0.5) * 0.05;
      ed.setCell(gx, gy, Math.abs(lng - 8) < 1 ? 3000 : 100, lng > 10 && lng < 14 ? 3 : 0); // rainforest east of a range
    }
    w.terrain = ed.commit();
    const shadows = findRainShadows(w.terrain, w.settings.biomes, 'earth', R);
    expect(shadows).toHaveLength(1);
    expect(shadows[0].windFromDeg).toBe(270);
    // wind from the east: the rainforest is on the windward side
    expect(findRainShadows(w.terrain, w.settings.biomes, 90, R)).toHaveLength(0);
    // the check is optional
    expect(checkWorld(w).some((x) => x.rule === 'rain-shadow')).toBe(false);
    w.settings.winds = { check: true, from: 'earth' };
    expect(checkWorld(w).some((x) => x.rule === 'rain-shadow')).toBe(true);
  });

  it('winters grow longer towards the poles and with the tilt', () => {
    const eq = localSeasons(0, 0);
    const mid = localSeasons(45, 0);
    const north = localSeasons(65, 0);
    expect(eq.winterDays).toBe(0);
    expect(mid.winterDays).toBeGreaterThan(60);
    expect(north.winterDays).toBeGreaterThan(mid.winterDays + 60);
    expect(north.summerDays).toBeLessThan(mid.summerDays);
    expect(north.midnightSun).toBe(false);
    expect(localSeasons(70, 0).midnightSun).toBe(true);
    expect(localSeasons(45, 0, 5).winterDays).toBeLessThan(mid.winterDays);
    expect(mid.text).toMatch(/^Winter lasts about \d months, summer about \d months\.$/);
  });
});

describe('terrain suggestions and detail (MK-20, MK-21)', () => {
  it('proposes forest, desert and ice by climate, only on unpainted land when asked', () => {
    const w = world();
    const ed = new TerrainEditor(emptyTerrain(0.1));
    applyDab(ed, { lat: 5, lng: 10 }, { tool: 'land', radiusKm: 200, strength: 1, planetRadiusKm: R });
    applyDab(ed, { lat: 50, lng: 10 }, { tool: 'land', radiusKm: 200, strength: 1, planetRadiusKm: R });
    applyDab(ed, { lat: 80, lng: 10 }, { tool: 'land', radiusKm: 200, strength: 1, planetRadiusKm: R });
    w.terrain = ed.commit();
    const s = suggestBiomes(w.terrain, w.settings.biomes, { tiltDeg: 23.44, radiusKm: R, winds: 'earth', onlyUnpainted: true });
    const reader = new TerrainReader(s.terrain);
    const nameAt = (lat: number) => w.settings.biomes.find((b) => b.id === reader.biome({ lat, lng: 10 }))?.name;
    expect(nameAt(5)).toBe('Rainforest');
    expect(nameAt(50)).toBe('Forest');
    expect(['Ice', 'Tundra']).toContain(nameAt(80));
    expect(s.cells).toBeGreaterThan(100);
    // already painted land is left alone
    const again = suggestBiomes(s.terrain, w.settings.biomes, { tiltDeg: 23.44, radiusKm: R, winds: 'earth', onlyUnpainted: true });
    expect(again.cells).toBe(0);
  });

  it('adds coastline detail that can be removed exactly, and keeps it when saved', async () => {
    const w = sloped();
    const withDetail = addCoastDetail(w.terrain, 3);
    const a = new TerrainReader(w.terrain), b = new TerrainReader(withDetail);
    let moved = 0;
    for (let lat = 41; lat < 49; lat += 0.5) if ((a.elevation({ lat, lng: 1.02 }) > 0) !== (b.elevation({ lat, lng: 1.02 }) > 0)) moved++;
    expect(moved).toBeGreaterThan(0);
    const back = removeCoastDetail(withDetail);
    for (const [k, t] of Object.entries(w.terrain.tiles)) expect(Array.from(back.tiles[k].elev)).toEqual(Array.from(t.elev));
    w.terrain = withDetail;
    const saved = await bytesToWorld(await worldToBytes(w));
    expect(Object.values(saved.terrain.tiles).some((t) => !!t.detail)).toBe(true);
    expect(removeCoastDetail(saved.terrain).tiles[Object.keys(back.tiles)[0]].elev).toEqual(back.tiles[Object.keys(back.tiles)[0]].elev);
  });

  it('wiggles drawn lines, keeps their ends, and puts them back', () => {
    const pts = [{ lat: 45, lng: 5 }, { lat: 45, lng: 6 }];
    const wig = wiggleLine(pts, R, false, 2);
    expect(wig.length).toBeGreaterThan(4);
    expect(wig[0]).toEqual(pts[0]);
    expect(wig[wig.length - 1]).toEqual(pts[1]);
    const w = world();
    w.mapFeatures = [feat('r', 'river', [[45, 5], [45, 6]]), feat('t', 'river', [[46, 5.5], [45, 5.5]], { joinsId: 'r' }), feat('auto', 'river', [[44, 5], [44, 6]], { auto: true })];
    const d = addDetailToFeatures(w);
    expect(d.mapFeatures[0].points.length).toBeGreaterThan(2);
    expect(d.mapFeatures[2].points).toHaveLength(2); // automatic rivers already follow the land
    const removed = removeDetailFromFeatures(d);
    expect(removed.mapFeatures[0].points).toEqual(w.mapFeatures[0].points);
    expect(removed.mapFeatures[0].roughPoints).toBeUndefined();
  });
});
