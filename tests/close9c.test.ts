import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECT, TerrainReader, detectLand, emptyTerrain, laySketchLand } from '../src/core';
import { renderTile } from '../src/ui/map/terrainRender';

describe('smoother land close up (MK-37)', () => {
  it('a quarter of a tile drawn on its own matches that quarter of the whole tile', () => {
    // a round island across the tile at 0..6°E, 6..0°N (tile size 120 cells of 0.05°)
    const W = 60, H = 60;
    const pix = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ink = (x - 30) ** 2 + (y - 30) ** 2 < 400 ? 0 : 255;
      pix.data.set([ink, ink, ink, 255], (y * W + x) * 4);
    }
    const mask = detectLand(pix, { ...DEFAULT_DETECT, mode: 'filled' });
    const t = laySketchLand(emptyTerrain(0.05), mask, { north: 6, south: 0, west: 0, east: 6 }, { mode: 'replace', rough: true, seed: 3 }).terrain;
    const r = new TerrainReader(t);
    const tx = Math.floor(180 / 6), ty = Math.floor(84 / 6);
    const style = { relief: 'hillshade' as const, climate: false, tilt: 23, biomes: [], dark: false };
    const whole = renderTile(r, tx, ty, 480, style);
    const part = renderTile(r, tx, ty, 240, style, { x: 1, y: 1, n: 2 });
    let same = 0, total = 0;
    for (let y = 0; y < 239; y++) for (let x = 0; x < 239; x++) {
      const a = ((y + 240) * 480 + x + 240) * 4, b = (y * 240 + x) * 4;
      total++;
      if (Math.abs(whole.data[a] - part.data[b]) <= 1 && Math.abs(whole.data[a + 2] - part.data[b + 2]) <= 1) same++;
    }
    expect(same / total).toBeGreaterThan(0.99);
    // and sharper: a part at 480 pixels has four times the pixels of the same quarter in the whole tile
    expect(renderTile(r, tx, ty, 480, style, { x: 1, y: 1, n: 2 }).data.length).toBe(whole.data.length);
  });
});
