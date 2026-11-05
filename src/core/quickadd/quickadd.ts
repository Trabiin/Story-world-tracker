/**
 * EU-1: quick-add sentences, parsed offline with fixed patterns, names and aliases.
 * "Kaela rides to Thornwick, leaves 3 May" → a journey form to confirm.
 * "The Party stays at Varn Keep from 3 May until 10 May" → a stay form to confirm.
 */
import { FuzzyDate, parseFuzzyDate } from '../dates';
import type { Id, World } from '../model';

export interface QuickAddResult {
  kind: 'journey' | 'stay';
  subject?: { kind: 'character' | 'group'; id: Id };
  originId?: Id;
  destinationId?: Id;
  placeId?: Id;
  departure?: FuzzyDate;
  arrival?: FuzzyDate;
  durationDays?: number;
  modeId?: string;
  /** Parts of the sentence that were not understood, shown to the user. */
  notes: string[];
}

const MODE_VERBS: [RegExp, string][] = [
  [/\b(rides?|rode|riding|gallops?)\b/, 'horse'],
  [/\b(walks?|walked|walking|marches|marched|hikes?|hiked|treks?)\b/, 'foot'],
  [/\b(sails?|sailed|sailing|rows?|rowed)\b/, 'ship'],
  [/\b(flies|flew|flying|fly)\b/, 'flying'],
  [/\b(drives?|drove|carts?)\b/, 'cart'],
  [/\b(teleports?|teleported|portals?)\b/, 'magic'],
];
const JOURNEY_WORDS = /\b(travels?|travelled|traveled|goes|went|heads?|headed|journeys?|sets out|leaves for|returns?|returned|flees|fled|moves?|moved)\b/;
const STAY_WORDS = /\b(stays?|stayed|remains?|remained|waits?|waited|lives?|lived|is|was|rests?|rested|hides?|hid)\b/;

interface Named { id: Id; names: string[]; kind?: 'character' | 'group' }

/** Earliest (then longest) name or alias found in text, case-insensitive, on word boundaries. */
function findName(text: string, items: Named[], at?: 'start'): { item: Named; index: number; length: number } | null {
  const lower = text.toLowerCase();
  let best: { item: Named; index: number; length: number } | null = null;
  for (const item of items) {
    for (const n of item.names) {
      const name = n.toLowerCase().trim();
      if (!name) continue;
      let from = 0;
      for (;;) {
        const k = lower.indexOf(name, from);
        if (k < 0) break;
        const before = k === 0 || !/[\p{L}\p{N}]/u.test(lower[k - 1]);
        const after = k + name.length >= lower.length || !/[\p{L}\p{N}]/u.test(lower[k + name.length]);
        if (before && after && (!at || k === 0) && (!best || k < best.index || (k === best.index && name.length > best.length))) best = { item, index: k, length: name.length };
        from = k + 1;
      }
    }
  }
  return best;
}

function placeAfter(text: string, words: RegExp, places: Named[]): Id | undefined {
  const m = text.match(words);
  if (!m || m.index === undefined) return undefined;
  const rest = text.slice(m.index + m[0].length);
  const f = findName(rest, places);
  return f && f.index <= 4 ? f.item.id : undefined;
}

/** Parse a date phrase; a missing year is taken from the current moment's year. */
function dateAfter(text: string, words: RegExp, defaultYear: number): FuzzyDate | undefined {
  const m = text.match(new RegExp(words.source + String.raw`\s+(?:on\s+|in\s+)?([^,;]+?)(?=\s+(?:and|then|until|till|to|from|for|arrives?|arriving|leaves?|leaving|departs?|departing)\b|[,;.]|$)`, 'i'));
  if (!m) return undefined;
  const phrase = m[m.length - 1].trim();
  return parseFuzzyDate(phrase) ?? parseFuzzyDate(`${phrase} ${defaultYear}`) ?? undefined;
}

export function parseQuickAdd(input: string, world: World, defaultYear: number): QuickAddResult {
  const text = input.trim();
  const notes: string[] = [];
  const subjects: Named[] = [
    ...world.characters.filter((c) => !c.archived).map((c) => ({ id: c.id, names: [c.name, ...c.aliases, c.name.split(' ')[0]], kind: 'character' as const })),
    ...world.groups.map((g) => ({ id: g.id, names: [g.name, g.name.replace(/^the\s+/i, '')], kind: 'group' as const })),
  ];
  const places: Named[] = world.places.map((p) => ({ id: p.id, names: [p.name, ...p.aliases] }));

  const subj = findName(text, subjects, 'start') ?? findName(text, subjects);
  const subject = subj ? { kind: subj.item.kind!, id: subj.item.id } : undefined;
  if (!subject) notes.push('No character or group name found.');
  const rest = subj ? text.slice(0, subj.index) + ' ' + text.slice(subj.index + subj.length) : text;
  const lower = rest.toLowerCase();

  let modeId: string | undefined;
  for (const [re, id] of MODE_VERBS) if (re.test(lower) && world.settings.travelModes.some((m) => m.id === id)) { modeId = id; break; }
  const destinationId = placeAfter(rest, /\b(to|towards|for|into)\b/i, places);
  const isJourney = !!modeId || JOURNEY_WORDS.test(lower) || (!!destinationId && !STAY_WORDS.test(lower));

  if (isJourney) {
    const originId = placeAfter(rest, /\bfrom\b/i, places);
    const departure = dateAfter(rest, /\b(?:leaves?|leaving|left|departs?|departing|departed|sets out|setting out|starts?|on)\b/, defaultYear);
    const arrival = dateAfter(rest, /\b(?:arrives?|arriving|arrived|reaches|reached|by)\b/, defaultYear);
    if (!destinationId) notes.push('No destination place found (write "to <place>").');
    if (!departure) notes.push('No departure date found (write "leaves 3 May").');
    return { kind: 'journey', subject, originId, destinationId, departure, arrival, modeId, notes };
  }

  const placeId = placeAfter(rest, /\b(at|in|inside)\b/i, places) ?? findName(rest, places)?.item.id;
  const arrival = dateAfter(rest, /\b(?:from|since|on|arrives?|arriving|starting)\b/, defaultYear);
  const departure = dateAfter(rest, /\b(?:until|till|to|leaves?|leaving)\b/, defaultYear);
  let durationDays: number | undefined;
  const dur = lower.match(/\bfor\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month|year)s?\b/);
  if (dur) {
    const nums: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const n = /^\d+$/.test(dur[1]) ? Number(dur[1]) : nums[dur[1]];
    durationDays = n * { day: 1, week: 7, month: 30, year: 365 }[dur[2] as 'day']!;
  }
  if (!placeId) notes.push('No place found (write "at <place>").');
  if (!arrival) notes.push('No arrival date found (write "from 3 May").');
  return { kind: 'stay', subject, placeId, arrival, departure, durationDays, notes };
}
