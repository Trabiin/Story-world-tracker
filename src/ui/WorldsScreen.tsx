/** PL-2: several separate worlds, one per series. */
import { useEffect, useState } from 'react';
import { ask } from './components/Dialogs';
import { bytesToWorld, createEmptyWorld, worldFromJson, worldToBytes } from '../storage';
import { Platform, WorldHandle } from './platform';
import { sampleWorld } from './sample';

export function WorldsScreen({ platform, onOpen }: { platform: Platform; onOpen: (h: WorldHandle) => void }) {
  const [worlds, setWorlds] = useState<WorldHandle[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const refresh = () => platform.listWorlds().then(setWorlds).catch((e) => setError(String(e)));
  useEffect(() => { void refresh(); }, []);

  const create = async (n: string, sample = false) => {
    try {
      const w = sample ? sampleWorld() : createEmptyWorld(n);
      const h = await platform.createWorld(w.settings.name, await worldToBytes(w));
      if (h) onOpen(h);
    } catch (e) { setError(String(e)); }
  };
  const importFile = async () => {
    try {
      const f = await platform.pickFile(['.json', '.world']);
      if (!f) return;
      const w = f.name.endsWith('.json') ? worldFromJson(new TextDecoder().decode(f.bytes)) : await bytesToWorld(f.bytes);
      const h = await platform.createWorld(w.settings.name, await worldToBytes(w));
      if (h) onOpen(h);
    } catch (e) { setError(`Could not import: ${e}`); }
  };
  return (
    <div className="worlds">
      <div className="worlds-card">
        <h1>Story World Tracker</h1>
        <p className="muted">Where is everyone, what are they doing, and how did they get there?</p>
        {platform.kind === 'browser' && <p className="note">Browser preview: worlds are saved in this browser only, and file exports may not download here. The desktop app saves real .world files.</p>}
        {error && <p className="error">{error}</p>}
        <h2>Your worlds</h2>
        {worlds === null ? <p className="muted">Loading…</p> : worlds.length === 0 ? <p className="muted">No worlds yet.</p> : (
          <ul className="world-list">
            {worlds.map((w) => (
              <li key={w.id}>
                <button className="link big" onClick={() => onOpen(w)}>{w.name}</button>
                <small className="muted">{w.path ?? (w.updatedAt ? `edited ${new Date(w.updatedAt).toLocaleString()}` : '')}</small>
                <button className="small" onClick={async () => {
                  if (!(await ask.confirm(platform.kind === 'browser' ? `Delete ${w.name} from this browser? This cannot be undone.` : `Remove ${w.name} from this list? The file stays on disk.`, { okLabel: platform.kind === 'browser' ? 'Delete' : 'Remove', danger: true }))) return;
                  await platform.forget(w);
                  void refresh();
                }}>{platform.kind === 'browser' ? 'Delete' : 'Remove'}</button>
              </li>
            ))}
          </ul>
        )}
        <h2>New world</h2>
        <div className="row">
          <input placeholder="Series name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create(name.trim())} />
          <button className="primary" disabled={!name.trim()} onClick={() => create(name.trim())}>Create</button>
        </div>
        <div className="row wrap">
          {platform.openWorldFile && <button onClick={async () => { const h = await platform.openWorldFile!(); if (h) onOpen(h); }}>Open a .world file…</button>}
          <button onClick={importFile}>Import from JSON or .world…</button>
          <button onClick={() => create('', true)}>Try the sample world</button>
        </div>
      </div>
    </div>
  );
}
