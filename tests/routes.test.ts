import { describe, expect, it } from 'vitest';
import { MapFeature, WorldIndex, checkWorld, networkFor, routeAlongFeatures, toDayNumber, whereIs } from '../src/core';
import { d, journey, world } from './fixtures';

const base = { scenarioId: 'canon', status: 'canon' as const, createdAt: '', updatedAt: '', notes: '' };
const line = (id: string, kind: MapFeature['kind'], pts: [number, number][]): MapFeature =>
  ({ ...base, id, shape: 'line', kind, name: id, points: pts.map(([lat, lng]) => ({ lat, lng })) });

describe('routes (WH-6)', () => {
  it('follows roads when they help and joins roads that meet', () => {
    const w = world();
    // Varn (50,10) to Thornwick (50,12): a road bends north via 50.5°N in two pieces that meet
    w.mapFeatures = [line('North Road', 'road', [[50, 10], [50.5, 11]]), line('East Road', 'road', [[50.5, 11], [50, 12]])];
    const r = routeAlongFeatures(w, { lat: 50, lng: 10 }, { lat: 50, lng: 12 }, 'land');
    expect(r.via).toEqual(['North Road', 'East Road']);
    expect(r.km).toBeGreaterThan(143);
    expect(r.onNetworkKm).toBeCloseTo(r.km, 0);
    // a road far out of the way is ignored: straight across country is cheaper
    w.mapFeatures = [line('Detour', 'road', [[50, 10], [53, 11], [50, 12]])];
    expect(routeAlongFeatures(w, { lat: 50, lng: 10 }, { lat: 50, lng: 12 }, 'land').via).toEqual([]);
  });

  it('ships use sea lanes and rivers, not roads; flyers go straight', () => {
    const w = world();
    w.mapFeatures = [line('Road', 'road', [[50, 10], [50.3, 11], [50, 12]]), line('Lane', 'sea-lane', [[50, 10], [49.7, 11], [50, 12]])];
    expect(routeAlongFeatures(w, { lat: 50, lng: 10 }, { lat: 50, lng: 12 }, networkFor('ship')).via).toEqual(['Lane']);
    expect(routeAlongFeatures(w, { lat: 50, lng: 10 }, { lat: 50, lng: 12 }, networkFor('horse')).via).toEqual(['Road']);
    expect(routeAlongFeatures(w, { lat: 50, lng: 10 }, { lat: 50, lng: 12 }, networkFor('flying')).points).toHaveLength(2);
  });

  it('a drawn route sets the distance, the position while travelling and the travel check', () => {
    const w = world();
    const j = journey('kaela', 'varn', 'thornwick', d(1042, 5, 1), d(1042, 5, 4), 'horse');
    j.route = [{ lat: 50, lng: 10 }, { lat: 51, lng: 11 }, { lat: 50, lng: 12 }];
    w.journeys = [j];
    const ix = new WorldIndex(w);
    const km = ix.journeyDistanceKm(j)!;
    expect(km).toBeGreaterThan(220); // via 51°N, longer than the 143 km straight
    expect(ix.detourOf(j)).toBe(1);
    const mid = whereIs(ix, 'kaela', toDayNumber({ year: 1042, month: 5, day: 2 }) + 0.5);
    expect(mid.kind).toBe('journey');
    if (mid.kind === 'journey') expect(mid.position!.lat).toBeGreaterThan(50.8); // halfway is at the bend
    // 3 days at 50 km/day is too little for the long way round
    j.arrival = d(1042, 5, 3);
    expect(checkWorld(w).find((x) => x.rule === 'impossible-travel')?.message).toMatch(/km along its route/);
  });
});
