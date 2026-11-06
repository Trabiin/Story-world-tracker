/** EU-12: quick calculators: a character's age on a date, and travel time between two places. */
import { ageOn, formatDayNumber, fromDayNumber, midpoint } from '../dates';
import { networkFor, routeAlongFeatures } from '../features';
import { greatCircleKm } from '../globe';
import type { Id } from '../model';
import type { WorldIndex } from '../whereabouts';

export function ageText(ix: WorldIndex, characterId: Id, day: number): string {
  const c = ix.characters.get(characterId);
  if (!c) return '';
  if (!c.birth) return `${c.name} has no birth date yet.`;
  const born = ix.win(c.birth);
  const on = formatDayNumber(day);
  if (day < born.earliest) return `${c.name} is not born yet on ${on} (born ${formatDayNumber(born.earliest)}${born.latest > born.earliest ? ' or later' : ''}).`;
  const youngest = ageOn(fromDayNumber(born.latest), fromDayNumber(day));
  const oldest = ageOn(fromDayNumber(born.earliest), fromDayNumber(day));
  const age = youngest === oldest ? `${oldest}` : `${Math.max(0, youngest)} or ${oldest}`;
  if (c.death && day > midpoint(ix.win(c.death))) {
    const at = ageOn(fromDayNumber(born.earliest), fromDayNumber(midpoint(ix.win(c.death))));
    return `${c.name} died on ${formatDayNumber(midpoint(ix.win(c.death)))}, aged about ${at}. On ${on} they would be ${age}.`;
  }
  return `${c.name} is ${age} on ${on}.`;
}

export interface TravelEstimate {
  km: number;
  days: number;
  /** Drawn roads, rivers or sea lanes it follows. */
  via: string[];
  straightKm: number;
  byRoute: boolean;
}

/** How long from one place to another by a travel mode: along drawn roads or sea lanes when there are any, else straight × detour. */
export function travelEstimate(ix: WorldIndex, fromId: Id, toId: Id, modeId: Id): TravelEstimate | undefined {
  const a = ix.locationOf(fromId), b = ix.locationOf(toId);
  if (!a || !b) return undefined;
  const w = ix.world;
  const straightKm = greatCircleKm(a, b, w.settings.radiusKm);
  const speed = ix.speedOf(modeId);
  const r = routeAlongFeatures(w, a, b, networkFor(modeId));
  const byRoute = r.onNetworkKm > 0;
  const km = byRoute ? r.km : straightKm * (w.settings.defaultDetourFactor || 1.3);
  return { km, days: km / speed, via: r.via, straightKm, byRoute };
}
