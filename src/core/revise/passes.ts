/** RV-5: revision passes over a book, each with a checklist of chapters. */
import type { Id, RevisionPass, World } from '../model';
import { outline } from '../story';

export function passesOf(world: World, bookId: Id): RevisionPass[] {
  return world.passes.filter((p) => p.bookId === bookId).sort((a, b) => a.order - b.order);
}

/** Chapters done in a pass out of the book's chapters (chapters deleted since are not counted). */
export function passProgress(world: World, pass: RevisionPass): { done: number; total: number } {
  const chapters = outline(world).find((b) => b.book.id === pass.bookId)?.chapters ?? [];
  const ids = new Set(chapters.map((c) => c.chapter.id));
  return { done: pass.done.filter((id) => ids.has(id)).length, total: chapters.length };
}

/** Tick a chapter in a pass on or off. */
export function toggleChapter(pass: RevisionPass, chapterId: Id): RevisionPass {
  return { ...pass, done: pass.done.includes(chapterId) ? pass.done.filter((x) => x !== chapterId) : [...pass.done, chapterId] };
}

/** Suggested passes for a first revision. */
export const PASS_IDEAS: { name: string; note: string }[] = [
  { name: 'Story and structure', note: 'Does every scene earn its place? Setups paid off, stakes clear, pacing.' },
  { name: 'Timeline and places', note: 'Dates, travel times, who is where: clear the Warnings page for this book.' },
  { name: 'Characters', note: 'Voices, motives and arcs; names spelt the same everywhere.' },
  { name: 'Dialogue', note: 'Cut small talk, check tags and beats, read it aloud.' },
  { name: 'Line edit', note: 'Style marks on the Write page: repetition, long sentences, filter words, adverbs.' },
];
