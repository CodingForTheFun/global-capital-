import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** American odds always carry their sign, so -110 and +104 line up in a column. */
export function odds(value: number | string | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n > 0 ? `+${n}` : String(n);
}

export function pct(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  // The board reports rates both as 0–1 and as 0–100 depending on the window,
  // so normalise before rendering rather than trusting one shape.
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

export function pctValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return Math.round(n <= 1 ? n * 100 : n);
}

export function signed(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

export function initials(name: string) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** A hit rate is good news above 60, a warning in the middle, bad below 45. */
export function rateTone(value: number | null): 'pos' | 'warn' | 'neg' | 'none' {
  if (value === null) return 'none';
  if (value >= 60) return 'pos';
  if (value >= 45) return 'warn';
  return 'neg';
}

export function shortTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export function shortDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
