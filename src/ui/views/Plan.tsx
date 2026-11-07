/**
 * NT-5 corkboard and outline, NT-6 setups and payoffs, NT-7 structure templates with a pacing strip,
 * NT-8 character arcs. One page per book, in tabs.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Book, CharacterArc, Id, STAGE_COLOR, STAGE_LABEL, Scene, Setup, SETUP_STATE_LABEL, allTemplates, applyTemplate, arcTurnsInOrder, arcsInBook, bookScenes,
  charactersWithoutArc, formatFuzzy, moveScene, outline, pacing, readIndexOf, sceneChoices, scenePov, setupState, setupsIn, stageOf, templateFromBook,
} from '../../core';
import { newId, recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { useApp } from '../context';
import { StageDot, StageSelect } from '../writing/Goals';

type Tab = 'cards' | 'outline' | 'setups' | 'structure' | 'arcs';
const TABS: [Tab, string, string][] = [
  ['cards', 'Corkboard', 'NT-5: an index card per scene; drag to reorder'],
  ['outline', 'Outline', 'NT-5: summary, POV, stage and words per scene'],
  ['setups', 'Setups & payoffs', 'NT-6: clues, promises and planted objects, and where they pay off'],
  ['structure', 'Structure', 'NT-7: a beat sheet over the book, and where each beat falls'],
  ['arcs', 'Character arcs', 'NT-8: where each main character starts and ends, and what turns them'],
];
const TAB_KEY = 'swt.plan.tab';
const BOOK_KEY = 'swt.plan.book';
const DRAG = 'application/x-swt-scene';

export function Plan() {
  const { world, selected } = useApp();
  const tree = useMemo(() => outline(world), [world.books, world.chapters, world.scenes]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTabState] = useState<Tab>(() => { try { return (localStorage.getItem(TAB_KEY) as Tab) || 'cards'; } catch { return 'cards'; } });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const [bookState, setBookState] = useState<Id | undefined>(() => { try { return localStorage.getItem(BOOK_KEY) ?? undefined; } catch { return undefined; } });
  const setBook = (id: Id) => { setBookState(id); try { localStorage.setItem(BOOK_KEY, id); } catch { /* ignore */ } };
  // Opened at a setup or an arc from elsewhere.
  useEffect(() => {
    const s = world.setups.find((x) => x.id === selected);
    const a = world.arcs.find((x) => x.id === selected);
    if (s) setTab('setups');
    if (a) { setTab('arcs'); setBook(a.bookId); }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const bookId = tree.some((b) => b.book.id === bookState) ? bookState! : tree[0]?.book.id;
  const book = world.books.find((b) => b.id === bookId);

  if (!book) return <div className="page narrow"><h1>Plan</h1><p className="muted">Add a book with chapters and scenes first (Write or Books & scenes); then plan it here on cards, in an outline, with setups, a structure and character arcs.</p></div>;
  return (
    <div className="plan-page">
      <div className="plan-head">
        <select value={bookId} onChange={(e) => setBook(e.target.value)} aria-label="Book">{tree.map(({ book: b }) => <option key={b.id} value={b.id}>{b.title}</option>)}</select>
        <div className="seg">{TABS.map(([t, label, hint]) => <button key={t} className={tab === t ? 'on' : ''} title={hint} onClick={() => setTab(t)}>{label}</button>)}</div>
      </div>
      <div className="plan-body">
        {tab === 'cards' && <Corkboard book={book} />}
        {tab === 'outline' && <Outline book={book} />}
        {tab === 'setups' && <Setups book={book} />}
        {tab === 'structure' && <Structure book={book} />}
        {tab === 'arcs' && <Arcs book={book} />}
      </div>
    </div>
  );
}

/** Badges on a card or outline row: setups planted and paid, beats, arc turns. */
function useSceneMarks(bookId: Id) {
  const { world } = useApp();
  return useMemo(() => {
    const m = new Map<Id, { planted: number; paid: number; beats: string[]; turns: string[] }>();
    const get = (id: Id) => m.get(id) ?? m.set(id, { planted: 0, paid: 0, beats: [], turns: [] }).get(id)!;
    for (const s of world.setups) { if (s.setupSceneId) get(s.setupSceneId).planted++; if (s.payoffSceneId) get(s.payoffSceneId).paid++; }
    for (const b of world.books.find((x) => x.id === bookId)?.beats ?? []) if (b.sceneId) get(b.sceneId).beats.push(b.name);
    const name = new Map(world.characters.map((c) => [c.id, c.name]));
    for (const a of world.arcs) if (a.bookId === bookId) for (const t of a.turns) get(t.sceneId).turns.push(name.get(a.characterId) ?? '?');
    return m;
  }, [world.setups, world.books, world.arcs, world.characters, bookId]);
}

function Marks({ id, marks }: { id: Id; marks: ReturnType<typeof useSceneMarks> }) {
  const k = marks.get(id);
  if (!k) return null;
  return (
    <span className="plan-marks">
      {k.beats.map((b) => <span key={b} className="tag beat-tag" title="NT-7: structure beat">{b}</span>)}
      {k.planted > 0 && <span className="tag setup-tag" title="NT-6: setups planted here">◆ {k.planted} setup{k.planted > 1 ? 's' : ''}</span>}
      {k.paid > 0 && <span className="tag payoff-tag" title="NT-6: payoffs here">★ {k.paid} payoff{k.paid > 1 ? 's' : ''}</span>}
      {k.turns.length > 0 && <span className="tag arc-tag" title={`NT-8: turns ${k.turns.join(', ')}`}>↻ {k.turns.join(', ')}</span>}
    </span>
  );
}

// ---------- NT-5 corkboard ----------

function Corkboard({ book }: { book: Book }) {
  const { world, store, ix, go } = useApp();
  const groups = bookScenes(world, book.id);
  const words = useMemo(() => new Map(world.sceneTexts.map((t) => [t.sceneId, t.words])), [world.sceneTexts]);
  const marks = useSceneMarks(book.id);
  const [over, setOver] = useState<string | null>(null);
  const drop = (chapterId: Id, beforeId?: Id) => (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(DRAG);
    setOver(null);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    store.update((w) => moveScene(w, id, chapterId, beforeId));
  };
  const allow = (key: string) => (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.stopPropagation(); setOver(key); } };
  const addScene = (chapterId: Id) => {
    const siblings = world.scenes.filter((s) => s.chapterId === chapterId);
    store.upsert('scenes', { ...recordBase(), chapterId, title: `Scene ${siblings.length + 1}`, order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 1, characterIds: [], summary: '' } as Scene);
  };
  return (
    <div className="corkboard">
      <p className="muted small">Drag a card to move the scene, also into another chapter. Click a title for the scene's details; summaries can be edited on the card.</p>
      {groups.map(({ chapterId, scenes }) => {
        const ch = world.chapters.find((c) => c.id === chapterId)!;
        return (
          <section key={chapterId} className={`cork-lane ${over === `end:${chapterId}` ? 'over' : ''}`} onDragOver={allow(`end:${chapterId}`)} onDragLeave={() => setOver(null)} onDrop={drop(chapterId)}>
            <h3>{ch.title}</h3>
            <div className="cork-cards">
              {scenes.map((s) => {
                const pov = scenePov(world, s);
                return (
                  <article key={s.id} className={`index-card ${over === s.id ? 'over' : ''}`} draggable={!store.readOnly} onDragStart={(e) => { e.dataTransfer.setData(DRAG, s.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={allow(s.id)} onDrop={drop(chapterId, s.id)} style={{ borderTopColor: STAGE_COLOR[stageOf(s)] }}>
                    <header><button className="link" onClick={() => go('story', s.id)}>{s.title}</button><StageDot stage={s.stage} /></header>
                    <textarea value={s.summary} placeholder="What happens…" readOnly={store.readOnly} onChange={(e) => store.upsert('scenes', { ...s, summary: e.target.value })} onMouseDown={(e) => e.stopPropagation()} draggable={false} onDragStart={(e) => e.preventDefault()} />
                    <footer className="muted small">
                      {pov && <span>{ix.characters.get(pov)?.name}</span>}
                      {s.start && <span>{formatFuzzy(s.start)}</span>}
                      <span>{(words.get(s.id) ?? 0).toLocaleString('en-US')} w</span>
                      <button className="link small" onClick={() => go('write', s.id)}>Write</button>
                    </footer>
                    <Marks id={s.id} marks={marks} />
                  </article>
                );
              })}
              {!store.readOnly && <button className="index-card add" onClick={() => addScene(chapterId)}>+ Scene</button>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------- NT-5 outline ----------

function Outline({ book }: { book: Book }) {
  const { world, store, ix, go } = useApp();
  const groups = bookScenes(world, book.id);
  const words = useMemo(() => new Map(world.sceneTexts.map((t) => [t.sceneId, t.words])), [world.sceneTexts]);
  const marks = useSceneMarks(book.id);
  let n = 0;
  const total = groups.reduce((a, g) => a + g.scenes.reduce((b, s) => b + (words.get(s.id) ?? 0), 0), 0);
  return (
    <table className="plan-outline">
      <thead><tr><th>#</th><th>Scene</th><th>Summary</th><th>POV</th><th>When</th><th>Stage</th><th className="num">Words</th></tr></thead>
      <tbody>
        {groups.map(({ chapterId, scenes }) => {
          const ch = world.chapters.find((c) => c.id === chapterId)!;
          const cw = scenes.reduce((a, s) => a + (words.get(s.id) ?? 0), 0);
          return [
            <tr key={chapterId} className="chapter-row"><td colSpan={6}>{ch.title}</td><td className="num">{cw.toLocaleString('en-US')}</td></tr>,
            ...scenes.map((s) => {
              const pov = scenePov(world, s);
              n++;
              return (
                <tr key={s.id}>
                  <td className="muted">{n}</td>
                  <td><button className="link" onClick={() => go('story', s.id)}>{s.title}</button><Marks id={s.id} marks={marks} /></td>
                  <td><textarea rows={2} value={s.summary} placeholder="What happens…" readOnly={store.readOnly} onChange={(e) => store.upsert('scenes', { ...s, summary: e.target.value })} /></td>
                  <td>{pov ? ix.characters.get(pov)?.name : <span className="muted">—</span>}</td>
                  <td className="nowrap">{s.start ? formatFuzzy(s.start) : <span className="muted">undated</span>}</td>
                  <td><StageSelect value={s.stage} onChange={(stage) => store.upsert('scenes', { ...s, stage })} disabled={store.readOnly} compact /></td>
                  <td className="num">{(words.get(s.id) ?? 0).toLocaleString('en-US')}</td>
                </tr>
              );
            }),
          ];
        })}
        <tr className="chapter-row"><td colSpan={6}>Book</td><td className="num">{total.toLocaleString('en-US')}</td></tr>
      </tbody>
    </table>
  );
}

// ---------- NT-6 setups and payoffs ----------

function SceneSelect({ value, onChange, choices, placeholder }: { value?: Id; onChange: (v: Id | undefined) => void; choices: { id: Id; label: string }[]; placeholder: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{placeholder}</option>
      {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  );
}

function Setups({ book }: { book: Book }) {
  const { world, store, selected } = useApp();
  const [scope, setScope] = useState<'book' | 'all'>('book');
  const read = useMemo(() => readIndexOf(world), [world]);
  const choices = useMemo(() => sceneChoices(world), [world]);
  const inBook = useMemo(() => new Set(sceneChoices(world, book.id).map((c) => c.id)), [world, book.id]);
  const list = world.setups
    .filter((s) => scope === 'all' || (!s.setupSceneId && !s.payoffSceneId) || inBook.has(s.setupSceneId!) || inBook.has(s.payoffSceneId!))
    .sort((a, b) => (read.get(a.setupSceneId ?? '') ?? 1e9) - (read.get(b.setupSceneId ?? '') ?? 1e9));
  const set = (s: Setup, p: Partial<Setup>) => store.upsert('setups', { ...s, ...p });
  const add = () => store.upsert('setups', { ...recordBase(), title: 'New setup', kind: 'clue', note: '' } as Setup);
  const remove = async (s: Setup) => { if (await ask.confirm(`Delete the setup “${s.title}”?`, { okLabel: 'Delete', danger: true })) store.removeMany([{ c: 'setups', id: s.id }]); };
  return (
    <div className="plan-setups">
      <div className="row">
        <button className="primary" onClick={add} disabled={store.readOnly}>+ Setup</button>
        <select style={{ flexShrink: 0 }} value={scope} onChange={(e) => setScope(e.target.value as 'book' | 'all')}><option value="book">In this book</option><option value="all">Whole series</option></select>
        <span className="muted small">Plant a clue, a promise or an object, then say where it pays off. A setup with no payoff, or a payoff the reader meets first, shows on the Warnings page. Payoffs can be in a later book.</span>
      </div>
      {list.length === 0 && <p className="muted">No setups yet.</p>}
      {list.map((s) => {
        const st = setupState(s, read);
        return (
          <div key={s.id} className={`setup-row state-${st} ${s.id === selected ? 'selected' : ''}`}>
            <div className="row">
              <input className="grow setup-title" value={s.title} onChange={(e) => set(s, { title: e.target.value })} aria-label="Setup" />
              <select value={s.kind} onChange={(e) => set(s, { kind: e.target.value as Setup['kind'] })}>
                <option value="clue">Clue</option><option value="promise">Promise</option><option value="object">Object</option><option value="foreshadowing">Foreshadowing</option><option value="other">Other</option>
              </select>
              <span className={`setup-state ${st}`}>{SETUP_STATE_LABEL[st]}</span>
              <button className="icon" aria-label="Delete" onClick={() => void remove(s)}>×</button>
            </div>
            <div className="row setup-scenes">
              <label>◆ Planted in <SceneSelect value={s.setupSceneId} choices={choices} placeholder="(no scene yet)" onChange={(v) => set(s, { setupSceneId: v })} /></label>
              <label>★ Paid off in <SceneSelect value={s.payoffSceneId} choices={choices} placeholder="(no payoff yet)" onChange={(v) => set(s, { payoffSceneId: v })} /></label>
            </div>
            <input className="setup-note" value={s.note} placeholder="Notes" onChange={(e) => set(s, { note: e.target.value })} />
          </div>
        );
      })}
    </div>
  );
}

// ---------- NT-7 structure ----------

function Structure({ book }: { book: Book }) {
  const { world, store, go } = useApp();
  const templates = allTemplates(world);
  const [pick, setPick] = useState(templates[0].id);
  const pc = useMemo(() => pacing(world, book.id), [world, book.id]);
  const choices = useMemo(() => sceneChoices(world, book.id), [world, book.id]);
  const setBook = (b: Book) => store.upsert('books', b);
  const apply = async () => {
    const t = templates.find((x) => x.id === pick)!;
    if (book.beats?.length && !(await ask.confirm(`Lay “${t.name}” over ${book.title}? Beats with the same name keep their scene; the others are replaced.`))) return;
    setBook(applyTemplate(book, t, newId));
  };
  const saveTemplate = async () => {
    const name = await ask.prompt('Name for your template:', book.structureName ? `${book.structureName} (mine)` : 'My structure');
    if (!name) return;
    store.setSettings({ structureTemplates: [...(world.settings.structureTemplates ?? []), templateFromBook(book, name, newId())] });
  };
  const beats = book.beats ?? [];
  const setBeat = (id: Id, p: Partial<NonNullable<Book['beats']>[number]>) => setBook({ ...book, beats: beats.map((b) => (b.id === id ? { ...b, ...p } : b)) });
  const chapterTitle = new Map(world.chapters.map((c) => [c.id, c.title]));
  const sceneById = new Map(world.scenes.map((s) => [s.id, s]));
  return (
    <div className="plan-structure">
      <div className="row wrap">
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Template">{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <button className="primary" disabled={store.readOnly} onClick={() => void apply()}>{beats.length ? 'Use this structure' : 'Lay over this book'}</button>
        {beats.length > 0 && <button onClick={() => setBook({ ...book, beats: [...beats, { id: newId(), name: 'New beat', at: 50 }] })}>+ Beat</button>}
        {beats.length > 0 && <button onClick={() => void saveTemplate()} title="Keep these beats as your own template">Save as template</button>}
        {beats.length > 0 && <button className="danger" onClick={() => setBook({ ...book, beats: undefined, structureName: undefined })}>Remove</button>}
        <span className="muted small">Optional. Beats are guides, not rules: put each one at the scene where it happens and see how far it is from where the template expects it.</span>
      </div>
      <PacingStrip pc={pc} titleOf={(id) => sceneById.get(id)?.title ?? '?'} chapterOf={(id) => chapterTitle.get(id) ?? '?'} onScene={(id) => go('story', id)} />
      <p className="muted small">The strip is the book from first to last scene, sized by {pc.byWords ? 'words written' : 'scene (too little text yet to size by words)'} and coloured by writing stage. Beats sit above it where the template puts them and point to where their scene really is.</p>
      {beats.length > 0 && (
        <table className="beats">
          <thead><tr><th>Beat{book.structureName ? ` (${book.structureName})` : ''}</th><th className="num">Template</th><th>Scene</th><th className="num">Falls at</th><th>Notes</th><th /></tr></thead>
          <tbody>
            {[...beats].sort((a, b) => a.at - b.at).map((b) => {
              const p = pc.beats.find((x) => x.beat.id === b.id);
              const off = p?.drift !== undefined && Math.abs(p.drift) >= 10;
              return (
                <tr key={b.id}>
                  <td><input value={b.name} onChange={(e) => setBeat(b.id, { name: e.target.value })} /></td>
                  <td className="num"><input type="number" min={0} max={100} value={b.at} onChange={(e) => setBeat(b.id, { at: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />%</td>
                  <td><SceneSelect value={b.sceneId} choices={choices} placeholder="(not placed)" onChange={(v) => setBeat(b.id, { sceneId: v })} /></td>
                  <td className={`num ${off ? 'warn-text' : ''}`} title={off ? 'Ten points or more from where the template puts it' : undefined}>{p?.actual !== undefined ? `${Math.round(p.actual)}%${p.drift ? ` (${p.drift > 0 ? '+' : ''}${Math.round(p.drift)})` : ''}` : '—'}</td>
                  <td><input value={b.note ?? ''} placeholder={'What happens here'} onChange={(e) => setBeat(b.id, { note: e.target.value || undefined })} /></td>
                  <td><button className="icon" aria-label="Remove beat" onClick={() => setBook({ ...book, beats: beats.filter((x) => x.id !== b.id) })}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** NT-7: the pacing strip. Chapters and scenes along the book, beats above (target) pointing at their scene (actual). */
function PacingStrip({ pc, titleOf, chapterOf, onScene }: { pc: ReturnType<typeof pacing>; titleOf: (id: Id) => string; chapterOf: (id: Id) => string; onScene: (id: Id) => void }) {
  const { world } = useApp();
  const stage = new Map(world.scenes.map((s) => [s.id, stageOf(s)]));
  const W = 1000, top = 58, h = 26;
  const beats = [...pc.beats].sort((a, b) => a.target - b.target);
  return (
    <svg className="pacing-strip" viewBox={`0 0 ${W} 120`} preserveAspectRatio="none" role="img" aria-label="Pacing strip">
      {beats.map((b, i) => {
        const x = (b.target / 100) * W;
        const ax = b.actual !== undefined ? (b.actual / 100) * W : undefined;
        return (
          <g key={b.beat.id} className="beat-mark">
            <title>{`${b.beat.name}: template ${b.target}%${b.actual !== undefined ? `, falls at ${Math.round(b.actual)}%` : ', not placed'}`}</title>
            <line x1={x} x2={x} y1={i % 2 ? 24 : 12} y2={top - 2} className="beat-target" />
            {ax !== undefined && <path d={`M${x} ${top - 2} L${ax} ${top + h + 4}`} className="beat-link" />}
            {ax !== undefined && <circle cx={ax} cy={top + h + 6} r={4} className="beat-actual" />}
            <text x={x} y={i % 2 ? 21 : 9} className="beat-label" textAnchor={b.target > 85 ? 'end' : b.target < 8 ? 'start' : 'middle'}>{b.beat.name}</text>
          </g>
        );
      })}
      {pc.scenes.map((s) => (
        <rect key={s.sceneId} x={(s.start / 100) * W} width={Math.max(0.5, ((s.end - s.start) / 100) * W - 1)} y={top} height={h} fill={STAGE_COLOR[stage.get(s.sceneId) ?? 'idea']} className="pace-scene" onClick={() => onScene(s.sceneId)}>
          <title>{`${titleOf(s.sceneId)} · ${STAGE_LABEL[stage.get(s.sceneId) ?? 'idea']} · ${s.words.toLocaleString('en-US')} words`}</title>
        </rect>
      ))}
      {pc.chapters.map((c) => (
        <g key={c.chapterId}>
          <line x1={(c.start / 100) * W} x2={(c.start / 100) * W} y1={top - 4} y2={top + h + 18} className="pace-chapter" />
          <text x={(c.start / 100) * W + 3} y={top + h + 18} className="pace-chapter-label">{chapterOf(c.chapterId)}</text>
        </g>
      ))}
    </svg>
  );
}

// ---------- NT-8 character arcs ----------

function Arcs({ book }: { book: Book }) {
  const { world, store, selected } = useApp();
  const arcs = arcsInBook(world, book.id);
  const missing = charactersWithoutArc(world, book.id);
  const [who, setWho] = useState('');
  const add = (characterId: Id) => {
    if (!characterId || store.readOnly) return;
    store.upsert('arcs', { ...recordBase(), characterId, bookId: book.id, goalStart: '', goalEnd: '', beliefStart: '', beliefEnd: '', woundStart: '', woundEnd: '', turns: [], notes: '' } as CharacterArc);
    setWho('');
  };
  const name = (id: Id) => world.characters.find((c) => c.id === id)?.name ?? '?';
  const taken = new Set(arcs.map((a) => a.characterId));
  return (
    <div className="plan-arcs">
      <div className="row wrap">
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Character"><option value="">Character…</option>{world.characters.filter((c) => !c.archived && !taken.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="primary" disabled={!who || store.readOnly} onClick={() => add(who)}>+ Arc</button>
        {missing.length > 0 && <span className="muted small">Main characters in this book without an arc: {missing.map((id, i) => <span key={id}>{i ? ', ' : ''}<button className="link" onClick={() => add(id)}>{name(id)}</button></span>)}</span>}
      </div>
      {arcs.length === 0 && <p className="muted">For each main character: what they want, what they believe and what hurts them at the start of the book and at the end, and the scenes that turn them.</p>}
      {arcs.map((a) => <ArcCard key={a.id} arc={a} selected={a.id === selected} />)}
    </div>
  );
}

function ArcCard({ arc, selected }: { arc: CharacterArc; selected: boolean }) {
  const { world, store, go } = useApp();
  const set = (p: Partial<CharacterArc>) => store.upsert('arcs', { ...arc, ...p });
  const choices = useMemo(() => sceneChoices(world, arc.bookId), [world, arc.bookId]);
  const label = new Map(choices.map((c) => [c.id, c.label]));
  const c = world.characters.find((x) => x.id === arc.characterId);
  const row = (title: string, a: keyof CharacterArc, b: keyof CharacterArc, ph: [string, string]) => (
    <div className="arc-row">
      <span className="arc-label">{title}</span>
      <textarea rows={2} value={arc[a] as string} placeholder={ph[0]} onChange={(e) => set({ [a]: e.target.value })} />
      <span className="arc-arrow">→</span>
      <textarea rows={2} value={arc[b] as string} placeholder={ph[1]} onChange={(e) => set({ [b]: e.target.value })} />
    </div>
  );
  const remove = async () => { if (await ask.confirm(`Delete ${c?.name ?? 'this'}'s arc?`, { okLabel: 'Delete', danger: true })) store.removeMany([{ c: 'arcs', id: arc.id }]); };
  return (
    <section className={`arc-card ${selected ? 'selected' : ''}`} style={{ borderLeftColor: c?.color }}>
      <div className="row">
        <h3 className="grow"><button className="link" onClick={() => go('characters', arc.characterId)}>{c?.name ?? '?'}</button></h3>
        <button className="icon" aria-label="Delete arc" onClick={() => void remove()}>×</button>
      </div>
      <div className="arc-cols muted small"><span /><span>Start of the book</span><span /><span>End of the book</span></div>
      {row('Goal', 'goalStart', 'goalEnd', ['What they want', 'What they want now, or got'])}
      {row('Belief', 'beliefStart', 'beliefEnd', ['The belief or lie they start with', 'What they believe at the end'])}
      {row('Wound', 'woundStart', 'woundEnd', ['What hurts them', 'Where that stands at the end'])}
      <div className="arc-turns">
        <b>Turning scenes</b>
        {arcTurnsInOrder(world, arc).map((t) => (
          <div key={t.id} className="row">
            <button className="link nowrap" onClick={() => go('story', t.sceneId)}>{label.get(t.sceneId) ?? '?'}</button>
            <input className="grow" value={t.note} placeholder="What changes in them here" onChange={(e) => set({ turns: arc.turns.map((x) => (x.id === t.id ? { ...x, note: e.target.value } : x)) })} />
            <button className="icon" aria-label="Remove turn" onClick={() => set({ turns: arc.turns.filter((x) => x.id !== t.id) })}>×</button>
          </div>
        ))}
        <select value="" onChange={(e) => { if (e.target.value) set({ turns: [...arc.turns, { id: newId(), sceneId: e.target.value, note: '' }] }); }} aria-label="Add a turning scene">
          <option value="">+ Add a turning scene…</option>
          {choices.filter((x) => !arc.turns.some((t) => t.sceneId === x.id)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </div>
    </section>
  );
}

/** NT-6, NT-7, NT-8 on a scene's page: what it plants and pays off, the beat it carries, who turns in it. */
export function PlanForScene({ sceneId }: { sceneId: Id }) {
  const { world, go } = useApp();
  const { planted, paid } = setupsIn(world, sceneId);
  const beats = world.books.flatMap((b) => (b.beats ?? []).filter((x) => x.sceneId === sceneId).map((x) => x.name));
  const turns = world.arcs.flatMap((a) => a.turns.filter((t) => t.sceneId === sceneId).map((t) => ({ a, t })));
  if (!planted.length && !paid.length && !beats.length && !turns.length) return null;
  const name = (id: Id) => world.characters.find((c) => c.id === id)?.name ?? '?';
  return (
    <section className="plan-for">
      <h2>Plan</h2>
      <ul className="plain">
        {beats.map((b) => <li key={b}><span className="tag beat-tag">{b}</span> structure beat</li>)}
        {planted.map((s) => <li key={s.id}>◆ Plants <button className="link" onClick={() => go('plan', s.id)}>{s.title}</button></li>)}
        {paid.map((s) => <li key={s.id}>★ Pays off <button className="link" onClick={() => go('plan', s.id)}>{s.title}</button></li>)}
        {turns.map(({ a, t }) => <li key={t.id}>↻ Turns <button className="link" onClick={() => go('plan', a.id)}>{name(a.characterId)}</button>{t.note ? `: ${t.note}` : ''}</li>)}
      </ul>
    </section>
  );
}

/** NT-8 on a character's page: their arc in each book. */
export function ArcsForCharacter({ characterId }: { characterId: Id }) {
  const { world, go } = useApp();
  const arcs = world.arcs.filter((a) => a.characterId === characterId);
  if (!arcs.length) return null;
  const book = (id: Id) => world.books.find((b) => b.id === id)?.title ?? '?';
  const pair = (a: string, b: string) => (a || b ? `${a || '?'} → ${b || '?'}` : '');
  return (
    <section className="plan-for">
      <h2>Arcs</h2>
      {arcs.map((a) => (
        <div key={a.id} className="arc-summary">
          <button className="link" onClick={() => go('plan', a.id)}>{book(a.bookId)}</button>
          {[['Goal', pair(a.goalStart, a.goalEnd)], ['Belief', pair(a.beliefStart, a.beliefEnd)], ['Wound', pair(a.woundStart, a.woundEnd)]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="small"><span className="muted">{k}:</span> {v}</div>)}
          {a.turns.length > 0 && <div className="small muted">{a.turns.length} turning scene{a.turns.length > 1 ? 's' : ''}</div>}
        </div>
      ))}
    </section>
  );
}
