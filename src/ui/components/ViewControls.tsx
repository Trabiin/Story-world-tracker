/** Top-bar controls: ST-7 what-if scenarios, VW-7 filters with ST-6 drafts, and EU-7 saved views. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CANON, Id, SavedView, ViewFilter, applyFilter, checkWorld, discardScenario, factionChoices, isFiltering, newScenario, promoteScenario, scenarioChanges, scenarioView } from '../../core';
import { newId, nowIso } from '../../storage';
import { useApp, View } from '../context';
import { ask } from './Dialogs';
import { Field, Modal } from './Modal';
import { sortByName } from '../util';

export function ViewControls() {
  const { store, scenarioId, setScenario, filter } = useApp();
  const [open, setOpen] = useState<'filter' | 'scenarios' | null>(null);
  const scenarios = store.world.scenarios;
  const createScenario = async () => {
    const name = await ask.prompt('Name the what-if (for example “Kaela goes north”):', '');
    if (!name?.trim()) return;
    const t = nowIso();
    const sc = newScenario({ id: newId(), createdAt: t, updatedAt: t }, name.trim());
    store.update((w) => ({ ...w, scenarios: [...w.scenarios, sc] }), true, true);
    setScenario(sc.id);
  };
  const n = activeFilterCount(filter);
  return (
    <div className="view-controls">
      <select className={`scenario-select ${scenarioId !== CANON ? 'on' : ''}`} value={scenarioId} title="ST-7: try a what-if without touching canon" onChange={(e) => {
        const v = e.target.value;
        if (v === '+new') void createScenario();
        else if (v === '+manage') setOpen('scenarios');
        else setScenario(v);
      }}>
        <option value={CANON}>Canon</option>
        {scenarios.map((s) => <option key={s.id} value={s.id}>What if: {s.name}</option>)}
        <option value="+new">+ New what-if…</option>
        {scenarios.length > 0 && <option value="+manage">Compare and manage…</option>}
      </select>
      <button className={n ? 'on' : ''} onClick={() => setOpen(open === 'filter' ? null : 'filter')} title="VW-7: filter every view">Filter{n ? ` (${n})` : ''}</button>
      {open === 'filter' && <FilterPanel onClose={() => setOpen(null)} />}
      {open === 'scenarios' && <ScenarioManager onClose={() => setOpen(null)} />}
    </div>
  );
}

function activeFilterCount(f: ViewFilter): number {
  return [f.bookId, f.threadId, f.faction, f.tag, f.povId, f.drafts === 'hide' ? 'x' : undefined].filter(Boolean).length;
}

/** VW-7 + EU-7 */
function FilterPanel({ onClose }: { onClose: () => void }) {
  const { unfiltered: world, filter, setFilter, store, view, go, scenarioId, setScenario } = useApp();
  const set = (p: Partial<ViewFilter>) => setFilter({ ...filter, ...p });
  const tags = useMemo(() => [...new Set(world.characters.flatMap((c) => c.tags))].sort(), [world.characters]);
  const factions = useMemo(() => factionChoices(world), [world]);
  const shown = useMemo(() => applyFilter(world, { ...filter, drafts: 'show' }), [world, filter]);
  const saved = store.world.settings.savedViews ?? [];
  // Close on Escape or a click elsewhere (but not in the top-bar controls or a dialog it opened).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { const t = e.target as Element; if (!t.closest?.('.view-controls, .modal-backdrop')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);
  const save = async () => {
    const name = await ask.prompt('Name this view (for example “Book 2, northern storyline”):', '');
    if (!name?.trim()) return;
    const v: SavedView = { id: newId(), name: name.trim(), filter, view, scenarioId: scenarioId === CANON ? undefined : scenarioId };
    store.setSettings({ savedViews: [...saved, v] });
  };
  const apply = (v: SavedView) => {
    setFilter(v.filter);
    setScenario(v.scenarioId && store.world.scenarios.some((s) => s.id === v.scenarioId) ? v.scenarioId : CANON);
    go(v.view as View);
    onClose();
  };
  return (
    <div className="popover filter-panel" role="dialog" aria-label="Filter" ref={ref}>
      <div className="popover-head"><b>Show only</b><button className="icon" onClick={onClose} aria-label="Close">×</button></div>
      <div className="form-grid">
        <Field label="Book">
          <select value={filter.bookId ?? ''} onChange={(e) => set({ bookId: e.target.value || undefined })}>
            <option value="">All books</option>
            {[...world.books].sort((a, b) => a.order - b.order).map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </Field>
        <Field label="Plot thread" hint="A thread includes its branches.">
          <select value={filter.threadId ?? ''} onChange={(e) => set({ threadId: e.target.value || undefined })}>
            <option value="">All threads</option>
            {sortByName(world.threads).map((t) => <option key={t.id} value={t.id}>{t.parentId ? '↳ ' : ''}{t.name}</option>)}
          </select>
        </Field>
        <Field label="Point of view">
          <select value={filter.povId ?? ''} onChange={(e) => set({ povId: e.target.value || undefined })}>
            <option value="">Any POV</option>
            {sortByName(world.characters.filter((c) => world.chapters.some((ch) => ch.povCharacterId === c.id) || world.scenes.some((s) => s.povCharacterId === c.id))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Faction or group">
          <select value={filter.faction ?? ''} onChange={(e) => set({ faction: e.target.value || undefined })}>
            <option value="">Any</option>
            {factions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        {tags.length > 0 && (
          <Field label="Tag">
            <select value={filter.tag ?? ''} onChange={(e) => set({ tag: e.target.value || undefined })}>
              <option value="">Any tag</option>
              {tags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        )}
        <label className="checkbox" title="ST-6: drafts leave every view and check"><input type="checkbox" checked={filter.drafts === 'hide'} onChange={(e) => set({ drafts: e.target.checked ? 'hide' : 'show' })} /> Hide drafts (canon only)</label>
      </div>
      {isFiltering({ ...filter, drafts: 'show' }) && <p className="muted small">Showing {shown.characters.length} of {world.characters.length} characters and {shown.scenes.length} of {world.scenes.length} scenes.</p>}
      <div className="row wrap">
        <button className="small" disabled={!isFiltering(filter)} onClick={() => setFilter({ drafts: 'show' })}>Clear</button>
        <button className="small primary" onClick={save} title="EU-7: remembers this filter, this page and the what-if">Save this view…</button>
      </div>
      {saved.length > 0 && (
        <>
          <h3>Saved views</h3>
          <ul className="plain saved-views">
            {saved.map((v) => (
              <li key={v.id}>
                <button className="link" onClick={() => apply(v)}>{v.name}</button>
                <button className="icon" aria-label={`Delete ${v.name}`} onClick={() => store.setSettings({ savedViews: saved.filter((x) => x.id !== v.id) })}>×</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** ST-7: compare each what-if with canon, then switch to it, make it canon or discard it. */
function ScenarioManager({ onClose }: { onClose: () => void }) {
  const { store, scenarioId, setScenario } = useApp();
  const all = store.world;
  const [pick, setPick] = useState<Id | undefined>(scenarioId !== CANON ? scenarioId : all.scenarios[0]?.id);
  const sc = all.scenarios.find((s) => s.id === pick);
  const changes = useMemo(() => (sc ? scenarioChanges(all, sc.id) : []), [all, sc]);
  const counts = useMemo(() => {
    if (!sc) return undefined;
    const open = (w: typeof all) => checkWorld(w).filter((x) => !x.dismissed && x.severity === 'warning').length;
    return { canon: open(scenarioView(all, CANON)), what: open(scenarioView(all, sc.id)) };
  }, [all, sc]);
  const promote = async () => {
    if (!sc || !(await ask.confirm(`Make “${sc.name}” canon? Its ${changes.length} change(s) replace the canon records, and the what-if is removed. Undo can take it back.`, { okLabel: 'Make canon' }))) return;
    store.update((w) => promoteScenario(w, sc.id), true, true);
    setScenario(CANON);
    onClose();
  };
  const discard = async () => {
    if (!sc || !(await ask.confirm(`Discard “${sc.name}” and its ${changes.length} change(s)? Canon is not touched.`, { okLabel: 'Discard', danger: true }))) return;
    store.update((w) => discardScenario(w, sc.id), true, true);
    if (scenarioId === sc.id) setScenario(CANON);
    setPick(undefined);
  };
  const setSc = (p: { name?: string; description?: string }) => sc && store.update((w) => ({ ...w, scenarios: w.scenarios.map((s) => (s.id === sc.id ? { ...s, ...p } : s)) }), true, true);
  const LABEL: Record<string, string> = { characters: 'Character', places: 'Place', groups: 'Group', memberships: 'Membership', stays: 'Stay', journeys: 'Journey', books: 'Book', chapters: 'Chapter', scenes: 'Scene', mapFeatures: 'Map feature', mapSymbols: 'Map symbol', regions: 'Region', events: 'Event', relationships: 'Relationship', secrets: 'Secret', threads: 'Thread' };
  return (
    <Modal title="What-if scenarios" onClose={onClose} wide>
      {all.scenarios.length === 0 ? <p className="muted">No what-ifs yet.</p> : (
        <div className="two-col">
          <div>
            <ul className="list">
              {all.scenarios.map((s) => <li key={s.id} className={s.id === pick ? 'active' : ''} onClick={() => setPick(s.id)}>{s.name}{s.id === scenarioId && <span className="tag">active</span>}</li>)}
            </ul>
          </div>
          {sc && (
            <div className="form-grid">
              <Field label="Name"><input value={sc.name} onChange={(e) => setSc({ name: e.target.value })} /></Field>
              <Field label="What changes"><textarea rows={2} value={sc.description} onChange={(e) => setSc({ description: e.target.value })} /></Field>
              {counts && <p>Open warnings: <b>{counts.canon}</b> in canon, <b>{counts.what}</b> in this what-if{counts.what !== counts.canon && ` (${counts.what > counts.canon ? '+' : ''}${counts.what - counts.canon})`}.</p>}
              <div>
                <b>{changes.length} change{changes.length === 1 ? '' : 's'} from canon</b>
                {changes.length === 0 ? <p className="muted">Nothing changed yet. Switch to it and edit as usual.</p> : (
                  <ul className="changes">
                    {changes.map((c) => <li key={c.collection + c.id} className={`ch-${c.kind}`}><span className="tag">{c.kind}</span> {LABEL[c.collection]}: {c.label}</li>)}
                  </ul>
                )}
              </div>
              <div className="row wrap">
                {sc.id !== scenarioId ? <button className="primary" onClick={() => { setScenario(sc.id); onClose(); }}>Switch to it</button> : <button onClick={() => { setScenario(CANON); onClose(); }}>Back to canon</button>}
                <button onClick={promote} disabled={!changes.length}>Make it canon</button>
                <button className="danger" onClick={discard}>Discard</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
