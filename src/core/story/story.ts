/** Story structure helpers (ST-1, ST-2) and backlinks (EU-6). */
import { formatFuzzy, midpoint } from '../dates';
import type { Id, LinkTargetKind, Scene, World } from '../model';
import { WorldIndex, whereIs } from '../whereabouts';
import { linksInDoc } from '../writing/doc';

export function scenePov(world: World, s: Scene): Id | undefined {
  return s.povCharacterId ?? world.chapters.find((c) => c.id === s.chapterId)?.povCharacterId;
}

/** ST-1: a scene's place is its override, else where its POV character stays on the scene date. */
export function scenePlace(ix: WorldIndex, s: Scene): { placeId?: Id; derived: boolean } {
  if (s.placeId) return { placeId: s.placeId, derived: false };
  const pov = scenePov(ix.world, s);
  if (!pov || !s.start) return { derived: true };
  const w = whereIs(ix, pov, midpoint(ix.win(s.start)));
  return { placeId: w.kind === 'stay' ? w.placeId : undefined, derived: true };
}

/** Books → chapters → scenes in reading order. */
export function outline(world: World) {
  const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;
  return [...world.books].sort(byOrder).map((b) => ({
    book: b,
    chapters: world.chapters.filter((c) => c.bookId === b.id).sort(byOrder).map((c) => ({
      chapter: c,
      scenes: world.scenes.filter((s) => s.chapterId === c.id).sort(byOrder),
    })),
  }));
}

export interface Backlink {
  kind: 'text' | 'passage' | 'scene' | 'chapter' | 'stay' | 'journey' | 'membership' | 'place' | 'event';
  id: Id;
  label: string;
  detail?: string;
  /** For passages: which manuscript and paragraph to open. */
  manuscriptId?: Id;
  linkId?: Id;
}

/** EU-6: everything that mentions a record. */
export function backlinksFor(world: World, kind: LinkTargetKind, id: Id): Backlink[] {
  const out: Backlink[] = [];
  const placeName = (pid?: Id) => world.places.find((p) => p.id === pid)?.name ?? '?';
  const subjName = (s: { kind: string; id: Id }) => (s.kind === 'character' ? world.characters : world.groups).find((x) => x.id === s.id)?.name ?? '?';
  for (const l of world.links) {
    if (l.target.kind !== kind || l.target.id !== id) continue;
    const m = world.manuscripts.find((x) => x.id === l.manuscriptId);
    out.push({ kind: 'passage', id: l.id, linkId: l.id, manuscriptId: l.manuscriptId, label: `“${l.anchor.quote.length > 90 ? l.anchor.quote.slice(0, 90) + '…' : l.anchor.quote}”`, detail: [m?.name, l.anchor.heading, l.state === 'lost' ? 'needs re-linking' : ''].filter(Boolean).join(' · ') });
  }
  // WR-4, WR-11: passages linked inside the app's own scene text.
  for (const t of world.sceneTexts) {
    const sc = world.scenes.find((x) => x.id === t.sceneId);
    if (!sc) continue;
    for (const l of linksInDoc(t.doc)) {
      if (l.kind !== kind || l.id !== id) continue;
      out.push({ kind: 'text', id: sc.id, label: `“${l.text.length > 90 ? l.text.slice(0, 90) + '…' : l.text}”`, detail: [sc.title, l.note].filter(Boolean).join(' · ') });
    }
  }
  for (const s of world.scenes) {
    const hit = kind === 'character' ? s.povCharacterId === id || s.characterIds.includes(id) : kind === 'place' ? s.placeId === id : kind === 'chapter' ? s.chapterId === id : false;
    if (hit) out.push({ kind: 'scene', id: s.id, label: s.title || 'Untitled scene', detail: s.start ? formatFuzzy(s.start) : undefined });
  }
  for (const e of world.events) {
    const hit = kind === 'character' ? e.characterIds.includes(id) : kind === 'place' ? e.placeId === id : false;
    if (hit) out.push({ kind: 'event', id: e.id, label: e.name, detail: e.start ? formatFuzzy(e.start) : undefined });
  }
  for (const c of world.chapters) {
    if ((kind === 'character' && c.povCharacterId === id) || (kind === 'book' && c.bookId === id)) out.push({ kind: 'chapter', id: c.id, label: c.title || 'Untitled chapter', detail: kind === 'character' ? 'POV' : undefined });
  }
  if (kind === 'place') {
    for (const s of world.stays) if (s.placeId === id) out.push({ kind: 'stay', id: s.id, label: `${subjName(s.subject)} stays here`, detail: formatFuzzy(s.arrival) });
    for (const j of world.journeys) if (j.originId === id || j.destinationId === id || j.waypointIds.includes(id)) out.push({ kind: 'journey', id: j.id, label: `${subjName(j.subject)}: ${placeName(j.originId)} → ${placeName(j.destinationId)}`, detail: formatFuzzy(j.departure) });
    for (const p of world.places) if (p.parentId === id) out.push({ kind: 'place', id: p.id, label: p.name, detail: 'inside' });
  }
  if (kind === 'group') for (const m of world.memberships) if (m.groupId === id) out.push({ kind: 'membership', id: m.id, label: world.characters.find((c) => c.id === m.characterId)?.name ?? '?', detail: 'member' });
  if (kind === 'character') for (const m of world.memberships) if (m.characterId === id) out.push({ kind: 'membership', id: m.id, label: world.groups.find((g) => g.id === m.groupId)?.name ?? '?', detail: 'member of group' });
  return out;
}

/** CH-3: attribute values that apply on a given day. */
export function attributesOn(ix: WorldIndex, characterId: Id, day: number): Record<string, string> {
  const c = ix.characters.get(characterId);
  const out: Record<string, string> = {};
  for (const a of c?.attributes ?? []) {
    if (a.start && ix.win(a.start).earliest > day) continue;
    if (a.end && ix.win(a.end).latest < day) continue;
    out[a.key] = out[a.key] ? `${out[a.key]}, ${a.value}` : a.value;
  }
  return out;
}

/** Where a character or group is on a day: the stay's place, or a journey's destination. */
export function placeAt(ix: WorldIndex, subject: { kind: 'character' | 'group'; id: Id }, day: number): Id | undefined {
  if (subject.kind === 'character') {
    const w = whereIs(ix, subject.id, day);
    return w.kind === 'stay' ? w.placeId : w.kind === 'journey' ? w.toId : undefined;
  }
  let best: { placeId: Id; start: number } | undefined;
  for (const s of ix.staysOf('group', subject.id)) {
    const a = ix.win(s.arrival).earliest, e = ix.stayEnd(s).end.latest;
    if (a <= day && day <= e && (!best || a > best.start)) best = { placeId: s.placeId, start: a };
  }
  return best?.placeId;
}
