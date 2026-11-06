/**
 * WR-11: the list of records shown while typing "@name", and the picker for linking selected words
 * (Ctrl+L or the toolbar's Link button). WR-10: the card shown when hovering a name in the text.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { LinkTarget, NameCard, linkTargets } from '../../core';
import { useApp } from '../context';

/** Position a floating box under a point, kept inside the window. */
function place(left: number, top: number, w: number, h: number): { left: number; top: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200, vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let y = top + 4;
  if (y + h > vh - 8) y = Math.max(8, top - h - 28);
  return { left: Math.max(8, Math.min(left, vw - w - 8)), top: y };
}

export function TargetList({ items, index, onPick, onHover }: { items: LinkTarget[]; index: number; onPick: (t: LinkTarget) => void; onHover?: (i: number) => void }) {
  if (!items.length) return <div className="link-empty muted small">No record by that name. Keep typing, or Esc.</div>;
  return (
    <ul className="link-items" role="listbox">
      {items.map((t, i) => (
        <li key={t.kind + t.id} role="option" aria-selected={i === index} className={i === index ? 'active' : ''}
          onMouseDown={(e) => { e.preventDefault(); onPick(t); }} onMouseEnter={() => onHover?.(i)}>
          <span>{t.label}</span> <small className="muted">{t.detail}</small>
        </li>
      ))}
    </ul>
  );
}

/** WR-11: the "@" list. Keys are handled by the page (the editor keeps the focus). */
export function MentionMenu({ left, top, items, index, onPick, onHover }: { left: number; top: number; items: LinkTarget[]; index: number; onPick: (t: LinkTarget) => void; onHover: (i: number) => void }) {
  const pos = place(left, top, 300, 40 + items.length * 30);
  return (
    <div className="link-menu" style={pos} onMouseDown={(e) => e.preventDefault()}>
      <div className="link-head muted small">Link to… <span>↑↓ Enter · Esc</span></div>
      <TargetList items={items} index={index} onPick={onPick} onHover={onHover} />
    </div>
  );
}

/** WR-11: pick a record for the selected words. */
export function LinkPicker({ left, top, initial, onPick, onClose }: { left: number; top: number; initial: string; onPick: (t: LinkTarget) => void; onClose: () => void }) {
  const { world } = useApp();
  const [q, setQ] = useState(initial);
  const [index, setIndex] = useState(0);
  const items = useMemo(() => linkTargets(world, q, 10), [world, q]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  useEffect(() => setIndex(0), [q]);
  const pos = place(left, top, 320, 80 + items.length * 30);
  return (
    <>
      <div className="link-backdrop" onMouseDown={onClose} />
      <div className="link-menu picker" style={pos}>
        <input ref={ref} value={q} placeholder="Link to a character, place, realm, event…" aria-label="Find a record to link"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (items[index]) onPick(items[index]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }} />
        <TargetList items={items} index={index} onPick={onPick} onHover={setIndex} />
      </div>
    </>
  );
}

/** WR-10: the hover card. */
export function NameCardBox({ card, left, top, linked, onOpen, onLink, onUnlink, onEnter, onLeave }: {
  card: NameCard; left: number; top: number; linked: boolean;
  onOpen: () => void; onLink?: () => void; onUnlink?: () => void; onEnter: () => void; onLeave: () => void;
}) {
  const pos = place(left, top, 320, 120 + (card.lines.length + card.reader.length) * 22);
  return (
    <div className="name-card" style={pos} onMouseEnter={onEnter} onMouseLeave={onLeave} role="dialog" aria-label={card.title}>
      <div className="name-card-head">
        <b>{card.title}</b>
        {card.subtitle && <div className="muted small">{card.subtitle}</div>}
      </div>
      {card.lines.length > 0 && (
        <dl className="name-card-lines">
          {card.lines.map((l) => <Fragment key={l.label}><dt>{l.label}</dt><dd>{l.text}</dd></Fragment>)}
        </dl>
      )}
      {card.reader.length > 0 && (
        <div className="name-card-reader">
          <div className="muted small">The reader so far</div>
          {card.reader.map((r, i) => <div key={i} className="small">{r}</div>)}
        </div>
      )}
      <div className="name-card-actions">
        {!card.missing && <button className="small" onClick={onOpen}>Open page</button>}
        {!linked && onLink && !card.missing && <button className="small" onClick={onLink} title="WR-11: make this name a link to the record">Link</button>}
        {linked && onUnlink && <button className="small" onClick={onUnlink}>Remove link</button>}
        <span className="muted small">{linked ? 'Linked' : 'Name'} · Ctrl+click opens</span>
      </div>
    </div>
  );
}
