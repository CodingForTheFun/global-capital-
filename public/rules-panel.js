(() => {
  const ids = ['minL5','minL10','minL15','minH2H','minExpectedOutcome','minFilterHitRate'];
  const toggles = ['useH2H','requireWinLoss','requireOpponent','requireSeason','requireHomeAway','requireTeam','requireAdvancedAvailable','bestAvailable'];
  let presets = {};
  let currentPreset = 'strict';

  function injectStyles() {
    if (document.getElementById('ruleFilterStyles')) return;
    const style = document.createElement('style');
    style.id = 'ruleFilterStyles';
    style.textContent = `
      .mini-action{border:1px solid rgba(103,224,255,.24);background:rgba(103,224,255,.06);color:#8cecff;border-radius:10px;padding:7px 10px;font:inherit;font-size:12px;font-weight:800;cursor:pointer}
      .rules-dialog{width:min(760px,calc(100vw - 24px));max-height:min(88vh,900px);overflow:auto}.locked-rule-row{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.locked-rule-row span{padding:8px 10px;border-radius:999px;background:rgba(92,224,255,.07);border:1px solid rgba(92,224,255,.14);font-size:12px;font-weight:750;color:#bdefff}.preset-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 20px}.preset-row button{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:inherit;border-radius:12px;padding:12px;font:inherit;font-weight:800;cursor:pointer}.preset-row button.active{border-color:rgba(71,226,255,.6);background:rgba(71,226,255,.12);color:#9ef3ff}.rules-form{display:grid;gap:14px}.rule-slider{padding:13px 14px;border-radius:15px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07)}.rule-slider label{display:flex;justify-content:space-between;gap:12px;font-size:13px;margin-bottom:10px}.rule-slider input[type=range]{width:100%;accent-color:#50e7ff}.toggle-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.toggle-grid>label{display:flex;align-items:flex-start;gap:10px;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.025);cursor:pointer}.toggle-grid input{margin-top:3px;accent-color:#50e7ff}.toggle-grid b,.toggle-grid small{display:block}.toggle-grid b{font-size:13px}.toggle-grid small{opacity:.58;font-size:11px;margin-top:3px;line-height:1.35}.compact-number{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border:1px solid rgba(255,255,255,.07);border-radius:14px;font-size:13px}.compact-number input{width:72px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:inherit;padding:9px;text-align:center}.rule-profile-note{margin-top:10px;font-size:11px;opacity:.6;line-height:1.5}
      @media(max-width:620px){.rules-dialog{width:calc(100vw - 12px);max-height:92vh;margin:auto 6px}.toggle-grid{grid-template-columns:1fr}.preset-row button{padding:10px 6px}.locked-rule-row{gap:6px}.locked-rule-row span{font-size:10px}}
    `;
    document.head.appendChild(style);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body ? { 'content-type':'application/json', ...(options.headers || {}) } : options.headers,
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
    return data;
  }

  function setPresetButtons(name) {
    document.querySelectorAll('[data-rule-preset]').forEach((button) => button.classList.toggle('active', button.dataset.rulePreset === name));
  }

  function populate(rules) {
    if (!rules) return;
    currentPreset = rules.preset || 'custom';
    ids.forEach((id) => {
      const input = document.getElementById(id);
      const value = document.getElementById(`${id}Value`);
      if (!input) return;
      input.value = Number(rules[id] ?? input.value ?? 0);
      if (value) value.textContent = `${input.value}%`;
    });
    toggles.forEach((id) => { const input = document.getElementById(id); if (input) input.checked = Boolean(rules[id]); });
    const count = document.getElementById('bestAvailableLimit');
    if (count) count.value = Number(rules.bestAvailableLimit || 12);
    setPresetButtons(currentPreset);
    renderSummary(rules);
  }

  function formRules() {
    const rules = { preset: currentPreset };
    ids.forEach((id) => { rules[id] = Number(document.getElementById(id)?.value || 0); });
    toggles.forEach((id) => { rules[id] = Boolean(document.getElementById(id)?.checked); });
    rules.bestAvailableLimit = Number(document.getElementById('bestAvailableLimit')?.value || 12);
    return rules;
  }

  function renderSummary(rules) {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const name = String(rules.preset || 'custom');
    set('rulePresetName', `${name.charAt(0).toUpperCase()}${name.slice(1)} profile`);
    set('ruleL5', `${rules.minL5}%+`);
    set('ruleL10', `${rules.minL10}%+`);
    set('ruleL15', `${rules.minL15}%+`);
    set('ruleH2H', rules.useH2H ? `${rules.minH2H}%+` : 'Optional');
    set('ruleWL', rules.requireWinLoss ? `${rules.minExpectedOutcome}%+` : 'Optional');
    set('ruleContext', `${rules.minFilterHitRate}%+`);
  }

  async function loadRules(open = false) {
    const data = await api('/api/rules');
    presets = data.presets || {};
    populate(data.rules);
    if (open) document.getElementById('rulesDialog')?.showModal();
  }

  function markCustom() {
    currentPreset = 'custom';
    setPresetButtons('custom');
  }

  function choosePreset(name) {
    const preset = presets[name];
    if (!preset) return;
    currentPreset = name;
    populate({ ...preset, preset: name });
  }

  async function save(event) {
    event.preventDefault();
    const state = document.getElementById('rulesState');
    const button = document.getElementById('saveRulesBtn');
    if (state) { state.className = 'connect-state working'; state.textContent = 'Saving rule profile…'; }
    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    try {
      const data = await api('/api/rules', { method:'PUT', body:JSON.stringify({ rules: formRules() }) });
      populate(data.rules);
      if (state) { state.className = 'connect-state success'; state.textContent = 'Saved. Manual and scheduled scans will use these rules.'; }
      setTimeout(() => document.getElementById('rulesDialog')?.close(), 700);
    } catch (error) {
      if (state) { state.className = 'connect-state error'; state.textContent = error.message || 'Could not save rules.'; }
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Save rules'; }
    }
  }

  function bind() {
    injectStyles();
    document.getElementById('ruleFiltersBtn')?.addEventListener('click', () => loadRules(true).catch(() => {}));
    document.getElementById('sideRuleFiltersBtn')?.addEventListener('click', () => loadRules(true).catch(() => {}));
    document.getElementById('rulesForm')?.addEventListener('submit', save);
    document.querySelectorAll('[data-rule-preset]').forEach((button) => button.addEventListener('click', () => choosePreset(button.dataset.rulePreset)));
    ids.forEach((id) => {
      const input = document.getElementById(id);
      input?.addEventListener('input', () => {
        const value = document.getElementById(`${id}Value`);
        if (value) value.textContent = `${input.value}%`;
        markCustom();
      });
    });
    toggles.forEach((id) => document.getElementById(id)?.addEventListener('change', markCustom));
    document.getElementById('bestAvailableLimit')?.addEventListener('input', markCustom);
    loadRules(false).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true });
  else bind();
})();
