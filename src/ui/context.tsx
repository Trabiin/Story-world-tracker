import { createContext, useContext } from 'react';
import type { Id, LatLng, Warning, World, WorldIndex } from '../core';
import type { Platform } from './platform';
import type { WorldStore } from './store';

export type View = 'who' | 'timeline' | 'map' | 'story' | 'manuscripts' | 'characters' | 'places' | 'layers' | 'groups' | 'warnings' | 'settings';

export type EditorTarget =
  | { kind: 'stay'; id?: Id; preset?: Record<string, unknown> }
  | { kind: 'journey'; id?: Id; preset?: Record<string, unknown> };

export interface AppCtx {
  store: WorldStore;
  world: World;
  ix: WorldIndex;
  warnings: Warning[];
  platform: Platform;
  moment: number;
  view: View;
  go: (view: View, selectId?: Id) => void;
  selected: Id | undefined;
  select: (id: Id | undefined) => void;
  edit: (t: EditorTarget) => void;
  closeWorld: () => void;
  /** Map pick mode: the next map click sets this place's position. */
  pickFor: Id | undefined;
  startPick: (placeId: Id | undefined) => void;
  /** WH-6: the journey whose route is being drawn on the map. */
  routeFor: Id | undefined;
  startRoute: (journeyId: Id | undefined) => void;
  /** Open the manuscript reader at a linked passage (ST-10). */
  openPassage: (manuscriptId: Id, linkId?: Id) => void;
  /** Passage to scroll to when the reader opens. */
  focusLink: Id | undefined;
  /** Open the map centred on a spot (n changes each time, so the same spot can be shown again). */
  showOnMap: (at: LatLng) => void;
  mapFocus: { at: LatLng; n: number } | undefined;
  /** VW-3: open the map with this character's whole track drawn. */
  showTrack: (characterId: Id) => void;
  trackRequest: { id: Id; n: number } | undefined;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
