/**
 * ST-11: links survive edits. A passage is remembered by its text plus surrounding text and heading,
 * and found again after the manuscript changes: exactly, moved elsewhere, approximately, or lost.
 */
import type { Paragraph, PassageAnchor } from '../model';

const CONTEXT = 32;

export function nearestHeading(paras: Paragraph[], index: number): string {
  for (let i = Math.min(index, paras.length - 1); i >= 0; i--) if (paras[i].heading) return paras[i].text.trim();
  return '';
}

export function makeAnchor(paras: Paragraph[], paraIndex: number, start: number, end: number): PassageAnchor {
  const text = paras[paraIndex].text;
  const s = Math.max(0, Math.min(start, end)), e = Math.min(text.length, Math.max(start, end));
  return {
    paraIndex,
    start: s,
    end: e,
    quote: text.slice(s, e),
    prefix: text.slice(Math.max(0, s - CONTEXT), s),
    suffix: text.slice(e, e + CONTEXT),
    heading: paras[paraIndex].heading ? text.trim() : nearestHeading(paras, paraIndex),
  };
}

export interface Located {
  paraIndex: number;
  start: number;
  end: number;
  state: 'ok' | 'moved' | 'fuzzy';
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const words = (s: string) => norm(s).match(/[\p{L}\p{N}']+/gu) ?? [];

function wordDistance(a: string[], b: string[]): number {
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Find the passage in (possibly edited) paragraphs, or null when it is lost. */
export function locate(paras: Paragraph[], a: PassageAnchor): Located | null {
  if (!a.quote) return null;
  // 1. Unchanged in place.
  const here = paras[a.paraIndex]?.text;
  if (here !== undefined && here.slice(a.start, a.end) === a.quote && here.slice(Math.max(0, a.start - a.prefix.length), a.start) === a.prefix) {
    return { paraIndex: a.paraIndex, start: a.start, end: a.end, state: 'ok' };
  }
  // 2. Exact text found elsewhere: pick the occurrence with the best context match.
  let best: { score: number; paraIndex: number; start: number } | null = null;
  for (let i = 0; i < paras.length; i++) {
    const t = paras[i].text;
    let from = 0;
    for (;;) {
      const k = t.indexOf(a.quote, from);
      if (k < 0) break;
      const score =
        commonSuffixLen(t.slice(0, k), a.prefix) +
        commonPrefixLen(t.slice(k + a.quote.length), a.suffix) +
        (nearestHeading(paras, i) === a.heading ? 20 : 0) -
        Math.min(10, Math.abs(i - a.paraIndex) / 20);
      if (!best || score > best.score) best = { score, paraIndex: i, start: k };
      from = k + 1;
    }
  }
  if (best) {
    const same = best.paraIndex === a.paraIndex && best.start === a.start;
    return { paraIndex: best.paraIndex, start: best.start, end: best.start + a.quote.length, state: same ? 'ok' : 'moved' };
  }
  // 3. Approximate: the passage was reworded a little. Compare word sequences.
  const q = words(a.quote);
  if (q.length < 3) return null;
  const qset = new Set(q);
  let fuzzy: { sim: number; paraIndex: number; start: number; end: number } | null = null;
  for (let i = 0; i < paras.length; i++) {
    const t = paras[i].text;
    const tokens = [...t.matchAll(/[\p{L}\p{N}'’]+/gu)];
    if (tokens.length === 0) continue;
    let shared = 0;
    const seen = new Set<string>();
    for (const tk of tokens) {
      const w = norm(tk[0]);
      if (qset.has(w) && !seen.has(w)) { shared++; seen.add(w); }
    }
    if (shared < qset.size * 0.5) continue;
    const tw = tokens.map((tk) => norm(tk[0]));
    for (const len of [q.length - 1, q.length, q.length + 1]) {
      if (len < 1) continue;
      for (let s = 0; s + len <= tw.length; s++) {
        const d = wordDistance(q, tw.slice(s, s + len));
        const sim = 1 - d / Math.max(q.length, len);
        if (sim >= 0.7 && (!fuzzy || sim > fuzzy.sim || (sim === fuzzy.sim && Math.abs(i - a.paraIndex) < Math.abs(fuzzy.paraIndex - a.paraIndex)))) {
          const startTok = tokens[s], endTok = tokens[s + len - 1];
          fuzzy = { sim, paraIndex: i, start: startTok.index!, end: endTok.index! + endTok[0].length };
        }
      }
    }
  }
  return fuzzy ? { paraIndex: fuzzy.paraIndex, start: fuzzy.start, end: fuzzy.end, state: 'fuzzy' } : null;
}

/** Re-anchor every link of a manuscript after its text changed. Returns updated anchors and states. */
export function reanchor<T extends { anchor: PassageAnchor; state: string }>(paras: Paragraph[], links: T[]): T[] {
  return links.map((l) => {
    const found = locate(paras, l.anchor);
    if (!found) return { ...l, state: 'lost' };
    const anchor = makeAnchor(paras, found.paraIndex, found.start, found.end);
    return { ...l, anchor, state: found.state };
  });
}
