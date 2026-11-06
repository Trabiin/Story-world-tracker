/** VW-5: every character's location and activity on the current moment. */
import { useMemo, useState } from 'react';
import { Id, ageOn, attributesOn, formatDayNumber, fromDayNumber, plansOn, whereIs } from '../../core';
import { useApp } from '../context';
import { placePath } from '../util';

export function WhoIsWhere() {
  const { world, ix, moment, go, edit } = useApp();
  const [groupByPlace, setGroupByPlace] = useState(false);
  const [filter, setFilter] = useState<'all' | 'main' | 'secondary' | 'minor'>('all');
  const plans = useMemo(() => plansOn(ix, moment).filter((v) => v.plan.placeId && (v.active || v.overdue)), [ix, moment]);
  const rows = useMemo(() => {
    return world.characters
      .filter((c) => !c.archived && (filter === 'all' || c.importance === filter))
      .map((c) => {
        const w = whereIs(ix, c.id, moment);
        const age = c.birth ? ageOn(fromDayNumber(ix.win(c.birth).earliest), fromDayNumber(moment)) : undefined;
        let where = '';
        let doing = '';
        let placeKey: Id = '~';
        let recordKind: 'stay' | 'journey' | undefined;
        let recordId: Id | undefined;
        if (w.kind === 'stay') {
          where = placePath(ix, w.placeId);
          placeKey = w.placeId;
          doing = world.stays.find((s) => s.id === w.segment.recordId)?.purpose ?? '';
          recordKind = 'stay';
          recordId = w.segment.recordId;
        } else if (w.kind === 'journey') {
          where = `On the way from ${ix.places.get(w.fromId)?.name} to ${ix.places.get(w.toId)?.name} (${Math.round(w.progress * 100)}%)`;
          placeKey = `journey:${w.fromId}>${w.toId}`;
          doing = world.journeys.find((j) => j.id === w.segment.recordId)?.purpose ?? '';
          recordKind = 'journey';
          recordId = w.segment.recordId;
        } else {
          where = w.kind === 'not-born' ? 'Not yet born' : w.kind === 'dead' ? 'Dead' : 'Unknown';
          placeKey = `~${w.kind}`;
        }
        const via = (w.kind === 'stay' || w.kind === 'journey') && w.segment.viaGroupId ? world.groups.find((g) => g.id === w.segment.viaGroupId)?.name : undefined;
        const title = attributesOn(ix, c.id, moment).title;
        return { c, where, doing, placeKey, via, age, recordKind, recordId, title, unknown: w.kind === 'unknown' };
      })
      .sort((a, b) => (groupByPlace ? a.where.localeCompare(b.where) : 0) || (['main', 'secondary', 'minor'].indexOf(a.c.importance) - ['main', 'secondary', 'minor'].indexOf(b.c.importance)) || a.c.name.localeCompare(b.c.name));
  }, [world, ix, moment, groupByPlace, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Who is where on {formatDayNumber(moment)}</h1>
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All characters</option>
            <option value="main">Main</option>
            <option value="secondary">Secondary</option>
            <option value="minor">Minor</option>
          </select>
          <label className="checkbox"><input type="checkbox" checked={groupByPlace} onChange={(e) => setGroupByPlace(e.target.checked)} /> Sort by place</label>
        </div>
      </div>
      {world.characters.length === 0 ? (
        <div className="empty">
          <p>No characters yet.</p>
          <button className="primary" onClick={() => go('characters')}>Add your first character</button>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Character</th><th>Age</th><th>Where</th><th>Doing</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.c.id} className={groupByPlace && i > 0 && rows[i - 1].placeKey !== r.placeKey ? 'group-start' : ''}>
                <td>
                  <button className="link" onClick={() => go('characters', r.c.id)}>
                    <span className="swatch" style={{ color: r.c.color }}>{r.c.icon}</span> {r.c.name}
                  </button>
                  {r.title && <div className="muted small">{r.title}</div>}
                </td>
                <td>{r.age !== undefined && r.age >= 0 ? r.age : ''}</td>
                <td className={r.unknown ? 'muted' : ''}>
                  {r.where}
                  {r.via && <span className="tag">with {r.via}</span>}
                </td>
                <td>
                  {r.doing}
                  {plans.filter((v) => v.character.id === r.c.id).map((v) => (
                    <div key={v.plan.id} className={`small ${v.overdue ? 'warn-text' : 'muted'}`}>Plans to reach {ix.places.get(v.plan.placeId)?.name ?? '?'}{v.plan.by ? ` by ${formatDayNumber(ix.win(v.plan.by).latest)}` : ''}{v.overdue ? ' (overdue)' : ''}</div>
                  ))}
                </td>
                <td className="actions">
                  {r.recordId ? (
                    <button className="small" onClick={() => edit({ kind: r.recordKind!, id: r.recordId })}>Edit</button>
                  ) : (
                    <button className="small" onClick={() => edit({ kind: 'stay', preset: { subject: { kind: 'character', id: r.c.id }, arrival: { ...fromDayNumber(moment), precision: 'day' } } })}>Add stay</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
