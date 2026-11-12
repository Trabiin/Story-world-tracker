/**
 * AI-1: the Claude folder. A live, read-only copy of the world as plain Markdown files that Claude
 * Code can read and search like a codebase: every scene's text, a page per character, place, group,
 * event and realm, the timeline, the story's threads and secrets, the map and the open warnings,
 * plus the guide (CLAUDE.md, guide/data-model.md) and the whole world as JSON.
 */
import { formatFuzzy, fromDay, toWindow, type FuzzyDate } from '../dates';
import { describeRelative } from '../events';
import { polylineKm } from '../features';
import { LAYER_TYPES, LayerIndex, describeChain } from '../layers';
import { CANON, Id, World } from '../model';
import { backlinksFor, outline, scenePlace, scenePov } from '../story';
import { scenarioChanges, scenarioView } from '../structure';
import type { Warning } from '../warnings';
import { OPEN_END, WorldIndex } from '../whereabouts';
import { safeName, textOf } from '../writing';
import { allComments, cleanFolder } from '../notes';
import { SETUP_STATE_LABEL, arcTurnsInOrder, pacing, readIndexOf, setupState } from '../plan';
import { STYLE_RULES, STYLE_RULE_IDS, dialogueCounts, dialogueLines, passesOf } from '../revise';
import { SUBMISSION_ANSWERS, SUBMISSION_KINDS, SUBMISSION_SENT, sortedSubmissions, submissionSummary } from '../publish';
import { claudeMd, dataModelGuide } from './guide';
import { REF_KIND_COLLECTION } from './schema';
import { docToMarkdown } from './text';

export interface FolderFile {
  /** Relative path with "/" between folders. */
  path: string;
  /** The file's text; for a binary file (bytes set), a key that changes when the bytes do. */
  text: string;
  /** NT-4: a binary file (a research file's copy). */
  bytes?: Uint8Array;
}

const num = (i: number, n: number) => String(i + 1).padStart(Math.max(2, String(n).length), '0');

/** File names that stay unique: a second "Kaela" gets a short id after its name. */
function namer() {
  const used = new Set<string>();
  return (dir: string, name: string, id: Id) => {
    let base = `${dir}/${safeName(name)}`;
    if (used.has(base.toLowerCase())) base = `${base} (${id.slice(0, 6)})`;
    used.add(base.toLowerCase());
    return `${base}.md`;
  };
}

export function dateText(world: World, d: FuzzyDate | undefined): string {
  if (!d) return '';
  return d.rel ? `${formatFuzzy(d)} (${describeRelative(world, d.rel)})` : formatFuzzy(d);
}

/** Every file of the Claude folder for this world. warnings: the app's current warnings. */
export function claudeFolderFiles(stored: World, warnings: Warning[], opts: { directEdit?: boolean } = {}): FolderFile[] {
  const files: FolderFile[] = [];
  // Pages show canon; story/scenarios.md lists what each what-if changes.
  const world = scenarioView(stored, CANON);
  const ix = new WorldIndex(world);
  const lix = new LayerIndex(world);
  const d = (x: FuzzyDate | undefined) => dateText(world, x);
  const name = (c: string, id: Id | undefined): string => {
    if (!id) return '';
    const r = (world as unknown as Record<string, { id: Id; name?: string; title?: string }[]>)[c]?.find((x) => x.id === id);
    return r ? `${r.name ?? r.title ?? '?'} (\`${id}\`)` : `? (\`${id}\`)`;
  };
  const ch = (id: Id | undefined) => name('characters', id);
  const pl = (id: Id | undefined) => name('places', id);
  const subj = (s: { kind: string; id: Id }) => (s.kind === 'character' ? ch(s.id) : `the group ${name('groups', s.id)}`);
  const line = (label: string, v: unknown) => (v === undefined || v === '' || (Array.isArray(v) && !v.length) ? '' : `- **${label}:** ${Array.isArray(v) ? v.join(', ') : String(v)}\n`);
  const head = (title: string, id: Id, kind: string) => `# ${title}\n\n- **id:** \`${id}\`\n- **kind of record:** ${kind}\n`;
  const ref = namer();

  // ---- guide ----
  files.push({ path: 'CLAUDE.md', text: claudeMd(world, { directEdit: !!opts.directEdit }) });
  files.push({ path: 'guide/data-model.md', text: dataModelGuide() });

  // ---- world at a glance ----
  const s = world.settings;
  const tree = outline(world);
  const moment = s.currentMoment !== undefined ? formatFuzzy(fromDay(Math.round(s.currentMoment))) : '';
  files.push({
    path: 'world.md',
    text: `# ${s.name}\n\n${line('Planet radius', `${s.radiusKm} km`)}${line('Axial tilt', `${s.axialTiltDeg}°`)}${line('Seasons follow the', `${s.hemisphereForSeasons}ern hemisphere when no place is known`)}${line('Current moment in the app', moment)}${line('Travel modes', s.travelModes.map((m) => `${m.name} \`${m.id}\` ${m.speedKmPerDay} km/day`))}${line('Default detour factor', s.defaultDetourFactor)}${line('Terrain types', s.biomes.map((b) => b.name))}
## Counts

${line('Characters', world.characters.length)}${line('Places', world.places.length)}${line('Groups', world.groups.length)}${line('Stays and journeys', world.stays.length + world.journeys.length)}${line('Events', world.events.length)}${line('Books, chapters, scenes', `${world.books.length}, ${world.chapters.length}, ${world.scenes.length}`)}${line('Words in scene text', world.sceneTexts.filter((t) => t.scenarioId === CANON).reduce((n, t) => n + t.words, 0).toLocaleString('en-GB'))}${line('Map features', world.mapFeatures.length)}${line('Regions', world.regions.length)}
## Books

${tree.map(({ book, chapters }) => `- ${book.order}. **${book.title}** (\`${book.id}\`): ${chapters.length} chapters${book.wordGoal ? `, goal ${book.wordGoal.toLocaleString('en-GB')} words` : ''}${book.deadline ? `, deadline ${book.deadline}` : ''}`).join('\n') || 'None yet.'}
`,
  });

  // ---- manuscript ----
  tree.forEach(({ book, chapters }, bi) => {
    const bookDir = `manuscript/${num(bi, tree.length)} ${safeName(book.title, 'Book')}`;
    chapters.forEach(({ chapter, scenes }, ci) => {
      const chDir = `${bookDir}/${num(ci, chapters.length)} ${safeName(chapter.title, 'Chapter')}`;
      scenes.forEach((sc, si) => {
        const t = textOf(world, sc.id);
        const where = scenePlace(ix, sc);
        const body = t ? docToMarkdown(t.doc) : '';
        files.push({
          path: `${chDir}/${num(si, scenes.length)} ${safeName(sc.title, 'Scene')}.md`,
          text: `${head(sc.title || 'Untitled scene', sc.id, 'scene')}${line('Book', name('books', book.id))}${line('Chapter', name('chapters', chapter.id))}${line('When', [d(sc.start), sc.end ? d(sc.end) : ''].filter(Boolean).join(' to '))}${line('Point of view', ch(scenePov(world, sc)))}${line('Place', where.placeId ? `${pl(where.placeId)}${where.derived ? ' (where the POV character is)' : ''}` : '')}${line('Cast', sc.characterIds.map(ch))}${line('Plot threads', (sc.threadIds ?? []).map((x) => name('threads', x)))}${line('Writing stage', sc.stage ?? 'idea')}${line('Status', sc.status)}${line('Words', t?.words ?? 0)}${line('Summary', sc.summary)}${t?.comments?.length ? `- **Comments:** ${t.comments.map((c) => `${c.author}: ${c.text}`).join(' | ')}\n` : ''}\n---\n\n${body || '_No text yet._'}\n`,
        });
      });
    });
  });

  // ---- characters ----
  for (const c of world.characters) {
    const whereabouts = whereaboutsLines(world, ix, c.id);
    const rels = world.relationships.filter((r) => r.aId === c.id || r.bId === c.id).map((r) => `- ${r.aId === c.id ? `is ${r.kind} of` : `${r.kind} relation with (they are ${r.kind} of this character)`} ${ch(r.aId === c.id ? r.bId : r.aId)}${r.label ? ` (${r.label})` : ''}${r.start || r.end ? `, ${d(r.start)}–${d(r.end)}` : ''} [\`${r.id}\`]`);
    const groups = world.memberships.filter((m) => m.characterId === c.id).map((m) => `- ${name('groups', m.groupId)}${m.start || m.end ? `, ${d(m.start)}–${d(m.end)}` : ''}`);
    const secrets = world.secrets.flatMap((x) => x.knowers.filter((k) => k.characterId === c.id).map((k) => `- ${x.title} (\`${x.id}\`): knows ${k.from ? `from ${d(k.from)}` : 'from the start'}${k.how ? `, ${k.how}` : ''}`));
    const appears = backlinksFor(world, 'character', c.id).filter((b) => b.kind === 'scene' || b.kind === 'chapter' || b.kind === 'event').map((b) => `- ${b.kind} ${b.label} (\`${b.id}\`)${b.detail ? `, ${b.detail}` : ''}`);
    files.push({
      path: ref('characters', c.name, c.id),
      text: `${head(c.name, c.id, 'character')}${line('Aliases', c.aliases)}${line('Importance', c.importance)}${line('Tags', c.tags)}${line('Born', d(c.birth))}${line('Died', d(c.death))}${line('Archived', c.archived ? 'yes' : '')}${line('Status', c.status)}${line('Description', c.description)}${line('Notes', c.notes)}
## Attributes over time

${(c.attributes ?? []).map((a) => `- ${a.key}: ${a.value}${a.start || a.end ? ` (${d(a.start) || '…'} – ${d(a.end) || '…'})` : ''}`).join('\n') || 'None.'}

## Relationships

${rels.join('\n') || 'None.'}

## Groups

${groups.join('\n') || 'None.'}

## Whereabouts

${whereabouts.join('\n') || 'No stays or journeys yet.'}

## Plans

${(c.plans ?? []).map((p) => `- to ${pl(p.placeId)}${p.by ? ` by ${d(p.by)}` : ''}${p.from ? ` (decided ${d(p.from)})` : ''}${p.note ? `: ${p.note}` : ''}${p.done ? ' (done)' : ''}`).join('\n') || 'None.'}

## Secrets known

${secrets.join('\n') || 'None.'}

## Appears in

${appears.join('\n') || 'Nothing yet.'}
`,
    });
  }

  // ---- places ----
  for (const p of world.places) {
    const loc = ix.locationOf(p.id);
    const realms = loc ? lix.realmHistory(loc).map((r) => `- ${describeChain(r.chain)}: ${r.startLabel ?? 'from the beginning'}${r.endLabel ? ` until ${r.endLabel}` : ''}`) : [];
    const here = backlinksFor(world, 'place', p.id).map((b) => `- ${b.kind}: ${b.label} (\`${b.id}\`)${b.detail ? `, ${b.detail}` : ''}`);
    const feature = world.mapFeatures.find((f) => f.placeId === p.id);
    files.push({
      path: ref('places', p.name, p.id),
      text: `${head(p.name, p.id, 'place')}${line('Kind', p.kind)}${line('Aliases', p.aliases)}${line('Inside', pl(p.parentId))}${line('Location', loc ? `${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)}${p.location ? '' : ' (from its parent)'}` : 'not on the map')}${line('Exists', p.start || p.end ? `${d(p.start) || '…'} – ${d(p.end) || '…'}` : '')}${line('Map feature', feature ? `${feature.kind} \`${feature.id}\`` : '')}${line('Placeholder', p.isPlaceholder ? 'yes (unknown / on the road)' : '')}${line('Status', p.status)}${line('Notes', p.notes)}
## Realm over time

${realms.join('\n') || 'Not inside any realm on the political layer.'}

## Connections

${here.join('\n') || 'Nothing yet.'}
`,
    });
  }

  // ---- groups ----
  for (const g of world.groups) {
    files.push({
      path: ref('groups', g.name, g.id),
      text: `${head(g.name, g.id, 'group')}${line('Description', g.description)}\n## Members\n\n${world.memberships.filter((m) => m.groupId === g.id).map((m) => `- ${ch(m.characterId)}${m.start || m.end ? `, ${d(m.start) || '…'} – ${d(m.end) || '…'}` : ''} [membership \`${m.id}\`]`).join('\n') || 'None.'}\n\n## Stays and journeys\n\n${[...world.stays.filter((x) => x.subject.kind === 'group' && x.subject.id === g.id).map((x) => `- ${d(x.arrival)}: at ${pl(x.placeId)} [stay \`${x.id}\`]`), ...world.journeys.filter((x) => x.subject.kind === 'group' && x.subject.id === g.id).map((x) => `- ${d(x.departure)}: ${pl(x.originId)} → ${pl(x.destinationId)} [journey \`${x.id}\`]`)].join('\n') || 'None.'}\n`,
    });
  }

  // ---- events ----
  for (const e of world.events) {
    files.push({ path: ref('events', e.name, e.id), text: `${head(e.name, e.id, 'event')}${line('Kind', e.kind)}${line('When', [d(e.start), e.end ? d(e.end) : ''].filter(Boolean).join(' to '))}${line('Every year', e.yearly ? 'yes' : '')}${line('Where', pl(e.placeId))}${line('Who', e.characterIds.map(ch))}${line('Description', e.description)}` });
  }

  // ---- realms and other regions ----
  for (const r of world.regions) {
    const layer = world.regionLayers.find((l) => l.id === r.layerId);
    const dir = `realms/${safeName(layer?.name ?? 'Layer')}`;
    files.push({
      path: ref(dir, r.name, r.id),
      text: `${head(r.name, r.id, `region on the ${layer?.name ?? '?'} layer (${layer ? LAYER_TYPES[layer.type].name : '?'})`)}${line('Layer', layer ? `${layer.name} (\`${layer.id}\`)` : '')}${line('Exists', r.start || r.end ? `${d(r.start) || '…'} – ${d(r.end) || '…'}` : '')}
## Entry

${r.entry || '_Empty._'}

## Shape over time

${r.versions.map((v) => `- ${v.start ? `from ${d(v.start)}` : 'from the beginning'}: ${v.area.length} part(s)${v.intensity !== undefined ? `, intensity ${v.intensity}%` : ''}${v.note ? `, ${v.note}` : ''}`).join('\n') || 'No shape drawn yet.'}

## Part of / vassal of

${r.overlords.map((o) => `- ${o.relation} of ${name('regions', o.regionId)}${o.start || o.end ? `, ${d(o.start) || '…'} – ${d(o.end) || '…'}` : ''}`).join('\n') || 'None.'}

## Characters tied to it

${r.ties.map((t) => `- ${t.role}: ${ch(t.characterId)}${t.start || t.end ? `, ${d(t.start) || '…'} – ${d(t.end) || '…'}` : ''}`).join('\n') || 'None.'}
`,
    });
  }
  files.push({ path: 'realms/layers.md', text: `# Region layers\n\n${world.regionLayers.map((l) => `- **${l.name}** (\`${l.id}\`): ${LAYER_TYPES[l.type].name}${l.overlaps ? ', regions may overlap' : ', regions never overlap'}; ${world.regions.filter((r) => r.layerId === l.id).length} regions`).join('\n')}\n` });

  // ---- timeline ----
  type Row = { day: number; text: string };
  const rows: Row[] = [];
  const hemi = s.hemisphereForSeasons;
  const at = (x: FuzzyDate | undefined) => (x ? toWindow(x, hemi).earliest : undefined);
  for (const x of world.stays) rows.push({ day: at(x.arrival)!, text: `${d(x.arrival)}: ${subj(x.subject)} arrives at ${pl(x.placeId)}${x.departure ? `, leaves ${d(x.departure)}` : ''}` });
  for (const x of world.journeys) rows.push({ day: at(x.departure)!, text: `${d(x.departure)}: ${subj(x.subject)} sets out ${pl(x.originId)} → ${pl(x.destinationId)}${x.arrival ? `, arrives ${d(x.arrival)}` : ''}` });
  for (const x of world.events) if (x.start) rows.push({ day: at(x.start)!, text: `${d(x.start)}: event ${x.name} (\`${x.id}\`)${x.placeId ? ` at ${pl(x.placeId)}` : ''}` });
  for (const x of world.scenes) if (x.start) rows.push({ day: at(x.start)!, text: `${d(x.start)}: scene ${x.title} (\`${x.id}\`)` });
  for (const x of world.characters) { if (x.birth) rows.push({ day: at(x.birth)!, text: `${d(x.birth)}: ${x.name} is born` }); if (x.death) rows.push({ day: at(x.death)!, text: `${d(x.death)}: ${x.name} dies` }); }
  rows.sort((a, b) => a.day - b.day);
  files.push({ path: 'timeline.md', text: `# Timeline\n\nIn in-world date order. Dates are day/month/year.\n\n${rows.map((r) => `- ${r.text}`).join('\n') || 'Nothing dated yet.'}\n` });

  // ---- story: threads, secrets, scenarios, to-dos ----
  files.push({ path: 'story/threads.md', text: `# Plot threads\n\n${world.threads.map((t) => `## ${t.name}\n\n- **id:** \`${t.id}\`\n${line('Branches off', name('threads', t.parentId))}${line('Rejoins', name('threads', t.rejoinsId))}${line('Characters', t.characterIds.map(ch))}${line('Description', t.description)}${line('Scenes', world.scenes.filter((x) => x.threadIds?.includes(t.id)).map((x) => `${x.title} (\`${x.id}\`)`))}`).join('\n') || 'None yet.'}\n` });
  files.push({ path: 'story/secrets.md', text: `# Secrets\n\n${world.secrets.map((x) => `## ${x.title}\n\n- **id:** \`${x.id}\`\n${line('About event', name('events', x.eventId))}${line('Description', x.description)}${x.knowers.map((k) => `- ${ch(k.characterId)} knows ${k.from ? `from ${d(k.from)}` : 'from the start'}${k.how ? `: ${k.how}` : ''}`).join('\n')}\n`).join('\n') || 'None yet.'}\n` });
  files.push({ path: 'story/scenarios.md', text: `# What-if scenarios\n\nEach scenario changes records only inside itself; canon is untouched until the writer keeps it.\n\n${world.scenarios.map((x) => `## ${x.name}\n\n- **id:** \`${x.id}\`\n${line('Description', x.description)}${scenarioChanges(stored, x.id).map((c) => `- ${c.kind}: ${c.collection} ${c.label} (\`${c.id}\`)`).join('\n')}\n`).join('\n') || 'None.'}\n` });
  files.push({ path: 'story/todos.md', text: `# To-dos and plot holes\n\n${world.todos.map((t) => `- [${t.done ? 'x' : ' '}] ${t.kind === 'plot-hole' ? 'Plot hole: ' : ''}${t.title} (\`${t.id}\`)${t.note ? `: ${t.note}` : ''}`).join('\n') || 'None.'}\n` });

  // ---- planning: setups and payoffs, structure, arcs (NT-6..NT-8) ----
  const read = readIndexOf(world);
  const sc = (id: Id | undefined) => name('scenes', id);
  files.push({
    path: 'story/setups.md',
    text: `# Setups and payoffs\n\nA setup with no payoff, or a payoff the reader reads before its setup, is a warning.\n\n${world.setups.map((x) => `- **${x.title}** (\`${x.id}\`, ${x.kind}): ${SETUP_STATE_LABEL[setupState(x, read)]}. Planted in ${sc(x.setupSceneId) || 'no scene yet'}; paid off in ${sc(x.payoffSceneId) || 'no scene yet'}${x.note ? `. ${x.note}` : ''}`).join('\n') || 'None yet.'}\n`,
  });
  files.push({
    path: 'story/structure.md',
    text: `# Book structure\n\nBeat sheets laid over each book. "at" is where the template puts a beat (% of the book); "falls at" is where its scene actually is, by words written (or by scenes while there is little text).\n\n${world.books.slice().sort((a, b) => a.order - b.order).map((b) => {
      const pc = pacing(world, b.id);
      return `## ${b.title} (\`${b.id}\`)\n\n${b.beats?.length ? `Structure: ${b.structureName ?? 'own'}\n\n${pc.beats.map((x) => `- **${x.beat.name}** at ${x.target}%: ${x.beat.sceneId ? `${sc(x.beat.sceneId)}, falls at ${Math.round(x.actual ?? 0)}%` : 'no scene yet'}${x.beat.note ? ` (${x.beat.note})` : ''}`).join('\n')}` : 'No structure laid over this book.'}\n`;
    }).join('\n') || 'No books yet.'}\n`,
  });
  files.push({
    path: 'story/arcs.md',
    text: `# Character arcs\n\nPer book: where each character starts and ends, and the scenes that turn them.\n\n${world.arcs.map((a) => `## ${ch(a.characterId)} in ${name('books', a.bookId)}\n\n- **id:** \`${a.id}\`\n${line('Goal', a.goalStart || a.goalEnd ? `${a.goalStart || '?'} → ${a.goalEnd || '?'}` : '')}${line('Belief', a.beliefStart || a.beliefEnd ? `${a.beliefStart || '?'} → ${a.beliefEnd || '?'}` : '')}${line('Wound', a.woundStart || a.woundEnd ? `${a.woundStart || '?'} → ${a.woundEnd || '?'}` : '')}${arcTurnsInOrder(world, a).map((t) => `- Turn in ${sc(t.sceneId)}${t.note ? `: ${t.note}` : ''}`).join('\n')}${line('Notes', a.notes)}`).join('\n\n') || 'None yet.'}\n`,
  });

  // ---- revision passes (RV-5) and style rules (RV-4) ----
  const off = world.settings.writing?.styleOff ?? [];
  files.push({
    path: 'story/revision.md',
    text: `# Revision\n\nRevision passes: one read through a book looking for one thing, ticked off chapter by chapter.\n\n${world.books.slice().sort((a, b) => a.order - b.order).map((b) => {
      const list = passesOf(world, b.id);
      const chapters = world.chapters.filter((c) => c.bookId === b.id).sort((x, y) => x.order - y.order);
      return `## ${b.title}\n\n${list.length ? list.map((p) => `### ${p.name} (\`${p.id}\`)\n\n${p.note ? `${p.note}\n\n` : ''}${chapters.map((c) => `- [${p.done.includes(c.id) ? 'x' : ' '}] ${c.title}`).join('\n')}`).join('\n\n') : 'No passes for this book.'}\n`;
    }).join('\n') || 'No books yet.'}\nStyle checks (RV-4) on the Write page: ${STYLE_RULE_IDS.filter((r) => !off.includes(r)).map((r) => STYLE_RULES[r].name.toLowerCase()).join(', ') || 'all switched off'}. Names that look misspelt (RV-2) are listed in warnings.md.\n`,
  });

  // ---- dialogue by character (RV-7) and submissions (RV-9) ----
  const lines = dialogueLines(world);
  files.push({
    path: 'story/dialogue.md',
    text: `# Dialogue by character\n\nLines the writer has tagged with a speaker on the Write page, in reading order. Untagged speech is not listed.\n\n${dialogueCounts(lines).map((c) => `## ${ch(c.characterId)}\n\n${c.lines} lines, ${c.words} words, in ${c.scenes} scenes.\n\n${lines.filter((l) => l.characterId === c.characterId).map((l) => `- ${l.text} (${name('scenes', l.sceneId)})`).join('\n')}`).join('\n\n') || 'No tagged lines yet.'}\n`,
  });
  const lbl = <T extends { id: string; label: string }>(xs: T[], id: string) => xs.find((x) => x.id === id)?.label ?? id;
  files.push({
    path: 'story/submissions.md',
    text: `# Submissions\n\nWhere each book was sent and the answer (real-world dates, newest first).\n\n${world.books.slice().sort((a, b) => a.order - b.order).filter((b) => world.submissions.some((x) => x.bookId === b.id)).map((b) => {
      const list = sortedSubmissions(world, b.id);
      const sum = submissionSummary(list);
      return `## ${b.title}\n\n${sum.sent} sent, ${sum.open} open, ${sum.offers} offers, ${sum.rejections} rejections.\n\n${list.map((x) => `- ${x.sentOn}: ${lbl(SUBMISSION_SENT, x.sent).toLowerCase()} to **${x.to}** (${lbl(SUBMISSION_KINDS, x.kind).toLowerCase()}): ${lbl(SUBMISSION_ANSWERS, x.answer).toLowerCase()}${x.answeredOn ? ` on ${x.answeredOn}` : ''}${x.notes ? `. ${x.notes}` : ''} (\`${x.id}\`)`).join('\n')}`;
    }).join('\n\n') || 'Nothing sent yet.'}\n`,
  });

  // ---- notebook and research files (NT-2, NT-4) ----
  const refText = (r: { kind: string; id: Id }) => `${r.kind} ${name(REF_KIND_COLLECTION[r.kind] ?? '', r.id)}`;
  const noteFile = namer();
  for (const n of world.notes) {
    const dir = ['notes', ...(n.inbox ? ['Inbox'] : cleanFolder(n.folder).split("/").filter(Boolean).map((p) => safeName(p)))].join('/');
    const files2 = world.attachments.filter((a) => a.refs.some((r) => r.kind === 'note' && r.id === n.id));
    files.push({
      path: noteFile(dir, n.title || 'Untitled note', n.id),
      text: `${head(n.title || 'Untitled note', n.id, 'note')}${line('Folder', n.inbox ? 'Inbox (not sorted yet)' : n.folder || 'top of the notebook')}${line('About', n.refs.map(refText))}${line('Files', files2.map((a) => `${a.name} (\`${a.id}\`)`))}${line('Last changed', n.updatedAt.slice(0, 10))}\n${n.body || '_Empty._'}\n`,
    });
  }
  files.push({
    path: 'research/files.md',
    text: `# Research files\n\nImages and PDFs the writer keeps with the world. Copies of the files themselves are in \`research/files/\` when the desktop app wrote them.\n\n${world.attachments.map((a) => `- **${a.name}** (\`${a.id}\`, ${a.mime}, ${Math.round(a.size / 1024)} KB)${a.caption ? `: ${a.caption}` : ''}${a.refs.length ? `. Attached to ${a.refs.map(refText).join(', ')}` : ''}. File: \`${researchFilePath(a)}\``).join('\n') || 'None.'}\n`,
  });
  const comments = allComments(world);
  files.push({
    path: 'story/comments.md',
    text: `# Margin comments\n\nComments on passages of the scene text (NT-1), in reading order of their scenes.\n\n${comments.map((c) => `- ${name('scenes', c.sceneId)}${c.comment.resolved ? ' (resolved)' : ''}: **${c.comment.author || 'Comment'}**: ${c.comment.text}${c.quote ? ` — on “${c.quote}”` : ''}${c.todo ? ` [to-do \`${c.todo.id}\`${c.todo.done ? ', done' : ''}]` : ''}`).join('\n') || 'None.'}\n`,
  });

  // ---- map ----
  const R = s.radiusKm;
  files.push({
    path: 'map.md',
    text: `# Map\n\nThe painted map (land, heights, terrain types) is in the app; the \`realm_at\` and \`travel_time\` tools use it. Map features:\n\n${world.mapFeatures.map((f) => `- **${f.name || 'Unnamed'}** (\`${f.id}\`): ${f.kind}${f.shape === 'line' ? `, ${Math.round(polylineKm(f.points, R))} km` : ''}, ${f.points.length} points${f.joinsId ? `, flows into ${name('mapFeatures', f.joinsId)}` : ''}${f.start || f.end ? `, exists ${d(f.start) || '…'} – ${d(f.end) || '…'}` : ''}${f.placeId ? `, place \`${f.placeId}\`` : ''}`).join('\n') || 'No features drawn yet.'}\n\n## Detail maps\n\n${world.detailMaps.map((m) => `- ${m.name} (\`${m.id}\`): ${m.kind}, N ${m.north} S ${m.south} W ${m.west} E ${m.east}`).join('\n') || 'None.'}\n`,
  });

  // ---- warnings ----
  const open = warnings.filter((w) => !w.dismissed);
  files.push({ path: 'warnings.md', text: `# Warnings\n\nWhat the app's checks flag now (${open.length} open, ${warnings.length - open.length} marked intentional).\n\n${open.map((w) => `- **${w.rule}** (${w.severity}): ${w.message}`).join('\n') || 'Nothing.'}\n${warnings.some((w) => w.dismissed) ? `\n## Marked intentional\n\n${warnings.filter((w) => w.dismissed).map((w) => `- ${w.message} (note: ${w.dismissed!.note})`).join('\n')}\n` : ''}` });

  // ---- whole world as JSON ----
  files.push({ path: 'data/world.json', text: JSON.stringify(worldForJson(world), null, 1) });
  return files;
}

/** NT-4: where a research file's copy goes in the Claude folder. */
export function researchFilePath(a: { id: Id; name: string }): string {
  const dot = a.name.lastIndexOf('.');
  const stem = dot > 0 ? a.name.slice(0, dot) : a.name;
  const ext = dot > 0 ? a.name.slice(dot).replace(/[^.\w]/g, '') : '';
  return `research/files/${safeName(stem)} (${a.id.slice(0, 6)})${ext}`;
}

/** The world without the painted map, pictures and scene version history (too big, and not text). */
export function worldForJson(world: World): Record<string, unknown> {
  const noPics = <T extends { images?: unknown; portrait?: unknown }>(r: T) => (r.images || r.portrait ? { ...r, images: undefined, portrait: undefined } : r);
  return {
    ...world,
    terrain: undefined, sceneVersions: undefined, writingDays: undefined, suggestions: undefined, claudeLog: undefined,
    mapImages: world.mapImages.map((m) => ({ ...m, dataUrl: undefined })),
    characters: world.characters.map(noPics), places: world.places.map(noPics), events: world.events.map(noPics), regions: world.regions.map(noPics),
    manuscripts: world.manuscripts.map((m) => ({ ...m, paragraphs: undefined })),
    settings: { ...world.settings, claude: undefined, backupFolder: undefined },
  };
}

/** A character's stays and journeys (their own and their groups'), in date order, one line each. */
export function whereaboutsLines(world: World, ix: WorldIndex, characterId: Id): string[] {
  const d = (x: FuzzyDate | undefined) => dateText(world, x);
  const name = (c: 'places' | 'groups', id: Id) => `${(world[c] as { id: Id; name: string }[]).find((x) => x.id === id)?.name ?? '?'} (\`${id}\`)`;
  const pl = (id: Id) => name('places', id);
  return ix.segmentsFor(characterId).slice().sort((a, b) => a.start.earliest - b.start.earliest).map((g) => {
    const via = g.viaGroupId ? ` (with ${name('groups', g.viaGroupId)})` : '';
    if (g.kind === 'stay') {
      const st = world.stays.find((x) => x.id === g.recordId)!;
      return `- ${d(st.arrival)} → ${st.departure ? d(st.departure) : st.durationDays !== undefined ? `${st.durationDays} days` : g.end.latest === OPEN_END ? 'until further notice' : '?'}: at ${pl(st.placeId)}${st.purpose ? `, ${st.purpose}` : ''}${via} [stay \`${st.id}\`]`;
    }
    const j = world.journeys.find((x) => x.id === g.recordId)!;
    return `- ${d(j.departure)} → ${j.arrival ? d(j.arrival) : `about ${Math.round(ix.suggestedTravelDays(j) ?? 0)} days (suggested)`}: travels ${pl(j.originId)} → ${pl(j.destinationId)} by ${j.modeId}${j.purpose ? `, ${j.purpose}` : ''}${via} [journey \`${j.id}\`]`;
  });
}
