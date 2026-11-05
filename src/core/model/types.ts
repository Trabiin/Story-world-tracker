/**
 * The world data model (DM-1..DM-8). Plain data objects; storage lives elsewhere.
 * Every record carries scenarioId and status from day one (DM-6).
 */
import type { FuzzyDate, Hemisphere } from '../dates';
import type { LatLng } from '../globe';

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
  | 'building' | 'room' | 'region' | 'landmark' | 'other';

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
}
