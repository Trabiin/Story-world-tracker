/**
 * EU-19: spreadsheet-style editing of characters, places, stays and journeys. Each column says how
 * to show a record's value as text and how to read typed (or pasted) text back. The UI is a plain
 * grid of text cells; everything about meaning lives here, so pasting a block from Excel goes
 * through exactly the same checks as typing one cell.
 */
import { formatFuzzy, parseFuzzyDate, toWindow, type FuzzyDate } from '../dates';
import { anchorChoices, describeRelative, parseRelativeDate, resolveOne } from '../events';
import type { Character, Id, Importance, Journey, Place, PlaceKind, Stay, Subject, World } from '../model';

export type GridKind = 'characters' | 'places' | 'stays' | 'journeys';
type Rec = Character | Place | Stay | Journey;

export interface GridColumn {
  id: string;
  label: string;
  /** Fixed choices (shown as a list); typed text must match one of them. */
  choices?: (world: World) => string[];
  /** The record's value as text. */
  get: (r: Rec, world: World) => string;
  /** A value to sort by (defaults to the text). */
  sort?: (r: Rec, world: World) => number | string;
  /** Read text into a change, or say why it can't be used. */
  set: (text: string, r: Rec, world: World) => { patch: Partial<Rec> } | { error: string };
  /** A new row is not created until every required cell reads. */
  required?: boolean;
  width?: number;
}

const IMPORTANCE: Importance[] = ['main', 'secondary', 'minor'];
export const GRID_PLACE_KINDS: PlaceKind[] = ['capital', 'city', 'town', 'village', 'castle', 'port', 'temple', 'ruin', 'battle-site', 'building', 'room', 'region', 'landmark', 'river', 'lake', 'road', 'area', 'unknown', 'other'];

const lower = (s: string) => s.trim().toLowerCase();
const splitList = (s: string) => s.split(/[;|]|,(?=\s*\S)/).map((x) => x.trim()).filter(Boolean);
const ok = (patch: Partial<Rec>) => ({ patch });

/** Find a record by name or alias, ignoring case. */
function byName<T extends { id: Id; name: string; aliases?: string[] }>(list: T[], text: string): T | undefined {
  const k = lower(text);
  return list.find((x) => lower(x.name) === k) ?? list.find((x) => x.aliases?.some((a) => lower(a) === k));
}

export function gridDateText(world: World, d: FuzzyDate | undefined): string {
  return !d ? '' : d.rel ? describeRelative(world, d.rel) : formatFuzzy(d);
}

/** A typed date: "3/5/1042", "late spring 1042", "~1042" or "3 days after the Battle of Varn". */
export function gridReadDate(world: World, text: string, old?: FuzzyDate): FuzzyDate | string {
  const plain = parseFuzzyDate(text);
  if (plain) return plain;
  const rel = parseRelativeDate(text, anchorChoices(world));
  if (rel) return resolveOne(world, { ...(old ?? { year: 1, precision: 'year' }), rel }) ?? 'That event, chapter or scene has no date yet.';
  return `"${text.trim()}" is not a date (try 3/5/1042, May 1042, ~1042)`;
}

const dateSort = (world: World, d: FuzzyDate | undefined) => (d ? toWindow(d, world.settings.hemisphereForSeasons).earliest : Number.MAX_SAFE_INTEGER);

function dateColumn<R extends Rec>(id: string, label: string, key: keyof R & string, optional: boolean, required = false): GridColumn {
  return {
    id, label, required, width: 150,
    get: (r, w) => gridDateText(w, (r as R)[key] as FuzzyDate | undefined),
    sort: (r, w) => dateSort(w, (r as R)[key] as FuzzyDate | undefined),
    set: (text, r, w) => {
      if (!text.trim()) return optional ? ok({ [key]: undefined } as Partial<Rec>) : { error: `${label} is needed` };
      const d = gridReadDate(w, text, (r as R)[key] as FuzzyDate | undefined);
      return typeof d === 'string' ? { error: d } : ok({ [key]: d } as Partial<Rec>);
    },
  };
}

function textColumn(id: string, label: string, key: string, opts: { required?: boolean; width?: number } = {}): GridColumn {
  return {
    id, label, required: opts.required, width: opts.width ?? 200,
    get: (r) => String((r as unknown as Record<string, unknown>)[key] ?? ''),
    set: (text) => (opts.required && !text.trim() ? { error: `${label} is needed` } : ok({ [key]: opts.required ? text.trim() : text } as Partial<Rec>)),
  };
}

function listColumn(id: string, label: string, key: string): GridColumn {
  return {
    id, label, width: 180,
    get: (r) => (((r as unknown as Record<string, unknown>)[key] as string[] | undefined) ?? []).join('; '),
    set: (text) => ok({ [key]: splitList(text) } as Partial<Rec>),
  };
}

const statusColumn: GridColumn = {
  id: 'status', label: 'Draft', width: 70, choices: () => ['draft'],
  get: (r) => (r.status === 'draft' ? 'draft' : ''),
  set: (text) => {
    const t = lower(text);
    if (['draft', 'yes', 'y', 'x', 'true'].includes(t)) return ok({ status: 'draft' });
    if (['canon', '', 'no', 'n', 'false'].includes(t)) return ok({ status: 'canon' });
    return { error: 'Use draft or canon' };
  },
};

function subjectColumn(): GridColumn {
  return {
    id: 'who', label: 'Who', required: true, width: 160,
    choices: (w) => [...w.characters.filter((c) => !c.archived).map((c) => c.name), ...w.groups.map((g) => g.name)],
    get: (r, w) => subjectName(w, (r as Stay).subject),
    set: (text, _r, w) => {
      if (!text.trim()) return { error: 'Who is needed' };
      const c = byName(w.characters, text);
      if (c) return ok({ subject: { kind: 'character', id: c.id } } as Partial<Rec>);
      const g = byName(w.groups, text);
      if (g) return ok({ subject: { kind: 'group', id: g.id } } as Partial<Rec>);
      return { error: `No character or group called "${text.trim()}"` };
    },
  };
}

export function subjectName(w: World, s: Subject | undefined): string {
  if (!s) return '';
  return (s.kind === 'character' ? w.characters.find((c) => c.id === s.id)?.name : w.groups.find((g) => g.id === s.id)?.name) ?? '?';
}

function placeColumn(id: string, label: string, key: string, required: boolean): GridColumn {
  return {
    id, label, required, width: 170,
    choices: (w) => w.places.map((p) => p.name),
    get: (r, w) => w.places.find((p) => p.id === (r as unknown as Record<string, unknown>)[key])?.name ?? '',
    set: (text, r, w) => {
      if (!text.trim()) return required ? { error: `${label} is needed` } : ok({ [key]: undefined } as Partial<Rec>);
      const p = byName(w.places, text);
      if (!p) return { error: `No place called "${text.trim()}"` };
      if (key === 'parentId') {
        // A place can't end up inside itself.
        for (let at: Place | undefined = p; at; at = w.places.find((x) => x.id === at!.parentId)) {
          if (at.id === r.id) return { error: `${p.name} is inside this place already` };
        }
      }
      const cur = (r as unknown as Record<string, unknown>)[key];
      // A journey that now goes somewhere else loses its drawn route (as in the journey editor).
      const stale = (key === 'originId' || key === 'destinationId') && cur !== p.id ? { route: undefined } : {};
      return ok({ [key]: p.id, ...stale } as Partial<Rec>);
    },
  };
}

function numberColumn(id: string, label: string, read: (n: number, r: Rec) => Partial<Rec> | string, get: (r: Rec) => number | undefined, width = 90): GridColumn {
  return {
    id, label, width,
    get: (r) => { const v = get(r); return v === undefined ? '' : String(v); },
    sort: (r) => get(r) ?? Number.MAX_SAFE_INTEGER,
    set: (text, r) => {
      if (!text.trim()) { const p = read(NaN, r); return typeof p === 'string' ? { error: p } : ok(p); }
      const n = Number(text.trim().replace(',', '.'));
      if (!Number.isFinite(n)) return { error: `"${text.trim()}" is not a number` };
      const p = read(n, r);
      return typeof p === 'string' ? { error: p } : ok(p);
    },
  };
}

/** Latitude or longitude; both are kept together as the place's position. */
function coordColumn(which: 'lat' | 'lng'): GridColumn {
  const max = which === 'lat' ? 90 : 180;
  return numberColumn(which, which === 'lat' ? 'Latitude' : 'Longitude', (n, r) => {
    const p = r as Place;
    if (Number.isNaN(n)) return { location: undefined };
    if (Math.abs(n) > max) return `Must be between -${max} and ${max}`;
    const cur = p.location ?? { lat: 0, lng: 0 };
    return { location: { ...cur, [which]: n } };
  }, (r) => (r as Place).location?.[which]);
}

export const GRID_COLUMNS: Record<GridKind, GridColumn[]> = {
  characters: [
    textColumn('name', 'Name', 'name', { required: true, width: 180 }),
    listColumn('aliases', 'Aliases', 'aliases'),
    {
      id: 'importance', label: 'Importance', width: 110, choices: () => IMPORTANCE,
      get: (r) => (r as Character).importance,
      sort: (r) => IMPORTANCE.indexOf((r as Character).importance),
      set: (text) => { const t = lower(text) as Importance; return IMPORTANCE.includes(t) ? ok({ importance: t }) : { error: 'Use main, secondary or minor' }; },
    },
    dateColumn<Character>('birth', 'Born', 'birth', true),
    dateColumn<Character>('death', 'Died', 'death', true),
    listColumn('tags', 'Tags', 'tags'),
    textColumn('description', 'Description', 'description', { width: 260 }),
    statusColumn,
  ],
  places: [
    textColumn('name', 'Name', 'name', { required: true, width: 180 }),
    {
      id: 'kind', label: 'Kind', width: 110, choices: () => GRID_PLACE_KINDS,
      get: (r) => (r as Place).kind,
      set: (text) => { const t = lower(text) as PlaceKind; return GRID_PLACE_KINDS.includes(t) ? ok({ kind: t }) : !t ? ok({ kind: 'other' }) : { error: `Use one of: ${GRID_PLACE_KINDS.join(', ')}` }; },
    },
    placeColumn('parent', 'Inside', 'parentId', false),
    coordColumn('lat'),
    coordColumn('lng'),
    listColumn('aliases', 'Aliases', 'aliases'),
    textColumn('notes', 'Notes', 'notes', { width: 260 }),
    statusColumn,
  ],
  stays: [
    subjectColumn(),
    placeColumn('place', 'Place', 'placeId', true),
    dateColumn<Stay>('arrival', 'Arrives', 'arrival', false, true),
    dateColumn<Stay>('departure', 'Leaves', 'departure', true),
    numberColumn('duration', 'Days', (n) => (Number.isNaN(n) ? { durationDays: undefined } : n >= 1 && Number.isInteger(n) ? { durationDays: n } : 'A whole number of days'), (r) => (r as Stay).durationDays, 70),
    textColumn('purpose', 'Why', 'purpose'),
    textColumn('notes', 'Notes', 'notes'),
    statusColumn,
  ],
  journeys: [
    subjectColumn(),
    placeColumn('from', 'From', 'originId', true),
    placeColumn('to', 'To', 'destinationId', true),
    dateColumn<Journey>('departure', 'Sets out', 'departure', false, true),
    dateColumn<Journey>('arrival', 'Arrives', 'arrival', true),
    {
      id: 'mode', label: 'By', width: 100, choices: (w) => w.settings.travelModes.map((m) => m.name),
      get: (r, w) => w.settings.travelModes.find((m) => m.id === (r as Journey).modeId)?.name ?? '',
      set: (text, _r, w) => {
        const m = w.settings.travelModes.find((x) => lower(x.name) === lower(text) || lower(x.id) === lower(text));
        return m ? ok({ modeId: m.id } as Partial<Rec>) : { error: `Use one of: ${w.settings.travelModes.map((x) => x.name).join(', ')}` };
      },
    },
    textColumn('purpose', 'Why', 'purpose'),
    statusColumn,
  ],
};

export function gridRecords(world: World, kind: GridKind): Rec[] {
  return world[kind] as Rec[];
}

/** One cell's text: on an existing record (id) or on a new row (key, shared by the cells of that row). */
export interface GridEdit {
  id?: Id;
  newRow?: string;
  col: string;
  text: string;
}

export interface GridProblem {
  id?: Id;
  newRow?: string;
  col: string;
  message: string;
}

export interface GridMakers {
  character: (name: string) => Character;
  place: (name: string) => Place;
  stay: () => Stay;
  journey: () => Journey;
  now: string;
}

/** What a new row is still missing before it can be created (labels of required cells). */
export function missingForNew(kind: GridKind, cols: Set<string>): string[] {
  return GRID_COLUMNS[kind].filter((c) => c.required && !cols.has(c.id)).map((c) => c.label);
}

/**
 * Apply cell edits as one change: typed or pasted text is read column by column; cells that can't
 * be read are left as they were and reported. New rows are created only when every required cell
 * reads; otherwise nothing of that row is added and the missing cells are reported.
 */
export function applyGridEdits(world: World, kind: GridKind, edits: GridEdit[], make: GridMakers): { world: World; problems: GridProblem[]; created: Id[] } {
  const cols = new Map(GRID_COLUMNS[kind].map((c) => [c.id, c]));
  const list = [...gridRecords(world, kind)];
  const problems: GridProblem[] = [];
  const created: Id[] = [];
  // Places added in the same paste can be named as parents by later rows: read new places first.
  let w: World = world;
  const commit = () => { w = { ...w, [kind]: list }; };

  const readInto = (rec: Rec, rowEdits: GridEdit[]): Rec => {
    let out = rec;
    for (const e of rowEdits) {
      const c = cols.get(e.col);
      if (!c) continue;
      const res = c.set(e.text, out, w);
      if ('error' in res) problems.push({ id: e.id, newRow: e.newRow, col: e.col, message: res.error });
      else out = { ...out, ...res.patch } as Rec;
    }
    return out;
  };

  // Existing records.
  const byId = new Map<Id, GridEdit[]>();
  for (const e of edits) if (e.id) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  for (const [id, rowEdits] of byId) {
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) continue;
    const next = readInto(list[i], rowEdits);
    if (next !== list[i]) { list[i] = { ...next, updatedAt: make.now } as Rec; commit(); }
  }

  // New rows, in the order they were given.
  const rows = new Map<string, GridEdit[]>();
  for (const e of edits) if (!e.id && e.newRow) rows.set(e.newRow, [...(rows.get(e.newRow) ?? []), e]);
  for (const [key, rowEdits] of rows) {
    const filled = rowEdits.filter((e) => e.text.trim());
    if (!filled.length) continue;
    const missing = missingForNew(kind, new Set(filled.map((e) => e.col)));
    if (missing.length) { problems.push({ newRow: key, col: GRID_COLUMNS[kind].find((c) => c.label === missing[0])!.id, message: `Still needed: ${missing.join(', ')}` }); continue; }
    const nameCell = filled.find((e) => e.col === 'name')?.text.trim() ?? '';
    const blank: Rec = kind === 'characters' ? make.character(nameCell) : kind === 'places' ? make.place(nameCell) : kind === 'stays' ? make.stay() : make.journey();
    const before = problems.length;
    const rec = readInto(blank, filled);
    const failedRequired = problems.slice(before).some((p) => cols.get(p.col)?.required);
    if (failedRequired) continue;
    list.push({ ...rec, createdAt: make.now, updatedAt: make.now } as Rec);
    created.push(rec.id);
    commit();
  }
  return { world: w, problems, created };
}

/** Split pasted spreadsheet text (tab-separated, one row per line) into cells. */
export function parsePastedCells(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return lines.map((l) => l.split('\t'));
}
