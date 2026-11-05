/**
 * In-app confirm / prompt / alert. Browser pop-ups are unreliable inside the desktop webview
 * and blocked in the preview, so the app uses its own dialogs everywhere.
 */
import { useEffect, useState } from 'react';
import { Modal } from './Modal';

type Req =
  | { kind: 'confirm'; message: string; okLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; message: string; value: string; resolve: (v: string | null) => void }
  | { kind: 'alert'; message: string; resolve: () => void };

let push: ((r: Req) => void) | null = null;
const pending: Req[] = [];

function open(r: Req) {
  if (push) push(r);
  else pending.push(r);
}

export const ask = {
  confirm(message: string, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
    return new Promise((resolve) => open({ kind: 'confirm', message, okLabel: opts.okLabel ?? 'OK', danger: opts.danger ?? false, resolve }));
  },
  prompt(message: string, value = ''): Promise<string | null> {
    return new Promise((resolve) => open({ kind: 'prompt', message, value, resolve }));
  },
  alert(message: string): Promise<void> {
    return new Promise((resolve) => open({ kind: 'alert', message, resolve }));
  },
};

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  const [text, setText] = useState('');
  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    if (pending.length) setQueue((q) => [...q, ...pending.splice(0)]);
    return () => { push = null; };
  }, []);
  const cur = queue[0];
  useEffect(() => { if (cur?.kind === 'prompt') setText(cur.value); }, [cur]);
  if (!cur) return null;
  const done = () => setQueue((q) => q.slice(1));
  const cancel = () => {
    if (cur.kind === 'confirm') cur.resolve(false);
    else if (cur.kind === 'prompt') cur.resolve(null);
    else cur.resolve();
    done();
  };
  const ok = () => {
    if (cur.kind === 'confirm') cur.resolve(true);
    else if (cur.kind === 'prompt') cur.resolve(text);
    else cur.resolve();
    done();
  };
  return (
    <Modal
      title={cur.kind === 'alert' ? 'Note' : cur.kind === 'prompt' ? 'Enter a value' : 'Please confirm'}
      onClose={cancel}
      footer={
        <>
          <span className="spacer" />
          {cur.kind !== 'alert' && <button onClick={cancel}>Cancel</button>}
          <button className={cur.kind === 'confirm' && cur.danger ? 'primary danger-bg' : 'primary'} autoFocus={cur.kind !== 'prompt'} onClick={ok}>
            {cur.kind === 'confirm' ? cur.okLabel : 'OK'}
          </button>
        </>
      }
    >
      <p className="dialog-message">{cur.message}</p>
      {cur.kind === 'prompt' && (
        <input id="dialog-input" autoFocus style={{ width: '100%' }} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      )}
    </Modal>
  );
}
