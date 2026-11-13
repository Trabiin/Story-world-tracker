/** World settings, travel speeds (WH-7), backups (EU-17) and open exports (PL-4). */
import { useMemo, useState } from 'react';
import { LightSetting, lightSetting, setLightSetting, softwareRendering } from '../perf';
import { WheelPref, setWheelPref, wheelPref } from '../map/navigate';
import { EARTH_MOON, MOON_ICON, fromDay, moonPhases, toWindow, BAND_INFO, CELL_SIZES, CLIMATE_BANDS, ClimateBand, EARTH_TILT, TravelMode, biomeUsage, clearBiome, hasTerrain, nextBiomeId, resampleTerrain, seasonStrength, windName, SETTLEMENT_WATER_KM, NO_MODIFIERS } from '../../core';
import { ask } from '../components/Dialogs';
import { placesToGeoJson, worldToBytes, worldToJson } from '../../storage';
import JSZip from 'jszip';
import { safetyCopyFiles } from '../../core';
import { Field } from '../components/Modal';
import { DateInput } from '../components/DateInput';
import { useApp } from '../context';
import { CalendarSettings } from './CalendarSettings';

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

      <MoonSettings />

      <CalendarSettings />

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

      <h3>What slows travel down</h3>
      <p className="muted small">Optional. Each one changes the suggested travel time of every journey that has no arrival date of its own, and the too-fast warnings.</p>
      <div className="stack">
        {([
          ['terrain', 'Hills and mountains', 'Land travel over painted heights: hills ×1.25, high ground ×1.6, peaks ×2.'],
          ['season', 'Winter', 'Land ×1.35, sea ×1.15 when a journey sets out in winter at that latitude.'],
          ['danger', 'Danger', 'Regions on a Danger layer slow everyone, up to ×1.5 at full intensity.'],
          ['river', 'River currents', 'Ships on drawn rivers: downstream ×0.75, upstream ×1.4.'],
        ] as const).map(([k, label, hint]) => (
          <label className="checkbox" key={k} title={hint}>
            <input type="checkbox" checked={!!s.travelModifiers?.[k]} onChange={(e) => store.setSettings({ travelModifiers: { ...NO_MODIFIERS, ...s.travelModifiers, [k]: e.target.checked } })} /> {label} <span className="muted small">{hint}</span>
          </label>
        ))}
      </div>

      <h2>Character templates</h2>
      {(s.characterTemplates ?? []).length === 0 ? <p className="muted small">Open a character and choose More… → Save as a template. New characters can then start with the same tags, importance, look, lasting attributes and groups.</p> : (
        <table className="table">
          <thead><tr><th>Template</th><th>Starts with</th><th></th></tr></thead>
          <tbody>
            {(s.characterTemplates ?? []).map((t) => (
              <tr key={t.id}>
                <td><input value={t.name} onChange={(e) => store.setSettings({ characterTemplates: s.characterTemplates!.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)) })} /></td>
                <td className="muted small">{[t.importance, t.tags.length ? `tags ${t.tags.join(', ')}` : '', t.attributes.map((a) => `${a.key}: ${a.value}`).join(', '), t.groupIds.map((g) => world.groups.find((x) => x.id === g)?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</td>
                <td><button className="icon" aria-label="Remove template" onClick={() => store.setSettings({ characterTemplates: s.characterTemplates!.filter((x) => x.id !== t.id) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
        <p>{platform.kind === 'web' ? 'Backups are kept inside Chrome on this computer (last 10). The .world file itself is where you saved it; keeping it in Google Drive also gives you Drive\'s own version history.' : 'In the browser preview, backups are kept inside this browser (last 10). Download a copy to keep it safe elsewhere.'}</p>
      )}
      <div className="row">
        <button onClick={() => store.backupNow()}>Back up now</button>
        <span className="muted">{store.lastBackupInfo}</span>
      </div>
      <p className="muted">WR-7: {platform.kind === 'desktop' ? 'each backup also writes every scene as a plain text file, in a "' + s.name + ' text" folder beside the backups (books and chapters as folders).' : 'download every scene as plain text files, foldered by book and chapter.'} The words are never locked in.</p>
      <div className="row"><button onClick={async () => {
        const zip = new JSZip();
        for (const f of safetyCopyFiles(world)) zip.file(f.path.join('/'), f.text);
        await platform.saveBinaryFile(`${s.name} text.zip`, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
      }}>Download text copies (.zip)</button></div>

      <WritingSettings />

      <VersionHistory />

      <h2>Export</h2>
      <p>Open formats, so your world is never locked in.</p>
      <div className="row wrap">
        <button onClick={async () => platform.saveBinaryFile(`${safe}.world`, await worldToBytes(store.world, store.snapshots))}>World file (.world, SQLite)</button>
        <button onClick={() => platform.saveTextFile(`${safe}.json`, worldToJson(store.world), 'application/json')}>Everything as JSON</button>
        <button onClick={() => platform.saveTextFile(`${safe}-places.geojson`, placesToGeoJson(world), 'application/geo+json')}>Places as GeoJSON</button>
      </div>

      <h2>World</h2>
      <button onClick={closeWorld}>Close world and switch</button>
    </div>
  );
}

/** PL-3: restore the world as it was at an earlier time. */
/** WR-3, WR-5, WR-8, EU-18: the writing page and exported manuscripts. */
function WritingSettings() {
  const { world, store } = useApp();
  const ws = world.settings.writing ?? {};
  const set = (patch: Partial<typeof ws>) => store.setSettings({ writing: { ...ws, ...patch } });
  return (
    <>
      <h2>Writing</h2>
      <div className="form-grid narrow-form">
        <Field label="Author name" hint="On the title page and in the running header of an exported manuscript (WR-5)."><input value={ws.authorName ?? ''} onChange={(e) => set({ authorName: e.target.value })} /></Field>
        <Field label="Surname for the header" hint="Leave empty to use the last word of the name."><input value={ws.authorSurname ?? ''} onChange={(e) => set({ authorSurname: e.target.value })} /></Field>
        <Field label="Contact for the title page" hint="One per line: address, email, phone or agent."><textarea rows={3} value={ws.contact ?? ''} onChange={(e) => set({ contact: e.target.value })} /></Field>
        <Field label="Spelling" hint="WR-8: Windows' spell checker underlines mistakes as you write. Names of characters, places, realms, events and groups are never underlined. British English also exports A4 pages, American English US Letter.">
          <select value={ws.spelling ?? 'en-GB'} onChange={(e) => set({ spelling: e.target.value as 'en-GB' | 'en-US' })}>
            <option value="en-GB">English (UK)</option>
            <option value="en-US">English (US)</option>
          </select>
        </Field>
        <Field label="Writing page">
          <div className="row wrap">
            <select value={ws.page ?? 'light'} onChange={(e) => set({ page: e.target.value as 'light' | 'dark' | 'sepia' })}>
              <option value="light">Light page</option><option value="sepia">Sepia page</option><option value="dark">Dark page</option>
            </select>
            <label className="row">Text size <input type="number" min={12} max={32} value={ws.textSize ?? 18} onChange={(e) => set({ textSize: Math.max(12, Math.min(32, Number(e.target.value) || 18)) })} style={{ width: 64 }} /> px</label>
            <label className="checkbox"><input type="checkbox" checked={!!ws.typewriter} onChange={(e) => set({ typewriter: e.target.checked })} /> Typewriter scrolling</label>
          </div>
        </Field>
      </div>
    </>
  );
}

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
        <LightDrawingField />
        <WheelField />
        <Field label="Map style" hint="MK-12: a clean flat look, or a hand-drawn parchment look. Also used for exported maps.">
          <select value={s.mapStyle ?? 'flat'} onChange={(e) => store.setSettings({ mapStyle: e.target.value as 'flat' | 'parchment' })}>
            <option value="flat">Clean and flat</option>
            <option value="parchment">Hand-drawn parchment</option>
          </select>
        </Field>
        <Field label="Rain-shadow check" hint="RC-9 (optional): flags rainforest and swamps just downwind of high mountains.">
          <label className="checkbox"><input type="checkbox" checked={!!s.winds?.check} onChange={(e) => store.setSettings({ winds: { from: s.winds?.from ?? 'earth', check: e.target.checked } })} /> Check for rain shadows</label>
        </Field>
        <Field label="Prevailing winds" hint="Earth-like: trade winds from the east near the equator, westerlies in the middle latitudes, easterlies near the poles.">
          <select value={String(s.winds?.from ?? 'earth')} onChange={(e) => store.setSettings({ winds: { check: s.winds?.check ?? false, from: e.target.value === 'earth' ? 'earth' : Number(e.target.value) } })}>
            <option value="earth">Earth-like belts by latitude</option>
            {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => <option key={d} value={d}>Always from the {windName(d)}</option>)}
          </select>
        </Field>
        <Field label="Large towns near water (km)" hint="RC-11: towns, cities, capitals and ports further than this from a river, lake or coast are flagged.">
          <input type="number" min={1} max={200} value={s.settlementWaterKm ?? SETTLEMENT_WATER_KM} onChange={(e) => store.setSettings({ settlementWaterKm: Math.max(1, Math.min(200, Number(e.target.value) || SETTLEMENT_WATER_KM)) })} />
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

/** TL-6: the moon shown on the timeline. */
function MoonSettings() {
  const { world, store, moment } = useApp();
  const m: NonNullable<typeof world.settings.moon> = world.settings.moon ?? EARTH_MOON;
  const set = (p: Partial<typeof m>) => store.setSettings({ moon: { ...m, ...p } });
  const next = moonPhases(moment, moment + Math.ceil(m.periodDays) + 1, m).filter((p) => p.phase === 'new' || p.phase === 'full').slice(0, 2);
  return (
    <>
      <h2>Moon</h2>
      <div className="form-grid">
        <Field label="Name" hint="Shown on the timeline when the Moon option is on.">
          <input value={world.settings.moon?.name ?? ''} placeholder="The moon" onChange={(e) => set({ name: e.target.value || undefined })} />
        </Field>
        <Field label="Days from new moon to new moon" hint="Earth's moon: 29.53.">
          <input type="number" step={0.01} min={2} value={m.periodDays} onChange={(e) => set({ periodDays: Math.max(2, Number(e.target.value) || EARTH_MOON.periodDays) })} />
        </Field>
        <Field label="A date with a new moon" hint={next.length ? `Next: ${next.map((p) => `${MOON_ICON[p.phase]} ${p.phase} moon ${fromDay(p.day).day}/${fromDay(p.day).month}/${fromDay(p.day).year}`).join(', ')}` : undefined}>
          <DateInput value={fromDay(m.newMoonDay)} allowEmpty={false} onChange={(d) => d && set({ newMoonDay: toWindow(d).earliest })} />
        </Field>
        {world.settings.moon && <div><button className="small" onClick={() => store.setSettings({ moon: undefined })}>Use Earth's moon</button></div>}
      </div>
    </>
  );
}

/** Lighter drawing for slow computers; kept per computer, not in the world. */
function LightDrawingField() {
  const [v, setV] = useState<LightSetting>(lightSetting);
  const soft = softwareRendering();
  return (
    <Field label="Drawing on this computer" hint={`For slower computers and Chromebooks: sharp-screen detail, animations and shadows are dropped so the map and timeline move faster. ${soft ? 'This computer draws without graphics acceleration, so Automatic uses lighter drawing.' : 'This computer has graphics acceleration, so Automatic uses full detail.'} Kept on this computer only.`}>
      <select value={v} onChange={(e) => { const n = e.target.value as LightSetting; setLightSetting(n); setV(n); window.dispatchEvent(new Event('resize')); }}>
        <option value="auto">Automatic ({soft ? 'lighter' : 'full detail'})</option>
        <option value="on">Lighter (faster)</option>
        <option value="off">Full detail</option>
      </select>
    </Field>
  );
}

function WheelField() {
  const [v, setV] = useState<WheelPref>(wheelPref);
  return (
    <Field label="Scrolling on the map" hint="A mouse wheel usually zooms. On a touchpad, two-finger scrolling may feel better moving the map. Pinching always zooms, and holding Shift swaps the two. Kept on this computer only.">
      <select value={v} onChange={(e) => { const n = e.target.value as WheelPref; setWheelPref(n); setV(n); }}>
        <option value="zoom">Zooms in and out (mouse)</option>
        <option value="pan">Moves the map (touchpad)</option>
      </select>
    </Field>
  );
}
