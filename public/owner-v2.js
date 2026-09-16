import { renderMembers as drawMembers, renderAudit } from '/owner-v2-render.js';

const $ = (id) => document.getElementById(id);
const TAB_IDS = new Set(['overview', 'users', 'support', 'access', 'system', 'logs', 'settings']);
const TAB_META = {
  overview: ['OWNER CONTROL CENTER', 'Owner overview', 'Complete control. Private, secure, and connected to the live Oblige Props accounts.'],
  users: ['CUSTOMERS', 'Users', 'Manage live customer access, Pro time, bans, support roles and devices.'],
  support: ['SUPPORT', 'Support operations', 'See the customer-support picture without weakening owner-only controls.'],
  access: ['ACCESS', 'Staff access', 'Review exactly who has owner or support privileges.'],
  system: ['SYSTEM', 'System health', 'Check the production application and account services from one place.'],
  logs: ['AUDIT', 'Privileged activity', 'Review protected owner and support actions.'],
  settings: ['SETTINGS', 'Owner settings', 'Review how this control center is connected to production.'],
};
const state = {
  me: null,
  members: [],
  access: new Map(),
  csrf: '',
  busy: new Set(),
  expanded: new Set(),
  activeTab: 'overview',
};

const isPro = (a) => a?.plan === 'pro';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function notice(text, type = '') {
  const el = $('notice');
  if (!text) {
    el.className = 'notice hidden';
    el.textContent = '';
    return;
  }
  el.className = `notice ${type}`.trim();
  el.textContent = text;
}

async function request(path, options = {}) {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.ok === false) throw new Error(d?.message || `Request failed (${r.status}).`);
  return d;
}

const post = (path, body) => request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf },
  body: JSON.stringify(body),
});

function draw() {
  drawMembers($('members'), {
    members: state.members,
    access: state.access,
    me: state.me,
    busy: state.busy,
    expanded: state.expanded,
    query: $('searchInput').value.trim(),
    filter: $('statusFilter').value,
  });
}

function kpis(o) {
  $('kpiTotal').textContent = o?.counts?.total ?? state.members.length;
  $('kpiOnline').textContent = o?.counts?.online ?? state.members.filter((m) => m.presence === 'ONLINE').length;
  $('kpiPro').textContent = state.members.filter((m) => isPro(state.access.get(m.id))).length;
  $('kpiBanned').textContent = o?.counts?.disabled ?? state.members.filter((m) => m.disabled).length;
  $('overviewStaff').textContent = o?.counts?.support ?? state.members.filter((m) => m.role === 'support').length;
  $('overviewCustomers').textContent = Math.max(0, Number(o?.counts?.total ?? state.members.length) - Number(o?.counts?.owners ?? 1) - Number(o?.counts?.support ?? 0));
  $('overviewVerified').textContent = o?.counts?.verified ?? '—';
  $('overviewIdle').textContent = o?.counts?.idle ?? '—';
}

function setHealthValue(id, healthy, text) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('health-bad', healthy === false);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probeHealth(path, retries = 2) {
  let last = { reachable: false, healthy: false, data: null };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => null);
      last = {
        reachable: true,
        healthy: response.ok && data?.ok !== false,
        data,
      };
      if (last.healthy || response.status < 500 || attempt === retries) return last;
    } catch {
      last = { reachable: false, healthy: false, data: null };
      if (attempt === retries) return last;
    }
    await wait(350 * (attempt + 1));
  }
  return last;
}

async function loadHealth() {
  const [appProbe, accountProbe] = await Promise.all([
    probeHealth('/api/health'),
    probeHealth('/api/account/health'),
  ]);
  const app = appProbe.data;
  const acct = accountProbe.data;
  const badge = $('systemBadge');

  if (appProbe.healthy) {
    badge.className = 'system-badge ok';
    badge.querySelector('span').textContent = 'SYSTEM ONLINE';
  } else if (appProbe.reachable) {
    badge.className = 'system-badge bad';
    badge.querySelector('span').textContent = 'NEEDS ATTENTION';
  } else {
    // A missing health response is unknown, not proof that production is down.
    // Keep the badge neutral and retry on the normal dashboard refresh cycle.
    badge.className = 'system-badge';
    badge.querySelector('span').textContent = 'STATUS UNAVAILABLE';
  }

  setHealthValue('healthApp', appProbe.healthy, appProbe.healthy ? 'Healthy' : appProbe.reachable ? 'Unavailable' : 'Status unavailable');
  setHealthValue('healthAccounts', accountProbe.healthy, accountProbe.healthy ? 'Ready' : accountProbe.reachable ? 'Unavailable' : 'Status unavailable');

  const askState = acct?.features?.ask;
  const projectionsState = acct?.features?.projections;
  setHealthValue('healthAsk', askState === true ? true : askState === false ? false : null, askState === true ? 'Enabled' : askState === false ? 'Not enabled' : 'Unknown');
  setHealthValue('healthProjections', projectionsState === true ? true : projectionsState === false ? false : null, projectionsState === true ? 'Enabled' : projectionsState === false ? 'Not enabled' : 'Unknown');
}

async function loadAudit(quiet = false) {
  try {
    const d = await request('/api/admin/audit');
    renderAudit($('auditList'), d.entries || []);
  } catch (e) {
    $('auditList').innerHTML = '<div class="empty">Audit activity is unavailable right now.</div>';
    if (!quiet) notice(e.message, 'error');
  }
}

async function loadSupport() {
  try {
    const d = await request('/api/support/overview');
    $('supportTotal').textContent = d?.counts?.total ?? '—';
    $('supportOnline').textContent = d?.counts?.online ?? '—';
    $('supportPro').textContent = d?.counts?.pro ?? '—';
    $('supportDisabled').textContent = d?.counts?.disabled ?? '—';
  } catch {
    for (const id of ['supportTotal', 'supportOnline', 'supportPro', 'supportDisabled']) $(id).textContent = '—';
  }
}

function drawAccess() {
  const root = $('accessList');
  const staff = state.members.filter((m) => m.id === state.me?.id || m.role === 'owner' || m.role === 'support');
  if (!staff.length) {
    root.innerHTML = '<div class="empty">No staff accounts are available.</div>';
    return;
  }
  root.innerHTML = staff.map((m) => {
    const owner = m.id === state.me?.id || m.role === 'owner';
    const online = m.presence === 'ONLINE';
    const disabled = Boolean(m.disabled);
    const action = owner
      ? '<button class="btn small" type="button" disabled>Protected owner</button>'
      : `<button class="btn small danger" type="button" data-action="role" data-role="member" data-user="${esc(m.id)}" ${state.busy.has(m.id) ? 'disabled' : ''}>Remove Support</button>`;
    return `<article class="staff-row">
      <div class="staff-person"><span class="avatar">${esc(String(m.email || 'U')[0].toUpperCase())}</span><div><strong>${esc(m.email)}</strong><span>${owner ? 'Owner' : 'Support worker'}</span></div></div>
      <div class="staff-badges"><span class="pill ${online ? 'online' : ''}">${online ? 'ONLINE' : esc(m.presence || 'OFFLINE')}</span><span class="pill ${owner ? 'owner' : 'pro'}">${owner ? 'OWNER' : 'SUPPORT'}</span>${disabled ? '<span class="pill banned">BANNED</span>' : ''}</div>
      <div class="staff-action">${action}</div>
    </article>`;
  }).join('');
}

function currentTabFromUrl() {
  const raw = new URL(window.location.href).searchParams.get('tab') || 'overview';
  return TAB_IDS.has(raw) ? raw : 'overview';
}

function setTab(tab, { replace = false, updateUrl = true } = {}) {
  const next = TAB_IDS.has(tab) ? tab : 'overview';
  state.activeTab = next;
  document.querySelectorAll('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== next; });
  document.querySelectorAll('[data-tab-link]').forEach((link) => link.classList.toggle('active', link.dataset.tabLink === next));
  const [eyebrow, title, subtitle] = TAB_META[next];
  $('pageEyebrow').textContent = eyebrow;
  $('pageTitle').textContent = title;
  $('pageSubtitle').textContent = subtitle;
  document.title = `${title} · Oblige Props`;
  if (updateUrl) {
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    history[replace ? 'replaceState' : 'pushState']({ tab: next }, '', url);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadDashboard({ quiet = false } = {}) {
  if (!quiet) notice('');
  const me = await request('/api/account/me');
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

  const [overview, members, entitlements] = await Promise.all([
    request('/api/admin/overview'),
    request('/api/admin/members'),
    request('/api/admin/entitlements'),
  ]);
  state.members = Array.isArray(members.members) ? members.members : [];
  state.access = new Map((entitlements.entitlements || []).map((r) => [r.userId, r.access]));
  kpis(overview);
  draw();
  drawAccess();
  $('lastRefresh').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  await Promise.all([loadHealth(), loadAudit(true), loadSupport()]);
}

async function memberAction(b) {
  const userId = b.dataset.user;
  if (!userId || state.busy.has(userId)) return;
  state.busy.add(userId);
  draw();
  drawAccess();
  try {
    let r;
    switch (b.dataset.action) {
      case 'access':
        r = await post('/api/admin/member/access', { userId, action: b.dataset.mode || 'grant', days: Number(b.dataset.days) });
        break;
      case 'revoke-access':
        r = await post('/api/admin/member/access', { userId, action: 'revoke' });
        break;
      case 'ban':
        r = await post('/api/admin/member/disable', { userId, disabled: b.dataset.disabled === 'true' });
        break;
      case 'role':
        r = await post('/api/admin/member/role', { userId, role: b.dataset.role });
        break;
      case 'revoke-device':
        r = await post('/api/admin/session/revoke', { sessionId: b.dataset.session });
        break;
      default:
        return;
    }
    notice(r?.message || 'Updated.', 'success');
    await loadDashboard({ quiet: true });
  } catch (e) {
    notice(e.message || 'That update failed.', 'error');
  } finally {
    state.busy.delete(userId);
    draw();
    drawAccess();
  }
}

$('members').addEventListener('click', (e) => {
  const t = e.target.closest('button[data-toggle-user]');
  if (t) {
    const id = t.dataset.toggleUser;
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
    draw();
    return;
  }
  const b = e.target.closest('button[data-action]');
  if (b) memberAction(b);
});

$('accessList').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (b) memberAction(b);
});

$('searchInput').addEventListener('input', draw);
$('statusFilter').addEventListener('change', draw);
$('refreshBtn').addEventListener('click', () => loadDashboard().catch((e) => notice(e.message, 'error')));
$('auditRefreshBtn').addEventListener('click', () => loadAudit());
$('systemRefreshBtn').addEventListener('click', () => loadHealth().catch((e) => notice(e.message, 'error')));

document.querySelectorAll('[data-tab-link]').forEach((link) => link.addEventListener('click', (e) => {
  e.preventDefault();
  setTab(link.dataset.tabLink);
}));
document.querySelectorAll('[data-tab-jump]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tabJump)));
window.addEventListener('popstate', () => setTab(currentTabFromUrl(), { updateUrl: false }));

setTab(currentTabFromUrl(), { replace: true });
loadDashboard().catch((e) => {
  $('dashboard').classList.add('hidden');
  notice(e.message || 'Owner control center could not load.', 'error');
  $('accessDenied').classList.remove('hidden');
});
