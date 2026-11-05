/** CH-5, DM-5: groups that travel together; time-bound membership. */
import { Group, Membership, formatFuzzy } from '../../core';
import { ask } from '../components/Dialogs';
import { recordBase } from '../../storage';
import { DateInput } from '../components/DateInput';
import { Backlinks } from '../components/Backlinks';
import { Field } from '../components/Modal';
import { useApp } from '../context';
import { PALETTE, placeName, sortByName } from '../util';

export function Groups() {
  const { world, store, selected, select } = useApp();
  const current = world.groups.find((g) => g.id === selected);
  const add = () => {
    const g: Group = { ...recordBase(), name: 'New group', description: '', color: PALETTE[(world.groups.length + 5) % PALETTE.length] };
    store.upsert('groups', g);
    select(g.id);
  };
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools"><button className="primary" onClick={add}>+ New group</button></div>
        <ul className="list">
          {sortByName(world.groups).map((g) => (
            <li key={g.id} className={g.id === selected ? 'active' : ''} onClick={() => select(g.id)}>
              <span className="swatch" style={{ color: g.color }}>■</span> {g.name}
            </li>
          ))}
        </ul>
      </aside>
      <section className="detail">{current ? <GroupDetail key={current.id} g={current} /> : <div className="empty">Groups let several characters travel or stay together: you move the group once instead of each member.</div>}</section>
    </div>
  );
}

function GroupDetail({ g }: { g: Group }) {
  const { world, store, edit, select } = useApp();
  const set = (p: Partial<Group>) => store.upsert('groups', { ...g, ...p });
  const members = world.memberships.filter((m) => m.groupId === g.id);
  const setM = (m: Membership, p: Partial<Membership>) => store.upsert('memberships', { ...m, ...p });
  const stays = world.stays.filter((s) => s.subject.kind === 'group' && s.subject.id === g.id);
  const journeys = world.journeys.filter((j) => j.subject.kind === 'group' && j.subject.id === g.id);
  const remove = async () => {
    if (!(await ask.confirm(`Delete ${g.name}, its ${members.length} membership(s), ${stays.length} stay(s) and ${journeys.length} journey(s)?`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'groups', id: g.id }, ...members.map((m) => ({ c: 'memberships' as const, id: m.id })), ...stays.map((s) => ({ c: 'stays' as const, id: s.id })), ...journeys.map((j) => ({ c: 'journeys' as const, id: j.id }))]);
    select(undefined);
  };
  const subject = { kind: 'group' as const, id: g.id };
  return (
    <div className="page">
      <div className="page-head">
        <h1><span style={{ color: g.color }}>■</span> {g.name}</h1>
        <div className="row">
          <button onClick={() => edit({ kind: 'stay', preset: { subject } })}>+ Group stay</button>
          <button onClick={() => edit({ kind: 'journey', preset: { subject } })}>+ Group journey</button>
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <div className="two-col">
        <div className="form-grid">
          <Field label="Name"><input value={g.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Colour">
            <div className="row wrap">
              {PALETTE.map((p) => <button key={p} className={`color-dot ${g.color === p ? 'on' : ''}`} style={{ background: p }} onClick={() => set({ color: p })} />)}
            </div>
          </Field>
          <Field label="Description"><textarea rows={3} value={g.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <h2>Members</h2>
          <p className="muted">Members follow the group's stays and journeys between their join and leave dates. A member's own entries win where both exist.</p>
          <table className="table">
            <thead><tr><th>Character</th><th>Joins</th><th>Leaves</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <select value={m.characterId} onChange={(e) => setM(m, { characterId: e.target.value })}>
                      {sortByName(world.characters).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><DateInput value={m.start} placeholder="from the start" onChange={(start) => setM(m, { start })} /></td>
                  <td><DateInput value={m.end} placeholder="to the end" onChange={(end) => setM(m, { end })} /></td>
                  <td><button className="icon" onClick={() => store.removeMany([{ c: 'memberships', id: m.id }])}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <select value="" onChange={(e) => e.target.value && store.upsert('memberships', { ...recordBase(), groupId: g.id, characterId: e.target.value })}>
            <option value="">+ add a member…</option>
            {sortByName(world.characters.filter((c) => !c.archived)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <h2>Group whereabouts</h2>
          <ul className="plain">
            {stays.map((s) => <li key={s.id}><button className="link" onClick={() => edit({ kind: 'stay', id: s.id })}>{formatFuzzy(s.arrival)}: at {placeName(world, s.placeId)}</button></li>)}
            {journeys.map((j) => <li key={j.id}><button className="link" onClick={() => edit({ kind: 'journey', id: j.id })}>{formatFuzzy(j.departure)}: {placeName(world, j.originId)} → {placeName(world, j.destinationId)}</button></li>)}
          </ul>
          {stays.length + journeys.length === 0 && <p className="muted">None yet.</p>}
          <Backlinks kind="group" id={g.id} />
        </div>
      </div>
    </div>
  );
}
