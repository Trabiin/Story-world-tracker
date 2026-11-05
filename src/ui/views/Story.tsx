/** ST-1, ST-2: series → books → chapters → scenes, with POV and in-world dates. */
import { useMemo } from 'react';
import { Book, Chapter, Id, Scene, formatFuzzy, outline, scenePlace, scenePov } from '../../core';
import { recordBase } from '../../storage';
import { Backlinks } from '../components/Backlinks';
import { DateInput } from '../components/DateInput';
import { ask } from '../components/Dialogs';
import { Field } from '../components/Modal';
import { PlaceSelect } from '../components/Pickers';
import { useApp } from '../context';
import { placePath, sortByName } from '../util';

export function Story() {
  const { world, store, selected, select } = useApp();
  const tree = useMemo(() => outline(world), [world]);
  const nextOrder = (list: { order: number }[]) => (list.length ? Math.max(...list.map((x) => x.order)) + 1 : 1);
  const addBook = () => {
    const b: Book = { ...recordBase(), title: `Book ${world.books.length + 1}`, order: nextOrder(world.books), notes: '' };
    store.upsert('books', b);
    select(b.id);
  };
  const addChapter = (bookId: Id) => {
    const siblings = world.chapters.filter((c) => c.bookId === bookId);
    const c: Chapter = { ...recordBase(), bookId, title: `Chapter ${siblings.length + 1}`, order: nextOrder(siblings), notes: '' };
    store.upsert('chapters', c);
    select(c.id);
  };
  const addScene = (chapterId: Id) => {
    const siblings = world.scenes.filter((s) => s.chapterId === chapterId);
    const s: Scene = { ...recordBase(), chapterId, title: `Scene ${siblings.length + 1}`, order: nextOrder(siblings), characterIds: [], summary: '' };
    store.upsert('scenes', s);
    select(s.id);
  };
  const book = world.books.find((b) => b.id === selected);
  const chapter = world.chapters.find((c) => c.id === selected);
  const scene = world.scenes.find((s) => s.id === selected);
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools"><button className="primary" onClick={addBook}>+ New book</button></div>
        <ul className="list outline">
          {tree.map(({ book: b, chapters }) => (
            <li key={b.id} className="outline-group">
              <div className={`outline-item book ${b.id === selected ? 'active' : ''}`} onClick={() => select(b.id)}>{b.title}</div>
              {chapters.map(({ chapter: c, scenes }) => (
                <div key={c.id}>
                  <div className={`outline-item chapter ${c.id === selected ? 'active' : ''}`} onClick={() => select(c.id)}>{c.title}</div>
                  {scenes.map((s) => (
                    <div key={s.id} className={`outline-item scene ${s.id === selected ? 'active' : ''} ${s.status === 'draft' ? 'draft' : ''}`} onClick={() => select(s.id)}>
                      {s.title} {s.start && <span className="muted small">{formatFuzzy(s.start)}</span>}
                    </div>
                  ))}
                  <button className="link add-line scene" onClick={() => addScene(c.id)}>+ scene</button>
                </div>
              ))}
              <button className="link add-line chapter" onClick={() => addChapter(b.id)}>+ chapter</button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="detail">
        {book && <BookDetail key={book.id} b={book} />}
        {chapter && <ChapterDetail key={chapter.id} c={chapter} />}
        {scene && <SceneDetail key={scene.id} s={scene} />}
        {!book && !chapter && !scene && <div className="empty">Add a book, then its chapters and scenes. Give each scene an in-world date and a POV character, and its place follows from where that character is.</div>}
      </section>
    </div>
  );
}

function Reorder({ list, item, collection }: { list: { id: Id; order: number }[]; item: { id: Id; order: number }; collection: 'books' | 'chapters' | 'scenes' }) {
  const { store, world } = useApp();
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((x) => x.id === item.id);
  const swap = (j: number) => {
    const other = sorted[j];
    if (!other) return;
    store.update((w) => ({
      ...w,
      [collection]: (w[collection] as { id: Id; order: number }[]).map((x) => (x.id === item.id ? { ...x, order: other.order } : x.id === other.id ? { ...x, order: item.order } : x)),
    }));
  };
  void world;
  return (
    <span className="row">
      <button className="icon" disabled={i <= 0} onClick={() => swap(i - 1)} title="Move up">↑</button>
      <button className="icon" disabled={i >= sorted.length - 1} onClick={() => swap(i + 1)} title="Move down">↓</button>
    </span>
  );
}

function CharacterSelect({ value, onChange, none = '(none)' }: { value?: Id; onChange: (id?: Id) => void; none?: string }) {
  const { world } = useApp();
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{none}</option>
      {sortByName(world.characters.filter((c) => !c.archived || c.id === value)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function BookDetail({ b }: { b: Book }) {
  const { world, store, select } = useApp();
  const set = (p: Partial<Book>) => store.upsert('books', { ...b, ...p });
  const remove = async () => {
    const chapters = world.chapters.filter((c) => c.bookId === b.id);
    const scenes = world.scenes.filter((s) => chapters.some((c) => c.id === s.chapterId));
    if (!(await ask.confirm(`Delete ${b.title} with its ${chapters.length} chapter(s) and ${scenes.length} scene(s)? Manuscript files are not affected.`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'books', id: b.id }, ...chapters.map((c) => ({ c: 'chapters' as const, id: c.id })), ...scenes.map((s) => ({ c: 'scenes' as const, id: s.id }))]);
    select(undefined);
  };
  return (
    <div className="page narrow">
      <div className="page-head"><h1>{b.title}</h1><div className="row"><Reorder list={world.books} item={b} collection="books" /><button className="danger" onClick={remove}>Delete</button></div></div>
      <div className="form-grid">
        <Field label="Title"><input value={b.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Notes"><textarea rows={6} value={b.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      <Backlinks kind="book" id={b.id} title="Linked" />
    </div>
  );
}

function ChapterDetail({ c }: { c: Chapter }) {
  const { world, store, select } = useApp();
  const set = (p: Partial<Chapter>) => store.upsert('chapters', { ...c, ...p });
  const siblings = world.chapters.filter((x) => x.bookId === c.bookId);
  const scenes = world.scenes.filter((s) => s.chapterId === c.id).sort((a, b) => a.order - b.order);
  const remove = async () => {
    if (!(await ask.confirm(`Delete ${c.title} and its ${scenes.length} scene(s)?`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'chapters', id: c.id }, ...scenes.map((s) => ({ c: 'scenes' as const, id: s.id }))]);
    select(undefined);
  };
  return (
    <div className="page narrow">
      <div className="page-head"><h1>{c.title}</h1><div className="row"><Reorder list={siblings} item={c} collection="chapters" /><button className="danger" onClick={remove}>Delete</button></div></div>
      <div className="form-grid">
        <Field label="Title"><input value={c.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Book">
          <select value={c.bookId} onChange={(e) => set({ bookId: e.target.value })}>
            {world.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </Field>
        <Field label="POV character" hint="Scenes use this unless they name their own."><CharacterSelect value={c.povCharacterId} onChange={(povCharacterId) => set({ povCharacterId })} /></Field>
        <Field label="Notes"><textarea rows={4} value={c.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
      {scenes.length > 0 && (
        <>
          <h2>Scenes</h2>
          <ul className="plain">{scenes.map((s) => <li key={s.id}><button className="link" onClick={() => select(s.id)}>{s.title}</button>{s.start && <span className="muted"> · {formatFuzzy(s.start)}</span>}</li>)}</ul>
        </>
      )}
      <Backlinks kind="chapter" id={c.id} title="Linked" />
    </div>
  );
}

function SceneDetail({ s }: { s: Scene }) {
  const { world, store, ix, select, go } = useApp();
  const set = (p: Partial<Scene>) => store.upsert('scenes', { ...s, ...p });
  const siblings = world.scenes.filter((x) => x.chapterId === s.chapterId);
  const pov = scenePov(world, s);
  const place = scenePlace(ix, s);
  const remove = async () => {
    if (!(await ask.confirm(`Delete ${s.title}?`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'scenes', id: s.id }]);
    select(undefined);
  };
  return (
    <div className="page narrow">
      <div className="page-head"><h1>{s.title}</h1><div className="row"><Reorder list={siblings} item={s} collection="scenes" /><button className="danger" onClick={remove}>Delete</button></div></div>
      <div className="form-grid">
        <Field label="Title"><input value={s.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Chapter">
          <select value={s.chapterId} onChange={(e) => set({ chapterId: e.target.value })}>
            {outline(world).flatMap(({ book, chapters }) => chapters.map(({ chapter }) => <option key={chapter.id} value={chapter.id}>{book.title} · {chapter.title}</option>))}
          </select>
        </Field>
        <Field label="In-world date" hint="Start, and an end if the scene spans time.">
          <div className="row wrap">
            <DateInput value={s.start} onChange={(start) => set({ start })} />
            <span className="muted">to</span>
            <DateInput value={s.end} onChange={(end) => set({ end })} placeholder="(same)" />
          </div>
        </Field>
        <Field label="POV character" hint={!s.povCharacterId && pov ? `From the chapter: ${ix.characters.get(pov)?.name}` : undefined}>
          <CharacterSelect value={s.povCharacterId} onChange={(povCharacterId) => set({ povCharacterId })} none="(chapter's POV)" />
        </Field>
        <Field label="Where" hint={place.derived ? (place.placeId ? `From ${ix.characters.get(pov!)?.name}'s stay: ${placePath(ix, place.placeId)}` : pov && s.start ? 'The POV character has no stay on this date.' : 'Set a date and POV to work it out, or choose a place.') : 'Chosen for this scene (overrides the POV stay).'}>
          <PlaceSelect world={world} value={s.placeId} onChange={(placeId) => set({ placeId })} allowNone="(where the POV character is)" />
        </Field>
        <Field label="Also present">
          <div className="row wrap">
            {s.characterIds.map((id) => (
              <span className="chip" key={id}>
                <button className="link" onClick={() => go('characters', id)}>{ix.characters.get(id)?.name ?? '?'}</button>
                <button className="icon" onClick={() => set({ characterIds: s.characterIds.filter((x) => x !== id) })}>×</button>
              </span>
            ))}
            <select value="" onChange={(e) => e.target.value && set({ characterIds: [...s.characterIds, e.target.value] })}>
              <option value="">+ add…</option>
              {sortByName(world.characters.filter((c) => !c.archived && !s.characterIds.includes(c.id))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Summary"><textarea rows={5} value={s.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>
        <label className="checkbox"><input type="checkbox" checked={s.status === 'draft'} onChange={(e) => set({ status: e.target.checked ? 'draft' : 'canon' })} /> Draft (not yet canon)</label>
      </div>
      <Backlinks kind="scene" id={s.id} title="Linked passages" />
    </div>
  );
}
