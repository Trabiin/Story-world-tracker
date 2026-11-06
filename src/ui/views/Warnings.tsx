/** CC-7: one panel for every warning. Warn, never block (D-9). */
import { useState } from 'react';
import { ask } from '../components/Dialogs';
import { FIX_LABEL, RULES, RuleId, Warning, formatDayNumber, fromDayNumber } from '../../core';
import { nowIso } from '../../storage';
import { useApp } from '../context';

export function Warnings() {
  const { world, store, warnings, edit, selected, showOnMap, previewFix } = useApp();
  const [showDismissed, setShowDismissed] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const visible = warnings.filter((w) => (showDismissed || !w.dismissed) && (showInfo || w.severity === 'warning'));
  const byRule = new Map<RuleId, Warning[]>();
  for (const w of visible) byRule.set(w.rule, [...(byRule.get(w.rule) ?? []), w]);
  const dismiss = async (w: Warning) => {
    const note = await ask.prompt('Why is this intentional? (optional note)', '');
    if (note === null) return;
    store.upsert('dismissals', { key: w.key, note, at: nowIso() });
  };
  const undismiss = (w: Warning) => store.removeMany([{ c: 'dismissals', id: w.key }]);
  const toggleRule = (r: RuleId) => {
    const d = new Set(world.settings.disabledRules);
    if (d.has(r)) d.delete(r); else d.add(r);
    store.setSettings({ disabledRules: [...d] });
  };
  const openRef = (r: Warning['refs'][number]) => {
    if (r.kind === 'stay' || r.kind === 'journey') edit({ kind: r.kind, id: r.id });
  };
  const active = warnings.filter((w) => !w.dismissed && w.severity === 'warning').length;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Warnings <span className="muted">({active} open)</span></h1>
        <div className="row">
          <label className="checkbox"><input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> Show notes to resolve</label>
          <label className="checkbox"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Show intentional</label>
        </div>
      </div>
      {visible.length === 0 && <div className="empty">Nothing to report. The timeline is consistent.</div>}
      {[...byRule.entries()].map(([rule, list]) => (
        <section key={rule}>
          <h2>{RULES[rule].name} <span className="muted">· {RULES[rule].requirement} · {list.length}</span></h2>
          <ul className="warnings">
            {list.map((w) => (
              <li key={w.key} className={`${w.severity} ${w.dismissed ? 'dismissed' : ''} ${selected === w.key ? 'selected' : ''}`}>
                <div>{w.message}</div>
                {w.dismissed && <div className="muted">Intentional{w.dismissed.note && `: ${w.dismissed.note}`}</div>}
                <div className="row wrap">
                  {w.day !== undefined && <button className="small" onClick={() => store.setMoment(w.day!)}>Go to {formatDayNumber(w.day)}</button>}
                  {w.at && <button className="small" onClick={() => showOnMap(w.at!)}>Show on map</button>}
                  {w.refs.filter((r) => r.kind === 'stay' || r.kind === 'journey').map((r, i) => (
                    <button key={i} className="small" onClick={() => openRef(r)}>Open {r.kind}</button>
                  ))}
                  {w.fix?.kind === 'create-journey' && (
                    <button className="small primary" onClick={() => {
                      const d = { ...fromDayNumber(w.fix!.journey.departureDay), precision: 'day' as const };
                      edit({ kind: 'journey', preset: { subject: w.fix!.journey.subject, originId: w.fix!.journey.originId, destinationId: w.fix!.journey.destinationId, departure: d, status: 'draft' } });
                    }}>Create draft journey</button>
                  )}
                  {!w.dismissed && w.mapFixes?.map((f, i) => (
                    <button key={f.kind} className={`small ${i === 0 ? 'primary' : ''}`} title="MK-23: shown on the map first; nothing changes until you apply it" onClick={() => previewFix({ fix: f, message: w.message, at: w.at })}>Fix: {FIX_LABEL[f.kind].replace(/^./, (c) => c.toLowerCase())}…</button>
                  ))}
                  {w.dismissed ? <button className="small" onClick={() => undismiss(w)}>Not intentional</button> : <button className="small" onClick={() => dismiss(w)}>Mark intentional</button>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h2>Rules</h2>
        <ul className="plain">
          {(Object.keys(RULES) as RuleId[]).map((r) => (
            <li key={r}>
              <label className="checkbox"><input type="checkbox" checked={!world.settings.disabledRules.includes(r)} onChange={() => toggleRule(r)} /> {RULES[r].name} <span className="muted">({RULES[r].requirement})</span></label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
