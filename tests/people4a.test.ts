import { describe, expect, it } from 'vitest';
import {
  CANON, Relationship, WorldEvent, WorldIndex, ageText, anchorChoices, characterStatus, checkPeople, checkWorld, compareTimelines, describeRelative, familyTree,
  findMeetings, knowledgeOf, moonPhases, occurrences, parseRelativeDate, relationsOf, resolveRelativeDates, seasonBands, spoilerView, toDayNumber, toWindow, travelEstimate,
} from '../src/core';
import { bytesToWorld, worldToBytes } from '../src/storage';
import { d, journey, place, stay, world } from './fixtures';

const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };
const day = (y: number, m: number, dd: number) => toDayNumber({ year: y, month: m, day: dd });
const ev = (id: string, name: string, start = d(1042, 5, 3), extra: Partial<WorldEvent> = {}): WorldEvent => ({ ...base, id, name, kind: 'battle', characterIds: [], description: '', start, ...extra });
const rel = (aId: string, bId: string, kind: Relationship['kind'], extra: Partial<Relationship> = {}): Relationship => ({ ...base, id: `${aId}-${kind}-${bId}`, aId, bId, kind, notes: '', ...extra });
const person = (id: string, name: string) => ({ ...world().characters[0], id, name });

describe('relative dates (TL-4)', () => {
  it('reads "three days after the battle" and follows the battle when it moves', () => {
    const w = world();
    w.events = [ev('battle', 'Battle of Varn')];
    const r = parseRelativeDate('three days after the Battle of Varn', anchorChoices(w))!;
    expect(r).toEqual({ kind: 'event', id: 'battle', days: 3 });
    expect(parseRelativeDate('2 weeks before battle of varn', anchorChoices(w))!.days).toBe(-14);
    expect(parseRelativeDate('the day after the Battle of Varn', anchorChoices(w))!.days).toBe(1);
    expect(parseRelativeDate('on the Battle of Varn', anchorChoices(w))!.days).toBe(0);
    expect(parseRelativeDate('three days after the Siege', anchorChoices(w))).toBeNull();
    w.stays = [stay('kaela', 'varn', { ...d(1000, 1, 1), rel: r })];
    let out = resolveRelativeDates(w);
    expect(toWindow(out.stays[0].arrival).earliest).toBe(day(1042, 5, 6));
    expect(describeRelative(out, r)).toBe('3 days after Battle of Varn');
    // move the battle: the stay follows
    out = resolveRelativeDates({ ...out, events: [ev('battle', 'Battle of Varn', d(1042, 6, 10))] });
    expect(toWindow(out.stays[0].arrival).earliest).toBe(day(1042, 6, 13));
    // nothing to change: same object back
    expect(resolveRelativeDates(out)).toBe(out);
  });

  it('chains through events and hangs on chapters ("before chapter 2")', () => {
    const w = world();
    w.books = [{ ...base, id: 'b1', title: 'Book', order: 1, notes: '' }];
    w.chapters = [{ ...base, id: 'c1', bookId: 'b1', title: 'Arrival', order: 1, notes: '' }, { ...base, id: 'c2', bookId: 'b1', title: 'The Fall', order: 2, notes: '' }];
    w.scenes = [{ ...base, id: 'sc', chapterId: 'c2', title: 'Gates', order: 1, start: d(1042, 9, 1), characterIds: [], summary: '' }];
    w.events = [ev('a', 'Coronation', d(1042, 1, 1)), ev('b', 'Feast', { ...d(1, 1, 1), rel: { kind: 'event', id: 'a', days: 7 } })];
    const before = parseRelativeDate('before chapter 2', anchorChoices(w))!;
    expect(before).toEqual({ kind: 'chapter', id: 'c2', days: -1 });
    expect(parseRelativeDate('a week before The Fall', anchorChoices(w))!.days).toBe(-7);
    w.stays = [stay('kaela', 'varn', { ...d(1, 1, 1), rel: before }), stay('bren', 'varn', { ...d(1, 1, 1), rel: { kind: 'event', id: 'b', days: 1 } })];
    const out = resolveRelativeDates(w);
    expect(toWindow(out.stays[0].arrival).earliest).toBe(day(1042, 8, 31));
    expect(toWindow(out.stays[1].arrival).earliest).toBe(day(1042, 1, 9)); // coronation + 7 + 1
  });
});

describe('world events and the sky (TL-5, TL-6)', () => {
  it('repeats yearly holidays and lists events in a range', () => {
    const w = world();
    w.events = [ev('mid', 'Midsummer', d(1040, 6, 21), { kind: 'festival', yearly: true }), ev('b', 'Battle', d(1042, 5, 3))];
    const occ = occurrences(w, day(1041, 1, 1), day(1042, 12, 31));
    expect(occ.map((o) => [o.event.id, o.from])).toEqual([['mid', day(1041, 6, 21)], ['b', day(1042, 5, 3)], ['mid', day(1042, 6, 21)]]);
  });

  it('calendar seasons flip in the south; local seasons follow latitude (RC-10)', () => {
    const y = [day(1042, 1, 1), day(1042, 12, 31)] as const;
    const north = seasonBands(y[0], y[1], { hemisphere: 'north' });
    const south = seasonBands(y[0], y[1], { hemisphere: 'south' });
    const at = (bands: ReturnType<typeof seasonBands>, n: number) => bands.find((b) => b.from <= n && n <= b.to)?.season;
    expect(at(north, day(1042, 7, 10))).toBe('summer');
    expect(at(south, day(1042, 7, 10))).toBe('winter');
    const arctic = seasonBands(y[0], y[1], { hemisphere: 'north', lat: 66 });
    const mild = seasonBands(y[0], y[1], { hemisphere: 'north', lat: 40 });
    const len = (bands: ReturnType<typeof seasonBands>, s: string) => bands.filter((b) => b.season === s).reduce((n, b) => n + Math.min(b.to, y[1]) - Math.max(b.from, y[0]) + 1, 0);
    expect(len(arctic, 'winter')).toBeGreaterThan(len(mild, 'winter') + 60);
    expect(at(arctic, day(1042, 1, 20))).toBe('winter');
    expect(at(seasonBands(y[0], y[1], { hemisphere: 'south', lat: -50 }), day(1042, 7, 20))).toBe('winter');
  });

  it('moon phases follow the cycle', () => {
    const ph = moonPhases(day(2000, 1, 1), day(2000, 2, 10), { periodDays: 29.530589, newMoonDay: day(2000, 1, 6) });
    expect(ph.filter((p) => p.phase === 'new').map((p) => p.day)).toEqual([day(2000, 1, 6), day(2000, 2, 5)]);
    expect(ph.find((p) => p.phase === 'full')!.day).toBe(day(2000, 1, 21));
  });
});

describe('characters (CH-4, CH-7, CH-8, EU-11)', () => {
  it('relationships have a direction and dates', () => {
    const w = world();
    w.relationships = [rel('kaela', 'bren', 'mentor', { start: d(1040, 1, 1), end: d(1041, 1, 1) })];
    expect(relationsOf(w, 'bren', day(1040, 6, 1))[0]).toMatchObject({ otherId: 'kaela', label: 'student of', when: 'now' });
    expect(relationsOf(w, 'kaela', day(1042, 1, 1))[0]).toMatchObject({ label: 'mentor of', when: 'after' });
  });

  it('draws three generations with couples side by side', () => {
    const w = world();
    w.characters.push(person('mum', 'Mum'), person('dad', 'Dad'), person('kid', 'Kid'), person('gran', 'Gran'));
    w.relationships = [rel('mum', 'dad', 'spouse'), rel('mum', 'kaela', 'parent'), rel('dad', 'kaela', 'parent'), rel('mum', 'bren', 'parent'), rel('kaela', 'kid', 'parent'), rel('gran', 'mum', 'parent')];
    const t = familyTree(w, 'kaela');
    const gen = Object.fromEntries(t.nodes.map((n) => [n.id, n.gen]));
    expect(gen).toEqual({ kaela: 0, mum: -1, dad: -1, bren: 0, kid: 1, gran: -2 });
    expect(t.couples).toEqual([['mum', 'dad']]);
    const x = Object.fromEntries(t.nodes.map((n) => [n.id, n.x]));
    expect(Math.abs(x.mum - x.dad)).toBe(1);
    expect(t.families.find((f) => f.parents.join() === 'dad,mum')!.children).toEqual(['kaela']);
    expect(t.families.find((f) => f.parents.join() === 'mum')!.children).toEqual(['bren']);
  });

  it('status: alive, missing, unknown, dead', () => {
    const w = world();
    w.characters[0] = { ...w.characters[0], death: d(1043, 1, 1), attributes: [{ id: 'a', key: 'status', value: 'missing', start: d(1042, 6, 1), end: d(1042, 7, 1) }] };
    w.stays = [stay('kaela', 'varn', d(1042, 1, 1), d(1042, 12, 1)), stay('bren', 'nowhere', d(1042, 1, 1))];
    const ix = new WorldIndex(w);
    expect(characterStatus(ix, 'kaela', day(1042, 3, 1))).toMatchObject({ status: 'alive', placeId: 'varn' });
    expect(characterStatus(ix, 'kaela', day(1042, 6, 15)).status).toBe('missing');
    expect(characterStatus(ix, 'kaela', day(1043, 2, 1)).status).toBe('dead');
    expect(characterStatus(ix, 'bren', day(1042, 3, 1)).status).toBe('unknown');
  });

  it('knowledge from a date, and learning of an event before it happens is flagged', () => {
    const w = world();
    w.events = [ev('battle', 'Battle of Varn', d(1042, 5, 3))];
    w.secrets = [{ ...base, id: 'sec', title: 'Who won the battle', description: '', eventId: 'battle', knowers: [{ id: 'k1', characterId: 'kaela', from: d(1042, 5, 10), how: 'a letter' }, { id: 'k2', characterId: 'bren', from: d(1042, 4, 1), how: '' }] }];
    expect(knowledgeOf(w, 'kaela', day(1042, 5, 9))[0].knows).toBe(false);
    expect(knowledgeOf(w, 'kaela', day(1042, 5, 10))[0].knows).toBe(true);
    expect(checkPeople(w).map((i) => i.key)).toEqual(['knowledge-order:sec:bren']);
  });
});

describe('checks (CC-4, CC-5, CC-6)', () => {
  it('flags activity after death and before birth', () => {
    const w = world();
    w.characters[0] = { ...w.characters[0], birth: d(1020, 1, 1), death: d(1042, 1, 1) };
    w.stays = [stay('kaela', 'varn', d(1041, 1, 1), d(1042, 3, 1)), stay('kaela', 'thornwick', d(1042, 6, 1)), stay('kaela', 'varn', d(1010, 1, 1), d(1011, 1, 1))];
    w.events = [ev('b', 'Battle', d(1043, 1, 1), { characterIds: ['kaela'] })];
    const keys = checkWorld(w).filter((x) => x.rule === 'life-span').map((x) => x.message);
    expect(keys).toHaveLength(3); // the Thornwick stay, the stay before birth, the battle; the stay running past death is fine
    expect(keys.some((m) => m.includes('before being born'))).toBe(true);
    expect(keys.some((m) => m.includes('takes part in Battle'))).toBe(true);
  });

  it('flags a visit to a place before it is founded, including places inside it', () => {
    const w = world();
    w.places = w.places.map((p) => (p.id === 'castle' ? { ...p, start: d(1050, 1, 1) } : p));
    w.stays = [stay('kaela', 'hall', d(1042, 1, 1), d(1042, 2, 1)), stay('bren', 'hall', d(1051, 1, 1), d(1051, 2, 1))];
    const issues = checkWorld(w).filter((x) => x.rule === 'place-existence');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Varn Castle only exists from');
  });

  it('flags a scene at one place while the character stays at another', () => {
    const w = world();
    w.books = [{ ...base, id: 'b1', title: 'Book', order: 1, notes: '' }];
    w.chapters = [{ ...base, id: 'c1', bookId: 'b1', title: 'One', order: 1, notes: '', povCharacterId: 'kaela' }];
    w.scenes = [{ ...base, id: 's1', chapterId: 'c1', title: 'Council', order: 1, start: d(1042, 3, 1), characterIds: ['bren'], summary: '', placeId: 'castle' }];
    w.stays = [stay('kaela', 'hall', d(1042, 1, 1), d(1042, 6, 1)), stay('bren', 'thornwick', d(1042, 1, 1), d(1042, 6, 1))];
    const issues = checkWorld(w).filter((x) => x.rule === 'scene-place');
    expect(issues.map((i) => i.key)).toEqual(['scene-place:s1:bren']); // Kaela is in the hall, inside the castle
  });
});

describe('meetings, comparison and calculators (VW-6, EU-13, EU-12)', () => {
  it('finds who was in the same place at the same time, nesting aware', () => {
    const w = world();
    w.stays = [stay('kaela', 'hall', d(1042, 1, 1), d(1042, 1, 20)), stay('bren', 'varn', d(1042, 1, 10), d(1042, 2, 1)), stay('bren', 'nowhere', d(1042, 2, 2))];
    const m = findMeetings(new WorldIndex(w), ['kaela', 'bren']);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ placeId: 'varn', from: day(1042, 1, 10), to: day(1042, 1, 20) });
  });

  it('puts two timelines side by side, merging unchanged cells', () => {
    const w = world();
    w.stays = [stay('kaela', 'varn', d(1042, 1, 1), d(1042, 1, 10)), stay('kaela', 'thornwick', d(1042, 1, 14), d(1042, 2, 1)), stay('bren', 'thornwick', d(1042, 1, 1), d(1042, 2, 1))];
    w.journeys = [journey('kaela', 'varn', 'thornwick', d(1042, 1, 11), d(1042, 1, 13))];
    const rows = compareTimelines(new WorldIndex(w), ['kaela', 'bren']);
    expect(rows.map((r) => r.cells[0].text)).toEqual(['In Varn', 'Travelling Varn → Thornwick', 'In Thornwick', 'Whereabouts unknown']);
    expect(rows[2].together).toEqual([[0, 1]]);
    expect(rows[1].cells[1].same).toBe(true);
  });

  it('works out ages and travel times', () => {
    const w = world();
    w.characters[0] = { ...w.characters[0], birth: d(1020, 5, 1) };
    const ix = new WorldIndex(w);
    expect(ageText(ix, 'kaela', day(1042, 5, 1))).toBe('Kaela is 22 on 01/05/1042.');
    expect(ageText(ix, 'kaela', day(1019, 1, 1))).toContain('not born yet');
    const t = travelEstimate(ix, 'varn', 'thornwick', 'horse')!;
    expect(Math.round(t.straightKm)).toBe(143);
    expect(t.days).toBeCloseTo((t.straightKm * 1.3) / 50, 5);
  });
});

describe('saving and the reader\'s view', () => {
  it('keeps events, relationships and secrets in the world file', async () => {
    const w = world();
    w.events = [ev('battle', 'Battle of Varn')];
    w.relationships = [rel('kaela', 'bren', 'sibling')];
    w.secrets = [{ ...base, id: 'sec', title: 'S', description: '', knowers: [] }];
    const back = await bytesToWorld(await worldToBytes(w));
    expect(back.events[0].name).toBe('Battle of Varn');
    expect(back.relationships).toHaveLength(1);
    expect(back.secrets).toHaveLength(1);
  });

  it('hides later events and relationships from the reader', () => {
    const w = world();
    w.books = [{ ...base, id: 'b1', title: 'Book', order: 1, notes: '' }];
    w.chapters = [{ ...base, id: 'c1', bookId: 'b1', title: 'One', order: 1, notes: '', povCharacterId: 'kaela' }];
    w.scenes = [{ ...base, id: 's1', chapterId: 'c1', title: 'Start', order: 1, start: d(1042, 1, 1), characterIds: ['bren'], summary: '' }];
    w.events = [ev('early', 'Early', d(1041, 1, 1)), ev('late', 'Late', d(1050, 1, 1))];
    w.relationships = [rel('kaela', 'bren', 'sibling'), rel('kaela', 'bren', 'enemy', { start: d(1049, 1, 1) })];
    const v = spoilerView(w, 0);
    expect(v.events.map((e) => e.id)).toEqual(['early']);
    expect(v.relationships.map((r) => r.kind)).toEqual(['sibling']);
  });
});
