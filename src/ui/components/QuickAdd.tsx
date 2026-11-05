/** EU-1: type a sentence, confirm the filled-in form. Ctrl/Cmd+J from anywhere. */
import { useMemo, useState } from 'react';
import { formatFuzzy, fromDayNumber, parseQuickAdd, placeAt } from '../../core';
import { useApp } from '../context';
import { placeName, subjectName } from '../util';

export function QuickAdd({ onClose }: { onClose: () => void }) {
  const { world, ix, moment, edit } = useApp();
  const [text, setText] = useState('');
  const year = fromDayNumber(moment).year;
  const r = useMemo(() => {
    if (!text.trim()) return null;
    const res = parseQuickAdd(text, world, year);
    // A journey without "from" starts where the traveller is when leaving.
    if (res.kind === 'journey' && !res.originId && res.subject && res.departure) res.originId = placeAt(ix, res.subject, ix.win(res.departure).earliest);
    return res;
  }, [text, world, ix, year]);
  const go = () => {
    if (!r) return;
    const preset: Record<string, unknown> = { subject: r.subject };
    if (r.kind === 'journey') Object.assign(preset, { originId: r.originId ?? '', destinationId: r.destinationId ?? '', departure: r.departure, arrival: r.arrival, ...(r.modeId ? { modeId: r.modeId } : {}) });
    else Object.assign(preset, { placeId: r.placeId ?? '', arrival: r.arrival, departure: r.departure, durationDays: r.durationDays });
    for (const k of Object.keys(preset)) if (preset[k] === undefined) delete preset[k];
    edit({ kind: r.kind, preset });
    onClose();
  };
  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="command">
        <input
          id="quick-add"
          autoFocus
          placeholder="e.g. Kaela rides to Thornwick, leaves 3 May"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') go(); }}
        />
        <div className="quick-preview">
          {!r && <p className="muted">Describe a journey or a stay in one sentence. Missing years use {year}. Press Enter to check and save the form.</p>}
          {r && (
            <>
              <p><b>{r.kind === 'journey' ? 'Journey' : 'Stay'}</b>{r.subject && <> · {subjectName(world, r.subject)}</>}</p>
              {r.kind === 'journey' ? (
                <p>{r.originId ? placeName(world, r.originId) : 'from where they are'} → {r.destinationId ? placeName(world, r.destinationId) : '?'}
                  {r.modeId && <> · by {world.settings.travelModes.find((m) => m.id === r.modeId)?.name.toLowerCase()}</>}
                  {r.departure && <> · leaves {formatFuzzy(r.departure)}</>}{r.arrival && <> · arrives {formatFuzzy(r.arrival)}</>}</p>
              ) : (
                <p>At {r.placeId ? placeName(world, r.placeId) : '?'}{r.arrival && <> · from {formatFuzzy(r.arrival)}</>}{r.departure && <> · until {formatFuzzy(r.departure)}</>}{r.durationDays !== undefined && <> · for {r.durationDays} days</>}</p>
              )}
              {r.notes.map((n, i) => <p key={i} className="warn-text small">{n}</p>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
