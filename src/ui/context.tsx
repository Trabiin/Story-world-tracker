import { createContext, useContext } from 'react';
import type { Id, Warning, World, WorldIndex } from '../core';
import type { Platform } from './platform';
import type { WorldStore } from './store';

export type View = 'who' | 'timeline' | 'map' | 'characters' | 'places' | 'groups' | 'warnings' | 'settings';

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
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
