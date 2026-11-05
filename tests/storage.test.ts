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

import { loadWorldFile, makeSnapshot, restoreSnapshot } from '../src/storage';
describe('version history', () => {
  it('keeps snapshots inside the world file and restores them', async () => {
    const w = world();
    w.mapImages.push({ id: 'img', scenarioId: 'canon', status: 'canon', createdAt: '', updatedAt: '', name: 'Sketch', dataUrl: 'data:image/png;base64,AAAA', widthPx: 1, heightPx: 1, north: 1, south: 0, west: 0, east: 1, opacity: 1, locked: false, visible: true });
    const snap = await makeSnapshot(w, 'Before the war');
    const changed = { ...w, characters: [] };
    const { world: loaded, snapshots } = await loadWorldFile(await worldToBytes(changed, [snap]));
    expect(loaded.characters).toHaveLength(0);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].label).toBe('Before the war');
    const restored = await restoreSnapshot(snapshots[0], loaded);
    expect(restored.characters.map((c) => c.name)).toEqual(['Kaela', 'Bren']);
    expect(restored.mapImages[0].dataUrl).toBe('data:image/png;base64,AAAA');
  });
});
