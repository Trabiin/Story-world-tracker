import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TEMPLATES, applyTemplate, arcTurnsInOrder, arcsInBook, bookScenes, charactersWithoutArc, checkSetups, checkWorld, claudeFolderFiles, dataModelGuide,
  deleteRecord, moveScene, pacing, readIndexOf, sceneChoices, setupState, templateFromBook, SCENARIO_COLLECTIONS, World,
} from '../src/core';
import { loadWorldFile, worldToBytes } from '../src/storage';
import { sampleWorld } from '../src/ui/sample';

const W = () => sampleWorld();
const scene = (w: World, title: string) => w.scenes.find((s) => s.title === title)!;
let n = 0;
const nid = () => `id-${++n}`;

describe('NT-5 corkboard: moving cards', () => {
  it('moves a scene before another in the same chapter and renumbers', () => {
    const w = W();
    const book = w.books[0];
    const ch3 = bookScenes(w, book.id)[2];
    const [a, b, c] = ch3.scenes;
    const out = moveScene(w, c.id, ch3.chapterId, a.id);
    expect(bookScenes(out, book.id)[2].scenes.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(bookScenes(out, book.id)[2].scenes.map((s) => s.order)).toEqual([1, 2, 3]);
  });
  it('moves a scene into another chapter (at the end) and closes the gap it left', () => {
    const w = W();
    const g = bookScenes(w, w.books[0].id);
    const out = moveScene(w, g[0].scenes[0].id, g[1].chapterId);
    const h = bookScenes(out, w.books[0].id);
    expect(h[0].scenes.map((s) => s.order)).toEqual([1]);
    expect(h[1].scenes.map((s) => s.id)).toEqual([...g[1].scenes.map((s) => s.id), g[0].scenes[0].id]);
    expect(moveScene(w, g[0].scenes[0].id, g[0].chapterId, g[0].scenes[0].id)).toBe(w);
  });
});

describe('NT-6 setups and payoffs', () => {
  it('a paid-off setup is fine; one with no payoff is a warning', () => {
    const w = W();
    const read = readIndexOf(w);
    expect(w.setups.map((s) => setupState(s, read))).toEqual(['paid', 'no-payoff']);
    const ws = checkWorld(w).filter((x) => x.rule === 'setup-no-payoff');
    expect(ws).toHaveLength(1);
    expect(ws[0].message).toContain('Bram');
    expect(ws[0].refs[0]).toEqual({ kind: 'scene', id: scene(w, 'The keep at night').id });
  });
  it('a payoff read before its setup is a warning', () => {
    const w = W();
    const s = { ...w.setups[0], setupSceneId: scene(w, 'The heir’s letter').id, payoffSceneId: scene(w, 'The regent’s errand').id };
    const out = checkSetups({ ...w, setups: [s] });
    expect(out.map((x) => x.rule)).toEqual(['payoff-before-setup']);
  });
  it('deleting a scene takes it out of setups, arc turns and beats', () => {
    const w = W();
    const heir = scene(w, 'The heir’s letter');
    const out = deleteRecord(w, 'scenes', heir.id, { kind: 'remove' });
    expect(out.setups[0].payoffSceneId).toBeUndefined();
    expect(out.arcs[0].turns.map((t) => t.sceneId)).not.toContain(heir.id);
    expect(out.books[0].beats!.find((b) => b.name === 'Climax')!.sceneId).toBeUndefined();
    expect(out.arcs).toHaveLength(1);
  });
  it('setups and arcs can differ inside a what-if scenario', () => {
    expect(SCENARIO_COLLECTIONS).toEqual(expect.arrayContaining(['setups', 'arcs']));
  });
});

describe('NT-7 structure templates and pacing', () => {
  it('lays a template over a book, keeping scenes of beats with the same name', () => {
    const w = W();
    const book = w.books[0];
    expect(book.structureName).toBe('Three acts');
    const mid = book.beats!.find((b) => b.name === 'Midpoint')!;
    const seven = applyTemplate(book, BUILT_IN_TEMPLATES.find((t) => t.id === 'seven-points')!, nid);
    expect(seven.structureName).toBe('Seven points');
    expect(seven.beats!.find((b) => b.name === 'Midpoint')!.sceneId).toBe(mid.sceneId);
    expect(seven.beats!.find((b) => b.name === 'Hook')!.sceneId).toBeUndefined();
    const own = templateFromBook(book, 'Mine', 'tpl');
    expect(own.beats.map((b) => b.name)).toEqual(book.beats!.map((b) => b.name));
  });
  it('places scenes along the book by words and shows how far each beat drifts', () => {
    const w = W();
    const pc = pacing(w, w.books[0].id);
    expect(pc.byWords).toBe(true);
    expect(pc.scenes[0].start).toBe(0);
    expect(Math.round(pc.scenes[pc.scenes.length - 1].end)).toBe(100);
    const opening = pc.beats.find((b) => b.beat.name === 'Opening image')!;
    expect(opening.actual).toBe(0);
    expect(opening.drift).toBe(0);
    const climax = pc.beats.find((b) => b.beat.name === 'Climax')!;
    expect(climax.actual).toBeGreaterThan(90);
    expect(pc.beats.find((b) => b.beat.name === 'Resolution')!.actual).toBeUndefined();
    expect(pc.chapters).toHaveLength(3);
  });
  it('falls back to one share per scene while there is little text', () => {
    const w = { ...W(), sceneTexts: [] };
    const pc = pacing(w, w.books[0].id);
    expect(pc.byWords).toBe(false);
    expect(pc.scenes[1].start).toBeCloseTo(100 / pc.scenes.length);
  });
});

describe('NT-8 character arcs', () => {
  it('arcs per book, turns in reading order, main characters still without an arc', () => {
    const w = W();
    const book = w.books[0];
    const arcs = arcsInBook(w, book.id);
    expect(arcs.map((a) => w.characters.find((c) => c.id === a.characterId)!.name)).toEqual(['Kaela Venn']);
    const reversed = { ...arcs[0], turns: [...arcs[0].turns].reverse() };
    expect(arcTurnsInOrder(w, reversed).map((t) => t.note)).toEqual(['Walks the last stretch rather than turn back', 'Breaks the seal']);
    const missing = charactersWithoutArc(w, book.id).map((id) => w.characters.find((c) => c.id === id)!.name);
    expect(missing).not.toContain('Kaela Venn');
    expect(sceneChoices(w, book.id)[0].label).toContain(':');
  });
  it('deleting the character deletes the arc', () => {
    const w = W();
    const out = deleteRecord(w, 'characters', w.arcs[0].characterId, { kind: 'remove' });
    expect(out.arcs).toHaveLength(0);
  });
});

describe('saved, and known to Claude (AI-10)', () => {
  it('setups, arcs and beats survive the world file', async () => {
    const w = W();
    const back = (await loadWorldFile(await worldToBytes(w))).world;
    expect(back.setups).toEqual(w.setups);
    expect(back.arcs).toEqual(w.arcs);
    expect(back.books[0].beats).toEqual(w.books[0].beats);
  });
  it('the guide and the folder describe setups, structure and arcs', () => {
    const g = dataModelGuide();
    expect(g).toContain('## setups');
    expect(g).toContain('## arcs');
    expect(g).toContain('`beats`');
    const w = W();
    const files = claudeFolderFiles(w, checkWorld(w));
    const at = (p: string) => files.find((f) => f.path === p)!.text;
    expect(at('story/setups.md')).toContain('No payoff yet');
    expect(at('story/structure.md')).toContain('**Midpoint** at 50%');
    expect(at('story/arcs.md')).toContain('Breaks the seal');
  });
});
