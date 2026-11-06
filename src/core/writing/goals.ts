/**
 * WR-12 word counts and goals, WR-13 scene stages, SR-1 the series dashboard.
 *
 * Counts come from SceneText.words (kept up to date on every save). Words written per day are
 * logged in World.writingDays by the editor's save (see logWords); a day's figure is net words
 * (added − removed), so deleting and rewriting a paragraph is not counted twice.
 * Deadlines and the log use real-world dates "YYYY-MM-DD", never in-world dates.
 */
import type { Book, Id, RefKind, SceneStage, World, WritingDay } from '../model';
import { CANON } from '../model';
import { outline } from '../story/story';

/** WR-13: stages in order, with the labels the app shows. */
export const SCENE_STAGES: SceneStage[] = ['idea', 'outlined', 'first-draft', 'revised', 'final'];
export const STAGE_LABEL: Record<SceneStage, string> = { idea: 'Idea', outlined: 'Outlined', 'first-draft': 'First draft', revised: 'Revised', final: 'Final' };
/** Colours used for the stage dot in the scene tree and the stage bars on the dashboard. */
export const STAGE_COLOR: Record<SceneStage, string> = { idea: '#b8b8b8', outlined: '#8fb3d9', 'first-draft': '#e0b050', revised: '#9bc27a', final: '#3f8f5a' };

export const stageOf = (s: { stage?: SceneStage }): SceneStage => s.stage ?? 'idea';
export const stageRank = (s: SceneStage) => SCENE_STAGES.indexOf(s);

/** Local calendar day as "YYYY-MM-DD". */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → local Date at midnight (undefined if not a valid day). */
export function parseDayKey(k: string | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k ?? '');
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : undefined;
}

/** A real-world day in day/month/year order (D-3), e.g. "31/12/2026". */
export function formatDayKey(k: string | undefined): string {
  const d = parseDayKey(k);
  return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
}

/** Whole days from one day key to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const a = parseDayKey(from), b = parseDayKey(to);
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

export function addDays(k: string, n: number): string {
  const d = parseDayKey(k)!;
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/**
 * WR-12: add a change in a scene's word count to the day's log. Called by the editor's save with
 * (new words − words before). Returns the same world when nothing changes.
 */
export function logWords(world: World, delta: number, day: string = dayKey()): World {
  if (!delta || !Number.isFinite(delta)) return world;
  const list = world.writingDays ?? [];
  const i = list.findIndex((d) => d.id === day);
  const cur: WritingDay = i >= 0 ? list[i] : { id: day, scenarioId: CANON, added: 0, removed: 0 };
  const next: WritingDay = delta > 0 ? { ...cur, added: cur.added + delta } : { ...cur, removed: cur.removed - delta };
  return { ...world, writingDays: i >= 0 ? list.map((d, j) => (j === i ? next : d)) : [...list, next] };
}

export const netWords = (d: WritingDay | undefined) => (d ? d.added - d.removed : 0);

/** Net words written on one day. */
export function wordsOn(world: World, day: string = dayKey()): number {
  return netWords((world.writingDays ?? []).find((d) => d.id === day));
}

/** WR-12: days in a row (ending today, or yesterday if nothing is written yet today) on which the daily goal (or any words, without a goal) was reached. */
export function writingStreak(world: World, today: string = dayKey()): number {
  const goal = world.settings.writing?.dailyGoal || 1;
  const by = new Map((world.writingDays ?? []).map((d) => [d.id, netWords(d)]));
  let day = (by.get(today) ?? 0) >= goal ? today : addDays(today, -1);
  let n = 0;
  while ((by.get(day) ?? 0) >= goal) { n++; day = addDays(day, -1); }
  return n;
}

/** WR-12: the calendar of words per day: `weeks` whole weeks (Monday first) ending with the week of `today`. */
export function writingCalendar(world: World, weeks = 20, today: string = dayKey()): { day: string; words: number; future: boolean }[][] {
  const by = new Map((world.writingDays ?? []).map((d) => [d.id, netWords(d)]));
  const t = parseDayKey(today)!;
  const monday = addDays(today, -((t.getDay() + 6) % 7));
  const start = addDays(monday, -7 * (weeks - 1));
  const out: { day: string; words: number; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { day: string; words: number; future: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      col.push({ day, words: by.get(day) ?? 0, future: day > today });
    }
    out.push(col);
  }
  return out;
}

export interface Counts {
  scene: Map<Id, number>;
  chapter: Map<Id, number>;
  book: Map<Id, number>;
  series: number;
}

/** WR-12: words per scene, chapter, book and the whole series. */
export function wordCounts(world: World): Counts {
  const scene = new Map<Id, number>();
  for (const t of world.sceneTexts) scene.set(t.sceneId, (scene.get(t.sceneId) ?? 0) + (t.words || 0));
  const chapter = new Map<Id, number>();
  const book = new Map<Id, number>();
  let series = 0;
  for (const b of outline(world)) {
    let bw = 0;
    for (const c of b.chapters) {
      const cw = c.scenes.reduce((n, s) => n + (scene.get(s.id) ?? 0), 0);
      chapter.set(c.chapter.id, cw);
      bw += cw;
    }
    book.set(b.book.id, bw);
    series += bw;
  }
  return { scene, chapter, book, series };
}

export interface BookProgress {
  book: Book;
  words: number;
  goal?: number;
  /** 0..1 (can pass 1). */
  fraction?: number;
  deadline?: string;
  /** Days left until the deadline (0 = today, negative = passed). */
  daysLeft?: number;
  /** Words a day still needed to reach the goal by the deadline. */
  perDay?: number;
  scenes: number;
  /** WR-13: scenes at each stage. */
  stages: Record<SceneStage, number>;
  /** The stage every scene has reached (the least advanced one); undefined for a book without scenes. */
  stage?: SceneStage;
  /** EU-14: open to-dos and plot holes about the book, its chapters or its scenes. */
  todos: number;
  plotHoles: number;
}

/** WR-12, WR-13, SR-1: one book's progress. */
export function bookProgress(world: World, bookId: Id, today: string = dayKey(), counts: Counts = wordCounts(world)): BookProgress | undefined {
  const b = outline(world).find((x) => x.book.id === bookId);
  if (!b) return undefined;
  const book = b.book;
  const words = counts.book.get(bookId) ?? 0;
  const stages = Object.fromEntries(SCENE_STAGES.map((s) => [s, 0])) as Record<SceneStage, number>;
  const scenes = b.chapters.flatMap((c) => c.scenes);
  for (const s of scenes) stages[stageOf(s)]++;
  const least = scenes.length ? SCENE_STAGES.find((s) => stages[s] > 0) : undefined;
  const goal = book.wordGoal && book.wordGoal > 0 ? book.wordGoal : undefined;
  const deadline = parseDayKey(book.deadline) ? book.deadline : undefined;
  const daysLeft = deadline ? daysBetween(today, deadline) : undefined;
  const perDay = goal && daysLeft !== undefined && daysLeft >= 0 ? Math.ceil(Math.max(0, goal - words) / (daysLeft + 1)) : undefined;
  const ids = new Set<string>([`book:${bookId}`, ...b.chapters.map((c) => `chapter:${c.chapter.id}`), ...scenes.map((s) => `scene:${s.id}`)]);
  const refsBook = (refs: { kind: RefKind; id: Id }[]) => refs.some((r) => ids.has(`${r.kind}:${r.id}`));
  const open = world.todos.filter((t) => !t.done && refsBook(t.refs));
  return {
    book, words, goal, fraction: goal ? words / goal : undefined, deadline, daysLeft, perDay,
    scenes: scenes.length, stages, stage: least, todos: open.length, plotHoles: open.filter((t) => t.kind === 'plot-hole').length,
  };
}

/** SR-1: every book of the series with its progress, in reading order. */
export function seriesDashboard(world: World, today: string = dayKey()): { books: BookProgress[]; words: number; today: number; dailyGoal?: number; streak: number } {
  const counts = wordCounts(world);
  const books = outline(world).map((b) => bookProgress(world, b.book.id, today, counts)!).filter(Boolean);
  const goal = world.settings.writing?.dailyGoal;
  return { books, words: counts.series, today: wordsOn(world, today), dailyGoal: goal && goal > 0 ? goal : undefined, streak: writingStreak(world, today) };
}
