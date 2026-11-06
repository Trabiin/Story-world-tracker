/**
 * AI-1, AI-2, AI-6: while Claude is on for the open world (desktop), keep the Claude folder up to
 * date after every change and answer the local connector. Renders nothing.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CANON, Id, McpEnv, Warning, World, checkWorld, claudeFolderFiles, claudeSettingsJson, handleMcp, mcpJson, scenarioView } from '../../core';
import { useApp } from '../context';
import type { WorldStore } from '../store';
import { claudeOpts, proposeInStore } from './actions';

const SYNC_MS = 1500;

/** What the Ask Claude page shows about the connection. */
export interface ClaudeStatus {
  port?: number;
  connectorError?: string;
  folder?: string;
  lastSync?: string;
  syncError?: string;
  /** Requests answered since the app started (shows that Claude is using the tools). */
  requests: number;
  lastTool?: string;
}

let status: ClaudeStatus = { requests: 0 };
const listeners = new Set<() => void>();
export function setClaudeStatus(p: Partial<ClaudeStatus>) {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
}
export function useClaudeStatus(): ClaudeStatus {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => status);
}

/** Warnings per scenario for the stored world, worked out once per change. */
function warningsCache() {
  let key: World | null = null;
  const m = new Map<Id, Warning[]>();
  return (w: World, sid: Id) => {
    if (key !== w) { key = w; m.clear(); }
    let r = m.get(sid);
    if (!r) m.set(sid, (r = checkWorld(scenarioView(w, sid))));
    return r;
  };
}

/** The files of the Claude folder plus the Claude Code setup files (AI-5). */
export function folderFiles(world: World, port: number | undefined, warnings: Warning[]) {
  const c = world.settings.claude!;
  const files = claudeFolderFiles(world, warnings, { directEdit: !!c.directEdit });
  if (port && c.token) files.push({ path: '.mcp.json', text: mcpJson(port, c.token) });
  files.push({ path: '.claude/settings.local.json', text: claudeSettingsJson() });
  return files;
}

export async function syncNow(store: WorldStore, folder: string, warnings: Warning[]) {
  const p = store.platform.claude;
  if (!p) return;
  try {
    await p.syncFolder(folder, folderFiles(store.world, status.port, warnings));
    setClaudeStatus({ lastSync: new Date().toLocaleTimeString(), syncError: undefined, folder });
  } catch (e) {
    setClaudeStatus({ syncError: String(e) });
  }
}

export function ClaudeHub() {
  const { store, platform } = useApp();
  const claude = store.world.settings.claude;
  const on = !!claude?.enabled && !!platform.claude;
  const warnings = useRef(warningsCache());
  const st = useClaudeStatus();

  // AI-2: the local connector. Requests are answered from the world as it is at that moment.
  useEffect(() => {
    if (!on || !platform.claude) return;
    let alive = true;
    const p = platform.claude;
    p.startConnector((id, auth, body) => {
      const c = store.world.settings.claude;
      let rpcId: unknown = null;
      try { rpcId = JSON.parse(body)?.id ?? null; } catch { /* answered below */ }
      if (!c?.enabled || !c.token || auth !== `Bearer ${c.token}`) {
        const isNote = rpcId === null && /"method"\s*:\s*"notifications\//.test(body);
        void p.reply(id, 200, isNote ? '' : JSON.stringify({ jsonrpc: '2.0', id: rpcId, error: { code: -32001, message: `This is not the story world that is open in Story World Tracker${c?.enabled ? '' : ', or Claude is switched off for it'}. Open the world in the app and switch Claude on (Ask Claude page), then start Claude Code again.` } }));
        return;
      }
      const env: McpEnv = {
        world: store.world,
        warnings: (sid) => warnings.current(store.world, sid),
        propose: (pr, check) => proposeInStore(store, pr, check),
        directEdit: !!c.directEdit,
        opts: claudeOpts,
        appVersion: '0.1.0',
      };
      let out = '';
      try { out = handleMcp(body, env); } catch (e) { out = JSON.stringify({ jsonrpc: '2.0', id: rpcId, error: { code: -32603, message: String(e) } }); }
      const tool = /"method"\s*:\s*"tools\/call"/.test(body) ? (body.match(/"name"\s*:\s*"([\w-]+)"/)?.[1]) : undefined;
      setClaudeStatus({ requests: status.requests + 1, ...(tool ? { lastTool: tool } : {}) });
      void p.reply(id, 200, out);
    }).then((port) => { if (alive) setClaudeStatus({ port, connectorError: undefined }); }, (e) => setClaudeStatus({ connectorError: String(e) }));
    return () => { alive = false; };
  }, [on, platform, store]);

  // AI-1: refresh the folder a moment after each change (and once when switched on).
  const v = store.version;
  const folder = claude?.folder;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<World | null>(null);
  useEffect(() => { last.current = null; }, [st.port, folder, claude?.directEdit]);
  useEffect(() => {
    if (!on || !folder || !platform.claude) return;
    if (last.current === store.world) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      last.current = store.world;
      void syncNow(store, folder, warnings.current(store.world, CANON));
    }, SYNC_MS);
  }, [on, folder, v, platform, store, st.port, claude?.directEdit]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return null;
}
