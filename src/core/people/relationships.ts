/** CH-4 relationships between characters, and EU-11 family trees drawn from them. */
import { toWindow } from '../dates';
import { DIRECTED_RELATIONS, Id, RelationKind, Relationship, World } from '../model';

export const RELATION_KINDS: { id: RelationKind; label: string; forward: string; back: string }[] = [
  { id: 'parent', label: 'Parent and child', forward: 'parent of', back: 'child of' },
  { id: 'spouse', label: 'Married', forward: 'spouse of', back: 'spouse of' },
  { id: 'sibling', label: 'Siblings', forward: 'sibling of', back: 'sibling of' },
  { id: 'lover', label: 'Lovers', forward: 'lover of', back: 'lover of' },
  { id: 'friend', label: 'Friends', forward: 'friend of', back: 'friend of' },
  { id: 'ally', label: 'Allies', forward: 'ally of', back: 'ally of' },
  { id: 'rival', label: 'Rivals', forward: 'rival of', back: 'rival of' },
  { id: 'enemy', label: 'Enemies', forward: 'enemy of', back: 'enemy of' },
  { id: 'mentor', label: 'Mentor and student', forward: 'mentor of', back: 'student of' },
  { id: 'liege', label: 'Liege and sworn', forward: 'liege of', back: 'sworn to' },
  { id: 'other', label: 'Other', forward: 'related to', back: 'related to' },
];

export interface RelationView {
  rel: Relationship;
  otherId: Id;
  /** "parent of", "student of", or the label for 'other'. */
  label: string;
  /** On the given day: before it starts, during, or after it ended. */
  when: 'before' | 'now' | 'after';
}

export function relationLabel(r: Relationship, from: Id): string {
  const k = RELATION_KINDS.find((x) => x.id === r.kind)!;
  const base = r.kind === 'other' && r.label ? r.label : DIRECTED_RELATIONS.includes(r.kind) && r.bId === from ? k.back : k.forward;
  return r.label && r.kind !== 'other' ? `${base} (${r.label})` : base;
}

/** CH-4: every relationship of a character, with its state on a day. */
export function relationsOf(world: World, characterId: Id, day: number): RelationView[] {
  const h = world.settings.hemisphereForSeasons;
  const out: RelationView[] = [];
  for (const r of world.relationships) {
    if (r.aId !== characterId && r.bId !== characterId) continue;
    const when = r.start && toWindow(r.start, h).earliest > day ? 'before' : r.end && toWindow(r.end, h).latest < day ? 'after' : 'now';
    out.push({ rel: r, otherId: r.aId === characterId ? r.bId : r.aId, label: relationLabel(r, characterId), when });
  }
  const order = RELATION_KINDS.map((k) => k.id);
  return out.sort((a, b) => order.indexOf(a.rel.kind) - order.indexOf(b.rel.kind));
}

export interface TreeNode { id: Id; gen: number; x: number }
export interface FamilyTree {
  nodes: TreeNode[];
  couples: [Id, Id][];
  /** Children grouped by the parents they share. */
  families: { parents: Id[]; children: Id[] }[];
  siblings: [Id, Id][];
}

const FAMILY: RelationKind[] = ['parent', 'spouse', 'sibling'];

/**
 * EU-11: lay out the family around a character from parent, spouse and sibling links.
 * Generations are rows (parents above); x is a slot number within the drawing.
 */
export function familyTree(world: World, rootId: Id, maxPeople = 80): FamilyTree {
  const rels = world.relationships.filter((r) => FAMILY.includes(r.kind) && r.aId !== r.bId);
  const parentsOf = new Map<Id, Set<Id>>(), childrenOf = new Map<Id, Set<Id>>(), spousesOf = new Map<Id, Set<Id>>(), sibsOf = new Map<Id, Set<Id>>();
  const add = (m: Map<Id, Set<Id>>, k: Id, v: Id) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
  for (const r of rels) {
    if (r.kind === 'parent') { add(parentsOf, r.bId, r.aId); add(childrenOf, r.aId, r.bId); }
    else if (r.kind === 'spouse') { add(spousesOf, r.aId, r.bId); add(spousesOf, r.bId, r.aId); }
    else { add(sibsOf, r.aId, r.bId); add(sibsOf, r.bId, r.aId); }
  }
  // Breadth-first from the root: parents a row up, children a row down, spouses and siblings alongside.
  const gen = new Map<Id, number>([[rootId, 0]]);
  const order: Id[] = [rootId];
  for (let i = 0; i < order.length && order.length < maxPeople; i++) {
    const id = order[i], g = gen.get(id)!;
    const visit = (ids: Set<Id> | undefined, dg: number) => {
      for (const o of ids ?? []) if (!gen.has(o) && order.length < maxPeople) { gen.set(o, g + dg); order.push(o); }
    };
    visit(parentsOf.get(id), -1);
    visit(spousesOf.get(id), 0);
    visit(sibsOf.get(id), 0);
    visit(childrenOf.get(id), 1);
  }
  const rows = new Map<number, Id[]>();
  for (const id of order) (rows.get(gen.get(id)!) ?? rows.set(gen.get(id)!, []).get(gen.get(id)!)!).push(id);
  const gens = [...rows.keys()].sort((a, b) => a - b);
  const pos = new Map<Id, number>();
  const place = () => {
    for (const g of gens) rows.get(g)!.forEach((id, i) => pos.set(id, i - (rows.get(g)!.length - 1) / 2));
  };
  const keepCouplesTogether = (row: Id[]) => {
    const out: Id[] = [];
    for (const id of row) {
      if (out.includes(id)) continue;
      out.push(id);
      for (const s of spousesOf.get(id) ?? []) if (row.includes(s) && !out.includes(s)) out.push(s);
    }
    return out;
  };
  const sortBy = (g: number, key: (id: Id) => number | undefined) => {
    const row = rows.get(g)!;
    const k = new Map(row.map((id) => [id, key(id) ?? pos.get(id)!]));
    rows.set(g, keepCouplesTogether([...row].sort((a, b) => k.get(a)! - k.get(b)!)));
    place();
  };
  const mean = (ids: Set<Id> | undefined) => {
    const xs = [...(ids ?? [])].filter((x) => pos.has(x)).map((x) => pos.get(x)!);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
  };
  place();
  for (let pass = 0; pass < 3; pass++) {
    for (const g of gens.slice(1)) sortBy(g, (id) => mean(parentsOf.get(id)));
    for (const g of [...gens].reverse().slice(1)) sortBy(g, (id) => mean(childrenOf.get(id)));
  }
  for (const g of gens.slice(1)) sortBy(g, (id) => mean(parentsOf.get(id)));
  // Spread rows to whole slots, centred on the widest one.
  const nodes: TreeNode[] = [];
  for (const g of gens) rows.get(g)!.forEach((id) => nodes.push({ id, gen: g, x: pos.get(id)! }));
  const inTree = new Set(order);
  const couples: [Id, Id][] = [];
  const siblings: [Id, Id][] = [];
  for (const r of rels) {
    if (!inTree.has(r.aId) || !inTree.has(r.bId)) continue;
    if (r.kind === 'spouse') couples.push([r.aId, r.bId]);
    if (r.kind === 'sibling' && !sameParents(parentsOf, r.aId, r.bId)) siblings.push([r.aId, r.bId]);
  }
  const fam = new Map<string, { parents: Id[]; children: Id[] }>();
  for (const id of order) {
    const ps = [...(parentsOf.get(id) ?? [])].filter((p) => inTree.has(p)).sort();
    if (!ps.length) continue;
    const k = ps.join('+');
    (fam.get(k) ?? fam.set(k, { parents: ps, children: [] }).get(k)!).children.push(id);
  }
  return { nodes, couples, families: [...fam.values()], siblings };
}

function sameParents(parentsOf: Map<Id, Set<Id>>, a: Id, b: Id): boolean {
  const pa = parentsOf.get(a), pb = parentsOf.get(b);
  return !!pa && !!pb && pa.size > 0 && [...pa].some((p) => pb.has(p));
}
