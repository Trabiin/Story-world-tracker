/** A small invented world to try the app with. Contains a few deliberate problems to show warnings. */
import {
  Book, Character, Journey, LatLng, ManuscriptLink, MapFeature, Paragraph, Place, Relationship, Stay, World, WorldEvent, exactDate as d, featureAnchor,
  makeAnchor, textHash, toDayNumber, traceRiver, Region, editRegionArea, polygonFromPoints, subtractArea, PlotThread, Scene, newScenario, overlayId,
  Block, Run, TextComment, blocksToDoc, docToBlocks, docWords, addDays, dayKey,
} from '../core';
import { newId, nowIso } from '../storage';
import { createEmptyWorld, recordBase } from '../storage';
import { sampleTerrain } from './sampleTerrain';

export function sampleWorld(): World {
  const w = createEmptyWorld('Sample: The Salt Roads');
  const place = (name: string, kind: Place['kind'], lat?: number, lng?: number, parentId?: string): Place => {
    const p: Place = { ...recordBase(), name, aliases: [], kind, parentId, location: lat !== undefined ? { lat, lng: lng! } : undefined, notes: '', isPlaceholder: false };
    w.places.push(p);
    return p;
  };
  const varn = place('Varn', 'capital', 48.2, 11.5);
  const keep = place('Varn Keep', 'castle', undefined, undefined, varn.id);
  const hall = place('Hall of Lamps', 'room', undefined, undefined, keep.id);
  const thornwick = place('Thornwick', 'town', 47.4, 13.6);
  const saltmere = place('Saltmere', 'port', 45.65, 12.52);
  const ashford = place('Ashford', 'village', 48.0, 14.3);
  const ember = place('Emberhold', 'city', 44.5, 17.5);

  const char = (name: string, color: string, icon: string, importance: Character['importance'], birth?: [number, number, number], tags: string[] = []): Character => {
    const c: Character = { ...recordBase(), name, aliases: [], description: '', notes: '', tags, color, icon, importance, archived: false, birth: birth ? d(...birth) : undefined };
    w.characters.push(c);
    return c;
  };
  const kaela = char('Kaela Venn', '#d1495b', '★', 'main', [1020, 3, 14], ['POV']);
  const oren = char('Oren Hask', '#2e86ab', '⚔', 'main', [1015, 9, 2], ['POV']);
  const mira = char('Mira Solt', '#3c9d5d', '☾', 'secondary', [1024, 1, 30]);
  const tamsin = char('Tamsin Rook', '#8e5ea2', '♛', 'minor');

  const caravan = { ...recordBase(), name: 'The Salt Caravan', description: 'Traders on the southern road', color: '#edae49' };
  w.groups.push(caravan);
  w.memberships.push({ ...recordBase(), groupId: caravan.id, characterId: oren.id, start: d(1042, 5, 1) });
  w.memberships.push({ ...recordBase(), groupId: caravan.id, characterId: mira.id, start: d(1042, 5, 1), end: d(1042, 5, 12) });

  const stay = (who: { id: string }, p: Place, a: Stay['arrival'], dep?: Stay['departure'], purpose = '', group = false) =>
    w.stays.push({ ...recordBase(), subject: { kind: group ? 'group' : 'character', id: who.id }, placeId: p.id, arrival: a, departure: dep, purpose, notes: '' });
  const journey = (who: { id: string }, from: Place, to: Place, dep: Journey['departure'], arr: Journey['arrival'], modeId: string, purpose = '', group = false) =>
    w.journeys.push({ ...recordBase(), subject: { kind: group ? 'group' : 'character', id: who.id }, originId: from.id, destinationId: to.id, waypointIds: [], departure: dep, arrival: arr, modeId, purpose, notes: '' });

  // Kaela: Varn → Thornwick → Saltmere
  stay(kaela, hall, { year: 1042, precision: 'season', season: 'spring', part: 'early' }, d(1042, 4, 28), 'serving the regent');
  journey(kaela, varn, thornwick, d(1042, 4, 28), d(1042, 5, 3), 'horse', 'carrying the sealed letter');
  stay(kaela, thornwick, d(1042, 5, 3), d(1042, 5, 9), 'waiting for Oren');
  journey(kaela, thornwick, saltmere, d(1042, 5, 9), undefined, 'horse');
  stay(kaela, saltmere, d(1042, 5, 15), undefined, 'hiding at the harbour');

  // The caravan (Oren and Mira travel with it)
  stay(caravan, ashford, d(1042, 4, 25), d(1042, 5, 2), 'loading salt', true);
  journey(caravan, ashford, thornwick, d(1042, 5, 2), d(1042, 5, 6), 'cart', 'southern road', true);
  stay(caravan, thornwick, d(1042, 5, 6), d(1042, 5, 12), 'market days', true);
  journey(caravan, thornwick, ember, d(1042, 5, 12), d(1042, 6, 10), 'cart', 'the long road east', true);
  // Mira leaves the caravan at Thornwick
  stay(mira, thornwick, d(1042, 5, 12), d(1042, 6, 1), 'stays behind to nurse her father');

  // Tamsin: deliberate problems — impossible ride, and a jump with no journey
  stay(tamsin, varn, d(1042, 5, 1), d(1042, 5, 4), 'spying on the keep');
  journey(tamsin, varn, ember, d(1042, 5, 4), d(1042, 5, 6), 'horse', 'urgent message');
  stay(tamsin, ember, d(1042, 5, 6), d(1042, 5, 10));
  stay(tamsin, saltmere, d(1042, 5, 18), d(1042, 5, 25));

  oren.attributes = [
    { id: crypto.randomUUID(), key: 'title', value: 'Caravan master', start: { year: 1038, precision: 'year' } },
    { id: crypto.randomUUID(), key: 'allegiance', value: 'Salt Guild' },
  ];

  // Story structure (ST-1, ST-2)
  const book: Book = { ...recordBase(), title: 'The Salt Roads', order: 1, notes: '' };
  w.books.push(book);
  const ch1 = { ...recordBase(), bookId: book.id, title: 'Chapter 1: The Sealed Letter', order: 1, povCharacterId: kaela.id, notes: '' };
  const ch2 = { ...recordBase(), bookId: book.id, title: 'Chapter 2: Market Days', order: 2, povCharacterId: oren.id, notes: '' };
  w.chapters.push(ch1, ch2);
  w.scenes.push(
    { ...recordBase(), chapterId: ch1.id, title: 'The regent’s errand', order: 1, start: d(1042, 4, 27), characterIds: [], summary: 'Kaela is handed the sealed letter in the Hall of Lamps.' },
    { ...recordBase(), chapterId: ch1.id, title: 'Riding south', order: 2, start: d(1042, 4, 30), characterIds: [], summary: 'On the road to Thornwick.' },
    { ...recordBase(), chapterId: ch2.id, title: 'Carts at the gate', order: 1, start: d(1042, 5, 7), characterIds: [kaela.id, mira.id], summary: 'Oren meets Kaela at the Thornwick market.' },
  );

  // A short sample manuscript, as if read from a Word file (ST-8..ST-10)
  const paragraphs: Paragraph[] = [
    { text: 'Chapter 1: The Sealed Letter', heading: 1 },
    { text: 'The lamps in the Hall of Lamps were never allowed to go out, and so Kaela Venn had learned to read faces by their light. The regent’s face that morning told her nothing at all.' },
    { text: '“Thornwick,” he said, and pressed the letter into her hand. “Before the market closes. Give it to no one but Oren Hask.”' },
    { text: 'She left Varn on the twenty-eighth, with the seal against her ribs and the gates closing behind her.' },
    { text: 'Chapter 2: Market Days', heading: 1 },
    { text: 'Oren Hask counted carts the way other men counted debts. Forty-one had come down the southern road from Ashford, and every one of them was late.' },
    { text: 'Mira Solt found him at the gate, already arguing with the toll-keeper about the price of salt.' },
  ];
  const ms = { ...recordBase(), name: 'Salt Roads – draft 1', paragraphs, textHash: textHash(paragraphs), loadedAt: nowIso() };
  w.manuscripts.push(ms);
  const link = (pi: number, quote: string, target: ManuscriptLink['target']) => {
    const k = paragraphs[pi].text.indexOf(quote);
    w.links.push({ ...recordBase(), manuscriptId: ms.id, anchor: makeAnchor(paragraphs, pi, k, k + quote.length), target, note: '', state: 'ok' });
  };
  link(1, 'Hall of Lamps', { kind: 'place', id: hall.id });
  link(3, 'She left Varn on the twenty-eighth', { kind: 'journey', id: w.journeys[0].id });
  link(5, 'Oren Hask counted carts', { kind: 'character', id: oren.id });
  link(6, 'Mira Solt found him at the gate', { kind: 'scene', id: w.scenes[2].id });

  // A painted continent (Phase 2), with a few hand-placed symbols.
  w.terrain = sampleTerrain();
  w.mapSymbols.push(
    { ...recordBase(), kind: 'volcano', location: { lat: 45.2, lng: 18.6 }, size: 1.3 },
    { ...recordBase(), kind: 'dunes', location: { lat: 44.9, lng: 15.3 }, size: 1 },
    { ...recordBase(), kind: 'reeds', location: { lat: 46.78, lng: 10.05 }, size: 0.8 },
  );
  w.settings.mainMap = { north: 54, south: 40, west: 3, east: 24 };

  // Rivers, a lake and roads (Phase 2b). Rivers are traced downhill like the Automatic river tool.
  const feature = (f: Omit<MapFeature, 'id' | 'scenarioId' | 'status' | 'createdAt' | 'updatedAt' | 'placeId' | 'notes'>): MapFeature => {
    const placeKind = f.kind === 'river' ? 'river' : f.kind === 'lake' ? 'lake' : f.shape === 'line' ? 'road' : 'area';
    const mf: MapFeature = { ...recordBase(), notes: '', ...f };
    const p = place(f.name, placeKind, featureAnchor(mf)?.lat, featureAnchor(mf)?.lng);
    mf.placeId = p.id;
    w.mapFeatures.push(mf);
    return mf;
  };
  const river = (name: string, source: LatLng) => {
    const t = traceRiver(w, source);
    w.terrain = t.terrain;
    return feature({ shape: 'line', kind: 'river', name, points: t.points, auto: true, joinsId: t.joinsId });
  };
  river('The Sallow', { lat: 49.0, lng: 11.0 });
  const mere = feature({
    shape: 'area', kind: 'lake', name: 'Glass Mere',
    points: [[49.05, 13.0], [49.05, 13.4], [48.85, 13.5], [48.72, 13.3], [48.78, 13.0]].map(([lat, lng]) => ({ lat, lng })),
  });
  const glass = river('Glassrun', { lat: 48.9, lng: 13.2 });
  mere.outletId = glass.id;
  river('Greywater', { lat: 49.9, lng: 12.0 });
  river('The Ember', { lat: 49.1, lng: 15.0 });
  // Towns grow up by water (RC-11): springs in Varn and Thornwick feed small rivers. Emberhold has none, on purpose.
  const lampwell = river('Lampwell', varn.location!);
  lampwell.spring = true;
  river('Thorn Brook', thornwick.location!);
  // A deliberate problem for the one-click fixes (RC-4, MK-23): a pond in the reeds with no outlet.
  feature({
    shape: 'area', kind: 'lake', name: 'Reed Pool',
    points: [[46.85, 9.9], [46.87, 10.15], [46.72, 10.2], [46.7, 9.95]].map(([lat, lng]) => ({ lat, lng })),
  });
  const road = (name: string, kind: 'road' | 'trade-route', ...stops: Place[]) =>
    feature({ shape: 'line', kind, name, points: stops.map((p) => p.location!), stops: stops.map((p) => p.id) });
  road('King\'s Road', 'road', varn, thornwick, ashford);
  road('Salt Road', 'road', thornwick, saltmere);
  road('Ember Way', 'trade-route', saltmere, ember);

  // Detail maps (Phase 2c): the heartland region and the city of Varn, with its wall and keep.
  keep.location = { lat: 48.212, lng: 11.497 };
  const ring = Array.from({ length: 13 }, (_, i) => ({ lat: 48.2 + 0.03 * Math.sin((i / 12) * 2 * Math.PI), lng: 11.5 + 0.045 * Math.cos((i / 12) * 2 * Math.PI) }));
  feature({ shape: 'line', kind: 'wall', name: 'Varn city wall', points: ring });
  w.detailMaps.push(
    { ...recordBase(), name: 'The Heartland', kind: 'region', north: 49.4, south: 45.2, west: 9.6, east: 15.4, notes: '' },
    { ...recordBase(), name: 'Varn', kind: 'city', north: 48.25, south: 48.15, west: 11.42, east: 11.58, placeId: varn.id, notes: '' },
  );

  // Realms, faiths and cultures over time (Phase 3). Thornwick passes from Varn to Ash in a conquest in 1044.
  const poly = (...pts: [number, number][]) => polygonFromPoints(pts.map(([lat, lng]) => ({ lat, lng })));
  const region = (layerId: string, name: string, color: string, area: ReturnType<typeof poly>, extra: Partial<Region> = {}): Region => {
    const r: Region = { ...recordBase(), layerId, name, color, versions: [{ id: newId(), area }], overlords: [], ties: [], entry: '', ...extra };
    w.regions.push(r);
    return r;
  };
  const ost = poly([55, 3], [55, 9.2], [50.6, 9.8], [49.4, 8.6], [49.2, 3]);
  const varnRealm = region('layer-political', 'Kingdom of Varn', '#c0504d',
    subtractArea(poly([55, 3], [55, 15.3], [51, 15.8], [48.5, 15.2], [46, 15.9], [40, 15.6], [40, 3]), ost),
    { start: d(1001, 3, 1), entry: 'Founded in 1001 when the river lords swore to the first king at Varn. The crown passes to the eldest child; a regent rules while the heir is young.' });
  const ash = region('layer-political', 'Empire of Ash', '#6b5b95',
    poly([55, 15.3], [55, 24], [40, 24], [40, 15.6], [46, 15.9], [48.5, 15.2], [51, 15.8]),
    { entry: 'An old empire of the eastern hills, ruled from Emberhold. It wants the salt of the gulf.', ties: [{ id: newId(), characterId: tamsin.id, role: 'agent', start: d(1040, 1, 1) }] });
  region('layer-political', 'Duchy of Ost', '#d98c5f', ost, {
    start: d(1001, 3, 1),
    overlords: [{ id: newId(), regionId: varnRealm.id, relation: 'part' }],
    entry: 'The northern march, held for the crown by the dukes of Ost.',
  });
  const conquered = poly([52.5, 12.8], [49.5, 13.1], [47.9, 12.6], [46.6, 13.1], [46.6, 16], [52.5, 16]);
  const after = editRegionArea(w, { regionId: ash.id, area: conquered, op: 'add', from: d(1044, 6, 1), neighbours: 'take', note: 'The Ash conquest of the east march', newId });
  w.regions = after.regions;
  region('layer-religion', 'Old Faith', '#4f81bd', poly([55, 3], [55, 14.2], [40, 14.2], [40, 3]), { entry: 'The lamps must never go out.' });
  const sun = region('layer-religion', 'Sun Faith', '#e9a23b', poly([55, 11.2], [55, 24], [40, 24], [40, 11.2]), { entry: 'The sun sees every oath.' });
  sun.versions[0].intensity = 70;
  sun.versions.push({ id: newId(), start: d(1050, 1, 1), area: poly([55, 8.5], [55, 24], [40, 24], [40, 8.5]), intensity: 80, note: 'Spreads west after the conquest' });
  region('layer-culture', 'Northern culture', '#2c9faf', poly([55, 3], [55, 24], [48.7, 24], [48.4, 3]));
  w.regionLayers = w.regionLayers.map((l) => (l.type === 'culture' || l.type === 'religion' ? { ...l, visible: false } : l));
  w.settings.layerPresets = [{ id: newId(), name: 'politics + religion', visibleLayerIds: ['layer-political', 'layer-religion'] }];

  // Phase 4a: family and other relationships (CH-4, EU-11), world events (TL-5), a relative date (TL-4) and a secret (CH-8).
  const aldric = char('Aldric Venn', '#6d597a', '✦', 'minor', [990, 6, 1]);
  aldric.death = d(1039, 11, 2);
  const sera = char('Sera Venn', '#b5838d', '✦', 'minor', [994, 2, 11]);
  const bram = char('Bram Venn', '#e07a5f', '♞', 'minor', [1023, 8, 19]);
  const tobin = char('Tobin Solt', '#588157', '✚', 'minor', [995, 4, 4]);
  tobin.attributes = [{ id: crypto.randomUUID(), key: 'health', value: 'fever', start: d(1042, 5, 1), end: d(1042, 6, 1) }];
  const rel = (a: Character, b: Character, kind: Relationship['kind'], extra: Partial<Relationship> = {}) =>
    w.relationships.push({ ...recordBase(), aId: a.id, bId: b.id, kind, notes: '', ...extra });
  rel(aldric, sera, 'spouse', { start: d(1018, 5, 1), end: aldric.death });
  rel(aldric, kaela, 'parent'); rel(sera, kaela, 'parent');
  rel(aldric, bram, 'parent'); rel(sera, bram, 'parent');
  rel(tobin, mira, 'parent');
  rel(oren, mira, 'mentor', { start: d(1040, 1, 1), notes: 'Taught her the salt trade' });
  rel(kaela, oren, 'ally', { start: d(1042, 5, 7) });
  rel(tamsin, kaela, 'rival', { notes: 'Both want the regent’s trust' });

  const council: WorldEvent = { ...recordBase(), name: 'The Regent’s Council', kind: 'other', start: d(1042, 4, 27), placeId: hall.id, characterIds: [kaela.id], description: 'The regent decides to send the sealed letter south.' };
  const fair: WorldEvent = { ...recordBase(), name: 'Thornwick Salt Fair', kind: 'festival', start: d(1030, 5, 6), end: d(1030, 5, 12), yearly: true, placeId: thornwick.id, characterIds: [], description: 'A week of salt trading every spring.' };
  const eclipse: WorldEvent = { ...recordBase(), name: 'Eclipse over Saltmere', kind: 'eclipse', start: d(1042, 5, 20), placeId: saltmere.id, characterIds: [kaela.id, tamsin.id], description: 'The harbour goes dark at noon. Kaela and Tamsin both see it.' };
  w.events.push(council, fair, eclipse);
  // TL-4: Kaela leaves "the day after the Regent's Council"; move the council and her departure follows.
  const after1 = { kind: 'event' as const, id: council.id, days: 1 };
  w.stays[0] = { ...w.stays[0], departure: { ...d(1042, 4, 28), rel: after1 } };
  w.journeys[0] = { ...w.journeys[0], departure: { ...d(1042, 4, 28), rel: after1 } };
  w.secrets.push({
    ...recordBase(), title: 'The sealed letter names the heir', description: 'The regent’s letter names Bram Venn as heir.', knowers: [
      { id: crypto.randomUUID(), characterId: kaela.id, from: d(1042, 4, 27), how: 'handed the letter by the regent' },
      { id: crypto.randomUUID(), characterId: tamsin.id, from: d(1042, 5, 3), how: 'overhears it in the keep' },
      { id: crypto.randomUUID(), characterId: oren.id, from: d(1042, 5, 7), how: 'Kaela tells him at the market' },
    ],
  });
  w.settings.timelineSky = { events: true, seasons: true, moon: true, holidays: true };

  // Phase 4b: a third chapter with a flashback and a parallel scene (ST-4, ST-5), plot threads (ST-3),
  // a what-if (ST-7), a plan (WH-11) and incidents on the way (WH-10).
  const ch3 = { ...recordBase(), bookId: book.id, title: 'Chapter 3: Two Roads', order: 3, notes: '' };
  w.chapters.push(ch3);
  const keepNight: Scene = { ...recordBase(), chapterId: ch3.id, title: 'The keep at night', order: 1, start: d(1042, 5, 3), povCharacterId: tamsin.id, characterIds: [], summary: 'Tamsin overhears who the letter names.' };
  const saltWind: Scene = { ...recordBase(), chapterId: ch3.id, title: 'Salt on the wind', order: 2, start: d(1042, 5, 7), povCharacterId: mira.id, characterIds: [oren.id], summary: 'The same morning at the gate, as Mira sees it.' };
  const heir: Scene = { ...recordBase(), chapterId: ch3.id, title: 'The heir’s letter', order: 3, start: d(1042, 5, 16), povCharacterId: kaela.id, characterIds: [], summary: 'Kaela opens the letter at the harbour.' };
  w.scenes.push(keepNight, saltWind, heir);
  const thread = (name: string, color: string, characterIds: string[], extra: Partial<PlotThread> = {}): PlotThread => {
    const t: PlotThread = { ...recordBase(), name, color, description: '', characterIds, ...extra };
    w.threads.push(t);
    return t;
  };
  const letter = thread('The sealed letter', '#c0504d', [kaela.id], { description: 'Kaela carries the regent’s letter south.' });
  const trade = thread('The salt trade', '#4f81bd', [oren.id, mira.id]);
  const spy = thread('Tamsin’s spying', '#8064a2', [tamsin.id], { parentId: letter.id, rejoinsId: letter.id });
  const tag = (sc: Scene, ...ts: PlotThread[]) => { sc.threadIds = ts.map((t) => t.id); };
  const [s1, s2, s3] = w.scenes;
  tag(s1, letter); tag(s2, letter); tag(s3, letter, trade); tag(keepNight, spy); tag(saltWind, trade); tag(heir, letter);
  w.settings.savedViews = [{ id: crypto.randomUUID(), name: 'The sealed letter', filter: { threadId: letter.id, drafts: 'show' }, view: 'timeline' }];

  const whatIf = { ...newScenario(recordBase(), 'What if Mira stays with the caravan?'), description: 'Mira never stops at Thornwick and rides east with Oren.' };
  const miraStay = w.stays.find((x) => x.subject.id === mira.id)!;
  const miraMember = w.memberships.find((m) => m.characterId === mira.id)!;
  whatIf.hidden.push(`stays:${miraStay.id}`);
  const { end: _end, ...staysOn } = miraMember;
  void _end;
  w.memberships.push({ ...staysOn, id: overlayId(whatIf.id, miraMember.id), scenarioId: whatIf.id });
  w.scenarios.push(whatIf);

  kaela.plans = [{ id: crypto.randomUUID(), placeId: ember.id, from: d(1042, 5, 16), by: d(1042, 7, 1), note: 'find the heir’s guardian' }];
  w.journeys[0].incidents = [{ id: crypto.randomUUID(), day: 3, title: 'A lame horse', note: 'She walks the last stretch.' }];
  w.journeys[3].incidents = [{ id: crypto.randomUUID(), day: 9, title: 'Bandits at the ford', note: '' }, { id: crypto.randomUUID(), day: 21, title: 'Spring floods', note: '' }];

  // Phase 4c: to-dos and plot holes (EU-14) and a character template (EU-3).
  w.todos.push(
    { ...recordBase(), title: 'How does Tamsin reach Emberhold in two days?', note: 'Either give her a faster way to travel or move her departure earlier.', kind: 'plot-hole', done: false, refs: [{ kind: 'character', id: tamsin.id }, { kind: 'place', id: ember.id }] },
    { ...recordBase(), title: 'Decide who forged the regent’s seal', note: '', kind: 'todo', done: false, refs: [{ kind: 'secret', id: w.secrets[0].id }] },
    { ...recordBase(), title: 'Describe the Thornwick market', note: 'Smells, stalls, the toll-keeper.', kind: 'todo', done: true, refs: [{ kind: 'place', id: thornwick.id }, { kind: 'chapter', id: ch2.id }] },
  );
  w.settings.characterTemplates = [{ id: crypto.randomUUID(), name: 'Caravan hand', tags: ['Salt Guild'], importance: 'minor', color: '#edae49', icon: '●', description: 'Drives carts on the southern road.', attributes: [{ key: 'allegiance', value: 'Salt Guild' }], groupIds: [caravan.id] }];

  // Phase 6a: the manuscript written in the app (WR-1). _words_ are italic; a comment and a link show how imports look.
  const para = (t: string, extra?: Partial<Run>): Run[] => t.split(/(_[^_]+_)/).filter(Boolean).map((x) => (x.startsWith('_') ? { text: x.slice(1, -1), italic: true, ...extra } : { text: x, ...extra }));
  const sceneText = (scene: Scene, blocks: Block[], comments?: TextComment[]) => {
    const doc = blocksToDoc(blocks);
    w.sceneTexts.push({ ...recordBase(), sceneId: scene.id, doc, words: docWords(doc), ...(comments ? { comments } : {}) });
  };
  const P = (t: string): Block => ({ kind: 'p', runs: para(t) });
  const commentId = crypto.randomUUID();
  sceneText(s1, [
    { kind: 'p', runs: [{ text: 'The lamps in the ' }, { text: 'Hall of Lamps', link: { kind: 'place', id: hall.id } }, { text: ' were never allowed to go out, and so Kaela Venn had learned to read faces by their light. The regent’s face that morning told her nothing at all.' }] },
    P('“Thornwick,” he said, and pressed the letter into her hand. “Before the market closes. Give it to no one but Oren Hask.”'),
    P('She turned the letter over. The seal was the regent’s own, the wax still soft at the edges, and it was _heavier_ than a letter had any right to be.'),
    { kind: 'p', runs: [{ text: '“And if Oren Hask is not there?”' }, { text: ' “Then you wait,” the regent said.', comments: [commentId] }] },
  ], [{ id: commentId, author: 'Ojon', text: 'Too abrupt? Let him hesitate first.' }]);
  sceneText(s2, [
    P('She left Varn on the twenty-eighth, with the seal against her ribs and the gates closing behind her.'),
    P('By the third day the horse was limping, and Kaela walked beside it through the river mist, counting milestones the way her father had taught her.'),
    { kind: 'break' },
    P('Thornwick showed itself at dusk: a smudge of smoke, a bell, the smell of salt carried up from the pans.'),
  ]);
  sceneText(s3, [
    P('Oren Hask counted carts the way other men counted debts. Forty-one had come down the southern road from Ashford, and every one of them was late.'),
    P('Mira Solt found him at the gate, already arguing with the toll-keeper about the price of salt. “You’ll have a visitor,” she said. “From Varn. She rides like she owes someone money.”'),
  ]);
  sceneText(keepNight, [P('Tamsin had not meant to listen. But the keep was old, and its walls carried voices the way a well carries an echo, and the name she heard was _Bram_.')]);
  sceneText(saltWind, [P('The same grey morning, from the other side of the gate: Mira watched Oren lose his temper over a toll of two coppers, and wondered what he was really waiting for.')]);
  sceneText(heir, [P('At the harbour, with the gulls quarrelling over the fish market, Kaela broke the seal.')]);

  // Phase 6b: scene stages (WR-13), a word goal and deadline for the book, a daily goal and some days of writing (WR-12),
  // and an inline link to a realm typed with @ (WR-11).
  const stages: Scene['stage'][] = ['revised', 'first-draft', 'first-draft', 'outlined', 'idea', 'idea'];
  [s1, s2, s3, keepNight, saltWind, heir].forEach((sc, i) => { sc.stage = stages[i]; });
  const today = dayKey();
  book.wordGoal = 90000;
  book.deadline = addDays(today, 120);
  w.settings.writing = { ...w.settings.writing, dailyGoal: 500 };
  const pattern = [620, 0, 410, 530, 880, 0, 0, 350, 510, 700, 240, 0, 560, 505, 0, 720, 300, 0, 0, 450, 515, 610, 90, 0, 530, 680, 540, 0, 400, 520];
  pattern.forEach((words, i) => { if (words) w.writingDays.push({ id: addDays(today, -(pattern.length - i)), scenarioId: 'canon', added: words + 40, removed: 40 }); });
  w.writingDays.push({ id: today, scenarioId: 'canon', added: 260, removed: 25 });
  const t3 = w.sceneTexts.find((t) => t.sceneId === s3.id)!;
  t3.doc = blocksToDoc([...docToBlocks(t3.doc), { kind: 'p', runs: [{ text: '“A courier from the ' }, { text: 'Kingdom of Varn', link: { kind: 'region', id: varnRealm.id } }, { text: '? Then the regent is frightened.”' }] }]);
  t3.words = docWords(t3.doc);

  w.settings.currentMoment = toDayNumber({ year: 1042, month: 5, day: 5 });
  return w;
}
