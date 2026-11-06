import { expect, it } from 'vitest';
import { checkWorld } from '../src/core';
import { sampleWorld } from '../src/ui/sample';

it('sample world shows exactly its deliberate problems', () => {
  const rules = checkWorld(sampleWorld()).map((w) => `${w.rule}:${w.message.split(' ')[0]}`).sort();
  expect(rules).toEqual(['biome-climate:Rainforest', 'gap:Tamsin', 'impossible-travel:Tamsin', 'missing-journey:Tamsin', 'open-stay:Kaela']);
});

import { LayerIndex, toDayNumber } from '../src/core';
it('sample world: Thornwick passes from Varn to Ash in 1044 (LY-12)', () => {
  const w = sampleWorld();
  const ix = new LayerIndex(w);
  const thornwick = w.places.find((p) => p.name === 'Thornwick')!.location!;
  expect(ix.realmHistory(thornwick).map((h) => h.chain[h.chain.length - 1].region.name)).toEqual(['Kingdom of Varn', 'Empire of Ash']);
  const ost = { lat: 52, lng: 6 };
  expect(ix.realmAt(ost, toDayNumber({ year: 1042, month: 5, day: 5 })).map((c) => c.region.name)).toEqual(['Duchy of Ost', 'Kingdom of Varn']);
  const saltmere = w.places.find((p) => p.name === 'Saltmere')!.location!;
  expect(ix.realmAt(saltmere, toDayNumber({ year: 1046, month: 1, day: 1 }))[0].region.name).toBe('Kingdom of Varn');
});
