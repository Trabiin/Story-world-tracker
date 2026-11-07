/**
 * Phase 8a, revise: RV-3 find and replace, RV-1 rename everywhere and RV-2 name typos, RV-4 style
 * checks, RV-5 revision passes and RV-6 the editor's changes from Word. One page, in tabs.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Block, FindHit, World, FindScope, Id, PASS_IDEAS, RenameKind, Review, ReviewDecision, RevisionPass, Run, STYLE_RULES, STYLE_RULE_IDS, SceneReview, StyleRuleId, TextChange,
  addVersion, decideScene, diffParagraphs, docWords, findInWorld, logWords, makeVersion, nameTypos, nameWordSet, outline, passesOf, passProgress, planReplace,
  readDocxRich, reviewDocx, runText, styleOff, styleReport, toggleChapter, withTexts,
} from '../../core';
import { newId, nowIso, recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { RenameEverywhere } from '../components/Rename';
import { useApp } from '../context';
import { ReviseRequest, applyTextChanges, takeReviseRequest, undoTextChanges } from '../revise/actions';

type Tab = 'find' | 'names' | 'style' | 'passes' | 'editor';
const TABS: [Tab, string, string][] = [
  ['find', 'Find & replace', 'RV-3: across a scene, a chapter, a book or the whole series'],
  ['names', 'Names', 'RV-1 rename everywhere, RV-2 names that look misspelt'],
  ['style', 'Style', 'RV-4: repetition, long sentences, adverbs, filter words, overused words'],
  ['passes', 'Passes', 'RV-5: named revision passes with a checklist per chapter'],
  ['editor', "Editor's changes", "RV-6: read back a Word file with an editor's tracked changes and comments"],
];
const TAB_KEY = 'swt.revise.tab';
const BOOK_KEY = 'swt.revise.book';

export function Revise() {
  const { world } = useApp();
  const tree = useMemo(() => outline(world), [world.books, world.chapters, world.scenes]); // eslint-disable-line react-hooks/exhaustive-deps
  const [req] = useState<ReviseRequest | undefined>(() => takeReviseRequest());
  const [tab, setTabState] = useState<Tab>(() => req?.tab ?? (() => { try { return (localStorage.getItem(TAB_KEY) as Tab) || 'find'; } catch { return 'find'; } })());
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  useEffect(() => { if (req) setTab(req.tab); }, [req]);
  const [bookState, setBookState] = useState<Id | undefined>(() => { try { return localStorage.getItem(BOOK_KEY) ?? undefined; } catch { return undefined; } });
  const setBook = (id: Id) => { setBookState(id); try { localStorage.setItem(BOOK_KEY, id); } catch { /* ignore */ } };
  const bookId = tree.some((b) => b.book.id === bookState) ? bookState! : tree[0]?.book.id;

  if (!bookId) return <div className="page narrow"><h1>Revise</h1><p className="muted">Write or import a book first; then find and replace, rename, check style and names, plan revision passes and take in an editor's changes here.</p></div>;
  return (
    <div className="plan-page revise-page">
      <div className="plan-head">
        {tab !== 'find' && tab !== 'names' && tab !== 'editor' && <select value={bookId} onChange={(e) => setBook(e.target.value)} aria-label="Book">{tree.map(({ book: b }) => <option key={b.id} value={b.id}>{b.title}</option>)}</select>}
        <div className="seg">{TABS.map(([t, label, hint]) => <button key={t} className={tab === t ? 'on' : ''} title={hint} onClick={() => setTab(t)}>{label}</button>)}</div>
      </div>
      <div className="plan-body">
        {tab === 'find' && <FindReplace bookId={bookId} req={req?.tab === 'find' ? req : undefined} />}
        {tab === 'names' && <Names req={req?.tab === 'names' ? req : undefined} />}
        {tab === 'style' && <Style bookId={bookId} />}
        {tab === 'passes' && <Passes bookId={bookId} />}
        {tab === 'editor' && <EditorChanges />}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- RV-3 find and replace

function FindReplace({ bookId, req }: { bookId: Id; req?: Extract<ReviseRequest, { tab: 'find' }> }) {
  const { world, store, go } = useApp();
  const tree = useMemo(() => outline(world), [world.books, world.chapters, world.scenes]); // eslint-disable-line react-hooks/exhaustive-deps
  const [query, setQuery] = useState(req?.query ?? '');
  const [replace, setReplace] = useState(req?.replace ?? '');
  const [wholeWord, setWholeWord] = useState(req?.wholeWord ?? true);
  const [matchCase, setMatchCase] = useState(req?.matchCase ?? false);
  const [scopeKey, setScopeKey] = useState<string>(() => (req?.scope?.kind === 'scene' ? `scene:${req.scope.sceneId}` : req?.scope?.kind === 'book' ? `book:${req.scope.bookId}` : 'series'));
  const [off, setOff] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ msg: string; changes: TextChange[] } | undefined>();
  const scope: FindScope = scopeKey === 'series' ? { kind: 'series' } : scopeKey.startsWith('book:') ? { kind: 'book', bookId: scopeKey.slice(5) } : scopeKey.startsWith('chapter:') ? { kind: 'chapter', chapterId: scopeKey.slice(8) } : { kind: 'scene', sceneId: scopeKey.slice(6) };
  const hits = useMemo(() => findInWorld(world, query, { wholeWord, matchCase }, scope), [world.sceneTexts, world.scenes, world.chapters, query, wholeWord, matchCase, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setOff(new Set()), [query, wholeWord, matchCase, scopeKey]);
  const chosen = hits.filter((h) => !off.has(h.key));
  const byScene = useMemo(() => {
    const m = new Map<Id, FindHit[]>();
    for (const h of hits) m.set(h.sceneId, [...(m.get(h.sceneId) ?? []), h]);
    return m;
  }, [hits]);
  const scene = (id: Id) => world.scenes.find((s) => s.id === id);
  const chapter = (id?: Id) => world.chapters.find((c) => c.id === id);
  const toggle = (keys: string[], on: boolean) => { const n = new Set(off); for (const k of keys) { if (on) n.delete(k); else n.add(k); } setOff(n); };

  const run = async () => {
    if (!chosen.length) return;
    const changes = planReplace(store.world, chosen.map((h) => ({ ...h, text: replace })));
    await applyTextChanges(store, changes, `replacing “${query}”`);
    setDone({ msg: `Replaced ${plural(chosen.length, 'match', 'matches')} in ${plural(changes.length, 'scene')}. Each scene keeps a version from before (History).`, changes });
  };
  const undo = () => {
    if (!done) return;
    const n = undoTextChanges(store, done.changes);
    setDone({ msg: n === done.changes.length ? 'Put back as it was.' : `Put back ${n} of ${done.changes.length} scenes; the others have changed since (use their History).`, changes: [] });
  };

  return (
    <div className="revise-find">
      <div className="find-form">
        <label>Find <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setDone(undefined); }} placeholder="Words to find" /></label>
        <label>Replace with <input value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="(nothing removes them)" /></label>
        <div className="row">
          <label className="checkbox small"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words</label>
          <label className="checkbox small"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
          <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} aria-label="Where to look">
            <option value="series">Whole series</option>
            {tree.map((b) => (
              <optgroup key={b.book.id} label={b.book.title}>
                <option value={`book:${b.book.id}`}>All of {b.book.title}</option>
                {b.chapters.map((c) => <option key={c.chapter.id} value={`chapter:${c.chapter.id}`}>{c.chapter.title}</option>)}
                {b.chapters.flatMap((c) => c.scenes).map((s) => <option key={s.id} value={`scene:${s.id}`}>Scene: {s.title}</option>)}
              </optgroup>
            ))}
          </select>
          <span className="spacer" />
          <button className="primary" disabled={!chosen.length || store.readOnly} onClick={() => void run()}>{chosen.length ? `Replace ${plural(chosen.length, 'match', 'matches')}` : 'Replace'}</button>
        </div>
      </div>
      {done && <div className="notice">{done.msg} {done.changes.length > 0 && <button className="link" onClick={undo}>Undo</button>}</div>}
      {query && !hits.length && !done && <p className="muted">No matches{scope.kind !== 'series' ? ' here. Try the whole series.' : '.'}</p>}
      {hits.length > 0 && <p className="muted small">{plural(hits.length, 'match', 'matches')} in {plural(byScene.size, 'scene')}{bookId && scope.kind === 'series' ? '' : ''}. Untick any to leave them as they are.</p>}
      <div className="find-results">
        {[...byScene].map(([sid, list]) => {
          const s = scene(sid);
          const allOn = list.every((h) => !off.has(h.key));
          return (
            <section key={sid} className="find-scene">
              <header>
                <label className="checkbox"><input type="checkbox" checked={allOn} onChange={(e) => toggle(list.map((h) => h.key), e.target.checked)} /></label>
                <button className="link" onClick={() => go('write', sid)}>{s?.title ?? '?'}</button>
                <span className="muted small">{chapter(s?.chapterId)?.title} · {plural(list.length, 'match', 'matches')}</span>
              </header>
              <ul>
                {list.map((h) => (
                  <li key={h.key} className={off.has(h.key) ? 'off' : ''}>
                    <label className="checkbox">
                      <input type="checkbox" checked={!off.has(h.key)} onChange={(e) => toggle([h.key], e.target.checked)} />
                      <span className="ctx">{h.before}{replace || !off.has(h.key) ? <><del className="diff-del">{h.match}</del>{!off.has(h.key) && replace && <ins className="diff-ins">{replace}</ins>}</> : <mark>{h.match}</mark>}{h.after}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- RV-1 rename, RV-2 typos

const KIND_LABEL: Record<RenameKind, string> = { character: 'Characters', place: 'Places', region: 'Realms and regions', group: 'Groups', event: 'Events' };

function Names({ req }: { req?: Extract<ReviseRequest, { tab: 'names' }> }) {
  const { world, store, go } = useApp();
  const typos = useMemo(() => nameTypos(world), [world.sceneTexts, world.characters, world.places, world.regions, world.groups, world.events, world.mapFeatures]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismissed = new Set(world.dismissals.map((d) => d.key));
  const open = typos.filter((t) => !dismissed.has(`name-typo:${t.word}`));
  const ignored = typos.filter((t) => dismissed.has(`name-typo:${t.word}`));
  const [target, setTarget] = useState<{ kind: RenameKind; id: Id } | undefined>(req?.rename);
  const [msg, setMsg] = useState('');
  const [fixed, setFixed] = useState<{ msg: string; changes: TextChange[] } | undefined>();
  const records: { kind: RenameKind; list: { id: Id; name: string }[] }[] = [
    { kind: 'character', list: world.characters.filter((c) => !c.archived) },
    { kind: 'place', list: world.places.filter((p) => !p.isPlaceholder) },
    { kind: 'region', list: world.regions },
    { kind: 'group', list: world.groups },
    { kind: 'event', list: world.events },
  ];
  const fix = async (t: (typeof typos)[number]) => {
    const hits = findInWorld(store.world, t.word, { wholeWord: true, matchCase: true }, { kind: 'series' });
    const changes = planReplace(store.world, hits.map((h) => ({ ...h, text: t.like })));
    await applyTextChanges(store, changes, `changing “${t.word}” to “${t.like}”`);
    setFixed({ msg: `Changed ${plural(hits.length, '“' + t.word + '”', '“' + t.word + '”s')} to “${t.like}” in ${plural(changes.length, 'scene')}.`, changes });
  };
  const notTypo = (t: (typeof typos)[number]) => store.upsert('dismissals', { key: `name-typo:${t.word}`, note: 'Not a typo', at: nowIso() });
  const scene = (id: Id) => world.scenes.find((s) => s.id === id)?.title ?? '?';
  return (
    <div className="revise-names">
      <section>
        <h2>Names that look misspelt <span className="muted small">RV-2</span></h2>
        <p className="muted small">A capitalised word one letter away from a name or alias in the world, that is not a name itself. Words you also use in lower case, and common words that start sentences, are left out.</p>
        {fixed && <div className="notice">{fixed.msg} {fixed.changes.length > 0 && <button className="link" onClick={() => { undoTextChanges(store, fixed.changes); setFixed(undefined); }}>Undo</button>}</div>}
        {!open.length && <p className="muted">None found.</p>}
        <ul className="typo-list">
          {open.map((t) => (
            <li key={t.word}>
              <b className="name-typo">{t.word}</b> <span className="muted">({t.count === 1 ? 'once' : `${t.count} times`})</span> looks like <b>{t.like}</b>{t.name !== t.like && <span className="muted"> ({t.name})</span>}
              <span className="muted small"> in {t.sceneIds.map((id, i) => <span key={id}>{i ? ', ' : ''}<button className="link" onClick={() => go('write', id)}>{scene(id)}</button></span>)}</span>
              {!store.readOnly && <span className="typo-actions"><button onClick={() => void fix(t)}>Change to {t.like}</button><button className="link" onClick={() => notTypo(t)}>Not a typo</button></span>}
            </li>
          ))}
        </ul>
        {ignored.length > 0 && <p className="muted small">Marked as not a typo: {ignored.map((t, i) => <span key={t.word}>{i ? ', ' : ''}{t.word} <button className="link small" onClick={() => store.removeMany([{ c: 'dismissals', id: `name-typo:${t.word}` }])}>undo</button></span>)}</p>}
      </section>
      <section>
        <h2>Rename everywhere <span className="muted small">RV-1</span></h2>
        <p className="muted small">Pick a character, place, realm, group or event, type the new name, and check every mention in every book before it changes.</p>
        <select value={target ? `${target.kind}:${target.id}` : ''} onChange={(e) => { const [k, ...id] = e.target.value.split(':'); setTarget(e.target.value ? { kind: k as RenameKind, id: id.join(':') } : undefined); setMsg(''); }} aria-label="What to rename">
          <option value="">Choose what to rename…</option>
          {records.filter((r) => r.list.length).map((r) => <optgroup key={r.kind} label={KIND_LABEL[r.kind]}>{[...r.list].sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.id} value={`${r.kind}:${x.id}`}>{x.name}</option>)}</optgroup>)}
        </select>
        {msg && <div className="notice">{msg}</div>}
        {target && <RenameEverywhere key={`${target.kind}:${target.id}`} target={target} onDone={(m) => { setMsg(m); setTarget(undefined); }} onCancel={() => setTarget(undefined)} />}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- RV-4 style

function Style({ bookId }: { bookId: Id }) {
  const { world, store, go } = useApp();
  const off = styleOff(world);
  const names = useMemo(() => nameWordSet(world), [world.characters, world.places, world.regions, world.groups, world.events]); // eslint-disable-line react-hooks/exhaustive-deps
  const report = useMemo(() => styleReport(world, bookId, off, names), [world.sceneTexts, world.chapters, world.scenes, bookId, names, world.settings.writing?.styleOff]); // eslint-disable-line react-hooks/exhaustive-deps
  const ws = world.settings.writing ?? {};
  const setWriting = (patch: Partial<NonNullable<typeof ws>>) => store.update((w) => ({ ...w, settings: { ...w.settings, writing: { ...w.settings.writing, ...patch } } }), false);
  const toggleRule = (r: StyleRuleId) => setWriting({ styleOff: off.has(r) ? [...off].filter((x) => x !== r) : [...off, r] });
  const shown = STYLE_RULE_IDS.filter((r) => r !== 'overused' && !off.has(r));
  const per1000 = (n: number, words: number) => (words ? (n * 1000) / words : 0);
  return (
    <div className="revise-style">
      <section className="style-rules">
        <label className="checkbox"><input type="checkbox" checked={!!ws.styleMarks} onChange={(e) => setWriting({ styleMarks: e.target.checked })} /> <b>Show style marks on the Write page</b></label>
        <div className="rule-list">
          {STYLE_RULE_IDS.map((r) => (
            <label key={r} className="checkbox small" title={STYLE_RULES[r].hint}><input type="checkbox" checked={!off.has(r)} onChange={() => toggleRule(r)} /> <span className={`style-key style-${r}`}>{STYLE_RULES[r].name}</span></label>
          ))}
        </div>
        <p className="muted small">Plain rules, no AI: they point at places to look, not mistakes. Switch off any you do not want.</p>
      </section>
      <section>
        <h2>By chapter <span className="muted small">per 1,000 words</span></h2>
        <table className="plan-outline style-table">
          <thead><tr><th>Chapter</th><th className="num">Words</th>{shown.map((r) => <th key={r} className="num" title={STYLE_RULES[r].hint}>{STYLE_RULES[r].name}</th>)}</tr></thead>
          <tbody>
            {report.chapters.map((c) => (
              <tr key={c.chapterId}>
                <td><button className="link" onClick={() => go('write', world.scenes.find((s) => s.chapterId === c.chapterId)?.id ?? c.chapterId)}>{c.title}</button></td>
                <td className="num">{c.words.toLocaleString('en-US')}</td>
                {shown.map((r) => <td key={r} className="num" title={`${c.counts[r]} in this chapter`}>{c.words ? per1000(c.counts[r], c.words).toFixed(1) : '·'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {!off.has('overused') && (
        <section>
          <h2>Overused in this book</h2>
          {report.overused.length ? (
            <ul className="overused">{report.overused.map((o) => <li key={o.word}><b>{o.word}</b> {o.count}× <span className="muted small">({o.per1000.toFixed(1)} per 1,000 words; about {o.limit} is plenty)</span></li>)}</ul>
          ) : <p className="muted">None of the usual crutch words stands out{report.words < 2000 ? ' (there is not much text yet)' : ''}.</p>}
        </section>
      )}
      <section>
        <h2>Most used words</h2>
        <p className="top-words">{report.top.map((t) => <span key={t.word} className="tag">{t.word} <span className="muted">{t.count}</span></span>)}</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- RV-5 passes

function Passes({ bookId }: { bookId: Id }) {
  const { world, store, go } = useApp();
  const passes = passesOf(world, bookId);
  const chapters = outline(world).find((b) => b.book.id === bookId)?.chapters ?? [];
  const add = async (name?: string, note = '') => {
    const n = name ?? (await ask.prompt('Name of the pass (for example "Dialogue" or "Timeline fixes")', ''));
    if (!n?.trim()) return;
    const p: RevisionPass = { ...recordBase(), bookId, name: n.trim(), note, done: [], order: passes.length ? Math.max(...passes.map((x) => x.order)) + 1 : 1 };
    store.upsert('passes', p);
  };
  const set = (p: RevisionPass, patch: Partial<RevisionPass>) => store.upsert('passes', { ...p, ...patch });
  const remove = async (p: RevisionPass) => { if (await ask.confirm(`Delete the pass "${p.name}"?`, { okLabel: 'Delete', danger: true })) store.removeMany([{ c: 'passes', id: p.id }]); };
  const unused = PASS_IDEAS.filter((i) => !passes.some((p) => p.name === i.name));
  return (
    <div className="revise-passes">
      <div className="row">
        <button className="primary" disabled={store.readOnly} onClick={() => void add()}>+ Pass</button>
        {unused.length > 0 && !store.readOnly && <span className="muted small">Ideas: {unused.map((i, k) => <span key={i.name}>{k ? ', ' : ''}<button className="link" title={i.note} onClick={() => void add(i.name, i.note)}>{i.name}</button></span>)}</span>}
      </div>
      {!passes.length ? <p className="muted">No passes yet. A pass is one read through the book looking for one thing; tick each chapter off as you go.</p> : (
        <table className="plan-outline pass-table">
          <thead>
            <tr>
              <th>Chapter</th>
              {passes.map((p) => {
                const pr = passProgress(world, p);
                return (
                  <th key={p.id} className="pass-col">
                    <input className="pass-name" value={p.name} onChange={(e) => set(p, { name: e.target.value })} disabled={store.readOnly} aria-label="Pass name" />
                    <div className="muted small">{pr.done}/{pr.total} <button className="icon small" aria-label="Delete pass" onClick={() => void remove(p)}>×</button></div>
                    <div className="pass-bar"><div style={{ width: `${pr.total ? (pr.done * 100) / pr.total : 0}%` }} /></div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {chapters.map((c) => (
              <tr key={c.chapter.id}>
                <td><button className="link" onClick={() => go('write', c.scenes[0]?.id ?? c.chapter.id)}>{c.chapter.title}</button></td>
                {passes.map((p) => <td key={p.id} className="pass-cell"><input type="checkbox" aria-label={`${p.name}: ${c.chapter.title}`} checked={p.done.includes(c.chapter.id)} disabled={store.readOnly} onChange={() => store.upsert('passes', toggleChapter(p, c.chapter.id))} /></td>)}
              </tr>
            ))}
            <tr className="pass-notes">
              <td className="muted small">What to look for</td>
              {passes.map((p) => <td key={p.id}><textarea rows={3} value={p.note} placeholder="What to look for" disabled={store.readOnly} onChange={(e) => set(p, { note: e.target.value })} /></td>)}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- RV-6 editor's changes

function EditorChanges() {
  const { world, store, platform, go } = useApp();
  const [file, setFile] = useState<{ name: string; review: Review } | undefined>();
  const [error, setError] = useState('');
  const [bring, setBring] = useState(true);
  const [decided, setDecided] = useState<Map<Id, ReviewDecision>>(new Map());
  const [showAll, setShowAll] = useState(false);
  const pick = async () => {
    const f = await platform.pickFile(['.docx']);
    if (!f) return;
    try {
      const content = await readDocxRich(f.bytes, { revisions: true });
      setFile({ name: f.name, review: reviewDocx(store.world, content) });
      setDecided(new Map());
      setError('');
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
  };
  const decide = async (r: SceneReview, d: ReviewDecision) => {
    const t = store.world.sceneTexts.find((x) => x.sceneId === r.sceneId);
    const out = decideScene(r, t?.doc, t?.comments ?? [], d, bring, newId);
    if (d === 'both') {
      const v = await makeVersion(r.sceneId, out.editorDoc, `Editor's version: ${file?.name ?? ''}`.slice(0, 80), true);
      store.update((w) => addVersion(w, v), false);
    }
    const withComments = (w: World): World => ({ ...w, sceneTexts: w.sceneTexts.map((x) => (x.sceneId === r.sceneId ? { ...x, comments: out.comments } : x)) });
    if (!t) {
      if (d === 'accept') store.update((w) => logWords({ ...w, sceneTexts: [...w.sceneTexts, { ...recordBase(), sceneId: r.sceneId, doc: out.doc, words: docWords(out.doc), comments: out.comments }] }, docWords(out.doc)), false);
    } else if (out.doc !== t.doc) {
      await applyTextChanges(store, [{ sceneId: r.sceneId, before: t.doc, after: out.doc }], `the editor's changes (${file?.name ?? 'Word file'})`, withComments);
    } else if (out.comments.length !== (t.comments ?? []).length) store.update(withComments, false);
    setDecided((m) => new Map(m).set(r.sceneId, d));
  };
  const rv = file?.review;
  const changed = rv?.scenes.filter((s) => s.changed || s.comments.length) ?? [];
  const open = changed.filter((s) => !decided.has(s.sceneId));
  const acceptAll = async () => {
    if (!(await ask.confirm(`Accept the editor's changes in all ${open.length} remaining scenes? Each scene keeps a version from before.`, { okLabel: 'Accept all' }))) return;
    for (const s of open) await decide(s, 'accept');
  };
  const DECIDED: Record<ReviewDecision, string> = { accept: 'Accepted', reject: 'Rejected (your text kept)', both: "Kept both (the editor's version is in History)" };
  return (
    <div className="revise-editor">
      <div className="row">
        <button className="primary" onClick={() => void pick()} disabled={store.readOnly}>Open the edited Word file…</button>
        <label className="checkbox small"><input type="checkbox" checked={bring} onChange={(e) => setBring(e.target.checked)} /> Bring the editor's comments in as margin comments</label>
      </div>
      <p className="muted small">Export the book from the Write page (Export), send it to your editor, and open the file they send back here, with their tracked changes and comments. Each scene is shown with what changed; accept, reject or keep both.</p>
      {error && <div className="notice error">{error}</div>}
      {rv && (
        <>
          <div className="notice">
            <b>{file!.name}</b>: {rv.matchedBy === 'none' ? 'no scenes of this world were found in it. Is it a file exported from this app?' : <>
              {plural(changed.length, 'scene')} with changes or comments{rv.scenes.length > changed.length ? `, ${plural(rv.scenes.length - changed.length, 'scene')} unchanged` : ''}.
              {rv.matchedBy === 'chapters' && ' (Found by chapter titles and scene breaks: this file has no scene markers.)'}
              {rv.unplaced.length > 0 && ` Not matched: ${rv.unplaced.join(', ')}.`}
            </>}
            {open.length > 1 && !store.readOnly && <>{' '}<button className="link" onClick={() => void acceptAll()}>Accept all</button></>}
          </div>
          <label className="checkbox small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show unchanged paragraphs too</label>
          {changed.map((s) => {
            const d = decided.get(s.sceneId);
            return (
              <section key={s.sceneId} className={`review-scene ${d ? 'decided' : ''}`}>
                <header>
                  <button className="link" onClick={() => go('write', s.sceneId)}><b>{s.title}</b></button>
                  <span className="muted small">{s.chapterTitle}{s.insertions + s.deletions > 0 && ` · ${plural(s.insertions, 'insertion')}, ${plural(s.deletions, 'deletion')}`}{s.authors.length > 0 && ` by ${s.authors.join(', ')}`}{s.comments.length > 0 && ` · ${plural(s.comments.length, 'comment')}`}{!s.changed && ' · text unchanged'}</span>
                  <span className="spacer" />
                  {d ? <span className="muted small">{DECIDED[d]}</span> : !store.readOnly && (
                    <span className="review-actions">
                      {s.changed && <button className="primary" onClick={() => void decide(s, 'accept')} title="Use the editor's text; your links and comments stay where their words still are">Accept</button>}
                      {s.changed && <button onClick={() => void decide(s, 'reject')} title="Keep your text">Reject</button>}
                      {s.changed && <button onClick={() => void decide(s, 'both')} title="Keep your text, and keep the editor's version in this scene's History to compare or restore">Keep both</button>}
                      {!s.changed && <button onClick={() => void decide(s, 'reject')}>Add the comments</button>}
                    </span>
                  )}
                </header>
                {!d && <ReviewDiff r={s} showAll={showAll} />}
                {!d && s.comments.length > 0 && <ul className="review-comments">{s.comments.map((c) => <li key={c.id}><b>{c.author || 'Editor'}</b>: {c.text}</li>)}</ul>}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

/** The editor's version with tracked changes marked; changes made without tracking show as a word diff against the app's text. */
const textOf = (b: Block) => (b.kind === 'break' ? '* * *' : runText(b.runs));

function ReviewDiff({ r, showAll }: { r: SceneReview; showAll: boolean }) {
  const rows = useMemo(() => {
    const tracked = r.marked.some((b) => b.kind !== 'break' && b.runs.some((x) => x.rev));
    const mine = r.mine.map(textOf), theirs = r.theirs.map(textOf);
    // Untracked differences: compare the app's text with the editor's text with tracked changes undone.
    const original = r.marked.flatMap((b) => (b.kind === 'break' ? ['* * *'] : b.runs.every((x) => x.rev?.kind === 'ins') && b.runs.length ? [] : [b.runs.filter((x) => x.rev?.kind !== 'ins').map((x) => (x.br ? '\n' : x.text)).join('')]));
    const untracked = diffParagraphs(mine, original).some((x) => x.changed);
    return { tracked, untracked, diff: diffParagraphs(mine, theirs) };
  }, [r]);
  if (rows.tracked && !rows.untracked) {
    return (
      <div className="review-text">
        {r.marked.map((b, i) => {
          if (b.kind === 'break') return showAll ? <p key={i} className="center">* * *</p> : null;
          const has = b.runs.some((x) => x.rev);
          if (!has && !showAll) return null;
          return <p key={i} className={has ? '' : 'muted'}>{b.runs.map((x: Run, k) => (x.br ? <br key={k} /> : x.rev?.kind === 'ins' ? <ins key={k} className="diff-ins" title={x.rev.author}>{x.text}</ins> : x.rev?.kind === 'del' ? <del key={k} className="diff-del" title={x.rev.author}>{x.text}</del> : <span key={k}>{x.text}</span>))}</p>;
        })}
      </div>
    );
  }
  return (
    <div className="review-text">
      {rows.untracked && rows.tracked && <p className="muted small">Some changes were made without tracking; this shows every difference from your text.</p>}
      {rows.diff.map((row, i) => {
        if (!row.changed && !showAll) return null;
        return <p key={i} className={row.changed ? '' : 'muted'}>{renderRow(row)}</p>;
      })}
    </div>
  );
}

function renderRow(row: ReturnType<typeof diffParagraphs>[number]) {
  if (row.left && !row.right) return <del className="diff-del">{row.left.map((x) => x.text).join('')}</del>;
  if (row.right && !row.left) return <ins className="diff-ins">{row.right.map((x) => x.text).join('')}</ins>;
  // Changed paragraph: the right side holds eq + ins, the left eq + del; show them merged in order.
  const out: JSX.Element[] = [];
  const l = row.left ?? [], r = row.right ?? [];
  let i = 0, j = 0, k = 0;
  while (i < l.length || j < r.length) {
    if (i < l.length && l[i].op === 'del') { out.push(<del key={k++} className="diff-del">{l[i++].text}</del>); continue; }
    if (j < r.length && r[j].op === 'ins') { out.push(<ins key={k++} className="diff-ins">{r[j++].text}</ins>); continue; }
    if (i < l.length && j < r.length) { out.push(<span key={k++}>{r[j].text}</span>); i++; j++; continue; }
    if (i < l.length) { out.push(<span key={k++}>{l[i++].text}</span>); continue; }
    out.push(<span key={k++}>{r[j++].text}</span>);
  }
  return <>{out}</>;
}

