(() => {
  'use strict';
  const id = 'autoscout-reference-ui';
  function install() {
    if (!document.querySelector('.as5') || document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = '/assets/autoscout-reference-ui.css?v=20260913a';
    document.head.appendChild(link);
  }
  install();
  const observer = new MutationObserver(() => {
    install();
    if (document.getElementById(id)) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
