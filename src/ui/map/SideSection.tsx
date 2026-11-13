/** A side-panel section that folds away and stays as it was left, on this computer (MK-32). */
import { ReactNode, useState } from 'react';

const key = (id: string) => `swt.mapSection.${id}`;

export function SideSection({ id, title, children, defaultOpen = true, extra }: { id: string; title: string; children: ReactNode; defaultOpen?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key(id)); return v === null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
  });
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key(id), o ? '0' : '1'); } catch { /* ignore */ }
      return !o;
    });
  };
  return (
    <section className={`side-section${open ? ' open' : ''}`}>
      <h3 className="side-section-head">
        <button className="link" aria-expanded={open} onClick={toggle}><span className="caret">{open ? '▾' : '▸'}</span> {title}</button>
        {extra}
      </h3>
      {open && <div className="side-section-body">{children}</div>}
    </section>
  );
}
