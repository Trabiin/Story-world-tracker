/** EC-1, EC-2, EC-7: an eclipse's shadow path, daily length and the places under it; and the eclipse box on place pages. */
import { useMemo } from 'react';
import {
  EclipseShadow, Place, WorldEvent, effectSeries, effectsAt, exactDate, fromDayNumber, formatDayNumber, localSeasons, newShadow, pathLengthKm,
  placeShadows, shadowCoverage, shadowHours, shadowWindow, shadowsOn, skyFacts, hasTerrain, TerrainReader,
} from '../../core';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { useApp } from '../context';
import { fmtHours } from '../map/eclipseRender';

/** Places that stand for drawn rivers, roads, lakes and areas are left out of the list. */
const FEATURE_KINDS = new Set<string>(['river', 'lake', 'road', 'area']);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const deg = (c: number) => `${c <= -0.05 ? '−' : ''}${Math.abs(c).toFixed(1)} °C`;

export function EclipsePanel({ e }: { e: WorldEvent }) {
  const { world, store, moment, go, startEclipse } = useApp();
  const s = e.shadow;
  const set = (p: Partial<EclipseShadow>) => store.upsert('events', { ...e, shadow: { ...(s ?? newShadow()), ...p } });
  const draw = () => { if (!s) set({}); startEclipse(e.id); go('map'); };
  const day = Math.floor(moment);
  const under = useMemo(() => {
    if (!s?.track.length) return [];
    const out: { p: Place; zone: string; today: number; cooling: number; forest: number }[] = [];
    for (const p of world.places) {
      if (!p.location || p.isPlaceholder || FEATURE_KINDS.has(p.kind)) continue;
      const ps = placeShadows(world, p.location);
      const mine = ps.reach.find((r) => r.event.id === e.id);
      if (!mine) continue;
      const eff = effectsAt(world, ps, day);
      out.push({ p, zone: mine.zone, today: shadowsOn(world, ps, day).reduce((a, h) => a + h.lightLost, 0), cooling: eff.coolingC, forest: eff.forest });
    }
    return out.sort((a, b) => (a.zone === b.zone ? a.p.name.localeCompare(b.p.name) : a.zone === 'band' ? -1 : 1));
  }, [world, s, e.id, day]);
  if (!s) {
    return (
      <>
        <h2>Shadow path</h2>
        <p className="muted">Draw where the shadow falls to see the annular (or total) band and the partial zone on the map, and what the eclipse does to temperatures and forests over time.</p>
        <button className="primary" disabled={!e.start} onClick={draw}>Draw the shadow path on the map</button>
        {!e.start && <p className="muted small">Give the eclipse a date first.</p>}
      </>
    );
  }
  const sky = world.settings.sky;
  const coverage = shadowCoverage(world, s);
  const natural = sky?.moons.length ? skyFacts(sky, world.settings.radiusKm).moons.find((m) => m.moon.id === s.moonId) ?? skyFacts(sky, world.settings.radiusKm).moons[0] : undefined;
  const w = shadowWindow(world, e);
  const hoursNow = shadowHours(world, e, day);
  const steps = [...s.steps].sort((a, b) => (a.from.year - b.from.year) || ((a.from.month ?? 0) - (b.from.month ?? 0)) || ((a.from.day ?? 0) - (b.from.day ?? 0)));
  return (
    <>
      <h2>Shadow path</h2>
      <p>
        {s.track.length ? <>{Math.round(pathLengthKm(s.track, world.settings.radiusKm)).toLocaleString()} km long. </> : 'Not drawn yet. '}
        {w && (hoursNow > 0 ? <b>On {formatDayNumber(day)}: {fmtHours(hoursNow)} of eclipse at the centre.</b> : <span className="muted">No eclipse on {formatDayNumber(day)}.</span>)}
      </p>
      <div className="row wrap">
        <button className="primary" onClick={draw}>{s.track.length ? 'Redraw on the map' : 'Draw on the map'}</button>
        {w && <button onClick={() => store.setMoment(w.from)}>Go to the start</button>}
        <button className="danger small" onClick={() => store.upsert('events', { ...e, shadow: undefined })}>Remove the path</button>
      </div>
      <div style={{ height: 10 }} />
      <div className="form-grid">
        <Field label="Kind" hint={s.kind === 'annular' ? 'A ring of light stays around the moon: deep twilight, never night.' : 'The sun is covered completely.'}>
          <select value={s.kind} onChange={(x) => set({ kind: x.target.value as EclipseShadow['kind'] })}>
            <option value="annular">Annular</option>
            <option value="total">Total</option>
          </select>
        </Field>
        <Field label={`${s.kind === 'annular' ? 'Annular' : 'Total'} band width (km)`} hint={natural ? `With the sizes in Settings → Sky it would naturally be about ${Math.round(natural.bandKm).toLocaleString()} km.` : undefined}>
          <input type="number" min={1} step={10} value={s.bandKm} onChange={(x) => set({ bandKm: Math.max(1, Number(x.target.value) || 1) })} />
        </Field>
        <Field label="Partial zone width (km)" hint="Edge to edge, band included. The eclipse fades out towards its edge.">
          <input type="number" min={1} step={50} value={s.partialKm} onChange={(x) => set({ partialKm: Math.max(1, Number(x.target.value) || 1) })} />
        </Field>
        <Field label="Sun covered in the band (%)" hint={s.coverage === undefined ? `Now ${Math.round(coverage * 100)}%, ${sky?.moons.length ? 'from Settings → Sky' : s.kind === 'annular' ? 'a moon 90% as wide as the sun' : 'total'}. Leave empty to keep it automatic.` : 'Leave empty to work it out from Settings → Sky.'}>
          <input type="number" min={0} max={100} placeholder={String(Math.round(coverage * 100))} value={s.coverage ?? ''} onChange={(x) => set({ coverage: x.target.value === '' ? undefined : Math.max(0, Math.min(100, Number(x.target.value))) })} />
        </Field>
        {sky && sky.moons.length > 1 && (
          <Field label="Cast by">
            <select value={s.moonId ?? sky.moons[0].id} onChange={(x) => set({ moonId: x.target.value })}>
              {sky.moons.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Hours a day at the centre line" hint="From the eclipse's date. Each day, when the sun passes over the shadow, it is eclipsed this long.">
          <input type="number" min={0} max={24} step={0.25} value={s.hours} onChange={(x) => set({ hours: Math.max(0, Math.min(24, Number(x.target.value) || 0)) })} />
        </Field>
      </div>
      <h3>Changes in length</h3>
      <p className="muted small">The eclipse can grow, shrink or jump over the years. Each line applies from its date on.</p>
      {steps.length > 0 && (
        <table className="table attr-table">
          <thead><tr><th>From</th><th>Hours a day</th><th></th></tr></thead>
          <tbody>
            {steps.map((st) => (
              <tr key={st.id}>
                <td><DateInput value={st.from} allowEmpty={false} onChange={(from) => from && set({ steps: s.steps.map((x) => (x.id === st.id ? { ...x, from } : x)) })} /></td>
                <td><input type="number" min={0} max={24} step={0.25} style={{ width: 80 }} value={st.hours} onChange={(x) => set({ steps: s.steps.map((q) => (q.id === st.id ? { ...q, hours: Math.max(0, Math.min(24, Number(x.target.value) || 0)) } : q)) })} /></td>
                <td><button className="icon" aria-label="Remove" onClick={() => set({ steps: s.steps.filter((x) => x.id !== st.id) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row wrap">
        <button className="small" disabled={!w} onClick={() => {
          const d = fromDayNumber(Math.max(day, w ? w.from + 1 : day));
          set({ steps: [...s.steps, { id: crypto.randomUUID(), from: exactDate(d.year, d.month, d.day), hours: Math.round((hoursNow || s.hours) * 2 + 1) / 2 }] });
        }}>+ Change from the current date</button>
        <label className="checkbox small"><input type="checkbox" checked={!!s.gradual} onChange={(x) => set({ gradual: x.target.checked || undefined })} /> Change gradually between dates</label>
      </div>
      <h3>Places under it on {formatDayNumber(day)}</h3>
      {!under.length ? <p className="muted">{s.track.length ? 'No places lie in the band or the partial zone.' : 'Draw the path to see which places lie under it.'}</p> : (
        <table className="table">
          <thead><tr><th>Place</th><th>Where</th><th>Light lost today</th><th>Cooling</th><th>Forests</th></tr></thead>
          <tbody>
            {under.map((u) => (
              <tr key={u.p.id}>
                <td><button className="link" onClick={() => go('places', u.p.id)}>{u.p.name}</button></td>
                <td>{u.zone === 'band' ? (s.kind === 'annular' ? 'annular band' : 'total band') : 'partial'}</td>
                <td>{u.today > 0 ? pct(u.today) : '–'}</td>
                <td>{Math.abs(u.cooling) >= 0.05 ? deg(u.cooling) : '–'}</td>
                <td>{u.forest < 99.5 ? pct(u.forest / 100) : 'healthy'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Light lost, cooling and forest health follow the rules in Settings → Sky, and add up when eclipses overlap.</p>
    </>
  );
}

/** EC-7: the eclipse box on a place page. */
export function EclipseHere({ p }: { p: Place }) {
  const { world, ix, moment, go } = useApp();
  const at = ix.locationOf(p.id);
  const ps = useMemo(() => (at && !p.isPlaceholder ? placeShadows(world, at) : undefined), [world, at, p.isPlaceholder]);
  const day = Math.floor(moment);
  const info = useMemo(() => {
    if (!ps || !ps.reach.length) return undefined;
    const lastEnd = Math.max(...ps.reach.map((r) => r.to));
    const to = Math.max(day, lastEnd + 365 * 5);
    const series = effectSeries(world, ps, to, Math.max(7, Math.round((to - ps.reach[0].from) / 160)));
    return { series, now: effectsAt(world, ps, day), today: shadowsOn(world, ps, day) };
  }, [world, ps, day]);
  const normal = useMemo(() => {
    if (!at) return undefined;
    const elev = hasTerrain(world.terrain) ? Math.max(0, new TerrainReader(world.terrain).elevation(at)) : 0;
    return localSeasons(at.lat, elev, world.settings.axialTiltDeg).meanC;
  }, [at, world.terrain, world.settings.axialTiltDeg]);
  if (!ps || !info) return null;
  return (
    <>
      <h2>Eclipse</h2>
      <ul className="plain">
        {ps.reach.map((r) => (
          <li key={r.event.id}>
            <button className="link" onClick={() => go('events', r.event.id)}>☀ {r.event.name}</button>
            <span className="muted"> · {r.zone === 'band' ? `in the ${r.event.shadow.kind} band` : `partial, ${Math.round(r.distKm).toLocaleString()} km from the centre`} · {formatDayNumber(r.from)} – {formatDayNumber(r.to)}</span>
          </li>
        ))}
      </ul>
      <p>
        {info.today.length
          ? <>On {formatDayNumber(day)}: {info.today.map((h) => `${fmtHours(h.hours)} of ${h.zone === 'band' ? h.event.shadow.kind : 'partial'} eclipse`).join(', ')}, {pct(info.now.lightLost)} of the day's light lost. </>
          : <>No eclipse here on {formatDayNumber(day)}. </>}
        {Math.abs(info.now.coolingC) >= 0.05 && <>About {deg(info.now.coolingC).replace('−', '')} colder than normal{normal !== undefined ? ` (around ${Math.round(normal + info.now.coolingC)} °C on average instead of ${Math.round(normal)} °C)` : ''}. </>}
        {info.now.forest < 99.5 && <>Forests at {pct(info.now.forest / 100)} health.</>}
      </p>
      {info.series && <EffectChart series={info.series.points} day={day} />}
    </>
  );
}

function EffectChart({ series, day }: { series: { day: number; coolingC: number; forest: number; lightLost: number }[]; day: number }) {
  const W = 320, H = 120, padL = 30, padB = 16, padT = 8;
  const d0 = series[0].day, d1 = series[series.length - 1].day;
  const minC = Math.min(-1, ...series.map((s) => s.coolingC));
  const x = (d: number) => padL + ((d - d0) / Math.max(1, d1 - d0)) * (W - padL - 4);
  const yC = (c: number) => padT + (c / minC) * (H - padT - padB);
  const yF = (f: number) => padT + ((100 - f) / 100) * (H - padT - padB);
  const line = (f: (s: (typeof series)[number]) => number) => series.map((s, i) => `${i ? 'L' : 'M'}${x(s.day).toFixed(1)},${f(s).toFixed(1)}`).join(' ');
  const y0 = fromDayNumber(d0).year, y1 = fromDayNumber(d1).year;
  const every = Math.max(1, Math.ceil((y1 - y0) / 6));
  const ticks: number[] = [];
  for (let y = y0 + 1; y <= y1; y += every) ticks.push(y);
  return (
    <svg className="eclipse-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cooling and forest health over the years">
      <line x1={padL} x2={W - 4} y1={padT} y2={padT} stroke="currentColor" opacity={0.15} />
      <line x1={padL} x2={W - 4} y1={H - padB} y2={H - padB} stroke="currentColor" opacity={0.3} />
      {ticks.map((y) => { const d = series.find((s) => fromDayNumber(s.day).year >= y)?.day ?? d1; return <text key={y} x={x(d)} y={H - 3} textAnchor="middle">{y}</text>; })}
      <text x={2} y={padT + 4}>0 °C</text>
      <text x={2} y={H - padB}>{Math.round(minC)} °C</text>
      <path d={line((s) => yF(s.forest))} fill="none" stroke="#8a5a1e" strokeWidth={2} />
      <path d={line((s) => yC(s.coolingC))} fill="none" stroke="#2f6fd6" strokeWidth={2} />
      {day >= d0 && day <= d1 && <line x1={x(day)} x2={x(day)} y1={padT} y2={H - padB} stroke="#d62828" strokeDasharray="3 3" />}
      <g transform={`translate(${W - 150}, ${H - padB - 26})`}>
        <rect width={10} height={3} y={-2} fill="#2f6fd6" /><text x={14} y={2}>cooling</text>
        <rect x={64} width={10} height={3} y={-2} fill="#8a5a1e" /><text x={78} y={2}>forest health</text>
      </g>
    </svg>
  );
}
