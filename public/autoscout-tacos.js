/* Display-only promotions view. Never inject offers into regular prop/scanner state. */
(async () => {
  'use strict';
  if (!/^\/apex\/?$/.test(location.pathname)) return;
  const {verifiedTacoChannelOffer} = await import('/assets/lib/ui/offer-promotion.mjs');
  let active = location.hash === '#tacos', currentSport = '', pending = null;
  let version = 0, scheduled = false, expiryTimer = null, waitingForBoard = false;
  let offers = [], message = '', loading = false;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const getSport = () => document.querySelector('.as5 #asSports [aria-pressed="true"]')?.dataset.sport || '';
  function usableOffer(o) {
    return verifiedTacoChannelOffer(o, currentSport);
  }
  function draw() {
    const panel = document.getElementById('asTacoPanel');
    if (!panel) return;
    clearTimeout(expiryTimer);
    panel.replaceChildren();
    const head = element('div', undefined, 'asTacoHead');
    const title = element('div');
    title.append(element('p', 'PRIZEPICKS · PROMOTIONAL PROPS', 'asTacoEyebrow'));
    const heading = element('h2', '🌮 Taco-only props'); heading.id = 'asTacoHeading'; title.append(heading);
    const back = element('button', 'Back to regular props', 'asBtn'); back.type = 'button'; back.onclick = () => setActive(false);
    head.append(title, back); panel.append(head);
    const status = element('p', waitingForBoard ? 'Waiting for this sport’s prop board…' : loading ? 'Checking verified Taco props…' : message, 'asTacoStatus');
    status.setAttribute('role', 'status'); panel.append(status);
    const list = element('div', undefined, 'asTacoCards');
    const seen = new Set();
    const valid = offers.filter(o => usableOffer(o) && !seen.has(o.id) && seen.add(o.id));
    for (const offer of valid) {
      const card = element('article', undefined, 'asTacoCard');
      card.append(element('h3', offer.playerName), element('p', `${currentSport} · ${offer.market} · ${offer.side}`));
      const line = element('p', undefined, 'asTacoLine');
      const old = element('del', String(offer.originalLine)); old.setAttribute('aria-label', 'Original line');
      const discounted = element('strong', String(offer.line)); discounted.setAttribute('aria-label', 'Taco line');
      const badge = element('span', '🌮', 'asTacoBadge');
      badge.dataset.tacoOffer = offer.id; badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', 'Verified PrizePicks Taco offer');
      badge.title = 'PrizePicks Taco: this exact promotional line only';
      line.append(old, discounted, badge); card.append(line, element('p', `Expires ${new Date(offer.expiresAt).toLocaleString()}`, 'asTacoExpiry'));
      list.append(card);
    }
    if (!loading && !valid.length) list.append(element('p', 'No verified, unexpired Taco props are available for this sport.', 'asTacoEmpty'));
    panel.append(list, element('p', 'Promotional props only. Regular props, Goblins and Demons are not relabeled as Tacos. Auto Scout’s regular-line scanner and saved selections are unchanged.', 'asTacoNote'));
    const refresh = element('button', 'Refresh Taco props', 'asBtn'); refresh.type = 'button'; refresh.disabled = loading;
    refresh.onclick = () => load(getSport()); panel.append(refresh);
    if (active && valid.length) {
      const soonest = Math.min(...valid.map(o => verifiedTacoChannelOffer(o, currentSport)?.validUntil || Date.now()));
      expiryTimer = setTimeout(draw, Math.min(2147483647, Math.max(100, soonest - Date.now() + 50)));
    }
  }
  async function load(sport) {
    pending?.abort(); const requestVersion = ++version;
    currentSport = sport; offers = []; message = ''; loading = true; draw();
    if (!/^[A-Z]{2,6}$/.test(sport)) { loading = false; message = 'Select a sport to view Taco props.'; draw(); return; }
    const controller = new AbortController(); pending = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api/apex/taco-offers?sport=${encodeURIComponent(sport)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Object.assign(new Error('Promotion request failed'), { authRequired: response.status === 401 });
      const data = await response.json();
      if (!active || requestVersion !== version) return;
      offers = Array.isArray(data.offers) ? data.offers.slice(0, 250) : [];
      message = typeof data.message === 'string' ? data.message.slice(0, 600) : 'Only source-verified Taco promotions are shown.';
    } catch (error) {
      if (!active || requestVersion !== version) return;
      message = controller.signal.aborted ? 'Taco props request timed out. Try refreshing.' : error.authRequired ? 'Sign in to view Taco props.' : 'Promotion data is temporarily unavailable.';
    } finally {
      clearTimeout(timeout);
      if (requestVersion === version) { pending = null; loading = false; if (active) draw(); }
    }
  }
  function setActive(value) {
    active = value;
    if (!active) { version++; pending?.abort(); pending = null; currentSport = ''; offers = []; waitingForBoard = false; clearTimeout(expiryTimer); }
    history.replaceState(null, '', location.pathname + location.search + (active ? '#tacos' : ''));
    mount();
  }
  function mount() {
    const root = document.querySelector('.as5'), quick = root?.querySelector('#asQuick');
    const controls = quick?.querySelector('.asQuickToggles');
    if (!root || !controls) return;
    if (!document.getElementById('asTacoStyles')) {
      const style = element('style'); style.id = 'asTacoStyles';
      style.textContent = `.as5 #asTacoPanel[hidden]{display:none!important}.as5 .asTacoPanel{border:1px solid #785a263d;background:#111726;border-radius:16px;padding:24px;margin:12px 0;min-width:0}.asTacoHead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.asTacoHead h2{margin:8px 0;font-size:22px}.asTacoEyebrow{font-size:10px;letter-spacing:.15em;color:#fbbf24}.asTacoStatus,.asTacoNote,.asTacoEmpty{color:#94a3b8;font-size:12px;line-height:1.7;overflow-wrap:anywhere}.asTacoCards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px;margin:18px 0}.asTacoCard{padding:18px;border:1px solid #334155;border-radius:12px;background:#090d16;overflow-wrap:anywhere}.asTacoCard h3{margin:0;font-size:16px}.asTacoCard p{font-size:12px;color:#94a3b8}.asTacoLine{display:flex;align-items:center;gap:14px}.asTacoLine strong{font-size:26px;color:#fbbf24}.asTacoLine del{font-size:16px}.asTacoNote{margin:18px 0}.as5 [data-taco-filter][aria-pressed=true]{color:#fbbf24;border-color:#b88732;background:#44321455}.as5.asTacoOnly #asPropTypes,.as5.asTacoOnly .asFilters,.as5.asTacoOnly .asToolbar,.as5.asTacoOnly #asSummary,.as5.asTacoOnly .asTableViewport,.as5.asTacoOnly #asMore,.as5.asTacoOnly .asCoverageNote,.as5.asTacoOnly .asHeroBadge{display:none!important}`;
      document.head.append(style);
    }
    let button = controls.querySelector('[data-taco-filter]');
    if (!button) {
      button = element('button', '🌮 Taco-only props', 'asChip asChipToggle'); button.type = 'button';
      button.dataset.tacoFilter = 'true'; button.setAttribute('aria-controls', 'asTacoPanel');
      button.onclick = () => setActive(!active); controls.append(button);
    }
    const pressed = String(active);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    root.classList.toggle('asTacoOnly', active);
    let panel = root.querySelector('#asTacoPanel');
    if (!panel) {
      panel = element('section', undefined, 'asTacoPanel'); panel.id = 'asTacoPanel';
      panel.setAttribute('aria-labelledby', 'asTacoHeading'); quick.after(panel); draw();
    }
    panel.hidden = !active;
    const sport = getSport();
    const boardBusy = root.querySelector('#asList')?.getAttribute('aria-busy') === 'true' || root.querySelector('#asRefresh')?.disabled;
    // The Taco route reads the existing cache. Wait for its owning board request,
    // rather than starting a second provider refresh or displaying a cold miss.
    if (active && sport && boardBusy) {
      if (!waitingForBoard || currentSport !== sport) {
        version++; pending?.abort(); pending = null; currentSport = sport;
        offers = []; loading = true; waitingForBoard = true; draw();
      }
      return;
    }
    if (active && sport && (waitingForBoard || sport !== currentSport)) {
      waitingForBoard = false; load(sport);
    }
  }
  // The existing shell rerenders quick controls. Reattach without changing its
  // closures, filter values, research payload, saved props or scan rules.
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; mount(); }); }
  });
  const observe = () => observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-busy', 'disabled'] });
  observe();
  document.addEventListener('click', event => {
    if (active && event.target instanceof Element && event.target.closest('.as5 [data-view], .as5 [data-quick]')) setActive(false);
  }, true);
  window.addEventListener('hashchange', () => {
    const wanted = location.hash === '#tacos';
    if (wanted !== active) setActive(wanted);
  });
  window.addEventListener('pagehide', () => { observer.disconnect(); version++; pending?.abort(); clearTimeout(expiryTimer); });
  window.addEventListener('pageshow', event => { if (event.persisted) { currentSport = ''; observe(); mount(); } });
  mount();
})();
