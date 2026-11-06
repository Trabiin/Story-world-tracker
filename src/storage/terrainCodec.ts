/**
 * Storing painted terrain. Each tile is packed (heights as 16-bit little-endian, then terrain
 * types), gzipped, and stored once under a content hash. The world file and every version in
 * the history refer to tiles by hash, so unchanged tiles are never stored twice.
 */
import { TILE_CELLS, Terrain, TerrainTile, emptyTerrain } from '../core';

export interface TerrainManifest {
  cellDeg: number;
  tiles: Record<string, string>; // tile key → blob hash
}

const N = TILE_CELLS * TILE_CELLS;

/** Compressed tiles by hash, shared by the current world and its version history. */
export const blobStore = new Map<string, Uint8Array>();
const encoded = new WeakMap<TerrainTile, string>();

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream('gzip'));
}
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream('gzip'));
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Heights (int16 LE), then terrain types (uint8), then (MK-21, only when present) added detail (int16 LE). */
export function packTile(t: TerrainTile): Uint8Array {
  const out = new Uint8Array(t.detail ? N * 5 : N * 3);
  for (let i = 0; i < N; i++) {
    const v = t.elev[i];
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  out.set(t.biome, N * 2);
  if (t.detail) {
    for (let i = 0; i < N; i++) {
      const v = t.detail[i];
      out[N * 3 + i * 2] = v & 0xff;
      out[N * 3 + i * 2 + 1] = (v >> 8) & 0xff;
    }
  }
  return out;
}

export function unpackTile(b: Uint8Array): TerrainTile {
  if (b.length !== N * 3 && b.length !== N * 5) throw new Error('Damaged terrain tile');
  const elev = new Int16Array(N);
  for (let i = 0; i < N; i++) elev[i] = (b[i * 2] | (b[i * 2 + 1] << 8)) << 16 >> 16;
  const tile: TerrainTile = { elev, biome: b.slice(N * 2, N * 3) };
  if (b.length === N * 5) {
    const detail = new Int16Array(N);
    for (let i = 0; i < N; i++) detail[i] = (b[N * 3 + i * 2] | (b[N * 3 + i * 2 + 1] << 8)) << 16 >> 16;
    tile.detail = detail;
  }
  return tile;
}

/** Two independent 32-bit FNV-1a hashes plus the length: plenty to tell tiles apart. */
export function hashBytes(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 ^ b[i], 0x0100019d);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}${b.length.toString(16)}`;
}

export async function encodeTile(t: TerrainTile): Promise<string> {
  const known = encoded.get(t);
  if (known && blobStore.has(known)) return known;
  const raw = packTile(t);
  const hash = hashBytes(raw);
  if (!blobStore.has(hash)) blobStore.set(hash, await gzip(raw));
  encoded.set(t, hash);
  return hash;
}

export async function encodeTerrain(t: Terrain): Promise<TerrainManifest> {
  const tiles: Record<string, string> = {};
  for (const [k, tile] of Object.entries(t.tiles)) tiles[k] = await encodeTile(tile);
  return { cellDeg: t.cellDeg, tiles };
}

/** Rebuild a terrain from its manifest; tiles whose blob is missing are skipped. */
export async function decodeTerrain(m: TerrainManifest | undefined): Promise<Terrain> {
  if (!m || !m.tiles) return emptyTerrain();
  const tiles: Record<string, TerrainTile> = {};
  for (const [k, hash] of Object.entries(m.tiles)) {
    const gz = blobStore.get(hash);
    if (!gz) continue;
    const tile = unpackTile(await gunzip(gz));
    encoded.set(tile, hash);
    tiles[k] = tile;
  }
  return { cellDeg: m.cellDeg, tiles };
}

export function manifestHashes(m: TerrainManifest | undefined): string[] {
  return m ? Object.values(m.tiles) : [];
}

// ---- JSON export (PL-4): plain base64 of the packed tiles, readable without this app ----

export interface TerrainJson {
  cellDeg: number;
  tileCells: number;
  /** Tiles with added detail (MK-21) carry a third block: int16le detail heights. */
  encoding: 'int16le-heights-then-uint8-types-base64';
  tiles: Record<string, string>;
}

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function terrainToJson(t: Terrain): TerrainJson {
  const tiles: Record<string, string> = {};
  for (const [k, tile] of Object.entries(t.tiles)) tiles[k] = toBase64(packTile(tile));
  return { cellDeg: t.cellDeg, tileCells: TILE_CELLS, encoding: 'int16le-heights-then-uint8-types-base64', tiles };
}

export function terrainFromJson(j: TerrainJson | undefined): Terrain {
  if (!j || !j.tiles) return emptyTerrain();
  const tiles: Record<string, TerrainTile> = {};
  for (const [k, b64] of Object.entries(j.tiles)) tiles[k] = unpackTile(fromBase64(b64));
  return { cellDeg: j.cellDeg, tiles };
}
