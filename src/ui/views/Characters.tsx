/** CH-1, CH-2, CH-6, EU-9: characters list and profile, with their whereabouts chain. */
import { useMemo, useState } from 'react';
import { ask } from '../components/Dialogs';
import { RevealField } from '../components/RevealField';
import { ATTRIBUTE_KEYS, Character, CharacterAttribute, Importance, ageOn, attributesOn, formatDayNumber, formatFuzzy, fromDayNumber, nominalStart } from '../../core';
import { Backlinks } from '../components/Backlinks';
import { recordBase } from '../../storage';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { useApp } from '../context';
import { ICONS, PALETTE, blankCharacter, placeName, splitList } from '../util';

const IMPORTANCE: Importance[] = ['main', 'secondary', 'minor'];

export function Characters() {
  const { world, store, selected, select } = useApp();
  const [q, setQ] = useState('');
  const [imp, setImp] = useState<Importance | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [tag, setTag] = useState('');
  const tags = useMemo(() => [...new Set(world.characters.flatMap((c) => c.tags))].sort(), [world.characters]);
  const list = useMemo(() => {
    const s = q.toLowerCase();
    return world.characters
      .filter((c) => (showArchived || !c.archived) && (imp === 'all' || c.importance === imp) && (!tag || c.tags.includes(tag)))
      .filter((c) => !s || c.name.toLowerCase().includes(s) || c.aliases.some((a) => a.toLowerCase().includes(s)))
      .sort((a, b) => IMPORTANCE.indexOf(a.importance) - IMPORTANCE.indexOf(b.importance) || a.name.localeCompare(b.name));
  }, [world.characters, q, imp, showArchived, tag]);
  const current = world.characters.find((c) => c.id === selected);
  const add = () => {
    const c = blankCharacter(world, recordBase());
    store.upsert('characters', c);
    select(c.id);
  };
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools">
          <input placeholder="Search names and aliases" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row">
            <select value={imp} onChange={(e) => setImp(e.target.value as Importance | 'all')}>
              <option value="all">All</option>
              {IMPORTANCE.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            {tags.length > 0 && (
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Any tag</option>
                {tags.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
          </div>
          <label className="checkbox"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
          <button className="primary" onClick={add}>+ New character</button>
        </div>
        <ul className="list">
          {list.map((c, i) => (
            <li key={c.id} className={c.id === selected ? 'active' : ''} onClick={() => select(c.id)}>
              {(i === 0 || list[i - 1].importance !== c.importance) && <div className="list-heading">{c.importance}</div>}
              <span className="swatch" style={{ color: c.color }}>{c.icon}</span> {c.name}
              {c.archived && <span className="tag">archived</span>}
            </li>
          ))}
        </ul>
        <div className="muted small-pad">{list.length} of {world.characters.length}</div>
      </aside>
      <section className="detail">{current ? <CharacterDetail key={current.id} c={current} /> : <div className="empty">Select or add a character.</div>}</section>
    </div>
  );
}

function CharacterDetail({ c }: { c: Character }) {
  const { world, store, ix, moment, edit, warnings, select, go, showTrack } = useApp();
  const set = (p: Partial<Character>) => store.upsert('characters', { ...c, ...p });
  const segs = useMemo(() => ix.segmentsFor(c.id), [ix, c.id]);
  const mine = warnings.filter((w) => w.characterId === c.id && !w.dismissed);
  const age = c.birth ? ageOn(fromDayNumber(ix.win(c.birth).earliest), fromDayNumber(moment)) : undefined;
  const lastEnd = segs.length ? segs[segs.length - 1] : undefined;
  const nextPreset = () => {
    if (!lastEnd || lastEnd.end.latest === Number.MAX_SAFE_INTEGER) return { subject: { kind: 'character' as const, id: c.id } };
    const d = fromDayNumber(lastEnd.end.earliest);
    return { subject: { kind: 'character' as const, id: c.id }, departure: { ...d, precision: 'day' as const }, arrival: { ...d, precision: 'day' as const }, originId: lastEnd.destinationId ?? lastEnd.placeId };
  };
  const remove = async () => {
    const stays = world.stays.filter((s) => s.subject.kind === 'character' && s.subject.id === c.id);
    const journeys = world.journeys.filter((j) => j.subject.kind === 'character' && j.subject.id === c.id);
    const mem = world.memberships.filter((m) => m.characterId === c.id);
    if (!(await ask.confirm(`Delete ${c.name}? This also deletes ${stays.length} stay(s), ${journeys.length} journey(s) and ${mem.length} group membership(s). Consider archiving instead.`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'characters', id: c.id }, ...stays.map((s) => ({ c: 'stays' as const, id: s.id })), ...journeys.map((j) => ({ c: 'journeys' as const, id: j.id })), ...mem.map((m) => ({ c: 'memberships' as const, id: m.id }))]);
    select(undefined);
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1><span style={{ color: c.color }}>{c.icon}</span> {c.name}</h1>
        <div className="row">
          {age !== undefined && age >= 0 && <span className="muted">Age {age} on {formatDayNumber(moment)}</span>}
          {segs.length > 0 && <button onClick={() => showTrack(c.id)} title="VW-3: draw every stay and journey on the map">Show track on map</button>}
          <button onClick={() => set({ archived: !c.archived })}>{c.archived ? 'Unarchive' : 'Archive'}</button>
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <div className="two-col">
        <div className="form-grid">
          <Field label="Name"><input value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Aliases and titles" hint="Comma separated"><CommaInput value={c.aliases} onChange={(aliases) => set({ aliases })} /></Field>
          <Field label="Importance">
            <select value={c.importance} onChange={(e) => set({ importance: e.target.value as Importance })}>
              {IMPORTANCE.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Tags" hint="Comma separated, e.g. POV, antagonist"><CommaInput value={c.tags} onChange={(tags) => set({ tags })} /></Field>
          <Field label="Born"><DateInput value={c.birth} onChange={(birth) => set({ birth })} /></Field>
          <Field label="Died"><DateInput value={c.death} onChange={(death) => set({ death })} /></Field>
          <Field label="Colour and icon">
            <div className="row wrap">
              {PALETTE.map((p) => <button key={p} className={`color-dot ${c.color === p ? 'on' : ''}`} style={{ background: p }} onClick={() => set({ color: p })} aria-label={p} />)}
              <input type="color" value={c.color} onChange={(e) => set({ color: e.target.value })} />
            </div>
            <div className="row wrap">
              {ICONS.map((i) => <button key={i} className={`icon-pick ${c.icon === i ? 'on' : ''}`} style={{ color: c.color }} onClick={() => set({ icon: i })}>{i}</button>)}
            </div>
          </Field>
          <Attributes c={c} set={set} />
          <Field label="Short description"><textarea rows={2} value={c.description} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="Notes"><textarea rows={5} value={c.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          <RevealField value={c.revealedIn} onChange={(revealedIn) => set({ revealedIn })} />
          <Field label="Portrait">
            <div className="row">
              {c.portrait && <img src={c.portrait} className="portrait" alt="" />}
              <input type="file" accept="image/*" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) set({ portrait: await fileToDataUrl(f, 256) });
              }} />
              {c.portrait && <button className="small" onClick={() => set({ portrait: undefined })}>Remove</button>}
            </div>
          </Field>
        </div>
        <div>
          <div className="section-head">
            <h2>Whereabouts</h2>
            <div className="row">
              <button onClick={() => edit({ kind: 'stay', preset: { subject: { kind: 'character', id: c.id }, ...(nextPreset().arrival ? { arrival: nextPreset().arrival, placeId: nextPreset().originId } : {}) } })}>+ Stay</button>
              <button onClick={() => edit({ kind: 'journey', preset: nextPreset() })}>+ Journey</button>
            </div>
          </div>
          {segs.length === 0 ? <p className="muted">No stays or journeys yet.</p> : (
            <ol className="chain">
              {segs.map((s) => {
                const stay = s.kind === 'stay' ? world.stays.find((x) => x.id === s.recordId) : undefined;
                const j = s.kind === 'journey' ? world.journeys.find((x) => x.id === s.recordId) : undefined;
                const rec = stay ?? j;
                const active = nominalStart(s) <= moment && moment <= (s.end.latest === Number.MAX_SAFE_INTEGER ? Infinity : s.end.latest);
                return (
                  <li key={s.recordId + (s.viaGroupId ?? '')} className={`${s.kind} ${active ? 'now' : ''} ${rec?.status === 'draft' ? 'draft' : ''}`} onClick={() => edit({ kind: s.kind, id: s.recordId })}>
                    <div className="when">
                      {stay && <>{formatFuzzy(stay.arrival)} – {stay.departure ? formatFuzzy(stay.departure) : stay.durationDays !== undefined ? `${stay.durationDays} days` : 'until further notice'}</>}
                      {j && <>{formatFuzzy(j.departure)} – {j.arrival ? formatFuzzy(j.arrival) : `${formatDayNumber(s.end.earliest)} (suggested)`}</>}
                    </div>
                    <div className="what">
                      {stay && <>At <b>{placeName(world, stay.placeId)}</b>{stay.purpose && <> · {stay.purpose}</>}</>}
                      {j && <>Travels <b>{placeName(world, j.originId)}</b> → <b>{placeName(world, j.destinationId)}</b> by {world.settings.travelModes.find((m) => m.id === j.modeId)?.name.toLowerCase()}{j.purpose && <> · {j.purpose}</>}</>}
                      {s.viaGroupId && <span className="tag">with {world.groups.find((g) => g.id === s.viaGroupId)?.name}</span>}
                      {rec?.status === 'draft' && <span className="tag">draft</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <Backlinks kind="character" id={c.id} />
          {world.regions.some((r) => r.ties.some((t) => t.characterId === c.id)) && (
            <>
              <h2>Realms and regions</h2>
              <ul className="plain">
                {world.regions.flatMap((r) => r.ties.filter((t) => t.characterId === c.id).map((t) => (
                  <li key={t.id}>
                    <button className="link" onClick={() => go('layers', r.id)}>{r.name}</button>
                    <span className="muted"> · {t.role}{(t.start || t.end) && ` · ${t.start ? formatFuzzy(t.start) : '…'} – ${t.end ? formatFuzzy(t.end) : '…'}`}</span>
                  </li>
                )))}
              </ul>
            </>
          )}
          {mine.length > 0 && (
            <>
              <h2>Warnings</h2>
              <ul className="warnings compact">
                {mine.map((w) => <li key={w.key} className={w.severity} onClick={() => go('warnings', w.key)}>{w.message}</li>)}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Text input for comma-separated lists that only commits on blur, so typing commas works. */
export function CommaInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(splitList(text))} />;
}

export function fileToDataUrl(file: File, maxSize?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (!maxSize) return resolve(String(r.result));
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = String(r.result);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** CH-3: time-bound attributes, e.g. "Captain of the Guard, 1040–1043". */
function Attributes({ c, set }: { c: Character; set: (p: Partial<Character>) => void }) {
  const { ix, moment } = useApp();
  const list = c.attributes ?? [];
  const now = attributesOn(ix, c.id, moment);
  const setA = (a: CharacterAttribute, p: Partial<CharacterAttribute>) => set({ attributes: list.map((x) => (x.id === a.id ? { ...x, ...p } : x)) });
  return (
    <Field label="Attributes over time" hint={Object.keys(now).length ? `On ${formatDayNumber(moment)}: ${Object.entries(now).map(([k, v]) => `${k} ${v}`).join(' · ')}` : 'Title, allegiance, faction, culture, religion, health, possessions…'}>
      <datalist id="attr-keys">{ATTRIBUTE_KEYS.map((k) => <option key={k} value={k} />)}</datalist>
      {list.length > 0 && (
        <table className="table attr-table">
          <thead><tr><th>Attribute</th><th>Value</th><th>From</th><th>Until</th><th></th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td><input list="attr-keys" value={a.key} onChange={(e) => setA(a, { key: e.target.value })} /></td>
                <td><input value={a.value} onChange={(e) => setA(a, { value: e.target.value })} /></td>
                <td><DateInput value={a.start} placeholder="always" onChange={(start) => setA(a, { start })} /></td>
                <td><DateInput value={a.end} placeholder="still" onChange={(end) => setA(a, { end })} /></td>
                <td><button className="icon" onClick={() => set({ attributes: list.filter((x) => x.id !== a.id) })}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div><button className="small" onClick={() => set({ attributes: [...list, { id: crypto.randomUUID(), key: 'title', value: '' }] })}>+ Add attribute</button></div>
    </Field>
  );
}
