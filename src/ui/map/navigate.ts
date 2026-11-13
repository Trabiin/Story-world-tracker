/**
 * Moving around the map (MK-28): zooming about a point, panning, pinching with two fingers,
 * zooming to a dragged box and gliding smoothly between views. Pure functions on the view, so
 * they can be tested without a screen.
 */
import { clampLat, wrapLng } from '../../core';
import { ViewState, toLatLng } from './projection';

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 20000;

export interface Size { w: number; h: number }

export function clampView(v: ViewState): ViewState {
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale));
  return { scale, centerLat: clampLat(v.centerLat), centerLng: wrapLng(v.centerLng) };
}

/** Zoom by `factor`, keeping the spot under screen point (x, y) where it is (the centre when left out). */
export function zoomAt(v: ViewState, size: Size, factor: number, x = size.w / 2, y = size.h / 2): ViewState {
  const before = toLatLng(v, size.w, size.h, x, y);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
  return clampView({ scale, centerLng: before.lng - (x - size.w / 2) / scale, centerLat: before.lat + (y - size.h / 2) / scale });
}

/** Move the map by (dx, dy) screen pixels: the map follows the pointer. */
export function panBy(v: ViewState, dx: number, dy: number): ViewState {
  return clampView({ ...v, centerLng: v.centerLng - dx / v.scale, centerLat: v.centerLat + dy / v.scale });
}

export interface Pinch { view: ViewState; mid: { x: number; y: number }; dist: number }

/** Two fingers: the spot under the starting midpoint follows the fingers, and spreading them zooms. */
export function pinchView(start: Pinch, size: Size, mid: { x: number; y: number }, dist: number): ViewState {
  const anchor = toLatLng(start.view, size.w, size.h, start.mid.x, start.mid.y);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, start.view.scale * (dist / Math.max(1, start.dist))));
  return clampView({ scale, centerLng: anchor.lng - (mid.x - size.w / 2) / scale, centerLat: anchor.lat + (mid.y - size.h / 2) / scale });
}

/** The view that shows the screen box between two corners (Shift-drag). Null for a box too small to mean anything. */
export function viewForBox(v: ViewState, size: Size, x0: number, y0: number, x1: number, y1: number): ViewState | null {
  const bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
  if (bw < 8 || bh < 8) return null;
  const c = toLatLng(v, size.w, size.h, (x0 + x1) / 2, (y0 + y1) / 2);
  return clampView({ centerLat: c.lat, centerLng: c.lng, scale: v.scale * Math.min(size.w / bw, size.h / bh) });
}

/** A point on the way from a to b (t from 0 to 1): the zoom changes evenly, the centre follows the shorter way round. */
export function lerpView(a: ViewState, b: ViewState, t: number): ViewState {
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in and out
  let dLng = b.centerLng - a.centerLng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  return {
    scale: Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * e),
    centerLat: a.centerLat + (b.centerLat - a.centerLat) * e,
    centerLng: wrapLng(a.centerLng + dLng * e),
  };
}

/** Wheel deltas in pixels, whatever unit the browser reports (lines in Firefox, pages rarely). */
export function wheelPixels(e: { deltaX: number; deltaY: number; deltaMode: number }, pageH: number) {
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageH : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/**
 * What one wheel event does. A pinch on a touchpad arrives as a wheel event with Ctrl held, and
 * always zooms. Otherwise the per-computer choice decides: the wheel (or two-finger scroll) zooms,
 * or it moves the map; Shift swaps the two.
 */
export type WheelAction = { zoom: number } | { pan: { dx: number; dy: number } };
export function wheelAction(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey?: boolean; shiftKey: boolean }, pageH: number, pref: WheelPref): WheelAction {
  const { dx, dy } = wheelPixels(e, pageH);
  if (e.ctrlKey || e.metaKey) return { zoom: Math.exp(-dy * 0.01) };
  const zoom = (pref === 'zoom') !== e.shiftKey;
  if (zoom) return { zoom: Math.exp(-dy * 0.0015) };
  // Shift turns a mouse's vertical wheel into a sideways move in most browsers already
  return { pan: e.shiftKey && dx === 0 ? { dx: dy, dy: 0 } : { dx, dy } };
}

/** Per computer, like lighter drawing: a mouse wants the wheel to zoom, a touchpad often wants it to move. */
export type WheelPref = 'zoom' | 'pan';
const WHEEL_KEY = 'swt.mapWheel';
export function wheelPref(): WheelPref {
  try { return localStorage.getItem(WHEEL_KEY) === 'pan' ? 'pan' : 'zoom'; } catch { return 'zoom'; }
}
export function setWheelPref(v: WheelPref) {
  try { if (v === 'zoom') localStorage.removeItem(WHEEL_KEY); else localStorage.setItem(WHEEL_KEY, v); } catch { /* ignore */ }
}

/** Arrow keys move a fifth of the map (Shift: half). */
export function arrowPan(v: ViewState, size: Size, key: string, big: boolean): ViewState | null {
  const step = big ? 0.5 : 0.2;
  const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
  if (!dx && !dy) return null;
  // the map moves the other way from the pointer-drag sense: Right shows what lies to the east
  return panBy(v, -dx * size.w * step, -dy * size.h * step);
}
