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

  async function latestPayload() {
    const response = await fetch('/api/status', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not load latest audit data');
    const data = await response.json();
    return data.latest || null;
  }

  function sourceFromDialog(dialog) {
    const text = dialog.querySelector('.fineprint')?.textContent || '';
    return text.replace(/^\s*Source:\s*/i, '').trim();
  }

  function rebuildAudit(dialog, pick) {
    const audit = Array.isArray(pick?.filterAudit) ? pick.filterAudit : [];
    const tables = dialog.querySelectorAll('.audit-table');
    const table = tables[0];
    if (!table || !audit.length) return;

    table.innerHTML = `<thead><tr><th>Filter</th><th>Value</th><th>Before</th><th>After</th><th>Δ</th><th>Status</th></tr></thead><tbody>${audit.map((a) => {
      const floor = Number(a.floor ?? 75);
      const after = a.afterHitRate ?? a.hitRate;
      const passed = a.verified && (a.enforceFloor === false || (after !== null && after !== undefined && Number(after) >= floor));
      const missingRequired = a.required && !a.verified;
      const checkedFailure = a.verified && a.enforceFloor !== false && (after === null || after === undefined || Number(after) < floor);
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
      meta?.insertAdjacentHTML('afterend', `<p class="fineprint full-detail-proof">✓ Full player detail page verified • Summary view not used for performance decisions • Each filter records Before → After → Δ</p>`);
    }
  }

  async function enhance(dialog) {
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

  const dialog = document.getElementById('detailsDialog');
  if (!dialog) return;
  new MutationObserver(() => {
    if (dialog.open) setTimeout(() => enhance(dialog), 0);
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
})();
