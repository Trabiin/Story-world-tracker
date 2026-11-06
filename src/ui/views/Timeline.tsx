/**
 * VW-1: timeline swimlanes. One row per character (and group), stays as blocks, journeys as arrows.
 * Zoom from decades to days; fuzzy dates show as faded edges. Click the axis to set the current moment.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EARTH_MOON, Id, MOON_ICON, OPEN_END, Segment, TerrainReader, eventIcon, fromDayNumber, formatDayNumber, hasTerrain, moonPhases, occurrences, seasonBands, toDayNumber } from '../../core';
import { useApp } from '../context';
import { ShiftDatesModal } from '../components/ShiftDates';
import { worldDayRange } from '../util';

const ROW_H = 30;
const AXIS_H = 40;
const LABEL_W = 170;
/** TL-5/TL-6 lane under the date bar: moon phases on top, events below. */
const SKY_H = 32;
const SEASON_COLOR: Record<string, string> = { spring: '#7cc576', summer: '#f2c14e', autumn: '#d98236', winter: '#7fb2e5' };
const DEFAULT_SKY = { events: true, seasons: false, moon: false, holidays: true };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Row {
  kind: 'character' | 'group';
  id: Id;
  name: string;
  color: string;
  icon: string;
  segs: Segment[];
}

interface Hit {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  kind: 'stay' | 'journey' | 'event';
  id: Id;
  label: string;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function Timeline() {
  const { world, ix, moment, store, edit, warnings, go } = useApp();
  const [shifting, setShifting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 900, h: 500 });
  const [range] = useState(() => worldDayRange(world, ix));
  const [pxPerDay, setPxPerDay] = useState(() => Math.max(0.02, Math.min(40, 900 / Math.max(30, range[1] - range[0]))));
  const [start, setStart] = useState(() => moment - 450 / Math.max(0.02, Math.min(40, 900 / Math.max(30, range[1] - range[0]))));
  const [scrollY, setScrollY] = useState(0);
  const [imp, setImp] = useState<'all' | 'main' | 'secondary' | 'minor'>('all');
  const [showGroups, setShowGroups] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const hits = useRef<Hit[]>([]);
  const sky = { ...DEFAULT_SKY, ...world.settings.timelineSky };
  const setSky = (p: Partial<typeof sky>) => store.setSettings({ timelineSky: { ...sky, ...p } }, false);
  const laneOn = (sky.events && world.events.length > 0) || sky.moon;
  const top = AXIS_H + (laneOn ? SKY_H : 0);
  // TL-6: season lengths from a chosen place's latitude and height (RC-10), else calendar seasons.
  const seasonOpts = useMemo(() => {
    const loc = sky.seasonsAt ? ix.locationOf(sky.seasonsAt) : undefined;
    if (!loc) return { hemisphere: world.settings.hemisphereForSeasons };
    const elevM = hasTerrain(world.terrain) ? Math.max(0, new TerrainReader(world.terrain).elevation(loc)) : 0;
    return { hemisphere: world.settings.hemisphereForSeasons, lat: loc.lat, elevM, tiltDeg: world.settings.axialTiltDeg };
  }, [sky.seasonsAt, ix, world.terrain, world.settings.hemisphereForSeasons, world.settings.axialTiltDeg]);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const flagged = useMemo(() => new Set(warnings.filter((w) => !w.dismissed && w.severity === 'warning').flatMap((w) => w.refs.map((r) => r.id))), [warnings]);

  const rows: Row[] = useMemo(() => {
    const order = ['main', 'secondary', 'minor'];
    const chars = world.characters
      .filter((c) => !c.archived && (imp === 'all' || c.importance === imp))
      .sort((a, b) => order.indexOf(a.importance) - order.indexOf(b.importance) || a.name.localeCompare(b.name))
      .map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, color: c.color, icon: c.icon, segs: ix.segmentsFor(c.id) }));
    if (!showGroups) return chars;
    const groups = world.groups.map((g) => {
      const segs: Segment[] = [];
      for (const s of world.stays) if (s.subject.kind === 'group' && s.subject.id === g.id) {
        const { end, open } = ix.stayEnd(s);
        segs.push({ kind: 'stay', recordId: s.id, characterId: '', start: ix.win(s.arrival), end, openEnded: open, placeId: s.placeId });
      }
      for (const j of world.journeys) if (j.subject.kind === 'group' && j.subject.id === g.id) {
        segs.push({ kind: 'journey', recordId: j.id, characterId: '', start: ix.win(j.departure), end: ix.journeyEnd(j).end, openEnded: false, placeId: j.originId, destinationId: j.destinationId });
      }
      return { kind: 'group' as const, id: g.id, name: `${g.name} (group)`, color: g.color, icon: '■', segs };
    });
    return [...groups, ...chars];
  }, [world, ix, imp, showGroups]);

  const xOf = (day: number) => LABEL_W + (day - start) * pxPerDay;
  const dayOf = (x: number) => start + (x - LABEL_W) / pxPerDay;

  useEffect(() => {
    const cv = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { w, h } = size;
    const fg = cssVar('--fg'), muted = cssVar('--muted'), line = cssVar('--line'), bg = cssVar('--bg'), panel = cssVar('--panel'), danger = cssVar('--danger');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const hs: Hit[] = [];
    const endDay = dayOf(w);

    // axis ticks
    const yearsVisible = (endDay - start) / 365.25;
    const tickKind: 'decade' | 'year' | 'month' | 'day' = yearsVisible > 60 ? 'decade' : yearsVisible > 4 ? 'year' : pxPerDay > 18 ? 'day' : 'month';
    const first = fromDayNumber(Math.floor(start));
    const ticks: { day: number; label: string; major: boolean }[] = [];
    if (tickKind === 'decade' || tickKind === 'year') {
      const step = tickKind === 'decade' ? (yearsVisible > 300 ? 50 : 10) : yearsVisible > 20 ? 5 : 1;
      for (let y = Math.floor(first.year / step) * step; ; y += step) {
        const d = toDayNumber({ year: y, month: 1, day: 1 });
        if (d > endDay) break;
        ticks.push({ day: d, label: String(y <= 0 ? `${1 - y} BC` : y), major: true });
      }
    } else if (tickKind === 'month') {
      let y = first.year, m = first.month;
      for (;;) {
        const d = toDayNumber({ year: y, month: m, day: 1 });
        if (d > endDay) break;
        ticks.push({ day: d, label: m === 1 ? `${MONTHS[0]} ${y}` : pxPerDay > 1.5 || m % 3 === 1 ? MONTHS[m - 1] : '', major: m === 1 });
        m++; if (m > 12) { m = 1; y++; }
      }
    } else {
      for (let d = Math.floor(start); d <= endDay; d++) {
        const ymd = fromDayNumber(d);
        ticks.push({ day: d, label: ymd.day === 1 ? `1 ${MONTHS[ymd.month - 1]} ${ymd.year}` : pxPerDay > 28 || ymd.day % 5 === 0 ? String(ymd.day) : '', major: ymd.day === 1 });
      }
    }
    g.font = '11px system-ui';
    g.textBaseline = 'middle';
    for (const t of ticks) {
      const x = xOf(t.day);
      if (x < LABEL_W) continue;
      g.strokeStyle = line;
      g.globalAlpha = t.major ? 0.9 : 0.4;
      g.beginPath(); g.moveTo(x, AXIS_H - (t.major ? 14 : 8)); g.lineTo(x, h); g.stroke();
      g.globalAlpha = 1;
    }

    // rows
    const firstRow = Math.max(0, Math.floor(scrollY / ROW_H));
    const lastRow = Math.min(rows.length - 1, Math.ceil((scrollY + h - top) / ROW_H));
    // TL-6 seasons tint the background.
    const seasonLabels: [string, number][] = [];
    if (sky.seasons) {
      for (const b of seasonBands(start, endDay, seasonOpts)) {
        const x0 = Math.max(LABEL_W, xOf(b.from)), x1 = Math.min(w, xOf(b.to + 1));
        if (x1 <= x0) continue;
        g.fillStyle = SEASON_COLOR[b.season];
        g.globalAlpha = 0.09;
        g.fillRect(x0, top, x1 - x0, h - top);
        g.globalAlpha = 0.85;
        g.fillRect(x0, top - 4, x1 - x0, 4);
        g.globalAlpha = 1;
        if (x1 - x0 > 50) seasonLabels.push([b.season, x0 + 4]);
      }
    }
    g.save();
    g.beginPath(); g.rect(0, top, w, h - top); g.clip();
    for (let i = firstRow; i <= lastRow; i++) {
      const r = rows[i];
      const y = top + i * ROW_H - scrollY;
      if (i % 2) { g.fillStyle = panel; g.globalAlpha = 0.5; g.fillRect(LABEL_W, y, w - LABEL_W, ROW_H); g.globalAlpha = 1; }
      for (const s of r.segs) {
        const open = s.end.latest === OPEN_END;
        const x0 = Math.max(LABEL_W, xOf(s.start.earliest));
        const xs = xOf(s.start.latest);
        const xe = open ? w + 10 : xOf(s.end.earliest);
        const x1 = open ? w + 10 : Math.min(w + 10, xOf(s.end.latest + 1));
        if (x1 < LABEL_W || x0 > w) continue;
        const top = y + (s.kind === 'stay' ? 5 : 9), hh = s.kind === 'stay' ? ROW_H - 10 : ROW_H - 18;
        const col = r.color;
        // fuzzy edges faded
        g.fillStyle = col;
        g.globalAlpha = 0.3;
        g.fillRect(x0, top, Math.max(1, x1 - x0), hh);
        g.globalAlpha = s.viaGroupId ? 0.6 : 0.9;
        const sx = Math.max(LABEL_W, xs), ex = Math.max(sx + 1, xe);
        if (s.kind === 'stay') g.fillRect(sx, top, ex - sx, hh);
        else {
          // journey arrow
          g.beginPath();
          g.moveTo(sx, top); g.lineTo(ex - 6, top); g.lineTo(ex, top + hh / 2); g.lineTo(ex - 6, top + hh); g.lineTo(sx, top + hh); g.closePath();
          g.fill();
        }
        g.globalAlpha = 1;
        if (s.viaGroupId) { g.strokeStyle = bg; g.setLineDash([3, 3]); g.strokeRect(sx + 0.5, top + 0.5, ex - sx - 1, hh - 1); g.setLineDash([]); }
        if (flagged.has(s.recordId)) { g.strokeStyle = danger; g.lineWidth = 2; g.strokeRect(x0 + 1, top - 1, Math.max(2, x1 - x0 - 2), hh + 2); g.lineWidth = 1; }
        const label = s.kind === 'stay' ? ix.places.get(s.placeId)?.name ?? '?' : `→ ${ix.places.get(s.destinationId!)?.name ?? '?'}`;
        if (ex - sx > 30) {
          g.save();
          g.beginPath(); g.rect(sx, top, ex - sx - 4, hh); g.clip();
          g.fillStyle = '#fff';
          g.font = '11px system-ui';
          g.fillText(label, sx + 4, top + hh / 2);
          g.restore();
        }
        const fmt = (n: number) => (n === OPEN_END ? '…' : formatDayNumber(n));
        // WH-10: incidents on a journey, as diamonds on the arrow.
        if (s.kind === 'journey') {
          const j = ix.journeys.get(s.recordId);
          for (const inc of j?.incidents ?? []) {
            const day = s.start.earliest + Math.max(0, inc.day - 1);
            const ix0 = xOf(day + 0.5);
            if (ix0 < LABEL_W || ix0 > w) continue;
            const cy = top + hh / 2;
            g.beginPath(); g.moveTo(ix0, cy - 6); g.lineTo(ix0 + 5, cy); g.lineTo(ix0, cy + 6); g.lineTo(ix0 - 5, cy); g.closePath();
            g.fillStyle = bg; g.fill(); g.strokeStyle = col; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
            hs.push({ x0: ix0 - 6, x1: ix0 + 6, y0: cy - 7, y1: cy + 7, kind: 'journey', id: s.recordId, label: `◆ ${inc.title || 'Incident'}\nday ${inc.day} of the journey, ${formatDayNumber(day)}` });
          }
        }
        hs.push({ x0, x1: Math.max(x1, x0 + 4), y0: top, y1: top + hh, kind: s.kind, id: s.recordId, label: `${label}\n${fmt(s.start.earliest)} – ${fmt(open ? OPEN_END : s.end.latest)}${s.viaGroupId ? `\nwith ${world.groups.find((gg) => gg.id === s.viaGroupId)?.name}` : ''}` });
      }
      // label column
      g.fillStyle = bg;
      g.fillRect(0, y, LABEL_W, ROW_H);
      g.fillStyle = r.color;
      g.font = '13px system-ui';
      g.fillText(r.icon, 8, y + ROW_H / 2);
      g.fillStyle = fg;
      g.fillText(r.name.length > 20 ? r.name.slice(0, 19) + '…' : r.name, 26, y + ROW_H / 2);
    }
    g.restore();
    g.fillStyle = muted; g.font = '10px system-ui';
    for (const [name, x] of seasonLabels) g.fillText(name, x, h - 8);
    // TL-5/TL-6 lane: moon phases and world events (yearly holidays repeat every year).
    if (laneOn) {
      g.fillStyle = bg;
      g.fillRect(0, AXIS_H, w, SKY_H - (sky.seasons ? 4 : 0));
      g.fillStyle = muted;
      g.font = '11px system-ui';
      g.fillText(sky.moon && sky.events && world.events.length ? 'Moon · events' : sky.moon ? (world.settings.moon?.name ?? 'Moon') : 'Events', 8, AXIS_H + SKY_H / 2);
      if (sky.moon && pxPerDay >= 0.9) {
        const moon = world.settings.moon ?? EARTH_MOON;
        for (const ph of moonPhases(Math.floor(start), Math.ceil(endDay), moon)) {
          if (pxPerDay < 3 && ph.phase !== 'full' && ph.phase !== 'new') continue;
          const x = xOf(ph.day + 0.5), y = AXIS_H + 8, r = 4.5;
          if (x < LABEL_W + 6) continue;
          // Drawn discs: new = dark, full = light ring, quarters = half lit (lit side to the right when waxing, northern view).
          g.strokeStyle = fg; g.fillStyle = fg; g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
          if (ph.phase === 'new') g.fill(); else g.stroke();
          if (ph.phase === 'first-quarter' || ph.phase === 'last-quarter') {
            g.beginPath();
            if (ph.phase === 'first-quarter') g.arc(x, y, r, Math.PI / 2, Math.PI * 1.5); else g.arc(x, y, r, -Math.PI / 2, Math.PI / 2);
            g.closePath(); g.fill();
          }
          hs.push({ x0: x - 6, x1: x + 6, y0: AXIS_H, y1: AXIS_H + 15, kind: 'event', id: '', label: `${MOON_ICON[ph.phase]} ${ph.phase.replace('-', ' ')} moon\n${formatDayNumber(ph.day)}` });
        }
      }
      if (sky.events) {
        const y = AXIS_H + (sky.moon ? 22 : SKY_H / 2);
        let labelEnd = -Infinity;
        for (const o of occurrences(world, Math.floor(start), Math.ceil(endDay))) {
          if (o.repeat !== undefined && !sky.holidays) continue;
          const x0 = xOf(o.from), x1 = xOf(o.to + 1);
          if (x1 < LABEL_W || x0 > w) continue;
          g.fillStyle = cssVar('--accent');
          g.globalAlpha = o.repeat !== undefined ? 0.55 : 1;
          if (x1 - x0 > 8) g.fillRect(Math.max(LABEL_W, x0), y - 3, Math.min(w, x1) - Math.max(LABEL_W, x0), 6);
          const icon = eventIcon(o.event.kind);
          g.font = '12px system-ui';
          const ix0 = Math.max(LABEL_W + 2, x0 - 6);
          g.fillStyle = fg;
          g.fillText(icon, ix0, y);
          const label = o.event.name;
          g.font = '11px system-ui';
          const tw = g.measureText(label).width;
          if (ix0 + 16 > labelEnd) { g.fillText(label, ix0 + 16, y); labelEnd = ix0 + 16 + tw + 8; }
          g.globalAlpha = 1;
          const fmt = o.from === o.to ? formatDayNumber(o.from) : `${formatDayNumber(o.from)} – ${formatDayNumber(o.to)}`;
          hs.push({ x0: ix0 - 2, x1: Math.max(ix0 + 14, x1), y0: y - 8, y1: y + 8, kind: 'event', id: o.event.id, label: `${icon} ${o.event.name}${o.repeat !== undefined ? ' (yearly)' : ''}\n${fmt}${o.event.placeId ? `\nat ${ix.places.get(o.event.placeId)?.name ?? '?'}` : ''}` });
        }
      }
      g.strokeStyle = line;
      g.beginPath(); g.moveTo(0, top); g.lineTo(w, top); g.stroke();
    }
    // axis background over rows
    g.fillStyle = bg;
    g.globalAlpha = 0.92;
    g.fillRect(0, 0, w, AXIS_H - 26);
    g.globalAlpha = 1;
    g.strokeStyle = line;
    g.beginPath(); g.moveTo(0, AXIS_H); g.lineTo(w, AXIS_H); g.moveTo(LABEL_W, 0); g.lineTo(LABEL_W, h); g.stroke();
    for (const t of ticks) { const x = xOf(t.day); if (x >= LABEL_W && t.label) { g.fillStyle = t.major ? fg : muted; g.fillText(t.label, x + 3, AXIS_H - 20); } }

    // current moment (TL-7)
    const mx = xOf(moment + 0.5);
    if (mx >= LABEL_W && mx <= w) {
      g.strokeStyle = cssVar('--accent');
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(mx, AXIS_H - 30); g.lineTo(mx, h); g.stroke();
      g.lineWidth = 1;
      g.fillStyle = cssVar('--accent');
      g.font = 'bold 11px system-ui';
      g.fillText(formatDayNumber(moment), Math.min(mx + 4, w - 70), 8);
    }
    hits.current = hs;
  }, [size, rows, start, pxPerDay, scrollY, moment, flagged, ix, world.groups, world.events, world.settings.moon, top, laneOn, sky.events, sky.moon, sky.seasons, sky.holidays, seasonOpts]); // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useRef<{ x: number; y: number; start: number; scrollY: number; moved: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const maxScroll = Math.max(0, rows.length * ROW_H - (size.h - top));

  const onWheel = (e: React.WheelEvent) => {
    const { x } = local(e);
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      setStart((s) => s + (e.deltaX || e.deltaY) / pxPerDay);
      return;
    }
    if (x < LABEL_W) { setScrollY((s) => Math.max(0, Math.min(maxScroll, s + e.deltaY))); return; }
    const anchor = dayOf(x);
    const next = Math.max(0.005, Math.min(120, pxPerDay * Math.exp(-e.deltaY * 0.0015)));
    setPxPerDay(next);
    setStart(anchor - (x - LABEL_W) / next);
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    drag.current = { ...p, start, scrollY, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    const d = drag.current;
    if (d) {
      if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 3) d.moved = true;
      if (d.moved) {
        if (d.y < AXIS_H) { store.setMoment(Math.floor(dayOf(p.x))); return; }
        setStart(d.start - (p.x - d.x) / pxPerDay);
        setScrollY(Math.max(0, Math.min(maxScroll, d.scrollY - (p.y - d.y))));
      }
      return;
    }
    const hit = hits.current.find((hh) => p.x >= hh.x0 && p.x <= hh.x1 && p.y >= hh.y0 && p.y <= hh.y1);
    setTip(hit ? { x: p.x, y: p.y, text: hit.label } : null);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const p = local(e);
    if (p.y < AXIS_H && p.x > LABEL_W) { store.setMoment(Math.floor(dayOf(p.x))); return; }
    if (p.x < LABEL_W) {
      const i = Math.floor((p.y - top + scrollY) / ROW_H);
      const r = rows[i];
      if (r) go(r.kind === 'character' ? 'characters' : 'groups', r.id);
      return;
    }
    const hit = hits.current.find((hh) => p.x >= hh.x0 && p.x <= hh.x1 && p.y >= hh.y0 && p.y <= hh.y1);
    if (hit?.kind === 'event') { if (hit.id) go('events', hit.id); }
    else if (hit) edit({ kind: hit.kind, id: hit.id });
    else if (p.y >= top) store.setMoment(Math.floor(dayOf(p.x)));
  };

  const zoomTo = (days: number) => {
    const next = (size.w - LABEL_W) / days;
    setPxPerDay(next);
    setStart(moment - (size.w - LABEL_W) / 2 / next);
  };

  return (
    <div className="timeline-page">
      <div className="page-head pad">
        <h1>Timeline</h1>
        <div className="row wrap">
          <span className="muted">Zoom:</span>
          <button className="small" onClick={() => zoomTo(365.25 * 50)}>50 years</button>
          <button className="small" onClick={() => zoomTo(365.25 * 5)}>5 years</button>
          <button className="small" onClick={() => zoomTo(365.25)}>Year</button>
          <button className="small" onClick={() => zoomTo(30)}>Month</button>
          <button className="small" onClick={() => zoomTo(7)}>Week</button>
          <button className="small" onClick={() => { const r = worldDayRange(world, ix); const n = (size.w - LABEL_W) / (r[1] - r[0]); setPxPerDay(n); setStart(r[0]); }}>Fit all</button>
          <select value={imp} onChange={(e) => setImp(e.target.value as typeof imp)}>
            <option value="all">All characters</option><option value="main">Main</option><option value="secondary">Secondary</option><option value="minor">Minor</option>
          </select>
          <label className="checkbox"><input type="checkbox" checked={showGroups} onChange={(e) => setShowGroups(e.target.checked)} /> Group rows</label>
          <label className="checkbox" title="TL-5"><input type="checkbox" checked={sky.events} onChange={(e) => setSky({ events: e.target.checked })} /> Events</label>
          {sky.events && world.events.some((x) => x.yearly) && <label className="checkbox" title="TL-6: yearly festivals and holidays, every year"><input type="checkbox" checked={sky.holidays} onChange={(e) => setSky({ holidays: e.target.checked })} /> Holidays</label>}
          <label className="checkbox" title="TL-6"><input type="checkbox" checked={sky.moon} onChange={(e) => setSky({ moon: e.target.checked })} /> Moon</label>
          <label className="checkbox" title="TL-6"><input type="checkbox" checked={sky.seasons} onChange={(e) => setSky({ seasons: e.target.checked })} /> Seasons</label>
          {sky.seasons && (
            <select value={sky.seasonsAt ?? ''} onChange={(e) => setSky({ seasonsAt: e.target.value || undefined })} title="TL-6: season lengths follow this place's latitude and height (RC-10)">
              <option value="">Calendar seasons ({world.settings.hemisphereForSeasons})</option>
              {world.places.filter((p) => !p.isPlaceholder && ix.locationOf(p.id) && ['city', 'town', 'village', 'capital', 'castle', 'port', 'region'].includes(p.kind)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>Seasons as in {p.name}</option>)}
            </select>
          )}
          <button className="small" onClick={() => setShifting(true)} title="EU-4: push every date after a day later or earlier">Shift dates…</button>
        </div>
        {shifting && <ShiftDatesModal onClose={() => setShifting(false)} />}
      </div>
      <div className="timeline-canvas" ref={wrapRef}>
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setTip(null)} />
        {tip && <div className="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>}
        {rows.length === 0 && <div className="empty overlay">No characters to show yet.</div>}
      </div>
      <p className="muted pad small">Scroll to zoom, drag to pan, click the date bar to set the current moment, click a block to edit, click an event to open it. Faded edges show uncertain dates; red outlines have warnings; dashed blocks come from a group.</p>
    </div>
  );
}
