/**
 * WR-1..WR-3, WR-8: write the manuscript in the app. One book reads as a continuous document,
 * scene after scene; each scene is its own editor. Focus mode fills the screen.
 */
import type { EditorView } from 'prosemirror-view';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Book, Chapter, Id, RefKind, Scene, SceneText, TextComment, docToBlocks, formatFuzzy, outline, refLabel, removeCommentMarks, runText, scenePov, worldWords } from '../../core';
import { nowIso, recordBase } from '../../storage';
import { useApp } from '../context';
import { ExportDialog } from '../writing/ExportDialog';
import { HistoryPanel } from '../writing/HistoryPanel';
import { ImportDialog } from '../writing/ImportDialog';
import { SceneEditor, TextInfo, commands } from '../writing/SceneEditor';
import { Selection } from 'prosemirror-state';

const PAGE_KEY = 'swt.write.book';
const words = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'word' : 'words'}`;

export function Write() {
  const { world, store, selected, select, go, platform } = useApp();
  const tree = useMemo(() => outline(world), [world.books, world.chapters, world.scenes]); // eslint-disable-line react-hooks/exhaustive-deps
  const ws = world.settings.writing ?? {};
  const theme = ws.page ?? 'light';
  const size = ws.textSize ?? 18;
  const sceneOf = (id?: Id) => world.scenes.find((s) => s.id === id);
  const chapterOf = (id?: Id) => world.chapters.find((c) => c.id === id);
  const [bookIdState, setBookIdState] = useState<Id | undefined>(() => { try { return localStorage.getItem(PAGE_KEY) ?? undefined; } catch { return undefined; } });
  const selScene = sceneOf(selected);
  const selBookId = selScene ? chapterOf(selScene.chapterId)?.bookId : world.books.some((b) => b.id === selected) ? selected : undefined;
  const bookId = selBookId ?? (tree.some((b) => b.book.id === bookIdState) ? bookIdState : tree[0]?.book.id);
  const setBook = (id: Id) => { setBookIdState(id); try { localStorage.setItem(PAGE_KEY, id); } catch { /* ignore */ } select(id); };
  const book = tree.find((b) => b.book.id === bookId);

  const [focus, setFocus] = useState(false);
  const [historyFor, setHistoryFor] = useState<Id | undefined>();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [active, setActive] = useState<Id | undefined>();
  const views = useRef(new Map<Id, EditorView>());
  const activeView = useRef<EditorView | null>(null);
  const [, setTick] = useState(0);

  // WR-8: names never get the red underline. Recomputed only when names change.
  const nameKey = [world.characters, world.places, world.regions, world.events, world.groups, world.mapFeatures];
  const wordSet = useMemo(() => worldWords(world), nameKey); // eslint-disable-line react-hooks/exhaustive-deps
  const worldRef = useRef(world);
  worldRef.current = world;
  const label = useCallback((kind: string, id: Id) => refLabel(worldRef.current, kind as RefKind, id), []);

  const setWriting = (patch: Partial<NonNullable<typeof ws>>) => store.setSettings({ writing: { ...ws, ...patch } }, false);

  const enterFocus = (on: boolean) => {
    setFocus(on);
    void platform.setFullscreen?.(on);
    setTimeout(() => activeView.current?.focus(), 50);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'F11') { e.preventDefault(); enterFocus(!focus); }
      else if (e.key === 'Escape' && focus && !document.querySelector('.modal-backdrop')) enterFocus(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (focus) void platform.setFullscreen?.(false); }, [focus, platform]);

  // Jump to the scene chosen elsewhere (search, Books & scenes, a backlink).
  useEffect(() => {
    if (!selScene) return;
    const el = document.getElementById(`scene-${selScene.id}`);
    el?.scrollIntoView({ block: 'start' });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFocus = useCallback((sceneId: Id, v: EditorView) => { activeView.current = v; setActive(sceneId); }, []);
  const register = useCallback((sceneId: Id, v: EditorView | null) => { if (v) views.current.set(sceneId, v); else views.current.delete(sceneId); }, []);
  const order = useMemo(() => (book ? book.chapters.flatMap((c) => c.scenes.map((s) => s.id)) : []), [book]);
  const onNav = useCallback((sceneId: Id, dir: 'prev' | 'next') => {
    const i = order.indexOf(sceneId);
    const target = order[dir === 'next' ? i + 1 : i - 1];
    const v = target && views.current.get(target);
    if (!v) return;
    v.focus();
    v.dispatch(v.state.tr.setSelection(dir === 'next' ? Selection.atStart(v.state.doc) : Selection.atEnd(v.state.doc)).scrollIntoView());
  }, [order]);

  const run = (cmd: (s: EditorView['state'], d?: EditorView['dispatch'], v?: EditorView) => boolean) => {
    const v = activeView.current;
    if (!v || store.readOnly) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  };

  const nextOrder = (list: { order: number }[]) => (list.length ? Math.max(...list.map((x) => x.order)) + 1 : 1);
  const addScene = (chapterId: Id) => {
    const siblings = world.scenes.filter((s) => s.chapterId === chapterId);
    const s: Scene = { ...recordBase(), chapterId, title: `Scene ${siblings.length + 1}`, order: nextOrder(siblings), characterIds: [], summary: '' };
    store.upsert('scenes', s);
    setTimeout(() => { document.getElementById(`scene-${s.id}`)?.scrollIntoView({ block: 'center' }); views.current.get(s.id)?.focus(); }, 80);
  };
  const addChapter = (bId: Id) => {
    const siblings = world.chapters.filter((c) => c.bookId === bId);
    const c: Chapter = { ...recordBase(), bookId: bId, title: `Chapter ${siblings.length + 1}`, order: nextOrder(siblings), notes: '' };
    const s: Scene = { ...recordBase(), chapterId: c.id, title: 'Scene 1', order: 1, characterIds: [], summary: '' };
    store.update((w) => ({ ...w, chapters: [...w.chapters, c], scenes: [...w.scenes, s] }));
    setTimeout(() => document.getElementById(`scene-${s.id}`)?.scrollIntoView({ block: 'center' }), 80);
  };
  const startBook = () => {
    const b: Book = { ...recordBase(), title: world.books.length ? `Book ${world.books.length + 1}` : 'Book 1', order: nextOrder(world.books), notes: '' };
    const c: Chapter = { ...recordBase(), bookId: b.id, title: 'Chapter 1', order: 1, notes: '' };
    const s: Scene = { ...recordBase(), chapterId: c.id, title: 'Scene 1', order: 1, characterIds: [], summary: '' };
    store.update((w) => ({ ...w, books: [...w.books, b], chapters: [...w.chapters, c], scenes: [...w.scenes, s] }));
    setBook(b.id);
  };

  const textBy = useMemo(() => new Map(world.sceneTexts.map((t) => [t.sceneId, t])), [world.sceneTexts]);
  const countScene = (id: Id) => textBy.get(id)?.words ?? 0;
  const activeScene = sceneOf(active);
  const activeChapter = book?.chapters.find((c) => c.chapter.id === activeScene?.chapterId);
  const bookWords = book ? book.chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + countScene(s.id), 0), 0) : 0;

  if (!tree.length) {
    return (
      <div className="page narrow">
        <div className="page-head"><h1>Write</h1></div>
        <p>Write your manuscript here, scene by scene. The text is saved in the world file as you type, and every scene keeps its own history.</p>
        <div className="row">
          <button className="primary" onClick={startBook}>Start a book</button>
          <button onClick={() => setImporting(true)}>Import from Word…</button>
        </div>
        {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(id) => setBook(id)} />}
      </div>
    );
  }

  return (
    <div className={`write-page ${focus ? 'focus' : ''} write-${theme}`} style={{ ['--write-size' as string]: `${size}px` }}>
      {!focus && (
        <aside className="write-outline">
          <div className="master-tools">
            <select value={bookId} onChange={(e) => setBook(e.target.value)} aria-label="Book">
              {tree.map(({ book: b }) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <div className="row">
              <button onClick={() => setImporting(true)} title="WR-4: bring in a Word file, split into chapters and scenes">Import…</button>
              <button onClick={() => setExporting(true)} title="WR-5: manuscript format or a reading copy">Export…</button>
            </div>
          </div>
          <ul className="list outline write-tree">
            {book?.chapters.map(({ chapter: c, scenes }) => (
              <li key={c.id} className="outline-group">
                <div className="outline-item chapter" onClick={() => document.getElementById(`chapter-${c.id}`)?.scrollIntoView({ block: 'start' })}>{c.title}</div>
                {scenes.map((s) => (
                  <div key={s.id} className={`outline-item scene ${s.id === active ? 'active' : ''}`} onClick={() => { document.getElementById(`scene-${s.id}`)?.scrollIntoView({ block: 'start' }); views.current.get(s.id)?.focus(); }}>
                    {s.title} <span className="muted small">{countScene(s.id) || ''}</span>
                  </div>
                ))}
                <button className="link add-line scene" onClick={() => addScene(c.id)}>+ scene</button>
              </li>
            ))}
            {book && <li><button className="link add-line chapter" onClick={() => addChapter(book.book.id)}>+ chapter</button></li>}
          </ul>
        </aside>
      )}
      <div className="write-main">
        <div className="write-toolbar" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
          <button className="icon" title="Bold (Ctrl+B)" onClick={() => run(commands.bold)}><b>B</b></button>
          <button className="icon" title="Italics (Ctrl+I)" onClick={() => run(commands.italic)}><i>I</i></button>
          <select value="" onChange={(e) => { const v = e.target.value; if (v) run(v === 'p' ? commands.paragraph : commands.heading(Number(v))); }} title="Paragraph or heading (Ctrl+Alt+0 to 3)" aria-label="Paragraph style">
            <option value="">Style…</option>
            <option value="p">Text</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
          <button title="Scene break (Ctrl+Enter, or type ***)" onClick={() => run(commands.sceneBreak)}>* * *</button>
          <button className="icon" title="Undo typing (Ctrl+Z)" onClick={() => run(commands.undo)}>↶</button>
          <button className="icon" title="Redo typing (Ctrl+Y)" onClick={() => run(commands.redo)}>↷</button>
          <span className="write-counts muted small" title="Words in this scene · chapter · book">
            {activeScene ? `Scene ${countScene(activeScene.id).toLocaleString('en-US')} · ` : ''}{activeChapter ? `chapter ${activeChapter.scenes.reduce((n, s) => n + countScene(s.id), 0).toLocaleString('en-US')} · ` : ''}book {words(bookWords)}
          </span>
          <span className="spacer" />
          <select value={theme} onChange={(e) => setWriting({ page: e.target.value as 'light' | 'sepia' | 'dark' })} title="Page colour" aria-label="Page colour">
            <option value="light">Light page</option><option value="sepia">Sepia page</option><option value="dark">Dark page</option>
          </select>
          <button className="icon" title="Smaller text" onClick={() => setWriting({ textSize: Math.max(12, size - 1) })}>A−</button>
          <button className="icon" title="Larger text" onClick={() => setWriting({ textSize: Math.min(32, size + 1) })}>A+</button>
          <label className="checkbox small" title="WR-3: keep the line you are typing in the middle of the screen"><input type="checkbox" checked={!!ws.typewriter} onChange={(e) => setWriting({ typewriter: e.target.checked })} /> Typewriter</label>
          <button disabled={!active} onClick={() => setHistoryFor(active)} title="WR-6: this scene's versions">History</button>
          <button className={focus ? 'primary' : ''} onClick={() => enterFocus(!focus)} title="Focus mode (F11, Esc to leave)">{focus ? 'Leave focus' : 'Focus'}</button>
        </div>
        <div className={`write-scroll ${ws.typewriter ? 'typewriter' : ''}`}>
          <div className="write-sheet">
            {book && <div className="write-book-title">{book.book.title}</div>}
            {book?.chapters.map(({ chapter: c, scenes }) => (
              <section key={c.id} className="write-chapter" id={`chapter-${c.id}`}>
                <h1 className="write-chapter-title">{c.title}</h1>
                {scenes.map((s, i) => (
                  <SceneBlock key={s.id} scene={s} first={i === 0} text={textBy.get(s.id)} wordSet={wordSet} label={label} spelling={ws.spelling ?? 'en-GB'} typewriter={!!ws.typewriter}
                    onFocus={onFocus} onNav={onNav} register={register} onHistory={() => setHistoryFor(s.id)} onDetails={() => go('story', s.id)} active={s.id === active} onChange={() => setTick((n) => n + 1)} />
                ))}
                {!focus && <button className="link write-add" onClick={() => addScene(c.id)}>+ New scene in {c.title}</button>}
              </section>
            ))}
            {book && !focus && <button className="link write-add" onClick={() => addChapter(book.book.id)}>+ New chapter</button>}
          </div>
        </div>
      </div>
      {historyFor && sceneOf(historyFor) && <HistoryPanel sceneId={historyFor} view={views.current.get(historyFor)} onClose={() => setHistoryFor(undefined)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(id) => setBook(id)} />}
      {exporting && book && <ExportDialog bookId={book.book.id} onClose={() => setExporting(false)} />}
    </div>
  );
}

interface BlockProps {
  scene: Scene;
  first: boolean;
  text: SceneText | undefined;
  wordSet: Set<string>;
  label: TextInfo['label'];
  spelling: string;
  typewriter: boolean;
  active: boolean;
  onFocus: (id: Id, v: EditorView) => void;
  onNav: (id: Id, dir: 'prev' | 'next') => void;
  register: (id: Id, v: EditorView | null) => void;
  onHistory: () => void;
  onDetails: () => void;
  onChange: () => void;
}

/** One scene on the page: a thin header, then its editor (made when it scrolls near, so long books stay quick). */
function SceneBlock(p: BlockProps) {
  const { world, store, ix } = useApp();
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setMounted(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setMounted(true); }, { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);
  const comments = p.text?.comments;
  const info = useMemo<TextInfo>(() => ({ words: p.wordSet, comments: new Map((comments ?? []).map((c) => [c.id, c])), label: p.label }), [p.wordSet, comments, p.label]);
  const pov = scenePov(world, p.scene);
  const removeComment = (c: TextComment) => {
    store.update((w) => ({
      ...w,
      sceneTexts: w.sceneTexts.map((t) => (t.sceneId === p.scene.id ? { ...t, doc: removeCommentMarks(t.doc, c.id), comments: (t.comments ?? []).filter((x) => x.id !== c.id), updatedAt: nowIso() } : t)),
    }), false);
  };
  return (
    <div className={`write-scene ${p.active ? 'active' : ''}`} id={`scene-${p.scene.id}`} ref={ref}>
      {!p.first && <div className="write-scene-gap" aria-hidden>* * *</div>}
      <div className="write-scene-head">
        <button className="link" onClick={p.onDetails} title="Date, place, POV and who is present">{p.scene.title}</button>
        {p.scene.start && <span>{formatFuzzy(p.scene.start)}</span>}
        {pov && <span>POV {ix.characters.get(pov)?.name}</span>}
        <span>{(p.text?.words ?? 0).toLocaleString('en-US')} words</span>
        <button className="link" onClick={p.onHistory}>History</button>
      </div>
      {mounted ? (
        <SceneEditor store={store} sceneId={p.scene.id} text={p.text} readOnly={store.readOnly} info={info} spelling={p.spelling} typewriter={p.typewriter}
          onFocus={p.onFocus} onNav={p.onNav} register={p.register} onChange={p.onChange} />
      ) : (
        <StaticText text={p.text} />
      )}
      {!!comments?.length && (
        <ul className="write-comments">
          {comments.map((c) => (
            <li key={c.id}><b>{c.author || 'Comment'}</b>{c.date && <span className="muted small"> · {new Date(c.date).toLocaleDateString()}</span>}: {c.text} <button className="link small" onClick={() => removeComment(c)}>Remove</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The scene drawn as plain HTML until its editor is made. */
function StaticText({ text }: { text: SceneText | undefined }) {
  const blocks = docToBlocks(text?.doc);
  return (
    <div className="scene-editor">
      <div className="prose">
        {blocks.length === 0 && <p />}
        {blocks.map((b, i) => (b.kind === 'break' ? <div key={i} className="scene-break">* * *</div> : b.kind === 'heading' ? <h2 key={i}>{runText(b.runs)}</h2> : <p key={i}>{runText(b.runs)}</p>))}
      </div>
    </div>
  );
}

