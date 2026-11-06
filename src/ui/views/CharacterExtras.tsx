/** Character page parts for Phase 4a: status (CH-7), relationships (CH-4), family tree (EU-11), knowledge (CH-8). */
import { useMemo, useState } from 'react';
import {
  Character, Id, RELATION_KINDS, RelationKind, Relationship, STATUS_LABEL, characterStatus, familyTree, formatDayNumber, formatFuzzy, knowledgeOf, relationsOf,
} from '../../core';
import { recordBase } from '../../storage';
import { DateInput } from '../components/DateInput';
import { Modal } from '../components/Modal';
import { CharacterSelect } from '../components/Pickers';
import { useApp } from '../context';
import { placeName } from '../util';

/** CH-7: alive, dead, missing or whereabouts unknown, at the current moment. */
export function StatusBadge({ id }: { id: Id }) {
  const { ix, world, moment } = useApp();
  const s = characterStatus(ix, id, moment);
  const where = s.placeId && s.status !== 'dead' ? `${s.travelling ? ' · travelling to ' : ' · in '}${placeName(world, s.placeId)}` : '';
  return <span className={`status status-${s.status}`} title={`CH-7: status on ${formatDayNumber(moment)}`}>{STATUS_LABEL[s.status]}{where}</span>;
}

/** CH-4 */
export function Relationships({ c }: { c: Character }) {
  const { world, store, moment, go } = useApp();
  const [adding, setAdding] = useState(false);
  const [tree, setTree] = useState(false);
  const list = relationsOf(world, c.id, moment);
  const hasFamily = world.relationships.some((r) => (r.aId === c.id || r.bId === c.id) && ['parent', 'spouse', 'sibling'].includes(r.kind));
  const set = (r: Relationship, p: Partial<Relationship>) => store.upsert('relationships', { ...r, ...p });
  return (
    <section>
      <div className="section-head">
        <h2>Relationships</h2>
        <div className="row">
          {hasFamily && <button onClick={() => setTree(true)} title="EU-11: drawn from parent, spouse and sibling links">Family tree</button>}
          <button onClick={() => setAdding(true)}>+ Relationship</button>
        </div>
      </div>
      {list.length === 0 && !adding && <p className="muted">No relationships yet. Family links (parent, spouse, sibling) also build the family tree.</p>}
      {list.length > 0 && (
        <ul className="relations">
          {list.map((v) => {
            const o = world.characters.find((x) => x.id === v.otherId);
            return (
              <li key={v.rel.id} className={v.when === 'now' ? '' : 'ended'}>
                <span className="muted">{v.label}</span>{' '}
                <button className="link" onClick={() => go('characters', v.otherId)}><span style={{ color: o?.color }}>{o?.icon}</span> {o?.name ?? '?'}</button>
                <span className="muted small">
                  {(v.rel.start || v.rel.end) && ` · ${v.rel.start ? formatFuzzy(v.rel.start) : '…'} – ${v.rel.end ? formatFuzzy(v.rel.end) : '…'}`}
                  {v.when === 'before' && ' · not yet'}
                  {v.when === 'after' && ' · ended'}
                </span>
                <details className="inline-edit">
                  <summary aria-label="Edit">✎</summary>
                  <div className="form-grid">
                    <input placeholder="Nuance (half-sister, sworn brother…)" value={v.rel.label ?? ''} onChange={(e) => set(v.rel, { label: e.target.value || undefined })} />
                    <div className="row"><span className="muted">From</span><DateInput value={v.rel.start} placeholder="always" onChange={(start) => set(v.rel, { start })} /></div>
                    <div className="row"><span className="muted">Until</span><DateInput value={v.rel.end} placeholder="still" onChange={(end) => set(v.rel, { end })} /></div>
                    <textarea rows={2} placeholder="Notes" value={v.rel.notes} onChange={(e) => set(v.rel, { notes: e.target.value })} />
                    <button className="small danger" onClick={() => store.removeMany([{ c: 'relationships', id: v.rel.id }])}>Remove relationship</button>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {adding && <AddRelationship c={c} onDone={() => setAdding(false)} />}
      {tree && <FamilyTreeModal rootId={c.id} onClose={() => setTree(false)} />}
    </section>
  );
}

/** Choices read from this character's side: "Kaela is the … of …". */
const CHOICES: { value: string; label: string; kind: RelationKind; flip: boolean }[] = [
  { value: 'parent', label: 'parent of', kind: 'parent', flip: false },
  { value: 'child', label: 'child of', kind: 'parent', flip: true },
  { value: 'spouse', label: 'spouse of', kind: 'spouse', flip: false },
  { value: 'sibling', label: 'sibling of', kind: 'sibling', flip: false },
  { value: 'lover', label: 'lover of', kind: 'lover', flip: false },
  { value: 'friend', label: 'friend of', kind: 'friend', flip: false },
  { value: 'ally', label: 'ally of', kind: 'ally', flip: false },
  { value: 'rival', label: 'rival of', kind: 'rival', flip: false },
  { value: 'enemy', label: 'enemy of', kind: 'enemy', flip: false },
  { value: 'mentor', label: 'mentor of', kind: 'mentor', flip: false },
  { value: 'student', label: 'student of', kind: 'mentor', flip: true },
  { value: 'liege', label: 'liege of', kind: 'liege', flip: false },
  { value: 'sworn', label: 'sworn to', kind: 'liege', flip: true },
  { value: 'other', label: 'other…', kind: 'other', flip: false },
];

function AddRelationship({ c, onDone }: { c: Character; onDone: () => void }) {
  const { world, store } = useApp();
  const [choice, setChoice] = useState('sibling');
  const [other, setOther] = useState<Id | undefined>();
  const [label, setLabel] = useState('');
  const [start, setStart] = useState<Relationship['start']>();
  const ch = CHOICES.find((x) => x.value === choice)!;
  const save = () => {
    if (!other) return;
    store.upsert('relationships', { ...recordBase(), aId: ch.flip ? other : c.id, bId: ch.flip ? c.id : other, kind: ch.kind, label: label || undefined, start, notes: '' });
    onDone();
  };
  return (
    <div className="card add-rel">
      <div className="row wrap">
        <b>{c.name}</b> is
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>{CHOICES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
        <CharacterSelect world={world} value={other} exclude={[c.id]} onChange={setOther} />
      </div>
      <div className="row wrap">
        <input placeholder={choice === 'other' ? 'What are they? (betrothed, rescuer…)' : 'Nuance, optional (half-sister…)'} value={label} onChange={(e) => setLabel(e.target.value)} />
        <span className="muted">from</span> <DateInput value={start} placeholder="always" onChange={setStart} />
      </div>
      <div className="row">
        <button className="primary" disabled={!other} onClick={save}>Add</button>
        <button onClick={onDone}>Cancel</button>
      </div>
      <p className="muted small">{RELATION_KINDS.find((k) => k.id === ch.kind)?.label}. Add an end date afterwards with ✎ if it ends.</p>
    </div>
  );
}

const BOX_W = 132, BOX_H = 44, GAP_X = 24, GAP_Y = 64;

/** EU-11: the family drawn from parent, spouse and sibling links. */
export function FamilyTreeModal({ rootId, onClose }: { rootId: Id; onClose: () => void }) {
  const { world, go, moment, ix } = useApp();
  const [root, setRoot] = useState(rootId);
  const t = useMemo(() => familyTree(world, root), [world, root]);
  const minX = Math.min(...t.nodes.map((n) => n.x)), maxX = Math.max(...t.nodes.map((n) => n.x));
  const minG = Math.min(...t.nodes.map((n) => n.gen)), maxG = Math.max(...t.nodes.map((n) => n.gen));
  const W = (maxX - minX + 1) * (BOX_W + GAP_X) + GAP_X, H = (maxG - minG + 1) * (BOX_H + GAP_Y) + GAP_Y / 2;
  const pos = new Map(t.nodes.map((n) => [n.id, { x: GAP_X + (n.x - minX) * (BOX_W + GAP_X), y: GAP_Y / 2 + (n.gen - minG) * (BOX_H + GAP_Y) }]));
  const life = (id: Id) => {
    const c = world.characters.find((x) => x.id === id);
    if (!c?.birth && !c?.death) return '';
    return `${c.birth ? c.birth.year : '?'} – ${c.death ? c.death.year : ''}`;
  };
  const rootName = world.characters.find((c) => c.id === root)?.name ?? '?';
  return (
    <Modal title={`Family tree of ${rootName}`} onClose={onClose} wide>
      <div className="family-tree-wrap">
        <svg width={W} height={H} className="family-tree" role="img" aria-label={`Family tree of ${rootName}`}>
          {t.couples.map(([a, b]) => {
            const pa = pos.get(a)!, pb = pos.get(b)!;
            const [l, r] = pa.x < pb.x ? [pa, pb] : [pb, pa];
            return <line key={a + b} x1={l.x + BOX_W} y1={l.y + BOX_H / 2} x2={r.x} y2={r.y + BOX_H / 2} className="tree-couple" />;
          })}
          {t.families.map((f) => {
            const ps = f.parents.map((p) => pos.get(p)!).filter(Boolean);
            const cs = f.children.map((c) => pos.get(c)!).filter(Boolean);
            if (!ps.length || !cs.length) return null;
            const px = ps.length === 2 && Math.abs(ps[0].y - ps[1].y) < 1 ? (ps[0].x + ps[1].x + BOX_W) / 2 : ps[0].x + BOX_W / 2;
            const py = ps.length === 2 && Math.abs(ps[0].y - ps[1].y) < 1 ? ps[0].y + BOX_H / 2 : ps[0].y + BOX_H;
            const barY = cs[0].y - GAP_Y / 2;
            const xs = cs.map((c) => c.x + BOX_W / 2);
            const left = Math.min(px, ...xs), right = Math.max(px, ...xs);
            return (
              <g key={f.parents.join('+')} className="tree-line">
                <line x1={px} y1={py} x2={px} y2={barY} />
                <line x1={left} y1={barY} x2={right} y2={barY} />
                {xs.map((x, i) => <line key={i} x1={x} y1={barY} x2={x} y2={cs[i].y} />)}
              </g>
            );
          })}
          {t.siblings.map(([a, b]) => {
            const pa = pos.get(a)!, pb = pos.get(b)!;
            const y = Math.min(pa.y, pb.y) - 10;
            return <polyline key={a + b} points={`${pa.x + BOX_W / 2},${pa.y} ${pa.x + BOX_W / 2},${y} ${pb.x + BOX_W / 2},${y} ${pb.x + BOX_W / 2},${pb.y}`} className="tree-sibling" />;
          })}
          {t.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const c = world.characters.find((x) => x.id === n.id);
            const dead = c?.death && ix.win(c.death).latest < moment;
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} className={`tree-node ${n.id === root ? 'root' : ''} ${dead ? 'dead' : ''}`} onClick={() => setRoot(n.id)} onDoubleClick={() => { onClose(); go('characters', n.id); }}>
                <title>{`${c?.name ?? '?'}: click to centre the tree, double-click to open`}</title>
                <rect width={BOX_W} height={BOX_H} rx={6} style={{ stroke: c?.color }} />
                <text x={10} y={18} className="tree-name"><tspan style={{ fill: c?.color }}>{c?.icon}</tspan> {(c?.name ?? '?').length > 15 ? `${c!.name.slice(0, 14)}…` : c?.name}</text>
                <text x={10} y={34} className="tree-dates">{life(n.id)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="muted small">Click someone to centre the tree on them; double-click to open their page. Faded boxes died before the current date.</p>
    </Modal>
  );
}

/** CH-8: what this character knows on the current date, and what they learn later. */
export function Knowledge({ c }: { c: Character }) {
  const { world, moment, go } = useApp();
  const list = knowledgeOf(world, c.id, moment);
  if (!list.length) return null;
  return (
    <section>
      <h2>Knows <span className="muted small">on {formatDayNumber(moment)}</span></h2>
      <ul className="plain">
        {list.map((k) => (
          <li key={k.secret.id} className={k.knows ? '' : 'later'}>
            <button className="link" onClick={() => go('events', k.secret.id)}>🗝 {k.secret.title}</button>
            <span className="muted small"> · {k.knows ? (k.from === undefined ? 'has always known' : `since ${formatDayNumber(k.from)}`) : `learns on ${formatDayNumber(k.from!)}`}{k.how && ` · ${k.how}`}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
