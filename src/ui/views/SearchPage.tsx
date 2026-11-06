/** VW-8: search everything: names, notes, scenes, events, and the text of the manuscripts. */
import { useEffect, useMemo, useState } from 'react';
import { RefKind, globalSearch } from '../../core';
import { REF_LABEL, useOpenRef } from '../components/Refs';
import { useApp } from '../context';

const ORDER: RefKind[] = ['character', 'place', 'event', 'secret', 'group', 'region', 'thread', 'book', 'chapter', 'scene', 'stay', 'journey', 'relationship', 'manuscript'];
const PLURAL: Partial<Record<RefKind, string>> = { character: 'Characters', place: 'Places', event: 'Events', secret: 'Secrets', group: 'Groups', region: 'Regions', thread: 'Plot threads', book: 'Books', chapter: 'Chapters', scene: 'Scenes', stay: 'Stays', journey: 'Journeys', relationship: 'Relationships', manuscript: 'In the manuscripts' };

export function SearchPage() {
  const { world, selected } = useApp();
  const [q, setQ] = useState(selected ?? '');
  useEffect(() => { if (selected !== undefined) setQ(selected); }, [selected]);
  const open = useOpenRef();
  const hits = useMemo(() => globalSearch(world, q), [world, q]);
  const groups = ORDER.map((k) => ({ k, list: hits.filter((h) => h.kind === k) })).filter((g) => g.list.length);
  return (
    <div className="page search-page">
      <div className="page-head"><h1>Search</h1></div>
      <input className="search-big" autoFocus value={q} placeholder="Names, notes, scene summaries, manuscript text…" onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && <p className="muted">{hits.length === 0 ? 'Nothing found.' : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}. Every word must appear somewhere in the record.`}</p>}
      {groups.map((g) => (
        <section key={g.k}>
          <h2>{PLURAL[g.k]} <span className="muted">({g.list.length})</span></h2>
          <ul className="plain search-hits">
            {g.list.map((h, i) => (
              <li key={h.kind + h.id + (h.paraIndex ?? '') + i}>
                <button className="link" onClick={() => open(h)}>{h.title}</button> <span className="muted small">{h.kind === 'manuscript' ? `paragraph ${h.paraIndex! + 1}` : h.sub || REF_LABEL[h.kind]}</span>
                {h.snippet && <div className="quote small">{h.snippet}</div>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
