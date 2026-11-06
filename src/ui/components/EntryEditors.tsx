/** Stay (WH-1..WH-3) and journey (WH-5, WH-7, WH-8) editors. */
import { useMemo, useState } from 'react';
import { ask } from './Dialogs';
import { Backlinks } from './Backlinks';
import { FuzzyDate, Journey, LatLng, Stay, Subject, WorldIndex, formatDayNumber, formatFuzzy, fromDay, routeThrough } from '../../core';
import { recordBase } from '../../storage';
import { useApp } from '../context';
import { DateInput } from './DateInput';
import { Field, Modal } from './Modal';
import { PlaceSelect, SubjectSelect } from './Pickers';
import { RevealField } from './RevealField';

type Draftable = { status: 'draft' | 'canon' };

function StatusToggle({ value, onChange }: { value: Draftable['status']; onChange: (s: Draftable['status']) => void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={value === 'draft'} onChange={(e) => onChange(e.target.checked ? 'draft' : 'canon')} /> Draft (not yet canon)
    </label>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button className="danger" onClick={async () => (await ask.confirm('Delete this entry?', { okLabel: 'Delete', danger: true })) && onDelete()}>
      Delete
    </button>
  );
}

export function StayEditor({ id, preset, onClose }: { id?: string; preset?: Partial<Stay>; onClose: () => void }) {
  const { world, store } = useApp();
  const existing = world.stays.find((s) => s.id === id);
  const [s, setS] = useState<Stay>(
    () => existing ?? { ...recordBase(), subject: undefined as unknown as Subject, placeId: '', arrival: undefined as unknown as FuzzyDate, purpose: '', notes: '', ...preset },
  );
  const [endMode, setEndMode] = useState<'date' | 'duration' | 'open'>(s.departure ? 'date' : s.durationDays !== undefined ? 'duration' : existing ? 'open' : 'date');
  const set = (p: Partial<Stay>) => setS((x) => ({ ...x, ...p }));
  const valid = s.subject && s.placeId && s.arrival;
  const save = () => {
    const clean: Stay = { ...s };
    if (endMode !== 'date') delete clean.departure;
    if (endMode !== 'duration') delete clean.durationDays;
    store.upsert('stays', clean);
    onClose();
  };
  return (
    <Modal
      title={existing ? 'Edit stay' : 'New stay'}
      onClose={onClose}
      footer={
        <>
          {existing && <DeleteButton onDelete={() => (store.removeMany([{ c: 'stays', id: s.id }]), onClose())} />}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={save}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Who"><SubjectSelect world={world} value={s.subject} onChange={(subject) => set({ subject })} /></Field>
        <Field label="Where"><PlaceSelect world={world} value={s.placeId} onChange={(placeId) => set({ placeId: placeId ?? '' })} /></Field>
        <Field label="Arrives"><DateInput value={s.arrival} allowEmpty={false} onChange={(arrival) => arrival && set({ arrival })} /></Field>
        <Field label="Leaves">
          <div className="row">
            <select value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)}>
              <option value="date">on a date</option>
              <option value="duration">after a number of days</option>
              <option value="open">until further notice</option>
            </select>
            {endMode === 'date' && <DateInput value={s.departure} onChange={(departure) => set({ departure })} />}
            {endMode === 'duration' && (
              <input type="number" min={0} style={{ width: 90 }} value={s.durationDays ?? ''} onChange={(e) => set({ durationDays: e.target.value === '' ? undefined : Number(e.target.value) })} />
            )}
          </div>
        </Field>
        <Field label="Doing what" hint="Purpose and activities (WH-2)"><input value={s.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="e.g. recovering from wounds, negotiating the treaty" /></Field>
        <Field label="Notes"><textarea rows={3} value={s.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <RevealField value={s.revealedIn} onChange={(revealedIn) => set({ revealedIn })} />
        <StatusToggle value={s.status} onChange={(status) => set({ status })} />
        {existing && <Backlinks kind="stay" id={s.id} title="Linked passages" />}
      </div>
    </Modal>
  );
}

export function JourneyEditor({ id, preset, onClose }: { id?: string; preset?: Partial<Journey>; onClose: () => void }) {
  const { world, store, moment, go, startRoute } = useApp();
  const existing = world.journeys.find((j) => j.id === id);
  const [j, setJ] = useState<Journey>(
    () =>
      existing ?? {
        ...recordBase(),
        subject: undefined as unknown as Subject,
        originId: '',
        destinationId: '',
        waypointIds: [],
        departure: undefined as unknown as FuzzyDate,
        modeId: world.settings.travelModes[1]?.id ?? world.settings.travelModes[0]?.id ?? 'foot',
        purpose: '',
        notes: '',
        ...preset,
      },
  );
  // Changing where the journey goes makes a drawn route stale, so it is dropped.
  const set = (p: Partial<Journey>) => setJ((x) => ({ ...x, ...p, ...('originId' in p || 'destinationId' in p || 'waypointIds' in p ? { route: undefined } : {}) }));
  const ix = useMemo(() => new WorldIndex(world), [world]);
  const [via, setVia] = useState<string[] | null>(null);
  const stops = (): LatLng[] | undefined => {
    const pts = [j.originId, ...j.waypointIds, j.destinationId].map((id) => ix.locationOf(id));
    return pts.every(Boolean) ? (pts as LatLng[]) : undefined;
  };
  const followRoads = () => {
    const s = stops();
    if (!s) return;
    const day = j.departure ? ix.win(j.departure).earliest : moment;
    const r = routeThrough(world, s, j.modeId, day, (d) => ix.win(d));
    setVia(r.via);
    if (!r.via.length) void ask.alert('No drawn roads, rivers or sea lanes help on this journey, so it stays a straight line.');
    else setJ((x) => ({ ...x, route: r.points }));
  };
  const km = j.originId && j.destinationId ? ix.journeyDistanceKm(j) : undefined;
  const days = j.originId && j.destinationId ? ix.suggestedTravelDays(j) : undefined;
  const suggested = days !== undefined && j.departure ? fromDay(ix.win(j.departure).earliest + days) : undefined;
  const valid = j.subject && j.originId && j.destinationId && j.departure;
  const missingPos = j.originId && j.destinationId && km === undefined;
  return (
    <Modal
      title={existing ? 'Edit journey' : 'New journey'}
      onClose={onClose}
      footer={
        <>
          {existing && <DeleteButton onDelete={() => (store.removeMany([{ c: 'journeys', id: j.id }]), onClose())} />}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={() => (store.upsert('journeys', j), onClose())}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Who"><SubjectSelect world={world} value={j.subject} onChange={(subject) => set({ subject })} /></Field>
        <Field label="From"><PlaceSelect world={world} value={j.originId} onChange={(originId) => set({ originId: originId ?? '' })} /></Field>
        <Field label="Via" hint="Optional waypoints, in order">
          <div className="stack">
            {j.waypointIds.map((w, i) => (
              <div className="row" key={i}>
                <PlaceSelect world={world} value={w} onChange={(v) => set({ waypointIds: j.waypointIds.map((x, k) => (k === i ? v ?? '' : x)).filter(Boolean) })} />
                <button className="icon" onClick={() => set({ waypointIds: j.waypointIds.filter((_, k) => k !== i) })}>×</button>
              </div>
            ))}
            <PlaceSelect world={world} value={undefined} allowNone="+ add a waypoint" onChange={(v) => v && set({ waypointIds: [...j.waypointIds, v] })} />
          </div>
        </Field>
        <Field label="To"><PlaceSelect world={world} value={j.destinationId} onChange={(destinationId) => set({ destinationId: destinationId ?? '' })} /></Field>
        <Field label="Travelling by">
          <div className="row">
            <select value={j.modeId} onChange={(e) => set({ modeId: e.target.value })}>
              {world.settings.travelModes.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.speedKmPerDay} km/day)</option>
              ))}
            </select>
            {!j.route && (
              <>
                <span className="muted">detour ×</span>
                <input type="number" step={0.05} min={1} style={{ width: 70 }} value={j.detourFactor ?? world.settings.defaultDetourFactor} onChange={(e) => set({ detourFactor: Number(e.target.value) || undefined })} />
              </>
            )}
          </div>
        </Field>
        <Field label="Route" hint={j.route ? `Drawn route, ${Math.round(km ?? 0)} km${via?.length ? ` along ${via.join(', ')}` : ''}.` : 'Straight line for now. Follow the drawn roads, rivers and sea lanes, or draw the route on the map.'}>
          <div className="row wrap">
            <button className="small" disabled={!stops()} onClick={followRoads} title="Ships follow sea lanes and rivers; flyers go straight">Follow roads</button>
            <button className="small" disabled={!valid} onClick={() => { store.upsert('journeys', j); startRoute(j.id); go('map'); onClose(); }}>Draw on map</button>
            {j.route && <button className="small" onClick={() => { setVia(null); setJ((x) => ({ ...x, route: undefined })); }}>Straight line</button>}
          </div>
        </Field>
        <Field label="Departs"><DateInput value={j.departure} allowEmpty={false} onChange={(departure) => departure && set({ departure })} /></Field>
        <Field
          label="Arrives"
          hint={
            missingPos ? 'Give both places a position on the map to get a suggested arrival.' :
            km !== undefined ? (
              <>
                {j.route ? `${Math.round(km)} km along the route` : `${Math.round(km)} km straight, ~${Math.round(km * ix.detourOf(j))} km travelled`} ≈ {days} day(s).{' '}
                {suggested && (
                  <>
                    Suggested arrival: <b>{formatFuzzy(suggested)}</b>{' '}
                    {j.arrival && <button className="link" onClick={() => set({ arrival: suggested })}>use it</button>}
                  </>
                )}
              </>
            ) : undefined
          }
        >
          <DateInput value={j.arrival} placeholder={suggested ? `blank = suggested (${formatDayNumber(ix.win(suggested).earliest)})` : undefined} onChange={(arrival) => set({ arrival })} />
        </Field>
        <Field label="Purpose"><input value={j.purpose} onChange={(e) => set({ purpose: e.target.value })} /></Field>
        <Field label="Notes"><textarea rows={3} value={j.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <RevealField value={j.revealedIn} onChange={(revealedIn) => set({ revealedIn })} />
        <StatusToggle value={j.status} onChange={(status) => set({ status })} />
        {existing && <Backlinks kind="journey" id={j.id} title="Linked passages" />}
      </div>
    </Modal>
  );
}
