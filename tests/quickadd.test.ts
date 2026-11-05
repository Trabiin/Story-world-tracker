import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../src/core';
import { world } from './fixtures';

describe('quick add (EU-1)', () => {
  const w = world();
  w.characters[0].aliases = ['the Fox'];
  it('parses a journey with mode, destination and departure without a year', () => {
    expect(parseQuickAdd('Kaela rides to Thornwick, leaves 3 May', w, 1042)).toMatchObject({
      kind: 'journey', subject: { kind: 'character', id: 'kaela' }, destinationId: 'thornwick', modeId: 'horse',
      departure: { year: 1042, month: 5, day: 3, precision: 'day' }, notes: [],
    });
  });
  it('parses origin and arrival, and aliases', () => {
    expect(parseQuickAdd('The Fox sails from Varn to Thornwick, departs 1/6/1043 arrives 9 June', w, 1042)).toMatchObject({
      kind: 'journey', subject: { id: 'kaela' }, originId: 'varn', destinationId: 'thornwick', modeId: 'ship',
      departure: { year: 1043, month: 6, day: 1 }, arrival: { year: 1042, month: 6, day: 9 },
    });
  });
  it('parses a group stay with dates', () => {
    expect(parseQuickAdd('The Party stays at Varn Castle from 3 May until 10 May', w, 1042)).toMatchObject({
      kind: 'stay', subject: { kind: 'group', id: 'party' }, placeId: 'castle',
      arrival: { month: 5, day: 3 }, departure: { month: 5, day: 10 },
    });
  });
  it('parses a stay with a duration and fuzzy date', () => {
    expect(parseQuickAdd('Bren waits in Thornwick from spring 1042 for 3 weeks', w, 1000)).toMatchObject({
      kind: 'stay', placeId: 'thornwick', arrival: { precision: 'season', season: 'spring', year: 1042 }, durationDays: 21,
    });
  });
  it('explains what it could not understand', () => {
    const r = parseQuickAdd('Somebody goes somewhere', w, 1042);
    expect(r.notes.length).toBeGreaterThanOrEqual(2);
  });
});
