import { useCallback, useEffect, useMemo, useState } from 'react';
import { Id, LatLng, World, WorldIndex, checkWorld, readingChoices, spoilerView } from '../core';
import { ask } from './components/Dialogs';
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
import { Layers } from './views/Layers';
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
  { view: 'layers', label: 'Realms & layers', key: '' },
  { view: 'groups', label: 'Groups', key: '8' },
  { view: 'warnings', label: 'Warnings', key: '9' },
  { view: 'settings', label: 'Settings', key: '0' },
];

export function App({ store, platform, onClose }: { store: WorldStore; platform: Platform; onClose: () => void }) {
  const full = useStore(store);
  // EU-8: the reader's view shows the world only as the reader knows it at the end of a chapter.
  const readerKey = `swt.reader.${store.handle.id}`;
  const [asOf, setAsOfState] = useState<number | undefined>(() => {
    try { const v = localStorage.getItem(readerKey); return v === null || v === '' ? undefined : Number(v); } catch { return undefined; }
  });
  const choices = useMemo(() => readingChoices(full), [full.books, full.chapters]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastChapter = choices.length ? Math.max(...choices.map((c) => c.value)) : -1;
  const readerAt = asOf === undefined || lastChapter < 0 ? undefined : Math.min(asOf, lastChapter);
  const setAsOf = (v: number | undefined) => {
    setAsOfState(v);
    try { localStorage.setItem(readerKey, v === undefined ? '' : String(v)); } catch { /* ignore */ }
  };
  // Filter only when records change, not on every playback frame.
  const filtered = useMemo<World | undefined>(
    () => (readerAt === undefined ? undefined : spoilerView(full, readerAt)),
    [readerAt, full.characters, full.places, full.groups, full.memberships, full.stays, full.journeys, full.regions, full.chapters, full.books, full.scenes, full.links, full.manuscripts, full.mapFeatures, full.settings.hemisphereForSeasons], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const world = useMemo(() => (filtered ? { ...filtered, settings: full.settings } : full), [filtered, full]);
  store.readOnly = readerAt !== undefined;
  store.onBlocked = () => void ask.alert("This is the reader's view, so editing is off. Switch the view back to Author to make changes.");
  const ix = useMemo(() => new WorldIndex(world), [world]);
  // Warnings ignore the current moment, so recompute only when records change.
  const recordsKey = useMemo(() => ({ ...world, settings: { ...world.settings, currentMoment: undefined } }), [world.characters, world.places, world.groups, world.memberships, world.stays, world.journeys, world.dismissals, world.settings.disabledRules, world.settings.travelModes, world.settings.radiusKm, world.settings.defaultDetourFactor, world.settings.hemisphereForSeasons, world.terrain, world.mapFeatures, world.settings.biomes, world.settings.axialTiltDeg]); // eslint-disable-line react-hooks/exhaustive-deps
  const warnings = useMemo(() => checkWorld(recordsKey), [recordsKey]);
  const moment = defaultMoment(world, ix);
  const [view, setView] = useState<View>(() => (localStorage.getItem('swt.view') as View) || 'who');
  const [selectedByView, setSelectedByView] = useState<Partial<Record<View, Id>>>({});
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [command, setCommand] = useState(false);
  const [pickFor, setPickFor] = useState<Id | undefined>();
  const [routeFor, setRouteFor] = useState<Id | undefined>();
  const [quick, setQuick] = useState(false);
  const [focusLink, setFocusLink] = useState<Id | undefined>();
  const [mapFocus, setMapFocus] = useState<{ at: LatLng; n: number } | undefined>();
  const [trackRequest, setTrackRequest] = useState<{ id: Id; n: number } | undefined>();

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
    routeFor,
    startRoute: setRouteFor,
    focusLink,
    mapFocus,
    trackRequest,
    showTrack: (id: Id) => {
      setTrackRequest((t) => ({ id, n: (t?.n ?? 0) + 1 }));
      go('map');
    },
    showOnMap: (at: LatLng) => {
      setMapFocus((f) => ({ at, n: (f?.n ?? 0) + 1 }));
      go('map');
    },
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
            {choices.length > 0 && (
              <select className={`reader-select ${readerAt !== undefined ? 'on' : ''}`} value={readerAt ?? ''} onChange={(e) => setAsOf(e.target.value === '' ? undefined : Number(e.target.value))} title="EU-8: show the world as the reader knows it at the end of a chapter or book. Editing is off while this is on.">
                <option value="">Author view</option>
                {choices.map((c, i) => <option key={i} value={c.value}>{c.book ? `Reader: ${c.label}` : `Reader: after ${c.label}`}</option>)}
              </select>
            )}
            <button className="icon" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (Ctrl+Z)">↶</button>
            <button className="icon" disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
            <span className={`save-state ${store.saveState}`} title={store.saveError}>{saveLabel}</span>
            <button onClick={() => setQuick(true)} title="Ctrl+J">Quick add</button>
            <button onClick={() => setCommand(true)} title="Ctrl+K">Search</button>
          </div>
        </header>
        <nav className="sidebar">
          {NAV.map((n) => (
            <button key={n.view} className={view === n.view ? 'active' : ''} onClick={() => go(n.view)} title={n.key ? `Alt+${n.key}` : undefined}>
              {n.label}
              {n.view === 'warnings' && openWarnings > 0 && <span className="badge">{openWarnings}</span>}
            </button>
          ))}
          <div className="sidebar-actions">
            <button onClick={() => setEditor({ kind: 'stay' })}>+ Stay</button>
            <button onClick={() => setEditor({ kind: 'journey' })}>+ Journey</button>
          </div>
        </nav>
        <main className={`main ${readerAt !== undefined ? 'reader-on' : ''}`}>
          {readerAt !== undefined && <div className="reader-banner">Reader's view: only what the reader knows after “{choices.find((c) => c.value === readerAt && !c.book)?.label}”. Editing is off. <button className="link" onClick={() => setAsOf(undefined)}>Back to Author view</button></div>}
          {view === 'who' && <WhoIsWhere />}
          {view === 'timeline' && <Timeline />}
          {view === 'map' && <MapView />}
          {view === 'story' && <Story />}
          {view === 'manuscripts' && <Manuscripts />}
          {view === 'characters' && <Characters />}
          {view === 'places' && <Places />}
          {view === 'layers' && <Layers />}
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
