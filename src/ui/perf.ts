/**
 * Lighter drawing for computers without graphics acceleration (for example a Chromebook running
 * the app in its Linux environment): canvases are drawn at one pixel per screen point instead of
 * the screen's full sharpness (a quarter of the work on a sharp screen), animations are skipped,
 * and shadows and blur are switched off. It is a choice per computer (kept in this computer's
 * settings, not in the world file, which may be shared with a faster computer).
 */
export type LightSetting = 'auto' | 'on' | 'off';
const KEY = 'swt.lightDrawing';

let detected: boolean | undefined;

/** True when the web view draws without the graphics card (software rendering), or has no WebGL at all. */
export function softwareRendering(): boolean {
  if (detected !== undefined) return detected;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return (detected = true);
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    detected = /llvmpipe|softpipe|swiftshader|software|swrast/.test(name);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    detected = false;
  }
  return detected;
}

export function lightSetting(): LightSetting {
  try { const v = localStorage.getItem(KEY); return v === 'on' || v === 'off' ? v : 'auto'; } catch { return 'auto'; }
}

export function setLightSetting(v: LightSetting) {
  try { if (v === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch { /* ignore */ }
  applyLightClass();
}

export function lightDrawing(): boolean {
  const s = lightSetting();
  return s === 'on' || (s === 'auto' && softwareRendering());
}

/** Pixels per screen point for canvases. */
export function canvasRatio(): number {
  return lightDrawing() ? 1 : window.devicePixelRatio || 1;
}

/** Puts `light-drawing` on <html>, so the style sheet drops shadows, blur and transitions. */
export function applyLightClass() {
  document.documentElement.classList.toggle('light-drawing', lightDrawing());
}
