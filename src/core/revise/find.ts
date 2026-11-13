/**
 * RV-3: find and replace across a scene, a book or the whole series, with whole-word and match-case
 * options. Every hit is listed with its context first; only the hits the writer keeps are replaced.
 */
import type { Id, SceneText, TextNode, World } from '../model';
import { outline } from '../story';
import { MatchOptions, TextEdit, applyEdits, blockTexts, matchRanges } from './text';

export type FindScope = { kind: 'scene'; sceneId: Id } | { kind: 'chapter'; chapterId: Id } | { kind: 'book'; bookId: Id } | { kind: 'series' };

export interface FindHit {
  /** Stable for one search: scene, block and offset. */
  key: string;
  sceneId: Id;
  block: number;
  from: number;
  to: number;
  /** The words around the hit, for the list. */
  before: string;
  match: string;
  after: string;
}

/** Scenes in reading order (books, chapters, scenes) inside a scope. */
export function scopeScenes(world: World, scope: FindScope): Id[] {
  const out: Id[] = [];
  for (const b of outline(world)) {
    if (scope.kind === 'book' && b.book.id !== scope.bookId) continue;
    for (const c of b.chapters) {
      if (scope.kind === 'chapter' && c.chapter.id !== scope.chapterId) continue;
      for (const s of c.scenes) if (scope.kind !== 'scene' || s.id === scope.sceneId) out.push(s.id);
    }
  }
  return out;
}

const CONTEXT = 40;
function around(text: string, from: number, to: number) {
  let a = Math.max(0, from - CONTEXT), b = Math.min(text.length, to + CONTEXT);
  if (a > 0) { const sp = text.indexOf(' ', a); if (sp >= 0 && sp < from) a = sp + 1; }
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > to) b = sp; }
  return { before: (a > 0 ? '…' : '') + text.slice(a, from), match: text.slice(from, to), after: text.slice(to, b) + (b < text.length ? '…' : '') };
}

/** Matches of a query in one scene's text. */
export function findInDoc(sceneId: Id, doc: TextNode | undefined, query: string, opts: MatchOptions): FindHit[] {
  const out: FindHit[] = [];
  blockTexts(doc).forEach((text, block) => {
    for (const [from, to] of matchRanges(text, query, opts)) out.push({ key: `${sceneId}:${block}:${from}`, sceneId, block, from, to, ...around(text, from, to) });
  });
  return out;
}

/** Every match in the scope, in reading order. */
export function findInWorld(world: World, query: string, opts: MatchOptions, scope: FindScope): FindHit[] {
  if (!query) return [];
  const texts = new Map(world.sceneTexts.map((t) => [t.sceneId, t]));
  return scopeScenes(world, scope).flatMap((id) => findInDoc(id, texts.get(id)?.doc, query, opts));
}

export interface TextChange { sceneId: Id; before: TextNode; after: TextNode }

/** The new text of each scene touched by the chosen replacements (to save "before" versions, then commit). */
export function planReplace(world: World, hits: { sceneId: Id; block: number; from: number; to: number; text: string }[]): TextChange[] {
  const byScene = new Map<Id, TextEdit[]>();
  for (const h of hits) byScene.set(h.sceneId, [...(byScene.get(h.sceneId) ?? []), { block: h.block, from: h.from, to: h.to, text: h.text }]);
  const out: TextChange[] = [];
  for (const [sceneId, edits] of byScene) {
    const t = world.sceneTexts.find((x) => x.sceneId === sceneId);
    if (!t) continue;
    out.push({ sceneId, before: t.doc, after: applyEdits(t.doc, dropOverlaps(edits)) });
  }
  return out;
}

/** Keep the first of any edits that overlap in the same block (a full name and a word of it). */
function dropOverlaps(edits: TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.block - b.block || a.from - b.from || b.to - a.to);
  const out: TextEdit[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && last.block === e.block && e.from < last.to) continue;
    out.push(e);
  }
  return out;
}

/** Put new text into the world (scene text records only; words are recounted). */
export function withTexts(world: World, changes: TextChange[], wordsOf: (doc: TextNode) => number, now: string): World {
  if (!changes.length) return world;
  const by = new Map(changes.map((c) => [c.sceneId, c.after]));
  return { ...world, sceneTexts: world.sceneTexts.map((t): SceneText => (by.has(t.sceneId) ? { ...t, doc: by.get(t.sceneId)!, words: wordsOf(by.get(t.sceneId)!), updatedAt: now } : t)) };
}
