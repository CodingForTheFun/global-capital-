const nativeFetch = window.fetch.bind(window);

function inviteInput() {
  return document.getElementById('friendAccessCode');
}

function ensureInviteField() {
  const form = document.getElementById('authForm');
  const submit = document.getElementById('authSubmit');
  if (!form || !submit || document.getElementById('friendInviteLabel')) return;

  const label = document.createElement('label');
  label.id = 'friendInviteLabel';
  label.className = 'hidden';
  label.innerHTML = 'Access code <span style="opacity:.65;font-size:.82em">(owner setup code for the first account; friend invite code after that)</span><input id="friendAccessCode" type="text" inputmode="text" autocomplete="off" placeholder="Enter your AutoProp access code" maxlength="80" />';
  form.insertBefore(label, submit);

  const sync = () => {
    const register = document.getElementById('registerTab')?.classList.contains('active');
    label.classList.toggle('hidden', !register);
    const input = inviteInput();
    if (input && !register) input.value = '';
  };

  document.getElementById('registerTab')?.addEventListener('click', () => setTimeout(sync, 0));
  document.getElementById('loginTab')?.addEventListener('click', () => setTimeout(sync, 0));
  inviteInput()?.addEventListener('input', (event) => {
    event.target.value = String(event.target.value || '').toUpperCase().replace(/\s+/g, '');
  });
  sync();
}

function ensureCheckoutHook() {
  const link = document.querySelector('a[href="/checkout.html"]');
  if (!link) return;
  link.id = 'checkoutLink';
  link.classList.add('hidden');
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.includes('/api/auth/register') && init?.body) {
    try {
      const payload = JSON.parse(init.body);
      const accessCode = String(inviteInput()?.value || '').trim();
      init = { ...init, body: JSON.stringify({ ...payload, accessCode }) };
    } catch {}
  }
  return nativeFetch(input, init);
};

ensureInviteField();
ensureCheckoutHook();
await import('./app-v4-core.js');
ensureInviteField();
ensureCheckoutHook();
