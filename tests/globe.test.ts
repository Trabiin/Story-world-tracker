import { describe, expect, it } from 'vitest';
import { greatCircleKm, interpolateGreatCircle, travelDays, wrapLng } from '../src/core';

describe('globe', () => {
  it('measures great-circle distance', () => {
    // London to Paris ≈ 344 km
    expect(greatCircleKm({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeCloseTo(344, -1);
    // across the antimeridian
    expect(greatCircleKm({ lat: 0, lng: 179 }, { lat: 0, lng: -179 })).toBeCloseTo(222.4, 0);
  });
  it('wraps longitude', () => {
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(180)).toBe(180);
  });
  it('interpolates along the great circle', () => {
    const pts = interpolateGreatCircle({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }, 2);
    expect(pts[1].lat).toBeCloseTo(0);
    expect(pts[1].lng).toBeCloseTo(45);
  });
  it('suggests travel days with detour factor', () => {
    expect(travelDays(100, 50, 1.3)).toBe(3);
    expect(travelDays(10, 50, 1.3)).toBe(1);
  });
});
