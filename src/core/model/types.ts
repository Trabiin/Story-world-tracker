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
}

export const ATTRIBUTE_KEYS = ['title', 'allegiance', 'faction', 'culture', 'religion', 'health', 'possession'] as const;

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
  purpose: string;
  notes: string;
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
}

/** ST-1: series → books → chapters → scenes. */
export interface Book extends RecordBase {
  title: string;
  order: number;
  notes: string;
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

export type LinkTargetKind = 'character' | 'place' | 'group' | 'stay' | 'journey' | 'book' | 'chapter' | 'scene';

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
  /** MK-4..MK-7: painted land, height and terrain types. */
  terrain: Terrain;
}
