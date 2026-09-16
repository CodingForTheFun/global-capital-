const text = (value) => String(value ?? '').trim();

function identity(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function eventTeamAliases(value) {
  const team = identity(value);
  if (!team) return [];

  const aliases = new Set([team]);
  const tokens = team.split(' ').filter(Boolean);

  // Sportsbook feeds commonly abbreviate the location while keeping the team
  // nickname intact (for example "ATL Falcons" vs "Atlanta Falcons" or
  // "NY Jets" vs "New York Jets"). Generate only conservative location
  // aliases so those team-total runners cannot masquerade as player names.
  for (let split = 1; split < tokens.length; split += 1) {
    const location = tokens.slice(0, split);
    const nickname = tokens.slice(split).join(' ');
    if (!nickname) continue;

    if (location.length === 1 && location[0].length >= 3) {
      aliases.add(`${location[0].slice(0, 3)} ${nickname}`);
    } else if (location.length > 1) {
      const initials = location.map((part) => part[0]).join('');
      if (initials.length >= 2) aliases.add(`${initials} ${nickname}`);
    }
  }

  return [...aliases];
}

export function isVerifiedPlayerPropRow(row) {
  if (!row || typeof row !== 'object') return false;
  const player = identity(row.playerName);
  if (!player || ['team', 'game', 'match', 'home', 'away'].includes(player)) return false;

  // Generic market labels are not player identities. FanDuel can surface
  // runners such as "Moneyline Parlay" inside responses that otherwise look
  // like valid prop records.
  if (/\bparlay\b/.test(player)) return false;

  // A player-prop row must never identify one of the event's teams as the
  // player. This catches team totals/moneyline-style markets that happen to
  // contain generic stat words such as "Points" and would otherwise look like
  // valid player markets to a text-only parser. Include conservative team
  // location aliases because some books use ATL/NY/GB-style labels.
  const eventTeams = [row.homeTeam, row.awayTeam]
    .flatMap(eventTeamAliases)
    .filter(Boolean);
  if (eventTeams.includes(player)) return false;

  // Some adapters carry the participant's team separately. A real player name
  // should not be identical to that team name or one of its location aliases.
  const participantTeamAliases = eventTeamAliases(row.team);
  if (participantTeamAliases.includes(player)) return false;

  return true;
}
