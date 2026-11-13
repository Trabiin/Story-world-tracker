import type { Platform } from './types';
export * from './types';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let platform: Platform | null = null;
/** The Chrome app build (vite.web.config.ts); without Chrome's file access it falls back to browser storage. */
export const isWebApp = import.meta.env.VITE_WEB_APP === '1';

export async function getPlatform(): Promise<Platform> {
  if (!platform) {
    if (isDesktop) platform = (await import('./desktop')).desktopPlatform;
    else if (isWebApp && (await import('./web')).hasFileAccess()) platform = (await import('./web')).webPlatform;
    else platform = (await import('./browser')).browserPlatform;
  }
  return platform;
}
