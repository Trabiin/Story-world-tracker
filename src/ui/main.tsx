import { StrictMode, useEffect, useState } from 'react';
import { applyLightClass } from './perf';
import { createRoot } from 'react-dom/client';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { initSql, loadWorldFile } from '../storage';
import { App } from './App';
import { DialogHost } from './components/Dialogs';
import { getPlatform, isWebApp, Platform, WorldHandle } from './platform';
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
        // The Chrome app may need a click to allow the file again, so it only reopens when Chrome remembers.
        const quiet = p.kind !== 'web' || (last && (await (await import('./platform/web')).canReopenQuietly(last)));
        if (last && quiet && (await p.listWorlds()).some((w) => w.id === last.id)) await open(p, last);
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
// The Chrome app works offline: a service worker keeps the app's files.
if (isWebApp && 'serviceWorker' in navigator) window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js').catch(() => undefined); });
createRoot(document.getElementById('root')!).render(<StrictMode><Root /><DialogHost /></StrictMode>);
