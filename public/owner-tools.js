(() => {
  const realFetch = window.fetch.bind(window);
  let role = null;
  let inviteField = null;

  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.endsWith('/api/auth/register') && init?.body) {
        const parsed = JSON.parse(init.body);
        if (!parsed.accessCode && inviteField) parsed.accessCode = inviteField.value;
        init = { ...init, body: JSON.stringify(parsed) };
      }
    } catch {}
    return realFetch(input, init);
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
    makeOwnerDialog();
    refreshRole();
    setInterval(refreshRole, 7000);
  });
})();
