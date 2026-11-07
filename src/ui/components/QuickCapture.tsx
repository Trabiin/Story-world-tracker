/**
 * NT-3: quick capture. Ctrl+Shift+N (or the Note button) opens a small box from anywhere, also in
 * focus mode. The first line becomes the title. The note lands in the Notebook's Inbox, linked to
 * what was open when you wrote it unless you take that link off.
 */
import { useState } from 'react';
import { TodoRef, captureNote, refLabel } from '../../core';
import { recordBase } from '../../storage';
import { useApp } from '../context';
import { REF_LABEL } from './Refs';

export function QuickCapture({ about, onClose }: { about?: TodoRef; onClose: () => void }) {
  const { world, store } = useApp();
  const [text, setText] = useState('');
  const label = about ? refLabel(world, about.kind, about.id) : undefined;
  const [link, setLink] = useState(!!label);
  const [saved, setSaved] = useState(0);
  const save = (again: boolean) => {
    if (!text.trim()) return onClose();
    if (store.readOnly) { store.onBlocked?.(); return; }
    store.upsert('notes', captureNote(text, link && about && label ? [about] : [], recordBase()));
    if (again) { setText(''); setSaved((n) => n + 1); } else onClose();
  };
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && save(false)}>
      <div className="command quick-capture" role="dialog" aria-label="Quick note">
        <textarea
          autoFocus
          rows={4}
          placeholder="Jot it down. The first line is the title."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(e.shiftKey); }
          }}
        />
        <div className="quick-preview">
          {label ? <label className="quick-about"><input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> About {REF_LABEL[about!.kind]} <b>{label}</b></label> : <span className="muted small">Not linked to anything</span>}
          <button className="primary small" onClick={() => save(false)} disabled={!text.trim()}>Save to Inbox</button>
        </div>
        <div className="quick-hint muted small">{saved ? `${saved} saved to the Inbox. ` : ''}Ctrl+Enter saves · Ctrl+Shift+Enter saves and starts another · Esc cancels</div>
      </div>
    </div>
  );
}
