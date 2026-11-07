/** VW-8: one search box over characters, places, events, scenes, notes and the manuscripts. */
import type { Id, RefKind, World } from '../model';
import { docParagraphs } from '../writing/doc';

export interface SearchHit {
  kind: RefKind;
  id: Id;
  title: string;
  /** What kind of thing, for the result line ("Character", "Scene in Chapter 2"…). */
  sub: string;
  /** Where the words were found, when not in the name. */
  snippet?: string;
  /** For manuscript hits: the paragraph. */
  paraIndex?: number;
  /** WR-1: found in the scene's text (opens the writing page, not the scene's details). */
  inText?: boolean;
  score: number;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** A few words either side of the first term found. */
function snippetOf(text: string, terms: string[]): string | undefined {
  const t = norm(text);
  let at = -1;
  for (const w of terms) { const i = t.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return undefined;
  const start = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 40)) + 1);
  const end = Math.min(text.length, at + 80);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

/** How well the names match: exact, starts with, a word starts with, contains. */
function nameScore(names: string[], q: string, terms: string[]): number {
  let best = 0;
  for (const n0 of names) {
    const n = norm(n0);
    if (!n) continue;
    if (n === q) best = Math.max(best, 100);
    else if (n.startsWith(q)) best = Math.max(best, 80);
    else if (terms.every((w) => n.split(/[^a-z0-9]+/).some((part) => part.startsWith(w)))) best = Math.max(best, 60);
    else if (terms.every((w) => n.includes(w))) best = Math.max(best, 40);
  }
  return best;
}

export function globalSearch(world: World, query: string, limit = 200): SearchHit[] {
  const q = norm(query.trim()).replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  const terms = q.split(' ');
  const hits: SearchHit[] = [];
  const place = (id?: Id) => (id ? world.places.find((p) => p.id === id)?.name : undefined);
  const chapter = (id: Id) => world.chapters.find((c) => c.id === id)?.title;
  const who = (s: { kind: string; id: Id }) => (s.kind === 'character' ? world.characters : world.groups).find((x) => x.id === s.id)?.name ?? '?';
  const consider = (kind: RefKind, id: Id, title: string, sub: string, names: string[], texts: string[], weight = 0) => {
    const ns = nameScore(names, q, terms);
    const all = norm([...names, ...texts].join(' \n '));
    if (!terms.every((w) => all.includes(w))) return;
    const inText = ns ? undefined : texts.map((t) => snippetOf(t, terms)).find(Boolean);
    hits.push({ kind, id, title, sub, snippet: inText, score: (ns || 20) + weight });
  };
  for (const c of world.characters) consider('character', c.id, c.name, `Character${c.archived ? ' · archived' : ''}`, [c.name, ...c.aliases], [c.description, c.notes, c.tags.join(' '), ...(c.attributes ?? []).map((a) => `${a.key} ${a.value}`), ...(c.plans ?? []).map((p) => p.note), ...(c.images ?? []).map((i) => i.caption)], 5);
  for (const p of world.places) if (!p.isPlaceholder) consider('place', p.id, p.name, `Place · ${p.kind}${p.parentId ? ` in ${place(p.parentId)}` : ''}`, [p.name, ...p.aliases], [p.notes, ...(p.images ?? []).map((i) => i.caption)], 4);
  for (const g of world.groups) consider('group', g.id, g.name, 'Group', [g.name], [g.description], 3);
  for (const e of world.events) consider('event', e.id, e.name, `Event${e.placeId ? ` at ${place(e.placeId)}` : ''}`, [e.name], [e.description], 3);
  for (const s of world.secrets) consider('secret', s.id, s.title, 'Secret', [s.title], [s.description, ...s.knowers.map((k) => k.how)], 2);
  for (const r of world.regions) {
    const layer = world.regionLayers.find((l) => l.id === r.layerId);
    consider('region', r.id, r.name, layer ? `Region · ${layer.name}` : 'Region', [r.name], [r.entry], 3);
  }
  for (const t of world.threads) consider('thread', t.id, t.name, 'Plot thread', [t.name], [t.description], 2);
  for (const b of world.books) consider('book', b.id, b.title, 'Book', [b.title], [b.notes], 2);
  for (const c of world.chapters) consider('chapter', c.id, c.title, 'Chapter', [c.title], [c.notes], 2);
  for (const s of world.scenes) consider('scene', s.id, s.title, `Scene in ${chapter(s.chapterId) ?? '?'}`, [s.title], [s.summary], 2);
  for (const s of world.stays) consider('stay', s.id, `${who(s.subject)} at ${place(s.placeId) ?? '?'}`, 'Stay', [], [s.purpose, s.notes]);
  for (const j of world.journeys) consider('journey', j.id, `${who(j.subject)}: ${place(j.originId) ?? '?'} → ${place(j.destinationId) ?? '?'}`, 'Journey', [], [j.purpose, j.notes, ...(j.incidents ?? []).map((i) => `${i.title} ${i.note}`)]);
  for (const r of world.relationships) {
    const a = world.characters.find((c) => c.id === r.aId)?.name ?? '?', b = world.characters.find((c) => c.id === r.bId)?.name ?? '?';
    if (r.notes || r.label) consider('relationship', r.id, `${a} and ${b}`, `Relationship · ${r.kind}`, [], [r.label ?? '', r.notes]);
  }
  // NT-2, NT-4: the notebook and research files.
  for (const n of world.notes) consider('note', n.id, n.title || 'Untitled note', n.inbox ? 'Note · Inbox' : `Note${n.folder ? ` · ${n.folder}` : ''}`, [n.title], [n.body], 2);
  for (const a of world.attachments) consider('file', a.id, a.name, 'Research file', [a.name], [a.caption], 1);
  // NT-1: margin comments in scene text.
  for (const t of world.sceneTexts) {
    const s = world.scenes.find((x) => x.id === t.sceneId);
    if (!s) continue;
    for (const c of t.comments ?? []) {
      const tx = norm(c.text);
      if (terms.every((w) => tx.includes(w))) hits.push({ kind: 'scene', id: s.id, title: s.title, sub: `Comment · ${chapter(s.chapterId) ?? '?'}`, snippet: snippetOf(c.text, terms), inText: true, score: 11 });
    }
  }
  // Manuscript text: one hit per paragraph, at most 25 per manuscript.
  for (const m of world.manuscripts) {
    let n = 0;
    m.paragraphs.forEach((p, i) => {
      if (n >= 25) return;
      const t = norm(p.text);
      if (!terms.every((w) => t.includes(w))) return;
      n++;
      hits.push({ kind: 'manuscript', id: m.id, title: m.name, sub: 'Manuscript', snippet: snippetOf(p.text, terms), paraIndex: i, score: 10 });
    });
  }
  // Scene text (WR-1): one hit per paragraph, at most 10 per scene.
  for (const t of world.sceneTexts) {
    const s = world.scenes.find((x) => x.id === t.sceneId);
    if (!s) continue;
    let n = 0;
    docParagraphs(t.doc).forEach((p, i) => {
      if (n >= 10) return;
      const tx = norm(p.text);
      if (!terms.every((w) => tx.includes(w))) return;
      n++;
      hits.push({ kind: 'scene', id: s.id, title: s.title, sub: `Text · ${chapter(s.chapterId) ?? '?'}`, snippet: snippetOf(p.text, terms), paraIndex: i, inText: true, score: 12 });
    });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
