/** A small invented world to try the app with. Contains a few deliberate problems to show warnings. */
import { Character, Journey, Place, Stay, World, exactDate as d, toDayNumber } from '../core';
import { createEmptyWorld, recordBase } from '../storage';

export function sampleWorld(): World {
  const w = createEmptyWorld('Sample: The Salt Roads');
  const place = (name: string, kind: Place['kind'], lat?: number, lng?: number, parentId?: string): Place => {
    const p: Place = { ...recordBase(), name, aliases: [], kind, parentId, location: lat !== undefined ? { lat, lng: lng! } : undefined, notes: '', isPlaceholder: false };
    w.places.push(p);
    return p;
  };
  const varn = place('Varn', 'city', 48.2, 11.5);
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

  w.settings.currentMoment = toDayNumber({ year: 1042, month: 5, day: 5 });
  return w;
}
