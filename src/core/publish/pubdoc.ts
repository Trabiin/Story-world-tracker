/**
 * RV-8, EU-16, SR-2: one simple document form for everything the app hands out to read: a book's
 * reading copy, the series bible and the "previously on" recap. Each is written to ePub, PDF or Word
 * from this form (epub.ts, pdf.ts, docx.ts).
 */
import type { Run } from '../writing/doc';

export type PubBlock =
  /** A chapter or section title. Level 1 starts a new page (PDF) or a new file (ePub). */
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'p'; runs: Run[]; /** No first-line indent (first paragraph after a heading or break). */ first?: boolean; /** Smaller, for notes and lists. */ small?: boolean }
  | { kind: 'break' };

export interface PubDoc {
  title: string;
  subtitle?: string;
  author: string;
  /** 'en-GB' or 'en-US'. */
  lang: string;
  blocks: PubBlock[];
}

/** Plain text runs. */
export const plain = (text: string): Run[] => [{ text }];
/** "Label: value" with the label in bold. */
export const labelled = (label: string, value: string): Run[] => [{ text: `${label}: `, bold: true }, { text: value }];

/** A file name from a title, safe on Windows. */
export function fileTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
