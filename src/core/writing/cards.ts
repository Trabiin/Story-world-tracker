/**
 * WR-10 live name cards: what hovering a name in the text shows, on the scene's date. WR-11 the
 * records an @ link can point at.
 *
 * "What the reader already knows" (EU-8) is the world as the reader's view shows it at the end of
 * the chapter before the scene's chapter: the reader has not finished the scene's own chapter yet.
 */
import { formatFuzzy, midpoint } from '../dates';
import { LayerIndex, describeChain } from '../layers';
import type { Id, LinkTargetKind, World } from '../model';
import { STATUS_LABEL, characterStatus } from '../people/status';
import { relationsOf } from '../people/relationships';
import { knowledgeOf } from '../people/knowledge';
import { firstMentions, readingOrder, spoilerView } from '../story/spoilers';
import { attributesOn, outline } from '../story/story';
import { localSeasons, TerrainReader, hasTerrain } from '../terrain';
import { WorldIndex } from '../whereabouts';
import { whereText } from './sceneContext';

export interface CardLine { label: string; text: string }

export interface NameCard {
  kind: LinkTargetKind;
  id: Id;
  title: string;
  subtitle?: string;
  /** Facts on the scene's date. */
  lines: CardLine[];
  /** EU-8: what the reader knows by the start of this scene's chapter. */
  reader: string[];
  missing?: boolean;
}

/** The reading position just before a scene's chapter: -1 = the reader has read nothing yet. */
export function readerPointBefore(world: World, sceneId: Id | undefined): number {
  const s = world.scenes.find((x) => x.id === sceneId);
  const idx = s ? readingOrder(world).find((p) => p.chapter.id === s.chapterId)?.index : undefined;
  return idx === undefined ? -1 : idx - 1;
}

/** EU-8: the reader's knowledge at a reading point, worked out once and shared by every card in the chapter. */
export interface ReaderKnowledge {
  point: number;
  view: World | undefined;
  mentions: Map<Id, number>;
  labels: string[];
}

export function readerKnowledge(world: World, point: number): ReaderKnowledge {
  return { point, view: point >= 0 ? spoilerView(world, point) : undefined, mentions: firstMentions(world), labels: readingOrder(world).map((p) => p.label) };
}

function readerLines(world: World, rk: ReaderKnowledge, kind: LinkTargetKind, id: Id, day: number | undefined): string[] {
  const first = rk.mentions.get(id);
  const v = rk.view;
  const has = (list: { id: Id }[] | undefined) => !!list?.some((x) => x.id === id);
  const known = kind === 'character' ? has(v?.characters) : kind === 'place' ? has(v?.places) : kind === 'group' ? has(v?.groups) : kind === 'event' ? has(v?.events) : kind === 'region' ? has(v?.regions) : true;
  if (!known) {
    if (first === rk.point + 1) return ['New to the reader: this chapter is the first to mention it.'];
    if (first !== undefined && first > rk.point + 1) return [`The reader has not met it yet (first mentioned in ${rk.labels[first]}).`];
    return ['The reader has not met it yet.'];
  }
  const out: string[] = [];
  if (first !== undefined && first <= rk.point) out.push(`First met in ${rk.labels[first]}.`);
  else out.push('Known to the reader.');
  if (kind === 'character' && v) {
    const vix = new WorldIndex(v);
    const rels = relationsOf(v, id, day ?? Number.MAX_SAFE_INTEGER).filter((r) => r.when !== 'before');
    if (rels.length) out.push(`Knows them as ${rels.slice(0, 4).map((r) => `${r.label} ${vix.characters.get(r.otherId)?.name ?? '?'}`).join(', ')}${rels.length > 4 ? '…' : ''}.`);
    const attrs = Object.entries(attributesOn(vix, id, day ?? Number.MAX_SAFE_INTEGER));
    if (attrs.length) out.push(attrs.slice(0, 3).map(([k, val]) => `${k}: ${val}`).join(' · '));
    const secrets = v.secrets.filter((s) => s.knowers.some((k) => k.characterId === id));
    if (secrets.length) out.push(`Knows they know: ${secrets.slice(0, 3).map((s) => s.title).join(', ')}.`);
  }
  return out;
}

/**
 * WR-10: the card for a record on a day (the scene's date; undefined = the scene has no date).
 * `rk` from readerKnowledge(); leave it out to skip the reader's part.
 */
export function nameCard(ix: WorldIndex, kind: LinkTargetKind, id: Id, day: number | undefined, rk?: ReaderKnowledge): NameCard | undefined {
  const w = ix.world;
  const reader = (k: LinkTargetKind) => (rk ? readerLines(w, rk, k, id, day) : []);
  const card = (title: string, subtitle: string | undefined, lines: CardLine[]): NameCard => ({ kind, id, title, subtitle, lines, reader: reader(kind) });

  if (kind === 'character') {
    const c = ix.characters.get(id);
    if (!c) return missing(kind, id);
    const lines: CardLine[] = [];
    const subtitle = [c.importance === 'main' ? 'Main character' : c.importance === 'secondary' ? 'Secondary character' : 'Minor character', c.aliases.length ? `also ${c.aliases.join(', ')}` : ''].filter(Boolean).join(' · ');
    if (day === undefined) {
      lines.push({ label: 'Date', text: 'Give the scene a date to see age and whereabouts.' });
    } else {
      const st = characterStatus(ix, id, day);
      lines.push({ label: 'Age', text: ageShort(ix, id, day) });
      lines.push({ label: 'Status', text: STATUS_LABEL[st.status] });
      lines.push({ label: 'Where', text: capital(whereText(ix, id, day).text) });
      const rels = relationsOf(w, id, day).filter((r) => r.when === 'now');
      if (rels.length) lines.push({ label: 'Relations', text: rels.slice(0, 5).map((r) => `${r.label} ${ix.characters.get(r.otherId)?.name ?? '?'}`).join(', ') + (rels.length > 5 ? '…' : '') });
      const attrs = Object.entries(attributesOn(ix, id, day)).filter(([k]) => k !== 'status');
      if (attrs.length) lines.push({ label: 'Now', text: attrs.slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(' · ') });
      const knows = knowledgeOf(w, id, day).filter((k) => k.knows);
      if (knows.length) lines.push({ label: 'Knows', text: knows.slice(0, 3).map((k) => k.secret.title).join(', ') + (knows.length > 3 ? '…' : '') });
    }
    return card(c.name, subtitle, lines);
  }

  if (kind === 'place') {
    const p = ix.places.get(id);
    if (!p) return missing(kind, id);
    const lines: CardLine[] = [];
    const path = ix.ancestors(id).map((a) => ix.places.get(a)?.name).filter(Boolean);
    const at = ix.locationOf(id);
    if (day !== undefined && at) {
      const chain = new LayerIndex(w).realmAt(at, day);
      if (chain.length) lines.push({ label: 'Realm', text: describeChain(chain) });
    }
    if (day !== undefined) {
      const here = w.characters.filter((c) => !c.archived).filter((c) => {
        const wt = whereText(ix, c.id, day);
        return wt.placeId && !wt.travelling && ix.nested(wt.placeId, id) && (wt.placeId === id || ix.ancestors(wt.placeId).includes(id));
      });
      lines.push({ label: 'Here then', text: here.length ? here.slice(0, 8).map((c) => c.name).join(', ') + (here.length > 8 ? ` and ${here.length - 8} more` : '') : 'Nobody in the cast' });
    }
    if (at) {
      const elev = hasTerrain(w.terrain) ? Math.max(0, new TerrainReader(w.terrain).elevation(at)) : 0;
      lines.push({ label: 'Seasons', text: localSeasons(at.lat, elev, w.settings.axialTiltDeg).text });
    }
    if (p.start || p.end) lines.push({ label: 'Exists', text: `${p.start ? formatFuzzy(p.start) : 'always'} – ${p.end ? formatFuzzy(p.end) : 'now'}` });
    return card(p.name, [p.kind, path.length ? `in ${path.join(', ')}` : ''].filter(Boolean).join(' · '), lines);
  }

  if (kind === 'region') {
    const r = w.regions.find((x) => x.id === id);
    if (!r) return missing(kind, id);
    const layer = w.regionLayers.find((l) => l.id === r.layerId);
    const lines: CardLine[] = [];
    if (day !== undefined) {
      const lix = new LayerIndex(w);
      lines.push({ label: 'Then', text: lix.exists(r, day) ? describeChain(lix.chain(r.id, day)) : 'Does not exist on this date' });
      const ties = r.ties.filter((t) => (!t.start || ix.win(t.start).earliest <= day) && (!t.end || ix.win(t.end).latest >= day));
      if (ties.length) lines.push({ label: 'People', text: ties.slice(0, 5).map((t) => `${ix.characters.get(t.characterId)?.name ?? '?'}${t.role ? ` (${t.role})` : ''}`).join(', ') });
    }
    if (r.entry) lines.push({ label: 'Entry', text: short(r.entry) });
    return card(r.name, layer?.name, lines);
  }

  if (kind === 'group') {
    const g = w.groups.find((x) => x.id === id);
    if (!g) return missing(kind, id);
    const members = w.memberships.filter((m) => m.groupId === id && (day === undefined || ((!m.start || ix.win(m.start).earliest <= day) && (!m.end || ix.win(m.end).latest >= day))));
    const lines: CardLine[] = [{ label: 'Members', text: members.length ? members.slice(0, 8).map((m) => ix.characters.get(m.characterId)?.name ?? '?').join(', ') : 'None on this date' }];
    if (g.description) lines.push({ label: 'About', text: short(g.description) });
    return card(g.name, 'Group', lines);
  }

  if (kind === 'event') {
    const e = w.events.find((x) => x.id === id);
    if (!e) return missing(kind, id);
    const lines: CardLine[] = [];
    if (e.start) {
      const when = `${formatFuzzy(e.start)}${e.end ? ` – ${formatFuzzy(e.end)}` : ''}`;
      const rel = day === undefined ? '' : midpoint(ix.win(e.start)) > day ? ' (still to come)' : ' (already happened)';
      lines.push({ label: 'When', text: when + rel });
    }
    if (e.placeId) lines.push({ label: 'Where', text: ix.places.get(e.placeId)?.name ?? '?' });
    if (e.characterIds.length) lines.push({ label: 'Who', text: e.characterIds.slice(0, 6).map((c) => ix.characters.get(c)?.name ?? '?').join(', ') });
    return card(e.name, e.kind, lines);
  }

  if (kind === 'scene' || kind === 'chapter' || kind === 'book') {
    const t = outline(w);
    if (kind === 'book') { const b = w.books.find((x) => x.id === id); return b ? card(b.title, 'Book', []) : missing(kind, id); }
    if (kind === 'chapter') { const c = w.chapters.find((x) => x.id === id); return c ? card(c.title, t.find((b) => b.book.id === c.bookId)?.book.title, []) : missing(kind, id); }
    const s = w.scenes.find((x) => x.id === id);
    if (!s) return missing(kind, id);
    return card(s.title, w.chapters.find((c) => c.id === s.chapterId)?.title, [s.start ? { label: 'When', text: formatFuzzy(s.start) } : undefined, s.summary ? { label: 'Summary', text: short(s.summary) } : undefined].filter(Boolean) as CardLine[]);
  }

  if (kind === 'stay' || kind === 'journey') {
    const r = kind === 'stay' ? w.stays.find((x) => x.id === id) : w.journeys.find((x) => x.id === id);
    if (!r) return missing(kind, id);
    const who = r.subject.kind === 'character' ? ix.characters.get(r.subject.id)?.name : w.groups.find((g) => g.id === r.subject.id)?.name;
    if (kind === 'stay') { const s = r as World['stays'][number]; return card(`${who ?? '?'} at ${ix.places.get(s.placeId)?.name ?? '?'}`, 'Stay', [{ label: 'From', text: formatFuzzy(s.arrival) }]); }
    const j = r as World['journeys'][number];
    return card(`${who ?? '?'}: ${ix.places.get(j.originId)?.name ?? '?'} → ${ix.places.get(j.destinationId)?.name ?? '?'}`, 'Journey', [{ label: 'Leaves', text: formatFuzzy(j.departure) }]);
  }
  return undefined;
}

function missing(kind: LinkTargetKind, id: Id): NameCard {
  return { kind, id, title: 'Linked record no longer exists', lines: [], reader: [], missing: true };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s: string) => (s.length > 160 ? s.slice(0, 157).trimEnd() + '…' : s);

function ageShort(ix: WorldIndex, id: Id, day: number): string {
  const c = ix.characters.get(id);
  if (!c?.birth) return 'No birth date';
  const born = ix.win(c.birth);
  if (day < born.earliest) return 'Not born yet';
  const y = (from: number) => Math.floor((day - from) / 365.2425);
  const a = y(born.latest), b = y(born.earliest);
  return a === b ? `${b}` : `${Math.max(0, a)}–${b}`;
}

export interface LinkTarget { kind: LinkTargetKind; id: Id; label: string; detail?: string }

const KIND_WORD: Partial<Record<LinkTargetKind, string>> = { character: 'Character', place: 'Place', region: 'Realm or region', group: 'Group', event: 'Event', book: 'Book', chapter: 'Chapter', scene: 'Scene' };

/**
 * WR-11: records an @ link can point at whose name, alias or title matches what was typed.
 * Names with a word that starts with the query come first (main characters, then other characters,
 * places and realms, groups and events, then books, chapters and scenes), then names that merely contain it.
 */
export function linkTargets(world: World, query: string, limit = 8): LinkTarget[] {
  const q = query.trim().toLowerCase();
  const all: (LinkTarget & { names: string[]; rank: number })[] = [];
  const push = (kind: LinkTargetKind, id: Id, label: string, names: string[], rank: number, detail?: string) => all.push({ kind, id, label, names: [label, ...names], rank, detail: detail ?? KIND_WORD[kind] });
  const imp = { main: 0, secondary: 1, minor: 2 } as Record<string, number>;
  for (const c of world.characters) if (!c.archived) push('character', c.id, c.name, c.aliases, imp[c.importance] ?? 2);
  for (const p of world.places) if (!p.isPlaceholder) push('place', p.id, p.name, p.aliases, 3, p.kind ? `Place · ${p.kind}` : 'Place');
  for (const r of world.regions) push('region', r.id, r.name, [], 3, world.regionLayers.find((l) => l.id === r.layerId)?.name ?? 'Region');
  for (const g of world.groups) push('group', g.id, g.name, [], 4);
  for (const e of world.events) push('event', e.id, e.name, [], 4, e.start ? `Event · ${formatFuzzy(e.start)}` : 'Event');
  for (const b of world.books) push('book', b.id, b.title, [], 6);
  for (const c of world.chapters) push('chapter', c.id, c.title, [], 6);
  for (const s of world.scenes) push('scene', s.id, s.title, [], 7);
  const score = (t: (typeof all)[number]) => {
    let best = Infinity;
    for (const n of t.names) {
      const l = n.toLowerCase();
      const s = !q ? 1 : l.startsWith(q) || l.split(/[\s-]+/).some((w) => w.startsWith(q)) ? 0 : l.includes(q) ? 1 : Infinity;
      best = Math.min(best, s);
    }
    return best;
  };
  return all
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s < Infinity && x.t.label.trim())
    .sort((a, b) => a.s - b.s || a.t.rank - b.t.rank || a.t.label.localeCompare(b.t.label))
    .slice(0, limit)
    .map(({ t }) => ({ kind: t.kind, id: t.id, label: t.label, detail: t.detail }));
}
