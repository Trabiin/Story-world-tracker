import { useCallback, useEffect, useMemo, useState } from 'react';
import { CANON, Id, LatLng, NO_FILTER, TodoRef, ViewFilter, World, WorldIndex, applyFilter, checkWorld, readingChoices, scenarioView, spoilerView, withoutDrafts } from '../core';
import { ViewControls } from './components/ViewControls';
import { ask } from './components/Dialogs';
import { CommandBar } from './components/CommandBar';
import { JourneyEditor, StayEditor } from './components/EntryEditors';
import { MomentBar } from './components/MomentBar';
import { QuickAdd } from './components/QuickAdd';
import { Manuscripts } from './views/Manuscripts';
import { Story } from './views/Story';
import { Ctx, EditorTarget, FixPreview, View } from './context';
import { MapView } from './map/MapView';
import type { Platform } from './platform';
import { WorldStore, useStore } from './store';
import { defaultMoment } from './util';
import { Characters } from './views/Characters';
import { Groups } from './views/Groups';
import { Events } from './views/Events';
import { People } from './views/People';
import { Places } from './views/Places';
import { Layers } from './views/Layers';
import { Settings } from './views/Settings';
import { Timeline } from './views/Timeline';
import { Warnings } from './views/Warnings';
import { WhoIsWhere } from './views/WhoIsWhere';
import { Home } from './views/Home';
import { SearchPage } from './views/SearchPage';
import { Todos } from './views/Todos';
import { Write } from './views/Write';
import { AskClaude } from './views/AskClaude';
import { Notebook } from './views/Notebook';
import { Plan } from './views/Plan';
import { Revise } from './views/Revise';
import { Finish } from './views/Finish';
import { QuickCapture } from './components/QuickCapture';
import { ClaudeHub } from './claude/ClaudeHub';
import type { ClaudePreview } from './context';

const NAV: { view: View; label: string; key: string }[] = [
  { view: 'home', label: 'Home', key: '' },
  { view: 'who', label: 'Who is where', key: '1' },
  { view: 'timeline', label: 'Timeline', key: '2' },
  { view: 'map', label: 'Map', key: '3' },
  { view: 'write', label: 'Write', key: '' },
  { view: 'notes', label: 'Notebook', key: '' },
  { view: 'plan', label: 'Plan', key: '' },
  { view: 'revise', label: 'Revise', key: '' },
  { view: 'finish', label: 'Finish', key: '' },
  { view: 'story', label: 'Books & scenes', key: '4' },
  { view: 'manuscripts', label: 'Manuscripts', key: '5' },
  { view: 'characters', label: 'Characters', key: '6' },
  { view: 'events', label: 'Events & secrets', key: '' },
  { view: 'people', label: 'Meetings & tools', key: '' },
  { view: 'places', label: 'Places', key: '7' },
  { view: 'layers', label: 'Realms & layers', key: '' },
  { view: 'groups', label: 'Groups', key: '8' },
  { view: 'warnings', label: 'Warnings', key: '9' },
  { view: 'todos', label: 'To-dos', key: '' },
  { view: 'claude', label: 'Ask Claude', key: '' },
  { view: 'settings', label: 'Settings', key: '0' },
];

export function App({ store, platform, onClose }: { store: WorldStore; platform: Platform; onClose: () => void }) {
  const stored = useStore(store);
  // ST-7: the active what-if scenario; VW-7: the filter all views share. Both are remembered per world.
  const prefKey = `swt.view.${store.handle.id}`;
  const [prefs, setPrefs] = useState<{ scenarioId: Id; filter: ViewFilter }>(() => {
    try { const v = JSON.parse(localStorage.getItem(prefKey) ?? 'null'); if (v?.filter) return v; } catch { /* ignore */ }
    return { scenarioId: CANON, filter: NO_FILTER };
  });
  const savePrefs = (p: typeof prefs) => { setPrefs(p); try { localStorage.setItem(prefKey, JSON.stringify(p)); } catch { /* ignore */ } };
  const scenarioId = prefs.scenarioId !== CANON && !stored.scenarios.some((x) => x.id === prefs.scenarioId) ? CANON : prefs.scenarioId;
  store.scenarioId = scenarioId;
  const scenarioWorld = useMemo(() => scenarioView(stored, scenarioId), [stored, scenarioId]);
  const full = useMemo(() => (prefs.filter.drafts === 'hide' ? withoutDrafts(scenarioWorld) : scenarioWorld), [scenarioWorld, prefs.filter.drafts]);
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
    [readerAt, full.characters, full.places, full.groups, full.memberships, full.stays, full.journeys, full.regions, full.chapters, full.books, full.scenes, full.links, full.manuscripts, full.mapFeatures, full.events, full.relationships, full.secrets, full.settings.hemisphereForSeasons], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const unfiltered = useMemo(() => (filtered ? { ...filtered, settings: full.settings } : full), [filtered, full]);
  const world = useMemo(() => applyFilter(unfiltered, { ...prefs.filter, drafts: 'show' }), [unfiltered, prefs.filter]);
  store.readOnly = readerAt !== undefined;
  store.onBlocked = () => void ask.alert("This is the reader's view, so editing is off. Switch the view back to Author to make changes.");
  const ix = useMemo(() => new WorldIndex(world), [world]);
  // Warnings ignore the current moment, so recompute only when records change.
  const u = unfiltered;
  const recordsKey = useMemo(() => ({ ...u, settings: { ...u.settings, currentMoment: undefined } }), [u.characters, u.places, u.groups, u.memberships, u.stays, u.journeys, u.dismissals, u.settings.disabledRules, u.settings.travelModes, u.settings.radiusKm, u.settings.defaultDetourFactor, u.settings.hemisphereForSeasons, u.terrain, u.mapFeatures, u.settings.biomes, u.settings.axialTiltDeg, u.settings.winds, u.settings.settlementWaterKm, u.scenes, u.chapters, u.events, u.secrets, u.settings.travelModifiers, u.regions, u.setups, u.books]); // eslint-disable-line react-hooks/exhaustive-deps
  // Warnings cover the whole (scenario) world; the VW-7 filter narrows which ones show.
  const allWarnings = useMemo(() => checkWorld(recordsKey), [recordsKey]);
  const shownChars = useMemo(() => new Set(world.characters.map((c) => c.id)), [world.characters]);
  const warnings = useMemo(() => (world === unfiltered ? allWarnings : allWarnings.filter((w) => !w.characterId || shownChars.has(w.characterId))), [allWarnings, shownChars, world, unfiltered]);
  const moment = defaultMoment(world, ix);
  const [view, setView] = useState<View>(() => (localStorage.getItem('swt.view') as View) || 'home');
  const [selectedByView, setSelectedByView] = useState<Partial<Record<View, Id>>>({});
  const [editor, setEditorState] = useState<EditorTarget | null>(null);
  // Each opening gets a fresh editor, so "Duplicate" can open a copy from inside an editor (EU-3).
  const [editorN, setEditorN] = useState(0);
  const setEditor = useCallback((t: EditorTarget | null) => { setEditorN((n) => n + 1); setEditorState(t); }, []);
  const [command, setCommand] = useState(false);
  const [pickFor, setPickFor] = useState<Id | undefined>();
  const [routeFor, setRouteFor] = useState<Id | undefined>();
  const [quick, setQuick] = useState(false);
  const [capture, setCapture] = useState(false);
  const [focusLink, setFocusLink] = useState<Id | undefined>();
  const [mapFocus, setMapFocus] = useState<{ at: LatLng; n: number } | undefined>();
  const [trackRequest, setTrackRequest] = useState<{ id: Id; n: number } | undefined>();
  const [fixPreview, setFixPreview] = useState<FixPreview | undefined>();
  const [claudePreview, setClaudePreview] = useState<ClaudePreview | undefined>();

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
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); setCapture(true); }
      else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommand(true); }
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
  const openTodos = world.todos.filter((t) => !t.done).length;
  const inboxNotes = world.notes.filter((n) => n.inbox).length;
  const openSuggestions = stored.suggestions.filter((x) => x.state === 'open').length;
  const ctx = {
    store, world, ix, warnings, platform, moment, view, go,
    scenarioId,
    setScenario: (id: Id) => savePrefs({ ...prefs, scenarioId: id }),
    filter: prefs.filter,
    setFilter: (f: ViewFilter) => savePrefs({ ...prefs, filter: f }),
    unfiltered,
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
    fixPreview,
    previewFix: (p: FixPreview | undefined) => {
      setFixPreview(p);
      if (p) {
        if (p.at) setMapFocus((f) => ({ at: p.at!, n: (f?.n ?? 0) + 1 }));
        go('map');
      }
    },
    claudePreview,
    previewSuggestion: (p: ClaudePreview | undefined) => {
      setClaudePreview(p);
      if (p) go('map');
    },
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
          <ViewControls />
          <div className="topbar-right">
            {stored.settings.claude?.enabled && <button className="claude-pill" onClick={() => go('claude')} title="AI-6: Claude can read this world (through the Claude folder and the connector). Only what Claude reads is sent to Anthropic.">Claude on</button>}
            {choices.length > 0 && (
              <select className={`reader-select ${readerAt !== undefined ? 'on' : ''}`} value={readerAt ?? ''} onChange={(e) => setAsOf(e.target.value === '' ? undefined : Number(e.target.value))} title="EU-8: show the world as the reader knows it at the end of a chapter or book. Editing is off while this is on.">
                <option value="">Author view</option>
                {choices.map((c, i) => <option key={i} value={c.value}>{c.book ? `Reader: ${c.label}` : `Reader: after ${c.label}`}</option>)}
              </select>
            )}
            <button className="icon" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (Ctrl+Z)">↶</button>
            <button className="icon" disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
            <span className={`save-state ${store.saveState}`} title={store.saveError}>{saveLabel}</span>
            <button onClick={() => setCapture(true)} title="NT-3: jot down a note (Ctrl+Shift+N). It lands in the Notebook's Inbox.">Note</button>
            <button onClick={() => setQuick(true)} title="Ctrl+J">Quick add</button>
            <button onClick={() => setCommand(true)} title="Ctrl+K">Search</button>
          </div>
        </header>
        <nav className="sidebar">
          {NAV.map((n) => (
            <button key={n.view} className={view === n.view ? 'active' : ''} onClick={() => go(n.view)} title={n.key ? `Alt+${n.key}` : undefined}>
              {n.label}
              {n.view === 'warnings' && openWarnings > 0 && <span className="badge">{openWarnings}</span>}
              {n.view === 'todos' && openTodos > 0 && <span className="count">{openTodos}</span>}
              {n.view === 'notes' && inboxNotes > 0 && <span className="count" title="Notes in the Inbox, waiting to be sorted">{inboxNotes}</span>}
              {n.view === 'claude' && openSuggestions > 0 && <span className="count claude-count" title="Suggestions waiting">{openSuggestions}</span>}
            </button>
          ))}
          <div className="sidebar-actions">
            <button onClick={() => setEditor({ kind: 'stay' })}>+ Stay</button>
            <button onClick={() => setEditor({ kind: 'journey' })}>+ Journey</button>
          </div>
        </nav>
        <main className={`main ${readerAt !== undefined ? 'reader-on' : ''}`}>
          {scenarioId !== CANON && <div className="scenario-banner">What if: <b>{stored.scenarios.find((x) => x.id === scenarioId)?.name}</b>. Changes you make now stay in this scenario; canon is untouched. <button className="link" onClick={() => savePrefs({ ...prefs, scenarioId: CANON })}>Back to canon</button></div>}
          {readerAt !== undefined && <div className="reader-banner">Reader's view: only what the reader knows after “{choices.find((c) => c.value === readerAt && !c.book)?.label}”. Editing is off. <button className="link" onClick={() => setAsOf(undefined)}>Back to Author view</button></div>}
          {view === 'home' && <Home />}
          {view === 'search' && <SearchPage />}
          {view === 'todos' && <Todos />}
          {view === 'who' && <WhoIsWhere />}
          {view === 'timeline' && <Timeline />}
          {view === 'map' && <MapView />}
          {view === 'write' && <Write />}
          {view === 'notes' && <Notebook />}
          {view === 'plan' && <Plan />}
          {view === 'revise' && <Revise />}
          {view === 'finish' && <Finish />}
          {view === 'story' && <Story />}
          {view === 'manuscripts' && <Manuscripts />}
          {view === 'characters' && <Characters />}
          {view === 'places' && <Places />}
          {view === 'layers' && <Layers />}
          {view === 'groups' && <Groups />}
          {view === 'events' && <Events />}
          {view === 'people' && <People />}
          {view === 'warnings' && <Warnings />}
          {view === 'settings' && <Settings />}
          {view === 'claude' && <AskClaude />}
        </main>
        {editor?.kind === 'stay' && <StayEditor key={editorN} id={editor.id} preset={editor.preset} onClose={() => setEditor(null)} />}
        {editor?.kind === 'journey' && <JourneyEditor key={editorN} id={editor.id} preset={editor.preset} onClose={() => setEditor(null)} />}
        {command && <CommandBar onClose={() => setCommand(false)} />}
        {quick && <QuickAdd onClose={() => setQuick(false)} />}
        {capture && <QuickCapture about={captureAbout(world, view, selectedByView[view])} onClose={() => setCapture(false)} />}
        <ClaudeHub />
      </div>
    </Ctx.Provider>
  );
}

/** NT-3: what a quick note is about by default: the record open on the current page. */
function captureAbout(w: World, view: View, id: Id | undefined): TodoRef | undefined {
  if (!id) return undefined;
  const has = (list: { id: Id }[]) => list.some((x) => x.id === id);
  const kind: TodoRef['kind'] | undefined =
    view === 'characters' ? 'character' : view === 'places' ? 'place' : view === 'groups' ? 'group' : view === 'layers' ? 'region'
    : view === 'events' ? (has(w.events) ? 'event' : has(w.secrets) ? 'secret' : undefined)
    : view === 'story' || view === 'write' ? (has(w.scenes) ? 'scene' : has(w.chapters) ? 'chapter' : has(w.books) ? 'book' : has(w.threads) ? 'thread' : undefined)
    : view === 'notes' ? (has(w.notes) ? 'note' : has(w.attachments) ? 'file' : undefined)
    : view === 'plan' ? (has(w.setups) ? 'setup' : has(w.arcs) ? 'arc' : undefined)
    : undefined;
  return kind ? { kind, id } : undefined;
}
