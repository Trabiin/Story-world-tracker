import { describe, expect, it } from 'vitest';
import {
  CANON, Manuscript, bulkEditCharacters, characterFromTemplate, deleteImpact, deleteRecord, dependants, globalSearch, looseEnds, mergeRecords, recentChanges,
  shiftDates, templateFromCharacter, toDayNumber, unlinkedChapters,
} from '../src/core';
import { bytesToWorld, worldToBytes } from '../src/storage';
import { d, journey, stay, world } from './fixtures';

const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };

function sample() {
  const w = world();
  w.characters.push({ ...base, id: 'kaela2', name: 'Kaela of Varn', aliases: ['the Courier'], description: '', notes: 'Rides fast.', tags: ['POV'], color: '#c33', icon: 'person', importance: 'minor', archived: false });
  w.stays = [stay('kaela', 'varn', d(1042, 1, 1), d(1042, 2, 1)), stay('kaela2', 'thornwick', d(1042, 3, 1), d(1042, 4, 1))];
  w.journeys = [journey('kaela2', 'varn', 'thornwick', d(1042, 2, 1), d(1042, 3, 1))];
  w.relationships = [{ ...base, id: 'r1', aId: 'kaela', bId: 'kaela2', kind: 'friend', notes: '' }, { ...base, id: 'r2', aId: 'kaela2', bId: 'bren', kind: 'ally', notes: 'Old friends from the war' }];
  w.events = [{ ...base, id: 'e1', name: 'The Siege of Varn', kind: 'battle', start: d(1042, 2, 10), placeId: 'varn', characterIds: ['kaela', 'kaela2'], description: 'The walls hold.' }];
  w.memberships = [{ ...base, id: 'm1', groupId: 'party', characterId: 'kaela2' }];
  return w;
}

describe('global search (VW-8)', () => {
  it('ranks names over notes and finds manuscript text', () => {
    const w = sample();
    const m: Manuscript = { ...base, id: 'ms', name: 'Draft', textHash: '', loadedAt: '', paragraphs: [{ text: 'Chapter 1', heading: 1 }, { text: 'The siege began at dawn, and Kaela watched the walls.' }] };
    w.manuscripts = [m];
    const hits = globalSearch(w, 'siege');
    expect(hits[0]).toMatchObject({ kind: 'event', id: 'e1' });
    expect(hits.find((h) => h.kind === 'manuscript')).toMatchObject({ paraIndex: 1 });
    expect(globalSearch(w, 'courier')[0].id).toBe('kaela2'); // alias
    expect(globalSearch(w, 'old war')[0]).toMatchObject({ kind: 'relationship', snippet: expect.stringContaining('war') }); // every word, anywhere
    expect(globalSearch(w, 'x')).toEqual([]);
  });
});

describe('merge and delete (EU-20)', () => {
  it('merges a duplicate character, keeping every stay, journey, relationship and membership', () => {
    const w = mergeRecords(sample(), 'characters', 'kaela', 'kaela2');
    expect(w.characters.map((c) => c.id)).toEqual(['kaela', 'bren']);
    const k = w.characters[0];
    expect(k.aliases).toEqual(['Kaela of Varn', 'the Courier']);
    expect(k.tags).toEqual(['POV']);
    expect(k.notes).toBe('Rides fast.');
    expect(w.stays.every((s) => s.subject.id === 'kaela')).toBe(true);
    expect(w.journeys[0].subject.id).toBe('kaela');
    expect(w.relationships.map((r) => r.id)).toEqual(['r2']); // no one is their own friend
    expect(w.events[0].characterIds).toEqual(['kaela']);
    expect(w.memberships[0].characterId).toBe('kaela');
    expect(dependants(w, 'kaela2')).toEqual([]);
  });
  it('lists dependants, and deletes or reassigns them', () => {
    const w = sample();
    const imp = deleteImpact(w, 'characters', 'kaela2');
    expect(imp.goes.map((x) => x.collection).sort()).toEqual(['journeys', 'memberships', 'relationships', 'relationships', 'stays']);
    expect(imp.unlinked.map((x) => x.collection)).toEqual(['events']);
    const gone = deleteRecord(w, 'characters', 'kaela2', { kind: 'remove' });
    expect(gone.stays).toHaveLength(1);
    expect(gone.journeys).toHaveLength(0);
    expect(gone.events[0].characterIds).toEqual(['kaela']);
    expect(gone.memberships).toHaveLength(0);
    const moved = deleteRecord(w, 'characters', 'kaela2', { kind: 'reassign', to: 'bren' });
    expect(moved.stays.map((s) => s.subject.id)).toEqual(['kaela', 'bren']);
    expect(moved.relationships.map((r) => r.id)).toEqual(['r1']); // bren–bren dropped
  });
  it('deleting a place moves its sub-places up and removes stays there', () => {
    const w = sample();
    const out = deleteRecord(w, 'places', 'castle', { kind: 'remove' });
    expect(out.places.find((p) => p.id === 'hall')?.parentId).toBe('varn');
    const out2 = deleteRecord(w, 'places', 'varn', { kind: 'remove' });
    expect(out2.stays.map((s) => s.placeId)).toEqual(['thornwick']);
    expect(out2.journeys).toHaveLength(0);
    expect(out2.events[0].placeId).toBeUndefined();
  });
});

describe('bulk edit (EU-4)', () => {
  it('pushes everything after the siege back two weeks', () => {
    const w = sample();
    const r = shiftDates(w, { fromDay: toDayNumber({ year: 1042, month: 2, day: 10 }), days: 14 });
    expect(r.world.stays[0].departure).toEqual(d(1042, 2, 1)); // before: unchanged
    expect(r.world.stays[1].arrival).toEqual(d(1042, 3, 15));
    expect(r.world.events[0].start).toEqual(d(1042, 2, 24));
    expect(r.world.journeys[0].departure).toEqual(d(1042, 2, 1));
    expect(r.world.journeys[0].arrival).toEqual(d(1042, 3, 15));
    expect(r.shifted).toBe(4);
  });
  it('can shift only some characters, and leaves vague dates unless whole years', () => {
    const w = sample();
    w.stays.push(stay('bren', 'varn', { year: 1042, precision: 'season', season: 'summer' }));
    const only = shiftDates(w, { fromDay: -Infinity, days: 7, characterIds: ['bren'] });
    expect(only.shifted).toBe(0);
    expect(only.skipped).toBe(1);
    const years = shiftDates(w, { fromDay: -Infinity, days: 365, characterIds: ['bren'] });
    expect(years.world.stays[2].arrival.year).toBe(1043);
  });
  it('tags, archives and re-ranks many characters at once', () => {
    let w = bulkEditCharacters(sample(), ['kaela', 'bren'], { kind: 'add-tag', tag: 'Guard' });
    expect(w.characters.filter((c) => c.tags.includes('Guard'))).toHaveLength(2);
    w = bulkEditCharacters(w, ['bren'], { kind: 'archive', archived: true });
    expect(w.characters.find((c) => c.id === 'bren')?.archived).toBe(true);
  });
});

describe('templates (EU-3), dashboard (EU-15) and to-dos (EU-14)', () => {
  it('makes a character from a template, with its groups', () => {
    const w = sample();
    const t = templateFromCharacter(w, w.characters.find((c) => c.id === 'kaela2')!, 'Courier', 't1');
    expect(t.groupIds).toEqual(['party']);
    let i = 0;
    const { character, memberships } = characterFromTemplate(t, 'New courier', { ...base, id: 'c9' }, () => `n${++i}`);
    expect(character).toMatchObject({ name: 'New courier', tags: ['POV'], importance: 'minor' });
    expect(memberships[0]).toMatchObject({ groupId: 'party', characterId: 'c9' });
  });
  it('lists recent changes, loose ends and unlinked chapters', () => {
    const w = sample();
    w.characters[0] = { ...w.characters[0], updatedAt: '2026-11-06T10:00:00Z' };
    w.stays.push(stay('bren', 'varn', d(1042, 1, 1)), stay('bren', 'thornwick', d(1042, 6, 1)));
    w.books = [{ ...base, id: 'b', title: 'Book', order: 1, notes: '' }];
    w.chapters = [{ ...base, id: 'c1', bookId: 'b', title: 'One', order: 1, notes: '' }];
    expect(recentChanges(w)[0].id).toBe('kaela');
    expect(looseEnds(w).filter((l) => l.kind === 'open-stay')).toHaveLength(1);
    expect(unlinkedChapters(w).map((c) => c.chapterId)).toEqual(['c1']);
  });
  it('stores to-dos in the world file', async () => {
    const w = sample();
    w.todos = [{ ...base, id: 't', title: 'Why does Bren trust her?', note: '', kind: 'plot-hole', done: false, refs: [{ kind: 'character', id: 'bren' }] }];
    const back = await bytesToWorld(await worldToBytes(w));
    expect(back.todos[0]).toMatchObject({ kind: 'plot-hole', refs: [{ kind: 'character', id: 'bren' }] });
    expect(dependants(w, 'bren').map((x) => x.collection)).toContain('todos');
  });
});
