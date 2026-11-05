/**
 * World file format: one SQLite database per world (architecture §1, PL-2).
 * Each record type has its own table: indexed id/scenario columns plus the full record as JSON.
 * The same code runs in the desktop app and in the browser preview (sql.js / WebAssembly).
 */
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import type { World } from '../core';

export const SCHEMA_VERSION = 1;

export const COLLECTIONS = ['characters', 'places', 'groups', 'memberships', 'stays', 'journeys', 'mapImages', 'dismissals'] as const;
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
}

export async function worldToBytes(world: World): Promise<Uint8Array> {
  const SQL = await initSql();
  const db = new SQL.Database();
  try {
    createSchema(db);
    db.run('BEGIN');
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run(['schema_version', String(SCHEMA_VERSION)]);
    meta.run(['settings', JSON.stringify(world.settings)]);
    meta.run(['saved_at', new Date().toISOString()]);
    meta.free();
    for (const c of COLLECTIONS) {
      const st = db.prepare(`INSERT INTO ${TABLE[c]} (id, scenario_id, data) VALUES (?, ?, ?)`);
      for (const r of world[c] as { id?: string; key?: string; scenarioId?: string }[]) {
        st.run([r.id ?? r.key!, r.scenarioId ?? 'canon', JSON.stringify(r)]);
      }
      st.free();
    }
    db.run('COMMIT');
    return db.export();
  } finally {
    db.close();
  }
}

export async function bytesToWorld(bytes: Uint8Array): Promise<World> {
  const SQL = await initSql();
  const db = new SQL.Database(bytes);
  try {
    const metaRows = db.exec('SELECT key, value FROM meta');
    const meta = new Map<string, string>((metaRows[0]?.values ?? []).map((r) => [String(r[0]), String(r[1])]));
    const version = Number(meta.get('schema_version') ?? 0);
    if (version > SCHEMA_VERSION) throw new Error(`This world was saved by a newer version of the app (format ${version}).`);
    const world = { settings: JSON.parse(meta.get('settings') ?? '{}') } as World;
    for (const c of COLLECTIONS) {
      let rows: unknown[] = [];
      try {
        rows = (db.exec(`SELECT data FROM ${TABLE[c]}`)[0]?.values ?? []).map((r) => JSON.parse(String(r[0])));
      } catch {
        rows = []; // table missing in an older file
      }
      (world as unknown as Record<string, unknown[]>)[c] = rows;
    }
    return world;
  } finally {
    db.close();
  }
}
