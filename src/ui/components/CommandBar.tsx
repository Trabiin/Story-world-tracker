/** EU-5: jump to any character, place, group or date by typing part of its name. Ctrl/Cmd+K. */
import { useMemo, useState } from 'react';
import { formatFuzzy, parseFuzzyDate, toWindow } from '../../core';
import { useApp, View } from '../context';

interface Item {
  label: string;
  sub: string;
  run: () => void;
}

export function CommandBar({ onClose }: { onClose: () => void }) {
  const { world, go, store, edit } = useApp();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const items = useMemo<Item[]>(() => {
    const s = q.trim().toLowerCase();
    const out: Item[] = [];
    const d = parseFuzzyDate(q);
    if (d) out.push({ label: `Go to ${formatFuzzy(d)}`, sub: 'Set the current moment', run: () => store.setMoment(toWindow(d, world.settings.hemisphereForSeasons).earliest) });
    const match = (name: string, aliases: string[] = []) => !s || name.toLowerCase().includes(s) || aliases.some((a) => a.toLowerCase().includes(s));
    for (const c of world.characters) if (match(c.name, c.aliases)) out.push({ label: c.name, sub: `Character${c.archived ? ' · archived' : ''}`, run: () => go('characters', c.id) });
    for (const p of world.places) if (match(p.name, p.aliases)) out.push({ label: p.name, sub: `Place · ${p.kind}`, run: () => go('places', p.id) });
    for (const g of world.groups) if (match(g.name)) out.push({ label: g.name, sub: 'Group', run: () => go('groups', g.id) });
    const views: [string, View][] = [['Who is where', 'who'], ['Timeline', 'timeline'], ['Map', 'map'], ['Warnings', 'warnings'], ['Settings', 'settings']];
    for (const [label, v] of views) if (match(label)) out.push({ label, sub: 'View', run: () => go(v) });
    if (match('new stay')) out.push({ label: 'New stay', sub: 'Action', run: () => edit({ kind: 'stay' }) });
    if (match('new journey')) out.push({ label: 'New journey', sub: 'Action', run: () => edit({ kind: 'journey' }) });
    return out.slice(0, 40);
  }, [q, world, go, store, edit]);
  const run = (it?: Item) => { if (it) { it.run(); onClose(); } };
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="command">
        <input
          autoFocus
          placeholder="Jump to a character, place, group, view or date…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter') run(items[i]);
          }}
        />
        <ul>
          {items.map((it, k) => (
            <li key={k} className={k === i ? 'active' : ''} onMouseEnter={() => setI(k)} onClick={() => run(it)}>
              <span>{it.label}</span><small>{it.sub}</small>
            </li>
          ))}
          {items.length === 0 && <li className="muted">Nothing found</li>}
        </ul>
      </div>
    </div>
  );
}
