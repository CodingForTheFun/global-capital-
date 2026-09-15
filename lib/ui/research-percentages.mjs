import { toNumberOrNull as num } from '../props/model.mjs';

// Research counts use all eligible games, including pushes. Do not reuse this
// denominator for model probabilities or the legacy decided-games scanner.
export function researchRate(window) {
  const games = num(window?.games), hits = num(window?.hits);
  if (!Number.isInteger(games) || games <= 0 || !Number.isInteger(hits) || hits < 0 || hits > games) return null;
  return 100 * hits / games;
}
export function formatResearchRate(value, missing = 'N/A') {
  const rate = num(value);
  if (rate === null || rate < 0 || rate > 100) return missing;
  return `${Number(rate.toFixed(1))}%`;
}
export function researchSideRates(window, side) {
  const active = researchRate(window), games = num(window?.games);
  const misses = num(window?.misses), pushes = num(window?.pushes);
  if (active === null || !['OVER', 'UNDER'].includes(side) ||
      !Number.isInteger(misses) || misses < 0 || !Number.isInteger(pushes) || pushes < 0 ||
      num(window.hits) + misses + pushes !== games) return null;
  const opposite = 100 * misses / games;
  return {over: side === 'UNDER' ? opposite : active,
    under: side === 'UNDER' ? active : opposite, push: 100 * pushes / games, games};
}

// Oblige Props bottom navigation behaves like an auto-hidden taskbar: drag the
// exposed tab toward the edge to tuck it away, then drag it back (or tap it)
// to restore the full navigation. The presentation-only behavior is mounted
// here because this module is already part of the research shell's client
// bundle, avoiding another boot-time asset request.
function installSlideAwayNavigation() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const STORAGE_KEY = 'obligeprops-nav-collapsed';
  const STYLE_ID = 'obligeprops-slide-nav-style';
  const VISIBLE_EDGE = 36;

  function mount() {
    const nav = document.querySelector('#as5 .asNav');
    if (!nav || nav.dataset.slideRailReady === '1') return false;
    nav.dataset.slideRailReady = '1';
    nav.classList.add('asNavSlideRail');
    if (!nav.id) nav.id = 'asMainNav';

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
#as5 .asNav.asNavSlideRail{overflow:visible!important;transition:translate .26s cubic-bezier(.22,.61,.36,1),opacity .18s ease!important;will-change:translate}
#as5 .asNav.asNavSlideRail>.asNavEdgeHandle{position:absolute!important;left:2px!important;top:-28px!important;translate:0 0!important;transform:none!important;width:32px!important;min-width:32px!important;max-width:32px!important;height:28px!important;min-height:28px!important;padding:0!important;margin:0!important;flex:0 0 32px!important;display:grid!important;place-items:center!important;border:1px solid rgba(122,148,181,.58)!important;border-bottom:0!important;border-radius:10px 10px 0 0!important;background:rgba(8,18,31,.9)!important;color:#d6e2f2!important;font:800 19px/1 system-ui,-apple-system,sans-serif!important;z-index:4!important;box-shadow:0 -4px 16px rgba(0,0,0,.2)!important;opacity:.78;touch-action:pan-y;user-select:none;-webkit-user-select:none;cursor:ew-resize}
#as5 .asNav.asNavSlideRail>.asNavEdgeHandle:focus-visible{outline:2px solid #82b1ff!important;outline-offset:2px!important}
#as5 .asNav.asNavSlideRail.asNavCollapsed{opacity:.78}
#as5 .asNav.asNavSlideRail.asNavCollapsed>.asNavEdgeHandle{opacity:1;background:rgba(11,25,42,.97)!important}
#as5 .asNav.asNavSlideRail.asNavCollapsed>:not(.asNavEdgeHandle){pointer-events:none!important}
@media(prefers-reduced-motion:reduce){#as5 .asNav.asNavSlideRail{transition:none!important}}
`;
      (document.body || document.head || document.documentElement).appendChild(style);
    }

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'asNavEdgeHandle';
    handle.setAttribute('aria-controls', nav.id);
    nav.prepend(handle);

    const navItems = Array.from(nav.children).filter((node) => node !== handle && (node.matches?.('button') || node.matches?.('a')));
    const savedAccess = new Map(navItems.map((item) => [item, {
      tabindex: item.getAttribute('tabindex'),
      ariaHidden: item.getAttribute('aria-hidden'),
    }]));

    let collapsed = false;
    let currentOffset = 0;
    let drag = null;
    let didDrag = false;
    try { collapsed = window.localStorage.getItem(STORAGE_KEY) === '1'; } catch {}

    function maxOffset() {
      const rect = nav.getBoundingClientRect();
      const baseLeft = rect.left - currentOffset;
      return Math.max(0, window.innerWidth - VISIBLE_EDGE - baseLeft);
    }

    function setItemsAccessible(isOpen) {
      navItems.forEach((item) => {
        const previous = savedAccess.get(item);
        if (isOpen) {
          if (previous?.tabindex == null) item.removeAttribute('tabindex');
          else item.setAttribute('tabindex', previous.tabindex);
          if (previous?.ariaHidden == null) item.removeAttribute('aria-hidden');
          else item.setAttribute('aria-hidden', previous.ariaHidden);
        } else {
          item.setAttribute('tabindex', '-1');
          item.setAttribute('aria-hidden', 'true');
        }
      });
    }

    function render(persist = false) {
      currentOffset = collapsed ? maxOffset() : 0;
      nav.style.translate = `${Math.round(currentOffset)}px 0`;
      nav.classList.toggle('asNavCollapsed', collapsed);
      handle.textContent = collapsed ? '‹' : '›';
      handle.setAttribute('aria-label', collapsed ? 'Show navigation' : 'Hide navigation');
      handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      setItemsAccessible(!collapsed);
      if (persist) {
        try { window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
      }
    }

    requestAnimationFrame(() => render(false));

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, start: currentOffset };
      didDrag = false;
      nav.style.transition = 'none';
      try { handle.setPointerCapture(event.pointerId); } catch {}
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 5) didDrag = true;
      const max = maxOffset();
      currentOffset = Math.min(max, Math.max(0, drag.start + dx));
      nav.style.translate = `${Math.round(currentOffset)}px 0`;
    });

    function finishDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const max = maxOffset();
      nav.style.transition = '';
      if (Math.abs(dx) >= 24) collapsed = dx > 0;
      else collapsed = currentOffset > max / 2;
      drag = null;
      requestAnimationFrame(() => render(true));
    }

    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      nav.style.transition = '';
      requestAnimationFrame(() => render(false));
    });

    handle.addEventListener('click', (event) => {
      if (didDrag) {
        didDrag = false;
        event.preventDefault();
        return;
      }
      collapsed = !collapsed;
      render(true);
    });

    window.addEventListener('resize', () => {
      if (collapsed) requestAnimationFrame(() => render(false));
    }, { passive: true });

    return true;
  }

  if (mount()) return;
  const root = document.body || document.documentElement;
  if (!root || typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver(() => {
    if (mount()) observer.disconnect();
  });
  observer.observe(root, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15000);
}

installSlideAwayNavigation();
