/** WH-11: where a character means to go next, and turning a plan into a journey. */
import { Character, Plan, formatDayNumber, fromDay, planOrigin, plansOn } from '../../core';
import { DateInput } from '../components/DateInput';
import { PlaceSelect } from '../components/Pickers';
import { useApp } from '../context';

export function Plans({ c }: { c: Character }) {
  const { world, ix, store, moment, edit } = useApp();
  const plans = c.plans ?? [];
  const views = new Map(plansOn(ix, moment).filter((v) => v.character.id === c.id).map((v) => [v.plan.id, v]));
  const put = (list: Plan[]) => store.upsert('characters', { ...c, plans: list.length ? list : undefined });
  const set = (id: string, p: Partial<Plan>) => put(plans.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const toJourney = (p: Plan) => {
    const day = Math.max(Math.floor(moment), p.from ? ix.win(p.from).earliest : -Infinity);
    edit({ kind: 'journey', preset: { subject: { kind: 'character', id: c.id }, originId: planOrigin(ix, c.id, day) ?? '', destinationId: p.placeId, departure: fromDay(day), purpose: p.note, status: 'draft' } });
    set(p.id, { done: true });
  };
  return (
    <section className="plans">
      <div className="section-head">
        <h2>Plans</h2>
        <button className="small" onClick={() => put([...plans, { id: crypto.randomUUID(), placeId: '', from: fromDay(Math.floor(moment)), note: '' }])}>+ Plan</button>
      </div>
      {plans.length === 0 ? <p className="muted small">Where {c.name} means to go next, before the journey is written. A plan that runs out of time without them arriving is flagged.</p> : (
        <ul className="plain plan-list">
          {plans.map((p) => {
            const v = views.get(p.id);
            const state = p.done ? 'done' : v?.reached ? 'reached' : v?.overdue ? 'overdue' : v?.active ? 'active' : 'later';
            return (
              <li key={p.id} className={state === 'done' || state === 'reached' || state === 'later' ? 'later' : ''}>
                <div className="row wrap">
                  <span className="muted">To</span>
                  <PlaceSelect world={world} value={p.placeId || undefined} allowNone="Choose…" onChange={(placeId) => set(p.id, { placeId: placeId ?? '' })} />
                  {state === 'reached' && <span className="tag">reached</span>}
                  {state === 'done' && <span className="tag">done</span>}
                  {state === 'overdue' && <span className="tag warn" title={p.by ? `Meant to be there by ${formatDayNumber(ix.win(p.by).latest)}` : ''}>overdue</span>}
                  <span className="spacer" />
                  <button className="icon" aria-label="Remove" onClick={() => put(plans.filter((x) => x.id !== p.id))}>×</button>
                </div>
                <div className="row wrap">
                  <span className="muted">decides</span>
                  <DateInput value={p.from} placeholder="from the start" onChange={(from) => set(p.id, { from })} />
                  <span className="muted">by</span>
                  <DateInput value={p.by} placeholder="no deadline" onChange={(by) => set(p.id, { by })} />
                </div>
                <div className="row wrap">
                  <input className="grow" value={p.note} placeholder="Why: to warn the queen…" onChange={(e) => set(p.id, { note: e.target.value })} />
                  {state === 'done' ? <button className="small" onClick={() => set(p.id, { done: undefined })}>Reopen</button> : !v?.reached && (
                    <>
                      <button className="small" disabled={!p.placeId} onClick={() => toJourney(p)} title="Open a draft journey there and mark the plan done">Make it a journey</button>
                      <button className="small" onClick={() => set(p.id, { done: true })} title="Given up">Drop</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
