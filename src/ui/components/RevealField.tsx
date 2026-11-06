import { useMemo } from 'react';
import { REVEAL_NEVER, REVEAL_START, readingOrder } from '../../core';
import { useApp } from '../context';
import { Field } from './Modal';

/** EU-8: when the reader learns of a record. Empty = worked out from the books. */
export function RevealField({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const { world } = useApp();
  const order = useMemo(() => readingOrder(world), [world]);
  return (
    <Field label="Reader learns of it" hint="For the reader's view. Automatic means the first chapter that mentions it.">
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">Automatic</option>
        <option value={REVEAL_START}>From the start</option>
        {order.map((p) => <option key={p.chapter.id} value={p.chapter.id}>In {p.label}</option>)}
        <option value={REVEAL_NEVER}>Never (author only)</option>
      </select>
    </Field>
  );
}
