/** Names for any record, used by search, the dashboard, to-dos and delete warnings. */
import { formatFuzzy } from '../dates';
import type { Id, RefKind, World } from '../model';

/** Collections that hold story data (not settings, terrain or map images). */
export const DATA_COLLECTIONS = ['characters', 'places', 'groups', 'memberships', 'stays', 'journeys', 'books', 'chapters', 'scenes', 'manuscripts', 'links', 'mapSymbols', 'mapFeatures', 'detailMaps', 'regionLayers', 'regions', 'events', 'relationships', 'secrets', 'threads', 'todos', 'sceneTexts'] as const;

export const COLLECTION_LABEL: Record<(typeof DATA_COLLECTIONS)[number], [string, string]> = {
  characters: ['character', 'characters'], places: ['place', 'places'], groups: ['group', 'groups'], memberships: ['group membership', 'group memberships'],
  stays: ['stay', 'stays'], journeys: ['journey', 'journeys'], books: ['book', 'books'], chapters: ['chapter', 'chapters'], scenes: ['scene', 'scenes'],
  manuscripts: ['manuscript', 'manuscripts'], links: ['manuscript link', 'manuscript links'], mapSymbols: ['map symbol', 'map symbols'], mapFeatures: ['map feature', 'map features'],
  detailMaps: ['detail map', 'detail maps'], regionLayers: ['layer', 'layers'], regions: ['region', 'regions'], events: ['event', 'events'], relationships: ['relationship', 'relationships'],
  secrets: ['secret', 'secrets'], threads: ['plot thread', 'plot threads'], todos: ['to-do', 'to-dos'], sceneTexts: ['scene text', 'scene texts'],
};

export const countText = (n: number, c: (typeof DATA_COLLECTIONS)[number]) => `${n} ${COLLECTION_LABEL[c][n === 1 ? 0 : 1]}`;

export function recordLabel(world: World, c: string, r: unknown): string {
  const o = r as Record<string, unknown>;
  const name = (o.name ?? o.title) as string | undefined;
  if (name) return name;
  const place = (id: unknown) => world.places.find((p) => p.id === id)?.name ?? '?';
  const who = (s: { kind: string; id: Id } | undefined) => (s ? ((s.kind === 'character' ? world.characters : world.groups) as { id: Id; name: string }[]).find((x) => x.id === s.id)?.name ?? '?' : '?');
  const ch = (id: unknown) => world.characters.find((x) => x.id === id)?.name ?? '?';
  const when = (d: unknown) => (d ? `, ${formatFuzzy(d as never)}` : '');
  if (c === 'stays') return `${who(o.subject as never)} at ${place(o.placeId)}${when(o.arrival)}`;
  if (c === 'journeys') return `${who(o.subject as never)}: ${place(o.originId)} → ${place(o.destinationId)}${when(o.departure)}`;
  if (c === 'memberships') return `${ch(o.characterId)} in ${world.groups.find((g) => g.id === o.groupId)?.name ?? '?'}`;
  if (c === 'relationships') return `${ch(o.aId)} and ${ch(o.bId)} (${o.kind})`;
  if (c === 'sceneTexts') return `Text of ${world.scenes.find((s) => s.id === o.sceneId)?.title ?? 'a scene'}`;
  if (c === 'links') return `“${String((o.anchor as { quote?: string })?.quote ?? '').slice(0, 50)}”`;
  return String(o.kind ?? c);
}

/** Collection for a reference kind. */
export const REF_COLLECTION: Record<RefKind, (typeof DATA_COLLECTIONS)[number]> = {
  character: 'characters', place: 'places', group: 'groups', stay: 'stays', journey: 'journeys', book: 'books', chapter: 'chapters', scene: 'scenes',
  event: 'events', secret: 'secrets', region: 'regions', thread: 'threads', manuscript: 'manuscripts', relationship: 'relationships',
};

export function refLabel(world: World, kind: RefKind, id: Id): string | undefined {
  const c = REF_COLLECTION[kind];
  const r = (world[c] as { id: Id }[]).find((x) => x.id === id);
  return r ? recordLabel(world, c, r) : undefined;
}
