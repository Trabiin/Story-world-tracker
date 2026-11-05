/**
 * VW-1: timeline swimlanes. One row per character (and group), stays as blocks, journeys as arrows.
 * Zoom from decades to days; fuzzy dates show as faded edges. Click the axis to set the current moment.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Id, OPEN_END, Segment, fromDayNumber, formatDayNumber, toDayNumber } from '../../core';
import { useApp } from '../context';
import { worldDayRange } from '../util';

const ROW_H = 30;
const AXIS_H = 40;
const LABEL_W = 170;
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
  kind: 'stay' | 'journey';
  id: Id;
  label: string;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function Timeline() {
  const { world, ix, moment, store, edit, warnings, go } = useApp();
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
    const lastRow = Math.min(rows.length - 1, Math.ceil((scrollY + h - AXIS_H) / ROW_H));
    for (let i = firstRow; i <= lastRow; i++) {
      const r = rows[i];
      const y = AXIS_H + i * ROW_H - scrollY;
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
  }, [size, rows, start, pxPerDay, scrollY, moment, flagged, ix, world.groups]);

  const drag = useRef<{ x: number; y: number; start: number; scrollY: number; moved: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const maxScroll = Math.max(0, rows.length * ROW_H - (size.h - AXIS_H));

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
      const i = Math.floor((p.y - AXIS_H + scrollY) / ROW_H);
      const r = rows[i];
      if (r) go(r.kind === 'character' ? 'characters' : 'groups', r.id);
      return;
    }
    const hit = hits.current.find((hh) => p.x >= hh.x0 && p.x <= hh.x1 && p.y >= hh.y0 && p.y <= hh.y1);
    if (hit) edit({ kind: hit.kind, id: hit.id });
    else store.setMoment(Math.floor(dayOf(p.x)));
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
        </div>
      </div>
      <div className="timeline-canvas" ref={wrapRef}>
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setTip(null)} />
        {tip && <div className="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>}
        {rows.length === 0 && <div className="empty overlay">No characters to show yet.</div>}
      </div>
      <p className="muted pad small">Scroll to zoom, drag to pan, click the date bar to set the current moment, click a block to edit. Faded edges show uncertain dates; red outlines have warnings; dashed blocks come from a group.</p>
    </div>
  );
}
