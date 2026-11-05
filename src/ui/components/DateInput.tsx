import { useEffect, useState } from 'react';
import { FuzzyDate, formatFuzzy, parseFuzzyDate } from '../../core';

/** Text date entry in day/month/year order, with fuzzy precision (TL-3). */
export function DateInput({ value, onChange, placeholder, allowEmpty = true, autoFocus }: {
  value: FuzzyDate | undefined;
  onChange: (d: FuzzyDate | undefined) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ? formatFuzzy(value) : '');
  const [error, setError] = useState('');
  useEffect(() => {
    setText(value ? formatFuzzy(value) : '');
    setError('');
  }, [value]);
  const parsed = text.trim() ? parseFuzzyDate(text) : undefined;
  const commit = () => {
    if (!text.trim()) {
      if (allowEmpty) onChange(undefined);
      else setError('A date is needed');
      return;
    }
    const p = parseFuzzyDate(text);
    if (!p) {
      setError('Not a date I understand. Try 3/5/1042, May 1042, late spring 1042 or ~1042.');
      return;
    }
    setError('');
    onChange(p);
  };
  return (
    <span className="date-input">
      <input
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'd/m/yyyy, May 1042, spring 1042…'}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className={error ? 'invalid' : ''}
      />
      {error ? <small className="error">{error}</small> : parsed && text !== (value ? formatFuzzy(value) : '') ? <small className="hint">→ {formatFuzzy(parsed)}</small> : null}
    </span>
  );
}
