/**
 * Where am I (MK-31): the main map (or the whole world) small in a corner while zoomed in, with
 * the part on screen outlined. Click or drag in it to move the map there.
 */
import { useEffect, useRef } from 'react';
import { clampLat, wrapLng, LatLng } from '../../core';
import { ViewState, toLatLng } from './projection';
import type { Bounds } from './findOnMap';

const W = 200;

/** The inset's own view of its extent, and its height for that shape. */
export function insetLayout(b: Bounds): { view: ViewState; h: number } {
  const lngSpan = Math.max(1, b.east - b.west), latSpan = Math.max(1, b.north - b.south);
  const h = Math.round(Math.min(140, Math.max(60, (W * latSpan) / lngSpan)));
  const scale = Math.min(W / lngSpan, h / latSpan);
  return { view: { centerLat: (b.north + b.south) / 2, centerLng: (b.west + b.east) / 2, scale }, h };
}

export function MapInset({ extent, paintBase, version, view, size, onCenter }: {
  extent: Bounds;
  /** Paints the land, sketches and realms (no labels) for the inset's view. */
  paintBase: (g: CanvasRenderingContext2D, w: number, h: number, v: ViewState) => void;
  /** Changes when the land or realms change, so the picture is drawn again. */
  version: string;
  view: ViewState;
  size: { w: number; h: number };
  onCenter: (p: LatLng) => void;
}) {
  const { view: iv, h: H } = insetLayout(extent);
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef(false);
  const paintRef = useRef(paintBase);
  paintRef.current = paintBase;

  const draw = () => {
    const c = ref.current, b = base.current;
    if (!c || !b) return;
    const r = window.devicePixelRatio || 1;
    if (c.width !== W * r || c.height !== H * r) { c.width = W * r; c.height = H * r; }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(b, 0, 0, c.width, c.height);
    g.setTransform(r, 0, 0, r, 0, 0);
    // the part on screen, in the inset's own coordinates
    const tl = toLatLng(view, size.w, size.h, 0, 0), br = toLatLng(view, size.w, size.h, size.w, size.h);
    const px = (lng: number) => (lng - iv.centerLng) * iv.scale + W / 2;
    const py = (lat: number) => (iv.centerLat - lat) * iv.scale + H / 2;
    const x0 = px(tl.lng), x1 = px(br.lng), y0 = py(tl.lat), y1 = py(br.lat);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(x0, y0, Math.max(3, x1 - x0), Math.max(3, y1 - y0));
    g.lineWidth = 1.5;
    g.strokeStyle = '#c0392b';
    g.strokeRect(x0, y0, Math.max(3, x1 - x0), Math.max(3, y1 - y0));
  };

  // The land picture is drawn again only when the land changes, plus once more a moment later for tiles still loading.
  useEffect(() => {
    const render = () => {
      const r = window.devicePixelRatio || 1;
      const b = base.current ?? document.createElement('canvas');
      b.width = W * r; b.height = H * r;
      const g = b.getContext('2d')!;
      g.setTransform(r, 0, 0, r, 0, 0);
      paintRef.current(g, W, H, iv);
      base.current = b;
      draw();
    };
    render();
    const t = setTimeout(render, 900);
    return () => clearTimeout(t);
  }, [version, H, iv.centerLat, iv.centerLng, iv.scale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(draw);

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.min(W, Math.max(0, e.clientX - r.left)), y = Math.min(H, Math.max(0, e.clientY - r.top));
    onCenter({ lat: clampLat(iv.centerLat - (y - H / 2) / iv.scale), lng: wrapLng(iv.centerLng + (x - W / 2) / iv.scale) });
  };
  return (
    <canvas
      ref={ref}
      className="map-inset"
      style={{ width: W, height: H }}
      title="Overview: click or drag to move there"
      onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); dragging.current = true; at(e); }}
      onPointerMove={(e) => dragging.current && at(e)}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    />
  );
}
