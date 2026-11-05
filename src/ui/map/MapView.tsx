/**
 * The world map (MP-1..MP-3, MP-5, MK-1, MK-3, VW-5 markers) and the mapmaking tools
 * (MK-4..MK-7, MK-18, MK-24, MK-26, MK-27). Equirectangular, wraps east–west.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ask } from '../components/Dialogs';
import {
  BAND_INFO, BrushParams, CLIMATE_BANDS, Id, LatLng, MapImage, MapSymbol, Place, Terrain, TerrainEditor, TerrainReader,
  applyDab, bandEdges, clampLat, climateBand, dabsBetween, fillPolygon, formatDayNumber, greatCircleKm, hasTerrain, interpolateGreatCircle,
  meanTemperatureC, pathLengthKm, whereIs, wrapLng,
} from '../../core';
import { recordBase } from '../../storage';
import { fileToDataUrl } from '../views/Characters';
import { PLACE_ICON } from '../views/Places';
import { useApp } from '../context';
import { TiledImage, TILE } from './tiles';
import { ViewState, boundsFromTwoPoints, toLatLng, toScreen, wrapOffsets } from './projection';
import { DEFAULT_DRAW, DrawOptions, DrawState, TOOLS, ToolPalette, isBrush, toolInfo } from './DrawPanel';
import { GlobePreview } from './GlobePreview';
import { Overview, Relief, RenderStyle, SYMBOL_BLOCK, TileImageCache, autoSymbols, hexToRgb, PALETTE, styleKey } from './terrainRender';
import { drawCompass, drawSymbol } from './symbols';

type Mode = 'browse' | 'pick' | 'measure' | 'calibrate' | 'add-place' | 'draw';
const DRAW_KEY = 'swt.draw';
const LAYERS_KEY = 'swt.mapLayers';
const DEFAULT_LAYERS = { grid: true, compass: true, scale: true, mountains: true, symbols: true, climate: false, places: true, characters: true, routes: true, labels: true };
type Layers = typeof DEFAULT_LAYERS;
const LAYER_NAMES: Record<keyof Layers, string> = {
  grid: 'Lat/long grid', compass: 'Compass rose', scale: 'Scale bar', mountains: 'Mountain symbols (automatic)', symbols: 'Placed symbols',
  climate: 'Climate zones', places: 'Places', characters: 'Characters', routes: 'Routes', labels: 'Labels',
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '');
    if (v && typeof v === 'object') return { ...fallback, ...v };
  } catch { /* ignore */ }
  return fallback;
}

function isDark(): boolean {
  const [r, g, b] = hexToRgb(cssVar('--bg'));
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 < 0.5;
}

interface Marker {
  kind: 'place' | 'character';
  id: Id;
  x: number;
  y: number;
  r: number;
}

const VIEW_KEY = 'swt.mapView';

function loadView(key: string, places: Place[]): ViewState {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '');
    if (v && typeof v.scale === 'number') return v;
  } catch { /* ignore */ }
  return fitPlaces(places, 900, 650);
}

/** A view that frames every positioned place, or the whole globe when there are none. */
function fitPlaces(places: Place[], w: number, h: number): ViewState {
  const pts = places.filter((p) => p.location && !p.isPlaceholder).map((p) => p.location!);
  if (pts.length === 0) return { centerLat: 0, centerLng: 0, scale: Math.max(0.5, w / 380) };
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const spanLat = Math.max(2, Math.max(...lats) - Math.min(...lats)), spanLng = Math.max(2, Math.max(...lngs) - Math.min(...lngs));
  return {
    centerLat: (Math.max(...lats) + Math.min(...lats)) / 2,
    centerLng: (Math.max(...lngs) + Math.min(...lngs)) / 2,
    scale: Math.min(w / spanLng, h / spanLat) * 0.6,
  };
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function MapView() {
  const { world, store, ix, moment, pickFor, startPick, go, edit, mapFocus } = useApp();
  const viewKey = `${VIEW_KEY}.${store.handle.id}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(() => loadView(viewKey, world.places));
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [mode, setMode] = useState<Mode>(pickFor ? 'pick' : 'browse');
  const [hover, setHover] = useState<LatLng | null>(null);
  const [selected, setSelected] = useState<{ kind: 'place' | 'character'; id: Id } | null>(null);
  const [measure, setMeasure] = useState<LatLng[]>([]);
  const [layers, setLayers] = useState<Layers>(() => loadJson(LAYERS_KEY, DEFAULT_LAYERS));
  const [relief, setRelief] = useState<Relief>(() => (localStorage.getItem('swt.relief') as Relief) || 'hillshade');
  const [draw, setDraw] = useState<DrawState>(() => loadJson(DRAW_KEY, DEFAULT_DRAW));
  const [working, setWorking] = useState<Terrain | null>(null);
  const [poly, setPoly] = useState<LatLng[]>([]);
  const [globe, setGlobe] = useState(false);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [overviewVersion, setOverviewVersion] = useState(0);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tileCache = useRef(new TileImageCache());
  const overview = useMemo(() => new Overview(0.5), []);
  const space = useRef(false);
  const [tick, setTick] = useState(0);
  const [calib, setCalib] = useState<{ imageId: Id; points: { px: number; py: number; lat: number; lng: number }[] } | null>(null);
  const markers = useRef<Marker[]>([]);
  const tiled = useRef(new Map<Id, { src: string; t: TiledImage }>());

  useEffect(() => setMode(pickFor ? 'pick' : 'browse'), [pickFor]);
  useEffect(() => {
    try { localStorage.setItem(viewKey, JSON.stringify(view)); } catch { /* ignore */ }
  }, [view, viewKey]);
  useEffect(() => {
    try {
      localStorage.setItem(DRAW_KEY, JSON.stringify(draw));
      localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
      localStorage.setItem('swt.relief', relief);
    } catch { /* ignore */ }
  }, [draw, layers, relief]);

  // Show a spot on the map when asked from elsewhere (e.g. a realism warning).
  useEffect(() => {
    if (!mapFocus) return;
    setFocus(mapFocus.at);
    setView((v) => ({ centerLat: mapFocus.at.lat, centerLng: mapFocus.at.lng, scale: Math.min(Math.max(v.scale, 25), 160) }));
  }, [mapFocus]);

  const terrain = working ?? world.terrain;
  const reader = useMemo(() => new TerrainReader(terrain), [terrain]);
  const showTerrain = hasTerrain(terrain);
  const style: RenderStyle = useMemo(
    () => ({ relief, climate: layers.climate, tilt: world.settings.axialTiltDeg, biomes: world.settings.biomes, dark: isDark() }),
    [relief, layers.climate, world.settings.axialTiltDeg, world.settings.biomes],
  );
  const sk = useMemo(() => styleKey(style), [style]);
  useEffect(() => {
    if (overview.update(reader, style, sk)) setOverviewVersion((v) => v + 1);
  }, [reader, style, sk, overview]);

  // Keep tiled images in sync with the world's map images.
  useEffect(() => {
    const m = tiled.current;
    for (const img of world.mapImages) {
      const cur = m.get(img.id);
      if (cur && cur.src === img.dataUrl) continue;
      cur?.t.dispose();
      const el = new Image();
      el.onload = () => {
        m.set(img.id, { src: img.dataUrl, t: new TiledImage(el, () => setTick((t) => t + 1)) });
        setTick((t) => t + 1);
      };
      el.src = img.dataUrl;
    }
    for (const id of [...m.keys()]) if (!world.mapImages.some((i) => i.id === id)) { m.get(id)!.t.dispose(); m.delete(id); }
  }, [world.mapImages]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const characterPositions = useMemo(() => {
    const out: { id: Id; pos: LatLng; journey?: { from: LatLng; to: LatLng } }[] = [];
    for (const c of world.characters) {
      if (c.archived) continue;
      const w = whereIs(ix, c.id, moment);
      if ((w.kind === 'stay' || w.kind === 'journey') && w.position) {
        let journey;
        if (w.kind === 'journey') {
          const from = ix.locationOf(w.fromId), to = ix.locationOf(w.toId);
          if (from && to) journey = { from, to };
        }
        out.push({ id: c.id, pos: w.position, journey });
      }
    }
    return out;
  }, [world, ix, moment]);

  // ---- drawing ----
  useEffect(() => {
    const cv = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h } = size;
    g.fillStyle = cssVar('--map-sea');
    g.fillRect(0, 0, w, h);
    const offsets = wrapOffsets(view, w);
    const ms: Marker[] = [];

    // world extent: plain when nothing is painted yet, open ocean once there is terrain
    const pal = style.dark ? PALETTE.dark : PALETTE.light;
    for (const o of offsets) {
      const a = toScreen(view, w, h, { lat: 90, lng: -180 }, o);
      const b = toScreen(view, w, h, { lat: -90, lng: 180 }, o);
      g.fillStyle = showTerrain ? `rgb(${pal.deep.join(',')})` : cssVar('--map-world');
      g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }

    // painted terrain (MK-4..MK-7)
    const tg = reader.g;
    const tilePx = tg.tileDeg * view.scale;
    const visibleTiles: [number, number][] = [];
    if (showTerrain) {
      if (tilePx < 20) {
        g.imageSmoothingEnabled = true;
        for (const o of offsets) {
          const a = toScreen(view, w, h, { lat: 90, lng: -180 }, o);
          g.drawImage(overview.canvas, a.x, a.y, 360 * view.scale, 180 * view.scale);
        }
      } else {
        const res = tilePx <= 40 ? 30 : tilePx <= 110 ? 120 : tilePx <= 400 ? 240 : 480;
        tileCache.current.beginFrame();
        const tl = toLatLng(view, w, h, 0, 0), br = toLatLng(view, w, h, w, h);
        const ty0 = Math.max(0, Math.floor((90 - tl.lat) / tg.tileDeg)), ty1 = Math.min(tg.tilesY - 1, Math.floor((90 - br.lat) / tg.tileDeg));
        const tx0 = Math.floor((tl.lng + 180) / tg.tileDeg), tx1 = Math.floor((br.lng + 180) / tg.tileDeg);
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let txu = tx0; txu <= tx1; txu++) {
            const tx = ((txu % tg.tilesX) + tg.tilesX) % tg.tilesX;
            if (!reader.tile(tx, ty)) continue;
            const o = (txu - tx) / tg.tilesX * 360;
            const c = tileCache.current.get(reader, tx, ty, res, style, sk);
            visibleTiles.push([tx, ty]);
            if (!c) continue;
            const p = toScreen(view, w, h, { lat: 90 - ty * tg.tileDeg, lng: -180 + tx * tg.tileDeg }, o);
            g.drawImage(c, p.x, p.y, tilePx + 0.6, tilePx + 0.6);
          }
        }
        if (tileCache.current.pending) requestAnimationFrame(() => setTick((t) => t + 1));
      }
    }

    // pinned images (tiled)
    for (const img of world.mapImages) {
      if (!img.visible) continue;
      const t = tiled.current.get(img.id)?.t;
      if (!t) continue;
      const east = img.east < img.west ? img.east + 360 : img.east;
      const pxPerDegX = t.width / (east - img.west);
      const screenPerImagePx = view.scale / pxPerDegX;
      const level = t.levelFor(screenPerImagePx);
      const span = TILE * 2 ** level;
      g.globalAlpha = img.opacity;
      for (const o of offsets) {
        const tl = toScreen(view, w, h, { lat: img.north, lng: img.west }, o);
        const br = toScreen(view, w, h, { lat: img.south, lng: east }, o);
        const sx = (br.x - tl.x) / t.width, sy = (br.y - tl.y) / t.height;
        if (br.x < 0 || tl.x > w || br.y < 0 || tl.y > h) continue;
        const c0 = Math.max(0, Math.floor(-tl.x / sx / span)), c1 = Math.min(Math.ceil(t.width / span) - 1, Math.floor((w - tl.x) / sx / span));
        const r0 = Math.max(0, Math.floor(-tl.y / sy / span)), r1 = Math.min(Math.ceil(t.height / span) - 1, Math.floor((h - tl.y) / sy / span));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const dx = tl.x + c * span * sx, dy = tl.y + r * span * sy;
            const dw = Math.min(span, t.width - c * span) * sx, dh = Math.min(span, t.height - r * span) * sy;
            let bmp = t.get(level, c, r);
            if (bmp) { g.drawImage(bmp, dx, dy, dw + 0.5, dh + 0.5); continue; }
            // fall back to a coarser level while the fine tile loads
            for (let L = level + 1; L < t.levels && !bmp; L++) {
              const sp = TILE * 2 ** L;
              const cc = Math.floor((c * span) / sp), rr = Math.floor((r * span) / sp);
              bmp = t.get(L, cc, rr);
              if (bmp) {
                const srcX = (c * span - cc * sp) / 2 ** L, srcY = (r * span - rr * sp) / 2 ** L;
                g.drawImage(bmp, srcX, srcY, Math.min(span, t.width - c * span) / 2 ** L, Math.min(span, t.height - r * span) / 2 ** L, dx, dy, dw + 0.5, dh + 0.5);
              }
            }
          }
        }
      }
      g.globalAlpha = 1;
    }

    // graticule (MK-3)
    if (layers.grid) {
      const step = view.scale > 40 ? 1 : view.scale > 12 ? 5 : view.scale > 4 ? 10 : 30;
      g.strokeStyle = cssVar('--map-grid');
      g.lineWidth = 1;
      g.fillStyle = cssVar('--map-grid-label');
      g.font = '10px system-ui';
      for (const o of offsets) {
        for (let lng = -180; lng <= 180; lng += step) {
          const a = toScreen(view, w, h, { lat: 90, lng }, o), b = toScreen(view, w, h, { lat: -90, lng }, o);
          if (a.x < -1 || a.x > w + 1) continue;
          g.globalAlpha = lng === 0 ? 0.9 : 0.4;
          g.beginPath(); g.moveTo(a.x, Math.max(0, a.y)); g.lineTo(b.x, Math.min(h, b.y)); g.stroke();
          g.globalAlpha = 1;
          g.fillText(`${Math.abs(lng)}°${lng < 0 ? 'W' : lng > 0 ? 'E' : ''}`, a.x + 2, Math.max(10, a.y + 10));
        }
      }
      const left = toScreen(view, w, h, { lat: 0, lng: -180 }, offsets[0]).x, right = toScreen(view, w, h, { lat: 0, lng: 180 }, offsets[offsets.length - 1]).x;
      for (let lat = -90; lat <= 90; lat += step) {
        const y = toScreen(view, w, h, { lat, lng: 0 }).y;
        if (y < 0 || y > h) continue;
        g.globalAlpha = lat === 0 ? 0.9 : 0.4;
        g.beginPath(); g.moveTo(Math.max(0, left), y); g.lineTo(Math.min(w, right), y); g.stroke();
        g.globalAlpha = 1;
        g.fillText(`${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}`, 2, y - 2);
      }
    }

    // mountain and hill symbols where the ground is high (MK-6), then hand-placed symbols (MK-24)
    if (showTerrain && layers.mountains && tilePx >= 20) {
      const blockPx = SYMBOL_BLOCK * tg.cellDeg * view.scale;
      if (blockPx >= 3) {
        // Thin the symbols out so they never crowd: roughly one per 24–48 px.
        const k = Math.max(1, Math.ceil(24 / blockPx));
        for (const [tx, ty] of visibleTiles) {
          for (const sym of autoSymbols(reader, tx, ty)) {
            if (sym.bx % k || sym.by % k) continue;
            const sz = Math.max(7, Math.min(36, blockPx * k * 0.7 * sym.size));
            for (const o of offsets) {
              const sp = toScreen(view, w, h, sym, o);
              if (sp.x < -30 || sp.x > w + 30 || sp.y < -30 || sp.y > h + 40) continue;
              drawSymbol(g, sym.kind, sp.x, sp.y + sz * 0.35, sym.kind === 'hill' ? sz * 0.7 : sz);
            }
          }
        }
      }
    }
    if (layers.symbols) {
      const kmPerDeg = (Math.PI * world.settings.radiusKm) / 180;
      for (const sym of world.mapSymbols) {
        const sz = Math.max(6, Math.min(70, (30 * sym.size / kmPerDeg) * view.scale));
        for (const o of offsets) {
          const sp = toScreen(view, w, h, sym.location, o);
          if (sp.x < -80 || sp.x > w + 80 || sp.y < -80 || sp.y > h + 80) continue;
          drawSymbol(g, sym.kind, sp.x, sp.y + sz * 0.35, sz);
        }
      }
    }

    const drawPath = (pts: LatLng[], o: number) => {
      g.beginPath();
      let prev: LatLng | null = null;
      let shift = 0;
      for (const p of pts) {
        if (prev && Math.abs(p.lng - prev.lng) > 180) shift += p.lng < prev.lng ? 360 : -360;
        const s = toScreen(view, w, h, { lat: p.lat, lng: p.lng + shift }, o);
        if (!prev) g.moveTo(s.x, s.y); else g.lineTo(s.x, s.y);
        prev = p;
      }
      g.stroke();
    };

    // journeys in progress
    if (layers.routes) {
      for (const cp of characterPositions) {
        if (!cp.journey) continue;
        const col = ix.characters.get(cp.id)?.color ?? '#888';
        g.strokeStyle = col;
        g.setLineDash([6, 4]);
        g.lineWidth = 2;
        for (const o of offsets) drawPath(interpolateGreatCircle(cp.journey.from, cp.journey.to, 48), o);
        g.setLineDash([]);
      }
    }

    // places
    const showPlace = (p: Place) => {
      if (!p.location || p.isPlaceholder) return false;
      if (!p.parentId) return true;
      return view.scale > 60; // nested places with their own position only when zoomed in
    };
    if (layers.places) {
      const fg = cssVar('--fg');
      const bg = cssVar('--bg');
      for (const p of world.places) {
        if (!showPlace(p)) continue;
        for (const o of offsets) {
          const s = toScreen(view, w, h, p.location!, o);
          if (s.x < -50 || s.x > w + 50 || s.y < -20 || s.y > h + 20) continue;
          const isPick = pickFor === p.id;
          g.font = `${p.kind === 'city' ? 16 : 13}px system-ui`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = isPick || (selected?.kind === 'place' && selected.id === p.id) ? cssVar('--accent') : fg;
          g.fillText(PLACE_ICON[p.kind], s.x, s.y);
          if (layers.labels && (view.scale > 6 || p.kind === 'city')) {
            g.font = `${p.kind === 'city' ? 'bold ' : ''}12px system-ui`;
            g.textAlign = 'left';
            g.lineWidth = 3;
            g.strokeStyle = bg;
            g.strokeText(p.name, s.x + 9, s.y);
            g.fillText(p.name, s.x + 9, s.y);
          }
          ms.push({ kind: 'place', id: p.id, x: s.x, y: s.y, r: 9 });
        }
      }
    }

    // characters at the current moment, fanned out when they share a spot
    if (layers.characters) {
      const groups = new Map<string, typeof characterPositions>();
      for (const cp of characterPositions) {
        const k = `${cp.pos.lat.toFixed(3)},${cp.pos.lng.toFixed(3)}`;
        groups.set(k, [...(groups.get(k) ?? []), cp]);
      }
      for (const list of groups.values()) {
        list.forEach((cp, i) => {
          const c = ix.characters.get(cp.id)!;
          const ang = (i / list.length) * Math.PI * 2 - Math.PI / 2;
          const rad = list.length > 1 ? 12 + list.length : 0;
          for (const o of offsets) {
            const s0 = toScreen(view, w, h, cp.pos, o);
            const s = { x: s0.x + Math.cos(ang) * rad, y: s0.y - 14 + Math.sin(ang) * rad };
            if (s.x < -30 || s.x > w + 30 || s.y < -30 || s.y > h + 30) continue;
            g.beginPath();
            g.arc(s.x, s.y, 9, 0, Math.PI * 2);
            g.fillStyle = c.color;
            g.fill();
            g.lineWidth = selected?.kind === 'character' && selected.id === c.id ? 3 : 1.5;
            g.strokeStyle = cssVar('--bg');
            g.stroke();
            g.fillStyle = '#fff';
            g.font = '11px system-ui';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(c.icon, s.x, s.y + 0.5);
            if (layers.labels && view.scale > 4) {
              g.font = '11px system-ui';
              g.textAlign = 'center';
              g.lineWidth = 3;
              g.strokeStyle = cssVar('--bg');
              g.strokeText(c.name, s.x, s.y - 15);
              g.fillStyle = c.color;
              g.fillText(c.name, s.x, s.y - 15);
            }
            ms.push({ kind: 'character', id: c.id, x: s.x, y: s.y, r: 10 });
          }
        });
      }
    }

    // measure (MP-10)
    if (measure.length) {
      g.strokeStyle = cssVar('--accent');
      g.lineWidth = 2;
      const pts: LatLng[] = [];
      for (let i = 1; i < measure.length; i++) pts.push(...interpolateGreatCircle(measure[i - 1], measure[i], 24));
      for (const o of offsets) {
        if (pts.length) drawPath(pts, o);
        for (const p of measure) {
          const s = toScreen(view, w, h, p, o);
          g.fillStyle = cssVar('--accent');
          g.beginPath(); g.arc(s.x, s.y, 4, 0, Math.PI * 2); g.fill();
        }
      }
    }

    // spot shown from a warning
    if (focus) {
      for (const o of offsets) {
        const sp = toScreen(view, w, h, focus, o);
        g.strokeStyle = cssVar('--accent');
        g.lineWidth = 3;
        g.beginPath(); g.arc(sp.x, sp.y, 18, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 1;
        g.beginPath(); g.arc(sp.x, sp.y, 26, 0, Math.PI * 2); g.stroke();
      }
    }

    if (layers.compass) drawCompass(g, w - 40, 64, 20, cssVar('--fg'), cssVar('--bg'));

    // scale bar (MK-3)
    if (layers.scale) {
    const kmPerPx = (Math.PI * world.settings.radiusKm) / 180 / view.scale * Math.cos((view.centerLat * Math.PI) / 180);
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const km = nice.find((n) => n / kmPerPx > 80) ?? 10000;
    const px = km / kmPerPx;
    g.fillStyle = cssVar('--bg');
    g.globalAlpha = 0.8;
    g.fillRect(w - px - 30, h - 34, px + 20, 24);
    g.globalAlpha = 1;
    g.strokeStyle = cssVar('--fg');
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(w - px - 20, h - 16); g.lineTo(w - 20, h - 16); g.stroke();
    g.fillStyle = cssVar('--fg');
    g.font = '11px system-ui';
    g.textAlign = 'center';
    g.fillText(`${km.toLocaleString()} km`, w - 20 - px / 2, h - 25);
    }

    markers.current = ms;
  }, [view, size, world, ix, characterPositions, layers, measure, selected, pickFor, tick, reader, showTerrain, style, sk, overview, focus]);

  // ---- brush cursor and shape being drawn (separate layer, so hovering doesn't redraw the map) ----
  useEffect(() => {
    const cv = overlayRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    if (mode !== 'draw') return;
    const { w, h } = size;
    const offsets = wrapOffsets(view, w);
    if (hover && isBrush(draw.tool)) {
      const kmPerDeg = (Math.PI * world.settings.radiusKm) / 180;
      const ry = (draw.radiusKm / kmPerDeg) * view.scale;
      const rx = Math.min(w * 2, ry / Math.max(0.02, Math.cos((hover.lat * Math.PI) / 180)));
      const s0 = toScreen(view, w, h, hover);
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.beginPath(); g.ellipse(s0.x, s0.y, rx, ry, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#222';
      g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(s0.x, s0.y, rx, ry, 0, 0, Math.PI * 2); g.stroke();
    }
    if (draw.tool === 'polygon' && poly.length) {
      const pts = hover ? [...poly, hover] : poly;
      for (const o of offsets) {
        g.beginPath();
        let prev: LatLng | null = null, shift = 0;
        for (const p of pts) {
          if (prev && Math.abs(p.lng - prev.lng) > 180) shift += p.lng < prev.lng ? 360 : -360;
          const sp = toScreen(view, w, h, { lat: p.lat, lng: p.lng + shift }, o);
          if (!prev) g.moveTo(sp.x, sp.y); else g.lineTo(sp.x, sp.y);
          prev = p;
        }
        g.closePath();
        g.fillStyle = 'rgba(181,86,44,0.18)';
        g.fill();
        g.strokeStyle = '#b5562c';
        g.lineWidth = 2;
        g.stroke();
        for (const p of poly) {
          const sp = toScreen(view, w, h, p, o);
          g.fillStyle = '#b5562c';
          g.fillRect(sp.x - 3, sp.y - 3, 6, 6);
        }
      }
    }
  }, [hover, draw, poly, mode, view, size, world.settings.radiusKm]);

  // ---- interaction ----
  const drag = useRef<{ x: number; y: number; moved: boolean; v: ViewState } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (x: number, y: number) => {
    const ms = markers.current;
    for (let i = ms.length - 1; i >= 0; i--) if ((ms[i].x - x) ** 2 + (ms[i].y - y) ** 2 <= ms[i].r ** 2) return ms[i];
    return null;
  };
  const clampView = useCallback((v: ViewState): ViewState => {
    const scale = Math.max(0.5, Math.min(20000, v.scale));
    return { scale, centerLat: clampLat(v.centerLat), centerLng: wrapLng(v.centerLng) };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    const { x, y } = local(e);
    const before = toLatLng(view, size.w, size.h, x, y);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.max(0.5, Math.min(20000, view.scale * factor));
    // keep the point under the cursor fixed
    setView(clampView({ scale, centerLng: before.lng - (x - size.w / 2) / scale, centerLat: before.lat + (y - size.h / 2) / scale }));
  };

  // ---- painting strokes: edits collect in a working copy and become one undo step ----
  const stroke = useRef<{ ed: TerrainEditor; last: LatLng; params: BrushParams; raf: number } | null>(null);
  const pressureOf = (e: React.PointerEvent) => (draw.pressure && e.pointerType === 'pen' ? e.pressure || 0.5 : 1);
  const llAt = (x: number, y: number) => {
    const raw = toLatLng(view, size.w, size.h, x, y);
    return { lat: clampLat(raw.lat), lng: wrapLng(raw.lng) };
  };
  const startStroke = (e: React.PointerEvent, ll: LatLng) => {
    const info = toolInfo(draw.tool);
    const tool = e.altKey && info.alt ? info.alt : draw.tool;
    if (!isBrush(tool)) return;
    const params: BrushParams = {
      tool: tool === 'biome' && draw.biome === 0 ? 'erase-biome' : (tool as BrushParams['tool']),
      radiusKm: draw.radiusKm,
      strength: draw.strength,
      height: tool === 'flatten' ? Math.round(reader.elevation(ll)) : draw.height,
      biome: draw.biome,
      planetRadiusKm: world.settings.radiusKm,
    };
    const ed = new TerrainEditor(world.terrain);
    applyDab(ed, ll, params, pressureOf(e));
    stroke.current = { ed, last: ll, params, raf: 0 };
    setWorking(ed.snapshot());
  };
  const continueStroke = (e: React.PointerEvent, ll: LatLng) => {
    const st = stroke.current!;
    const cellKm = reader.g.cellDeg * (Math.PI * world.settings.radiusKm) / 180;
    const pts = dabsBetween(st.last, ll, Math.max(st.params.radiusKm * 0.3, cellKm * 0.7), world.settings.radiusKm);
    if (!pts.length) return;
    for (const p of pts) applyDab(st.ed, p, st.params, pressureOf(e));
    st.last = pts[pts.length - 1];
    if (!st.raf) st.raf = requestAnimationFrame(() => { st.raf = 0; if (stroke.current === st) setWorking(st.ed.snapshot()); });
  };
  const endStroke = () => {
    const st = stroke.current;
    if (!st) return;
    stroke.current = null;
    if (st.raf) cancelAnimationFrame(st.raf);
    const next = st.ed.commit();
    store.update((w) => ({ ...w, terrain: next }));
    setWorking(null);
  };
  const finishPolygon = (pts = poly) => {
    if (pts.length < 3) return;
    const ed = new TerrainEditor(world.terrain);
    fillPolygon(ed, pts, draw.polyMode, draw.biome);
    const next = ed.commit();
    store.update((w) => ({ ...w, terrain: next }));
    setPoly([]);
  };

  // MK-26: keyboard shortcuts for every drawing tool.
  useEffect(() => {
    if (mode !== 'draw') return;
    const down = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing || e.ctrlKey || e.metaKey) return;
      if (e.key === ' ') { space.current = true; e.preventDefault(); return; }
      if (e.altKey) return;
      if (e.key === '[' || e.key === ']') {
        setDraw((d) => ({ ...d, radiusKm: Math.max(2, Math.min(2000, Math.round(d.radiusKm * (e.key === ']' ? 1.25 : 0.8)))) }));
        return;
      }
      if (e.key === 'Enter') { finishPolygon(); return; }
      if (e.key === 'Escape') { setPoly([]); return; }
      if (e.key === 'Backspace' && poly.length) { setPoly((p) => p.slice(0, -1)); e.preventDefault(); return; }
      const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
      if (t) { setDraw((d) => ({ ...d, tool: t.tool })); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') space.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const { x, y } = local(e);
    if (mode === 'draw' && e.button === 0 && !space.current && isBrush(draw.tool)) {
      startStroke(e, llAt(x, y));
      return;
    }
    drag.current = { x, y, moved: false, v: view };
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    setHover(toLatLng(view, size.w, size.h, x, y));
    if (stroke.current) { continueStroke(e, llAt(x, y)); return; }
    const d = drag.current;
    if (!d) return;
    if (Math.abs(x - d.x) + Math.abs(y - d.y) > 3) d.moved = true;
    if (d.moved) setView(clampView({ ...d.v, centerLng: d.v.centerLng - (x - d.x) / d.v.scale, centerLat: d.v.centerLat + (y - d.y) / d.v.scale }));
  };
  const onUp = async (e: React.PointerEvent) => {
    if (stroke.current) { endStroke(); return; }
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const { x, y } = local(e);
    const raw = toLatLng(view, size.w, size.h, x, y);
    const ll = { lat: clampLat(raw.lat), lng: wrapLng(raw.lng) };
    setFocus(null);
    if (mode === 'draw') {
      if (draw.tool === 'polygon') setPoly((p) => [...p, ll]);
      if (draw.tool === 'stamp') {
        if (e.shiftKey) {
          let best: MapSymbol | undefined, bestD = 16 ** 2;
          for (const sym of world.mapSymbols) {
            for (const o of wrapOffsets(view, size.w)) {
              const sp = toScreen(view, size.w, size.h, sym.location, o);
              const dd = (sp.x - x) ** 2 + (sp.y - 6 - y) ** 2;
              if (dd < bestD) { bestD = dd; best = sym; }
            }
          }
          if (best) store.removeMany([{ c: 'mapSymbols', id: best.id }]);
        } else {
          store.upsert('mapSymbols', { ...recordBase(), kind: draw.symbol, location: ll, size: 1 });
        }
      }
      return;
    }
    if (mode === 'pick' && pickFor) {
      const p = world.places.find((q) => q.id === pickFor);
      if (p) store.upsert('places', { ...p, location: ll });
      startPick(undefined);
      setMode('browse');
      return;
    }
    if (mode === 'add-place') {
      const name = await ask.prompt('Name of the new place?');
      if (name) {
        const p: Place = { ...recordBase(), name, aliases: [], kind: 'city', location: ll, notes: '', isPlaceholder: false };
        store.upsert('places', p);
        setSelected({ kind: 'place', id: p.id });
      }
      return;
    }
    if (mode === 'measure') {
      setMeasure((m) => [...m, ll]);
      return;
    }
    if (mode === 'calibrate' && calib) {
      const img = world.mapImages.find((i) => i.id === calib.imageId);
      const t = tiled.current.get(calib.imageId)?.t;
      if (!img || !t) return;
      const east = img.east < img.west ? img.east + 360 : img.east;
      let lng = raw.lng;
      while (lng < img.west) lng += 360;
      while (lng > img.west + 360) lng -= 360;
      const px = ((lng - img.west) / (east - img.west)) * t.width;
      const py = ((img.north - raw.lat) / (img.north - img.south)) * t.height;
      const ans = await ask.prompt(`Real latitude, longitude of this spot on the sketch (e.g. 52.5, 13.4):`);
      if (!ans) return;
      const [la, ln] = ans.split(/[ ,;]+/).map(Number);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return void ask.alert('Please enter two numbers: latitude, longitude.');
      const points = [...calib.points, { px, py, lat: la, lng: ln }];
      if (points.length < 2) return setCalib({ ...calib, points });
      const b = boundsFromTwoPoints(points[0], points[1], t.width, t.height);
      if (!b) { void ask.alert('The two points must differ both left–right and up–down. Try again.'); return setCalib({ ...calib, points: [] }); }
      store.upsert('mapImages', { ...img, ...b });
      setCalib(null);
      setMode('browse');
      return;
    }
    const m = hit(x, y);
    setSelected(m ? { kind: m.kind, id: m.id } : null);
  };
  const onDouble = (e: React.MouseEvent) => {
    if (mode === 'draw') {
      if (draw.tool === 'polygon') {
        // the double-click's second click added a duplicate corner; leave it out
        finishPolygon(poly.slice(0, -1));
      }
      return;
    }
    const { x, y } = local(e);
    const m = hit(x, y);
    if (m?.kind === 'place') go('places', m.id);
    else if (m?.kind === 'character') go('characters', m.id);
  };

  const addImage = async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    const el = new Image();
    el.onload = () => {
      // Default placement: fill the visible area while keeping the aspect ratio.
      const widthDeg = Math.min(360, size.w / view.scale * 0.8);
      const heightDeg = Math.min(170, widthDeg * (el.naturalHeight / el.naturalWidth));
      const img: MapImage = {
        ...recordBase(),
        name: file.name.replace(/\.[^.]+$/, ''),
        dataUrl,
        widthPx: el.naturalWidth,
        heightPx: el.naturalHeight,
        north: clampLat(view.centerLat + heightDeg / 2),
        south: clampLat(view.centerLat - heightDeg / 2),
        west: view.centerLng - widthDeg / 2,
        east: view.centerLng + widthDeg / 2,
        opacity: 0.85,
        locked: false,
        visible: true,
      };
      store.upsert('mapImages', img);
    };
    el.src = dataUrl;
  };

  const selPlace = selected?.kind === 'place' ? world.places.find((p) => p.id === selected.id) : undefined;
  const selChar = selected?.kind === 'character' ? world.characters.find((c) => c.id === selected.id) : undefined;
  const selWhere = selChar ? whereIs(ix, selChar.id, moment) : undefined;
  const pickPlace = pickFor ? world.places.find((p) => p.id === pickFor) : undefined;

  const hoverInfo = useMemo(() => {
    if (!hover || !showTerrain) return '';
    const p = { lat: clampLat(hover.lat), lng: wrapLng(hover.lng) };
    const e = Math.round(reader.elevation(p));
    if (e <= 0) return ` · sea, ${(-e).toLocaleString()} m deep`;
    const b = world.settings.biomes.find((x) => x.id === reader.biome(p));
    const band = BAND_INFO[climateBand(p.lat, e, world.settings.axialTiltDeg)].name;
    return ` · ${e.toLocaleString()} m · ${band}, ~${Math.round(meanTemperatureC(p.lat, e))}°C${b ? ` · ${b.name}` : ''}`;
  }, [hover, reader, showTerrain, world.settings.biomes, world.settings.axialTiltDeg]);

  const mainMap = world.settings.mainMap;
  const frame = (b: { north: number; south: number; west: number; east: number }) => {
    const east = b.east < b.west ? b.east + 360 : b.east;
    setView(clampView({ centerLat: (b.north + b.south) / 2, centerLng: (b.west + east) / 2, scale: Math.min(size.w / (east - b.west), size.h / (b.north - b.south)) * 0.95 }));
  };
  const currentBounds = () => {
    const tl = toLatLng(view, size.w, size.h, 0, 0), br = toLatLng(view, size.w, size.h, size.w, size.h);
    return { north: clampLat(tl.lat), south: clampLat(br.lat), west: wrapLng(tl.lng), east: wrapLng(Math.min(br.lng, tl.lng + 360)) };
  };
  const edges = bandEdges(world.settings.axialTiltDeg);
  const globePoints = useMemo(() => [
    ...world.places.filter((p) => p.location && !p.isPlaceholder && !p.parentId).map((p) => ({ pos: p.location!, color: '#222' })),
    ...characterPositions.map((cp) => ({ pos: cp.pos, color: ix.characters.get(cp.id)?.color ?? '#888' })),
  ], [world.places, characterPositions, ix]);

  return (
    <div className="map-layout">
      <div className="map-canvas" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h, cursor: mode === 'browse' || (mode === 'draw' && draw.tool === 'pan') ? 'grab' : mode === 'draw' && isBrush(draw.tool) ? 'none' : 'crosshair' }}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { endStroke(); drag.current = null; }}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={onDouble}
          onContextMenu={(e) => mode === 'draw' && e.preventDefault()}
        />
        <canvas ref={overlayRef} className="map-overlay" style={{ width: size.w, height: size.h }} />
        <div className="map-toolbar">
          {(['browse', 'add-place', 'measure', 'draw'] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); if (m !== 'measure') setMeasure([]); setPoly([]); startPick(undefined); }}
              title={m === 'draw' ? 'Draw the world: land, heights, terrain and symbols' : undefined}>
              {m === 'browse' ? 'Move' : m === 'add-place' ? '+ Place' : m === 'measure' ? 'Measure' : '✎ Draw map'}
            </button>
          ))}
          <button onClick={() => setView(fitPlaces(world.places, size.w, size.h))}>Fit places</button>
          {mainMap && <button onClick={() => frame(mainMap)} title="Frame the main map (World settings)">Main map</button>}
          <button onClick={() => setView({ centerLat: 0, centerLng: 0, scale: Math.max(0.5, size.w / 380) })}>Whole globe</button>
          <button className={globe ? 'on' : ''} onClick={() => setGlobe(!globe)} title="Show the world as a sphere">Globe</button>
        </div>
        {mode === 'draw' && <ToolPalette state={draw} onChange={(d) => { setDraw(d); if (d.tool !== 'polygon') setPoly([]); }} />}
        {globe && (
          <GlobePreview
            overview={overview}
            version={overviewVersion}
            start={{ lat: view.centerLat, lng: view.centerLng }}
            points={globePoints}
            onClose={() => setGlobe(false)}
            onPick={(p) => setView((v) => ({ ...v, centerLat: p.lat, centerLng: p.lng }))}
          />
        )}
        <div className="map-status">
          {mode === 'pick' && pickPlace && <b>Click the map to place {pickPlace.name}. </b>}
          {mode === 'add-place' && <b>Click the map where the new place is. </b>}
          {mode === 'calibrate' && calib && <b>Calibrating: click known spot {calib.points.length + 1} of 2 on the sketch. </b>}
          {mode === 'draw' && draw.tool === 'polygon' && <b>{poly.length === 0 ? 'Click the first corner. ' : `${poly.length} corner(s): double-click or Enter to fill. `}</b>}
          {mode === 'measure' && (
            <b>
              {measure.length < 2 ? 'Click points to measure. ' : `${Math.round(pathLengthKm(measure, world.settings.radiusKm)).toLocaleString()} km great-circle. `}
              {measure.length > 0 && <button className="link" onClick={() => setMeasure([])}>clear</button>}
            </b>
          )}
          {hover && <span>{Math.abs(hover.lat).toFixed(2)}°{hover.lat >= 0 ? 'N' : 'S'}, {Math.abs(wrapLng(hover.lng)).toFixed(2)}°{wrapLng(hover.lng) >= 0 ? 'E' : 'W'}{hoverInfo}</span>}
          <span className="muted"> · {formatDayNumber(moment)}</span>
        </div>
      </div>
      <aside className="map-side">
        {mode === 'draw' && (
          <DrawOptions state={draw} onChange={setDraw} biomes={world.settings.biomes} polygonPoints={poly.length} onFinishPolygon={() => finishPolygon()} onCancelPolygon={() => setPoly([])} />
        )}
        {mode === 'draw' && !showTerrain && (
          <div className="card hint">
            <b>Start with the coastline.</b> Pick <b>Land</b> (L) and paint, or use <b>Shape</b> (P) to click out a continent. Upload a sketch below to trace over it.
          </div>
        )}
        {selPlace && (
          <div className="card">
            <h3>{PLACE_ICON[selPlace.kind]} {selPlace.name}</h3>
            <p className="muted">{selPlace.kind}{selPlace.location && ` · ${selPlace.location.lat.toFixed(2)}, ${selPlace.location.lng.toFixed(2)}`}</p>
            <p>Here now: {characterPositions.filter((cp) => { const w = whereIs(ix, cp.id, moment); return w.kind === 'stay' && (w.placeId === selPlace.id || ix.ancestors(w.placeId).includes(selPlace.id)); }).map((cp) => ix.characters.get(cp.id)!.name).join(', ') || 'nobody'}</p>
            <div className="row wrap">
              <button className="small" onClick={() => go('places', selPlace.id)}>Open</button>
              <button className="small" onClick={() => edit({ kind: 'stay', preset: { placeId: selPlace.id } })}>+ Stay here</button>
              <button className="small" onClick={() => { startPick(selPlace.id); }}>Move</button>
            </div>
          </div>
        )}
        {selChar && (
          <div className="card">
            <h3><span style={{ color: selChar.color }}>{selChar.icon}</span> {selChar.name}</h3>
            <p>
              {selWhere?.kind === 'stay' && <>At {ix.places.get(selWhere.placeId)?.name}</>}
              {selWhere?.kind === 'journey' && <>Travelling {ix.places.get(selWhere.fromId)?.name} → {ix.places.get(selWhere.toId)?.name}, {Math.round(selWhere.progress * 100)}% · {Math.round(greatCircleKm(ix.locationOf(selWhere.fromId)!, ix.locationOf(selWhere.toId)!, world.settings.radiusKm))} km straight</>}
            </p>
            <button className="small" onClick={() => go('characters', selChar.id)}>Open</button>
          </div>
        )}
        <h3>Show</h3>
        {(Object.keys(layers) as (keyof Layers)[]).map((k) => (
          <label key={k} className="checkbox"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {LAYER_NAMES[k]}</label>
        ))}
        <label className="field"><span className="label">Relief</span>
          <select value={relief} onChange={(e) => setRelief(e.target.value as Relief)}>
            <option value="hillshade">Hillshading</option>
            <option value="contours">Contour lines (every 250 m)</option>
            <option value="both">Both</option>
            <option value="off">Flat colours</option>
          </select>
        </label>
        {layers.climate && (
          <div className="card legend">
            <b className="small">Climate zones (RC-7)</b>
            {CLIMATE_BANDS.map((b, i) => (
              <div key={b} className="row small"><span className="sw" style={{ background: BAND_INFO[b].color }} /> {BAND_INFO[b].name}
                <span className="muted">{i === 0 ? `0–${edges[0].toFixed(0)}°` : i < 4 ? `${edges[i - 1].toFixed(0)}–${edges[i].toFixed(0)}°` : `${edges[3].toFixed(0)}–90°`}</span>
              </div>
            ))}
            <span className="muted small">At sea level, from the equator. Every 1,000 m of height counts as about 9° nearer a pole. Edges follow the axial tilt ({world.settings.axialTiltDeg}°).</span>
          </div>
        )}
        <h3>Main map</h3>
        <p className="muted small">{mainMap ? `Covers ${mainMap.north.toFixed(1)}° to ${mainMap.south.toFixed(1)}° latitude, ${mainMap.west.toFixed(1)}° to ${mainMap.east.toFixed(1)}° longitude.` : 'The main map is the whole globe.'}</p>
        <div className="row wrap">
          <button className="small" onClick={() => store.setSettings({ mainMap: currentBounds() })}>Use this view</button>
          {mainMap && <button className="small" onClick={() => store.setSettings({ mainMap: undefined })}>Whole globe</button>}
        </div>
        <h3>Sketches and images</h3>
        <p className="muted small">Upload a map sketch and pin it to the globe by its edges, or calibrate it with two known spots.</p>
        {world.mapImages.map((img) => (
          <div className="card" key={img.id}>
            <div className="row">
              <input type="checkbox" checked={img.visible} onChange={(e) => store.upsert('mapImages', { ...img, visible: e.target.checked })} title="Visible" />
              <input value={img.name} onChange={(e) => store.upsert('mapImages', { ...img, name: e.target.value })} />
            </div>
            <label className="field"><span className="label">Opacity</span>
              <input type="range" min={0.1} max={1} step={0.05} value={img.opacity} onChange={(e) => store.upsert('mapImages', { ...img, opacity: Number(e.target.value) }, )} />
            </label>
            <div className="corner-grid">
              {(['north', 'south', 'west', 'east'] as const).map((k) => (
                <label key={k}><span>{k}</span>
                  <input type="number" step={0.1} disabled={img.locked} value={Number(img[k].toFixed(3))} onChange={(e) => store.upsert('mapImages', { ...img, [k]: Number(e.target.value) })} />
                </label>
              ))}
            </div>
            <div className="row wrap">
              <label className="checkbox"><input type="checkbox" checked={img.locked} onChange={(e) => store.upsert('mapImages', { ...img, locked: e.target.checked })} /> Lock</label>
              <button className="small" disabled={img.locked} onClick={() => { setCalib({ imageId: img.id, points: [] }); setMode('calibrate'); }}>Calibrate</button>
              <button className="small" onClick={() => {
                const east = img.east < img.west ? img.east + 360 : img.east;
                setView(clampView({ centerLat: (img.north + img.south) / 2, centerLng: (img.west + east) / 2, scale: Math.min(size.w / (east - img.west), size.h / (img.north - img.south)) * 0.9 }));
              }}>Zoom to</button>
              <button className="small danger" onClick={async () => (await ask.confirm(`Remove ${img.name}?`, { okLabel: 'Remove', danger: true })) && store.removeMany([{ c: 'mapImages', id: img.id }])}>Remove</button>
            </div>
          </div>
        ))}
        <label className="button">
          + Upload sketch
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ''; }} />
        </label>
      </aside>
    </div>
  );
}
