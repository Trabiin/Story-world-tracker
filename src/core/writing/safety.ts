/**
 * WR-7: plain-text safety copies. Every scene as a .txt file, foldered by book and chapter, so the
 * words are never locked inside the app. Written beside each backup and downloadable as a zip.
 */
import type { World } from '../model';
import { outline } from '../story';
import { docToPlain, textOf } from './doc';

export interface TextFile {
  /** Folder names, then the file name. */
  path: string[];
  text: string;
}

/** A name Windows accepts for a file or folder. */
export function safeName(s: string, fallback = 'Untitled'): string {
  const t = s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  const name = t || fallback;
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `_${name}` : name;
}

const num = (i: number, n: number) => String(i + 1).padStart(Math.max(2, String(n).length), '0');

export function safetyCopyFiles(world: World): TextFile[] {
  const files: TextFile[] = [];
  const tree = outline(world);
  tree.forEach(({ book, chapters }, bi) => {
    const bookDir = `${num(bi, tree.length)} ${safeName(book.title, 'Book')}`;
    chapters.forEach(({ chapter, scenes }, ci) => {
      const chDir = `${num(ci, chapters.length)} ${safeName(chapter.title, 'Chapter')}`;
      scenes.forEach((s, si) => {
        const t = textOf(world, s.id);
        const body = t ? docToPlain(t.doc, '\r\n\r\n') : '';
        files.push({ path: [bookDir, chDir, `${num(si, scenes.length)} ${safeName(s.title, 'Scene')}.txt`], text: `${s.title}\r\n\r\n${body}\r\n` });
      });
    });
  });
  files.push({
    path: ['READ ME.txt'],
    text: `Plain-text copy of every scene in "${world.settings.name}", written ${new Date().toLocaleString()}.\r\n\r\nFolders are books, then chapters; each file is one scene. Bold, italics and comments are left out. The world file (.world) beside this folder holds everything else.\r\n`,
  });
  return files;
}
