/** "Find on map" in the map toolbar (MK-30): type part of a name, pick a match, the map glides there. */
import { useEffect, useRef, useState } from 'react';
import { FindEntry, findMatches } from './findOnMap';

const KIND_MARK: Record<FindEntry['kind'], string> = { place: '●', feature: '〰', region: '▦', character: '☺' };

export function FindBox({ entries, onPick }: { entries: FindEntry[]; onPick: (e: FindEntry) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = open ? findMatches(entries, text) : [];
  const pick = (e: FindEntry) => { onPick(e); setText(e.name); setOpen(false); input.current?.blur(); };

  // "/" jumps to the box from anywhere on the map, unless something else is being typed in
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) return;
      if (document.querySelector('.modal-backdrop')) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  return (
    <div className="map-find" onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        type="search"
        value={text}
        placeholder="Find on map… (/)"
        aria-label="Find a place, feature, realm or character on the map"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
      />
      {open && text.trim() && (
        <ul className="map-find-list" role="listbox">
          {matches.length === 0 && <li className="muted small">Nothing on the map by that name on this date.</li>}
          {matches.map((m, i) => (
            <li key={`${m.kind}:${m.id}`} role="option" aria-selected={i === hi}>
              <button className={i === hi ? 'hi' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)} onMouseEnter={() => setHi(i)}>
                <span className="mark">{KIND_MARK[m.kind]}</span> {m.name} <span className="muted small">{m.note}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
