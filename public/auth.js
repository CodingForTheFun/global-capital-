const $ = (id) => document.getElementById(id);
const state = { email: '', resendTimer: 0, config: null };

// --- shell ----------------------------------------------------------------

function showView(name) {
  for (const section of document.querySelectorAll('[data-view]')) {
    section.hidden = section.id !== `view-${name}`;
  }
  clearAlert();
  clearFieldErrors();
  const focusable = document.querySelector(`#view-${name} input:not([type=checkbox])`);
  if (focusable) setTimeout(() => focusable.focus(), 40);
  const titles = {
    signin: 'Sign in', signup: 'Create account', verify: 'Confirm your email',
    forgot: 'Reset password', reset: 'New password',
  };
  document.title = `${titles[name] || 'Sign in'} · AutoProp Scout Pro`;
  history.replaceState(null, '', `#${name}`);
}

function alertBox(kind, message) {
  const box = $('alert');
  box.className = `alert ${kind}`;
  box.textContent = message;
  box.classList.remove('hidden');
}
const clearAlert = () => $('alert').classList.add('hidden');

function fieldError(id, message) {
  const holder = document.querySelector(`[data-error-for="${id}"]`);
  const input = $(id);
  if (input) input.setAttribute('aria-invalid', 'true');
  if (!holder) return;
  holder.textContent = message;
  holder.classList.remove('hidden');
}
function clearFieldErrors() {
  for (const holder of document.querySelectorAll('.field-error')) holder.classList.add('hidden');
  for (const input of document.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
}

function busy(button, isBusy, label) {
  if (!button) return;
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${label || 'Working…'}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

async function api(path, body, method = 'POST') {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await response.json(); } catch { /* empty body */ }
  if (!response.ok) {
    const error = new Error(data.message || `Request failed (${response.status})`);
    error.code = data.code;
    error.details = data.details;
    error.status = response.status;
    throw error;
  }
  return data;
}

const nextUrl = () => {
  const target = new URLSearchParams(location.search).get('next') || '/';
  // Only ever bounce to a same-origin path.
  return target.startsWith('/') && !target.startsWith('//') ? target : '/';
};

// --- code inputs ----------------------------------------------------------

function wireCodeRow(rowId, onComplete) {
  const row = $(rowId);
  const boxes = [...row.querySelectorAll('input')];

  const sync = () => {
    boxes.forEach((box) => box.classList.toggle('filled', Boolean(box.value)));
  };

  boxes.forEach((box, index) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1);
      sync();
      if (box.value && index < boxes.length - 1) boxes[index + 1].focus();
      if (boxes.every((one) => one.value) && onComplete) onComplete();
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !box.value && index > 0) {
        boxes[index - 1].focus();
        boxes[index - 1].value = '';
        sync();
        event.preventDefault();
      }
      if (event.key === 'ArrowLeft' && index > 0) { boxes[index - 1].focus(); event.preventDefault(); }
      if (event.key === 'ArrowRight' && index < boxes.length - 1) { boxes[index + 1].focus(); event.preventDefault(); }
    });
    box.addEventListener('paste', (event) => {
      const digits = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      event.preventDefault();
      boxes.forEach((one, position) => { one.value = digits[position] || ''; });
      sync();
      boxes[Math.min(digits.length, boxes.length - 1)].focus();
      if (digits.length === 6 && onComplete) onComplete();
    });
  });

  return {
    value: () => boxes.map((box) => box.value).join(''),
    clear: () => { boxes.forEach((box) => { box.value = ''; }); sync(); boxes[0].focus(); },
    focus: () => boxes[0].focus(),
  };
}

// --- password strength ----------------------------------------------------

const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];

function wireStrength(inputId, meterId, labelId, emailId) {
  const input = $(inputId);
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const password = input.value;
      if (!password) {
        $(meterId).dataset.score = '0';
        $(labelId).textContent = 'Use 10+ characters with a mix of cases, numbers or symbols.';
        return;
      }
      try {
        const result = await api('/api/auth/password-strength', {
          password, email: emailId ? $(emailId)?.value : '',
        });
        $(meterId).dataset.score = String(result.score);
        $(labelId).textContent = result.acceptable
          ? `${STRENGTH_LABELS[result.score]} — good to go.`
          : (result.issues[0] || STRENGTH_LABELS[result.score]);
      } catch { /* strength is advisory; the server still validates on submit */ }
    }, 220);
  });
}

// --- resend cooldown ------------------------------------------------------

function startCooldown(buttonId, seconds = 45) {
  const button = $(buttonId);
  let left = seconds;
  button.disabled = true;
  const label = 'Resend code';
  const tick = () => {
    button.textContent = `Resend code in ${left}s`;
    if (left <= 0) {
      clearInterval(state.resendTimer);
      button.disabled = false;
      button.textContent = label;
      return;
    }
    left -= 1;
  };
  clearInterval(state.resendTimer);
  tick();
  state.resendTimer = setInterval(tick, 1000);
}

// --- flows ----------------------------------------------------------------

const verifyCode = wireCodeRow('verify-code', () => $('form-verify').requestSubmit());
const resetCode = wireCodeRow('reset-code', () => $('reset-password').focus());

$('form-signin').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert(); clearFieldErrors();
  const button = $('signin-submit');
  const email = $('signin-email').value.trim();
  const password = $('signin-password').value;
  if (!email) return fieldError('signin-email', 'Enter your email address.');
  if (!password) return fieldError('signin-password', 'Enter your password.');

  busy(button, true, 'Signing in…');
  try {
    await api('/api/auth/login', { email, password, remember: $('signin-remember').checked });
    location.href = nextUrl();
  } catch (error) {
    if (error.code === 'EMAIL_UNVERIFIED') {
      state.email = email;
      $('verify-target').textContent = email;
      showView('verify');
      alertBox('info', error.message);
      startCooldown('verify-resend');
      verifyCode.focus();
    } else if (error.code === 'CREDENTIALS_INVALID') {
      fieldError('signin-password', error.message);
    } else {
      alertBox('error', error.message);
    }
  } finally {
    busy(button, false);
  }
});

$('form-signup').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert(); clearFieldErrors();
  const button = $('signup-submit');
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const confirm = $('signup-confirm').value;
  if (!email) return fieldError('signup-email', 'Enter your email address.');
  if (password !== confirm) return fieldError('signup-confirm', 'The two passwords do not match.');

  busy(button, true, 'Creating account…');
  try {
    const result = await api('/api/auth/register', {
      email, password, displayName: $('signup-name').value.trim(),
    });
    state.email = result.email || email;
    if (result.autoConfirmed) { location.href = nextUrl(); return; }
    $('verify-target').textContent = result.maskedEmail || email;
    showView('verify');
    alertBox('success', 'Account created. Enter the 6-digit code we just emailed you.');
    startCooldown('verify-resend');
    verifyCode.focus();
  } catch (error) {
    if (error.code === 'PASSWORD_WEAK') fieldError('signup-password', error.message);
    else if (error.code === 'EMAIL_INVALID') fieldError('signup-email', error.message);
    else alertBox('error', error.message);
  } finally {
    busy(button, false);
  }
});

$('form-verify').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert();
  const button = $('verify-submit');
  const code = verifyCode.value();
  if (code.length !== 6) { alertBox('error', 'Enter all six digits.'); return; }

  busy(button, true, 'Confirming…');
  try {
    await api('/api/auth/verify-email', { email: state.email, code });
    location.href = nextUrl();
  } catch (error) {
    alertBox('error', error.message);
    verifyCode.clear();
  } finally {
    busy(button, false);
  }
});

$('verify-resend').addEventListener('click', async () => {
  clearAlert();
  try {
    await api('/api/auth/resend-code', { email: state.email });
    alertBox('info', 'A new code is on its way.');
    startCooldown('verify-resend');
  } catch (error) {
    alertBox('error', error.message);
    if (error.retryAfterSeconds) startCooldown('verify-resend', error.retryAfterSeconds);
  }
});

$('form-forgot').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert(); clearFieldErrors();
  const button = $('forgot-submit');
  const email = $('forgot-email').value.trim();
  if (!email) return fieldError('forgot-email', 'Enter your email address.');

  busy(button, true, 'Sending…');
  try {
    const result = await api('/api/auth/forgot-password', { email });
    state.email = email;
    $('reset-target').textContent = result.maskedEmail || email;
    showView('reset');
    alertBox('info', 'If that address has an account, a reset code is on its way.');
    startCooldown('reset-resend');
    resetCode.focus();
  } catch (error) {
    alertBox('error', error.message);
  } finally {
    busy(button, false);
  }
});

$('form-reset').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert(); clearFieldErrors();
  const button = $('reset-submit');
  const code = resetCode.value();
  const password = $('reset-password').value;
  if (code.length !== 6) { alertBox('error', 'Enter all six digits of the reset code.'); return; }
  if (!password) return fieldError('reset-password', 'Choose a new password.');

  busy(button, true, 'Updating…');
  try {
    await api('/api/auth/reset-password', { email: state.email, code, password });
    location.href = nextUrl();
  } catch (error) {
    if (error.code === 'PASSWORD_WEAK') fieldError('reset-password', error.message);
    else { alertBox('error', error.message); resetCode.clear(); }
  } finally {
    busy(button, false);
  }
});

$('reset-resend').addEventListener('click', async () => {
  clearAlert();
  try {
    await api('/api/auth/forgot-password', { email: state.email });
    alertBox('info', 'A new reset code is on its way.');
    startCooldown('reset-resend');
  } catch (error) {
    alertBox('error', error.message);
    if (error.retryAfterSeconds) startCooldown('reset-resend', error.retryAfterSeconds);
  }
});

// --- wiring ---------------------------------------------------------------

for (const button of document.querySelectorAll('[data-go]')) {
  button.addEventListener('click', () => showView(button.dataset.go));
}
for (const button of document.querySelectorAll('[data-reveal]')) {
  button.addEventListener('click', () => {
    const input = $(button.dataset.reveal);
    const revealed = input.type === 'text';
    input.type = revealed ? 'password' : 'text';
    button.textContent = revealed ? 'Show' : 'Hide';
    input.focus();
  });
}

wireStrength('signup-password', 'meter', 'meter-label', 'signup-email');
wireStrength('reset-password', 'reset-meter', 'reset-meter-label');

(async function boot() {
  // Already signed in? Go straight through.
  try {
    const session = await api('/api/auth/session', null, 'GET');
    if (session.authenticated) { location.href = nextUrl(); return; }
  } catch { /* fall through to the form */ }

  try {
    state.config = await api('/api/auth/config', null, 'GET');
    if (!state.config.configured) {
      alertBox('warn', 'Accounts are not available yet — this deployment is missing its Supabase credentials.');
      for (const button of document.querySelectorAll('.primary-button')) button.disabled = true;
      return;
    }
    if (!state.config.signupEnabled) {
      for (const button of document.querySelectorAll('[data-go="signup"]')) button.hidden = true;
    }
  } catch { /* config is advisory */ }

  const hash = location.hash.replace('#', '');
  showView(['signin', 'signup', 'forgot'].includes(hash) ? hash : 'signin');
}());
