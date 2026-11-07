/**
 * NT-5 corkboard and outline, NT-6 setups and payoffs, NT-7 structure templates and the pacing
 * strip, NT-8 character arcs: the rules the Plan page shares.
 */
import type { Beat, Book, CharacterArc, Id, Scene, Setup, StructureTemplate, World } from '../model';
import { orderedScenes } from '../structure/order';

// ---------- NT-5: moving cards ----------

/** The scenes of a book, chapter by chapter, in order. */
export function bookScenes(world: World, bookId: Id): { chapterId: Id; scenes: Scene[] }[] {
  return world.chapters.filter((c) => c.bookId === bookId).sort((a, b) => a.order - b.order)
    .map((c) => ({ chapterId: c.id, scenes: world.scenes.filter((s) => s.chapterId === c.id).sort((a, b) => a.order - b.order) }));
}

/**
 * NT-5: drop a scene card into a chapter, before another card (or at the end). The scenes of the
 * chapters involved are numbered 1, 2, 3… again. Returns the same world when nothing moves.
 */
export function moveScene(world: World, sceneId: Id, toChapterId: Id, beforeSceneId?: Id, now = new Date().toISOString()): World {
  const scene = world.scenes.find((s) => s.id === sceneId);
  if (!scene || sceneId === beforeSceneId || !world.chapters.some((c) => c.id === toChapterId)) return world;
  const target = world.scenes.filter((s) => s.chapterId === toChapterId && s.id !== sceneId).sort((a, b) => a.order - b.order);
  const at = beforeSceneId ? target.findIndex((s) => s.id === beforeSceneId) : -1;
  target.splice(at < 0 ? target.length : at, 0, scene);
  const changes = new Map<Id, Partial<Scene>>();
  target.forEach((s, i) => { if (s.order !== i + 1 || s.chapterId !== toChapterId) changes.set(s.id, { order: i + 1, chapterId: toChapterId }); });
  if (scene.chapterId !== toChapterId) {
    world.scenes.filter((s) => s.chapterId === scene.chapterId && s.id !== sceneId).sort((a, b) => a.order - b.order)
      .forEach((s, i) => { if (s.order !== i + 1) changes.set(s.id, { order: i + 1 }); });
  }
  if (!changes.size) return world;
  return { ...world, scenes: world.scenes.map((s) => (changes.has(s.id) ? { ...s, ...changes.get(s.id), updatedAt: now } : s)) };
}

// ---------- NT-6: setups and payoffs ----------

export type SetupState = 'paid' | 'no-payoff' | 'payoff-first' | 'no-setup' | 'idea';

/** Where each scene comes in reading order (0 = the first scene of the first book). */
export function readIndexOf(world: World): Map<Id, number> {
  return new Map(orderedScenes(world).map((o) => [o.scene.id, o.readIndex]));
}

export function setupState(s: Setup, read: Map<Id, number>): SetupState {
  const a = s.setupSceneId !== undefined ? read.get(s.setupSceneId) : undefined;
  const b = s.payoffSceneId !== undefined ? read.get(s.payoffSceneId) : undefined;
  if (a === undefined && b === undefined) return 'idea';
  if (a === undefined) return 'no-setup';
  if (b === undefined) return 'no-payoff';
  return b < a ? 'payoff-first' : 'paid';
}

export const SETUP_STATE_LABEL: Record<SetupState, string> = {
  paid: 'Paid off', 'no-payoff': 'No payoff yet', 'payoff-first': 'Payoff comes before the setup', 'no-setup': 'Payoff without a setup scene', idea: 'Not placed yet',
};

export interface SetupWarning { key: string; rule: 'setup-no-payoff' | 'payoff-before-setup'; setupId: Id; sceneIds: Id[]; message: string }

/** NT-6, DM-8: setups with no payoff, and payoffs read before their setup. */
export function checkSetups(world: World): SetupWarning[] {
  const read = readIndexOf(world);
  const title = (id?: Id) => world.scenes.find((s) => s.id === id)?.title ?? '?';
  const out: SetupWarning[] = [];
  for (const s of world.setups) {
    const st = setupState(s, read);
    if (st === 'no-payoff') out.push({ key: `setup-no-payoff:${s.id}`, rule: 'setup-no-payoff', setupId: s.id, sceneIds: [s.setupSceneId!], message: `The ${s.kind === 'other' ? 'setup' : s.kind} “${s.title}” is planted in “${title(s.setupSceneId)}” but never paid off.` });
    if (st === 'payoff-first') out.push({ key: `payoff-before-setup:${s.id}`, rule: 'payoff-before-setup', setupId: s.id, sceneIds: [s.payoffSceneId!, s.setupSceneId!], message: `“${s.title}” pays off in “${title(s.payoffSceneId)}”, which the reader reads before its setup in “${title(s.setupSceneId)}”.` });
  }
  return out;
}

/** Setups and payoffs in a scene. */
export function setupsIn(world: World, sceneId: Id): { planted: Setup[]; paid: Setup[] } {
  return { planted: world.setups.filter((s) => s.setupSceneId === sceneId), paid: world.setups.filter((s) => s.payoffSceneId === sceneId) };
}

// ---------- NT-7: structure templates ----------

export const BUILT_IN_TEMPLATES: StructureTemplate[] = [
  {
    id: 'three-acts', name: 'Three acts', beats: [
      { name: 'Opening image', at: 0, note: 'The world and the hero before the story starts.' },
      { name: 'Inciting incident', at: 10, note: 'Something upsets the hero\'s life.' },
      { name: 'End of act one', at: 25, note: 'The hero commits; no way back.' },
      { name: 'Midpoint', at: 50, note: 'A reversal or revelation raises the stakes.' },
      { name: 'End of act two', at: 75, note: 'All seems lost.' },
      { name: 'Climax', at: 90, note: 'The final confrontation.' },
      { name: 'Resolution', at: 98, note: 'The new normal.' },
    ],
  },
  {
    id: 'seven-points', name: 'Seven points', beats: [
      { name: 'Hook', at: 0, note: 'Where the hero starts, the opposite of where they end.' },
      { name: 'First plot turn', at: 15, note: 'The conflict arrives.' },
      { name: 'First pinch', at: 35, note: 'The opposition shows its strength.' },
      { name: 'Midpoint', at: 50, note: 'The hero moves from reacting to acting.' },
      { name: 'Second pinch', at: 62, note: 'Things get worse; a loss.' },
      { name: 'Second plot turn', at: 80, note: 'The hero gets the last piece they need.' },
      { name: 'Resolution', at: 97, note: 'The climax and its outcome.' },
    ],
  },
  {
    id: 'heros-journey', name: 'Hero\'s journey', beats: [
      { name: 'Ordinary world', at: 0 }, { name: 'Call to adventure', at: 8 }, { name: 'Refusal of the call', at: 12 }, { name: 'Meeting the mentor', at: 17 },
      { name: 'Crossing the threshold', at: 25 }, { name: 'Tests, allies, enemies', at: 35 }, { name: 'Approach to the inmost cave', at: 45 }, { name: 'The ordeal', at: 52 },
      { name: 'The reward', at: 62 }, { name: 'The road back', at: 75 }, { name: 'Resurrection', at: 88 }, { name: 'Return with the elixir', at: 97 },
    ],
  },
  {
    id: 'four-parts', name: 'Four parts', beats: [
      { name: 'Setup', at: 0 }, { name: 'First plot point', at: 25 }, { name: 'Response', at: 26 }, { name: 'Midpoint', at: 50 },
      { name: 'Attack', at: 51 }, { name: 'Second plot point', at: 75 }, { name: 'Resolution', at: 76 },
    ],
  },
];

export function allTemplates(world: World): StructureTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...(world.settings.structureTemplates ?? [])];
}

/** Lay a template over a book. Beats with the same name keep the scene they were placed at. */
export function applyTemplate(book: Book, t: StructureTemplate, newId: () => string): Book {
  const old = new Map((book.beats ?? []).map((b) => [b.name.toLowerCase(), b]));
  const beats: Beat[] = t.beats.map((b) => {
    const prev = old.get(b.name.toLowerCase());
    return { id: prev?.id ?? newId(), name: b.name, at: b.at, ...(prev?.sceneId ? { sceneId: prev.sceneId } : {}), ...(b.note || prev?.note ? { note: prev?.note || b.note } : {}) };
  });
  return { ...book, structureName: t.name, beats };
}

/** Save a book's beats as one of the writer's own templates. */
export function templateFromBook(book: Book, name: string, id: string): StructureTemplate {
  return { id, name, beats: (book.beats ?? []).map((b) => ({ name: b.name, at: b.at, ...(b.note ? { note: b.note } : {}) })) };
}

export interface PacingScene { sceneId: Id; chapterId: Id; start: number; end: number; words: number }
export interface PacingBeat { beat: Beat; target: number; actual?: number; drift?: number }
export interface Pacing { byWords: boolean; scenes: PacingScene[]; chapters: { chapterId: Id; start: number; end: number }[]; beats: PacingBeat[] }

/**
 * NT-7: where each scene sits in the book, as a share of its words (or of its scenes while there is
 * little text), and where each beat falls against where the template puts it. Positions are 0–100.
 */
export function pacing(world: World, bookId: Id): Pacing {
  const groups = bookScenes(world, bookId);
  const words = new Map(world.sceneTexts.map((t) => [t.sceneId, t.words]));
  const all = groups.flatMap((g) => g.scenes.map((s) => ({ s, chapterId: g.chapterId, w: words.get(s.id) ?? 0 })));
  const total = all.reduce((n, x) => n + x.w, 0);
  const withText = all.filter((x) => x.w > 0).length;
  const byWords = total > 0 && withText >= all.length / 2;
  let at = 0;
  const scenes: PacingScene[] = all.map((x) => {
    const size = byWords ? (x.w / total) * 100 : 100 / all.length;
    const p = { sceneId: x.s.id, chapterId: x.chapterId, start: at, end: at + size, words: x.w };
    at += size;
    return p;
  });
  const chapters = groups.filter((g) => g.scenes.length).map((g) => {
    const mine = scenes.filter((p) => p.chapterId === g.chapterId);
    return { chapterId: g.chapterId, start: mine[0].start, end: mine[mine.length - 1].end };
  });
  const pos = new Map(scenes.map((p) => [p.sceneId, p.start]));
  const book = world.books.find((b) => b.id === bookId);
  const beats = (book?.beats ?? []).map((beat) => {
    const actual = beat.sceneId !== undefined ? pos.get(beat.sceneId) : undefined;
    return { beat, target: beat.at, actual, drift: actual === undefined ? undefined : actual - beat.at };
  });
  return { byWords, scenes, chapters, beats };
}

// ---------- NT-8: character arcs ----------

/** The arcs in a book, main characters first. */
export function arcsInBook(world: World, bookId: Id): CharacterArc[] {
  const rank = { main: 0, secondary: 1, minor: 2 } as const;
  const ch = new Map(world.characters.map((c) => [c.id, c]));
  return world.arcs.filter((a) => a.bookId === bookId).sort((a, b) => (rank[ch.get(a.characterId)?.importance ?? 'minor'] - rank[ch.get(b.characterId)?.importance ?? 'minor']) || (ch.get(a.characterId)?.name ?? '').localeCompare(ch.get(b.characterId)?.name ?? ''));
}

/** An arc's turning scenes in reading order. */
export function arcTurnsInOrder(world: World, arc: CharacterArc): CharacterArc['turns'] {
  const read = readIndexOf(world);
  return [...arc.turns].sort((a, b) => (read.get(a.sceneId) ?? 1e9) - (read.get(b.sceneId) ?? 1e9));
}

/** Main characters in a book (POV or cast of its scenes) who have no arc there yet. */
export function charactersWithoutArc(world: World, bookId: Id): Id[] {
  const scenes = bookScenes(world, bookId).flatMap((g) => g.scenes);
  const chapters = new Map(world.chapters.map((c) => [c.id, c]));
  const inBook = new Set<Id>();
  for (const s of scenes) {
    for (const id of s.characterIds) inBook.add(id);
    const pov = s.povCharacterId ?? chapters.get(s.chapterId)?.povCharacterId;
    if (pov) inBook.add(pov);
  }
  const has = new Set(world.arcs.filter((a) => a.bookId === bookId).map((a) => a.characterId));
  return world.characters.filter((c) => c.importance === 'main' && !c.archived && inBook.has(c.id) && !has.has(c.id)).map((c) => c.id);
}

/** Book of a scene. */
export function bookOfScene(world: World, sceneId: Id): Id | undefined {
  const s = world.scenes.find((x) => x.id === sceneId);
  return s && world.chapters.find((c) => c.id === s.chapterId)?.bookId;
}

/** Scene choices for a book in reading order, labelled "Chapter: Scene". */
export function sceneChoices(world: World, bookId?: Id): { id: Id; label: string }[] {
  const chapterTitle = new Map(world.chapters.map((c) => [c.id, c.title]));
  return orderedScenes(world).filter((o) => !bookId || bookOfScene(world, o.scene.id) === bookId).map((o) => ({ id: o.scene.id, label: `${chapterTitle.get(o.chapterId) ?? '?'}: ${o.scene.title}` }));
}
