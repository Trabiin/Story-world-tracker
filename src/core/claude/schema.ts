/**
 * AI-10: the data model as Claude sees it. Every record type, every field, what each field refers to
 * and what a record cannot live without. The guide file (CLAUDE.md, guide/data-model.md), the
 * connector's data_model tool and the proposal checks (validate.ts) are all built from this one
 * description, so they cannot drift apart.
 *
 * The specs are typed against the model (types.ts): adding a field to a record type without
 * describing it here is a compile error, so the guide never falls out of date.
 */
import type {
  ArcTurn, Beat, CharacterArc, RevisionPass, Setup, Book, Chapter, Character, CharacterAttribute, DetailMap, Group, Incident, Journey, Knower, MapFeature, MapLayer, MapSymbol, Membership, Picture, Place,
  Note, Plan, PlotThread, RecordBase, Region, RegionLayer, RegionOverlord, RegionTie, RegionVersion, Relationship, Scene, Secret, Stay, Todo, WorldEvent,
} from '../model';
import { DIRECTED_RELATIONS } from '../model';

/** Collections Claude may propose changes to (AI-3). Scene text has its own change ('text'), terrain too ('terrain'). */
export const CLAUDE_COLLECTIONS = [
  'characters', 'places', 'groups', 'memberships', 'stays', 'journeys', 'books', 'chapters', 'scenes', 'threads', 'events', 'relationships', 'secrets',
  'regionLayers', 'regions', 'mapFeatures', 'mapSymbols', 'mapLayers', 'detailMaps', 'todos', 'notes', 'setups', 'arcs', 'passes',
] as const;
export type ClaudeCollection = (typeof CLAUDE_COLLECTIONS)[number];

/** Collections Claude can read but not change. */
export const READ_ONLY_COLLECTIONS = ['sceneTexts', 'manuscripts', 'links', 'scenarios', 'dismissals', 'mapImages', 'attachments'] as const;

export type Field =
  | { t: 'string'; desc: string; req?: boolean }
  | { t: 'number'; desc: string; req?: boolean; min?: number; max?: number; int?: boolean }
  | { t: 'boolean'; desc: string; req?: boolean }
  | { t: 'enum'; desc: string; req?: boolean; values: readonly string[] }
  | { t: 'strings'; desc: string; req?: boolean }
  | { t: 'date'; desc: string; req?: boolean }
  | { t: 'latlng'; desc: string; req?: boolean }
  | { t: 'latlngs'; desc: string; req?: boolean; min?: number }
  | { t: 'ref'; desc: string; req?: boolean; to: readonly string[] }
  | { t: 'refs'; desc: string; req?: boolean; to: readonly string[] }
  /** { kind: 'character' | 'group', id } */
  | { t: 'subject'; desc: string; req?: boolean }
  /** A list of sub-records, each with its own id. */
  | { t: 'list'; desc: string; req?: boolean; fields: Record<string, Field> }
  /** GeoJSON MultiPolygon coordinates: [[[ [lng, lat], … ]]]. */
  | { t: 'geo'; desc: string; req?: boolean }
  /** Set by the app; Claude cannot set it. */
  | { t: 'app'; desc: string };

/** Fields every record has (RecordBase). id, scenarioId, createdAt and updatedAt are set by the app. */
export const BASE_FIELDS: { [K in keyof RecordBase]-?: Field } = {
  id: { t: 'app', desc: 'Unique id. New records in a proposal use "new:<anything>"; the app gives them a real id.' },
  scenarioId: { t: 'app', desc: 'The what-if scenario the record belongs to ("canon" for the main story). Set by the app from the proposal.' },
  status: { t: 'enum', values: ['canon', 'draft'], desc: 'ST-6: "draft" records can be hidden from every view and check. Default "canon".' },
  createdAt: { t: 'app', desc: 'When it was made (set by the app).' },
  updatedAt: { t: 'app', desc: 'When it last changed (set by the app).' },
  revealedIn: { t: 'string', desc: 'EU-8: when the reader learns of it: a chapter id, "start" or "never". Absent = worked out from the story (first mention).' },
};

type Spec<T> = { [K in Exclude<keyof T, keyof RecordBase>]-?: Field };
type SubSpec<T> = { [K in keyof T]-?: Field };

const SUB_ID: Field = { t: 'app', desc: 'Id of this entry (given by the app when absent).' };
const PICTURES: Field = { t: 'app', desc: 'Pictures (added by the writer only).' };
const COLOR = (what: string): Field => ({ t: 'string', desc: `${what} colour as #rrggbb.` });
const SPAN_START: Field = { t: 'date', desc: 'From (absent = always).' };
const SPAN_END: Field = { t: 'date', desc: 'Until (absent = still).' };

const attribute: SubSpec<CharacterAttribute> = {
  id: SUB_ID,
  key: { t: 'string', req: true, desc: 'title, allegiance, faction, culture, religion, health, possession, status (status "missing" marks the character missing) or any other word.' },
  value: { t: 'string', req: true, desc: 'e.g. "Captain of the Guard".' },
  start: SPAN_START, end: SPAN_END,
};
const plan: SubSpec<Plan> = {
  id: SUB_ID,
  placeId: { t: 'ref', to: ['places'], req: true, desc: 'Where they mean to go.' },
  from: { t: 'date', desc: 'When they decide (absent = from the start).' },
  by: { t: 'date', desc: 'When they mean to be there.' },
  note: { t: 'string', desc: 'Why.' },
  done: { t: 'boolean', desc: 'Given up, or written as a journey.' },
};
const incident: SubSpec<Incident> = {
  id: SUB_ID,
  day: { t: 'number', int: true, min: 1, req: true, desc: 'Day of the journey (1 = the departure day).' },
  title: { t: 'string', req: true, desc: 'e.g. "Ambush at the ford".' },
  note: { t: 'string', desc: 'What happens.' },
  eventId: { t: 'ref', to: ['events'], desc: 'The world event this incident is.' },
};
const knower: SubSpec<Knower> = {
  id: SUB_ID,
  characterId: { t: 'ref', to: ['characters'], req: true, desc: 'Who knows.' },
  from: { t: 'date', desc: 'When they learn it (absent = has always known).' },
  how: { t: 'string', desc: 'How they learn it.' },
};
const version: SubSpec<RegionVersion> = {
  id: SUB_ID,
  start: { t: 'date', desc: 'From this date the region has this shape (absent = from its beginning). Versions are kept sorted by start.' },
  area: { t: 'geo', req: true, desc: 'The shape: GeoJSON MultiPolygon coordinates, [lng, lat] pairs, outer ring first then holes.' },
  intensity: { t: 'number', min: 0, max: 100, desc: 'LY-4: 0–100, e.g. 70 = "70% follow the Sun Faith". Absent = 100.' },
  note: { t: 'string', desc: 'What happened on this date ("Conquered by the Empire of Ash").' },
};
const overlord: SubSpec<RegionOverlord> = {
  id: SUB_ID,
  regionId: { t: 'ref', to: ['regions'], req: true, desc: 'The larger realm.' },
  relation: { t: 'enum', values: ['part', 'vassal'], req: true, desc: '"part" (a duchy inside a kingdom) or "vassal".' },
  start: SPAN_START, end: SPAN_END,
};
const tie: SubSpec<RegionTie> = {
  id: SUB_ID,
  characterId: { t: 'ref', to: ['characters'], req: true, desc: 'The character.' },
  role: { t: 'string', req: true, desc: 'e.g. "ruler", "high priest".' },
  start: SPAN_START, end: SPAN_END,
};
void (null as unknown as SubSpec<Picture>);

const PLACE_KINDS = ['unknown', 'city', 'town', 'village', 'castle', 'ruin', 'temple', 'port', 'battle-site', 'building', 'room', 'region', 'landmark', 'other', 'capital', 'river', 'lake', 'road', 'area'] as const;
const LINE_KINDS = ['river', 'road', 'trade-route', 'sea-lane', 'wall'] as const;
const AREA_KINDS = ['lake', 'sea', 'mountains', 'forest', 'desert', 'swamp', 'other'] as const;
const LAYER_TYPES = ['political', 'culture', 'religion', 'language', 'trade', 'population', 'resources', 'influence', 'military', 'danger', 'magic', 'known-world', 'history', 'disasters', 'notes', 'other'] as const;
const EVENT_KINDS = ['battle', 'coronation', 'festival', 'eclipse', 'treaty', 'disaster', 'birth', 'death', 'wedding', 'discovery', 'other'] as const;
const RELATION_KINDS = ['parent', 'spouse', 'sibling', 'lover', 'ally', 'rival', 'enemy', 'friend', 'mentor', 'liege', 'other'] as const;
const REF_KINDS = ['character', 'place', 'group', 'stay', 'journey', 'book', 'chapter', 'scene', 'event', 'secret', 'region', 'thread', 'manuscript', 'relationship', 'note', 'file', 'setup', 'arc'] as const;

const characters: Spec<Character> = {
  name: { t: 'string', req: true, desc: 'Name as used in the text.' },
  aliases: { t: 'strings', desc: 'Other names and titles ("the Grey Captain"). Name spotting and @ links use them.' },
  description: { t: 'string', desc: 'Short description.' },
  notes: { t: 'string', desc: 'Writer\'s notes.' },
  tags: { t: 'strings', desc: 'Free tags.' },
  portrait: { t: 'app', desc: 'Portrait picture (added by the writer only).' },
  birth: { t: 'date', desc: 'CH-2: birth date.' },
  death: { t: 'date', desc: 'CH-2: death date. A dead character must not be anywhere after it (warning).' },
  color: COLOR('Marker'),
  icon: { t: 'string', desc: 'A short emoji or letter for the map marker.' },
  importance: { t: 'enum', values: ['main', 'secondary', 'minor'], desc: 'EU-9. Default "secondary".' },
  archived: { t: 'boolean', desc: 'Archived characters are left out of checks.' },
  attributes: { t: 'list', fields: attribute, desc: 'CH-3: time-bound attributes (title, allegiance, faction, culture, religion, health, possession, status).' },
  plans: { t: 'list', fields: plan, desc: 'WH-11: where the character intends to go before it is written as a journey.' },
  images: PICTURES,
};

const places: Spec<Place> = {
  name: { t: 'string', req: true, desc: 'Name.' },
  aliases: { t: 'strings', desc: 'Other names.' },
  kind: { t: 'enum', values: PLACE_KINDS, req: true, desc: 'What it is. river/lake/road/area places stand for map features (made with the feature, not on their own).' },
  parentId: { t: 'ref', to: ['places'], desc: 'DM-2: the place it is physically inside (room → castle → city). Never a realm: realms are regions.' },
  location: { t: 'latlng', desc: 'DM-3: position on the globe. Absent = the parent\'s position.' },
  notes: { t: 'string', desc: 'Notes.' },
  isPlaceholder: { t: 'boolean', desc: 'WH-12: "unknown place / on the road" placeholder. Only the built-in one should be true.' },
  start: { t: 'date', desc: 'Exists from (founded, built).' },
  end: { t: 'date', desc: 'Exists until (destroyed).' },
  images: PICTURES,
};

const groups: Spec<Group> = {
  name: { t: 'string', req: true, desc: 'Name ("The Party", "Third Legion").' },
  description: { t: 'string', desc: 'Description.' },
  color: COLOR('Group'),
};

const memberships: Spec<Membership> = {
  groupId: { t: 'ref', to: ['groups'], req: true, desc: 'The group.' },
  characterId: { t: 'ref', to: ['characters'], req: true, desc: 'The member. While a member, they go where the group goes unless they have their own stay or journey.' },
  start: { t: 'date', desc: 'Joins (absent = always).' },
  end: { t: 'date', desc: 'Leaves (absent = still a member).' },
};

const SUBJECT: Field = { t: 'subject', req: true, desc: 'Who: { "kind": "character" | "group", "id": … }. A group\'s stay or journey moves all its members.' };

const stays: Spec<Stay> = {
  subject: SUBJECT,
  placeId: { t: 'ref', to: ['places'], req: true, desc: 'Where.' },
  arrival: { t: 'date', req: true, desc: 'Arrives.' },
  departure: { t: 'date', desc: 'Leaves. Absent = until further notice, unless durationDays is set.' },
  durationDays: { t: 'number', min: 0, desc: '"Stays 3 weeks" = 21.' },
  purpose: { t: 'string', desc: 'What they are doing there.' },
  notes: { t: 'string', desc: 'Notes.' },
};

const journeys: Spec<Journey> = {
  subject: SUBJECT,
  originId: { t: 'ref', to: ['places'], req: true, desc: 'From.' },
  destinationId: { t: 'ref', to: ['places'], req: true, desc: 'To.' },
  waypointIds: { t: 'refs', to: ['places'], desc: 'Places passed on the way, in order.' },
  departure: { t: 'date', req: true, desc: 'Leaves.' },
  arrival: { t: 'date', desc: 'Arrives. Absent = worked out from distance and speed (use the travel_time tool).' },
  modeId: { t: 'string', req: true, desc: 'Travel mode id from world settings (foot, horse, cart, ship, flying, magic or the writer\'s own).' },
  detourFactor: { t: 'number', min: 1, desc: 'How much longer than a straight line (default from settings, e.g. 1.3).' },
  route: { t: 'latlngs', desc: 'WH-6: the way drawn on the map, origin to destination. Its length replaces distance × detour.' },
  incidents: { t: 'list', fields: incident, desc: 'WH-10: things that happen on the way.' },
  purpose: { t: 'string', desc: 'Why they travel.' },
  notes: { t: 'string', desc: 'Notes.' },
};

const beat: SubSpec<Beat> = {
  id: SUB_ID,
  name: { t: 'string', req: true, desc: 'Beat name, e.g. "Midpoint".' },
  at: { t: 'number', min: 0, max: 100, req: true, desc: 'Where the template puts it, % of the book.' },
  sceneId: { t: 'ref', to: ['scenes'], desc: 'The scene where it happens in this book.' },
  note: { t: 'string', desc: 'Notes.' },
};

const books: Spec<Book> = {
  title: { t: 'string', req: true, desc: 'Title.' },
  order: { t: 'number', req: true, desc: 'Position in the series (1, 2, 3…).' },
  notes: { t: 'string', desc: 'Notes.' },
  wordGoal: { t: 'number', min: 0, int: true, desc: 'WR-12: target length in words.' },
  deadline: { t: 'string', desc: 'WR-12: real-world deadline as "YYYY-MM-DD" (not an in-world date).' },
  structureName: { t: 'string', desc: 'NT-7: the beat sheet laid over the book ("Three acts", "Seven points"…).' },
  beats: { t: 'list', fields: beat, desc: 'NT-7: the beats of the book\'s structure, each with where the template puts it (at, % of the book) and the scene where it happens.' },
};

const setups: Spec<Setup> = {
  title: { t: 'string', req: true, desc: 'What is set up ("the regent\'s heavy seal").' },
  kind: { t: 'enum', values: ['clue', 'promise', 'object', 'foreshadowing', 'other'], desc: 'Kind of setup. Default "clue".' },
  note: { t: 'string', desc: 'Notes.' },
  setupSceneId: { t: 'ref', to: ['scenes'], desc: 'The scene that plants it.' },
  payoffSceneId: { t: 'ref', to: ['scenes'], desc: 'The scene that pays it off. A setup with no payoff, or a payoff read before its setup, is a warning.' },
};

const arcTurn: SubSpec<ArcTurn> = {
  id: SUB_ID,
  sceneId: { t: 'ref', to: ['scenes'], req: true, desc: 'A scene that turns the character.' },
  note: { t: 'string', desc: 'What changes in them there.' },
};
const arcs: Spec<CharacterArc> = {
  characterId: { t: 'ref', to: ['characters'], req: true, desc: 'Whose arc.' },
  bookId: { t: 'ref', to: ['books'], req: true, desc: 'The book it spans (one arc per character per book).' },
  goalStart: { t: 'string', desc: 'What they want at the start of the book.' },
  goalEnd: { t: 'string', desc: 'What they want (or got) at the end.' },
  beliefStart: { t: 'string', desc: 'The belief (or lie) they start with.' },
  beliefEnd: { t: 'string', desc: 'What they believe at the end.' },
  woundStart: { t: 'string', desc: 'The wound they carry in.' },
  woundEnd: { t: 'string', desc: 'Where the wound stands at the end.' },
  turns: { t: 'list', fields: arcTurn, desc: 'The scenes that turn them, in any order (shown in reading order).' },
  notes: { t: 'string', desc: 'Notes.' },
};

const passes: Spec<RevisionPass> = {
  bookId: { t: 'ref', to: ['books'], req: true, desc: 'The book this pass goes through.' },
  name: { t: 'string', req: true, desc: 'Name of the pass ("Dialogue", "Timeline fixes").' },
  note: { t: 'string', desc: 'What to look for in this pass.' },
  done: { t: 'refs', to: ['chapters'], desc: 'Chapters done in this pass (the writer ticks them off).' },
  order: { t: 'number', desc: 'Position among the book\'s passes (1, 2, 3…).' },
};

const chapters: Spec<Chapter> = {
  bookId: { t: 'ref', to: ['books'], req: true, desc: 'The book.' },
  title: { t: 'string', req: true, desc: 'Title.' },
  order: { t: 'number', req: true, desc: 'Position in the book (1, 2, 3…).' },
  povCharacterId: { t: 'ref', to: ['characters'], desc: 'ST-2: point-of-view character of the chapter.' },
  notes: { t: 'string', desc: 'Notes.' },
};

const scenes: Spec<Scene> = {
  chapterId: { t: 'ref', to: ['chapters'], req: true, desc: 'The chapter.' },
  title: { t: 'string', req: true, desc: 'Title.' },
  order: { t: 'number', req: true, desc: 'Position in the chapter (1, 2, 3…).' },
  povCharacterId: { t: 'ref', to: ['characters'], desc: 'ST-2: point of view (absent = the chapter\'s).' },
  start: { t: 'date', desc: 'In-world date (or start of a range).' },
  end: { t: 'date', desc: 'End of the range.' },
  placeId: { t: 'ref', to: ['places'], desc: 'Only when it differs from where the POV character is on the scene date (that is worked out from stays).' },
  characterIds: { t: 'refs', to: ['characters'], desc: 'Who appears.' },
  summary: { t: 'string', desc: 'What happens.' },
  threadIds: { t: 'refs', to: ['threads'], desc: 'ST-3: plot threads.' },
  stage: { t: 'enum', values: ['idea', 'outlined', 'first-draft', 'revised', 'final'], desc: 'WR-13: writing stage (absent = idea). Not the same as status.' },
};

const threads: Spec<PlotThread> = {
  name: { t: 'string', req: true, desc: 'Name.' },
  color: COLOR('Thread'),
  description: { t: 'string', desc: 'Description.' },
  characterIds: { t: 'refs', to: ['characters'], desc: 'Characters in this storyline.' },
  parentId: { t: 'ref', to: ['threads'], desc: 'Branches off this thread.' },
  rejoinsId: { t: 'ref', to: ['threads'], desc: 'Joins this thread again after its last scene.' },
};

const events: Spec<WorldEvent> = {
  name: { t: 'string', req: true, desc: 'Name ("Battle of the Ford").' },
  kind: { t: 'enum', values: EVENT_KINDS, req: true, desc: 'Kind.' },
  start: { t: 'date', desc: 'When (start).' },
  end: { t: 'date', desc: 'Until.' },
  placeId: { t: 'ref', to: ['places'], desc: 'Where.' },
  characterIds: { t: 'refs', to: ['characters'], desc: 'Who takes part. They should be at the place on the date (warning otherwise).' },
  yearly: { t: 'boolean', desc: 'TL-6: a holiday held every year on the start date\'s day and month.' },
  description: { t: 'string', desc: 'What happens.' },
  images: PICTURES,
};

const relationships: Spec<Relationship> = {
  aId: { t: 'ref', to: ['characters'], req: true, desc: `First character. Directed kinds (${DIRECTED_RELATIONS.join(', ')}) read "a is <kind> of b".` },
  bId: { t: 'ref', to: ['characters'], req: true, desc: 'Second character (never the same as a).' },
  kind: { t: 'enum', values: RELATION_KINDS, req: true, desc: 'CH-4 kind.' },
  label: { t: 'string', desc: 'Nuance ("half-sister") or the name of an "other" kind.' },
  notes: { t: 'string', desc: 'Notes.' },
  start: { t: 'date', desc: 'From.' },
  end: { t: 'date', desc: 'Until.' },
};

const secrets: Spec<Secret> = {
  title: { t: 'string', req: true, desc: 'The secret in a few words.' },
  description: { t: 'string', desc: 'The whole of it.' },
  eventId: { t: 'ref', to: ['events'], desc: 'The world event it is about.' },
  knowers: { t: 'list', fields: knower, desc: 'CH-8: who learns it and when. A character must not act on it before (warning).' },
};

const regionLayers: Spec<RegionLayer> = {
  name: { t: 'string', req: true, desc: 'Name ("Political", "Religions").' },
  type: { t: 'enum', values: LAYER_TYPES, req: true, desc: 'LY-1. Political layers decide which realm a place belongs to.' },
  overlaps: { t: 'boolean', req: true, desc: 'LY-3: regions may overlap (cultures, religions). Must be false for political layers.' },
  color: COLOR('Layer'),
  fill: { t: 'enum', values: ['solid', 'hatch', 'none'], desc: 'Fill style.' },
  borderStyle: { t: 'enum', values: ['solid', 'dashed', 'dotted', 'none'], desc: 'Border style.' },
  opacity: { t: 'number', min: 0, max: 1, desc: '0–1.' },
  labels: { t: 'boolean', desc: 'Show region names.' },
  onlyOnLand: { t: 'boolean', desc: 'Fill stops at the coastline.' },
  colorBy: { t: 'enum', values: ['top', 'own'], desc: 'Political: colour by the top realm or by itself.' },
  visible: { t: 'boolean', desc: 'Shown on the map.' },
  locked: { t: 'boolean', desc: 'Locked against drawing.' },
  order: { t: 'number', desc: 'Drawing order.' },
};

const regions: Spec<Region> = {
  layerId: { t: 'ref', to: ['regionLayers'], req: true, desc: 'The layer (Political for realms).' },
  name: { t: 'string', req: true, desc: 'Name ("Kingdom of Varn").' },
  color: COLOR('Region'),
  versions: { t: 'list', fields: version, desc: 'LY-6: the region\'s shape over time. To change a border on a date prefer the "border" change, which also updates the neighbours.' },
  overlords: { t: 'list', fields: overlord, desc: 'LY-2: larger realms it is part of or a vassal of, over time.' },
  ties: { t: 'list', fields: tie, desc: 'LY-10: characters tied to it (rulers, priests) over time.' },
  entry: { t: 'string', desc: 'Encyclopedia entry (rulers, tenets, history).' },
  start: { t: 'date', desc: 'Exists from.' },
  end: { t: 'date', desc: 'Exists until.' },
  images: PICTURES,
};

const mapFeatures: Spec<MapFeature> = {
  shape: { t: 'enum', values: ['line', 'area'], req: true, desc: '"line" (river, road, trade-route, sea-lane, wall) or "area" (lake, sea, mountains, forest, desert, swamp, other).' },
  kind: { t: 'enum', values: [...LINE_KINDS, ...AREA_KINDS], req: true, desc: 'What it is; must fit the shape.' },
  name: { t: 'string', req: true, desc: 'Name.' },
  points: { t: 'latlngs', req: true, min: 2, desc: 'Lines in drawing order (rivers from source to mouth). Areas: the outline (at least 3 points).' },
  placeId: { t: 'ref', to: ['places'], desc: 'MP-8: every feature is also a place. Leave it out when creating: the app makes the place.' },
  stops: { t: 'app', desc: 'Roads: places each point was snapped to (set by the app).' },
  joinsId: { t: 'ref', to: ['mapFeatures'], desc: 'Rivers: the river this one flows into (its last point should touch it).' },
  endsInBasin: { t: 'boolean', desc: 'Rivers: ends in an inland basin on purpose (RC-2).' },
  fork: { t: 'enum', values: ['delta', 'intentional'], desc: 'Rivers: starts by splitting off another river (RC-3).' },
  auto: { t: 'app', desc: 'Traced downhill by the app.' },
  salt: { t: 'boolean', desc: 'Lakes: salt lake with no outlet.' },
  outletId: { t: 'ref', to: ['mapFeatures'], desc: 'Lakes: the river that drains it.' },
  handEdited: { t: 'app', desc: 'Set by the app.' },
  layerId: { t: 'ref', to: ['mapLayers'], desc: 'MK-13: drawing layer.' },
  spring: { t: 'boolean', desc: 'Rivers: rises at a spring (RC-6).' },
  crossingOk: { t: 'boolean', desc: 'Allowed to cross mountains or another river (RC-5).' },
  roughPoints: { t: 'app', desc: 'Set by the app (add/remove detail).' },
  notes: { t: 'string', desc: 'Notes.' },
  start: { t: 'date', desc: 'Exists from (a road built in 1030).' },
  end: { t: 'date', desc: 'Exists until.' },
};

const mapSymbols: Spec<MapSymbol> = {
  kind: { t: 'enum', values: ['peak', 'hill', 'volcano', 'conifer', 'tree', 'palm', 'reeds', 'dunes', 'rocks'], req: true, desc: 'Symbol.' },
  location: { t: 'latlng', req: true, desc: 'Where.' },
  size: { t: 'number', min: 0.2, max: 5, desc: 'Size, 1 = normal.' },
  layerId: { t: 'ref', to: ['mapLayers'], desc: 'Drawing layer.' },
};

const mapLayers: Spec<MapLayer> = {
  name: { t: 'string', req: true, desc: 'Name.' },
  visible: { t: 'boolean', desc: 'Shown.' },
  locked: { t: 'boolean', desc: 'Locked.' },
  order: { t: 'number', desc: 'Order.' },
};

const detailMaps: Spec<DetailMap> = {
  name: { t: 'string', req: true, desc: 'Name.' },
  kind: { t: 'enum', values: ['continent', 'region', 'city'], req: true, desc: 'Scale.' },
  north: { t: 'number', min: -90, max: 90, req: true, desc: 'North edge (latitude).' },
  south: { t: 'number', min: -90, max: 90, req: true, desc: 'South edge.' },
  west: { t: 'number', min: -540, max: 540, req: true, desc: 'West edge (longitude).' },
  east: { t: 'number', min: -540, max: 540, req: true, desc: 'East edge.' },
  placeId: { t: 'ref', to: ['places'], desc: 'The place it maps.' },
  notes: { t: 'string', desc: 'Notes.' },
};

const REFS = (desc: string): Field => ({ t: 'list', fields: { kind: { t: 'enum', values: REF_KINDS, req: true, desc: 'Record kind.' }, id: { t: 'string', req: true, desc: 'Record id.' } }, desc });

const todos: Spec<Todo> = {
  title: { t: 'string', req: true, desc: 'What to do.' },
  note: { t: 'string', desc: 'Details.' },
  kind: { t: 'enum', values: ['todo', 'plot-hole'], desc: 'To-do or plot hole. Default "todo".' },
  done: { t: 'boolean', desc: 'Done.' },
  refs: REFS('Records it concerns.'),
  comment: { t: 'app', desc: 'NT-1: the margin comment it was made from ({ sceneId, commentId }); set by the app.' },
};

const notes: Spec<Note> = {
  title: { t: 'string', req: true, desc: 'Title of the note.' },
  body: { t: 'string', desc: 'The note itself, plain text (blank lines between paragraphs).' },
  folder: { t: 'string', desc: 'Folder path with "/" between levels, e.g. "Research/Ships". "" = top of the notebook.' },
  inbox: { t: 'boolean', desc: 'NT-3: still in the Inbox (captured, not sorted). Notes you write should normally leave it out.' },
  refs: REFS('Records the note is about (it shows on their pages). Kinds as for to-dos; "file" points at a research file.'),
  pinned: { t: 'boolean', desc: 'Pinned to the top of its folder.' },
};

export interface CollectionSpec {
  /** One sentence for the guide. */
  about: string;
  fields: Record<string, Field>;
  /** Field defaults for a new record (filled in before checking). */
  defaults: Record<string, unknown>;
}

export const SCHEMA: Record<ClaudeCollection, CollectionSpec> = {
  characters: { about: 'People and creatures in the story.', fields: characters, defaults: { aliases: [], description: '', notes: '', tags: [], color: '#4f81bd', icon: '', importance: 'secondary', archived: false } },
  places: { about: 'Places that nest physically (room → castle → city), on the globe. Realms are NOT places: they are regions on a political layer.', fields: places, defaults: { aliases: [], notes: '', isPlaceholder: false, kind: 'other' } },
  groups: { about: 'Groups that travel together; membership is time-bound.', fields: groups, defaults: { description: '', color: '#8064a2' } },
  memberships: { about: 'A character in a group for a span of time (DM-5).', fields: memberships, defaults: {} },
  stays: { about: 'A character or group at a place from arrival to departure (WH-1..WH-3).', fields: stays, defaults: { purpose: '', notes: '' } },
  journeys: { about: 'Travel from one place to another (WH-5..WH-8).', fields: journeys, defaults: { waypointIds: [], modeId: 'foot', purpose: '', notes: '' } },
  books: { about: 'Books of the series (ST-1).', fields: books, defaults: { notes: '' } },
  chapters: { about: 'Chapters of a book.', fields: chapters, defaults: { notes: '' } },
  scenes: { about: 'Scenes of a chapter, with an in-world date, POV and cast. Their text is changed with the "text" change, not here.', fields: scenes, defaults: { characterIds: [], summary: '' } },
  threads: { about: 'Plot threads (storylines) that can branch and rejoin (ST-3).', fields: threads, defaults: { color: '#2c9faf', description: '', characterIds: [] } },
  events: { about: 'Named world events: battles, coronations, festivals (TL-5).', fields: events, defaults: { kind: 'other', characterIds: [], description: '' } },
  relationships: { about: 'Relationships between two characters over time (CH-4).', fields: relationships, defaults: { notes: '' } },
  secrets: { about: 'Secrets and who learns them when (CH-8).', fields: secrets, defaults: { description: '', knowers: [] } },
  regionLayers: { about: 'Themed sets of regions: Political, Cultures, Religions… (LY-1).', fields: regionLayers, defaults: { overlaps: true, color: '#888888', fill: 'solid', borderStyle: 'solid', opacity: 0.35, labels: true, onlyOnLand: true, visible: true, locked: false, order: 0 } },
  regions: { about: 'A realm, culture, religion or other area on a layer, with its shape over time, overlords and rulers (LY-1..LY-12).', fields: regions, defaults: { color: '#c0504d', versions: [], overlords: [], ties: [], entry: '' } },
  mapFeatures: { about: 'Rivers, roads, trade routes, sea lanes, walls (lines) and lakes, seas, mountain ranges, forests, deserts, swamps (areas). Each is also a place (MP-8).', fields: mapFeatures, defaults: { notes: '' } },
  mapSymbols: { about: 'Symbols stamped on the map by hand (MK-6).', fields: mapSymbols, defaults: { size: 1 } },
  mapLayers: { about: 'Drawing layers that group features and symbols (MK-13).', fields: mapLayers, defaults: { visible: true, locked: false, order: 0 } },
  detailMaps: { about: 'Continent, region and city maps framed on the globe (MP-4).', fields: detailMaps, defaults: { notes: '' } },
  todos: { about: 'To-dos and plot holes linked to records (EU-14).', fields: todos, defaults: { note: '', kind: 'todo', done: false, refs: [] } },
  setups: { about: 'Setups and payoffs (NT-6): a clue, promise or planted object, the scene that plants it and the scene that pays it off.', fields: setups, defaults: { kind: 'clue', note: '' } },
  arcs: { about: 'Character arcs (NT-8): per book, where a character starts and ends (goal, belief, wound) and the scenes that turn them.', fields: arcs, defaults: { goalStart: '', goalEnd: '', beliefStart: '', beliefEnd: '', woundStart: '', woundEnd: '', turns: [], notes: '' } },
  passes: { about: 'Revision passes (RV-5): a named pass over a book ("dialogue", "timeline fixes") with a checklist of chapters done. Shared by every what-if scenario.', fields: passes, defaults: { note: '', done: [], order: 1 } },
  notes: { about: 'The writer\'s notebook: free notes and research pages in folders, each linked to the records it is about (NT-2). Quick captures sit in the Inbox until sorted (NT-3). Research files (images, PDFs) are read only: see research/files.md.', fields: notes, defaults: { body: '', folder: '', refs: [] } },
};

/** How a to-do ref kind maps to a collection. */
export const REF_KIND_COLLECTION: Record<string, string> = {
  character: 'characters', place: 'places', group: 'groups', stay: 'stays', journey: 'journeys', book: 'books', chapter: 'chapters', scene: 'scenes',
  event: 'events', secret: 'secrets', region: 'regions', thread: 'threads', manuscript: 'manuscripts', relationship: 'relationships',
  note: 'notes', file: 'attachments', setup: 'setups', arc: 'arcs',
};

/**
 * AI-10: what a record cannot live without, and what happens on delete. Mirrors REQUIRED in
 * tools/refs.ts (the EU-20 safe delete the app's own forms use), which the delete change calls.
 */
export const DEPENDENCY_RULES: string[] = [
  'A stay needs its character or group and its place; a journey needs its character or group, its origin and its destination. Deleting any of those deletes the stay or journey.',
  'A membership needs its character and its group. A relationship needs both characters.',
  'A revision pass needs its book; deleting a chapter takes it off the pass\'s checklist. A character arc needs its character and its book. Deleting a scene takes it out of setups, payoffs, arc turns and book beats.',
  'A chapter needs its book; a scene needs its chapter; a scene\'s text needs its scene. Deleting a book deletes its chapters, their scenes and the scene text.',
  'A map feature (river, road, lake…) is also a place (MP-8): creating a feature creates its place (same name, kept in step); deleting the feature deletes that place too unless stays or journeys use it (then the place is kept); deleting the place deletes the feature.',
  'A region needs its layer. A realm is a region on a political layer, never a place. Political regions never overlap: use the "border" change, which takes land from neighbours or stops at their border.',
  'Places nest physically through parentId. Deleting a place moves its sub-places up one level; a place can never be inside itself.',
  'The built-in place "unknown-place" (Unknown / on the road) cannot be deleted.',
  'Every other reference (a scene\'s cast, an event\'s place, a to-do\'s or a note\'s refs, …) is simply removed when the record it points at is deleted.',
  'Notes, to-dos and research files are shared by every what-if scenario (they are the writer\'s, not the story\'s). A margin comment lives inside its scene\'s text (sceneTexts[].comments, with a "comment" mark on the commented words); a to-do made from it points back with comment: { sceneId, commentId }.',
  'A delete that would also delete other records is refused unless the change says cascade: true (the proposal then lists what goes). reassignTo moves every link to another record of the same kind first.',
];

/** AI-10: how dates are written. */
export const DATE_RULES: string[] = [
  'DM-1: dates are day/month/year. Write them as text in the app\'s own format: "3/5/1042" (3 May 1042), "3 May 1042", "May 1042", "spring 1042", "late spring 1042", "~1042" (about), "300 BC".',
  'Every date is a window from earliest to latest day; "May 1042" covers the whole month. Checks only warn when windows certainly clash.',
  'TL-4: a date can hang on an event, chapter or scene ("3 days after the battle"). Those are shown as such in the folder; keep them when you only change other fields.',
  'Book deadlines (WR-12) are real-world dates written "YYYY-MM-DD", not in-world dates.',
];
