/**
 * MK-16: the first-map guide, one step at a time: sketch → globe and placement → coastline →
 * mountains → rivers → terrain → settlements. Every step can be skipped and come back to.
 */
import type { DrawTool } from './DrawPanel';
import { useApp } from '../context';

interface Step {
  title: string;
  text: string;
  tools: { tool: DrawTool; label: string }[];
}

export const WIZARD_STEPS: Step[] = [
  { title: 'Load a sketch', text: 'If you have a drawing or scan of your world, upload it to trace over. No sketch? Skip this step.', tools: [] },
  { title: 'Set the globe and placement', text: 'Choose the size of your planet and its tilt (season strength). Pin the sketch where it lies on the globe by its edges, or calibrate it with two known spots, in the Sketches list below.', tools: [] },
  { title: 'Trace the coastline', text: 'Paint land, or click out a continent with the Shape tool. Hold Alt to paint water. Smooth or roughen the coast afterwards.', tools: [{ tool: 'land', label: 'Land' }, { tool: 'polygon', label: 'Shape' }, { tool: 'water', label: 'Water' }, { tool: 'roughen', label: 'Roughen' }] },
  { title: 'Raise the mountains', text: 'Drag the Mountain range brush along a ridge; peak symbols appear by themselves. Hills for gentler ground.', tools: [{ tool: 'mountains', label: 'Mountain range' }, { tool: 'hills', label: 'Hills' }, { tool: 'raise', label: 'Raise' }] },
  { title: 'Let the rivers run', text: 'Click a source high up and the river finds its way to the sea. Draw one by hand if you want it somewhere else; climbing stretches show red.', tools: [{ tool: 'auto-river', label: 'Automatic river' }, { tool: 'river', label: 'River' }, { tool: 'lake', label: 'Lake' }] },
  { title: 'Paint the terrain', text: 'Forest, farmland, desert, swamp and more. Terrain that does not suit its climate shows in Warnings.', tools: [{ tool: 'biome', label: 'Terrain' }] },
  { title: 'Found the settlements', text: 'Place villages, towns, cities and a capital, then link them with roads.', tools: [{ tool: 'settlement', label: 'Settlement' }, { tool: 'line', label: 'Road' }] },
];

export function MapWizard({ onTool, onUpload, onClose }: { onTool: (t: DrawTool) => void; onUpload: (f: File) => void; onClose: () => void }) {
  const { world, store, go } = useApp();
  const wz = world.settings.mapWizard ?? { step: 0, done: [] };
  const step = Math.min(wz.step, WIZARD_STEPS.length - 1);
  const s = WIZARD_STEPS[step];
  const save = (patch: Partial<typeof wz>) => store.setSettings({ mapWizard: { ...wz, ...patch } });
  const goTo = (i: number) => {
    save({ step: i });
    const first = WIZARD_STEPS[i]?.tools[0];
    if (first) onTool(first.tool);
  };
  const next = (markDone: boolean) => {
    const done = markDone && !wz.done.includes(step) ? [...wz.done, step] : wz.done;
    if (step === WIZARD_STEPS.length - 1) { store.setSettings({ mapWizard: { step, done, closed: true } }); onClose(); return; }
    store.setSettings({ mapWizard: { step: step + 1, done } });
    const first = WIZARD_STEPS[step + 1].tools[0];
    if (first) onTool(first.tool);
  };
  const r = world.settings.radiusKm;
  return (
    <div className="card wizard">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>First map · step {step + 1} of {WIZARD_STEPS.length}</h3>
        <button className="small" onClick={() => { save({ closed: true }); onClose(); }} aria-label="Close the guide">✕</button>
      </div>
      <ol className="wizard-steps">
        {WIZARD_STEPS.map((x, i) => (
          <li key={x.title} className={`${i === step ? 'on' : ''}${wz.done.includes(i) ? ' done' : ''}`}>
            <button className="link" onClick={() => goTo(i)}>{wz.done.includes(i) ? '✓ ' : ''}{x.title}</button>
          </li>
        ))}
      </ol>
      <h4>{s.title}</h4>
      <p className="small">{s.text}</p>
      {step === 0 && (
        <label className="button small">
          Upload a sketch
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
        </label>
      )}
      {step === 1 && (
        <div className="stack small">
          <label className="field"><span className="label">Planet radius (km) · Earth is 6,371</span>
            <input type="number" min={100} value={r} onChange={(e) => store.setSettings({ radiusKm: Math.max(100, Number(e.target.value) || 6371) })} />
          </label>
          <label className="field"><span className="label">Axial tilt (°) · Earth is 23.4; 0 means no seasons</span>
            <input type="number" min={0} max={60} step={0.5} value={world.settings.axialTiltDeg} onChange={(e) => store.setSettings({ axialTiltDeg: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
          </label>
          <button className="link" onClick={() => go('settings')}>More world settings</button>
        </div>
      )}
      {s.tools.length > 0 && (
        <div className="row wrap">
          {s.tools.map((t) => <button key={t.tool} className="small" onClick={() => onTool(t.tool)}>{t.label}</button>)}
        </div>
      )}
      <div className="row wrap wizard-nav">
        <button className="small" disabled={step === 0} onClick={() => goTo(step - 1)}>Back</button>
        <span className="spacer" />
        <button className="small" onClick={() => next(false)}>Skip</button>
        <button className="small primary" onClick={() => next(true)}>{step === WIZARD_STEPS.length - 1 ? 'Finish' : 'Done, next'}</button>
      </div>
    </div>
  );
}
