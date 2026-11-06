/**
 * ST-4 reading order vs chronological order, ST-5 flashbacks and parallel scenes, and ST-13 the
 * per-chapter overview built from the links.
 */
import { DayWindow, toWindow } from '../dates';
import type { Id, Scene, World } from '../model';
import { linkChapters, readingOrder } from '../story/spoilers';
import { scenePlace, scenePov } from '../story/story';
import type { WorldIndex } from '../whereabouts';

export interface OrderedScene {
  scene: Scene;
  /** Position in reading order (0 = first scene of the first book). */
  readIndex: number;
  chapterId: Id;
  chapterLabel: string;
  window?: DayWindow;
  /** ST-5: happens before something the reader has already seen. */
  flashback: boolean;
  /** ST-5: overlaps in time with a scene from another point of view. */
  parallelWith: Id[];
}

/** Every scene with its reading position and in-world window, in reading order. */
export function orderedScenes(world: World): OrderedScene[] {
  const h = world.settings.hemisphereForSeasons;
  const points = readingOrder(world);
  const out: OrderedScene[] = [];
  for (const p of points) {
    for (const s of world.scenes.filter((x) => x.chapterId === p.chapter.id).sort((a, b) => a.order - b.order)) {
      const w = s.start ? toWindow(s.start, h) : undefined;
      const end = s.end ? toWindow(s.end, h) : w;
      out.push({ scene: s, readIndex: out.length, chapterId: p.chapter.id, chapterLabel: p.label, window: w && end ? { earliest: w.earliest, latest: Math.max(w.latest, end.latest) } : undefined, flashback: false, parallelWith: [] });
    }
  }
  // Flashback: certainly before the latest moment already read.
  let latestSeen = -Infinity;
  for (const o of out) {
    if (!o.window) continue;
    if (o.window.latest < latestSeen) o.flashback = true;
    latestSeen = Math.max(latestSeen, o.window.earliest);
  }
  for (const a of out) for (const b of out) {
    if (a === b || !a.window || !b.window || a.chapterId === b.chapterId) continue;
    if (scenePov(world, a.scene) === scenePov(world, b.scene)) continue;
    if (a.window.earliest <= b.window.latest && b.window.earliest <= a.window.latest) a.parallelWith.push(b.scene.id);
  }
  return out;
}

/** ST-4: the same scenes in the order they happen. Undated scenes go last, in reading order. */
export function chronologicalScenes(world: World): OrderedScene[] {
  return [...orderedScenes(world)].sort((a, b) => (a.window?.earliest ?? Infinity) - (b.window?.earliest ?? Infinity) || a.readIndex - b.readIndex);
}

export interface ChapterOverview {
  characters: { id: Id; pov: boolean; scenes: number; passages: number }[];
  places: { id: Id; scenes: number; passages: number }[];
  range?: DayWindow;
  scenes: number;
  undated: number;
}

/** ST-13: who appears in a chapter, where it takes place and when, from scenes and linked passages. */
export function chapterOverview(ix: WorldIndex, chapterId: Id): ChapterOverview {
  const w = ix.world;
  const ch = w.chapters.find((c) => c.id === chapterId);
  const scenes = w.scenes.filter((s) => s.chapterId === chapterId);
  const chars = new Map<Id, { id: Id; pov: boolean; scenes: number; passages: number }>();
  const places = new Map<Id, { id: Id; scenes: number; passages: number }>();
  const ch1 = (id: Id) => chars.get(id) ?? chars.set(id, { id, pov: false, scenes: 0, passages: 0 }).get(id)!;
  const pl1 = (id: Id) => places.get(id) ?? places.set(id, { id, scenes: 0, passages: 0 }).get(id)!;
  if (ch?.povCharacterId) ch1(ch.povCharacterId).pov = true;
  let range: DayWindow | undefined;
  let undated = 0;
  for (const s of scenes) {
    const pov = scenePov(w, s);
    for (const id of new Set([...(pov ? [pov] : []), ...s.characterIds])) {
      const e = ch1(id);
      e.scenes++;
      if (id === pov) e.pov = true;
    }
    const p = scenePlace(ix, s).placeId;
    if (p && !ix.isPlaceholder(p)) pl1(p).scenes++;
    if (s.start) {
      const a = ix.win(s.start), b = s.end ? ix.win(s.end) : a;
      range = range ? { earliest: Math.min(range.earliest, a.earliest), latest: Math.max(range.latest, b.latest) } : { earliest: a.earliest, latest: Math.max(a.latest, b.latest) };
    } else undated++;
  }
  // Passages linked inside this chapter of a manuscript.
  const order = readingOrder(w);
  const idx = order.find((o) => o.chapter.id === chapterId)?.index;
  if (idx !== undefined) {
    const at = linkChapters(w);
    for (const l of w.links) {
      if (at.get(l) !== idx) continue;
      if (l.target.kind === 'character') ch1(l.target.id).passages++;
      if (l.target.kind === 'place') pl1(l.target.id).passages++;
    }
  }
  const byWeight = <T extends { scenes: number; passages: number }>(a: T, b: T) => b.scenes + b.passages - (a.scenes + a.passages);
  return { characters: [...chars.values()].sort((a, b) => Number(b.pov) - Number(a.pov) || byWeight(a, b)), places: [...places.values()].sort(byWeight), range, scenes: scenes.length, undated };
}
