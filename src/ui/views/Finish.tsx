/**
 * Phase 8b, finish: RV-8 reading copies (ePub and PDF), RV-9 the submissions tracker, SR-2 the
 * "Previously on…" recap and EU-16 the series bible (PDF or Word, as the reader knows it by a book).
 */
import { useMemo, useState } from 'react';
import {
  BIBLE_SECTIONS, BibleSection, Id, Measure, PubBlock, PubDoc, Run, SUBMISSION_ANSWERS, SUBMISSION_KINDS, SUBMISSION_SENT, Submission, World,
  buildEpub, buildPdf, buildPubDocx, chapterBefore, dayKey, daysWaiting, fileTitle, outline, readingCopy, recap, roughMeasure,
  scenarioView, seriesBible, sortedSubmissions, submissionOpen, submissionSummary,
} from '../../core';
import { recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { useApp } from '../context';
import { DayInput } from '../writing/Goals';

type Tab = 'copy' | 'submissions' | 'recap' | 'bible';
const TABS: [Tab, string, string][] = [
  ['copy', 'Reading copy', 'RV-8: a book as an ePub for e-readers or a PDF to read or print'],
  ['submissions', 'Submissions', 'RV-9: where each book was sent, when, and the answer'],
  ['recap', 'Previously on…', 'SR-2: before a book, what the reader knows so far'],
  ['bible', 'Series bible', 'EU-16: characters, places, groups and the timeline, as PDF or Word'],
];
const TAB_KEY = 'swt.finish.tab';
const BOOK_KEY = 'swt.finish.book';
type PdfPage = 'trade' | 'a4' | 'letter';

/** Text widths for the PDF, in Times New Roman (the same widths as the PDF's Times). */
const canvasMeasure: Measure = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = document.createElement('canvas').getContext('2d'); } catch { /* no canvas (tests) */ }
  if (!ctx) return roughMeasure;
  const c = ctx;
  const fonts = { R: '', I: 'italic ', B: 'bold ', BI: 'italic bold ' } as const;
  return (text, font, size) => { c.font = `${fonts[font]}100px "Times New Roman", Times, "Liberation Serif", serif`; return (c.measureText(text).width * size) / 100; };
})();

export function Finish() {
  const { store, scenarioId, world: shown } = useApp();
  // The documents are built from the whole (scenario) world, not the reader's view or the view filter.
  const world = useMemo(() => scenarioView(store.world, scenarioId), [store.world, scenarioId, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = useMemo(() => outline(world), [world]);
  const [tab, setTabState] = useState<Tab>(() => { try { return (localStorage.getItem(TAB_KEY) as Tab) || 'copy'; } catch { return 'copy'; } });
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  const [bookState, setBookState] = useState<Id | undefined>(() => { try { return localStorage.getItem(BOOK_KEY) ?? undefined; } catch { return undefined; } });
  const setBook = (id: Id) => { setBookState(id); try { localStorage.setItem(BOOK_KEY, id); } catch { /* ignore */ } };
  const bookId = tree.some((b) => b.book.id === bookState) ? bookState! : tree[0]?.book.id;

  if (!bookId) return <div className="page narrow"><h1>Finish</h1><p className="muted">Write or import a book first; then make reading copies, track submissions, and make the recap and the series bible here.</p></div>;
  return (
    <div className="plan-page finish-page">
      <div className="plan-head">
        {tab !== 'bible' && <select value={bookId} onChange={(e) => setBook(e.target.value)} aria-label="Book">{tree.map(({ book: b }) => <option key={b.id} value={b.id}>{b.title}</option>)}</select>}
        <div className="seg">{TABS.map(([t, label, hint]) => <button key={t} className={tab === t ? 'on' : ''} title={hint} onClick={() => setTab(t)}>{label}</button>)}</div>
      </div>
      <div className="plan-body">
        {tab === 'copy' && <ReadingCopy world={world} bookId={bookId} />}
        {tab === 'submissions' && <Submissions world={world} bookId={bookId} />}
        {tab === 'recap' && <Recap world={world} bookId={bookId} />}
        {tab === 'bible' && <Bible world={world} />}
      </div>
    </div>
  );
}

function useSaver() {
  const { platform } = useApp();
  const [busy, setBusy] = useState('');
  const save = async (label: string, name: string, make: () => Uint8Array | Promise<Uint8Array>) => {
    setBusy(label);
    try { await platform.saveBinaryFile(name, await make()); }
    catch (e) { void ask.alert(`Could not make the file: ${(e as Error).message}`); }
    finally { setBusy(''); }
  };
  return { busy, save };
}

// ---------------------------------------------------------------- RV-8 reading copy

function ReadingCopy({ world, bookId }: { world: World; bookId: Id }) {
  const chapters = outline(world).find((b) => b.book.id === bookId)?.chapters ?? [];
  const [range, setRange] = useState<{ book: Id; from: number; to: number }>({ book: bookId, from: 0, to: Math.max(0, chapters.length - 1) });
  const r = range.book === bookId ? { from: Math.min(range.from, chapters.length - 1), to: Math.min(range.to, chapters.length - 1) } : { from: 0, to: chapters.length - 1 };
  const [page, setPage] = useState<PdfPage>('trade');
  const doc = useMemo(() => (chapters.length ? readingCopy(world, bookId, { fromChapter: Math.max(0, r.from), toChapter: Math.max(0, r.to) }) : undefined), [world, bookId, r.from, r.to, chapters.length]);
  const { busy, save } = useSaver();
  if (!doc) return <p className="muted">This book has no chapters yet.</p>;
  const words = doc.blocks.reduce((n, b) => n + (b.kind === 'p' ? b.runs.map((x) => x.text).join('').split(/\s+/).filter(Boolean).length : 0), 0);
  const name = fileTitle(doc.title);
  return (
    <div className="finish-split">
      <section className="finish-controls">
        <h2>Reading copy</h2>
        <p className="muted small">For beta readers and for reading on an e-reader or tablet: the text only, chapters on a new page, no comments or links. For Word, use Export on the Write page.</p>
        <label>From <select value={r.from} onChange={(e) => setRange({ book: bookId, from: Number(e.target.value), to: Math.max(Number(e.target.value), r.to) })}>{chapters.map((c, i) => <option key={c.chapter.id} value={i}>{c.chapter.title || `Chapter ${i + 1}`}</option>)}</select></label>
        <label>To <select value={r.to} onChange={(e) => setRange({ book: bookId, from: Math.min(r.from, Number(e.target.value)), to: Number(e.target.value) })}>{chapters.map((c, i) => <option key={c.chapter.id} value={i}>{c.chapter.title || `Chapter ${i + 1}`}</option>)}</select></label>
        <p className="small">{(r.to - r.from + 1)} chapters, about {words.toLocaleString('en-US')} words{doc.author ? `, by ${doc.author}` : ' (add your name in Settings → Writing for the title page)'}.</p>
        <div className="finish-actions">
          <button className="primary" disabled={!!busy} onClick={() => void save('epub', `${name}.epub`, () => buildEpub(doc, { id: bookId }))}>{busy === 'epub' ? 'Making…' : 'Save ePub'}</button>
          <span className="muted small">For Kindle (send to Kindle), Kobo, Apple Books and most reading apps.</span>
        </div>
        <div className="finish-actions">
          <button className="primary" disabled={!!busy} onClick={() => void save('pdf', `${name}.pdf`, () => buildPdf(doc, { page, measure: canvasMeasure }))}>{busy === 'pdf' ? 'Making…' : 'Save PDF'}</button>
          <select value={page} onChange={(e) => setPage(e.target.value as PdfPage)} aria-label="Page size">
            <option value="trade">Paperback page (6 × 9 in)</option><option value="a4">A4</option><option value="letter">US Letter</option>
          </select>
        </div>
        <p className="muted small">The PDF is set in Times. Letters outside Western European alphabets show as "?" in the PDF (the ePub keeps them).</p>
      </section>
      <PubPreview doc={doc} />
    </div>
  );
}

/** A page-like preview of a document (the first part of it). */
function PubPreview({ doc, limit = 120 }: { doc: PubDoc; limit?: number }) {
  const blocks = doc.blocks.slice(0, limit);
  return (
    <section className="pub-preview" aria-label="Preview">
      <div className="pub-page">
        <div className="pub-title"><div className="t">{doc.title}</div>{doc.subtitle && <div className="s">{doc.subtitle}</div>}{doc.author && <div className="a">{doc.author}</div>}</div>
        {blocks.map((b, i) => <PubBlockView key={i} b={b} />)}
        {doc.blocks.length > limit && <p className="muted small pub-more">… and {doc.blocks.length - limit} more paragraphs in the file.</p>}
        {!doc.blocks.length && <p className="muted">Nothing to show yet.</p>}
      </div>
    </section>
  );
}

function PubBlockView({ b }: { b: PubBlock }) {
  if (b.kind === 'break') return <p className="pub-break">* * *</p>;
  if (b.kind === 'heading') { const H = `h${b.level + 1}` as 'h2'; return <H className={`pub-h${b.level}`}>{b.text}</H>; }
  return <p className={`${b.first ? 'first' : ''} ${b.small ? 'small' : ''}`}>{b.runs.map((r, i) => <RunView key={i} r={r} />)}</p>;
}
function RunView({ r }: { r: Run }) {
  if (r.br) return <br />;
  let el: React.ReactNode = r.text;
  if (r.italic) el = <em>{el}</em>;
  if (r.bold) el = <strong>{el}</strong>;
  return <>{el}</>;
}

// ---------------------------------------------------------------- RV-9 submissions

function Submissions({ world, bookId }: { world: World; bookId: Id }) {
  const { store } = useApp();
  const list = sortedSubmissions(world, bookId);
  const sum = submissionSummary(list);
  const today = dayKey();
  const set = (s: Submission, patch: Partial<Submission>) => store.upsert('submissions', { ...s, ...patch });
  const add = () => store.upsert('submissions', { ...recordBase(), bookId, to: '', kind: 'agent', sent: 'query', sentOn: today, answer: 'waiting', notes: '' } as Submission);
  const remove = async (s: Submission) => { if (await ask.confirm(`Delete the submission to ${s.to || 'this agent'}?`, { okLabel: 'Delete', danger: true })) store.removeMany([{ c: 'submissions', id: s.id }]); };
  const ro = store.readOnly;
  return (
    <div className="finish-submissions">
      <div className="row">
        <button className="primary" disabled={ro} onClick={add}>+ Submission</button>
        {list.length > 0 && <span className="small">{sum.sent} sent · <b>{sum.open} waiting</b> · {sum.requests} asked for more · {sum.offers} {sum.offers === 1 ? 'offer' : 'offers'} · {sum.rejections} {sum.rejections === 1 ? 'rejection' : 'rejections'}</span>}
      </div>
      {!list.length ? <p className="muted">Nothing sent yet. Add a row each time this book goes out: a query to an agent, pages they asked for, a contest entry.</p> : (
        <table className="plan-outline submissions-table">
          <thead><tr><th>Sent</th><th>To</th><th>Kind</th><th>What</th><th>Answer</th><th>Answered</th><th>Notes</th><th /></tr></thead>
          <tbody>
            {list.map((s) => {
              const wait = daysWaiting(s, today);
              return (
                <tr key={s.id} className={`answer-${s.answer}`}>
                  <td><DayInput value={s.sentOn} disabled={ro} onChange={(v) => v && set(s, { sentOn: v })} />{wait !== undefined && <div className={`muted small ${wait > 90 ? 'warn-text' : ''}`}>{wait} days</div>}</td>
                  <td><input value={s.to} placeholder="Agent, agency or contest" disabled={ro} onChange={(e) => set(s, { to: e.target.value })} aria-label="Sent to" /></td>
                  <td><select value={s.kind} disabled={ro} onChange={(e) => set(s, { kind: e.target.value as Submission['kind'] })} aria-label="Kind">{SUBMISSION_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></td>
                  <td><select value={s.sent} disabled={ro} onChange={(e) => set(s, { sent: e.target.value as Submission['sent'] })} aria-label="What was sent">{SUBMISSION_SENT.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></td>
                  <td><select className={`answer-pick answer-${s.answer}`} value={s.answer} disabled={ro} onChange={(e) => { const answer = e.target.value as Submission['answer']; set(s, { answer, answeredOn: SUBMISSION_ANSWERS.find((a) => a.id === answer)?.open === false && !s.answeredOn ? today : s.answeredOn }); }} aria-label="Answer">{SUBMISSION_ANSWERS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></td>
                  <td>{submissionOpen(s) && !s.answeredOn ? <span className="muted small">—</span> : <DayInput value={s.answeredOn} disabled={ro} onChange={(v) => set(s, { answeredOn: v })} />}</td>
                  <td><input value={s.notes} disabled={ro} onChange={(e) => set(s, { notes: e.target.value })} aria-label="Notes" /></td>
                  <td><button className="icon small" aria-label="Delete submission" disabled={ro} onClick={() => void remove(s)}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted small">Dates are real days (day/month/year), not story dates. "Asked for more" counts as an answer: add a new row when you send the pages they asked for.</p>
    </div>
  );
}

// ---------------------------------------------------------------- SR-2 recap

function Recap({ world, bookId }: { world: World; bookId: Id }) {
  const [minor, setMinor] = useState(false);
  const doc = useMemo(() => recap(world, bookId, { minor }), [world, bookId, minor]);
  const { busy, save } = useSaver();
  const book = world.books.find((b) => b.id === bookId)!;
  if (!doc) return <p className="muted">{book.title} is the first book, so there is nothing to recap before it. Pick a later book above.</p>;
  const name = fileTitle(`Previously on - before ${book.title}`);
  const upTo = outline(world).flatMap((b) => b.chapters.map((c) => ({ b, c })))[chapterBefore(world, bookId)];
  return (
    <div className="finish-split">
      <section className="finish-controls">
        <h2>Previously on…</h2>
        <p className="muted small">What the reader knows before {book.title}: the scene summaries of the books before it, who is who and where the story left them, and the secrets the reader is in on. It uses the reader's view at the end of {upTo ? <b>{upTo.b.book.title}</b> : 'the book before'}, so nothing from later leaks in.</p>
        <label className="checkbox"><input type="checkbox" checked={minor} onChange={(e) => setMinor(e.target.checked)} /> Include minor characters</label>
        <p className="muted small">Thin? It is built from scene summaries (Books &amp; scenes) and character descriptions: the fuller those are, the better the recap.</p>
        <div className="finish-actions">
          <button className="primary" disabled={!!busy} onClick={() => void save('pdf', `${name}.pdf`, () => buildPdf(doc, { page: world.settings.writing?.spelling === 'en-US' ? 'letter' : 'a4', measure: canvasMeasure }))}>{busy === 'pdf' ? 'Making…' : 'Save PDF'}</button>
          <button disabled={!!busy} onClick={() => void save('docx', `${name}.docx`, () => buildPubDocx(doc))}>{busy === 'docx' ? 'Making…' : 'Save Word'}</button>
        </div>
      </section>
      <PubPreview doc={doc} />
    </div>
  );
}

// ---------------------------------------------------------------- EU-16 series bible

function Bible({ world }: { world: World }) {
  const tree = outline(world);
  const [through, setThrough] = useState<Id | ''>('');
  const [sections, setSections] = useState<BibleSection[]>(BIBLE_SECTIONS.map((s) => s.id));
  const [skipMinor, setSkipMinor] = useState(false);
  const throughId = tree.some((b) => b.book.id === through) ? (through as Id) : undefined;
  const doc = useMemo(() => seriesBible(world, { throughBookId: throughId, sections, skipMinor }), [world, throughId, sections, skipMinor]);
  const { busy, save } = useSaver();
  const name = fileTitle(throughId ? `${doc.title} series bible - to ${tree.find((b) => b.book.id === throughId)!.book.title}` : `${doc.title} series bible`);
  const toggle = (s: BibleSection) => setSections((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : BIBLE_SECTIONS.map((x) => x.id).filter((x) => x === s || cur.includes(x))));
  return (
    <div className="finish-split">
      <section className="finish-controls">
        <h2>Series bible</h2>
        <label>What it covers
          <select value={through} onChange={(e) => setThrough(e.target.value)}>
            <option value="">Everything (the author's copy, with notes)</option>
            {tree.map(({ book: b }) => <option key={b.id} value={b.id}>What the reader knows by the end of {b.title}</option>)}
          </select>
        </label>
        <p className="muted small">{throughId ? "Safe to hand to a cover artist, an editor or a co-writer: it leaves out what the reader has not learned yet, and your private notes." : 'Everyone and everything, with your notes. Pick a book to leave out spoilers.'}</p>
        <div className="rule-list">{BIBLE_SECTIONS.map((s) => <label key={s.id} className="checkbox small"><input type="checkbox" checked={sections.includes(s.id)} onChange={() => toggle(s.id)} /> {s.label}</label>)}</div>
        <label className="checkbox small"><input type="checkbox" checked={skipMinor} onChange={(e) => setSkipMinor(e.target.checked)} /> Leave out minor characters</label>
        <div className="finish-actions">
          <button className="primary" disabled={!!busy || !sections.length} onClick={() => void save('pdf', `${name}.pdf`, () => buildPdf(doc, { page: world.settings.writing?.spelling === 'en-US' ? 'letter' : 'a4', measure: canvasMeasure }))}>{busy === 'pdf' ? 'Making…' : 'Save PDF'}</button>
          <button disabled={!!busy || !sections.length} onClick={() => void save('docx', `${name}.docx`, () => buildPubDocx(doc))}>{busy === 'docx' ? 'Making…' : 'Save Word'}</button>
        </div>
      </section>
      <PubPreview doc={doc} limit={160} />
    </div>
  );
}

