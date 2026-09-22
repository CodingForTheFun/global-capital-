function norm(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamAliasProfile(value) {
  const raw = norm(value);
  const words = raw.split(/\s+/).filter(Boolean);
  const short = words.length === 1 && raw.length <= 5;
  const strong = new Set();
  const weak = new Set();

  if (!raw) return { raw, short, strong, weak };

  strong.add(raw.replace(/\s+/g, ''));

  if (words.length > 1) {
    strong.add(words.map((word) => word[0]).join(''));

    const city = words.slice(0, -1);
    const nickname = words[words.length - 1] || '';
    const cityCode = city.length === 1 && city[0].length <= 3
      ? city[0]
      : city.map((word) => word[0]).join('');

    if (cityCode && nickname) strong.add(cityCode + nickname[0]);

    if (city.length === 1) {
      strong.add(city[0]);
      if (city[0].length >= 3) strong.add(city[0].slice(0, 3));
    } else if (city.length > 1) {
      const initials = city.map((word) => word[0]).join('');
      if (initials) weak.add(initials);

      const providerStyle = city[0].slice(0, 2) + city.slice(1).map((word) => word[0]).join('');
      if (providerStyle) weak.add(providerStyle);
    }
  }

  return { raw, short, strong, weak };
}

function intersects(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function playerTeamIndex(groups = []) {
  const teamsByName = new Map();

  for (const group of groups) {
    const name = norm(group?.player);
    const team = norm(group?.team);
    if (!name || !team) continue;

    const bucket = teamsByName.get(name) || new Set();
    bucket.add(team);
    teamsByName.set(name, bucket);
  }

  const out = new Map();

  for (const [name, bucket] of teamsByName) {
    const teams = [...bucket];
    const profiles = teams.map(teamAliasProfile);
    const parent = teams.map((_, index) => index);

    const root = (index) => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };

    const join = (left, right) => {
      left = root(left);
      right = root(right);
      if (left !== right) parent[right] = left;
    };

    for (let left = 0; left < teams.length; left += 1) {
      for (let right = left + 1; right < teams.length; right += 1) {
        if (
          !profiles[left].short &&
          !profiles[right].short &&
          intersects(profiles[left].strong, profiles[right].strong)
        ) {
          join(left, right);
        }
      }
    }

    for (let shortIndex = 0; shortIndex < teams.length; shortIndex += 1) {
      if (!profiles[shortIndex].short) continue;

      const matches = new Set();
      for (let fullIndex = 0; fullIndex < teams.length; fullIndex += 1) {
        if (shortIndex === fullIndex || profiles[fullIndex].short) continue;
        if (
          profiles[fullIndex].strong.has(profiles[shortIndex].raw) ||
          profiles[fullIndex].weak.has(profiles[shortIndex].raw)
        ) {
          matches.add(root(fullIndex));
        }
      }

      if (matches.size === 1) join(shortIndex, [...matches][0]);
    }

    const members = new Map();
    for (let index = 0; index < teams.length; index += 1) {
      const rootIndex = root(index);
      const list = members.get(rootIndex) || [];
      list.push(teams[index]);
      members.set(rootIndex, list);
    }

    const clusterKey = new Map();
    for (const [rootIndex, list] of members) {
      clusterKey.set(
        rootIndex,
        [...list].sort((left, right) => left.length - right.length || left.localeCompare(right))[0],
      );
    }

    const keyByTeam = new Map();
    for (let index = 0; index < teams.length; index += 1) {
      keyByTeam.set(teams[index], clusterKey.get(root(index)));
    }

    out.set(name, { size: members.size, keyByTeam });
  }

  return out;
}

function eventIdentity(group) {
  const startsAt = Date.parse(group?.startsAt || '');
  if (Number.isFinite(startsAt)) return `t:${Math.floor(startsAt / 60000)}`;

  const matchup = norm(group?.matchup);
  if (matchup) return `m:${matchup}`;

  const away = norm(group?.awayTeam);
  const home = norm(group?.homeTeam);
  if (away || home) return `teams:${away}:${home}`;

  const eventIds = [...new Set(
    (group?.quotes || [])
      .map((quote) => norm(quote?.eventId))
      .filter(Boolean),
  )].sort();

  return eventIds.length ? `event:${eventIds[0]}` : 'event:unknown';
}

export function terminalPlayerCardKey(group, teamIndex = null) {
  const sport = String(group?.sport || '').trim().toUpperCase();
  const period = norm(group?.period || 'game') || 'game';
  const event = eventIdentity(group);
  const name = norm(group?.player);

  if (name) {
    const team = norm(group?.team);
    const entry = teamIndex instanceof Map ? teamIndex.get(name) : null;
    const contested = Boolean(entry && entry.size > 1);
    const teamKey = entry?.keyByTeam instanceof Map ? (entry.keyByTeam.get(team) || team) : team;

    return [
      sport,
      period,
      event,
      `name:${name}`,
      contested && teamKey ? `team:${teamKey}` : '',
    ].join('|');
  }

  const playerId = norm(group?.providerPlayerId);
  return [
    sport,
    period,
    event,
    `id:${playerId || norm(group?.key) || 'unknown'}`,
  ].join('|');
}

/**
 * The terminal receives one PropGroup per exact market + line. The customer
 * board is player-first, so collapse those exact rows only after filtering and
 * ranking. The first row is intentionally retained as the current preview;
 * every other line/market remains available in the player research workspace.
 */
export function uniqueTerminalPlayerCards(groups = []) {
  const teamIndex = playerTeamIndex(groups);
  const seen = new Set();

  return groups.filter((group) => {
    const key = terminalPlayerCardKey(group, teamIndex);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
