import { json, requireUser, requireAdmin, refreshHeaders, readBody, sameOrigin } from '../auth/routes.mjs';
import { lineHistory, playerStats, injuries, liveScores, headshots, subscriptions, users, diagnostics } from '../db/repositories.mjs';
import { entitlements, requireFeature, resolveTier, scanUsage, UpgradeRequired, TIERS } from '../billing/entitlements.mjs';
import { systemDiagnostics } from '../providers/catalog.mjs';
import { adminAuth } from '../db/supabase.mjs';

function fail(res, error, headers = {}) {
  if (error instanceof UpgradeRequired) {
    return json(res, 402, {
      ok: false, code: error.code, message: error.message,
      feature: error.feature, currentTier: error.currentTier,
    }, headers);
  }
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error('[api error]', error?.stack || error?.message || error);
  return json(res, status, {
    ok: false,
    code: error?.code || 'SERVER_ERROR',
    message: status >= 500 ? 'Something went wrong. Try again.' : (error?.message || 'Request failed.'),
  }, headers);
}

const param = (url, name) => url.searchParams.get(name) || '';

// `existingSession` is the session the server already resolved for this
// request, so a call never costs a second round trip to Supabase.
export async function handleApiRequest(req, res, url, existingSession = null) {
  const route = url.pathname;
  if (!route.startsWith('/api/me') && !route.startsWith('/api/data/')
    && !route.startsWith('/api/billing/') && !route.startsWith('/api/admin/')) return false;

  const session = existingSession || await requireUser(req, res);
  if (!session) return true;
  const headers = refreshHeaders(req, session);
  const { user, envelope } = session;
  const accessToken = envelope.accessToken;

  try {
    // --- identity + entitlements -----------------------------------------
    if (route === '/api/me' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        user,
        entitlements: entitlements(user),
        scanUsage: scanUsage(user),
      }, headers);
    }

    // --- line history -----------------------------------------------------
    if (route === '/api/data/line-history' && req.method === 'GET') {
      const tier = requireFeature(user, 'lineHistory');
      const result = await lineHistory.forProp({
        propId: param(url, 'propId'),
        bookmakerKey: param(url, 'book') || undefined,
        side: param(url, 'side') || undefined,
        sinceHours: Math.min(Number(param(url, 'hours')) || 72, tier.features.lineHistoryHours),
        accessToken,
      });
      return json(res, 200, { ok: true, ...result }, headers);
    }

    if (route === '/api/data/line-movement' && req.method === 'GET') {
      const tier = requireFeature(user, 'lineHistory');
      const result = await lineHistory.movement({
        propId: param(url, 'propId'),
        bookmakerKey: param(url, 'book') || undefined,
        side: param(url, 'side') || undefined,
        sinceHours: Math.min(Number(param(url, 'hours')) || 72, tier.features.lineHistoryHours),
        accessToken,
      });
      return json(res, 200, { ok: true, ...result }, headers);
    }

    if (route === '/api/data/line-spread' && req.method === 'GET') {
      const result = await lineHistory.spread({
        propId: param(url, 'propId'), side: param(url, 'side') || 'OVER', accessToken,
      });
      return json(res, 200, { ok: true, ...result }, headers);
    }

    // --- player data ------------------------------------------------------
    if (route === '/api/data/player-stats' && req.method === 'GET') {
      const window = Number(param(url, 'window')) || 10;
      const line = param(url, 'line');
      const result = line
        ? await playerStats.hitRate({
          playerId: param(url, 'playerId'),
          statKey: param(url, 'stat'),
          line: Number(line),
          window,
          side: param(url, 'side') || 'OVER',
          accessToken,
        })
        : await playerStats.samples({
          playerId: param(url, 'playerId'), statKey: param(url, 'stat') || undefined, accessToken,
        });
      return json(res, 200, { ok: true, ...result }, headers);
    }

    if (route === '/api/data/injuries' && req.method === 'GET') {
      return json(res, 200, {
        ok: true, ...(await injuries.forPlayer({ playerId: param(url, 'playerId'), accessToken })),
      }, headers);
    }

    if (route === '/api/data/live' && req.method === 'GET') {
      return json(res, 200, {
        ok: true, ...(await liveScores.forEvent({ eventId: param(url, 'eventId'), accessToken })),
      }, headers);
    }

    if (route === '/api/data/headshots' && req.method === 'GET') {
      const ids = param(url, 'ids').split(',').map((id) => id.trim()).filter(Boolean).slice(0, 60);
      return json(res, 200, {
        ok: true, ...(await headshots.forPlayers({ playerIds: ids, accessToken })),
      }, headers);
    }

    // --- billing ----------------------------------------------------------
    if (route === '/api/billing/plans' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        currentTier: resolveTier(user).key,
        plans: Object.values(TIERS).map((tier) => ({
          key: tier.key, name: tier.name, price: tier.price, features: tier.features,
        })),
      }, headers);
    }

    if (route === '/api/billing/subscription' && req.method === 'GET') {
      const row = await subscriptions.forUser({ userId: user.id, accessToken });
      return json(res, 200, {
        ok: true,
        subscription: row,
        entitlements: entitlements(user),
      }, headers);
    }

    // --- admin ------------------------------------------------------------
    if (route.startsWith('/api/admin/')) {
      if (!user.isAdmin) {
        return json(res, 403, {
          ok: false, code: 'FORBIDDEN', message: 'This action is limited to admins.',
        }, headers);
      }
      const admin = session;

      if (route === '/api/admin/diagnostics' && req.method === 'GET') {
        return json(res, 200, { ok: true, ...(await systemDiagnostics({ accessToken })) }, headers);
      }

      if (route === '/api/admin/users' && req.method === 'GET') {
        const [profiles, subs] = await Promise.all([
          users.list({ limit: 200, accessToken }),
          subscriptions.listAll({ limit: 200, accessToken }).catch(() => ({ rows: [] })),
        ]);
        const byUser = new Map((subs.rows || []).map((row) => [row.user_id, row]));
        return json(res, 200, {
          ok: true,
          available: profiles.available !== false,
          users: (profiles.rows || []).map((row) => ({
            id: row.id,
            email: row.email,
            displayName: row.display_name,
            role: row.role,
            createdAt: row.created_at,
            subscription: byUser.get(row.id) || null,
          })),
        }, headers);
      }

      if (route === '/api/admin/users/role' && req.method === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' }, headers);
        const body = await readBody(req, 4_000);
        if (body.userId === admin.user.id) {
          return json(res, 400, {
            ok: false, code: 'SELF_DEMOTION', message: 'You cannot change your own role.',
          }, headers);
        }
        // Only an owner may mint another owner or admin.
        if (['OWNER', 'ADMIN'].includes(body.role) && !admin.user.isOwner) {
          return json(res, 403, {
            ok: false, code: 'OWNER_REQUIRED', message: 'Only the owner can grant admin access.',
          }, headers);
        }
        const updated = await users.setRole({ userId: body.userId, role: body.role, accessToken });
        return json(res, 200, { ok: true, user: updated }, headers);
      }

      if (route === '/api/admin/subscriptions' && req.method === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { ok: false, message: 'Cross-origin request rejected.' }, headers);
        const body = await readBody(req, 4_000);
        const updated = await subscriptions.upsert({
          userId: body.userId,
          tier: body.tier === 'pro' ? 'pro' : 'free',
          status: String(body.status || 'inactive'),
          provider: body.provider || 'manual',
          currentPeriodEnd: body.currentPeriodEnd || null,
        });
        return json(res, 200, { ok: true, subscription: updated }, headers);
      }

      if (route === '/api/admin/errors' && req.method === 'GET') {
        return json(res, 200, {
          ok: true, ...(await diagnostics.recentErrors({ limit: 50, accessToken })),
        }, headers);
      }

      if (route === '/api/admin/identity' && req.method === 'GET') {
        // Service-role listing exposes confirmation state the profile table lacks.
        if (!adminAuth.available()) {
          return json(res, 200, {
            ok: true, available: false,
            reason: 'SUPABASE_SERVICE_ROLE_KEY is not set, so identity details are unavailable.',
            users: [],
          }, headers);
        }
        const result = await adminAuth.listUsers({ perPage: 100 });
        return json(res, 200, {
          ok: true,
          available: true,
          users: (result?.users || []).map((row) => ({
            id: row.id,
            email: row.email,
            emailConfirmedAt: row.email_confirmed_at || row.confirmed_at || null,
            lastSignInAt: row.last_sign_in_at,
            createdAt: row.created_at,
          })),
        }, headers);
      }

      return json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Unknown admin endpoint.' }, headers);
    }

    return json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Unknown endpoint.' }, headers);
  } catch (error) {
    return fail(res, error, headers);
  }
}
