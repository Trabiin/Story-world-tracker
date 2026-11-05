/**
 * PL-3 version history: compressed copies of the world kept inside the world file,
 * so "restore the world as it was last Tuesday" works without any backup folder.
 */
import type { World } from '../core';
import { normalizeWorld } from './newWorld';

export interface Snapshot {
  id: string;
  at: string; // ISO time
  label: string;
  summary: string; // "12 characters · 40 places · 210 stays and journeys"
  data: Uint8Array; // gzip of the world JSON, without map image pixels
}

export const MAX_SNAPSHOTS = 60;

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function summarize(w: World): string {
  return `${w.characters.length} characters · ${w.places.length} places · ${w.stays.length + w.journeys.length} stays and journeys`;
}

export async function makeSnapshot(world: World, label: string): Promise<Snapshot> {
  // Map images are large and rarely change; keep their settings but not their pixels.
  const lean = { ...world, mapImages: world.mapImages.map((m) => ({ ...m, dataUrl: '' })) };
  const json = new TextEncoder().encode(JSON.stringify(lean));
  return { id: crypto.randomUUID(), at: new Date().toISOString(), label, summary: summarize(world), data: await pipe(json, new CompressionStream('gzip')) };
}

/** Rebuild the world from a snapshot, reusing current map image pixels where the image still exists. */
export async function restoreSnapshot(s: Snapshot, current: World): Promise<World> {
  const json = new TextDecoder().decode(await pipe(s.data, new DecompressionStream('gzip')));
  const w = normalizeWorld(JSON.parse(json) as World);
  w.mapImages = w.mapImages
    .map((m) => ({ ...m, dataUrl: current.mapImages.find((c) => c.id === m.id)?.dataUrl ?? '' }))
    .filter((m) => m.dataUrl);
  w.settings = { ...w.settings, currentMoment: current.settings.currentMoment, backupFolder: current.settings.backupFolder };
  return w;
}

export function pruneSnapshots(list: Snapshot[]): Snapshot[] {
  return [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_SNAPSHOTS);
}
