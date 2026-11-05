import { useCallback, useEffect, useMemo, useState } from 'react';
import { Id, WorldIndex, checkWorld } from '../core';
import { CommandBar } from './components/CommandBar';
import { JourneyEditor, StayEditor } from './components/EntryEditors';
import { MomentBar } from './components/MomentBar';
import { QuickAdd } from './components/QuickAdd';
import { Manuscripts } from './views/Manuscripts';
import { Story } from './views/Story';
import { Ctx, EditorTarget, View } from './context';
import { MapView } from './map/MapView';
import type { Platform } from './platform';
import { WorldStore, useStore } from './store';
import { defaultMoment } from './util';
import { Characters } from './views/Characters';
import { Groups } from './views/Groups';
import { Places } from './views/Places';
import { Settings } from './views/Settings';
import { Timeline } from './views/Timeline';
import { Warnings } from './views/Warnings';
import { WhoIsWhere } from './views/WhoIsWhere';

const NAV: { view: View; label: string; key: string }[] = [
  { view: 'who', label: 'Who is where', key: '1' },
  { view: 'timeline', label: 'Timeline', key: '2' },
  { view: 'map', label: 'Map', key: '3' },
  { view: 'story', label: 'Books & scenes', key: '4' },
  { view: 'manuscripts', label: 'Manuscripts', key: '5' },
  { view: 'characters', label: 'Characters', key: '6' },
  { view: 'places', label: 'Places', key: '7' },
  { view: 'groups', label: 'Groups', key: '8' },
  { view: 'warnings', label: 'Warnings', key: '9' },
  { view: 'settings', label: 'Settings', key: '0' },
];

export function App({ store, platform, onClose }: { store: WorldStore; platform: Platform; onClose: () => void }) {
  const world = useStore(store);
  const ix = useMemo(() => new WorldIndex(world), [world]);
  // Warnings ignore the current moment, so recompute only when records change.
  const recordsKey = useMemo(() => ({ ...world, settings: { ...world.settings, currentMoment: undefined } }), [world.characters, world.places, world.groups, world.memberships, world.stays, world.journeys, world.dismissals, world.settings.disabledRules, world.settings.travelModes, world.settings.radiusKm, world.settings.defaultDetourFactor, world.settings.hemisphereForSeasons]); // eslint-disable-line react-hooks/exhaustive-deps
  const warnings = useMemo(() => checkWorld(recordsKey), [recordsKey]);
  const moment = defaultMoment(world, ix);
  const [view, setView] = useState<View>(() => (localStorage.getItem('swt.view') as View) || 'who');
  const [selectedByView, setSelectedByView] = useState<Partial<Record<View, Id>>>({});
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [command, setCommand] = useState(false);
  const [pickFor, setPickFor] = useState<Id | undefined>();
  const [quick, setQuick] = useState(false);
  const [focusLink, setFocusLink] = useState<Id | undefined>();

  const go = useCallback((v: View, id?: Id) => {
    setView(v);
    try { localStorage.setItem('swt.view', v); } catch { /* ignore */ }
    if (id !== undefined) setSelectedByView((s) => ({ ...s, [v]: id }));
  }, []);

  const closeWorld = useCallback(async () => {
    if (store.hasPendingSave) await store.saveNow();
    onClose();
  }, [store, onClose]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommand(true); }
      else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); setQuick(true); }
      else if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
      else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); store.redo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void store.saveNow(); }
      else if (e.altKey && /^[0-9]$/.test(e.key)) { e.preventDefault(); go(NAV.find((n) => n.key === e.key)!.view); }
    };
    window.addEventListener('keydown', k);
    const beforeUnload = (e: BeforeUnloadEvent) => { if (store.hasPendingSave) { void store.saveNow(); e.preventDefault(); } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('beforeunload', beforeUnload); };
  }, [store, go]);

  const openWarnings = warnings.filter((w) => !w.dismissed && w.severity === 'warning').length;
  const ctx = {
    store, world, ix, warnings, platform, moment, view, go,
    selected: selectedByView[view],
    select: (id: Id | undefined) => setSelectedByView((s) => ({ ...s, [view]: id })),
    edit: setEditor,
    closeWorld,
    pickFor,
    startPick: setPickFor,
    focusLink,
    openPassage: (manuscriptId: Id, linkId?: Id) => {
      setFocusLink(linkId);
      setView('manuscripts');
      setSelectedByView((s) => ({ ...s, manuscripts: manuscriptId }));
    },
  };
  const saveLabel = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed' }[store.saveState];

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <button className="world-name" onClick={() => go('settings')} title="World settings">{world.settings.name}</button>
          <MomentBar />
          <div className="topbar-right">
            <button className="icon" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (Ctrl+Z)">↶</button>
            <button className="icon" disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
            <span className={`save-state ${store.saveState}`} title={store.saveError}>{saveLabel}</span>
            <button onClick={() => setQuick(true)} title="Ctrl+J">Quick add</button>
            <button onClick={() => setCommand(true)} title="Ctrl+K">Search</button>
          </div>
        </header>
        <nav className="sidebar">
          {NAV.map((n) => (
            <button key={n.view} className={view === n.view ? 'active' : ''} onClick={() => go(n.view)} title={`Alt+${n.key}`}>
              {n.label}
              {n.view === 'warnings' && openWarnings > 0 && <span className="badge">{openWarnings}</span>}
            </button>
          ))}
          <div className="sidebar-actions">
            <button onClick={() => setEditor({ kind: 'stay' })}>+ Stay</button>
            <button onClick={() => setEditor({ kind: 'journey' })}>+ Journey</button>
          </div>
        </nav>
        <main className="main">
          {view === 'who' && <WhoIsWhere />}
          {view === 'timeline' && <Timeline />}
          {view === 'map' && <MapView />}
          {view === 'story' && <Story />}
          {view === 'manuscripts' && <Manuscripts />}
          {view === 'characters' && <Characters />}
          {view === 'places' && <Places />}
          {view === 'groups' && <Groups />}
          {view === 'warnings' && <Warnings />}
          {view === 'settings' && <Settings />}
        </main>
        {editor?.kind === 'stay' && <StayEditor key={editor.id ?? 'new'} id={editor.id} preset={editor.preset} onClose={() => setEditor(null)} />}
        {editor?.kind === 'journey' && <JourneyEditor key={editor.id ?? 'new'} id={editor.id} preset={editor.preset} onClose={() => setEditor(null)} />}
        {command && <CommandBar onClose={() => setCommand(false)} />}
        {quick && <QuickAdd onClose={() => setQuick(false)} />}
      </div>
    </Ctx.Provider>
  );
}
