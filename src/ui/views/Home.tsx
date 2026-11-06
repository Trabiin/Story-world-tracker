/** EU-15: the home page: what changed lately, what needs attention, and what is still loose. SR-1: the series dashboard on top. */
import { useMemo } from 'react';
import { RefKind, SCENE_STAGES, STAGE_COLOR, STAGE_LABEL, dayKey, formatDayNumber, looseEnds, recentChanges, seriesDashboard, unlinkedChapters } from '../../core';
import { GoalBar, StageBar, WritingCalendar, deadlineText } from '../writing/Goals';
import { useOpenRef } from '../components/Refs';
import { useApp } from '../context';

const KIND_OF: Record<string, RefKind | undefined> = {
  characters: 'character', places: 'place', groups: 'group', stays: 'stay', journeys: 'journey', books: 'book', chapters: 'chapter', scenes: 'scene',
  events: 'event', secrets: 'secret', regions: 'region', threads: 'thread', manuscripts: 'manuscript', relationships: 'relationship', mapFeatures: 'place',
};
const NOUN: Record<string, string> = { characters: 'character', places: 'place', groups: 'group', memberships: 'membership', stays: 'stay', journeys: 'journey', books: 'book', chapters: 'chapter', scenes: 'scene', events: 'event', secrets: 'secret', regions: 'region', threads: 'thread', manuscripts: 'manuscript', relationships: 'relationship', mapFeatures: 'map feature' };

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export function Home() {
  const { world, warnings, go, moment, store } = useApp();
  const open = useOpenRef();
  const recent = useMemo(() => recentChanges(world, 10), [world]);
  const loose = useMemo(() => looseEnds(world), [world]);
  const unlinked = useMemo(() => (world.manuscripts.length ? unlinkedChapters(world) : []), [world]);
  const openWarnings = warnings.filter((w) => !w.dismissed && w.severity === 'warning');
  const todos = world.todos.filter((t) => !t.done);
  const holes = todos.filter((t) => t.kind === 'plot-hole');
  const mapFeature = (id: string) => world.mapFeatures.find((f) => f.id === id)?.placeId;
  const openRecent = (r: (typeof recent)[number]) => {
    if (r.collection === 'memberships') { const m = world.memberships.find((x) => x.id === r.id); if (m) go('groups', m.groupId); return; }
    if (r.collection === 'mapFeatures') { const p = mapFeature(r.id); if (p) go('places', p); return; }
    const k = KIND_OF[r.collection];
    if (k) open({ kind: k, id: r.id });
  };
  const stat = (n: number, one: string, many: string) => <div className="stat"><b>{n.toLocaleString()}</b><span>{n === 1 ? one : many}</span></div>;
  return (
    <div className="page home">
      <div className="page-head">
        <h1>{world.settings.name}</h1>
        <span className="muted">Current moment: <button className="link" onClick={() => go('who')}>{formatDayNumber(moment)}</button></span>
      </div>
      <div className="stats">
        {stat(world.characters.filter((c) => !c.archived).length, 'character', 'characters')}
        {stat(world.places.filter((p) => !p.isPlaceholder).length, 'place', 'places')}
        {stat(world.events.length, 'event', 'events')}
        {stat(world.chapters.length, 'chapter', 'chapters')}
        {stat(world.scenes.length, 'scene', 'scenes')}
        {stat(world.stays.length + world.journeys.length, 'stay or journey', 'stays and journeys')}
      </div>
      {world.books.length > 0 && <SeriesDashboard />}
      <div className="home-grid">
        <section className="card">
          <div className="section-head"><h2>Warnings</h2><button className="small" onClick={() => go('warnings')}>All warnings</button></div>
          {openWarnings.length === 0 ? <p className="muted">No open warnings.</p> : (
            <ul className="plain home-list">
              {openWarnings.slice(0, 5).map((w) => <li key={w.key}><span className="warn-text">⚠</span> {w.message}</li>)}
              {openWarnings.length > 5 && <li className="muted">and {openWarnings.length - 5} more</li>}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="section-head"><h2>To-dos{holes.length > 0 && <span className="tag warn">{holes.length} plot {holes.length === 1 ? 'hole' : 'holes'}</span>}</h2><button className="small" onClick={() => go('todos')}>All to-dos</button></div>
          {todos.length === 0 ? <p className="muted">Nothing on the list. Add to-dos and plot holes from any character, place or scene page.</p> : (
            <ul className="plain home-list">
              {todos.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <input type="checkbox" checked={false} onChange={() => store.upsert('todos', { ...t, done: true })} aria-label="Done" />{' '}
                  <button className="link" onClick={() => go('todos', t.id)}>{t.title}</button>{t.kind === 'plot-hole' && <span className="tag warn">plot hole</span>}
                </li>
              ))}
              {todos.length > 6 && <li className="muted">and {todos.length - 6} more</li>}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Recently changed</h2>
          {recent.length === 0 ? <p className="muted">Nothing yet.</p> : (
            <ul className="plain home-list">
              {recent.map((r) => <li key={r.collection + r.id}><button className="link" onClick={() => openRecent(r)}>{r.label}</button> <span className="muted small">{NOUN[r.collection] ?? ''} · {ago(r.updatedAt)}</span></li>)}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Loose ends</h2>
          {loose.length === 0 ? <p className="muted">No unfinished stays, undated scenes or drafts.</p> : (
            <ul className="plain home-list">
              {loose.slice(0, 7).map((l) => <li key={l.kind + l.id}><button className="link" onClick={() => open({ kind: KIND_OF[l.collection]!, id: l.id })}>{l.text}</button></li>)}
              {loose.length > 7 && <li className="muted">and {loose.length - 7} more</li>}
            </ul>
          )}
        </section>
        {world.manuscripts.length > 0 && (
          <section className="card">
            <h2>Chapters with no linked passage</h2>
            {unlinked.length === 0 ? <p className="muted">Every chapter has at least one linked passage.</p> : (
              <ul className="plain home-list">
                {unlinked.slice(0, 8).map((c) => <li key={c.chapterId}><button className="link" onClick={() => go('story', c.chapterId)}>{c.label}</button> <span className="muted small">{c.scenes} {c.scenes === 1 ? 'scene' : 'scenes'}</span></li>)}
                {unlinked.length > 8 && <li className="muted">and {unlinked.length - 8} more</li>}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/** SR-1: every book with its stage, words, progress to goal, deadline and open to-dos; WR-12 today's words and the calendar. */
function SeriesDashboard() {
  const { world, go } = useApp();
  const today = dayKey();
  const d = useMemo(() => seriesDashboard(world, today), [world, today]);
  const n = (x: number) => x.toLocaleString('en-US');
  return (
    <section className="card series-card">
      <div className="section-head"><h2>The series</h2><button className="small" onClick={() => go('write')}>Write</button></div>
      <table className="table series-table">
        <thead><tr><th>Book</th><th>Scenes by stage</th><th className="num">Words</th><th>Progress to goal</th><th>Deadline</th><th className="num">Open to-dos</th></tr></thead>
        <tbody>
          {d.books.map((b) => (
            <tr key={b.book.id}>
              <td><button className="link" onClick={() => go('story', b.book.id)}>{b.book.title}</button>{b.stage && <div className="muted small">{STAGE_LABEL[b.stage]}{b.scenes ? ` · ${b.scenes} ${b.scenes === 1 ? 'scene' : 'scenes'}` : ''}</div>}</td>
              <td><StageBar stages={b.stages} total={b.scenes} /></td>
              <td className="num">{n(b.words)}</td>
              <td>{b.goal ? <><GoalBar value={b.words} goal={b.goal} /><span className="muted small">{Math.round((b.fraction ?? 0) * 100)}% of {n(b.goal)}</span></> : <button className="link small" onClick={() => go('story', b.book.id)}>Set a goal</button>}</td>
              <td className={b.daysLeft !== undefined && b.daysLeft < 0 ? 'warn-text small' : 'small'}>{b.deadline ? deadlineText(b) : <span className="muted">none</span>}</td>
              <td className="num">{b.todos ? <button className="link" onClick={() => go('todos')}>{b.todos}{b.plotHoles ? ` (${b.plotHoles} plot ${b.plotHoles === 1 ? 'hole' : 'holes'})` : ''}</button> : <span className="muted">0</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td><b>Series</b></td><td /><td className="num"><b>{n(d.words)}</b></td><td colSpan={3} /></tr></tfoot>
      </table>
      <div className="stage-legend">{SCENE_STAGES.map((s) => <span key={s}><span className="stage-dot" style={{ background: STAGE_COLOR[s] }} />{STAGE_LABEL[s]}</span>)}</div>
      <div className="series-today">
        <div>
          <div className="muted small">Today</div>
          <div className="goal-row"><b>{n(Math.max(0, d.today))}</b> <span className="muted">{d.dailyGoal ? `of ${n(d.dailyGoal)} words` : 'words'}</span></div>
          {d.dailyGoal ? <GoalBar value={d.today} goal={d.dailyGoal} /> : <span className="muted small">Set a daily goal on the Write page's Goals tab.</span>}
          {d.streak > 0 && <div className="small">{d.streak} {d.streak === 1 ? 'day' : 'days'} in a row</div>}
        </div>
        <div><div className="muted small">Words per day</div><WritingCalendar world={world} weeks={26} /></div>
      </div>
    </section>
  );
}
