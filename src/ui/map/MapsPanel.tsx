/** MP-4: detail maps (continent, region, city) pinned to world coordinates, and MK-13 drawing layers. */
import type { DetailMap, Id, MapLayer } from '../../core';
import { recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { useApp } from '../context';

type Bounds = { north: number; south: number; west: number; east: number };

const KIND_NAME: Record<DetailMap['kind'], string> = { continent: 'Continent', region: 'Region', city: 'City' };

/** Guess the kind of map from its size: under half a degree is a city, under eight degrees a region. */
export function kindForBounds(b: Bounds): DetailMap['kind'] {
  const span = Math.max(b.north - b.south, ((b.east - b.west + 360) % 360) || 360);
  return span < 0.5 ? 'city' : span < 8 ? 'region' : 'continent';
}

/** Maps listed with the larger maps first, each followed by the maps that sit inside it. */
export function sortedMaps(maps: DetailMap[]): { m: DetailMap; depth: number }[] {
  const area = (m: DetailMap) => (m.north - m.south) * (((m.east - m.west + 360) % 360) || 360);
  const inside = (a: DetailMap, b: DetailMap) => a !== b && a.north <= b.north && a.south >= b.south && a.west >= b.west && a.east <= b.east && area(a) < area(b);
  const parent = new Map<Id, DetailMap | undefined>();
  for (const m of maps) {
    const holders = maps.filter((o) => inside(m, o)).sort((a, b) => area(a) - area(b));
    parent.set(m.id, holders[0]);
  }
  const out: { m: DetailMap; depth: number }[] = [];
  const walk = (p: DetailMap | undefined, depth: number) => {
    for (const m of maps.filter((x) => parent.get(x.id) === p).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ m, depth });
      walk(m, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

export function DetailMapsCard({ current, openMap, currentBounds, selectedPlaceId }: {
  current: Id | undefined;
  openMap: (m: DetailMap | undefined) => void;
  currentBounds: () => Bounds;
  selectedPlaceId?: Id;
}) {
  const { world, store, ix } = useApp();
  const add = async () => {
    const b = currentBounds();
    const place = selectedPlaceId ? ix.places.get(selectedPlaceId) : undefined;
    const name = await ask.prompt('Name of the new map?', place?.name ?? '');
    if (!name) return;
    const m: DetailMap = { ...recordBase(), name, kind: kindForBounds(b), ...b, placeId: place?.id, notes: '' };
    store.upsert('detailMaps', m);
    openMap(m);
  };
  const remove = async (m: DetailMap) => {
    if (!(await ask.confirm(`Delete the map "${m.name}"? Everything drawn stays on the globe.`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'detailMaps', id: m.id }]);
    if (current === m.id) openMap(undefined);
  };
  const places = world.places.filter((p) => !p.isPlaceholder).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <h3>Maps</h3>
      <p className="muted small">Continent, region and city maps are framed parts of the same globe. Zoom in, then make a map of the view. A map linked to a place opens from that place.</p>
      <div className="maps-list">
        <button className={`map-row${!current ? ' on' : ''}`} onClick={() => openMap(undefined)}>🌍 World</button>
        {sortedMaps(world.detailMaps).map(({ m, depth }) => (
          <details key={m.id} className="map-item" style={{ marginLeft: depth * 14 }}>
            <summary>
              <button className={`map-row${current === m.id ? ' on' : ''}`} onClick={(e) => { e.preventDefault(); openMap(m); }}>{m.name}</button>
              <span className="muted small"> {KIND_NAME[m.kind]}</span>
            </summary>
            <div className="stack small">
              <input value={m.name} onChange={(e) => store.upsert('detailMaps', { ...m, name: e.target.value })} aria-label="Map name" />
              <select value={m.kind} onChange={(e) => store.upsert('detailMaps', { ...m, kind: e.target.value as DetailMap['kind'] })}>
                {(['continent', 'region', 'city'] as const).map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}
              </select>
              <select value={m.placeId ?? ''} onChange={(e) => store.upsert('detailMaps', { ...m, placeId: e.target.value || undefined })} aria-label="Linked place">
                <option value="">Not linked to a place</option>
                {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="row wrap">
                <button className="small" onClick={() => store.upsert('detailMaps', { ...m, ...currentBounds() })} title="Frame this map to the current view">Use this view</button>
                <button className="small danger" onClick={() => remove(m)}>Delete</button>
              </div>
            </div>
          </details>
        ))}
      </div>
      <button className="small" onClick={add}>+ Map of this view</button>
    </>
  );
}

export function LayersCard({ active, setActive }: { active: Id | undefined; setActive: (id: Id | undefined) => void }) {
  const { world, store } = useApp();
  const layers = [...world.mapLayers].sort((a, b) => a.order - b.order);
  const add = async () => {
    const name = await ask.prompt('Name of the new drawing layer?', `Layer ${layers.length + 1}`);
    if (!name) return;
    const l: MapLayer = { ...recordBase(), name, visible: true, locked: false, order: (layers[layers.length - 1]?.order ?? 0) + 1 };
    store.upsert('mapLayers', l);
    setActive(l.id);
  };
  const remove = async (l: MapLayer) => {
    const n = world.mapFeatures.filter((f) => f.layerId === l.id).length + world.mapSymbols.filter((s) => s.layerId === l.id).length;
    if (!(await ask.confirm(`Delete the layer "${l.name}"?${n ? ` Its ${n} feature(s) and symbol(s) move to the base layer.` : ''}`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({
      ...w,
      mapLayers: w.mapLayers.filter((x) => x.id !== l.id),
      mapFeatures: w.mapFeatures.map((f) => (f.layerId === l.id ? { ...f, layerId: undefined } : f)),
      mapSymbols: w.mapSymbols.map((s) => (s.layerId === l.id ? { ...s, layerId: undefined } : s)),
    }));
    if (active === l.id) setActive(undefined);
  };
  const row = (l: MapLayer | undefined) => {
    const id = l?.id;
    const count = world.mapFeatures.filter((f) => f.layerId === id).length + world.mapSymbols.filter((s) => s.layerId === id).length;
    return (
      <div key={id ?? 'base'} className={`layer-row${active === id ? ' on' : ''}`}>
        <input type="radio" name="active-layer" checked={active === id} onChange={() => setActive(id)} title="Draw on this layer" />
        {l ? <input value={l.name} onChange={(e) => store.upsert('mapLayers', { ...l, name: e.target.value })} aria-label="Layer name" /> : <span>Base layer</span>}
        <span className="muted small">{count}</span>
        {l && (
          <>
            <button className={`icon${l.visible ? '' : ' off'}`} title={l.visible ? 'Hide' : 'Show'} onClick={() => store.upsert('mapLayers', { ...l, visible: !l.visible })}>{l.visible ? '👁' : '◌'}</button>
            <button className={`icon${l.locked ? ' on' : ''}`} title={l.locked ? 'Unlock' : 'Lock: no selecting or editing'} onClick={() => store.upsert('mapLayers', { ...l, locked: !l.locked })}>{l.locked ? '🔒' : '🔓'}</button>
            <button className="icon" title="Delete layer" onClick={() => remove(l)}>×</button>
          </>
        )}
      </div>
    );
  };
  return (
    <div className="card">
      <h3>Drawing layers</h3>
      <p className="muted small">New rivers, roads, areas and symbols go on the chosen layer. Hide a layer to compare versions, lock it so it can't be changed by accident.</p>
      {row(undefined)}
      {layers.map((l) => row(l))}
      <button className="small" onClick={add}>+ Layer</button>
    </div>
  );
}
