import { CANON, Character, FuzzyDate, Id, LayerIndex, Subject, World, WorldIndex, midpoint, toDayNumber } from '../core';

export const PALETTE = ['#d1495b', '#2e86ab', '#edae49', '#3c9d5d', '#8e5ea2', '#e07a5f', '#00798c', '#b5838d', '#6d597a', '#588157', '#bc6c25', '#4361ee'];
export const ICONS = ['●', '■', '▲', '◆', '★', '✚', '♛', '⚔', '✦', '☾', '☀', '♞'];

export function subjectName(world: World, s: Subject): string {
  if (s.kind === 'character') return world.characters.find((c) => c.id === s.id)?.name ?? '?';
  return world.groups.find((g) => g.id === s.id)?.name ?? '?';
}

export function subjectColor(world: World, s: Subject): string {
  if (s.kind === 'character') return world.characters.find((c) => c.id === s.id)?.color ?? '#888';
  return world.groups.find((g) => g.id === s.id)?.color ?? '#888';
}

export function placeName(world: World, id: Id | undefined): string {
  return world.places.find((p) => p.id === id)?.name ?? '?';
}

/** "Great Hall, Varn Castle, Varn" */
export function placePath(ix: WorldIndex, id: Id): string {
  return [id, ...ix.ancestors(id)].map((p) => ix.places.get(p)?.name ?? '?').join(', ');
}

export function dateDay(d: FuzzyDate | undefined, ix: WorldIndex): number | undefined {
  return d ? midpoint(ix.win(d)) : undefined;
}

/** Default "current moment": the first recorded date in the world, or 1 Jan 1000. */
export function defaultMoment(world: World, ix: WorldIndex): number {
  if (world.settings.currentMoment !== undefined) return world.settings.currentMoment;
  const days = [...world.stays.map((s) => midpoint(ix.win(s.arrival))), ...world.journeys.map((j) => midpoint(ix.win(j.departure)))];
  return days.length ? Math.min(...days) : toDayNumber({ year: 1000, month: 1, day: 1 });
}

export function worldDayRange(world: World, ix: WorldIndex): [number, number] {
  const days: number[] = [];
  for (const s of world.stays) {
    days.push(ix.win(s.arrival).earliest);
    const e = ix.stayEnd(s).end;
    if (e.latest < Number.MAX_SAFE_INTEGER) days.push(e.latest);
  }
  for (const j of world.journeys) {
    days.push(ix.win(j.departure).earliest, ix.journeyEnd(j).end.latest);
  }
  // Births and deaths only count when there are no whereabouts yet, so the view frames the story.
  if (!days.length) {
    for (const c of world.characters) {
      if (c.birth) days.push(ix.win(c.birth).earliest);
      if (c.death) days.push(ix.win(c.death).latest);
    }
  }
  // Border changes (LY-6) count too, so playback reaches conquests after the last stay.
  if (days.length) {
    const lix = new LayerIndex(world);
    for (const d of lix.changeDays()) if (Number.isFinite(d)) days.push(d);
  }
  if (!days.length) {
    const m = defaultMoment(world, ix);
    return [m - 365, m + 365];
  }
  return [Math.min(...days) - 30, Math.max(...days) + 30];
}

export function blankCharacter(world: World, base: { id: Id; scenarioId: Id; status: 'canon' | 'draft'; createdAt: string; updatedAt: string }): Character {
  return {
    ...base,
    name: 'New character',
    aliases: [],
    description: '',
    notes: '',
    tags: [],
    color: PALETTE[world.characters.length % PALETTE.length],
    icon: ICONS[0],
    importance: 'secondary',
    archived: false,
  };
}

export const isCanon = (r: { scenarioId: Id }) => r.scenarioId === CANON;

export function splitList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function sortByName<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

/** PL-5: a canvas as JPEG or PNG bytes. JPEG gets a white background first (no transparency in JPEG). */
export async function canvasBytes(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Uint8Array> {
  let src = c;
  if (type === 'image/jpeg') {
    src = document.createElement('canvas');
    src.width = c.width; src.height = c.height;
    const g = src.getContext('2d')!;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(c, 0, 0);
  }
  const blob = await new Promise<Blob | null>((res) => src.toBlob(res, type, 0.92));
  if (!blob) throw new Error('Could not make the picture.');
  return new Uint8Array(await blob.arrayBuffer());
}
