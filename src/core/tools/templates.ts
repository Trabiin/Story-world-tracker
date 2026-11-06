/** EU-3: start a character from a template ("soldier of the Guard"), and copy stays and journeys. */
import type { Character, CharacterTemplate, Id, Journey, Membership, Stay, World } from '../model';

type Base = { id: Id; scenarioId: Id; status: 'draft' | 'canon'; createdAt: string; updatedAt: string };

export function templateFromCharacter(world: World, c: Character, name: string, id: Id): CharacterTemplate {
  const groupIds = [...new Set(world.memberships.filter((m) => m.characterId === c.id).map((m) => m.groupId))];
  return { id, name, tags: [...c.tags], importance: c.importance, color: c.color, icon: c.icon, description: c.description, attributes: (c.attributes ?? []).filter((a) => !a.start && !a.end).map((a) => ({ key: a.key, value: a.value })), groupIds };
}

/** A new character from a template, and memberships in its groups (open-ended, from the start). */
export function characterFromTemplate(t: CharacterTemplate, name: string, base: Base, newId: () => Id): { character: Character; memberships: Membership[] } {
  const character: Character = {
    ...base, name, aliases: [], description: t.description, notes: '', tags: [...t.tags], color: t.color, icon: t.icon, importance: t.importance, archived: false,
    attributes: t.attributes.length ? t.attributes.map((a) => ({ id: newId(), key: a.key as never, value: a.value })) : undefined,
  };
  const memberships = t.groupIds.map((groupId) => ({ ...base, id: newId(), groupId, characterId: character.id }));
  return { character, memberships };
}

/** A copy of a stay or journey, without its id or dates' anchors kept by reference. */
export function duplicateEntry<T extends Stay | Journey>(r: T): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const { id, createdAt, updatedAt, ...rest } = r;
  void id; void createdAt; void updatedAt;
  return JSON.parse(JSON.stringify(rest));
}
