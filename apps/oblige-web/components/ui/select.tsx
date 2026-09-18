'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius)] px-3',
        'bg-[var(--surface-2)] border border-[var(--line)] text-[length:var(--fs-sm)] font-semibold text-[var(--text)]',
        'outline-none transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)]',
        'focus:border-[var(--accent)] focus:shadow-[var(--shadow-glow)] data-[placeholder]:text-[var(--text-3)]',
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={6}
        className={cn(
          'z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden',
          'rounded-[var(--radius)] border border-[var(--line-strong)] bg-[var(--surface-2)]',
          'shadow-[var(--shadow-2)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-[var(--radius-sm)] px-2.5',
        'text-[length:var(--fs-sm)] text-[var(--text-2)] outline-none',
        'data-[highlighted]:bg-[var(--surface-3)] data-[highlighted]:text-[var(--text)]',
        'data-[state=checked]:text-[var(--accent)] data-[state=checked]:font-semibold',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator asChild>
        <Check className="size-3.5" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
