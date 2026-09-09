export const PROVIDER_KINDS = Object.freeze({
  DATA: 'data',
  ODDS: 'odds',
  STATS: 'stats',
  SCORES: 'scores',
  INJURY: 'injury',
});

export function validateProvider(provider, kind) {
  const errors = [];
  if (!provider || typeof provider !== 'object') return ['provider must be an object'];
  if (!provider.id || typeof provider.id !== 'string') errors.push('id is required');
  if (!provider.name || typeof provider.name !== 'string') errors.push('name is required');
  if (!Object.values(PROVIDER_KINDS).includes(kind)) errors.push(`unknown provider kind: ${kind}`);
  if (typeof provider.isConfigured !== 'function') errors.push('isConfigured() is required');
  if (typeof provider.health !== 'function') errors.push('health() is required');
  if (kind === PROVIDER_KINDS.ODDS && typeof provider.fetchBoard !== 'function') errors.push('OddsProvider requires fetchBoard()');
  return errors;
}

export class ProviderRegistry {
  constructor() { this.providers = new Map(); }
  register(kind, provider) {
    const errors = validateProvider(provider, kind);
    if (errors.length) throw new Error(`${provider?.id || 'provider'} contract invalid: ${errors.join('; ')}`);
    if (!this.providers.has(kind)) this.providers.set(kind, new Map());
    this.providers.get(kind).set(provider.id, provider);
    return provider;
  }
  get(kind, id) { return this.providers.get(kind)?.get(id) || null; }
  list(kind) { return [...(this.providers.get(kind)?.values() || [])]; }
  configured(kind) { return this.list(kind).filter((provider) => provider.isConfigured()); }
}
