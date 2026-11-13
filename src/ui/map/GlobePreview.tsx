/** MK-27: the world as a sphere. Drag to turn it; it can also spin on its own. */
import { useEffect, useRef, useState } from 'react';
import { canvasRatio } from '../perf';
import type { LatLng } from '../../core';
import type { Overview } from './terrainRender';

interface Props {
  overview: Overview;
  version: number;
  start: LatLng;
  points: { pos: LatLng; color: string }[];
  onClose: () => void;
  onPick?: (p: LatLng) => void;
}

const SIZE = 300;
const RAD = Math.PI / 180;

export function GlobePreview({ overview, version, start, points, onClose, onPick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [rot, setRot] = useState({ lat: Math.max(-60, Math.min(60, start.lat)), lng: start.lng });
  const [spin, setSpin] = useState(false);
  const pixels = useRef<ImageData | null>(null);
  const drag = useRef<{ x: number; y: number; r: typeof rot; moved: boolean } | null>(null);

  useEffect(() => { pixels.current = overview.pixels(); }, [overview, version]);

  useEffect(() => {
    if (!spin) return;
    let raf = 0, last = performance.now();
    const step = (t: number) => {
      setRot((r) => ({ ...r, lng: ((r.lng + (t - last) * 0.012 + 540) % 360) - 180 }));
      last = t;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, canvasRatio());
    const n = Math.round(SIZE * dpr);
    cv.width = n; cv.height = n;
    const g = cv.getContext('2d')!;
    const src = pixels.current ?? overview.pixels();
    pixels.current = src;
    const img = g.createImageData(n, n);
    const R = n / 2 - 2 * dpr, c = n / 2;
    const s0 = Math.sin(rot.lat * RAD), c0 = Math.cos(rot.lat * RAD);
    const W = src.width, H = src.height, sd = src.data, d = img.data;
    for (let y = 0; y < n; y++) {
      const ny = (c - y - 0.5) / R;
      for (let x = 0; x < n; x++) {
        const nx = (x + 0.5 - c) / R;
        const rho2 = nx * nx + ny * ny;
        if (rho2 > 1) continue;
        const z = Math.sqrt(1 - rho2);
        const lat = Math.asin(Math.max(-1, Math.min(1, z * s0 + ny * c0))) / RAD;
        let lng = rot.lng + Math.atan2(nx, z * c0 - ny * s0) / RAD;
        lng = ((lng + 540) % 360) - 180;
        const px = Math.min(W - 1, Math.floor(((lng + 180) / 360) * W)), py = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
        const si = (py * W + px) * 4, o = (y * n + x) * 4;
        const light = 0.55 + 0.45 * z;
        let r = sd[si] * light, gg = sd[si + 1] * light, b = sd[si + 2] * light;
        const latM = Math.abs(((lat + 90) % 30 + 30) % 30), lngM = Math.abs(((lng + 180) % 30 + 30) % 30);
        if (Math.min(latM, 30 - latM) < 0.45 || Math.min(lngM, 30 - lngM) < 0.45 / Math.max(0.2, Math.cos(lat * RAD))) {
          r = r * 0.75 + 255 * 0.25; gg = gg * 0.75 + 255 * 0.25; b = b * 0.75 + 255 * 0.25;
        }
        d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // atmosphere rim
    g.strokeStyle = 'rgba(120,170,210,0.8)';
    g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
    for (const p of points) {
      const φ = p.pos.lat * RAD, dλ = (p.pos.lng - rot.lng) * RAD;
      const cosc = s0 * Math.sin(φ) + c0 * Math.cos(φ) * Math.cos(dλ);
      if (cosc <= 0) continue;
      const x = c + R * Math.cos(φ) * Math.sin(dλ), y = c - R * (c0 * Math.sin(φ) - s0 * Math.cos(φ) * Math.cos(dλ));
      g.fillStyle = p.color;
      g.beginPath(); g.arc(x, y, 3 * dpr, 0, Math.PI * 2); g.fill();
    }
  }, [rot, overview, version, points]);

  const toLatLng = (cx: number, cy: number): LatLng | null => {
    const r = ref.current!.getBoundingClientRect();
    const R = SIZE / 2 - 2, c = SIZE / 2;
    const nx = (cx - r.left - c) / R, ny = (c - (cy - r.top)) / R;
    const rho2 = nx * nx + ny * ny;
    if (rho2 > 1) return null;
    const z = Math.sqrt(1 - rho2), s0 = Math.sin(rot.lat * RAD), c0 = Math.cos(rot.lat * RAD);
    const lat = Math.asin(z * s0 + ny * c0) / RAD;
    const lng = ((rot.lng + Math.atan2(nx, z * c0 - ny * s0) / RAD + 540) % 360) - 180;
    return { lat, lng };
  };

  return (
    <div className="globe-preview card" onWheel={(e) => e.stopPropagation()}>
      <div className="row">
        <b>Globe</b>
        <label className="checkbox small"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> Spin</label>
        <span className="spacer" />
        <button className="icon" onClick={onClose} title="Close">×</button>
      </div>
      <canvas
        ref={ref}
        style={{ width: SIZE, height: SIZE, cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, r: rot, moved: false }; setSpin(false); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
          const k = 180 / SIZE;
          setRot({ lat: Math.max(-89, Math.min(89, d.r.lat + (e.clientY - d.y) * k)), lng: ((d.r.lng - (e.clientX - d.x) * k + 540) % 360) - 180 });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved && onPick) { const p = toLatLng(e.clientX, e.clientY); if (p) onPick(p); }
        }}
      />
      <p className="muted small">Drag to turn. Click to show that spot on the flat map.</p>
    </div>
  );
}
