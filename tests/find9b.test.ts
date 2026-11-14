import { describe, expect, it } from 'vitest';
import { FindEntry, boundsOf, boundsOfArea, findMatches, viewForBounds, viewForEntry } from '../src/ui/map/findOnMap';

const at = { lat: 48, lng: 14 };
const e = (name: string, extra: Partial<FindEntry> = {}): FindEntry => ({ kind: 'place', id: name, name, note: 'city', at, ...extra });

describe('find on the map (MK-30)', () => {
  it('ranks names that start with the text first, then words, then anywhere; aliases count', () => {
    const list = [e('Thornwick'), e('Ashford'), e('Port Ash'), e('Varn', { aliases: ['Ashen Crown'] }), e('Glassrun')];
    expect(findMatches(list, 'ash').map((x) => x.name)).toEqual(['Ashford', 'Varn', 'Port Ash']);
    expect(findMatches(list, 'run').map((x) => x.name)).toEqual(['Glassrun']);
    expect(findMatches(list, '  ')).toEqual([]);
    expect(findMatches(list, 'zzz')).toEqual([]);
  });

  it('frames lines and realms, and zooms in on a spot', () => {
    const b = boundsOf([{ lat: 40, lng: 10 }, { lat: 44, lng: 18 }])!;
    expect(b).toEqual({ north: 44, south: 40, west: 10, east: 18 });
    expect(boundsOfArea([[[[10, 40], [18, 40], [18, 44], [10, 40]]]])).toEqual(b);
    const v = viewForBounds(b, { w: 800, h: 600 });
    expect(v.centerLat).toBe(42); expect(v.centerLng).toBe(14);
    expect(v.scale).toBeCloseTo(Math.min(800 / 8, 600 / 4) * 0.75);
    const cur = { centerLat: 0, centerLng: 0, scale: 5 };
    expect(viewForEntry(e('Varn'), cur, { w: 800, h: 600 })).toEqual({ centerLat: 48, centerLng: 14, scale: 60 });
    // already closer: keep the zoom
    expect(viewForEntry(e('Varn'), { ...cur, scale: 300 }, { w: 800, h: 600 }).scale).toBe(300);
    expect(viewForEntry(e('Road', { kind: 'feature', bounds: b }), cur, { w: 800, h: 600 }).centerLat).toBe(42);
  });
});
