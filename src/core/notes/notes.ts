/**
 * NT-1 margin comments, NT-2 the notebook, NT-3 the Inbox, NT-4 research files: the rules the
 * pages share. Notes, to-dos and research files belong to the writer, so every what-if scenario
 * sees the same ones.
 */
import type { Attachment, Id, Note, RefKind, SceneText, TextComment, TextNode, Todo, TodoRef, World } from '../model';

export const INBOX = 'Inbox';

/** "Research / Ships/" → "Research/Ships". */
export function cleanFolder(path: string | undefined): string {
  return (path ?? '').split('/').map((p) => p.trim()).filter(Boolean).join('/');
}

export interface FolderNode {
  /** Full path ("Research/Ships"). */
  path: string;
  name: string;
  /** Notes directly in this folder. */
  count: number;
  /** Notes here and in every folder below. */
  total: number;
  children: FolderNode[];
}

/** The notebook's folders as a tree, from the folders its notes use (Inbox notes are left out). */
export function folderTree(notes: Note[]): FolderNode[] {
  const root: FolderNode = { path: '', name: '', count: 0, total: 0, children: [] };
  for (const n of notes) {
    if (n.inbox) continue;
    const parts = cleanFolder(n.folder).split('/').filter(Boolean);
    let at = root;
    at.total++;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let next = at.children.find((c) => c.path === path);
      if (!next) { next = { path, name: parts[i], count: 0, total: 0, children: [] }; at.children.push(next); }
      next.total++;
      at = next;
    }
    at.count++;
  }
  const sort = (n: FolderNode) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sort); };
  sort(root);
  return root.children;
}

/** Every folder path in use, sorted (for a folder picker). */
export function folderPaths(notes: Note[]): string[] {
  const out = new Set<string>();
  for (const n of notes) {
    const parts = cleanFolder(n.folder).split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** True when the note sits in this folder or one below it. */
export const inFolder = (n: Note, path: string) => {
  const f = cleanFolder(n.folder);
  return !path || f === path || f.startsWith(path + '/');
};

/** Rename or move a folder: every note in it or below it follows. */
export function moveFolder(world: World, from: string, to: string, now: string): World {
  const a = cleanFolder(from), b = cleanFolder(to);
  if (!a || a === b) return world;
  let changed = false;
  const notes = world.notes.map((n) => {
    const f = cleanFolder(n.folder);
    if (f !== a && !f.startsWith(a + '/')) return n;
    changed = true;
    return { ...n, folder: cleanFolder(b + f.slice(a.length)), updatedAt: now };
  });
  return changed ? { ...world, notes } : world;
}

/** NT-2: the notes about a record, pinned first, newest first. */
export function notesFor(world: World, kind: RefKind, id: Id): Note[] {
  return world.notes.filter((n) => n.refs.some((r) => r.kind === kind && r.id === id)).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

/** NT-4: the research files attached to a record or a note. */
export function filesFor(world: World, kind: RefKind, id: Id): Attachment[] {
  return world.attachments.filter((a) => a.refs.some((r) => r.kind === kind && r.id === id));
}

/** NT-3: a quick capture. The first line is the title; the rest is the body. It lands in the Inbox. */
export function captureNote(text: string, refs: TodoRef[], base: Pick<Note, 'id' | 'scenarioId' | 'status' | 'createdAt' | 'updatedAt'>): Note {
  const lines = text.replace(/\r/g, '').trim().split('\n');
  const first = lines[0].trim();
  const title = first.length > 80 ? `${first.slice(0, 77).replace(/\s+\S*$/, '')}…` : first;
  const body = (first.length > 80 ? text.trim() : lines.slice(1).join('\n')).trim();
  return { ...base, title: title || 'Quick note', body, folder: '', inbox: true, refs };
}

/** NT-1: the words a margin comment is on, in document order. */
export function commentQuote(doc: TextNode | undefined, commentId: Id): string {
  const parts: string[] = [];
  let gap = false;
  const walk = (n: TextNode) => {
    if (n.type === 'text') {
      if (n.marks?.some((m) => m.type === 'comment' && m.attrs?.id === commentId)) { parts.push((gap && parts.length ? ' … ' : '') + (n.text ?? '')); gap = false; }
      else if (parts.length) gap = true;
      return;
    }
    n.content?.forEach(walk);
    if (n.type === 'paragraph' || n.type === 'heading') gap = parts.length > 0;
  };
  if (doc) walk(doc);
  return parts.join('').trim();
}

/** Put quotation marks round a passage, unless it already starts and ends with them. */
export function quoted(q: string): string {
  return /^[“"‘']/.test(q) && /[”"’']$/.test(q) ? q : `“${q}”`;
}

/** A timestamp as day/month/year (DM-1 order), in the writer's local time. */
export function dmy(iso: string | undefined, withTime = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}${withTime ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : ''}`;
}

/** NT-1: every margin comment in the world, with its scene and the words it is on. */
export function allComments(world: World): { sceneId: Id; comment: TextComment; quote: string; todo?: Todo }[] {
  const todoOf = new Map(world.todos.filter((t) => t.comment).map((t) => [t.comment!.commentId, t]));
  const out: { sceneId: Id; comment: TextComment; quote: string; todo?: Todo }[] = [];
  for (const t of world.sceneTexts) for (const c of t.comments ?? []) out.push({ sceneId: t.sceneId, comment: c, quote: commentQuote(t.doc, c.id), todo: todoOf.get(c.id) });
  return out;
}

/** NT-1: the to-do made from a comment, if any. */
export function todoForComment(world: World, commentId: Id): Todo | undefined {
  return world.todos.find((t) => t.comment?.commentId === commentId);
}

/** NT-1: one click turns a comment into a to-do about the scene that links back to the comment. */
export function commentTodo(text: SceneText, comment: TextComment, base: Pick<Todo, 'id' | 'scenarioId' | 'status' | 'createdAt' | 'updatedAt'>): Todo {
  const quote = commentQuote(text.doc, comment.id);
  const first = comment.text.trim().split('\n')[0] || 'Comment';
  return {
    ...base,
    title: first.length > 80 ? `${first.slice(0, 77)}…` : first,
    note: quote ? `On ${quoted(quote.length > 200 ? `${quote.slice(0, 197)}…` : quote)}` : '',
    kind: 'todo',
    done: false,
    refs: [{ kind: 'scene', id: text.sceneId }],
    comment: { sceneId: text.sceneId, commentId: comment.id },
  };
}

/** NT-4: what a file is, for its icon and viewer. */
export function fileKind(mime: string, name = ''): 'image' | 'pdf' | 'other' {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'other';
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
