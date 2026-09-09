(() => {
  const state = {
    version: '',
    picks: [],
    refreshing: false,
    refreshedAt: null,
    total: 0,
    search: '',
    sport: 'ALL',
    lineType: 'ALL',
    app: 'ALL',
    visibleLimit: 120,
    timer: null,
    bound: false,
  };

  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const fmtLine = (value) => Number.isFinite(Number(value)) ? String(Number(value)) : '—';

  function injectStyles() {
    if (document.getElementById('allPropsLiveStyles')) return;
    const style = document.createElement('style');
    style.id = 'allPropsLiveStyles';
    style.textContent = `
      .all-props-live{margin-top:18px;padding:22px;overflow:hidden}
      .apl-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
      .apl-top h2{margin:5px 0 4px;font-size:clamp(28px,4vw,42px);letter-spacing:-.04em}
      .apl-top p{margin:0;color:var(--muted,#93a3b6);line-height:1.55;max-width:680px}
      .apl-live{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid rgba(84,235,168,.2);border-radius:999px;background:rgba(84,235,168,.07);font-size:11px;font-weight:900;letter-spacing:.08em;color:#7af0b4;white-space:nowrap}
      .apl-live i{width:7px;height:7px;border-radius:50%;background:#62eca8;box-shadow:0 0 0 5px rgba(98,236,168,.09)}
      .apl-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:18px 0 12px}
      .apl-stat{padding:12px 13px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(255,255,255,.025)}
      .apl-stat small,.apl-stat b{display:block}.apl-stat small{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#8ea0b4)}.apl-stat b{font-size:20px;margin-top:3px}
      .apl-tools{display:grid;grid-template-columns:minmax(180px,1.5fr) repeat(3,minmax(130px,.7fr)) auto;gap:9px;margin:12px 0}
      .apl-tools input,.apl-tools select{width:100%;min-width:0;border:1px solid rgba(255,255,255,.09);background:#06111d;color:#f7fbff;border-radius:13px;padding:12px 13px;font:inherit}
      .apl-refresh{border:1px solid rgba(83,226,255,.18);background:rgba(83,226,255,.07);color:#a5f4ff;border-radius:13px;padding:0 15px;font:inherit;font-weight:800;cursor:pointer;min-height:45px}
      .apl-refresh:disabled{opacity:.5;cursor:default}
      .apl-meta{display:flex;gap:10px;justify-content:space-between;align-items:center;min-height:28px;color:var(--muted,#8ea0b4);font-size:12px;margin-bottom:10px}
      .apl-meta strong{color:#dbe8f5}
      .apl-grid{display:grid;gap:8px}
      .apl-row{display:grid;grid-template-columns:minmax(165px,1.15fr) minmax(180px,1fr) 88px 98px;gap:12px;align-items:center;padding:13px 14px;border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.025);border-radius:14px}
      .apl-player b,.apl-prop b{display:block;font-size:14px;line-height:1.25}.apl-player span,.apl-prop span{display:block;color:var(--muted,#8ea0b4);font-size:11px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .apl-direction{font-size:12px;font-weight:900;text-align:center;padding:7px 8px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
      .apl-direction.over{color:#75edba;background:rgba(71,220,158,.07)}.apl-direction.under{color:#ff9eaa;background:rgba(255,92,112,.07)}
      .apl-badges{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}.apl-badge{font-size:9px;font-weight:900;letter-spacing:.06em;border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:4px 6px;color:#9aacc0;background:rgba(255,255,255,.03)}
      .apl-badge.green{color:#76f28c;background:rgba(78,238,105,.07)}.apl-badge.red{color:#ff8e9c;background:rgba(255,89,107,.07)}.apl-badge.pass{color:#76efbb;background:rgba(74,231,164,.08)}.apl-badge.fail{color:#ff9aa7;background:rgba(255,88,109,.07)}
      .apl-more{width:100%;margin-top:12px;padding:12px;border-radius:13px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:#eaf5ff;font:inherit;font-weight:800;cursor:pointer}
      .apl-empty{padding:44px 18px;text-align:center;border:1px dashed rgba(255,255,255,.09);border-radius:15px;color:var(--muted,#8ea0b4)}.apl-empty b{display:block;color:#eef7ff;font-size:18px;margin-bottom:6px}
      @media(max-width:900px){.apl-tools{grid-template-columns:1fr 1fr}.apl-tools input{grid-column:1/-1}.apl-refresh{min-height:46px}.apl-row{grid-template-columns:minmax(0,1fr) 82px}.apl-prop{grid-row:2}.apl-badges{grid-row:2;justify-content:flex-end}.apl-stats{grid-template-columns:1fr 1fr}}
      @media(max-width:520px){.all-props-live{padding:18px}.apl-top{display:block}.apl-live{margin-top:12px}.apl-tools{grid-template-columns:1fr 1fr}.apl-tools select:nth-of-type(3){grid-column:1/2}.apl-refresh{grid-column:2/3}.apl-row{padding:12px}.apl-player b,.apl-prop b{font-size:13px}.apl-stat b{font-size:18px}}
    `;
    document.head.appendChild(style);
  }

  function ensureSection() {
    if (document.getElementById('allPropsLive')) return true;
    const liveCenter = document.querySelector('.live-center');
    if (!liveCenter?.parentElement) return false;
    const section = document.createElement('section');
    section.id = 'allPropsLive';
    section.className = 'all-props-live panel';
    section.innerHTML = `
      <div class="apl-top">
        <div><span class="eyebrow">ALL PROPS LIVE</span><h2>PickFinder board</h2><p>Every prop is pulled into a fast private cache first. Rule research is separate, so the board stays visible while scans run.</p></div>
        <span class="apl-live"><i></i><span id="aplLiveText">LIVE PULL</span></span>
      </div>
      <div class="apl-stats">
        <div class="apl-stat"><small>Total props</small><b id="aplTotal">—</b></div>
        <div class="apl-stat"><small>Regular</small><b id="aplRegular">—</b></div>
        <div class="apl-stat"><small>Green</small><b id="aplGreen">—</b></div>
        <div class="apl-stat"><small>Red</small><b id="aplRed">—</b></div>
      </div>
      <div class="apl-tools">
        <input id="aplSearch" type="search" placeholder="Search every loaded prop, player, team…" autocomplete="off" />
        <select id="aplSport"><option value="ALL">All sports</option></select>
        <select id="aplType"><option value="ALL">All line types</option><option value="REGULAR">Regular</option><option value="GREEN_GOBLIN">Green Goblin</option><option value="RED_GOBLIN">Red Goblin</option></select>
        <select id="aplApp"><option value="ALL">All apps</option></select>
        <button id="aplRefresh" class="apl-refresh" type="button">Refresh now</button>
      </div>
      <div class="apl-meta"><span id="aplMeta">Waiting for your private PickFinder board…</span><strong id="aplShowing"></strong></div>
      <div id="aplGrid" class="apl-grid"><div class="apl-empty"><b>Loading All Props Live</b>Your cached board will appear here without waiting for rule research.</div></div>
      <button id="aplMore" class="apl-more" type="button" hidden>Show more props</button>
    `;
    liveCenter.insertAdjacentElement('afterend', section);
    bind();
    return true;
  }

  function bind() {
    if (state.bound) return;
    state.bound = true;
    document.getElementById('aplSearch')?.addEventListener('input', (event) => {
      state.search = String(event.target.value || '').trim().toLowerCase();
      state.visibleLimit = 120;
      render();
    });
    document.getElementById('aplSport')?.addEventListener('change', (event) => { state.sport = event.target.value; state.visibleLimit = 120; render(); });
    document.getElementById('aplType')?.addEventListener('change', (event) => { state.lineType = event.target.value; state.visibleLimit = 120; render(); });
    document.getElementById('aplApp')?.addEventListener('change', (event) => { state.app = event.target.value; state.visibleLimit = 120; render(); });
    document.getElementById('aplRefresh')?.addEventListener('click', refreshNow);
    document.getElementById('aplMore')?.addEventListener('click', () => { state.visibleLimit += 150; render(); });
  }

  function filtered() {
    return state.picks.filter((pick) => {
      if (state.sport !== 'ALL' && String(pick.sport || '').toUpperCase() !== state.sport) return false;
      if (state.lineType !== 'ALL' && String(pick.lineType || 'REGULAR').toUpperCase() !== state.lineType) return false;
      if (state.app !== 'ALL' && String(pick.sourceApp || 'PickFinder') !== state.app) return false;
      if (!state.search) return true;
      const hay = [pick.player, pick.sport, pick.prop, pick.line, pick.pick, pick.opponent, pick.sourceApp, pick.lineType].join(' ').toLowerCase();
      return hay.includes(state.search);
    });
  }

  function lineBadge(type) {
    const value = String(type || 'REGULAR').toUpperCase();
    if (value === 'GREEN_GOBLIN') return '<span class="apl-badge green">GREEN</span>';
    if (value === 'RED_GOBLIN') return '<span class="apl-badge red">RED</span>';
    return '<span class="apl-badge">REGULAR</span>';
  }

  function ruleBadge(pick) {
    const status = String(pick.ruleStatus || '').toUpperCase();
    if (status === 'PASSED') return '<span class="apl-badge pass">RULE PASS</span>';
    if (status === 'FAILED') return '<span class="apl-badge fail">RULE FAIL</span>';
    return '<span class="apl-badge">BOARD</span>';
  }

  function renderFilters() {
    const sports = [...new Set(state.picks.map((p) => String(p.sport || '').toUpperCase()).filter(Boolean))].sort();
    const apps = [...new Set(state.picks.map((p) => String(p.sourceApp || 'PickFinder')).filter(Boolean))].sort();
    const sport = document.getElementById('aplSport');
    const app = document.getElementById('aplApp');
    if (sport) {
      const selected = state.sport;
      sport.innerHTML = '<option value="ALL">All sports</option>' + sports.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      if (sports.includes(selected)) sport.value = selected; else { sport.value = 'ALL'; state.sport = 'ALL'; }
    }
    if (app) {
      const selected = state.app;
      app.innerHTML = '<option value="ALL">All apps</option>' + apps.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      if (apps.includes(selected)) app.value = selected; else { app.value = 'ALL'; state.app = 'ALL'; }
    }
  }

  function render() {
    const grid = document.getElementById('aplGrid');
    if (!grid) return;
    const all = state.picks;
    const rows = filtered();
    const visible = rows.slice(0, state.visibleLimit);
    const regular = all.filter((p) => String(p.lineType || 'REGULAR').toUpperCase() === 'REGULAR').length;
    const green = all.filter((p) => String(p.lineType || '').toUpperCase() === 'GREEN_GOBLIN').length;
    const red = all.filter((p) => String(p.lineType || '').toUpperCase() === 'RED_GOBLIN').length;
    const total = state.total || all.length;
    const refreshed = state.refreshedAt ? new Date(state.refreshedAt) : null;

    const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    set('aplTotal', total ? total.toLocaleString() : '—');
    set('aplRegular', all.length ? regular.toLocaleString() : '—');
    set('aplGreen', all.length ? green.toLocaleString() : '—');
    set('aplRed', all.length ? red.toLocaleString() : '—');
    set('aplLiveText', state.refreshing ? 'REFRESHING' : 'LIVE PULL');
    set('aplMeta', state.refreshedAt ? `Cached instantly • last PickFinder pull ${refreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : state.refreshing ? 'Building your first private PickFinder cache…' : 'Waiting for your private PickFinder board…');
    set('aplShowing', rows.length ? `Showing ${Math.min(visible.length, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}` : '');

    if (!rows.length) {
      grid.innerHTML = `<div class="apl-empty"><b>${state.picks.length ? 'No props match these filters' : state.refreshing ? 'Pulling PickFinder now…' : 'No cached props yet'}</b>${state.picks.length ? 'Change the All Props Live filters.' : 'Connect PickFinder or tap Refresh now. The board will cache separately from research.'}</div>`;
    } else {
      grid.innerHTML = visible.map((pick) => {
        const direction = String(pick.pick || 'N/A').toUpperCase();
        const directionClass = direction === 'OVER' ? 'over' : direction === 'UNDER' ? 'under' : '';
        const opponent = pick.opponent ? `vs ${esc(pick.opponent)}` : (pick.eventDate ? esc(pick.eventDate) : 'PickFinder board');
        return `<article class="apl-row">
          <div class="apl-player"><b>${esc(pick.player || 'Player')}</b><span>${esc(pick.sport || 'OTHER')} • ${opponent}</span></div>
          <div class="apl-prop"><b>${esc(pick.prop || 'Prop')} ${fmtLine(pick.line)}</b><span>${esc(pick.sourceApp || 'PickFinder')}</span></div>
          <div class="apl-direction ${directionClass}">${esc(direction === 'N/A' ? '—' : direction)}</div>
          <div class="apl-badges">${lineBadge(pick.lineType)}${ruleBadge(pick)}</div>
        </article>`;
      }).join('');
    }

    const more = document.getElementById('aplMore');
    if (more) {
      more.hidden = visible.length >= rows.length;
      if (!more.hidden) more.textContent = `Show more (${(rows.length - visible.length).toLocaleString()} remaining)`;
    }
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
    return data;
  }

  async function refreshNow() {
    const button = document.getElementById('aplRefresh');
    if (button) { button.disabled = true; button.textContent = 'Refreshing…'; }
    try {
      await api('/api/board/refresh', { method: 'POST' });
      state.refreshing = true;
      render();
      setTimeout(() => poll(true), 900);
    } catch (error) {
      const meta = document.getElementById('aplMeta');
      if (meta) meta.textContent = error.message;
    } finally {
      setTimeout(() => { if (button) { button.disabled = false; button.textContent = 'Refresh now'; } }, 1200);
    }
  }

  async function poll(force = false) {
    clearTimeout(state.timer);
    const app = document.getElementById('app');
    if (!app || app.classList.contains('hidden')) {
      state.timer = setTimeout(() => poll(false), 2500);
      return;
    }
    if (!ensureSection()) {
      state.timer = setTimeout(() => poll(false), 1200);
      return;
    }
    try {
      const query = !force && state.version ? `?since=${encodeURIComponent(state.version)}` : '';
      const data = await api(`/api/board${query}`);
      state.refreshing = Boolean(data.refreshing);
      state.refreshedAt = data.refreshedAt || state.refreshedAt;
      state.total = Number(data.total || state.total || 0);
      if (!data.unchanged && Array.isArray(data.picks)) {
        state.version = data.version || '';
        state.picks = data.picks;
        renderFilters();
      }
      if (data.error && !state.picks.length) {
        const meta = document.getElementById('aplMeta');
        if (meta) meta.textContent = data.error;
      }
      render();
    } catch (error) {
      if (!/sign in/i.test(error.message || '')) {
        const meta = document.getElementById('aplMeta');
        if (meta) meta.textContent = `Live board: ${error.message}`;
      }
    } finally {
      state.timer = setTimeout(() => poll(false), state.refreshing ? 1800 : 7000);
    }
  }

  injectStyles();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => poll(true), { once: true });
  else poll(true);
})();
