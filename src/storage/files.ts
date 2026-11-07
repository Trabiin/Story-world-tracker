/**
 * NT-4: research files. The bytes of each file are kept once, under "file:" and their SHA-256, in
 * the same blob table as the painted map's tiles. The world (and every version in its history)
 * holds only the small Attachment records that point at them, so saving, undo and version history
 * never copy a PDF around.
 */
import type { World } from '../core';
import { blobStore } from './terrainCodec';

export const FILE_PREFIX = 'file:';
/** Biggest file accepted, in bytes. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function fileKeyOf(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return FILE_PREFIX + Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Keep a file's bytes; returns its key. */
export async function putFile(bytes: Uint8Array): Promise<string> {
  const key = await fileKeyOf(bytes);
  if (!blobStore.has(key)) blobStore.set(key, bytes);
  return key;
}

export function getFile(key: string): Uint8Array | undefined {
  return blobStore.get(key);
}

/** The file keys a world uses. */
export function fileKeys(world: World): string[] {
  return [...new Set((world.attachments ?? []).map((a) => a.fileKey))];
}
