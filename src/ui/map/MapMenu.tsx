/** The menu for a spot on the map (MK-33): right-click, or press and hold on a touchscreen. */
import { useEffect, useRef } from 'react';

export interface MenuItem { label: string; onClick: () => void; danger?: boolean }

export function MapMenu({ x, y, title, groups, bounds, onClose }: {
  x: number; y: number; title?: string; groups: MenuItem[][]; bounds: { w: number; h: number }; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // wait a moment, so the press that opened the menu doesn't close it
    const t = setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const items = groups.filter((g) => g.length);
  const rows = items.reduce((n, g) => n + g.length, 0);
  const left = Math.min(x, bounds.w - 210), top = Math.min(y, bounds.h - 34 * rows - 16 * items.length - (title ? 30 : 0));
  return (
    <div ref={ref} className="map-menu" role="menu" style={{ left: Math.max(4, left), top: Math.max(4, top) }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {title && <div className="map-menu-title">{title}</div>}
      {items.map((g, gi) => (
        <div key={gi} className="map-menu-group">
          {g.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { onClose(); it.onClick(); }}>{it.label}</button>
          ))}
        </div>
      ))}
    </div>
  );
}
