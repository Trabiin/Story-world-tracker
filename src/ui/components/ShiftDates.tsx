/** EU-4: "push everything after the siege back two weeks". */
import { useMemo, useState } from 'react';
import { FuzzyDate, Id, formatDayNumber, shiftDates, toWindow } from '../../core';
import { DateInput } from './DateInput';
import { Field, Modal } from './Modal';
import { CharacterChips } from './Pickers';
import { useApp } from '../context';

const UNITS = [['days', 1], ['weeks', 7], ['months', 30], ['years', 365]] as const;

export function ShiftDatesModal({ from, characterIds, onClose, title }: { from?: FuzzyDate; characterIds?: Id[]; onClose: () => void; title?: string }) {
  const { world, store, moment, unfiltered } = useApp();
  const h = world.settings.hemisphereForSeasons;
  const [start, setStart] = useState<FuzzyDate | undefined>(from);
  const [n, setN] = useState(2);
  const [unit, setUnit] = useState<(typeof UNITS)[number][0]>('weeks');
  const [dir, setDir] = useState<1 | -1>(1);
  const [only, setOnly] = useState<Id[]>(characterIds ?? []);
  const fromDay = start ? toWindow(start, h).earliest : Math.floor(moment);
  const days = dir * n * UNITS.find((u) => u[0] === unit)![1];
  const opts = { fromDay, days, characterIds: only.length ? only : undefined };
  const preview = useMemo(() => shiftDates(unfiltered, opts), [unfiltered, fromDay, days, only]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = () => { store.update((w) => shiftDates(w, opts).world); onClose(); };
  return (
    <Modal title={title ?? 'Shift dates'} onClose={onClose} footer={<><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!preview.shifted} onClick={run}>Shift {preview.shifted} {preview.shifted === 1 ? 'date' : 'dates'}</button></>}>
      <div className="form-grid">
        <div className="row wrap">
          <span>Move everything on or after</span>
          <DateInput value={start} placeholder={`${formatDayNumber(Math.floor(moment))} (now)`} onChange={setStart} />
        </div>
        <div className="row wrap">
          <select value={dir} onChange={(e) => setDir(Number(e.target.value) as 1 | -1)}><option value={1}>later by</option><option value={-1}>earlier by</option></select>
          <input type="number" min={1} style={{ width: 70 }} value={n} onChange={(e) => setN(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
          <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>{UNITS.map(([u]) => <option key={u} value={u}>{u}</option>)}</select>
        </div>
        <Field label="Only for" hint="Leave empty for everyone. A group's own entries move only when every member is chosen."><CharacterChips world={world} value={only} onChange={setOnly} /></Field>
      </div>
      <p className="muted">
        {preview.shifted ? `${preview.shifted} ${preview.shifted === 1 ? 'date' : 'dates'} in ${preview.records} ${preview.records === 1 ? 'record' : 'records'}: stays, journeys, scenes, events, memberships, relationships, attributes and plans.` : 'No dates to move.'}
        {preview.skipped > 0 && ` ${preview.skipped} vague ${preview.skipped === 1 ? 'date (a month, season or year) stays' : 'dates (months, seasons or years) stay'} as ${preview.skipped === 1 ? 'it is' : 'they are'}; whole years move those too.`}
        {' '}Births and deaths stay put. Dates set relative to an event or chapter follow it. You can undo this.
      </p>
    </Modal>
  );
}
