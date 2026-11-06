/**
 * Region layers on the map side panel: layer controls and presets (LY-1, LY-7, LY-8), the region
 * being edited with its border history (LY-5, LY-6), and "what is here" for a clicked point (LY-9).
 */
import { useMemo } from 'react';
import {
  FuzzyDate, Id, LAYER_TYPES, LatLng, LayerIndex, REGION_COLORS, Region, RegionLayer, RegionLayerType, areaKm2, describeChain, formatFuzzy, fromDay, newRegionLayer, toWindow,
} from '../../core';
import { newId, recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { DateInput } from '../components/DateInput';
import { useApp } from '../context';

export interface RegionToolState {
  tool: 'select' | 'shape' | 'brush';
  op: 'add' | 'remove';
  brushKm: number;
  snap: boolean;
  /** 'always': the change applies to the region's whole history; 'from': from a date (until another). */
  span: 'always' | 'from';
  from?: FuzzyDate;
  until?: FuzzyDate;
  neighbours: 'stop' | 'take';
  note: string;
}

export const DEFAULT_REGION_TOOLS: RegionToolState = { tool: 'select', op: 'add', brushKm: 60, snap: true, span: 'always', neighbours: 'stop', note: '' };

export const REGION_TOOL_KEYS: Record<string, RegionToolState['tool']> = { V: 'select', P: 'shape', B: 'brush' };

const toSlider = (km: number) => Math.round((Math.log(km / 2) / Math.log(1000)) * 100);
const fromSlider = (v: number) => Math.round(2 * Math.pow(1000, v / 100));

export function sortedLayers(layers: RegionLayer[]): RegionLayer[] {
  return [...layers].sort((a, b) => a.order - b.order);
}

/** LY-1, LY-7, LY-8: show/hide, lock, reorder, opacity, style, presets. */
export function RegionLayerList({ active, setActive, editing }: { active?: Id; setActive?: (id: Id) => void; editing: boolean }) {
  const { world, store } = useApp();
  const layers = sortedLayers(world.regionLayers);
  const presets = world.settings.layerPresets ?? [];
  const set = (l: RegionLayer, patch: Partial<RegionLayer>) => store.upsert('regionLayers', { ...l, ...patch });
  const move = (l: RegionLayer, dir: -1 | 1) => {
    const i = layers.indexOf(l), j = i + dir;
    if (j < 0 || j >= layers.length) return;
    const other = layers[j];
    store.update((w) => ({ ...w, regionLayers: w.regionLayers.map((x) => (x.id === l.id ? { ...x, order: other.order } : x.id === other.id ? { ...x, order: l.order } : x)) }));
  };
  const add = async (type: RegionLayerType) => {
    const name = await ask.prompt('Name of the new layer?', LAYER_TYPES[type].name);
    if (!name) return;
    const l = newRegionLayer(type, recordBase(), (layers[layers.length - 1]?.order ?? 0) + 1, name);
    store.upsert('regionLayers', l);
    setActive?.(l.id);
  };
  const remove = async (l: RegionLayer) => {
    const n = world.regions.filter((r) => r.layerId === l.id).length;
    if (!(await ask.confirm(`Delete the layer "${l.name}"${n ? ` and its ${n} region(s)` : ''}?`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({ ...w, regionLayers: w.regionLayers.filter((x) => x.id !== l.id), regions: w.regions.filter((r) => r.layerId !== l.id) }));
  };
  const savePreset = async () => {
    const name = await ask.prompt('Name of this combination of layers?', layers.filter((l) => l.visible).map((l) => l.name.toLowerCase()).join(' + '));
    if (!name) return;
    store.setSettings({ layerPresets: [...presets, { id: newId(), name, visibleLayerIds: layers.filter((l) => l.visible).map((l) => l.id) }] });
  };
  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    store.update((w) => ({ ...w, regionLayers: w.regionLayers.map((l) => ({ ...l, visible: p.visibleLayerIds.includes(l.id) })) }));
  };
  return (
    <div className="card">
      <h3>Layers</h3>
      {editing && <p className="muted small">Pick the layer to draw on. Layers lower in the list are drawn on top.</p>}
      {layers.map((l, i) => {
        const count = world.regions.filter((r) => r.layerId === l.id).length;
        return (
          <div key={l.id} className={`layer-block${active === l.id && editing ? ' on' : ''}`}>
            <div className="layer-row">
              {editing && setActive && <input type="radio" name="region-layer" checked={active === l.id} onChange={() => setActive(l.id)} title="Draw on this layer" />}
              <span className="sw" style={{ background: l.color }} />
              <span className="grow" title={LAYER_TYPES[l.type].hint}>{l.name}</span>
              <span className="muted small">{count}</span>
              <button className={`icon${l.visible ? '' : ' off'}`} title={l.visible ? 'Hide' : 'Show'} onClick={() => set(l, { visible: !l.visible })}>{l.visible ? '👁' : '◌'}</button>
              {editing && <button className={`icon${l.locked ? ' on' : ''}`} title={l.locked ? 'Unlock' : 'Lock: no selecting or editing'} onClick={() => set(l, { locked: !l.locked })}>{l.locked ? '🔒' : '🔓'}</button>}
            </div>
            {editing && (
              <details className="layer-style">
                <summary className="small muted">Style and order</summary>
                <div className="stack small">
                  <input value={l.name} onChange={(e) => set(l, { name: e.target.value })} aria-label="Layer name" />
                  <label className="field"><span className="label">Opacity {Math.round(l.opacity * 100)}%</span>
                    <input type="range" min={0.05} max={1} step={0.05} value={l.opacity} onChange={(e) => set(l, { opacity: Number(e.target.value) })} />
                  </label>
                  <div className="row wrap">
                    <label>Fill <select value={l.fill} onChange={(e) => set(l, { fill: e.target.value as RegionLayer['fill'] })}>
                      <option value="solid">Colour</option><option value="hatch">Hatching</option><option value="none">None</option>
                    </select></label>
                    <label>Border <select value={l.borderStyle} onChange={(e) => set(l, { borderStyle: e.target.value as RegionLayer['borderStyle'] })}>
                      <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="none">None</option>
                    </select></label>
                    <label title="Default colour for new regions">Colour <input type="color" value={l.color} onChange={(e) => set(l, { color: e.target.value })} /></label>
                  </div>
                  <label className="checkbox"><input type="checkbox" checked={l.labels} onChange={(e) => set(l, { labels: e.target.checked })} /> Labels</label>
                  <label className="checkbox"><input type="checkbox" checked={l.onlyOnLand} onChange={(e) => set(l, { onlyOnLand: e.target.checked })} /> Stop at the coastline</label>
                  <label className="checkbox" title="Political layers keep regions apart, so each place has one realm"><input type="checkbox" checked={l.overlaps} disabled={l.type === 'political'} onChange={(e) => set(l, { overlaps: e.target.checked })} /> Regions may overlap</label>
                  {l.type === 'political' && (
                    <label className="checkbox"><input type="checkbox" checked={l.colorBy !== 'own'} onChange={(e) => set(l, { colorBy: e.target.checked ? 'top' : 'own' })} /> Colour duchies and vassals like their top realm</label>
                  )}
                  <div className="row wrap">
                    <button className="small" disabled={i === 0} onClick={() => move(l, -1)}>Move up</button>
                    <button className="small" disabled={i === layers.length - 1} onClick={() => move(l, 1)}>Move down</button>
                    <button className="small danger" onClick={() => remove(l)}>Delete layer</button>
                  </div>
                </div>
              </details>
            )}
          </div>
        );
      })}
      <div className="row wrap">
        {presets.length > 0 && (
          <select value="" onChange={(e) => applyPreset(e.target.value)} aria-label="Show a saved combination">
            <option value="">Presets…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button className="small" onClick={savePreset} title="Remember which layers are showing">Save as preset</button>
        {editing && presets.length > 0 && (
          <select value="" onChange={(e) => e.target.value && store.setSettings({ layerPresets: presets.filter((p) => p.id !== e.target.value) })} aria-label="Delete a preset">
            <option value="">Delete preset…</option>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      {editing && (
        <select value="" onChange={(e) => e.target.value && void add(e.target.value as RegionLayerType)} aria-label="Add a layer">
          <option value="">+ Add a layer…</option>
          {(Object.keys(LAYER_TYPES) as RegionLayerType[]).map((t) => <option key={t} value={t}>{LAYER_TYPES[t].name}: {LAYER_TYPES[t].hint}</option>)}
        </select>
      )}
      {editing && <p className="muted small">Climate, terrain and elevation are drawn from the painted map: switch them under Show.</p>}
    </div>
  );
}

/** The regions on the active layer, and a button to start a new one. */
export function RegionList({ layer, selected, onSelect, ix, moment }: { layer: RegionLayer; selected?: Id; onSelect: (id: Id) => void; ix: LayerIndex; moment: number }) {
  const { store } = useApp();
  const regions = ix.regionsOf(layer.id);
  const add = async () => {
    const name = await ask.prompt(`Name of the new ${layer.type === 'political' ? 'realm' : 'region'}?`, layer.type === 'political' ? 'Kingdom of ' : '');
    if (!name) return;
    const r: Region = { ...recordBase(), layerId: layer.id, name, color: REGION_COLORS[regions.length % REGION_COLORS.length], versions: [], overlords: [], ties: [], entry: '' };
    store.upsert('regions', r);
    onSelect(r.id);
  };
  return (
    <div className="card">
      <h3>{layer.name}</h3>
      {regions.length === 0 && <p className="muted small">No regions yet. Add one, then draw its shape.</p>}
      <div className="region-list">
        {regions.map((r) => {
          const v = ix.versionAt(r, moment);
          const chain = layer.type === 'political' ? ix.chain(r.id, moment) : [];
          return (
            <button key={r.id} className={`map-row${selected === r.id ? ' on' : ''}`} onClick={() => onSelect(r.id)}>
              <span className="sw" style={{ background: r.color }} /> {r.name}
              {chain.length > 1 && <span className="muted small"> · {chain[chain.length - 1].region.name}</span>}
              {!v?.area.length && <span className="muted small"> · not on the map now</span>}
            </button>
          );
        })}
      </div>
      <button className="small" disabled={layer.locked} onClick={add}>+ {layer.type === 'political' ? 'Realm' : 'Region'}</button>
    </div>
  );
}

/** LY-5, LY-6: drawing a region's shape and its border history. */
export function RegionCard({ region, ix, moment, tools, setTools, draftPoints, onFinish, onCancel, onClose }: {
  region: Region;
  ix: LayerIndex;
  moment: number;
  tools: RegionToolState;
  setTools: (t: RegionToolState) => void;
  draftPoints: number;
  onFinish: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { world, store, go } = useApp();
  const layer = ix.layer(region.layerId);
  const set = (p: Partial<RegionToolState>) => setTools({ ...tools, ...p });
  const now = ix.versionAt(region, moment);
  const nowIdx = ix.versionIndexAt(region, moment);
  const R = world.settings.radiusKm;
  const chain = ix.chain(region.id, moment);
  const locked = !!layer?.locked;
  const setVersion = (id: Id, patch: Partial<Region['versions'][number]>) =>
    store.upsert('regions', { ...region, versions: region.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  return (
    <div className="card region-card">
      <div className="row">
        <span className="sw" style={{ background: region.color }} />
        <h3 className="grow">{region.name}</h3>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="muted small">
        {layer?.name}{chain.length > 1 && ` · ${describeChain(chain).replace(`${region.name}, `, '')}`}
        {now?.area.length ? ` · ${Math.round(areaKm2(now.area, R)).toLocaleString()} km² now` : ' · not on the map on this date'}
      </p>
      {locked ? <p className="muted small">This layer is locked. Unlock it to draw.</p> : (
        <>
          <div className="swatches" role="toolbar" aria-label="Region tools">
            <button className={tools.tool === 'select' ? 'on' : ''} onClick={() => set({ tool: 'select' })} title="Click the map to pick a region and see what is there (V)">☝ Pick</button>
            <button className={tools.tool === 'shape' ? 'on' : ''} onClick={() => set({ tool: 'shape' })} title="Click the corners of a shape; double-click or Enter to finish (P)">⬠ Shape</button>
            <button className={tools.tool === 'brush' ? 'on' : ''} onClick={() => set({ tool: 'brush' })} title="Paint the region freehand (B)">🖌 Brush</button>
          </div>
          {tools.tool !== 'select' && (
            <>
              <div className="row wrap">
                <label className="checkbox"><input type="radio" checked={tools.op === 'add'} onChange={() => set({ op: 'add' })} /> Add land</label>
                <label className="checkbox"><input type="radio" checked={tools.op === 'remove'} onChange={() => set({ op: 'remove' })} /> Remove land</label>
                <span className="muted small">(Alt swaps)</span>
              </div>
              {tools.tool === 'brush' && (
                <label className="field"><span className="label">Brush size: {tools.brushKm.toLocaleString()} km <span className="muted">([ and ])</span></span>
                  <input type="range" min={0} max={100} value={toSlider(tools.brushKm)} onChange={(e) => set({ brushKm: fromSlider(Number(e.target.value)) })} />
                </label>
              )}
              {tools.tool === 'shape' && (
                <>
                  <label className="checkbox small" title="Corners snap to borders, rivers, roads and coastlines nearby"><input type="checkbox" checked={tools.snap} onChange={(e) => set({ snap: e.target.checked })} /> Snap to borders, rivers, roads and coasts</label>
                  <div className="row">
                    <button className="small primary" disabled={draftPoints < 3} onClick={onFinish}>Finish ({draftPoints} corners)</button>
                    <button className="small" disabled={draftPoints === 0} onClick={onCancel}>Cancel</button>
                  </div>
                </>
              )}
              <div className="span-box">
                <b className="small">When does this change happen?</b>
                <label className="checkbox small"><input type="radio" checked={tools.span === 'always'} onChange={() => set({ span: 'always' })} /> Always (the whole history)</label>
                <label className="checkbox small"><input type="radio" checked={tools.span === 'from'} onChange={() => set({ span: 'from', from: tools.from ?? fromDay(Math.floor(moment)) })} /> From a date, e.g. a conquest</label>
                {tools.span === 'from' && (
                  <div className="stack small">
                    <label className="field"><span className="label">From</span><DateInput value={tools.from} onChange={(from) => set({ from })} allowEmpty={false} /></label>
                    <label className="field"><span className="label">Until (optional, e.g. an occupation that ends)</span><DateInput value={tools.until} onChange={(until) => set({ until })} placeholder="from then on" /></label>
                    <label className="field"><span className="label">What happened (shown in the border history)</span><input value={tools.note} placeholder="e.g. Conquered by the Empire of Ash" onChange={(e) => set({ note: e.target.value })} /></label>
                  </div>
                )}
              </div>
              {layer && !layer.overlaps && tools.op === 'add' && (
                <div className="span-box">
                  <b className="small">Where it overlaps a neighbour</b>
                  <label className="checkbox small"><input type="radio" checked={tools.neighbours === 'stop'} onChange={() => set({ neighbours: 'stop' })} /> Stop at their border (shared edge)</label>
                  <label className="checkbox small"><input type="radio" checked={tools.neighbours === 'take'} onChange={() => set({ neighbours: 'take' })} /> Take the land from them</label>
                </div>
              )}
            </>
          )}
        </>
      )}
      {now && (
        <label className="field"><span className="label">Intensity on this date: {now.intensity ?? 100}% <span className="muted">(e.g. share of followers)</span></span>
          <input type="range" min={5} max={100} step={5} disabled={locked} value={now.intensity ?? 100} onChange={(e) => setVersion(now.id, { intensity: Number(e.target.value) === 100 ? undefined : Number(e.target.value) })} />
        </label>
      )}
      <BorderHistory region={region} current={nowIdx} />
      <div className="row wrap">
        <button className="small" onClick={() => go('layers', region.id)}>Open page</button>
      </div>
    </div>
  );
}

/** LY-6: the list of border versions; click one to jump the timeline there. */
export function BorderHistory({ region, current }: { region: Region; current: number }) {
  const { world, store } = useApp();
  const R = world.settings.radiusKm;
  if (!region.versions.length) return <p className="muted small">No shape drawn yet.</p>;
  return (
    <div>
      <b className="small">Border history</b>
      <ol className="border-history">
        {region.versions.map((v, i) => (
          <li key={v.id} className={i === current ? 'on' : ''}>
            <button className="link" onClick={() => v.start ? store.setMoment(toWindow(v.start, world.settings.hemisphereForSeasons).earliest) : undefined} title={v.start ? 'Show the map on this date' : undefined}>
              {v.start ? formatFuzzy(v.start) : region.start ? formatFuzzy(region.start) : 'From the beginning'}
            </button>
            <span className="muted"> · {v.area.length ? `${Math.round(areaKm2(v.area, R)).toLocaleString()} km²` : 'no land'}{v.intensity !== undefined ? ` · ${v.intensity}%` : ''}</span>
            {v.note && <div className="small">{v.note}</div>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** LY-9: every region covering a point on the current date. */
export function WhatsHere({ at, ix, moment, onPick, onClose }: { at: LatLng; ix: LayerIndex; moment: number; onPick: (id: Id) => void; onClose: () => void }) {
  const here = useMemo(() => ix.regionsAt(at, moment), [ix, at, moment]);
  const realm = useMemo(() => ix.realmAt(at, moment), [ix, at, moment]);
  return (
    <div className="card">
      <div className="row"><h3 className="grow">Here on this date</h3><button className="icon" onClick={onClose} aria-label="Close">×</button></div>
      <p className="muted small">{Math.abs(at.lat).toFixed(2)}°{at.lat >= 0 ? 'N' : 'S'}, {Math.abs(at.lng).toFixed(2)}°{at.lng >= 0 ? 'E' : 'W'}</p>
      {here.length === 0 && <p className="muted small">No region covers this spot.</p>}
      {realm.length > 0 && <p><b>Realm:</b> {describeChain(realm)}</p>}
      {here.map(({ layer, hits }) => (
        <div key={layer.id} className="small">
          <span className="muted">{layer.name}: </span>
          {hits.map((h, i) => (
            <span key={h.region.id}>{i > 0 && ' + '}<button className="link" onClick={() => onPick(h.region.id)}>{h.region.name}</button>{h.intensity < 100 && ` ${h.intensity}%`}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One line for the status bar, e.g. "Kingdom of Varn · Northern culture · Old Faith + Sun Faith". */
export function hereLine(ix: LayerIndex, at: LatLng, day: number): string {
  return ix.regionsAt(at, day).filter((x) => x.layer.visible).map((x) => x.hits.map((h) => h.region.name).join(' + ')).join(' · ');
}
