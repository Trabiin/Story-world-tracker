import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BIOMES, DEFAULT_OCEAN_M, NEW_LAND_M, TILE_CELLS, TerrainEditor, TerrainReader, applyDab, bandEdges, checkWorld, climateBand,
  dabsBetween, emptyTerrain, fillPolygon, findBiomeClashes, grid, resampleTerrain,
} from '../src/core';
import { blobStore, loadWorldFile, makeSnapshot, packTile, restoreSnapshot, unpackTile, worldFromJson, worldToBytes, worldToJson } from '../src/storage';
import { world } from './fixtures';

const R = 6371;
const brush = (tool: Parameters<typeof applyDab>[2]['tool'], radiusKm = 100, extra = {}) => ({ tool, radiusKm, strength: 1, planetRadiusKm: R, ...extra });

describe('terrain grid', () => {
  it('copies only the tiles an edit touches and leaves the original alone', () => {
    const base = emptyTerrain();
    const ed = new TerrainEditor(base);
    applyDab(ed, { lat: 10, lng: 10 }, brush('land'));
    const t1 = ed.commit();
    expect(Object.keys(base.tiles)).toHaveLength(0);
    expect(Object.keys(t1.tiles).length).toBeGreaterThan(0);
    const r = new TerrainReader(t1);
    expect(r.isLand({ lat: 10, lng: 10 })).toBe(true);
    expect(r.isLand({ lat: 10, lng: 12 })).toBe(false); // ~220 km away
    // A second edit elsewhere shares the first edit's tiles.
    const ed2 = new TerrainEditor(t1);
    applyDab(ed2, { lat: -40, lng: -100 }, brush('land'));
    const t2 = ed2.commit();
    for (const k of Object.keys(t1.tiles)) expect(t2.tiles[k]).toBe(t1.tiles[k]);
  });

  it('wraps brushes across the date line', () => {
    const ed = new TerrainEditor(emptyTerrain());
    applyDab(ed, { lat: 0, lng: 179.9 }, brush('land', 80));
    const r = new TerrainReader(ed.commit());
    expect(r.isLand({ lat: 0, lng: 179.5 })).toBe(true);
    expect(r.isLand({ lat: 0, lng: -179.6 })).toBe(true);
  });

  it('a brush near a pole covers many degrees of longitude (projection stretch)', () => {
    const ed = new TerrainEditor(emptyTerrain());
    applyDab(ed, { lat: 80, lng: 0 }, brush('land', 200));
    const r = new TerrainReader(ed.commit());
    // 200 km at 80°N is about 10° of longitude.
    expect(r.isLand({ lat: 80, lng: 8 })).toBe(true);
    expect(r.isLand({ lat: 80, lng: 13 })).toBe(false);
    expect(r.isLand({ lat: 81.5, lng: 0 })).toBe(true);
    expect(r.isLand({ lat: 82.2, lng: 0 })).toBe(false);
  });

  it('paints water, heights, plateaus and terrain types', () => {
    const ed = new TerrainEditor(emptyTerrain());
    applyDab(ed, { lat: 45, lng: 10 }, brush('land', 300));
    applyDab(ed, { lat: 45, lng: 10 }, brush('mountains', 100));
    const r = new TerrainReader(ed.snapshot());
    expect(r.elevation({ lat: 45, lng: 10 })).toBeGreaterThan(NEW_LAND_M + 50);
    applyDab(ed, { lat: 45, lng: 10 }, brush('set-height', 60, { height: 1200 }));
    expect(Math.round(new TerrainReader(ed.snapshot()).elevation({ lat: 45, lng: 10 }))).toBeGreaterThan(1100);
    applyDab(ed, { lat: 45, lng: 12 }, brush('biome', 50, { biome: 2 }));
    expect(new TerrainReader(ed.snapshot()).biome({ lat: 45, lng: 12 })).toBe(2);
    applyDab(ed, { lat: 45, lng: 12 }, brush('water', 50));
    const after = new TerrainReader(ed.commit());
    expect(after.isLand({ lat: 45, lng: 12 })).toBe(false);
    expect(after.biome({ lat: 45, lng: 12 })).toBe(0);
  });

  it('fills polygons, including ones across the date line', () => {
    const ed = new TerrainEditor(emptyTerrain());
    fillPolygon(ed, [{ lat: 5, lng: 175 }, { lat: 5, lng: -175 }, { lat: -5, lng: -175 }, { lat: -5, lng: 175 }], 'land');
    const r = new TerrainReader(ed.commit());
    expect(r.isLand({ lat: 0, lng: 180 })).toBe(true);
    expect(r.isLand({ lat: 0, lng: -176 })).toBe(true);
    expect(r.isLand({ lat: 0, lng: 170 })).toBe(false);
    expect(r.isLand({ lat: 0, lng: 0 })).toBe(false);
  });

  it('spaces dabs along a stroke', () => {
    expect(dabsBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, 20, R)).toHaveLength(5); // 111 km / 20 km
    expect(dabsBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }, 20, R)).toHaveLength(0);
  });

  it('drops tiles that went back to plain ocean, and resamples to another grid size', () => {
    const ed = new TerrainEditor(emptyTerrain(0.1));
    applyDab(ed, { lat: 20, lng: 20 }, brush('land', 150));
    const t = ed.commit();
    expect(grid(0.1).tileDeg).toBe(12);
    const fine = resampleTerrain(t, 0.05);
    expect(fine.cellDeg).toBe(0.05);
    expect(new TerrainReader(fine).isLand({ lat: 20, lng: 20 })).toBe(true);
    expect(new TerrainReader(fine).isLand({ lat: 20, lng: 23 })).toBe(false);
    const ed2 = new TerrainEditor(t);
    for (const k of Object.keys(t.tiles)) {
      const tile = ed2.writable(...(k.split(',').map(Number) as [number, number]));
      tile.elev.fill(DEFAULT_OCEAN_M);
    }
    expect(Object.keys(ed2.commit().tiles)).toHaveLength(0);
  });
});

describe('climate (RC-7) and terrain checks (RC-8)', () => {
  it('puts Earth band edges at the tropics and polar circles', () => {
    const [a, b, c, d] = bandEdges(23.44);
    expect(a).toBeCloseTo(23.44);
    expect(b).toBeCloseTo(35, 0);
    expect(c).toBeCloseTo(55, 0);
    expect(d).toBeCloseTo(66.56);
    expect(climateBand(0, 0)).toBe('tropical');
    expect(climateBand(-50, 0)).toBe('temperate');
    expect(climateBand(75, 0)).toBe('polar');
    // High ground is colder: a 4 km peak on the equator is not tropical.
    expect(climateBand(0, 4000)).not.toBe('tropical');
    // A tilted planet moves the tropics.
    expect(climateBand(30, 0, 35)).toBe('tropical');
  });

  it('flags rainforest near a pole as one patch', () => {
    const w = world();
    const ed = new TerrainEditor(emptyTerrain());
    applyDab(ed, { lat: 72, lng: 30 }, brush('land', 300));
    applyDab(ed, { lat: 72, lng: 30 }, brush('biome', 120, { biome: 3 }));
    applyDab(ed, { lat: 5, lng: 30 }, brush('land', 200));
    applyDab(ed, { lat: 5, lng: 30 }, brush('biome', 100, { biome: 3 })); // fine in the tropics
    w.terrain = ed.commit();
    const clashes = findBiomeClashes(w.terrain, DEFAULT_BIOMES, 23.44, R);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].band).toBe('polar');
    expect(clashes[0].center.lat).toBeCloseTo(72, 0);
    expect(clashes[0].areaKm2).toBeGreaterThan(30000);
    const ws = checkWorld(w).filter((x) => x.rule === 'biome-climate');
    expect(ws).toHaveLength(1);
    expect(ws[0].message).toMatch(/^Rainforest in a polar zone near 72/);
    expect(ws[0].at).toBeDefined();
  });
});

describe('terrain storage', () => {
  it('packs negative heights losslessly', () => {
    const ed = new TerrainEditor(emptyTerrain());
    ed.setCell(5, 5, -10999, 7);
    ed.setCell(6, 5, 8848, 3);
    const tile = ed.commit().tiles['0,0'];
    const back = unpackTile(packTile(tile));
    expect(back.elev).toEqual(tile.elev);
    expect(back.biome).toEqual(tile.biome);
    expect(back.elev.length).toBe(TILE_CELLS * TILE_CELLS);
  });

  it('round-trips terrain through the world file, JSON, and version history', async () => {
    const w = world();
    const ed = new TerrainEditor(emptyTerrain());
    applyDab(ed, { lat: 50, lng: 10 }, brush('land', 200));
    applyDab(ed, { lat: 50, lng: 10 }, brush('hills', 100));
    w.terrain = ed.commit();
    const snap = await makeSnapshot(w, 'Coast drawn');
    const ed2 = new TerrainEditor(w.terrain);
    applyDab(ed2, { lat: 50, lng: 10 }, brush('water', 300));
    const later = { ...w, terrain: ed2.commit() };
    const bytes = await worldToBytes(later, [snap]);
    blobStore.clear(); // as if opened fresh
    const { world: loaded, snapshots } = await loadWorldFile(bytes);
    expect(loaded.terrain).toEqual(later.terrain);
    const restored = await restoreSnapshot(snapshots[0], loaded);
    expect(restored.terrain).toEqual(w.terrain);
    expect(new TerrainReader(restored.terrain).isLand({ lat: 50, lng: 10 })).toBe(true);
    expect(worldFromJson(worldToJson(w)).terrain).toEqual(w.terrain);
  });
});
