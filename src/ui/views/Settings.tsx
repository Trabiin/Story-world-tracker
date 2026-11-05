/** World settings, travel speeds (WH-7), backups (EU-17) and open exports (PL-4). */
import { TravelMode } from '../../core';
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
        <Field label="Planet radius (km)" hint={`Circumference ${Math.round(2 * Math.PI * s.radiusKm).toLocaleString()} km. Earth is 6,371.`}>
          <input type="number" min={100} value={s.radiusKm} onChange={(e) => store.setSettings({ radiusKm: Math.max(100, Number(e.target.value) || 6371) })} />
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

      <h2>Export</h2>
      <p>Open formats, so your world is never locked in.</p>
      <div className="row wrap">
        <button onClick={async () => platform.saveBinaryFile(`${safe}.world`, await worldToBytes(world))}>World file (.world, SQLite)</button>
        <button onClick={() => platform.saveTextFile(`${safe}.json`, worldToJson(world), 'application/json')}>Everything as JSON</button>
        <button onClick={() => platform.saveTextFile(`${safe}-places.geojson`, placesToGeoJson(world), 'application/geo+json')}>Places as GeoJSON</button>
      </div>

      <h2>World</h2>
      <button onClick={closeWorld}>Close world and switch</button>
    </div>
  );
}
