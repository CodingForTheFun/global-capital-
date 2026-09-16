'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveal-on-scroll. One shared observer for the whole page rather than one per
 * element, and the element is unobserved as soon as it has shown, so a long
 * board does not keep paying for cards the viewer has already scrolled past.
 */
function useReveal<T extends HTMLElement>(delay = 0) {
  const ref = React.useRef<T | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    // Anything already on screen at mount shows immediately: waiting for an
    // intersection callback would blank the first paint.
    if (node.getBoundingClientRect().top < window.innerHeight) {
      const timer = window.setTimeout(() => setShown(true), 16);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [delay]);

  return { ref, shown };
}

export function Reveal({
  delay = 0,
  className,
  as: Tag = 'div',
  children,
  style,
  ...props
}: React.HTMLAttributes<HTMLElement> & { delay?: number; as?: 'div' | 'section' | 'li' }) {
  const { ref, shown } = useReveal<HTMLElement>(delay);
  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-shown={shown}
      className={cn('rv', className)}
      style={{ ['--d' as string]: `${delay}ms`, ...style }}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Counts once on entry, and lands on the real figure immediately when the
 *  viewer has asked for reduced motion. */
export function CountUp({
  to,
  duration = 1100,
  className,
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = React.useState(0);
  const done = React.useRef(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      setValue(to);
      return;
    }
    let frame = 0;
    const run = () => {
      if (done.current) return;
      done.current = true;
      const started = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = 1 - (1 - progress) ** 3;
        setValue(Math.round(to * eased));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && run()),
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, duration]);

  return (
    <span ref={ref} className={cn('num', className)}>
      {value.toLocaleString()}
    </span>
  );
}
