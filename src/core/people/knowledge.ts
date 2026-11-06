/** CH-8 (optional): which character knows which secret or event, and from when. */
import { toWindow } from '../dates';
import type { Id, Secret, World } from '../model';

export interface Knowing { secret: Secret; from?: number; how: string; knows: boolean }

/** The secrets a character knows on a day, and the ones they learn later. */
export function knowledgeOf(world: World, characterId: Id, day: number): Knowing[] {
  const h = world.settings.hemisphereForSeasons;
  const out: Knowing[] = [];
  for (const s of world.secrets) {
    for (const k of s.knowers) {
      if (k.characterId !== characterId) continue;
      const from = k.from ? toWindow(k.from, h).earliest : undefined;
      out.push({ secret: s, from, how: k.how, knows: from === undefined || from <= day });
    }
  }
  return out.sort((a, b) => (a.from ?? -Infinity) - (b.from ?? -Infinity));
}

/** Who knows a secret on a day. */
export function knowersOn(world: World, s: Secret, day: number): Id[] {
  const h = world.settings.hemisphereForSeasons;
  return s.knowers.filter((k) => !k.from || toWindow(k.from, h).earliest <= day).map((k) => k.characterId);
}
