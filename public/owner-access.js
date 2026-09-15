const $ = (id) => document.getElementById(id);
let requesting = false;
let verifying = false;

function notice(text, type = '') {
  const el = $('notice');
  if (!text) { el.className = 'notice hidden'; el.textContent = ''; return; }
  el.className = `notice ${type}`.trim();
  el.textContent = text;
}
async function api(path, body = {}) {
  const response = await fetch(path, {
    method:'POST',
    credentials:'same-origin',
    cache:'no-store',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.message || 'That request could not be completed.');
  return data;
}
function showVerify() {
  $('verifyForm').hidden = false;
  $('codeInput').focus({ preventScroll:true });
}
async function requestCode() {
  if (requesting) return;
  requesting = true;
  $('sendCodeBtn').disabled = true;
  $('resendBtn').disabled = true;
  notice('Requesting a private owner code…');
  try {
    const data = await api('/api/owner-recovery/start');
    notice(data.message || 'If recovery is available, a code was sent.', 'success');
    showVerify();
  } catch (error) {
    notice(error.message || 'Owner recovery is temporarily unavailable.', 'error');
  } finally {
    requesting = false;
    $('sendCodeBtn').disabled = false;
    $('resendBtn').disabled = false;
  }
}
async function verifyCode(event) {
  event.preventDefault();
  if (verifying) return;
  const code = $('codeInput').value.replace(/\D/g, '').slice(0, 6);
  if (code.length !== 6) {
    notice('Enter the 6-digit owner code.', 'error');
    $('codeInput').focus();
    return;
  }
  verifying = true;
  $('verifyBtn').disabled = true;
  notice('Verifying owner access…');
  try {
    const data = await api('/api/owner-recovery/verify', { code });
    notice('Owner verified. Opening the control center…', 'success');
    window.location.assign(data.redirect || '/owner');
  } catch (error) {
    notice(error.message || 'That code could not be verified.', 'error');
    $('codeInput').select();
  } finally {
    verifying = false;
    $('verifyBtn').disabled = false;
  }
}

$('sendCodeBtn').addEventListener('click', requestCode);
$('resendBtn').addEventListener('click', requestCode);
$('verifyForm').addEventListener('submit', verifyCode);
$('codeInput').addEventListener('input', (event) => {
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6);
});
