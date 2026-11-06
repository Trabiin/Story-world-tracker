/** ST-3: plot threads across the books, with branches and rejoins, laid out for the thread map. */
import type { Id, PlotThread, World } from '../model';
import { orderedScenes } from './order';

export interface ThreadLane {
  thread: PlotThread;
  lane: number;
  /** Reading positions of its scenes. */
  scenes: { id: Id; readIndex: number }[];
  first?: number;
  last?: number;
}

/** One lane per thread, branches right under their parent, with each scene's reading position. */
export function threadLanes(world: World): { lanes: ThreadLane[]; total: number } {
  const ordered = orderedScenes(world);
  const pos = new Map(ordered.map((o) => [o.scene.id, o.readIndex]));
  const children = new Map<Id | undefined, PlotThread[]>();
  const known = new Set(world.threads.map((t) => t.id));
  for (const t of world.threads) {
    const p = t.parentId && known.has(t.parentId) ? t.parentId : undefined;
    children.set(p, [...(children.get(p) ?? []), t]);
  }
  const lanes: ThreadLane[] = [];
  const seen = new Set<Id>();
  const walk = (parent: Id | undefined) => {
    for (const t of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const scenes = world.scenes.filter((s) => s.threadIds?.includes(t.id) && pos.has(s.id)).map((s) => ({ id: s.id, readIndex: pos.get(s.id)! })).sort((a, b) => a.readIndex - b.readIndex);
      lanes.push({ thread: t, lane: lanes.length, scenes, first: scenes[0]?.readIndex, last: scenes[scenes.length - 1]?.readIndex });
      walk(t.id);
    }
  };
  walk(undefined);
  return { lanes, total: ordered.length };
}
