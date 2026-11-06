/**
 * PL-3 version history: compressed copies of the world kept inside the world file,
 * so "restore the world as it was last Tuesday" works without any backup folder.
 */
import type { World } from '../core';
import { normalizeWorld } from './newWorld';
import { TerrainManifest, decodeTerrain, encodeTerrain, gunzip, gzip, manifestHashes } from './terrainCodec';

export interface Snapshot {
  id: string;
  at: string; // ISO time
  label: string;
  summary: string; // "12 characters · 40 places · 210 stays and journeys"
  data: Uint8Array; // gzip of the world JSON, without map image pixels
  /** Terrain tiles (by hash) this version uses; stored once in the world file. */
  terrainRefs?: string[];
}

export const MAX_SNAPSHOTS = 60;

export function summarize(w: World): string {
  return `${w.characters.length} characters · ${w.places.length} places · ${w.stays.length + w.journeys.length} stays and journeys`;
}

export async function makeSnapshot(world: World, label: string): Promise<Snapshot> {
  // Map images are large and rarely change; keep their settings but not their pixels.
  // Terrain is kept as references to tiles stored once in the world file.
  const terrain = await encodeTerrain(world.terrain);
  // Scene versions (WR-6), the words-per-day log (WR-12) and the Claude activity log (AI-9) are histories of their own and stay out of world versions.
  const lean = { ...world, mapImages: world.mapImages.map((m) => ({ ...m, dataUrl: '' })), sceneVersions: [], writingDays: [], claudeLog: [], terrain };
  const json = new TextEncoder().encode(JSON.stringify(lean));
  return { id: crypto.randomUUID(), at: new Date().toISOString(), label, summary: summarize(world), data: await gzip(json), terrainRefs: manifestHashes(terrain) };
}

/** Rebuild the world from a snapshot, reusing current map image pixels where the image still exists. */
export async function restoreSnapshot(s: Snapshot, current: World): Promise<World> {
  const json = new TextDecoder().decode(await gunzip(s.data));
  const parsed = JSON.parse(json) as World & { terrain?: TerrainManifest };
  const manifest = parsed.terrain as unknown as TerrainManifest | undefined;
  const w = normalizeWorld(parsed);
  w.terrain = manifest ? await decodeTerrain(manifest) : current.terrain;
  w.mapImages = w.mapImages
    .map((m) => ({ ...m, dataUrl: current.mapImages.find((c) => c.id === m.id)?.dataUrl ?? '' }))
    .filter((m) => m.dataUrl);
  w.sceneVersions = current.sceneVersions;
  w.writingDays = current.writingDays;
  // AI-3, AI-9: Claude's proposals and its activity log are kept as they are now, and so is the Claude setup.
  w.suggestions = current.suggestions;
  w.claudeLog = current.claudeLog;
  w.settings = { ...w.settings, currentMoment: current.settings.currentMoment, backupFolder: current.settings.backupFolder, claude: current.settings.claude };
  return w;
}

export function pruneSnapshots(list: Snapshot[]): Snapshot[] {
  return [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_SNAPSHOTS);
}
