import { describe, expect, it } from 'vitest';
import { LayerIndex, WorldIndex, characterTrack, placeVisits, readerDay, readingChoices, spoilerView, toDayNumber } from '../src/core';
import { sampleWorld } from '../src/ui/sample';

const names = (xs: { name: string }[]) => xs.map((x) => x.name).sort();

describe('"as of" spoiler filter (EU-8)', () => {
  it('shows only what the reader knows at the end of chapter 1', () => {
    const w = sampleWorld();
    expect(readingChoices(w).map((c) => c.label)).toEqual(['Chapter 1: The Sealed Letter', 'Chapter 2: Market Days', 'Chapter 3: Two Roads', 'End of The Salt Roads']);
    expect(readerDay(w, 0)).toBe(toDayNumber({ year: 1042, month: 4, day: 30 }));
    const v = spoilerView(w, 0);
    expect(names(v.characters)).toEqual(['Kaela Venn']);
    const places = names(v.places);
    expect(places).toEqual(expect.arrayContaining(['Hall of Lamps', 'Varn Keep', 'Varn', 'Thornwick', 'The Sallow']));
    expect(places).not.toContain('Emberhold');
    expect(places).not.toContain('Saltmere');
    expect(v.chapters).toHaveLength(1);
    // Kaela's later stays are not revealed yet; the linked journey is
    expect(v.stays.every((s) => s.subject.id === v.characters[0].id)).toBe(true);
    expect(v.stays).toHaveLength(1);
    expect(v.journeys).toHaveLength(1);
    // the 1044 conquest is in the future for the reader
    const ash = v.regions.find((r) => r.name === 'Empire of Ash')!;
    expect(ash.versions).toHaveLength(1);
    expect(ash.ties).toEqual([]);
  });
  it('reveals more by the end of the book, and a hand-set reveal wins', () => {
    const w = sampleWorld();
    const v = spoilerView(w, 1);
    expect(names(v.characters)).toEqual(['Kaela Venn', 'Mira Solt', 'Oren Hask']);
    expect(v.groups.map((g) => g.name)).toEqual(['The Salt Caravan']);
    const tamsin = w.characters.find((c) => c.name === 'Tamsin Rook')!;
    tamsin.revealedIn = 'start';
    const kaela = w.characters.find((c) => c.name === 'Kaela Venn')!;
    kaela.revealedIn = 'never';
    const v2 = spoilerView(w, 1);
    expect(names(v2.characters)).toEqual(['Mira Solt', 'Oren Hask', 'Tamsin Rook']);
    expect(v2.stays.some((s) => s.subject.id === kaela.id)).toBe(false);
    // the filtered world still works with the rest of the app
    expect(new LayerIndex(v2).regionsAt({ lat: 47.4, lng: 13.6 }, toDayNumber({ year: 1042, month: 5, day: 5 }))[0].hits[0].region.name).toBe('Kingdom of Varn');
  });
});

describe('character track (VW-3) and place view (VW-4)', () => {
  it("follows Kaela's path with dates", () => {
    const w = sampleWorld();
    const ix = new WorldIndex(w);
    const kaela = w.characters.find((c) => c.name === 'Kaela Venn')!;
    const t = characterTrack(ix, kaela.id);
    expect(t.stops.map((s) => ix.places.get(s.placeId)!.name)).toEqual(['Hall of Lamps', 'Thornwick', 'Saltmere']);
    expect(t.legs).toHaveLength(2);
  });
  it('lists who was at Thornwick, including the caravan members', () => {
    const w = sampleWorld();
    const ix = new WorldIndex(w);
    const thornwick = w.places.find((p) => p.name === 'Thornwick')!;
    const v = placeVisits(ix, thornwick.id);
    const who = new Set(v.filter((x) => x.kind === 'stay').map((x) => ix.characters.get(x.subject.id)!.name));
    expect([...who].sort()).toEqual(['Kaela Venn', 'Mira Solt', 'Oren Hask']);
    expect(v.some((x) => x.viaGroupId)).toBe(true);
    // the Hall of Lamps counts as being in Varn
    const varn = w.places.find((p) => p.name === 'Varn')!;
    expect(placeVisits(ix, varn.id).some((x) => x.kind === 'stay' && ix.characters.get(x.subject.id)!.name === 'Kaela Venn')).toBe(true);
  });
});
