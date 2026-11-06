/** MK-24: a small ready-made symbol library, drawn with canvas paths so it scales cleanly. */
import type { MapSymbolKind } from '../../core';

export const SYMBOL_LIBRARY: { kind: MapSymbolKind; name: string }[] = [
  { kind: 'peak', name: 'Mountain' },
  { kind: 'hill', name: 'Hill' },
  { kind: 'volcano', name: 'Volcano' },
  { kind: 'conifer', name: 'Pine' },
  { kind: 'tree', name: 'Tree' },
  { kind: 'palm', name: 'Palm' },
  { kind: 'reeds', name: 'Reeds' },
  { kind: 'dunes', name: 'Dunes' },
  { kind: 'rocks', name: 'Rocks' },
];

const INK = '#4a4036';
const LIGHT = '#f6f1e7';
const SHADE = '#a8998a';

/** Draw a symbol with its base at (x, y). s = height in pixels. */
export function drawSymbol(g: CanvasRenderingContext2D, kind: MapSymbolKind, x: number, y: number, s: number) {
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = Math.max(0.8, s / 14);
  g.strokeStyle = INK;
  const w = s * 0.62;
  switch (kind) {
    case 'peak':
    case 'volcano': {
      const top = kind === 'volcano' ? w * 0.18 : 0;
      g.beginPath();
      g.moveTo(x - w, y);
      g.quadraticCurveTo(x - w * 0.45, y - s * 0.55, x - top, y - s);
      g.lineTo(x + top, y - s);
      g.quadraticCurveTo(x + w * 0.5, y - s * 0.5, x + w, y);
      g.closePath();
      g.fillStyle = LIGHT;
      g.fill();
      // shaded east face
      g.beginPath();
      g.moveTo(x + top, y - s);
      g.quadraticCurveTo(x + w * 0.5, y - s * 0.5, x + w, y);
      g.lineTo(x + w * 0.1, y);
      g.quadraticCurveTo(x + w * 0.15, y - s * 0.5, x + top, y - s);
      g.fillStyle = SHADE;
      g.fill();
      g.beginPath();
      g.moveTo(x - w, y);
      g.quadraticCurveTo(x - w * 0.45, y - s * 0.55, x - top, y - s);
      g.lineTo(x + top, y - s);
      g.quadraticCurveTo(x + w * 0.5, y - s * 0.5, x + w, y);
      g.stroke();
      if (kind === 'volcano') {
        g.strokeStyle = '#b5562c';
        g.beginPath();
        g.moveTo(x, y - s * 1.05);
        g.bezierCurveTo(x - s * 0.2, y - s * 1.3, x + s * 0.2, y - s * 1.4, x, y - s * 1.65);
        g.stroke();
      }
      break;
    }
    case 'hill':
      g.beginPath();
      g.moveTo(x - w * 1.1, y);
      g.quadraticCurveTo(x, y - s * 0.9, x + w * 1.1, y);
      g.fillStyle = LIGHT;
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
      break;
    case 'conifer':
      g.beginPath();
      g.moveTo(x, y - s);
      g.lineTo(x + w * 0.55, y - s * 0.18);
      g.lineTo(x - w * 0.55, y - s * 0.18);
      g.closePath();
      g.fillStyle = '#4a6f5c';
      g.fill();
      g.stroke();
      g.beginPath(); g.moveTo(x, y - s * 0.18); g.lineTo(x, y); g.stroke();
      break;
    case 'tree':
      g.beginPath(); g.moveTo(x, y - s * 0.4); g.lineTo(x, y); g.stroke();
      g.beginPath();
      g.arc(x, y - s * 0.62, s * 0.34, 0, Math.PI * 2);
      g.fillStyle = '#5f9156';
      g.fill();
      g.stroke();
      break;
    case 'palm':
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + s * 0.12, y - s * 0.5, x + s * 0.05, y - s * 0.85);
      g.stroke();
      g.strokeStyle = '#3f7a46';
      for (const a of [-2.6, -2.0, -1.2, -0.5]) {
        g.beginPath();
        g.moveTo(x + s * 0.05, y - s * 0.85);
        g.quadraticCurveTo(x + s * 0.05 + Math.cos(a) * s * 0.3, y - s * 0.85 + Math.sin(a) * s * 0.3 - s * 0.05, x + s * 0.05 + Math.cos(a) * s * 0.45, y - s * 0.85 + Math.sin(a) * s * 0.1 + s * 0.15);
        g.stroke();
      }
      break;
    case 'reeds':
      g.strokeStyle = '#4f6b45';
      for (const dx of [-0.3, 0, 0.3]) {
        g.beginPath();
        g.moveTo(x + dx * s, y);
        g.lineTo(x + dx * s * 1.2, y - s * (dx === 0 ? 0.8 : 0.55));
        g.stroke();
      }
      g.beginPath(); g.moveTo(x - s * 0.5, y); g.lineTo(x + s * 0.5, y); g.stroke();
      break;
    case 'dunes':
      g.strokeStyle = '#9a7b4f';
      g.beginPath();
      g.moveTo(x - s * 0.7, y);
      g.quadraticCurveTo(x - s * 0.3, y - s * 0.45, x + s * 0.05, y);
      g.moveTo(x - s * 0.05, y - s * 0.1);
      g.quadraticCurveTo(x + s * 0.35, y - s * 0.55, x + s * 0.7, y - s * 0.05);
      g.stroke();
      break;
    case 'rocks':
      g.fillStyle = SHADE;
      for (const [dx, r] of [[-0.3, 0.22], [0.12, 0.3], [0.45, 0.18]] as const) {
        g.beginPath();
        g.moveTo(x + (dx - r) * s, y);
        g.lineTo(x + (dx - r * 0.4) * s, y - r * 1.4 * s);
        g.lineTo(x + (dx + r * 0.6) * s, y - r * 1.1 * s);
        g.lineTo(x + (dx + r) * s, y);
        g.closePath();
        g.fill();
        g.stroke();
      }
      break;
  }
  g.restore();
}

/** MK-3: a simple compass rose. */
export function drawCompass(g: CanvasRenderingContext2D, x: number, y: number, r: number, fg: string, bg: string) {
  g.save();
  g.translate(x, y);
  g.globalAlpha = 0.9;
  g.fillStyle = bg;
  g.beginPath(); g.arc(0, 0, r * 1.25, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = fg;
  g.lineWidth = 1;
  g.beginPath(); g.arc(0, 0, r * 0.9, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 4; k++) {
    g.save();
    g.rotate((k * Math.PI) / 2);
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.2, 0);
    g.lineTo(0, 0);
    g.closePath();
    g.fillStyle = k === 0 ? '#b5562c' : fg;
    g.fill();
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(-r * 0.2, 0);
    g.lineTo(0, 0);
    g.closePath();
    g.fillStyle = bg;
    g.fill();
    g.stroke();
    g.restore();
  }
  g.fillStyle = fg;
  g.font = `bold ${Math.round(r * 0.5)}px system-ui`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  g.fillText('N', 0, -r - 1);
  g.restore();
}

let grain: HTMLCanvasElement | null = null;
/** MK-12: paper grain and a soft dark edge over the whole map, for the parchment look. */
export function paintParchment(g: CanvasRenderingContext2D, w: number, h: number) {
  if (!grain) {
    grain = document.createElement('canvas');
    grain.width = grain.height = 256;
    const c = grain.getContext('2d')!;
    const img = c.createImageData(256, 256);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 256 * 256; i++) {
      const fib = Math.sin(i * 0.37) * 0.5 + 0.5; // faint fibres
      const v = 222 + rnd() * 28 + fib * 5;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.95; img.data[i * 4 + 2] = v * 0.82; img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = g.createPattern(grain, 'repeat')!;
  g.fillRect(0, 0, w, h);
  const r = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(1, 'rgba(110,80,40,0.35)');
  g.fillStyle = r;
  g.fillRect(0, 0, w, h);
  g.restore();
}
