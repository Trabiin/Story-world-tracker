/** WR-6: a scene's saved versions. Compare any two side by side, or one with the text now, and restore one. */
import type { EditorView } from 'prosemirror-view';
import { useEffect, useMemo, useState } from 'react';
import { DiffRow, Id, SceneVersion, TextNode, addVersion, diffParagraphs, docParagraphs, docToPlain, makeVersion, unpackDoc, versionsOf } from '../../core';
import { ask } from '../components/Dialogs';
import { useApp } from '../context';
import { commitText, docNode } from './SceneEditor';

const CURRENT = 'current';

export function HistoryPanel({ sceneId, view, onClose }: { sceneId: Id; view?: EditorView; onClose: () => void }) {
  const { world, store } = useApp();
  const scene = world.scenes.find((s) => s.id === sceneId);
  const versions = versionsOf(world, sceneId);
  const [a, setA] = useState<string>(versions[0]?.id ?? CURRENT);
  const [b, setB] = useState<string>(CURRENT);
  const [docs, setDocs] = useState<Record<string, TextNode>>({});
  const currentDoc = (): TextNode | undefined => (view ? (view.state.doc.toJSON() as TextNode) : world.sceneTexts.find((t) => t.sceneId === sceneId)?.doc);

  useEffect(() => {
    let live = true;
    for (const id of [a, b]) {
      if (id === CURRENT || docs[id]) continue;
      const v = versions.find((x) => x.id === id);
      if (v) void unpackDoc(v.data).then((d) => live && setDocs((m) => ({ ...m, [id]: d })));
    }
    return () => { live = false; };
  }, [a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  const docFor = (id: string) => (id === CURRENT ? currentDoc() : docs[id]);
  const left = docFor(a), right = docFor(b);
  const rows: DiffRow[] | undefined = useMemo(
    () => (left && right ? diffParagraphs(docParagraphs(left).map((p) => p.text), docParagraphs(right).map((p) => p.text)) : undefined),
    [left, right, world.sceneTexts], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const changed = rows?.filter((r) => r.changed).length ?? 0;

  const saveNow = async () => {
    const doc = currentDoc();
    if (!doc) return;
    const label = await ask.prompt('Name this version (for example "Before cutting the duel")', 'Kept by hand');
    if (label === null) return;
    if (view) commitText(store, sceneId, doc);
    const v = await makeVersion(sceneId, doc, label.trim() || 'Kept by hand', true);
    store.update((w) => addVersion(w, v), false);
    setA(v.id);
  };

  const restore = async (v: SceneVersion) => {
    if (!(await ask.confirm(`Put the text back as it was on ${when(v)}? The text as it is now is kept as a version first, so you can come back to it.`, { okLabel: 'Restore' }))) return;
    const now = currentDoc();
    if (now) {
      const keep = await makeVersion(sceneId, now, `Before restoring ${when(v)}`);
      store.update((w) => addVersion(w, keep), false);
    }
    const doc = docs[v.id] ?? (await unpackDoc(v.data));
    if (view) {
      // Through the editor, so Ctrl+Z can take the restore back too.
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, docNode(doc).content));
    } else commitText(store, sceneId, doc);
    setB(CURRENT);
  };

  const togglePin = (v: SceneVersion) => store.update((w) => ({ ...w, sceneVersions: w.sceneVersions.map((x) => (x.id === v.id ? { ...x, pinned: !x.pinned } : x)) }), false);
  const remove = async (v: SceneVersion) => {
    if (!(await ask.confirm(`Delete the version from ${when(v)}?`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({ ...w, sceneVersions: w.sceneVersions.filter((x) => x.id !== v.id) }), false);
    if (a === v.id) setA(CURRENT);
    if (b === v.id) setB(CURRENT);
  };

  const label = (id: string) => (id === CURRENT ? 'Now' : (() => { const v = versions.find((x) => x.id === id); return v ? `${when(v)} · ${v.label}` : '?'; })());
  const current = world.sceneTexts.find((t) => t.sceneId === sceneId);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history-modal" role="dialog" aria-label="Scene history">
        <header>
          <h2>History of {scene?.title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="history-body">
          <aside className="history-list">
            <button className="primary" onClick={saveNow}>Keep a version now…</button>
            <p className="muted small">A version is kept when you leave a scene you changed, every half hour of writing, before a restore and on import. Older automatic ones are thinned out; pinned ones (📌) are kept for good.</p>
            <ul className="plain">
              <li className={`history-item ${a === CURRENT || b === CURRENT ? 'on' : ''}`}>
                <div><b>Now</b> <span className="muted small">{(current?.words ?? 0).toLocaleString('en-US')} words</span></div>
                <div className="row small"><button className="link" onClick={() => setA(CURRENT)}>Left</button><button className="link" onClick={() => setB(CURRENT)}>Right</button></div>
              </li>
              {versions.map((v, i) => {
                const prev = versions[i + 1];
                const delta = prev ? v.words - prev.words : 0;
                return (
                  <li key={v.id} className={`history-item ${a === v.id || b === v.id ? 'on' : ''}`}>
                    <div>{v.pinned && '📌 '}<b>{when(v)}</b> <span className="muted small">{v.words.toLocaleString('en-US')} words{delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}</span></div>
                    <div className="muted small">{v.label}</div>
                    <div className="row small wrap">
                      <button className="link" onClick={() => setA(v.id)}>Left</button>
                      <button className="link" onClick={() => setB(v.id)}>Right</button>
                      <button className="link" disabled={store.readOnly} onClick={() => void restore(v)}>Restore</button>
                      <button className="link" onClick={() => togglePin(v)}>{v.pinned ? 'Unpin' : 'Pin'}</button>
                      <button className="link danger" onClick={() => void remove(v)}>Delete</button>
                    </div>
                  </li>
                );
              })}
              {versions.length === 0 && <li className="muted">No versions yet. One is kept the first time you leave this scene after changing it.</li>}
            </ul>
          </aside>
          <section className="history-compare">
            <div className="history-cols head"><div><b>{label(a)}</b></div><div><b>{label(b)}</b></div></div>
            {!rows && <p className="muted">Loading…</p>}
            {rows && a === b && <p className="muted">Choose two different versions to compare.</p>}
            {rows && a !== b && <p className="muted small">{changed === 0 ? 'No differences.' : `${changed} paragraph${changed === 1 ? '' : 's'} differ. Removed words are struck through on the left, added words are marked on the right.`}</p>}
            {rows && a !== b && rows.map((r, i) => (
              <div key={i} className={`history-cols ${r.changed ? 'changed' : ''}`}>
                <div>{r.left?.map((p, j) => <span key={j} className={`diff-${p.op}`}>{p.text}</span>)}</div>
                <div>{r.right?.map((p, j) => <span key={j} className={`diff-${p.op}`}>{p.text}</span>)}</div>
              </div>
            ))}
            {rows && left && !docToPlain(left).trim() && !docToPlain(right).trim() && <p className="muted">Both are empty.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function when(v: SceneVersion): string {
  const d = new Date(v.at);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}
