/** A small invented world to try the app with. Contains a few deliberate problems to show warnings. */
import {
  Character, Journey, LatLng, ManuscriptLink, MapFeature, Paragraph, Place, Stay, World, exactDate as d, featureAnchor,
  makeAnchor, textHash, toDayNumber, traceRiver,
} from '../core';
import { nowIso } from '../storage';
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
  const saltmere = place('Saltmere', 'port', 45.8, 12.9);
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
  const book = { ...recordBase(), title: 'The Salt Roads', order: 1, notes: '' };
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
    { ...recordBase(), kind: 'reeds', location: { lat: 45.95, lng: 11.1 }, size: 0.8 },
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

  w.settings.currentMoment = toDayNumber({ year: 1042, month: 5, day: 5 });
  return w;
}
