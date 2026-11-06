/** EU-10: pictures on an encyclopedia page. Images are shrunk to at most 1200 px and kept in the world file. */
import { useRef, useState } from 'react';
import { Picture } from '../../core';
import { useApp } from '../context';

async function shrink(file: File, max = 1200): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export function Pictures({ value = [], onChange }: { value?: Picture[]; onChange: (v: Picture[] | undefined) => void }) {
  const { store } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [big, setBig] = useState<Picture | null>(null);
  const [err, setErr] = useState('');
  const add = async (files: FileList | null) => {
    setErr('');
    const out = [...value];
    for (const f of Array.from(files ?? [])) {
      if (!f.type.startsWith('image/')) continue;
      try { out.push({ id: crypto.randomUUID(), src: await shrink(f), caption: f.name.replace(/\.[^.]+$/, '') }); } catch { setErr(`Could not read ${f.name}.`); }
    }
    onChange(out);
  };
  const set = (id: string, p: Partial<Picture>) => onChange(value.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return (
    <section className="pictures">
      <div className="section-head">
        <h2>Pictures</h2>
        <button className="small" disabled={store.readOnly} onClick={() => input.current?.click()}>+ Add picture</button>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
      </div>
      {err && <p className="error small">{err}</p>}
      {value.length === 0 ? <p className="muted small">Maps, sketches, portraits, mood images. They are stored in the world file.</p> : (
        <div className="picture-grid">
          {value.map((p) => (
            <figure key={p.id}>
              <img src={p.src} alt={p.caption} onClick={() => setBig(p)} />
              <figcaption className="row">
                <input value={p.caption} placeholder="Caption" onChange={(e) => set(p.id, { caption: e.target.value })} />
                <button className="icon" aria-label="Remove picture" onClick={() => { const v = value.filter((x) => x.id !== p.id); onChange(v.length ? v : undefined); }}>×</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {big && (
        <div className="modal-backdrop" onMouseDown={() => setBig(null)}>
          <figure className="picture-big"><img src={big.src} alt={big.caption} /><figcaption>{big.caption}</figcaption></figure>
        </div>
      )}
    </section>
  );
}
