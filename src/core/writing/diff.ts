/**
 * WR-6: compare two versions of a scene. Paragraphs are matched first (longest common
 * subsequence), then changed paragraphs are compared word by word.
 */

export type DiffOp = 'eq' | 'del' | 'ins';
export interface DiffPart { op: DiffOp; text: string }
/** One row of a side-by-side view: the old paragraph and the new one, each split into parts. */
export interface DiffRow { left?: DiffPart[]; right?: DiffPart[]; changed: boolean }

/** LCS table walk; returns pairs of matched indices. Fine for a few thousand items. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length, m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** Word-level diff of two strings (spaces kept as their own tokens so the text reads back exactly). */
export function diffWords(a: string, b: string): DiffPart[] {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length * tb.length > 4_000_000) return [...(a ? [{ op: 'del' as const, text: a }] : []), ...(b ? [{ op: 'ins' as const, text: b }] : [])];
  const pairs = lcs(ta, tb, (x, y) => x === y);
  const out: DiffPart[] = [];
  const push = (op: DiffOp, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [ta.length, tb.length] as [number, number]]) {
    push('del', ta.slice(i, pi).join(''));
    push('ins', tb.slice(j, pj).join(''));
    if (pi < ta.length) push('eq', ta[pi]);
    i = pi + 1; j = pj + 1;
  }
  return out;
}

/** Side-by-side rows for two lists of paragraphs. */
export function diffParagraphs(a: string[], b: string[]): DiffRow[] {
  const pairs = lcs(a, b, (x, y) => x === y);
  const rows: DiffRow[] = [];
  let i = 0, j = 0;
  const flush = (ai: number, bj: number) => {
    const olds = a.slice(i, ai), news = b.slice(j, bj);
    const k = Math.max(olds.length, news.length);
    for (let x = 0; x < k; x++) {
      const o = olds[x], nw = news[x];
      if (o !== undefined && nw !== undefined) {
        const parts = diffWords(o, nw);
        rows.push({ left: parts.filter((p) => p.op !== 'ins'), right: parts.filter((p) => p.op !== 'del'), changed: true });
      } else if (o !== undefined) rows.push({ left: [{ op: 'del', text: o }], changed: true });
      else rows.push({ right: [{ op: 'ins', text: nw! }], changed: true });
    }
  };
  for (const [pi, pj] of pairs) {
    flush(pi, pj);
    rows.push({ left: [{ op: 'eq', text: a[pi] }], right: [{ op: 'eq', text: b[pj] }], changed: false });
    i = pi + 1; j = pj + 1;
  }
  flush(a.length, b.length);
  return rows;
}
