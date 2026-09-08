(() => {
  const esc = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  const fmt = (value, suffix = '') => value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : `${value}${suffix}`;
  let latestSignature = '';

  function lineBadge(type) {
    const key = String(type || 'REGULAR').toUpperCase();
    if (key === 'GREEN_GOBLIN') return '<span class="mp-badge mp-green">GREEN GOBLIN</span>';
    if (key === 'RED_GOBLIN') return '<span class="mp-badge mp-red">RED GOBLIN</span>';
    return '<span class="mp-badge mp-regular">REGULAR</span>';
  }

  function injectStyles() {
    if (document.getElementById('masterpieceStyles')) return;
    const style = document.createElement('style');
    style.id = 'masterpieceStyles';
    style.textContent = `
      .mp-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:18px;margin:18px 0 24px}.mp-card{padding:20px;border-radius:22px}.mp-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:16px}.mp-head h2,.mp-head h3{margin:4px 0 0}.mp-count{font-size:12px;opacity:.72}.mp-apps{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.mp-app{padding:7px 10px;border:1px solid rgba(255,255,255,.1);border-radius:999px;font-size:12px;background:rgba(255,255,255,.035)}.mp-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.mp-board{border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:14px;background:rgba(5,12,24,.42)}.mp-board h3{margin:0 0 10px;font-size:15px}.mp-prop{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:11px 0;border-top:1px solid rgba(255,255,255,.07)}.mp-prop:first-of-type{border-top:0}.mp-prop b{display:block;font-size:13px}.mp-prop span{font-size:11px;opacity:.72}.mp-score{text-align:right}.mp-score strong{display:block;font-size:16px}.mp-badge{display:inline-flex;padding:3px 7px;border-radius:999px;font-size:9px!important;font-weight:800;letter-spacing:.07em;opacity:1!important;margin-left:5px}.mp-green{background:rgba(71,255,146,.14);color:#77ffad;border:1px solid rgba(71,255,146,.28)}.mp-red{background:rgba(255,80,104,.14);color:#ff8a9b;border:1px solid rgba(255,80,104,.28)}.mp-regular{background:rgba(103,166,255,.12);color:#9ec4ff;border:1px solid rgba(103,166,255,.24)}.mp-search-row{display:grid;grid-template-columns:1fr auto;gap:10px}.mp-search-row input{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(2,8,18,.65);color:inherit;font:inherit}.mp-results{margin-top:12px;display:grid;gap:8px;max-height:420px;overflow:auto}.mp-result{width:100%;text-align:left;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:inherit;border-radius:14px;padding:12px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;cursor:pointer}.mp-result:hover{border-color:rgba(255,255,255,.2)}.mp-result b{display:block}.mp-result small{display:block;margin-top:4px;opacity:.68}.mp-focus-output{margin-top:14px;padding:14px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}.mp-focus-output.pass{border-color:rgba(71,255,146,.35)}.mp-focus-output.fail{border-color:rgba(255,80,104,.35)}.mp-pay-link{display:inline-flex;margin-top:12px;text-decoration:none}.mp-muted{font-size:12px;opacity:.65;line-height:1.5}.mp-empty{font-size:12px;opacity:.58;padding:14px 0}@media(max-width:900px){.mp-grid,.mp-columns{grid-template-columns:1fr}.mp-search-row{grid-template-columns:1fr}.mp-card{padding:16px}}
    `;
    document.head.appendChild(style);
  }

  function ensureUI() {
    if (document.getElementById('masterpiecePanel')) return;
    const anchor = document.querySelector('.kpis');
    if (!anchor) return;
    const wrap = document.createElement('section');
    wrap.id = 'masterpiecePanel';
    wrap.className = 'mp-grid';
    wrap.innerHTML = `
      <section class="glass mp-card">
        <div class="mp-head"><div><span class="eyebrow">MASTERPIECE MARKET MATRIX</span><h2>Best lines across PickFinder</h2></div><span id="mpUniverseCount" class="mp-count">Waiting for scan</span></div>
        <div class="mp-columns">
          <div class="mp-board"><h3>🟢 Best Green Goblins</h3><div id="mpGreen"><div class="mp-empty">Run a live scan to rank green lines.</div></div></div>
          <div class="mp-board"><h3>🔴 Best Red Goblins</h3><div id="mpRed"><div class="mp-empty">Run a live scan to rank red lines.</div></div></div>
        </div>
        <div id="mpApps" class="mp-apps"></div>
      </section>
      <section class="glass mp-card">
        <div class="mp-head"><div><span class="eyebrow">FOCUSED PROP LAB</span><h2>Search → choose → deep scan</h2></div></div>
        <p class="mp-muted">Search a player or prop across the books PickFinder exposes. Select the exact line and AutoProp will open that prop alone, apply its available filters, and automatically undo any dropdown that makes the analytics disappear.</p>
        <form id="mpSearchForm" class="mp-search-row"><input id="mpSearchInput" type="search" placeholder="Search player or prop…" minlength="2" autocomplete="off"/><button class="primary-button" type="submit">Search props</button></form>
        <div id="mpSearchState" class="mp-muted" style="margin-top:9px"></div>
        <div id="mpSearchResults" class="mp-results"></div>
        <div id="mpFocusOutput"></div>
        <a class="ghost-button mp-pay-link" href="/checkout.html">Open PayPal / card checkout</a>
      </section>`;
    anchor.insertAdjacentElement('afterend', wrap);
    document.getElementById('mpSearchForm')?.addEventListener('submit', searchProps);
  }

  function propRows(rows = []) {
    if (!rows.length) return '<div class="mp-empty">No matching Goblin lines found in the latest live scan.</div>';
    return rows.slice(0, 8).map((p) => `<div class="mp-prop"><div><b>${esc(p.player)} • ${esc(p.pick)} ${fmt(p.line)}</b><span>${esc(p.sourceApp || 'PickFinder')} • ${esc(p.sport)} • ${esc(p.prop)} ${lineBadge(p.lineType)}</span></div><div class="mp-score"><strong>${fmt(p.confidence,'%')}</strong><span>${p.qualified ? 'qualified' : 'research rank'}</span></div></div>`).join('');
  }

  function renderMarket(latest) {
    const apps = (latest?.appInventory || []).filter((row) => row.available);
    document.getElementById('mpUniverseCount').textContent = `${apps.length || '—'} apps • ${fmt(latest?.totalReviewed)} props reviewed`;
    document.getElementById('mpApps').innerHTML = apps.length ? apps.map((row) => `<span class="mp-app">${esc(row.app)}${row.modifiers?.length ? ` • ${row.modifiers.length} modifiers` : ''}</span>`).join('') : '<span class="mp-empty">App inventory populates from PickFinder at scan time.</span>';
    const picks = latest?.picks || [];
    const green = latest?.greenGoblins?.length ? latest.greenGoblins : picks.filter((p) => p.lineType === 'GREEN_GOBLIN').sort((a,b) => Number(b.qualified)-Number(a.qualified) || Number(b.confidence||0)-Number(a.confidence||0));
    const red = latest?.redGoblins?.length ? latest.redGoblins : picks.filter((p) => p.lineType === 'RED_GOBLIN').sort((a,b) => Number(b.qualified)-Number(a.qualified) || Number(b.confidence||0)-Number(a.confidence||0));
    document.getElementById('mpGreen').innerHTML = propRows(green);
    document.getElementById('mpRed').innerHTML = propRows(red);
  }

  async function searchProps(event) {
    event.preventDefault();
    const input = document.getElementById('mpSearchInput');
    const state = document.getElementById('mpSearchState');
    const results = document.getElementById('mpSearchResults');
    const query = String(input?.value || '').trim();
    if (query.length < 2) { state.textContent = 'Type at least 2 characters.'; return; }
    state.textContent = 'Searching the live PickFinder board across available apps…';
    results.innerHTML = '';
    document.getElementById('mpFocusOutput').innerHTML = '';
    try {
      const response = await fetch(`/api/prop-search?q=${encodeURIComponent(query)}`, { cache:'no-store', credentials:'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Search failed.');
      state.textContent = `${data.results?.length || 0} matching lines found across ${data.appsSearched || 0} app slots. Tap one to scan only that prop.`;
      results.innerHTML = (data.results || []).map((p) => `<button class="mp-result" type="button" data-id="${esc(p.id)}"><div><b>${esc(p.player)} — ${esc(p.prop)} ${fmt(p.line)}</b><small>${esc(p.sourceApp)} • ${esc(p.sport)} • ${esc(p.pick)} ${lineBadge(p.lineType)}</small></div><span>Scan this prop →</span></button>`).join('') || '<div class="mp-empty">No matches found.</div>';
      results.querySelectorAll('[data-id]').forEach((button) => button.addEventListener('click', () => focusedScan(button.dataset.id, button)));
    } catch (error) { state.textContent = error.message || 'Search failed.'; }
  }

  async function focusedScan(id, button) {
    const output = document.getElementById('mpFocusOutput');
    const old = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<div><b>Deep-scanning this line…</b><small>Opening full analysis + adaptive dropdown audit</small></div><span>Working</span>';
    output.innerHTML = '';
    try {
      const response = await fetch('/api/scan-prop', { method:'POST', credentials:'same-origin', headers:{'content-type':'application/json'}, body:JSON.stringify({ id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Focused scan failed.');
      const p = data.pick;
      const removed = (p.filterAudit || []).filter((row) => row.removedBecauseDataDisappeared);
      output.innerHTML = `<div class="mp-focus-output ${p.qualified ? 'pass' : 'fail'}"><span class="eyebrow">${p.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'} • FOCUSED SCAN</span><h3>${esc(p.player)} — ${esc(p.pick)} ${fmt(p.line)}</h3><p>${esc(p.sourceApp)} • ${esc(p.sport)} • ${esc(p.prop)} ${lineBadge(p.lineType)}</p><p><b>${fmt(p.confidence,'%')} research confidence</b> • L5 ${fmt(p.l5,'%')} • L10 ${fmt(p.l10,'%')} • L15 ${fmt(p.l15,'%')} • H2H ${fmt(p.h2h,'%')}</p>${p.failures?.length ? `<p class="warning">${p.failures.map(esc).join(' • ')}</p>` : ''}${removed.length ? `<p class="mp-muted">Auto-removed ${removed.length} filter${removed.length===1?'':'s'} because applying them made the prop analytics disappear: ${removed.map((r)=>esc(r.label)).join(', ')}.</p>` : ''}</div>`;
    } catch (error) {
      output.innerHTML = `<div class="mp-focus-output fail"><b>Focused scan failed</b><p class="mp-muted">${esc(error.message || 'Unknown error')}</p></div>`;
    } finally { button.disabled = false; button.innerHTML = old; }
  }

  async function refresh() {
    ensureUI();
    try {
      const response = await fetch('/api/status', { cache:'no-store', credentials:'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      const sig = `${data.latest?.scannedAt || ''}:${data.latest?.totalReviewed || 0}:${data.latest?.greenGoblins?.length || 0}:${data.latest?.redGoblins?.length || 0}`;
      if (sig !== latestSignature) { latestSignature = sig; renderMarket(data.latest); }
    } catch {}
  }

  injectStyles();
  const boot = setInterval(() => { ensureUI(); if (document.getElementById('masterpiecePanel')) { clearInterval(boot); refresh(); setInterval(refresh, 7000); } }, 250);
})();
