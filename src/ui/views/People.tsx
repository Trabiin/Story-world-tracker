/** VW-6 meetings finder, EU-13 side-by-side timelines and EU-12 quick calculators. */
import { useMemo, useState } from 'react';
import { FuzzyDate, Id, OPEN_END, ageText, compareTimelines, findMeetings, formatDayNumber, meetingText, toWindow, travelEstimate } from '../../core';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { CharacterChips, CharacterSelect, PlaceSelect } from '../components/Pickers';
import { useApp } from '../context';

type Tab = 'meetings' | 'compare' | 'calc';

export function People() {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('swt.peopleTab') as Tab) || 'meetings');
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem('swt.peopleTab', t); } catch { /* ignore */ } };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Meetings & tools</h1>
        <div className="seg">
          <button className={tab === 'meetings' ? 'on' : ''} onClick={() => choose('meetings')}>Who met whom</button>
          <button className={tab === 'compare' ? 'on' : ''} onClick={() => choose('compare')}>Side by side</button>
          <button className={tab === 'calc' ? 'on' : ''} onClick={() => choose('calc')}>Calculators</button>
        </div>
      </div>
      {tab === 'meetings' && <Meetings />}
      {tab === 'compare' && <Compare />}
      {tab === 'calc' && <Calculators />}
    </div>
  );
}

const dayOf = (d: FuzzyDate | undefined, h: 'north' | 'south', edge: 'earliest' | 'latest') => (d ? toWindow(d, h)[edge] : undefined);

/** VW-6 */
function Meetings() {
  const { world, ix, store, go } = useApp();
  const [ids, setIds] = useState<Id[]>(() => world.characters.filter((c) => !c.archived && c.importance === 'main').map((c) => c.id));
  const [from, setFrom] = useState<FuzzyDate>();
  const [to, setTo] = useState<FuzzyDate>();
  const h = world.settings.hemisphereForSeasons;
  const range: [number, number] | undefined = from || to ? [dayOf(from, h, 'earliest') ?? -Infinity, dayOf(to, h, 'latest') ?? Infinity] : undefined;
  const list = useMemo(() => findMeetings(ix, ids, range), [ix, ids, range?.[0], range?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="form-grid narrow">
        <Field label="Characters" hint="Pick two to ask whether they ever met, or several to see every meeting among them."><CharacterChips world={world} value={ids} onChange={setIds} /></Field>
        <div className="row wrap"><span className="muted">Between</span><DateInput value={from} placeholder="the beginning" onChange={setFrom} /><span className="muted">and</span><DateInput value={to} placeholder="the end" onChange={setTo} /></div>
      </div>
      {ids.length < 2 ? <p className="muted">Pick at least two characters.</p> : list.length === 0 ? (
        <p className="empty">{ids.length === 2 ? 'These two are never in the same place at the same time.' : 'No meetings among these characters.'}</p>
      ) : (
        <>
          <p className="muted">{list.length} {list.length === 1 ? 'meeting' : 'meetings'}. A stay in a castle meets a stay in the city around it; unknown places never count.</p>
          <ul className="meetings">
            {list.map((m, i) => (
              <li key={i}>
                <span>{meetingText(ix, m)}{m.to !== OPEN_END && m.to > m.from && <span className="muted"> ({m.to - m.from + 1} days)</span>}</span>
                <span className="row">
                  <button className="small" onClick={() => store.setMoment(m.from)}>Go to {formatDayNumber(m.from)}</button>
                  <button className="small" onClick={() => go('places', m.placeId)}>Open place</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** EU-13 */
function Compare() {
  const { world, ix, store, moment } = useApp();
  const [ids, setIds] = useState<Id[]>(() => world.characters.filter((c) => !c.archived && c.importance === 'main').slice(0, 2).map((c) => c.id));
  const rows = useMemo(() => compareTimelines(ix, ids), [ix, ids]);
  // Row spans: a cell that repeats the one above is folded into it.
  const togetherAt = (row: number, col: number) => rows[row].together.some(([a, b]) => a === col || b === col);
  const spans = useMemo(() => ids.map((_, col) => {
    const out: number[] = new Array(rows.length).fill(0);
    let start = 0;
    rows.forEach((r, i) => {
      // Fold a repeat into the cell above, unless being together with someone starts or stops.
      if (i > 0 && r.cells[col].same && togetherAt(i, col) === togetherAt(i - 1, col)) out[start]++;
      else { start = i; out[i] = 1; }
    });
    return out;
  }), [rows, ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = rows.reduce((best, r, i) => (r.day <= moment ? i : best), -1);
  return (
    <>
      <div className="form-grid narrow">
        <Field label="Characters" hint="Two or three. Each row is a moment when one of them moves; green cells are together."><CharacterChips world={world} value={ids} max={3} onChange={setIds} /></Field>
      </div>
      {ids.length < 2 ? <p className="muted">Pick two or three characters.</p> : rows.length === 0 ? <p className="empty">None of them has stays or journeys yet.</p> : (
        <div className="compare-wrap">
          <table className="table compare">
            <thead>
              <tr>
                <th>From</th>
                {ids.map((id) => { const c = world.characters.find((x) => x.id === id); return <th key={id}><span style={{ color: c?.color }}>{c?.icon}</span> {c?.name}</th>; })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.day} className={i === current ? 'now' : ''}>
                  <td className="when"><button className="link" onClick={() => store.setMoment(r.day)}>{formatDayNumber(r.day)}</button></td>
                  {ids.map((id, col) => spans[col][i] === 0 ? null : (
                    <td key={id} rowSpan={spans[col][i]} className={`cell-${r.cells[col].kind} ${togetherAt(i, col) ? 'together' : ''}`}>{r.cells[col].text}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** EU-12 */
function Calculators() {
  const { world, ix, moment } = useApp();
  const h = world.settings.hemisphereForSeasons;
  const [who, setWho] = useState<Id | undefined>(() => world.characters.find((c) => c.birth)?.id);
  const [on, setOn] = useState<FuzzyDate>();
  const [fromId, setFromId] = useState<Id>();
  const [toId, setToId] = useState<Id>();
  const [mode, setMode] = useState(world.settings.travelModes[1]?.id ?? world.settings.travelModes[0]?.id);
  const [d1, setD1] = useState<FuzzyDate>();
  const [d2, setD2] = useState<FuzzyDate>();
  const onDay = on ? toWindow(on, h).earliest : moment;
  const trip = fromId && toId && mode ? travelEstimate(ix, fromId, toId, mode) : undefined;
  const between = d1 && d2 ? toWindow(d2, h).earliest - toWindow(d1, h).earliest : undefined;
  return (
    <div className="calc-grid">
      <section className="card">
        <h2>How old?</h2>
        <div className="row wrap">
          <CharacterSelect world={world} value={who} onChange={setWho} />
          <span className="muted">on</span>
          <DateInput value={on} placeholder={`${formatDayNumber(moment)} (now)`} onChange={setOn} />
        </div>
        {who && <p className="answer">{ageText(ix, who, onDay)}</p>}
      </section>
      <section className="card">
        <h2>How long is the journey?</h2>
        <div className="row wrap">
          <PlaceSelect world={world} value={fromId} allowNone="From…" onChange={setFromId} />
          <span className="muted">to</span>
          <PlaceSelect world={world} value={toId} allowNone="To…" onChange={setToId} />
          <span className="muted">by</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>{world.settings.travelModes.map((m) => <option key={m.id} value={m.id}>{m.name.toLowerCase()}</option>)}</select>
        </div>
        {fromId && toId && !trip && <p className="muted">Both places need a position on the map.</p>}
        {trip && (
          <p className="answer">
            About <b>{trip.days < 1 ? `${Math.max(1, Math.round(trip.days * 24))} hours` : `${Math.ceil(trip.days)} ${Math.ceil(trip.days) === 1 ? 'day' : 'days'}`}</b> over {Math.round(trip.km).toLocaleString()} km
            {trip.byRoute ? <> along {trip.via.join(', ')}</> : <> ({Math.round(trip.straightKm).toLocaleString()} km straight, plus {Math.round((world.settings.defaultDetourFactor - 1) * 100)}% for winding roads)</>}
            , at {world.settings.travelModes.find((m) => m.id === mode)?.speedKmPerDay} km a day.
          </p>
        )}
      </section>
      <section className="card">
        <h2>Days between</h2>
        <div className="row wrap">
          <DateInput value={d1} onChange={setD1} />
          <span className="muted">and</span>
          <DateInput value={d2} onChange={setD2} />
        </div>
        {between !== undefined && (
          <p className="answer">
            {Math.abs(between).toLocaleString()} days
            {Math.abs(between) >= 14 && <> (about {Math.abs(between) >= 730 ? `${(Math.abs(between) / 365.25).toFixed(1)} years` : Math.abs(between) >= 60 ? `${Math.round(Math.abs(between) / 30.44)} months` : `${Math.round(Math.abs(between) / 7)} weeks`})</>}
            {between < 0 && ', counting backwards'}.
          </p>
        )}
      </section>
      {world.events.length > 0 && (
        <section className="card">
          <h2>Tip</h2>
          <p className="muted">Any date box also takes relative dates, such as “10 days after {world.events[0].name}”.</p>
        </section>
      )}
    </div>
  );
}
