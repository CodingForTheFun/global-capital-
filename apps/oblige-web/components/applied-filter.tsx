'use client';
import * as React from 'react';
import './applied-filter.css';

/** Each field owns its draft. Other fields cannot accidentally commit it.
 * Editors expand in document flow rather than overlapping on narrow screens. */
export function AppliedFilter({ label, value, options, onApply, clearValue = 'all' }: {
  label: string; value: string; options: { value: string; label: string }[];
  onApply: (value: string) => void; clearValue?: string;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const id = React.useId();
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  function close() { if (ref.current) ref.current.open = false; }
  return <details ref={ref} className="op-applied-filter" data-filter={label} onToggle={() => { if (!ref.current?.open) setDraft(value); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); close(); ref.current?.querySelector('summary')?.focus(); } }}>
    <summary><span>{label}</span><strong>{options.find(option => option.value === value)?.label || 'All'}</strong><span aria-hidden="true">⌄</span></summary>
    <form className="op-filter-editor" onSubmit={e => { e.preventDefault(); if (options.some(option => option.value === draft)) { onApply(draft); close(); } }}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={draft} onChange={e => setDraft(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      <div><button type="submit">Apply</button><button type="button" onClick={() => { setDraft(clearValue); onApply(clearValue); close(); }}>Clear</button></div>
      <small>{draft !== value ? 'Not applied yet' : 'Only this filter will change'}</small>
    </form>
  </details>;
}
