/**
 * WR-6: scene history. A version is kept when the writer leaves a scene they changed (at most one
 * every few minutes), every half hour of steady writing, by hand, and before a restore or import.
 * Old automatic versions are thinned out: all from the last day, then one a day for a month, then
 * one a week. Pinned (hand-made) versions are always kept.
 */
import type { Id, SceneVersion, TextNode, World } from '../model';
import { docWords } from './doc';

export const AUTO_VERSION_GAP_MS = 5 * 60 * 1000;
export const WRITING_VERSION_EVERY_MS = 30 * 60 * 1000;
const DAY = 24 * 3600 * 1000;
const MAX_RECENT = 30;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function packDoc(doc: TextNode): Promise<string> {
  return toBase64(await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream('gzip')));
}
export async function unpackDoc(data: string): Promise<TextNode> {
  return JSON.parse(new TextDecoder().decode(await pipe(fromBase64(data), new DecompressionStream('gzip'))));
}

export async function makeVersion(sceneId: Id, doc: TextNode, label: string, pinned = false, at = new Date()): Promise<SceneVersion> {
  return { id: crypto.randomUUID(), sceneId, at: at.toISOString(), label, pinned, words: docWords(doc), data: await packDoc(doc) };
}

export function versionsOf(world: World, sceneId: Id): SceneVersion[] {
  return world.sceneVersions.filter((v) => v.sceneId === sceneId).sort((a, b) => b.at.localeCompare(a.at));
}

/** Which automatic versions of one scene to keep (newest first in, newest first out). */
export function thinVersions(list: SceneVersion[], now = Date.now()): SceneVersion[] {
  const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at));
  const keep: SceneVersion[] = [];
  const buckets = new Set<string>();
  let recent = 0;
  for (const v of sorted) {
    if (v.pinned) { keep.push(v); continue; }
    const age = now - Date.parse(v.at);
    if (age < DAY && recent < MAX_RECENT) { recent++; keep.push(v); continue; }
    const bucket = age < 31 * DAY ? `d${Math.floor(Date.parse(v.at) / DAY)}` : `w${Math.floor(Date.parse(v.at) / (7 * DAY))}`;
    if (buckets.has(bucket)) continue;
    buckets.add(bucket);
    keep.push(v);
  }
  return keep;
}

/** Add a version to the world and thin out that scene's older ones. */
export function addVersion(world: World, v: SceneVersion, now = Date.now()): World {
  const others = world.sceneVersions.filter((x) => x.sceneId !== v.sceneId);
  const mine = thinVersions([v, ...world.sceneVersions.filter((x) => x.sceneId === v.sceneId)], now);
  return { ...world, sceneVersions: [...others, ...mine] };
}

/** Should leaving the scene keep a version? Only when the text changed since the last one, and not too often. */
export function wantsAutoVersion(last: SceneVersion | undefined, currentData: string | undefined, now = Date.now()): boolean {
  if (!last) return true;
  if (currentData !== undefined && last.data === currentData) return false;
  return now - Date.parse(last.at) >= AUTO_VERSION_GAP_MS;
}
