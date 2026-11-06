/**
 * WR-12 word goals and the calendar of words written per day, WR-13 scene stage controls, SR-1 the
 * series table. Shared by the Write page's sidebar, Books & scenes and the Home page.
 */
import { useEffect, useMemo, useState } from 'react';
import { BookProgress, SCENE_STAGES, STAGE_COLOR, STAGE_LABEL, SceneStage, World, dayKey, formatDayKey, parseDayKey, stageOf, writingCalendar } from '../../core';

const n = (x: number) => x.toLocaleString('en-US');

/** WR-13: a small coloured dot for a scene's stage. */
export function StageDot({ stage }: { stage?: SceneStage }) {
  const s = stage ?? 'idea';
  return <span className={`stage-dot stage-${s}`} style={{ background: STAGE_COLOR[s] }} title={STAGE_LABEL[s]} aria-label={STAGE_LABEL[s]} />;
}

/** WR-13: choose a scene's stage. */
export function StageSelect({ value, onChange, disabled, compact }: { value?: SceneStage; onChange: (s: SceneStage) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <select className={compact ? 'stage-select compact' : 'stage-select'} value={stageOf({ stage: value })} disabled={disabled} onChange={(e) => onChange(e.target.value as SceneStage)} title="WR-13: how far this scene has got" aria-label="Scene stage">
      {SCENE_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
    </select>
  );
}

/** WR-13: scenes at each stage as one bar. */
export function StageBar({ stages, total }: { stages: Record<SceneStage, number>; total: number }) {
  if (!total) return <span className="muted small">No scenes</span>;
  return (
    <span className="stage-bar" title={SCENE_STAGES.filter((s) => stages[s]).map((s) => `${STAGE_LABEL[s]}: ${stages[s]}`).join(' · ')}>
      {SCENE_STAGES.map((s) => (stages[s] ? <span key={s} style={{ width: `${(stages[s] / total) * 100}%`, background: STAGE_COLOR[s] }} /> : null))}
    </span>
  );
}

/** A progress bar towards a goal. */
export function GoalBar({ value, goal, label }: { value: number; goal?: number; label?: string }) {
  const f = goal ? Math.max(0, Math.min(1, value / goal)) : 0;
  return (
    <div className="goal-bar" title={label}>
      <div className="goal-fill" style={{ width: `${f * 100}%` }} data-done={goal && value >= goal ? 'true' : undefined} />
    </div>
  );
}

/** WR-12: a real-world day typed day/month/year (D-3), whatever the computer's own date format is. Value "YYYY-MM-DD". */
export function DayInput({ value, onChange, disabled }: { value?: string; onChange: (v: string | undefined) => void; disabled?: boolean }) {
  const [text, setText] = useState(formatDayKey(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(formatDayKey(value)); setBad(false); }, [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) { setBad(false); if (value) onChange(undefined); return; }
    const m = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(t);
    const key = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
    if (!parseDayKey(key)) { setBad(true); return; }
    setBad(false);
    if (key !== value) onChange(key);
    else setText(formatDayKey(key));
  };
  return (
    <input className={`day-input ${bad ? 'bad' : ''}`} value={text} placeholder="dd/mm/yyyy" disabled={disabled} aria-invalid={bad} title={bad ? 'Type the day as day/month/year, e.g. 31/12/2026' : 'Day/month/year'}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
  );
}

/** WR-12: a book's deadline and what it takes to make it. */
export function deadlineText(p: BookProgress): string {
  if (!p.deadline) return '';
  const d = formatDayKey(p.deadline);
  if (p.daysLeft === undefined) return d;
  if (p.daysLeft < 0) return `${d} · ${-p.daysLeft} ${p.daysLeft === -1 ? 'day' : 'days'} ago`;
  const left = p.daysLeft === 0 ? 'today' : `${p.daysLeft} ${p.daysLeft === 1 ? 'day' : 'days'} left`;
  return `${d} · ${left}${p.perDay ? ` · ${n(p.perDay)} words a day to finish` : ''}`;
}

/** WR-12: the calendar of words written per day, weeks as columns (Monday at the top). */
export function WritingCalendar({ world, weeks = 20 }: { world: World; weeks?: number }) {
  const today = dayKey();
  const cols = useMemo(() => writingCalendar(world, weeks, today), [world.writingDays, weeks, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const goal = world.settings.writing?.dailyGoal || 0;
  const max = Math.max(goal, ...cols.flat().map((c) => c.words), 1);
  const level = (w: number) => (w <= 0 ? 0 : goal ? (w >= goal ? 4 : w >= goal / 2 ? 3 : w >= goal / 4 ? 2 : 1) : Math.min(4, Math.ceil((w / max) * 4)));
  const total = cols.flat().reduce((s, c) => s + Math.max(0, c.words), 0);
  const days = cols.flat().filter((c) => c.words > 0).length;
  return (
    <div className="writing-calendar">
      <div className="cal-grid" role="img" aria-label={`Words written per day over the last ${weeks} weeks`}>
        {cols.map((col, i) => (
          <div key={i} className="cal-col">
            {col.map((c) => <span key={c.day} className={`cal-day l${level(c.words)} ${c.future ? 'future' : ''} ${c.day === today ? 'today' : ''}`} title={c.future ? '' : `${formatDayKey(c.day)}: ${n(c.words)} words`} />)}
          </div>
        ))}
      </div>
      <div className="muted small">{n(total)} words on {days} {days === 1 ? 'day' : 'days'} in the last {weeks} weeks{goal ? ` · darkest = daily goal reached` : ''}</div>
    </div>
  );
}
