(() => {
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  const fmt = (value, suffix = '') => value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${value}${suffix}`;
  const deltaFmt = (value) => value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${Number(value) > 0 ? '+' : ''}${Number(value)}%`;
  let latest = null;
  let refreshTimer = null;

  async function fetchLatest() {
    const response = await fetch('/api/status', { cache:'no-store', credentials:'same-origin' });
    if (!response.ok) return null;
    const data = await response.json();
    latest = data.latest || null;
    return latest;
  }

  function floorFor(label, rules = {}) {
    if (label === 'L5') return Number(rules.minL5 ?? 80);
    if (label === 'L10') return Number(rules.minL10 ?? 75);
    if (label === 'L15') return Number(rules.minL15 ?? 75);
    if (label === 'H2H') return Number(rules.minH2H ?? 75);
    return Number(rules.minExpectedOutcome ?? 75);
  }

  function metric(label, value, rules) {
    const pass = Number.isFinite(Number(value)) && Number(value) >= floorFor(label, rules);
    return `<div class="metric ${pass ? 'metric-pass' : ''}"><small>${label}</small><b>${fmt(value, '%')}</b></div>`;
  }

  function rebuildAudit(dialog, pick) {
    const audit = Array.isArray(pick?.filterAudit) ? pick.filterAudit : [];
    const table = dialog.querySelector('.audit-table');
    if (table && audit.length) {
      table.innerHTML = `<thead><tr><th>Filter</th><th>Value</th><th>Before</th><th>After</th><th>Δ</th><th>Status</th></tr></thead><tbody>${audit.map((row) => {
        const after = row.afterHitRate ?? row.hitRate;
        const floor = Number(row.floor ?? latest?.rulesApplied?.minFilterHitRate ?? 75);
        const reverted = Boolean(row.removedBecauseDataDisappeared);
        const passed = row.enforceFloor === false ? row.verified : row.verified && Number.isFinite(Number(after)) && Number(after) >= floor;
        const failed = row.required && !reverted && !passed;
        const status = reverted ? 'Reverted — data disappeared' : passed ? 'Pass' : failed ? 'Fail / unverified' : 'Optional / unavailable';
        return `<tr><td>${esc(row.label)}</td><td>${esc(row.value || '—')}</td><td>${fmt(row.beforeHitRate,'%')}</td><td>${fmt(after,'%')}</td><td>${deltaFmt(row.delta)}</td><td class="${passed ? 'ok' : failed ? 'bad' : ''}">${status}</td></tr>`;
      }).join('')}</tbody>`;
    }
    if (!dialog.querySelector('.full-detail-proof') && pick.detailPageVerified) {
      dialog.querySelector('.detail-meta')?.insertAdjacentHTML('afterend', '<p class="fineprint full-detail-proof">✓ Full detail page verified • Summary table not used for performance decisions • Filters track Before → After → Δ</p>');
    }
  }

  function openBestAvailable(pick) {
    const dialog = document.getElementById('detailsDialog');
    const body = document.getElementById('detailsBody');
    if (!dialog || !body) return;
    const rules = latest?.rulesApplied || {};
    body.innerHTML = `<div class="detail-wrap"><span class="eyebrow">BEST AVAILABLE • NOT QUALIFIED • ${esc(pick.sport)}</span><h2>${esc(pick.player)} — ${esc(pick.pick)} ${fmt(pick.line)}</h2><div class="detail-meta">${esc(pick.prop)} • vs ${esc(pick.opponent || '—')} • near-miss rank ${fmt(pick.researchScore,'%')}</div><div class="warning">This prop is fully researched and hard-eligible, but it did not pass every active rule. ${esc((pick.nearMisses || []).join(' • '))}</div><div class="detail-score"><div><small>L5</small><b>${fmt(pick.l5,'%')}</b></div><div><small>L10</small><b>${fmt(pick.l10,'%')}</b></div><div><small>L15</small><b>${fmt(pick.l15,'%')}</b></div><div><small>H2H</small><b>${rules.useH2H === false ? 'Optional' : fmt(pick.h2h,'%')}</b></div><div><small>Expected W/L</small><b>${rules.requireWinLoss === false ? 'Optional' : fmt(pick.expectedOutcomeRate,'%')}</b></div></div><h3>Full filter audit</h3><table class="audit-table"></table>${pick.sourceUrl ? `<p class="fineprint">Source: ${esc(pick.sourceUrl)}</p>` : ''}</div>`;
    rebuildAudit(dialog, pick);
    dialog.showModal();
  }

  function filtered(rows) {
    const search = String(document.getElementById('propSearch')?.value || '').trim().toLowerCase();
    const sport = String(document.getElementById('sportFilter')?.value || 'ALL').toUpperCase();
    return rows.filter((p) => (sport === 'ALL' || String(p.sport || '').toUpperCase() === sport) && (!search || [p.player,p.prop,p.opponent,p.sport,p.pick].some((value) => String(value || '').toLowerCase().includes(search))));
  }

  function renderBestAvailable() {
    if (!latest) return;
    const button = document.querySelector('.segment[data-filter="qualified"]');
    const cardList = document.getElementById('cardList');
    const cardTitle = cardList?.closest('.side-card')?.querySelector('h3');
    if (Number(latest.qualifiedCount || 0) > 0) {
      if (button) button.textContent = 'Qualified';
      if (cardTitle) cardTitle.textContent = 'Top independent legs';
      return;
    }
    const ranked = Array.isArray(latest.bestAvailable) ? latest.bestAvailable : [];
    if (button) button.textContent = ranked.length ? 'Best available' : 'Qualified';
    if (!ranked.length) return;
    if (cardTitle) cardTitle.textContent = 'Best available — not qualified';
    if (cardList && !(latest.diversifiedCard || []).length) {
      cardList.innerHTML = `<p class="warning">No prop passed every active rule. These are the strongest fully researched near-misses, not qualified legs.</p>${ranked.slice(0,4).map((p,i) => `<div class="card-leg"><span class="leg-num">${i+1}</span><div><b>${esc(p.player)} ${esc(p.pick)} ${fmt(p.line)}</b><span>${esc(p.sport)} • ${esc(p.prop)} • ${(p.nearMisses || []).length} miss${(p.nearMisses || []).length === 1 ? '' : 'es'}</span></div><strong>${fmt(p.researchScore,'%')}</strong></div>`).join('')}`;
    }
    if (document.querySelector('.segment.active')?.dataset.filter !== 'qualified') return;
    const list = document.getElementById('pickList');
    if (!list) return;
    const rows = filtered(ranked);
    if (!rows.length) return;
    const rules = latest.rulesApplied || {};
    list.innerHTML = `<div class="warning fallback-near-miss">No props fully qualified under the active ${esc(rules.preset || 'custom')} profile. Showing only hard-eligible regular PrizePicks near-misses for today.</div>${rows.map((p,index) => `<article class="pick-row fallback-near-miss" data-best-index="${index}"><div class="pick-main"><b>${esc(p.player)}</b><span>${esc(p.sport)} • vs ${esc(p.opponent || '—')} <em class="reject-tag">BEST AVAILABLE</em></span></div><div class="pick-line"><b>${esc(p.prop)} ${fmt(p.line)}</b><span class="${String(p.pick).toLowerCase() === 'under' ? 'under' : 'over'}">${esc(p.pick)}</span></div>${metric('L5',p.l5,rules)}${metric('L10',p.l10,rules)}${metric('L15',p.l15,rules)}${metric('H2H',p.h2h,rules)}${metric('W/L',p.expectedOutcomeRate,rules)}<div class="conf"><strong>${fmt(p.researchScore,'%')}</strong><span>near-miss rank</span></div></article>`).join('')}`;
    list.querySelectorAll('[data-best-index]').forEach((row) => row.addEventListener('click', () => openBestAvailable(rows[Number(row.dataset.bestIndex)])));
  }

  function enhanceOpenDialog() {
    const dialog = document.getElementById('detailsDialog');
    if (!dialog?.open || !latest?.picks?.length) return;
    const heading = dialog.querySelector('h2')?.textContent || '';
    const source = [...dialog.querySelectorAll('.fineprint')].map((el) => el.textContent || '').find((text) => /^\s*Source:/i.test(text))?.replace(/^\s*Source:\s*/i,'').trim();
    const pick = latest.picks.find((p) => source && p.sourceUrl === source) || latest.picks.find((p) => heading.startsWith(`${p.player} —`));
    if (pick) rebuildAudit(dialog, pick);
  }

  async function refresh() {
    try { await fetchLatest(); renderBestAvailable(); enhanceOpenDialog(); } catch {}
  }

  document.getElementById('propSearch')?.addEventListener('input', () => setTimeout(renderBestAvailable, 0));
  document.getElementById('sportFilter')?.addEventListener('change', () => setTimeout(renderBestAvailable, 0));
  document.querySelectorAll('.segment').forEach((button) => button.addEventListener('click', () => setTimeout(renderBestAvailable, 0)));
  refresh();
  refreshTimer = setInterval(refresh, 6500);
  window.addEventListener('pagehide', () => clearInterval(refreshTimer), { once:true });
})();
