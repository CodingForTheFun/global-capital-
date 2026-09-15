import { renderMembers as drawMembers, renderAudit } from '/owner-v2-render.js';

const $ = (id) => document.getElementById(id);
const TAB_IDS = new Set(['overview', 'users', 'support', 'access', 'system', 'logs', 'settings']);
const TAB_META = {
  overview: ['OWNER CONTROL CENTER', 'Owner overview', 'Complete control. Private, secure, and connected to the live Oblige Props accounts.'],
  users: ['CUSTOMERS', 'Users', 'Manage live customer access, Pro time, bans, support roles and devices.'],
  support: ['SUPPORT', 'Support operations', 'See the customer-support picture without weakening owner-only controls.'],
  access: ['ACCESS', 'Access & codes', 'Generate guest or trial codes and manage staff access from one owner-only workspace.'],
  system: ['SYSTEM', 'System health', 'Check the production application and account services from one place.'],
  logs: ['AUDIT', 'Privileged activity', 'Review protected owner and support actions.'],
  settings: ['SETTINGS', 'Owner settings', 'Review how this control center is connected to production.'],
};
const state = {
  me: null,
  members: [],
  access: new Map(),
  codes: [],
  csrf: '',
  busy: new Set(),
  codeBusy: new Set(),
  expanded: new Set(),
  activeTab: 'overview',
  generatedCode: '',
};

const isPro = (a) => a?.plan === 'pro';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (value, fallback = '—') => {
  const d = new Date(value || '');
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : fallback;
};
const when = (value, fallback = 'Never') => {
  const d = new Date(value || '');
  return Number.isFinite(d.getTime()) ? d.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : fallback;
};

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

async function loadHealth() {
  const [app, acct] = await Promise.all([
    request('/api/health').catch(() => null),
    request('/api/account/health').catch(() => null),
  ]);
  const ok = Boolean(app?.ok);
  $('systemBadge').className = `system-badge ${ok ? 'ok' : 'bad'}`;
  $('systemBadge').querySelector('span').textContent = ok ? 'SYSTEM ONLINE' : 'NEEDS ATTENTION';
  setHealthValue('healthApp', ok, ok ? 'Healthy' : 'Unavailable');
  setHealthValue('healthAccounts', Boolean(acct?.ok), acct?.ok ? 'Ready' : 'Unavailable');
  setHealthValue('healthAsk', acct?.features?.ask !== false, acct?.features?.ask ? 'Enabled' : 'Not enabled');
  setHealthValue('healthProjections', acct?.features?.projections !== false, acct?.features?.projections ? 'Enabled' : 'Not enabled');
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

function ensureCodeStyles() {
  if (document.getElementById('owner-access-code-styles')) return;
  const style = document.createElement('style');
  style.id = 'owner-access-code-styles';
  style.textContent = `
    .code-manager{display:grid;gap:14px;margin-bottom:22px;padding-bottom:22px;border-bottom:1px solid rgba(255,255,255,.08)}
    .code-manager-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
    .code-manager-head h3{margin:0;font-size:16px}.code-manager-head p{margin:5px 0 0;color:var(--muted);font-size:11px;line-height:1.55}
    .code-count{white-space:nowrap;color:var(--muted);font-size:10px}
    .code-form{display:grid;grid-template-columns:minmax(170px,1.3fr) minmax(130px,.75fr) minmax(130px,.75fr) auto;gap:8px;align-items:end}
    .code-field{display:block;min-width:0}.code-field>span{display:block;margin:0 0 6px;color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .code-field input,.code-field select{width:100%;height:38px;border:1px solid rgba(255,255,255,.1);border-radius:9px;background:#0a0d12;color:#f7f8fa;padding:0 10px}
    .code-generated{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px;border:1px solid rgba(82,214,138,.25);border-radius:11px;background:rgba(18,68,42,.18)}
    .code-generated span{display:block;color:#a9e9c5;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.code-generated code{display:block;margin-top:4px;color:#fff;font:800 17px/1.3 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;letter-spacing:.05em;overflow-wrap:anywhere}
    .code-list{display:grid;gap:7px}.code-row{display:grid;grid-template-columns:minmax(190px,1.2fr) .7fr .7fr .8fr auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(7,11,16,.45)}
    .code-main{min-width:0}.code-main strong,.code-main code{display:block}.code-main strong{font-size:11px}.code-main code{margin-top:3px;color:#dbe4f0;font:700 10px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}.code-main .status-line{margin-top:6px}
    .code-metric span,.code-metric strong{display:block}.code-metric span{font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.code-metric strong{margin-top:3px;font-size:10px}
    .staff-section-head{margin:2px 0 10px}.staff-section-head h3{margin:0;font-size:14px}.staff-section-head p{margin:4px 0 0;color:var(--muted);font-size:10px}
    @media(max-width:980px){.code-form{grid-template-columns:1fr 1fr}.code-form .code-submit{grid-column:1/-1}.code-row{grid-template-columns:1.2fr .8fr .8fr}.code-row .code-metric:nth-of-type(3){display:none}.code-row .code-actions{grid-column:1/-1}}
    @media(max-width:680px){.code-manager-head{flex-direction:column}.code-form{grid-template-columns:1fr}.code-form .code-submit{grid-column:auto;width:100%}.code-generated{align-items:stretch;flex-direction:column}.code-generated .btn{width:100%}.code-row{grid-template-columns:1fr 1fr}.code-main{grid-column:1/-1}.code-row .code-actions{grid-column:1/-1}.code-row .code-actions .btn{width:100%}}
  `;
  document.head.appendChild(style);
}

function codeExpiry(code) {
  return code?.neverExpires || !code?.expiresAt ? 'Unlimited' : date(code.expiresAt);
}

function codeUses(code) {
  const used = Number(code?.uses || 0);
  return code?.unlimitedUses || code?.maxUses === null ? `${used} used · Unlimited` : `${used} / ${Number(code?.maxUses || 0)} used`;
}

function codeManagerHtml() {
  const active = state.codes.filter((code) => code.active !== false).length;
  const generated = state.generatedCode ? `<div class="code-generated"><div><span>New code · shown in full only now</span><code>${esc(state.generatedCode)}</code></div><button class="btn small good" type="button" data-code-action="copy">Copy code</button></div>` : '';
  const codeRows = state.codes.length ? state.codes.map((code) => {
    const busy = state.codeBusy.has(code.id);
    const badges = `${code.active === false ? '<span class="pill banned">INACTIVE</span>' : '<span class="pill online">ACTIVE</span>'}${code.neverExpires ? '<span class="pill pro">UNLIMITED TIME</span>' : ''}${code.unlimitedUses ? '<span class="pill pro">UNLIMITED USES</span>' : ''}`;
    return `<article class="code-row"><div class="code-main"><strong>${esc(code.label || 'Access')}</strong><code>${esc(code.hint || '••••')}</code><div class="status-line">${badges}</div></div><div class="code-metric"><span>Expires</span><strong>${esc(codeExpiry(code))}</strong></div><div class="code-metric"><span>Redemptions</span><strong>${esc(codeUses(code))}</strong></div><div class="code-metric"><span>Last used</span><strong>${esc(when(code.lastUsedAt))}</strong></div><div class="code-actions"><button class="btn small danger" type="button" data-code-action="revoke" data-code-id="${esc(code.id)}" ${busy || code.active === false ? 'disabled' : ''}>Revoke</button></div></article>`;
  }).join('') : '<div class="empty">No access codes yet. Generate the first one above.</div>';

  return `<section class="code-manager"><div class="code-manager-head"><div><h3>Guest & trial access codes</h3><p>Create as many codes as needed. Pick 3 days, a year, custom time, or unlimited access. Full codes are never stored in readable form.</p></div><span class="code-count">${active} active · ${state.codes.length} total</span></div><form id="ownerCodeForm" class="code-form"><label class="code-field"><span>Label</span><input id="ownerCodeLabel" type="text" maxlength="80" value="Trial access" placeholder="e.g. 3-day trial" autocomplete="off"></label><label class="code-field"><span>Duration</span><select id="ownerCodeDuration"><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option><option value="unlimited">Unlimited</option><option value="custom">Custom days…</option></select><input id="ownerCodeCustomDays" type="number" min="1" max="3650" step="1" value="30" inputmode="numeric" hidden></label><label class="code-field"><span>Redemptions</span><select id="ownerCodeUses"><option value="1" selected>1 person</option><option value="5">5 uses</option><option value="10">10 uses</option><option value="25">25 uses</option><option value="100">100 uses</option><option value="unlimited">Unlimited uses</option><option value="custom">Custom uses…</option></select><input id="ownerCodeCustomUses" type="number" min="1" max="100000" step="1" value="1" inputmode="numeric" hidden></label><button class="btn primary code-submit" type="submit">Generate code</button></form>${generated}<div class="code-list">${codeRows}</div></section>`;
}

function drawAccess() {
  ensureCodeStyles();
  const root = $('accessList');
  const staff = state.members.filter((m) => m.id === state.me?.id || m.role === 'owner' || m.role === 'support');
  const staffHtml = staff.length ? staff.map((m) => {
    const owner = m.id === state.me?.id || m.role === 'owner';
    const online = m.presence === 'ONLINE';
    const disabled = Boolean(m.disabled);
    const action = owner
      ? '<button class="btn small" type="button" disabled>Protected owner</button>'
      : `<button class="btn small danger" type="button" data-action="role" data-role="member" data-user="${esc(m.id)}" ${state.busy.has(m.id) ? 'disabled' : ''}>Remove Support</button>`;
    return `<article class="staff-row"><div class="staff-person"><span class="avatar">${esc(String(m.email || 'U')[0].toUpperCase())}</span><div><strong>${esc(m.email)}</strong><span>${owner ? 'Owner' : 'Support worker'}</span></div></div><div class="staff-badges"><span class="pill ${online ? 'online' : ''}">${online ? 'ONLINE' : esc(m.presence || 'OFFLINE')}</span><span class="pill ${owner ? 'owner' : 'pro'}">${owner ? 'OWNER' : 'SUPPORT'}</span>${disabled ? '<span class="pill banned">BANNED</span>' : ''}</div><div class="staff-action">${action}</div></article>`;
  }).join('') : '<div class="empty">No staff accounts are available.</div>';
  root.innerHTML = `${codeManagerHtml()}<div class="staff-section-head"><h3>Owner & support access</h3><p>The owner identity stays server-pinned. Support can be granted or removed from existing accounts.</p></div>${staffHtml}`;
  syncCodeFields();
}

function syncCodeFields() {
  const duration = $('ownerCodeDuration');
  const customDays = $('ownerCodeCustomDays');
  const uses = $('ownerCodeUses');
  const customUses = $('ownerCodeCustomUses');
  if (duration && customDays) customDays.hidden = duration.value !== 'custom';
  if (uses && customUses) customUses.hidden = uses.value !== 'custom';
}

async function refreshCodes() {
  const d = await request('/api/admin/access-codes');
  state.codes = Array.isArray(d.codes) ? d.codes : [];
  drawAccess();
}

async function generateCode(form) {
  const button = form.querySelector('button[type="submit"]');
  if (!button || button.disabled) return;
  const duration = $('ownerCodeDuration')?.value || '30';
  const uses = $('ownerCodeUses')?.value || '1';
  const neverExpires = duration === 'unlimited';
  const unlimitedUses = uses === 'unlimited';
  const expiresInDays = neverExpires ? null : Math.trunc(Number(duration === 'custom' ? $('ownerCodeCustomDays')?.value : duration));
  const maxUses = unlimitedUses ? null : Math.trunc(Number(uses === 'custom' ? $('ownerCodeCustomUses')?.value : uses));
  if (!neverExpires && (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650)) {
    notice('Enter between 1 and 3650 days, or choose Unlimited.', 'error');
    return;
  }
  if (!unlimitedUses && (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 100000)) {
    notice('Enter between 1 and 100000 redemptions, or choose Unlimited.', 'error');
    return;
  }
  button.disabled = true;
  try {
    const result = await post('/api/admin/access-codes/generate', {
      label: $('ownerCodeLabel')?.value?.trim() || 'Trial access',
      expiresInDays,
      neverExpires,
      maxUses,
      unlimitedUses,
    });
    state.generatedCode = String(result.code || '');
    notice(result.message || 'Access code generated.', 'success');
    await refreshCodes();
  } catch (e) {
    notice(e.message || 'Could not generate the access code.', 'error');
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

async function revokeCode(id) {
  if (!id || state.codeBusy.has(id)) return;
  if (!window.confirm('Revoke this access code? Existing sessions using it will lose access.')) return;
  state.codeBusy.add(id);
  drawAccess();
  try {
    const result = await post('/api/admin/access-codes/revoke', { id });
    notice(result.message || 'Access code revoked.', 'success');
    await refreshCodes();
  } catch (e) {
    notice(e.message || 'Could not revoke that access code.', 'error');
  } finally {
    state.codeBusy.delete(id);
    drawAccess();
  }
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

  const [overview, members, entitlements, codes] = await Promise.all([
    request('/api/admin/overview'),
    request('/api/admin/members'),
    request('/api/admin/entitlements'),
    request('/api/admin/access-codes'),
  ]);
  state.members = Array.isArray(members.members) ? members.members : [];
  state.access = new Map((entitlements.entitlements || []).map((r) => [r.userId, r.access]));
  state.codes = Array.isArray(codes.codes) ? codes.codes : [];
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
      case 'access': {
        const unlimited = b.dataset.unlimited === 'true';
        let days = b.dataset.days;
        if (!unlimited && days === 'custom') {
          const entered = window.prompt('How many days of complimentary Pro access? Enter 1–3650.', '14');
          if (entered === null) return;
          const parsed = Math.trunc(Number(entered));
          if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3650) throw new Error('Enter a whole number from 1 to 3650 days.');
          days = parsed;
        }
        r = await post('/api/admin/member/access', { userId, action: b.dataset.mode || 'grant', ...(unlimited ? { unlimited: true } : { days: Number(days) }) });
        break;
      }
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

$('accessList').addEventListener('submit', (e) => {
  if (e.target?.id !== 'ownerCodeForm') return;
  e.preventDefault();
  generateCode(e.target);
});
$('accessList').addEventListener('change', (e) => {
  if (e.target?.id === 'ownerCodeDuration' || e.target?.id === 'ownerCodeUses') syncCodeFields();
});
$('accessList').addEventListener('click', (e) => {
  const codeButton = e.target.closest('button[data-code-action]');
  if (codeButton) {
    if (codeButton.dataset.codeAction === 'copy') copyGeneratedCode();
    else if (codeButton.dataset.codeAction === 'revoke') revokeCode(codeButton.dataset.codeId);
    return;
  }
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
