import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const money = (amount: number) => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(amount);
