import * as React from 'react';
import { cn } from '@/lib/utils';

/** 16px text on purpose: anything smaller makes iOS zoom the page on focus. */
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'min-h-11 w-full min-w-0 rounded-[var(--radius)] px-3',
        'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)]',
        'text-base sm:text-[length:var(--fs-sm)] placeholder:text-[var(--text-3)]',
        'outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)]',
        'focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)]',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-28 w-full min-w-0 resize-y rounded-[var(--radius)] p-3',
        'bg-[var(--surface-2)] border border-[var(--line)] text-[var(--text)]',
        'text-base sm:text-[length:var(--fs-sm)] leading-relaxed placeholder:text-[var(--text-3)]',
        'outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)]',
        'focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)]',
        className,
      )}
      {...props}
    />
  );
}

/** Labels are always visible — a placeholder disappears the moment you type. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={cn('grid gap-2', className)}>
      <label htmlFor={htmlFor} className="text-[length:var(--fs-sm)] font-semibold">
        {label}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
            'aria-invalid': error ? true : undefined,
          })
        : children}
      {hint && !error && (
        <span id={hintId} className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="text-[length:var(--fs-xs)] text-[var(--neg)]">
          {error}
        </span>
      )}
    </div>
  );
}
