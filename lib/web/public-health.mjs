// What a signed-out visitor may learn from a health endpoint.
//
// The data core's /api/health is an operator report: provider names, plan
// tiers, monthly quota used and remaining, vendor notices, polling policy and
// storage use. The generic sanitizer rewrites vendor names in values but not in
// keys, and it has no idea that a quota count is owner detail. So health is
// reduced to an allowlist before it leaves the frontdoor, and only the owner
// sees the full report.
//
// The allowlist is exactly what uptime checks read: the Railway healthcheck
// (status only), the release smoke tests (ok, service, revision,
// provider.configured) and the site QA (ok).

const text = (value, max = 80) => (typeof value === 'string' ? value.slice(0, max) : undefined);

export function publicHealth(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const out = { ok: body.ok === true };
  const service = text(body.service) ?? text(body.app);
  if (service) out.service = service;
  const revision = text(body.revision, 64);
  if (revision && /^[0-9a-f]{7,64}$/i.test(revision)) out.revision = revision;
  for (const key of ['startedAt', 'time']) {
    const value = text(body[key], 40);
    if (value && Number.isFinite(Date.parse(value))) out[key] = value;
  }
  if (body.provider && typeof body.provider === 'object') out.provider = { configured: body.provider.configured === true };
  return out;
}

export const HEALTH_PATHS = new Set(['/api/health', '/api/apex/health', '/api/apex-next/health']);
