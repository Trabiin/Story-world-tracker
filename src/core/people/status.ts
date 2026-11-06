/** CH-7: a character's status at a moment: alive, dead, missing, or whereabouts unknown. */
import { midpoint } from '../dates';
import { Id, STATUS_MISSING } from '../model';
import { attributesOn } from '../story';
import { WorldIndex, whereIs } from '../whereabouts';

export type CharacterStatus = 'not-born' | 'alive' | 'dead' | 'missing' | 'unknown';

export const STATUS_LABEL: Record<CharacterStatus, string> = {
  'not-born': 'Not born yet',
  alive: 'Alive',
  dead: 'Dead',
  missing: 'Missing',
  unknown: 'Whereabouts unknown',
};

export function characterStatus(ix: WorldIndex, id: Id, day: number): { status: CharacterStatus; placeId?: Id; travelling?: boolean } {
  const c = ix.characters.get(id);
  if (c?.birth && day < midpoint(ix.win(c.birth))) return { status: 'not-born' };
  if (c?.death && day > midpoint(ix.win(c.death))) return { status: 'dead' };
  const missing = (attributesOn(ix, id, day).status ?? '').toLowerCase().split(', ').includes(STATUS_MISSING);
  const w = whereIs(ix, id, day);
  if (missing) return { status: 'missing', placeId: w.kind === 'stay' ? w.placeId : undefined };
  if (w.kind === 'stay') return ix.isPlaceholder(w.placeId) ? { status: 'unknown' } : { status: 'alive', placeId: w.placeId };
  if (w.kind === 'journey') return { status: 'alive', placeId: w.toId, travelling: true };
  return { status: 'unknown' };
}
