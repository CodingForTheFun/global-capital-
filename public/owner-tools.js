(() => {
  const realFetch = window.fetch.bind(window);
  let role = null;
  let inviteField = null;
  let rulesEnabled = false;
  let boardCount = 0;

  function rebuiltJsonResponse(response, data) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  function pickKey(pick = {}) {
    return String(pick.id || pick.sourceUrl || [pick.sourceApp, pick.player, pick.prop, pick.line, pick.pick, pick.lineType].join('|')).toLowerCase();
  }

  function mergeBoardIntoStatus(data) {
    if (!data || typeof data !== 'object') return data;
    if (data.rules && typeof data.rules.rulesEnabled === 'boolean') rulesEnabled = data.rules.rulesEnabled;
    const latest = data.latest;
    if (!latest || !Array.isArray(latest.boardProps) || !latest.boardProps.length) {
      boardCount = Array.isArray(latest?.picks) ? latest.picks.length : 0;
      setTimeout(syncRuleUi, 0);
      return data;
    }

    const researched = new Map((latest.picks || []).map((pick) => [pickKey(pick), pick]));
    const board = latest.boardProps.map((raw) => {
      const match = researched.get(pickKey(raw));
      const combined = match ? { ...raw, ...match, boardVisible: true } : { ...raw, boardVisible: true };
      if (!rulesEnabled) {
        combined.qualified = false;
        combined.bestAvailable = false;
        combined.failures = [];
        combined.warnings = [];
        combined.rulesApplied = false;
        combined.unfiltered = true;
      }
      return combined;
    });

    boardCount = board.length;
    latest.picks = board;
    latest.totalReviewed = board.length;
    latest.suppressedMalformedCount = 0;
    if (!rulesEnabled) {
      latest.qualifiedCount = 0;
      latest.rejectedCount = 0;
      latest.bestAvailable = [];
      latest.diversifiedCard = [];
      latest.warnings = [`Rules are OFF. Showing all ${board.length} props discovered from PickFinder. Turn Rules ON when you want qualification filters applied.`];
    } else {
      latest.warnings = (latest.warnings || []).filter((warning) => !/malformed scraper records were hidden/i.test(String(warning)));
    }
    setTimeout(syncRuleUi, 0);
    return data;
  }

  window.fetch = async (input, init = {}) => {
    let url = '';
    try {
      url = typeof input === 'string' ? input : input?.url || '';
      if (url.endsWith('/api/auth/register') && init?.body) {
        const parsed = JSON.parse(init.body);
        if (!parsed.accessCode && inviteField) parsed.accessCode = inviteField.value;
        init = { ...init, body: JSON.stringify(parsed) };
      }
    } catch {}

    const response = await realFetch(input, init);
    try {
      const pathname = new URL(url, window.location.origin).pathname;
      if (response.ok && pathname === '/api/status') {
        const data = mergeBoardIntoStatus(await response.clone().json());
        return rebuiltJsonResponse(response, data);
      }
      if (response.ok && pathname === '/api/rules') {
        const data = await response.clone().json();
        if (data?.rules && typeof data.rules.rulesEnabled === 'boolean') {
          rulesEnabled = data.rules.rulesEnabled;
          setTimeout(syncRuleUi, 0);
        }
      }
    } catch {}
    return response;
  };

  function ensureInviteField() {
    const form = document.getElementById('authForm');
    if (!form || document.getElementById('authAccessCode')) return;
    const label = document.createElement('label');
    label.id = 'authAccessCodeWrap';
    label.style.display = 'none';
    label.innerHTML = 'Access code<input id="authAccessCode" type="text" autocomplete="one-time-code" placeholder="Owner code or friend invite code" required />';
    form.insertBefore(label, document.getElementById('authSubmit'));
    inviteField = document.getElementById('authAccessCode');
    const sync = () => {
      const creating = document.getElementById('registerTab')?.classList.contains('active');
      label.style.display = creating ? '' : 'none';
      inviteField.required = Boolean(creating);
      if (!creating) inviteField.value = '';
    };
    document.getElementById('loginTab')?.addEventListener('click', () => setTimeout(sync, 0));
    document.getElementById('registerTab')?.addEventListener('click', () => setTimeout(sync, 0));
    sync();
  }

  function ensureRulesToggle() {
    if (document.getElementById('rulesToggleBtn')) return;
    const rulesBtn = document.getElementById('rulesBtn');
    if (!rulesBtn?.parentElement) return;
    const button = document.createElement('button');
    button.id = 'rulesToggleBtn';
    button.type = 'button';
    button.className = 'secondary';
    button.style.minWidth = '132px';
    button.addEventListener('click', toggleRules);
    rulesBtn.parentElement.insertBefore(button, rulesBtn.nextSibling);

    const dialogBody = document.getElementById('rulesDialog')?.querySelector('.modal-body');
    if (dialogBody && !document.getElementById('rulesMasterSwitch')) {
      const row = document.createElement('div');
      row.className = 'connect-state';
      row.style.margin = '14px 0 18px';
      row.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px"><div><b>Apply rule qualification</b><br><span style="font-size:12px;opacity:.72">OFF keeps every discovered PickFinder prop visible. ON scores the same board against this profile.</span></div><button id="rulesMasterSwitch" class="secondary" type="button" style="white-space:nowrap">Rules OFF</button></div>`;
      const form = document.getElementById('rulesForm');
      dialogBody.insertBefore(row, form || null);
      document.getElementById('rulesMasterSwitch')?.addEventListener('click', toggleRules);
    }
    syncRuleUi();
  }

  async function toggleRules() {
    const buttons = [document.getElementById('rulesToggleBtn'), document.getElementById('rulesMasterSwitch')].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const current = await api('/api/rules');
      const next = { ...(current.rules || {}), rulesEnabled: !Boolean(current.rules?.rulesEnabled) };
      const saved = await api('/api/rules', { method:'PUT', body:JSON.stringify({ rules: next }) });
      rulesEnabled = Boolean(saved.rules?.rulesEnabled);
      syncRuleUi();
      if (!rulesEnabled) forceAllTab();
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = rulesEnabled ? 'Rules ON — qualification filters will be applied.' : 'Rules OFF — all PickFinder props stay visible.';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3200);
      }
    } catch (error) {
      alert(error.message);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function forceAllTab() {
    const all = document.querySelector('.segment[data-filter="all"]');
    if (all && !all.classList.contains('active')) all.click();
  }

  function syncRuleUi() {
    ensureRulesToggle();
    const top = document.getElementById('rulesToggleBtn');
    const modal = document.getElementById('rulesMasterSwitch');
    for (const button of [top, modal].filter(Boolean)) {
      button.textContent = `Rules ${rulesEnabled ? 'ON' : 'OFF'}`;
      button.classList.toggle('primary', rulesEnabled);
      button.classList.toggle('secondary', !rulesEnabled);
    }

    const qualified = document.querySelector('.segment[data-filter="qualified"]');
    const rejected = document.querySelector('.segment[data-filter="rejected"]');
    const all = document.querySelector('.segment[data-filter="all"]');
    if (qualified) {
      qualified.disabled = !rulesEnabled;
      qualified.textContent = rulesEnabled ? 'Qualified' : 'Rules off';
    }
    if (rejected) rejected.disabled = !rulesEnabled;
    if (all) all.textContent = rulesEnabled ? 'All' : 'All props';
    if (!rulesEnabled) forceAllTab();
    scrubRuleOffPresentation();
  }

  function scrubRuleOffPresentation() {
    if (rulesEnabled) return;
    document.querySelectorAll('.reject-tag').forEach((node) => {
      if (node.textContent !== 'UNFILTERED') node.textContent = 'UNFILTERED';
    });
    const qualifiedCount = document.getElementById('qualifiedCount');
    const rejectedCount = document.getElementById('rejectedCount');
    const bestConfidence = document.getElementById('bestConfidence');
    if (qualifiedCount) qualifiedCount.textContent = '—';
    if (rejectedCount) rejectedCount.textContent = '—';
    if (bestConfidence) bestConfidence.textContent = '—';
    const warning = document.getElementById('warningBox');
    if (warning && !warning.classList.contains('hidden') && /no props passed|malformed scraper records|rules are off/i.test(warning.textContent || '')) {
      warning.textContent = `Rules OFF • Showing all ${boardCount || 'discovered'} PickFinder props. Turn Rules ON to apply qualification filters.`;
    }
  }

  function makeOwnerDialog() {
    if (document.getElementById('ownerCodesDialog')) return;
    const account = document.getElementById('accountDialog')?.querySelector('.modal-body');
    if (account) {
      const btn = document.createElement('button');
      btn.id = 'ownerCodesBtn';
      btn.type = 'button';
      btn.className = 'primary full';
      btn.style.marginBottom = '10px';
      btn.textContent = 'Generate friend access codes';
      btn.hidden = true;
      btn.addEventListener('click', () => { document.getElementById('accountDialog')?.close(); openOwnerTools(); });
      account.insertBefore(btn, account.querySelector('#logoutBtn'));
    }

    const dialog = document.createElement('dialog');
    dialog.id = 'ownerCodesDialog';
    dialog.className = 'modal wide-modal';
    dialog.innerHTML = `<button class="modal-x" id="ownerCodesClose" type="button">×</button>
      <div class="modal-body"><span class="eyebrow">OWNER CONTROL</span><h2>Friend access codes</h2><p>Create codes your friends use once when creating their own AutoProp account. They will then connect their own PickFinder account.</p>
      <div class="rules-grid">
        <label>Label<input id="inviteLabel" type="text" value="Friend access" maxlength="80" /></label>
        <label>Expires in days<input id="inviteDays" type="number" min="1" max="90" value="30" /></label>
        <label>Max uses<input id="inviteUses" type="number" min="1" max="20" value="1" /></label>
        <div class="full-row"><button id="generateInviteBtn" class="primary" type="button">Generate code</button></div>
      </div>
      <div id="newInviteCode" class="connect-state hidden" style="margin-top:14px"></div>
      <h3 style="margin-top:22px">Active / recent codes</h3><div id="inviteCodeList" class="history-list"><p class="muted">Loading…</p></div></div>`;
    document.body.appendChild(dialog);
    document.getElementById('ownerCodesClose').addEventListener('click', () => dialog.close());
    document.getElementById('generateInviteBtn').addEventListener('click', generateCode);
  }

  async function api(url, options = {}) {
    const res = await realFetch(url, { credentials:'same-origin', cache:'no-store', headers: options.body ? {'content-type':'application/json'} : undefined, ...options });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  }

  async function refreshRole() {
    try {
      const data = await api('/api/auth/status');
      role = data.role || data.user?.role || null;
      const btn = document.getElementById('ownerCodesBtn');
      if (btn) btn.hidden = role !== 'owner';
    } catch {
      role = null;
    }
  }

  async function refreshRules() {
    try {
      const data = await api('/api/rules');
      rulesEnabled = Boolean(data.rules?.rulesEnabled);
      syncRuleUi();
    } catch {}
  }

  async function openOwnerTools() {
    if (role !== 'owner') return;
    const dialog = document.getElementById('ownerCodesDialog');
    dialog?.showModal();
    await loadCodes();
  }

  async function generateCode() {
    const btn = document.getElementById('generateInviteBtn');
    btn.disabled = true;
    try {
      const data = await api('/api/access-codes/generate', { method:'POST', body: JSON.stringify({
        label: document.getElementById('inviteLabel').value,
        expiresInDays: Number(document.getElementById('inviteDays').value),
        maxUses: Number(document.getElementById('inviteUses').value),
      }) });
      const box = document.getElementById('newInviteCode');
      box.classList.remove('hidden');
      box.innerHTML = `<b style="font-size:18px;letter-spacing:.08em">${data.code}</b><br><span>Copy this now. For security, the full code is only shown once.</span>`;
      await navigator.clipboard?.writeText(data.code).catch(() => {});
      await loadCodes();
    } catch (e) {
      const box = document.getElementById('newInviteCode');
      box.classList.remove('hidden');
      box.textContent = e.message;
    } finally { btn.disabled = false; }
  }

  async function loadCodes() {
    const node = document.getElementById('inviteCodeList');
    try {
      const data = await api('/api/access-codes');
      const rows = data.codes || [];
      node.innerHTML = rows.length ? rows.map(row => `<div class="history-row"><div><b>${escapeHtml(row.label || 'Friend access')} • ${escapeHtml(row.hint || '')}</b><span>${row.active ? 'Active' : 'Revoked'} • ${row.uses || 0}/${row.maxUses || 1} uses • expires ${new Date(row.expiresAt).toLocaleDateString()}</span></div>${row.active ? `<button class="mini-btn" data-revoke="${row.id}" type="button">Revoke</button>` : ''}</div>`).join('') : '<p class="muted">No friend codes yet.</p>';
      node.querySelectorAll('[data-revoke]').forEach(btn => btn.addEventListener('click', async () => { try { await api('/api/access-codes/revoke',{method:'POST',body:JSON.stringify({id:btn.dataset.revoke})}); await loadCodes(); } catch(e){ alert(e.message); } }));
    } catch (e) { node.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
  }

  function escapeHtml(v='') { return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  document.addEventListener('DOMContentLoaded', () => {
    ensureInviteField();
    ensureRulesToggle();
    makeOwnerDialog();
    refreshRole();
    refreshRules();
    const observer = new MutationObserver(() => {
      if (!rulesEnabled) scrubRuleOffPresentation();
    });
    observer.observe(document.body, { childList:true, subtree:true });
    setInterval(refreshRole, 7000);
  });
})();
