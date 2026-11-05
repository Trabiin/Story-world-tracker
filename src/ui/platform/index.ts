import type { Platform } from './types';
export * from './types';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let platform: Platform | null = null;
export async function getPlatform(): Promise<Platform> {
  if (!platform) platform = isDesktop ? (await import('./desktop')).desktopPlatform : (await import('./browser')).browserPlatform;
  return platform;
}
