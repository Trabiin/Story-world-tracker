/**
 * PL-6: bring characters and places in from a spreadsheet saved as CSV (Excel: "CSV UTF-8").
 * Columns are matched by their headings (in any order, any case, a few common synonyms); a row
 * whose name already exists is skipped or fills in only the empty fields, as chosen.
 */
import { parseFuzzyDate } from '../dates';
import type { Character, Id, Importance, Place, PlaceKind, World } from '../model';

/** RFC 4180 CSV, with ; or tab as separator when the first line has more of them than commas (Excel in many locales). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const sep = count(';') > count(',') && count(';') >= count('\t') ? ';' : count('\t') > count(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export type CsvKind = 'characters' | 'places';

export const CSV_FIELDS: Record<CsvKind, { id: string; label: string; names: string[] }[]> = {
  characters: [
    { id: 'name', label: 'Name', names: ['name', 'character', 'full name'] },
    { id: 'aliases', label: 'Aliases', names: ['aliases', 'alias', 'also known as', 'aka', 'titles', 'nicknames'] },
    { id: 'description', label: 'Description', names: ['description', 'summary', 'about', 'bio'] },
    { id: 'notes', label: 'Notes', names: ['notes', 'note', 'comments'] },
    { id: 'tags', label: 'Tags', names: ['tags', 'tag', 'labels'] },
    { id: 'birth', label: 'Born', names: ['born', 'birth', 'birthday', 'date of birth', 'dob'] },
    { id: 'death', label: 'Died', names: ['died', 'death', 'date of death'] },
    { id: 'importance', label: 'Importance', names: ['importance', 'role', 'main', 'priority'] },
  ],
  places: [
    { id: 'name', label: 'Name', names: ['name', 'place', 'location'] },
    { id: 'kind', label: 'Kind', names: ['kind', 'type', 'category'] },
    { id: 'parent', label: 'Inside (parent place)', names: ['parent', 'inside', 'in', 'part of', 'region', 'within'] },
    { id: 'lat', label: 'Latitude', names: ['lat', 'latitude', 'y'] },
    { id: 'lng', label: 'Longitude', names: ['lng', 'lon', 'long', 'longitude', 'x'] },
    { id: 'aliases', label: 'Aliases', names: ['aliases', 'alias', 'other names', 'aka'] },
    { id: 'notes', label: 'Notes', names: ['notes', 'note', 'description'] },
  ],
};

/** Which column (index) feeds each field, from the headings. */
export function guessColumns(kind: CsvKind, header: string[]): Record<string, number | undefined> {
  const h = header.map((x) => x.trim().toLowerCase());
  const out: Record<string, number | undefined> = {};
  const used = new Set<number>();
  for (const f of CSV_FIELDS[kind]) {
    const i = h.findIndex((x, k) => !used.has(k) && f.names.includes(x));
    if (i >= 0) { out[f.id] = i; used.add(i); }
  }
  return out;
}

const PLACE_KIND_WORDS: Record<string, PlaceKind> = {
  capital: 'capital', city: 'city', town: 'town', village: 'village', hamlet: 'village', castle: 'castle', fort: 'castle', fortress: 'castle', keep: 'castle',
  port: 'port', harbour: 'port', harbor: 'port', temple: 'temple', shrine: 'temple', church: 'temple', ruin: 'ruin', ruins: 'ruin', 'battle-site': 'battle-site', battlefield: 'battle-site',
  building: 'building', inn: 'building', tavern: 'building', room: 'room', region: 'region', province: 'region', landmark: 'landmark', other: 'other',
};
const IMPORTANCE_WORDS: Record<string, Importance> = { main: 'main', major: 'main', protagonist: 'main', lead: 'main', secondary: 'secondary', supporting: 'secondary', minor: 'minor', background: 'minor', extra: 'minor' };

export interface CsvPlanRow {
  line: number;
  name: string;
  action: 'add' | 'fill' | 'skip';
  /** Why a cell was not used ("Born: not a date"). */
  problems: string[];
  record: Partial<Character> | Partial<Place>;
  existingId?: Id;
}

export interface CsvPlan { kind: CsvKind; rows: CsvPlanRow[]; adds: number; fills: number; skips: number }

/** Work out what an import would do, without changing anything. */
export function planCsvImport(world: World, kind: CsvKind, rows: string[][], cols: Record<string, number | undefined>, existing: 'skip' | 'fill', hasHeader = true): CsvPlan {
  const list = (kind === 'characters' ? world.characters : world.places) as { id: Id; name: string; aliases: string[] }[];
  const byName = new Map(list.map((r) => [r.name.trim().toLowerCase(), r]));
  const seen = new Set<string>();
  const cell = (r: string[], f: string) => (cols[f] === undefined ? '' : (r[cols[f]!] ?? '').trim());
  const split = (s: string) => s.split(/[;|]|,(?=\s*\S)/).map((x) => x.trim()).filter(Boolean);
  const out: CsvPlanRow[] = [];
  rows.slice(hasHeader ? 1 : 0).forEach((r, k) => {
    const line = k + (hasHeader ? 2 : 1);
    const name = cell(r, 'name');
    const problems: string[] = [];
    if (!name) return;
    const key = name.toLowerCase();
    const rec: Record<string, unknown> = { name };
    if (kind === 'characters') {
      const al = cell(r, 'aliases'); if (al) rec.aliases = split(al);
      for (const f of ['description', 'notes'] as const) { const v = cell(r, f); if (v) rec[f] = v; }
      const tags = cell(r, 'tags'); if (tags) rec.tags = split(tags);
      for (const f of ['birth', 'death'] as const) {
        const v = cell(r, f);
        if (!v) continue;
        const d = parseFuzzyDate(v);
        if (d) rec[f] = d; else problems.push(`${f === 'birth' ? 'Born' : 'Died'}: "${v}" is not a date`);
      }
      const imp = cell(r, 'importance').toLowerCase();
      if (imp) { if (IMPORTANCE_WORDS[imp]) rec.importance = IMPORTANCE_WORDS[imp]; else problems.push(`Importance: "${imp}" (use main, secondary or minor)`); }
    } else {
      const kindWord = cell(r, 'kind').toLowerCase();
      if (kindWord) { if (PLACE_KIND_WORDS[kindWord]) rec.kind = PLACE_KIND_WORDS[kindWord]; else { rec.kind = 'other'; problems.push(`Kind: "${kindWord}" read as other`); } }
      const parent = cell(r, 'parent'); if (parent) rec.parentName = parent;
      const lat = cell(r, 'lat'), lng = cell(r, 'lng');
      if (lat || lng) {
        const a = Number(lat.replace(',', '.')), b = Number(lng.replace(',', '.'));
        if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180) rec.location = { lat: a, lng: b };
        else problems.push(`Position: "${lat}, ${lng}" is not a latitude and longitude`);
      }
      const al = cell(r, 'aliases'); if (al) rec.aliases = split(al);
      const notes = cell(r, 'notes'); if (notes) rec.notes = notes;
    }
    const ex = byName.get(key);
    const action: CsvPlanRow['action'] = seen.has(key) ? 'skip' : ex ? (existing === 'fill' ? 'fill' : 'skip') : 'add';
    if (seen.has(key)) problems.push('Same name as an earlier row');
    seen.add(key);
    out.push({ line, name, action, problems, record: rec as Partial<Character>, existingId: ex?.id });
  });
  return { kind, rows: out, adds: out.filter((r) => r.action === 'add').length, fills: out.filter((r) => r.action === 'fill').length, skips: out.filter((r) => r.action === 'skip').length };
}

/**
 * Apply a plan: new records from `make` (the app's defaults for a blank record), existing ones get
 * only the fields that are empty now. Places are linked to their parent by name, also to places
 * added in the same import. Returns the new world.
 */
export function applyCsvImport(world: World, plan: CsvPlan, make: { character: (name: string) => Character; place: (name: string) => Place }): World {
  const isEmpty = (v: unknown) => v === undefined || v === '' || (Array.isArray(v) && !v.length);
  if (plan.kind === 'characters') {
    const characters = [...world.characters];
    for (const r of plan.rows) {
      if (r.action === 'skip') continue;
      const rec = r.record as Partial<Character>;
      if (r.action === 'add') characters.push({ ...make.character(r.name), ...rec });
      else {
        const i = characters.findIndex((c) => c.id === r.existingId);
        if (i < 0) continue;
        const cur = characters[i] as unknown as Record<string, unknown>;
        const patch = Object.fromEntries(Object.entries(rec).filter(([k]) => k !== 'name' && isEmpty(cur[k])));
        characters[i] = { ...characters[i], ...patch };
      }
    }
    return { ...world, characters };
  }
  const places = [...world.places];
  const parentOf = new Map<Id, string>();
  for (const r of plan.rows) {
    if (r.action === 'skip') continue;
    const { parentName, ...rec } = r.record as Partial<Place> & { parentName?: string };
    let id: Id;
    if (r.action === 'add') { const p = { ...make.place(r.name), ...rec }; places.push(p); id = p.id; }
    else {
      const i = places.findIndex((p) => p.id === r.existingId);
      if (i < 0) continue;
      const cur = places[i] as unknown as Record<string, unknown>;
      places[i] = { ...places[i], ...Object.fromEntries(Object.entries(rec).filter(([k]) => k !== 'name' && isEmpty(cur[k]))) };
      id = places[i].id;
    }
    if (parentName) parentOf.set(id, parentName);
  }
  const byName = new Map(places.map((p) => [p.name.trim().toLowerCase(), p.id]));
  for (const [id, pname] of parentOf) {
    const pid = byName.get(pname.trim().toLowerCase());
    const i = places.findIndex((p) => p.id === id);
    if (pid && pid !== id && i >= 0 && !places[i].parentId) places[i] = { ...places[i], parentId: pid };
  }
  return { ...world, places };
}
