import { StrictMode, useEffect, useState } from 'react';
import { applyLightClass } from './perf';
import { createRoot } from 'react-dom/client';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { initSql, loadWorldFile } from '../storage';
import { App } from './App';
import { DialogHost } from './components/Dialogs';
import { getPlatform, Platform, WorldHandle } from './platform';
import { WorldStore } from './store';
import { WorldsScreen } from './WorldsScreen';
import './styles.css';

const LAST_KEY = 'swt.lastWorld';

function Root() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [store, setStore] = useState<WorldStore | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      await initSql(wasmUrl);
      const p = await getPlatform();
      setPlatform(p);
      try {
        const last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as WorldHandle | null;
        if (last && (await p.listWorlds()).some((w) => w.id === last.id)) await open(p, last);
      } catch { /* show the worlds screen */ }
    })().catch((e) => setError(String(e)));
  }, []);

  const open = async (p: Platform, h: WorldHandle) => {
    try {
      const { world, snapshots } = await loadWorldFile(await p.load(h));
      setStore(new WorldStore(world, h, p, snapshots));
      try { localStorage.setItem(LAST_KEY, JSON.stringify(h)); } catch { /* ignore */ }
      setError('');
    } catch (e) {
      setError(`Could not open ${h.name}: ${e}`);
    }
  };

  if (error && !platform) return <div className="worlds"><p className="error">{error}</p></div>;
  if (!platform) return <div className="worlds"><p className="muted">Loading…</p></div>;
  if (!store) return <>{error && <p className="error banner">{error}</p>}<WorldsScreen platform={platform} onOpen={(h) => open(platform, h)} /></>;
  return <App key={store.handle.id} store={store} platform={platform} onClose={() => { try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ } setStore(null); }} />;
}

applyLightClass();
createRoot(document.getElementById('root')!).render(<StrictMode><Root /><DialogHost /></StrictMode>);
