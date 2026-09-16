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
  const raw = text(value);
  if (!raw) return [];

  // Baseball and some other sportsbook event labels append the expected
  // starter in parentheses (for example "Chicago White Sox (A Kay)"). Keep
  // both the complete label and the team-only form so downstream integrity
  // checks compare against the actual club name instead of the qualifier.
  const teams = new Set([
    identity(raw),
    identity(raw.replace(/\s*\([^)]*\)\s*$/g, '')),
  ].filter(Boolean));
  const aliases = new Set(teams);

  for (const team of teams) {
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
  }

  return [...aliases];
}

function hasSameTeamBoundary(player, team) {
  const playerTokens = identity(player).split(' ').filter(Boolean);
  const teamTokens = identity(team).split(' ').filter(Boolean);
  if (playerTokens.length < 2 || teamTokens.length < 2) return false;

  const playerFirst = playerTokens[0];
  const playerLast = playerTokens.at(-1);
  const teamFirst = teamTokens[0];
  const teamLast = teamTokens.at(-1);

  // This intentionally requires both a substantial first and last token. It
  // catches parser-damaged team labels such as "Chicago W e Sox" while not
  // rejecting real players merely because they share a city or one word with
  // an event team.
  return playerFirst.length >= 3 && playerLast.length >= 3
    && playerFirst === teamFirst && playerLast === teamLast;
}

function isImpossibleFanDuelFootballMarket(row) {
  const provider = text(row?.sportsbookKey || row?.provider).toLowerCase();
  const sport = text(row?.sport).toUpperCase();
  const market = text(row?.marketId).toLowerCase();
  if (provider !== 'fanduel' || !['NFL', 'NCAAF'].includes(sport)) return false;

  // FanDuel's public page labels can include player/team text in the same
  // string that the lightweight stat parser scans. Baseball words (or a
  // player's surname ending in "ks") can therefore be misread as Strikeouts,
  // and a football team total can be misread as generic player Points. These
  // markets are impossible/ambiguous for this football adapter. Valid kicking
  // points are normalized separately as player_kicking_points.
  if (market === 'player_points') return true;
  return /(?:^|_)(?:pitcher_)?strikeouts?(?:_|$)/.test(market)
    || /(?:^|_)(?:home_runs?|total_bases?|stolen_bases?|hits_allowed|walks_allowed|pitching_outs|earned_runs?|pitches_thrown)(?:_|$)/.test(market);
}

export function isVerifiedPlayerPropRow(row) {
  if (!row || typeof row !== 'object') return false;
  const player = identity(row.playerName);
  if (!player || ['team', 'game', 'match', 'home', 'away'].includes(player)) return false;

  // Generic market labels are not player identities. FanDuel can surface
  // runners such as "Moneyline Parlay" inside responses that otherwise look
  // like valid prop records.
  if (/\bparlay\b/.test(player)) return false;

  // BetMGM soccer can surface match/team combination outcomes such as
  // "FK Smederevo 1924 and combined scored" in markets whose label contains
  // "Goals". These are match outcomes, not player identities, and must never
  // enter player research where they would produce meaningless history rates.
  if (/\bcombined\s+scored\b/.test(player)) return false;

  // Fail closed on provider/sport market combinations that are known to be
  // parser artifacts rather than football player props.
  if (isImpossibleFanDuelFootballMarket(row)) return false;

  // A player-prop row must never identify one of the event's teams as the
  // player. This catches team totals/moneyline-style markets that happen to
  // contain generic stat words such as "Points" and would otherwise look like
  // valid player markets to a text-only parser. Include conservative team
  // location aliases because some books use ATL/NY/GB-style labels. The
  // boundary comparison also rejects a team label whose middle token was
  // damaged by a stat-name parser while keeping the same location and nickname.
  const eventTeams = [row.homeTeam, row.awayTeam]
    .flatMap(eventTeamAliases)
    .filter(Boolean);
  if (eventTeams.includes(player) || eventTeams.some((team) => hasSameTeamBoundary(player, team))) return false;

  // Some adapters carry the participant's team separately. A real player name
  // should not be identical to that team name or one of its location aliases.
  const participantTeamAliases = eventTeamAliases(row.team);
  if (participantTeamAliases.includes(player)
    || participantTeamAliases.some((team) => hasSameTeamBoundary(player, team))) return false;

  return true;
}
