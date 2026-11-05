/**
 * World file format: one SQLite database per world (architecture §1, PL-2).
 * Each record type has its own table: indexed id/scenario columns plus the full record as JSON.
 * The same code runs in the desktop app and in the browser preview (sql.js / WebAssembly).
 */
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import type { World } from '../core';
import { normalizeWorld } from './newWorld';
import type { Snapshot } from './snapshots';
import { blobStore, decodeTerrain, encodeTerrain, manifestHashes } from './terrainCodec';

/** 2: painted terrain (terrain_blobs table, "terrain" meta entry) and map symbols. */
export const SCHEMA_VERSION = 2;

export const COLLECTIONS = ['characters', 'places', 'groups', 'memberships', 'stays', 'journeys', 'mapImages', 'dismissals', 'books', 'chapters', 'scenes', 'manuscripts', 'links', 'mapSymbols'] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

const TABLE: Record<CollectionName, string> = {
  characters: 'characters',
  places: 'places',
  groups: 'groups_',
  memberships: 'memberships',
  stays: 'stays',
  journeys: 'journeys',
  mapImages: 'map_images',
  dismissals: 'dismissals',
  books: 'books',
  chapters: 'chapters',
  scenes: 'scenes',
  manuscripts: 'manuscripts',
  links: 'manuscript_links',
  mapSymbols: 'map_symbols',
};

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** wasmUrl: where the browser finds sql-wasm.wasm. In Node tests it is resolved automatically. */
export function initSql(wasmUrl?: string): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  return sqlPromise;
}

function createSchema(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  for (const c of COLLECTIONS) {
    const t = TABLE[c];
    db.run(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL DEFAULT 'canon', data TEXT NOT NULL)`);
    db.run(`CREATE INDEX IF NOT EXISTS ${t}_scenario ON ${t}(scenario_id)`);
  }
  db.run(`CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, at TEXT NOT NULL, label TEXT NOT NULL, summary TEXT NOT NULL, data BLOB NOT NULL, refs TEXT NOT NULL DEFAULT '[]')`);
  db.run(`CREATE TABLE IF NOT EXISTS terrain_blobs (hash TEXT PRIMARY KEY, data BLOB NOT NULL)`);
}

export async function worldToBytes(world: World, snapshots: Snapshot[] = []): Promise<Uint8Array> {
  const SQL = await initSql();
  const manifest = await encodeTerrain(world.terrain);
  const db = new SQL.Database();
  try {
    createSchema(db);
    db.run('BEGIN');
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run(['schema_version', String(SCHEMA_VERSION)]);
    meta.run(['settings', JSON.stringify(world.settings)]);
    meta.run(['saved_at', new Date().toISOString()]);
    meta.run(['terrain', JSON.stringify(manifest)]);
    meta.free();
    for (const c of COLLECTIONS) {
      const st = db.prepare(`INSERT INTO ${TABLE[c]} (id, scenario_id, data) VALUES (?, ?, ?)`);
      for (const r of world[c] as { id?: string; key?: string; scenarioId?: string }[]) {
        st.run([r.id ?? r.key!, r.scenarioId ?? 'canon', JSON.stringify(r)]);
      }
      st.free();
    }
    const snap = db.prepare('INSERT INTO snapshots (id, at, label, summary, data, refs) VALUES (?, ?, ?, ?, ?, ?)');
    for (const sn of snapshots) snap.run([sn.id, sn.at, sn.label, sn.summary, sn.data, JSON.stringify(sn.terrainRefs ?? [])]);
    snap.free();
    // Terrain tiles used by the world or by any kept version, each stored once.
    const refs = new Set([...manifestHashes(manifest), ...snapshots.flatMap((sn) => sn.terrainRefs ?? [])]);
    const blob = db.prepare('INSERT INTO terrain_blobs (hash, data) VALUES (?, ?)');
    for (const h of refs) {
      const b = blobStore.get(h);
      if (b) blob.run([h, b]);
    }
    blob.free();
    db.run('COMMIT');
    return db.export();
  } finally {
    db.close();
  }
}

export async function bytesToWorld(bytes: Uint8Array): Promise<World> {
  return (await loadWorldFile(bytes)).world;
}

/** Open a world file: the world plus its version history. */
export async function loadWorldFile(bytes: Uint8Array): Promise<{ world: World; snapshots: Snapshot[] }> {
  const SQL = await initSql();
  const db = new SQL.Database(bytes);
  try {
    const metaRows = db.exec('SELECT key, value FROM meta');
    const meta = new Map<string, string>((metaRows[0]?.values ?? []).map((r) => [String(r[0]), String(r[1])]));
    const version = Number(meta.get('schema_version') ?? 0);
    if (version > SCHEMA_VERSION) throw new Error(`This world was saved by a newer version of the app (format ${version}).`);
    const world = { settings: JSON.parse(meta.get('settings') ?? '{}') } as World;
    try {
      for (const r of db.exec('SELECT hash, data FROM terrain_blobs')[0]?.values ?? []) blobStore.set(String(r[0]), r[1] as Uint8Array);
    } catch { /* older file without terrain */ }
    for (const c of COLLECTIONS) {
      let rows: unknown[] = [];
      try {
        rows = (db.exec(`SELECT data FROM ${TABLE[c]}`)[0]?.values ?? []).map((r) => JSON.parse(String(r[0])));
      } catch {
        rows = []; // table missing in an older file
      }
      (world as unknown as Record<string, unknown[]>)[c] = rows;
    }
    let snapshots: Snapshot[] = [];
    const hasRefs = version >= 2;
    try {
      snapshots = (db.exec(`SELECT id, at, label, summary, data${hasRefs ? ', refs' : ''} FROM snapshots ORDER BY at DESC`)[0]?.values ?? []).map((r) => ({
        id: String(r[0]), at: String(r[1]), label: String(r[2]), summary: String(r[3]), data: r[4] as Uint8Array,
        terrainRefs: hasRefs ? (JSON.parse(String(r[5])) as string[]) : [],
      }));
    } catch {
      snapshots = []; // older file without version history
    }
    const out = normalizeWorld(world);
    out.terrain = await decodeTerrain(meta.has('terrain') ? JSON.parse(meta.get('terrain')!) : undefined);
    return { world: out, snapshots };
  } finally {
    db.close();
  }
}
