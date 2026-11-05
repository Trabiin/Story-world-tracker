import { Id, Subject, World } from '../../core';
import { sortByName } from '../util';

/** Places in physical-nesting order, indented (DM-2). */
export function placeOptions(world: World): { id: Id; label: string }[] {
  const children = new Map<string | undefined, typeof world.places>();
  for (const p of world.places) {
    const key = p.parentId && world.places.some((q) => q.id === p.parentId) ? p.parentId : undefined;
    children.set(key, [...(children.get(key) ?? []), p]);
  }
  const out: { id: Id; label: string }[] = [];
  const seen = new Set<Id>();
  const walk = (parent: string | undefined, depth: number) => {
    for (const p of sortByName(children.get(parent) ?? [])) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ id: p.id, label: `${'   '.repeat(depth)}${p.name}` });
      walk(p.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

export function PlaceSelect({ world, value, onChange, allowNone, exclude }: { world: World; value: Id | undefined; onChange: (id: Id | undefined) => void; allowNone?: string; exclude?: Id }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{allowNone ?? 'Choose a place…'}</option>
      {placeOptions(world)
        .filter((o) => o.id !== exclude)
        .map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
    </select>
  );
}

export function SubjectSelect({ world, value, onChange }: { world: World; value: Subject | undefined; onChange: (s: Subject) => void }) {
  const v = value ? `${value.kind}:${value.id}` : '';
  return (
    <select
      value={v}
      onChange={(e) => {
        const [kind, ...rest] = e.target.value.split(':');
        if (kind) onChange({ kind: kind as Subject['kind'], id: rest.join(':') });
      }}
    >
      <option value="">Who?</option>
      <optgroup label="Characters">
        {sortByName(world.characters.filter((c) => !c.archived)).map((c) => (
          <option key={c.id} value={`character:${c.id}`}>{c.name}</option>
        ))}
      </optgroup>
      {world.groups.length > 0 && (
        <optgroup label="Groups">
          {sortByName(world.groups).map((g) => (
            <option key={g.id} value={`group:${g.id}`}>{g.name} (group)</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
