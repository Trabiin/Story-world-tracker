/**
 * WR-1, WR-2, WR-8, WR-10, WR-11: the editor for one scene. Text is saved into the world a moment after typing
 * stops (and at least every few seconds while typing), when the scene loses focus, and when it
 * closes. The editor keeps its own undo and redo; world undo never touches the text.
 */
import { baseKeymap, setBlockType, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { InputRule, ellipsis, emDash, inputRules, smartQuotes } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, Selection, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { useEffect, useRef } from 'react';
import { Id, LinkTargetKind, StyleRuleId, STYLE_RULES, styleHits, NameIndex, SceneText, TextComment, TextNode, World, addVersion, docWords, emptyDoc, logWords, makeVersion, nameMatches, nameRanges, packDoc, versionsOf, wantsAutoVersion, WRITING_VERSION_EVERY_MS } from '../../core';
import { nowIso, newId, recordBase } from '../../storage';
import type { WorldStore } from '../store';
import { schema } from './schema';
import 'prosemirror-view/style/prosemirror.css';

const COMMIT_IDLE_MS = 1500;
const COMMIT_MAX_MS = 5000;

/** What the decorations need from the world: its names (WR-8, WR-10), comments and link labels. */
export interface TextInfo {
  words: Set<string>;
  /** WR-10: full names and aliases, so a hovered name can show its card. */
  names: NameIndex;
  comments: Map<Id, TextComment>;
  label: (kind: string, id: Id) => string | undefined;
  /** RV-4: style marks to show (absent = off). */
  style?: { off: ReadonlySet<StyleRuleId>; names: ReadonlySet<string>; overused: ReadonlySet<string> };
  /** RV-2: words that look like a misspelt name, and the name ("Kayla" → "Kaela"). */
  typos?: ReadonlyMap<string, string>;
}

const infoKey = new PluginKey<DecorationSet>('world-words');

function decorate(doc: PMNode, info: TextInfo): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    // WR-10: names that stand for a record carry it, for the hover card (one span per name, kept out of the
    // spell checker too). Linked text already says what it points at. WR-8: other world words only skip the checker.
    const matches = node.marks.some((m) => m.type.name === 'link') ? [] : nameMatches(text, info.names);
    for (const m of matches) decos.push(Decoration.inline(pos + m.from, pos + m.to, { 'data-ref': `${m.ref.kind}:${m.ref.id}`, spellcheck: 'false', class: 'world-word name-ref' }, { ref: m.ref }));
    for (const [a, b] of nameRanges(text, info.words)) {
      if (!matches.some((m) => m.from <= a && b <= m.to)) decos.push(Decoration.inline(pos + a, pos + b, { spellcheck: 'false', class: 'world-word' }));
    }
    for (const m of node.marks) {
      if (m.type.name === 'comment') {
        const c = info.comments.get(m.attrs.id);
        if (c) decos.push(Decoration.inline(pos, pos + text.length, { title: `${c.author ? c.author + ': ' : ''}${c.text}`, ...(c.resolved ? { class: 'comment-resolved' } : {}) }));
      } else if (m.type.name === 'link') {
        const l = info.label(m.attrs.kind, m.attrs.id);
        decos.push(Decoration.inline(pos, pos + text.length, { title: l ? `Linked to ${l}${m.attrs.note ? ` · ${m.attrs.note}` : ''}` : 'Linked record no longer exists' }));
      }
    }
    // RV-2: a word that looks like a misspelt name.
    if (info.typos?.size) {
      for (const t of text.matchAll(/[\p{L}][\p{L}'’-]*/gu)) {
        const w = t[0].replace(/['’]s$/, '').replace(/['’-]+$/, '');
        const like = info.typos.get(w);
        if (like) decos.push(Decoration.inline(pos + t.index!, pos + t.index! + w.length, { class: 'name-typo', title: `Looks like a misspelling of ${like} (see Revise → Names)` }));
      }
    }
  });
  // RV-4: style marks. Offsets are per block (top-level node), one position per character as in runText.
  if (info.style) {
    const texts: string[] = [];
    const starts: number[] = [];
    doc.forEach((node, offset) => {
      starts.push(offset + 1);
      let s = '';
      node.forEach((c) => { s += c.isText ? c.text ?? '' : c.type.name === 'hard_break' ? '\n' : ''; });
      texts.push(node.isTextblock ? s : '');
    });
    for (const h of styleHits(texts, info.style.off, info.style.names, info.style.overused)) {
      decos.push(Decoration.inline(starts[h.block] + h.from, starts[h.block] + h.to, { class: `style-mark style-${h.rule}`, title: `${STYLE_RULES[h.rule].name}: ${h.note}` }));
    }
  }
  return DecorationSet.create(doc, decos);
}

function infoPlugin(get: () => TextInfo) {
  return new Plugin<DecorationSet>({
    key: infoKey,
    state: {
      init: (_, s) => decorate(s.doc, get()),
      apply: (tr, old, _, s) => (tr.docChanged || tr.getMeta(infoKey) ? decorate(s.doc, get()) : old),
    },
    props: { decorations: (s) => infoKey.getState(s) },
  });
}

/** WR-1: "***" on its own line becomes a scene break. */
const sceneBreakRule = new InputRule(/^\s*(\*\s?){3}$/, (state, _m, start, end) => {
  const $s = state.doc.resolve(start);
  if ($s.parent.type !== schema.nodes.paragraph) return null;
  const from = $s.before(), to = $s.after();
  const tr = state.tr.replaceWith(from, to, [schema.nodes.scene_break.create(), schema.nodes.paragraph.create()]);
  void end;
  return tr.setSelection(TextSelection.create(tr.doc, from + 2));
});

/** WR-11: an "@name" being typed: the text from the @ to the cursor. */
export interface MentionState {
  sceneId: Id;
  view: EditorView;
  from: number;
  to: number;
  query: string;
  /** Where to show the list, in window coordinates. */
  left: number;
  top: number;
}

const mentionKey = new PluginKey<{ dismissedAt?: number }>('mention');

/** WR-11: "@" after a space (or at the start of a paragraph) and up to 40 letters typed since. */
export function findMention(state: EditorState): { from: number; to: number; query: string } | null {
  const sel = state.selection;
  if (!sel.empty || !sel.$head.parent.isTextblock) return null;
  const $h = sel.$head;
  const before = $h.parent.textBetween(0, $h.parentOffset, undefined, '\ufffc');
  const m = /(?:^|[\s(“"‘'—–])@([^\s@\ufffc][^@\n\ufffc]{0,39})?$/u.exec(before);
  if (!m) return null;
  const query = m[1] ?? '';
  if (/\s\s$/.test(query) || /[.,;:!?)]$/.test(query)) return null;
  return { from: $h.pos - query.length - 1, to: $h.pos, query };
}

function mentionPlugin(get: () => Props) {
  let last = '';
  const report = (view: EditorView) => {
    const p = get();
    if (!p.onMention) return;
    const found = view.hasFocus() && !p.readOnly ? findMention(view.state) : null;
    const dismissed = mentionKey.getState(view.state)?.dismissedAt;
    const m = found && found.from !== dismissed ? found : null;
    const key = m ? `${m.from}:${m.query}` : '';
    if (key === last) return;
    last = key;
    if (!m) { p.onMention(null); return; }
    let left = 0, top = 0;
    try { const c = view.coordsAtPos(m.from); left = c.left; top = c.bottom; } catch { /* not drawn yet */ }
    p.onMention({ sceneId: p.sceneId, view, ...m, left, top });
  };
  return new Plugin<{ dismissedAt?: number }>({
    key: mentionKey,
    state: {
      init: () => ({}),
      apply: (tr, v) => {
        const meta = tr.getMeta(mentionKey);
        if (meta) return meta;
        return v.dismissedAt !== undefined && tr.docChanged ? { dismissedAt: tr.mapping.map(v.dismissedAt) } : v;
      },
    },
    view: () => ({ update: report, destroy: () => { if (last) get().onMention?.(null); } }),
    props: {
      handleKeyDown: (_v, e) => get().onMentionKey?.(e) ?? false,
      handleDOMEvents: { blur: (v) => { last = ''; get().onMention?.(null); void v; return false; } },
    },
  });
}

/** WR-11: stop offering links for this "@" (Esc). */
export function dismissMention(view: EditorView, from: number) {
  view.dispatch(view.state.tr.setMeta(mentionKey, { dismissedAt: from }).setMeta('addToHistory', false));
}

/** WR-11: put a link to a record on text: replace from–to with the label, or (label undefined) link the text that is there. */
export function linkText(view: EditorView, from: number, to: number, target: { kind: LinkTargetKind; id: Id }, label?: string) {
  const mark = schema.marks.link.create({ kind: target.kind, id: target.id, note: '' });
  let tr = view.state.tr;
  if (label !== undefined) {
    const keep = view.state.doc.resolve(from).marks().filter((m) => m.type !== schema.marks.link);
    tr = tr.replaceWith(from, to, schema.text(label, [...keep, mark]));
    tr = tr.setSelection(TextSelection.create(tr.doc, from + label.length)).removeStoredMark(schema.marks.link);
  } else {
    tr = tr.removeMark(from, to, schema.marks.link).addMark(from, to, mark);
  }
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** WR-11: the extent of the link at a position (the run of text carrying the same link). */
export function linkRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const $p = state.doc.resolve(pos);
  const parent = $p.parent;
  const start = $p.start();
  let found: { from: number; to: number; id?: string } | null = null;
  let cur: { from: number; to: number; id: string } | null = null;
  parent.forEach((child, offset) => {
    const a = start + offset, b = a + child.nodeSize;
    const link = child.marks.find((m) => m.type === schema.marks.link);
    if (link && cur && cur.id === link.attrs.id && cur.to === a) cur.to = b;
    else cur = link ? { from: a, to: b, id: link.attrs.id } : null;
    if (cur && cur.from <= pos && pos <= cur.to && (!found || found.from === cur.from)) found = { ...cur };
  });
  return found ? { from: (found as { from: number }).from, to: (found as { to: number }).to } : null;
}

/** WR-10: the extent of the name at a position, as the decorations found it. */
export function nameRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const d = infoKey.getState(state)?.find(pos, pos + 1, (spec) => !!spec.ref)[0];
  return d ? { from: d.from, to: d.to } : null;
}

/** WR-11: take a link off (the text stays). */
export function unlinkText(view: EditorView, from: number, to: number) {
  view.dispatch(view.state.tr.removeMark(from, to, schema.marks.link));
}

export const commands = {
  bold: toggleMark(schema.marks.strong),
  italic: toggleMark(schema.marks.em),
  paragraph: setBlockType(schema.nodes.paragraph),
  heading: (level: number) => setBlockType(schema.nodes.heading, { level }),
  sceneBreak: (state: EditorState, dispatch?: EditorView['dispatch']) => {
    if (dispatch) {
      const { $to } = state.selection;
      const at = $to.after(1);
      const tr = state.tr.insert(at, [schema.nodes.scene_break.create(), schema.nodes.paragraph.create()]);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
    }
    return true;
  },
  undo,
  redo,
};

export function docNode(doc: TextNode | undefined): PMNode {
  try {
    return PMNode.fromJSON(schema, doc ?? emptyDoc());
  } catch {
    return PMNode.fromJSON(schema, emptyDoc());
  }
}

interface Props {
  store: WorldStore;
  sceneId: Id;
  text: SceneText | undefined;
  readOnly: boolean;
  info: TextInfo;
  spelling: string;
  typewriter: boolean;
  onFocus: (sceneId: Id, view: EditorView) => void;
  onNav: (sceneId: Id, dir: 'prev' | 'next') => void;
  register: (sceneId: Id, view: EditorView | null) => void;
  onChange?: () => void;
  /** WR-11: an "@name" is being typed (null: not any more). */
  onMention?: (m: MentionState | null) => void;
  /** WR-11: keys go here first while the @ list is open; true = handled. */
  onMentionKey?: (e: KeyboardEvent) => boolean;
  /** WR-11: Ctrl+L, link the selected words (or a name at the cursor). */
  onLinkKey?: (sceneId: Id, view: EditorView) => void;
  /** NT-1: Ctrl+Alt+M, comment on the selected words. */
  onCommentKey?: (sceneId: Id, view: EditorView) => void;
}

/**
 * Save the editor's text into the world (not an undo step: the editor has its own undo).
 * WR-12: the change in the scene's word count goes into today's words-written log.
 * NT-1: editComments changes the scene's comment list in the same step.
 */
export function commitText(store: WorldStore, sceneId: Id, doc: TextNode, editComments?: (c: TextComment[]) => TextComment[]) {
  store.update((w: World) => {
    const words = docWords(doc);
    const t = w.sceneTexts.find((x) => x.sceneId === sceneId);
    const rec: SceneText = t ? { ...t, doc, words, updatedAt: nowIso() } : { ...recordBase(), id: newId(), sceneId, doc, words };
    // NT-1: a comment is added or removed together with its mark.
    if (editComments) rec.comments = editComments(rec.comments ?? []);
    const next = { ...w, sceneTexts: t ? w.sceneTexts.map((x) => (x === t ? rec : x)) : [...w.sceneTexts, rec] };
    return logWords(next, words - (t?.words ?? 0));
  }, false);
}

/** WR-6: keep a version of the scene when it changed since the last one. */
export async function autoVersion(store: WorldStore, sceneId: Id, label = 'Automatic', force = false) {
  const t = store.world.sceneTexts.find((x) => x.sceneId === sceneId && x.scenarioId === store.scenarioId) ?? store.world.sceneTexts.find((x) => x.sceneId === sceneId);
  if (!t) return;
  const data = await packDoc(t.doc);
  const last = versionsOf(store.world, sceneId)[0];
  if (!force && !wantsAutoVersion(last, data)) return;
  if (last?.data === data) return;
  const v = await makeVersion(sceneId, t.doc, label, label !== 'Automatic' && !label.startsWith('Before'));
  store.update((w) => addVersion(w, v), false);
}

export function SceneEditor(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const props = useRef(p);
  props.current = p;
  /** The doc object last written to (or read from) the world, to tell our own saves from outside changes. */
  const known = useRef<TextNode | undefined>(p.text?.doc);
  const dirty = useRef(false);
  const timers = useRef<{ idle?: ReturnType<typeof setTimeout>; max?: ReturnType<typeof setTimeout> }>({});
  const lastVersionAt = useRef(Date.now());
  /** Typed in since the last automatic version check. */
  const edited = useRef(false);
  const versionIfEdited = () => {
    if (!edited.current) return;
    edited.current = false;
    void autoVersion(props.current.store, props.current.sceneId);
  };

  const flush = () => {
    const v = view.current;
    clearTimeout(timers.current.idle);
    clearTimeout(timers.current.max);
    timers.current = {};
    if (!v || !dirty.current) return;
    dirty.current = false;
    const doc = v.state.doc.toJSON() as TextNode;
    known.current = doc;
    commitText(props.current.store, props.current.sceneId, doc);
    // WR-6: a version every half hour of steady writing.
    if (Date.now() - lastVersionAt.current > WRITING_VERSION_EVERY_MS) {
      lastVersionAt.current = Date.now();
      void autoVersion(props.current.store, props.current.sceneId, 'Automatic', true);
    }
  };

  useEffect(() => {
    const state = EditorState.create({
      doc: docNode(p.text?.doc),
      plugins: [
        // WR-11 first, so the @ list gets arrow keys, Enter and Esc before the editor does.
        mentionPlugin(() => props.current),
        inputRules({ rules: [...smartQuotes, ellipsis, emDash, sceneBreakRule] }),
        history(),
        keymap({
          'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
          'Mod-b': commands.bold, 'Mod-i': commands.italic,
          'Mod-Alt-0': commands.paragraph, 'Mod-Alt-1': commands.heading(1), 'Mod-Alt-2': commands.heading(2), 'Mod-Alt-3': commands.heading(3),
          'Mod-Enter': commands.sceneBreak,
          'Mod-l': (_s, _d, v) => { if (v && props.current.onLinkKey) props.current.onLinkKey(props.current.sceneId, v); return true; },
          'Mod-Alt-m': (_s, _d, v) => { if (v && props.current.onCommentKey) props.current.onCommentKey(props.current.sceneId, v); return true; },
          'Shift-Enter': (s, d) => { d?.(s.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); return true; },
          ArrowDown: (s, _d, v) => atEdge(s, v, 'end', 'down') && nav('next'),
          ArrowRight: (s) => s.selection.empty && s.selection.head === Selection.atEnd(s.doc).head && nav('next'),
          ArrowUp: (s, _d, v) => atEdge(s, v, 'start', 'up') && nav('prev'),
          ArrowLeft: (s) => s.selection.empty && s.selection.head === Selection.atStart(s.doc).head && nav('prev'),
        }),
        keymap(baseKeymap),
        infoPlugin(() => props.current.info),
      ],
    });
    // WR-6: the text as it was before the scene was first edited here is kept too.
    const keepFirst = (before: PMNode) => {
      const { store, sceneId } = props.current;
      if (versionsOf(store.world, sceneId).length || !before.textContent.trim()) return;
      void makeVersion(sceneId, before.toJSON() as TextNode, 'Before first edit').then((ver) => store.update((w) => addVersion(w, ver), false));
    };
    const nav = (dir: 'prev' | 'next') => { props.current.onNav(props.current.sceneId, dir); return true; };
    const v = new EditorView(host.current!, {
      state,
      editable: () => !props.current.readOnly,
      attributes: { spellcheck: 'true', lang: p.spelling, class: 'prose' },
      dispatchTransaction(tr) {
        if (tr.docChanged && !edited.current) keepFirst(v.state.doc);
        const ns = v.state.apply(tr);
        v.updateState(ns);
        if (tr.docChanged) {
          dirty.current = true;
          edited.current = true;
          clearTimeout(timers.current.idle);
          timers.current.idle = setTimeout(flush, COMMIT_IDLE_MS);
          if (!timers.current.max) timers.current.max = setTimeout(flush, COMMIT_MAX_MS);
          props.current.onChange?.();
        }
        if ((tr.docChanged || tr.selectionSet) && props.current.typewriter && v.hasFocus()) typewriterScroll(v);
      },
      handleDOMEvents: {
        focus: () => { props.current.onFocus(props.current.sceneId, v); return false; },
        blur: () => { flush(); versionIfEdited(); return false; },
      },
    });
    view.current = v;
    p.register(p.sceneId, v);
    return () => {
      flush();
      versionIfEdited();
      props.current.register(props.current.sceneId, null);
      v.destroy();
      view.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A change from outside (restore a version, undo a delete, an import): show it.
  useEffect(() => {
    const v = view.current;
    if (!v || p.text?.doc === known.current) return;
    known.current = p.text?.doc;
    if (dirty.current) return; // our own unsaved typing wins; it is saved in a moment
    const doc = docNode(p.text?.doc);
    if (doc.eq(v.state.doc)) return;
    const sel = Math.min(v.state.selection.head, doc.content.size);
    let ns = EditorState.create({ doc, plugins: v.state.plugins });
    try { ns = ns.apply(ns.tr.setSelection(Selection.near(ns.doc.resolve(sel)))); } catch { /* keep the start */ }
    v.updateState(ns);
  }, [p.text?.doc]);

  // Names, comments or links changed in the world: redraw the decorations.
  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(v.state.tr.setMeta(infoKey, true).setMeta('addToHistory', false));
  }, [p.info]);

  useEffect(() => { view.current?.setProps({ attributes: { spellcheck: 'true', lang: p.spelling, class: 'prose' } }); }, [p.spelling]);
  useEffect(() => { view.current?.setProps({}); }, [p.readOnly]);

  return <div className="scene-editor" ref={host} />;
}

function atEdge(s: EditorState, v: EditorView | undefined, edge: 'start' | 'end', dir: 'up' | 'down'): boolean {
  if (!v || !s.selection.empty) return false;
  const $h = s.selection.$head;
  const idx = $h.index(0);
  const isEdgeBlock = edge === 'end' ? idx === s.doc.childCount - 1 : idx === 0;
  return isEdgeBlock && v.endOfTextblock(dir);
}

/** WR-3: keep the line being typed in the middle of the screen. */
function typewriterScroll(v: EditorView) {
  const scroller = v.dom.closest('.write-scroll') as HTMLElement | null;
  if (!scroller) return;
  try {
    const c = v.coordsAtPos(v.state.selection.head);
    const r = scroller.getBoundingClientRect();
    const delta = c.top - (r.top + r.height / 2);
    if (Math.abs(delta) > 4) scroller.scrollTop += delta;
  } catch { /* position not drawn yet */ }
}
