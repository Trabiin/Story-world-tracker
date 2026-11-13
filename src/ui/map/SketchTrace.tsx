/**
 * MK-17 and MK-15: find the coastline in a sketch pinned on the map, check it against the picture,
 * then lay it onto the globe as land and sea (flat, or as rough hills and deepening seas) to refine
 * with the brushes. One undo step.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DETECT, DetectOptions, LandMask, MapImage, detectLand, landShare, laySketchLand, refreshAutoRivers, tilesInBounds } from '../../core';
import { ask } from '../components/Dialogs';
import { Modal } from '../components/Modal';
import { useApp } from '../context';

/** The sketch is read at most this many pixels on its long side. */
const WORK_PX = 720;

export function SketchTraceDialog({ image, onClose, onDone }: { image: MapImage; onClose: () => void; onDone?: () => void }) {
  const { world, store } = useApp();
  const [pixels, setPixels] = useState<ImageData | undefined>();
  const [opts, setOpts] = useState<DetectOptions>(DEFAULT_DETECT);
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [rough, setRough] = useState(true);
  const [peak, setPeak] = useState(1200);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = new Image();
    el.onload = () => {
      const k = Math.min(1, WORK_PX / Math.max(el.naturalWidth, el.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(el.naturalWidth * k));
      c.height = Math.max(1, Math.round(el.naturalHeight * k));
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(el, 0, 0, c.width, c.height);
      setPixels(g.getImageData(0, 0, c.width, c.height));
    };
    el.src = image.dataUrl;
  }, [image.dataUrl]);

  const mask = useMemo<LandMask | undefined>(() => (pixels ? detectLand(pixels, opts) : undefined), [pixels, opts]);

  // The picture, with what was found tinted over it: green land, blue sea.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !pixels || !mask) return;
    c.width = pixels.width; c.height = pixels.height;
    const g = c.getContext('2d')!;
    const out = new ImageData(pixels.width, pixels.height);
    for (let i = 0; i < mask.land.length; i++) {
      const [r, gg, b] = mask.land[i] ? [70, 150, 70] : [70, 130, 200];
      for (let k = 0; k < 3; k++) out.data[i * 4 + k] = Math.round(pixels.data[i * 4 + k] * 0.55 + [r, gg, b][k] * 0.45);
      out.data[i * 4 + 3] = 255;
    }
    g.putImageData(out, 0, 0);
  }, [pixels, mask]);

  const set = (p: Partial<DetectOptions>) => setOpts((o) => ({ ...o, ...p }));
  const share = mask ? landShare(mask) : 0;

  const use = () => {
    if (!mask) return;
    let counts = { land: 0, water: 0 };
    store.update((w) => {
      const r = laySketchLand(w.terrain, mask, image, { mode, rough, peakM: peak, planetRadiusKm: w.settings.radiusKm, seed: 3 });
      counts = r;
      if (r.terrain === w.terrain) return w;
      // Automatic rivers follow the new coastline (MK-25).
      // Fade the sketch so the new land shows through it.
      const mapImages = w.mapImages.map((m) => (m.id === image.id ? { ...m, opacity: Math.min(m.opacity, 0.4) } : m));
      return refreshAutoRivers({ ...w, mapImages, terrain: r.terrain }, tilesInBounds(w.terrain.cellDeg, image));
    });
    onClose();
    onDone?.();
    void ask.alert(counts.land || counts.water
      ? `The coastline from ${image.name} is on the map${rough ? ', with rough hills and seas' : ''}. Fix it with the Land and Water brushes, or roughen it with "Add detail". Undo takes it back.`
      : 'Nothing changed: the land found is already on the map.');
  };

  return (
    <Modal title={`Find the coastline in ${image.name}`} onClose={onClose} wide
      footer={<><span className="muted small">{mask ? `${Math.round(share * 100)}% of the sketch is land` : 'Reading the sketch…'}</span><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!mask || share === 0} onClick={use}>Use as coastline</button></>}>
      <div className="sketch-trace">
        <div className="sketch-preview">
          <canvas ref={canvas} aria-label="The sketch with the land found tinted green and the sea blue" />
        </div>
        <div className="stack small sketch-opts">
          <div className="seg">
            <button className={opts.mode === 'outline' ? 'on' : ''} onClick={() => set({ mode: 'outline' })} title="Coastlines drawn as lines: what the lines close in is land">Drawn outlines</button>
            <button className={opts.mode === 'filled' ? 'on' : ''} onClick={() => set({ mode: 'filled' })} title="Land shaded or coloured in: dark areas are land">Filled-in land</button>
          </div>
          <label className="field"><span className="label">{opts.mode === 'outline' ? 'How dark a line must be' : 'How dark land must be'}</span>
            <input type="range" min={30} max={230} value={opts.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
          </label>
          {opts.mode === 'outline' && (
            <label className="field"><span className="label">Close breaks in the coastline up to {opts.gap * 2} px</span>
              <input type="range" min={0} max={8} value={opts.gap} onChange={(e) => set({ gap: Number(e.target.value) })} />
            </label>
          )}
          <label className="field"><span className="label">Ignore specks and lettering smaller than {opts.minArea} px</span>
            <input type="range" min={0} max={600} step={10} value={opts.minArea} onChange={(e) => set({ minArea: Number(e.target.value) })} />
          </label>
          <label className="checkbox"><input type="checkbox" checked={!!opts.invert} onChange={(e) => set({ invert: e.target.checked })} /> Swap land and sea</label>
          <hr />
          <label className="checkbox"><input type="radio" name="lay" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Land and sea inside the sketch follow it</label>
          <label className="checkbox"><input type="radio" name="lay" checked={mode === 'add'} onChange={() => setMode('add')} /> Only add land (keep land already painted)</label>
          <label className="checkbox"><input type="checkbox" checked={rough} onChange={(e) => setRough(e.target.checked)} /> Rough terrain to start from: hills rising inland, seas deepening offshore</label>
          {rough && (
            <label className="field"><span className="label">Inland heights up to about {peak.toLocaleString()} m</span>
              <input type="range" min={200} max={4000} step={100} value={peak} onChange={(e) => setPeak(Number(e.target.value))} />
            </label>
          )}
          <p className="muted">Green is land, blue is sea. The sketch is laid where it is pinned ({image.north.toFixed(1)}° to {image.south.toFixed(1)}°, {image.west.toFixed(1)}° to {image.east.toFixed(1)}°), so pin it first. {world.terrain && Object.keys(world.terrain.tiles).length ? 'Painted terrain types are kept.' : ''}</p>
        </div>
      </div>
    </Modal>
  );
}
