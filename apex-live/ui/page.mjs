import { APEX_STYLES } from './styles.mjs';
import { apexClient } from './client.mjs';

export function apexPage(sports) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f5f2ea">
<title>Apex Market Lab</title>
<style>${APEX_STYLES}</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="logo"><div class="mark">A</div><div class="brand">APEX<small>MARKET LAB</small></div></div>
    <div class="nav">
      <button class="active"><i>⌁</i> Market Board</button>
      <button><i>◉</i> Live Games <span class="soon">NEXT</span></button>
      <button><i>☆</i> Watchlist</button>
      <button><i>⌕</i> Players <span class="soon">NEXT</span></button>
      <button><i>↗</i> Trends <span class="soon">NEXT</span></button>
      <button><i>⚙</i> Settings</button>
    </div>
    <div class="sidefoot">Live market analysis powered by licensed data feeds.<br><br>Information only. No wagers are placed through Apex.</div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="topin">
      <div class="mobile-logo"><div class="mark">A</div><b>APEX</b></div>
      <span class="live-dot"></span><div><div class="title">Market Board</div><div class="provider">SportsDataIO live feed</div></div>
      <div class="grow"></div><div id="fresh" class="fresh">Connecting…</div><button id="refresh" class="refresh">Refresh</button>
    </div></header>
    <div class="content">
      <section class="hero">
        <div class="hero-main"><div class="eyebrow">Your sports market command center</div><h1>Find the line. Compare the market. Save what matters.</h1><p>Scan current player props across sportsbooks, compare each posted line with the returned market median, and build your own watchlist without copying another product's workflow.</p><div class="hero-badges"><span>Live prop feeds</span><span>Market median</span><span>Saved watchlist</span></div></div>
        <div class="pulse"><div class="section-kicker"><h3>Market pulse</h3><small id="pulseSport">NFL</small></div><div id="pulseList" class="pulse-list"></div></div>
      </section>
      <section class="stats">
        <div class="stat"><small>Available props</small><strong id="count">—</strong></div>
        <div class="stat"><small>Games scanned</small><strong id="games">—</strong></div>
        <div class="stat"><small>Sportsbooks</small><strong id="books">—</strong></div>
        <div class="stat"><small>Saved</small><strong id="savedCount">0</strong></div>
      </section>
      <div class="workspace">
        <section class="board">
          <div class="toolbar"><div id="sports" class="sports"></div><div class="filters">
            <input id="search" class="control search" placeholder="Search player, team, market or book">
            <select id="market" class="control"><option value="all">All markets</option></select>
            <select id="book" class="control"><option value="all">All sportsbooks</option></select>
            <select id="side" class="control"><option value="all">Over + Under</option><option value="OVER">Over only</option><option value="UNDER">Under only</option></select>
            <select id="sort" class="control"><option value="edge">Largest market gap</option><option value="player">Player A–Z</option><option value="line">Line high → low</option><option value="book">Sportsbook A–Z</option></select>
          </div></div>
          <div class="board-head"><div><h2>Current player props</h2><p id="subtitle">Loading live markets…</p></div><div id="countpill" class="countpill">0 shown</div></div>
          <div id="notice" class="notice"></div><div id="cards" class="cards"><div class="empty">Loading live SportsDataIO props…</div></div>
        </section>
        <aside class="saved"><h3>Saved props</h3><p>Your shortlist is stored on this device. Tap the star on any market card.</p><div id="savedList" class="saved-list"></div><div class="disclaimer">Market gap compares a posted line with the median current line for the same player, market and side in the returned feed. It is not a prediction or guarantee.</div></aside>
      </div>
    </div>
  </main>
</div>
<nav class="mobile-nav"><button><b>⌁</b>Board</button><button><b>◉</b>Live</button><button><b>☆</b>Saved</button><button><b>⌕</b>Players</button></nav>
<script>${apexClient(sports)}</script>
</body></html>`;
}
