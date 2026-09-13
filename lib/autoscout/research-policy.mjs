const text = value => String(value ?? '').trim();

export function isMultiPlayerSelection(playerName) {
  return /\s+\+\s+/.test(text(playerName));
}

export function isFantasyScoringMarket(market, marketId = '') {
  const value = `${text(market)} ${text(marketId)}`;
  return /\bfantasy(?:\s+(?:score|points?))?\b/i.test(value);
}

export function researchSelectionPolicy({ sport, playerName, market, providerMarketKey, marketId } = {}) {
  if (isMultiPlayerSelection(playerName)) {
    return {
      eligible: false,
      code: 'MULTI_PLAYER_COMBO',
      message: 'Live combo line only. Auto Scout does not combine separate player histories unless the source provides a verified combo history, because doing so could misstate how the prop is settled.',
    };
  }
  if (isFantasyScoringMarket(market, providerMarketKey || marketId)) {
    return {
      eligible: false,
      code: 'FANTASY_SCORING_UNVERIFIED',
      message: 'Live fantasy line only. Historical hit rates are withheld until this platform’s exact scoring formula is verified for this sport.',
    };
  }
  if (text(sport).toUpperCase() === 'TENNIS') {
    return {
      eligible: false,
      code: 'HISTORICAL_SOURCE_UNVERIFIED',
      message: 'Live tennis line only. Auto Scout has not yet verified a complete tennis match-history source for these prop statistics, so it will not invent L5/L10/H2H results.',
    };
  }
  return { eligible: true, code: null, message: null };
}

export function lineOnlyResearch(params = {}) {
  const policy = researchSelectionPolicy(params);
  return policy.eligible ? null : {
    ok: true,
    available: false,
    code: policy.code,
    message: policy.message,
    gameLog: [],
    lineOnly: true,
    retryable: false,
  };
}
