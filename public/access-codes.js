const byId = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json', ...(options.headers || {}) } : options.headers,
    ...options,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

function setState(message, kind = '') {
  const box = byId('accessCodeState');
  if (!box) return;
  box.className = `connect-state ${kind}`.trim();
  box.textContent = message || '';
  box.classList.toggle('hidden', !message);
}

function applyRole(auth) {
  const owner = auth?.role === 'owner';
  const member = auth?.role === 'member';
  byId('ownerAccessCard')?.classList.toggle('hidden', !owner);

  for (const id of ['connectBtn', 'manageConnectionBtn', 'ruleFiltersBtn', 'sideRuleFiltersBtn']) {
    const node = byId(id);
    if (!node) continue;
    node.classList.toggle('hidden', member);
  }

  const badge = byId('connectionBadge');
  if (badge && member) {
    badge.disabled = true;
    badge.title = 'PickFinder connection is managed by the owner';
  } else if (badge) {
    badge.disabled = false;
    badge.removeAttribute('title');
  }
}

async function refreshAccessRole() {
  try {
    const auth = await api('/api/auth/status');
    applyRole(auth);
    return auth;
  } catch {
    byId('ownerAccessCard')?.classList.add('hidden');
    return null;
  }
}

async function generateCode() {
  const button = byId('generateAccessCodeBtn');
  const output = byId('generatedAccessCode');
  const panel = byId('generatedCodePanel');
  if (!button || !output || !panel) return;
  button.disabled = true;
  button.textContent = 'Generating…';
  setState('Creating a private friend code…', 'working');
  try {
    const data = await api('/api/access-codes/generate', {
      method: 'POST',
      body: JSON.stringify({ label: 'Friend access', expiresInDays: 30, maxUses: 5 }),
    });
    output.textContent = data.code;
    panel.classList.remove('hidden');
    setState('Code created. It is shown only here; send it privately.', 'success');
  } catch (error) {
    setState(error.message || 'Could not generate an access code.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Generate access code';
  }
}

async function copyCode() {
  const value = byId('generatedAccessCode')?.textContent?.trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setState('Access code copied.', 'success');
  } catch {
    setState('Press and hold the code to copy it.', '');
  }
}

byId('generateAccessCodeBtn')?.addEventListener('click', generateCode);
byId('copyAccessCodeBtn')?.addEventListener('click', copyCode);
byId('authForm')?.addEventListener('submit', () => setTimeout(refreshAccessRole, 900));
window.addEventListener('focus', refreshAccessRole);
refreshAccessRole();
