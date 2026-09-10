const $ = (id) => document.getElementById(id);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[c]));

let me = null;

async function api(path, body, method = 'GET') {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) { location.replace(`/auth.html?next=${encodeURIComponent('/admin.html')}`); throw new Error('Sign in'); }
  let data = {};
  try { data = await response.json(); } catch { /* empty */ }
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`);
    error.code = data.code;
    throw error;
  }
  return data;
}

function alertBox(kind, message) {
  const box = $('alert');
  box.className = `alert ${kind}`;
  box.textContent = message;
  box.classList.remove('hidden');
}
const clearAlert = () => $('alert').classList.add('hidden');

const relative = (value) => {
  if (!value) return '—';
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

function renderDiagnostics(data) {
  const db = data.database || {};
  $('statDb').textContent = db.ok ? 'Healthy' : (db.configured ? 'Error' : 'Not set');
  $('statDb').style.color = db.ok ? 'var(--green)' : 'var(--red)';
  $('statDbNote').textContent = db.ok
    ? `${db.latencyMs}ms · ${db.adminConfigured ? 'service key set' : 'no service key'}`
    : (db.message || 'Unavailable');

  const providers = data.dataProviders || [];
  const connected = providers.filter((row) => row.configured).length;
  $('statProviders').textContent = `${connected}/${providers.length}`;
  $('statProviders').style.color = connected ? 'var(--green)' : 'var(--amber)';
  $('statProvidersNote').textContent = connected ? 'credentials present' : 'no data sources connected';

  $('statErrors').textContent = String((data.recentErrors || []).length);
  $('statErrors').style.color = (data.recentErrors || []).length ? 'var(--red)' : 'var(--green)';

  $('providerList').innerHTML = providers.map((provider) => `
    <div class="provider-row">
      <div>
        <b>${escapeHtml(provider.name)}</b>
        <small>Supplies: ${escapeHtml(provider.supplies.join(', '))}</small>
        ${provider.missingEnv.length ? `<small>Needs <span class="env-key">${provider.missingEnv.map(escapeHtml).join('</span>, <span class="env-key">')}</span></small>` : ''}
        ${provider.note ? `<small>${escapeHtml(provider.note)}</small>` : ''}
      </div>
      <span class="pill ${provider.configured ? 'ok' : 'warn'}">${provider.configured ? 'CONNECTED' : 'MISSING'}</span>
    </div>`).join('') || '<p class="muted">No data providers defined.</p>';

  const services = [
    { name: 'Supabase database', ok: db.ok, detail: db.configured ? (db.message || 'Reachable') : 'SUPABASE_URL / SUPABASE_ANON_KEY not set' },
    { name: 'Identity (Supabase Auth)', ok: db.configured, detail: db.adminConfigured ? 'Service role available' : 'Service role key not set — user listing limited' },
    { name: 'Security alert email', ok: data.email?.configured, detail: `Provider: ${data.email?.provider || 'console'}` },
    { name: 'Payments (PayPal)', ok: data.payments?.configured, detail: `Environment: ${data.payments?.environment || 'sandbox'}` },
  ];
  $('serviceList').innerHTML = services.map((service) => `
    <div class="provider-row">
      <div><b>${escapeHtml(service.name)}</b><small>${escapeHtml(service.detail)}</small></div>
      <span class="pill ${service.ok ? 'ok' : 'warn'}">${service.ok ? 'OK' : 'NOT SET'}</span>
    </div>`).join('');

  const runs = data.recentRuns || [];
  $('runRows').innerHTML = runs.length ? runs.map((run) => `
    <tr>
      <td>${escapeHtml(run.provider)}</td>
      <td><span class="pill ${run.status === 'SUCCEEDED' ? 'ok' : run.status === 'RUNNING' ? 'mute' : 'bad'}">${escapeHtml(run.status)}</span></td>
      <td>${run.events_count ?? 0}</td>
      <td>${run.lines_count ?? 0}</td>
      <td class="mono">${relative(run.started_at)}</td>
    </tr>`).join('') : '<tr><td colspan="5" class="muted">No sync runs recorded yet.</td></tr>';

  const errors = data.recentErrors || [];
  $('errorRows').innerHTML = errors.length ? errors.map((row) => `
    <tr>
      <td>${escapeHtml(row.provider)}</td>
      <td>${row.http_status ?? '—'}</td>
      <td>${escapeHtml(String(row.reason || '').slice(0, 90))}</td>
      <td class="mono">${relative(row.created_at)}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="muted">No provider errors recorded.</td></tr>';
}

const ROLES = ['USER', 'PREMIUM', 'ADMIN', 'OWNER'];

function renderUsers(data) {
  const rows = data.users || [];
  $('statUsers').textContent = String(rows.length);
  $('userRows').innerHTML = rows.length ? rows.map((user) => {
    const isSelf = user.id === me?.id;
    const options = ROLES.map((role) => `<option value="${role}"${user.role === role ? ' selected' : ''}>${role}</option>`).join('');
    const plan = user.subscription
      ? `${escapeHtml(user.subscription.tier)} · ${escapeHtml(user.subscription.status)}`
      : 'free · inactive';
    return `
      <tr>
        <td>${escapeHtml(user.email || '—')}${isSelf ? ' <span class="pill mute">YOU</span>' : ''}</td>
        <td>${escapeHtml(user.displayName || '—')}</td>
        <td><select data-role-for="${escapeHtml(user.id)}"${isSelf ? ' disabled' : ''}>${options}</select></td>
        <td>${plan}</td>
        <td class="mono">${relative(user.createdAt)}</td>
        <td><button class="btn" type="button" data-save-role="${escapeHtml(user.id)}"${isSelf ? ' disabled' : ''}>Save</button></td>
      </tr>`;
  }).join('') : '<tr><td colspan="6" class="muted">No accounts yet.</td></tr>';

  for (const button of document.querySelectorAll('[data-save-role]')) {
    button.addEventListener('click', async () => {
      const userId = button.dataset.saveRole;
      const role = document.querySelector(`[data-role-for="${userId}"]`).value;
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        await api('/api/admin/users/role', { userId, role }, 'POST');
        alertBox('ok', `Role updated to ${role}.`);
        await load();
      } catch (error) {
        alertBox('error', error.message);
        button.disabled = false;
        button.textContent = 'Save';
      }
    });
  }
}

async function load() {
  clearAlert();
  try {
    const session = await api('/api/me');
    me = session.user;
    if (!me.isAdmin) {
      alertBox('error', 'This console is limited to admins.');
      $('whoami').textContent = me.email;
      return;
    }
    $('whoami').textContent = `${me.email} · ${me.role}`;
    $('whoami').className = 'pill ok';
  } catch (error) {
    alertBox('error', error.message);
    return;
  }

  const [diagnostics, users] = await Promise.allSettled([
    api('/api/admin/diagnostics'),
    api('/api/admin/users'),
  ]);

  if (diagnostics.status === 'fulfilled') renderDiagnostics(diagnostics.value);
  else alertBox('error', `Diagnostics unavailable: ${diagnostics.reason.message}`);

  if (users.status === 'fulfilled') renderUsers(users.value);
  else alertBox('warn', `User list unavailable: ${users.reason.message}`);
}

$('refreshBtn').addEventListener('click', () => {
  $('refreshBtn').disabled = true;
  load().finally(() => { $('refreshBtn').disabled = false; });
});

load();
