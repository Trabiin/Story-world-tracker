/**
 * EU-20: what depends on a record, merging duplicates, and deleting with a choice for each
 * dependant. Ids are random UUIDs, so any string equal to an id is a reference to it.
 */
import type { Id, World } from '../model';
import { DATA_COLLECTIONS, recordLabel } from './labels';

export type DataCollection = (typeof DATA_COLLECTIONS)[number];

export interface Dependant { collection: DataCollection; id: Id; label: string }

const holds = (v: unknown, id: Id, depth = 0): boolean => {
  if (v === id) return true;
  if (depth > 8 || !v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some((x) => holds(x, id, depth + 1));
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (depth === 0 && (k === 'id' || k === 'scenarioId')) continue;
    if (k === 'points' || k === 'area' || k === 'route' || k === 'paragraphs') continue;
    if (holds(x, id, depth + 1)) return true;
  }
  return false;
};

/** Every record that refers to this one. */
export function dependants(world: World, id: Id): Dependant[] {
  const out: Dependant[] = [];
  for (const c of DATA_COLLECTIONS) for (const r of world[c] as { id: Id }[]) if (r.id !== id && holds(r, id)) out.push({ collection: c, id: r.id, label: recordLabel(world, c, r) });
  return out;
}

/** Copy-on-write: every reference to `from` now points at `to`. Records' own ids stay. */
function replaceIn<T>(v: T, from: Id, to: Id, depth = 0): T {
  if ((v as unknown) === from) return to as unknown as T;
  if (depth > 8 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    let out: unknown[] | undefined;
    v.forEach((x, i) => { const n = replaceIn(x, from, to, depth + 1); if (n !== x) (out ??= v.slice())[i] = n; });
    return (out ?? v) as unknown as T;
  }
  let out: Record<string, unknown> | undefined;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (depth === 0 && (k === 'id' || k === 'scenarioId')) continue;
    if (k === 'points' || k === 'area' || k === 'route' || k === 'paragraphs') continue;
    const n = replaceIn(x, from, to, depth + 1);
    if (n !== x) (out ??= { ...(v as Record<string, unknown>) })[k] = n;
  }
  return (out ?? v) as T;
}

export function replaceRefs(world: World, from: Id, to: Id): World {
  const next = { ...world, settings: replaceIn(world.settings, from, to) } as World;
  for (const c of DATA_COLLECTIONS) (next as unknown as Record<string, unknown>)[c] = replaceIn(world[c], from, to);
  return tidy(next);
}

/** After a merge or reassignment: no one is their own relative, no list names someone twice. */
function tidy(w: World): World {
  const dedupe = <T extends { characterIds: Id[] }>(r: T): T => (new Set(r.characterIds).size === r.characterIds.length ? r : { ...r, characterIds: [...new Set(r.characterIds)] });
  return {
    ...w,
    relationships: w.relationships.filter((r) => r.aId !== r.bId),
    places: w.places.map((p) => (p.parentId === p.id ? { ...p, parentId: undefined } : p)),
    scenes: w.scenes.map(dedupe),
    events: w.events.map(dedupe),
    threads: w.threads.map(dedupe),
    secrets: w.secrets.map((s) => (new Set(s.knowers.map((k) => k.characterId)).size === s.knowers.length ? s : { ...s, knowers: s.knowers.filter((k, i) => s.knowers.findIndex((x) => x.characterId === k.characterId) === i) })),
  };
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const joinText = (a: string, b: string) => (a && b && a !== b ? `${a}\n\n${b}` : a || b);

/** EU-20: fold `dropId` into `keepId`. Its stays, links, relationships and the rest move over; its names become aliases. */
export function mergeRecords(world: World, collection: 'characters' | 'places' | 'groups' | 'events', keepId: Id, dropId: Id): World {
  if (keepId === dropId) return world;
  const list = world[collection] as unknown as Record<string, unknown>[];
  const keep = list.find((r) => r.id === keepId);
  const drop = list.find((r) => r.id === dropId);
  if (!keep || !drop) return world;
  const merged: Record<string, unknown> = { ...keep };
  const name = (r: Record<string, unknown>) => String(r.name ?? '');
  if (Array.isArray(keep.aliases)) merged.aliases = uniq([...(keep.aliases as string[]), name(drop), ...((drop.aliases as string[]) ?? [])]).filter((a) => a !== name(keep));
  if (Array.isArray(keep.tags)) merged.tags = uniq([...(keep.tags as string[]), ...((drop.tags as string[]) ?? [])]);
  for (const k of ['notes', 'description']) if (typeof keep[k] === 'string') merged[k] = joinText(keep[k] as string, (drop[k] as string) ?? '');
  for (const k of ['birth', 'death', 'portrait', 'location', 'parentId', 'start', 'end', 'placeId']) if (merged[k] === undefined && drop[k] !== undefined && drop[k] !== keepId) merged[k] = drop[k];
  if (Array.isArray(keep.attributes) || Array.isArray(drop.attributes)) merged.attributes = [...((keep.attributes as unknown[]) ?? []), ...((drop.attributes as unknown[]) ?? [])];
  if (Array.isArray(keep.plans) || Array.isArray(drop.plans)) merged.plans = [...((keep.plans as unknown[]) ?? []), ...((drop.plans as unknown[]) ?? [])];
  if (Array.isArray(keep.images) || Array.isArray(drop.images)) merged.images = [...((keep.images as unknown[]) ?? []), ...((drop.images as unknown[]) ?? [])];
  if (Array.isArray(keep.characterIds)) merged.characterIds = uniq([...(keep.characterIds as string[]), ...((drop.characterIds as string[]) ?? [])]);
  const next = { ...world, [collection]: list.filter((r) => r.id !== dropId).map((r) => (r.id === keepId ? merged : r)) } as World;
  return replaceRefs(next, dropId, keepId);
}

/** References a dependant cannot live without: the record goes with the one deleted. */
const REQUIRED: Partial<Record<DataCollection, string[]>> = {
  stays: ['subject', 'placeId'],
  journeys: ['subject', 'originId', 'destinationId'],
  memberships: ['characterId', 'groupId'],
  relationships: ['aId', 'bId'],
  links: ['target'],
  mapFeatures: ['placeId'],
  scenes: ['chapterId'],
  chapters: ['bookId'],
  regions: ['layerId'],
  sceneTexts: ['sceneId'],
  arcs: ['characterId', 'bookId'],
  passes: ['bookId'],
  submissions: ['bookId'],
};

function strip(v: unknown, id: Id, parentOf: Id | undefined, depth = 0): unknown {
  if (depth > 8 || !v || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = v.filter((x) => x !== id && !(x && typeof x === 'object' && !Array.isArray(x) && Object.values(x as Record<string, unknown>).includes(id))).map((x) => strip(x, id, parentOf, depth + 1));
    return out.length === v.length && out.every((x, i) => x === v[i]) ? v : out;
  }
  let out: Record<string, unknown> | undefined;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (depth === 0 && (k === 'id' || k === 'scenarioId')) continue;
    if (k === 'points' || k === 'area' || k === 'route' || k === 'paragraphs') continue;
    let n: unknown;
    if (x === id) n = k === 'parentId' ? parentOf : undefined;
    else n = strip(x, id, parentOf, depth + 1);
    if (n !== x) (out ??= { ...(v as Record<string, unknown>) })[k] = n;
  }
  return out ?? v;
}

/**
 * EU-20: delete a record. 'remove' deletes what cannot live without it (its stays, journeys,
 * memberships, relationships, links) and takes it out of every list; sub-places move up a level.
 * 'reassign' hands everything to another record first.
 */
export function deleteRecord(world: World, collection: DataCollection, id: Id, mode: { kind: 'remove' } | { kind: 'reassign'; to: Id }): World {
  let w = world;
  if (mode.kind === 'reassign') w = replaceRefs(w, id, mode.to);
  // NT-7: a book's beat stays when its scene goes; it is only no longer placed.
  else if (collection === 'scenes' && w.books.some((b) => b.beats?.some((x) => x.sceneId === id))) {
    w = { ...w, books: w.books.map((b) => (b.beats?.some((x) => x.sceneId === id) ? { ...b, beats: b.beats.map((x) => (x.sceneId === id ? { ...x, sceneId: undefined } : x)) } : b)) };
  }
  const rec = (w[collection] as unknown as Record<string, unknown>[]).find((r) => r.id === id);
  const parentOf = rec?.parentId as Id | undefined;
  const next = { ...w, settings: strip(w.settings, id, undefined) } as World;
  for (const c of DATA_COLLECTIONS) {
    const list = w[c] as unknown as Record<string, unknown>[];
    const req = REQUIRED[c] ?? [];
    const out = list
      .filter((r) => r.id !== id || c !== collection)
      .filter((r) => !req.some((k) => holds({ x: r[k] }, id)))
      .map((r) => strip(r, id, parentOf) as Record<string, unknown>);
    (next as unknown as Record<string, unknown>)[c] = out.length === list.length && out.every((x, i) => x === list[i]) ? list : out;
  }
  return next;
}

/** What a 'remove' delete would take with it, and what it would only unlink. */
export function deleteImpact(world: World, collection: DataCollection, id: Id): { goes: Dependant[]; unlinked: Dependant[] } {
  const goes: Dependant[] = [];
  const unlinked: Dependant[] = [];
  for (const d of dependants(world, id)) {
    const r = (world[d.collection] as unknown as Record<string, unknown>[]).find((x) => x.id === d.id)!;
    ((REQUIRED[d.collection] ?? []).some((k) => holds({ x: r[k] }, id)) ? goes : unlinked).push(d);
  }
  void collection;
  return { goes, unlinked };
}
