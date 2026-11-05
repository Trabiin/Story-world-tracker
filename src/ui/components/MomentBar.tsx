/** TL-7: the global "current moment". Every view follows it. */
import { useEffect, useMemo, useState } from 'react';
import { formatDayNumber, fromDayNumber, parseFuzzyDate, toWindow } from '../../core';
import { useApp } from '../context';
import { worldDayRange } from '../util';

export function MomentBar() {
  const { world, ix, moment, store } = useApp();
  const range = useMemo(() => worldDayRange(world, ix), [world, ix]);
  const [text, setText] = useState(formatDayNumber(moment));
  const [playing, setPlaying] = useState(false);
  useEffect(() => setText(formatDayNumber(moment)), [moment]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => store.setMoment(store.world.settings.currentMoment! + 1), 120);
    return () => clearInterval(t);
  }, [playing, store]);
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
      <button className="icon" title={playing ? 'Pause' : 'Play, one day at a time'} onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
      <input className="moment-slider" type="range" min={lo} max={hi} value={moment} onChange={(e) => store.setMoment(Number(e.target.value))} title={`${ymd.day}/${ymd.month}/${ymd.year}`} />
    </div>
  );
}
