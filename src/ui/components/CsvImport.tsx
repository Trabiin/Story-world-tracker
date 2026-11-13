/**
 * PL-6: import characters or places from a spreadsheet saved as CSV. Pick the file, check which
 * column feeds which field, see what will happen row by row, then import (one undo step).
 */
import { useMemo, useState } from 'react';
import { CSV_FIELDS, CsvKind, applyCsvImport, guessColumns, parseCsv, planCsvImport } from '../../core';
import { recordBase } from '../../storage';
import { useApp } from '../context';
import { blankCharacter } from '../util';
import { ask } from './Dialogs';
import { Modal } from './Modal';

export function CsvImportButton({ kind }: { kind: CsvKind }) {
  const { platform, store } = useApp();
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const pick = async () => {
    const f = await platform.pickFile(['.csv', '.txt', '.tsv']);
    if (!f) return;
    const rows = parseCsv(new TextDecoder('utf-8').decode(f.bytes));
    if (rows.length < 2) { void ask.alert('That file has no rows to import. Save the spreadsheet as "CSV UTF-8", with column headings in the first row.'); return; }
    setFile({ name: f.name, rows });
  };
  return (
    <>
      <button className="small" disabled={store.readOnly} title={`PL-6: add ${kind} from a spreadsheet saved as CSV`} onClick={() => void pick()}>Import CSV…</button>
      {file && <CsvImportDialog kind={kind} file={file} onClose={() => setFile(null)} />}
    </>
  );
}

function CsvImportDialog({ kind, file, onClose }: { kind: CsvKind; file: { name: string; rows: string[][] }; onClose: () => void }) {
  const { world, store } = useApp();
  const header = file.rows[0];
  const [cols, setCols] = useState(() => guessColumns(kind, header));
  const [existing, setExisting] = useState<'skip' | 'fill'>('skip');
  const plan = useMemo(() => planCsvImport(world, kind, file.rows, cols, existing), [world, kind, file.rows, cols, existing]);
  const noun = kind === 'characters' ? 'character' : 'place';
  const run = () => {
    store.update((w) => applyCsvImport(w, plan, {
      character: (name) => ({ ...blankCharacter(w, recordBase()), name }),
      place: (name) => ({ ...recordBase(), name, aliases: [], kind: 'other', notes: '', isPlaceholder: false }),
    }));
    onClose();
    void ask.alert(`${plan.adds} ${plan.adds === 1 ? noun : `${noun}s`} added${plan.fills ? `, ${plan.fills} filled in` : ''}. Undo takes it all back.`);
  };
  return (
    <Modal title={`Import ${kind} from ${file.name}`} onClose={onClose} wide
      footer={<><span className="muted small">{plan.adds} to add · {plan.fills} to fill in · {plan.skips} skipped</span><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={cols.name === undefined || !(plan.adds + plan.fills)} onClick={run}>Import</button></>}>
      <div className="csv-import">
        <p className="muted small">Which column holds what? Guessed from the headings in the first row.</p>
        <div className="csv-cols">
          {CSV_FIELDS[kind].map((f) => (
            <label key={f.id}>{f.label}
              <select value={cols[f.id] ?? ''} onChange={(e) => setCols({ ...cols, [f.id]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                <option value="">(none)</option>
                {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
            </label>
          ))}
        </div>
        {cols.name === undefined && <p className="warn-text small">Choose the column with the names.</p>}
        <label className="checkbox small"><input type="checkbox" checked={existing === 'fill'} onChange={(e) => setExisting(e.target.checked ? 'fill' : 'skip')} /> When a {noun} with that name already exists, fill in its empty fields (otherwise the row is skipped)</label>
        <div className="csv-preview">
          <table className="table small">
            <thead><tr><th>Row</th><th>Name</th><th>What happens</th><th>Notes</th></tr></thead>
            <tbody>
              {plan.rows.slice(0, 200).map((r) => (
                <tr key={r.line} className={r.action === 'skip' ? 'muted' : ''}>
                  <td>{r.line}</td><td>{r.name}</td>
                  <td>{r.action === 'add' ? 'Add' : r.action === 'fill' ? 'Fill in empty fields' : 'Skip (already there)'}</td>
                  <td className="warn-text">{r.problems.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.rows.length > 200 && <p className="muted small">… and {plan.rows.length - 200} more rows.</p>}
        </div>
        <p className="muted small">Dates are read day/month/year ("3/5/1042", "May 1042", "~1020"). Lists (aliases, tags) are separated by semicolons or commas. {kind === 'places' ? 'Parent places are matched by name, also to places in the same file.' : ''}</p>
      </div>
    </Modal>
  );
}
