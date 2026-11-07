/** CH-1, CH-2, CH-6, EU-9: characters list and profile, with their whereabouts chain. EU-3 templates, EU-4 bulk edit, EU-20 merge and delete. */
import { useMemo, useState } from 'react';
import { ask } from '../components/Dialogs';
import { RevealField } from '../components/RevealField';
import { ATTRIBUTE_KEYS, BulkCharacterEdit, Character, CharacterAttribute, Id, Importance, ageOn, attributesOn, bulkEditCharacters, characterFromTemplate, formatDayNumber, formatFuzzy, fromDayNumber, nominalStart, templateFromCharacter } from '../../core';
import { Backlinks } from '../components/Backlinks';
import { newId, recordBase } from '../../storage';
import { Pictures } from '../components/Pictures';
import { DeleteDialog, MergeDialog } from '../components/RecordTools';
import { ShiftDatesModal } from '../components/ShiftDates';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { useApp } from '../context';
import { TodosFor } from '../components/Refs';
import { Research } from '../components/Research';
import { ICONS, PALETTE, blankCharacter, placeName, splitList } from '../util';
import { Knowledge, Relationships, StatusBadge } from './CharacterExtras';
import { Plans } from './CharacterPlans';

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
  const templates = world.settings.characterTemplates ?? [];
  const fromTemplate = async (tid: string) => {
    const t = templates.find((x) => x.id === tid);
    if (!t) return;
    const name = await ask.prompt(`Name of the new ${t.name.toLowerCase()}:`, '');
    if (!name?.trim()) return;
    const { character, memberships } = characterFromTemplate(t, name.trim(), recordBase(), newId);
    store.update((w) => ({ ...w, characters: [...w.characters, character], memberships: [...w.memberships, ...memberships] }));
    select(character.id);
  };
  // EU-4: pick several characters and change them together.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Id[]>([]);
  const [shifting, setShifting] = useState(false);
  const toggle = (id: Id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const bulk = async (v: string) => {
    let e: BulkCharacterEdit | undefined;
    if (v === 'add-tag' || v === 'remove-tag') {
      const tag = await ask.prompt(v === 'add-tag' ? 'Tag to add:' : 'Tag to remove:', '');
      if (tag?.trim()) e = { kind: v, tag: tag.trim() };
    } else if (v.startsWith('imp:')) e = { kind: 'importance', importance: v.slice(4) as Importance };
    else if (v === 'archive' || v === 'unarchive') e = { kind: 'archive', archived: v === 'archive' };
    else if (v === 'shift') setShifting(true);
    if (e) store.update((w) => bulkEditCharacters(w, picked, e!));
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
          {templates.length > 0 && (
            <select value="" onChange={(e) => void fromTemplate(e.target.value)} title="EU-3: start from a template">
              <option value="">+ New from a template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <div className="row">
            <button className={`small ${picking ? 'on' : ''}`} onClick={() => { setPicking(!picking); setPicked([]); }}>{picking ? 'Done selecting' : 'Select several'}</button>
            {picking && <button className="small" onClick={() => setPicked(picked.length === list.length ? [] : list.map((c) => c.id))}>{picked.length === list.length ? 'None' : 'All'}</button>}
          </div>
          {picking && picked.length > 0 && (
            <select className="bulk-select" value="" onChange={(e) => void bulk(e.target.value)}>
              <option value="">Change {picked.length} {picked.length === 1 ? 'character' : 'characters'}…</option>
              <option value="add-tag">Add a tag…</option>
              <option value="remove-tag">Remove a tag…</option>
              {IMPORTANCE.map((i) => <option key={i} value={`imp:${i}`}>Make {i}</option>)}
              <option value="archive">Archive</option>
              <option value="unarchive">Unarchive</option>
              <option value="shift">Shift their dates…</option>
            </select>
          )}
        </div>
        <ul className="list">
          {list.map((c, i) => (
            <li key={c.id} className={c.id === selected ? 'active' : ''} onClick={() => (picking ? toggle(c.id) : select(c.id))}>
              {(i === 0 || list[i - 1].importance !== c.importance) && <div className="list-heading">{c.importance}</div>}
              {picking && <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${c.name}`} />}
              <span className="swatch" style={{ color: c.color }}>{c.icon}</span> {c.name}
              {c.archived && <span className="tag">archived</span>}
            </li>
          ))}
        </ul>
        <div className="muted small-pad">{list.length} of {world.characters.length}</div>
      </aside>
      <section className="detail">{current ? <CharacterDetail key={current.id} c={current} /> : <div className="empty">Select or add a character.</div>}</section>
      {shifting && <ShiftDatesModal characterIds={picked} title={`Shift dates for ${picked.length} ${picked.length === 1 ? 'character' : 'characters'}`} onClose={() => setShifting(false)} />}
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
  const [dialog, setDialog] = useState<'delete' | 'merge' | null>(null);
  const more = async (v: string) => {
    if (v === 'merge') setDialog('merge');
    if (v === 'template') {
      const name = await ask.prompt('Name this template (for example “Soldier of the Guard”):', c.tags[0] ?? '');
      if (!name?.trim()) return;
      const t = templateFromCharacter(world, c, name.trim(), newId());
      store.setSettings({ characterTemplates: [...(world.settings.characterTemplates ?? []), t] });
      void ask.alert(`Saved. New characters can now start as “${t.name}”, with ${c.name}'s tags, importance, look${t.attributes.length ? ', lasting attributes' : ''}${t.groupIds.length ? ' and groups' : ''}.`);
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1><span style={{ color: c.color }}>{c.icon}</span> {c.name}</h1>
        <div className="row">
          <StatusBadge id={c.id} />
          {age !== undefined && age >= 0 && <span className="muted">Age {age} on {formatDayNumber(moment)}</span>}
          {segs.length > 0 && <button onClick={() => showTrack(c.id)} title="VW-3: draw every stay and journey on the map">Show track on map</button>}
          <button onClick={() => set({ archived: !c.archived })}>{c.archived ? 'Unarchive' : 'Archive'}</button>
          <select className="more" value="" onChange={(e) => void more(e.target.value)} aria-label="More actions">
            <option value="">More…</option>
            <option value="merge">Merge into another character…</option>
            <option value="template">Save as a template…</option>
          </select>
          <button className="danger" onClick={() => setDialog('delete')}>Delete</button>
        </div>
      </div>
      {dialog === 'delete' && <DeleteDialog collection="characters" id={c.id} extra="Consider archiving instead: archived characters keep their history but leave the lists." onClose={() => setDialog(null)} onDone={() => select(undefined)} />}
      {dialog === 'merge' && <MergeDialog collection="characters" id={c.id} onClose={() => setDialog(null)} onDone={(keep) => select(keep)} />}
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
          <Relationships c={c} />
          <Plans c={c} />
          <Knowledge c={c} />
          <Backlinks kind="character" id={c.id} />
          <TodosFor kind="character" id={c.id} />
          <Research kind="character" id={c.id} />
          <Pictures value={c.images} onChange={(images) => set({ images })} />
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
