/**
 * WR-1, WR-2, WR-8: the editor for one scene. Text is saved into the world a moment after typing
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
import { Id, SceneText, TextComment, TextNode, World, addVersion, docWords, emptyDoc, makeVersion, nameRanges, packDoc, versionsOf, wantsAutoVersion, WRITING_VERSION_EVERY_MS } from '../../core';
import { nowIso, newId, recordBase } from '../../storage';
import type { WorldStore } from '../store';
import { schema } from './schema';
import 'prosemirror-view/style/prosemirror.css';

const COMMIT_IDLE_MS = 1500;
const COMMIT_MAX_MS = 5000;

/** What the decorations need from the world: its names (WR-8), comments and link labels. */
export interface TextInfo {
  words: Set<string>;
  comments: Map<Id, TextComment>;
  label: (kind: string, id: Id) => string | undefined;
}

const infoKey = new PluginKey<DecorationSet>('world-words');

function decorate(doc: PMNode, info: TextInfo): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? '';
    for (const [a, b] of nameRanges(text, info.words)) decos.push(Decoration.inline(pos + a, pos + b, { spellcheck: 'false', class: 'world-word' }));
    for (const m of node.marks) {
      if (m.type.name === 'comment') {
        const c = info.comments.get(m.attrs.id);
        if (c) decos.push(Decoration.inline(pos, pos + text.length, { title: `${c.author ? c.author + ': ' : ''}${c.text}` }));
      } else if (m.type.name === 'link') {
        const l = info.label(m.attrs.kind, m.attrs.id);
        decos.push(Decoration.inline(pos, pos + text.length, { title: l ? `Linked to ${l}${m.attrs.note ? ` · ${m.attrs.note}` : ''}` : 'Linked record no longer exists' }));
      }
    }
  });
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
}

/** Save the editor's text into the world (not an undo step: the editor has its own undo). */
export function commitText(store: WorldStore, sceneId: Id, doc: TextNode) {
  store.update((w: World) => {
    const words = docWords(doc);
    const t = w.sceneTexts.find((x) => x.sceneId === sceneId);
    const rec: SceneText = t ? { ...t, doc, words, updatedAt: nowIso() } : { ...recordBase(), id: newId(), sceneId, doc, words };
    return { ...w, sceneTexts: t ? w.sceneTexts.map((x) => (x === t ? rec : x)) : [...w.sceneTexts, rec] };
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
        inputRules({ rules: [...smartQuotes, ellipsis, emDash, sceneBreakRule] }),
        history(),
        keymap({
          'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
          'Mod-b': commands.bold, 'Mod-i': commands.italic,
          'Mod-Alt-0': commands.paragraph, 'Mod-Alt-1': commands.heading(1), 'Mod-Alt-2': commands.heading(2), 'Mod-Alt-3': commands.heading(3),
          'Mod-Enter': commands.sceneBreak,
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
