import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamLogo, verifiedLogoUrl, teamBadge } from '../lib/autoscout/providers/team-logo.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const directory = { sports: [{ leagues: [{ teams: [
  { team: { id: '2', abbreviation: 'BOS', displayName: 'Boston Celtics', shortDisplayName: 'Celtics', name: 'Celtics', location: 'Boston', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png' }] } },
  { team: { id: '18', abbreviation: 'NY', displayName: 'New York Knicks', shortDisplayName: 'Knicks', name: 'Knicks', location: 'New York', logos: [{ href: 'https://evil.example/logo.png' }] } },
] }] }] };

function fetcher(calls) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes('/teams?')) return new Response(JSON.stringify(directory), { status: 200 });
    if (String(url).endsWith('bos.png')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('no', { status: 404 });
  };
}

test('a team label resolves to its ESPN crest and is cached', async () => {
  const calls = [];
  const get = createTeamLogo({ fetchImpl: fetcher(calls) });
  for (const label of ['BOS', 'Boston Celtics']) {
    const r = await get('NBA', label);
    assert.equal(r.verified, true);
    assert.equal(r.contentType, 'image/png');
    assert.equal(r.name, 'Boston Celtics');
  }
  await get('NBA', 'BOS');
  assert.equal(calls.filter((u) => u.endsWith('bos.png')).length, 2, 'one fetch per distinct label, then cached');
  assert.equal(calls.filter((u) => u.includes('/teams?')).length, 1, 'the directory is read once');
});

test('only ESPN teamlogo URLs are fetched; anything else gets a neutral badge', async () => {
  const calls = [];
  const get = createTeamLogo({ fetchImpl: fetcher(calls) });
  const r = await get('NBA', 'New York Knicks');
  assert.equal(r.verified, false);
  assert.equal(r.contentType, 'image/svg+xml');
  assert.ok(!calls.some((u) => u.includes('evil.example')));
  assert.equal(verifiedLogoUrl('https://a.espncdn.com/i/teamlogos/nba/500/bos.png'), 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png');
  assert.equal(verifiedLogoUrl('http://a.espncdn.com/i/teamlogos/nba/500/bos.png'), null);
  assert.equal(verifiedLogoUrl('https://a.espncdn.com/i/headshots/nba/players/full/1.png'), null);
});

test('unknown teams, league-agnostic soccer and failures fall back without guessing', async () => {
  const get = createTeamLogo({ fetchImpl: fetcher([]) });
  assert.equal((await get('NBA', 'Nowhere Nobodies')).verified, false);
  assert.equal((await get('SOCCER', 'Arsenal')).verified, false);
  const broken = createTeamLogo({ fetchImpl: async () => { throw new Error('down'); } });
  assert.equal((await broken('NBA', 'BOS')).verified, false);
  assert.match(teamBadge('Boston Celtics').toString(), />BC</);
  assert.match(teamBadge('<script>').toString(), /&lt;SC/);
});
