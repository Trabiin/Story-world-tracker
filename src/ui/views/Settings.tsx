/** World settings, travel speeds (WH-7), backups (EU-17) and open exports (PL-4). */
import { useMemo, useState } from 'react';
import { BAND_INFO, CELL_SIZES, CLIMATE_BANDS, ClimateBand, EARTH_TILT, TravelMode, biomeUsage, clearBiome, hasTerrain, nextBiomeId, resampleTerrain, seasonStrength } from '../../core';
import { ask } from '../components/Dialogs';
import { placesToGeoJson, worldToBytes, worldToJson } from '../../storage';
import { Field } from '../components/Modal';
import { useApp } from '../context';

export function Settings() {
  const { world, store, platform, closeWorld } = useApp();
  const s = world.settings;
  const setMode = (i: number, p: Partial<TravelMode>) => store.setSettings({ travelModes: s.travelModes.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const safe = s.name.replace(/[^\w\- ]+/g, '') || 'world';
  const usedModes = new Set(world.journeys.map((j) => j.modeId));
  return (
    <div className="page narrow">
      <h1>World settings</h1>
      <div className="form-grid">
        <Field label="World name"><input value={s.name} onChange={(e) => store.setSettings({ name: e.target.value })} /></Field>
        <Field label="Planet radius (km)" hint="Earth is 6,371 km.">
          <input type="number" min={100} value={s.radiusKm} onChange={(e) => store.setSettings({ radiusKm: Math.max(100, Number(e.target.value) || 6371) })} />
        </Field>
        <Field label="or circumference (km)" hint="Earth is 40,030 km.">
          <input type="number" min={630} value={Math.round(2 * Math.PI * s.radiusKm)} onChange={(e) => store.setSettings({ radiusKm: Math.max(100, Math.round((Number(e.target.value) || 40030) / (2 * Math.PI))) })} />
        </Field>
        <Field label="Axial tilt (°)" hint={`${seasonStrength(s.axialTiltDeg)[0].toUpperCase()}${seasonStrength(s.axialTiltDeg).slice(1)}. Tropics reach ${Math.min(44, s.axialTiltDeg).toFixed(1)}°, polar circles start at ${(90 - Math.min(44, s.axialTiltDeg)).toFixed(1)}°. Earth is ${EARTH_TILT}°.`}>
          <input type="number" min={0} max={60} step={0.5} value={s.axialTiltDeg} onChange={(e) => store.setSettings({ axialTiltDeg: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
        </Field>
        <Field label="Seasons follow the" hint="Used to read dates like 'spring 1042'.">
          <select value={s.hemisphereForSeasons} onChange={(e) => store.setSettings({ hemisphereForSeasons: e.target.value as 'north' | 'south' })}>
            <option value="north">northern hemisphere (spring = Mar–May)</option>
            <option value="south">southern hemisphere (spring = Sep–Nov)</option>
          </select>
        </Field>
        <Field label="Default detour factor" hint="Straight-line distance × this = distance travelled, until roads are drawn.">
          <input type="number" step={0.05} min={1} value={s.defaultDetourFactor} onChange={(e) => store.setSettings({ defaultDetourFactor: Math.max(1, Number(e.target.value) || 1.3) })} />
        </Field>
      </div>

      <MapSettings />

      <h2>Travel speeds</h2>
      <table className="table">
        <thead><tr><th>Mode</th><th>km per day</th><th></th></tr></thead>
        <tbody>
          {s.travelModes.map((m, i) => (
            <tr key={m.id}>
              <td><input value={m.name} onChange={(e) => setMode(i, { name: e.target.value })} /></td>
              <td><input type="number" min={1} value={m.speedKmPerDay} onChange={(e) => setMode(i, { speedKmPerDay: Math.max(1, Number(e.target.value) || 1) })} /></td>
              <td>{!usedModes.has(m.id) && <button className="icon" onClick={() => store.setSettings({ travelModes: s.travelModes.filter((_, j) => j !== i) })}>×</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => store.setSettings({ travelModes: [...s.travelModes, { id: crypto.randomUUID(), name: 'New mode', speedKmPerDay: 40 }] })}>+ Add travel mode</button>

      <h2>Backups</h2>
      {platform.kind === 'desktop' ? (
        <>
          <p>Every 10 minutes while you work, a dated copy of this world goes to your backup folder (the last 30 are kept). A Dropbox or OneDrive folder works well.</p>
          <div className="row">
            <code>{s.backupFolder ?? 'No folder chosen'}</code>
            <button onClick={async () => { const f = await platform.chooseBackupFolder?.(); if (f) store.setSettings({ backupFolder: f }); }}>Choose folder…</button>
          </div>
        </>
      ) : (
        <p>In the browser preview, backups are kept inside this browser (last 10). Download a copy to keep it safe elsewhere.</p>
      )}
      <div className="row">
        <button onClick={() => store.backupNow()}>Back up now</button>
        <span className="muted">{store.lastBackupInfo}</span>
      </div>

      <VersionHistory />

      <h2>Export</h2>
      <p>Open formats, so your world is never locked in.</p>
      <div className="row wrap">
        <button onClick={async () => platform.saveBinaryFile(`${safe}.world`, await worldToBytes(world, store.snapshots))}>World file (.world, SQLite)</button>
        <button onClick={() => platform.saveTextFile(`${safe}.json`, worldToJson(world), 'application/json')}>Everything as JSON</button>
        <button onClick={() => platform.saveTextFile(`${safe}-places.geojson`, placesToGeoJson(world), 'application/geo+json')}>Places as GeoJSON</button>
      </div>

      <h2>World</h2>
      <button onClick={closeWorld}>Close world and switch</button>
    </div>
  );
}

/** PL-3: restore the world as it was at an earlier time. */
function VersionHistory() {
  const { store } = useApp();
  const [busy, setBusy] = useState(false);
  const list = store.snapshots;
  return (
    <>
      <h2>Version history</h2>
      <p>A copy of the world is kept every 10 minutes while you work (the last 60), inside the world file itself. Restoring is undoable, and the current state is kept as a version first.</p>
      <div className="row">
        <button disabled={busy} onClick={async () => {
          const label = await ask.prompt('Name this version (optional)', '');
          if (label === null) return;
          setBusy(true);
          await store.snapshotNow(label || 'Saved by hand');
          setBusy(false);
        }}>Save a version now</button>
      </div>
      {list.length === 0 ? <p className="muted">No earlier versions yet.</p> : (
        <table className="table">
          <thead><tr><th>When</th><th>Name</th><th>Contents</th><th></th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.at).toLocaleString()}</td>
                <td>{s.label}</td>
                <td className="muted">{s.summary}</td>
                <td className="actions">
                  <button className="small" disabled={busy} onClick={async () => {
                    if (!(await ask.confirm(`Restore the world as it was on ${new Date(s.at).toLocaleString()}?`, { okLabel: 'Restore' }))) return;
                    setBusy(true);
                    await store.restore(s.id);
                    setBusy(false);
                  }}>Restore</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** MK-2 map detail and MK-7 editable terrain types (with the climates they suit, RC-8). */
function MapSettings() {
  const { world, store } = useApp();
  const s = world.settings;
  const usage = useMemo(() => biomeUsage(world.terrain), [world.terrain]);
  const g = world.terrain.cellDeg;
  const setBiome = (id: number, p: Partial<(typeof s.biomes)[number]>) => store.setSettings({ biomes: s.biomes.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const toggleBand = (id: number, band: ClimateBand) => {
    const b = s.biomes.find((x) => x.id === id)!;
    setBiome(id, { bands: b.bands.includes(band) ? b.bands.filter((x) => x !== band) : CLIMATE_BANDS.filter((x) => x === band || b.bands.includes(x)) });
  };
  return (
    <>
      <h2>Map</h2>
      <div className="form-grid">
        <Field label="Map detail" hint={`One painted cell is about ${Math.round(g * Math.PI * s.radiusKm / 180)} km across at the equator. Finer detail makes the world file bigger.`}>
          <select value={g} onChange={async (e) => {
            const next = Number(e.target.value);
            if (hasTerrain(world.terrain) && !(await ask.confirm('Redraw the painted map at the new detail? Heights and terrain are resampled, and this can be undone.', { okLabel: 'Change detail' }))) return;
            store.update((w) => ({ ...w, terrain: resampleTerrain(w.terrain, next) }));
          }}>
            {CELL_SIZES.map((c) => <option key={c} value={c}>{c === 0.1 ? 'Coarse' : c === 0.05 ? 'Standard' : 'Fine'}: {c}° (~{Math.round(c * Math.PI * s.radiusKm / 180)} km)</option>)}
          </select>
        </Field>
      </div>
      <h3>Terrain types</h3>
      <p className="muted">Painted with the Terrain tool on the map. Ticked climates are where each type is plausible; anywhere else shows a warning (it can be marked intentional).</p>
      <table className="table biome-table">
        <thead><tr><th>Colour</th><th>Name</th><th>Plausible in</th><th>Painted</th><th></th></tr></thead>
        <tbody>
          {s.biomes.map((b) => (
            <tr key={b.id}>
              <td><input type="color" value={b.color} onChange={(e) => setBiome(b.id, { color: e.target.value })} /></td>
              <td><input value={b.name} onChange={(e) => setBiome(b.id, { name: e.target.value })} /></td>
              <td><div className="bands">{CLIMATE_BANDS.map((band) => (
                <label key={band} className="checkbox"><input type="checkbox" checked={b.bands.includes(band)} onChange={() => toggleBand(b.id, band)} /> {BAND_INFO[band].name}</label>
              ))}</div></td>
              <td className="muted">{usage.get(b.id) ? `${usage.get(b.id)!.toLocaleString()} cells` : '–'}</td>
              <td><button className="icon" title="Delete terrain type" onClick={async () => {
                if (usage.get(b.id) && !(await ask.confirm(`${b.name} is painted on the map. Delete it and clear it from the map?`, { okLabel: 'Delete', danger: true }))) return;
                store.update((w) => ({ ...w, terrain: clearBiome(w.terrain, b.id), settings: { ...w.settings, biomes: w.settings.biomes.filter((x) => x.id !== b.id) } }));
              }}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button disabled={nextBiomeId(s.biomes) < 0} onClick={() => store.setSettings({ biomes: [...s.biomes, { id: nextBiomeId(s.biomes), name: 'New terrain', color: '#9fb07a', bands: ['subtropical', 'temperate'] }] })}>+ Add terrain type</button>
    </>
  );
}
