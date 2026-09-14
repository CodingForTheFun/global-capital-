const $ = (id) => document.getElementById(id);
const state = { me:null, csrf:'', members:[], busy:new Set() };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function when(value, fallback='Never') {
  const d = new Date(value || '');
  if (!Number.isFinite(d.getTime())) return fallback;
  return d.toLocaleString([], { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}
function shortWhen(value, fallback='—') {
  const d = new Date(value || '');
  if (!Number.isFinite(d.getTime())) return fallback;
  return d.toLocaleDateString([], { year:'numeric', month:'short', day:'numeric' });
}
function notice(text, type='') {
  const el = $('notice');
  if (!text) { el.className='notice hidden'; el.textContent=''; return; }
  el.className=`notice ${type}`.trim();
  el.textContent=text;
}
async function request(path, options={}) {
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || `Request failed (${response.status}).`);
  return data;
}
async function post(path, body) {
  return request(path, {
    method:'POST',
    headers:{ 'content-type':'application/json', 'x-csrf-token':state.csrf },
    body:JSON.stringify(body),
  });
}
function memberMatches(member) {
  const q = $('searchInput').value.trim().toLowerCase();
  const filter = $('statusFilter').value;
  if (q && !String(member.email || '').toLowerCase().includes(q)) return false;
  if (filter === 'online' && member.presence !== 'ONLINE') return false;
  if (filter === 'pro' && member.plan !== 'pro') return false;
  if (filter === 'disabled' && !member.disabled) return false;
  if (filter === 'unverified' && member.emailVerified) return false;
  return true;
}
function renderKpis(overview) {
  $('kpiTotal').textContent = overview?.counts?.total ?? state.members.length;
  $('kpiOnline').textContent = overview?.counts?.online ?? state.members.filter((m) => m.presence === 'ONLINE').length;
  $('kpiPro').textContent = overview?.counts?.pro ?? state.members.filter((m) => m.plan === 'pro').length;
  $('kpiDisabled').textContent = overview?.counts?.disabled ?? state.members.filter((m) => m.disabled).length;
}
function renderMembers() {
  const root = $('members');
  const rows = state.members.filter(memberMatches);
  if (!rows.length) {
    root.innerHTML = '<div class="empty">No customer accounts match this filter.</div>';
    return;
  }
  root.innerHTML = rows.map((m) => {
    const busy = state.busy.has(m.id);
    const devices = Array.isArray(m.devices) ? m.devices : [];
    const status = m.disabled ? '<span class="pill disabled">DISABLED</span>'
      : m.presence === 'ONLINE' ? '<span class="pill online">ONLINE</span>'
      : '<span class="pill">OFFLINE</span>';
    const verified = m.emailVerified ? '<span class="pill">VERIFIED</span>' : '<span class="pill unverified">UNVERIFIED</span>';
    const plan = m.plan === 'pro' ? '<span class="pill pro">PRO</span>' : '<span class="pill">FREE</span>';
    const deviceHtml = devices.length ? devices.map((d) => `
      <div class="device">
        <b>${esc(d.device || 'Device')} · ${esc(d.presence || 'OFFLINE')}</b>
        <span>Last seen ${esc(when(d.lastSeenAt))}</span>
        <button class="btn small" data-action="revoke-device" data-user="${esc(m.id)}" data-session="${esc(d.id)}" ${busy ? 'disabled' : ''}>Sign out this device</button>
      </div>`).join('') : '<div class="device"><b>No active devices</b><span>This customer currently has no active sessions.</span></div>';
    return `<article class="member" data-user-row="${esc(m.id)}">
      <div class="account">
        <strong>${esc(m.email)}</strong>
        <span>Joined ${esc(shortWhen(m.createdAt))}</span>
        <div class="status-line">${status}${verified}${plan}</div>
      </div>
      <div class="metric"><span>Plan</span><strong>${esc(m.planName || 'Free')}</strong></div>
      <div class="metric"><span>Last seen</span><strong>${esc(when(m.lastSeenAt))}</strong></div>
      <div class="metric"><span>Devices</span><strong>${Number(m.activeSessions || devices.length || 0)}</strong></div>
      <div class="actions">
        <button class="btn small danger" data-action="revoke-all" data-user="${esc(m.id)}" ${busy || !devices.length ? 'disabled' : ''}>Sign out all devices</button>
      </div>
      <details class="more"><summary>${devices.length} active device${devices.length === 1 ? '' : 's'} · support details</summary><div class="devices">${deviceHtml}</div></details>
    </article>`;
  }).join('');
}

async function loadDashboard({quiet=false}={}) {
  if (!quiet) notice('');
  const me = await request('/api/account/me');
  if (!me.authenticated) {
    $('dashboard').classList.add('hidden');
    $('accessDenied').classList.remove('hidden');
    return;
  }
  state.me = me.user;
  state.csrf = me.csrfToken || '';
  $('staffIdentity').textContent = me.user?.email || 'Staff';

  try {
    const [overview, members] = await Promise.all([
      request('/api/support/overview'),
      request('/api/support/members'),
    ]);
    state.members = Array.isArray(members.members) ? members.members : [];
    $('accessDenied').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    renderKpis(overview);
    renderMembers();
    $('lastRefresh').textContent = `Updated ${new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}`;
  } catch (error) {
    if (/support access/i.test(error.message || '')) {
      $('dashboard').classList.add('hidden');
      $('accessDenied').classList.remove('hidden');
      return;
    }
    throw error;
  }
}

async function runAction(button) {
  const userId = button.dataset.user;
  if (!userId || state.busy.has(userId)) return;
  state.busy.add(userId);
  renderMembers();
  try {
    const action = button.dataset.action;
    let result;
    if (action === 'revoke-device') {
      result = await post('/api/support/session/revoke', { userId, sessionId:button.dataset.session });
    } else if (action === 'revoke-all') {
      result = await post('/api/support/session/revoke-all', { userId });
    } else {
      return;
    }
    notice(result?.message || 'Customer session updated.', 'success');
    await loadDashboard({quiet:true});
  } catch (error) {
    notice(error.message || 'That support action failed.', 'error');
  } finally {
    state.busy.delete(userId);
    renderMembers();
  }
}

$('members').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) runAction(button);
});
$('searchInput').addEventListener('input', renderMembers);
$('statusFilter').addEventListener('change', renderMembers);
$('refreshBtn').addEventListener('click', () => loadDashboard().catch((e) => notice(e.message, 'error')));

loadDashboard().catch((error) => {
  $('dashboard').classList.add('hidden');
  notice(error.message || 'Support console could not load.', 'error');
  $('accessDenied').classList.remove('hidden');
});
