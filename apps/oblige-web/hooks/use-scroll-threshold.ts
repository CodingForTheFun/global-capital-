'use client';

import * as React from 'react';

export function useScrollThreshold(threshold = 24) {
  const [passed, setPassed] = React.useState(false);

  React.useEffect(() => {
    let ticking = false;

    const update = () => {
      const next = window.scrollY > threshold;
      setPassed((current) => (current === next ? current : next));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    update();

    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  return passed;
}
