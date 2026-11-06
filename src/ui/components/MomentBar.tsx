/** TL-7: the global "current moment". Every view follows it. VW-2: play it forward at a chosen speed. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDayNumber, fromDayNumber, parseFuzzyDate, toWindow } from '../../core';
import { useApp } from '../context';
import { worldDayRange } from '../util';

/** Days of story time per second of playback. */
const SPEEDS: { days: number; label: string }[] = [
  { days: 1, label: '1 day/s' },
  { days: 7, label: '1 week/s' },
  { days: 30, label: '1 month/s' },
  { days: 365, label: '1 year/s' },
];

export function MomentBar() {
  const { world, ix, moment, store } = useApp();
  const range = useMemo(() => worldDayRange(world, ix), [world, ix]);
  const [text, setText] = useState(formatDayNumber(moment));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('swt.playSpeed')) || 7);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  useEffect(() => setText(formatDayNumber(moment)), [moment]);
  useEffect(() => { try { localStorage.setItem('swt.playSpeed', String(speed)); } catch { /* ignore */ } }, [speed]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    // Start again from the beginning when play is pressed at the end.
    if ((store.world.settings.currentMoment ?? 0) >= rangeRef.current[1]) store.setMoment(rangeRef.current[0]);
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const next = (store.world.settings.currentMoment ?? 0) + dt * speed;
      if (next >= rangeRef.current[1]) {
        store.setMoment(rangeRef.current[1]);
        setPlaying(false);
        return;
      }
      store.setMoment(next, true);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      store.setMoment(Math.floor(store.world.settings.currentMoment ?? 0));
    };
  }, [playing, speed, store]);
  const commit = () => {
    const d = parseFuzzyDate(text);
    if (d) store.setMoment(toWindow(d, world.settings.hemisphereForSeasons).earliest);
    else setText(formatDayNumber(moment));
  };
  const ymd = fromDayNumber(moment);
  const lo = Math.min(range[0], moment), hi = Math.max(range[1], moment);
  return (
    <div className="moment">
      <button className="icon" title="Previous month" onClick={() => store.setMoment(moment - 30)}>«</button>
      <button className="icon" title="Previous day" onClick={() => store.setMoment(moment - 1)}>‹</button>
      <input className="moment-date" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} title="Current moment (day/month/year)" />
      <button className="icon" title="Next day" onClick={() => store.setMoment(moment + 1)}>›</button>
      <button className="icon" title="Next month" onClick={() => store.setMoment(moment + 30)}>»</button>
      <button className={`icon${playing ? ' on' : ''}`} title={playing ? 'Pause' : 'Play: watch characters travel and borders change'} onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
      <select className="moment-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Playback speed" aria-label="Playback speed">
        {SPEEDS.map((s) => <option key={s.days} value={s.days}>{s.label}</option>)}
      </select>
      <input className="moment-slider" type="range" min={lo} max={hi} step="any" value={moment} onChange={(e) => store.setMoment(Number(e.target.value))} title={`${ymd.day}/${ymd.month}/${ymd.year}`} />
    </div>
  );
}
