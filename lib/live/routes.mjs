import { liveService } from './service.mjs';
import { newsService } from '../news/service.mjs';
import { buildUnifiedPropViewAsync } from '../props/universe.mjs';
import { internalDetail, publicMessageFor, GENERIC_MESSAGE } from '../safe-error.mjs';

function sportsFrom(url) {
  return String(url.searchParams.get('sports') || '')
    .split(',')
    .map((sport) => sport.trim().toUpperCase())
    .filter(Boolean);
}

function csvFrom(url, name) {
  return String(url.searchParams.get(name) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function handleLiveRoutes(req, res, url, { readLatest, json, log = console }) {
  if (!url.pathname.startsWith('/api/live') || req.method !== 'GET') return false;
  try {
    const sports = sportsFrom(url);
    const force = ['1', 'true', 'yes'].includes(String(url.searchParams.get('force') || '').toLowerCase());

    if (url.pathname === '/api/live') {
      const snapshot = await liveService.snapshot({ sports: sports.length ? sports : undefined, force });
      json(res, 200, snapshot);
      return true;
    }

    if (url.pathname === '/api/live/news') {
      const snapshot = await newsService.snapshot({
        sports,
        categories: csvFrom(url, 'categories'),
        publishers: csvFrom(url, 'publishers'),
        limit: Math.min(250, Math.max(1, Number(url.searchParams.get('limit')) || 180)),
        sinceHours: Math.min(168, Math.max(1, Number(url.searchParams.get('sinceHours')) || 72)),
        force,
      });
      json(res, 200, snapshot);
      return true;
    }

    if (url.pathname === '/api/live/players') {
      const scan = await readLatest();
      const view = await buildUnifiedPropViewAsync(scan, {
        filters: {
          sports,
          timeWindow: 'ALL',
          liveStatuses: ['LIVE'],
          applyScoutRules: false,
        },
        limit: 250,
      });
      json(res, 200, {
        props: view.props,
        counts: view.counts,
        fetchedAt: view.universe?.providerFetchedAt || view.scannedAt || null,
        universe: view.universe,
      });
      return true;
    }
  } catch (error) {
    log?.error?.('[Scout Pro live] request failed', JSON.stringify(internalDetail(error, { stage: 'live-route', path: url.pathname })));
    json(res, 500, { ok: false, message: publicMessageFor(error, GENERIC_MESSAGE) });
    return true;
  }
  return false;
}
