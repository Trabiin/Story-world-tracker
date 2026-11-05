import { describe, expect, it } from 'vitest';
import { WorldIndex, checkWorld, toDayNumber, whereIs } from '../src/core';
import { d, journey, stay, world } from './fixtures';

const day = (y: number, m: number, dd: number) => toDayNumber({ year: y, month: m, day: dd });

describe('whereabouts', () => {
  it('finds a character at a stay and on a journey', () => {
    const w = world();
    w.stays.push(stay('kaela', 'varn', d(1042, 5, 1), d(1042, 5, 3)), stay('kaela', 'thornwick', d(1042, 5, 7)));
    w.journeys.push(journey('kaela', 'varn', 'thornwick', d(1042, 5, 3), d(1042, 5, 7)));
    const ix = new WorldIndex(w);
    expect(whereIs(ix, 'kaela', day(1042, 5, 2))).toMatchObject({ kind: 'stay', placeId: 'varn' });
    const mid = whereIs(ix, 'kaela', day(1042, 5, 5));
    expect(mid).toMatchObject({ kind: 'journey', fromId: 'varn', toId: 'thornwick', progress: 0.5 });
    if (mid.kind === 'journey') expect(mid.position!.lng).toBeCloseTo(11, 0);
    expect(whereIs(ix, 'kaela', day(1042, 6, 1))).toMatchObject({ kind: 'stay', placeId: 'thornwick' });
    expect(whereIs(ix, 'kaela', day(1042, 4, 1))).toEqual({ kind: 'unknown' });
  });

  it('inherits location from the physical parent', () => {
    const ix = new WorldIndex(world());
    expect(ix.locationOf('hall')).toEqual({ lat: 50, lng: 10 });
    expect(ix.nested('hall', 'varn')).toBe(true);
    expect(ix.nested('hall', 'thornwick')).toBe(false);
  });

  it('applies group whereabouts during membership, own entries win', () => {
    const w = world();
    w.memberships.push({ id: 'm1', scenarioId: 'canon', status: 'canon', createdAt: '', updatedAt: '', groupId: 'party', characterId: 'bren', start: d(1042, 5, 4) });
    w.stays.push(stay('party', 'thornwick', d(1042, 5, 1), d(1042, 5, 20), true));
    w.stays.push(stay('bren', 'castle', d(1042, 5, 10), d(1042, 5, 12)));
    const ix = new WorldIndex(w);
    expect(whereIs(ix, 'bren', day(1042, 5, 2))).toEqual({ kind: 'unknown' }); // before joining
    expect(whereIs(ix, 'bren', day(1042, 5, 5))).toMatchObject({ kind: 'stay', placeId: 'thornwick' });
    expect(whereIs(ix, 'bren', day(1042, 5, 11))).toMatchObject({ kind: 'stay', placeId: 'castle' }); // own wins
    // own vs group overlap is not a CC-1 conflict
    expect(checkWorld(w).filter((x) => x.rule === 'two-places')).toHaveLength(0);
  });

  it('suggests arrival when none is entered (WH-8)', () => {
    const w = world();
    const j = journey('kaela', 'varn', 'thornwick', d(1042, 5, 3), undefined, 'horse');
    w.journeys.push(j);
    const ix = new WorldIndex(w);
    // 143 km × 1.3 / 50 km/day = 3.7 → 4 days
    expect(ix.suggestedTravelDays(j)).toBe(4);
    expect(ix.journeyEnd(j)).toMatchObject({ suggested: true, end: { earliest: day(1042, 5, 7) } });
  });
});

describe('warnings', () => {
  it('CC-1 flags overlapping stays at different places but not nested ones', () => {
    const w = world();
    w.stays.push(stay('kaela', 'varn', d(1042, 5, 1), d(1042, 5, 10)));
    w.stays.push(stay('kaela', 'hall', d(1042, 5, 2), d(1042, 5, 3))); // nested → fine
    w.stays.push(stay('kaela', 'thornwick', d(1042, 5, 5), d(1042, 5, 8))); // conflict
    const ws = checkWorld(w).filter((x) => x.rule === 'two-places');
    expect(ws).toHaveLength(1);
    expect(ws[0].message).toContain('Thornwick');
  });

  it('CC-1 compares fuzzy dates as windows', () => {
    const w = world();
    w.stays.push(stay('kaela', 'varn', { year: 1042, precision: 'season', season: 'spring' }, { year: 1042, precision: 'season', season: 'spring' }));
    w.stays.push(stay('kaela', 'thornwick', d(1042, 4, 15), d(1042, 4, 20)));
    expect(checkWorld(w).filter((x) => x.rule === 'two-places')).toHaveLength(0);
  });

  it('CC-2 flags gaps; placeholders count as accounted for', () => {
    const w = world();
    w.stays.push(stay('kaela', 'varn', d(1042, 5, 1), d(1042, 5, 3)));
    w.stays.push(stay('kaela', 'thornwick', d(1042, 5, 10), d(1042, 5, 12)));
    const gap = checkWorld(w).find((x) => x.rule === 'gap')!;
    expect(gap.message).toContain('04/05/1042 to 09/05/1042 (6 days)');
    w.stays.push(stay('kaela', 'nowhere', d(1042, 5, 3), d(1042, 5, 10)));
    const after = checkWorld(w);
    expect(after.filter((x) => x.rule === 'gap')).toHaveLength(0);
    expect(after.filter((x) => x.rule === 'missing-journey')).toHaveLength(0);
    expect(after.filter((x) => x.rule === 'placeholder')).toHaveLength(1);
  });

  it('WH-13 offers a draft journey between stays at different places', () => {
    const w = world();
    w.stays.push(stay('kaela', 'varn', d(1042, 5, 1), d(1042, 5, 3)));
    w.stays.push(stay('kaela', 'thornwick', d(1042, 5, 3), d(1042, 5, 12)));
    const mj = checkWorld(w).find((x) => x.rule === 'missing-journey')!;
    expect(mj.fix).toMatchObject({ kind: 'create-journey', journey: { originId: 'varn', destinationId: 'thornwick', departureDay: day(1042, 5, 3) } });
  });

  it('CC-3 flags impossible travel', () => {
    const w = world();
    w.journeys.push(journey('kaela', 'varn', 'thornwick', d(1042, 5, 3), d(1042, 5, 4), 'foot'));
    w.journeys.push(journey('bren', 'varn', 'thornwick', d(1042, 5, 3), d(1042, 5, 9), 'foot'));
    const ws = checkWorld(w).filter((x) => x.rule === 'impossible-travel');
    expect(ws).toHaveLength(1);
    expect(ws[0].message).toContain('Kaela');
  });

  it('respects disabled rules and intentional dismissals', () => {
    const w = world();
    w.stays.push(stay('kaela', 'varn', d(1042, 5, 1)));
    const open = checkWorld(w).find((x) => x.rule === 'open-stay')!;
    w.dismissals.push({ key: open.key, note: 'she never leaves', at: '' });
    expect(checkWorld(w).find((x) => x.rule === 'open-stay')!.dismissed?.note).toBe('she never leaves');
    w.settings.disabledRules.push('open-stay');
    expect(checkWorld(w).find((x) => x.rule === 'open-stay')).toBeUndefined();
  });
});
