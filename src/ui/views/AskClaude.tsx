/**
 * AI-3..AI-9: the Ask Claude page. Chat with Claude Code about the world (AI-4), the Suggestions
 * list with before/after previews (AI-3, AI-7, AI-8), the Claude activity log (AI-9) and setup
 * (AI-5, AI-6).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CANON, ClaudeChange, ClaudeSuggestion, DiffRow, Id, World, checkProposal, deleteImpact, diffParagraphs, docParagraphs, formatFuzzy, isClaudeCollection, readDate, recordLabel,
  scenarioView, textOf, type DataCollection,
} from '../../core';
import { ask } from '../components/Dialogs';
import { useApp } from '../context';
import { claudeOpts, acceptInStore, rejectInStore, undoAllInStore, undoEntryInStore } from '../claude/actions';
import { syncNow, useClaudeStatus } from '../claude/ClaudeHub';
import { useStore } from '../store';

type Tab = 'chat' | 'suggestions' | 'activity' | 'setup';
const TAB_KEY = 'swt.claudeTab';

export function AskClaude() {
  const { store, platform } = useApp();
  const stored = useStore(store);
  const c = stored.settings.claude;
  const open = stored.suggestions.filter((s) => s.state === 'open').length;
  const [tab, setTab] = useState<Tab>(() => {
    const t = localStorage.getItem(TAB_KEY) as Tab | null;
    return t ?? (open ? 'suggestions' : c?.enabled ? 'chat' : 'setup');
  });
  const go = (t: Tab) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const shown: Tab = !c?.enabled && (tab === 'chat') ? 'setup' : tab;
  return (
    <div className="page claude-page">
      <div className="page-head">
        <h1>Ask Claude</h1>
        <div className="seg">
          <button className={shown === 'chat' ? 'on' : ''} onClick={() => go('chat')}>Chat</button>
          <button className={shown === 'suggestions' ? 'on' : ''} onClick={() => go('suggestions')}>Suggestions{open ? ` (${open})` : ''}</button>
          <button className={shown === 'activity' ? 'on' : ''} onClick={() => go('activity')}>Activity</button>
          <button className={shown === 'setup' ? 'on' : ''} onClick={() => go('setup')}>Setup</button>
        </div>
      </div>
      {!platform.claude && shown !== 'suggestions' && shown !== 'activity' && <p className="card hint small">This is the browser preview. Claude Code, the Claude folder and the live connector run in the Windows app; the Suggestions list and the activity log work here too.</p>}
      {shown === 'chat' && <Chat />}
      {shown === 'suggestions' && <Suggestions />}
      {shown === 'activity' && <Activity />}
      {shown === 'setup' && <Setup />}
    </div>
  );
}

// ---------------------------------------------------------------- setup (AI-5, AI-6, AI-9)

function Setup() {
  const { store, platform } = useApp();
  const world = useStore(store);
  const c = world.settings.claude;
  const st = useClaudeStatus();
  const p = platform.claude;
  const [version, setVersion] = useState<string>('');
  const [checking, setChecking] = useState(false);
  const check = async () => {
    if (!p) return;
    setChecking(true);
    try { setVersion(await p.version()); } catch (e) { setVersion(`! ${String(e)}`); }
    setChecking(false);
  };
  useEffect(() => { if (c?.enabled) void check(); }, [c?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<NonNullable<typeof c>>) => store.setSettings({ claude: { enabled: false, ...c, ...patch } }, false);
  const turnOn = async () => {
    const folder = c?.folder ?? (p ? await p.defaultFolder(world.settings.name) : undefined);
    set({ enabled: true, folder, token: c?.token ?? `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '') });
  };
  const turnOff = async () => {
    const remove = p && c?.folder ? await ask.confirm(`Switch Claude off for this world? The connector stops answering for it. Also remove the Claude folder (${c.folder})? Only files the app wrote are removed.`, { okLabel: 'Switch off and remove the folder' }) : false;
    if (remove && p && c?.folder) await p.clearFolder(c.folder).catch(() => undefined);
    set({ enabled: false, directEdit: false });
  };
  const changeFolder = async () => {
    const f = await p?.chooseFolder();
    if (!f) return;
    if (c?.folder && p) await p.clearFolder(c.folder).catch(() => undefined);
    set({ folder: f });
  };
  const notFound = version.startsWith('!');
  return (
    <div className="claude-setup">
      <section className="card">
        <h3>Let Claude read this world</h3>
        <p className="small">When this is on, the app keeps a <b>Claude folder</b>: a live, read-only copy of this world as plain files (every scene, a page per character, place and realm, the timeline, the warnings and a guide to how everything fits together). Claude Code reads it like a codebase and asks the app precise questions through a <b>connector</b> on this computer. Claude never changes the world by itself: its changes arrive as <b>suggestions</b> for you to accept or reject.</p>
        <p className="small muted">Claude Code uses your own Claude account. The app itself stays offline; only what Claude reads is sent to Anthropic, by Claude Code. It is off for every world until you switch it on here.</p>
        <div className="row wrap">
          {!c?.enabled ? <button className="primary" onClick={() => void turnOn()}>Switch on for this world</button> : <button onClick={() => void turnOff()}>Switch off</button>}
          {c?.enabled && <span className="claude-pill">Claude can read this world</span>}
        </div>
      </section>
      {c?.enabled && (
        <>
          <section className="card">
            <h3>Claude folder</h3>
            {p ? <>
              <p className="small"><code>{c.folder}</code></p>
              <p className="small muted">{st.syncError ? <span className="error">Could not write it: {st.syncError}</span> : st.lastSync ? `Brought up to date ${st.lastSync}, a moment after each change.` : 'Being written…'}</p>
              <div className="row wrap">
                <button className="small" onClick={() => c.folder && void p.openFolder(c.folder)}>Open folder</button>
                <button className="small" onClick={() => void changeFolder()}>Move it…</button>
                <button className="small" onClick={() => c.folder && void syncNow(store, c.folder, [])}>Write it now</button>
              </div>
            </> : <p className="small muted">In the Windows app it goes to Documents\Story World Tracker\Claude\{world.settings.name}.</p>}
          </section>
          <section className="card">
            <h3>Claude Code</h3>
            {p ? <>
              <p className="small">{checking ? 'Checking…' : notFound ? <>Claude Code was not found on this computer. Install it from <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">code.claude.com</a> (on Windows: the installer, or <code>irm https://claude.ai/install.ps1 | iex</code> in PowerShell), sign in once, then press Check again.</> : version ? <>Installed: {version}. The folder is set up for it: the connector (<code>.mcp.json</code>) and settings that let Claude read the folder and use the connector, and stop it from editing files there.</> : ''}</p>
              <p className="small muted">Connector: {st.connectorError ? <span className="error">{st.connectorError}</span> : st.port ? `listening on this computer only (port ${st.port})${st.requests ? `, ${st.requests} request(s) answered${st.lastTool ? `, last: ${st.lastTool}` : ''}` : ''}.` : 'starting…'}</p>
              <div className="row wrap">
                <button className="small" onClick={() => void check()}>Check again</button>
                <button className="small" disabled={notFound} onClick={() => c.folder && p.openTerminal(c.folder).catch((e) => ask.alert(String(e)))}>Open Claude Code in a terminal</button>
                <button className="small" onClick={() => c.folder && p.openInVsCode(c.folder).catch((e) => ask.alert(String(e)))}>Open in VS Code</button>
              </div>
              <p className="small muted">In VS Code, open the Claude Code panel (or its terminal) in that folder. The first time, Claude Code asks whether to trust the folder and use the "story-world" connector: say yes. The app must be open with this world for the connector to answer.</p>
            </> : <p className="small muted">Desktop only.</p>}
          </section>
          <section className="card">
            <h3>Direct editing</h3>
            <label className="checkbox"><input type="checkbox" checked={!!c.directEdit} onChange={async (e) => {
              const v = e.target.checked;
              if (v && !(await ask.confirm('Let Claude apply its changes itself, without asking first? Every change is still checked, labelled as Claude\'s in version history, listed in the activity log, and can be undone one by one or all at once.', { okLabel: 'Allow direct editing' }))) return;
              set({ directEdit: v });
            }} /> Claude may change this world itself instead of sending suggestions</label>
            <p className="small muted">Off by default. While the reader's view is on, Claude's changes come as suggestions anyway.</p>
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- chat (AI-4)

interface Msg { who: 'you' | 'claude' | 'tool' | 'error'; text: string }

/** One line of `claude -p --output-format stream-json` → messages to show. */
function readLine(line: string, setSession: (s: string) => void): Msg[] {
  let o: Record<string, unknown>;
  try { o = JSON.parse(line); } catch { return []; }
  if (typeof o.session_id === 'string') setSession(o.session_id);
  const content = ((o.message as { content?: unknown[] } | undefined)?.content ?? []) as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
  if (o.type === 'assistant') {
    return content.flatMap((p): Msg[] => {
      if (p.type === 'text' && p.text?.trim()) return [{ who: 'claude', text: p.text }];
      if (p.type === 'tool_use') return [{ who: 'tool', text: toolLabel(p.name ?? '', p.input ?? {}) }];
      return [];
    });
  }
  if (o.type === 'result' && o.is_error) return [{ who: 'error', text: String(o.result ?? 'Claude Code stopped with an error.') }];
  return [];
}

function toolLabel(name: string, input: Record<string, unknown>): string {
  const n = name.replace(/^mcp__story-world__/, '');
  const arg = (k: string) => (typeof input[k] === 'string' ? String(input[k]) : '');
  if (n === 'Read') return `Read ${arg('file_path').split(/[\\/]/).slice(-2).join('/')}`;
  if (n === 'Grep') return `Searched the folder for “${arg('pattern')}”`;
  if (n === 'Glob') return `Listed ${arg('pattern')}`;
  if (n === 'propose_changes') return `Proposed: ${arg('title')}`;
  return `Asked the app: ${n.replace(/_/g, ' ')}${arg('date') ? ` (${arg('date')})` : arg('query') ? ` “${arg('query')}”` : ''}`;
}

function Chat() {
  const { store, platform } = useApp();
  const world = useStore(store);
  const folder = world.settings.claude?.folder;
  const key = `swt.claudeChat.${store.handle.id}`;
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '{}').msgs ?? []; } catch { return []; } });
  const [session, setSession] = useState<string | undefined>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '{}').session; } catch { return undefined; } });
  const [text, setText] = useState('');
  const [run, setRun] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ msgs: msgs.slice(-200), session })); } catch { /* ignore */ } end.current?.scrollIntoView({ block: 'end' }); }, [msgs, session, key]);
  const p = platform.claude;
  const send = async () => {
    const q = text.trim();
    if (!q || !p || !folder || run !== null) return;
    setText('');
    setMsgs((m) => [...m, { who: 'you', text: q }]);
    try {
      const id = await p.ask(folder, q, session, (line) => {
        const out = readLine(line, setSession);
        if (out.length) setMsgs((m) => [...m, ...out]);
      }, (code, error) => {
        setRun(null);
        if (code !== 0 && code !== null) setMsgs((m) => [...m, { who: 'error', text: error.trim() || `Claude Code stopped (code ${code}).` }]);
      });
      setRun(id);
    } catch (e) {
      setMsgs((m) => [...m, { who: 'error', text: String(e) }]);
    }
  };
  return (
    <div className="claude-chat">
      <div className="chat-log">
        {msgs.length === 0 && <div className="empty small">Ask anything about the world or the manuscript: “Where is everyone on 3/5/1042?”, “Which scenes mention the sealed letter?”, “Does Tamsin have time to reach Emberhold?”, “Suggest a river from the Ember Hills to the sea.” Claude reads the Claude folder and asks the app; changes come back as suggestions.</div>}
        {msgs.map((m, i) => <div key={i} className={`chat-msg ${m.who}`}>{m.who === 'tool' ? `· ${m.text}` : m.text}</div>)}
        {run !== null && <div className="chat-msg tool">· Claude is working…</div>}
        <div ref={end} />
      </div>
      <div className="chat-input">
        <textarea value={text} rows={3} placeholder={p ? 'Ask Claude… (Ctrl+Enter to send)' : 'Claude Code runs in the Windows app.'} disabled={!p} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
        <div className="row">
          {run === null ? <button className="primary" disabled={!p || !text.trim()} onClick={() => void send()}>Send</button> : <button onClick={() => p?.stop(run)}>Stop</button>}
          <button className="small" disabled={run !== null} onClick={() => { setMsgs([]); setSession(undefined); }}>New conversation</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- suggestions (AI-3, AI-7, AI-8)

function Suggestions() {
  const { store } = useApp();
  const world = useStore(store);
  const [filter, setFilter] = useState<'open' | 'accepted' | 'rejected'>('open');
  const list = world.suggestions.filter((s) => s.state === filter).slice().reverse();
  const acceptAll = async () => {
    const open = world.suggestions.filter((s) => s.state === 'open');
    if (!(await ask.confirm(`Accept all ${open.length} open suggestions? Each one is checked again against the world as it is now and is one undo step.`, { okLabel: 'Accept all' }))) return;
    const failed: string[] = [];
    for (const s of open) { const e = await acceptInStore(store, store.world.suggestions.find((x) => x.id === s.id)!); if (e) failed.push(`#${s.number} ${s.title}: ${e.join(' | ')}`); }
    if (failed.length) void ask.alert(`Some could not be accepted:\n${failed.join('\n')}`);
  };
  return (
    <div className="claude-suggestions">
      <div className="row wrap">
        <div className="seg">
          {(['open', 'accepted', 'rejected'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)} ({world.suggestions.filter((s) => s.state === f).length})</button>)}
        </div>
        {filter === 'open' && list.length > 1 && <button className="small" onClick={() => void acceptAll()}>Accept all open</button>}
      </div>
      {list.length === 0 && <div className="empty">{filter === 'open' ? 'No suggestions waiting. When Claude proposes a change it appears here, checked and with a preview.' : 'None.'}</div>}
      {list.map((s) => <SuggestionCard key={s.id} s={s} />)}
    </div>
  );
}

const fmtValue = (world: World, v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'string') {
    const hit = findRecord(world, v);
    return hit ? hit.label : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && 'lat' in x)) return `${v.length} points on the map`;
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtValue(world, x)).join(', ') : '—';
  const o = v as Record<string, unknown>;
  if (typeof o.year === 'number' && typeof o.precision === 'string') return formatFuzzy(o as never);
  if (typeof o.lat === 'number' && typeof o.lng === 'number') return `${o.lat.toFixed(2)}, ${o.lng.toFixed(2)}`;
  if ((o.kind === 'character' || o.kind === 'group') && typeof o.id === 'string') return fmtValue(world, o.id);
  return Object.entries(o).filter(([k]) => k !== 'id').map(([k, x]) => `${k}: ${fmtValue(world, x)}`).join('; ');
};
const shown = (world: World, v: unknown) => (typeof v === 'string' && readDate(v) && typeof readDate(v) !== 'string' && /\d/.test(v) && !findRecord(world, v) ? formatFuzzy(readDate(v) as never) : fmtValue(world, v));

function findRecord(world: World, id: string): { c: string; label: string } | undefined {
  for (const c of ['characters', 'places', 'groups', 'events', 'regions', 'regionLayers', 'books', 'chapters', 'scenes', 'threads', 'mapFeatures', 'stays', 'journeys', 'secrets', 'mapLayers']) {
    const r = ((world as unknown as Record<string, { id: Id }[]>)[c] ?? []).find((x) => x.id === id);
    if (r) return { c, label: recordLabel(world, c, r) };
  }
  return undefined;
}

const MAP_COLLECTIONS = ['mapFeatures', 'mapSymbols', 'regions', 'detailMaps'];
export const changeOnMap = (ch: ClaudeChange) => ch.op === 'terrain' || ch.op === 'border' || ('collection' in ch && (MAP_COLLECTIONS.includes(ch.collection) || (ch.collection === 'places' && ((ch.op === 'create' && !!ch.record.location) || (ch.op === 'update' && 'location' in ch.set)))));

function SuggestionCard({ s }: { s: ClaudeSuggestion }) {
  const { store, previewSuggestion } = useApp();
  const stored = useStore(store);
  const pending = s.changes.map((_, i) => i).filter((i) => !(s.acceptedChanges ?? []).includes(i));
  const [picked, setPicked] = useState<Set<number>>(() => new Set(pending));
  const [busy, setBusy] = useState(false);
  // The proposal checked against the world as it is now (it may have changed since Claude sent it).
  const check = useMemo(() => (s.state === 'open' ? checkProposal(stored, { ...s, changes: pending.map((i) => s.changes[i]), asScenario: s.acceptedChanges?.length ? undefined : s.asScenario }, claudeOpts) : null), [stored, s]); // eslint-disable-line react-hooks/exhaustive-deps
  const sid = check?.scenarioId ?? s.scenarioId;
  const before = useMemo(() => scenarioView(stored, s.asScenario && !s.acceptedChanges?.length ? CANON : s.scenarioId), [stored, s]);
  const after = useMemo(() => (check?.result && !check.errors.length ? scenarioView(check.result.world, sid) : undefined), [check, sid]);
  const scenarioName = s.scenarioId !== CANON ? stored.scenarios.find((x) => x.id === s.scenarioId)?.name : undefined;
  const accept = async (only?: number[]) => {
    setBusy(true);
    const errors = await acceptInStore(store, s, only);
    setBusy(false);
    if (errors) void ask.alert(`This suggestion no longer fits the world as it is now:\n${errors.join('\n')}`);
  };
  const reject = async () => {
    const note = await ask.prompt('Reject this suggestion. A note for Claude (optional):', '');
    if (note === null) return;
    rejectInStore(store, s.id, note);
  };
  const anyMap = s.changes.some(changeOnMap);
  return (
    <section className={`card suggestion ${s.state}`}>
      <div className="row wrap suggestion-head">
        <h3>#{s.number} {s.title}</h3>
        {s.asScenario && <span className="tag">What-if scenario: {s.asScenario.name}</span>}
        {scenarioName && <span className="tag">In scenario: {scenarioName}</span>}
        <span className="muted small">{new Date(s.createdAt).toLocaleString()}</span>
      </div>
      {s.reason && <p className="small">{s.reason}</p>}
      {s.state === 'open' && check?.errors.length ? <div className="claude-stale small"><b>No longer fits the world as it is now:</b><ul>{check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div> : null}
      {s.state === 'open' && check && !check.errors.length && check.newWarnings.length > 0 && (
        <div className="claude-warn small"><b>The app's checks would flag:</b><ul>{check.newWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}
      {s.state === 'rejected' && s.note && <p className="small muted">Your note: {s.note}</p>}
      <ol className="changes">
        {s.changes.map((ch, i) => {
          const done = (s.acceptedChanges ?? []).includes(i);
          return (
            <li key={i} className={done ? 'done' : ''}>
              {s.state === 'open' && !done && s.changes.length > 1 && <input type="checkbox" checked={picked.has(i)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(i); else n.delete(i); return n; })} title="Accept this change" />}
              <ChangeView ch={ch} before={before} after={after} ids={check?.result?.ids ?? {}} />
              {done && <span className="muted small"> (accepted)</span>}
            </li>
          );
        })}
      </ol>
      {s.state === 'open' && (
        <div className="row wrap">
          <button className="primary small" disabled={busy || !!check?.errors.length} onClick={() => void accept()}>{s.asScenario && !s.acceptedChanges?.length ? 'Keep as a what-if scenario' : pending.length === s.changes.length ? 'Accept' : 'Accept the rest'}</button>
          {s.changes.length > 1 && picked.size > 0 && picked.size < pending.length && <button className="small" disabled={busy} onClick={() => void accept([...picked])}>Accept {picked.size} selected</button>}
          {anyMap && <button className="small" disabled={!after} onClick={() => previewSuggestion({ suggestionId: s.id })}>Show on map</button>}
          <button className="small" onClick={() => void reject()}>Reject</button>
        </div>
      )}
    </section>
  );
}

const label = (c: string) => ({ characters: 'character', places: 'place', groups: 'group', memberships: 'group membership', stays: 'stay', journeys: 'journey', books: 'book', chapters: 'chapter', scenes: 'scene', threads: 'plot thread', events: 'event', relationships: 'relationship', secrets: 'secret', regionLayers: 'layer', regions: 'region', mapFeatures: 'map feature', mapSymbols: 'map symbol', mapLayers: 'drawing layer', detailMaps: 'detail map', todos: 'to-do' } as Record<string, string>)[c] ?? c;

function ChangeView({ ch, before, after, ids }: { ch: ClaudeChange; before: World; after?: World; ids: Record<string, Id> }) {
  const w = after ?? before;
  if (ch.op === 'create') {
    const id = typeof ch.record.id === 'string' ? ids[ch.record.id] : undefined;
    const rec = id ? ((w as unknown as Record<string, { id: Id }[]>)[ch.collection] ?? []).find((r) => r.id === id) : undefined;
    const name = rec ? recordLabel(w, ch.collection, rec) : String(ch.record.name ?? ch.record.title ?? '');
    return (
      <div className="change"><b>New {label(ch.collection)}</b>{name ? `: ${name}` : ''}
        <table className="table change-table"><tbody>{Object.entries(ch.record).filter(([k]) => k !== 'id').map(([k, v]) => <tr key={k}><td>{k}</td><td>{shown(w, v)}</td></tr>)}</tbody></table>
      </div>
    );
  }
  if (ch.op === 'update') {
    const cur = ((before as unknown as Record<string, Record<string, unknown>[]>)[ch.collection] ?? []).find((r) => r.id === ch.id);
    return (
      <div className="change"><b>Change {label(ch.collection)}</b>: {cur ? recordLabel(before, ch.collection, cur) : ch.id}
        <table className="table change-table"><thead><tr><th>Field</th><th>Now</th><th>Proposed</th></tr></thead><tbody>
          {Object.entries(ch.set).map(([k, v]) => <tr key={k}><td>{k}</td><td className="was">{fmtValue(before, cur?.[k])}</td><td className="will">{v === null ? '(removed)' : shown(w, v)}</td></tr>)}
        </tbody></table>
      </div>
    );
  }
  if (ch.op === 'delete') {
    const cur = ((before as unknown as Record<string, { id: Id }[]>)[ch.collection] ?? []).find((r) => r.id === ch.id);
    const impact = cur && isClaudeCollection(ch.collection) && ch.collection !== 'mapLayers' ? deleteImpact(before, ch.collection as DataCollection, ch.id) : undefined;
    return (
      <div className="change"><b>Delete {label(ch.collection)}</b>: {cur ? recordLabel(before, ch.collection, cur) : ch.id}
        {ch.reassignTo && <span className="small"> (its links move to {fmtValue(before, ch.reassignTo)})</span>}
        {impact && !ch.reassignTo && impact.goes.length > 0 && <div className="small claude-warn">Also deletes: {impact.goes.map((d) => d.label).join(', ')}</div>}
        {impact && !ch.reassignTo && impact.unlinked.length > 0 && <div className="small muted">Unlinks: {impact.unlinked.map((d) => d.label).join(', ')}</div>}
      </div>
    );
  }
  if (ch.op === 'text') {
    const scene = before.scenes.find((x) => x.id === ch.sceneId);
    const rows: DiffRow[] = after ? diffParagraphs(docParagraphs(textOf(before, ch.sceneId)?.doc).map((p) => p.text), docParagraphs(textOf(after, ch.sceneId)?.doc).map((p) => p.text)) : [];
    const changed = rows.filter((r) => r.changed);
    return (
      <div className="change"><b>Scene text</b>: {scene?.title ?? ch.sceneId} <span className="muted small">{ch.find ? '(one passage)' : '(the whole scene)'}</span>
        {changed.length > 0 ? changed.slice(0, 12).map((r, i) => (
          <div key={i} className="history-cols changed">
            <div>{r.left?.map((p, j) => <span key={j} className={`diff-${p.op}`}>{p.text}</span>)}</div>
            <div>{r.right?.map((p, j) => <span key={j} className={`diff-${p.op}`}>{p.text}</span>)}</div>
          </div>
        )) : <p className="small muted">{ch.find ? <>Replace “{ch.find}” with “{ch.replace}”.</> : 'Replaces the whole text.'}</p>}
      </div>
    );
  }
  if (ch.op === 'terrain') {
    const what = [ch.land, ch.heightM !== undefined ? `height ${ch.heightM.toLocaleString('en-GB')} m` : '', ch.terrainType].filter(Boolean).join(', ');
    return <div className="change"><b>Paint the map</b>: {what} {ch.shape === 'area' ? `inside an area of ${ch.points.length} points` : `along a line${ch.widthKm ? ` ${ch.widthKm} km wide` : ''}`}</div>;
  }
  if (ch.op === 'border') {
    const r = before.regions.find((x) => x.id === ch.regionId);
    return <div className="change"><b>Border change</b>: {r?.name ?? ch.regionId} {ch.mode === 'add' ? 'gains' : 'loses'} land{ch.from ? ` from ${shown(before, ch.from)}` : ''}{ch.until ? ` until ${shown(before, ch.until)}` : ''}{ch.mode === 'add' ? (ch.neighbours === 'stop' ? ', stopping at neighbours\' borders' : ', taking it from neighbours') : ''}{ch.note ? `: ${ch.note}` : ''}</div>;
  }
  return <div className="change">{JSON.stringify(ch)}</div>;
}

// ---------------------------------------------------------------- activity (AI-9)

function Activity() {
  const { store } = useApp();
  const world = useStore(store);
  const log = world.claudeLog.slice().reverse();
  const direct = world.claudeLog.filter((e) => e.kind === 'direct' && !e.undone).length;
  const undo = (id: Id) => { const e = undoEntryInStore(store, id); if (e) void ask.alert(e); };
  const undoAll = async () => {
    if (!(await ask.confirm(`Undo all ${direct} change(s) Claude made directly, newest first?`, { okLabel: 'Undo all' }))) return;
    const r = undoAllInStore(store);
    if (r.error) void ask.alert(`Undid ${r.undone}. Then stopped: ${r.error}`);
  };
  return (
    <div className="claude-activity">
      <div className="row wrap">
        <p className="small muted">Everything Claude changed directly and every suggestion you accepted. Each can be undone while the records it touched are as it left them; otherwise use version history (Settings), where Claude's changes are labelled.</p>
        {direct > 0 && <button className="small" onClick={() => void undoAll()}>Undo all of Claude's direct changes ({direct})</button>}
      </div>
      {log.length === 0 && <div className="empty">Nothing yet.</div>}
      <ul className="warnings">
        {log.map((e) => (
          <li key={e.id} className={`info ${e.undone ? 'dismissed' : ''}`}>
            <div><b>{e.kind === 'direct' ? 'Claude changed' : 'You accepted'}:</b> {e.title} <span className="muted small">· {new Date(e.at).toLocaleString()} · {e.touched.length} record(s){e.terrain ? ' and the painted map' : ''}{e.scenarioId !== CANON ? ` · in ${world.scenarios.find((s) => s.id === e.scenarioId)?.name ?? 'a scenario'}` : ''}</span></div>
            {e.undone ? <div className="muted small">Undone.</div> : (
              <div className="row">
                <button className="small" onClick={() => undo(e.id)}>Undo</button>
                {e.terrain && <span className="muted small">The painted map is put back through version history (“Before Claude…”).</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
