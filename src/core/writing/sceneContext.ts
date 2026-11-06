/**
 * WR-9: what the story sidebar shows beside the page for one scene: its date, place, season and
 * moon, who is present and where each one is staying, where the rest of the cast is, and the
 * warnings that concern the scene. Pure: worked out from the world and the warnings list.
 */
import { DayWindow, formatFuzzy, midpoint } from '../dates';
import { EARTH_MOON, MoonPhase, moonAge, seasonBands } from '../events/sky';
import type { Id, Scene, World } from '../model';
import { STATUS_LABEL, characterStatus } from '../people/status';
import { scenePlace, scenePov } from '../story/story';
import { TerrainReader, hasTerrain } from '../terrain';
import type { Warning } from '../warnings';
import { WorldIndex, whereIs } from '../whereabouts';

export interface PresentCharacter {
  id: Id;
  pov: boolean;
  /** "at Varn Keep", "on the road from Varn to Thornwick", "not born yet"… */
  where: string;
  placeId?: Id;
  /** CC-6: their stay is somewhere other than the scene's place. */
  elsewhere: boolean;
}

export interface CastPlace {
  /** undefined = whereabouts unknown. */
  placeId?: Id;
  label: string;
  characterIds: Id[];
  travelling: boolean;
}

export interface SceneContext {
  scene: Scene;
  dateLabel?: string;
  window?: DayWindow;
  /** The day everything is looked up on: the middle of the scene's start date. */
  day?: number;
  placeId?: Id;
  placeDerived: boolean;
  season?: string;
  moon?: { phase: MoonPhase; label: string; name?: string };
  present: PresentCharacter[];
  /** Everyone else in the cast, grouped by where they are. */
  elsewhere: CastPlace[];
  warnings: Warning[];
}

const MOON_LABELS: [number, string, MoonPhase][] = [
  [0.0625, 'New moon', 'new'], [0.1875, 'Waxing crescent', 'new'], [0.3125, 'First quarter', 'first-quarter'], [0.4375, 'Waxing gibbous', 'first-quarter'],
  [0.5625, 'Full moon', 'full'], [0.6875, 'Waning gibbous', 'full'], [0.8125, 'Last quarter', 'last-quarter'], [0.9375, 'Waning crescent', 'last-quarter'], [1.01, 'New moon', 'new'],
];

/** TL-6: the moon on a day, named the way a writer would. */
export function moonOn(world: World, day: number): { phase: MoonPhase; label: string; name?: string } {
  const m = world.settings.moon ?? EARTH_MOON;
  const age = moonAge(day, m);
  const hit = MOON_LABELS.find(([to]) => age < to)!;
  return { phase: hit[2], label: hit[1], name: world.settings.moon?.name };
}

/** TL-6, RC-10: the season on a day at a place (its latitude and height), or the calendar season. */
export function seasonOn(ix: WorldIndex, day: number, placeId?: Id): string {
  const w = ix.world;
  const at = placeId ? ix.locationOf(placeId) : undefined;
  let elevM = 0;
  if (at && hasTerrain(w.terrain)) elevM = Math.max(0, new TerrainReader(w.terrain).elevation(at));
  const band = seasonBands(day, day, { hemisphere: w.settings.hemisphereForSeasons, lat: at?.lat, elevM, tiltDeg: w.settings.axialTiltDeg })[0];
  return band ? band.season[0].toUpperCase() + band.season.slice(1) : '';
}

/** Where a character is on a day, in words. */
export function whereText(ix: WorldIndex, id: Id, day: number): { text: string; placeId?: Id; travelling: boolean } {
  const name = (pid: Id) => ix.places.get(pid)?.name ?? '?';
  const st = characterStatus(ix, id, day);
  if (st.status === 'not-born' || st.status === 'dead') return { text: STATUS_LABEL[st.status].toLowerCase(), travelling: false };
  const w = whereIs(ix, id, day);
  if (w.kind === 'stay') {
    if (ix.isPlaceholder(w.placeId)) return { text: 'whereabouts unknown', travelling: false };
    return { text: `${st.status === 'missing' ? 'missing, last at' : 'at'} ${name(w.placeId)}`, placeId: w.placeId, travelling: false };
  }
  if (w.kind === 'journey') return { text: `on the road from ${name(w.fromId)} to ${name(w.toId)}`, placeId: w.toId, travelling: true };
  return { text: 'no stay on this date', travelling: false };
}

/** WR-9: everything the story sidebar needs for a scene. `warnings` is the full warnings list (checkWorld). */
export function sceneContext(ix: WorldIndex, sceneId: Id, warnings: Warning[] = []): SceneContext | undefined {
  const world = ix.world;
  const scene = world.scenes.find((s) => s.id === sceneId);
  if (!scene) return undefined;
  const pov = scenePov(world, scene);
  const place = scenePlace(ix, scene);
  const window = scene.start ? (() => {
    const a = ix.win(scene.start!), b = scene.end ? ix.win(scene.end) : a;
    return { earliest: a.earliest, latest: Math.max(a.latest, b.latest) };
  })() : undefined;
  const day = scene.start ? midpoint(ix.win(scene.start)) : undefined;
  const dateLabel = scene.start ? `${formatFuzzy(scene.start)}${scene.end ? ` – ${formatFuzzy(scene.end)}` : ''}` : undefined;
  const ids = [...new Set([...(pov ? [pov] : []), ...scene.characterIds])].filter((id) => ix.characters.has(id));

  const present: PresentCharacter[] = ids.map((id) => {
    if (day === undefined) return { id, pov: id === pov, where: '', elsewhere: false };
    const w = whereText(ix, id, day);
    const elsewhere = !!(w.placeId && place.placeId && !w.travelling && !ix.nested(w.placeId, place.placeId) && !ix.isPlaceholder(place.placeId));
    return { id, pov: id === pov, where: w.text, placeId: w.placeId, elsewhere };
  });

  const elsewhere: CastPlace[] = [];
  if (day !== undefined) {
    const here = new Set(ids);
    const groups = new Map<string, CastPlace>();
    const rank = { main: 0, secondary: 1, minor: 2 } as Record<string, number>;
    const cast = world.characters.filter((c) => !c.archived && !here.has(c.id)).sort((a, b) => (rank[a.importance] ?? 3) - (rank[b.importance] ?? 3) || a.name.localeCompare(b.name));
    for (const c of cast) {
      const st = characterStatus(ix, c.id, day);
      if (st.status === 'not-born' || st.status === 'dead') continue;
      const w = whereText(ix, c.id, day);
      const key = w.placeId ? `${w.travelling ? 'to:' : ''}${w.placeId}` : 'unknown';
      let g = groups.get(key);
      if (!g) {
        g = { placeId: w.placeId, label: w.placeId ? `${w.travelling ? 'On the way to ' : ''}${ix.places.get(w.placeId)?.name ?? '?'}` : 'Whereabouts unknown', characterIds: [], travelling: w.travelling };
        groups.set(key, g);
      }
      g.characterIds.push(c.id);
    }
    elsewhere.push(...[...groups.values()].sort((a, b) => Number(!a.placeId) - Number(!b.placeId) || b.characterIds.length - a.characterIds.length || a.label.localeCompare(b.label)));
  }

  return {
    scene, dateLabel, window, day, placeId: place.placeId, placeDerived: place.derived,
    season: day !== undefined ? seasonOn(ix, day, place.placeId) : undefined,
    moon: day !== undefined ? moonOn(world, day) : undefined,
    present, elsewhere,
    warnings: warningsForScene(warnings, scene, ids, window),
  };
}

/** WR-9: warnings about the scene itself, or about someone present at the scene's time. */
export function warningsForScene(warnings: Warning[], scene: Scene, present: Id[], window?: DayWindow): Warning[] {
  const who = new Set(present);
  return warnings.filter((w) => {
    if (w.dismissed) return false;
    if (w.refs.some((r) => r.kind === 'scene' && r.id === scene.id)) return true;
    if (!window || w.day === undefined) return false;
    const involves = (w.characterId && who.has(w.characterId)) || w.refs.some((r) => r.kind === 'character' && who.has(r.id));
    return !!involves && w.day >= window.earliest - 1 && w.day <= window.latest + 1;
  });
}
