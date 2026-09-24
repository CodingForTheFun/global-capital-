import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_SPORTS } from '../lib/autoscout/models.mjs';
import { SPORTSGAMEODDS_BOARD_SPORTS } from '../lib/autoscout/board-coverage-catalog.mjs';
import {
  SPORTSGAMEODDS_LEAGUES,
  SPORTSGAMEODDS_SPORT_IDS,
  SPORTSGAMEODDS_SPORTS,
  __resetSportsGameOddsProvider,
  fetchSportsGameOddsBoard,
} from '../lib/autoscout/providers/sportsgameodds.mjs';
import { __resetSportsGameOddsClient } from '../lib/data-sources/sportsgameodds/client.mjs';
import { normalizeSportsGameOddsEvents } from '../lib/data-sources/sportsgameodds/normalize.mjs';

const DOCUMENTED_SPORT_IDS = [
  'AUSSIE_RULES_FOOTBALL','BADMINTON','BANDY','BASEBALL','BASKETBALL',
  'BEACH_VOLLEYBALL','BOXING','CRICKET','DARTS','ESPORTS','FLOORBALL',
  'FOOTBALL','FUTSAL','GOLF','HANDBALL','HOCKEY','HORSE_RACING','LACROSSE',
  'MMA','MOTORSPORTS','RUGBY','SNOOKER','SOCCER','TABLE_TENNIS','TENNIS',
  'VOLLEYBALL','WATER_POLO',
];

test('every SportsGameOdds sport category is reachable on the board', () => {
  assert.equal(SPORTSGAMEODDS_BOARD_SPORTS.length, 27);
  assert.equal(new Set(SPORTSGAMEODDS_BOARD_SPORTS).size, 27);
  assert.equal(Object.keys(SPORTSGAMEODDS_SPORT_IDS).length, 27);
  assert.deepEqual(
    [...new Set(Object.values(SPORTSGAMEODDS_SPORT_IDS))].sort(),
    [...DOCUMENTED_SPORT_IDS].sort(),
  );
  for (const sport of SPORTSGAMEODDS_BOARD_SPORTS) {
    assert.ok(BOARD_SPORTS.includes(sport), sport + ' must be a supported board sport');
    assert.ok(SPORTSGAMEODDS_SPORTS.includes(sport), sport + ' must be a supported SGO sport');
  }
  assert.ok(!SPORTSGAMEODDS_SPORTS.includes('NON_SPORTS'));
  assert.ok(SPORTSGAMEODDS_LEAGUES.NFL.includes('NFL'));
  assert.ok(SPORTSGAMEODDS_LEAGUES.NBA.includes('NBA'));
});

test('aggregate SportsGameOdds sport requests stay in their requested board bucket', () => {
  const event = {
    eventID: 'event-1',
    sportID: 'CRICKET',
    leagueID: 'TEST_CRICKET_LEAGUE',
    status: { startsAt: '2026-09-22T01:00:00Z' },
    teams: {
      home: { teamID: 'HOME', name: 'Home' },
      away: { teamID: 'AWAY', name: 'Away' },
    },
    players: {
      PLAYER_1: { playerID: 'PLAYER_1', name: 'Test Player', teamID: 'HOME' },
    },
    odds: {
      one: {
        oddID: 'one',
        statID: 'runs',
        statEntityID: 'PLAYER_1',
        betTypeID: 'ou',
        sideID: 'over',
        byBookmaker: {
          draftkings: { available: true, overUnder: 10.5, odds: -110 },
        },
      },
    },
  };
  const board = normalizeSportsGameOddsEvents([event], { requestedSport: 'CRICKET' });
  assert.equal(board.props.length, 1);
  assert.equal(board.props[0].sport, 'CRICKET');
  assert.equal(board.data.events[0].sport, 'CRICKET');
  assert.equal(board.data.events[0].league, 'TEST_CRICKET_LEAGUE');
});

test('generic sport boards query SportsGameOdds by sportID, not a guessed leagueID', async () => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousMode = process.env.OBLIGE_PROP_PROVIDER_MODE;
  const previousFetch = globalThis.fetch;
  const urls = [];
  try {
    process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
    process.env.OBLIGE_PROP_PROVIDER_MODE = 'sportsgameodds';
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();

    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith('/account/usage')) {
        return new Response(JSON.stringify({
          success: true,
          data: { tier: 'test', rateLimits: { 'per-month': { 'max-entities': 100000, 'current-entities': 0 } } },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname.endsWith('/sports')) {
        return new Response(JSON.stringify({
          success: true,
          data: [{ sportID: 'CRICKET', name: 'Cricket' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname.endsWith('/leagues')) {
        return new Response(JSON.stringify({
          success: true,
          data: [{ leagueID: 'TEST_CRICKET_LEAGUE', sportID: 'CRICKET', name: 'Test Cricket' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname.endsWith('/events')) {
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error('Unexpected URL ' + url.href);
    };

    const board = await fetchSportsGameOddsBoard('CRICKET', { force: true, eventLimit: 1 });
    assert.equal(board.meta.supported, true);
    const eventUrl = urls.find((url) => url.pathname.endsWith('/events'));
    assert.ok(eventUrl, 'events endpoint must be called');
    assert.equal(eventUrl.searchParams.get('sportID'), 'CRICKET');
    assert.equal(eventUrl.searchParams.has('leagueID'), false);
  } finally {
    globalThis.fetch = previousFetch;
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    if (previousKey === undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER;
    else process.env.SPORTS_ODDS_API_KEY_HEADER = previousKey;
    if (previousMode === undefined) delete process.env.OBLIGE_PROP_PROVIDER_MODE;
    else process.env.OBLIGE_PROP_PROVIDER_MODE = previousMode;
  }
});




test('tennis fetches ATP WTA and ITF as separate SportsGameOdds event requests', async () => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousFetch = globalThis.fetch;
  const eventLeagueIDs = [];
  try {
    process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/account/usage')) {
        return new Response(JSON.stringify({ success:true, data:{ tier:'test', rateLimits:{ 'per-month':{ 'max-entities':100000, 'current-entities':0 } } } }), { status:200 });
      }
      if (url.pathname.endsWith('/sports')) {
        return new Response(JSON.stringify({ success:true, data:[{ sportID:'TENNIS', name:'Tennis' }] }), { status:200 });
      }
      if (url.pathname.endsWith('/leagues')) {
        return new Response(JSON.stringify({ success:true, data:[
          { leagueID:'ATP', sportID:'TENNIS' },
          { leagueID:'WTA', sportID:'TENNIS' },
          { leagueID:'ITF', sportID:'TENNIS' },
        ] }), { status:200 });
      }
      if (url.pathname.endsWith('/events')) {
        assert.equal(url.searchParams.has('sportID'), false);
        const leagueID = url.searchParams.get('leagueID');
        eventLeagueIDs.push(leagueID);
        assert.ok(['ATP','WTA','ITF'].includes(leagueID));
        return new Response(JSON.stringify({ success:true, data:[] }), { status:200 });
      }
      if (url.pathname.endsWith('/players') || url.pathname.endsWith('/teams') || url.pathname.endsWith('/markets')) {
        return new Response(JSON.stringify({ success:true, data:[] }), { status:200 });
      }
      throw new Error('Unexpected URL '+url.href);
    };
    const result = await fetchSportsGameOddsBoard('TENNIS', { force:true, eventLimit:8 });
    assert.equal(result.meta.supported, true);
    assert.deepEqual(eventLeagueIDs.sort(), ['ATP','ITF','WTA']);
    assert.deepEqual(result.meta.leaguesRequested.sort(), ['ATP','ITF','WTA']);
  } finally {
    globalThis.fetch = previousFetch;
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    if (previousKey === undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER;
    else process.env.SPORTS_ODDS_API_KEY_HEADER = previousKey;
  }
});


test('tennis event requests use the provider-documented minimal query parameters', async () => {
  const previousKey = process.env.SPORTS_ODDS_API_KEY_HEADER;
  const previousFetch = globalThis.fetch;
  const eventUrls = [];
  try {
    process.env.SPORTS_ODDS_API_KEY_HEADER = 'test-key';
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/account/usage')) return new Response(JSON.stringify({success:true,data:{tier:'test',rateLimits:{'per-month':{'max-entities':100000,'current-entities':0}}}}),{status:200,headers:{'content-type':'application/json'}});
      if (url.pathname.endsWith('/sports')) return new Response(JSON.stringify({success:true,data:[{sportID:'TENNIS'}]}),{status:200,headers:{'content-type':'application/json'}});
      if (url.pathname.endsWith('/leagues')) return new Response(JSON.stringify({success:true,data:[{leagueID:'ATP',sportID:'TENNIS'},{leagueID:'WTA',sportID:'TENNIS'}]}),{status:200,headers:{'content-type':'application/json'}});
      if (url.pathname.endsWith('/events')) {
        eventUrls.push(url);
        return new Response(JSON.stringify({success:true,data:[]}),{status:200,headers:{'content-type':'application/json'}});
      }
      throw new Error('Unexpected URL '+url.href);
    };
    await fetchSportsGameOddsBoard('TENNIS',{force:true,eventLimit:8});
    assert.equal(eventUrls.length,2);
    for (const url of eventUrls) {
      assert.equal(['ATP','WTA'].includes(url.searchParams.get('leagueID')),true);
      assert.equal(url.searchParams.get('oddsAvailable'),'true');
      assert.equal(url.searchParams.get('limit'),'8');
      assert.equal(url.searchParams.has('sportID'),false);
      assert.equal(url.searchParams.has('ended'),false);
      assert.equal(url.searchParams.has('cancelled'),false);
      assert.equal(url.searchParams.has('startsAfter'),false);
      assert.equal(url.searchParams.has('startsBefore'),false);
      assert.equal(url.searchParams.has('includeOpenCloseOdds'),false);
    }
  } finally {
    globalThis.fetch=previousFetch;
    __resetSportsGameOddsClient();
    __resetSportsGameOddsProvider();
    if(previousKey===undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER; else process.env.SPORTS_ODDS_API_KEY_HEADER=previousKey;
  }
});


test('tennis event requests use exact account catalog league IDs rather than guessed tour labels', async () => {
  const previousKey=process.env.SPORTS_ODDS_API_KEY_HEADER; const previousFetch=globalThis.fetch;
  const eventLeagueIDs=[];
  try {
    process.env.SPORTS_ODDS_API_KEY_HEADER='test-key'; __resetSportsGameOddsClient(); __resetSportsGameOddsProvider();
    globalThis.fetch=async(input)=>{
      const url=new URL(String(input));
      if(url.pathname.endsWith('/account/usage')) return new Response(JSON.stringify({success:true,data:{tier:'test',rateLimits:{'per-month':{'max-entities':100000,'current-entities':0}}}}),{status:200});
      if(url.pathname.endsWith('/sports')) return new Response(JSON.stringify({success:true,data:[{sportID:'TENNIS'}]}),{status:200});
      if(url.pathname.endsWith('/leagues')) return new Response(JSON.stringify({success:true,data:[{leagueID:'ATP_TOUR_2026',sportID:'TENNIS',name:'ATP'},{leagueID:'WTA_TOUR_2026',sportID:'TENNIS',name:'WTA'}]}),{status:200});
      if(url.pathname.endsWith('/events')) { eventLeagueIDs.push(url.searchParams.get('leagueID')); return new Response(JSON.stringify({success:true,data:[]}),{status:200}); }
      throw new Error('Unexpected URL '+url.href);
    };
    const result=await fetchSportsGameOddsBoard('TENNIS',{force:true,eventLimit:8});
    assert.equal(result.meta.supported,true);
    assert.deepEqual(eventLeagueIDs.sort(),['ATP_TOUR_2026','WTA_TOUR_2026']);
    assert.deepEqual(result.meta.leaguesRequested.sort(),['ATP_TOUR_2026','WTA_TOUR_2026']);
  } finally {
    globalThis.fetch=previousFetch; __resetSportsGameOddsClient(); __resetSportsGameOddsProvider();
    if(previousKey===undefined) delete process.env.SPORTS_ODDS_API_KEY_HEADER; else process.env.SPORTS_ODDS_API_KEY_HEADER=previousKey;
  }
});
