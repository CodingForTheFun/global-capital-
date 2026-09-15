const $ = (selector) => document.querySelector(selector);

const state = {
  items: [],
  sourceStatus: [],
  fetchedAt: null,
  sport: '',
  category: '',
  publisher: '',
  query: '',
  shown: 36,
  loading: false,
};

const SPORT_ORDER = ['NFL','NBA','WNBA','MLB','NHL','NCAAF','NCAAB','TENNIS','SOCCER','GOLF','BOXING','MMA','ALL'];
const CATEGORY_ORDER = ['INJURY','TRADE','SIGNING','TRANSACTION','REPORT','RUMOR','NEWS'];
const CATEGORY_LABELS = { INJURY:'Injuries', TRADE:'Trades', SIGNING:'Signings', TRANSACTION:'Transactions', REPORT:'Reports', RUMOR:'Rumors', NEWS:'News' };
const CATEGORY_CLASS = { INJURY:'injury', TRADE:'trade', SIGNING:'signing', TRANSACTION:'transaction', REPORT:'report', RUMOR:'rumor', NEWS:'news' };

function relativeTime(iso) {
  if (!iso) return 'Time unavailable';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Time unavailable';
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const units = abs < 3_600_000 ? ['minute', 60_000] : abs < 86_400_000 ? ['hour', 3_600_000] : ['day', 86_400_000];
  const value = Math.round(diff / units[1]);
  try { return new Intl.RelativeTimeFormat(undefined, { numeric:'auto' }).format(value, units[0]); }
  catch { return new Date(ms).toLocaleString(); }
}

function formatUpdated(iso) {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
}

function setNotice(message = '') {
  const notice = $('#newsNotice');
  notice.hidden = !message;
  notice.textContent = message;
}

function button(label, value, active, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `news-chip${active ? ' active' : ''}`;
  el.textContent = label;
  el.dataset.value = value;
  el.addEventListener('click', onClick);
  return el;
}

function renderFilters() {
  const sportCounts = new Map();
  const categoryCounts = new Map();
  const publishers = new Set();
  for (const item of state.items) {
    sportCounts.set(item.sport, (sportCounts.get(item.sport) || 0) + 1);
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
    publishers.add(item.publisher);
  }

  const sports = $('#newsSports');
  sports.replaceChildren();
  sports.append(button('All sports', '', !state.sport, () => { state.sport=''; state.shown=36; renderFilters(); renderItems(); }));
  for (const sport of SPORT_ORDER) {
    if (!sportCounts.has(sport)) continue;
    const label = sport === 'ALL' ? 'General' : sport;
    sports.append(button(`${label} ${sportCounts.get(sport)}`, sport, state.sport === sport, () => { state.sport=sport; state.shown=36; renderFilters(); renderItems(); }));
  }

  const categories = $('#newsCategories');
  categories.replaceChildren();
  categories.append(button('Everything', '', !state.category, () => { state.category=''; state.shown=36; renderFilters(); renderItems(); }));
  for (const category of CATEGORY_ORDER) {
    if (!categoryCounts.has(category)) continue;
    categories.append(button(`${CATEGORY_LABELS[category]} ${categoryCounts.get(category)}`, category, state.category === category, () => { state.category=category; state.shown=36; renderFilters(); renderItems(); }));
  }

  const sources = $('#newsSources');
  sources.replaceChildren();
  sources.append(button('All sources', '', !state.publisher, () => { state.publisher=''; state.shown=36; renderFilters(); renderItems(); }));
  for (const publisher of [...publishers].sort()) {
    sources.append(button(publisher, publisher, state.publisher === publisher, () => { state.publisher=publisher; state.shown=36; renderFilters(); renderItems(); }));
  }
}

function filteredItems() {
  const query = state.query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.sport && item.sport !== state.sport) return false;
    if (state.category && item.category !== state.category) return false;
    if (state.publisher && item.publisher !== state.publisher) return false;
    if (query && !`${item.title} ${item.publisher} ${item.sport} ${item.category}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function makeCard(item) {
  const card = document.createElement('a');
  card.className = 'news-card';
  card.href = item.url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer external';

  const meta = document.createElement('div');
  meta.className = 'news-meta';
  const tag = document.createElement('span');
  tag.className = `news-tag ${CATEGORY_CLASS[item.category] || 'news'}`;
  tag.textContent = CATEGORY_LABELS[item.category] || item.category || 'News';
  const sport = document.createElement('span');
  sport.className = 'news-sport';
  sport.textContent = item.sport === 'ALL' ? 'GENERAL' : item.sport;
  const source = document.createElement('span');
  source.className = 'news-source';
  source.textContent = item.attribution || item.publisher;
  const time = document.createElement('span');
  time.className = 'news-time';
  time.textContent = relativeTime(item.publishedAt);
  if (item.publishedAt) time.title = new Date(item.publishedAt).toLocaleString();
  meta.append(tag, sport, source, time);

  const title = document.createElement('h2');
  title.textContent = item.title;
  const open = document.createElement('div');
  open.className = 'news-open';
  const trust = document.createElement('span');
  trust.textContent = 'Publisher headline · opens original article';
  const arrow = document.createElement('b');
  arrow.textContent = 'Read source ↗';
  open.append(trust, arrow);
  card.append(meta, title, open);
  return card;
}

function renderItems() {
  const list = $('#newsList');
  const all = filteredItems();
  const visible = all.slice(0, state.shown);
  list.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'news-empty';
    const bold = document.createElement('b');
    bold.textContent = 'No matching stories';
    const text = document.createTextNode('Try another sport, category, source, or search.');
    empty.append(bold, text);
    list.append(empty);
  } else {
    for (const item of visible) list.append(makeCard(item));
  }
  const more = $('#newsMore');
  more.hidden = visible.length >= all.length;
  $('#newsShowing').textContent = String(all.length);
  $('#newsInjuries').textContent = String(all.filter((item) => item.category === 'INJURY').length);
  $('#newsMoves').textContent = String(all.filter((item) => ['TRADE','SIGNING','TRANSACTION'].includes(item.category)).length);
}

function renderHealth() {
  const box = $('#sourceHealth');
  box.replaceChildren();
  const grouped = new Map();
  for (const row of state.sourceStatus) {
    const current = grouped.get(row.publisher) || { total:0, ok:0, items:0 };
    current.total += 1;
    current.ok += row.ok ? 1 : 0;
    current.items += Number(row.itemCount || 0);
    grouped.set(row.publisher, current);
  }
  for (const [publisher, row] of grouped) {
    const wrap = document.createElement('div');
    wrap.className = 'source-row';
    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = publisher;
    const detail = document.createElement('small');
    detail.textContent = `${row.ok}/${row.total} feeds available · ${row.items} headlines`;
    text.append(name, detail);
    const dot = document.createElement('span');
    dot.className = `source-dot${row.ok ? ' ok' : ''}`;
    dot.title = row.ok ? 'Available' : 'Temporarily unavailable';
    wrap.append(text, dot);
    box.append(wrap);
  }
  const okCount = state.sourceStatus.filter((row) => row.ok).length;
  $('#newsHealth').textContent = `${okCount}/${state.sourceStatus.length || 0} feeds online`;
  $('#newsHealth').classList.toggle('active', okCount > 0);
  $('#newsSourcesKpi').textContent = String(grouped.size);
  $('#newsFeedsKpi').textContent = `${okCount}/${state.sourceStatus.length || 0}`;
}

function renderAll() {
  $('#newsUpdated').textContent = formatUpdated(state.fetchedAt);
  $('#newsUpdatedNote').textContent = state.fetchedAt ? relativeTime(state.fetchedAt) : 'Checking sources';
  renderFilters();
  renderHealth();
  renderItems();
}

async function loadNews({ force = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $('#newsRefresh').disabled = true;
  setNotice('');
  try {
    const url = `/api/live/news?limit=250&sinceHours=72${force ? '&force=1' : ''}`;
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store' });
    if (response.status === 401) {
      setNotice('Sign in to Oblige Props to view Sports News.');
      return;
    }
    if (!response.ok) throw new Error('feed');
    const data = await response.json();
    state.items = Array.isArray(data.items) ? data.items : [];
    state.sourceStatus = Array.isArray(data.sourceStatus) ? data.sourceStatus : [];
    state.fetchedAt = data.fetchedAt || null;
    renderAll();
    if (data.stale) setNotice('Showing the last verified news snapshot while publishers reconnect.');
  } catch {
    setNotice('Sports News is temporarily unavailable. Existing props and live feeds are unaffected.');
  } finally {
    state.loading = false;
    $('#newsRefresh').disabled = false;
  }
}

$('#newsSearch').addEventListener('input', (event) => { state.query = event.target.value || ''; state.shown=36; renderItems(); });
$('#newsMore').addEventListener('click', () => { state.shown += 36; renderItems(); });
$('#newsRefresh').addEventListener('click', () => loadNews({ force:true }));

loadNews();
setInterval(() => loadNews(), 120_000);
