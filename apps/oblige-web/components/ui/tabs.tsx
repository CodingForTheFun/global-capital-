'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('rail', className)} {...props} />;
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'flex-none min-h-11 rounded-full border border-[var(--line)] bg-[var(--surface)] px-5',
        'text-[length:var(--fs-xs)] font-semibold tracking-wide text-[var(--text-2)]',
        'transition-[color,background-color,border-color,transform] duration-200 ease-[var(--ease-out)]',
        'hover:text-[var(--text)] hover:border-[var(--line-strong)] active:scale-[.97]',
        'data-[state=active]:bg-[var(--accent-fill)] data-[state=active]:text-[var(--accent-ink)]',
        'data-[state=active]:border-transparent',
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
