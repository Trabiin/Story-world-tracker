/** TL-5 named world events and CH-8 secrets (who knows what, from when). */
import { useMemo, useState } from 'react';
import { EVENT_KINDS, Id, Secret, WorldEvent, datesHangingOn, detachAnchor, eventIcon, eventWindow, formatDayNumber, formatFuzzy, knowersOn } from '../../core';
import { recordBase } from '../../storage';
import { Backlinks } from '../components/Backlinks';
import { DateInput } from '../components/DateInput';
import { ask } from '../components/Dialogs';
import { Field } from '../components/Modal';
import { CharacterChips, CharacterSelect, PlaceSelect } from '../components/Pickers';
import { RevealField } from '../components/RevealField';
import { useApp } from '../context';
import { placeName } from '../util';

export function Events() {
  const { world, store, selected, select } = useApp();
  const [tab, setTab] = useState<'events' | 'secrets'>(() => (world.secrets.some((s) => s.id === selected) ? 'secrets' : 'events'));
  const [q, setQ] = useState('');
  const events = useMemo(() => {
    const s = q.toLowerCase();
    return world.events
      .filter((e) => !s || e.name.toLowerCase().includes(s))
      .map((e) => ({ e, day: eventWindow(world, e)?.earliest ?? Infinity }))
      .sort((a, b) => a.day - b.day || a.e.name.localeCompare(b.e.name));
  }, [world, q]);
  const secrets = useMemo(() => world.secrets.filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.title.localeCompare(b.title)), [world.secrets, q]);
  const addEvent = () => {
    const e: WorldEvent = { ...recordBase(), name: 'New event', kind: 'battle', characterIds: [], description: '' };
    store.upsert('events', e);
    select(e.id);
  };
  const addSecret = () => {
    const s: Secret = { ...recordBase(), title: 'New secret', description: '', knowers: [] };
    store.upsert('secrets', s);
    select(s.id);
  };
  const ev = world.events.find((e) => e.id === selected);
  const sec = world.secrets.find((s) => s.id === selected);
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools">
          <div className="seg">
            <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>Events ({world.events.length})</button>
            <button className={tab === 'secrets' ? 'on' : ''} onClick={() => setTab('secrets')}>Secrets ({world.secrets.length})</button>
          </div>
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          {tab === 'events' ? <button className="primary" onClick={addEvent}>+ New event</button> : <button className="primary" onClick={addSecret}>+ New secret</button>}
        </div>
        <ul className="list">
          {tab === 'events' && events.map(({ e, day }) => (
            <li key={e.id} className={e.id === selected ? 'active' : ''} onClick={() => select(e.id)}>
              <span className="swatch">{eventIcon(e.kind)}</span> {e.name}
              <div className="muted small">{day === Infinity ? 'no date yet' : formatDayNumber(day)}{e.yearly ? ' · every year' : ''}{e.start?.rel ? ' · relative' : ''}</div>
            </li>
          ))}
          {tab === 'secrets' && secrets.map((s) => (
            <li key={s.id} className={s.id === selected ? 'active' : ''} onClick={() => select(s.id)}>
              <span className="swatch">🗝</span> {s.title}
              <div className="muted small">{s.knowers.length} {s.knowers.length === 1 ? 'knower' : 'knowers'}</div>
            </li>
          ))}
        </ul>
      </aside>
      <section className="detail">
        {ev ? <EventDetail key={ev.id} e={ev} /> : sec ? <SecretDetail key={sec.id} s={sec} /> : (
          <div className="empty">
            {tab === 'events'
              ? 'Battles, coronations, festivals, eclipses: name the moments your world remembers. Characters and places link to them, and any date can be set relative to one, such as “3 days after the Battle of Varn”.'
              : 'Secrets track who knows what, and from when. Tie a secret to an event to be warned when someone learns of it before it happens.'}
          </div>
        )}
      </section>
    </div>
  );
}

function EventDetail({ e }: { e: WorldEvent }) {
  const { world, store, select, ix, go, showOnMap } = useApp();
  const set = (p: Partial<WorldEvent>) => store.upsert('events', { ...e, ...p });
  const hanging = datesHangingOn(world, e.id);
  const secrets = world.secrets.filter((s) => s.eventId === e.id);
  const where = e.placeId ? ix.locationOf(e.placeId) : undefined;
  const remove = async () => {
    const extra = [hanging ? `${hanging} record(s) have dates tied to it; they keep their current dates.` : '', secrets.length ? `${secrets.length} secret(s) about it stay, without the link.` : ''].filter(Boolean).join(' ');
    if (!(await ask.confirm(`Delete ${e.name}? ${extra}`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => {
      const d = detachAnchor(w, e.id);
      return { ...d, events: d.events.filter((x) => x.id !== e.id), secrets: d.secrets.map((s) => (s.eventId === e.id ? { ...s, eventId: undefined } : s)), links: d.links.filter((l) => !(l.target.kind === 'event' && l.target.id === e.id)) };
    });
    select(undefined);
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>{eventIcon(e.kind)} {e.name}</h1>
        <div className="row">
          {e.start && <button onClick={() => store.setMoment(eventWindow(world, e)!.earliest)}>Go to date</button>}
          {where && <button onClick={() => showOnMap(where)}>Show on map</button>}
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <div className="two-col">
        <div className="form-grid">
          <Field label="Name"><input value={e.name} onChange={(x) => set({ name: x.target.value })} /></Field>
          <Field label="Kind">
            <select value={e.kind} onChange={(x) => set({ kind: x.target.value as WorldEvent['kind'] })}>
              {EVENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
            </select>
          </Field>
          <Field label="Date" hint="A date, or relative: “3 days after the Coronation”, “a week before chapter 4”."><DateInput value={e.start} onChange={(start) => set({ start })} /></Field>
          <Field label="Until" hint="For events that last, such as a siege or a festival week."><DateInput value={e.end} placeholder="one day" onChange={(end) => set({ end })} /></Field>
          <label className="checkbox"><input type="checkbox" checked={!!e.yearly} onChange={(x) => set({ yearly: x.target.checked || undefined })} /> Held every year (a holiday or festival, shown on the timeline each year)</label>
          <Field label="Where"><PlaceSelect world={world} value={e.placeId} allowNone="Nowhere in particular" onChange={(placeId) => set({ placeId })} /></Field>
          <Field label="Who takes part"><CharacterChips world={world} value={e.characterIds} onChange={(characterIds) => set({ characterIds })} /></Field>
          <Field label="What happened"><textarea rows={5} value={e.description} onChange={(x) => set({ description: x.target.value })} /></Field>
          <RevealField value={e.revealedIn} onChange={(revealedIn) => set({ revealedIn })} />
        </div>
        <div>
          {hanging > 0 && <p className="muted">{hanging} {hanging === 1 ? 'record has a date' : 'records have dates'} tied to this event. They move when it moves.</p>}
          {e.placeId && <p>At <button className="link" onClick={() => go('places', e.placeId)}>{placeName(world, e.placeId)}</button></p>}
          {e.characterIds.length > 0 && (
            <>
              <h2>Taking part</h2>
              <ul className="plain">
                {e.characterIds.map((id) => {
                  const c = world.characters.find((x) => x.id === id);
                  return <li key={id}><button className="link" onClick={() => go('characters', id)}><span style={{ color: c?.color }}>{c?.icon}</span> {c?.name ?? '?'}</button></li>;
                })}
              </ul>
            </>
          )}
          {secrets.length > 0 && (
            <>
              <h2>Who knows about it</h2>
              <ul className="plain">{secrets.map((s) => <li key={s.id}><button className="link" onClick={() => select(s.id)}>🗝 {s.title}</button> <span className="muted">· {s.knowers.length} {s.knowers.length === 1 ? 'knower' : 'knowers'}</span></li>)}</ul>
            </>
          )}
          <Backlinks kind="event" id={e.id} />
        </div>
      </div>
    </div>
  );
}

function SecretDetail({ s }: { s: Secret }) {
  const { world, store, select, moment, go } = useApp();
  const set = (p: Partial<Secret>) => store.upsert('secrets', { ...s, ...p });
  const setK = (id: Id, p: Partial<Secret['knowers'][number]>) => set({ knowers: s.knowers.map((k) => (k.id === id ? { ...k, ...p } : k)) });
  const now = new Set(knowersOn(world, s, moment));
  const remove = async () => {
    if (!(await ask.confirm(`Delete the secret “${s.title}”?`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'secrets', id: s.id }]);
    select(undefined);
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>🗝 {s.title}</h1>
        <div className="row"><button className="danger" onClick={remove}>Delete</button></div>
      </div>
      <div className="form-grid narrow">
        <Field label="Secret or piece of knowledge"><input value={s.title} onChange={(x) => set({ title: x.target.value })} /></Field>
        <Field label="Details"><textarea rows={3} value={s.description} onChange={(x) => set({ description: x.target.value })} /></Field>
        <Field label="About an event" hint="Optional. Learning of it before it happens is flagged.">
          <select value={s.eventId ?? ''} onChange={(x) => set({ eventId: x.target.value || undefined })}>
            <option value="">No event</option>
            {world.events.map((e) => <option key={e.id} value={e.id}>{eventIcon(e.kind)} {e.name}{e.start ? ` (${formatFuzzy(e.start)})` : ''}</option>)}
          </select>
        </Field>
        <Field label="Who knows, and from when" hint={`On ${formatDayNumber(moment)}: ${now.size ? [...now].map((id) => world.characters.find((c) => c.id === id)?.name).join(', ') : 'nobody yet'}.`}>
          {s.knowers.length > 0 && (
            <table className="table attr-table">
              <thead><tr><th>Character</th><th>Knows from</th><th>How they learn it</th><th></th></tr></thead>
              <tbody>
                {s.knowers.map((k) => (
                  <tr key={k.id} className={now.has(k.characterId) ? '' : 'later'}>
                    <td><CharacterSelect world={world} value={k.characterId} onChange={(characterId) => characterId && setK(k.id, { characterId })} /></td>
                    <td><DateInput value={k.from} placeholder="always" onChange={(from) => setK(k.id, { from })} /></td>
                    <td><input value={k.how} placeholder="a letter, an overheard talk…" onChange={(x) => setK(k.id, { how: x.target.value })} /></td>
                    <td><button className="icon" aria-label="Remove" onClick={() => set({ knowers: s.knowers.filter((x) => x.id !== k.id) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div>
            <CharacterSelect world={world} value={undefined} placeholder="+ Add who knows…" exclude={s.knowers.map((k) => k.characterId)} onChange={(characterId) => characterId && set({ knowers: [...s.knowers, { id: crypto.randomUUID(), characterId, how: '' }] })} />
          </div>
        </Field>
        <RevealField value={s.revealedIn} onChange={(revealedIn) => set({ revealedIn })} />
        {s.knowers.length > 0 && <p className="muted">Open a character to see everything they know on the current date. <button className="link" onClick={() => go('characters', s.knowers[0].characterId)}>Go to {world.characters.find((c) => c.id === s.knowers[0].characterId)?.name}</button></p>}
      </div>
    </div>
  );
}
