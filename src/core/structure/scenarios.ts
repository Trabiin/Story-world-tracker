/**
 * ST-7, DM-6: "what if" scenarios. Canon records have scenarioId 'canon'. A scenario stores the
 * records it changes or adds under the id "<scenario>~<id>"; while it is active they stand in for
 * the canon record with the same id. Canon records it removes are listed in Scenario.hidden.
 * ST-6: drafts can be left out of every view.
 */
import { CANON, Id, Scenario, World } from '../model';

/** Collections a scenario can change. The rest (manuscripts, map images, layers…) are shared. */
export const SCENARIO_COLLECTIONS = ['characters', 'places', 'groups', 'memberships', 'stays', 'journeys', 'books', 'chapters', 'scenes', 'mapFeatures', 'mapSymbols', 'regions', 'events', 'relationships', 'secrets', 'threads'] as const;
export type ScenarioCollection = (typeof SCENARIO_COLLECTIONS)[number];

type Rec = { id: Id; scenarioId: Id; status?: 'draft' | 'canon' };
const SEP = '~';
export const overlayId = (scenarioId: Id, id: Id) => `${scenarioId}${SEP}${id}`;
const baseId = (scenarioId: Id, stored: Id) => stored.slice(scenarioId.length + SEP.length);
const list = (w: World, c: ScenarioCollection) => w[c] as unknown as Rec[];

/** The world as one scenario sees it (canon when scenarioId is 'canon'). */
export function scenarioView(world: World, scenarioId: Id = CANON): World {
  const sc = scenarioId === CANON ? undefined : world.scenarios.find((s) => s.id === scenarioId);
  const active = sc ? scenarioId : CANON;
  const hidden = new Set(sc?.hidden ?? []);
  let out: World | undefined;
  for (const c of SCENARIO_COLLECTIONS) {
    const all = list(world, c);
    if (!all.some((r) => r.scenarioId !== CANON) && !sc) continue; // nothing to filter: keep the same array
    const overlays = new Map<Id, Rec>();
    if (sc) for (const r of all) if (r.scenarioId === active) overlays.set(baseId(active, r.id), { ...r, id: baseId(active, r.id) });
    const view: Rec[] = [];
    for (const r of all) {
      if (r.scenarioId !== CANON) continue;
      if (hidden.has(`${c}:${r.id}`)) continue;
      const o = overlays.get(r.id);
      view.push(o ?? r);
      if (o) overlays.delete(r.id);
    }
    view.push(...overlays.values());
    (out ??= { ...world } as World)[c] = view as never;
  }
  return out ?? world;
}

/**
 * Write an edit made on a scenario's view back into the stored world. `before` is the view the edit
 * started from, `after` the edited view. Shared collections, settings and terrain are copied as they are.
 */
export function applyScenarioEdit(world: World, scenarioId: Id, before: World, after: World): World {
  const next = { ...world } as World;
  for (const k of Object.keys(after) as (keyof World)[]) {
    if ((SCENARIO_COLLECTIONS as readonly string[]).includes(k)) continue;
    if (after[k] !== before[k]) (next as unknown as Record<string, unknown>)[k] = after[k];
  }
  const sc = scenarioId === CANON ? undefined : next.scenarios.find((s) => s.id === scenarioId);
  let hidden = sc ? new Set(sc.hidden) : undefined;
  for (const c of SCENARIO_COLLECTIONS) {
    if (after[c] === before[c]) continue;
    const prev = new Map(list(before, c).map((r) => [r.id, r]));
    const stored = list(world, c);
    const byStoredId = new Map(stored.map((r, i) => [r.id, i]));
    const out = stored.slice();
    const removeIdx = new Set<number>();
    const keep = new Set<Id>();
    for (const r of list(after, c)) {
      keep.add(r.id);
      if (prev.get(r.id) === r) continue;
      const sid = sc ? overlayId(scenarioId, r.id) : r.id;
      const rec = sc ? { ...r, id: sid, scenarioId } : { ...r, scenarioId: CANON };
      const i = byStoredId.get(sid);
      if (i !== undefined) out[i] = rec; else { byStoredId.set(sid, out.length); out.push(rec); }
      if (sc) hidden!.delete(`${c}:${r.id}`);
    }
    for (const id of prev.keys()) {
      if (keep.has(id)) continue;
      const sid = sc ? overlayId(scenarioId, id) : id;
      const i = byStoredId.get(sid);
      if (i !== undefined) removeIdx.add(i);
      if (sc && stored.some((r) => r.id === id && r.scenarioId === CANON)) hidden!.add(`${c}:${id}`);
    }
    (next as unknown as Record<string, unknown>)[c] = removeIdx.size ? out.filter((_, i) => !removeIdx.has(i)) : out;
  }
  if (sc && hidden) {
    const h = [...hidden].sort();
    if (h.join() !== [...sc.hidden].sort().join()) next.scenarios = next.scenarios.map((s) => (s.id === scenarioId ? { ...s, hidden: h } : s));
  }
  return next;
}

export interface ScenarioChange {
  collection: ScenarioCollection;
  id: Id;
  kind: 'added' | 'changed' | 'removed';
  label: string;
}

const labelOf = (world: World, c: ScenarioCollection, r: Record<string, unknown>): string => {
  const name = (r.name ?? r.title) as string | undefined;
  if (name) return name;
  const place = (id: unknown) => world.places.find((p) => p.id === id)?.name ?? '?';
  const who = (s: { kind: string; id: Id } | undefined) => (s ? (s.kind === 'character' ? world.characters : world.groups).find((x) => x.id === s.id)?.name ?? '?' : '?');
  if (c === 'stays') return `${who(r.subject as never)} at ${place(r.placeId)}`;
  if (c === 'journeys') return `${who(r.subject as never)}: ${place(r.originId)} → ${place(r.destinationId)}`;
  if (c === 'memberships') return `${world.characters.find((x) => x.id === r.characterId)?.name ?? '?'} in ${world.groups.find((g) => g.id === r.groupId)?.name ?? '?'}`;
  if (c === 'relationships') return `${world.characters.find((x) => x.id === r.aId)?.name ?? '?'} – ${world.characters.find((x) => x.id === r.bId)?.name ?? '?'} (${r.kind})`;
  return String(r.kind ?? c);
};

/** ST-7: what a scenario changes compared with canon. */
export function scenarioChanges(world: World, scenarioId: Id): ScenarioChange[] {
  const sc = world.scenarios.find((s) => s.id === scenarioId);
  if (!sc) return [];
  const out: ScenarioChange[] = [];
  const view = scenarioView(world, scenarioId);
  for (const c of SCENARIO_COLLECTIONS) {
    const canonIds = new Set(list(world, c).filter((r) => r.scenarioId === CANON).map((r) => r.id));
    for (const r of list(world, c)) {
      if (r.scenarioId !== scenarioId) continue;
      const id = baseId(scenarioId, r.id);
      out.push({ collection: c, id, kind: canonIds.has(id) ? 'changed' : 'added', label: labelOf(view, c, r as unknown as Record<string, unknown>) });
    }
  }
  for (const h of sc.hidden) {
    const [c, id] = h.split(':') as [ScenarioCollection, Id];
    const r = list(world, c)?.find((x) => x.id === id && x.scenarioId === CANON);
    if (r) out.push({ collection: c, id, kind: 'removed', label: labelOf(world, c, r as unknown as Record<string, unknown>) });
  }
  return out;
}

/** ST-7: make a scenario the new canon. Its changes replace canon and the scenario is gone. */
export function promoteScenario(world: World, scenarioId: Id): World {
  const view = scenarioView(world, scenarioId);
  const next = { ...world } as World;
  for (const c of SCENARIO_COLLECTIONS) {
    const others = list(world, c).filter((r) => r.scenarioId !== CANON && r.scenarioId !== scenarioId);
    const promoted = list(view, c).map((r) => (r.scenarioId === scenarioId ? { ...r, scenarioId: CANON } : r));
    (next as unknown as Record<string, unknown>)[c] = [...promoted, ...others];
  }
  next.scenarios = world.scenarios.filter((s) => s.id !== scenarioId);
  return next;
}

/** ST-7: throw a scenario away with everything it changed. Canon is untouched. */
export function discardScenario(world: World, scenarioId: Id): World {
  const next = { ...world } as World;
  for (const c of SCENARIO_COLLECTIONS) (next as unknown as Record<string, unknown>)[c] = list(world, c).filter((r) => r.scenarioId !== scenarioId);
  next.scenarios = world.scenarios.filter((s) => s.id !== scenarioId);
  return next;
}

/** A new, empty scenario record. */
export function newScenario(base: { id: Id; createdAt: string; updatedAt: string }, name: string): Scenario {
  return { ...base, scenarioId: CANON, status: 'canon', name, description: '', hidden: [] };
}

/** ST-6: leave draft records out (for "hide drafts"). */
export function withoutDrafts(world: World): World {
  let out: World | undefined;
  for (const c of SCENARIO_COLLECTIONS) {
    const all = list(world, c);
    if (!all.some((r) => r.status === 'draft')) continue;
    (out ??= { ...world } as World)[c] = all.filter((r) => r.status !== 'draft') as never;
  }
  return out ?? world;
}
