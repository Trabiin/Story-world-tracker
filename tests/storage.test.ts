import { describe, expect, it } from 'vitest';
import { bytesToWorld, createEmptyWorld, placesToGeoJson, worldFromJson, worldToBytes, worldToJson } from '../src/storage';
import { d, stay, world } from './fixtures';

describe('storage', () => {
  it('round-trips a world through a SQLite file', async () => {
    const w = world();
    w.stays.push(stay('kaela', 'varn', d(1042, 5, 1), d(1042, 5, 3)));
    w.dismissals.push({ key: 'gap:x', note: 'n', at: '' });
    const bytes = await worldToBytes(w);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 15))).toBe('SQLite format 3');
    expect(await bytesToWorld(bytes)).toEqual(w);
  });
  it('round-trips JSON and writes GeoJSON in lng/lat order', () => {
    const w = world();
    expect(worldFromJson(worldToJson(w))).toEqual(w);
    const gj = JSON.parse(placesToGeoJson(w));
    const varn = gj.features.find((f: { id: string }) => f.id === 'varn');
    expect(varn.geometry.coordinates).toEqual([10, 50]);
    const hall = gj.features.find((f: { id: string }) => f.id === 'hall');
    expect(hall.properties.positionInherited).toBe(true);
    expect(gj.features.find((f: { id: string }) => f.id === 'nowhere')).toBeUndefined();
  });
  it('new worlds include the unknown-place placeholder', () => {
    const w = createEmptyWorld('Series');
    expect(w.places[0].isPlaceholder).toBe(true);
  });
});
