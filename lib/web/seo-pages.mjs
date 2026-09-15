import { headTags, siteOrigin } from './public-surface.mjs';

export const SEO_PATHS = Object.freeze([
  '/player-prop-research',
  '/nfl-player-props',
  '/nba-player-props',
  '/sportsbook-line-comparison',
]);

const PAGES = Object.freeze({
  '/player-prop-research': {
    title: 'Player Prop Research Tool | Oblige Props',
    description: 'Research player props with live line comparison, verified historical results, hit-rate windows and evidence-backed context in Oblige Props.',
    eyebrow: 'PLAYER PROP RESEARCH',
    h1: 'Research the prop, not just the player.',
    lead: 'Oblige Props puts the exact market line beside the player’s verified historical results and the currently available book or pick’em offers. The goal is a faster, more inspectable research workflow—not a promise that a trend will repeat.',
    cards: [
      ['Exact line first', 'Start with the player, market, side and posted number. A hit rate only means something when it is measured against the line you are actually evaluating.'],
      ['Verified history', 'Review recent windows such as L5, L10, L15, L20, season and head-to-head only when completed historical results support them. Missing data stays unavailable instead of being guessed.'],
      ['Compare the market', 'See available lines across connected sources so you can tell whether the number you are researching is better, worse or simply different from the rest of the market.'],
    ],
    sections: [
      ['What a useful prop research workflow checks', 'A good workflow separates recent form from opportunity, matchup and price. Oblige Props is designed to keep those pieces together: the active line, the side, recent verified results, season context, head-to-head context when available, and the connected source offering the market.'],
      ['Hit rates are evidence, not predictions', 'A 4-for-5 recent window describes what happened in that sample. It does not guarantee the next result. Oblige Props keeps sample sizes and unavailable states visible so a short streak is not presented as certainty.'],
      ['Why line shopping matters', 'Two books can post the same player market at different numbers or prices. Comparing those offers can change the question you are researching. The research workspace keeps the line itself central rather than treating every version of a prop as interchangeable.'],
    ],
  },
  '/nfl-player-props': {
    title: 'NFL Player Prop Research | Oblige Props',
    description: 'Research NFL player props across passing, rushing, receiving and other supported markets with verified history and line comparison.',
    eyebrow: 'NFL PLAYER PROPS',
    h1: 'NFL prop research built around role, line and evidence.',
    lead: 'NFL props can move quickly as practice reports, inactive lists, depth-chart roles and market prices change. Oblige Props keeps the posted player line beside the historical context used to evaluate it.',
    cards: [
      ['Offensive markets', 'Research supported passing yards, completions, attempts, touchdowns, rushing yards, rushing attempts, receiving yards and receptions when those markets are present in connected feeds.'],
      ['Role-aware context', 'A player’s opportunity can matter as much as the recent box score. Research should account for workload and availability instead of assuming the last few games will repeat.'],
      ['Market comparison', 'Compare available books and pick’em platforms on the same player market rather than researching one isolated number.'],
    ],
    sections: [
      ['Start with the current NFL slate', 'A useful NFL prop page must confirm that the game, player and market are current. Oblige Props is designed to show present provider-backed lines and to label unavailable research instead of recycling an old result as if it were live.'],
      ['Separate player props from team statistics', 'Passing, rushing and receiving markets belong to individual offensive players. Team sacks, defensive totals and other unit statistics should not be silently assigned to a quarterback or skill-position player. The research pipeline keeps player identity and market type separate.'],
      ['Read recent windows with the season baseline', 'L5 or L10 can highlight a role change, but a larger season sample can show whether that streak is typical. Oblige Props presents multiple windows so one short sample does not have to carry the whole decision.'],
    ],
  },
  '/nba-player-props': {
    title: 'NBA Player Prop Research | Oblige Props',
    description: 'Research NBA player props including supported points, rebounds, assists and combo markets with verified game history and book comparison.',
    eyebrow: 'NBA PLAYER PROPS',
    h1: 'NBA prop research with the line and the sample attached.',
    lead: 'NBA player roles can change with minutes, injuries, starting lineups and usage. Oblige Props combines the active prop line with verified historical windows so recent form is visible without being mistaken for a guarantee.',
    cards: [
      ['Core NBA markets', 'Research supported points, rebounds, assists, three-pointers, steals, blocks, turnovers and combination markets such as PRA when they are available.'],
      ['Multiple windows', 'Compare L5, L10, L15, L20, season and head-to-head context where verified historical results exist.'],
      ['Line-sensitive results', 'Changing the target line or Over/Under side changes the question. Hit-rate calculations should update against that exact threshold instead of staying frozen.'],
    ],
    sections: [
      ['Minutes and role come before a trend', 'A strong recent scoring run can mean something different if a player’s minutes or lineup role changes. Oblige Props is built to keep the market research connected to the player and matchup rather than presenting an isolated percentage.'],
      ['Head-to-head is a separate sample', 'H2H research should use completed games against the actual opponent and should show the number of games in that sample. When that verified history is unavailable, the correct display is unavailable—not zero and not an invented percentage.'],
      ['Compare books before evaluating the edge', 'A player can be 24.5 at one source and 25.5 at another. That one-point difference can materially change the historical hit rate. Oblige Props keeps book comparison beside the research so the posted number stays part of the analysis.'],
    ],
  },
  '/sportsbook-line-comparison': {
    title: 'Sportsbook Player Prop Line Comparison | Oblige Props',
    description: 'Compare player prop lines and available odds across connected sportsbooks and pick’em platforms before opening the deeper research view.',
    eyebrow: 'LINE COMPARISON',
    h1: 'Compare the number before you compare the trend.',
    lead: 'Player-prop research changes when the line changes. Oblige Props groups available offers for the same player and market so you can see the current numbers before deciding which version deserves deeper research.',
    cards: [
      ['Same market, different number', 'Books and pick’em platforms can post different thresholds for the same player statistic. The research view keeps those offers grouped instead of treating them as unrelated props.'],
      ['Over and Under context', 'The preferable threshold depends on the side being researched. A lower line can help an Over while a higher line can help an Under, so the comparison must preserve direction.'],
      ['Freshness matters', 'A stale number can make a comparison misleading. Oblige Props tracks provider-backed updates and keeps unavailable or delayed data clearly separated from current lines.'],
    ],
    sections: [
      ['Why one line is not the whole market', 'A prop card from one sportsbook shows one snapshot. A comparison view answers a different question: what numbers are currently available across connected sources for this player and market? That context can prevent research from being anchored to a worse line by accident.'],
      ['Odds and thresholds are different dimensions', 'When traditional sportsbook odds are available, price matters alongside the threshold. Pick’em platforms may present a line without American odds. Oblige Props keeps those data types distinct rather than fabricating an equivalent price.'],
      ['Research after the comparison', 'Once the exact line and side are selected, verified historical windows and deeper player context can be evaluated against that number. The line comparison is the starting point, not a prediction by itself.'],
    ],
  },
});

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function relatedLinks(current) {
  return SEO_PATHS.filter(path => path !== current).map(path => {
    const page = PAGES[path];
    return `<a href="${path}"><strong>${esc(page.eyebrow)}</strong><span>${esc(page.description)}</span></a>`;
  }).join('');
}

export function seoPage(pathname, { origin = siteOrigin() } = {}) {
  const page = PAGES[pathname];
  if (!page) return null;
  const faq = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Does Oblige Props place bets or accept wagers?',
        acceptedAnswer: { '@type': 'Answer', text: 'No. Oblige Props is a player-prop research product and does not accept wagers or hold betting funds.' },
      },
      {
        '@type': 'Question',
        name: 'Are hit rates predictions?',
        acceptedAnswer: { '@type': 'Answer', text: 'No. Hit rates describe verified historical samples against a selected line. Past results do not guarantee a future outcome.' },
      },
      {
        '@type': 'Question',
        name: 'What does unavailable or N/A mean?',
        acceptedAnswer: { '@type': 'Answer', text: 'It means the product does not have a verified sample for that field. Oblige Props does not convert missing research into a zero or invented statistic.' },
      },
    ],
  }).replace(/</g, '\\u003c');

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
${headTags(origin, { path: pathname, title: page.title, description: page.description })}
<script type="application/ld+json">${faq}</script>
<style>
*{box-sizing:border-box}:root{--bg:#070d18;--panel:#0d1726;--line:#26364d;--text:#f5f8fc;--muted:#a6b3c6;--green:#48e6a2;--blue:#63a8ff}html,body{margin:0;background:radial-gradient(circle at 20% -10%,#152b4d 0,transparent 35%),var(--bg);color:var(--text);font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.wrap{max-width:1040px;margin:auto;padding:24px 20px 70px}.top{display:flex;align-items:center;gap:11px;padding-bottom:22px;border-bottom:1px solid var(--line)}.logo{width:38px;height:38px;border-radius:11px;background:#03070b url('/brand/icon-512.png') center/cover no-repeat;border:1px solid #2d5a54}.brand{font-weight:900;letter-spacing:-.02em}.top nav{margin-left:auto;display:flex;gap:14px}.top nav a{text-decoration:none;color:var(--muted);font-size:13px}.hero{padding:72px 0 42px}.eyebrow{font-size:11px;font-weight:900;letter-spacing:.16em;color:var(--green)}h1{max-width:800px;margin:12px 0 18px;font-size:clamp(38px,7vw,66px);line-height:1.02;letter-spacing:-.05em}.lead{max-width:780px;margin:0;color:var(--muted);font-size:18px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0 44px}.card,.section,.faq,.related a{border:1px solid var(--line);background:rgba(13,23,38,.88);border-radius:16px}.card{padding:20px}.card strong{display:block;margin-bottom:7px;font-size:16px}.card p,.section p,.faq p{margin:0;color:var(--muted)}.section{padding:24px;margin:12px 0}.section h2{margin:0 0 8px;font-size:24px;letter-spacing:-.03em}.cta{display:flex;align-items:center;justify-content:space-between;gap:18px;margin:42px 0;padding:22px;border:1px solid #285c4c;border-radius:18px;background:#0d261f}.cta strong{font-size:20px}.cta span{display:block;color:#a6c8bc;font-size:13px}.cta a{flex:0 0 auto;text-decoration:none;background:var(--green);color:#05120d;font-weight:900;padding:12px 16px;border-radius:11px}.faq{padding:24px;margin-top:36px}.faq h2{margin-top:0}.faq h3{margin:20px 0 6px;font-size:16px}.related{margin-top:38px}.related h2{font-size:20px}.related-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.related a{display:block;padding:16px;text-decoration:none}.related a strong,.related a span{display:block}.related a strong{font-size:11px;color:#8fe8c3;letter-spacing:.08em}.related a span{margin-top:5px;color:var(--muted);font-size:12px}.foot{margin-top:44px;padding-top:22px;border-top:1px solid var(--line);color:#7f90a8;font-size:12px}.foot a{color:#a9bdd7;text-decoration:none}@media(max-width:760px){.wrap{padding:18px 14px 56px}.top nav a:not(:first-child){display:none}.hero{padding:48px 0 28px}.lead{font-size:16px}.cards,.related-grid{grid-template-columns:1fr}.section{padding:20px}.cta{align-items:flex-start;flex-direction:column}.cta a{width:100%;text-align:center}}
</style></head><body><div class="wrap">
<header class="top"><a href="/" class="logo" aria-label="Oblige Props home"></a><a href="/" class="brand">OBLIGE PROPS</a><nav><a href="/">Create free account</a><a href="/pricing">Pricing</a><a href="/player-prop-research">Research</a></nav></header>
<main>
<section class="hero"><span class="eyebrow">${esc(page.eyebrow)}</span><h1>${esc(page.h1)}</h1><p class="lead">${esc(page.lead)}</p></section>
<section class="cards">${page.cards.map(([title, copy]) => `<article class="card"><strong>${esc(title)}</strong><p>${esc(copy)}</p></article>`).join('')}</section>
${page.sections.map(([title, copy]) => `<section class="section"><h2>${esc(title)}</h2><p>${esc(copy)}</p></section>`).join('')}
<section class="cta"><div><strong>Open the live research workspace</strong><span>Create a free beta account to view the current prop board and deeper player research.</span></div><a href="/">Open Oblige Props</a></section>
<section class="faq"><h2>Player prop research FAQ</h2><h3>Does Oblige Props place bets?</h3><p>No. Oblige Props is a research product. It does not accept wagers or hold betting funds.</p><h3>Are hit rates predictions?</h3><p>No. Hit rates describe verified historical samples against a selected line. Past results do not guarantee future outcomes.</p><h3>What does N/A mean?</h3><p>N/A means a verified sample is not available for that field. Missing research is not converted into a zero or an invented statistic.</p></section>
<section class="related"><h2>More Oblige Props research</h2><div class="related-grid">${relatedLinks(pathname)}</div></section>
</main>
<footer class="foot">Oblige Props provides research and data context only. 18+. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/responsible-gaming">Responsible gaming</a></footer>
</div></body></html>`;
}
