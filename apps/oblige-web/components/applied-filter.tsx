'use client';
import * as React from 'react';
import './applied-filter.css';

/** The chip is the native select's entire touch target. No second editor,
 * pending draft, Apply button, or layout expansion is needed. Keep onApply
 * as the public callback so every existing caller still changes only itself. */
export function AppliedFilter({ label, value, options, onApply, clearValue = 'all' }: {
  label: string; value: string; options: { value: string; label: string }[];
  onApply: (value: string) => void; clearValue?: string;
}) {
  const choices = options.some(option => option.value === clearValue)
    ? options
    : [{ value: clearValue, label: 'All' }, ...options];
  const selected = choices.find(option => option.value === value);

  return <label className="op-applied-filter op-direct-filter" data-filter={label} data-filter-mode="instant">
    <span className="op-direct-filter-label" aria-hidden="true">{label}</span>
    <strong className="op-direct-filter-value" aria-hidden="true">{selected?.label || 'Unavailable'}</strong>
    <span className="op-direct-filter-chevron" aria-hidden="true">⌄</span>
    <select
      className="op-direct-filter-select"
      aria-label={label}
      title={`${label}: ${selected?.label || 'Unavailable'}`}
      value={value}
      onChange={event => {
        const next = event.currentTarget.value;
        if (next !== value && choices.some(option => option.value === next)) onApply(next);
      }}
    >
      {!selected && <option value={value} disabled>Unavailable</option>}
      {choices.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
