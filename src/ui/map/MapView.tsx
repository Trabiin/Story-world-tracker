/**
 * The world map (MP-1..MP-3, MP-5, MK-1, MK-3, VW-5 markers) and the mapmaking tools
 * (MK-4..MK-7, MK-18, MK-24, MK-26, MK-27). Equirectangular, wraps east–west.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canvasRatio, lightDrawing } from '../perf';
import { ask } from '../components/Dialogs';
import {
  BAND_INFO, BrushParams, CLIMATE_BANDS, DetailMap, Id, LatLng, MapImage, MapSymbol, Place, Terrain, TerrainEditor, TerrainReader,
  MapFeature, refreshAutoRivers, traceRiver, routeAlongFeatures, networkFor, fromDay, existsOn, featureAnchor, insideArea, nearestOnPolyline, riverFlows, uphillSegments,
  applyDab, bandEdges, clampLat, climateBand, dabsBetween, fillPolygon, formatDayNumber, greatCircleKm, hasTerrain, interpolateGreatCircle,
  meanTemperatureC, pathLengthKm, applyFix, changedFeatures, FIX_LABEL, suggestBiomes, addCoastDetail, removeCoastDetail, hasCoastDetail, addDetailToFeatures, removeDetailFromFeatures, localSeasons, BiomeSuggestion, whereIs, wrapLng, LayerIndex, characterTrack, OPEN_END, areaOwners, editRegionArea, polygonFromPoints, strokeArea, GeoMultiPolygon, incidentAt,
  checkProposal, scenarioView, CANON,
} from '../../core';
import { newId, recordBase } from '../../storage';
import { fileToDataUrl } from '../views/Characters';
import { PLACE_ICON } from '../views/Places';
import { useApp } from '../context';
import { TiledImage, TILE } from './tiles';
import { ViewState, boundsFromTwoPoints, toLatLng, toScreen, wrapOffsets } from './projection';
import { Pinch, arrowPan, clampView, lerpView, panBy, pinchView, viewForBox, wheelAction, wheelPref, zoomAt } from './navigate';
import { ZoomControls } from './ZoomControls';
import { FindBox } from './FindBox';
import { FindEntry, boundsOf, boundsOfArea, viewForEntry } from './findOnMap';
import { MapInset } from './MapInset';
import { SideSection } from './SideSection';
import { claudeOpts, acceptInStore } from '../claude/actions';
import { DEFAULT_DRAW, DrawOptions, DrawState, DrawTool, TOOLS, ToolPalette, isBrush, isDrawnFeature, toolInfo } from './DrawPanel';
import { GlobePreview } from './GlobePreview';
import { Overview, Relief, RenderStyle, SYMBOL_BLOCK, TileImageCache, autoSymbols, hexToRgb, paletteFor, styleKey } from './terrainRender';
import { drawCompass, drawSymbol, paintParchment } from './symbols';
import { KIND_NAME, RIVER_COLOR, ScreenShape, drawFeatures, hitFeature, projectLine } from './featureRender';
import { FeatureCard, deleteFeature } from './FeatureCard';
import { MapMenu, MenuItem } from './MapMenu';
import { RouteCard } from './RouteCard';
import { MapWizard } from './MapWizard';
import { SketchTraceDialog } from './SketchTrace';
import { DetailMapsCard, LayersCard, sortedMaps } from './MapsPanel';
import { drawRegionLayers } from './regionRender';
import { EffectShade, drawEclipses, drawEffectGrid } from './eclipseRender';
import { EclipseCard } from './EclipseCard';
import { effectGrid, eclipseRules, newShadow, shadowEvents } from '../../core';
import { mapToSvg } from './exportSvg';
import { imagePdf, formatDayNumber as fmtDay } from '../../core';
import { canvasBytes } from '../util';
import { DEFAULT_REGION_TOOLS, REGION_TOOL_KEYS, RegionCard, RegionLayerList, RegionList, RegionToolState, WhatsHere, hereLine, sortedLayers } from './RegionsPanel';

/** A path with long legs broken into great-circle pieces, so it curves correctly on the flat map. */
function densify(pts: LatLng[], R: number): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) { out.push(pts[0]); continue; }
    const n = Math.min(64, Math.ceil(greatCircleKm(pts[i - 1], pts[i], R) / 60));
    out.push(...(n > 1 ? interpolateGreatCircle(pts[i - 1], pts[i], n).slice(1) : [pts[i]]));
  }
  return out;
}

/** Map features never show as place markers; they are drawn as lines and areas. */
const FEATURE_PLACE_KINDS = new Set(['river', 'lake', 'road', 'area']);
const SETTLEMENT_SIZE: Record<string, number> = { capital: 18, city: 16, town: 13, village: 11 };

type Mode = 'browse' | 'pick' | 'measure' | 'calibrate' | 'add-place' | 'draw' | 'route' | 'layers' | 'eclipse';
const DRAW_KEY = 'swt.draw';
const LAYERS_KEY = 'swt.mapLayers';
const DEFAULT_LAYERS = { grid: true, compass: true, scale: true, mountains: true, symbols: true, features: true, maps: true, climate: false, regions: true, eclipses: true, eclipseEffects: false, places: true, characters: true, routes: true, labels: true, inset: true };
type Layers = typeof DEFAULT_LAYERS;
const LAYER_NAMES: Record<keyof Layers, string> = {
  grid: 'Lat/long grid', compass: 'Compass rose', scale: 'Scale bar', mountains: 'Mountain symbols (automatic)', symbols: 'Placed symbols', features: 'Rivers, lakes, roads and areas', maps: 'Detail map frames',
  climate: 'Climate zones', regions: 'Realms, cultures and other layers', eclipses: 'Eclipse paths', eclipseEffects: 'Eclipse effects (cooling, forests)', places: 'Places', characters: 'Characters', routes: 'Routes', labels: 'Labels', inset: 'Overview when zoomed in',
};
/** MK-32: the Show list in three groups. */
const LAYER_GROUPS: { name: string; keys: (keyof Layers)[] }[] = [
  { name: 'Background', keys: ['grid', 'compass', 'scale', 'inset'] },
  { name: 'Land', keys: ['mountains', 'symbols', 'features', 'maps', 'climate'] },
  { name: 'Story', keys: ['regions', 'eclipses', 'eclipseEffects', 'places', 'characters', 'routes', 'labels'] },
];
const PANEL_KEY = 'swt.mapPanel';

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
  const { world, store, ix, moment, pickFor, startPick, routeFor, startRoute, eclipseFor, startEclipse, go, edit, mapFocus, trackRequest, fixPreview, previewFix, platform, claudePreview, previewSuggestion } = useApp();
  const viewKey = `${VIEW_KEY}.${store.handle.id}`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(() => loadView(viewKey, world.places));
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [mode, setMode] = useState<Mode>(pickFor ? 'pick' : 'browse');
  const [hover, setHover] = useState<LatLng | null>(null);
  const [selected, setSelected] = useState<{ kind: 'place' | 'character' | 'feature'; id: Id } | null>(null);
  const [measure, setMeasure] = useState<LatLng[]>([]);
  /** MP-10: measure along drawn roads instead of straight. */
  const [measureFollow, setMeasureFollow] = useState(false);
  /** WH-6: the route being drawn for a journey; `marks` remembers where each click began, for undo. */
  const [routeDraft, setRouteDraft] = useState<{ pts: LatLng[]; marks: number[] }>({ pts: [], marks: [] });
  const [routeFollow, setRouteFollow] = useState(true);
  /** MP-4: the detail map being looked at; none = the world. MK-13: the layer new drawing goes on. */
  const mapKey = `swt.map.${store.handle.id}`;
  const [currentMap, setCurrentMap] = useState<Id | undefined>(() => { try { return JSON.parse(localStorage.getItem(mapKey) ?? '{}').map; } catch { return undefined; } });
  const [activeLayer, setActiveLayer] = useState<Id | undefined>(() => { try { return JSON.parse(localStorage.getItem(mapKey) ?? '{}').layer; } catch { return undefined; } });
  useEffect(() => { try { localStorage.setItem(mapKey, JSON.stringify({ map: currentMap, layer: activeLayer })); } catch { /* ignore */ } }, [mapKey, currentMap, activeLayer]);
  const hiddenLayers = useMemo(() => new Set(world.mapLayers.filter((l) => !l.visible).map((l) => l.id)), [world.mapLayers]);
  const lockedLayers = useMemo(() => new Set(world.mapLayers.filter((l) => l.locked).map((l) => l.id)), [world.mapLayers]);
  const layerOn = (id?: Id) => !id || !hiddenLayers.has(id);
  const layerFree = (id?: Id) => !id || (!hiddenLayers.has(id) && !lockedLayers.has(id));
  const drawLayer = activeLayer && world.mapLayers.some((l) => l.id === activeLayer) ? activeLayer : undefined;
  /** MK-16: the first-map guide opens by itself on a world with nothing drawn yet. */
  const [traceFor, setTraceFor] = useState<Id | undefined>();
  const [wizardOpen, setWizardOpen] = useState(() => !world.settings.mapWizard?.closed && !hasTerrain(world.terrain));
  /** EU-2: a character marker being dragged to a new place. */
  const charDrag = useRef<{ id: Id; x: number; y: number } | null>(null);
  const [charDragAt, setCharDragAt] = useState<{ id: Id; from: { x: number; y: number }; x: number; y: number } | null>(null);
  const [layers, setLayers] = useState<Layers>(() => loadJson(LAYERS_KEY, DEFAULT_LAYERS));
  const [relief, setRelief] = useState<Relief>(() => (localStorage.getItem('swt.relief') as Relief) || 'hillshade');
  const [draw, setDraw] = useState<DrawState>(() => loadJson(DRAW_KEY, DEFAULT_DRAW));
  const [working, setWorking] = useState<Terrain | null>(null);
  const [poly, setPoly] = useState<LatLng[]>([]);
  /** A river, lake, line or area being drawn, with the place each point snapped to. */
  const [draft, setDraft] = useState<{ pts: LatLng[]; stops: (Id | null)[] }>({ pts: [], stops: [] });
  const shapes = useRef<ScreenShape[]>([]);
  /** Dragging a vertex of the selected feature (MK-19: drag the line to adjust it). */
  const vdrag = useRef<{ id: Id; idx: number } | null>(null);
  const [editPts, setEditPts] = useState<{ id: Id; pts: LatLng[]; stops?: (Id | null)[] } | null>(null);
  const freehand = useRef<{ lastX: number; lastY: number; started: boolean } | null>(null);
  const [globe, setGlobe] = useState(false);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [hoverHit, setHoverHit] = useState<{ kind: 'place' | 'character' | 'feature'; id: Id; name: string; note: string; x: number; y: number; mx: number; my: number; r: number } | null>(null);
  const [overviewVersion, setOverviewVersion] = useState(0);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tileCache = useRef(new TileImageCache());
  const overview = useMemo(() => new Overview(0.5), []);
  const space = useRef(false);
  const [tick, setTick] = useState(0);
  const [calib, setCalib] = useState<{ imageId: Id; points: { px: number; py: number; lat: number; lng: number }[] } | null>(null);
  const markers = useRef<Marker[]>([]);
  const paintRef = useRef<((g: CanvasRenderingContext2D, w: number, h: number, view: ViewState, opts: { pxRatio: number; exporting?: boolean; base?: boolean }) => Marker[]) | null>(null);
  const tiled = useRef(new Map<Id, { src: string; t: TiledImage }>());
  // ---- region layers (LY-1..LY-9) ----
  const lix = useMemo(() => new LayerIndex(world), [world.regionLayers, world.regions, world.settings.hemisphereForSeasons]); // eslint-disable-line react-hooks/exhaustive-deps
  const [regionTools, setRegionTools] = useState<RegionToolState>(() => ({ ...loadJson('swt.regionTools', DEFAULT_REGION_TOOLS), from: undefined, until: undefined, note: '', span: 'always' as const }));
  useEffect(() => { try { localStorage.setItem('swt.regionTools', JSON.stringify({ tool: regionTools.tool, op: regionTools.op, brushKm: regionTools.brushKm, snap: regionTools.snap, neighbours: regionTools.neighbours })); } catch { /* ignore */ } }, [regionTools]);
  const [regionLayerPick, setRegionLayerPick] = useState<Id | undefined>(() => localStorage.getItem(`swt.regionLayer.${store.handle.id}`) ?? undefined);
  const regionLayer = lix.layer(regionLayerPick ?? '') ?? sortedLayers(world.regionLayers)[0];
  useEffect(() => { try { if (regionLayer) localStorage.setItem(`swt.regionLayer.${store.handle.id}`, regionLayer.id); } catch { /* ignore */ } }, [regionLayer, store.handle.id]);
  const [regionSel, setRegionSel] = useState<Id | undefined>();
  const selRegion = regionSel ? lix.regions.get(regionSel) : undefined;
  const [regionDraft, setRegionDraft] = useState<LatLng[]>([]);
  const regionStroke = useRef<{ pts: LatLng[]; alt: boolean } | null>(null);
  const [strokePreview, setStrokePreview] = useState<LatLng[]>([]);
  const [whatsHere, setWhatsHere] = useState<LatLng | null>(null);
  const regionEditable = !!selRegion && !lix.layer(selRegion.layerId)?.locked;
  // ---- VW-2, LY-6: when the date crosses a border change, the changed regions glow and the change is named ----
  const prevVersions = useRef<Map<Id, number> | null>(null);
  const prevMoment = useRef(moment);
  const [flash, setFlash] = useState<{ ids: Set<Id>; text: string; day: number; t0: number } | null>(null);
  const [flashTick, setFlashTick] = useState(0);
  useEffect(() => {
    const now = new Map<Id, number>();
    for (const r of lix.regions.values()) now.set(r.id, lix.exists(r, moment) ? lix.versionIndexAt(r, moment) : -2);
    const prev = prevVersions.current;
    const from = prevMoment.current;
    prevVersions.current = now;
    prevMoment.current = moment;
    if (!prev) return;
    const changed = [...now].filter(([id, v]) => prev.has(id) && prev.get(id) !== v && lix.layer(lix.regions.get(id)!.layerId)?.visible).map(([id]) => id);
    if (!changed.length) return;
    const notes = changed.map((id) => { const r = lix.regions.get(id)!; const v = lix.versionAt(r, moment); return v?.note; }).filter(Boolean) as string[];
    const text = notes.length ? [...new Set(notes)].join(' · ') : `Borders change: ${changed.map((id) => lix.regions.get(id)!.name).join(', ')}`;
    // Name the day the change happened, not the frame that crossed it.
    const lo = Math.min(from, moment), hi = Math.max(from, moment);
    const days = lix.changeDays().filter((d) => d > lo && d <= hi);
    const day = days.length ? (moment >= from ? days[days.length - 1] : days[0]) : moment;
    setFlash({ ids: new Set(changed), text, day, t0: performance.now() });
  }, [moment, lix]);
  useEffect(() => {
    if (!flash) return;
    // Lighter drawing: no fade animation (each frame redraws the whole map), just show and clear.
    if (lightDrawing()) { const t = setTimeout(() => setFlash(null), 3000); return () => clearTimeout(t); }
    let raf = 0;
    const tick = () => {
      if (performance.now() - flash.t0 > 3000) { setFlash(null); return; }
      setFlashTick((t) => t + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flash]);
  const flashStrength = flash ? Math.max(0, 1 - (performance.now() - flash.t0) / 3000) : 0;
  // ---- VW-3: character tracks ----
  const tracksKey = `swt.tracks.${store.handle.id}`;
  const [tracks, setTracks] = useState<Id[]>(() => { try { return JSON.parse(localStorage.getItem(tracksKey) ?? '[]'); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem(tracksKey, JSON.stringify(tracks)); } catch { /* ignore */ } }, [tracks, tracksKey]);
  useEffect(() => { if (trackRequest) setTracks((t) => (t.includes(trackRequest.id) ? t : [...t, trackRequest.id])); }, [trackRequest]);
  const trackData = useMemo(() => tracks.filter((id) => ix.characters.has(id)).map((id) => ({ id, ...characterTrack(ix, id) })), [tracks, ix]);

  useEffect(() => setMode(pickFor ? 'pick' : 'browse'), [pickFor]);
  // EC-1: drawing an eclipse's shadow path
  const [eclipseDraft, setEclipseDraft] = useState<LatLng[]>([]);
  const eclipseEvent = eclipseFor ? world.events.find((e) => e.id === eclipseFor) : undefined;
  useEffect(() => {
    if (!eclipseFor) { setMode((m) => (m === 'eclipse' ? 'browse' : m)); return; }
    const e = store.world.events.find((q) => q.id === eclipseFor);
    if (!e) { startEclipse(undefined); return; }
    if (!e.shadow) store.upsert('events', { ...e, shadow: newShadow() });
    setMode('eclipse');
    setEclipseDraft(e.shadow?.track ?? []);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eclipseFor]);
  const finishEclipse = () => {
    const e = eclipseEvent;
    if (e) store.upsert('events', { ...e, shadow: { ...(e.shadow ?? newShadow()), track: eclipseDraft } });
    startEclipse(undefined);
    setMode('browse');
  };
  const cancelEclipse = () => { startEclipse(undefined); setMode('browse'); };
  // EC-6: shading for cooling or forest health on the date shown
  const [effectShade, setEffectShade] = useState<EffectShade>(() => { try { return (localStorage.getItem('swt.eclipseShade') as EffectShade) || 'cooling'; } catch { return 'cooling'; } });
  useEffect(() => { try { localStorage.setItem('swt.eclipseShade', effectShade); } catch { /* ignore */ } }, [effectShade]);
  const hasShadows = useMemo(() => shadowEvents(world).length > 0, [world]);
  const gridDay = Math.floor(moment);
  const effects = useMemo(() => (layers.eclipseEffects && hasShadows ? effectGrid(world, gridDay) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers.eclipseEffects, hasShadows, world.events, world.settings.eclipseRules, world.settings.sky, world.settings.radiusKm, world.settings.hemisphereForSeasons, gridDay]);
  const maxCooling = eclipseRules(world).coolingC * 0.4;
  const routeJourney = routeFor ? world.journeys.find((j) => j.id === routeFor) : undefined;
  useEffect(() => {
    if (!routeFor) { setMode((m) => (m === 'route' ? 'browse' : m)); return; }
    const j = world.journeys.find((q) => q.id === routeFor);
    const start = j && ix.locationOf(j.originId);
    if (!j || !start) { startRoute(undefined); return; }
    setMode('route');
    setRouteDraft(j.route?.length ? { pts: j.route, marks: [] } : { pts: [start], marks: [] });
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFor]);
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

  // ---- MK-23: a fix previewed on the map; MK-20: suggested terrain previewed before it is accepted ----
  const fixAfter = useMemo(() => (fixPreview ? applyFix(world, fixPreview.fix, recordBase) : null), [fixPreview, world]);
  const fixDiff = useMemo(() => (fixAfter ? changedFeatures(world, fixAfter) : null), [fixAfter, world]);
  const [suggestion, setSuggestion] = useState<(BiomeSuggestion & { onlyUnpainted: boolean }) | null>(null);
  // AI-3: a suggestion from Claude shown as a ghost: new lines violet, replaced ones red, new borders dashed, new places as rings.
  const claudeSug = claudePreview ? store.world.suggestions.find((x) => x.id === claudePreview.suggestionId && x.state === 'open') : undefined;
  const claudeGhost = useMemo(() => {
    if (!claudeSug) return null;
    const pending = claudeSug.changes.map((_, i) => i).filter((i) => !(claudeSug.acceptedChanges ?? []).includes(i));
    const c = checkProposal(store.world, { ...claudeSug, changes: pending.map((i) => claudeSug.changes[i]), asScenario: claudeSug.acceptedChanges?.length ? undefined : claudeSug.asScenario }, claudeOpts);
    if (c.errors.length || !c.result) return { errors: c.errors, added: undefined, removed: [], regions: [], places: [], terrain: undefined, warnings: [] };
    const after = scenarioView(c.result.world, c.scenarioId ?? CANON);
    const old = new Map(world.mapFeatures.map((f) => [f.id, f]));
    const added = after.mapFeatures.filter((f) => old.get(f.id)?.points !== f.points);
    const now = new Set(after.mapFeatures.map((f) => f.id));
    const removed = world.mapFeatures.filter((f) => !now.has(f.id) || added.some((a) => a.id === f.id));
    const oldR = new Map(world.regions.map((r) => [r.id, r]));
    const regions = after.regions.filter((r) => oldR.get(r.id)?.versions !== r.versions);
    const oldP = new Map(world.places.map((pl) => [pl.id, pl]));
    const places = after.places.filter((pl) => pl.location && oldP.get(pl.id)?.location !== pl.location && !after.mapFeatures.some((f) => f.placeId === pl.id));
    return { errors: [] as string[], added, removed, regions, places, terrain: c.result.terrain ? after.terrain : undefined, warnings: c.newWarnings };
  }, [claudeSug, store.world, world]);
  const terrain = suggestion?.terrain ?? claudeGhost?.terrain ?? working ?? world.terrain;
  const reader = useMemo(() => new TerrainReader(terrain), [terrain]);
  const showTerrain = hasTerrain(terrain);
  const style: RenderStyle = useMemo(
    () => ({ relief, climate: layers.climate, tilt: world.settings.axialTiltDeg, biomes: world.settings.biomes, dark: isDark(), parchment: world.settings.mapStyle === 'parchment' }),
    [relief, layers.climate, world.settings.axialTiltDeg, world.settings.biomes, world.settings.mapStyle],
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
    const out: { id: Id; pos: LatLng; journey?: LatLng[] }[] = [];
    for (const c of world.characters) {
      if (c.archived) continue;
      const w = whereIs(ix, c.id, moment);
      if ((w.kind === 'stay' || w.kind === 'journey') && w.position) {
        let journey;
        if (w.kind === 'journey') {
          const j = ix.journeys.get(w.segment.recordId);
          journey = j ? ix.journeyPath(j) : undefined;
        }
        out.push({ id: c.id, pos: w.position, journey });
      }
    }
    return out;
  }, [world, ix, moment]);

  const flows = useMemo(() => riverFlows(world.mapFeatures, world.settings.radiusKm), [world.mapFeatures, world.settings.radiusKm]);

  // ---- drawing ----
  /** Paint the whole map into g (w × h CSS pixels). MK-14: also used, sharper, for exports. */
  const paint = (g: CanvasRenderingContext2D, w: number, h: number, view: ViewState, opts: { pxRatio: number; exporting?: boolean; base?: boolean }): Marker[] => {
    const ff = style.parchment ? 'Georgia, "Times New Roman", serif' : 'system-ui';
    g.fillStyle = cssVar('--map-sea');
    g.fillRect(0, 0, w, h);
    const offsets = wrapOffsets(view, w);
    const ms: Marker[] = [];

    // world extent: plain when nothing is painted yet, open ocean once there is terrain
    const pal = paletteFor(style);
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
        const devPx = tilePx * Math.max(1, opts.pxRatio / 1.5);
        const res = devPx <= 40 ? 30 : devPx <= 110 ? 120 : devPx <= 400 ? 240 : 480;
        tileCache.current.beginFrame(opts.exporting ? 1e9 : 30);
        const tl = toLatLng(view, w, h, 0, 0), br = toLatLng(view, w, h, w, h);
        const ty0 = Math.max(0, Math.floor((90 - tl.lat) / tg.tileDeg)), ty1 = Math.min(tg.tilesY - 1, Math.floor((90 - br.lat) / tg.tileDeg));
        const tx0 = Math.floor((tl.lng + 180) / tg.tileDeg), tx1 = Math.floor((br.lng + 180) / tg.tileDeg);
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let txu = tx0; txu <= tx1; txu++) {
            const tx = ((txu % tg.tilesX) + tg.tilesX) % tg.tilesX;
            if (!reader.tile(tx, ty)) continue;
            const o = (txu - tx) / tg.tilesX * 360;
            visibleTiles.push([tx, ty]);
            const p = toScreen(view, w, h, { lat: 90 - ty * tg.tileDeg, lng: -180 + tx * tg.tileDeg }, o);
            // MK-37: close up, a tile is drawn in parts at full sharpness instead of one stretched picture
            const n = devPx > 2400 ? 8 : devPx > 1200 ? 4 : devPx > 600 ? 2 : 1;
            if (n === 1) {
              const c = tileCache.current.get(reader, tx, ty, res, style, sk);
              if (c) g.drawImage(c, p.x, p.y, tilePx + 0.6, tilePx + 0.6);
              continue;
            }
            const partPx = tilePx / n;
            for (let py = 0; py < n; py++) {
              const y = p.y + py * partPx;
              if (y > h || y + partPx < 0) continue;
              for (let px = 0; px < n; px++) {
                const x = p.x + px * partPx;
                if (x > w || x + partPx < 0) continue;
                const c = tileCache.current.get(reader, tx, ty, 480, style, sk, { x: px, y: py, n });
                if (c) g.drawImage(c, x, y, partPx + 0.6, partPx + 0.6);
                else { // the whole tile, stretched, until the sharp part is ready
                  const whole = tileCache.current.get(reader, tx, ty, 480, style, sk);
                  if (whole) g.drawImage(whole, px * 480 / n, py * 480 / n, 480 / n, 480 / n, x, y, partPx + 0.6, partPx + 0.6);
                }
              }
            }
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

    // region layers: realms, cultures, religions … on the current date (LY-3, LY-6, LY-7)
    if (layers.regions && world.regions.length) {
      drawRegionLayers(g, {
        ix: lix, day: moment, offsets, project: (p, o) => toScreen(view, w, h, p, o), scale: view.scale, w, h,
        reader: showTerrain ? reader : undefined, labels: layers.labels && !opts.base, selected: mode === 'layers' && !opts.exporting ? regionSel : undefined,
        flash: flash && !opts.exporting ? { ids: flash.ids, strength: flashStrength } : undefined,
        activeLayer: mode === 'layers' ? regionLayer?.id : undefined, fg: cssVar('--fg'), bg: cssVar('--bg'),
      });
    }

    // EC-6: eclipse effects, then the bands of the eclipses going on (and the one being drawn)
    if (effects && layers.eclipseEffects) drawEffectGrid(g, effects, effectShade, maxCooling, offsets, (p, o) => toScreen(view, w, h, p, o));
    if (layers.eclipses || mode === 'eclipse') {
      drawEclipses(g, {
        world, day: moment, offsets, project: (p, o) => toScreen(view, w, h, p, o), w, h, labels: layers.labels && !opts.base,
        draft: mode === 'eclipse' && eclipseFor ? { eventId: eclipseFor, track: eclipseDraft } : undefined, fg: cssVar('--fg'), bg: cssVar('--bg'),
      });
    }

    // MK-14: the raster under an SVG export stops here; the rest is drawn as vectors
    if (opts.base) { if (style.parchment) paintParchment(g, w, h); return ms; }

    // graticule (MK-3)
    if (layers.grid) {
      const step = view.scale > 40 ? 1 : view.scale > 12 ? 5 : view.scale > 4 ? 10 : 30;
      g.strokeStyle = cssVar('--map-grid');
      g.lineWidth = 1;
      g.fillStyle = cssVar('--map-grid-label');
      g.font = `10px ${ff}`;
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
        if (!layerOn(sym.layerId)) continue;
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

    // drawn features (MP-6, MP-7), only while they exist (MP-9)
    if (layers.features) {
      const visible = world.mapFeatures.filter((f) => layerOn(f.layerId) && existsOn((d) => ix.win(d), f, moment));
      shapes.current = drawFeatures(g, visible, {
        offsets, project: (p, o) => toScreen(view, w, h, p, o), scale: view.scale, flows, selected: selected?.kind === 'feature' ? selected.id : undefined,
        labels: layers.labels, fg: cssVar('--fg'), bg: cssVar('--bg'), w, h,
      });
    } else shapes.current = [];

    // MK-23: what the previewed fix changes: old lines faded red, new ones green
    if (fixDiff && !opts.exporting) {
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      for (const o of offsets) {
        for (const f of fixDiff.removed) { g.strokeStyle = 'rgba(200,60,40,0.7)'; g.lineWidth = 3; g.setLineDash([5, 4]); drawPath(f.points, o); }
        for (const f of fixDiff.added) {
          g.setLineDash([]);
          g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7; drawPath(f.points, o);
          g.strokeStyle = '#2e9d4f'; g.lineWidth = 3.5; drawPath(f.points, o);
        }
      }
      g.restore();
    }
    if (claudeGhost?.added && !opts.exporting) {
      const ghost = { ...claudeGhost, added: claudeGhost.added };
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      const lix2 = new LayerIndex({ ...world, regions: ghost.regions });
      for (const o of offsets) {
        for (const f of ghost.removed) { g.strokeStyle = 'rgba(200,60,40,0.75)'; g.lineWidth = 3; g.setLineDash([5, 4]); drawPath(f.shape === 'area' ? [...f.points, f.points[0]] : f.points, o); }
        for (const f of ghost.added) {
          const pts = f.shape === 'area' ? [...f.points, f.points[0]] : f.points;
          g.setLineDash([]);
          g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7; drawPath(pts, o);
          g.strokeStyle = '#7e57c2'; g.lineWidth = 3.5; drawPath(pts, o);
        }
        g.setLineDash([9, 5]);
        for (const r of ghost.regions) {
          const v = lix2.versionAt(r, moment) ?? r.versions[r.versions.length - 1];
          if (!v) continue;
          for (const poly of v.area) for (const ring of poly) { g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; drawPath(ring.map(([lng, lat]) => ({ lat, lng })), o); g.strokeStyle = '#7e57c2'; g.lineWidth = 2.5; drawPath(ring.map(([lng, lat]) => ({ lat, lng })), o); }
        }
        g.setLineDash([]);
        for (const pl of ghost.places) {
          const sp = toScreen(view, w, h, pl.location!, o);
          g.beginPath(); g.arc(sp.x, sp.y, 7, 0, Math.PI * 2); g.strokeStyle = '#7e57c2'; g.lineWidth = 3; g.stroke();
          g.fillStyle = '#7e57c2'; g.font = `600 12px ${ff}`; g.fillText(pl.name, sp.x + 10, sp.y + 4);
        }
      }
      g.restore();
    }

    // detail map frames (MP-4)
    if (layers.maps) {
      g.save();
      g.setLineDash([8, 5]);
      g.font = `600 12px ${ff}`;
      g.textBaseline = 'bottom';
      for (const m of world.detailMaps) {
        if (m.id === currentMap) continue;
        const east = m.east < m.west ? m.east + 360 : m.east;
        for (const o of offsets) {
          const a = toScreen(view, w, h, { lat: m.north, lng: m.west }, o), b = toScreen(view, w, h, { lat: m.south, lng: east }, o);
          if (b.x < 0 || a.x > w || b.y < 0 || a.y > h || b.x - a.x < 12) continue;
          g.strokeStyle = 'rgba(40,40,40,0.55)'; g.lineWidth = 1.2;
          g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
          if (b.x - a.x > 40) {
            g.fillStyle = 'rgba(255,255,255,0.8)';
            const tw = g.measureText(m.name).width;
            g.fillRect(a.x, a.y - 16, tw + 8, 16);
            g.fillStyle = '#333';
            g.fillText(m.name, a.x + 4, a.y - 2);
          }
        }
      }
      g.restore();
    }

    // VW-3: whole tracks of chosen characters, with dates at each stop
    for (const t of trackData) {
      const col = ix.characters.get(t.id)?.color ?? '#888';
      g.save();
      g.lineJoin = 'round'; g.lineCap = 'round';
      for (const leg of t.legs) {
        const path = densify(leg.path, world.settings.radiusKm);
        const done = leg.end <= moment;
        g.globalAlpha = done ? 0.95 : 0.55;
        g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 5; g.setLineDash([]);
        for (const o of offsets) drawPath(path, o);
        g.strokeStyle = col; g.lineWidth = 2.5; g.setLineDash(done ? [] : [6, 5]);
        for (const o of offsets) drawPath(path, o);
      }
      g.setLineDash([]);
      g.globalAlpha = 1;
      // WH-10: incidents on the way, as small diamonds along the leg.
      for (const leg of t.legs) {
        const j = ix.journeys.get(leg.journeyId);
        for (const inc of j?.incidents ?? []) {
          const at = incidentAt(ix, j!, inc).at;
          if (!at) continue;
          for (const o of offsets) {
            const sp = toScreen(view, w, h, at, o);
            if (sp.x < -50 || sp.x > w + 50 || sp.y < -20 || sp.y > h + 20) continue;
            g.beginPath(); g.moveTo(sp.x, sp.y - 6); g.lineTo(sp.x + 6, sp.y); g.lineTo(sp.x, sp.y + 6); g.lineTo(sp.x - 6, sp.y); g.closePath();
            g.fillStyle = col; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
            if (layers.labels && inc.title) {
              g.font = `italic 11px ${ff}`; g.textAlign = 'left'; g.textBaseline = 'middle';
              g.lineWidth = 3; g.strokeStyle = cssVar('--bg'); g.strokeText(inc.title, sp.x + 8, sp.y);
              g.fillStyle = col; g.fillText(inc.title, sp.x + 8, sp.y);
            }
          }
        }
      }
      const fmt = (n: number) => formatDayNumber(n);
      t.stops.forEach((st, i) => {
        for (const o of offsets) {
          const sp = toScreen(view, w, h, st.at, o);
          if (sp.x < -100 || sp.x > w + 100 || sp.y < -40 || sp.y > h + 40) continue;
          g.beginPath(); g.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
          g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = col; g.stroke();
          if (layers.labels) {
            const label = `${i + 1}. ${fmt(st.start)}${st.end === OPEN_END ? ' –' : st.end - st.start >= 1 ? ` – ${fmt(st.end)}` : ''}`;
            g.font = `600 11px ${ff}`; g.textAlign = 'left'; g.textBaseline = 'top';
            g.lineWidth = 3; g.strokeStyle = cssVar('--bg');
            g.strokeText(label, sp.x + 7, sp.y + 4 + (i % 2) * 12);
            g.fillStyle = col;
            g.fillText(label, sp.x + 7, sp.y + 4 + (i % 2) * 12);
          }
        }
      });
      g.restore();
    }

    // journeys in progress
    if (layers.routes) {
      for (const cp of characterPositions) {
        if (!cp.journey) continue;
        const col = ix.characters.get(cp.id)?.color ?? '#888';
        g.strokeStyle = col;
        g.setLineDash([6, 4]);
        g.lineWidth = 2;
        const path = densify(cp.journey, world.settings.radiusKm);
        for (const o of offsets) drawPath(path, o);
        g.setLineDash([]);
      }
    }

    // places
    const showPlace = (p: Place) => {
      if (!p.location || p.isPlaceholder || FEATURE_PLACE_KINDS.has(p.kind)) return false;
      if (!existsOn((d) => ix.win(d), p, moment)) return false; // MP-9
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
          g.font = `${SETTLEMENT_SIZE[p.kind] ?? 13}px ${ff}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillStyle = isPick || (selected?.kind === 'place' && selected.id === p.id) ? cssVar('--accent') : fg;
          g.fillText(PLACE_ICON[p.kind], s.x, s.y);
          if (layers.labels && (view.scale > 6 || p.kind === 'city' || p.kind === 'capital')) {
            g.font = `${p.kind === 'city' || p.kind === 'capital' ? 'bold ' : ''}${p.kind === 'capital' ? 14 : 12}px ${ff}`;
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
            g.font = `11px ${ff}`;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(c.icon, s.x, s.y + 0.5);
            if (layers.labels && view.scale > 4) {
              g.font = `11px ${ff}`;
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
    if (measure.length && !opts.exporting) {
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

    // MK-12: parchment grain and darker edges
    if (style.parchment) paintParchment(g, w, h);

    // spot shown from a warning
    if (focus && !opts.exporting) {
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
    g.font = `11px ${ff}`;
    g.textAlign = 'center';
    g.fillText(`${km.toLocaleString()} km`, w - 20 - px / 2, h - 25);
    }

    return ms;
  };
  paintRef.current = paint;
  useEffect(() => {
    const cv = canvasRef.current!;
    const dpr = canvasRatio();
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    markers.current = paint(g, size.w, size.h, view, { pxRatio: dpr });
  }, [view, size, world, ix, characterPositions, layers, measure, selected, pickFor, tick, reader, showTerrain, style, sk, overview, focus, flows, moment, hiddenLayers, currentMap, lix, regionSel, regionLayer, mode, trackData, flashTick, fixDiff, claudeGhost, effects, effectShade, eclipseDraft, eclipseFor]);

  // ---- brush cursor and shape being drawn (separate layer, so hovering doesn't redraw the map) ----
  useEffect(() => {
    const cv = overlayRef.current;
    if (!cv) return;
    const dpr = canvasRatio();
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const { w, h } = size;
    const offsets = wrapOffsets(view, w);
    // vertex handles on the selected feature
    const sf = selected?.kind === 'feature' && !draft.pts.length ? world.mapFeatures.find((f) => f.id === selected.id) : undefined;
    if (sf) {
      const pts = editPts?.id === sf.id ? editPts.pts : sf.points;
      for (const o of offsets) {
        const sp = projectLine(sf.shape === 'area' ? [...pts, pts[0]] : pts, (p, oo) => toScreen(view, w, h, p, oo), o);
        if (editPts?.id === sf.id) {
          g.strokeStyle = '#b5562c'; g.lineWidth = 2; g.setLineDash([5, 4]);
          g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
          g.setLineDash([]);
        }
        g.fillStyle = '#fff'; g.strokeStyle = '#b5562c'; g.lineWidth = 1.5;
        for (const p of sp.slice(0, pts.length)) { g.fillRect(p.x - 3.5, p.y - 3.5, 7, 7); g.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7); }
      }
    }
    // MK-34: what the pointer is over in Move mode
    if (hoverHit && !(selected && selected.id === hoverHit.id)) {
      g.lineJoin = 'round';
      if (hoverHit.kind === 'feature') {
        const sh = shapes.current.find((q) => q.id === hoverHit.id);
        if (sh && sh.pts.length > 1) {
          const path = () => { g.beginPath(); sh.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); if (sh.shape === 'area') g.closePath(); };
          if (sh.shape === 'area') { path(); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill(); }
          path(); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7; g.stroke();
          path(); g.strokeStyle = '#b5562c'; g.lineWidth = 2.5; g.stroke();
        }
      } else {
        g.beginPath(); g.arc(hoverHit.mx, hoverHit.my, hoverHit.r + 4, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5; g.stroke();
        g.strokeStyle = '#b5562c'; g.lineWidth = 2; g.stroke();
      }
    }
    if (mode === 'eclipse' && eclipseDraft.length && hover) {
      for (const o of offsets) {
        const sp = projectLine(densify([eclipseDraft[eclipseDraft.length - 1], { lat: clampLat(hover.lat), lng: wrapLng(hover.lng) }], world.settings.radiusKm), (p, oo) => toScreen(view, w, h, p, oo), o);
        g.setLineDash([6, 4]); g.strokeStyle = '#f0a33a'; g.lineWidth = 2;
        g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); g.setLineDash([]);
      }
    }
    if (mode === 'route' && routeDraft.pts.length) {
      const col = routeJourney ? (ix.characters.get(routeJourney.subject.id)?.color ?? '#b5562c') : '#b5562c';
      const pts = densify(hover ? [...routeDraft.pts, { lat: clampLat(hover.lat), lng: wrapLng(hover.lng) }] : routeDraft.pts, world.settings.radiusKm);
      g.lineJoin = 'round';
      for (const o of offsets) {
        const sp = projectLine(pts, (p, oo) => toScreen(view, w, h, p, oo), o);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6;
        g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
        g.strokeStyle = col; g.lineWidth = 3;
        g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
      }
    }
    if (charDragAt) {
      const c = ix.characters.get(charDragAt.id);
      g.strokeStyle = c?.color ?? '#888'; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(charDragAt.from.x, charDragAt.from.y); g.lineTo(charDragAt.x, charDragAt.y); g.stroke();
      g.setLineDash([]);
      g.fillStyle = c?.color ?? '#888';
      g.beginPath(); g.arc(charDragAt.x, charDragAt.y, 9, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    }
    if (mode === 'layers') {
      const col = selRegion?.color ?? '#b5562c';
      if (hover && regionTools.tool === 'brush' && regionEditable) {
        const kmPerDeg = (Math.PI * world.settings.radiusKm) / 180;
        const ry = (regionTools.brushKm / kmPerDeg) * view.scale;
        const rx = Math.min(w * 2, ry / Math.max(0.02, Math.cos((hover.lat * Math.PI) / 180)));
        const s0 = toScreen(view, w, h, hover);
        g.strokeStyle = '#fff'; g.lineWidth = 3;
        g.beginPath(); g.ellipse(s0.x, s0.y, rx, ry, 0, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = regionTools.op === 'remove' ? '#d62828' : '#222'; g.lineWidth = 1.2;
        g.beginPath(); g.ellipse(s0.x, s0.y, rx, ry, 0, 0, Math.PI * 2); g.stroke();
      }
      if (strokePreview.length) {
        const kmPerDeg = (Math.PI * world.settings.radiusKm) / 180;
        const ry = (regionTools.brushKm / kmPerDeg) * view.scale;
        g.strokeStyle = regionStroke.current?.alt !== (regionTools.op === 'remove') ? 'rgba(214,40,40,0.45)' : `${col}88`;
        g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = ry * 2;
        for (const o of offsets) {
          const sp = projectLine(strokePreview, (p, oo) => toScreen(view, w, h, p, oo), o);
          g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); if (sp.length === 1) g.lineTo(sp[0].x + 0.1, sp[0].y); g.stroke();
        }
      }
      if (regionDraft.length) {
        const pts = hover ? [...regionDraft, { lat: clampLat(hover.lat), lng: wrapLng(hover.lng) }] : regionDraft;
        for (const o of offsets) {
          const sp = projectLine([...pts, pts[0]], (p, oo) => toScreen(view, w, h, p, oo), o);
          g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
          g.fillStyle = regionTools.op === 'remove' ? 'rgba(214,40,40,0.18)' : `${col}44`; g.fill();
          g.strokeStyle = regionTools.op === 'remove' ? '#d62828' : '#b5562c'; g.lineWidth = 2; g.stroke();
          for (const p of sp.slice(0, regionDraft.length)) { g.fillStyle = '#fff'; g.fillRect(p.x - 3.5, p.y - 3.5, 7, 7); g.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7); }
        }
      }
      return;
    }
    if (mode !== 'draw') return;
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
    if (isDrawnFeature(draw.tool) && draft.pts.length) {
      const pts = hover ? [...draft.pts, { lat: clampLat(hover.lat), lng: wrapLng(hover.lng) }] : draft.pts;
      const closed = draw.tool === 'lake' || draw.tool === 'area';
      // MK-22: stretches of a river that climb show red while drawing
      const bad = draw.tool === 'river' ? uphillSegments(world.terrain, pts, world.settings.radiusKm) : new Set<number>();
      for (const o of offsets) {
        const sp = projectLine(closed ? [...pts, pts[0]] : pts, (p, oo) => toScreen(view, w, h, p, oo), o);
        if (closed) {
          g.beginPath(); sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
          g.fillStyle = draw.tool === 'lake' ? 'rgba(120,170,200,0.5)' : 'rgba(181,86,44,0.15)';
          g.fill();
        }
        g.lineWidth = draw.tool === 'river' ? 3 : 2;
        g.lineCap = 'round';
        for (let i = 1; i < sp.length; i++) {
          g.strokeStyle = bad.has(i - 1) ? '#d62828' : draw.tool === 'river' || draw.tool === 'lake' ? RIVER_COLOR : '#b5562c';
          g.setLineDash(hover && i === sp.length - 1 && !closed ? [4, 4] : []);
          g.beginPath(); g.moveTo(sp[i - 1].x, sp[i - 1].y); g.lineTo(sp[i].x, sp[i].y); g.stroke();
        }
        g.setLineDash([]);
        draft.pts.forEach((p, i) => {
          const q = toScreen(view, w, h, p, o);
          g.fillStyle = draft.stops[i] ? '#2a9d8f' : i === 0 && draw.tool === 'river' ? RIVER_COLOR : '#b5562c';
          g.beginPath(); g.arc(q.x, q.y, draft.stops[i] ? 5 : 3, 0, Math.PI * 2); g.fill();
        });
      }
      if (bad.size) {
        g.fillStyle = '#d62828';
        g.font = 'bold 12px system-ui';
        const q = toScreen(view, w, h, pts[pts.length - 1]);
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = 3;
        g.strokeText('flows uphill here', q.x + 10, q.y - 10);
        g.fillText('flows uphill here', q.x + 10, q.y - 10);
      }
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
  }, [hoverHit, hover, draw, poly, draft, mode, view, size, world.settings.radiusKm, world.terrain, world.mapFeatures, selected, editPts, routeDraft, charDragAt, routeJourney, ix, regionDraft, strokePreview, regionTools, selRegion, regionEditable, eclipseDraft]);

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

  // ---- MK-28: zooming and moving around ----
  const nav = useRef({ view, size });
  nav.current = { view, size };
  const glideRaf = useRef(0);
  const stopGlide = () => { if (glideRaf.current) cancelAnimationFrame(glideRaf.current); glideRaf.current = 0; };
  /** Glide to a view (straight there with lighter drawing). */
  const glideTo = (target: ViewState) => {
    stopGlide();
    const to = clampView(target);
    if (lightDrawing()) { setView(to); return; }
    const from = nav.current.view, t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 220);
      setView(t >= 1 ? to : lerpView(from, to, t));
      glideRaf.current = t >= 1 ? 0 : requestAnimationFrame(step);
    };
    glideRaf.current = requestAnimationFrame(step);
  };
  const zoomBy = (factor: number, x?: number, y?: number) => glideTo(zoomAt(nav.current.view, nav.current.size, factor, x, y));
  useEffect(() => stopGlide, []);
  // A native listener, because React's wheel listener can't stop the page from zooming on a touchpad pinch.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopGlide();
      const r = el.getBoundingClientRect();
      const { view: v, size: sz } = nav.current;
      const a = wheelAction(e, sz.h, wheelPref());
      setView('zoom' in a ? zoomAt(v, sz, a.zoom, e.clientX - r.left, e.clientY - r.top) : panBy(v, -a.pan.dx, -a.pan.dy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  // Two fingers on a touchscreen pinch to zoom and move; whatever the first finger started is dropped.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<Pinch | null>(null);
  const pinchLeft = useRef(false); // fingers still down after a pinch do nothing until all are lifted
  const pinchNow = () => {
    const [a, b] = [...touches.current.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  // Shift-drag in Move mode zooms to the box; the middle mouse button moves the map in every mode.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { if (!picked) return; const t = setTimeout(() => setPicked(null), 4000); return () => clearTimeout(t); }, [picked]);
  useEffect(() => { if (draw.tool !== 'eyedropper') toolBeforePick.current = draw.tool; }, [draw.tool]);
  const [zoomBox, setZoomBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const panDrag = useRef(false);
  // MK-34: the place, character or feature under the pointer in Move mode
  const hoverAt = (x: number, y: number) => {
    const m = hit(x, y);
    if (m) {
      const rec = m.kind === 'place' ? ix.places.get(m.id) : ix.characters.get(m.id);
      if (rec) return { kind: m.kind, id: m.id, name: rec.name, note: m.kind === 'place' ? (rec as Place).kind : 'character', x, y, mx: m.x, my: m.y, r: m.r };
    }
    const fid = hitFeature(shapes.current, x, y);
    const f = fid ? world.mapFeatures.find((q) => q.id === fid) : undefined;
    if (f && layerFree(f.layerId)) return { kind: 'feature' as const, id: f.id, name: f.name || (KIND_NAME[f.kind] ?? f.kind), note: (KIND_NAME[f.kind] ?? f.kind).toLowerCase(), x, y, mx: x, my: y, r: 0 };
    return null;
  };
  // MK-35: the eyedropper goes back to the tool used before it
  const toolBeforePick = useRef<DrawTool>('biome');

  // ---- MK-29: room for the map; MK-30: find on the map ----
  const layoutRef = useRef<HTMLDivElement>(null);
  const [panelHidden, setPanelHidden] = useState(() => { try { return localStorage.getItem(PANEL_KEY) === 'hidden'; } catch { return false; } });
  const togglePanel = () => setPanelHidden((h) => { try { localStorage.setItem(PANEL_KEY, h ? 'shown' : 'hidden'); } catch { /* ignore */ } return !h; });
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === layoutRef.current && !!layoutRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void layoutRef.current?.requestFullscreen?.().catch(() => undefined);
  };
  const findEntries = useMemo<FindEntry[]>(() => {
    const out: FindEntry[] = [];
    const on = (r: Parameters<typeof existsOn>[1]) => existsOn((d) => ix.win(d), r, moment);
    for (const f of world.mapFeatures) {
      if (!f.points.length || !on(f)) continue;
      out.push({ kind: 'feature', id: f.id, name: f.name || (KIND_NAME[f.kind] ?? f.kind), note: (KIND_NAME[f.kind] ?? f.kind).toLowerCase(), at: featureAnchor(f) ?? f.points[0], bounds: boundsOf(f.points) });
    }
    for (const p of world.places) {
      if (!p.location || p.isPlaceholder || FEATURE_PLACE_KINDS.has(p.kind) || !on(p)) continue;
      out.push({ kind: 'place', id: p.id, name: p.name, aliases: p.aliases, note: p.kind, at: p.location });
    }
    for (const r of world.regions) {
      const v = lix.versionAt(r, moment);
      const b = v && boundsOfArea(v.area);
      if (!b) continue;
      out.push({ kind: 'region', id: r.id, name: r.name, note: lix.layer(r.layerId)?.name ?? 'realm', at: { lat: (b.north + b.south) / 2, lng: (b.west + b.east) / 2 }, bounds: b });
    }
    for (const cp of characterPositions) {
      const c = ix.characters.get(cp.id);
      if (c) out.push({ kind: 'character', id: c.id, name: c.name, aliases: c.aliases, note: 'character, on this date', at: cp.pos });
    }
    return out;
  }, [world.mapFeatures, world.places, world.regions, characterPositions, ix, lix, moment]);
  /** Show something found (or asked for with "Zoom to") and select it. */
  const showEntry = (e: FindEntry) => {
    glideTo(viewForEntry(e, nav.current.view, nav.current.size));
    if (!e.bounds) setFocus(e.at);
    if (e.kind === 'region') {
      const r = world.regions.find((q) => q.id === e.id);
      if (mode === 'layers' && r) { setRegionLayerPick(r.layerId); setRegionSel(r.id); }
      return;
    }
    setSelected({ kind: e.kind, id: e.id });
  };
  // MK-31: the overview shows the main map, or the whole world when there is none
  const insetExtent = useMemo(() => {
    const m = world.settings.mainMap;
    if (!m) return { north: 85, south: -85, west: -180, east: 180 };
    return { ...m, east: m.east < m.west ? m.east + 360 : m.east };
  }, [world.settings.mainMap]);
  const insetCount = useRef(0);
  const insetVersion = useMemo(() => String(++insetCount.current), [world.terrain, world.regions, world.mapImages, world.regionLayers, style, relief, showTerrain]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomToRecord = (kind: FindEntry['kind'], id: Id) => {
    const e = findEntries.find((x) => x.kind === kind && x.id === id);
    if (e) showEntry(e);
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
    const keys = st.ed.changedKeys;
    const next = st.ed.commit();
    // MK-25: automatic rivers on the changed land find their way again, in the same undo step
    store.update((w) => refreshAutoRivers({ ...w, terrain: next }, keys));
    setWorking(null);
  };
  const finishPolygon = (pts = poly) => {
    if (pts.length < 3) return;
    const ed = new TerrainEditor(world.terrain);
    fillPolygon(ed, pts, draw.polyMode, draw.biome);
    const keys = ed.changedKeys;
    const next = ed.commit();
    store.update((w) => refreshAutoRivers({ ...w, terrain: next }, keys));
    setPoly([]);
  };

  // ---- features (MP-6..MP-9, MK-8..MK-10, MK-19) ----
  const SNAP_PX = 14;
  /** Snap a click to a nearby settlement or place (roads, MK-10). */
  const snapToPlace = (x: number, y: number): { ll: LatLng; placeId: Id } | null => {
    let best: { ll: LatLng; placeId: Id } | null = null, bestD = SNAP_PX ** 2;
    for (const m of markers.current) {
      if (m.kind !== 'place') continue;
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d < bestD) { const loc = ix.locationOf(m.id); if (loc) { bestD = d; best = { ll: loc, placeId: m.id }; } }
    }
    return best;
  };
  const pxPerKm = () => view.scale / ((Math.PI * world.settings.radiusKm) / 180);
  /** The nearest other river within snapping distance of a point. */
  const riverNear = (p: LatLng, exclude?: Id, km = SNAP_PX / pxPerKm()) => {
    let best: { f: MapFeature; point: LatLng; km: number } | null = null;
    for (const f of world.mapFeatures) {
      if (f.kind !== 'river' || f.id === exclude || f.points.length < 2) continue;
      const n = nearestOnPolyline(p, f.points, world.settings.radiusKm);
      if (n && n.km <= km && (!best || n.km < best.km)) best = { f, point: n.point, km: n.km };
    }
    return best;
  };
  const defaultName = (kind: string) => `${KIND_NAME[kind] ?? 'Feature'} ${world.mapFeatures.filter((f) => f.kind === kind).length + 1}`;
  /** Add a feature and the place that stands for it (MP-8) as one undo step. */
  const addFeature = (f: Omit<MapFeature, keyof ReturnType<typeof recordBase> | 'placeId' | 'name' | 'notes'> & { name?: string }, terrain?: Terrain) => {
    const base = recordBase();
    const name = f.name ?? defaultName(f.kind);
    const placeKind = f.kind === 'river' ? 'river' : f.kind === 'lake' || f.kind === 'sea' ? 'lake' : f.shape === 'line' ? 'road' : 'area';
    const feature: MapFeature = { ...base, notes: '', ...f, name, placeId: undefined, layerId: drawLayer };
    const place: Place = { ...recordBase(), name, aliases: [], kind: placeKind, location: featureAnchor(feature), notes: '', isPlaceholder: false };
    feature.placeId = place.id;
    store.update((w) => {
      let features = [...w.mapFeatures, feature];
      // MK-9: a river that starts in a lake without an outlet becomes its outlet.
      if (feature.kind === 'river') {
        const lake = features.find((l) => l.kind === 'lake' && !l.outletId && !l.salt && insideArea(feature.points[0], l.points));
        if (lake) features = features.map((l) => (l.id === lake.id ? { ...l, outletId: feature.id } : l));
      }
      return { ...w, mapFeatures: features, places: [...w.places, place], terrain: terrain ?? w.terrain };
    });
    setSelected({ kind: 'feature', id: feature.id });
  };
  const finishDraft = (pts = draft.pts, stops = draft.stops) => {
    const tool = draw.tool;
    const min = tool === 'river' || tool === 'line' ? 2 : 3;
    if (pts.length < min) return;
    if (tool === 'river') {
      // MK-8: ending on another river makes this one its tributary.
      const end = riverNear(pts[pts.length - 1]);
      const points = end ? [...pts.slice(0, -1), end.point] : pts;
      addFeature({ shape: 'line', kind: 'river', points, joinsId: end?.f.id });
    } else if (tool === 'line') {
      addFeature({ shape: 'line', kind: draw.lineKind, points: pts, stops });
    } else if (tool === 'lake') {
      addFeature({ shape: 'area', kind: 'lake', points: pts });
    } else if (tool === 'area') {
      addFeature({ shape: 'area', kind: draw.areaKind, points: pts });
    }
    setDraft({ pts: [], stops: [] });
  };
  const addDraftPoint = (x: number, y: number) => {
    const raw = llAt(x, y);
    const snap = draw.tool === 'line' ? snapToPlace(x, y) : null;
    setDraft((d) => ({ pts: [...d.pts, snap?.ll ?? raw], stops: [...d.stops, snap?.placeId ?? null] }));
  };
  /** MK-19: trace a river downhill from a clicked source. */
  const autoRiver = (src: LatLng) => {
    const t = traceRiver(world, src);
    if (t.points.length < 2) {
      void ask.alert(reader.elevation(src) <= 0 ? 'That spot is under water. Click on land to start a river.' : 'There is no way downhill from here. Raise the ground around the source or pick another spot.');
      return;
    }
    // The river cuts its valley through low rims it spills over, in the same undo step.
    addFeature({ shape: 'line', kind: 'river', points: t.points, auto: true, joinsId: t.joinsId, endsInBasin: t.endsInBasin || undefined }, t.terrain);
  };
  const addSettlement = async (ll: LatLng) => {
    const name = await ask.prompt(`Name of the new ${draw.settlement}?`);
    if (!name) return;
    const p: Place = { ...recordBase(), name, aliases: [], kind: draw.settlement, location: ll, notes: '', isPlaceholder: false };
    store.upsert('places', p);
    setSelected({ kind: 'place', id: p.id });
  };
  useEffect(() => { if (!isDrawnFeature(draw.tool)) setDraft({ pts: [], stops: [] }); }, [draw.tool]);

  // ---- region layers: shapes and the brush (LY-5, LY-6) ----
  const commitRegion = (area: GeoMultiPolygon, swap = false) => {
    if (!selRegion || !regionEditable || !area.length) return;
    const op = swap ? (regionTools.op === 'add' ? 'remove' : 'add') : regionTools.op;
    const dated = regionTools.span === 'from' && regionTools.from;
    const before = store.world.regions.find((r) => r.id === selRegion.id);
    store.update((w) => editRegionArea(w, {
      regionId: selRegion.id, area, op,
      from: dated ? regionTools.from : undefined, until: dated ? regionTools.until : undefined,
      neighbours: regionTools.neighbours, note: dated && regionTools.note.trim() ? regionTools.note.trim() : undefined, newId,
    }));
    const after = store.world.regions.find((r) => r.id === selRegion.id);
    if (op === 'add' && regionTools.neighbours === 'stop' && before && after && JSON.stringify(before.versions.map((v) => v.area)) === JSON.stringify(after.versions.map((v) => v.area))) {
      const owners = areaOwners(lix, selRegion.layerId, area, moment).filter((r) => r.id !== selRegion.id).map((r) => r.name);
      void ask.alert(`That land already belongs to ${owners?.length ? owners.join(' and ') : 'a neighbour'}, so nothing was added. To conquer it, choose "Take the land from them".`);
    }
  };
  const finishRegionShape = (pts = regionDraft) => {
    if (pts.length >= 3) commitRegion(polygonFromPoints(pts));
    setRegionDraft([]);
  };
  /** LY-5: snap a corner to a nearby border, river, road or coastline. */
  const snapRegion = (x: number, y: number): LatLng => {
    const raw = llAt(x, y);
    if (!regionTools.snap) return raw;
    const proj = (p: LatLng, o: number) => toScreen(view, size.w, size.h, p, o);
    const lines: LatLng[][] = [];
    for (const r of world.regions) {
      if (!lix.layer(r.layerId)?.visible) continue;
      const v = lix.versionAt(r, moment);
      for (const poly of v?.area ?? []) for (const ring of poly) lines.push(ring.map(([lng, lat]) => ({ lat, lng })));
    }
    for (const f of world.mapFeatures) {
      if (!layerOn(f.layerId) || f.points.length < 2) continue;
      lines.push(f.shape === 'area' ? [...f.points, f.points[0]] : f.points);
    }
    let vBest: LatLng | null = null, vD = 10 ** 2, eBest: LatLng | null = null, eD = 12 ** 2;
    const offs = [...new Set([-360, ...wrapOffsets(view, size.w), 360])];
    for (const line of lines) {
      for (const o of offs) {
        let prev: { x: number; y: number } | null = null;
        line.forEach((p, i) => {
          const sp = proj(p, o);
          const dv = (sp.x - x) ** 2 + (sp.y - y) ** 2;
          if (dv < vD) { vD = dv; vBest = { lat: p.lat, lng: wrapLng(p.lng) }; }
          if (prev && i > 0) {
            const dx = sp.x - prev.x, dy = sp.y - prev.y, len = dx * dx + dy * dy;
            const t = len ? Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / len)) : 0;
            const de = (prev.x + t * dx - x) ** 2 + (prev.y + t * dy - y) ** 2;
            if (de < eD) { const a = line[i - 1]; eD = de; eBest = { lat: a.lat + (p.lat - a.lat) * t, lng: wrapLng(a.lng + (p.lng - a.lng) * t) }; }
          }
          prev = sp;
        });
      }
    }
    if (vBest) return vBest;
    if (eBest) return eBest;
    // the coastline: the nearest spot within 12 px where land meets sea
    if (showTerrain) {
      const land = reader.isLand(raw);
      let best: LatLng | null = null, bd = Infinity;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        for (let r = 1.5; r <= 12; r += 1.5) {
          const q = llAt(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
          if (reader.isLand(q) !== land) { if (r < bd) { bd = r; best = q; } break; }
        }
      }
      if (best) return best;
    }
    return raw;
  };

  // Eclipse path keys: Enter finishes, Esc cancels, Backspace takes back the last click.
  useEffect(() => {
    if (mode !== 'eclipse') return;
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Enter') { e.preventDefault(); finishEclipse(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEclipse(); }
      else if (e.key === 'Backspace') { e.preventDefault(); setEclipseDraft((d) => d.slice(0, -1)); }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  });

  // Route drawing keys: Enter finishes, Esc cancels, Backspace takes back the last click.
  useEffect(() => {
    if (mode !== 'route') return;
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Enter') { e.preventDefault(); finishRoute(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRoute(); }
      else if (e.key === 'Backspace') { e.preventDefault(); undoRoutePoint(); }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  });

  // Region keys: V/P/B tools, Enter finishes a shape, Esc cancels, Backspace removes a corner, [ ] brush size.
  useEffect(() => {
    if (mode !== 'layers') return;
    const down = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { space.current = true; e.preventDefault(); return; }
      if (e.key === 'Enter') { e.preventDefault(); finishRegionShape(); return; }
      if (e.key === 'Escape') { setRegionDraft([]); return; }
      if (e.key === 'Backspace' && regionDraft.length) { e.preventDefault(); setRegionDraft((d) => d.slice(0, -1)); return; }
      if (e.key === '[' || e.key === ']') { setRegionTools((t) => ({ ...t, brushKm: Math.max(2, Math.min(2000, Math.round(t.brushKm * (e.key === ']' ? 1.25 : 0.8)))) })); return; }
      const tool = REGION_TOOL_KEYS[e.key.toUpperCase()];
      if (tool) { setRegionTools((t) => ({ ...t, tool })); setRegionDraft([]); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') space.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

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
      if (e.key === 'Enter') { if (isDrawnFeature(draw.tool)) finishDraft(); else finishPolygon(); return; }
      if (e.key === 'Escape') { setPoly([]); setDraft({ pts: [], stops: [] }); return; }
      if (e.key === 'Backspace' && draft.pts.length) { setDraft((d) => ({ pts: d.pts.slice(0, -1), stops: d.stops.slice(0, -1) })); e.preventDefault(); return; }
      if (e.key === 'Backspace' && poly.length) { setPoly((p) => p.slice(0, -1)); e.preventDefault(); return; }
      const t = TOOLS.find((x) => x.key === e.key.toUpperCase());
      if (t) { setDraw((d) => ({ ...d, tool: t.tool })); e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') space.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  // MK-28: + and − zoom, arrow keys move the map (Shift: further), in every mode.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-backdrop')) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(2); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(0.5); return; }
      const v = arrowPan(nav.current.view, nav.current.size, e.key, e.shiftKey);
      if (v) { e.preventDefault(); glideTo(v); }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  });

  // ---- journey routes (WH-6) and dragging characters (EU-2) ----
  const routeDay = routeJourney ? ix.win(routeJourney.departure).earliest : moment;
  const routeLeg = (a: LatLng, b: LatLng) =>
    routeFollow && routeJourney
      ? routeAlongFeatures(world, a, b, networkFor(routeJourney.modeId), (f) => existsOn((dd) => ix.win(dd), f, routeDay)).points.slice(1)
      : [b];
  const addRoutePoint = (p: LatLng) =>
    setRouteDraft((r) => ({ pts: [...r.pts, ...routeLeg(r.pts[r.pts.length - 1], p)], marks: [...r.marks, r.pts.length] }));
  const undoRoutePoint = () => setRouteDraft((r) => (r.marks.length ? { pts: r.pts.slice(0, r.marks[r.marks.length - 1]), marks: r.marks.slice(0, -1) } : r));
  const finishRoute = () => {
    const j = routeJourney;
    if (!j) return;
    const end = ix.locationOf(j.destinationId);
    let pts = routeDraft.pts;
    if (end && greatCircleKm(pts[pts.length - 1], end, world.settings.radiusKm) > 0.5) pts = [...pts, ...routeLeg(pts[pts.length - 1], end)];
    if (pts.length >= 2) store.upsert('journeys', { ...j, route: pts });
    startRoute(undefined);
    setMode('browse');
  };
  const cancelRoute = () => { startRoute(undefined); setMode('browse'); };
  const dropCharacter = async (characterId: Id, x: number, y: number) => {
    const c = ix.characters.get(characterId);
    const where = whereIs(ix, characterId, moment);
    const originId = where.kind === 'stay' ? where.placeId : where.kind === 'journey' ? where.toId : undefined;
    let destinationId = snapToPlace(x, y)?.placeId;
    if (!destinationId) {
      const name = await ask.prompt(`There is no place there. Name a new place for ${c?.name ?? 'them'} to travel to?`);
      if (!name) return;
      const raw = toLatLng(view, size.w, size.h, x, y);
      const p: Place = { ...recordBase(), name, aliases: [], kind: 'village', location: { lat: clampLat(raw.lat), lng: wrapLng(raw.lng) }, notes: '', isPlaceholder: false };
      store.upsert('places', p);
      destinationId = p.id;
    }
    if (destinationId === originId) return;
    edit({ kind: 'journey', preset: { subject: { kind: 'character', id: characterId }, originId: originId ?? '', destinationId, departure: fromDay(Math.floor(moment)) } });
  };

  /** The vertex of the selected feature under a screen point. */
  const handleAt = (x: number, y: number): { f: MapFeature; idx: number } | null => {
    if (selected?.kind !== 'feature' || draft.pts.length) return null;
    const f = world.mapFeatures.find((q) => q.id === selected.id);
    if (!f || !layerFree(f.layerId)) return null;
    for (const o of wrapOffsets(view, size.w)) {
      const sp = projectLine(f.points, (p, oo) => toScreen(view, size.w, size.h, p, oo), o);
      for (let i = sp.length - 1; i >= 0; i--) if (Math.abs(sp[i].x - x) <= 6 && Math.abs(sp[i].y - y) <= 6) return { f, idx: i };
    }
    return null;
  };
  const saveFeaturePoints = (f: MapFeature, points: LatLng[], stops?: (Id | null)[]) => {
    const moved = { ...f, points, stops: f.stops ? stops : undefined, handEdited: f.auto ? true : undefined };
    const at = featureAnchor(moved);
    store.update((w) => ({
      ...w,
      mapFeatures: w.mapFeatures.map((q) => (q.id === f.id ? moved : q)),
      places: f.placeId && at ? w.places.map((p) => (p.id === f.placeId ? { ...p, location: at } : p)) : w.places,
    }));
  };
  const addPlaceAt = async (ll: LatLng) => {
    const name = await ask.prompt('Name of the new place?');
    if (!name) return;
    const p: Place = { ...recordBase(), name, aliases: [], kind: 'city', location: ll, notes: '', isPlaceholder: false };
    store.upsert('places', p);
    setSelected({ kind: 'place', id: p.id });
  };
  // ---- MK-33: the menu for a spot (right-click, or press and hold) ----
  const [menu, setMenu] = useState<{ x: number; y: number; ll: LatLng; marker: Marker | null; featureId: Id | null } | null>(null);
  const rightBtn = useRef(false);
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const cancelHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };
  const openMenu = (x: number, y: number) => {
    const marker = hit(x, y);
    const fid = marker ? null : hitFeature(shapes.current, x, y);
    const featureId = fid && layerFree(world.mapFeatures.find((q) => q.id === fid)?.layerId) ? fid : null;
    setHoverHit(null);
    setMenu({ x, y, ll: llAt(x, y), marker, featureId });
  };
  /** Drop whatever a pointer had started (a second finger turned it into a pinch). Nothing is saved. */
  const abandonGesture = () => {
    const st = stroke.current;
    if (st) { stroke.current = null; if (st.raf) cancelAnimationFrame(st.raf); setWorking(null); }
    regionStroke.current = null; setStrokePreview([]);
    vdrag.current = null; setEditPts(null);
    drag.current = null; freehand.current = null;
    charDrag.current = null; setCharDragAt(null);
    panDrag.current = false; setZoomBox(null);
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const { x, y } = local(e);
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x, y });
      if (touches.current.size === 2 && !pinchLeft.current) { cancelHold(); abandonGesture(); stopGlide(); pinch.current = { view, ...pinchNow() }; return; }
      if (touches.current.size > 1 || pinchLeft.current) return;
    }
    stopGlide();
    if (menu) setMenu(null);
    if (e.button === 1 || e.button === 2) { panDrag.current = true; rightBtn.current = e.button === 2; drag.current = { x, y, moved: false, v: view }; return; }
    if (e.pointerType === 'touch') {
      cancelHold();
      hold.current = { x, y, timer: window.setTimeout(() => { hold.current = null; abandonGesture(); pinchLeft.current = true; openMenu(x, y); }, 550) };
    }
    const hv = e.button === 0 && !space.current ? handleAt(x, y) : null;
    if (hv) {
      const { f, idx } = hv;
      if (e.shiftKey) { // Shift-click a handle removes that point
        if (f.points.length > (f.shape === 'area' ? 3 : 2)) saveFeaturePoints(f, f.points.filter((_, i) => i !== idx), f.stops?.filter((_, i) => i !== idx));
        return;
      }
      vdrag.current = { id: f.id, idx };
      setEditPts({ id: f.id, pts: f.points, stops: f.stops });
      return;
    }
    if (mode === 'draw' && e.button === 0 && !space.current && isBrush(draw.tool)) {
      startStroke(e, llAt(x, y));
      return;
    }
    if (mode === 'layers' && e.button === 0 && !space.current && regionTools.tool === 'brush' && regionEditable) {
      const ll = llAt(x, y);
      regionStroke.current = { pts: [ll], alt: e.altKey };
      setStrokePreview([ll]);
      return;
    }
    if (mode === 'browse' && e.button === 0 && e.shiftKey && !space.current) { setZoomBox({ x0: x, y0: y, x1: x, y1: y }); return; }
    if (mode === 'browse' && e.button === 0 && !space.current) {
      const m = hit(x, y);
      if (m?.kind === 'character') { charDrag.current = { id: m.id, x: m.x, y: m.y }; drag.current = { x, y, moved: false, v: view }; return; }
    }
    if (mode === 'draw' && e.button === 0 && !space.current && (draw.tool === 'river' || draw.tool === 'line' || draw.tool === 'lake' || draw.tool === 'area')) {
      // Drag to draw freehand; a plain click adds one point (handled on release).
      freehand.current = { lastX: x, lastY: y, started: false };
    }
    drag.current = { x, y, moved: false, v: view };
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x, y });
      if (hold.current && Math.hypot(x - hold.current.x, y - hold.current.y) > 8) cancelHold();
      if (pinch.current && touches.current.size >= 2) { const n = pinchNow(); setView(pinchView(pinch.current, size, n.mid, n.dist)); return; }
      if (pinchLeft.current) return;
    }
    setHover(toLatLng(view, size.w, size.h, x, y));
    if (mode === 'browse' && !drag.current && e.pointerType !== 'touch') {
      const hh = hoverAt(x, y);
      setHoverHit((old) => (old?.id === hh?.id && (!hh || hh.kind !== 'feature') ? old : hh ? hh : null));
    } else if (hoverHit) setHoverHit(null);
    if (zoomBox) { setZoomBox({ ...zoomBox, x1: x, y1: y }); return; }
    if (stroke.current) { continueStroke(e, llAt(x, y)); return; }
    const rs = regionStroke.current;
    if (rs) {
      const ll = llAt(x, y);
      if (greatCircleKm(rs.pts[rs.pts.length - 1], ll, world.settings.radiusKm) > regionTools.brushKm * 0.3) { rs.pts.push(ll); setStrokePreview([...rs.pts]); }
      return;
    }
    const vd = vdrag.current;
    if (vd) {
      const f = world.mapFeatures.find((q) => q.id === vd.id);
      const snap = f && f.shape === 'line' && f.kind !== 'river' ? snapToPlace(x, y) : null;
      setEditPts((ep) => {
        if (!ep) return ep;
        const pts = ep.pts.slice(); pts[vd.idx] = snap?.ll ?? llAt(x, y);
        const stops = ep.stops?.slice(); if (stops) stops[vd.idx] = snap?.placeId ?? null;
        return { ...ep, pts, stops };
      });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (Math.abs(x - d.x) + Math.abs(y - d.y) > 3) d.moved = true;
    const cd = charDrag.current;
    if (cd) { if (d.moved) setCharDragAt({ id: cd.id, from: { x: cd.x, y: cd.y }, x, y }); return; }
    const fh = freehand.current;
    if (fh && d.moved) {
      if (Math.hypot(x - fh.lastX, y - fh.lastY) >= 8) {
        if (!fh.started) addDraftPoint(fh.lastX, fh.lastY); // the point where the drag began
        addDraftPoint(x, y);
        fh.lastX = x; fh.lastY = y; fh.started = true;
      }
      return;
    }
    if (d.moved) setView(panBy(d.v, x - d.x, y - d.y));
  };
  /** A finger lifted: ends a pinch, and true while the rest of that gesture should be ignored. */
  const endTouch = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return false;
    cancelHold();
    touches.current.delete(e.pointerId);
    if (!pinch.current && !pinchLeft.current) return false;
    pinch.current = null;
    pinchLeft.current = touches.current.size > 0;
    return true;
  };
  const onUp = async (e: React.PointerEvent) => {
    if (endTouch(e)) return;
    if (zoomBox) {
      const v = viewForBox(view, size, zoomBox.x0, zoomBox.y0, zoomBox.x1, zoomBox.y1);
      setZoomBox(null);
      if (v) glideTo(v);
      return;
    }
    if (panDrag.current) {
      const click = rightBtn.current && !drag.current?.moved;
      panDrag.current = false; rightBtn.current = false; drag.current = null;
      if (click) { const p = local(e); openMenu(p.x, p.y); }
      return;
    }
    if (stroke.current) { endStroke(); return; }
    const rs = regionStroke.current;
    if (rs) {
      regionStroke.current = null;
      setStrokePreview([]);
      commitRegion(strokeArea(rs.pts, regionTools.brushKm, world.settings.radiusKm), rs.alt);
      return;
    }
    if (vdrag.current) {
      const f = world.mapFeatures.find((q) => q.id === vdrag.current!.id);
      vdrag.current = null;
      if (f && editPts && editPts.id === f.id && editPts.pts.some((p, i) => p !== f.points[i])) saveFeaturePoints(f, editPts.pts, editPts.stops);
      setEditPts(null);
      return;
    }
    const d = drag.current;
    drag.current = null;
    const wasFreehand = freehand.current;
    freehand.current = null;
    const cd = charDrag.current;
    charDrag.current = null;
    if (cd && d?.moved) {
      setCharDragAt(null);
      const { x, y } = local(e);
      void dropCharacter(cd.id, x, y);
      return;
    }
    if (!d || d.moved) return;
    const { x, y } = local(e);
    if (mode === 'draw' && wasFreehand) { addDraftPoint(x, y); return; }
    const raw = toLatLng(view, size.w, size.h, x, y);
    const ll = { lat: clampLat(raw.lat), lng: wrapLng(raw.lng) };
    setFocus(null);
    if (mode === 'draw') {
      if (draw.tool === 'eyedropper') {
        const height = Math.round(reader.elevation(ll) / 10) * 10;
        const biome = reader.isLand(ll) ? reader.biome(ll) : 0;
        setDraw((d) => ({ ...d, tool: toolBeforePick.current, height, biome: biome || d.biome }));
        const bname = world.settings.biomes.find((b) => b.id === biome)?.name;
        setPicked(`${bname ? `${bname}, ` : ''}${height.toLocaleString()} m`);
        return;
      }
      if (draw.tool === 'polygon') setPoly((p) => [...p, ll]);
      if (draw.tool === 'auto-river') autoRiver(ll);
      if (draw.tool === 'settlement') void addSettlement(ll);
      if (draw.tool === 'stamp') {
        if (e.shiftKey) {
          let best: MapSymbol | undefined, bestD = 16 ** 2;
          for (const sym of world.mapSymbols) {
            if (!layerFree(sym.layerId)) continue;
            for (const o of wrapOffsets(view, size.w)) {
              const sp = toScreen(view, size.w, size.h, sym.location, o);
              const dd = (sp.x - x) ** 2 + (sp.y - 6 - y) ** 2;
              if (dd < bestD) { bestD = dd; best = sym; }
            }
          }
          if (best) store.removeMany([{ c: 'mapSymbols', id: best.id }]);
        } else {
          store.upsert('mapSymbols', { ...recordBase(), kind: draw.symbol, location: ll, size: 1, layerId: drawLayer });
        }
      }
      return;
    }
    if (mode === 'layers') {
      if (regionTools.tool === 'shape' && regionEditable) { setRegionDraft((d) => [...d, snapRegion(x, y)]); return; }
      // LY-9: pick the region here, on the layer being edited first, and say what covers this spot
      const onActive = regionLayer ? lix.regionsAt(ll, moment, regionLayer.id)[0]?.hits[0] : undefined;
      const hitR = onActive ?? lix.regionsAt(ll, moment).filter((h) => h.layer.visible).pop()?.hits[0];
      if (hitR) { setRegionSel(hitR.region.id); setRegionLayerPick(hitR.region.layerId); }
      setWhatsHere(ll);
      return;
    }
    if (mode === 'pick' && pickFor) {
      const p = world.places.find((q) => q.id === pickFor);
      if (p) store.upsert('places', { ...p, location: ll });
      startPick(undefined);
      setMode('browse');
      return;
    }
    if (mode === 'add-place') { await addPlaceAt(ll); return; }
    if (mode === 'measure') {
      if (measureFollow && measure.length) {
        const leg = routeAlongFeatures(world, measure[measure.length - 1], ll, 'land', (f) => existsOn((dd) => ix.win(dd), f, moment));
        setMeasure((m) => [...m, ...leg.points.slice(1)]);
      } else setMeasure((m) => [...m, ll]);
      return;
    }
    if (mode === 'route' && routeJourney) {
      addRoutePoint(snapToPlace(x, y)?.ll ?? ll);
      return;
    }
    if (mode === 'eclipse' && eclipseEvent) {
      setEclipseDraft((d) => [...d, snapToPlace(x, y)?.ll ?? ll]);
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
    const hf = m ? null : hitFeature(shapes.current, x, y);
    const f = hf && layerFree(world.mapFeatures.find((q) => q.id === hf)?.layerId) ? hf : null;
    setSelected(m ? { kind: m.kind, id: m.id } : f ? { kind: 'feature', id: f } : null);
    setWhatsHere(!m && !f && layers.regions && world.regions.length ? ll : null);
  };
  const onDouble = (e: React.MouseEvent) => {
    if (mode === 'eclipse') {
      // the double-click's second click added a duplicate point; leave it out
      const pts = eclipseDraft.slice(0, -1);
      if (eclipseEvent) store.upsert('events', { ...eclipseEvent, shadow: { ...(eclipseEvent.shadow ?? newShadow()), track: pts } });
      startEclipse(undefined); setMode('browse');
      return;
    }
    if (mode === 'layers') {
      // the double-click's second click added a duplicate corner; leave it out
      if (regionTools.tool === 'shape') finishRegionShape(regionDraft.slice(0, -1));
      return;
    }
    if (mode === 'draw') {
      if (draw.tool === 'polygon') {
        // the double-click's second click added a duplicate corner; leave it out
        finishPolygon(poly.slice(0, -1));
      }
      if (isDrawnFeature(draw.tool)) finishDraft(draft.pts.slice(0, -1), draft.stops.slice(0, -1));
      return;
    }
    const { x, y } = local(e);
    const m = hit(x, y);
    const linked = m?.kind === 'place' ? world.detailMaps.find((dm) => dm.placeId === m.id) : undefined;
    if (linked) openMap(linked);
    else if (m?.kind === 'place') go('places', m.id);
    else if (m?.kind === 'character') go('characters', m.id);
    else zoomBy(e.shiftKey ? 0.5 : 2, x, y); // MK-28: double-click empty map zooms in, Shift zooms out
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

  const selFeature = selected?.kind === 'feature' ? world.mapFeatures.find((f) => f.id === selected.id) : undefined;

  // ---- MK-14: export the current view as a sharp PNG or as SVG ----
  const fileBase = (world.settings.name.replace(/[^\w\- ]+/g, '') || 'map') + (currentMap ? `-${world.detailMaps.find((m) => m.id === currentMap)?.name.replace(/[^\w\- ]+/g, '') ?? ''}` : '');
  const renderExport = async (k: number, base = false): Promise<HTMLCanvasElement> => {
    const c = document.createElement('canvas');
    c.width = Math.round(size.w * k); c.height = Math.round(size.h * k);
    const g = c.getContext('2d')!;
    g.setTransform(k, 0, 0, k, 0, 0);
    paintRef.current!(g, size.w, size.h, view, { pxRatio: k, exporting: true, base });
    return c;
  };
  const exportPng = async (k: number) => {
    const c = await renderExport(k);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (blob) await platform.saveBinaryFile(`${fileBase}.png`, new Uint8Array(await blob.arrayBuffer()));
  };
  // PL-5: the view as a one-page PDF, with the world's name and the date it shows.
  const exportPdf = async () => {
    const jpeg = await canvasBytes(await renderExport(3), 'image/jpeg');
    const pdf = imagePdf(jpeg, { title: world.settings.name + (currentMap ? ` · ${world.detailMaps.find((m) => m.id === currentMap)?.name ?? ''}` : ''), caption: `As of ${fmtDay(moment)}`, page: world.settings.writing?.spelling === 'en-US' ? 'letter' : 'a4' });
    await platform.saveBinaryFile(`${fileBase}.pdf`, pdf);
  };
  const exportSvg = async () => {
    const base = (await renderExport(2, true)).toDataURL('image/png');
    const offsets = wrapOffsets(view, size.w);
    const svg = mapToSvg({
      w: size.w, h: size.h, base, project: (p, o) => toScreen(view, size.w, size.h, p, o), offsets, scale: view.scale,
      features: layers.features ? world.mapFeatures.filter((f) => layerOn(f.layerId) && existsOn((d) => ix.win(d), f, moment)) : [],
      flows, lix, day: moment, labels: layers.labels,
      places: layers.places ? world.places.filter((p) => p.location && !p.isPlaceholder && !FEATURE_PLACE_KINDS.has(p.kind) && existsOn((d) => ix.win(d), p, moment) && (!p.parentId || view.scale > 60))
        .map((p) => ({ p, icon: PLACE_ICON[p.kind], size: SETTLEMENT_SIZE[p.kind] ?? 13 })) : [],
      serif: 'Georgia, "Times New Roman", serif', sans: world.settings.mapStyle === 'parchment' ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif',
      kmPerPx: (Math.PI * world.settings.radiusKm) / 180 / view.scale * Math.cos((view.centerLat * Math.PI) / 180),
      title: world.settings.name,
    });
    await platform.saveTextFile(`${fileBase}.svg`, svg, 'image/svg+xml');
  };

  // ---- MK-20, MK-21 ----
  const suggest = (onlyUnpainted: boolean) => {
    const s = suggestBiomes(world.terrain, world.settings.biomes, { tiltDeg: world.settings.axialTiltDeg, radiusKm: world.settings.radiusKm, winds: world.settings.winds?.from ?? 'earth', onlyUnpainted });
    if (!s.cells) { void ask.alert(onlyUnpainted ? 'Every piece of land already has a terrain type. Try "Suggest for all land" to see a full proposal.' : 'The suggestion matches the map as it is.'); return; }
    setSuggestion({ ...s, onlyUnpainted });
  };
  useEffect(() => setSuggestion(null), [world.terrain]);
  const coastDetail = hasCoastDetail(world.terrain);
  const lineDetail = world.mapFeatures.some((f) => f.roughPoints);
  const toggleDetail = () => {
    if (coastDetail || lineDetail) store.update((w) => {
      const terrain = removeCoastDetail(w.terrain);
      return refreshAutoRivers({ ...removeDetailFromFeatures(w), terrain }, Object.keys(terrain.tiles).filter((k) => terrain.tiles[k] !== w.terrain.tiles[k]));
    });
    else store.update((w) => {
      const terrain = addCoastDetail(w.terrain, 7);
      // automatic rivers follow the new coastline (MK-25)
      return refreshAutoRivers({ ...addDetailToFeatures(w), terrain }, Object.keys(terrain.tiles).filter((k) => terrain.tiles[k] !== w.terrain.tiles[k]));
    });
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
    const ls = e > 0 ? localSeasons(p.lat, e, world.settings.axialTiltDeg) : undefined;
    return ` · ${e.toLocaleString()} m · ${band}, ~${Math.round(meanTemperatureC(p.lat, e))}°C${b ? ` · ${b.name}` : ''}${ls ? ` · winter ~${Math.round(ls.winterDays / 30.4)} mo` : ''}`;
  }, [hover, reader, showTerrain, world.settings.biomes, world.settings.axialTiltDeg]);

  const hoverRegions = useMemo(() => (hover && layers.regions && world.regions.length ? hereLine(lix, { lat: clampLat(hover.lat), lng: wrapLng(hover.lng) }, moment) : ''), [hover, lix, moment, layers.regions, world.regions.length]);

  const mainMap = world.settings.mainMap;
  const frame = (b: { north: number; south: number; west: number; east: number }) => {
    const east = b.east < b.west ? b.east + 360 : b.east;
    glideTo(({ centerLat: (b.north + b.south) / 2, centerLng: (b.west + east) / 2, scale: Math.min(size.w / (east - b.west), size.h / (b.north - b.south)) * 0.95 }));
  };
  const openMap = (m: DetailMap | undefined) => {
    setCurrentMap(m?.id);
    if (m) frame(m);
    else if (mainMap) frame(mainMap);
  };
  const shownMap = world.detailMaps.find((m) => m.id === currentMap);
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
    <div className={`map-layout${panelHidden ? ' panel-hidden' : ''}`} ref={layoutRef}>
      <div className="map-canvas" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h, cursor: mode === 'browse' && hoverHit ? 'pointer' : mode === 'draw' && draw.tool === 'eyedropper' ? 'copy' : mode === 'browse' || (mode === 'draw' && draw.tool === 'pan') || (mode === 'layers' && regionTools.tool === 'select') ? 'grab' : (mode === 'draw' && isBrush(draw.tool)) || (mode === 'layers' && regionTools.tool === 'brush' && regionEditable) ? 'none' : 'crosshair' }}
          onMouseDown={(e) => e.button === 1 && e.preventDefault() /* no autoscroll: the middle button moves the map */}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={(e) => { if (!endTouch(e)) endStroke(); drag.current = null; panDrag.current = false; setZoomBox(null); }}
          onPointerLeave={() => { setHover(null); setHoverHit(null); }}
          onDoubleClick={onDouble}
          onContextMenu={(e) => e.preventDefault() /* the right button opens the map's own menu (MK-33) */}
        />
        <canvas ref={overlayRef} className="map-overlay" style={{ width: size.w, height: size.h }} />
        <div className="map-toolbar">
          {(['browse', 'add-place', 'measure', 'draw', 'layers'] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); if (m !== 'measure') setMeasure([]); setPoly([]); setRegionDraft([]); startPick(undefined); if (routeFor) startRoute(undefined); if (eclipseFor) startEclipse(undefined); }}
              title={m === 'draw' ? 'Draw the world: land, heights, terrain and symbols' : m === 'layers' ? 'Realms, cultures, religions and other layers, and how their borders change over time' : undefined}>
              {m === 'browse' ? 'Move' : m === 'add-place' ? '+ Place' : m === 'measure' ? 'Measure' : m === 'draw' ? '✎ Draw map' : '▦ Layers'}
            </button>
          ))}
          {mainMap && <button onClick={() => openMap(undefined)} title="Frame the main map (World settings)">Main map</button>}
          {world.detailMaps.length > 0 && (
            <select className="map-pick" value={currentMap ?? ''} onChange={(e) => openMap(world.detailMaps.find((m) => m.id === e.target.value))} title="Open a continent, region or city map">
              <option value="">World map</option>
              {sortedMaps(world.detailMaps).map(({ m, depth }) => <option key={m.id} value={m.id}>{'\u00a0\u00a0'.repeat(depth)}{m.name}</option>)}
            </select>
          )}
          <FindBox entries={findEntries} onPick={showEntry} />
          <select className="map-export" value="" onChange={(e) => {
            const v = e.target.value;
            if (v === 'png') void exportPng(2); else if (v === 'print') void exportPng(4); else if (v === 'svg') void exportSvg(); else if (v === 'pdf') void exportPdf();
          }} title="MK-14, PL-5: save what is on screen">
            <option value="">Export…</option>
            <option value="png">PNG picture</option>
            <option value="print">PNG for print (4×)</option>
            <option value="svg">SVG (lines and labels as vectors)</option>
            <option value="pdf">PDF, one page</option>
          </select>
        </div>
        <ZoomControls
          onZoom={(f) => zoomBy(f)}
          panelHidden={panelHidden}
          onPanel={togglePanel}
          fullscreen={fullscreen}
          onFullscreen={toggleFullscreen}
          onFitPlaces={() => glideTo(fitPlaces(world.places, size.w, size.h))}
          onWholeGlobe={() => glideTo({ centerLat: 0, centerLng: 0, scale: Math.max(0.5, size.w / 380) })}
          globe={globe}
          onGlobe={() => setGlobe(!globe)}
        />
        {layers.inset && !globe && size.w / view.scale < (insetExtent.east - insetExtent.west) / 3 && (
          <MapInset extent={insetExtent} version={insetVersion} view={view} size={size}
            paintBase={(g, w, h, v) => { paintRef.current?.(g, w, h, v, { pxRatio: 1, base: true }); }}
            onCenter={(p) => { stopGlide(); setView((v) => clampView({ ...v, centerLat: p.lat, centerLng: p.lng })); }} />
        )}
        {menu && (() => {
          const m = menu.marker, place = m?.kind === 'place' ? ix.places.get(m.id) : undefined, ch = m?.kind === 'character' ? ix.characters.get(m.id) : undefined;
          const feat = menu.featureId ? world.mapFeatures.find((f) => f.id === menu.featureId) : undefined;
          const coords = `${menu.ll.lat.toFixed(4)}, ${menu.ll.lng.toFixed(4)}`;
          const first: MenuItem[] = place ? [
            { label: 'Open', onClick: () => go('places', place.id) },
            { label: 'Zoom to', onClick: () => zoomToRecord('place', place.id) },
            { label: '+ Stay here', onClick: () => edit({ kind: 'stay', preset: { placeId: place.id } }) },
            { label: 'Move it', onClick: () => startPick(place.id) },
          ] : ch ? [
            { label: 'Open', onClick: () => go('characters', ch.id) },
            { label: 'Zoom to', onClick: () => zoomToRecord('character', ch.id) },
            { label: tracks.includes(ch.id) ? 'Hide track' : 'Show track', onClick: () => setTracks((t) => (t.includes(ch.id) ? t.filter((x) => x !== ch.id) : [...t, ch.id])) },
          ] : feat ? [
            { label: 'Edit', onClick: () => setSelected({ kind: 'feature', id: feat.id }) },
            { label: 'Zoom to', onClick: () => zoomToRecord('feature', feat.id) },
            { label: 'Delete…', danger: true, onClick: () => void deleteFeature(world, store, feat).then((ok) => ok && selected?.id === feat.id && setSelected(null)) },
          ] : [];
          const here: MenuItem[] = [
            { label: '+ Place here', onClick: () => void addPlaceAt(menu.ll) },
            { label: "What's here", onClick: () => setWhatsHere(menu.ll) },
            { label: 'Measure from here', onClick: () => { setMode('measure'); setMeasure([menu.ll]); } },
            { label: 'Centre here', onClick: () => glideTo({ ...view, centerLat: menu.ll.lat, centerLng: menu.ll.lng }) },
            { label: 'Zoom in here', onClick: () => zoomBy(2, menu.x, menu.y) },
            { label: `Copy ${coords}`, onClick: () => void navigator.clipboard?.writeText(coords).catch(() => undefined) },
          ];
          return <MapMenu x={menu.x} y={menu.y} bounds={size} title={place?.name ?? ch?.name ?? (feat ? feat.name || KIND_NAME[feat.kind] : undefined)} groups={[first, here]} onClose={() => setMenu(null)} />;
        })()}
        {hoverHit && mode === 'browse' && !(selected && selected.id === hoverHit.id) && (
          <div className="map-hover-tip" style={{ left: Math.min(hoverHit.x + 14, size.w - 220), top: hoverHit.y + 16 }}>{hoverHit.name} <span className="muted small">{hoverHit.note}</span></div>
        )}
        {zoomBox && <div className="map-zoombox" style={{ left: Math.min(zoomBox.x0, zoomBox.x1), top: Math.min(zoomBox.y0, zoomBox.y1), width: Math.abs(zoomBox.x1 - zoomBox.x0), height: Math.abs(zoomBox.y1 - zoomBox.y0) }} />}
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
        {layers.eclipseEffects && effects && (
          <div className="map-legend eclipse-legend">
            <div className="seg small">
              <button className={effectShade === 'cooling' ? 'on' : ''} onClick={() => setEffectShade('cooling')}>Cooling</button>
              <button className={effectShade === 'forest' ? 'on' : ''} onClick={() => setEffectShade('forest')}>Forests</button>
            </div>
            <div className={`legend-bar ${effectShade}`} />
            <div className="legend-ends small">{effectShade === 'cooling' ? <><span>0 °C</span><span>−{Math.round(maxCooling)} °C or colder</span></> : <><span>healthy</span><span>dead</span></>}</div>
          </div>
        )}
        {flash && <div className="map-banner" style={{ opacity: Math.min(1, flashStrength * 2) }}>{formatDayNumber(flash.day)}: {flash.text}</div>}
        <div className="map-status">
          {mode === 'pick' && pickPlace && <b>Click the map to place {pickPlace.name}. </b>}
          {mode === 'add-place' && <b>Click the map where the new place is. </b>}
          {shownMap && <span className="map-crumb"><button className="link" onClick={() => openMap(undefined)}>World</button> › <b>{shownMap.name}</b> · </span>}
          {mode === 'route' && <b>Click along the way; Enter finishes at the destination. </b>}
          {mode === 'eclipse' && <b>Click along the middle of the shadow's path; Enter or double-click finishes. </b>}
          {mode === 'browse' && charDragAt && <b>Drop on a place to start a journey there. </b>}
          {mode === 'layers' && !selRegion && <b>Pick a region on the map or in the list, or add one. </b>}
          {mode === 'layers' && selRegion && regionTools.tool === 'shape' && regionEditable && <b>{regionDraft.length === 0 ? `Click the first corner to ${regionTools.op === 'add' ? 'add land to' : 'cut land from'} ${selRegion.name}. ` : `${regionDraft.length} corner(s): double-click or Enter to finish. `}</b>}
          {mode === 'layers' && selRegion && regionTools.tool === 'brush' && regionEditable && <b>Paint to {regionTools.op === 'add' ? 'add land to' : 'cut land from'} {selRegion.name}; Alt swaps. </b>}
          {mode === 'calibrate' && calib && <b>Calibrating: click known spot {calib.points.length + 1} of 2 on the sketch. </b>}
          {mode === 'draw' && <span className="map-tool-name">{toolInfo(draw.tool).icon} {toolInfo(draw.tool).name} ({toolInfo(draw.tool).key}) · </span>}
          {mode === 'draw' && draw.tool === 'eyedropper' && <b>Click the map to pick up its terrain type and height. </b>}
          {picked && <b>Picked up {picked}. </b>}
          {mode === 'draw' && draw.tool === 'polygon' && <b>{poly.length === 0 ? 'Click the first corner. ' : `${poly.length} corner(s): double-click or Enter to fill. `}</b>}
          {mode === 'measure' && (
            <b>
              {measure.length < 2 ? 'Click points to measure. ' : `${Math.round(pathLengthKm(measure, world.settings.radiusKm)).toLocaleString()} km great-circle. `}
              {measure.length > 0 && <button className="link" onClick={() => setMeasure([])}>clear</button>}{' '}
              <label className="checkbox small" style={{ display: 'inline-flex' }} title="Each click measures along the drawn roads and trade routes">
                <input type="checkbox" checked={measureFollow} onChange={(e) => setMeasureFollow(e.target.checked)} /> along roads
              </label>
            </b>
          )}
          {hover && <span>{Math.abs(hover.lat).toFixed(2)}°{hover.lat >= 0 ? 'N' : 'S'}, {Math.abs(wrapLng(hover.lng)).toFixed(2)}°{wrapLng(hover.lng) >= 0 ? 'E' : 'W'}{hoverInfo}{hoverRegions && ` · ${hoverRegions}`}</span>}
          <span className="muted"> · {formatDayNumber(moment)}</span>
        </div>
      </div>
      <aside className="map-side">
        {mode === 'eclipse' && eclipseEvent && (
          <EclipseCard event={eclipseEvent} points={eclipseDraft} onUndo={() => setEclipseDraft((d) => d.slice(0, -1))} onFinish={finishEclipse} onCancel={cancelEclipse} onClear={() => setEclipseDraft([])} />
        )}
        {mode === 'route' && routeJourney && (
          <RouteCard
            journey={routeJourney}
            points={routeDraft.pts}
            follow={routeFollow}
            onFollow={setRouteFollow}
            onUndo={undoRoutePoint}
            onFinish={finishRoute}
            onCancel={cancelRoute}
            onClear={() => setRouteDraft((r) => ({ pts: r.pts.slice(0, 1), marks: [] }))}
          />
        )}
        {mode === 'draw' && wizardOpen && <MapWizard onTool={(t) => setDraw((d) => ({ ...d, tool: t }))} onUpload={(f) => void addImage(f)} onTrace={world.mapImages.length ? () => setTraceFor(world.mapImages.find((m) => m.visible)?.id ?? world.mapImages[0].id) : undefined} onClose={() => setWizardOpen(false)} />}
        {mode === 'draw' && (
          <DrawOptions state={draw} onChange={setDraw} biomes={world.settings.biomes} polygonPoints={poly.length} onFinishPolygon={() => finishPolygon()} onCancelPolygon={() => setPoly([])}
            draftPoints={draft.pts.length} onFinishDraft={() => finishDraft()} onCancelDraft={() => setDraft({ pts: [], stops: [] })} />
        )}
        {mode === 'draw' && (
          <div className="card">
            <h3>Finishing touches</h3>
            <p className="muted small">MK-20: proposes terrain types from the climate, distance to the sea, dry belts and rain shadows. You see it first, then accept or cancel.</p>
            <div className="row wrap">
              <button className="small" disabled={!hasTerrain(world.terrain)} onClick={() => suggest(true)}>Suggest terrain for bare land</button>
              <button className="small" disabled={!hasTerrain(world.terrain)} onClick={() => suggest(false)}>Suggest for all land</button>
            </div>
            <p className="muted small">MK-21: natural wiggles for coastlines and hand-drawn rivers, lakes and areas. Can be removed again.</p>
            <button className="small" disabled={!hasTerrain(world.terrain) && !world.mapFeatures.length} onClick={toggleDetail}>{coastDetail || lineDetail ? 'Remove detail' : 'Add detail'}</button>
          </div>
        )}
        {mode === 'draw' && <LayersCard active={drawLayer} setActive={setActiveLayer} />}
        {mode === 'draw' && !wizardOpen && <button className="small" onClick={() => { setWizardOpen(true); store.setSettings({ mapWizard: { ...(world.settings.mapWizard ?? { step: 0, done: [] }), closed: false } }); }}>Guide: first map, step by step</button>}
        {mode === 'layers' && selRegion && (
          <RegionCard region={selRegion} ix={lix} moment={moment} tools={regionTools} setTools={(t) => { setRegionTools(t); if (t.tool !== 'shape') setRegionDraft([]); }}
            draftPoints={regionDraft.length} onFinish={() => finishRegionShape()} onCancel={() => setRegionDraft([])} onClose={() => { setRegionSel(undefined); setRegionDraft([]); }} />
        )}
        {(mode === 'layers' || mode === 'browse') && whatsHere && !selected && (
          <WhatsHere at={whatsHere} ix={lix} moment={moment} onClose={() => setWhatsHere(null)}
            onPick={(id) => { setMode('layers'); setRegionSel(id); setRegionLayerPick(lix.regions.get(id)?.layerId); }} />
        )}
        {mode === 'layers' && regionLayer && (
          <RegionList layer={regionLayer} selected={regionSel} ix={lix} moment={moment} onSelect={(id) => {
            setRegionSel(id);
            setRegionDraft([]);
            // a brand-new region has no shape yet: go straight to drawing it
            const r = store.world.regions.find((q) => q.id === id);
            if (r && !r.versions.length) setRegionTools((t) => ({ ...t, tool: 'shape', op: 'add' }));
          }} />
        )}
        {mode === 'layers' && <RegionLayerList editing active={regionLayer?.id} setActive={(id) => { setRegionLayerPick(id); setRegionSel(undefined); setRegionDraft([]); }} />}
        {fixPreview && (
          <div className="card fix-card">
            <h3>Preview: {FIX_LABEL[fixPreview.fix.kind].replace(/^./, (c) => c.toLowerCase())}</h3>
            <p className="small">{fixPreview.message}</p>
            {!fixAfter ? <p className="muted small">This fix can't be worked out on the map as it is now.</p>
              : fixDiff && (fixDiff.added.length || fixDiff.removed.length)
                ? <p className="muted small"><span className="swatch-line new" /> new line{fixDiff.removed.length ? <> · <span className="swatch-line old" /> line it replaces</> : null}. Nothing changes until you apply it.</p>
                : <p className="muted small">This only marks the feature; nothing on the map moves.</p>}
            <div className="row">
              <button className="small primary" disabled={!fixAfter} onClick={() => { const fix = fixPreview.fix; store.update((w) => applyFix(w, fix, recordBase) ?? w); previewFix(undefined); }}>Apply</button>
              <button className="small" onClick={() => previewFix(undefined)}>Cancel</button>
            </div>
          </div>
        )}
        {claudePreview && (
          <div className="card fix-card">
            <h3>Claude's suggestion{claudeSug ? ` #${claudeSug.number}: ${claudeSug.title}` : ''}</h3>
            {!claudeSug ? <p className="muted small">This suggestion is no longer open.</p>
              : claudeGhost?.errors.length ? <p className="small error">It no longer fits the world as it is now: {claudeGhost.errors.join(' ')}</p>
                : <p className="muted small"><span className="swatch-line claude" /> new or changed{claudeGhost?.removed?.length ? <> · <span className="swatch-line old" /> what it replaces</> : null}{claudeGhost?.regions?.length ? ' · dashed: new borders on the date shown' : ''}{claudeGhost?.terrain ? ' · the painted map shows the change' : ''}. Nothing changes until you accept it.</p>}
            {claudeGhost?.warnings?.length ? <p className="small claude-warn">The checks would flag: {claudeGhost.warnings.join(' | ')}</p> : null}
            <div className="row">
              {claudeSug && <button className="small primary" disabled={!!claudeGhost?.errors.length} onClick={async () => { const e = await acceptInStore(store, claudeSug); if (e) void ask.alert(e.join('\n')); else previewSuggestion(undefined); }}>Accept</button>}
              <button className="small" onClick={() => { previewSuggestion(undefined); go('claude'); }}>Back to suggestions</button>
              <button className="small" onClick={() => previewSuggestion(undefined)}>Close</button>
            </div>
          </div>
        )}
        {suggestion && (
          <div className="card fix-card">
            <h3>Suggested terrain</h3>
            <p className="small">{suggestion.cells.toLocaleString()} cells {suggestion.onlyUnpainted ? 'of bare land ' : ''}get a terrain type, shown on the map now:</p>
            <ul className="plain small">
              {[...suggestion.byBiome.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => {
                const b = world.settings.biomes.find((x) => x.id === id);
                return <li key={id}><span className="sw" style={{ background: b?.color, display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />{b?.name}: {Math.round((n / suggestion.cells) * 100)}%</li>;
              })}
            </ul>
            <div className="row">
              <button className="small primary" onClick={() => { const t = suggestion.terrain; store.update((w) => ({ ...w, terrain: t })); setSuggestion(null); }}>Accept</button>
              <button className="small" onClick={() => setSuggestion(null)}>Cancel</button>
            </div>
          </div>
        )}
        {selFeature && <FeatureCard feature={selFeature} onClose={() => setSelected(null)} onZoom={() => zoomToRecord('feature', selFeature.id)} />}
        {selPlace && (
          <div className="card">
            <h3>{PLACE_ICON[selPlace.kind]} {selPlace.name}</h3>
            <p className="muted">{selPlace.kind}{selPlace.location && ` · ${selPlace.location.lat.toFixed(2)}, ${selPlace.location.lng.toFixed(2)}`}</p>
            <p>Here now: {characterPositions.filter((cp) => { const w = whereIs(ix, cp.id, moment); return w.kind === 'stay' && (w.placeId === selPlace.id || ix.ancestors(w.placeId).includes(selPlace.id)); }).map((cp) => ix.characters.get(cp.id)!.name).join(', ') || 'nobody'}</p>
            <div className="row wrap">
              <button className="small" onClick={() => go('places', selPlace.id)}>Open</button>
              {selPlace.location && <button className="small" onClick={() => zoomToRecord('place', selPlace.id)}>Zoom to</button>}
              <button className="small" onClick={() => edit({ kind: 'stay', preset: { placeId: selPlace.id } })}>+ Stay here</button>
              <button className="small" onClick={() => { startPick(selPlace.id); }}>Move</button>
              {world.detailMaps.filter((dm) => dm.placeId === selPlace.id).map((dm) => (
                <button key={dm.id} className="small primary" onClick={() => openMap(dm)}>Open map: {dm.name}</button>
              ))}
            </div>
          </div>
        )}
        {selChar && (
          <div className="card">
            <h3><span style={{ color: selChar.color }}>{selChar.icon}</span> {selChar.name}</h3>
            <p>
              {selWhere?.kind === 'stay' && <>At {ix.places.get(selWhere.placeId)?.name}</>}
              {selWhere?.kind === 'journey' && <>Travelling {ix.places.get(selWhere.fromId)?.name} → {ix.places.get(selWhere.toId)?.name}, {Math.round(selWhere.progress * 100)}% · {(() => {
                const j = ix.journeys.get(selWhere.segment.recordId);
                const km = j ? ix.journeyDistanceKm(j) : undefined;
                return <>{km !== undefined ? `${Math.round(km)} km ${j?.route ? 'along its route' : 'straight'}` : ''} {j && <button className="link" onClick={() => startRoute(j.id)}>{j.route ? 'edit route' : 'draw route'}</button>}</>;
              })()}</>}
            </p>
            <div className="row wrap">
              <button className="small" onClick={() => go('characters', selChar.id)}>Open</button>
              <button className="small" onClick={() => zoomToRecord('character', selChar.id)}>Zoom to</button>
              <button className={`small${tracks.includes(selChar.id) ? ' primary' : ''}`} onClick={() => setTracks((t) => (t.includes(selChar.id) ? t.filter((x) => x !== selChar.id) : [...t, selChar.id]))}>
                {tracks.includes(selChar.id) ? 'Hide track' : 'Show track'}
              </button>
            </div>
          </div>
        )}
        {trackData.length > 0 && (
          <div className="card">
            <h3>Tracks</h3>
            {trackData.map((t) => {
              const c = ix.characters.get(t.id)!;
              return (
                <div key={t.id} className="row">
                  <span className="sw" style={{ background: c.color }} />
                  <button className="link grow" style={{ textAlign: 'left' }} onClick={() => setSelected({ kind: 'character', id: c.id })}>{c.name}</button>
                  <span className="muted small">{t.stops.length} {t.stops.length === 1 ? "stop" : "stops"}</span>
                  <button className="icon" title="Hide track" onClick={() => setTracks((x) => x.filter((id) => id !== t.id))}>×</button>
                </div>
              );
            })}
            <p className="muted small">Solid: travelled by the current date; dashed: still to come.</p>
          </div>
        )}
        <SideSection id="show" title="Show">
        {LAYER_GROUPS.map((grp) => (
          <div key={grp.name} className="show-group">
            <div className="show-group-name">{grp.name}</div>
            {grp.keys.map((k) => (
              <label key={k} className="checkbox"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {LAYER_NAMES[k]}</label>
            ))}
          </div>
        ))}
        {mode !== 'layers' && layers.regions && world.regions.length > 0 && <RegionLayerList editing={false} />}
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
        </SideSection>
        <DetailMapsCard current={currentMap} openMap={openMap} currentBounds={currentBounds} selectedPlaceId={selected?.kind === 'place' ? selected.id : undefined} />
        <SideSection id="main-map" title="Main map" defaultOpen={false}>
        <p className="muted small">{mainMap ? `Covers ${mainMap.north.toFixed(1)}° to ${mainMap.south.toFixed(1)}° latitude, ${mainMap.west.toFixed(1)}° to ${mainMap.east.toFixed(1)}° longitude.` : 'The main map is the whole globe.'}</p>
        <div className="row wrap">
          <button className="small" onClick={() => store.setSettings({ mainMap: currentBounds() })}>Use this view</button>
          {mainMap && <button className="small" onClick={() => store.setSettings({ mainMap: undefined })}>Whole globe</button>}
        </div>
        </SideSection>
        <SideSection id="sketches" title="Sketches and images">
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
              <button className="small" onClick={() => setTraceFor(img.id)} title="MK-17: find the coastline in this sketch and lay it on the map as land and sea">Find coastline…</button>
              <button className="small" onClick={() => {
                const east = img.east < img.west ? img.east + 360 : img.east;
                glideTo(({ centerLat: (img.north + img.south) / 2, centerLng: (img.west + east) / 2, scale: Math.min(size.w / (east - img.west), size.h / (img.north - img.south)) * 0.9 }));
              }}>Zoom to</button>
              <button className="small danger" onClick={async () => (await ask.confirm(`Remove ${img.name}?`, { okLabel: 'Remove', danger: true })) && store.removeMany([{ c: 'mapImages', id: img.id }])}>Remove</button>
            </div>
          </div>
        ))}
        {traceFor && world.mapImages.some((m) => m.id === traceFor) && <SketchTraceDialog image={world.mapImages.find((m) => m.id === traceFor)!} onClose={() => setTraceFor(undefined)} />}
        <label className="button">
          + Upload sketch
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImage(f); e.target.value = ''; }} />
        </label>
        </SideSection>
      </aside>
    </div>
  );
}
