/**
 * The world data model (DM-1..DM-8). Plain data objects; storage lives elsewhere.
 * Every record carries scenarioId and status from day one (DM-6).
 */
import type { FuzzyDate, Hemisphere } from '../dates';
import type { LatLng } from '../globe';
import type { Biome, Terrain } from '../terrain';

export type Id = string;
export const CANON: Id = 'canon';

export interface RecordBase {
  id: Id;
  scenarioId: Id; // DM-6, default CANON
  status: 'draft' | 'canon'; // ST-6
  createdAt: string; // ISO timestamp
  updatedAt: string;
  /** EU-8: when the reader learns of it: a chapter id, 'start' or 'never'. Absent = worked out from the story. */
  revealedIn?: Id;
}

/** DM-7: optional time span on anything. */
export interface TimeSpan {
  start?: FuzzyDate;
  end?: FuzzyDate;
}

export interface WorldSettings {
  name: string;
  radiusKm: number; // DM-3, MK-2
  hemisphereForSeasons: Hemisphere; // default for "spring 1042" when no place is known
  defaultDetourFactor: number; // WH-8
  travelModes: TravelMode[]; // WH-7
  disabledRules: string[]; // CC-7
  backupFolder?: string; // EU-17
  currentMoment?: number; // TL-7 day number
  /** MK-2: axial tilt in degrees; drives season strength and climate band edges (RC-7). */
  axialTiltDeg: number;
  /** MK-2: the part of the globe the main map frames. Absent = the whole globe. */
  mainMap?: { north: number; south: number; west: number; east: number };
  /** MK-16: where the first-map guide is; steps can be done, skipped and revisited. */
  mapWizard?: { step: number; done: number[]; closed?: boolean };
  /** MK-7: editable terrain types. */
  biomes: Biome[];
  /** LY-8: saved combinations of visible region layers ("politics + religion"). */
  layerPresets?: LayerPreset[];
  /** RC-9 (optional): prevailing winds for the rain-shadow check. 'earth' = Earth-like belts by latitude; a number = the direction the wind blows from, in degrees (0 = north). */
  winds?: { check: boolean; from: 'earth' | number };
  /** MK-12: map look. */
  mapStyle?: 'flat' | 'parchment';
  /** RC-11: how far a large town may be from water before it is flagged, in km. */
  settlementWaterKm?: number;
  /** TL-5, TL-6: what the timeline shows above and behind the rows: world events, yearly holidays, seasons, moon phases. seasonsAt: a place whose latitude sets the season lengths (RC-10); absent = calendar seasons. */
  timelineSky?: { events: boolean; seasons: boolean; seasonsAt?: Id; moon: boolean; holidays: boolean };
  /** TL-6: the moon's cycle, from one known new moon (a day number). */
  moon?: { periodDays: number; newMoonDay: number; name?: string };
  /** WH-9 (optional): what slows or speeds travel beyond the travel mode's speed. */
  travelModifiers?: TravelModifiers;
  /** EU-7: named filters and layouts. */
  savedViews?: SavedView[];
  /** EU-3: start a character from a template. */
  characterTemplates?: CharacterTemplate[];
  /** NT-7: the writer's own beat sheets, beside the built-in ones. */
  structureTemplates?: StructureTemplate[];
  /** WR-3, WR-5, WR-8: how the writing page looks and what goes on an exported title page. */
  writing?: WritingSettings;
  /** AI-1..AI-9: the Claude integration for this world. Absent = off (AI-6). */
  claude?: ClaudeSettings;
}

/** AI-6: Claude is off by default and switched on per world. */
export interface ClaudeSettings {
  enabled: boolean;
  /** AI-9: Claude may apply changes itself instead of proposing them. Off by default. */
  directEdit?: boolean;
  /** AI-1: the Claude folder (the live, read-only copy of the world). Absent = the default place. */
  folder?: string;
  /** AI-2: shared secret the local connector must present, so only Claude Code set up by the app can reach this world. */
  token?: string;
}

/** WR-3, WR-5, WR-8, EU-18. */
export interface WritingSettings {
  /** Title page and running header of an exported manuscript (WR-5). */
  authorName?: string;
  /** Surname for the running header ("Surname / TITLE / 1"); absent = last word of authorName. */
  authorSurname?: string;
  /** Contact lines (address, email, agent) for the top left of the title page. */
  contact?: string;
  /** WR-8: which English the spell checker uses. */
  spelling?: 'en-GB' | 'en-US';
  /** WR-3, EU-18: page colour and text size of the writing page and focus mode. */
  page?: 'light' | 'dark' | 'sepia';
  textSize?: number;
  /** WR-3: keep the line being typed in the middle of the screen. */
  typewriter?: boolean;
  /** WR-12: words to write each day (net words added to scene text). Absent or 0 = no daily goal. */
  dailyGoal?: number;
  /** WR-9: the story sidebar beside the page is shown. Absent = shown. */
  sidebar?: boolean;
}

/** EU-3: "soldier of the Guard": what a new character starts with. */
export interface CharacterTemplate {
  id: Id;
  name: string;
  tags: string[];
  importance: Importance;
  color: string;
  icon: string;
  description: string;
  /** Attribute keys and values, without dates. */
  attributes: { key: string; value: string }[];
  /** Groups the new character joins. */
  groupIds: Id[];
}

/** WH-9: each one on or off. */
export interface TravelModifiers {
  /** Hills and mountains slow travel on land. */
  terrain: boolean;
  /** Winter slows travel on land and at sea. */
  season: boolean;
  /** Regions on Danger layers slow everyone by their intensity. */
  danger: boolean;
  /** Ships go faster downstream and slower upstream on drawn rivers. */
  river: boolean;
}

/** VW-7: what every view shows. */
export interface ViewFilter {
  bookId?: Id;
  threadId?: Id;
  /** A faction or allegiance attribute value, or a group name. */
  faction?: string;
  tag?: string;
  /** Only scenes from this character's point of view, and who appears in them. */
  povId?: Id;
  /** WR-13: only scenes at this writing stage (the cast is not narrowed). */
  stage?: SceneStage;
  /** ST-6: 'hide' leaves draft records out of every view and check. */
  drafts: 'show' | 'hide';
}

/** EU-7: a named filter and layout to come back to in one click. */
export interface SavedView {
  id: Id;
  name: string;
  filter: ViewFilter;
  view: string;
  scenarioId?: Id;
}

/** LY-8: a named set of region layers to show together. */
export interface LayerPreset {
  id: Id;
  name: string;
  visibleLayerIds: Id[];
}

export interface TravelMode {
  id: Id;
  name: string; // foot, horse, cart, ship, flying, magic
  speedKmPerDay: number;
}

export const DEFAULT_TRAVEL_MODES: TravelMode[] = [
  { id: 'foot', name: 'Foot', speedKmPerDay: 30 },
  { id: 'horse', name: 'Horse', speedKmPerDay: 50 },
  { id: 'cart', name: 'Cart', speedKmPerDay: 25 },
  { id: 'ship', name: 'Ship', speedKmPerDay: 150 },
  { id: 'flying', name: 'Flying', speedKmPerDay: 300 },
  { id: 'magic', name: 'Magic', speedKmPerDay: 10000 },
];

export type Importance = 'main' | 'secondary' | 'minor'; // EU-9

export interface Character extends RecordBase {
  name: string;
  aliases: string[]; // CH-1 aliases and titles
  description: string;
  notes: string;
  tags: string[];
  portrait?: string; // data URL or relative file path
  birth?: FuzzyDate; // CH-2
  death?: FuzzyDate;
  color: string; // CH-6
  icon: string;
  importance: Importance;
  archived: boolean;
  /** CH-3: time-bound attributes such as title, allegiance or health. */
  attributes?: CharacterAttribute[];
  /** WH-11: where the character intends to go next, before it is written as a journey. */
  plans?: Plan[];
  /** EU-10: pictures for the encyclopedia page. */
  images?: Picture[];
}

/** EU-10: a picture on an encyclopedia page (a data URL), with a caption. */
export interface Picture {
  id: Id;
  src: string;
  caption: string;
}

/** WH-11: "Kaela means to reach Saltmere by midsummer". */
export interface Plan {
  id: Id;
  placeId: Id;
  /** When they decide; absent = from the start. */
  from?: FuzzyDate;
  /** When they mean to be there. */
  by?: FuzzyDate;
  note: string;
  /** Given up, or written as a journey. */
  done?: boolean;
}

export const ATTRIBUTE_KEYS = ['title', 'allegiance', 'faction', 'culture', 'religion', 'health', 'possession', 'status'] as const;

/** CH-7: a "status" attribute with this value marks the character as missing for its span. */
export const STATUS_MISSING = 'missing';

/** CH-3: e.g. title = "Captain of the Guard", 1040–1043. */
export interface CharacterAttribute extends TimeSpan {
  id: Id;
  key: string;
  value: string;
}

export type PlaceKind =
  | 'unknown' // WH-12 placeholder
  | 'city' | 'town' | 'village' | 'castle' | 'ruin' | 'temple' | 'port' | 'battle-site'
  | 'building' | 'room' | 'region' | 'landmark' | 'other'
  | 'capital' // MK-10 settlement sizes: village, town, city, capital
  | 'river' | 'lake' | 'road' | 'area'; // MP-8: map features are places too

/** DM-2: places nest physically only. Realms are layer regions (Phase 3), not places. */
export interface Place extends RecordBase, TimeSpan {
  name: string;
  aliases: string[];
  kind: PlaceKind;
  parentId?: Id; // physical parent
  location?: LatLng; // DM-3; inherited from parent when absent
  notes: string;
  /** WH-12: "unknown place" / "on the road somewhere" counts as accounted for in gap checks. */
  isPlaceholder: boolean;
  images?: Picture[];
}

export interface Group extends RecordBase {
  name: string;
  description: string;
  color: string;
}

/** DM-5: time-bound group membership. */
export interface Membership extends RecordBase, TimeSpan {
  groupId: Id;
  characterId: Id;
}

/** Who a stay or journey belongs to. */
export type Subject = { kind: 'character'; id: Id } | { kind: 'group'; id: Id };

/** WH-1..WH-3 */
export interface Stay extends RecordBase {
  subject: Subject;
  placeId: Id;
  arrival: FuzzyDate;
  departure?: FuzzyDate; // absent = open-ended (WH-3) unless durationDays set
  durationDays?: number; // "stays 3 weeks"
  purpose: string; // WH-2
  notes: string;
}

/** WH-5, WH-7, WH-8 */
export interface Journey extends RecordBase {
  subject: Subject;
  originId: Id;
  destinationId: Id;
  waypointIds: Id[];
  departure: FuzzyDate;
  arrival?: FuzzyDate; // absent = use suggested arrival
  modeId: Id;
  detourFactor?: number; // overrides world default
  /** WH-6: the route drawn on the map, origin to destination. Its length replaces straight distance × detour. */
  route?: LatLng[];
  /** WH-10: things that happen on the way, placed on the route by day. */
  incidents?: Incident[];
  purpose: string;
  notes: string;
}

/** WH-10: "an ambush on day 4". */
export interface Incident {
  id: Id;
  /** Days after departure (day 1 = the departure day). */
  day: number;
  title: string;
  note: string;
  /** A world event this incident is (optional). */
  eventId?: Id;
}

/** MP-1, MK-1: an image pinned to world coordinates by its corners. */
export interface MapImage extends RecordBase {
  name: string;
  /** Image bytes stored as a data URL (portable inside the world file). */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  north: number;
  south: number;
  west: number;
  east: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
}

/** MK-6, MK-24: a symbol stamped on the map by hand (peaks, trees, …). */
export type MapSymbolKind = 'peak' | 'hill' | 'volcano' | 'conifer' | 'tree' | 'palm' | 'reeds' | 'dunes' | 'rocks';

export interface MapSymbol extends RecordBase {
  kind: MapSymbolKind;
  location: LatLng;
  /** Size multiplier, 1 = normal. */
  size: number;
  /** MK-13: the drawing layer it belongs to; none = the base layer. */
  layerId?: Id;
}

/** MK-13: a drawing layer that groups features and symbols, so they can be hidden or locked together. */
export interface MapLayer extends RecordBase {
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

/** MP-4: a detail map (continent, region or city) pinned to world coordinates by its edges. */
export interface DetailMap extends RecordBase {
  name: string;
  kind: 'continent' | 'region' | 'city';
  north: number;
  south: number;
  west: number;
  east: number;
  /** The place it maps; clicking that place opens it. */
  placeId?: Id;
  notes: string;
}

/** MP-6: line features. */
export type LineKind = 'river' | 'road' | 'trade-route' | 'sea-lane' | 'wall';
/** MP-7: area features. */
export type AreaKind = 'lake' | 'sea' | 'mountains' | 'forest' | 'desert' | 'swamp' | 'other';

/** MP-6..MP-9, MK-8..MK-10: a drawn line or area on the map. Each one is also a place (MP-8). */
export interface MapFeature extends RecordBase, TimeSpan {
  shape: 'line' | 'area';
  kind: LineKind | AreaKind;
  name: string;
  /** Lines: in drawing order (rivers from source to mouth). Areas: the outline. */
  points: LatLng[];
  /** MP-8: the place record that stands for this feature. */
  placeId?: Id;
  /** Roads (MK-10): the place each vertex was snapped to, if any. */
  stops?: (Id | null)[];
  /** Rivers: the river this one flows into (MK-8 tributary). */
  joinsId?: Id;
  /** Rivers (RC-2): ends in a marked inland basin. */
  endsInBasin?: boolean;
  /** Rivers (RC-3): starts by splitting off another river, as a delta or on purpose. */
  fork?: 'delta' | 'intentional';
  /** Rivers (MK-19): traced downhill by the app. */
  auto?: boolean;
  /** Lakes (MK-9): salt lake with no outlet, and the outlet river. */
  salt?: boolean;
  outletId?: Id;
  /** An automatic river whose line was reshaped by hand: it is no longer re-traced (MK-25). */
  handEdited?: boolean;
  /** MK-13: the drawing layer it belongs to; none = the base layer. */
  layerId?: Id;
  /** RC-6: rises at a spring (a plausible source anywhere). */
  spring?: boolean;
  /** RC-5: allowed to cross the mountains or the other river (a gorge, an aqueduct…). */
  crossingOk?: boolean;
  /** MK-21: the line as drawn, before "add detail"; "remove detail" puts it back. */
  roughPoints?: LatLng[];
  notes: string;
}

/** LY-1, LY-11: what a region layer is about. Political decides which realm a place belongs to (DM-2, LY-2). */
export type RegionLayerType =
  | 'political' | 'culture' | 'religion' | 'language' | 'trade'
  | 'population' | 'resources' | 'influence' | 'military' | 'danger' | 'magic' | 'known-world' | 'history' | 'disasters' | 'notes' | 'other';

/** [longitude, latitude] pairs, outer ring first then holes, as in GeoJSON (RFC 7946). Longitudes may run past ±180 so a region can cross the date line. */
export type GeoRing = [number, number][];
export type GeoPolygon = GeoRing[];
export type GeoMultiPolygon = GeoPolygon[];

/** LY-1..LY-8: a themed set of regions, switched on and off together. */
export interface RegionLayer extends RecordBase {
  name: string;
  type: RegionLayerType;
  /** LY-3: regions may overlap (culture, religion). Political layers keep borders apart. */
  overlaps: boolean;
  /** LY-7 style. */
  color: string;
  fill: 'solid' | 'hatch' | 'none';
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'none';
  opacity: number;
  labels: boolean;
  /** Fill and borders stop at the coastline (LY-5 "snap to coastlines"). */
  onlyOnLand: boolean;
  /** Political layers: colour each region by its top realm (empire, kingdom) or by itself. */
  colorBy?: 'top' | 'own';
  /** LY-8 controls. */
  visible: boolean;
  locked: boolean;
  order: number;
}

/** LY-6: the shape of a region from a date until the next version starts. */
export interface RegionVersion {
  id: Id;
  /** Absent = from the region's beginning. */
  start?: FuzzyDate;
  area: GeoMultiPolygon;
  /** LY-4: 0–100, e.g. 70 = "70% followers of the Sun Faith". Absent = 100. */
  intensity?: number;
  /** What happened on this date, e.g. "Conquered by the Empire of Ash". */
  note?: string;
}

/** LY-2: a duchy inside a kingdom, or a vassal of an empire, for a span of time. */
export interface RegionOverlord extends TimeSpan {
  id: Id;
  regionId: Id;
  relation: 'part' | 'vassal';
}

/** LY-10, CH-3: a character tied to a region, e.g. a ruler or a high priest. */
export interface RegionTie extends TimeSpan {
  id: Id;
  characterId: Id;
  role: string;
}

/** LY-1..LY-12: a realm, culture, religion, language area or any other region on a layer. */
export interface Region extends RecordBase, TimeSpan {
  layerId: Id;
  name: string;
  color: string;
  /** Sorted by start date; the first one usually has no start. */
  versions: RegionVersion[];
  overlords: RegionOverlord[];
  ties: RegionTie[];
  /** LY-10: the encyclopedia entry (rulers, tenets, history). */
  entry: string;
  images?: Picture[];
}

/** ST-1: series → books → chapters → scenes. */
export interface Book extends RecordBase {
  title: string;
  order: number;
  notes: string;
  /** WR-12: the length the book should reach, in words. */
  wordGoal?: number;
  /** WR-12: the real-world date the book should be finished by, "YYYY-MM-DD" (not an in-world date). */
  deadline?: string;
  /** NT-7: the structure template laid over this book ("Three acts"), and its beats. */
  structureName?: string;
  beats?: Beat[];
}

/** NT-7: a beat of a structure ("Midpoint" at 50% of the book), and the scene where it actually happens. */
export interface Beat {
  id: Id;
  name: string;
  /** Where the template puts it, as a percentage of the book (0–100). */
  at: number;
  sceneId?: Id;
  note?: string;
}

/** NT-7: a beat sheet to lay over a book. Built-in ones live in core/plan; the writer's own in settings. */
export interface StructureTemplate {
  id: Id;
  name: string;
  beats: { name: string; at: number; note?: string }[];
}

/** NT-6: a setup (a clue, a promise, a planted object) and the scene that pays it off. */
export interface Setup extends RecordBase {
  title: string;
  kind: 'clue' | 'promise' | 'object' | 'foreshadowing' | 'other';
  note: string;
  /** The scene that plants it. */
  setupSceneId?: Id;
  /** The scene that pays it off. */
  payoffSceneId?: Id;
}

/** NT-8: one character's arc through one book: where they start and end, and the scenes that turn them. */
export interface CharacterArc extends RecordBase {
  characterId: Id;
  bookId: Id;
  goalStart: string;
  goalEnd: string;
  beliefStart: string;
  beliefEnd: string;
  woundStart: string;
  woundEnd: string;
  turns: ArcTurn[];
  notes: string;
}

export interface ArcTurn {
  id: Id;
  sceneId: Id;
  note: string;
}

export interface Chapter extends RecordBase {
  bookId: Id;
  title: string;
  order: number;
  povCharacterId?: Id; // ST-2
  notes: string;
}

export interface Scene extends RecordBase {
  chapterId: Id;
  title: string;
  order: number;
  povCharacterId?: Id; // ST-2; falls back to the chapter's POV
  start?: FuzzyDate; // in-world date or range
  end?: FuzzyDate;
  /** Stored only when it overrides the POV character's stay on the scene date (ST-1). */
  placeId?: Id;
  characterIds: Id[];
  summary: string;
  /** ST-3: plot threads this scene belongs to. */
  threadIds?: Id[];
  /**
   * WR-13: how far the writing of this scene has got. Absent = 'idea'. Not the same as `status`
   * (RecordBase, ST-6), which says whether the scene is canon or a draft record.
   */
  stage?: SceneStage;
}

/** WR-13: the writing stages of a scene, in order. */
export type SceneStage = 'idea' | 'outlined' | 'first-draft' | 'revised' | 'final';

/** ST-3: a storyline. A thread can branch off another and rejoin it (or any other) later. */
export interface PlotThread extends RecordBase {
  name: string;
  color: string;
  description: string;
  characterIds: Id[];
  /** Branches off this thread. */
  parentId?: Id;
  /** Joins this thread again after its last scene. */
  rejoinsId?: Id;
}

/**
 * ST-7, DM-6: a "what if" branch of the whole world. Its records are stored beside canon with the
 * id "<scenario id>~<record id>" and replace the canon record of the same id while it is active;
 * canon records it removes are listed in hidden as "<collection>:<id>".
 */
export interface Scenario extends RecordBase {
  name: string;
  description: string;
  hidden: string[];
}

/** ST-8: a Word file read (never written). Its text is cached so links and the reader work offline. */
export interface Manuscript extends RecordBase {
  name: string;
  /** Desktop: absolute path to the .docx on disk. */
  path?: string;
  bookId?: Id;
  paragraphs: Paragraph[];
  /** Fingerprint of the last text read, to notice edits. */
  textHash: string;
  loadedAt: string;
  /** WR-4: when the file was brought into the app's own editor, and into which book. */
  importedAt?: string;
  importedBookId?: Id;
}

export interface Paragraph {
  text: string;
  /** Heading level 1–6 when the paragraph is a heading. */
  heading?: number;
}

/** ST-11: enough context to find a passage again after the manuscript is edited. */
export interface PassageAnchor {
  paraIndex: number;
  start: number; // character offsets within the paragraph
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
  heading: string; // nearest heading above the passage
}

/** What a passage can be linked to (ST-9 manuscript links, WR-11 inline links in scene text). */
export type LinkTargetKind = 'character' | 'place' | 'group' | 'stay' | 'journey' | 'book' | 'chapter' | 'scene' | 'event' | 'region';

/** ST-9: a passage linked to a record. */
export interface ManuscriptLink extends RecordBase {
  manuscriptId: Id;
  anchor: PassageAnchor;
  target: { kind: LinkTargetKind; id: Id };
  note: string;
  /** Result of the last re-anchoring: found as-is, moved, found approximately, or lost. */
  state: 'ok' | 'moved' | 'fuzzy' | 'lost';
}

/** CC-7: a warning marked intentional, with a note (D-9). */
export interface WarningDismissal {
  key: string; // stable warning key
  note: string;
  at: string;
}

/** TL-5: a named world event (battle, coronation, festival, eclipse…). */
export type EventKind = 'battle' | 'coronation' | 'festival' | 'eclipse' | 'treaty' | 'disaster' | 'birth' | 'death' | 'wedding' | 'discovery' | 'other';

export interface WorldEvent extends RecordBase, TimeSpan {
  name: string;
  kind: EventKind;
  placeId?: Id;
  characterIds: Id[];
  /** TL-6: a holiday or festival held every year on the start date's day and month. */
  yearly?: boolean;
  description: string;
  images?: Picture[];
}

/** CH-4: relationship kinds. Directed ones read "a is parent of b", "a is mentor of b". */
export type RelationKind = 'parent' | 'spouse' | 'sibling' | 'lover' | 'ally' | 'rival' | 'enemy' | 'friend' | 'mentor' | 'liege' | 'other';
export const DIRECTED_RELATIONS: RelationKind[] = ['parent', 'mentor', 'liege'];

export interface Relationship extends RecordBase, TimeSpan {
  aId: Id;
  bId: Id;
  kind: RelationKind;
  /** Free label for 'other', or a nuance ("half-sister", "sworn brother"). */
  label?: string;
  notes: string;
}

/** CH-8: a secret or piece of knowledge, and who learns it when. */
export interface Secret extends RecordBase {
  title: string;
  description: string;
  /** The world event it is about, if any (knowing of an event). */
  eventId?: Id;
  knowers: Knower[];
}

export interface Knower {
  id: Id;
  characterId: Id;
  /** Absent = has always known. */
  from?: FuzzyDate;
  how: string;
}

/**
 * WR-1: the text of one scene, as a ProseMirror document in JSON form (see core/writing/doc.ts for
 * the node and mark types). One record per scene; id is usually the scene id.
 */
export interface SceneText extends RecordBase {
  sceneId: Id;
  doc: TextNode;
  /** Kept up to date on every save, so counts never need the whole text parsed. */
  words: number;
  /** WR-4, NT-1: margin comments. The commented text carries a "comment" mark with the same id. */
  comments?: TextComment[];
}

/**
 * WR-12: one real-world day of writing. id is the day as "YYYY-MM-DD" in the writer's local time.
 * added and removed are the words the editor saved that day, summed over every scene; net = added − removed.
 */
export interface WritingDay {
  id: string;
  scenarioId: Id;
  added: number;
  removed: number;
}

/** A node of a scene's text (ProseMirror JSON). */
export interface TextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TextNode[];
  text?: string;
  marks?: TextMark[];
}
export interface TextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** WR-4, NT-1: a margin comment, e.g. one brought in from Word. */
export interface TextComment {
  id: Id;
  author: string;
  date?: string;
  text: string;
  /** NT-1: dealt with. The comment stays (and its mark), shown folded away. */
  resolved?: boolean;
}

/** WR-6: one saved version of a scene's text. The document is gzipped JSON in base64 to keep the world file small. */
export interface SceneVersion {
  id: Id;
  sceneId: Id;
  at: string;
  /** "Automatic", "Before restoring …", or the writer's own label. */
  label: string;
  /** Kept by hand: never thinned out. */
  pinned: boolean;
  words: number;
  data: string;
}

export interface World {
  settings: WorldSettings;
  characters: Character[];
  places: Place[];
  groups: Group[];
  memberships: Membership[];
  stays: Stay[];
  journeys: Journey[];
  mapImages: MapImage[];
  dismissals: WarningDismissal[];
  books: Book[];
  chapters: Chapter[];
  scenes: Scene[];
  manuscripts: Manuscript[];
  links: ManuscriptLink[];
  /** MK-13: hand-placed map symbols. */
  mapSymbols: MapSymbol[];
  /** MP-6, MP-7: drawn rivers, roads, lakes and other features. */
  mapFeatures: MapFeature[];
  mapLayers: MapLayer[];
  detailMaps: DetailMap[];
  /** LY-1..LY-12: region layers (political, cultures, religions, …) and their regions. */
  regionLayers: RegionLayer[];
  regions: Region[];
  /** TL-5 named world events, CH-4 relationships, CH-8 secrets. */
  events: WorldEvent[];
  relationships: Relationship[];
  secrets: Secret[];
  /** ST-3 plot threads, ST-7 scenarios. */
  threads: PlotThread[];
  scenarios: Scenario[];
  /** EU-14 to-dos and plot holes. */
  todos: Todo[];
  /** WR-1 the manuscript text, one record per scene; WR-6 each scene's saved versions. */
  sceneTexts: SceneText[];
  sceneVersions: SceneVersion[];
  /** WR-12: words written on each real-world day. Shared by every scenario; world undo leaves it alone. */
  writingDays: WritingDay[];
  /** NT-2, NT-3: the notebook (free notes and research pages in folders; quick captures land in its Inbox). Shared by every scenario. */
  notes: Note[];
  /** NT-6 setups and payoffs, NT-8 character arcs. */
  setups: Setup[];
  arcs: CharacterArc[];
  /** NT-4: research files (images and PDFs) attached to notes and records. The bytes are stored once in the world file, by fileKey. */
  attachments: Attachment[];
  /** AI-3: changes Claude proposed, waiting to be accepted or rejected. Shared by every scenario. */
  suggestions: ClaudeSuggestion[];
  /** AI-9: what Claude changed (or what was accepted from it), newest last. */
  claudeLog: ClaudeLogEntry[];
  /** MK-4..MK-7: painted land, height and terrain types. */
  terrain: Terrain;
}

/**
 * AI-3, AI-10: one change Claude proposes. Records use the same field names as the World data model
 * (see core/claude/schema.ts). New records take ids starting "new:" so other changes in the same
 * proposal can point at them; the app replaces them with real ids when the change is applied.
 */
export type ClaudeChange =
  | { op: 'create'; collection: string; record: Record<string, unknown> }
  | { op: 'update'; collection: string; id: Id; set: Record<string, unknown> }
  /** EU-20: 'remove' also deletes what cannot live without the record (only with cascade: true); reassignTo hands its links to another record first. */
  | { op: 'delete'; collection: string; id: Id; cascade?: boolean; reassignTo?: Id }
  /** WR-1: replace one passage (find must occur exactly once) or, without find, the whole scene text. */
  | { op: 'text'; sceneId: Id; find?: string; replace: string }
  /** MK-4..MK-7: paint land, water, a height or a terrain type inside an area or along a line. */
  | { op: 'terrain'; shape: 'area' | 'line'; points: LatLng[]; widthKm?: number; land?: 'land' | 'water'; heightM?: number; terrainType?: string }
  /** LY-6: add land to a region (or take it away) from a date, as a border change. */
  | { op: 'border'; regionId: Id; area: LatLng[]; mode: 'add' | 'remove'; from?: string; until?: string; neighbours?: 'take' | 'stop'; note?: string };

/** AI-3, AI-7, AI-8: a proposal from Claude. */
export interface ClaudeSuggestion {
  id: Id;
  /** Shown as #n in the list. */
  number: number;
  createdAt: string;
  title: string;
  /** Claude's reason, shown with the proposal. */
  reason: string;
  /** The scenario the changes are for (canon unless Claude names one). */
  scenarioId: Id;
  /** AI-7: accept as a new what-if scenario with this name instead of changing canon. */
  asScenario?: { name: string; description: string };
  changes: ClaudeChange[];
  /** AI-8: new warnings the changes would cause, worked out when the proposal arrived. */
  newWarnings: string[];
  state: 'open' | 'accepted' | 'rejected';
  /** Changes accepted one by one (indexes into changes). */
  acceptedChanges?: number[];
  resolvedAt?: string;
  /** Why it was rejected, told back to Claude. */
  note?: string;
}

/** AI-9: one entry of the Claude activity log. before/after hold every record the change touched, so it can be undone. */
export interface ClaudeLogEntry {
  id: Id;
  at: string;
  /** direct: Claude applied it (AI-9). accepted: the writer accepted a suggestion. */
  kind: 'direct' | 'accepted';
  title: string;
  suggestionId?: Id;
  scenarioId: Id;
  touched: { collection: string; id: Id; before?: unknown; after?: unknown }[];
  /** The terrain was painted (undo through version history, or while the app is open). */
  terrain?: boolean;
  undone?: boolean;
}

/** EU-14: what a to-do or plot hole can point at. */
export type RefKind = LinkTargetKind | 'secret' | 'region' | 'thread' | 'manuscript' | 'relationship' | 'note' | 'file' | 'setup' | 'arc';
export interface TodoRef { kind: RefKind; id: Id }

/** EU-14: a to-do or a plot hole, linked to the records it concerns. */
export interface Todo extends RecordBase {
  title: string;
  note: string;
  kind: 'todo' | 'plot-hole';
  done: boolean;
  refs: TodoRef[];
  /** NT-1: made from this margin comment; the to-do links back to it. */
  comment?: { sceneId: Id; commentId: Id };
}

/** NT-2: a page in the writer's notebook. */
export interface Note extends RecordBase {
  title: string;
  /** Plain text; blank lines separate paragraphs. */
  body: string;
  /** Folder path with "/" between levels ("Research/Ships"); "" = the top of the notebook. */
  folder: string;
  /** NT-3: captured quickly and not sorted yet (shown in the Inbox). */
  inbox?: boolean;
  /** Records the note is about; it shows on their pages (EU-6, EU-10). */
  refs: TodoRef[];
  pinned?: boolean;
}

/** NT-4: a research file (an image or a PDF). */
export interface Attachment extends RecordBase {
  /** File name as added ("Salt trade.pdf"). */
  name: string;
  mime: string;
  /** Size in bytes. */
  size: number;
  /** Where the bytes are kept in the world file: "file:" and the SHA-256 of the bytes, so the same file is stored once. */
  fileKey: string;
  caption: string;
  /** Notes and records it is attached to. */
  refs: TodoRef[];
}
