/**
 * WR-9 the story sidebar beside the page: the scene's date, place, season and moon, who is present
 * and where each is staying, where the rest of the cast is, and the warnings about the scene.
 * WR-12 its Goals tab: today's words, the daily goal, the book's goal and deadline, the calendar.
 */
import { useMemo, useState } from 'react';
import { Id, MOON_ICON, Scene, bookProgress, dayKey, sceneContext, seriesDashboard, wordCounts } from '../../core';
import { useOpenRef } from '../components/Refs';
import { useApp } from '../context';
import { DayInput, GoalBar, StageSelect, WritingCalendar, deadlineText } from './Goals';

const n = (x: number) => x.toLocaleString('en-US');
const TAB_KEY = 'swt.write.sidebarTab';

export function StorySidebar({ sceneId, bookId, onClose }: { sceneId?: Id; bookId?: Id; onClose: () => void }) {
  const [tab, setTabState] = useState<'scene' | 'goals'>(() => { try { return localStorage.getItem(TAB_KEY) === 'goals' ? 'goals' : 'scene'; } catch { return 'scene'; } });
  const setTab = (t: 'scene' | 'goals') => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  return (
    <aside className="story-sidebar" aria-label="Story sidebar">
      <div className="story-tabs">
        <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')} title="WR-9: the world around this scene">Scene</button>
        <button className={tab === 'goals' ? 'on' : ''} onClick={() => setTab('goals')} title="WR-12: word counts and goals">Goals</button>
        <span className="spacer" />
        <button className="icon" onClick={onClose} title="Hide the story sidebar">×</button>
      </div>
      <div className="story-body">
        {tab === 'scene' ? <SceneTab sceneId={sceneId} /> : <GoalsTab bookId={bookId} />}
      </div>
    </aside>
  );
}

function SceneTab({ sceneId }: { sceneId?: Id }) {
  const { world, ix, warnings, store, go } = useApp();
  const open = useOpenRef();
  const ctx = useMemo(() => (sceneId ? sceneContext(ix, sceneId, warnings) : undefined), [ix, sceneId, warnings]);
  if (!ctx) return <p className="muted">Click into a scene to see the world around it.</p>;
  const s = ctx.scene;
  const set = (p: Partial<Scene>) => store.upsert('scenes', { ...s, ...p });
  const name = (id: Id) => ix.characters.get(id)?.name ?? '?';
  const place = (id?: Id) => (id ? ix.places.get(id)?.name ?? '?' : undefined);
  const cast = ctx.elsewhere.reduce((k, g) => k + g.characterIds.length, 0);
  return (
    <div className="story-scene">
      <div className="story-title">
        <button className="link" onClick={() => go('story', s.id)} title="Edit date, place, POV and who is present">{s.title}</button>
        <StageSelect value={s.stage} onChange={(stage) => set({ stage })} disabled={store.readOnly} compact />
      </div>
      <dl className="story-facts">
        <dt>When</dt>
        <dd>{ctx.dateLabel ?? <span className="muted">No date yet. <button className="link" onClick={() => go('story', s.id)}>Set one</button></span>}</dd>
        <dt>Where</dt>
        <dd>
          {ctx.placeId ? <button className="link" onClick={() => open({ kind: 'place', id: ctx.placeId! })}>{place(ctx.placeId)}</button> : <span className="muted">Not known</span>}
          {ctx.placeId && ctx.placeDerived && <span className="muted small"> · from the POV's stay</span>}
        </dd>
        {ctx.season && <><dt>Season</dt><dd>{ctx.season}</dd></>}
        {ctx.moon && <><dt>Moon</dt><dd><span aria-hidden>{MOON_ICON[ctx.moon.phase]}</span> {ctx.moon.label}{ctx.moon.name ? ` (${ctx.moon.name})` : ''}</dd></>}
      </dl>

      <h3>Present <span className="muted small">{ctx.present.length}</span></h3>
      {ctx.present.length === 0 ? <p className="muted small">Nobody yet. Add the POV and cast on the scene's page.</p> : (
        <ul className="plain story-list">
          {ctx.present.map((p) => (
            <li key={p.id}>
              <button className="link" onClick={() => open({ kind: 'character', id: p.id })}>{name(p.id)}</button>
              {p.pov && <span className="tag">POV</span>}
              {p.where && <div className={`small ${p.elsewhere ? 'warn-text' : 'muted'}`}>{p.elsewhere ? '⚠ ' : ''}{p.where}{p.elsewhere ? `, not ${place(ctx.placeId)}` : ''}</div>}
            </li>
          ))}
        </ul>
      )}

      {ctx.day !== undefined && (
        <>
          <h3>Everyone else <span className="muted small">{cast}</span></h3>
          {ctx.elsewhere.length === 0 ? <p className="muted small">Nobody else in the cast on this date.</p> : (
            <ul className="plain story-list elsewhere">
              {ctx.elsewhere.map((g) => (
                <li key={(g.travelling ? 'to:' : '') + (g.placeId ?? 'unknown')}>
                  <div className="small">{g.placeId ? <button className="link" onClick={() => open({ kind: 'place', id: g.placeId! })}>{g.label}</button> : <span className="muted">{g.label}</span>}</div>
                  <div className="names">
                    {g.characterIds.map((id, i) => <span key={id}>{i > 0 && ', '}<button className="link" onClick={() => open({ kind: 'character', id })}>{name(id)}</button></span>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h3>Warnings <span className="muted small">{ctx.warnings.length}</span></h3>
      {ctx.warnings.length === 0 ? <p className="muted small">Nothing about this scene or the people in it.</p> : (
        <ul className="plain story-list">
          {ctx.warnings.slice(0, 8).map((w) => <li key={w.key} className="small"><span className={w.severity === 'warning' ? 'warn-text' : 'muted'}>{w.severity === 'warning' ? '⚠' : 'ⓘ'}</span> {w.message}</li>)}
          <li><button className="link small" onClick={() => go('warnings')}>All warnings</button></li>
        </ul>
      )}
      {!!world.todos.filter((t) => !t.done && t.refs.some((r) => r.kind === 'scene' && r.id === s.id)).length && (
        <p className="small"><button className="link" onClick={() => go('story', s.id)}>Open to-dos for this scene</button></p>
      )}
    </div>
  );
}

function GoalsTab({ bookId }: { bookId?: Id }) {
  const { world, store } = useApp();
  const today = dayKey();
  const dash = useMemo(() => seriesDashboard(world, today), [world, today]);
  const counts = useMemo(() => wordCounts(world), [world.sceneTexts, world.scenes, world.chapters, world.books]); // eslint-disable-line react-hooks/exhaustive-deps
  const book = bookId ? bookProgress(world, bookId, today, counts) : undefined;
  const ws = world.settings.writing ?? {};
  const setGoal = (v: string) => store.setSettings({ writing: { ...ws, dailyGoal: Math.max(0, Math.round(Number(v) || 0)) || undefined } });
  const setBook = (p: { wordGoal?: number; deadline?: string }) => book && store.upsert('books', { ...book.book, ...p });
  return (
    <div className="story-goals">
      <h3>Today</h3>
      <div className="goal-row"><b>{n(Math.max(0, dash.today))}</b> <span className="muted">{dash.dailyGoal ? `of ${n(dash.dailyGoal)} words` : 'words'}</span></div>
      {dash.dailyGoal ? <GoalBar value={dash.today} goal={dash.dailyGoal} /> : null}
      <label className="field-inline small">Daily goal <input type="number" min={0} step={50} value={ws.dailyGoal ?? ''} placeholder="none" onChange={(e) => setGoal(e.target.value)} disabled={store.readOnly} /> words</label>
      {dash.streak > 0 && <p className="small">{dash.streak} {dash.streak === 1 ? 'day' : 'days'} in a row{dash.dailyGoal ? ' at your goal' : ''}.</p>}

      {book && (
        <>
          <h3>{book.book.title}</h3>
          <div className="goal-row"><b>{n(book.words)}</b> <span className="muted">{book.goal ? `of ${n(book.goal)} words (${Math.round((book.fraction ?? 0) * 100)}%)` : 'words'}</span></div>
          {book.goal ? <GoalBar value={book.words} goal={book.goal} /> : null}
          <label className="field-inline small">Goal <input type="number" min={0} step={1000} value={book.book.wordGoal ?? ''} placeholder="none" onChange={(e) => setBook({ wordGoal: Math.max(0, Math.round(Number(e.target.value) || 0)) || undefined })} disabled={store.readOnly} /> words</label>
          <label className="field-inline small">Deadline <DayInput value={book.book.deadline} onChange={(deadline) => setBook({ deadline })} disabled={store.readOnly} /></label>
          {book.deadline && <p className={`small ${book.daysLeft !== undefined && book.daysLeft < 0 ? 'warn-text' : 'muted'}`}>{deadlineText(book)}</p>}
        </>
      )}

      <h3>Series</h3>
      <p className="small">{n(dash.words)} words in {dash.books.length} {dash.books.length === 1 ? 'book' : 'books'}.</p>

      <h3>Words per day</h3>
      <WritingCalendar world={world} weeks={15} />
    </div>
  );
}
