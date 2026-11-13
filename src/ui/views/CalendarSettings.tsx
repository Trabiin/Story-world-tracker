/**
 * TL-2: the world's own calendars, and a converter. Dates in the app stay day/month/year (Gregorian);
 * a custom calendar is shown alongside (the date bar, the converter, Claude's folder), never instead.
 */
import { useState } from 'react';
import { CustomCalendar, calendarProblems, calendarTemplate, customDayLabel, dayInCalendars, formatDayNumber, fromDay, parseCustomDay, parseFuzzyDate, toWindow } from '../../core';
import { newId } from '../../storage';
import { ask } from '../components/Dialogs';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { useApp } from '../context';

export function CalendarSettings() {
  const { world, store, moment } = useApp();
  const cals = world.settings.calendars ?? [];
  const [open, setOpen] = useState<string | undefined>();
  const save = (list: CustomCalendar[]) => store.setSettings({ calendars: list });
  const set = (c: CustomCalendar, p: Partial<CustomCalendar>) => save(cals.map((x) => (x.id === c.id ? { ...x, ...p } : x)));
  const add = (kind: 'twelve' | 'thirteen' | 'ten') => {
    const c = calendarTemplate(kind, newId(), Math.floor(moment) - 300 * 365);
    save([...cals, c]);
    setOpen(c.id);
  };
  const remove = async (c: CustomCalendar) => { if (await ask.confirm(`Delete the calendar "${c.name}"? No dates change: they are all kept day/month/year.`, { okLabel: 'Delete', danger: true })) save(cals.filter((x) => x.id !== c.id)); };
  return (
    <>
      <h2>Calendars</h2>
      <p className="muted small">Your world's own calendars (TL-2). Dates everywhere in the app stay day/month/year; these calendars are shown next to the current date and in the converter below, and Claude sees them too.</p>
      {cals.map((c) => {
        const problems = calendarProblems(c);
        return (
          <div key={c.id} className="calendar-card">
            <div className="row">
              <b>{c.name || 'Untitled calendar'}</b>
              <span className="muted small">{problems.length ? <span className="warn-text">{problems[0]}</span> : <>Now: {customDayLabel(c, moment)}</>}</span>
              <span className="spacer" />
              <button className="small" onClick={() => setOpen(open === c.id ? undefined : c.id)}>{open === c.id ? 'Done' : 'Edit'}</button>
              <button className="icon small" aria-label="Delete calendar" onClick={() => void remove(c)}>×</button>
            </div>
            {open === c.id && <CalendarEditor c={c} set={(p) => set(c, p)} problems={problems} />}
          </div>
        );
      })}
      <div className="row">
        <span className="small">Add a calendar:</span>
        <button className="small" onClick={() => add('twelve')}>12 months (like ours)</button>
        <button className="small" onClick={() => add('thirteen')}>13 months of 28 days</button>
        <button className="small" onClick={() => add('ten')}>10 months</button>
      </div>
      {cals.length > 0 && <Converter cals={cals} />}
    </>
  );
}

function CalendarEditor({ c, set, problems }: { c: CustomCalendar; set: (p: Partial<CustomCalendar>) => void; problems: string[] }) {
  const months = c.months;
  const setMonth = (i: number, p: Partial<CustomCalendar['months'][number]>) => set({ months: months.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const yearDays = months.reduce((n, m) => n + m.days, 0);
  const leapDays = months.reduce((n, m) => n + (m.leapDays ?? 0), 0);
  const num = (v: string) => (v.trim() === '' ? undefined : Math.max(0, Math.round(Number(v) || 0)));
  return (
    <div className="calendar-editor">
      <div className="form-grid">
        <Field label="Name"><input value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Era after year 1" hint='For example "AR" (After the Reckoning). Empty: plain numbers.'><input value={c.era} onChange={(e) => set({ era: e.target.value })} /></Field>
        <Field label="Era before year 1" hint='For example "BR".'><input value={c.beforeEra ?? ''} onChange={(e) => set({ beforeEra: e.target.value || undefined })} /></Field>
        <Field label="Year 1 starts on" hint="The day/month/year date that is day 1 of the first month of year 1.">
          <DateInput value={fromDay(c.epoch)} allowEmpty={false} onChange={(d) => d && set({ epoch: toWindow(d).earliest })} />
        </Field>
      </div>
      <table className="table calendar-months">
        <thead><tr><th>#</th><th>Month</th><th>Days</th><th title="Days added in a leap year">+ in leap years</th><th /></tr></thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td><input value={m.name} onChange={(e) => setMonth(i, { name: e.target.value })} aria-label={`Month ${i + 1} name`} /></td>
              <td><input type="number" min={1} max={400} value={m.days} onChange={(e) => setMonth(i, { days: num(e.target.value) ?? 1 })} aria-label={`Month ${i + 1} days`} /></td>
              <td><input type="number" min={0} max={31} value={m.leapDays ?? 0} onChange={(e) => setMonth(i, { leapDays: num(e.target.value) || undefined })} aria-label={`Month ${i + 1} leap days`} /></td>
              <td>
                <button className="icon small" title="Move up" disabled={i === 0} onClick={() => { const l = [...months]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; set({ months: l }); }}>↑</button>
                <button className="icon small" aria-label="Remove month" disabled={months.length <= 1} onClick={() => set({ months: months.filter((_, j) => j !== i) })}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row"><button className="small" onClick={() => set({ months: [...months, { name: `Month ${months.length + 1}`, days: 30 }] })}>+ Month</button><span className="muted small">{yearDays} days a year{leapDays ? `, ${yearDays + leapDays} in a leap year` : ''}. Our year is 365.24 days.</span></div>
      <div className="form-grid">
        <Field label="Leap year every … years" hint="0: no leap years.">
          <input type="number" min={0} value={c.leap?.every ?? 0} onChange={(e) => set({ leap: { ...c.leap, every: num(e.target.value) ?? 0 } })} />
        </Field>
        <Field label="…except every … years" hint="Like 100 in our calendar. Empty: no exception.">
          <input type="number" min={0} value={c.leap?.except ?? ''} onChange={(e) => set({ leap: { every: c.leap?.every ?? 0, ...c.leap, except: num(e.target.value) || undefined } })} />
        </Field>
        <Field label="…but still every … years" hint="Like 400 in our calendar.">
          <input type="number" min={0} value={c.leap?.unless ?? ''} onChange={(e) => set({ leap: { every: c.leap?.every ?? 0, ...c.leap, unless: num(e.target.value) || undefined } })} />
        </Field>
        <Field label="Days of the week" hint="Names in order, separated by commas. Empty: no week.">
          <input value={c.weekdays.join(', ')} onChange={(e) => set({ weekdays: e.target.value.split(',').map((w) => w.trim()).filter(Boolean) })} />
        </Field>
      </div>
      {problems.length > 0 && <ul className="warn-text small">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </div>
  );
}

/** Type a date in any calendar (or day/month/year) and see it in all of them. */
function Converter({ cals }: { cals: CustomCalendar[] }) {
  const { world } = useApp();
  const [text, setText] = useState('');
  const usable = cals.filter((c) => !calendarProblems(c).length);
  let day: number | undefined, from = '';
  if (text.trim()) {
    for (const c of usable) { const d = parseCustomDay(c, text); if (d !== undefined) { day = d; from = c.name; break; } }
    if (day === undefined) { const g = parseFuzzyDate(text); if (g) { day = toWindow(g, world.settings.hemisphereForSeasons).earliest; from = 'day/month/year'; } }
  }
  return (
    <div className="calendar-converter">
      <Field label="Convert a date" hint='Type a day/month/year date ("3/5/1042") or a date in one of your calendars ("3 Thaw 318 AR").'>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="3/5/1042 or 3 Thaw 318 AR" />
      </Field>
      {text.trim() && (day === undefined ? <p className="warn-text small">Not a date in any of your calendars.</p> : (
        <table className="table small">
          <tbody>
            <tr><td className="muted">Day/month/year</td><td>{formatDayNumber(day)}</td></tr>
            {dayInCalendars(usable, day).map((r) => <tr key={r.id}><td className="muted">{r.name}</td><td>{r.label}</td></tr>)}
            <tr><td className="muted" colSpan={2}>Read as {from}.</td></tr>
          </tbody>
        </table>
      ))}
    </div>
  );
}
