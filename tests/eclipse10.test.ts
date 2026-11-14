/** Phase 10: eclipses (EC-1..EC-8). */
import { describe, expect, it } from 'vitest';
import {
  CANON, EclipseShadow, WorldEvent, distanceToPathKm, effectGrid, effectSeries, effectsAt, eclipsesOn, exactDate, greatCircleKm,
  pathOutline, placeShadows, shadowCoverage, shadowDepth, shadowHours, shadowsOn, skyFacts, toDayNumber, zoneAt,
} from '../src/core';
import { worldToBytes, bytesToWorld } from '../src/storage';
import { world } from './fixtures';

const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };
const day = (y: number, m: number, d: number) => toDayNumber({ year: y, month: m, day: d });

function eclipse(shadow: Partial<EclipseShadow> = {}, end = exactDate(6010, 1, 1)): WorldEvent {
  return {
    ...base, id: 'ecl', name: 'The Long Eclipse', kind: 'eclipse', characterIds: [], description: '',
    start: exactDate(6000, 1, 1), end,
    // west to east along latitude 50, through Varn (50N 10E)
    shadow: { kind: 'annular', track: [{ lat: 50, lng: 0 }, { lat: 50, lng: 20 }], bandKm: 400, partialKm: 2000, hours: 2, steps: [], ...shadow },
  };
}

describe('EC-3 sky', () => {
  it('works out apparent sizes, coverage and natural widths from Ojon\'s CHR-003 numbers', () => {
    const f = skyFacts({ sunRadiusKm: 650_000, sunDistanceKm: 75_000_000, moons: [{ id: 'm', name: 'Moon', radiusKm: 18_000, distanceKm: 2_300_000 }] }, 6400);
    expect(f.sunDiameterDeg).toBeCloseTo(0.99, 1);
    const m = f.moons[0];
    expect(m.diameterDeg).toBeCloseTo(0.9, 1);
    expect(m.kind).toBe('annular');
    expect(m.ratio).toBeGreaterThan(0.88);
    expect(m.ratio).toBeLessThan(0.93);
    expect(m.coverage).toBeGreaterThan(78);
    expect(m.coverage).toBeLessThan(86);
    // a straight antumbra cone gives a band of a few thousand km, far wider than the 400 km Ojon chose
    expect(m.bandKm).toBeGreaterThan(3000);
    expect(m.bandKm).toBeLessThan(4500);
    expect(m.partialKm).toBe(Infinity);
  });
  it('a big close moon makes a total eclipse; earth and moon give a narrow band', () => {
    const f = skyFacts({ sunRadiusKm: 696_000, sunDistanceKm: 149_600_000, moons: [{ id: 'm', name: 'Luna', radiusKm: 1737, distanceKm: 363_300 }] }, 6371);
    expect(f.moons[0].kind).toBe('total');
    expect(f.moons[0].bandKm).toBeGreaterThan(50);
    expect(f.moons[0].bandKm).toBeLessThan(300);
  });
  it('coverage comes from the eclipse, then the sky, then a default', () => {
    const w = world();
    expect(shadowCoverage(w, eclipse().shadow!)).toBeCloseTo(0.81);
    expect(shadowCoverage(w, eclipse({ kind: 'total' }).shadow!)).toBe(1);
    expect(shadowCoverage(w, eclipse({ coverage: 70 }).shadow!)).toBeCloseTo(0.7);
    w.settings.sky = { sunRadiusKm: 650_000, sunDistanceKm: 75_000_000, moons: [{ id: 'm', name: 'Moon', radiusKm: 18_000, distanceKm: 2_300_000 }] };
    expect(shadowCoverage(w, eclipse().shadow!)).toBeGreaterThan(0.78);
  });
});

describe('EC-1 geometry', () => {
  it('measures the distance to the centre line on the globe', () => {
    const track = [{ lat: 50, lng: 0 }, { lat: 50, lng: 20 }];
    expect(distanceToPathKm({ lat: 50, lng: 10 }, track, 6371)).toBeLessThan(60); // the great circle bows north of the parallel
    const north = distanceToPathKm({ lat: 53, lng: 10 }, track, 6371);
    expect(north).toBeGreaterThan(250);
    expect(north).toBeLessThan(400);
    // past the end: distance to the end point
    expect(distanceToPathKm({ lat: 50, lng: 25 }, track, 6371)).toBeCloseTo(greatCircleKm({ lat: 50, lng: 25 }, { lat: 50, lng: 20 }), 0);
  });
  it('the outline lies at half the width from the centre line', () => {
    const track = [{ lat: 50, lng: 0 }, { lat: 52, lng: 20 }];
    const ring = pathOutline(track, 400, 6371);
    expect(ring.length).toBeGreaterThan(20);
    for (const [lng, lat] of ring) expect(Math.abs(distanceToPathKm({ lat, lng }, track, 6371) - 200)).toBeLessThan(15);
  });
  it('depth: full in the band, fading out across the partial zone', () => {
    const s = eclipse().shadow!;
    expect(shadowDepth(s, 0, 0.81)).toBeCloseTo(0.81);
    expect(shadowDepth(s, 200, 0.81)).toBeCloseTo(0.81);
    expect(shadowDepth(s, 600, 0.81)).toBeCloseTo(0.405);
    expect(shadowDepth(s, 1000, 0.81)).toBe(0);
    expect(zoneAt(s, 100)).toBe('band');
    expect(zoneAt(s, 500)).toBe('partial');
    expect(zoneAt(s, 1500)).toBeNull();
  });
});

describe('EC-2 daily hours', () => {
  it('holds or changes gradually between steps, and is 0 outside the dates', () => {
    const w = world();
    const e = eclipse({ hours: 1, steps: [{ id: 'a', from: exactDate(6002, 1, 1), hours: 5 }, { id: 'b', from: exactDate(6004, 1, 1), hours: 2 }] });
    expect(shadowHours(w, e, day(5999, 12, 31))).toBe(0);
    expect(shadowHours(w, e, day(6001, 1, 1))).toBe(1);
    expect(shadowHours(w, e, day(6003, 1, 1))).toBe(5);
    expect(shadowHours(w, e, day(6005, 1, 1))).toBe(2);
    expect(shadowHours(w, e, day(6011, 1, 1))).toBe(0);
    const g = { ...e, shadow: { ...e.shadow!, gradual: true } };
    expect(shadowHours(w, g, day(6001, 1, 1))).toBeCloseTo(3, 0);
    expect(shadowHours(w, g, day(6003, 1, 1))).toBeCloseTo(3.5, 0);
  });
});

describe('EC-4, EC-5 effects', () => {
  it('a place in the band loses light, cools and its forest declines; outside nothing happens', () => {
    const w = world();
    w.events = [eclipse({ hours: 4 })];
    const varn = placeShadows(w, { lat: 50, lng: 10 });
    expect(varn.reach[0].zone).toBe('band');
    const today = shadowsOn(w, varn, day(6001, 6, 1));
    expect(today[0].lightLost).toBeCloseTo(0.81 * 4 / 12, 2);
    const after1 = effectsAt(w, varn, day(6001, 1, 1));
    expect(after1.coolingC).toBeLessThan(-6);
    expect(after1.coolingC).toBeGreaterThan(-7);
    expect(after1.forest).toBeLessThan(100);
    const after5 = effectsAt(w, varn, day(6005, 1, 1));
    expect(after5.forest).toBeLessThan(after1.forest);
    expect(after5.forest).toBeGreaterThan(20); // slowly, not at once
    // after the eclipse ends temperatures recover and forests regrow
    const later = effectsAt(w, varn, day(6012, 1, 1));
    expect(later.lightLost).toBe(0);
    expect(later.coolingC).toBeGreaterThan(-0.5);
    const muchLater = effectsAt(w, varn, day(6020, 1, 1));
    expect(muchLater.forest).toBeGreaterThan(later.forest);

    const far = placeShadows(w, { lat: 20, lng: 10 });
    expect(far.reach).toHaveLength(0);
    expect(effectsAt(w, far, day(6005, 1, 1))).toEqual({ lightLost: 0, coolingC: 0, forest: 100 });
  });
  it('the partial zone suffers less than the band, and the rules can be changed', () => {
    const w = world();
    w.events = [eclipse({ hours: 4 })];
    const band = effectsAt(w, placeShadows(w, { lat: 50, lng: 10 }), day(6003, 1, 1));
    const partial = effectsAt(w, placeShadows(w, { lat: 55, lng: 10 }), day(6003, 1, 1));
    expect(partial.coolingC).toBeGreaterThan(band.coolingC);
    expect(partial.forest).toBeGreaterThan(band.forest);
    w.settings.eclipseRules = { coolingC: 50 };
    expect(effectsAt(w, placeShadows(w, { lat: 50, lng: 10 }), day(6003, 1, 1)).coolingC).toBeLessThan(band.coolingC * 1.8);
  });
  it('a series for the chart, and a map grid that agrees with the place', () => {
    const w = world();
    w.events = [eclipse({ hours: 4 })];
    const ps = placeShadows(w, { lat: 50, lng: 10 });
    const s = effectSeries(w, ps, day(6012, 1, 1), 60)!;
    expect(s.points.length).toBeGreaterThan(60);
    expect(Math.min(...s.points.map((p) => p.coolingC))).toBeLessThan(-6);
    const t0 = performance.now();
    const g = effectGrid(w, day(6004, 1, 1))!;
    expect(performance.now() - t0).toBeLessThan(500);
    const c = Math.floor((10 - g.west) / g.cellDeg), r = Math.floor((g.north - 50) / g.cellDeg);
    const cell = g.cells[r * g.cols + c]!;
    const exact = effectsAt(w, ps, day(6004, 1, 1));
    expect(Math.abs(cell.coolingC - exact.coolingC)).toBeLessThan(0.6);
    expect(Math.abs(cell.forest - exact.forest)).toBeLessThan(4);
    expect(g.cells.some((x) => x === null)).toBe(true);
  });
  it('lists the eclipses going on', () => {
    const w = world();
    w.events = [eclipse()];
    expect(eclipsesOn(w, day(6003, 3, 3))).toEqual(['ecl']);
    expect(eclipsesOn(w, day(5990, 3, 3))).toEqual([]);
  });
});

describe('EC-8 storage', () => {
  it('the shadow and the sky survive saving', async () => {
    const w = world();
    w.events = [eclipse({ steps: [{ id: 'a', from: exactDate(6002, 1, 1), hours: 5 }] })];
    w.settings.sky = { sunRadiusKm: 650_000, sunDistanceKm: 75_000_000, moons: [{ id: 'm', name: 'Moon', radiusKm: 18_000, distanceKm: 2_300_000 }] };
    w.settings.eclipseRules = { settleDays: 60 };
    const back = await bytesToWorld(await worldToBytes(w));
    expect(back.events[0].shadow).toEqual(w.events[0].shadow);
    expect(back.settings.sky).toEqual(w.settings.sky);
    expect(back.settings.eclipseRules).toEqual({ settleDays: 60 });
  });
});
