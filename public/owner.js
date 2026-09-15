const $ = (id) => document.getElementById(id);
const state = { me: null, members: [], access: new Map(), codes: [], csrf: '', busy: new Set(), codeBusy: new Set(), generatedCode: '' };

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
  return access.expiresAt ? `Pro until ${shortWhen(access.expiresAt)}` : 'Pro · Unlimited';
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
      : `<button class="btn small good" data-action="access" data-mode="${accessAction}" data-days="3" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>+3d</button>
        <button class="btn small good" data-action="access" data-mode="${accessAction}" data-days="30" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>+30d</button>
        <button class="btn small good" data-action="access" data-mode="${accessAction}" data-days="365" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>+1y</button>
        <button class="btn small good" data-action="access" data-mode="${accessAction}" data-unlimited="true" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>Unlimited</button>
        <button class="btn small" data-action="access" data-mode="${accessAction}" data-days="custom" data-user="${esc(m.id)}" ${busy ? 'disabled' : ''}>Custom</button>
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

function codeExpiry(code) {
  if (code?.neverExpires || !code?.expiresAt) return 'Unlimited';
  return shortWhen(code.expiresAt, 'Unknown');
}
function codeUsage(code) {
  if (code?.unlimitedUses || code?.maxUses === null) return `${Number(code?.uses || 0)} used · unlimited`;
  return `${Number(code?.uses || 0)} / ${Number(code?.maxUses || 0)} used`;
}
function renderCodes() {
  const root = $('accessCodes');
  const active = state.codes.filter((code) => code.active !== false).length;
  $('codeCount').textContent = `${active} active · ${state.codes.length} total`;
  if (!state.codes.length) {
    root.innerHTML = '<div class="empty">No access codes yet. Generate the first one above.</div>';
    return;
  }
  root.innerHTML = state.codes.map((code) => {
    const busy = state.codeBusy.has(code.id);
    const status = code.active === false ? '<span class="pill banned">INACTIVE</span>' : '<span class="pill online">ACTIVE</span>';
    return `<article class="code-row">
      <div class="code-main">
        <strong>${esc(code.label || 'Access')}</strong>
        <code>${esc(code.hint || '••••')}</code>
        <div class="status-line">${status}${code.neverExpires ? '<span class="pill pro">UNLIMITED TIME</span>' : ''}${code.unlimitedUses ? '<span class="pill pro">UNLIMITED USES</span>' : ''}</div>
      </div>
      <div class="metric"><span>Expires</span><strong>${esc(codeExpiry(code))}</strong></div>
      <div class="metric"><span>Redemptions</span><strong>${esc(codeUsage(code))}</strong></div>
      <div class="metric"><span>Last used</span><strong>${esc(when(code.lastUsedAt, 'Never'))}</strong></div>
      <div class="actions"><button class="btn small danger" data-code-action="revoke" data-code="${esc(code.id)}" ${busy || code.active === false ? 'disabled' : ''}>Revoke</button></div>
    </article>`;
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

  const [overview, memberData, entitlementData, codeData] = await Promise.all([
    request('/api/admin/overview'),
    request('/api/admin/members'),
    request('/api/admin/entitlements'),
    request('/api/admin/access-codes'),
  ]);
  state.members = Array.isArray(memberData.members) ? memberData.members : [];
  state.access = new Map((entitlementData.entitlements || []).map((row) => [row.userId, row.access]));
  state.codes = Array.isArray(codeData.codes) ? codeData.codes : [];
  renderKpis(overview);
  renderMembers();
  renderCodes();
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
      let days = button.dataset.days;
      const unlimited = button.dataset.unlimited === 'true';
      if (!unlimited && days === 'custom') {
        const entered = window.prompt('How many days of complimentary Pro access? Enter 1–3650.', '14');
        if (entered === null) return;
        const parsed = Math.trunc(Number(entered));
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) throw new Error('Enter a whole number from 1 to 3650 days.');
        days = parsed;
      }
      result = await post('/api/admin/member/access', {
        userId,
        action:button.dataset.mode || 'grant',
        ...(unlimited ? { unlimited:true } : { days:Number(days) }),
      });
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

function syncCodeCustomFields() {
  $('customDurationWrap').classList.toggle('hidden', $('codeDuration').value !== 'custom');
  $('customUsesWrap').classList.toggle('hidden', $('codeUses').value !== 'custom');
}

async function generateCode(event) {
  event.preventDefault();
  const button = $('generateCodeBtn');
  if (button.disabled) return;
  const duration = $('codeDuration').value;
  const uses = $('codeUses').value;
  let expiresInDays = null;
  let maxUses = null;
  const neverExpires = duration === 'unlimited';
  const unlimitedUses = uses === 'unlimited';

  if (!neverExpires) {
    expiresInDays = Math.trunc(Number(duration === 'custom' ? $('codeCustomDays').value : duration));
    if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
      notice('Choose a duration from 1 to 3650 days, or Unlimited.', 'error');
      return;
    }
  }
  if (!unlimitedUses) {
    maxUses = Math.trunc(Number(uses === 'custom' ? $('codeCustomUses').value : uses));
    if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 100000) {
      notice('Choose between 1 and 100000 redemptions, or Unlimited.', 'error');
      return;
    }
  }

  button.disabled = true;
  notice('');
  try {
    const result = await post('/api/admin/access-codes/generate', {
      label:$('codeLabel').value.trim() || 'Trial access',
      expiresInDays,
      neverExpires,
      maxUses,
      unlimitedUses,
    });
    state.generatedCode = String(result.code || '');
    $('generatedCodeValue').textContent = state.generatedCode;
    $('generatedCode').classList.toggle('hidden', !state.generatedCode);
    notice(result.message || 'Access code generated.', 'success');
    const codeData = await request('/api/admin/access-codes');
    state.codes = Array.isArray(codeData.codes) ? codeData.codes : [];
    renderCodes();
  } catch (error) {
    notice(error.message || 'Could not generate the access code.', 'error');
  } finally {
    button.disabled = false;
  }
}

async function copyGeneratedCode() {
  if (!state.generatedCode) return;
  try {
    await navigator.clipboard.writeText(state.generatedCode);
    notice('Access code copied.', 'success');
  } catch {
    const area = document.createElement('textarea');
    area.value = state.generatedCode;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    notice(ok ? 'Access code copied.' : 'Copy the code manually.', ok ? 'success' : 'error');
  }
}

async function runCodeAction(button) {
  const id = button.dataset.code;
  if (!id || state.codeBusy.has(id)) return;
  state.codeBusy.add(id);
  renderCodes();
  try {
    const result = await post('/api/admin/access-codes/revoke', { id });
    notice(result.message || 'Access code revoked.', 'success');
    const codeData = await request('/api/admin/access-codes');
    state.codes = Array.isArray(codeData.codes) ? codeData.codes : [];
  } catch (error) {
    notice(error.message || 'Could not revoke that access code.', 'error');
  } finally {
    state.codeBusy.delete(id);
    renderCodes();
  }
}

$('members').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) runMemberAction(button);
});
$('accessCodes').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-code-action]');
  if (button) runCodeAction(button);
});
$('searchInput').addEventListener('input', renderMembers);
$('statusFilter').addEventListener('change', renderMembers);
$('codeDuration').addEventListener('change', syncCodeCustomFields);
$('codeUses').addEventListener('change', syncCodeCustomFields);
$('codeForm').addEventListener('submit', generateCode);
$('copyGeneratedCode').addEventListener('click', copyGeneratedCode);
$('refreshBtn').addEventListener('click', () => loadDashboard().catch((e) => notice(e.message, 'error')));
syncCodeCustomFields();

loadDashboard().catch((error) => {
  $('dashboard').classList.add('hidden');
  notice(error.message || 'Owner control center could not load.', 'error');
  $('accessDenied').classList.remove('hidden');
});
