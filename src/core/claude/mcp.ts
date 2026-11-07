/**
 * AI-2: the live world tools. The app is an MCP server for Claude Code (Streamable HTTP on this
 * computer, see src-tauri/src/claude.rs); every request arrives here as JSON-RPC and is answered
 * from the open world with the app's own rules: whereabouts, realms, the reader's view, travel
 * times, warnings. Proposals (AI-3) go through checkProposal and the env's propose().
 */
import { formatFuzzy, fromDay, midpoint, parseFuzzyDate, toWindow } from '../dates';
import { routeThrough } from '../features';
import { LayerIndex, describeChain } from '../layers';
import { CANON, Id, Journey, LinkTargetKind, World } from '../model';
import { readingOrder } from '../story';
import { scenarioView } from '../structure';
import { DATA_COLLECTIONS, dependants, globalSearch, recordLabel } from '../tools';
import { describeFactor } from '../travel';
import type { Warning } from '../warnings';
import { WorldIndex } from '../whereabouts';
import { nameCard, readerKnowledge, readerPointBefore, sceneContext, textOf, whereText } from '../writing';
import type { ApplyOptions } from './apply';
import { dateText, whereaboutsLines } from './folder';
import { CHANGE_FORMAT, MCP_SERVER_NAME, dataModelGuide } from './guide';
import { CLAUDE_COLLECTIONS, READ_ONLY_COLLECTIONS } from './schema';
import { checkProposal, type ProposalCheck, type ProposalInput } from './suggestions';
import { docToMarkdown } from './text';

export const MCP_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpEnv {
  /** The stored world (all scenarios). */
  world: World;
  /** Warnings for a scenario's view of the world (the app's checkWorld, cached). */
  warnings(scenarioId: Id): Warning[];
  /** AI-3 / AI-9: keep a checked proposal as a suggestion, or apply it when direct editing is on. Returns the text for Claude. */
  propose(p: ProposalInput, check: ProposalCheck): string;
  directEdit: boolean;
  opts: ApplyOptions;
  appVersion: string;
}

interface Tool { name: string; description: string; inputSchema: Record<string, unknown>; run: (args: Record<string, unknown>, env: McpEnv) => string }

const str = (desc: string) => ({ type: 'string', description: desc });
const num = (desc: string) => ({ type: 'number', description: desc });
const SCENARIO = str('Optional: read a what-if scenario\'s version of the world (id from story/scenarios.md). Default: canon.');
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required, additionalProperties: false });

class ToolError extends Error {}
const fail = (m: string): never => { throw new ToolError(m); };

const viewOf = (env: McpEnv, a: Record<string, unknown>) => {
  const sid = typeof a.scenarioId === 'string' && a.scenarioId ? a.scenarioId : CANON;
  if (sid !== CANON && !env.world.scenarios.some((s) => s.id === sid)) fail(`There is no scenario with id ${sid}.`);
  return { world: scenarioView(env.world, sid), sid };
};
const dayOf = (w: World, v: unknown, what = 'date'): number => {
  if (typeof v !== 'string') return fail(`${what} is required, as day/month/year text ("3/5/1042", "May 1042").`);
  const d = parseFuzzyDate(v);
  if (!d) return fail(`"${v}" is not a date the app understands. Dates are day/month/year: "3/5/1042", "3 May 1042", "May 1042", "spring 1042".`);
  return Math.round(midpoint(toWindow(d, w.settings.hemisphereForSeasons)));
};
const findAny = (w: World, id: string, only?: string): { c: string; r: Record<string, unknown> } | undefined => {
  const cols = only ? [only] : [...DATA_COLLECTIONS, 'mapLayers', 'scenarios'];
  for (const c of cols) {
    const r = ((w as unknown as Record<string, Record<string, unknown>[]>)[c] ?? []).find((x) => x.id === id);
    if (r) return { c, r };
  }
  return undefined;
};
const json = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'images' || k === 'portrait' || k === 'dataUrl' ? undefined : x), 1);

const TOOLS: Tool[] = [
  {
    name: 'search', description: 'Search the whole world (names, aliases, notes, descriptions, scene text) like the app\'s search. Returns ids to use with get_record.',
    inputSchema: obj({ query: str('Words to find.'), limit: num('Most results (default 30).'), scenarioId: SCENARIO }, ['query']),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const hits = globalSearch(world, String(a.query ?? ''), Math.min(200, Number(a.limit) || 30));
      return hits.length ? hits.map((h) => `- ${h.kind} **${h.title}** (\`${h.id}\`)${h.sub ? `: ${h.sub}` : ''}${h.snippet ? `\n  “${h.snippet}”` : ''}`).join('\n') : 'Nothing found.';
    },
  },
  {
    name: 'get_record', description: 'One record by id, exactly as stored (all fields), with its readable label and every record that refers to it. Scene text records come back as Markdown.',
    inputSchema: obj({ id: str('The record id.'), collection: str('Optional: the collection, if known.'), scenarioId: SCENARIO }, ['id']),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const id = String(a.id ?? '');
      const hit = findAny(world, id, typeof a.collection === 'string' ? a.collection : undefined) ?? fail(`No record with id ${id}.`);
      const deps = dependants(world, id);
      const body = hit.c === 'sceneTexts' ? { ...hit.r, doc: undefined, markdown: docToMarkdown((hit.r as { doc: never }).doc) } : hit.r;
      return `${hit.c}: ${recordLabel(world, hit.c, hit.r)}\n\n${json(body)}\n\nReferred to by ${deps.length} record(s)${deps.length ? ':\n' + deps.slice(0, 100).map((x) => `- ${x.collection} ${x.label} (\`${x.id}\`)`).join('\n') : '.'}`;
    },
  },
  {
    name: 'list_records', description: `List the records of one collection (id and label), optionally filtered by words in the label. Collections: ${[...CLAUDE_COLLECTIONS, ...READ_ONLY_COLLECTIONS].join(', ')}.`,
    inputSchema: obj({ collection: str('Collection name.'), query: str('Optional filter on the label.'), offset: num('Skip this many (default 0).'), limit: num('Most results (default 100).'), scenarioId: SCENARIO }, ['collection']),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const c = String(a.collection ?? '');
      const all = (world as unknown as Record<string, Record<string, unknown>[]>)[c];
      if (!Array.isArray(all) || c === 'settings' || c === 'terrain') fail(`"${c}" is not a collection. Collections: ${[...CLAUDE_COLLECTIONS, ...READ_ONLY_COLLECTIONS].join(', ')}.`);
      const q = String(a.query ?? '').toLowerCase();
      const rows = all.map((r) => ({ id: String(r.id ?? r.key), label: recordLabel(world, c, r) })).filter((r) => !q || r.label.toLowerCase().includes(q));
      const off = Math.max(0, Number(a.offset) || 0), lim = Math.min(500, Number(a.limit) || 100);
      return `${rows.length} ${c}${q ? ` matching "${q}"` : ''}${rows.length > off + lim ? `, showing ${off + 1}–${off + lim}` : ''}:\n${rows.slice(off, off + lim).map((r) => `- ${r.label} (\`${r.id}\`)`).join('\n')}`;
    },
  },
  {
    name: 'where_is', description: 'Where everyone is on a date (or one character), worked out by the app from stays, journeys and group membership. Also says who is not born yet, dead, missing or unaccounted for.',
    inputSchema: obj({ date: str('In-world date, day/month/year ("3/5/1042").'), characterId: str('Optional: only this character.'), scenarioId: SCENARIO }, ['date']),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const day = dayOf(world, a.date);
      const ix = new WorldIndex(world);
      const who = typeof a.characterId === 'string' ? [ix.characters.get(a.characterId) ?? fail(`No character with id ${a.characterId}.`)] : world.characters.filter((c) => !c.archived);
      return `On ${formatFuzzy(fromDay(day))}:\n${who.map((c) => `- ${c.name} (\`${c.id}\`): ${whereText(ix, c.id, day).text}`).join('\n')}`;
    },
  },
  {
    name: 'character_timeline', description: 'A character\'s whereabouts over time: every stay and journey (their own and their groups\'), in order, with ids.',
    inputSchema: obj({ characterId: str('The character id.'), scenarioId: SCENARIO }, ['characterId']),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const ix = new WorldIndex(world);
      const c = ix.characters.get(String(a.characterId)) ?? fail(`No character with id ${String(a.characterId)}.`);
      const lines = whereaboutsLines(world, ix, c.id);
      return `${c.name}${c.birth ? `, born ${dateText(world, c.birth)}` : ''}${c.death ? `, died ${dateText(world, c.death)}` : ''}\n${lines.join('\n') || 'No stays or journeys yet.'}`;
    },
  },
  {
    name: 'scene', description: 'A scene\'s text (Markdown) and its context on its date: place, season, moon, who is present and where the rest of the cast is, and the warnings that touch it.',
    inputSchema: obj({ sceneId: str('The scene id.'), scenarioId: SCENARIO }, ['sceneId']),
    run: (a, env) => {
      const { world, sid } = viewOf(env, a);
      const id = String(a.sceneId);
      const ix = new WorldIndex(world);
      const ctx = sceneContext(ix, id, env.warnings(sid)) ?? fail(`No scene with id ${id}.`);
      const place = ctx.placeId ? ix.places.get(ctx.placeId)?.name : undefined;
      const t = textOf(world, id);
      return [
        `# ${ctx.scene.title} (\`${id}\`)`,
        ctx.dateLabel ? `- When: ${ctx.dateLabel}${ctx.season ? `, ${ctx.season}` : ''}${ctx.moon ? `, ${ctx.moon.label}` : ''}` : '- No date yet.',
        place ? `- Where: ${place} (\`${ctx.placeId}\`)${ctx.placeDerived ? ', from the POV character\'s stay' : ''}` : '',
        ctx.present.length ? `- Present: ${ctx.present.map((p) => `${ix.characters.get(p.id)?.name ?? '?'}${p.pov ? ' (POV)' : ''}${p.elsewhere ? ` (but the app has them ${p.where})` : ''}`).join(', ')}` : '',
        ctx.elsewhere.length ? `- Elsewhere: ${ctx.elsewhere.map((e) => `${e.label}: ${e.characterIds.map((x) => ix.characters.get(x)?.name ?? '?').join(', ')}`).join('; ')}` : '',
        ctx.warnings.length ? `- Warnings: ${ctx.warnings.map((w) => w.message).join(' | ')}` : '',
        `- Words: ${t?.words ?? 0}`, '', '---', '', t ? docToMarkdown(t.doc) : '_No text yet._',
      ].filter((x) => x !== '').join('\n');
    },
  },
  {
    name: 'warnings', description: 'What the app\'s checks flag now: two places at once, gaps, impossible travel, rivers flowing uphill, a character acting on a secret before learning it, and the rest.',
    inputSchema: obj({ characterId: str('Optional: only warnings about this character.'), rule: str('Optional: only this rule id.'), includeIntentional: { type: 'boolean', description: 'Also list warnings marked intentional.' }, scenarioId: SCENARIO }),
    run: (a, env) => {
      const { sid } = viewOf(env, a);
      const ws = env.warnings(sid).filter((w) => (a.includeIntentional || !w.dismissed) && (!a.characterId || w.characterId === a.characterId || w.refs.some((r) => r.id === a.characterId)) && (!a.rule || w.rule === a.rule));
      return ws.length ? ws.map((w) => `- **${w.rule}** (${w.severity}${w.dismissed ? `, intentional: ${w.dismissed.note}` : ''}): ${w.message}${w.refs.length ? ` [${w.refs.map((r) => `${r.kind} \`${r.id}\``).join(', ')}]` : ''}`).join('\n') : 'No warnings.';
    },
  },
  {
    name: 'reader_knows', description: 'What the reader knows at the end of a chapter (or just before a scene): which characters, places, groups and events they have met, and, with "about", what they know of one record. "Known" in this world means known to the reader.',
    inputSchema: obj({ chapterId: str('End of this chapter.'), sceneId: str('Or: just before this scene\'s chapter.'), about: str('Optional: a character, place, group, event or region id.'), scenarioId: SCENARIO }),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const order = readingOrder(world);
      let point: number;
      if (typeof a.chapterId === 'string') point = order.find((p) => p.chapter.id === a.chapterId)?.index ?? fail(`No chapter with id ${a.chapterId}.`);
      else if (typeof a.sceneId === 'string') point = readerPointBefore(world, a.sceneId);
      else return fail('Give chapterId or sceneId.');
      const rk = readerKnowledge(world, point);
      const label = point < 0 ? 'before the story starts' : `after ${order[point].label}`;
      if (typeof a.about === 'string') {
        const hit = findAny(world, a.about) ?? fail(`No record with id ${a.about}.`);
        const kind = ({ characters: 'character', places: 'place', groups: 'group', events: 'event', regions: 'region' } as Record<string, LinkTargetKind>)[hit.c] ?? fail('about must be a character, place, group, event or region.');
        const card = nameCard(new WorldIndex(world), kind, a.about, undefined, rk);
        return `The reader ${label}, about ${recordLabel(world, hit.c, hit.r)}:\n${(card?.reader ?? []).map((x) => `- ${x}`).join('\n')}`;
      }
      const v = rk.view;
      if (!v) return `Nothing is known ${label}.`;
      const names = (l: { name: string; id: Id }[]) => l.map((x) => `${x.name} (\`${x.id}\`)`).join(', ') || 'none';
      return `The reader ${label} knows:\n- Characters: ${names(v.characters)}\n- Places: ${names(v.places)}\n- Groups: ${names(v.groups)}\n- Events: ${names(v.events)}\n- Secrets the reader has seen someone learn: ${v.secrets.map((s) => s.title).join(', ') || 'none'}`;
    },
  },
  {
    name: 'travel_time', description: 'Distance and travel time between two places by a travel mode, as the app suggests arrival dates (detour factor, or along drawn roads and sea lanes, plus terrain, season and danger when those are on).',
    inputSchema: obj({ fromPlaceId: str('From.'), toPlaceId: str('To.'), modeId: str('Travel mode id (default foot).'), departure: str('Optional departure date (day/month/year), for seasons and roads that exist then.'), followRoads: { type: 'boolean', description: 'Route along drawn roads, rivers and sea lanes.' }, scenarioId: SCENARIO }, ['fromPlaceId', 'toPlaceId']),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const ix = new WorldIndex(world);
      const from = ix.places.get(String(a.fromPlaceId)) ?? fail(`No place with id ${String(a.fromPlaceId)}.`);
      const to = ix.places.get(String(a.toPlaceId)) ?? fail(`No place with id ${String(a.toPlaceId)}.`);
      const modeId = typeof a.modeId === 'string' ? a.modeId : 'foot';
      const mode = world.settings.travelModes.find((m) => m.id === modeId) ?? fail(`No travel mode "${modeId}". Modes: ${world.settings.travelModes.map((m) => m.id).join(', ')}.`);
      const day = a.departure ? dayOf(world, a.departure, 'departure') : 0;
      const dep = a.departure ? parseFuzzyDate(String(a.departure))! : { year: 1, precision: 'year' as const };
      const j: Journey = { id: 'travel-time', scenarioId: CANON, status: 'canon', createdAt: '', updatedAt: '', subject: { kind: 'character', id: '' }, originId: from.id, destinationId: to.id, waypointIds: [], departure: dep, modeId, purpose: '', notes: '' };
      const a1 = ix.locationOf(from.id), b1 = ix.locationOf(to.id);
      if (!a1 || !b1) return `${!a1 ? from.name : to.name} is not on the map, so the distance is unknown.`;
      if (a.followRoads) j.route = routeThrough(world, [a1, b1], modeId, day, (d) => ix.win(d)).points;
      const km = ix.journeyDistanceKm(j) ?? 0;
      const days = ix.suggestedTravelDays(j) ?? 0;
      const factor = ix.travelFactorOf(j);
      return `${from.name} → ${to.name} by ${mode.name} (${mode.speedKmPerDay} km/day): about ${Math.round(km)} km${a.followRoads ? ' along the drawn routes' : ` (straight line × detour ${ix.detourOf(j)})`}, about ${days < 1 ? `${Math.round(days * 24)} hours` : `${Math.round(days * 10) / 10} days`}.${factor.factor !== 1 ? ` ${describeFactor(factor)}` : ''}`;
    },
  },
  {
    name: 'realm_at', description: 'Which realm (and overlords) a place or point belongs to on a date, and every other region covering it (cultures, religions, languages…). Realms change over time with borders.',
    inputSchema: obj({ placeId: str('A place id.'), lat: num('Or a latitude…'), lng: num('…and longitude.'), date: str('In-world date (day/month/year).'), scenarioId: SCENARIO }, ['date']),
    run: (a, env) => {
      const { world } = viewOf(env, a);
      const ix = new WorldIndex(world);
      const lix = new LayerIndex(world);
      const day = dayOf(world, a.date);
      const at = typeof a.placeId === 'string' ? ix.locationOf(a.placeId) ?? fail('That place is not on the map.') : typeof a.lat === 'number' && typeof a.lng === 'number' ? { lat: a.lat, lng: a.lng } : fail('Give placeId, or lat and lng.');
      const realm = lix.realmAt(at, day);
      const all = lix.regionsAt(at, day).map((x) => `- ${x.layer.name}: ${x.hits.map((h) => `${h.region.name} (\`${h.region.id}\`)${h.intensity < 100 ? ` ${h.intensity}%` : ''}`).join(', ')}`);
      return `Realm: ${realm.length ? describeChain(realm) : 'none'}\n${all.join('\n')}`;
    },
  },
  {
    name: 'data_model', description: 'The app\'s data model: every record type and field, what refers to what, what a record cannot live without, date rules and the warnings. Read it before proposing changes. Give a collection for just that one.',
    inputSchema: obj({ collection: str('Optional: one collection.') }),
    run: (a) => (typeof a.collection === 'string' && a.collection ? dataModelGuide(a.collection) : `${dataModelGuide()}\n\n## Proposal format\n\n${CHANGE_FORMAT}`),
  },
  {
    name: 'check_changes', description: 'Try a proposal without sending it: runs every check (fields, references, safe delete, borders) and lists the warnings it would cause. Same input as propose_changes.',
    inputSchema: proposalSchema(),
    run: (a, env) => {
      const c = checkProposal(env.world, a as unknown as ProposalInput, env.opts);
      if (c.errors.length) return fail(`Refused:\n${c.errors.map((e) => `- ${e}`).join('\n')}`);
      return `Fits. ${c.newWarnings.length ? `It would cause ${c.newWarnings.length} new warning(s):\n${c.newWarnings.map((w) => `- ${w}`).join('\n')}` : 'No new warnings.'}${c.notes.length ? `\nNotes:\n${c.notes.map((n) => `- ${n}`).join('\n')}` : ''}`;
    },
  },
  {
    name: 'propose_changes', description: 'Propose changes to anything in the world: records (characters, places, stays, journeys, scenes, realms, map features…), scene text, terrain and borders. They are checked first; then they wait in the app\'s Suggestions list for the writer to accept or reject (or, if the writer switched on direct editing, they are applied and logged). See data_model for the format.',
    inputSchema: proposalSchema(),
    run: (a, env) => {
      const p = a as unknown as ProposalInput;
      const c = checkProposal(env.world, p, env.opts);
      if (c.errors.length) return fail(`Refused (nothing was changed or sent):\n${c.errors.map((e) => `- ${e}`).join('\n')}`);
      return env.propose(p, c);
    },
  },
  {
    name: 'suggestions', description: 'Your earlier proposals and what happened to them (open, accepted, rejected with the writer\'s note), and what you changed directly.',
    inputSchema: obj({ state: { type: 'string', enum: ['open', 'accepted', 'rejected'], description: 'Optional filter.' } }),
    run: (a, env) => {
      const list = env.world.suggestions.filter((s) => !a.state || s.state === a.state).slice(-50);
      const direct = env.world.claudeLog.filter((e) => e.kind === 'direct').slice(-20);
      return `${list.map((s) => `- #${s.number} ${s.title}: ${s.state}${s.acceptedChanges?.length ? ` (${s.acceptedChanges.length} of ${s.changes.length} changes accepted so far)` : ''}${s.note ? `, note: ${s.note}` : ''}`).join('\n') || 'No suggestions.'}${direct.length ? `\n\nApplied directly:\n${direct.map((e) => `- ${e.title}${e.undone ? ' (undone by the writer)' : ''}`).join('\n')}` : ''}`;
    },
  },
];

function proposalSchema() {
  return obj({
    title: str('A short title for the Suggestions list.'),
    reason: str('Why: shown to the writer with the proposal.'),
    changes: { type: 'array', description: 'The changes, applied in order. Ops: create, update, delete, text, terrain, border (see data_model).', items: { type: 'object' } },
    scenarioId: str('Optional: make the changes inside this existing what-if scenario.'),
    asScenario: { type: 'object', description: 'AI-7: keep the whole proposal as a new what-if scenario.', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
  }, ['title', 'changes']);
}

const INSTRUCTIONS = (env: McpEnv) => `Live tools for the story world "${env.world.settings.name}" in Story World Tracker. Read CLAUDE.md in the Claude folder first. Dates are day/month/year. ${env.directEdit ? 'Direct editing is on: propose_changes applies changes at once (logged and undoable).' : 'You cannot change the world directly: propose_changes sends a proposal to the writer\'s Suggestions list.'}`;

type RpcId = string | number | null;
interface RpcRequest { jsonrpc?: string; id?: RpcId; method?: string; params?: Record<string, unknown> }

function one(req: RpcRequest, env: McpEnv): object | undefined {
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: req.id ?? null, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: req.id ?? null, error: { code, message } });
  if (!req || typeof req !== 'object' || typeof req.method !== 'string') return err(-32600, 'Invalid request');
  const isNote = req.id === undefined;
  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      return ok({ protocolVersion: MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: MCP_SERVER_NAME, title: 'Story World Tracker', version: env.appVersion }, instructions: INSTRUCTIONS(env) });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(-32602, `Unknown tool: ${name}`);
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return ok({ content: [{ type: 'text', text: tool.run(args, env) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: e instanceof ToolError ? e.message : `The app could not answer: ${String(e)}` }], isError: true });
      }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default:
      if (isNote) return undefined; // notifications/initialized, notifications/cancelled…
      return err(-32601, `Method not found: ${req.method}`);
  }
}

/** Answer one HTTP body of JSON-RPC (a request, a notification or a batch). '' = nothing to send back (HTTP 202). */
export function handleMcp(body: string, env: McpEnv): string {
  let msg: unknown;
  try { msg = JSON.parse(body); } catch { return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (Array.isArray(msg)) {
    const out = msg.map((m) => one(m as RpcRequest, env)).filter(Boolean);
    return out.length ? JSON.stringify(out) : '';
  }
  const r = one(msg as RpcRequest, env);
  return r ? JSON.stringify(r) : '';
}

export const TOOL_NAMES = TOOLS.map((t) => t.name);
