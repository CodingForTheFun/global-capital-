import { providerRegistry } from './registry.mjs';
import { healthCheck } from '../db/supabase.mjs';
import { diagnostics } from '../db/repositories.mjs';
import { mailerConfig } from '../auth/mailer.mjs';
import { paypalConfig } from '../payments/paypal.mjs';

// Data providers the app can consume. A provider is "connected" only when its
// credentials are actually present — nothing is assumed, and no adapter
// invents data when its source is missing.
export const dataProviders = [
  {
    id: 'sportsdataio',
    name: 'SportsDataIO',
    supplies: ['player-statistics', 'injuries', 'depth-charts', 'headshots'],
    envKeys: ['SPORTSDATAIO_API_KEY'],
    tables: ['player_statistics', 'injuries', 'players'],
    note: 'Trial keys are scope-limited; hit rates stay unavailable until a plan covering game stats is active.',
  },
  {
    id: 'the-odds-api',
    name: 'The Odds API',
    supplies: ['events', 'props', 'prop-lines', 'line-history'],
    envKeys: ['ODDS_API_KEY'],
    tables: ['events', 'props', 'prop_lines', 'line_snapshots'],
  },
  {
    id: 'scores-provider',
    name: 'Live Scores Provider',
    supplies: ['live-scores', 'game-state'],
    envKeys: ['SCORES_API_KEY'],
    tables: ['games'],
  },
  {
    id: 'headshot-provider',
    name: 'Headshot / Media Provider',
    supplies: ['headshots'],
    envKeys: ['HEADSHOT_API_KEY', 'HEADSHOT_BASE_URL'],
    tables: ['players'],
    note: 'Headshots render only from a licensed URL stored on players.headshot_url. Initials are shown otherwise.',
  },
];

function envPresence(keys) {
  const present = keys.filter((key) => String(process.env[key] || '').trim().length > 0);
  return { configured: present.length === keys.length, present, missing: keys.filter((k) => !present.includes(k)) };
}

export function providerStatus() {
  return dataProviders.map((provider) => {
    const env = envPresence(provider.envKeys);
    return {
      id: provider.id,
      name: provider.name,
      supplies: provider.supplies,
      tables: provider.tables,
      note: provider.note || null,
      configured: env.configured,
      missingEnv: env.missing,
      // "connected" is only ever claimed when credentials exist.
      status: env.configured ? 'connected' : 'missing-credentials',
    };
  });
}

// Full system picture for the admin console.
export async function systemDiagnostics({ accessToken } = {}) {
  const [database, runs, errors, usage] = await Promise.all([
    healthCheck(),
    diagnostics.recentRuns({ limit: 10, accessToken }).catch(() => ({ available: false, rows: [] })),
    diagnostics.recentErrors({ limit: 15, accessToken }).catch(() => ({ available: false, rows: [] })),
    diagnostics.usageSummary({ limit: 50, accessToken }).catch(() => ({ available: false, rows: [], byProvider: {} })),
  ]);

  const mailer = mailerConfig();
  const paypal = paypalConfig();

  return {
    generatedAt: new Date().toISOString(),
    database,
    scrapers: providerRegistry.map((row) => ({
      id: row.id, name: row.name, status: row.status, capabilities: row.capabilities,
    })),
    dataProviders: providerStatus(),
    email: { provider: mailer.provider, configured: mailer.configured },
    payments: { provider: 'paypal', configured: paypal.enabled, environment: paypal.environment },
    recentRuns: runs.rows || [],
    recentErrors: errors.rows || [],
    apiUsage: usage.byProvider || {},
  };
}
