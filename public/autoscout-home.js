/* Visual polish for the original Auto Scout shell. No data fetching or new state. */
(() => {
  'use strict';
  let observer, timeout;
  const mount = () => {
    const root = document.getElementById('as5');
    if (!root) return false;
    document.body.classList.add('asResearchHome');
    root.dataset.product = 'autoscout';
    document.title = 'Auto Scout — Player Prop Research';
    root.querySelector('.asIdentity')?.setAttribute('href', '/');
    const label = root.querySelector('.asDesktopLabel');
    if (label) label.textContent = 'PLAYER PROP INTELLIGENCE';
    const hero = root.querySelector('.asHero > div');
    if (hero && !hero.querySelector('.asHomeEyebrow')) {
      const eyebrow = document.createElement('p');
      eyebrow.className = 'asHomeEyebrow'; eyebrow.textContent = 'RESEARCH TERMINAL'; hero.prepend(eyebrow);
    }
    const search = root.querySelector('#asSearch');
    if (search) search.setAttribute('aria-keyshortcuts', 'Control+k Meta+k');
    observer?.disconnect(); clearTimeout(timeout);
    return true;
  };
  const shortcut = event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k' || event.altKey) return;
    const input = document.getElementById('asSearch');
    if (!input || input.closest('[inert]') || document.querySelector('dialog[open],.asDrawerBg.on')) return;
    event.preventDefault(); input.focus();
  };
  document.addEventListener('keydown', shortcut);
  if (!mount()) {
    observer = new MutationObserver(mount); observer.observe(document.body, { childList: true, subtree: true });
    timeout = setTimeout(() => observer.disconnect(), 15000);
  }
  window.addEventListener('pagehide', () => { observer?.disconnect(); clearTimeout(timeout); document.removeEventListener('keydown', shortcut); }, { once: true });
})();
