import { describe, expect, it } from 'vitest';
import {
  MapFeature, TerrainEditor, carveValley, TerrainReader, applyDab, checkRivers, checkWorld, emptyTerrain, nearestOnPolyline, profile, riverFlows,
  traceDownhill, uphillSegments, uphillStretches,
} from '../src/core';
import { world } from './fixtures';

const R = 6371;
const base = { scenarioId: 'canon', status: 'canon' as const, createdAt: '', updatedAt: '', notes: '' };
const river = (id: string, pts: [number, number][], extra: Partial<MapFeature> = {}): MapFeature =>
  ({ ...base, id, shape: 'line', kind: 'river', name: id, points: pts.map(([lat, lng]) => ({ lat, lng })), ...extra });

/** A continent at 40–50°N, 0–20°E sloping down to the west coast, with a hill at 45°N 15°E. */
function slopedWorld() {
  const w = world();
  const ed = new TerrainEditor(emptyTerrain());
  for (let gy = 800; gy < 1000; gy++) for (let gx = 3600; gx < 4000; gx++) {
    const lng = -180 + (gx + 0.5) * 0.05;
    ed.setCell(gx, gy, lng < 1 ? -50 : 20 + lng * 60); // 40–50°N, 0–20°E, rising eastward from the coast at 1°E
  }
  applyDab(ed, { lat: 45, lng: 15 }, { tool: 'set-height', height: 3000, radiusKm: 60, strength: 1, planetRadiusKm: R });
  w.terrain = ed.commit();
  return w;
}

describe('rivers', () => {
  it('traces a river downhill to the sea (MK-19) and it passes RC-1 by design', () => {
    const w = slopedWorld();
    const t = traceDownhill(w.terrain, { lat: 47, lng: 12 });
    expect(t.endsIn).toBe('sea');
    const last = t.points[t.points.length - 1];
    expect(last.lng).toBeLessThan(1.05);
    const reader = new TerrainReader(w.terrain);
    expect(uphillStretches(profile(reader, t.points, R))).toHaveLength(0);
    w.mapFeatures = [river('auto', [], { points: t.points, auto: true })];
    expect(checkRivers(w)).toHaveLength(0);
  });

  it('crosses flat ground and stops in a hollow', () => {
    const w = world();
    const ed = new TerrainEditor(emptyTerrain());
    applyDab(ed, { lat: 10, lng: 10 }, { tool: 'land', radiusKm: 300, strength: 1, planetRadiusKm: R }); // flat 30 m island
    w.terrain = ed.commit();
    expect(traceDownhill(w.terrain, { lat: 10, lng: 10 }).endsIn).toBe('sea');
    const ed2 = new TerrainEditor(w.terrain);
    applyDab(ed2, { lat: 10, lng: 10 }, { tool: 'set-height', height: 1500, radiusKm: 250, strength: 1, planetRadiusKm: R });
    applyDab(ed2, { lat: 10, lng: 10 }, { tool: 'set-height', height: 40, radiusKm: 40, strength: 1, planetRadiusKm: R }); // a deep crater
    const t = traceDownhill(ed2.commit(), { lat: 10.1, lng: 10.1 });
    expect(t.endsIn).toBe('basin');
  });

  it('spills out of a shallow hollow and cuts its valley so it never runs uphill', () => {
    const w = slopedWorld();
    const ed = new TerrainEditor(w.terrain);
    // a 120 m deep hollow across the river's way, at 47°N 9°E
    applyDab(ed, { lat: 47, lng: 9 }, { tool: 'set-height', height: 20 + 9 * 60 - 120, radiusKm: 40, strength: 1, planetRadiusKm: R });
    const terrain = ed.commit();
    const t = traceDownhill(terrain, { lat: 47, lng: 12 });
    expect(t.endsIn).toBe('sea');
    expect(t.spilled).toBe(true);
    expect(uphillStretches(profile(new TerrainReader(terrain), t.points, R)).length).toBeGreaterThan(0);
    const carved = carveValley(terrain, t.cells);
    expect(uphillStretches(profile(new TerrainReader(carved), t.points, R))).toHaveLength(0);
    // nothing to cut on a plain slope
    const plain = traceDownhill(w.terrain, { lat: 47, lng: 12 });
    expect(carveValley(w.terrain, plain.cells)).toBe(w.terrain);
  });

  it('flags a river drawn uphill (RC-1) and shows the climbing segments while drawing (MK-22)', () => {
    const w = slopedWorld();
    w.mapFeatures = [river('up', [[46, 2], [46, 8], [46, 14]])];
    const issues = checkRivers(w);
    expect(issues.map((i) => i.rule)).toContain('river-uphill');
    expect(issues.find((i) => i.rule === 'river-uphill')!.message).toMatch(/climbing up to \d+ m/);
    expect([...uphillSegments(w.terrain, w.mapFeatures[0].points, R)].sort()).toEqual([0, 1]);
    // Drawn backwards out of the sea it is caught too.
    w.mapFeatures = [river('backwards', [[46, 0.5], [46, 8]])];
    expect(checkRivers(w).map((i) => i.rule)).toContain('river-uphill');
    // Drawn the other way it is fine.
    w.mapFeatures = [river('down', [[46, 14], [46, 8], [46, 0.5]])];
    expect(checkRivers(w)).toHaveLength(0);
  });

  it('flags dead ends (RC-2) unless the river reaches the sea, a lake, a river or a marked basin', () => {
    const w = slopedWorld();
    w.mapFeatures = [river('stub', [[48, 12], [48, 8]])];
    expect(checkRivers(w).map((i) => i.rule)).toEqual(['river-dead-end']);
    w.mapFeatures = [river('stub', [[48, 12], [48, 8]], { endsInBasin: true })];
    expect(checkRivers(w)).toHaveLength(0);
    w.mapFeatures = [
      river('stub', [[48, 12], [48, 8]]),
      { ...base, id: 'lake', shape: 'area', kind: 'lake', name: 'Mere', points: [{ lat: 48.3, lng: 7.6 }, { lat: 48.3, lng: 8.4 }, { lat: 47.7, lng: 8.4 }, { lat: 47.7, lng: 7.6 }] },
    ];
    expect(checkRivers(w)).toHaveLength(0);
    w.mapFeatures = [river('main', [[44, 12], [44, 0.5]]), river('trib', [[47, 10], [44.02, 6]], { joinsId: 'main' })];
    expect(checkRivers(w)).toHaveLength(0);
  });

  it('flags a fork (RC-3) unless it is a delta or intentional', () => {
    const w = slopedWorld();
    w.mapFeatures = [river('main', [[44, 14], [44, 0.5]]), river('branch', [[44, 8], [42, 0.5]])];
    expect(checkRivers(w).map((i) => i.rule)).toEqual(['river-split']);
    w.mapFeatures[1] = { ...w.mapFeatures[1], fork: 'delta' };
    expect(checkRivers(w)).toHaveLength(0);
    // Starting where another river ends is a continuation, not a fork.
    w.mapFeatures = [river('upper', [[44, 14], [44, 8]]), river('lower', [[44, 8], [44, 0.5]])];
    expect(checkRivers(w)).toHaveLength(0);
    const ws = checkWorld({ ...w, mapFeatures: [river('main', [[44, 14], [44, 0.5]]), river('branch', [[44, 8], [42, 0.5]])] });
    expect(ws.find((x) => x.rule === 'river-split')?.at).toBeDefined();
  });

  it('grows rivers downstream, adding tributaries where they join (MK-8)', () => {
    const fs = [river('main', [[44, 14], [44, 10], [44, 6], [44, 2]]), river('trib', [[47, 9], [44, 7]], { joinsId: 'main' })];
    const f = riverFlows(fs, R);
    const main = f.get('main')!, trib = f.get('trib')!;
    expect(main[0]).toBe(0);
    expect(main[1]).toBeCloseTo(320, -1);
    // trib joins on the segment 10°E → 6°E, so it counts from vertex 2 on
    expect(main[2] - main[1]).toBeCloseTo(320 + trib[1], -1);
    expect(nearestOnPolyline({ lat: 44.5, lng: 8 }, fs[0].points, R)!.km).toBeCloseTo(55.6, 0);
  });
});
