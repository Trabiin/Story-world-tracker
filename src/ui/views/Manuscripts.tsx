/**
 * ST-8..ST-11: connect Word manuscripts (read-only), read them in the app, link passages to
 * records, and find those passages again after the manuscript is edited.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Id, LinkTargetKind, Manuscript, ManuscriptLink, Suggestion, formatFuzzy, fromDay, makeAnchor, nameSuggestions, readDocx, reanchor, textHash } from '../../core';
import { nowIso, recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { Field, Modal } from '../components/Modal';
import { AppCtx, useApp } from '../context';
import { placeName, sortByName, subjectName } from '../util';
import { ImportDialog } from '../writing/ImportDialog';

const KIND_LABEL: Record<LinkTargetKind, string> = { character: 'Character', place: 'Place', group: 'Group', stay: 'Stay', journey: 'Journey', book: 'Book', chapter: 'Chapter', scene: 'Scene', event: 'World event' };

export function targetOptions(world: AppCtx['world'], kind: LinkTargetKind): { id: Id; label: string }[] {
  switch (kind) {
    case 'character': return sortByName(world.characters).map((c) => ({ id: c.id, label: c.name }));
    case 'place': return sortByName(world.places).map((p) => ({ id: p.id, label: p.name }));
    case 'group': return sortByName(world.groups).map((g) => ({ id: g.id, label: g.name }));
    case 'stay': return world.stays.map((s) => ({ id: s.id, label: `${subjectName(world, s.subject)} at ${placeName(world, s.placeId)}, ${formatFuzzy(s.arrival)}` })).sort((a, b) => a.label.localeCompare(b.label));
    case 'journey': return world.journeys.map((j) => ({ id: j.id, label: `${subjectName(world, j.subject)}: ${placeName(world, j.originId)} → ${placeName(world, j.destinationId)}, ${formatFuzzy(j.departure)}` })).sort((a, b) => a.label.localeCompare(b.label));
    case 'book': return world.books.map((b) => ({ id: b.id, label: b.title }));
    case 'chapter': return world.chapters.map((c) => ({ id: c.id, label: `${world.books.find((b) => b.id === c.bookId)?.title ?? ''} · ${c.title}` }));
    case 'scene': return world.scenes.map((s) => ({ id: s.id, label: s.title }));
    case 'event': return sortByName(world.events).map((e) => ({ id: e.id, label: e.name }));
  }
}

export function targetLabel(world: AppCtx['world'], t: ManuscriptLink['target']): string {
  return targetOptions(world, t.kind).find((o) => o.id === t.id)?.label ?? '(deleted)';
}

export function useOpenTarget() {
  const { go, edit } = useApp();
  return (t: ManuscriptLink['target']) => {
    if (t.kind === 'stay' || t.kind === 'journey') edit({ kind: t.kind, id: t.id });
    else if (t.kind === 'character') go('characters', t.id);
    else if (t.kind === 'place') go('places', t.id);
    else if (t.kind === 'group') go('groups', t.id);
    else if (t.kind === 'event') go('events', t.id);
    else go('story', t.id);
  };
}

export function Manuscripts() {
  const { world, store, platform, selected, select } = useApp();
  const [error, setError] = useState('');
  const connect = async () => {
    setError('');
    try {
      const f = await platform.pickFile(['.docx']);
      if (!f) return;
      const paragraphs = await readDocx(f.bytes);
      const m: Manuscript = { ...recordBase(), name: f.name.replace(/\.docx$/i, ''), path: f.path, paragraphs, textHash: textHash(paragraphs), loadedAt: nowIso() };
      store.upsert('manuscripts', m);
      select(m.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  const current = world.manuscripts.find((m) => m.id === selected);
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools">
          <button className="primary" onClick={connect}>+ Connect a Word file</button>
          <small className="muted">The app reads your .docx files and never changes them.</small>
          {error && <small className="error">{error}</small>}
        </div>
        <ul className="list">
          {sortByName(world.manuscripts).map((m) => {
            const links = world.links.filter((l) => l.manuscriptId === m.id);
            const lost = links.filter((l) => l.state === 'lost').length;
            return (
              <li key={m.id} className={m.id === selected ? 'active' : ''} onClick={() => select(m.id)}>
                {m.name}
                <span className="tag">{links.length} links</span>
                {lost > 0 && <span className="tag warn">{lost} to re-link</span>}
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="detail reader-detail">
        {current ? <Reader key={current.id} m={current} /> : <div className="empty">Connect a chapter or a whole book saved as .docx. Then select a passage to link it to a character, place, stay, journey or scene.</div>}
      </section>
    </div>
  );
}

interface Sel { paraIndex: number; start: number; end: number; x: number; y: number }

function offsetIn(p: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(p, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function Reader({ m }: { m: Manuscript }) {
  const { world, store, platform, focusLink } = useApp();
  const openTarget = useOpenTarget();
  const links = useMemo(() => world.links.filter((l) => l.manuscriptId === m.id), [world.links, m.id]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [linking, setLinking] = useState<Sel | null>(null);
  const [relinkId, setRelinkId] = useState<Id | null>(null);
  const [activeLinks, setActiveLinks] = useState<Id[]>([]);
  const [report, setReport] = useState('');
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('');
  const textRef = useRef<HTMLDivElement>(null);

  const byPara = useMemo(() => {
    const map = new Map<number, ManuscriptLink[]>();
    for (const l of links) if (l.state !== 'lost') map.set(l.anchor.paraIndex, [...(map.get(l.anchor.paraIndex) ?? []), l]);
    return map;
  }, [links]);

  // ST-11: re-read the file and find every linked passage again.
  const reload = async (bytes?: Uint8Array) => {
    try {
      let b = bytes;
      if (!b && m.path && platform.readPath) b = await platform.readPath(m.path);
      if (!b) {
        const f = await platform.pickFile(['.docx']);
        if (!f) return;
        b = f.bytes;
      }
      const paragraphs = await readDocx(b);
      const hash = textHash(paragraphs);
      if (hash === m.textHash) {
        store.upsert('manuscripts', { ...m, loadedAt: nowIso() });
        setReport('No changes since the last reading.');
        return;
      }
      const updated = reanchor(paragraphs, links);
      const count = (s: string) => updated.filter((l) => l.state === s).length;
      store.update((w) => ({
        ...w,
        manuscripts: w.manuscripts.map((x) => (x.id === m.id ? { ...x, paragraphs, textHash: hash, loadedAt: nowIso(), updatedAt: nowIso() } : x)),
        links: w.links.map((l) => updated.find((u) => u.id === l.id) ?? l),
      }));
      setReport(`Manuscript updated. ${count('ok')} links unchanged, ${count('moved')} moved, ${count('fuzzy')} found approximately${count('lost') ? `, ${count('lost')} need re-linking` : ''}.`);
    } catch (e) {
      setReport(`Could not read the file: ${e instanceof Error ? e.message : e}`);
    }
  };

  // Desktop: notice edits made in Word since the last reading.
  useEffect(() => {
    if (!m.path || !platform.modifiedAt) return;
    let cancelled = false;
    platform.modifiedAt(m.path).then((t) => {
      if (!cancelled && t && t > Date.parse(m.loadedAt)) void reload();
    });
    return () => { cancelled = true; };
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to a passage opened from elsewhere (ST-10).
  useEffect(() => {
    const l = links.find((x) => x.id === focusLink);
    if (!l) return;
    setActiveLinks([l.id]);
    requestAnimationFrame(() => textRef.current?.querySelector(`[data-pi="${l.anchor.paraIndex}"]`)?.scrollIntoView({ block: 'center' }));
  }, [focusLink]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.anchorNode || !s.focusNode) return setSel(null);
    const pa = (s.anchorNode.parentElement ?? null)?.closest('[data-pi]') as HTMLElement | null;
    const pf = (s.focusNode.parentElement ?? null)?.closest('[data-pi]') as HTMLElement | null;
    if (!pa || pa !== pf) return setSel(null); // passages stay within one paragraph
    const a = offsetIn(pa, s.anchorNode, s.anchorOffset), b = offsetIn(pa, s.focusNode, s.focusOffset);
    if (a === b) return setSel(null);
    const rect = s.getRangeAt(0).getBoundingClientRect();
    const host = textRef.current!.getBoundingClientRect();
    setSel({ paraIndex: Number(pa.dataset.pi), start: Math.min(a, b), end: Math.max(a, b), x: rect.left - host.left + rect.width / 2, y: rect.top - host.top + textRef.current!.scrollTop });
  };

  const relinkHere = (s: Sel) => {
    const l = links.find((x) => x.id === relinkId);
    if (!l) return;
    store.upsert('links', { ...l, anchor: makeAnchor(m.paragraphs, s.paraIndex, s.start, s.end), state: 'ok' });
    setRelinkId(null);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  };

  const renderPara = (text: string, pi: number) => {
    const ls = byPara.get(pi);
    if (!ls) return text;
    const cuts = new Set<number>([0, text.length]);
    for (const l of ls) { cuts.add(Math.min(text.length, l.anchor.start)); cuts.add(Math.min(text.length, l.anchor.end)); }
    const pts = [...cuts].sort((a, b) => a - b);
    const out: React.ReactNode[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const covering = ls.filter((l) => l.anchor.start <= a && l.anchor.end >= b);
      const piece = text.slice(a, b);
      if (!covering.length) out.push(piece);
      else out.push(
        <mark key={i} className={`passage ${covering.some((l) => activeLinks.includes(l.id)) ? 'active' : ''} ${covering.some((l) => l.state === 'fuzzy') ? 'fuzzy' : ''}`} onClick={(e) => { e.stopPropagation(); setActiveLinks(covering.map((l) => l.id)); }} title={covering.map((l) => targetLabel(world, l.target)).join(', ')}>
          {piece}
        </mark>,
      );
    }
    return out;
  };

  const headings = m.paragraphs.map((p, i) => ({ ...p, i })).filter((p) => p.heading);
  const lost = links.filter((l) => l.state === 'lost');
  const active = links.filter((l) => activeLinks.includes(l.id));
  const shown = filter ? links.filter((l) => targetLabel(world, l.target).toLowerCase().includes(filter.toLowerCase()) || l.anchor.quote.toLowerCase().includes(filter.toLowerCase())) : links;

  const disconnect = async () => {
    if (!(await ask.confirm(`Disconnect ${m.name}? Its ${links.length} link(s) are removed from the app. The Word file itself is not touched.`, { okLabel: 'Disconnect', danger: true }))) return;
    store.removeMany([{ c: 'manuscripts', id: m.id }, ...links.map((l) => ({ c: 'links' as const, id: l.id }))]);
  };

  return (
    <div className="reader-layout">
      <div className="reader-main">
        <div className="reader-head">
          <div>
            <h1>{m.name}</h1>
            <small className="muted">{m.path ?? 'Uploaded copy'} · read {new Date(m.loadedAt).toLocaleString()} · {m.paragraphs.length} paragraphs</small>
          </div>
          <div className="row wrap">
            <select value={m.bookId ?? ''} onChange={(e) => store.upsert('manuscripts', { ...m, bookId: e.target.value || undefined })} title="Which book this manuscript belongs to">
              <option value="">(no book)</option>
              {world.books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            {headings.length > 0 && (
              <select value="" onChange={(e) => textRef.current?.querySelector(`[data-pi="${e.target.value}"]`)?.scrollIntoView({ block: 'start' })}>
                <option value="">Jump to heading…</option>
                {headings.map((h) => <option key={h.i} value={h.i}>{'  '.repeat((h.heading ?? 1) - 1)}{h.text}</option>)}
              </select>
            )}
            <button className={m.importedAt ? '' : 'primary'} onClick={() => setImporting(true)} title="WR-4: bring this file's text into the app's editor, split into chapters and scenes">{m.importedAt ? 'Import again…' : 'Import into the app…'}</button>
            <button onClick={() => reload()} title={m.path ? 'Read the file again and find every link' : 'Choose the updated file to read again'}>Read again</button>
            {m.path && platform.openExternally && <button onClick={() => platform.openExternally!(m.path!)}>Open in Word</button>}
            <button className="danger" onClick={disconnect}>Disconnect</button>
          </div>
        </div>
        {importing && <ImportDialog manuscriptId={m.id} onClose={() => setImporting(false)} />}
        {m.importedAt && <div className="note">Imported into {world.books.find((b) => b.id === m.importedBookId)?.title ?? 'a book'} on {new Date(m.importedAt).toLocaleDateString()}. The text now lives in the app (Write); this reader shows the Word file as it is.</div>}
        {report && <div className="note row">{report}<span className="spacer" /><button className="icon" onClick={() => setReport('')}>×</button></div>}
        {relinkId && <div className="note row warn-note">Select the passage's new text to re-link “{links.find((l) => l.id === relinkId)?.anchor.quote.slice(0, 60)}”.<span className="spacer" /><button className="small" onClick={() => setRelinkId(null)}>Cancel</button></div>}
        <div className="reader-text" ref={textRef} onMouseUp={onMouseUp} onClick={() => setActiveLinks([])}>
          {m.paragraphs.map((p, i) => {
            const Tag = (p.heading ? `h${Math.min(6, p.heading + 1)}` : 'p') as 'p';
            return <Tag key={i} data-pi={i} className={p.heading ? 'ms-heading' : 'ms-para'}>{renderPara(p.text, i)}</Tag>;
          })}
          {sel && (
            <div className="sel-pop" style={{ left: sel.x, top: sel.y }} onMouseUp={(e) => e.stopPropagation()}>
              {relinkId ? <button className="primary small" onClick={() => relinkHere(sel)}>Re-link here</button> : <button className="primary small" onClick={() => { setLinking(sel); setSel(null); }}>Link passage…</button>}
            </div>
          )}
        </div>
      </div>
      <aside className="reader-side">
        <NameSpotting m={m} onShow={(pi) => textRef.current?.querySelector(`[data-pi="${pi}"]`)?.scrollIntoView({ block: 'center' })} />
        {active.length > 0 && (
          <div className="card">
            <h3>This passage</h3>
            {active.map((l) => <LinkRow key={l.id} l={l} onOpen={() => openTarget(l.target)} />)}
          </div>
        )}
        {lost.length > 0 && (
          <>
            <h3>Need re-linking ({lost.length})</h3>
            <p className="muted small">These passages were not found after the manuscript changed.</p>
            {lost.map((l) => (
              <div className="card" key={l.id}>
                <div className="quote">“{l.anchor.quote}”</div>
                <div className="muted small">{targetLabel(world, l.target)} · was under {l.anchor.heading || 'no heading'}</div>
                <div className="row"><button className="small" onClick={() => setRelinkId(l.id)}>Re-link</button><button className="small danger" onClick={() => store.removeMany([{ c: 'links', id: l.id }])}>Remove</button></div>
              </div>
            ))}
          </>
        )}
        <h3>Links in this manuscript ({links.length})</h3>
        {links.length > 4 && <input placeholder="Filter links" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        {links.length === 0 && <p className="muted small">Select text in the manuscript and press “Link passage…”.</p>}
        <ul className="plain link-list">
          {shown.filter((l) => l.state !== 'lost').sort((a, b) => a.anchor.paraIndex - b.anchor.paraIndex || a.anchor.start - b.anchor.start).map((l) => (
            <li key={l.id}>
              <button className="link" onClick={() => { setActiveLinks([l.id]); textRef.current?.querySelector(`[data-pi="${l.anchor.paraIndex}"]`)?.scrollIntoView({ block: 'center' }); }}>
                <b>{targetLabel(world, l.target)}</b> <span className="muted">{KIND_LABEL[l.target.kind].toLowerCase()}</span>
                <div className="quote small">“{l.anchor.quote.length > 80 ? l.anchor.quote.slice(0, 80) + '…' : l.anchor.quote}”</div>
              </button>
              {l.state === 'fuzzy' && <span className="tag warn" title="Found approximately after an edit; check it">check</span>}
            </li>
          ))}
        </ul>
      </aside>
      {linking && <LinkDialog m={m} sel={linking} onClose={() => { setLinking(null); window.getSelection()?.removeAllRanges(); }} />}
    </div>
  );
}

/** ST-12: names found in the manuscript, with one-click suggestions. Dismissed ones stay dismissed for this manuscript. */
function NameSpotting({ m, onShow }: { m: Manuscript; onShow: (paraIndex: number) => void }) {
  const { world, store, edit } = useApp();
  const key = `swt.spotDismissed.${m.id}`;
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; } });
  const dismiss = (k: string) => {
    const next = [...dismissed, k];
    setDismissed(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const { sections, suggestions } = useMemo(() => (open ? nameSuggestions(world, m) : { sections: [], suggestions: [] as Suggestion[] }), [open, world, m]);
  const shown = suggestions.filter((x) => !dismissed.includes(x.key));
  const accept = (x: Suggestion) => {
    if (x.kind === 'cast') {
      const first = world.scenes.filter((s) => s.chapterId === x.chapterId).sort((a, b) => a.order - b.order)[0];
      if (first) store.upsert('scenes', { ...first, characterIds: [...first.characterIds, x.characterId] });
    } else if (x.kind === 'stay') {
      edit({ kind: 'stay', preset: { subject: { kind: 'character', id: x.characterId }, placeId: x.placeId, arrival: fromDay(x.range.earliest), departure: x.range.latest > x.range.earliest ? fromDay(x.range.latest) : undefined, status: 'draft', notes: 'Suggested from the manuscript.' } });
    } else {
      const link: ManuscriptLink = { ...recordBase(), manuscriptId: m.id, anchor: makeAnchor(m.paragraphs, x.paraIndex, x.start, x.end), target: { kind: x.targetKind, id: x.targetId }, note: '', state: 'ok' };
      store.upsert('links', link);
    }
    dismiss(x.key);
  };
  const names = sections.reduce((n, s) => n + s.mentions.length, 0);
  const matched = sections.filter((s) => s.chapterId).length;
  return (
    <div className="card spotting">
      <div className="row"><h3>Names in the text</h3><span className="spacer" /><button className="small" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Find names'}</button></div>
      {!open && <p className="muted small">Looks for character and place names, chapter by chapter, and suggests links, cast members and stays.</p>}
      {open && (
        <>
          <p className="muted small">{names} {names === 1 ? 'name' : 'names'} found in {sections.length} {sections.length === 1 ? 'part' : 'parts'}; {matched} matched to chapters by heading.</p>
          {shown.length === 0 ? <p className="muted small">Nothing new to suggest.</p> : (
            <ul className="plain suggestions">
              {shown.slice(0, 12).map((x) => (
                <li key={x.key}>
                  <span className="small">{x.text}</span>
                  <span className="row">
                    <button className="small primary" onClick={() => accept(x)}>{x.kind === 'cast' ? 'Add to scene' : x.kind === 'stay' ? 'Create stay…' : 'Link'}</button>
                    {x.kind === 'link' && <button className="small" onClick={() => onShow(x.paraIndex)}>Show</button>}
                    <button className="small" onClick={() => dismiss(x.key)}>Not now</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {shown.length > 12 && <p className="muted small">{shown.length - 12} more after these.</p>}
        </>
      )}
    </div>
  );
}

function LinkRow({ l, onOpen }: { l: ManuscriptLink; onOpen: () => void }) {
  const { world, store } = useApp();
  return (
    <div className="link-row">
      <div><b>{targetLabel(world, l.target)}</b> <span className="muted">{KIND_LABEL[l.target.kind].toLowerCase()}</span></div>
      {l.note && <div className="small">{l.note}</div>}
      {l.state === 'fuzzy' && <div className="small warn-text">Found approximately after an edit. Check it, then confirm.</div>}
      <div className="row wrap">
        <button className="small" onClick={onOpen}>Open</button>
        {l.state === 'fuzzy' && <button className="small" onClick={() => store.upsert('links', { ...l, state: 'ok' })}>Looks right</button>}
        <button className="small danger" onClick={() => store.removeMany([{ c: 'links', id: l.id }])}>Unlink</button>
      </div>
    </div>
  );
}

/** ST-9: link a selected passage to any record. */
function LinkDialog({ m, sel, onClose }: { m: Manuscript; sel: Sel; onClose: () => void }) {
  const { world, store } = useApp();
  const quote = m.paragraphs[sel.paraIndex].text.slice(sel.start, sel.end);
  // Suggest a target by spotting a character or place name in the selection.
  const guess = useMemo((): { kind: LinkTargetKind; id: Id } | null => {
    const q = quote.toLowerCase();
    const c = world.characters.find((x) => [x.name, ...x.aliases].some((n) => n && q.includes(n.toLowerCase())));
    if (c) return { kind: 'character', id: c.id };
    const p = world.places.find((x) => !x.isPlaceholder && [x.name, ...x.aliases].some((n) => n && q.includes(n.toLowerCase())));
    return p ? { kind: 'place', id: p.id } : null;
  }, [quote, world]);
  const [kind, setKind] = useState<LinkTargetKind>(guess?.kind ?? 'character');
  const [id, setId] = useState<Id>(guess?.id ?? '');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const opts = targetOptions(world, kind).filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  const save = () => {
    const link: ManuscriptLink = { ...recordBase(), manuscriptId: m.id, anchor: makeAnchor(m.paragraphs, sel.paraIndex, sel.start, sel.end), target: { kind, id }, note, state: 'ok' };
    store.upsert('links', link);
    onClose();
  };
  return (
    <Modal title="Link passage" onClose={onClose} footer={<><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!id} onClick={save}>Link</button></>}>
      <div className="form-grid">
        <blockquote className="quote">“{quote}”</blockquote>
        <Field label="Link to">
          <div className="row wrap">
            {(Object.keys(KIND_LABEL) as LinkTargetKind[]).map((k) => (
              <button key={k} className={`small ${k === kind ? 'primary' : ''}`} onClick={() => { setKind(k); setId(''); }}>{KIND_LABEL[k]}</button>
            ))}
          </div>
        </Field>
        <Field label={KIND_LABEL[kind]}>
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select size={8} value={id} onChange={(e) => setId(e.target.value)} onDoubleClick={() => id && save()}>
            {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {opts.length === 0 && <small className="muted">Nothing to link of this kind yet.</small>}
        </Field>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
