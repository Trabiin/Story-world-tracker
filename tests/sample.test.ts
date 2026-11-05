import { expect, it } from 'vitest';
import { checkWorld } from '../src/core';
import { sampleWorld } from '../src/ui/sample';

it('sample world shows exactly its deliberate problems', () => {
  const rules = checkWorld(sampleWorld()).map((w) => `${w.rule}:${w.message.split(' ')[0]}`).sort();
  expect(rules).toEqual(['gap:Tamsin', 'impossible-travel:Tamsin', 'missing-journey:Tamsin', 'open-stay:Kaela']);
});
