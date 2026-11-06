/** Mapmaking tools (MK-4..MK-7, MK-18, MK-24, MK-26): the tool list and its options. */
import type { AreaKind, Biome, BrushTool, LineKind, MapSymbolKind, PlaceKind } from '../../core';
import { AREA_KINDS, LINE_KINDS } from './featureRender';
import { SYMBOL_LIBRARY } from './symbols';

/** Feature tools (Phase 2b): drawn lines and areas, automatic rivers, settlements. */
export type FeatureTool = 'river' | 'auto-river' | 'line' | 'lake' | 'area' | 'settlement';
export type DrawTool = 'pan' | 'polygon' | 'stamp' | FeatureTool | Exclude<BrushTool, 'erase-biome'>;
export type SettlementKind = Extract<PlaceKind, 'village' | 'town' | 'city' | 'capital'>;

export interface DrawState {
  tool: DrawTool;
  radiusKm: number;
  strength: number;
  height: number;
  /** Terrain type for the terrain brush and polygon; 0 = clear. */
  biome: number;
  symbol: MapSymbolKind;
  polyMode: 'land' | 'water' | 'biome';
  pressure: boolean;
  lineKind: Exclude<LineKind, 'river'>;
  areaKind: Exclude<AreaKind, 'lake'>;
  settlement: SettlementKind;
}

export const DEFAULT_DRAW: DrawState = {
  tool: 'land', radiusKm: 100, strength: 0.6, height: 500, biome: 2, symbol: 'peak', polyMode: 'land', pressure: true,
  lineKind: 'road', areaKind: 'forest', settlement: 'town',
};

export interface ToolInfo {
  tool: DrawTool;
  name: string;
  key: string;
  icon: string;
  tip: string;
  group: 'land' | 'height' | 'paint' | 'features';
  /** Tool used while Alt is held. */
  alt?: DrawTool;
}

export const TOOLS: ToolInfo[] = [
  { tool: 'pan', name: 'Move', key: 'V', icon: '✋', group: 'land', tip: 'Drag to move the map. Hold Space with any tool to move for a moment.' },
  { tool: 'land', name: 'Land', key: 'L', icon: '▰', group: 'land', alt: 'water', tip: 'Paint land. Hold Alt to paint water instead.' },
  { tool: 'water', name: 'Water', key: 'W', icon: '≋', group: 'land', alt: 'land', tip: 'Paint sea or water over land. Hold Alt to paint land instead.' },
  { tool: 'polygon', name: 'Shape', key: 'P', icon: '⬠', group: 'land', tip: 'Click the corners of a shape, then double-click or press Enter to fill it with land, water or a terrain type. Esc cancels, Backspace removes the last corner.' },
  { tool: 'smooth', name: 'Smooth', key: 'S', icon: '◠', group: 'land', alt: 'roughen', tip: 'Smooth a coastline or soften slopes.' },
  { tool: 'roughen', name: 'Roughen', key: 'G', icon: '⋰', group: 'land', alt: 'smooth', tip: 'Roughen a coastline or slope so it looks natural.' },
  { tool: 'raise', name: 'Raise', key: 'U', icon: '▲', group: 'height', alt: 'lower', tip: 'Raise the ground. Hold Alt to lower it.' },
  { tool: 'lower', name: 'Lower', key: 'D', icon: '▼', group: 'height', alt: 'raise', tip: 'Lower the ground (below 0 m it becomes water). Hold Alt to raise it.' },
  { tool: 'set-height', name: 'Exact height', key: 'E', icon: '⇥', group: 'height', tip: 'Bring the ground to an exact height in metres.' },
  { tool: 'flatten', name: 'Plateau', key: 'F', icon: '▬', group: 'height', tip: 'Flatten into a plateau at the height where the stroke starts.' },
  { tool: 'mountains', name: 'Mountain range', key: 'M', icon: '⛰', group: 'height', tip: 'Smart brush: raises rugged ground; peak symbols appear where it gets high.' },
  { tool: 'hills', name: 'Hills', key: 'H', icon: '◡', group: 'height', tip: 'Smart brush: gentle rolling hills; hill symbols appear on their own.' },
  { tool: 'biome', name: 'Terrain', key: 'T', icon: '❦', group: 'paint', tip: 'Paint a terrain type (forest, desert, …) onto land. Pick "Clear" to remove it.' },
  { tool: 'stamp', name: 'Symbol', key: 'Y', icon: '✱', group: 'paint', tip: 'Click to place a symbol from the library. Shift-click a symbol to remove it.' },
  { tool: 'river', name: 'River', key: 'R', icon: '〰', group: 'features', tip: 'Draw a river from its source to its mouth: click points or drag freehand, then double-click or press Enter. End it on another river to make a tributary. Stretches that climb show red as you draw.' },
  { tool: 'auto-river', name: 'Automatic river', key: 'A', icon: '⤵', group: 'features', tip: 'Click a source: the river finds its own way downhill to the sea, a lake or another river. It fills small hollows and cuts a valley through their rims, like real rivers do.' },
  { tool: 'lake', name: 'Lake', key: 'K', icon: '◍', group: 'features', tip: 'Click the outline of a lake, then double-click or press Enter. A river starting in it becomes its outlet.' },
  { tool: 'line', name: 'Road and other lines', key: 'O', icon: '═', group: 'features', tip: 'Draw a road, trade route, sea lane or wall. Points snap to settlements and places.' },
  { tool: 'area', name: 'Area', key: 'N', icon: '▧', group: 'features', tip: 'Outline a named area: a mountain range, forest, desert, swamp or sea.' },
  { tool: 'settlement', name: 'Settlement', key: 'C', icon: '✪', group: 'features', tip: 'Click to add a village, town, city or capital.' },
];

export const FEATURE_TOOLS: DrawTool[] = ['river', 'lake', 'line', 'area'];
export const isDrawnFeature = (t: DrawTool) => FEATURE_TOOLS.includes(t);

export const toolInfo = (t: DrawTool) => TOOLS.find((x) => x.tool === t)!;
export const isBrush = (t: DrawTool) => !['pan', 'polygon', 'stamp', 'river', 'auto-river', 'line', 'lake', 'area', 'settlement'].includes(t);

/** Brush sizes on a log scale, 2 km to 2,000 km. */
const toSlider = (km: number) => Math.round((Math.log(km / 2) / Math.log(1000)) * 100);
const fromSlider = (v: number) => Math.round(2 * Math.pow(1000, v / 100));

export function ToolPalette({ state, onChange }: { state: DrawState; onChange: (s: DrawState) => void }) {
  return (
    <div className="tool-palette" role="toolbar" aria-label="Map drawing tools">
      {TOOLS.flatMap((t, i) => [
        ...(i > 0 && TOOLS[i - 1].group !== t.group ? [<span key={`sep-${t.tool}`} className="tool-sep" />] : []),
        <button key={t.tool} className={state.tool === t.tool ? 'on' : ''} onClick={() => onChange({ ...state, tool: t.tool })} title={`${t.name} (${t.key}) — ${t.tip}`} aria-label={t.name}>
          {t.icon}
        </button>,
      ])}
    </div>
  );
}

export function DrawOptions({ state, onChange, biomes, onFinishPolygon, polygonPoints, onCancelPolygon, draftPoints, onFinishDraft, onCancelDraft }: {
  draftPoints: number;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
  state: DrawState;
  onChange: (s: DrawState) => void;
  biomes: Biome[];
  polygonPoints: number;
  onFinishPolygon: () => void;
  onCancelPolygon: () => void;
}) {
  const info = toolInfo(state.tool);
  const set = (p: Partial<DrawState>) => onChange({ ...state, ...p });
  const biomePicker = (allowClear: boolean) => (
    <div className="swatches">
      {allowClear && (
        <button className={state.biome === 0 ? 'on' : ''} onClick={() => set({ biome: 0 })} title="Clear terrain type"><span className="sw clear" /> Clear</button>
      )}
      {biomes.map((b) => (
        <button key={b.id} className={state.biome === b.id ? 'on' : ''} onClick={() => set({ biome: b.id })}>
          <span className="sw" style={{ background: b.color }} /> {b.name}
        </button>
      ))}
    </div>
  );
  return (
    <div className="card draw-options">
      <h3>{info.icon} {info.name} <span className="muted small">({info.key})</span></h3>
      <p className="muted small">{info.tip}</p>
      {isBrush(state.tool) && (
        <>
          <label className="field"><span className="label">Brush size: {state.radiusKm.toLocaleString()} km <span className="muted">([ and ])</span></span>
            <input type="range" min={0} max={100} value={toSlider(state.radiusKm)} onChange={(e) => set({ radiusKm: fromSlider(Number(e.target.value)) })} />
          </label>
          {!['land', 'water', 'biome'].includes(state.tool) && (
            <label className="field"><span className="label">Strength: {Math.round(state.strength * 100)}%</span>
              <input type="range" min={5} max={100} value={Math.round(state.strength * 100)} onChange={(e) => set({ strength: Number(e.target.value) / 100 })} />
            </label>
          )}
          <label className="checkbox small"><input type="checkbox" checked={state.pressure} onChange={(e) => set({ pressure: e.target.checked })} /> Pen pressure changes strength</label>
        </>
      )}
      {state.tool === 'set-height' && (
        <label className="field"><span className="label">Height (m)</span>
          <input type="number" step={50} value={state.height} onChange={(e) => set({ height: Number(e.target.value) || 0 })} />
        </label>
      )}
      {state.tool === 'biome' && biomePicker(true)}
      {state.tool === 'polygon' && (
        <>
          <div className="row wrap">
            {(['land', 'water', 'biome'] as const).map((m) => (
              <label key={m} className="checkbox"><input type="radio" checked={state.polyMode === m} onChange={() => set({ polyMode: m })} /> {m === 'biome' ? 'Terrain type' : m[0].toUpperCase() + m.slice(1)}</label>
            ))}
          </div>
          {state.polyMode === 'biome' && biomePicker(true)}
          <div className="row">
            <button className="small primary" disabled={polygonPoints < 3} onClick={onFinishPolygon}>Fill shape ({polygonPoints} corners)</button>
            <button className="small" disabled={polygonPoints === 0} onClick={onCancelPolygon}>Cancel</button>
          </div>
        </>
      )}
      {state.tool === 'line' && (
        <div className="swatches">
          {LINE_KINDS.map((k) => <button key={k.kind} className={state.lineKind === k.kind ? 'on' : ''} onClick={() => set({ lineKind: k.kind as DrawState['lineKind'] })}>{k.name}</button>)}
        </div>
      )}
      {state.tool === 'area' && (
        <div className="swatches">
          {AREA_KINDS.map((k) => <button key={k.kind} className={state.areaKind === k.kind ? 'on' : ''} onClick={() => set({ areaKind: k.kind as DrawState['areaKind'] })}>{k.name}</button>)}
        </div>
      )}
      {state.tool === 'settlement' && (
        <div className="swatches">
          {(['village', 'town', 'city', 'capital'] as SettlementKind[]).map((k) => <button key={k} className={state.settlement === k ? 'on' : ''} onClick={() => set({ settlement: k })}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        </div>
      )}
      {isDrawnFeature(state.tool) && (
        <div className="row">
          <button className="small primary" disabled={draftPoints < (state.tool === 'river' || state.tool === 'line' ? 2 : 3)} onClick={onFinishDraft}>Finish ({draftPoints} points)</button>
          <button className="small" disabled={draftPoints === 0} onClick={onCancelDraft}>Cancel</button>
        </div>
      )}
      {state.tool === 'stamp' && (
        <div className="swatches">
          {SYMBOL_LIBRARY.map((s) => (
            <button key={s.kind} className={state.symbol === s.kind ? 'on' : ''} onClick={() => set({ symbol: s.kind })}>{s.name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
