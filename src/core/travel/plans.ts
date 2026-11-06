/** WH-10 incidents on a journey, and WH-11 plans: where a character means to go next. */
import { formatDayNumber, toWindow } from '../dates';
import type { LatLng } from '../globe';
import type { Character, Id, Incident, Journey, Plan, World } from '../model';
import { WorldIndex, pointAlong, whereIs } from '../whereabouts';

/** WH-10: where on the route, and on which day, an incident happens. */
export function incidentAt(ix: WorldIndex, j: Journey, inc: Incident): { day: number; at?: LatLng } {
  const dep = ix.win(j.departure).earliest;
  const end = ix.journeyEnd(j).end.earliest;
  const len = Math.max(1, end - dep + 1);
  const day = dep + Math.max(0, inc.day - 1);
  const path = ix.journeyPath(j);
  const at = path ? pointAlong(path, Math.min(1, Math.max(0, (inc.day - 0.5) / len)), ix.world.settings.radiusKm) : undefined;
  return { day, at };
}

export interface PlanView { character: Character; plan: Plan; active: boolean; overdue: boolean; reached: boolean }

/** WH-11: a plan is active from its decision date until done, reached, or forever while undone. */
export function plansOn(ix: WorldIndex, day: number): PlanView[] {
  const w = ix.world;
  const out: PlanView[] = [];
  for (const c of w.characters) {
    for (const p of c.plans ?? []) {
      const from = p.from ? ix.win(p.from).earliest : -Infinity;
      const by = p.by ? ix.win(p.by).latest : undefined;
      const reached = reachedPlace(ix, c.id, p.placeId, from);
      out.push({ character: c, plan: p, reached, active: !p.done && !reached && from <= day, overdue: !p.done && !reached && by !== undefined && by < day });
    }
  }
  return out;
}

/** Does the character stay at (or inside) the place after the plan was made? */
export function reachedPlace(ix: WorldIndex, characterId: Id, placeId: Id, from: number): boolean {
  return ix.segmentsFor(characterId).some((s) => s.kind === 'stay' && s.end.latest >= from && (s.placeId === placeId || ix.ancestors(s.placeId).includes(placeId)));
}

export interface PlanIssue { key: string; characterId: Id; message: string; day: number }

/** WH-11: plans whose date has passed without the character getting there. */
export function overduePlans(world: World): PlanIssue[] {
  const ix = new WorldIndex(world);
  const out: PlanIssue[] = [];
  const h = world.settings.hemisphereForSeasons;
  for (const c of world.characters) {
    if (c.archived) continue;
    for (const p of c.plans ?? []) {
      if (p.done || !p.by || !p.placeId) continue;
      const from = p.from ? toWindow(p.from, h).earliest : -Infinity;
      if (reachedPlace(ix, c.id, p.placeId, from)) continue;
      const by = toWindow(p.by, h).latest;
      // Only once the story has reached that date for this character.
      const last = Math.max(...ix.segmentsFor(c.id).map((s) => (s.end.latest === Number.MAX_SAFE_INTEGER ? s.start.latest : s.end.latest)), -Infinity);
      if (last < by) continue;
      out.push({ key: `plan-overdue:${c.id}:${p.id}`, characterId: c.id, day: by, message: `${c.name} meant to reach ${ix.places.get(p.placeId)?.name ?? '?'} by ${formatDayNumber(by)}, but never gets there.${p.note ? ` (${p.note})` : ''}` });
    }
  }
  return out;
}

/** Where a character would start a journey for a plan: where they are on the day. */
export function planOrigin(ix: WorldIndex, characterId: Id, day: number): Id | undefined {
  const w = whereIs(ix, characterId, day);
  return w.kind === 'stay' ? w.placeId : w.kind === 'journey' ? w.toId : undefined;
}
