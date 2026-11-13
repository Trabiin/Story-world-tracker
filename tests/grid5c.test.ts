import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS, GridMakers, Journey, Place, Stay, applyGridEdits, parsePastedCells } from '../src/core';
import { recordBase } from '../src/storage';
import { sampleWorld } from '../src/ui/sample';
import { blankCharacter } from '../src/ui/util';

const makers = (w: ReturnType<typeof sampleWorld>): GridMakers => ({
  now: '2026-11-13T00:00:00.000Z',
  character: (name) => ({ ...blankCharacter(w, recordBase()), name }),
  place: (name) => ({ ...recordBase(), name, aliases: [], kind: 'other', notes: '', isPlaceholder: false }),
  stay: () => ({ ...recordBase(), subject: undefined as never, placeId: '', arrival: undefined as never, purpose: '', notes: '' }),
  journey: () => ({ ...recordBase(), subject: undefined as never, originId: '', destinationId: '', waypointIds: [], departure: undefined as never, modeId: 'horse', purpose: '', notes: '' }),
});
const col = (kind: keyof typeof GRID_COLUMNS, id: string) => GRID_COLUMNS[kind].find((c) => c.id === id)!;

describe('EU-19 spreadsheet editing', () => {
  it('shows records as text and reads typed cells back, keeping cells that do not read', () => {
    const w = sampleWorld();
    const kaela = w.characters.find((c) => c.name === 'Kaela Venn')!;
    expect(col('characters', 'birth').get(kaela, w)).toMatch(/1020/);
    const { world, problems } = applyGridEdits(w, 'characters', [
      { id: kaela.id, col: 'aliases', text: 'The Courier; Kae' },
      { id: kaela.id, col: 'importance', text: 'Minor' },
      { id: kaela.id, col: 'death', text: 'someday' },
    ], makers(w));
    const after = world.characters.find((c) => c.id === kaela.id)!;
    expect(after.aliases).toEqual(['The Courier', 'Kae']);
    expect(after.importance).toBe('minor');
    expect(after.death).toEqual(kaela.death);
    expect(problems).toEqual([{ id: kaela.id, newRow: undefined, col: 'death', message: '"someday" is not a date (try 3/5/1042, May 1042, ~1042)' }]);
    expect(after.updatedAt).toBe('2026-11-13T00:00:00.000Z');
  });

  it('matches places and people by name or alias, and refuses a place inside itself', () => {
    const w = sampleWorld();
    const stay = w.stays[0];
    const place = w.places.find((p) => p.parentId)!;
    const parent = w.places.find((p) => p.id === place.parentId)!;
    const r = applyGridEdits(w, 'stays', [{ id: stay.id, col: 'place', text: parent.name.toUpperCase() }, { id: stay.id, col: 'who', text: 'Nobody At All' }], makers(w));
    expect(r.world.stays.find((s) => s.id === stay.id)!.placeId).toBe(parent.id);
    expect(r.problems.map((p) => p.message)).toEqual(['No character or group called "Nobody At All"']);
    const loop = applyGridEdits(w, 'places', [{ id: parent.id, col: 'parent', text: place.name }], makers(w));
    expect(loop.problems[0].message).toBe(`${place.name} is inside this place already`);
    expect(loop.world.places.find((p) => p.id === parent.id)!.parentId).toBe(parent.parentId);
  });

  it('pastes rows from a spreadsheet: new rows need every required cell', () => {
    const w = sampleWorld();
    const [a, b] = w.places;
    const cells = parsePastedCells(`Kaela Venn\t${a.name}\t3/5/1042\t\t4\tresting\r\nIlsa Marr\t${b.name}\r\n`);
    expect(cells).toHaveLength(2);
    const edits = cells.flatMap((line, i) => line.map((text, j) => ({ newRow: `p${i}`, col: GRID_COLUMNS.stays[j].id, text })));
    const r = applyGridEdits(w, 'stays', edits, makers(w));
    expect(r.created).toHaveLength(1);
    const s = r.world.stays.find((x) => x.id === r.created[0]) as Stay;
    expect(s).toMatchObject({ placeId: a.id, arrival: { year: 1042, month: 5, day: 3, precision: 'day' }, durationDays: 4, purpose: 'resting' });
    expect(s.departure).toBeUndefined();
    expect(s.subject).toEqual({ kind: 'character', id: w.characters.find((c) => c.name === 'Kaela Venn')!.id });
    expect(r.problems).toEqual([{ newRow: 'p1', col: 'arrival', message: 'Still needed: Arrives' }]);
    expect(r.world.stays.length).toBe(w.stays.length + 1);
  });

  it('journeys: travel mode by name, a new destination drops the drawn route', () => {
    const w = sampleWorld();
    const j0 = w.journeys[0];
    const w1 = { ...w, journeys: w.journeys.map((j) => (j.id === j0.id ? { ...j, route: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] } : j)) };
    const other = w.places.find((p) => p.id !== j0.destinationId && p.id !== j0.originId)!;
    const r = applyGridEdits(w1, 'journeys', [{ id: j0.id, col: 'mode', text: 'ship' }, { id: j0.id, col: 'to', text: other.name }], makers(w1));
    const j = r.world.journeys.find((x) => x.id === j0.id) as Journey;
    expect(j.modeId).toBe('ship');
    expect(j.destinationId).toBe(other.id);
    expect(j.route).toBeUndefined();
    expect(applyGridEdits(w1, 'journeys', [{ id: j0.id, col: 'mode', text: 'dragon' }], makers(w1)).problems[0].message).toMatch(/^Use one of: Foot, Horse/);
  });

  it('new places: kind, position and a parent added in the same paste', () => {
    const w = sampleWorld();
    const r = applyGridEdits(w, 'places', [
      { newRow: 'a', col: 'name', text: 'Gull Rock' }, { newRow: 'a', col: 'kind', text: 'Landmark' }, { newRow: 'a', col: 'lat', text: '46,2' }, { newRow: 'a', col: 'lng', text: '10.5' },
      { newRow: 'b', col: 'name', text: 'Gull Light' }, { newRow: 'b', col: 'kind', text: 'building' }, { newRow: 'b', col: 'parent', text: 'gull rock' },
    ], makers(w));
    expect(r.problems).toEqual([]);
    const rock = r.world.places.find((p) => p.name === 'Gull Rock') as Place;
    expect(rock).toMatchObject({ kind: 'landmark', location: { lat: 46.2, lng: 10.5 } });
    expect(r.world.places.find((p) => p.name === 'Gull Light')!.parentId).toBe(rock.id);
  });
});
