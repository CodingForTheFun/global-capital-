const $ = (id) => document.getElementById(id);
const state = { me: null, members: [], access: new Map(), audit: [], csrf: '', busy: new Set() };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function when(value, fallback = 'Never') {
  const d = new Date(value || '');
  if (!Number.isFinite(d.getTime())) return fallback;
  return d.toLocaleString([], { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function shortWhen(value, fallback = '—') {
  const d = new Date(value || '');
  if (!Number.isFinite(d.getTime())) return fallback;
  return d.toLocaleDateString([], { year:'numeric', month:'short', day:'numeric' });
}
function notice(text, type = '') {
  const el = $('notice');
  if (!text) { el.className = 'notice hidden'; el.textContent = ''; return; }
  el.className = `notice ${type}`.trim();
  el.textContent = text;
}
async function request(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || `Request failed (${response.status}).`);
  return data;
}
async function post(path, body) {
  return request(path, {
    method:'POST',
    headers:{ 'content-type':'application/json', 'x-csrf-token': state.csrf },
    body:JSON.stringify(body),
  });
}
function activeAccess(userId) {
  return state.access.get(userId) || { plan:'free', planName:'Free', expiresAt:null, source:null };
}
function isPro(access) { return access?.plan === 'pro'; }
function processorManaged(access) { return isPro(access) && Boolean(access?.source) && access.source !== 'owner-console'; }
function isOnline(member) { return member?.presence === 'ONLINE'; }
function accessLabel(access) {
  if (!isPro(access)) return 'Free';
  return access.expiresAt ? `Pro until ${shortWhen(access.expiresAt)}` : 'Pro';
}
function sourceLabel(source) {
  if (!source) return 'No paid access';
  if (source === 'owner-console') return 'Owner granted';
  return 'Billing managed';
}

function renderKpis(overview) {
  const members = state.members;
  $('kpiTotal').textContent = overview?.counts?.total ?? members.length;
  $('kpiOnline').textContent = overview?.counts?.online ?? members.filter(isOnline).length;
  $('kpiPro').textContent = members.filter((m) => isPro(activeAccess(m.id))).length;
  $('kpiBanned').textContent = overview?.counts?.disabled ?? members.filter((m) => m.disabled).length;
}

function memberMatches(member) {
  const q = $('searchInput').value.trim().toLowerCase();
  const filter = $('statusFilter').value;
  const access = activeAccess(member.id);
  if (q && !String(member.email || '').toLowerCase().includes(q)) return false;
  if (filter === 'online' && !isOnline(member)) return false;
  if (filter === 'pro' && !isPro(access)) return false;
  if (filter === 'banned' && !member.disabled) return false;
  if (filter === 'owner' && member.role !== 'owner') return false;
  if (filter === 'support' && member.role !== 'support') return false;
  return true;
}

function renderMembers() {
  const root = $('members');
  const rows = state.members.filter(memberMatches);
  if (!rows.length) {
    root.innerHTML = '<div class="empty">No accounts match this filter.</div>';
    return;
  }
  root.innerHTML = rows.map((m) => {
    const access = activeAccess(m.id);
    const own = m.id === state.me?.id;
    const busy = state.busy.has(m.id);
    const managed = processorManaged(access);
    const devices = Array.isArray(m.devices) ? m.devices : [];
    const accessAction = isPro(access) ? 'extend' : 'grant';
    const status = m.disabled ? '<span class="pill banned">BANNED</span>'
      : m.presence === 'ONLINE' ? '<span class="pill online">ONLINE</span>'
      : m.presence === 'IDLE' ? '<span class="pill idle">IDLE</span>'
      : '<span class="pill">OFFLINE</span>';
    const role = own || m.role === 'owner'
      ? '<span class="pill owner">OWNER</span>'
      : m.role === 'support'
        ? '<span class="pill pro">SUPPORT</span>'
        : '<span class="pill">MEMBER</span>';
    const plan = isPro(access) ? '<span class="pill pro">PRO</span>' : '<span class="pill">FREE</span>';
    const deviceHtml = devices.length ? devices.map((d) => `
      <div class="device">
        <b>${esc(d.device || 'Device')} · ${esc(d.presence || 'OFFLINE')}</b>
        <span>Last seen ${esc(when(d.lastSeenAt))}</span>
        <span>IP ${esc(d.ip || 'Unavailable')}</span>
        <button class="btn small" data-action="revoke-device" data-user="${esc(m.id)}" data-session="${esc(d.id)}" ${busy ? 'disabled' : ''}>Sign out device</button>
      </div>`).join('') : '<div class="device"><b>No active devices</b><span>This account has no live sessions.</span></div>';
    const accessButtons = managed
      ? '<span class="pill pro">MANAGED BY BILLING</span>'
      : `<button class="btn small good" data-action="access" data-mode="${accessAction}" data-days="7" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>+7d</button>
        <button class="btn small good" data-action="access" data-mode="${accessAction}" data-days="30" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>+30d</button>
        <button class="btn small good" data-action="access" data-mode="${accessAction}" data-days="90" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>+90d</button>
        ${isPro(access) ? `<button class="btn small" data-action="revoke-access" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>Remove Pro</button>` : ''}`;
    const roleButton = own
      ? '<button class="btn small" disabled>Protected owner</button>'
      : m.role === 'support'
        ? `<button class="btn small" data-action="role" data-user="${esc(m.id)}" data-role="member" ${busy ? 'disabled' : ''}>Remove Support</button>`
        : `<button class="btn small" data-action="role" data-user="${esc(m.id)}" data-role="support" ${busy ? 'disabled' : ''}>Make Support</button>`;
    return `<article class="member" data-user-row="${esc(m.id)}">
      <div class="account">
        <strong>${esc(m.email)}</strong>
        <span>Joined ${esc(shortWhen(m.createdAt))} · ${esc(sourceLabel(access.source))}</span>
        <div class="status-line" style="margin-top:7px">${status}${role}${plan}${own ? '<span class="pill">YOU</span>' : ''}</div>
      </div>
      <div class="metric"><span>Access</span><strong>${esc(accessLabel(access))}</strong></div>
      <div class="metric"><span>Last seen</span><strong>${esc(when(m.lastSeenAt))}</strong></div>
      <div class="metric"><span>Sessions</span><strong>${Number(m.activeSessions || devices.length || 0)}</strong></div>
      <div class="actions">
        ${accessButtons}
        <button class="btn small ${m.disabled ? 'good' : 'danger'}" data-action="ban" data-user="${esc(m.id)}" data-disabled="${m.disabled ? 'false' : 'true'}" ${busy || own ? 'disabled' : ''}>${m.disabled ? 'Restore' : 'Ban'}</button>
        ${roleButton}
      </div>
      <details class="more"><summary>${devices.length} active device${devices.length === 1 ? '' : 's'} · account details</summary><div class="more-grid">${deviceHtml}</div></details>
    </article>`;
  }).join('');
}

// The audit endpoint has existed and been owner-gated since the console was
// built, and nothing ever called it. The access guide promises every action is
// logged; until now there was no way to read that log.
function actionLabel(action) {
  const map = {
    'owner.session.revoke':'Signed out a device', 'owner.member.disable':'Banned an account',
    'owner.member.enable':'Restored an account', 'owner.member.role':'Changed a role',
    'owner.access.grant':'Granted Pro access', 'owner.access.extend':'Extended Pro access',
    'owner.access.revoke':'Removed Pro access',
  };
  return map[action] || String(action || 'Action').replace(/^owner\./, '').replace(/[._]/g, ' ');
}
function emailFor(userId) {
  const member = state.members.find((m) => m.id === userId);
  return member?.email || null;
}
function renderAudit() {
  const root = $('auditList');
  if (!root) return;
  const entries = state.audit;
  $('auditSummary').textContent = entries.length ? `${entries.length} recorded` : 'Nothing recorded yet';
  if (!entries.length) {
    // An empty log is a real state, not a failure: no owner action has been
    // taken since logging began.
    root.innerHTML = '<div class="empty">No owner actions recorded yet. Actions you take here will appear immediately.</div>';
    return;
  }
  root.innerHTML = entries.slice(0, 40).map((row) => {
    const failed = row.outcome && row.outcome !== 'success';
    const target = emailFor(row.targetId);
    return `<div class="feed-row${failed ? ' feed-row-bad' : ''}">
      <div class="feed-main">
        <b>${esc(actionLabel(row.action))}</b>
        <span>${esc(target || row.targetId || 'No target')}</span>
      </div>
      <div class="feed-side">
        <span class="pill${failed ? ' banned' : ''}">${esc(String(row.outcome || 'success').toUpperCase())}</span>
        <span>${esc(when(row.at))}</span>
      </div>
    </div>`;
  }).join('');
}

// Built from accounts already loaded, so it costs no extra request.
function renderRecentSignups() {
  const root = $('recentSignups');
  if (!root) return;
  const rows = state.members
    .filter((m) => Number.isFinite(Date.parse(m.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 6);
  if (!rows.length) { root.innerHTML = '<div class="empty">No accounts yet.</div>'; return; }
  root.innerHTML = rows.map((m) => {
    const access = activeAccess(m.id);
    const status = m.disabled ? '<span class="pill banned">BANNED</span>'
      : isOnline(m) ? '<span class="pill online">ONLINE</span>'
      : '<span class="pill">OFFLINE</span>';
    return `<div class="feed-row">
      <div class="feed-main"><b>${esc(m.email)}</b><span>Joined ${esc(shortWhen(m.createdAt))}</span></div>
      <div class="feed-side">${isPro(access) ? '<span class="pill pro">PRO</span>' : '<span class="pill">FREE</span>'}${status}</div>
    </div>`;
  }).join('');
}

async function loadHealth() {
  const [app, account] = await Promise.all([
    request('/api/health').catch(() => null),
    request('/api/account/health').catch(() => null),
  ]);
  const healthy = Boolean(app?.ok);
  $('systemBadge').className = `system-badge ${healthy ? 'ok' : 'bad'}`;
  $('systemBadge').querySelector('span').textContent = healthy ? 'Production responding' : 'Production needs attention';
  $('healthApp').textContent = healthy ? 'Healthy' : 'Unavailable';
  $('healthAccounts').textContent = account?.ok ? 'Ready' : 'Unavailable';
  $('healthAsk').textContent = account?.features?.ask ? 'Enabled' : 'Not enabled';
  $('healthProjections').textContent = account?.features?.projections ? 'Enabled' : 'Not enabled';
}

async function loadDashboard({ quiet = false } = {}) {
  if (!quiet) notice('');
  const me = await request('/api/account/me');
  // The page and script are already protected by the server-side designated
  // owner check. Do not trust a stale role string from older account storage.
  if (!me.authenticated) {
    $('dashboard').classList.add('hidden');
    $('accessDenied').classList.remove('hidden');
    $('ownerIdentity').textContent = 'Signed out';
    return;
  }
  state.me = me.user;
  state.csrf = me.csrfToken || '';
  $('ownerIdentity').textContent = me.user.email;
  $('accessDenied').classList.add('hidden');
  $('dashboard').classList.remove('hidden');

  const [overview, memberData, entitlementData, auditData] = await Promise.all([
    request('/api/admin/overview'),
    request('/api/admin/members'),
    request('/api/admin/entitlements'),
    // The log is useful but never worth blanking the console over.
    request('/api/admin/audit').catch(() => null),
  ]);
  state.members = Array.isArray(memberData.members) ? memberData.members : [];
  state.access = new Map((entitlementData.entitlements || []).map((row) => [row.userId, row.access]));
  state.audit = Array.isArray(auditData?.entries) ? auditData.entries : [];
  renderKpis(overview);
  renderMembers();
  renderRecentSignups();
  renderAudit();
  $('lastRefresh').textContent = `Updated ${new Date().toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}`;
  await loadHealth();
}

async function runMemberAction(button) {
  const userId = button.dataset.user;
  if (!userId || state.busy.has(userId)) return;
  state.busy.add(userId);
  renderMembers();
  try {
    const action = button.dataset.action;
    let result;
    if (action === 'access') {
      result = await post('/api/admin/member/access', { userId, action:button.dataset.mode || 'grant', days:Number(button.dataset.days) });
    } else if (action === 'revoke-access') {
      result = await post('/api/admin/member/access', { userId, action:'revoke' });
    } else if (action === 'ban') {
      result = await post('/api/admin/member/disable', { userId, disabled:button.dataset.disabled === 'true' });
    } else if (action === 'role') {
      result = await post('/api/admin/member/role', { userId, role:button.dataset.role });
    } else if (action === 'revoke-device') {
      result = await post('/api/admin/session/revoke', { sessionId:button.dataset.session });
    } else {
      return;
    }
    notice(result?.message || 'Updated.', 'success');
    await loadDashboard({ quiet:true });
  } catch (error) {
    notice(error.message || 'That update failed.', 'error');
  } finally {
    state.busy.delete(userId);
    renderMembers();
  }
}

$('members').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) runMemberAction(button);
});
document.querySelectorAll('[data-quick]').forEach((button) => {
  button.addEventListener('click', () => {
    const preset = button.dataset.quick;
    $('statusFilter').value = preset === 'pro' ? 'all' : preset;
    $('searchInput').value = '';
    renderMembers();
    document.getElementById('members')?.scrollIntoView({ behavior:'smooth', block:'start' });
  });
});
$('searchInput').addEventListener('input', renderMembers);
$('statusFilter').addEventListener('change', renderMembers);
$('refreshBtn').addEventListener('click', () => loadDashboard().catch((e) => notice(e.message, 'error')));

loadDashboard().catch((error) => {
  $('dashboard').classList.add('hidden');
  notice(error.message || 'Owner control center could not load.', 'error');
  $('accessDenied').classList.remove('hidden');
});
