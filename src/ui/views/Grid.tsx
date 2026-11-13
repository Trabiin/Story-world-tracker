/**
 * EU-19: characters, places, stays and journeys as a spreadsheet. Type in a cell and press Enter
 * (or move away) to save it; arrow keys move between rows; a block copied from Excel pastes into
 * several cells and rows at once, extra rows becoming new records. Each save is one undo step.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { GRID_COLUMNS, GridEdit, GridKind, GridMakers, GridProblem, Id, Journey, Stay, applyGridEdits, gridRecords, missingForNew, parsePastedCells } from '../../core';
import { recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { useApp } from '../context';
import { blankCharacter } from '../util';

const TABS: { kind: GridKind; label: string }[] = [
  { kind: 'characters', label: 'Characters' },
  { kind: 'places', label: 'Places' },
  { kind: 'stays', label: 'Stays' },
  { kind: 'journeys', label: 'Journeys' },
];
const NEW = '__new';

export function Grid() {
  const { world, store, warnings, go, edit } = useApp();
  const [kind, setKind] = useState<GridKind>(() => (localStorage.getItem('swt.grid') as GridKind) || 'characters');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | undefined>();
  const [problems, setProblems] = useState<Map<string, { message: string; text: string }>>(new Map());
  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<Id>>(new Set());
  const tableRef = useRef<HTMLTableElement>(null);
  const cols = GRID_COLUMNS[kind];

  const switchTo = (k: GridKind) => {
    setKind(k); setSort(undefined); setProblems(new Map()); setNewRow({}); setPicked(new Set());
    try { localStorage.setItem('swt.grid', k); } catch { /* ignore */ }
  };

  const rows = useMemo(() => {
    let list = gridRecords(world, kind);
    if (kind === 'characters') list = list.filter((c) => !(c as { archived?: boolean }).archived);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((r) => cols.some((c) => c.get(r, world).toLowerCase().includes(s)));
    }
    if (sort) {
      const c = cols.find((x) => x.id === sort.col)!;
      const key = (r: (typeof list)[number]) => (c.sort ? c.sort(r, world) : c.get(r, world).toLowerCase());
      list = [...list].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    }
    return list;
  }, [world, kind, q, sort, cols]);

  // Warnings that point at a stay or journey, so mistakes show up while typing.
  const warnFor = useMemo(() => {
    const m = new Map<Id, string[]>();
    if (kind === 'stays' || kind === 'journeys') {
      const k = kind === 'stays' ? 'stay' : 'journey';
      for (const w of warnings) if (!w.dismissed) for (const r of w.refs) if (r.kind === k) m.set(r.id, [...(m.get(r.id) ?? []), w.message]);
    }
    return m;
  }, [warnings, kind]);

  const makers = (w: typeof world): GridMakers => {
    let n = 0;
    return {
      now: new Date().toISOString(),
      character: (name) => { const c = blankCharacter({ ...w, characters: [...w.characters, ...Array(n++)] }, recordBase()); return { ...c, name }; },
      place: (name) => ({ ...recordBase(), name, aliases: [], kind: 'other', notes: '', isPlaceholder: false }),
      stay: () => ({ ...recordBase(), subject: undefined as unknown as Stay['subject'], placeId: '', arrival: undefined as unknown as Stay['arrival'], purpose: '', notes: '' }),
      journey: () => ({
        ...recordBase(), subject: undefined as unknown as Journey['subject'], originId: '', destinationId: '', waypointIds: [], departure: undefined as unknown as Journey['departure'],
        modeId: w.settings.travelModes[1]?.id ?? w.settings.travelModes[0]?.id ?? 'foot', purpose: '', notes: '',
      }),
    };
  };

  const pkey = (p: { id?: Id; newRow?: string; col: string }) => `${p.id ?? p.newRow}:${p.col}`;

  /** Save cell edits in one undo step and keep the cells that could not be read. */
  const run = (edits: GridEdit[]): { problems: GridProblem[]; created: Id[] } => {
    if (store.readOnly) { store.onBlocked?.(); return { problems: [], created: [] }; }
    let out: { problems: GridProblem[]; created: Id[] } = { problems: [], created: [] };
    store.update((w) => { const r = applyGridEdits(w, kind, edits, makers(w)); out = r; return r.world; });
    setProblems((old) => {
      const next = new Map(old);
      for (const e of edits) next.delete(pkey(e));
      for (const p of out.problems) next.set(pkey(p), { message: p.message, text: edits.find((e) => pkey(e) === pkey(p))?.text ?? '' });
      return next;
    });
    return out;
  };

  const commitCell = (id: Id | undefined, col: string, text: string) => {
    if (id) { run([{ id, col, text }]); return; }
    const texts = { ...newRow, [col]: text };
    const missing = missingForNew(kind, new Set(Object.entries(texts).filter(([, v]) => v.trim()).map(([k]) => k)));
    if (missing.length) {
      setNewRow(texts);
      setProblems((old) => { const n = new Map(old); n.delete(pkey({ newRow: NEW, col })); return n; });
      return;
    }
    const res = run(Object.entries(texts).map(([c, t]) => ({ newRow: NEW, col: c, text: t })));
    setNewRow(res.created.length ? {} : texts);
  };

  const paste = (rowIndex: number, colIndex: number, text: string) => {
    const cells = parsePastedCells(text);
    const edits: GridEdit[] = [];
    cells.forEach((line, i) => {
      const r = rows[rowIndex + i];
      line.forEach((t, j) => {
        const c = cols[colIndex + j];
        if (!c) return;
        edits.push(r ? { id: r.id, col: c.id, text: t.trim() } : { newRow: `paste${i}`, col: c.id, text: t.trim() });
      });
    });
    const res = run(edits);
    const added = res.created.length;
    const bad = res.problems.filter((p) => p.id).length;
    // A pasted row that could not become a record has no cells to mark, so say which and why.
    const lost = res.problems.filter((p) => p.newRow).map((p) => `Pasted row ${Number(p.newRow!.slice(5)) + 1}: ${p.message}`);
    const lostRows = new Set(res.problems.filter((p) => p.newRow).map((p) => p.newRow)).size;
    if (added || bad || lost.length) {
      void ask.alert([
        added ? `${added} new ${added === 1 ? 'row' : 'rows'} added.` : '',
        bad ? `${bad} ${bad === 1 ? 'cell' : 'cells'} could not be read and ${bad === 1 ? 'was' : 'were'} left as before (marked in red).` : '',
        lost.length ? `${lostRows} pasted ${lostRows === 1 ? 'row was' : 'rows were'} not added:\n${lost.join('\n')}` : '',
        'Undo takes the whole paste back.',
      ].filter(Boolean).join('\n'));
    }
  };

  const focusCell = (r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
    if (el) { el.focus(); el.select(); }
  };

  const open = (id: Id) => {
    if (kind === 'characters') go('characters', id);
    else if (kind === 'places') go('places', id);
    else edit({ kind: kind === 'stays' ? 'stay' : 'journey', id });
  };

  const deletePicked = async () => {
    const n = picked.size;
    if (!(await ask.confirm(`Delete ${n} ${kind === 'stays' ? (n === 1 ? 'stay' : 'stays') : n === 1 ? 'journey' : 'journeys'}? Undo brings them back.`))) return;
    store.removeMany([...picked].map((id) => ({ c: kind, id })));
    setPicked(new Set());
  };

  const canDelete = kind === 'stays' || kind === 'journeys';
  const newMissing = missingForNew(kind, new Set(Object.entries(newRow).filter(([, v]) => v.trim()).map(([k]) => k)));
  const newStarted = Object.values(newRow).some((v) => v.trim());

  return (
    <div className="page grid-page">
      <div className="page-head">
        <h2>Spreadsheet</h2>
        <div className="seg">
          {TABS.map((t) => <button key={t.kind} className={t.kind === kind ? 'on' : ''} onClick={() => switchTo(t.kind)}>{t.label} <span className="count">{gridRecords(world, t.kind).length}</span></button>)}
        </div>
      </div>
      <div className="grid-tools">
        <input type="search" placeholder="Show only rows containing…" value={q} onChange={(e) => setQ(e.target.value)} />
        {canDelete && picked.size > 0 && <button onClick={() => void deletePicked()}>Delete {picked.size} selected</button>}
        <span className="spacer" />
        <span className="muted small">Enter saves and moves down · Esc undoes the cell · paste a block from Excel to fill many cells · Ctrl+Z undoes</span>
      </div>
      <div className="grid-wrap">
        <table className="sheet" ref={tableRef}>
          <colgroup>
            {canDelete && <col style={{ width: 28 }} />}
            {cols.map((c) => <col key={c.id} style={{ width: c.width }} />)}
            <col style={{ width: 70 }} />
          </colgroup>
          <thead>
            <tr>
              {canDelete && <th><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((r) => picked.has(r.id))} onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
              {cols.map((c) => (
                <th key={c.id} className={c.required ? 'req' : ''} onClick={() => setSort(sort?.col === c.id ? (sort.dir === 1 ? { col: c.id, dir: -1 } : undefined) : { col: c.id, dir: 1 })} title="Sort by this column">
                  {c.label}{sort?.col === c.id ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const warn = warnFor.get(r.id);
              return (
                <tr key={r.id} className={r.status === 'draft' ? 'draft' : ''}>
                  {canDelete && <td className="pick"><input type="checkbox" aria-label="Select row" checked={picked.has(r.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} /></td>}
                  {cols.map((c, ci) => {
                    const prob = problems.get(pkey({ id: r.id, col: c.id }));
                    return (
                      <td key={c.id}>
                        <Cell r={ri} c={ci} value={c.get(r, world)} problem={prob} list={c.choices ? `grid-${kind}-${c.id}` : undefined} readOnly={store.readOnly}
                          onCommit={(t) => commitCell(r.id, c.id, t)} onPaste={(t) => paste(ri, ci, t)} onMove={focusCell} />
                      </td>
                    );
                  })}
                  <td className="row-end">
                    {warn && <span className="warn-dot" title={warn.join('\n')}>⚠ {warn.length}</span>}
                    <button className="link small" onClick={() => open(r.id)} title="Open the full page or editor">Open</button>
                  </td>
                </tr>
              );
            })}
            <tr className="new-row">
              {canDelete && <td className="pick">+</td>}
              {cols.map((c, ci) => (
                <td key={c.id}>
                  <Cell r={rows.length} c={ci} value={newRow[c.id] ?? ''} problem={problems.get(pkey({ newRow: NEW, col: c.id }))} list={c.choices ? `grid-${kind}-${c.id}` : undefined} readOnly={store.readOnly}
                    placeholder={ci === 0 ? `New ${kind === 'characters' ? 'character' : kind.slice(0, -1)}…` : ''}
                    onCommit={(t) => commitCell(undefined, c.id, t)} onPaste={(t) => paste(rows.length, ci, t)} onMove={focusCell} />
                </td>
              ))}
              <td className="row-end">{newStarted && newMissing.length > 0 && <span className="muted small" title={`Still needed: ${newMissing.join(', ')}`}>needs {newMissing.join(', ').toLowerCase()}</span>}</td>
            </tr>
          </tbody>
        </table>
        {cols.filter((c) => c.choices).map((c) => (
          <datalist key={c.id} id={`grid-${kind}-${c.id}`}>{c.choices!(world).map((x) => <option key={x} value={x} />)}</datalist>
        ))}
      </div>
      <p className="muted small">
        Dates are day/month/year ("3/5/1042", "May 1042", "~1042") or tied to an event or chapter ("3 days after the Battle of Varn"). Lists are separated by semicolons.
        {kind === 'places' ? ' A place with only a latitude typed in sits on longitude 0 until you type that too.' : ''}
        {kind === 'journeys' ? ' Leave Arrives empty to use the suggested arrival. Changing From or To drops a drawn route.' : ''}
        {kind === 'characters' ? ' Archived characters are not listed.' : ''}
      </p>
    </div>
  );
}

function Cell({ r, c, value, problem, list, readOnly, placeholder, onCommit, onPaste, onMove }: {
  r: number; c: number; value: string; problem?: { message: string; text: string }; list?: string; readOnly: boolean; placeholder?: string;
  onCommit: (text: string) => void; onPaste: (text: string) => void; onMove: (r: number, c: number) => void;
}) {
  const [text, setText] = useState(problem?.text ?? value);
  // The saved value can change while the cell has focus (Enter saves, then shows it as read back).
  useEffect(() => { setText(problem?.text ?? value); }, [value, problem]);
  const commit = () => { if (text !== (problem?.text ?? value)) onCommit(text); };
  return (
    <input
      data-r={r} data-c={c} value={text} list={list} readOnly={readOnly} placeholder={placeholder}
      className={problem ? 'invalid' : ''} title={problem?.message ?? (text.length > 18 ? text : undefined)}
      onBlur={commit}
      onChange={(e) => setText(e.target.value)}
      onPaste={(e) => {
        const t = e.clipboardData.getData('text/plain');
        if (/[\t\n]/.test(t.replace(/\r?\n$/, ''))) { e.preventDefault(); onPaste(t); }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); onMove(r + (e.shiftKey ? -1 : 1), c); }
        else if (e.key === 'Escape') { setText(value); }
        else if (e.key === 'ArrowDown' && !list) { e.preventDefault(); commit(); onMove(r + 1, c); }
        else if (e.key === 'ArrowUp' && !list) { e.preventDefault(); commit(); onMove(r - 1, c); }
      }}
    />
  );
}
