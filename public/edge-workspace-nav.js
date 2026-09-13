/* Same-origin navigation for the existing Auto Scout shell. */
(() => {
  'use strict';
  const items = [
    ['Sports', '/sportsbooks#sports'], ['Live', '/sportsbooks#live'],
    ['My Research', '/sportsbooks#research'], ['Analytics', '/sportsbooks#analytics'],
    ['Tools', '/sportsbooks#tools'], ['Auto Scout', '/apex'],
  ];
  let scheduled = false;
  const mount = () => {
    const bar = document.querySelector('.as5 .asBar');
    if (!bar || bar.querySelector('.edge-workspace-nav')) return;
    const nav = document.createElement('nav');
    nav.className = 'edge-workspace-nav';
    nav.setAttribute('aria-label', 'Primary workspace navigation');
    for (const [label, href] of items) {
      const link = document.createElement('a');
      link.href = href; link.textContent = label;
      if (label === 'Auto Scout') { link.setAttribute('aria-current', 'page'); link.dataset.testid = 'autoscout-nav'; }
      nav.appendChild(link);
    }
    bar.insertBefore(nav, bar.querySelector('.asGrow'));
  };
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; mount(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  mount();
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
