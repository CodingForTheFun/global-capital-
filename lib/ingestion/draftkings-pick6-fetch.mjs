import { http2JsonFetch } from './http2-json-fetch.mjs';

const LIST_URL = 'https://api.draftkings.com/sites/US-PSX/pick6/v1/pickgroups/main?showLive=false&appname=psxandroid&version=253542100&format=json';
const LEAGUE_URL = key => `https://api.draftkings.com/sites/US-PSX/pick6/v1/pickgroups/identifier?pillIdentifier=${encodeURIComponent(key)}&appname=psxandroid&version=260861600&format=json`;
const MARKET_URL = (groupId, categoryId = null) => {
  const url = new URL(`https://api.draftkings.com/sites/US-PSX/pick6/v1/pickgroups/${encodeURIComponent(groupId)}/category/pickcards`);
  if (categoryId != null) url.searchParams.set('pickCategoryId', String(categoryId));
  url.searchParams.set('appname','psxandroid');
  url.searchParams.set('version','260861600');
  url.searchParams.set('format','json');
  return url.href;
};
const headers = Object.freeze({ 'user-agent':'DraftKings/260861600 okhttp/4.12.0', accept:'application/json' });
const text = value => String(value ?? '').trim();
const supabaseUrl = () => text(process.env.AUTOSCOUT_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/,'');
const token = () => text(process.env.AUTOSCOUT_SUPABASE_INGEST_TOKEN);

function direct(kind, params = {}) {
  if (kind === 'root') return LIST_URL;
  if (kind === 'league') return LEAGUE_URL(params.key);
  if (kind === 'market') return MARKET_URL(params.group, params.category ?? null);
  throw Object.assign(new Error('DRAFTKINGS_PICK6_ROUTE_INVALID'), { code:'DRAFTKINGS_PICK6_ROUTE_INVALID' });
}

async function edge(kind, params = {}) {
  if (!supabaseUrl() || !token()) throw Object.assign(new Error('DRAFTKINGS_EDGE_NOT_CONFIGURED'), { code:'DRAFTKINGS_EDGE_NOT_CONFIGURED' });
  const url = new URL(`${supabaseUrl()}/functions/v1/autoscout-public-feed`);
  url.searchParams.set('source','draftkings_pick6');
  url.searchParams.set('kind',kind);
  if (params.key) url.searchParams.set('key',String(params.key));
  if (params.group) url.searchParams.set('group',String(params.group));
  if (params.category != null) url.searchParams.set('category',String(params.category));
  const response = await fetch(url, {
    headers:{accept:'application/json','x-autoscout-ingest-token':token()},
    signal:AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true || !body?.data) {
    const attempt = Array.isArray(body?.attempts) ? body.attempts.at(-1) : null;
    throw Object.assign(new Error('DRAFTKINGS_EDGE_FAILED'), { code:'DRAFTKINGS_EDGE_FAILED', status:Number(attempt?.status || response.status) || null });
  }
  return body.data;
}

export async function fetchDraftKingsPick6Json(kind, params = {}) {
  const url = direct(kind, params);
  try {
    return await http2JsonFetch(url, { headers, timeoutMs:15_000 });
  } catch (error) {
    if (Number(error?.status) !== 403 && error?.code !== 'PUBLIC_HTTP2_HTTP') throw error;
    return edge(kind, params);
  }
}
