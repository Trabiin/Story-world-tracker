/**
 * AI-3, AI-10: check and apply the changes Claude proposes. Every change goes through the same rules
 * as the app's own forms: field types, required fields, references that must exist, the EU-20 safe
 * delete, map features that are also places (MP-8) and border changes that keep political realms
 * apart (LY-2). A proposal is applied whole or not at all; anything that would break a link or leave
 * an orphan is refused with the reason.
 */
import { certainlyBefore, parseFuzzyDate, toWindow, type FuzzyDate } from '../dates';
import { resolveRelativeDates } from '../events';
import { featureAnchor, insideArea, refreshAutoRivers } from '../features';
import type { LatLng } from '../globe';
import { editRegionArea } from '../layers';
import { CANON, ClaudeChange, GeoMultiPolygon, Id, MapFeature, Place, SceneText, TextNode, World } from '../model';
import { applyScenarioEdit, scenarioView } from '../structure';
import { TerrainEditor, applyDab, dabsBetween, fillPolygon, pointInPolygon } from '../terrain';
import { DATA_COLLECTIONS, deleteImpact, deleteRecord, recordLabel, type DataCollection } from '../tools';
import { docToBlocks, docWords, textOf } from '../writing';
import { BASE_FIELDS, CLAUDE_COLLECTIONS, ClaudeCollection, Field, REF_KIND_COLLECTION, SCHEMA } from './schema';
import { countPassage, markdownToDoc, replacePassage } from './text';

export interface ApplyOptions {
  newId: () => Id;
  now: () => string;
}

export interface ApplyResult {
  /** The stored world after the changes (unchanged when there are errors). */
  world: World;
  errors: string[];
  /** Things worth telling the writer that are not errors ("2 comments in the old text are dropped"). */
  notes: string[];
  /** Scenes whose text changed, with the text before (for WR-6 versions and undo). */
  texts: { sceneId: Id; before?: TextNode }[];
  terrain: boolean;
  /** "new:…" ids and the real ids they got. */
  ids: Record<string, Id>;
}

const UNKNOWN_PLACE = 'unknown-place';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (w: World, c: string) => (w as unknown as Record<string, { id: Id }[]>)[c] ?? [];
const fieldNames = (c: ClaudeCollection) => Object.entries({ ...BASE_FIELDS, ...SCHEMA[c].fields }).filter(([, f]) => f.t !== 'app').map(([k]) => k);

export const isClaudeCollection = (c: string): c is ClaudeCollection => (CLAUDE_COLLECTIONS as readonly string[]).includes(c);

/** A date written as text ("3/5/1042") or as a stored date object. */
export function readDate(v: unknown): FuzzyDate | string {
  if (typeof v === 'string') return parseFuzzyDate(v) ?? `"${v}" is not a date the app understands (day/month/year, e.g. "3/5/1042", "May 1042", "spring 1042")`;
  if (isObj(v) && typeof v.year === 'number' && ['day', 'month', 'season', 'year'].includes(String(v.precision))) {
    if ((v.precision === 'day' || v.precision === 'month') && typeof v.month !== 'number') return 'a date with day or month precision needs a month';
    if (v.precision === 'day' && typeof v.day !== 'number') return 'a date with day precision needs a day';
    if (v.precision === 'season' && !['spring', 'summer', 'autumn', 'winter'].includes(String(v.season))) return 'a season date needs a season';
    return v as unknown as FuzzyDate;
  }
  return 'dates are written as text, e.g. "3/5/1042"';
}

interface Ctx { w: World; opts: ApplyOptions; errors: string[]; where: string }

function refExists(w: World, to: readonly string[], id: unknown): boolean {
  return typeof id === 'string' && to.some((c) => list(w, c).some((r) => r.id === id));
}

/** Check one field and return its stored form. Errors go into ctx.errors. */
function coerce(ctx: Ctx, f: Field, v: unknown, path: string): unknown {
  const err = (m: string) => { ctx.errors.push(`${ctx.where}: ${path} ${m}`); return undefined; };
  switch (f.t) {
    case 'app': return err('is set by the app and cannot be changed');
    case 'string': return typeof v === 'string' ? v : err('must be text');
    case 'boolean': return typeof v === 'boolean' ? v : err('must be true or false');
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return err('must be a number');
      if (f.int && !Number.isInteger(v)) return err('must be a whole number');
      if (f.min !== undefined && v < f.min) return err(`must be at least ${f.min}`);
      if (f.max !== undefined && v > f.max) return err(`must be at most ${f.max}`);
      return v;
    }
    case 'enum': return typeof v === 'string' && f.values.includes(v) ? v : err(`must be one of ${f.values.join(', ')}`);
    case 'strings': return Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : err('must be a list of text');
    case 'date': { const d = readDate(v); return typeof d === 'string' ? err(`: ${d}`) : d; }
    case 'latlng': return isLatLng(v) ? { lat: v.lat, lng: v.lng } : err('must be { "lat": -90…90, "lng": -180…180 }');
    case 'latlngs': {
      if (!Array.isArray(v) || !v.every(isLatLng)) return err('must be a list of { "lat", "lng" } points');
      if (f.min && v.length < f.min) return err(`needs at least ${f.min} points`);
      return v.map((p) => ({ lat: p.lat, lng: p.lng }));
    }
    case 'ref': return refExists(ctx.w, f.to, v) ? v : err(`points at "${String(v)}", which is not an existing ${f.to.join(' or ')} record`);
    case 'refs': {
      if (!Array.isArray(v)) return err('must be a list of ids');
      const bad = v.filter((x) => !refExists(ctx.w, f.to, x));
      return bad.length ? err(`points at ${bad.map((b) => `"${String(b)}"`).join(', ')}, not existing ${f.to.join(' or ')} records`) : [...new Set(v as string[])];
    }
    case 'subject': {
      if (!isObj(v) || (v.kind !== 'character' && v.kind !== 'group')) return err('must be { "kind": "character" | "group", "id": … }');
      return refExists(ctx.w, [v.kind === 'character' ? 'characters' : 'groups'], v.id) ? { kind: v.kind, id: v.id } : err(`points at ${v.kind} "${String(v.id)}", which does not exist`);
    }
    case 'geo': return isGeo(v) ? v : err('must be GeoJSON MultiPolygon coordinates [[[ [lng, lat], … ]]]');
    case 'list': {
      if (!Array.isArray(v)) return err('must be a list');
      return v.map((item, i) => {
        if (!isObj(item)) return err(`[${i}] must be an object`);
        const out: Record<string, unknown> = { id: typeof item.id === 'string' && !item.id.startsWith('new:') ? item.id : ctx.opts.newId() };
        for (const k of Object.keys(item)) if (k !== 'id' && !(k in f.fields)) err(`[${i}].${k} is not a field here (fields: ${Object.keys(f.fields).filter((x) => f.fields[x].t !== 'app').join(', ')})`);
        for (const [k, sf] of Object.entries(f.fields)) {
          if (k === 'id') continue;
          const x = item[k];
          if (x === undefined || x === null) { if ('req' in sf && sf.req) err(`[${i}].${k} is required`); continue; }
          const c = coerce(ctx, sf, x, `${path}[${i}].${k}`);
          if (c !== undefined) out[k] = c;
        }
        return out;
      });
    }
  }
}

const isLatLng = (v: unknown): v is LatLng => isObj(v) && typeof v.lat === 'number' && typeof v.lng === 'number' && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 540;
const isGeo = (v: unknown): v is GeoMultiPolygon => Array.isArray(v) && v.every((poly) => Array.isArray(poly) && poly.every((ring) => Array.isArray(ring) && ring.length >= 3 && ring.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))));

/** Rules beyond single fields, checked on the record as it would be stored. */
function checkRecord(ctx: Ctx, c: ClaudeCollection, r: Record<string, unknown>) {
  const err = (m: string) => ctx.errors.push(`${ctx.where}: ${m}`);
  for (const [k, f] of Object.entries(SCHEMA[c].fields)) if ('req' in f && f.req && (r[k] === undefined || r[k] === null || r[k] === '')) err(`${k} is required`);
  if (typeof r.revealedIn === 'string' && r.revealedIn !== 'start' && r.revealedIn !== 'never' && !refExists(ctx.w, ['chapters'], r.revealedIn)) err('revealedIn must be a chapter id, "start" or "never"');
  const win = (d: unknown) => (d ? toWindow(d as FuzzyDate, ctx.w.settings.hemisphereForSeasons) : undefined);
  const order = (a: string, b: string, what: string) => { const x = win(r[a]), y = win(r[b]); if (x && y && certainlyBefore(y, x)) err(`${what}`); };
  switch (c) {
    case 'places': {
      // DM-2: a place can never be inside itself.
      const seen = new Set<Id>([r.id as Id]);
      const parentOf = (id: Id) => (id === r.id ? (r.parentId as Id | undefined) : ctx.w.places.find((x) => x.id === id)?.parentId);
      for (let p = r.parentId as Id | undefined; p; p = parentOf(p)) {
        if (seen.has(p)) { err('parentId would put the place inside itself'); break; }
        seen.add(p);
      }
      if (r.isPlaceholder && r.id !== UNKNOWN_PLACE) err('isPlaceholder is only for the built-in "unknown-place"');
      order('start', 'end', 'end is before start');
      break;
    }
    case 'stays': order('arrival', 'departure', 'departure is before arrival'); break;
    case 'journeys': {
      order('departure', 'arrival', 'arrival is before departure');
      if (!ctx.w.settings.travelModes.some((m) => m.id === r.modeId)) err(`modeId "${String(r.modeId)}" is not a travel mode (modes: ${ctx.w.settings.travelModes.map((m) => m.id).join(', ')})`);
      break;
    }
    case 'memberships': case 'relationships': case 'events': case 'regions': order('start', 'end', 'end is before start'); break;
    case 'characters': order('birth', 'death', 'death is before birth'); break;
    case 'scenes': order('start', 'end', 'end is before start'); break;
  }
  if (c === 'relationships' && r.aId === r.bId) err('a relationship needs two different characters');
  if (c === 'mapFeatures') {
    const lines = ['river', 'road', 'trade-route', 'sea-lane', 'wall'];
    if ((r.shape === 'line') !== lines.includes(String(r.kind))) err(`kind "${String(r.kind)}" does not fit shape "${String(r.shape)}"`);
    if (r.shape === 'area' && Array.isArray(r.points) && r.points.length < 3) err('an area needs at least 3 points');
  }
  if (c === 'regionLayers' && r.type === 'political' && r.overlaps) err('political layers cannot overlap (overlaps must be false)');
  if (c === 'regions' && Array.isArray(r.versions)) {
    const vs = r.versions as { start?: FuzzyDate }[];
    r.versions = [...vs].sort((a, b) => (a.start ? toWindow(a.start).earliest : -Infinity) - (b.start ? toWindow(b.start).earliest : -Infinity));
  }
  if ((c === 'todos' || c === 'notes') && Array.isArray(r.refs)) for (const ref of r.refs as { kind: string; id: Id }[]) if (!refExists(ctx.w, [REF_KIND_COLLECTION[ref.kind]], ref.id)) err(`refs: ${ref.kind} "${ref.id}" does not exist`);
}

/** Replace every "new:…" id in the changes with a real one; refuse references to new ids no change creates. */
function mapNewIds(changes: ClaudeChange[], opts: ApplyOptions, errors: string[]): { changes: ClaudeChange[]; ids: Record<string, Id> } {
  const ids: Record<string, Id> = {};
  changes.forEach((ch, i) => {
    if (ch.op !== 'create') return;
    const id = ch.record?.id;
    if (id === undefined) return;
    if (typeof id !== 'string' || !id.startsWith('new:')) errors.push(`Change ${i + 1}: a new record's id must start with "new:" (or be left out)`);
    else if (ids[id]) errors.push(`Change ${i + 1}: the id "${id}" is used by two new records`);
    else ids[id] = opts.newId();
  });
  const missing = new Set<string>();
  // Sub-entries (an attribute, a knower) may carry "new:" ids of their own; those stay and are replaced when checked.
  const walk = (v: unknown, listItem = false): unknown => {
    if (typeof v === 'string' && v.startsWith('new:')) { if (ids[v]) return ids[v]; missing.add(v); return v; }
    if (Array.isArray(v)) return v.map((x) => walk(x, true));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, listItem && k === 'id' && typeof x === 'string' && x.startsWith('new:') && !ids[x] ? x : walk(x)]));
    return v;
  };
  const out = changes.map((ch) => {
    if (!isObj(ch)) return ch;
    // The top-level id of a created record is mapped too (it is in ids), so walk the whole change.
    return walk(ch) as ClaudeChange;
  });
  for (const m of missing) errors.push(`"${m}" is used as a reference, but no change creates a record with that id`);
  return { changes: out, ids };
}

function describe(ch: ClaudeChange, i: number): string {
  const what = ch.op === 'text' ? `text of scene ${ch.sceneId}` : ch.op === 'terrain' ? 'terrain' : ch.op === 'border' ? `border of region ${ch.regionId}` : `${ch.collection}${'id' in ch ? ` ${ch.id}` : ''}`;
  return `Change ${i + 1} (${ch.op} ${what})`;
}

/** Apply one change to a (scenario view of the) world. */
function applyOne(ctx: Ctx, ch: ClaudeChange, res: ApplyResult): World {
  const w = ctx.w;
  const err = (m: string) => { ctx.errors.push(`${ctx.where}: ${m}`); return w; };
  if (!isObj(ch)) return err('must be an object');
  switch (ch.op) {
    case 'create': {
      if (!isClaudeCollection(ch.collection)) return err(`"${ch.collection}" is not something Claude can create (collections: ${CLAUDE_COLLECTIONS.join(', ')})`);
      if (!isObj(ch.record)) return err('record must be an object');
      const c = ch.collection;
      const spec = SCHEMA[c];
      const now = ctx.opts.now();
      const id = typeof ch.record.id === 'string' && !ch.record.id.startsWith('new:') ? ch.record.id : ctx.opts.newId();
      if (list(w, c).some((r) => r.id === id)) return err(`a ${c} record with id ${id} already exists`);
      const rec: Record<string, unknown> = { ...structuredClone(spec.defaults), id, scenarioId: CANON, status: 'canon', createdAt: now, updatedAt: now };
      const fields = { ...BASE_FIELDS, ...spec.fields } as Record<string, Field>;
      const before = ctx.errors.length;
      for (const [k, v] of Object.entries(ch.record)) {
        if (k === 'id') continue;
        if (!(k in fields)) { err(`"${k}" is not a field of ${c} (fields: ${fieldNames(c).join(', ')})`); continue; }
        if (v === null || v === undefined) continue;
        const out = coerce(ctx, fields[k], v, k);
        if (out !== undefined) rec[k] = out;
      }
      if (ctx.errors.length > before) return w;
      checkRecord(ctx, c, rec);
      if (ctx.errors.length > before) return w;
      if (c === 'mapFeatures') return createFeature(w, rec as unknown as MapFeature, ctx.opts);
      return { ...w, [c]: [...list(w, c), rec] };
    }
    case 'update': {
      if (!isClaudeCollection(ch.collection)) return err(`"${ch.collection}" is not something Claude can change`);
      const c = ch.collection;
      const cur = list(w, c).find((r) => r.id === ch.id) as Record<string, unknown> | undefined;
      if (!cur) return err(`there is no ${c} record with id ${ch.id}`);
      if (!isObj(ch.set) || !Object.keys(ch.set).length) return err('set must name the fields to change');
      const fields = { ...BASE_FIELDS, ...SCHEMA[c].fields } as Record<string, Field>;
      const rec: Record<string, unknown> = { ...cur, updatedAt: ctx.opts.now() };
      const before = ctx.errors.length;
      for (const [k, v] of Object.entries(ch.set)) {
        if (!(k in fields)) { err(`"${k}" is not a field of ${c} (fields: ${fieldNames(c).join(', ')})`); continue; }
        if (v === null) {
          const f = fields[k];
          if (f.t === 'app') err(`${k} is set by the app`);
          else if ('req' in f && f.req) err(`${k} is required and cannot be removed`);
          else delete rec[k];
          continue;
        }
        const out = coerce(ctx, fields[k], v, k);
        if (out !== undefined) rec[k] = out;
      }
      if (ctx.errors.length > before) return w;
      checkRecord(ctx, c, rec);
      if (ctx.errors.length > before) return w;
      let next = { ...w, [c]: list(w, c).map((r) => (r.id === ch.id ? rec : r)) } as World;
      if (c === 'mapFeatures') next = syncFeaturePlace(next, rec as unknown as MapFeature, Object.keys(ch.set));
      return next;
    }
    case 'delete': {
      if (!isClaudeCollection(ch.collection)) return err(`"${ch.collection}" is not something Claude can delete`);
      const c = ch.collection;
      if (!list(w, c).some((r) => r.id === ch.id)) return err(`there is no ${c} record with id ${ch.id}`);
      if (c === 'places' && ch.id === UNKNOWN_PLACE) return err('the built-in "Unknown / on the road" place cannot be deleted');
      if (c === 'mapLayers') {
        return { ...w, mapLayers: w.mapLayers.filter((l) => l.id !== ch.id), mapFeatures: w.mapFeatures.map((f) => (f.layerId === ch.id ? { ...f, layerId: undefined } : f)), mapSymbols: w.mapSymbols.map((s) => (s.layerId === ch.id ? { ...s, layerId: undefined } : s)) };
      }
      const dc = c as DataCollection;
      if (ch.reassignTo !== undefined) {
        if (ch.reassignTo === ch.id || !list(w, c).some((r) => r.id === ch.reassignTo)) return err(`reassignTo must be another existing ${c} record`);
        return deleteRecord(w, dc, ch.id, { kind: 'reassign', to: ch.reassignTo });
      }
      if (c === 'mapFeatures') return deleteFeature(ctx, ch.id, !!ch.cascade);
      const impact = deleteImpact(w, dc, ch.id);
      if (impact.goes.length && !ch.cascade) {
        return err(`deleting it would also delete ${impact.goes.length} record(s) that cannot live without it: ${impact.goes.slice(0, 12).map((d) => `${d.label} (${d.collection} ${d.id})`).join('; ')}${impact.goes.length > 12 ? '; …' : ''}. Say cascade: true to delete them too, or reassignTo another record.`);
      }
      return deleteRecord(w, dc, ch.id, { kind: 'remove' });
    }
    case 'text': {
      const scene = w.scenes.find((s) => s.id === ch.sceneId);
      if (!scene) return err(`there is no scene with id ${ch.sceneId}`);
      if (typeof ch.replace !== 'string') return err('replace must be text');
      const cur = textOf(w, ch.sceneId);
      let doc: TextNode | undefined;
      if (ch.find !== undefined) {
        if (typeof ch.find !== 'string' || !ch.find) return err('find must be the exact passage to replace');
        const n = countPassage(cur?.doc, ch.find);
        if (n !== 1) return err(n === 0 ? `the passage "${ch.find.slice(0, 80)}" is not in the scene's text (it must match exactly, inside one paragraph)` : `the passage "${ch.find.slice(0, 80)}" occurs ${n} times; quote a longer passage so it is found once`);
        doc = replacePassage(cur?.doc, ch.find, ch.replace);
      } else {
        doc = markdownToDoc(ch.replace);
        const old = docToBlocks(cur?.doc);
        const comments = cur?.comments?.length ?? 0;
        const links = old.reduce((n, b) => n + (b.kind === 'break' ? 0 : b.runs.filter((r) => r.link).length), 0);
        if (comments || links) res.notes.push(`${describe(ch, 0).replace(/^Change \d+ /, '')}: the whole text is replaced, so ${[comments ? `${comments} comment(s)` : '', links ? `${links} @ link(s)` : ''].filter(Boolean).join(' and ')} in the old text are dropped.`);
      }
      if (!doc) return err('the passage could not be replaced');
      res.texts.push({ sceneId: ch.sceneId, before: cur?.doc });
      const now = ctx.opts.now();
      const words = docWords(doc);
      // Words Claude writes do not count towards the writer's own words-per-day (WR-12).
      const rec: SceneText = cur ? { ...cur, doc, words, updatedAt: now } : { id: ctx.opts.newId(), scenarioId: CANON, status: 'canon', createdAt: now, updatedAt: now, sceneId: ch.sceneId, doc, words };
      return { ...w, sceneTexts: cur ? w.sceneTexts.map((t) => (t === cur ? rec : t)) : [...w.sceneTexts, rec] };
    }
    case 'terrain': return paintTerrain(ctx, ch, res);
    case 'border': {
      const region = w.regions.find((r) => r.id === ch.regionId);
      if (!region) return err(`there is no region with id ${ch.regionId}`);
      if (!Array.isArray(ch.area) || ch.area.length < 3 || !ch.area.every(isLatLng)) return err('area must be at least 3 { "lat", "lng" } points');
      if (ch.mode !== 'add' && ch.mode !== 'remove') return err('mode must be "add" or "remove"');
      const from = ch.from === undefined ? undefined : readDate(ch.from);
      const until = ch.until === undefined ? undefined : readDate(ch.until);
      if (typeof from === 'string') return err(`from: ${from}`);
      if (typeof until === 'string') return err(`until: ${until}`);
      const ring: [number, number][] = ch.area.map((p) => [p.lng, p.lat]);
      ring.push(ring[0]);
      return editRegionArea(w, { regionId: ch.regionId, area: [[ring]], op: ch.mode, from, until, neighbours: ch.neighbours === 'stop' ? 'stop' : 'take', note: ch.note, newId: ctx.opts.newId });
    }
    default: return err(`unknown op "${String((ch as { op?: unknown }).op)}" (ops: create, update, delete, text, terrain, border)`);
  }
}

const PLACE_KIND: Record<string, Place['kind']> = { river: 'river', lake: 'lake', sea: 'lake' };

/** MP-8: a new feature comes with the place that stands for it (as the map's own drawing tools do). */
function createFeature(w: World, f: MapFeature, opts: ApplyOptions): World {
  let feature = f;
  let places = w.places;
  if (!f.placeId) {
    const now = opts.now();
    const place: Place = { id: opts.newId(), scenarioId: CANON, status: f.status, createdAt: now, updatedAt: now, name: f.name, aliases: [], kind: PLACE_KIND[f.kind] ?? (f.shape === 'line' ? 'road' : 'area'), location: featureAnchor(f), notes: '', isPlaceholder: false, start: f.start, end: f.end };
    feature = { ...f, placeId: place.id };
    places = [...places, place];
  }
  let features = [...w.mapFeatures, feature];
  // MK-9: a river that starts in a lake without an outlet becomes its outlet.
  if (feature.kind === 'river' && feature.points.length) {
    const lake = features.find((l) => l.kind === 'lake' && !l.outletId && !l.salt && insideArea(feature.points[0], l.points));
    if (lake) features = features.map((l) => (l.id === lake.id ? { ...l, outletId: feature.id } : l));
  }
  return { ...w, mapFeatures: features, places };
}

/** MP-8, MP-9: the feature's place keeps its name, dates and position. */
function syncFeaturePlace(w: World, f: MapFeature, changed: string[]): World {
  if (!f.placeId || !changed.some((k) => ['name', 'start', 'end', 'points'].includes(k))) return w;
  return {
    ...w,
    places: w.places.map((p) => (p.id === f.placeId ? { ...p, name: f.name, start: f.start, end: f.end, location: changed.includes('points') ? featureAnchor(f) ?? p.location : p.location } : p)),
  };
}

/** As the map's Delete button: rivers that joined it are let go; its place goes too unless stays or journeys use it. */
function deleteFeature(ctx: Ctx, id: Id, cascade: boolean): World {
  const w = ctx.w;
  const f = w.mapFeatures.find((x) => x.id === id)!;
  const placeUsed = f.placeId ? deleteImpact(w, 'places', f.placeId).goes.filter((d) => d.collection !== 'mapFeatures') : [];
  let next: World = {
    ...w,
    mapFeatures: w.mapFeatures.filter((x) => x.id !== id).map((x) => (x.joinsId === id ? { ...x, joinsId: undefined } : x.outletId === id ? { ...x, outletId: undefined } : x)),
  };
  next = deleteRecord(next, 'mapFeatures', id, { kind: 'remove' });
  if (f.placeId && !placeUsed.length) next = deleteRecord(next, 'places', f.placeId, { kind: 'remove' });
  void cascade;
  return next;
}

/** MK-4, MK-5, MK-7: paint inside an area or along a line. */
function paintTerrain(ctx: Ctx, ch: Extract<ClaudeChange, { op: 'terrain' }>, res: ApplyResult): World {
  const w = ctx.w;
  const err = (m: string) => { ctx.errors.push(`${ctx.where}: ${m}`); return w; };
  if (ch.shape !== 'area' && ch.shape !== 'line') return err('shape must be "area" or "line"');
  if (!Array.isArray(ch.points) || !ch.points.every(isLatLng)) return err('points must be { "lat", "lng" } points');
  if (ch.points.length < (ch.shape === 'area' ? 3 : 2)) return err(`a terrain ${ch.shape} needs at least ${ch.shape === 'area' ? 3 : 2} points`);
  if (ch.land === undefined && ch.heightM === undefined && ch.terrainType === undefined) return err('say what to paint: land ("land" or "water"), heightM and/or terrainType');
  if (ch.land !== undefined && ch.land !== 'land' && ch.land !== 'water') return err('land must be "land" or "water"');
  if (ch.heightM !== undefined && (typeof ch.heightM !== 'number' || ch.heightM < -11000 || ch.heightM > 9000)) return err('heightM must be a number of metres between -11000 and 9000');
  let biome: number | undefined;
  if (ch.terrainType !== undefined) {
    const b = w.settings.biomes.find((x) => x.name.toLowerCase() === String(ch.terrainType).toLowerCase());
    if (!b) return err(`terrainType "${ch.terrainType}" is not one of the world's terrain types (${w.settings.biomes.map((x) => x.name).join(', ')})`);
    biome = b.id;
  }
  if (ch.shape === 'line' && ch.widthKm !== undefined && (typeof ch.widthKm !== 'number' || ch.widthKm <= 0 || ch.widthKm > 2000)) return err('widthKm must be between 0 and 2000');
  const R = w.settings.radiusKm;
  const ed = new TerrainEditor(w.terrain);
  if (ch.shape === 'area') {
    if (ch.land) fillPolygon(ed, ch.points, ch.land);
    if (ch.heightM !== undefined) {
      const g = ed.g;
      const lats = ch.points.map((p) => p.lat), lngs = ch.points.map((p) => p.lng);
      for (let gy = Math.max(0, Math.floor((90 - Math.max(...lats)) / g.cellDeg)); gy <= Math.min(g.height - 1, Math.floor((90 - Math.min(...lats)) / g.cellDeg)); gy++) {
        const lat = 90 - (gy + 0.5) * g.cellDeg;
        for (let gx = Math.floor((Math.min(...lngs) + 180) / g.cellDeg); gx <= Math.floor((Math.max(...lngs) + 180) / g.cellDeg); gx++) {
          if (pointInPolygon(lat, -180 + (gx + 0.5) * g.cellDeg, ch.points)) ed.setCell(gx, gy, ch.heightM);
        }
      }
    }
    if (biome !== undefined) fillPolygon(ed, ch.points, 'biome', biome);
  } else {
    const radiusKm = (ch.widthKm ?? 20) / 2;
    const dabs: LatLng[] = [ch.points[0]];
    for (let i = 1; i < ch.points.length; i++) dabs.push(...dabsBetween(ch.points[i - 1], ch.points[i], Math.max(1, radiusKm / 2), R), ch.points[i]);
    const paint = (tool: 'land' | 'water' | 'set-height' | 'biome') => { for (const p of dabs) applyDab(ed, p, { tool, radiusKm, strength: 1, height: ch.heightM, biome, planetRadiusKm: R }); };
    if (ch.land) paint(ch.land);
    if (ch.heightM !== undefined) paint('set-height');
    if (biome !== undefined) paint('biome');
  }
  if (!ed.changed) { res.notes.push('A terrain change paints nothing new (the map already looks like that there).'); return w; }
  const keys = ed.changedKeys;
  res.terrain = true;
  return refreshAutoRivers({ ...w, terrain: ed.commit() }, keys);
}

/** References from story records that point at nothing. Used to refuse proposals that would leave broken links. */
export function brokenRefs(w: World): Set<string> {
  const out = new Set<string>();
  for (const c of CLAUDE_COLLECTIONS) {
    const fields = SCHEMA[c].fields;
    for (const r of list(w, c) as unknown as Record<string, unknown>[]) {
      const check = (fs: Record<string, Field>, o: Record<string, unknown>, path: string) => {
        for (const [k, f] of Object.entries(fs)) {
          const v = o[k];
          if (v === undefined || v === null) continue;
          if (f.t === 'ref' && !refExists(w, f.to, v)) out.add(`${c}:${String(r.id)}.${path}${k} → ${String(v)}`);
          if (f.t === 'refs' && Array.isArray(v)) for (const x of v) if (!refExists(w, f.to, x)) out.add(`${c}:${String(r.id)}.${path}${k} → ${String(x)}`);
          if (f.t === 'subject' && isObj(v) && !refExists(w, [v.kind === 'group' ? 'groups' : 'characters'], v.id)) out.add(`${c}:${String(r.id)}.${path}${k} → ${String(v.id)}`);
          if (f.t === 'list' && Array.isArray(v)) v.forEach((x, i) => isObj(x) && check(f.fields, x, `${path}${k}[${i}].`));
        }
      };
      check(fields, r, '');
    }
  }
  for (const t of w.sceneTexts) if (!w.scenes.some((s) => s.id === t.sceneId)) out.add(`sceneTexts:${t.id}.sceneId → ${t.sceneId}`);
  return out;
}

/**
 * Check and apply a list of changes to the stored world, in the given scenario. All or nothing:
 * when anything is wrong, `errors` says what and `world` is the world unchanged.
 */
export function applyChanges(stored: World, scenarioId: Id, input: ClaudeChange[], opts: ApplyOptions): ApplyResult {
  const res: ApplyResult = { world: stored, errors: [], notes: [], texts: [], terrain: false, ids: {} };
  if (!Array.isArray(input) || !input.length) { res.errors.push('There are no changes.'); return res; }
  if (scenarioId !== CANON && !stored.scenarios.some((s) => s.id === scenarioId)) { res.errors.push(`There is no scenario with id ${scenarioId}.`); return res; }
  const { changes, ids } = mapNewIds(input, opts, res.errors);
  res.ids = ids;
  if (res.errors.length) return res;
  const view = scenarioView(stored, scenarioId);
  const brokenBefore = brokenRefs(view);
  let w = view;
  changes.forEach((ch, i) => {
    const ctx: Ctx = { w, opts, errors: res.errors, where: describe(ch, i) };
    w = applyOne(ctx, ch, res);
  });
  if (res.errors.length) return res;
  // TL-4: dates tied to an event, chapter or scene follow it.
  w = resolveRelativeDates(w);
  for (const b of brokenRefs(w)) if (!brokenBefore.has(b)) res.errors.push(`The changes would leave a broken link: ${b}.`);
  if (res.errors.length) return res;
  res.world = applyScenarioEdit(stored, scenarioId, view, w);
  return res;
}

/** Collections whose records an entry of the activity log can restore. */
const LOGGED = [...DATA_COLLECTIONS, 'mapLayers', 'scenarios'] as const;

/** AI-9: every record a change touched, before and after, so it can be undone later. */
export function touchedRecords(before: World, after: World): { collection: string; id: Id; before?: unknown; after?: unknown }[] {
  const out: { collection: string; id: Id; before?: unknown; after?: unknown }[] = [];
  for (const c of LOGGED) {
    const a = list(before, c), b = list(after, c);
    if (a === b) continue;
    const old = new Map(a.map((r) => [r.id, r]));
    const seen = new Set<Id>();
    for (const r of b) {
      seen.add(r.id);
      const o = old.get(r.id);
      if (o !== r) out.push({ collection: c, id: r.id, before: o, after: r });
    }
    for (const [id, o] of old) if (!seen.has(id)) out.push({ collection: c, id, before: o });
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * AI-9: undo one logged change, if none of the records it touched has changed since. Returns the
 * world with the records put back, or the reason it cannot be done.
 */
export function undoTouched(world: World, touched: { collection: string; id: Id; before?: unknown; after?: unknown }[]): { world: World } | { error: string } | { already: true } {
  const changed: string[] = [];
  let allBefore = true;
  for (const t of touched) {
    const cur = list(world, t.collection).find((r) => r.id === t.id);
    if (!same(cur, t.before)) allBefore = false;
    if (!same(cur, t.after)) changed.push(cur ? recordLabel(world, t.collection, cur) : `a deleted ${t.collection} record`);
  }
  if (allBefore) return { already: true };
  if (changed.length) return { error: `Changed since: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? '…' : ''}. Use version history to go back instead.` };
  const next = { ...world } as unknown as Record<string, unknown>;
  for (const t of touched) {
    const cur = next[t.collection] as { id: Id }[];
    const without = cur.filter((r) => r.id !== t.id);
    next[t.collection] = t.before === undefined ? without : cur.some((r) => r.id === t.id) ? cur.map((r) => (r.id === t.id ? t.before : r)) : [...without, t.before];
  }
  return { world: next as unknown as World };
}
