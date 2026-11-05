import { expect, it } from 'vitest';
import { WorldIndex, attributesOn, backlinksFor, scenePlace, toDayNumber } from '../src/core';
import { d, stay, world } from './fixtures';

const base = { scenarioId: 'canon', status: 'canon' as const, createdAt: '', updatedAt: '' };

it('derives a scene place from the POV stay, and backlinks find it', () => {
  const w = world();
  w.stays.push(stay('kaela', 'thornwick', d(1042, 5, 1), d(1042, 5, 9)));
  w.books.push({ ...base, id: 'b1', title: 'Book One', order: 1, notes: '' });
  w.chapters.push({ ...base, id: 'ch1', bookId: 'b1', title: 'Chapter 1', order: 1, povCharacterId: 'kaela', notes: '' });
  w.scenes.push({ ...base, id: 'sc1', chapterId: 'ch1', title: 'Arrival', order: 1, start: d(1042, 5, 3), characterIds: ['bren'], summary: '' });
  const ix = new WorldIndex(w);
  expect(scenePlace(ix, w.scenes[0])).toEqual({ placeId: 'thornwick', derived: true });
  expect(backlinksFor(w, 'character', 'bren').map((b) => b.kind)).toEqual(['scene']);
  expect(backlinksFor(w, 'character', 'kaela').map((b) => b.kind)).toEqual(['chapter']);
  expect(backlinksFor(w, 'place', 'thornwick').map((b) => b.kind)).toEqual(['stay']);
});

it('reads time-bound attributes on a date', () => {
  const w = world();
  w.characters[0].attributes = [
    { id: 'a1', key: 'title', value: 'Squire', end: d(1040, 1, 1) },
    { id: 'a2', key: 'title', value: 'Captain of the Guard', start: { year: 1040, precision: 'year' }, end: { year: 1043, precision: 'year' } },
  ];
  const ix = new WorldIndex(w);
  expect(attributesOn(ix, 'kaela', toDayNumber({ year: 1039, month: 6, day: 1 }))).toEqual({ title: 'Squire' });
  expect(attributesOn(ix, 'kaela', toDayNumber({ year: 1042, month: 6, day: 1 }))).toEqual({ title: 'Captain of the Guard' });
});
