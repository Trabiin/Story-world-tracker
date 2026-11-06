import { useContext, useEffect, useMemo, useState } from 'react';
import { FuzzyDate, anchorChoices, describeRelative, formatFuzzy, parseFuzzyDate, parseRelativeDate, resolveOne } from '../../core';
import { Ctx } from '../context';

/**
 * Text date entry in day/month/year order, with fuzzy precision (TL-3), or tied to a world event,
 * chapter or scene (TL-4): "3 days after the Battle of Varn", "before chapter 12".
 */
export function DateInput({ value, onChange, placeholder, allowEmpty = true, autoFocus }: {
  value: FuzzyDate | undefined;
  onChange: (d: FuzzyDate | undefined) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  autoFocus?: boolean;
}) {
  const app = useContext(Ctx);
  const world = app?.world;
  const show = (v: FuzzyDate | undefined) => (!v ? '' : v.rel && world ? describeRelative(world, v.rel) : formatFuzzy(v));
  const [text, setText] = useState(show(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setText(show(value));
    setError('');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const anchors = useMemo(() => (world ? anchorChoices(world) : []), [world?.events, world?.chapters, world?.scenes, world?.books]); // eslint-disable-line react-hooks/exhaustive-deps
  const read = (t: string): FuzzyDate | null | 'waiting' => {
    const plain = parseFuzzyDate(t);
    if (plain) return plain;
    const rel = world ? parseRelativeDate(t, anchors) : null;
    if (!rel || !world) return null;
    // Keep the old date until the anchor has one; the store fills it in from the anchor.
    return resolveOne(world, { ...(value ?? { year: 1, precision: 'year' }), rel }) ?? 'waiting';
  };
  const parsed = text.trim() ? read(text) : undefined;
  const commit = () => {
    if (!text.trim()) {
      if (allowEmpty) onChange(undefined);
      else setError('A date is needed');
      return;
    }
    const p = read(text);
    if (!p) {
      setError(anchors.length ? 'Not a date I understand. Try 3/5/1042, May 1042, late spring 1042, ~1042, or "3 days after" an event or chapter.' : 'Not a date I understand. Try 3/5/1042, May 1042, late spring 1042 or ~1042.');
      return;
    }
    if (p === 'waiting') {
      setError('That event, chapter or scene has no date yet, so this date cannot follow it.');
      return;
    }
    setError('');
    onChange(p);
  };
  const changed = text !== show(value);
  return (
    <span className="date-input">
      <input
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'd/m/yyyy, May 1042, 3 days after…'}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={`${error ? 'invalid' : ''} ${value?.rel && !changed ? 'relative' : ''}`}
        title={value?.rel ? `${formatFuzzy(value)}: moves with ${describeRelative(world!, { ...value.rel, days: 0 }).replace(/^on /, '')}` : undefined}
      />
      {error ? <small className="error">{error}</small>
        : parsed && parsed !== 'waiting' && changed ? <small className="hint">→ {formatFuzzy(parsed)}{parsed.rel ? ' (follows it when it moves)' : ''}</small>
          : value?.rel && !changed ? <small className="hint">= {formatFuzzy(value)}</small> : null}
    </span>
  );
}
