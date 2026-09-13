const text = (value) => String(value ?? '').trim();

function identity(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isVerifiedPlayerPropRow(row) {
  if (!row || typeof row !== 'object') return false;
  const player = identity(row.playerName);
  if (!player || ['team', 'game', 'match', 'home', 'away'].includes(player)) return false;

  // A player-prop row must never identify one of the event's teams as the
  // player. This catches team totals/moneyline-style markets that happen to
  // contain generic stat words such as "Points" and would otherwise look like
  // valid player markets to a text-only parser.
  const eventTeams = [row.homeTeam, row.awayTeam]
    .map(identity)
    .filter(Boolean);
  if (eventTeams.includes(player)) return false;

  // Some adapters carry the participant's team separately. A real player name
  // should not be identical to that team name either.
  const team = identity(row.team);
  if (team && player === team) return false;

  return true;
}
