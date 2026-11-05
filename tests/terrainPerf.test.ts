import { expect, it } from 'vitest';
import { TerrainEditor, applyDab, checkWorld, emptyTerrain, fillPolygon } from '../src/core';
import { worldToBytes } from '../src/storage';
import { world } from './fixtures';

/** A continent covering about a quarter of the globe stays quick to check and save. */
it('checks and saves a quarter-globe continent quickly', async () => {
  const w = world();
  const ed = new TerrainEditor(emptyTerrain());
  fillPolygon(ed, [{ lat: 70, lng: -60 }, { lat: 70, lng: 60 }, { lat: -50, lng: 60 }, { lat: -50, lng: -60 }], 'land');
  applyDab(ed, { lat: 60, lng: 0 }, { tool: 'biome', biome: 3, radiusKm: 800, strength: 1, planetRadiusKm: 6371 });
  w.terrain = ed.commit();
  const tiles = Object.keys(w.terrain.tiles).length;
  let t = performance.now();
  const warnings = checkWorld(w).filter((x) => x.rule === 'biome-climate');
  const checkMs = performance.now() - t;
  t = performance.now();
  const bytes = await worldToBytes(w);
  const saveMs = performance.now() - t;
  t = performance.now();
  await worldToBytes(w); // tiles already packed: only the file is rebuilt
  const resaveMs = performance.now() - t;
  console.log({ tiles, checkMs: Math.round(checkMs), saveMs: Math.round(saveMs), resaveMs: Math.round(resaveMs), mb: (bytes.byteLength / 1e6).toFixed(2) });
  expect(warnings.length).toBeGreaterThan(0);
  expect(checkMs).toBeLessThan(1500);
  expect(resaveMs).toBeLessThan(1000);
}, 30000);
