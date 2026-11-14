/** EC-3, EC-5: sizes and distances of the sun and moons, what they imply, and the rules for long eclipses. */
import { DEFAULT_ECLIPSE_RULES, EclipseRules, SkyBodies, eclipseRules, skyFacts } from '../../core';
import { Field } from '../components/Modal';
import { useApp } from '../context';

const EARTHLIKE: SkyBodies = { sunRadiusKm: 696_000, sunDistanceKm: 149_600_000, moons: [{ id: 'moon-1', name: 'Moon', radiusKm: 1737, distanceKm: 384_400 }] };
const km = (n: number) => `${Math.round(n).toLocaleString()} km`;

export function SkySettings() {
  const { world, store } = useApp();
  const sky = world.settings.sky;
  const set = (p: Partial<SkyBodies>) => store.setSettings({ sky: { ...(sky ?? EARTHLIKE), ...p } });
  const rules = eclipseRules(world);
  const setRule = (k: keyof EclipseRules, v: number) => store.setSettings({ eclipseRules: { ...(world.settings.eclipseRules ?? {}), [k]: v } });
  const facts = sky ? skyFacts(sky, world.settings.radiusKm) : undefined;
  const num = (v: string, min: number) => Math.max(min, Number(v) || min);
  const rule = (k: keyof EclipseRules, label: string, hint: string, step = 1, max = 1000) => (
    <Field label={label} hint={`${hint} Default ${DEFAULT_ECLIPSE_RULES[k]}.`}>
      <input type="number" min={0} max={max} step={step} value={rules[k]} onChange={(e) => setRule(k, Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />
    </Field>
  );
  return (
    <>
      <h2>Sky: sun, moons and eclipses</h2>
      <p className="muted">Sizes and distances show how large the sun and moons look and how wide an eclipse's band would naturally be. Nothing here moves a drawn eclipse: the widths you give an eclipse always win.</p>
      {!sky ? <button onClick={() => store.setSettings({ sky: EARTHLIKE })}>Set up the sky (starts Earth-like)</button> : (
        <>
          <div className="form-grid">
            <Field label="Sun radius (km)" hint="Ours: 696,000 km."><input type="number" min={1} value={sky.sunRadiusKm} onChange={(e) => set({ sunRadiusKm: num(e.target.value, 1) })} /></Field>
            <Field label="Sun distance (km)" hint="Ours: 149,600,000 km."><input type="number" min={1} value={sky.sunDistanceKm} onChange={(e) => set({ sunDistanceKm: num(e.target.value, 1) })} /></Field>
          </div>
          <table className="table attr-table">
            <thead><tr><th>Moon</th><th>Radius (km)</th><th>Distance (km)</th><th>Looks</th><th>Its eclipses</th><th></th></tr></thead>
            <tbody>
              {sky.moons.map((m, i) => {
                const f = facts!.moons[i];
                const setM = (p: Partial<typeof m>) => set({ moons: sky.moons.map((x) => (x.id === m.id ? { ...x, ...p } : x)) });
                return (
                  <tr key={m.id}>
                    <td><input value={m.name} onChange={(e) => setM({ name: e.target.value })} /></td>
                    <td><input type="number" min={1} style={{ width: 100 }} value={m.radiusKm} onChange={(e) => setM({ radiusKm: num(e.target.value, 1) })} /></td>
                    <td><input type="number" min={1} style={{ width: 120 }} value={m.distanceKm} onChange={(e) => setM({ distanceKm: num(e.target.value, 1) })} /></td>
                    <td className="small">{f.diameterDeg.toFixed(2)}° wide, {Math.round(f.ratio * 100)}% of the sun</td>
                    <td className="small">{f.kind === 'total' ? 'Total' : 'Annular'}: {Math.round(f.coverage)}% of the sun covered; band about {km(f.bandKm)}, partial zone {f.partialKm === Infinity ? 'the whole sunlit side' : `about ${km(f.partialKm)}`}</td>
                    <td><button className="icon" aria-label="Remove" disabled={sky.moons.length < 2} onClick={() => set({ moons: sky.moons.filter((x) => x.id !== m.id) })}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small">The sun looks {facts!.sunDiameterDeg.toFixed(2)}° wide from the ground (ours: 0.53°).</p>
          <div className="row wrap">
            <button className="small" onClick={() => set({ moons: [...sky.moons, { id: crypto.randomUUID(), name: `Moon ${sky.moons.length + 1}`, radiusKm: 1737, distanceKm: 384_400 }] })}>+ Add a moon</button>
            <button className="small" onClick={() => store.setSettings({ sky: undefined })}>Clear the sky</button>
          </div>
          <p className="muted small">Worked out with straight shadow cones from the ground under the moon; the curve of the world and the moon's orbit are left out.</p>
        </>
      )}
      <h3>What long eclipses do</h3>
      <p className="muted">Each day, a place under an eclipse loses the covered share of the sun for the eclipse's hours. Temperatures drift towards a colder level set by the light lost, and forests suffer once light loss or cold passes what they tolerate. Change the numbers until the effects fit your story.</p>
      <div className="form-grid">
        {rule('daylightHours', 'Hours of daylight', 'The eclipse takes its hours out of these.', 0.5, 24)}
        {rule('coolingC', 'Cooling if all light were lost (°C)', 'Half the light lost settles at half this.', 1, 100)}
        {rule('settleDays', 'Days to settle', 'How fast temperatures follow: about two thirds of the way in this many days.', 5, 3650)}
        {rule('forestLightTolerance', 'Light loss forests tolerate (%)', 'Below this, forests are unharmed by the dark.', 1, 100)}
        {rule('forestColdTolerance', 'Cooling forests tolerate (°C)', 'Below this, forests are unharmed by the cold.', 0.5, 50)}
        {rule('forestDeclinePerYear', 'Forest decline (% a year)', 'Health lost a year for every 10% of light lost beyond the tolerance, and every 5 °C beyond the cold tolerance.', 0.5, 100)}
        {rule('forestRecoveryPerYear', 'Forest regrowth (% a year)', 'Health regained a year once the stress is gone.', 0.5, 100)}
      </div>
      {world.settings.eclipseRules && <button className="small" onClick={() => store.setSettings({ eclipseRules: undefined })}>Back to the defaults</button>}
    </>
  );
}
