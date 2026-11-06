/** VW-6 meetings finder and EU-13 side-by-side timelines. */
import { formatDayNumber } from '../dates';
import type { Id } from '../model';
import { OPEN_END, Segment, WorldIndex, nominalEnd, nominalStart, whereIs } from '../whereabouts';

export interface Meeting {
  aId: Id;
  bId: Id;
  /** The place they share: the wider one when one is inside the other (Varn, for the keep and the city). */
  placeId: Id;
  from: number;
  /** OPEN_END when both stays are open-ended. */
  to: number;
  /** On the same journey (travelling together). */
  travelling?: boolean;
}

const endOf = (s: Segment) => nominalEnd(s);

/**
 * VW-6: which characters were in the same place at the same time. Places nest: a stay in the
 * castle meets a stay in the city around it. Unknown places never count as a meeting.
 */
export function findMeetings(ix: WorldIndex, ids: Id[], range?: [number, number]): Meeting[] {
  const out: Meeting[] = [];
  const segs = new Map(ids.map((id) => [id, ix.segmentsFor(id)]));
  const lifespan = (id: Id): [number, number] => {
    const c = ix.characters.get(id);
    return [c?.birth ? ix.win(c.birth).earliest : -Infinity, c?.death ? ix.win(c.death).latest : Infinity];
  };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      const la = lifespan(a), lb = lifespan(b);
      const found: Meeting[] = [];
      for (const sa of segs.get(a)!) {
        for (const sb of segs.get(b)!) {
          let from = Math.max(nominalStart(sa), nominalStart(sb), la[0], lb[0]);
          let to = Math.min(endOf(sa), endOf(sb), la[1], lb[1]);
          if (range) { from = Math.max(from, range[0]); to = Math.min(to, range[1]); }
          if (from > to) continue;
          if (sa.kind === 'journey' && sb.kind === 'journey' && sa.recordId === sb.recordId) {
            found.push({ aId: a, bId: b, placeId: sa.placeId, from, to, travelling: true });
            continue;
          }
          if (sa.kind !== 'stay' || sb.kind !== 'stay') continue;
          if (ix.isPlaceholder(sa.placeId) || ix.isPlaceholder(sb.placeId) || !ix.nested(sa.placeId, sb.placeId)) continue;
          const wider = ix.ancestors(sa.placeId).includes(sb.placeId) ? sb.placeId : sa.placeId;
          found.push({ aId: a, bId: b, placeId: wider, from, to });
        }
      }
      // Join back-to-back meetings at the same place (a stay split in two, a group stay and an own one).
      found.sort((x, y) => x.from - y.from);
      for (const m of found) {
        const last = out.length && out[out.length - 1].aId === a && out[out.length - 1].bId === b ? out[out.length - 1] : undefined;
        if (last && last.placeId === m.placeId && !!last.travelling === !!m.travelling && m.from <= last.to + 1) last.to = Math.max(last.to, m.to);
        else out.push({ ...m });
      }
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

export function meetingText(ix: WorldIndex, m: Meeting): string {
  const n = (id: Id) => ix.characters.get(id)?.name ?? '?';
  const p = ix.places.get(m.placeId)?.name ?? '?';
  const when = m.to === OPEN_END ? `from ${formatDayNumber(m.from)}` : m.from === m.to ? `on ${formatDayNumber(m.from)}` : `${formatDayNumber(m.from)} – ${formatDayNumber(m.to)}`;
  return m.travelling ? `${n(m.aId)} and ${n(m.bId)} travel together from ${p}, ${when}` : `${n(m.aId)} and ${n(m.bId)} are both in ${p}, ${when}`;
}

export interface CompareCell {
  kind: 'stay' | 'journey' | 'unknown' | 'not-born' | 'dead';
  text: string;
  placeId?: Id;
  /** Same text as the cell above: the UI merges them. */
  same: boolean;
}

export interface CompareRow {
  day: number;
  cells: CompareCell[];
  /** Pairs of columns (by index) in the same place on this row. */
  together: [number, number][];
}

/** EU-13: two or three characters' timelines side by side, one row per change for any of them. */
export function compareTimelines(ix: WorldIndex, ids: Id[], range?: [number, number]): CompareRow[] {
  const days = new Set<number>();
  let first = Infinity;
  for (const id of ids) {
    for (const s of ix.segmentsFor(id)) {
      days.add(nominalStart(s));
      first = Math.min(first, nominalStart(s));
      if (s.end.latest !== OPEN_END) days.add(nominalEnd(s) + 1);
    }
  }
  // Births and deaths only matter once the story has started for one of them.
  for (const id of ids) {
    const c = ix.characters.get(id);
    if (c?.birth && ix.win(c.birth).earliest > first) days.add(ix.win(c.birth).earliest);
    if (c?.death && ix.win(c.death).latest + 1 > first) days.add(ix.win(c.death).latest + 1);
  }
  let list = [...days].sort((a, b) => a - b);
  if (range) list = list.filter((d) => d >= range[0] && d <= range[1]);
  const name = (p: Id | undefined) => (p ? ix.places.get(p)?.name ?? '?' : '?');
  const rows: CompareRow[] = [];
  let prev: CompareCell[] | undefined;
  for (const day of list) {
    const cells: CompareCell[] = ids.map((id, i) => {
      const w = whereIs(ix, id, day);
      const cell: Omit<CompareCell, 'same'> =
        w.kind === 'stay' ? { kind: 'stay', text: ix.isPlaceholder(w.placeId) ? 'Somewhere unknown' : `In ${name(w.placeId)}`, placeId: ix.isPlaceholder(w.placeId) ? undefined : w.placeId }
          : w.kind === 'journey' ? { kind: 'journey', text: `Travelling ${name(w.fromId)} → ${name(w.toId)}` }
            : w.kind === 'dead' ? { kind: 'dead', text: 'Dead' }
              : w.kind === 'not-born' ? { kind: 'not-born', text: 'Not born yet' }
                : { kind: 'unknown', text: 'Whereabouts unknown' };
      return { ...cell, same: !!prev && prev[i].text === cell.text };
    });
    if (prev && cells.every((c) => c.same)) continue;
    const together: [number, number][] = [];
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i].placeId, b = cells[j].placeId;
      if (a && b && ix.nested(a, b)) together.push([i, j]);
    }
    rows.push({ day, cells, together });
    prev = cells;
  }
  return rows;
}
