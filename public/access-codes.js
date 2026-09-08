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

async function refreshAccessRole() {
  const card = byId('ownerAccessCard');
  if (!card) return;
  try {
    const auth = await api('/api/auth/status');
    card.classList.toggle('hidden', !auth.canGenerateAccessCodes);
  } catch {
    card.classList.add('hidden');
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
window.addEventListener('autoprop-authenticated', refreshAccessRole);
refreshAccessRole();
