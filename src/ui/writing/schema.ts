/**
 * WR-1: the editor's document schema. It must match the description in core/writing/doc.ts:
 * doc > (paragraph | heading | scene_break)+, inline text and hard breaks, marks strong, em, comment, speaker, link.
 */
import { Schema } from 'prosemirror-model';

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 2 } },
      defining: true,
      parseDOM: [1, 2, 3].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (n) => [`h${n.attrs.level}`, 0],
    },
    scene_break: {
      group: 'block',
      selectable: true,
      parseDOM: [{ tag: 'hr' }],
      toDOM: () => ['div', { class: 'scene-break', contenteditable: 'false' }, '* * *'],
    },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null }, { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v as string) && null }],
      toDOM: () => ['strong', 0],
    },
    em: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    comment: {
      attrs: { id: {} },
      inclusive: false,
      excludes: '',
      parseDOM: [{ tag: 'span[data-comment]', getAttrs: (n) => ({ id: (n as HTMLElement).dataset.comment }) }],
      toDOM: (m) => ['span', { class: 'text-comment', 'data-comment': m.attrs.id }, 0],
    },
    speaker: {
      attrs: { id: {} },
      inclusive: false,
      parseDOM: [{ tag: 'span[data-speaker]', getAttrs: (n) => ({ id: (n as HTMLElement).dataset.speaker }) }],
      toDOM: (m) => ['span', { class: 'text-speaker', 'data-speaker': m.attrs.id }, 0],
    },
    link: {
      attrs: { kind: {}, id: {}, note: { default: '' } },
      inclusive: false,
      parseDOM: [{ tag: 'span[data-link]', getAttrs: (n) => ({ kind: (n as HTMLElement).dataset.kind, id: (n as HTMLElement).dataset.link, note: (n as HTMLElement).dataset.note ?? '' }) }],
      toDOM: (m) => ['span', { class: 'text-link', 'data-link': m.attrs.id, 'data-kind': m.attrs.kind, 'data-note': m.attrs.note }, 0],
    },
  },
});
