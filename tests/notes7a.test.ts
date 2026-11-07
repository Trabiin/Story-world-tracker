import { describe, expect, it } from 'vitest';
import {
  CANON, applyProposal, captureNote, checkWorld, claudeFolderFiles, commentQuote, commentTodo, dataModelGuide, deleteRecord, folderPaths, folderTree, globalSearch,
  inFolder, moveFolder, notesFor, filesFor, scenarioView, undoAllDirect, World, allComments, todoForComment,
} from '../src/core';
import { fileKeyOf, getFile, loadWorldFile, makeSnapshot, putFile, restoreSnapshot, worldToBytes } from '../src/storage';
import { sampleWorld } from '../src/ui/sample';

const base = () => ({ id: 'x', scenarioId: CANON, status: 'canon' as const, createdAt: '2026-11-07T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z' });
const W = () => sampleWorld();

describe('NT-1 margin comments', () => {
  it('a comment knows the words it is on, and becomes a to-do that links back to it', () => {
    const w = W();
    const t = w.sceneTexts.find((x) => x.comments?.some((c) => !c.resolved))!;
    const c = t.comments!.find((x) => !x.resolved)!;
    expect(commentQuote(t.doc, c.id)).toBe('“Then you wait,” the regent said.');
    // The sample already turned it into a to-do.
    const todo = todoForComment(w, c.id)!;
    expect(todo.comment).toEqual({ sceneId: t.sceneId, commentId: c.id });
    expect(todo.refs).toEqual([{ kind: 'scene', id: t.sceneId }]);
    expect(todo.note).toContain('Then you wait');
    const fresh = commentTodo(t, { ...c, text: 'First line\nmore' }, base());
    expect(fresh.title).toBe('First line');
  });
  it('lists every comment with its scene, words and to-do; resolved ones are marked', () => {
    const list = allComments(W());
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.comment.resolved)!.quote).toBe('toll-keeper');
    expect(list.find((x) => !x.comment.resolved)!.todo).toBeTruthy();
  });
  it('search finds comments; the Claude folder lists them', () => {
    const w = W();
    expect(globalSearch(w, 'abrupt').some((h) => h.sub.startsWith('Comment') && h.inText)).toBe(true);
    const md = claudeFolderFiles(w, checkWorld(w)).find((f) => f.path === 'story/comments.md')!.text;
    expect(md).toContain('Too abrupt?');
    expect(md).toContain('(resolved)');
    expect(md).toContain('[to-do');
  });
});

describe('NT-2 notebook', () => {
  it('folders form a tree with counts; Inbox notes stay out of it', () => {
    const w = W();
    const tree = folderTree(w.notes);
    const research = tree.find((f) => f.name === 'Research')!;
    expect(research.total).toBe(2);
    expect(research.children.map((c) => c.name)).toEqual(['Salt trade', 'Ships']);
    expect(tree.map((f) => f.name)).toEqual(['Characters', 'Ideas', 'Research']);
    expect(folderPaths(w.notes)).toContain('Research/Ships');
    expect(w.notes.filter((n) => inFolder(n, 'Research')).length).toBe(2);
  });
  it('renaming a folder moves the notes in it and below it', () => {
    const w = moveFolder(W(), 'Research', 'Background/Research', 'now');
    expect(folderPaths(w.notes)).toEqual(expect.arrayContaining(['Background/Research/Salt trade', 'Background/Research/Ships']));
    expect(w.notes.find((n) => n.title === 'Kaela’s voice')!.folder).toBe('Characters');
  });
  it('notes show on the pages of the records they link; deleting the record only unlinks', () => {
    const w = W();
    const kaela = w.characters.find((c) => c.name === 'Kaela Venn')!;
    expect(notesFor(w, 'character', kaela.id).map((n) => n.title)).toEqual(['Kaela’s voice']);
    const after = deleteRecord(w, 'characters', kaela.id, { kind: 'remove' });
    const n = after.notes.find((x) => x.title === 'Kaela’s voice')!;
    expect(n).toBeTruthy();
    expect(n.refs).toEqual([]);
  });
  it('notes are shared by every scenario and found by search', () => {
    const w = W();
    const sc = w.scenarios[0];
    if (sc) expect(scenarioView(w, sc.id).notes).toBe(w.notes);
    expect(globalSearch(w, 'rakers dawn')[0]).toMatchObject({ kind: 'note', title: 'How salt pans work' });
  });
});

describe('NT-3 quick capture', () => {
  it('the first line is the title, the rest the body; it lands in the Inbox', () => {
    const n = captureNote('Name for the inn\nThe Salted Eel?', [{ kind: 'place', id: 'p1' }], base());
    expect(n).toMatchObject({ title: 'Name for the inn', body: 'The Salted Eel?', inbox: true, folder: '', refs: [{ kind: 'place', id: 'p1' }] });
    const long = captureNote('a'.repeat(30) + ' ' + 'b'.repeat(80), [], base());
    expect(long.title.length).toBeLessThanOrEqual(80);
    expect(long.body).toContain('bbbb');
  });
});

describe('NT-4 research files', () => {
  it('files are stored once by content, attached to notes and records, and saved with the world', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 test');
    const key = await putFile(bytes);
    expect(key).toBe(await fileKeyOf(bytes));
    expect(await putFile(bytes.slice())).toBe(key);
    const w: World = { ...W() };
    w.attachments = [...w.attachments, { ...base(), id: 'att-1', name: 'test.pdf', mime: 'application/pdf', size: bytes.length, fileKey: key, caption: '', refs: [{ kind: 'character', id: w.characters[0].id }] }];
    expect(filesFor(w, 'character', w.characters[0].id).map((a) => a.name)).toEqual(['test.pdf']);
    const thornwick = w.places.find((p) => p.name === 'Thornwick')!;
    expect(filesFor(w, 'place', thornwick.id).map((a) => a.name)).toEqual(['Thornwick sketch.svg']);
    const snap = await makeSnapshot(w, 'test');
    expect(snap.terrainRefs).toContain(key);
    const back = await loadWorldFile(await worldToBytes(w, [snap]));
    expect(back.world.attachments.map((a) => a.name)).toContain('test.pdf');
    expect(back.world.notes.length).toBe(w.notes.length);
    expect(Array.from(getFile(key)!)).toEqual(Array.from(bytes));
    // A version from before the file was removed brings the file back, bytes and all.
    const removed = { ...w, attachments: w.attachments.filter((a) => a.id !== 'att-1') };
    const restored = await restoreSnapshot(snap, removed);
    expect(restored.attachments.some((a) => a.id === 'att-1')).toBe(true);
  });
  it('the sample PDF is a well-formed PDF', () => {
    const a = W().attachments.find((x) => x.mime === 'application/pdf')!;
    const text = new TextDecoder().decode(getFile(a.fileKey)!);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    expect(text).toContain('Salt pans of the southern coast');
  });
});

describe('AI-10 notes in the data model and the Claude folder', () => {
  it('the guide describes notes; research files are read only', () => {
    const g = dataModelGuide();
    expect(g).toContain('## notes');
    expect(g).toContain('`folder`');
    expect(g).toContain('attachments');
    expect(dataModelGuide('notes')).toContain('`title` (text) **required**');
  });
  it('the folder has a page per note in its folder, the Inbox, and the research file list', () => {
    const w = W();
    const files = claudeFolderFiles(w, checkWorld(w));
    expect(files.some((f) => f.path === 'notes/Research/Salt trade/How salt pans work.md')).toBe(true);
    expect(files.some((f) => f.path.startsWith('notes/Inbox/'))).toBe(true);
    const list = files.find((f) => f.path === 'research/files.md')!.text;
    expect(list).toContain('Salt pans of the southern coast.pdf');
    expect(list).toContain('research/files/');
    expect(files.find((f) => f.path === 'CLAUDE.md')!.text).toContain('`notes/`');
  });
  it('Claude can propose a note linked to a record; a link to a missing record is refused', () => {
    const w = W();
    const kaela = w.characters.find((c) => c.name === 'Kaela Venn')!;
    const ok = applyProposal(w, { title: 'note', changes: [{ op: 'create', collection: 'notes', record: { id: 'new:n', title: 'Kaela’s fears', folder: 'Characters', refs: [{ kind: 'character', id: kaela.id }] } }] }, 'direct', { newId: () => 'n1', now: () => 'now' });
    if ('errors' in ok) throw new Error(ok.errors.join('\n'));
    expect(notesFor(ok.world, 'character', kaela.id).map((n) => n.title)).toContain('Kaela’s fears');
    expect(undoAllDirect(ok.world).world.notes.length).toBe(w.notes.length);
    const bad = applyProposal(w, { title: 'bad', changes: [{ op: 'create', collection: 'notes', record: { id: 'new:n', title: 'x', refs: [{ kind: 'character', id: 'nobody' }] } }] }, 'direct', { newId: () => 'n2', now: () => 'now' });
    expect('errors' in bad && bad.errors.join()).toContain('does not exist');
  });
});
