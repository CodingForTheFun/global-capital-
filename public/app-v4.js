const nativeFetch = window.fetch.bind(window);
window.__autoPropRulesEnabled = null;

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

function responseWithJson(original, data) {
  const headers = new Headers(original.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(data), {
    status: original.status,
    statusText: original.statusText,
    headers,
  });
}

function patchRuleLabels() {
  if (window.__autoPropRulesEnabled !== false) return;
  document.querySelectorAll('.reject-tag').forEach((node) => {
    node.textContent = 'UNFILTERED';
    node.classList.remove('reject-tag');
    node.classList.add('near-tag');
  });
  const warning = document.getElementById('warningBox');
  if (warning && /malformed scraper records were hidden/i.test(warning.textContent || '')) {
    warning.textContent = (warning.textContent || '').replace(/\s*•?\s*\d+ malformed scraper records were hidden\.?/gi, '').trim();
  }
  const details = document.getElementById('detailsBody');
  if (details && /^REJECTED\b/i.test(details.textContent || '')) {
    const eyebrow = details.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = eyebrow.textContent.replace(/^REJECTED/i, 'UNFILTERED • RULES OFF');
  }
}

function scheduleFullBoardUI() {
  setTimeout(() => {
    if (window.__autoPropRulesEnabled !== false) return;
    const all = document.querySelector('.segment[data-filter="all"]');
    if (all && !all.classList.contains('active')) all.click();
    patchRuleLabels();
  }, 80);
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

  const response = await nativeFetch(input, init);
  if (url.includes('/api/status') && response.ok) {
    try {
      const data = await response.clone().json();
      const enabled = data?.rules?.rulesEnabled ?? data?.latest?.rulesEnabled ?? null;
      window.__autoPropRulesEnabled = enabled;
      if (data?.latest?.allBoard && Array.isArray(data.latest.allBoard)) {
        const board = data.latest.allBoard;
        data.latest.picks = board;
        data.latest.totalReviewed = Number(data.latest.totalLoaded ?? board.length);
        data.latest.totalLoaded = Number(data.latest.totalLoaded ?? board.length);
        data.latest.suppressedMalformedCount = 0;
        data.latest.rulesEnabled = enabled;
        if (enabled === false) {
          data.latest.qualifiedCount = 0;
          data.latest.rejectedCount = 0;
          data.latest.bestAvailable = [];
          data.latest.diversifiedCard = [];
          data.latest.warnings = [`Rules are OFF. Showing all ${board.length} props discovered from PickFinder.`];
        }
      }
      scheduleFullBoardUI();
      return responseWithJson(response, data);
    } catch {}
  }
  return response;
};

const observer = new MutationObserver(() => {
  patchRuleLabels();
});
observer.observe(document.documentElement, { childList:true, subtree:true });

ensureInviteField();
ensureCheckoutHook();
await import('./app-v4-core.js');
ensureInviteField();
ensureCheckoutHook();
