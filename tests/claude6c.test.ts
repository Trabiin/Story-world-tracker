import { describe, expect, it } from 'vitest';
import {
  ApplyOptions, BASE_FIELDS, CANON, CLAUDE_COLLECTIONS, ClaudeChange, McpEnv, ProposalInput, SCHEMA, World, acceptSuggestion, addSuggestion, applyChanges, applyProposal,
  blocksToDoc, checkProposal, checkWorld, claudeFolderFiles, claudeMd, countPassage, dataModelGuide, docToMarkdown, docToPlain, handleMcp, markdownToDoc, rejectSuggestion,
  replacePassage, scenarioChanges, scenarioView, textOf, undoAllDirect, undoLogEntry, TerrainReader, LayerIndex, toDayNumber, docToBlocks,
} from '../src/core';
import { loadWorldFile, worldToBytes } from '../src/storage';
import { sampleWorld } from '../src/ui/sample';

let n = 0;
const opts: ApplyOptions = { newId: () => `id-${++n}`, now: () => '2026-11-06T12:00:00.000Z' };
const W = () => sampleWorld();
const byName = <T extends { id: string; name?: string; title?: string }>(list: T[], name: string) => list.find((x) => (x.name ?? x.title) === name)!;
const ok = (w: World, changes: ClaudeChange[], sid = CANON) => {
  const r = applyChanges(w, sid, changes, opts);
  expect(r.errors).toEqual([]);
  return r;
};
const refused = (w: World, changes: ClaudeChange[]) => {
  const r = applyChanges(w, CANON, changes, opts);
  expect(r.errors.length).toBeGreaterThan(0);
  expect(r.world).toBe(w);
  return r.errors.join('\n');
};

describe('AI-10 data model guide', () => {
  it('describes every field the sample world uses, for every collection Claude can change', () => {
    const w = W();
    for (const c of CLAUDE_COLLECTIONS) {
      const known = new Set([...Object.keys(BASE_FIELDS), ...Object.keys(SCHEMA[c].fields)]);
      for (const r of (w as unknown as Record<string, Record<string, unknown>[]>)[c]) for (const k of Object.keys(r)) expect(known.has(k), `${c}.${k}`).toBe(true);
    }
  });
  it('the guide lists every collection, field, dependency rule and warning rule', () => {
    const g = dataModelGuide();
    for (const c of CLAUDE_COLLECTIONS) {
      expect(g).toContain(`## ${c}`);
      for (const k of Object.keys(SCHEMA[c].fields)) expect(g).toContain(`\`${k}\``);
    }
    expect(g).toContain('A stay needs its character or group and its place');
    expect(g).toContain('river-uphill');
    expect(dataModelGuide('stays')).toContain('`arrival` (date) **required**');
  });
  it('CLAUDE.md explains the folder, the tools, the rules and how to propose', () => {
    const md = claudeMd(W(), { directEdit: false });
    expect(md).toContain('never edit files here');
    expect(md).toContain('propose_changes');
    expect(md).toContain('day/month/year');
    expect(md).toContain('Suggestions');
    expect(claudeMd(W(), { directEdit: true })).toContain('direct editing');
  });
});

describe('AI-1 Claude folder', () => {
  const w = W();
  const files = claudeFolderFiles(w, checkWorld(w));
  const at = (p: string) => files.find((f) => f.path === p)?.text ?? '';
  it('has the guide, the world, a page per record and every scene as Markdown', () => {
    expect(at('CLAUDE.md')).toContain('# ');
    expect(at('guide/data-model.md')).toContain('## characters');
    expect(at('world.md')).toContain('The Salt Roads');
    for (const c of w.characters) expect(files.some((f) => f.path.startsWith('characters/') && f.text.includes(`\`${c.id}\``))).toBe(true);
    const scenes = files.filter((f) => f.path.startsWith('manuscript/'));
    expect(scenes.length).toBe(w.scenes.length);
    const errand = scenes.find((f) => f.path.includes('errand'))!;
    expect(errand.path).toMatch(/^manuscript\/01 The Salt Roads\/01 Chapter 1 The Sealed Letter\/\d\d /);
    const text = docToPlain(textOf(w, byName(w.scenes, 'The regent’s errand').id)!.doc);
    expect(errand.text).toContain(text.split('\n')[0].slice(0, 30));
    expect(new Set(files.map((f) => f.path.toLowerCase())).size).toBe(files.length);
  });
  it('character pages show whereabouts, places show their realm over time, warnings are listed', () => {
    const kaela = files.find((f) => f.path === 'characters/Kaela Venn.md')!.text;
    expect(kaela).toContain('## Whereabouts');
    expect(kaela).toMatch(/at Thornwick/);
    expect(files.find((f) => f.path === 'places/Thornwick.md')!.text).toMatch(/Kingdom of Varn.*\n- .*Empire of Ash/);
    expect(at('warnings.md')).toContain('impossible-travel');
    expect(JSON.parse(at('data/world.json')).terrain).toBeUndefined();
  });
});

describe('scene text as Markdown', () => {
  it('round-trips bold, italics, breaks and headings', () => {
    const doc = blocksToDoc([{ kind: 'heading', level: 2, runs: [{ text: 'Part one' }] }, { kind: 'p', runs: [{ text: 'She was ' }, { text: 'very', italic: true }, { text: ' tired', bold: true }, { text: '.' }] }, { kind: 'break' }, { kind: 'p', runs: [{ text: 'A*b_c' }] }]);
    const md = docToMarkdown(doc);
    expect(md).toBe('## Part one\n\nShe was *very* **tired**.\n\n* * *\n\nA\\*b\\_c');
    expect(docToMarkdown(markdownToDoc(md))).toBe(md);
    expect(docToPlain(markdownToDoc(md))).toBe(docToPlain(doc));
  });
  it('replaces one passage and keeps what is around it', () => {
    const doc = blocksToDoc([{ kind: 'p', runs: [{ text: 'The gate ' }, { text: 'creaked', italic: true }, { text: ' open at dawn.', comments: ['c1'] }] }]);
    expect(countPassage(doc, 'open at')).toBe(1);
    const out = replacePassage(doc, 'creaked open', 'swung wide')!;
    const runs = (docToBlocks(out)[0] as { runs: { text: string; italic?: boolean; comments?: string[] }[] }).runs;
    expect(runs.map((r) => r.text).join('')).toBe('The gate swung wide at dawn.');
    expect(runs.find((r) => r.text.includes('swung'))!.italic).toBe(true);
    expect(runs.find((r) => r.text.includes('dawn'))!.comments).toEqual(['c1']);
    expect(replacePassage(doc, 'nothing like this', 'x')).toBeUndefined();
  });
});

describe('AI-3, AI-10 proposals are checked like the app\'s forms', () => {
  it('creates records that point at each other with new: ids', () => {
    const w = W();
    const keep = byName(w.places, 'Varn Keep');
    const r = ok(w, [
      { op: 'create', collection: 'characters', record: { id: 'new:brother', name: 'Joren Venn', aliases: ['the Younger'], birth: '12/3/1019' } },
      { op: 'create', collection: 'stays', record: { subject: { kind: 'character', id: 'new:brother' }, placeId: keep.id, arrival: 'May 1042', purpose: 'guarding' } },
      { op: 'create', collection: 'relationships', record: { aId: 'new:brother', bId: byName(w.characters, 'Kaela Venn').id, kind: 'sibling' } },
    ]);
    const joren = byName(r.world.characters, 'Joren Venn');
    expect(joren.id).toBe(r.ids['new:brother']);
    expect(joren.birth).toEqual({ year: 1019, month: 3, day: 12, precision: 'day' });
    expect(joren.importance).toBe('secondary');
    expect(r.world.stays.find((s) => s.subject.id === joren.id)!.placeId).toBe(keep.id);
  });

  it('refuses unknown fields, bad dates, missing references and wrong values, with reasons', () => {
    const w = W();
    expect(refused(w, [{ op: 'create', collection: 'characters', record: { name: 'X', haircolour: 'red' } }])).toMatch(/"haircolour" is not a field of characters/);
    expect(refused(w, [{ op: 'create', collection: 'characters', record: { name: 'X', birth: 'the day after' } }])).toMatch(/not a date the app understands/);
    expect(refused(w, [{ op: 'create', collection: 'stays', record: { subject: { kind: 'character', id: 'nobody' }, placeId: 'unknown-place', arrival: '1042' } }])).toMatch(/does not exist/);
    expect(refused(w, [{ op: 'create', collection: 'characters', record: { name: 'X', importance: 'huge' } }])).toMatch(/must be one of main, secondary, minor/);
    expect(refused(w, [{ op: 'create', collection: 'stays', record: { subject: { kind: 'character', id: 'new:x' }, placeId: 'unknown-place', arrival: '1042' } }])).toMatch(/no change creates/);
    expect(refused(w, [{ op: 'create', collection: 'sceneVersions', record: {} }])).toMatch(/not something Claude can create/);
    expect(refused(w, [{ op: 'update', collection: 'characters', id: byName(w.characters, 'Kaela Venn').id, set: { name: null } }])).toMatch(/required/);
    const k = byName(w.characters, 'Kaela Venn').id;
    expect(refused(w, [{ op: 'create', collection: 'relationships', record: { aId: k, bId: k, kind: 'friend' } }])).toMatch(/two different characters/);
    expect(refused(w, [{ op: 'create', collection: 'journeys', record: { subject: { kind: 'character', id: k }, originId: 'unknown-place', destinationId: byName(w.places, 'Varn').id, departure: '1042', modeId: 'dragon' } }])).toMatch(/not a travel mode/);
    expect(refused(w, [{ op: 'create', collection: 'mapFeatures', record: { shape: 'line', kind: 'lake', name: 'X', points: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] } }])).toMatch(/does not fit shape/);
  });

  it('a place can never be inside itself', () => {
    const w = W();
    const varn = byName(w.places, 'Varn'), keep = byName(w.places, 'Varn Keep');
    expect(keep.parentId).toBe(varn.id);
    expect(refused(w, [{ op: 'update', collection: 'places', id: varn.id, set: { parentId: keep.id } }])).toMatch(/inside itself/);
  });

  it('EU-20: a delete that takes other records with it needs cascade; the built-in place stays', () => {
    const w = W();
    const thornwick = byName(w.places, 'Thornwick');
    expect(refused(w, [{ op: 'delete', collection: 'places', id: thornwick.id }])).toMatch(/would also delete .* cascade: true/s);
    const r = ok(w, [{ op: 'delete', collection: 'places', id: thornwick.id, cascade: true }]);
    expect(r.world.places.some((p) => p.id === thornwick.id)).toBe(false);
    expect(r.world.stays.some((s) => s.placeId === thornwick.id)).toBe(false);
    expect(refused(w, [{ op: 'delete', collection: 'places', id: 'unknown-place' }])).toMatch(/cannot be deleted/);
    const tamsin = byName(w.characters, 'Tamsin Rook');
    const merged = ok(w, [{ op: 'delete', collection: 'characters', id: tamsin.id, reassignTo: byName(w.characters, 'Mira Solt').id }]);
    expect(merged.world.stays.filter((s) => s.subject.id === tamsin.id)).toEqual([]);
  });

  it('MP-8: a new river comes with its place; deleting it removes the place too', () => {
    const w = W();
    const r = ok(w, [{ op: 'create', collection: 'mapFeatures', record: { id: 'new:r', shape: 'line', kind: 'river', name: 'Coldbrook', points: [{ lat: 50, lng: 5 }, { lat: 49.5, lng: 5.5 }] } }]);
    const f = byName(r.world.mapFeatures, 'Coldbrook');
    const place = r.world.places.find((p) => p.id === f.placeId)!;
    expect(place).toMatchObject({ name: 'Coldbrook', kind: 'river' });
    const renamed = ok(r.world, [{ op: 'update', collection: 'mapFeatures', id: f.id, set: { name: 'Cold Brook' } }]);
    expect(renamed.world.places.find((p) => p.id === f.placeId)!.name).toBe('Cold Brook');
    const gone = ok(r.world, [{ op: 'delete', collection: 'mapFeatures', id: f.id }]);
    expect(gone.world.places.some((p) => p.id === f.placeId)).toBe(false);
  });

  it('changes scene text by passage (keeping links and comments) or whole, and warns what a whole rewrite drops', () => {
    const w = W();
    const scene = byName(w.scenes, 'The regent’s errand');
    const plain = docToPlain(textOf(w, scene.id)!.doc);
    const words = plain.split(/\s+/).slice(2, 6).join(' ');
    const r = ok(w, [{ op: 'text', sceneId: scene.id, find: words, replace: 'NEW WORDS HERE' }]);
    expect(docToPlain(textOf(r.world, scene.id)!.doc)).toContain('NEW WORDS HERE');
    expect(r.texts[0].before).toBe(textOf(w, scene.id)!.doc);
    expect(refused(w, [{ op: 'text', sceneId: scene.id, find: 'zzz not here', replace: 'x' }])).toMatch(/not in the scene's text/);
    const whole = ok(w, [{ op: 'text', sceneId: scene.id, replace: 'One.\n\nTwo *three*.' }]);
    expect(docToMarkdown(textOf(whole.world, scene.id)!.doc)).toBe('One.\n\nTwo *three*.');
  });

  it('paints terrain in an area and along a line', () => {
    const w = W();
    const r = ok(w, [
      { op: 'terrain', shape: 'area', points: [{ lat: 10, lng: 100 }, { lat: 10, lng: 101 }, { lat: 9, lng: 101 }, { lat: 9, lng: 100 }], land: 'land', heightM: 800, terrainType: 'Forest' },
      { op: 'terrain', shape: 'line', points: [{ lat: 9.5, lng: 100.2 }, { lat: 9.5, lng: 100.8 }], widthKm: 10, heightM: 2500 },
    ]);
    expect(r.terrain).toBe(true);
    const rd = new TerrainReader(r.world.terrain);
    expect(rd.elevation({ lat: 9.2, lng: 100.2 })).toBe(800);
    expect(rd.elevation({ lat: 9.5, lng: 100.5 })).toBeGreaterThan(2000);
    expect(refused(w, [{ op: 'terrain', shape: 'area', points: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 2 }], terrainType: 'Lava' }])).toMatch(/not one of the world's terrain types/);
  });

  it('LY-6: a border change from a date takes land from the neighbour', () => {
    const w = W();
    const ash = byName(w.regions, 'Empire of Ash');
    const saltmere = byName(w.places, 'Saltmere').location!;
    const box = [{ lat: saltmere.lat + 0.3, lng: saltmere.lng - 0.3 }, { lat: saltmere.lat + 0.3, lng: saltmere.lng + 0.3 }, { lat: saltmere.lat - 0.3, lng: saltmere.lng + 0.3 }, { lat: saltmere.lat - 0.3, lng: saltmere.lng - 0.3 }];
    const r = ok(w, [{ op: 'border', regionId: ash.id, area: box, mode: 'add', from: '1/6/1047', neighbours: 'take', note: 'Saltmere falls' }]);
    const lix = new LayerIndex(r.world);
    expect(lix.realmAt(saltmere, toDayNumber({ year: 1046, month: 1, day: 1 }))[0].region.name).toBe('Kingdom of Varn');
    expect(lix.realmAt(saltmere, toDayNumber({ year: 1048, month: 1, day: 1 })).map((c) => c.region.name)).toContain('Empire of Ash');
  });
});

describe('sample world', () => {
  it('has three example suggestions that all still fit', () => {
    const w = W();
    expect(w.suggestions.map((s) => s.title)).toEqual(['Give Oren a reason to count carts', 'A river and a forest for Emberhold', 'What if Ash takes Saltmere in 1047?']);
    for (const s of w.suggestions) expect(checkProposal(w, s, opts).errors).toEqual([]);
  });
});

describe('AI-8 proposals pass the warnings engine', () => {
  it('lists the new warnings a proposal would cause', () => {
    const w = W();
    const kaela = byName(w.characters, 'Kaela Venn');
    const p: ProposalInput = { title: 'Kaela in Emberhold too', changes: [{ op: 'create', collection: 'stays', record: { subject: { kind: 'character', id: kaela.id }, placeId: byName(w.places, 'Emberhold').id, arrival: '5/5/1042', departure: '7/5/1042' } }] };
    const c = checkProposal(w, p, opts);
    expect(c.errors).toEqual([]);
    expect(c.newWarnings.join(' ')).toMatch(/Kaela/);
  });
});

describe('AI-3 suggestions, AI-7 scenarios, AI-9 direct editing and undo', () => {
  const proposal = (w: World): ProposalInput => ({ title: 'Give Oren a title', reason: 'He is the regent\'s clerk', changes: [{ op: 'update', collection: 'characters', id: byName(w.characters, 'Oren Hask').id, set: { aliases: ['the Clerk'], notes: 'Keeps the seals.' } }] });

  it('a suggestion waits, can be accepted (one undoable step) or rejected with a note', () => {
    let w = W();
    const p = proposal(w);
    const { world, suggestion } = addSuggestion(w, p, checkProposal(w, p, opts), opts);
    expect(suggestion).toMatchObject({ number: 4, state: 'open', title: 'Give Oren a title' });
    w = world;
    const done = acceptSuggestion(w, suggestion.id, opts);
    if ('errors' in done) throw new Error(done.errors.join());
    expect(byName(done.world.characters, 'Oren Hask').notes).toBe('Keeps the seals.');
    expect(done.world.suggestions.find((x) => x.id === suggestion.id)!.state).toBe('accepted');
    expect(done.world.claudeLog[done.world.claudeLog.length - 1]).toMatchObject({ kind: 'accepted', suggestionId: suggestion.id });
    const undone = undoLogEntry(done.world, done.entry.id);
    if ('error' in undone) throw new Error(undone.error);
    expect(byName(undone.world.characters, 'Oren Hask')).toEqual(byName(w.characters, 'Oren Hask'));
    expect(undone.world.suggestions.find((x) => x.id === suggestion.id)!.state).toBe('open');
    const rejected = rejectSuggestion(w, suggestion.id, 'Not yet', 'now');
    expect(rejected.suggestions.find((x) => x.id === suggestion.id)).toMatchObject({ state: 'rejected', note: 'Not yet' });
  });

  it('accepts change by change; a change that needs a skipped one is refused', () => {
    const w0 = W();
    const p: ProposalInput = { title: 'Two', changes: [
      { op: 'create', collection: 'groups', record: { id: 'new:g', name: 'Night Watch' } },
      { op: 'create', collection: 'memberships', record: { groupId: 'new:g', characterId: byName(w0.characters, 'Oren Hask').id } },
      { op: 'create', collection: 'todos', record: { title: 'Name the watch captain' } },
    ] };
    const { world: w, suggestion } = addSuggestion(w0, p, checkProposal(w0, p, opts), opts);
    const bad = acceptSuggestion(w, suggestion.id, opts, [1]);
    expect('errors' in bad && bad.errors.join()).toMatch(/no change creates/);
    const some = acceptSuggestion(w, suggestion.id, opts, [2]);
    if ('errors' in some) throw new Error(some.errors.join());
    expect(some.world.suggestions.find((x) => x.id === suggestion.id)).toMatchObject({ state: 'open', acceptedChanges: [2] });
    const rest = acceptSuggestion(some.world, suggestion.id, opts);
    if ('errors' in rest) throw new Error(rest.errors.join());
    expect(rest.world.suggestions.find((x) => x.id === suggestion.id)!.state).toBe('accepted');
    expect(rest.world.groups.some((g) => g.name === 'Night Watch')).toBe(true);
  });

  it('AI-7: a big idea becomes a what-if scenario and canon is untouched', () => {
    const w = W();
    const p: ProposalInput = { title: 'Ash invades', asScenario: { name: 'Invasion of 1044', description: 'Ash marches on Varn' }, changes: [
      { op: 'create', collection: 'events', record: { id: 'new:e', name: 'Fall of Thornwick', kind: 'battle', start: '3/3/1044', placeId: byName(w.places, 'Thornwick').id } },
      { op: 'update', collection: 'characters', id: byName(w.characters, 'Aldric Venn').id, set: { death: '3/3/1044' } },
    ] };
    expect(checkProposal(w, p, opts).errors).toEqual([]);
    const done = applyProposal(w, p, 'accepted', opts);
    if ('errors' in done) throw new Error(done.errors.join());
    const sc = done.world.scenarios.find((s) => s.name === 'Invasion of 1044')!;
    expect(sc.description).toBe('Ash marches on Varn');
    expect(done.world.events.filter((e) => e.scenarioId === CANON).some((e) => e.name === 'Fall of Thornwick')).toBe(false);
    expect(scenarioView(done.world, sc.id).events.some((e) => e.name === 'Fall of Thornwick')).toBe(true);
    expect(byName(done.world.characters.filter((c) => c.scenarioId === CANON), 'Aldric Venn')).toBe(byName(w.characters, 'Aldric Venn'));
    expect(scenarioChanges(done.world, sc.id).map((c) => c.kind).sort()).toEqual(['added', 'changed']);
    const undone = undoLogEntry(done.world, done.entry.id);
    if ('error' in undone) throw new Error(undone.error);
    expect(undone.world.scenarios.some((s) => s.id === sc.id)).toBe(false);
  });

  it('AI-9: direct changes are logged and can be undone one by one or all at once; changed records are protected', () => {
    let w = W();
    const a = applyProposal(w, proposal(w), 'direct', opts);
    if ('errors' in a) throw new Error(a.errors.join());
    const b = applyProposal(a.world, { title: 'A to-do', changes: [{ op: 'create', collection: 'todos', record: { title: 'Check the seals' } }] }, 'direct', opts);
    if ('errors' in b) throw new Error(b.errors.join());
    w = b.world;
    const all = undoAllDirect(w);
    expect(all.undone).toBe(2);
    expect(all.world.todos.length).toBe(W().todos.length);
    // Edited by the writer since: the log refuses to undo over it.
    const oren = byName(a.world.characters, 'Oren Hask');
    const edited = { ...a.world, characters: a.world.characters.map((c) => (c.id === oren.id ? { ...c, notes: 'My own words' } : c)) };
    const r = undoLogEntry(edited, a.entry.id);
    expect('error' in r && r.error).toMatch(/Changed since: Oren Hask/);
  });
});

describe('AI-10 round trip: each kind of change leaves every other record alone and undoes cleanly', () => {
  const w = W();
  const id = (list: { id: string; name?: string; title?: string }[], name: string) => byName(list, name).id;
  const kaela = id(w.characters, 'Kaela Venn'), varn = id(w.places, 'Varn'), keep = id(w.places, 'Varn Keep');
  const minimal: Record<string, Record<string, unknown>> = {
    characters: { name: 'New person' },
    places: { name: 'New inn', kind: 'building', parentId: varn, location: { lat: 50, lng: 5 } },
    groups: { name: 'New band' },
    memberships: { groupId: id(w.groups, 'The Salt Caravan'), characterId: kaela, start: '1/1/1043' },
    stays: { subject: { kind: 'character', id: kaela }, placeId: keep, arrival: '1/1/1050', departure: '5/1/1050' },
    journeys: { subject: { kind: 'character', id: kaela }, originId: keep, destinationId: varn, departure: '6/1/1050', modeId: 'horse' },
    books: { title: 'Book two', order: 2 },
    chapters: { bookId: id(w.books, 'The Salt Roads'), title: 'Epilogue', order: 9 },
    scenes: { chapterId: w.chapters[0].id, title: 'Coda', order: 9, characterIds: [kaela] },
    threads: { name: 'Thread' },
    events: { name: 'Feast', kind: 'festival', start: 'summer 1050' },
    relationships: { aId: kaela, bId: id(w.characters, 'Oren Hask'), kind: 'friend' },
    secrets: { title: 'Hidden', knowers: [{ characterId: kaela, from: '1050' }] },
    regionLayers: { name: 'Magic', type: 'magic', overlaps: true },
    regions: { layerId: 'layer-culture', name: 'Hill folk', versions: [{ area: [[[[5, 50], [6, 50], [6, 51], [5, 50]]]] }] },
    mapFeatures: { shape: 'area', kind: 'forest', name: 'Dark wood', points: [{ lat: 50, lng: 5 }, { lat: 50, lng: 6 }, { lat: 51, lng: 6 }] },
    mapSymbols: { kind: 'peak', location: { lat: 50, lng: 5 } },
    mapLayers: { name: 'Sketch' },
    detailMaps: { name: 'Inn', kind: 'city', north: 50.1, south: 50, west: 5, east: 5.1 },
    todos: { title: 'Check' },
    notes: { title: 'Idea' },
    setups: { title: 'A clue', setupSceneId: w.scenes[0].id },
    arcs: { characterId: kaela, bookId: id(w.books, 'The Salt Roads'), turns: [{ sceneId: w.scenes[0].id, note: 'x' }] },
    passes: { bookId: id(w.books, 'The Salt Roads'), name: 'Dialogue', done: [w.chapters[0].id] },
    submissions: { bookId: id(w.books, 'The Salt Roads'), to: 'An agent', sentOn: '2026-11-01' },
  };
  for (const c of CLAUDE_COLLECTIONS) {
    it(`${c}: create, update, delete`, () => {
      const created = applyProposal(w, { title: `create ${c}`, changes: [{ op: 'create', collection: c, record: { id: 'new:x', ...minimal[c] } }] }, 'direct', opts);
      if ('errors' in created) throw new Error(created.errors.join('\n'));
      const newId = created.result.ids['new:x'];
      // Every record that existed before is the very same object afterwards (copy-on-write), except a new feature's place.
      for (const col of CLAUDE_COLLECTIONS) {
        const before = (w as unknown as Record<string, unknown[]>)[col];
        const after = (created.world as unknown as Record<string, unknown[]>)[col];
        for (const r of before) expect(after.includes(r), `${c} create changed a ${col} record`).toBe(true);
      }
      const updated = applyProposal(created.world, { title: 'u', changes: [{ op: 'update', collection: c, id: newId, set: { status: 'draft' } }] }, 'direct', opts);
      if ('errors' in updated) throw new Error(updated.errors.join('\n'));
      const deleted = applyProposal(updated.world, { title: 'd', changes: [{ op: 'delete', collection: c, id: newId }] }, 'direct', opts);
      if ('errors' in deleted) throw new Error(deleted.errors.join('\n'));
      // Undo everything: back to the world as it was, record for record.
      const back = undoAllDirect(deleted.world);
      expect(back.error).toBeUndefined();
      expect(back.undone).toBe(3);
      const strip = (x: World) => JSON.stringify({ ...x, claudeLog: [], suggestions: [], terrain: null });
      expect(strip(back.world)).toBe(strip(w));
    });
  }

  it('suggestions and the activity log are saved in the world file', async () => {
    const p: ProposalInput = { title: 'Save me', changes: [{ op: 'create', collection: 'todos', record: { title: 'x' } }] };
    const { world } = addSuggestion(w, p, checkProposal(w, p, opts), opts);
    const done = acceptSuggestion(world, world.suggestions[world.suggestions.length - 1].id, opts);
    if ('errors' in done) throw new Error(done.errors.join());
    const back = (await loadWorldFile(await worldToBytes(done.world))).world;
    expect(back.suggestions).toEqual(done.world.suggestions);
    expect(back.claudeLog).toEqual(done.world.claudeLog);
  });
});

describe('AI-2 live world tools (MCP)', () => {
  const w = W();
  const proposals: ProposalInput[] = [];
  const env: McpEnv = { world: w, warnings: (sid) => checkWorld(scenarioView(w, sid)), propose: (p) => { proposals.push(p); return 'Suggestion #1 is waiting.'; }, directEdit: false, opts, appVersion: 'test' };
  const call = (method: string, params?: object, id: number | undefined = 1) => JSON.parse(handleMcp(JSON.stringify({ jsonrpc: '2.0', id, method, params }), env) || 'null');
  const tool = (name: string, args: object) => call('tools/call', { name, arguments: args }).result as { content: { text: string }[]; isError?: boolean };

  it('speaks MCP: initialize, notifications, tools/list, errors', () => {
    const init = call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'story-world' } });
    expect(handleMcp(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), env)).toBe('');
    const names = call('tools/list').result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search', 'get_record', 'where_is', 'scene', 'warnings', 'reader_knows', 'travel_time', 'realm_at', 'data_model', 'check_changes', 'propose_changes', 'suggestions']));
    expect(call('nope').error.code).toBe(-32601);
    expect(JSON.parse(handleMcp('{bad', env)).error.code).toBe(-32700);
  });

  it('answers questions from the world with the app\'s rules', () => {
    expect(tool('search', { query: 'Thornwick' }).content[0].text).toContain('Thornwick');
    expect(tool('where_is', { date: '5/5/1042', characterId: byName(w.characters, 'Kaela Venn').id }).content[0].text).toMatch(/Kaela Venn .*: at Thornwick/);
    expect(tool('get_record', { id: byName(w.places, 'Thornwick').id }).content[0].text).toMatch(/Referred to by \d+ record/);
    expect(tool('realm_at', { placeId: byName(w.places, 'Thornwick').id, date: '1/1/1045' }).content[0].text).toMatch(/Empire of Ash/);
    expect(tool('travel_time', { fromPlaceId: byName(w.places, 'Varn').id, toPlaceId: byName(w.places, 'Saltmere').id, modeId: 'horse' }).content[0].text).toMatch(/about \d+ km.*days/);
    expect(tool('reader_knows', { chapterId: w.chapters[0].id }).content[0].text).toMatch(/Characters: .*Kaela/);
    expect(tool('scene', { sceneId: byName(w.scenes, 'The regent’s errand').id }).content[0].text).toMatch(/When: .*1042/);
    expect(tool('warnings', {}).content[0].text).toContain('impossible-travel');
    expect(tool('data_model', { collection: 'journeys' }).content[0].text).toContain('modeId');
    const bad = tool('where_is', { date: 'next Tuesday' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/day\/month\/year/);
  });

  it('checks proposals and hands good ones to the app', () => {
    const r = tool('check_changes', { title: 't', changes: [{ op: 'delete', collection: 'places', id: byName(w.places, 'Thornwick').id }] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Refused:.*cascade/s);
    expect(tool('propose_changes', { title: 'Oren', changes: [{ op: 'update', collection: 'characters', id: byName(w.characters, 'Oren Hask').id, set: { notes: 'x' } }] }).content[0].text).toContain('waiting');
    expect(proposals.length).toBe(1);
  });
});
