import { describe, expect, it } from 'vitest';
import {
  CANON, Warning, WorldIndex, addDays, applyFilter, backlinksFor, blocksToDoc, bookProgress, daysBetween, docWords, formatDayKey, linkTargets, logWords, moonOn, nameCard,
  nameIndex, nameMatches, readerKnowledge, readerPointBefore, sceneContext, seriesDashboard, wordCounts, wordsOn, writingCalendar, writingStreak,
} from '../src/core';
import { loadWorldFile, worldToBytes } from '../src/storage';
import { d, stay, world } from './fixtures';

const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };

/** Two chapters; Kaela and Bren in Varn Castle in May 1042, Oren in Thornwick. Chapter 2 is the first to mention Oren. */
function story() {
  const w = world();
  w.characters.push({ ...base, id: 'oren', name: 'Oren Vale', aliases: ['the Clerk'], description: '', notes: '', tags: [], color: '#999', icon: 'person', importance: 'secondary', archived: false, birth: d(1010, 2, 1) });
  w.characters[0].birth = d(1020, 6, 1);
  w.stays = [stay('kaela', 'castle', d(1042, 5, 1)), stay('bren', 'hall', d(1042, 5, 1)), stay('oren', 'thornwick', d(1042, 4, 1))];
  w.relationships = [{ ...base, id: 'r1', kind: 'sibling', aId: 'kaela', bId: 'bren', label: '', notes: '' }];
  w.books = [{ ...base, id: 'b1', title: 'Salt', order: 1, notes: '', wordGoal: 1000, deadline: '2026-12-31' }, { ...base, id: 'b2', title: 'Ash', order: 2, notes: '' }];
  w.chapters = [
    { ...base, id: 'c1', bookId: 'b1', title: 'One', order: 1, notes: '', povCharacterId: 'kaela' },
    { ...base, id: 'c2', bookId: 'b1', title: 'Two', order: 2, notes: '' },
    { ...base, id: 'c3', bookId: 'b2', title: 'Three', order: 1, notes: '' },
  ];
  w.scenes = [
    { ...base, id: 's1', chapterId: 'c1', title: 'Hall', order: 1, characterIds: ['bren'], summary: '', start: d(1042, 5, 3), stage: 'revised' },
    { ...base, id: 's2', chapterId: 'c2', title: 'Clerk', order: 1, characterIds: ['oren'], summary: '', start: d(1042, 5, 9), stage: 'first-draft' },
    { ...base, id: 's3', chapterId: 'c3', title: 'Later', order: 1, characterIds: [], summary: '' },
  ];
  const text = (id: string, sceneId: string, s: string) => { const doc = blocksToDoc([{ kind: 'p', runs: [{ text: s }] }]); return { ...base, id, sceneId, doc, words: docWords(doc) }; };
  w.sceneTexts = [text('t1', 's1', 'Kaela waited in Varn Castle for Bren.'), text('t2', 's2', 'Oren counted carts.'), text('t3', 's3', 'One two three four five')];
  return w;
}

describe('WR-9 story sidebar', () => {
  it('shows date, place, season, moon, who is present and where everyone else is', () => {
    const w = story();
    const ctx = sceneContext(new WorldIndex(w), 's1')!;
    expect(ctx.dateLabel).toBe('3 May 1042');
    expect(ctx.placeId).toBe('castle');
    expect(ctx.placeDerived).toBe(true);
    expect(ctx.season).toBe('Spring');
    expect(ctx.moon?.label).toMatch(/moon|crescent|quarter|gibbous/);
    expect(ctx.present.map((p) => [p.id, p.pov, p.where, p.elsewhere])).toEqual([
      ['kaela', true, 'at Varn Castle', false],
      ['bren', false, 'at Great Hall', false], // inside the castle: not elsewhere
    ]);
    expect(ctx.elsewhere).toEqual([{ placeId: 'thornwick', label: 'Thornwick', characterIds: ['oren'], travelling: false }]);
  });

  it('flags someone present whose stay is elsewhere, and picks the warnings about the scene', () => {
    const w = story();
    w.scenes[1].characterIds = ['oren', 'bren'];
    w.scenes[1].placeId = 'thornwick';
    const ix = new WorldIndex(w);
    const day = ix.win(d(1042, 5, 9)).earliest;
    const warnings: Warning[] = [
      { key: 'a', rule: 'gap', severity: 'warning', characterId: 'bren', message: 'Bren gap', refs: [], day },
      { key: 'b', rule: 'gap', severity: 'warning', characterId: 'bren', message: 'Bren much later', refs: [], day: day + 400 },
      { key: 'c', rule: 'scene-place', severity: 'warning', message: 'Scene place', refs: [{ kind: 'scene', id: 's2' }] },
      { key: 'd', rule: 'gap', severity: 'warning', characterId: 'kaela', message: 'Kaela, not present', refs: [], day },
    ];
    const ctx = sceneContext(ix, 's2', warnings)!;
    expect(ctx.present.find((p) => p.id === 'bren')).toMatchObject({ elsewhere: true, where: 'at Great Hall' });
    expect(ctx.warnings.map((x) => x.key)).toEqual(['a', 'c']);
  });

  it('works for an undated scene', () => {
    const ctx = sceneContext(new WorldIndex(story()), 's3')!;
    expect(ctx.day).toBeUndefined();
    expect(ctx.elsewhere).toEqual([]);
  });

  it('names the moon from its age', () => {
    const w = story();
    w.settings.moon = { periodDays: 30, newMoonDay: 0, name: 'Selu' };
    expect(moonOn(w, 0)).toMatchObject({ label: 'New moon', phase: 'new', name: 'Selu' });
    expect(moonOn(w, 15)).toMatchObject({ label: 'Full moon', phase: 'full' });
    expect(moonOn(w, 7.5).label).toBe('First quarter');
  });
});

describe('WR-10 name cards', () => {
  it('finds full names, aliases and unique first names, longest first', () => {
    const idx = nameIndex(story());
    const text = 'Oren met the Clerk at Varn Castle, then Kaela’s brother left Varn.';
    const hits = nameMatches(text, idx).map((m) => [text.slice(m.from, m.to), m.ref.kind, m.ref.id]);
    expect(hits).toEqual([
      ['Oren', 'character', 'oren'],
      ['the Clerk', 'character', 'oren'],
      ['Varn Castle', 'place', 'castle'],
      ['Kaela', 'character', 'kaela'],
      ['Varn', 'place', 'varn'],
    ]);
  });

  it('shows age, whereabouts, relations and what the reader knows on the scene date', () => {
    const w = story();
    const ix = new WorldIndex(w);
    const day = ix.win(d(1042, 5, 9)).earliest;
    // Scene s2 is in chapter 2: the reader has read chapter 1.
    expect(readerPointBefore(w, 's2')).toBe(0);
    expect(readerPointBefore(w, 's1')).toBe(-1);
    const rk = readerKnowledge(w, readerPointBefore(w, 's2'));
    const kaela = nameCard(ix, 'character', 'kaela', day, rk)!;
    expect(kaela.lines).toEqual(expect.arrayContaining([{ label: 'Age', text: '21' }, { label: 'Where', text: 'At Varn Castle' }, { label: 'Relations', text: 'sibling of Bren' }]));
    expect(kaela.reader[0]).toBe('First met in Salt · One.');
    const oren = nameCard(ix, 'character', 'oren', day, rk)!;
    expect(oren.reader).toEqual(['New to the reader: this chapter is the first to mention it.']);
    const later = nameCard(ix, 'character', 'oren', day, readerKnowledge(w, -1))!;
    expect(later.reader[0]).toMatch(/has not met it yet \(first mentioned in Salt · Two\)/);
    const castle = nameCard(ix, 'place', 'castle', day)!;
    expect(castle.subtitle).toBe('city · in Varn');
    expect(castle.lines.find((l) => l.label === 'Here then')?.text).toBe('Kaela, Bren');
    expect(nameCard(ix, 'character', 'ghost', day)?.missing).toBe(true);
  });
});

describe('WR-11 inline links', () => {
  it('offers records by name, alias and word start', () => {
    const w = story();
    expect(linkTargets(w, 'or').map((t) => t.id)).toEqual(['oren', 'thornwick']); // starts with it, then contains it
    expect(linkTargets(w, 'clerk').map((t) => [t.kind, t.id])).toEqual([['character', 'oren'], ['scene', 's2']]);
    expect(linkTargets(w, 'varn').slice(0, 2).map((t) => t.id)).toEqual(['varn', 'castle']);
    expect(linkTargets(w, 'zzz')).toEqual([]);
  });

  it('links inside the text are backlinks of the record, realms included', () => {
    const w = story();
    w.regions = [{ ...base, id: 'kv', layerId: 'pol', name: 'Kingdom of Varn', color: '#c00', versions: [], overlords: [], ties: [], entry: '' }];
    w.sceneTexts[1] = { ...w.sceneTexts[1], doc: blocksToDoc([{ kind: 'p', runs: [{ text: 'Oren', link: { kind: 'character', id: 'oren' } }, { text: ' served ' }, { text: 'the kingdom', link: { kind: 'region', id: 'kv' } }] }]) };
    expect(backlinksFor(w, 'region', 'kv').map((b) => b.label)).toEqual(['“the kingdom”']);
    expect(backlinksFor(w, 'character', 'oren').some((b) => b.kind === 'text')).toBe(true);
  });
});

describe('WR-12 word counts and goals', () => {
  it('counts scenes, chapters, books and the series', () => {
    const c = wordCounts(story());
    expect(c.scene.get('s1')).toBe(7);
    expect(c.chapter.get('c2')).toBe(3);
    expect(c.book.get('b1')).toBe(10);
    expect(c.series).toBe(15);
  });

  it('logs words written per day, net of deletions', () => {
    let w = story();
    w = logWords(w, 120, '2026-11-05');
    w = logWords(w, 300, '2026-11-06');
    w = logWords(w, -50, '2026-11-06');
    expect(logWords(w, 0, '2026-11-06')).toBe(w);
    expect(w.writingDays.find((x) => x.id === '2026-11-06')).toMatchObject({ added: 300, removed: 50 });
    expect(wordsOn(w, '2026-11-06')).toBe(250);
    expect(writingStreak(w, '2026-11-06')).toBe(2);
    w.settings.writing = { dailyGoal: 200 };
    expect(writingStreak(w, '2026-11-06')).toBe(1);
    expect(writingStreak(w, '2026-11-07')).toBe(1); // nothing yet today: yesterday still counts
    const cal = writingCalendar(w, 2, '2026-11-06'); // a Friday
    expect(cal).toHaveLength(2);
    expect(cal[1][0].day).toBe('2026-11-02'); // Monday on top
    expect(cal[1][4]).toMatchObject({ day: '2026-11-06', words: 250, future: false });
    expect(cal[1][6].future).toBe(true);
  });

  it('works out deadlines in real-world days, day/month/year', () => {
    expect(formatDayKey('2026-12-31')).toBe('31/12/2026');
    expect(daysBetween('2026-11-06', '2026-12-31')).toBe(55);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    const p = bookProgress(story(), 'b1', '2026-12-30')!;
    expect(p).toMatchObject({ words: 10, goal: 1000, daysLeft: 1, perDay: 495, scenes: 2, stage: 'first-draft' });
    expect(p.fraction).toBeCloseTo(0.01);
  });

  it('keeps the log and the new fields in the world file', async () => {
    const w = logWords(story(), 42, '2026-11-06');
    const back = (await loadWorldFile(await worldToBytes(w))).world;
    expect(back.writingDays).toEqual(w.writingDays);
    expect(back.books[0]).toMatchObject({ wordGoal: 1000, deadline: '2026-12-31' });
    expect(back.scenes[0].stage).toBe('revised');
  });
});

describe('WR-13 scene stages and SR-1 series dashboard', () => {
  it('filters every view to scenes at one stage', () => {
    const f = applyFilter(story(), { drafts: 'show', stage: 'first-draft' });
    expect(f.scenes.map((s) => s.id)).toEqual(['s2']);
    expect(f.chapters.map((c) => c.id)).toEqual(['c2']);
    expect(f.books.map((b) => b.id)).toEqual(['b1']);
    expect(f.characters).toHaveLength(3); // the cast is not narrowed
    expect(applyFilter(story(), { drafts: 'show', stage: 'idea' }).scenes.map((s) => s.id)).toEqual(['s3']); // no stage = idea
  });

  it('lists every book with stage, words, goal, deadline and open to-dos', () => {
    const w = story();
    w.todos = [
      { ...base, id: 'td1', title: 'Fix', note: '', kind: 'plot-hole', done: false, refs: [{ kind: 'scene', id: 's2' }] },
      { ...base, id: 'td2', title: 'Done', note: '', kind: 'todo', done: true, refs: [{ kind: 'book', id: 'b1' }] },
      { ...base, id: 'td3', title: 'Other', note: '', kind: 'todo', done: false, refs: [{ kind: 'chapter', id: 'c3' }] },
    ];
    const dash = seriesDashboard(logWords(w, 80, '2026-11-06'), '2026-11-06');
    expect(dash.books.map((b) => [b.book.id, b.words, b.stage, b.todos, b.plotHoles])).toEqual([['b1', 10, 'first-draft', 1, 1], ['b2', 5, 'idea', 1, 0]]);
    expect(dash.books[0].stages).toMatchObject({ revised: 1, 'first-draft': 1, idea: 0 });
    expect(dash).toMatchObject({ words: 15, today: 80, streak: 1 });
  });
});
