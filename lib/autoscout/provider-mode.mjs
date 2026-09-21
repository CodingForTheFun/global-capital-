const text = (value) => String(value ?? '').trim().toLowerCase();

const ALIASES = Object.freeze({
  auto: 'auto',
  radar: 'sportradar',
  sr: 'sportradar',
  sportradar: 'sportradar',
  line: 'propline',
  pl: 'propline',
  propline: 'propline',
  sgo: 'sportsgameodds',
  sportsgameodds: 'sportsgameodds',
  'sports-game-odds': 'sportsgameodds',
});

export const PROP_PROVIDER_MODES = Object.freeze(['auto', 'sportradar', 'propline', 'sportsgameodds']);

export function propProviderMode(env = process.env) {
  const raw = text(env.OBLIGE_PROP_PROVIDER_MODE || env.PROP_PROVIDER_MODE || 'auto');
  return ALIASES[raw] || 'auto';
}

export function providerSwitchWord(env = process.env) {
  const mode = propProviderMode(env);
  return {
    mode,
    word: {
      auto: 'AUTO',
      sportradar: 'RADAR',
      propline: 'LINE',
      sportsgameodds: 'SGO',
    }[mode],
  };
}

export function providerRouting(env = process.env) {
  const mode = propProviderMode(env);
  if (mode === 'sportradar') {
    return { mode, primary: 'sportradar', enabled: ['sportradar', 'sportsgameodds'], fallback: ['sportsgameodds'] };
  }
  if (mode === 'propline') {
    return { mode, primary: 'propline', enabled: ['propline', 'sportsgameodds'], fallback: ['sportsgameodds'] };
  }
  if (mode === 'sportsgameodds') {
    return { mode, primary: 'sportsgameodds', enabled: ['sportsgameodds'], fallback: [] };
  }
  // AUTO deliberately preserves the pre-switch production precedence. Turning
  // the new switch off therefore cannot silently move customer quotes.
  return { mode, primary: 'propline', enabled: ['propline', 'sportradar', 'sportsgameodds'], fallback: ['sportradar', 'sportsgameodds'] };
}

export function providerIsEnabled(id, env = process.env) {
  return providerRouting(env).enabled.includes(text(id));
}

export function providerIsPrimary(id, env = process.env) {
  return providerRouting(env).primary === text(id);
}
