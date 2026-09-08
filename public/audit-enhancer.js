(() => {
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
  const fmt = (value, suffix = '') => value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${value}${suffix}`;
  const deltaFmt = (value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    const n = Number(value);
    return `${n > 0 ? '+' : ''}${n}%`;
  };

  let cache = { at: 0, latest: null };
  let refreshTimer = null;

  async function latestPayload(force = false) {
    if (!force && Date.now() - cache.at < 1500) return cache.latest;
    const response = await fetch('/api/status', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not load latest audit data');
    const data = await response.json();
    cache = { at: Date.now(), latest: data.latest || null };
    return cache.latest;
  }

  function sourceFromDialog(dialog) {
    const lines = [...dialog.querySelectorAll('.fineprint')].map((el) => el.textContent || '');
    const source = lines.find((text) => /^\s*Source:/i.test(text)) || '';
    return source.replace(/^\s*Source:\s*/i, '').trim();
  }

  function auditState(a) {
    const floor = Number(a.floor ?? 75);
    const after = a.afterHitRate ?? a.hitRate;
    const passed = a.verified && (a.enforceFloor === false || (after !== null && after !== undefined && Number(after) >= floor));
    const missingRequired = a.required && (!a.verified || (a.enforceFloor !== false && (after === null || after === undefined)));
    const checkedFailure = a.verified && a.enforceFloor !== false && after !== null && after !== undefined && Number(after) < floor;
    return { floor, after, passed, missingRequired, checkedFailure };
  }

  function rebuildAudit(dialog, pick) {
    const audit = Array.isArray(pick?.filterAudit) ? pick.filterAudit : [];
    const tables = dialog.querySelectorAll('.audit-table');
    const table = tables[0];
    if (!table || !audit.length) return;

    table.innerHTML = `<thead><tr><th>Filter</th><th>Value</th><th>Before</th><th>After</th><th>Δ</th><th>Status</th></tr></thead><tbody>${audit.map((a) => {
      const { after, passed, missingRequired, checkedFailure } = auditState(a);
      const statusText = passed ? 'Pass' : (missingRequired || checkedFailure) ? 'Fail / unverified' : 'Not available';
      return `<tr>
        <td>${esc(a.label)}</td>
        <td>${esc(a.value)}</td>
        <td>${fmt(a.beforeHitRate, '%')}</td>
        <td>${fmt(after, '%')}</td>
        <td>${deltaFmt(a.delta)}</td>
        <td class="${passed ? 'ok' : (missingRequired || checkedFailure) ? 'bad' : ''}">${statusText}</td>
      </tr>`;
    }).join('')}</tbody>`;

    const tabTable = tables[1];
    if (tabTable && Array.isArray(pick.tabAudit)) {
      tabTable.innerHTML = `<thead><tr><th>Tab</th><th>Before</th><th>After</th><th>Δ</th><th>L5</th><th>L10</th><th>L15</th><th>H2H</th><th>Score</th></tr></thead><tbody>${pick.tabAudit.map((t) => `<tr>
        <td>${esc(t.tab)}</td><td>${fmt(t.beforeHitRate, '%')}</td><td>${fmt(t.hitRate, '%')}</td><td>${deltaFmt(t.delta)}</td>
        <td>${fmt(t.l5, '%')}</td><td>${fmt(t.l10, '%')}</td><td>${fmt(t.l15, '%')}</td><td>${fmt(t.h2h, '%')}</td><td>${fmt(t.score, '%')}</td>
      </tr>`).join('')}</tbody>`;
    }

    if (!dialog.querySelector('.full-detail-proof')) {
      const meta = dialog.querySelector('.detail-meta');
      meta?.insertAdjacentHTML('afterend', '<p class="fineprint full-detail-proof">✓ Full player detail page verified • Summary view not used for performance decisions • Each filter records Before → After → Δ</p>');
    }
  }

  function hardEligible(pick) {
    return Boolean(
      pick
      && pick.detailPageVerified === true
      && pick.regularLine === true
      && pick.prizePicksConfirmed === true
      && pick.isToday === true
      && ['OVER', 'UNDER'].includes(String(pick.pick || '').toUpperCase())
      && Number.isFinite(Number(pick.line))
    );
  }

  function fallbackStats(pick) {
    const baseThresholds = [
      ['L5', pick.l5, 80],
      ['L10', pick.l10, 75],
      ['L15', pick.l15, 75],
      ['Expected W/L', pick.expectedOutcomeRate, 75],
    ];
    if (pick.h2h !== null && pick.h2h !== undefined) baseThresholds.push(['H2H', pick.h2h, 75]);

    let shortfall = 0;
    let missing = 0;
    const misses = [];

    for (const [label, value, floor] of baseThresholds) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        missing += 1;
        shortfall += 25;
        misses.push(`${label} unverified`);
      } else if (Number(value) < floor) {
        const gap = floor - Number(value);
        shortfall += gap;
        misses.push(`${label} short by ${gap}%`);
      }
    }

    for (const row of pick.filterAudit || []) {
      if (row.enforceFloor === false) continue;
      const floor = Number(row.floor ?? 75);
      const after = row.afterHitRate ?? row.hitRate;
      if (row.required && (!row.verified || after === null || after === undefined || !Number.isFinite(Number(after)))) {
        missing += 1;
        shortfall += 25;
        if (!misses.some((x) => x.startsWith(`${row.label} `))) misses.push(`${row.label} unverified`);
      } else if (row.verified && Number.isFinite(Number(after)) && Number(after) < floor) {
        const gap = floor - Number(after);
        shortfall += gap;
        if (!misses.some((x) => x.startsWith(`${row.label} `))) misses.push(`${row.label} short by ${gap}%`);
      }
    }

    const researchScore = Math.max(0, Math.round(Number(pick.confidence || 0) - shortfall * 0.65 - missing * 4));
    return { shortfall, missing, misses, researchScore };
  }

  function bestAvailable(latest) {
    return (latest?.picks || [])
      .filter((p) => !p.qualified && hardEligible(p))
      .map((p) => ({ ...p, fallback: fallbackStats(p) }))
      .sort((a, b) =>
        a.fallback.missing - b.fallback.missing
        || a.fallback.shortfall - b.fallback.shortfall
        || b.fallback.researchScore - a.fallback.researchScore
        || Number(b.confidence || 0) - Number(a.confidence || 0)
      );
  }

  function metric(label, value) {
    const pass = Number.isFinite(Number(value)) && Number(value) >= (label === 'L5' ? 80 : 75);
    return `<div class="metric ${pass ? 'metric-pass' : ''}"><small>${label}</small><b>${fmt(value, '%')}</b></div>`;
  }

  function filteredFallback(rows) {
    const search = String(document.getElementById('propSearch')?.value || '').trim().toLowerCase();
    const sport = String(document.getElementById('sportFilter')?.value || 'ALL').toUpperCase();
    return rows.filter((p) => {
      if (sport !== 'ALL' && String(p.sport || '').toUpperCase() !== sport) return false;
      if (!search) return true;
      return [p.player, p.prop, p.opponent, p.sport, p.pick]
        .some((v) => String(v || '').toLowerCase().includes(search));
    });
  }

  function openFallbackDetails(pick) {
    const dialog = document.getElementById('detailsDialog');
    const body = document.getElementById('detailsBody');
    if (!dialog || !body) return;
    const audit = pick.filterAudit || [];
    body.innerHTML = `<div class="detail-wrap">
      <span class="eyebrow">BEST AVAILABLE • NOT QUALIFIED • ${esc(pick.sport)}</span>
      <h2>${esc(pick.player)} — ${esc(pick.pick)} ${fmt(pick.line)}</h2>
      <div class="detail-meta">${esc(pick.prop)} • vs ${esc(pick.opponent || '—')} • research rank ${fmt(pick.fallback?.researchScore, '%')}</div>
      <p class="warning">This prop did not pass every strict rule. It is shown only because no props fully qualified. ${esc((pick.fallback?.misses || []).slice(0, 5).join(' • '))}</p>
      <div class="detail-score"><div><small>L5</small><b>${fmt(pick.l5,'%')}</b></div><div><small>L10</small><b>${fmt(pick.l10,'%')}</b></div><div><small>L15</small><b>${fmt(pick.l15,'%')}</b></div><div><small>H2H</small><b>${fmt(pick.h2h,'%')}</b></div><div><small>Expected W/L</small><b>${fmt(pick.expectedOutcomeRate,'%')}</b></div></div>
      <h3>Full filter audit</h3>
      <table class="audit-table"><thead><tr><th>Filter</th><th>Value</th><th>Hit rate</th><th>Status</th></tr></thead><tbody>${audit.map((a) => `<tr><td>${esc(a.label)}</td><td>${esc(a.value)}</td><td>${fmt(a.hitRate,'%')}</td><td>${a.verified ? 'Checked' : 'Unverified'}</td></tr>`).join('')}</tbody></table>
      ${(pick.tabAudit || []).length ? `<h3>Swarm tab audit</h3><table class="audit-table tab-table"><thead><tr><th>Tab</th><th>L5</th><th>L10</th><th>L15</th><th>H2H</th><th>Score</th></tr></thead><tbody>${(pick.tabAudit || []).map((t) => `<tr><td>${esc(t.tab)}</td><td>${fmt(t.l5,'%')}</td><td>${fmt(t.l10,'%')}</td><td>${fmt(t.l15,'%')}</td><td>${fmt(t.h2h,'%')}</td><td>${fmt(t.score,'%')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${pick.sourceUrl ? `<p class="fineprint">Source: ${esc(pick.sourceUrl)}</p>` : ''}
    </div>`;
    rebuildAudit(dialog, pick);
    dialog.showModal();
  }

  function renderFallback(latest) {
    const qualifiedCount = Number(latest?.qualifiedCount ?? (latest?.picks || []).filter((p) => p.qualified).length);
    const button = document.querySelector('.segment[data-filter="qualified"]');
    const active = document.querySelector('.segment.active')?.dataset.filter;
    const cardList = document.getElementById('cardList');
    const cardTitle = cardList?.closest('.side-card')?.querySelector('h3');

    if (qualifiedCount > 0) {
      if (button) button.textContent = 'Qualified';
      if (cardTitle) cardTitle.textContent = 'Top independent legs';
      return;
    }

    const ranked = bestAvailable(latest);
    if (button) button.textContent = ranked.length ? 'Best available' : 'Qualified';
    if (!ranked.length) return;

    if (cardTitle) cardTitle.textContent = 'Best available — not qualified';
    if (cardList && !(latest?.diversifiedCard || []).length) {
      const chosen = [];
      const used = new Set();
      for (const pick of ranked) {
        const key = pick.matchId || `${pick.sport}:${pick.opponent || pick.player}`;
        if (used.has(key)) continue;
        used.add(key);
        chosen.push(pick);
        if (chosen.length >= 4) break;
      }
      cardList.innerHTML = `<p class="warning">No prop passed every strict rule. These are research near-misses, not qualified legs.</p>${chosen.map((p, i) => `<div class="card-leg"><span class="leg-num">${i + 1}</span><div><b>${esc(p.player)} ${esc(p.pick)} ${fmt(p.line)}</b><span>${esc(p.sport)} • ${esc(p.prop)} • missed ${p.fallback.misses.length} check${p.fallback.misses.length === 1 ? '' : 's'}</span></div><strong>${p.fallback.researchScore}%</strong></div>`).join('')}`;
    }

    if (active !== 'qualified') return;
    const list = document.getElementById('pickList');
    if (!list || list.querySelector('.fallback-near-miss')) return;

    const rows = filteredFallback(ranked).slice(0, 12);
    if (!rows.length) return;

    list.innerHTML = `<div class="warning fallback-near-miss">No props fully qualified. Showing the strongest fully researched regular PrizePicks lines for tonight. Every item below is a <b>near-miss</b>, not a qualified pick.</div>${rows.map((p, index) => `<article class="pick-row fallback-near-miss" data-fallback-index="${index}">
      <div class="pick-main"><b>${esc(p.player)}</b><span>${esc(p.sport)} • vs ${esc(p.opponent || '—')} <em class="reject-tag">BEST AVAILABLE</em></span></div>
      <div class="pick-line"><b>${esc(p.prop)} ${fmt(p.line)}</b><span class="${String(p.pick).toLowerCase() === 'under' ? 'under' : 'over'}">${esc(p.pick)}</span></div>
      ${metric('L5', p.l5)}${metric('L10', p.l10)}${metric('L15', p.l15)}${metric('H2H', p.h2h)}${metric('W/L', p.expectedOutcomeRate)}
      <div class="conf"><strong>${fmt(p.fallback.researchScore, '%')}</strong><span>near-miss rank</span></div>
    </article>`).join('')}`;

    list.querySelectorAll('[data-fallback-index]').forEach((row) => {
      row.addEventListener('click', () => openFallbackDetails(rows[Number(row.dataset.fallbackIndex)]));
    });
  }

  async function enhanceDialog(dialog) {
    try {
      const latest = await latestPayload();
      if (!latest?.picks?.length) return;
      const source = sourceFromDialog(dialog);
      const heading = dialog.querySelector('h2')?.textContent || '';
      const pick = latest.picks.find((p) => source && p.sourceUrl === source)
        || latest.picks.find((p) => heading.startsWith(`${p.player} —`));
      if (pick) rebuildAudit(dialog, pick);
    } catch (error) {
      console.warn('Audit enhancer:', error.message);
    }
  }

  async function refreshFallback(force = false) {
    try {
      const latest = await latestPayload(force);
      if (latest) renderFallback(latest);
    } catch (error) {
      console.warn('Best Available enhancer:', error.message);
    }
  }

  function queueRefresh(force = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshFallback(force), 80);
  }

  const dialog = document.getElementById('detailsDialog');
  if (dialog) {
    new MutationObserver(() => {
      if (dialog.open) setTimeout(() => enhanceDialog(dialog), 0);
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  }

  const list = document.getElementById('pickList');
  if (list) {
    new MutationObserver(() => queueRefresh()).observe(list, { childList: true, subtree: false });
  }

  document.querySelectorAll('.segment').forEach((button) => button.addEventListener('click', () => queueRefresh(true)));
  document.getElementById('propSearch')?.addEventListener('input', () => queueRefresh());
  document.getElementById('sportFilter')?.addEventListener('change', () => queueRefresh());
  window.addEventListener('focus', () => queueRefresh(true));
  setInterval(() => queueRefresh(true), 10000);
  queueRefresh(true);
})();