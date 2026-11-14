import { describe, expect, it } from 'vitest';
import { arrowPan, clampView, lerpView, panBy, pinchView, viewForBox, wheelAction, zoomAt, MAX_SCALE } from '../src/ui/map/navigate';
import { toLatLng, toScreen } from '../src/ui/map/projection';

const size = { w: 800, h: 600 };
const v0 = { centerLat: 45, centerLng: 10, scale: 40 };

describe('map navigation (MK-28)', () => {
  it('zooms about a point, keeping that spot under the pointer', () => {
    const before = toLatLng(v0, size.w, size.h, 200, 150);
    const v = zoomAt(v0, size, 2, 200, 150);
    expect(v.scale).toBe(80);
    const p = toScreen(v, size.w, size.h, before);
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(150, 6);
    // without a point it zooms about the centre
    const c = zoomAt(v0, size, 0.5);
    expect(c.centerLat).toBeCloseTo(45); expect(c.centerLng).toBeCloseTo(10); expect(c.scale).toBe(20);
  });

  it('keeps zoom within limits and wraps longitude', () => {
    expect(zoomAt({ ...v0, scale: MAX_SCALE }, size, 4).scale).toBe(MAX_SCALE);
    expect(clampView({ centerLat: 120, centerLng: 190, scale: 0.01 })).toEqual({ centerLat: 90, centerLng: -170, scale: 0.5 });
  });

  it('pans so the map follows the pointer', () => {
    const v = panBy(v0, 40, -80);
    expect(v.centerLng).toBeCloseTo(9);
    expect(v.centerLat).toBeCloseTo(43);
    expect(arrowPan(v0, size, 'ArrowRight', false)!.centerLng).toBeGreaterThan(10);
    expect(arrowPan(v0, size, 'ArrowUp', false)!.centerLat).toBeGreaterThan(45);
    expect(arrowPan(v0, size, 'a', false)).toBeNull();
  });

  it('pinches: spreading the fingers zooms and the spot between them follows', () => {
    const start = { view: v0, mid: { x: 400, y: 300 }, dist: 100 };
    const v = pinchView(start, size, { x: 450, y: 300 }, 200);
    expect(v.scale).toBe(80);
    const spot = toLatLng(v0, size.w, size.h, 400, 300);
    const now = toScreen(v, size.w, size.h, spot);
    expect(now.x).toBeCloseTo(450, 6); expect(now.y).toBeCloseTo(300, 6);
  });

  it('zooms to a dragged box, ignoring a tiny one', () => {
    const v = viewForBox(v0, size, 100, 100, 300, 250)!;
    expect(v.scale).toBeCloseTo(40 * Math.min(800 / 200, 600 / 150));
    const c = toLatLng(v0, size.w, size.h, 200, 175);
    expect(v.centerLat).toBeCloseTo(c.lat); expect(v.centerLng).toBeCloseTo(c.lng);
    expect(viewForBox(v0, size, 100, 100, 104, 300)).toBeNull();
  });

  it('glides evenly in zoom and the short way round the globe', () => {
    const a = { centerLat: 0, centerLng: 170, scale: 10 }, b = { centerLat: 0, centerLng: -170, scale: 40 };
    const mid = lerpView(a, b, 0.5);
    expect(mid.scale).toBeCloseTo(20);
    expect(Math.abs(mid.centerLng)).toBeCloseTo(180);
    expect(lerpView(a, b, 1)).toEqual({ ...b, centerLng: -170 });
  });

  it('turns wheel events into zoom or pan', () => {
    const wheel = (o: Partial<{ deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, ...o });
    // a touchpad pinch (Ctrl) always zooms, even when scrolling moves the map
    const pinch = wheelAction(wheel({ deltaY: -10, ctrlKey: true }), 600, 'pan');
    expect('zoom' in pinch && pinch.zoom).toBeGreaterThan(1);
    const z = wheelAction(wheel({ deltaY: 100 }), 600, 'zoom');
    expect('zoom' in z && z.zoom).toBeLessThan(1);
    expect(wheelAction(wheel({ deltaX: 5, deltaY: 20 }), 600, 'pan')).toEqual({ pan: { dx: 5, dy: 20 } });
    // Shift swaps; lines are turned into pixels
    expect(wheelAction(wheel({ deltaY: 3, deltaMode: 1, shiftKey: true }), 600, 'zoom')).toEqual({ pan: { dx: 48, dy: 0 } });
  });
});
