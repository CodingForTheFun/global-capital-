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

// The production visual layer is applied after this module loads. Keep this
// presentation-only correction here so the stable data/research contracts stay
// untouched while the live header consistently uses the current product name
// and the existing profile menu occupies the compact action slot beside search.
function installObligePropsHeader() {
  if (typeof document === 'undefined') return;

  function fireInput(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {}
  }

  function apply() {
    const root = document.getElementById('as5');
    const bar = root?.querySelector('.asBar');
    const identity = root?.querySelector('.asIdentity');
    const realSearch = root?.querySelector('#asSearch');
    const profile = root?.querySelector('#asProfileMenu');
    if (!root || !bar || !identity || !realSearch || !profile) return false;

    document.title = 'ObligeProps';
    identity.classList.add('asWordmark');
    identity.setAttribute('aria-label', 'ObligeProps home');
    if (identity.textContent.replace(/\s+/g, '').toLowerCase() !== 'obligeprops') {
      identity.innerHTML = '<span class="asOblige">Oblige</span><span class="asPay">Props</span>';
    }

    let right = bar.querySelector('.asRight');
    if (!right) {
      right = document.createElement('div');
      right.className = 'asRight';
      bar.appendChild(right);
    }
    right.setAttribute('aria-label', 'Profile and account');
    if (profile.parentElement !== right) right.appendChild(profile);

    const summary = profile.querySelector('summary');
    if (summary) {
      summary.setAttribute('aria-label', 'Profile, account and settings');
      summary.setAttribute('title', 'Profile, account and settings');
    }
    const accountHeading = profile.querySelector('.asProfileDropdown strong');
    if (accountHeading) accountHeading.textContent = 'ObligeProps';

    if (!bar.querySelector('.asHeaderSearch')) {
      const label = document.createElement('label');
      label.className = 'asHeaderSearch';
      label.innerHTML = '<span class="asHeaderSearchIcon" aria-hidden="true">⌕</span><input type="search" autocomplete="off" aria-label="Search props" placeholder="Search players, teams, props...">';
      const proxy = label.querySelector('input');
      proxy.value = realSearch.value || '';
      proxy.addEventListener('input', () => {
        realSearch.value = proxy.value;
        fireInput(realSearch);
      });
      realSearch.addEventListener('input', () => {
        if (proxy.value !== realSearch.value) proxy.value = realSearch.value || '';
      });
      bar.insertBefore(label, right);
    } else if (right.previousElementSibling !== bar.querySelector('.asHeaderSearch')) {
      bar.insertBefore(right, bar.querySelector('.asHeaderSearch').nextSibling);
    }

    root.dataset.obligePropsHeader = 'ready';
    return true;
  }

  let observer = null;
  const run = () => {
    if (!apply()) return;
    observer?.disconnect();
  };

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  run();
  setTimeout(run, 0);
  setTimeout(run, 250);
}

if (typeof document !== 'undefined') installObligePropsHeader();
