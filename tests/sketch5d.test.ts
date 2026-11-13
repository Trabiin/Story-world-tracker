import { describe, expect, it } from 'vitest';
import { DEFAULT_DETECT, TerrainReader, detectLand, emptyTerrain, landShare, laySketchLand } from '../src/core';

/** A white picture with black pixels where `ink` says. */
function picture(w: number, h: number, ink: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = ink(x, y) ? 0 : 255, i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}
/** A circle outline of radius r around (cx, cy), with a gap on the right. */
const ring = (cx: number, cy: number, r: number, gapPx = 0) => (x: number, y: number) => {
  const d = Math.hypot(x - cx, y - cy);
  return Math.abs(d - r) < 1 && !(x > cx && Math.abs(y - cy) < gapPx / 2);
};

describe('MK-17 finding land in a sketch', () => {
  it('an outline drawn on paper: inside is land, the open area at the edge is sea', () => {
    const m = detectLand(picture(80, 60, ring(40, 30, 20)), DEFAULT_DETECT);
    expect(m.land[30 * 80 + 40]).toBe(1);
    expect(m.land[2 * 80 + 2]).toBe(0);
    expect(landShare(m)).toBeCloseTo((Math.PI * 20 * 20) / (80 * 60), 1);
  });
  it('closes small breaks in the line, and keeps big breaks open', () => {
    const closed = detectLand(picture(80, 60, ring(40, 30, 20, 3)), { ...DEFAULT_DETECT, gap: 2 });
    expect(closed.land[30 * 80 + 40]).toBe(1);
    const open = detectLand(picture(80, 60, ring(40, 30, 20, 3)), { ...DEFAULT_DETECT, gap: 0 });
    expect(open.land[30 * 80 + 40]).toBe(0);
  });
  it('drops specks and lettering; filled shapes and swapped land and sea', () => {
    const specks = detectLand(picture(80, 60, (x, y) => ring(40, 30, 20)(x, y) || (x === 5 && y === 5)), { ...DEFAULT_DETECT, mode: 'filled', threshold: 128 });
    expect(specks.land[5 * 80 + 5]).toBe(0);
    const blob = detectLand(picture(40, 40, (x, y) => Math.hypot(x - 20, y - 20) < 10), { ...DEFAULT_DETECT, mode: 'filled' });
    expect(blob.land[20 * 40 + 20]).toBe(1);
    expect(blob.land[0]).toBe(0);
    const swapped = detectLand(picture(40, 40, (x, y) => Math.hypot(x - 20, y - 20) < 10), { ...DEFAULT_DETECT, mode: 'filled', invert: true });
    expect(swapped.land[20 * 40 + 20]).toBe(0);
  });
});

describe('MK-15 laying the sketch onto the globe', () => {
  const mask = detectLand(picture(80, 60, ring(40, 30, 20)), DEFAULT_DETECT);
  const b = { north: 10, south: 0, west: 20, east: 33.33 };
  it('flat: land where the sketch has land, inside the sketch only', () => {
    const t = laySketchLand(emptyTerrain(0.1), mask, b, { mode: 'replace', rough: false });
    const r = new TerrainReader(t.terrain);
    expect(r.isLand({ lat: 5, lng: 26.67 })).toBe(true);
    expect(r.isLand({ lat: 9.8, lng: 20.2 })).toBe(false);
    expect(r.isLand({ lat: 5, lng: 40 })).toBe(false);
    expect(t.land).toBeGreaterThan(0);
  });
  it('rough: higher inland than at the coast, seas deepen offshore', () => {
    const t = laySketchLand(emptyTerrain(0.1), mask, b, { mode: 'replace', rough: true, seed: 2 });
    const r = new TerrainReader(t.terrain);
    const centre = r.elevation({ lat: 5, lng: 26.67 });
    const nearCoast = r.elevation({ lat: 5, lng: 26.67 - 3.1 });
    expect(centre).toBeGreaterThan(nearCoast);
    expect(nearCoast).toBeGreaterThan(0);
    expect(r.elevation({ lat: 9.9, lng: 20.1 })).toBeLessThan(r.elevation({ lat: 5, lng: 26.67 - 3.6 }));
  });
  it('"only add land" leaves existing land outside the sketch\'s land alone', () => {
    const first = laySketchLand(emptyTerrain(0.1), { width: 1, height: 1, land: new Uint8Array([1]) }, b, { mode: 'replace', rough: false }).terrain;
    const added = laySketchLand(first, mask, b, { mode: 'add', rough: false }).terrain;
    expect(new TerrainReader(added).isLand({ lat: 9.8, lng: 20.2 })).toBe(true);
    const replaced = laySketchLand(first, mask, b, { mode: 'replace', rough: false }).terrain;
    expect(new TerrainReader(replaced).isLand({ lat: 9.8, lng: 20.2 })).toBe(false);
  });
});
