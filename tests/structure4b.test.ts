import { describe, expect, it } from 'vitest';
import {
  CANON, Manuscript, PlotThread, Scene, WorldIndex, applyFilter, applyScenarioEdit, chapterOverview, checkWorld, chronologicalScenes, discardScenario, incidentAt, nameSuggestions,
  newScenario, orderedScenes, overduePlans, plansOn, promoteScenario, scenarioChanges, scenarioView, threadLanes, toDayNumber, travelFactor,
} from '../src/core';
import { bytesToWorld, worldToBytes } from '../src/storage';
import { d, journey, stay, world } from './fixtures';

const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };
const day = (y: number, m: number, dd: number) => toDayNumber({ year: y, month: m, day: dd });

function withStory() {
  const w = world();
  w.books = [{ ...base, id: 'b1', title: 'Book One', order: 1, notes: '' }, { ...base, id: 'b2', title: 'Book Two', order: 2, notes: '' }];
  w.chapters = [
    { ...base, id: 'c1', bookId: 'b1', title: 'The Gate', order: 1, notes: '', povCharacterId: 'kaela' },
    { ...base, id: 'c2', bookId: 'b1', title: 'Old Days', order: 2, notes: '', povCharacterId: 'bren' },
    { ...base, id: 'c3', bookId: 'b2', title: 'North', order: 1, notes: '', povCharacterId: 'kaela' },
  ];
  const sc = (id: string, chapterId: string, start: ReturnType<typeof d>, extra: Partial<Scene> = {}): Scene => ({ ...base, id, chapterId, title: id, order: 1, start, characterIds: [], summary: '', ...extra });
  w.scenes = [sc('s1', 'c1', d(1042, 5, 1), { placeId: 'varn', threadIds: ['main'] }), sc('s2', 'c2', d(1030, 1, 1), { threadIds: ['past'] }), sc('s3', 'c3', d(1042, 5, 1), { povCharacterId: 'bren', threadIds: ['north'] })];
  const th = (id: string, extra: Partial<PlotThread> = {}): PlotThread => ({ ...base, id, name: id, color: '#c33', description: '', characterIds: [], ...extra });
  w.threads = [th('main'), th('north', { parentId: 'main', rejoinsId: 'main' }), th('past')];
  return w;
}

describe('scenarios (ST-7) and drafts (ST-6)', () => {
  it('keeps what-if edits apart from canon, compares, discards and promotes', async () => {
    const w = world();
    w.stays = [stay('kaela', 'varn', d(1042, 1, 1), d(1042, 2, 1))];
    w.scenarios = [newScenario({ id: 'north', createdAt: '', updatedAt: '' }, 'Kaela goes north')];
    // edit in the scenario: move the stay, add one, delete Bren
    const before = scenarioView(w, 'north');
    const after = { ...before, stays: [{ ...before.stays[0], placeId: 'thornwick' }, stay('kaela', 'castle', d(1042, 3, 1))], characters: before.characters.filter((c) => c.id !== 'bren') };
    const stored = applyScenarioEdit(w, 'north', before, after);
    expect(scenarioView(stored, CANON).stays.map((s) => s.placeId)).toEqual(['varn']);
    expect(scenarioView(stored, CANON).characters).toHaveLength(2);
    const what = scenarioView(stored, 'north');
    expect(what.stays.map((s) => s.placeId)).toEqual(['thornwick', 'castle']);
    expect(what.stays[0].id).toBe(w.stays[0].id); // same id as the canon record it replaces
    expect(what.characters.map((c) => c.id)).toEqual(['kaela']);
    expect(scenarioChanges(stored, 'north').map((c) => `${c.kind}:${c.collection}`).sort()).toEqual(['added:stays', 'changed:stays', 'removed:characters']);
    // a second edit to the same record updates the overlay instead of adding another
    const v2 = scenarioView(stored, 'north');
    const stored2 = applyScenarioEdit(stored, 'north', v2, { ...v2, stays: v2.stays.map((s, i) => (i === 0 ? { ...s, purpose: 'scouting' } : s)) });
    expect(stored2.stays).toHaveLength(3);
    // saved and loaded
    const back = await bytesToWorld(await worldToBytes(stored2));
    expect(scenarioView(back, 'north').stays[0].purpose).toBe('scouting');
    // discard: canon as before
    const gone = discardScenario(stored2, 'north');
    expect(gone.stays).toHaveLength(1);
    expect(gone.scenarios).toHaveLength(0);
    // promote: the what-if becomes canon
    const prom = promoteScenario(stored2, 'north');
    expect(prom.stays.map((s) => s.placeId)).toEqual(['thornwick', 'castle']);
    expect(prom.stays.every((s) => s.scenarioId === CANON)).toBe(true);
    expect(prom.characters.map((c) => c.id)).toEqual(['kaela']);
  });

  it('canon edits go straight to canon and leave a what-if overlay alone', () => {
    const w = world();
    w.stays = [stay('kaela', 'varn', d(1042, 1, 1), d(1042, 2, 1))];
    w.scenarios = [newScenario({ id: 'x', createdAt: '', updatedAt: '' }, 'X')];
    const v = scenarioView(w, 'x');
    const s1 = applyScenarioEdit(w, 'x', v, { ...v, stays: [{ ...v.stays[0], purpose: 'what-if' }] });
    const c = scenarioView(s1, CANON);
    const s2 = applyScenarioEdit(s1, CANON, c, { ...c, stays: [{ ...c.stays[0], purpose: 'canon' }] });
    expect(scenarioView(s2, CANON).stays[0].purpose).toBe('canon');
    expect(scenarioView(s2, 'x').stays[0].purpose).toBe('what-if');
  });

  it('hiding drafts takes them out of the checks', () => {
    const w = world();
    w.stays = [stay('kaela', 'varn', d(1042, 1, 1), d(1042, 2, 1)), { ...stay('kaela', 'thornwick', d(1042, 1, 10), d(1042, 1, 20)), status: 'draft' }];
    expect(checkWorld(w).some((x) => x.rule === 'two-places')).toBe(true);
    expect(checkWorld(applyFilter(w, { drafts: 'hide' })).some((x) => x.rule === 'two-places')).toBe(false);
  });
});

describe('filters (VW-7) and threads (ST-3)', () => {
  it('filters by book, thread (with branches), POV, tag and faction', () => {
    const w = withStory();
    w.characters[1] = { ...w.characters[1], tags: ['villain'], attributes: [{ id: 'a', key: 'faction', value: 'Ash' }] };
    w.stays = [stay('kaela', 'varn', d(1042, 1, 1)), stay('bren', 'varn', d(1042, 1, 1))];
    const b2 = applyFilter(w, { drafts: 'show', bookId: 'b2' });
    expect(b2.chapters.map((c) => c.id)).toEqual(['c3']);
    expect(b2.characters.map((c) => c.id).sort()).toEqual(['bren', 'kaela']);
    const main = applyFilter(w, { drafts: 'show', threadId: 'main' });
    expect(main.scenes.map((s) => s.id).sort()).toEqual(['s1', 's3']); // north branches off main
    const pov = applyFilter(w, { drafts: 'show', povId: 'bren' });
    expect(pov.scenes.map((s) => s.id).sort()).toEqual(['s2', 's3']);
    expect(applyFilter(w, { drafts: 'show', tag: 'villain' }).characters.map((c) => c.id)).toEqual(['bren']);
    const ash = applyFilter(w, { drafts: 'show', faction: 'ash' });
    expect(ash.characters.map((c) => c.id)).toEqual(['bren']);
    expect(ash.stays.map((s) => s.subject.id)).toEqual(['bren']);
  });

  it('lays out thread lanes with branches under their parent', () => {
    const { lanes, total } = threadLanes(withStory());
    expect(total).toBe(3);
    expect(lanes.map((l) => l.thread.id)).toEqual(['main', 'north', 'past']);
    expect(lanes[1].first).toBe(2);
  });
});

describe('story order and chapters (ST-4, ST-5, ST-13)', () => {
  it('finds flashbacks and parallel scenes, and sorts chronologically', () => {
    const w = withStory();
    const o = orderedScenes(w);
    expect(o.find((x) => x.scene.id === 's2')!.flashback).toBe(true);
    expect(o.find((x) => x.scene.id === 's3')!.parallelWith).toEqual(['s1']); // same day, other POV
    expect(chronologicalScenes(w).map((x) => x.scene.id)).toEqual(['s2', 's1', 's3']);
  });

  it('builds a chapter overview from scenes and links', () => {
    const w = withStory();
    w.scenes.push({ ...base, id: 's4', chapterId: 'c1', title: 'later', order: 2, start: d(1042, 5, 4), characterIds: ['bren'], summary: '' });
    const ov = chapterOverview(new WorldIndex(w), 'c1');
    expect(ov.characters.map((c) => [c.id, c.pov])).toEqual([['kaela', true], ['bren', false]]);
    expect(ov.places.map((p) => p.id)).toEqual(['varn']);
    expect(ov.range).toEqual({ earliest: day(1042, 5, 1), latest: day(1042, 5, 4) });
  });
});

describe('name spotting (ST-12)', () => {
  it('suggests a stay, a cast member and links from a manuscript', () => {
    const w = withStory();
    w.places[1] = { ...w.places[1], aliases: ['the Wick'] };
    const m: Manuscript = {
      ...base, id: 'm', name: 'Draft', bookId: 'b1', textHash: '', loadedAt: '',
      paragraphs: [
        { text: 'The Gate', heading: 1 },
        { text: 'Kaela rode out of Varn. Bren watched from the walls; Bren always watched.' },
        { text: 'By dusk she reached the Wick.' },
        { text: 'Old Days', heading: 1 },
        { text: 'Long ago, Bren was a boy.' },
      ],
    };
    const { sections, suggestions } = nameSuggestions(w, m);
    expect(sections.map((s) => s.chapterId)).toEqual(['c1', 'c2']);
    const keys = suggestions.map((s) => s.key);
    expect(keys).toContain('cast:c1:bren');
    // Kaela has no whereabouts then: one stay, at the place named first-most (Varn)
    expect(keys.filter((k) => k.startsWith('stay:'))).toEqual(['stay:c1:kaela:varn']);
    expect(keys).toContain('link:place:thornwick'); // found via the alias
    expect(keys).toContain('link:character:kaela');
    expect(sections[0].mentions.find((x) => x.id === 'bren')!.count).toBe(2);
    // once Kaela's whereabouts are known then (anywhere), no stay is suggested
    w.stays = [stay('kaela', 'thornwick', d(1042, 4, 1), d(1042, 6, 1))];
    expect(nameSuggestions(w, m).suggestions.some((s) => s.kind === 'stay')).toBe(false);
  });
});

describe('travel (WH-9, WH-10, WH-11)', () => {
  it('slows land travel in winter and through danger, and only when switched on', () => {
    const w = world();
    const path = [{ lat: 50, lng: 10 }, { lat: 50, lng: 12 }];
    expect(travelFactor(w, path, 'horse', day(1042, 1, 15)).factor).toBe(1);
    w.settings.travelModifiers = { terrain: false, season: true, danger: true, river: false };
    expect(travelFactor(w, path, 'horse', day(1042, 1, 15)).parts.map((p) => p.reason)).toEqual(['winter']);
    expect(travelFactor(w, path, 'horse', day(1042, 7, 15)).factor).toBe(1);
    w.regionLayers = [{ ...base, id: 'dl', name: 'Danger', type: 'danger', overlaps: true, color: '#c00', fill: 'solid', borderStyle: 'solid', opacity: 0.4, labels: false, onlyOnLand: false, visible: true, locked: false, order: 1 }];
    w.regions = [{ ...base, id: 'r', layerId: 'dl', name: 'Wolf woods', color: '#c00', versions: [{ id: 'v', area: [[[[9, 49], [13, 49], [13, 51], [9, 51], [9, 49]]]], intensity: 100 }], overlords: [], ties: [], entry: '' }];
    const f = travelFactor(w, path, 'horse', day(1042, 7, 15));
    expect(f.parts).toEqual([{ reason: 'danger', factor: 1.5 }]);
    // the journey check uses it
    w.journeys = [journey('kaela', 'varn', 'thornwick', d(1042, 7, 1), d(1042, 7, 4))];
    expect(checkWorld(w).some((x) => x.rule === 'impossible-travel')).toBe(true); // 143 km × 1.3 × 1.5 ÷ 50 ≈ 5.6 days
    w.settings.travelModifiers = undefined;
    expect(checkWorld(w).some((x) => x.rule === 'impossible-travel')).toBe(false);
  });

  it('places an incident on the route and tracks plans', () => {
    const w = world();
    const j = { ...journey('kaela', 'varn', 'thornwick', d(1042, 5, 1), d(1042, 5, 4)), incidents: [{ id: 'i', day: 2, title: 'Ambush', note: '' }] };
    w.journeys = [j];
    const ix = new WorldIndex(w);
    const at = incidentAt(ix, j, j.incidents[0]);
    expect(at.day).toBe(day(1042, 5, 2));
    expect(at.at!.lng).toBeGreaterThan(10.2);
    expect(at.at!.lng).toBeLessThan(11);
    w.characters[0] = { ...w.characters[0], plans: [{ id: 'p', placeId: 'thornwick', by: d(1042, 4, 1), note: 'find Oren' }] };
    w.stays = [stay('kaela', 'varn', d(1042, 3, 1), d(1042, 4, 30))];
    w.journeys = [];
    expect(plansOn(new WorldIndex(w), day(1042, 3, 15))[0]).toMatchObject({ active: true, overdue: false });
    expect(overduePlans(w).map((p) => p.key)).toEqual(['plan-overdue:kaela:p']);
    w.stays.push(stay('kaela', 'thornwick', d(1042, 5, 1)));
    expect(overduePlans(w)).toHaveLength(0);
    expect(plansOn(new WorldIndex(w), day(1042, 6, 1))[0].reached).toBe(true);
  });
});

describe('sample world (Phase 4b)', () => {
  it('has a flashback, a parallel scene, a branch thread and a what-if', async () => {
    const { sampleWorld } = await import('../src/ui/sample');
    const { orderedScenes, threadLanes, scenarioView, checkWorld, plansOn, WorldIndex, whereIs, toDayNumber } = await import('../src/core');
    const w = sampleWorld();
    const o = orderedScenes(w);
    expect(o.find((x) => x.scene.title === 'The keep at night')?.flashback).toBe(true);
    expect(o.find((x) => x.scene.title === 'Salt on the wind')?.parallelWith).toHaveLength(1);
    const lanes = threadLanes(w).lanes.map((l) => l.thread.name);
    expect(lanes.indexOf('Tamsin’s spying')).toBe(lanes.indexOf('The sealed letter') + 1);
    const alt = scenarioView(w, w.scenarios[0].id);
    const mira = w.characters.find((c) => c.name === 'Mira Solt')!;
    const day = toDayNumber({ year: 1042, month: 5, day: 20 });
    expect(whereIs(new WorldIndex(w), mira.id, day).kind).toBe('stay');
    expect(whereIs(new WorldIndex(alt), mira.id, day).kind).toBe('journey');
    expect(checkWorld(alt).length).toBeGreaterThan(0);
    expect(plansOn(new WorldIndex(w), toDayNumber({ year: 1042, month: 5, day: 20 })).filter((p) => p.active)).toHaveLength(1);
  });
});
