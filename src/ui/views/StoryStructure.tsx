/** ST-3 plot threads and the thread map, ST-4/ST-5 story order, ST-13 chapter overview. */
import { useMemo } from 'react';
import { Id, PlotThread, REGION_COLORS, Scene, chapterOverview, chronologicalScenes, formatDayNumber, formatFuzzy, orderedScenes, threadLanes } from '../../core';
import { recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { Field } from '../components/Modal';
import { CharacterChips } from '../components/Pickers';
import { useApp } from '../context';

/** Master list: every scene in reading order or in the order it happens. */
export function OrderList({ chrono, onChrono }: { chrono: boolean; onChrono: (v: boolean) => void }) {
  const { world, selected, select } = useApp();
  const list = useMemo(() => (chrono ? chronologicalScenes(world) : orderedScenes(world)), [world, chrono]);
  const name = (id: Id) => world.scenes.find((s) => s.id === id)?.title ?? '?';
  return (
    <>
      <div className="master-tools">
        <div className="seg">
          <button className={!chrono ? 'on' : ''} onClick={() => onChrono(false)}>As read</button>
          <button className={chrono ? 'on' : ''} onClick={() => onChrono(true)}>As it happens</button>
        </div>
      </div>
      <ul className="list">
        {list.map((o) => (
          <li key={o.scene.id} className={`${o.scene.id === selected ? 'active' : ''} ${o.scene.status === 'draft' ? 'draft' : ''}`} onClick={() => select(o.scene.id)}>
            {chrono && <span className="muted small">{o.readIndex + 1}. </span>}{o.scene.title}
            {o.flashback && <span className="tag warn" title="Happens before something the reader has already seen">flashback</span>}
            {o.parallelWith.length > 0 && <span className="tag" title={`At the same time as ${o.parallelWith.map(name).join(', ')}`}>parallel</span>}
            <div className="muted small">{o.window ? formatDayNumber(o.window.earliest) : 'no date'} · {o.chapterLabel.split(' · ').pop()}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Master list of plot threads. */
export function ThreadList() {
  const { world, store, selected, select } = useApp();
  const { lanes } = useMemo(() => threadLanes(world), [world]);
  const add = () => {
    const t: PlotThread = { ...recordBase(), name: 'New thread', color: REGION_COLORS[world.threads.length % REGION_COLORS.length], description: '', characterIds: [] };
    store.upsert('threads', t);
    select(t.id);
  };
  return (
    <>
      <div className="master-tools"><button className="primary" onClick={add}>+ New thread</button></div>
      <ul className="list">
        {lanes.map((l) => (
          <li key={l.thread.id} className={l.thread.id === selected ? 'active' : ''} onClick={() => select(l.thread.id)} style={{ paddingLeft: 12 + depth(world.threads, l.thread) * 14 }}>
            <span className="tdot" style={{ background: l.thread.color }} /> {l.thread.name}
            <div className="muted small">{l.scenes.length} {l.scenes.length === 1 ? 'scene' : 'scenes'}{l.thread.parentId ? ' · branch' : ''}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

const depth = (all: PlotThread[], t: PlotThread, n = 0): number => {
  const p = t.parentId && all.find((x) => x.id === t.parentId);
  return p && n < 6 ? depth(all, p, n + 1) : n;
};

/** ST-3: lanes across the reading order, with branches splitting off and rejoining. */
export function ThreadMap({ focus }: { focus?: Id }) {
  const { world, select } = useApp();
  const { lanes, total } = useMemo(() => threadLanes(world), [world]);
  const ordered = useMemo(() => orderedScenes(world), [world]);
  if (!lanes.length) return <div className="empty">Plot threads follow a storyline across the books: a quest, a romance, a war. Make a thread, then tick it on the scenes it runs through. Branches split off a thread and can rejoin it later.</div>;
  const STEP = 44, LANE = 38, LEFT = 160, TOP = 34;
  const width = LEFT + Math.max(total, 1) * STEP + 20;
  const height = TOP + lanes.length * LANE + 10;
  const x = (i: number) => LEFT + i * STEP + STEP / 2;
  const laneOf = new Map(lanes.map((l) => [l.thread.id, l]));
  const y = (lane: number) => TOP + lane * LANE + LANE / 2;
  // Chapter boundaries along the top.
  const marks: { i: number; label: string; book: boolean }[] = [];
  ordered.forEach((o, i) => {
    const prev = ordered[i - 1];
    if (!prev || prev.chapterId !== o.chapterId) {
      const book = !prev || world.chapters.find((c) => c.id === prev.chapterId)?.bookId !== world.chapters.find((c) => c.id === o.chapterId)?.bookId;
      marks.push({ i, label: book ? o.chapterLabel.split(' · ')[0] : '', book });
    }
  });
  return (
    <div className="thread-map-wrap">
      <svg className="thread-map" width={width} height={height} role="img" aria-label="Thread map">
        {marks.map((m) => (
          <g key={m.i}>
            <line x1={LEFT + m.i * STEP} x2={LEFT + m.i * STEP} y1={m.book ? 4 : TOP - 8} y2={height - 4} className={m.book ? 'tm-book' : 'tm-chapter'} />
            {m.label && <text x={LEFT + m.i * STEP + 4} y={14} className="tm-label">{m.label}</text>}
          </g>
        ))}
        {lanes.map((l) => {
          const dim = focus && focus !== l.thread.id && l.thread.parentId !== focus && laneOf.get(focus)?.thread.parentId !== l.thread.id;
          const c = l.thread.color;
          const parent = l.thread.parentId ? laneOf.get(l.thread.parentId) : undefined;
          const rejoin = l.thread.rejoinsId ? laneOf.get(l.thread.rejoinsId) : undefined;
          return (
            <g key={l.thread.id} opacity={dim ? 0.3 : 1}>
              <text x={8 + depth(world.threads, l.thread) * 10} y={y(l.lane) + 4} className="tm-name" onClick={() => select(l.thread.id)}>{l.thread.name}</text>
              {l.first !== undefined && l.last !== undefined && <line x1={x(l.first)} x2={x(l.last)} y1={y(l.lane)} y2={y(l.lane)} stroke={c} strokeWidth={focus === l.thread.id ? 5 : 3} strokeLinecap="round" />}
              {parent && l.first !== undefined && <path d={`M${x(l.first) - STEP} ${y(parent.lane)} C${x(l.first) - STEP / 2} ${y(parent.lane)}, ${x(l.first) - STEP / 2} ${y(l.lane)}, ${x(l.first)} ${y(l.lane)}`} fill="none" stroke={c} strokeWidth={2} strokeDasharray="4 3" />}
              {rejoin && l.last !== undefined && <path d={`M${x(l.last)} ${y(l.lane)} C${x(l.last) + STEP / 2} ${y(l.lane)}, ${x(l.last) + STEP / 2} ${y(rejoin.lane)}, ${x(l.last) + STEP} ${y(rejoin.lane)}`} fill="none" stroke={c} strokeWidth={2} strokeDasharray="4 3" />}
              {l.scenes.map((s) => {
                const sc = world.scenes.find((z) => z.id === s.id);
                return (
                  <circle key={s.id} cx={x(s.readIndex)} cy={y(l.lane)} r={6} fill={sc?.status === 'draft' ? 'var(--bg)' : c} stroke={c} strokeWidth={2} className="tm-dot" onClick={() => select(s.id)}>
                    <title>{sc?.title}{sc?.start ? ` (${formatFuzzy(sc.start)})` : ''}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      <p className="muted small">Each dot is a scene, left to right in reading order. Dashed curves show where a branch splits off and rejoins. Hollow dots are drafts.</p>
    </div>
  );
}

export function ThreadDetail({ t }: { t: PlotThread }) {
  const { world, store, select } = useApp();
  const set = (p: Partial<PlotThread>) => store.upsert('threads', { ...t, ...p });
  const scenes = useMemo(() => orderedScenes(world).filter((o) => o.scene.threadIds?.includes(t.id)), [world, t.id]);
  const others = world.threads.filter((x) => x.id !== t.id);
  const remove = async () => {
    if (!(await ask.confirm(`Delete the thread “${t.name}”? Its scenes stay; branches of it become threads of their own.`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({
      ...w,
      threads: w.threads.filter((x) => x.id !== t.id).map((x) => ({ ...x, parentId: x.parentId === t.id ? undefined : x.parentId, rejoinsId: x.rejoinsId === t.id ? undefined : x.rejoinsId })),
      scenes: w.scenes.map((s) => (s.threadIds?.includes(t.id) ? { ...s, threadIds: s.threadIds.filter((x) => x !== t.id) } : s)),
    }));
    select(undefined);
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1><span className="tdot big" style={{ background: t.color }} /> {t.name}</h1>
        <div className="row"><button className="danger" onClick={remove}>Delete</button></div>
      </div>
      <ThreadMap focus={t.id} />
      <div className="two-col">
        <div className="form-grid">
          <Field label="Name"><input value={t.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Colour">
            <div className="swatches">{REGION_COLORS.map((c) => <button key={c} className={`sw ${c === t.color ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => set({ color: c })} />)}</div>
          </Field>
          <Field label="Branches off" hint="A side plot that splits from another thread.">
            <select value={t.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value || undefined })}>
              <option value="">Nothing (a main thread)</option>
              {others.filter((x) => x.parentId !== t.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Rejoins" hint="The thread it flows back into when it ends.">
            <select value={t.rejoinsId ?? ''} onChange={(e) => set({ rejoinsId: e.target.value || undefined })}>
              <option value="">Doesn't rejoin</option>
              {others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Who it follows"><CharacterChips world={world} value={t.characterIds} onChange={(characterIds) => set({ characterIds })} /></Field>
          <Field label="Description"><textarea rows={4} value={t.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
        <div>
          <h2>Scenes ({scenes.length})</h2>
          {scenes.length === 0 ? <p className="muted">Open a scene and tick this thread under “Plot threads”.</p> : (
            <ol className="plain">{scenes.map((o) => <li key={o.scene.id}><button className="link" onClick={() => select(o.scene.id)}>{o.scene.title}</button> <span className="muted small">· {o.chapterLabel}{o.scene.start ? ` · ${formatFuzzy(o.scene.start)}` : ''}</span></li>)}</ol>
          )}
        </div>
      </div>
    </div>
  );
}

/** Scene detail: thread chips, plus flashback and parallel notes. */
export function SceneThreads({ s }: { s: Scene }) {
  const { world, store, select } = useApp();
  const set = (threadIds: Id[]) => store.upsert('scenes', { ...s, threadIds: threadIds.length ? threadIds : undefined });
  const ids = s.threadIds ?? [];
  const o = useMemo(() => orderedScenes(world).find((x) => x.scene.id === s.id), [world, s.id]);
  const name = (id: Id) => world.scenes.find((x) => x.id === id)?.title ?? '?';
  return (
    <>
      <Field label="Plot threads">
        <div className="row wrap">
          {ids.map((id) => {
            const t = world.threads.find((x) => x.id === id);
            return (
              <span className="chip" key={id}>
                <span className="tdot" style={{ background: t?.color }} />
                <button className="link" onClick={() => select(id)}>{t?.name ?? '?'}</button>
                <button className="icon" aria-label="Remove" onClick={() => set(ids.filter((x) => x !== id))}>×</button>
              </span>
            );
          })}
          <select value="" onChange={(e) => e.target.value && set([...ids, e.target.value])}>
            <option value="">{world.threads.length ? '+ add…' : 'No threads yet'}</option>
            {world.threads.filter((t) => !ids.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </Field>
      {o?.flashback && <p className="note">This scene is a flashback: it happens before events the reader has already seen.</p>}
      {o && o.parallelWith.length > 0 && (
        <p className="note">Happens at the same time as {o.parallelWith.map((id, i) => <span key={id}>{i > 0 && ', '}<button className="link" onClick={() => select(id)}>{name(id)}</button></span>)}.</p>
      )}
    </>
  );
}

/** ST-13: who and where in a chapter, from its scenes and the passages linked in it. */
export function ChapterOverviewPanel({ chapterId }: { chapterId: Id }) {
  const { ix, go, store } = useApp();
  const ov = useMemo(() => chapterOverview(ix, chapterId), [ix, chapterId]);
  if (!ov.scenes && !ov.characters.length && !ov.places.length) return null;
  const count = (n: { scenes: number; passages: number }) => [n.scenes ? `${n.scenes} ${n.scenes === 1 ? 'scene' : 'scenes'}` : '', n.passages ? `${n.passages} ${n.passages === 1 ? 'passage' : 'passages'}` : ''].filter(Boolean).join(', ');
  return (
    <section className="overview">
      <h2>At a glance</h2>
      <p>
        {ov.range ? <>Takes place <button className="link" onClick={() => store.setMoment(ov.range!.earliest)}>{formatDayNumber(ov.range.earliest)}</button>{ov.range.latest > ov.range.earliest && <> to {formatDayNumber(ov.range.latest)} ({ov.range.latest - ov.range.earliest + 1} days)</>}.</> : 'No dated scenes yet.'}
        {ov.undated > 0 && <span className="muted"> {ov.undated} {ov.undated === 1 ? 'scene has' : 'scenes have'} no date.</span>}
      </p>
      <div className="two-col">
        <div>
          <h3>Who</h3>
          {ov.characters.length === 0 ? <p className="muted">Nobody yet.</p> : (
            <ul className="plain">{ov.characters.map((c) => { const ch = ix.characters.get(c.id); return <li key={c.id}><button className="link" onClick={() => go('characters', c.id)}><span style={{ color: ch?.color }}>{ch?.icon}</span> {ch?.name ?? '?'}</button>{c.pov && <span className="tag">POV</span>} <span className="muted small">{count(c)}</span></li>; })}</ul>
          )}
        </div>
        <div>
          <h3>Where</h3>
          {ov.places.length === 0 ? <p className="muted">No places yet.</p> : (
            <ul className="plain">{ov.places.map((p) => <li key={p.id}><button className="link" onClick={() => go('places', p.id)}>{ix.places.get(p.id)?.name ?? '?'}</button> <span className="muted small">{count(p)}</span></li>)}</ul>
          )}
        </div>
      </div>
    </section>
  );
}
