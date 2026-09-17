# Oblige Props — Arena AI Visual Handoff 2/4

Current board implementations, reference-acceptance layers, responsive density, and navigation chrome.


## FILE: apps/oblige-web/app/human-polish.css

```css
/*
 * Human polish pass for ObligeProps.
 * Original project CSS informed by the product patterns popularized by
 * shadcn/ui + Radix (quiet primitives), COSS/Linear-style SaaS density,
 * and modern sports-data dashboards. No external component code is copied.
 */

:root {
  --human-hairline: color-mix(in srgb, var(--text) 10%, transparent);
  --human-hairline-strong: color-mix(in srgb, var(--text) 17%, transparent);
  --human-surface: color-mix(in srgb, var(--surface) 94%, transparent);
  --human-surface-raised: color-mix(in srgb, var(--surface-2) 92%, transparent);
  --human-shadow: 0 18px 52px rgba(0, 0, 0, .22), inset 0 1px rgba(255, 255, 255, .025);
}

body {
  background:
    radial-gradient(900px 420px at 50% -170px, color-mix(in srgb, var(--accent) 9%, transparent), transparent 72%),
    var(--bg);
}

::selection {
  background: color-mix(in srgb, var(--accent) 32%, transparent);
  color: var(--text);
}

/* ------------------------------ restrained app chrome */

header {
  box-shadow: none !important;
}

header > div {
  min-height: 56px;
}

header nav[aria-label="Primary"] {
  display: flex;
  align-items: center;
  gap: 3px !important;
  padding: 3px;
  border: 1px solid var(--human-hairline) !important;
  border-radius: 11px;
  background: color-mix(in srgb, var(--surface) 64%, transparent) !important;
  box-shadow: none !important;
}

header nav[aria-label="Primary"] a {
  padding: 7px 10px !important;
  border-radius: 8px;
  font-size: 12px !important;
}

header nav[aria-label="Primary"] a > span {
  display: none;
}

header nav[aria-label="Primary"] a[aria-current="page"] {
  background: var(--surface-2) !important;
  box-shadow: inset 0 0 0 1px var(--human-hairline) !important;
}

/* ------------------------------ board: more data, less chrome */

main .sticky.top-16 {
  border-color: var(--human-hairline) !important;
  border-radius: 16px !important;
  padding: 10px !important;
  background: color-mix(in srgb, var(--bg-deep) 90%, transparent) !important;
  box-shadow: 0 12px 36px rgba(0, 0, 0, .20) !important;
  backdrop-filter: blur(22px) saturate(1.08) !important;
}

main .sticky.top-16 .rail button,
main .sticky.top-16 > div:nth-child(2) > button {
  min-height: 36px !important;
  padding-inline: 12px !important;
  border-color: var(--human-hairline) !important;
  background: rgba(255, 255, 255, .018) !important;
  box-shadow: none !important;
}

main .sticky.top-16 .rail button[aria-pressed="true"],
main .sticky.top-16 > div:nth-child(2) > button[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--accent) 44%, transparent) !important;
  background: color-mix(in srgb, var(--accent) 13%, var(--surface)) !important;
  color: var(--text) !important;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 9%, transparent) !important;
}

main .sticky.top-16 input[type="search"] {
  min-height: 40px !important;
  border-color: var(--human-hairline) !important;
  border-radius: 11px !important;
  background: rgba(255, 255, 255, .018) !important;
  box-shadow: none !important;
}

main .sticky.top-16 input[type="search"]:focus {
  border-color: color-mix(in srgb, var(--accent) 52%, transparent) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent) !important;
}

.board-filter-panel {
  border: 1px solid var(--human-hairline) !important;
  border-radius: 14px !important;
  background: var(--human-surface-raised) !important;
  box-shadow: var(--human-shadow) !important;
}

/* ------------------------------ player prop cards */

main .face.prop-card-v2 {
  border-color: var(--human-hairline) !important;
  border-radius: 18px !important;
  background:
    radial-gradient(360px 150px at 96% -28%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%),
    linear-gradient(165deg, color-mix(in srgb, var(--surface) 98%, black 2%), var(--bg-deep)) !important;
  box-shadow: 0 10px 32px rgba(0, 0, 0, .18), inset 0 1px rgba(255, 255, 255, .018) !important;
  transition: transform 180ms var(--ease-out), border-color 180ms var(--ease-out), box-shadow 180ms var(--ease-out) !important;
}

@media (hover: hover) {
  main .face.prop-card-v2:hover {
    transform: translateY(-2px) !important;
    border-color: var(--human-hairline-strong) !important;
    box-shadow: 0 15px 44px rgba(0, 0, 0, .25), inset 0 1px rgba(255, 255, 255, .025) !important;
  }
}

.prop-card-v2__open {
  gap: 0 !important;
  padding: 14px 14px 10px !important;
}

.prop-card-v2__identity {
  min-height: 58px;
}

.prop-card-v2__identity .ringavatar {
  filter: none;
  box-shadow: 0 0 0 1px var(--human-hairline-strong), 0 9px 22px rgba(0, 0, 0, .24) !important;
}

.prop-card-v2__identity .ringavatar > span {
  border-radius: 16px !important;
}

.prop-card-v2__identity .ringavatar img {
  transform: scale(1.04);
}

.prop-card-v2__meta {
  color: var(--text-3) !important;
  font-size: 11px;
  line-height: 1.4;
}

.prop-card-v2__market-row {
  margin-top: 11px;
  padding-top: 11px !important;
  border-color: var(--human-hairline) !important;
}

.prop-card-v2__market-label > span:first-child {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-2);
}

.prop-card-v2__market-label > span:last-child {
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-3);
}

.prop-card-v2__line {
  font-size: 27px !important;
  letter-spacing: -.045em !important;
}

.prop-card-v2__hit {
  padding: 0 14px 13px !important;
}

/* Convert the generic meter into a ten-beat sports-data strip. The fill still
   represents the exact rate supplied by the backend; dividers are visual only. */
.prop-card-v2__hit > div > div:last-child {
  position: relative;
  height: 10px !important;
  border-radius: 4px !important;
  border-color: var(--human-hairline) !important;
  background: color-mix(in srgb, var(--surface-3) 76%, transparent) !important;
}

.prop-card-v2__hit > div > div:last-child::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  border-radius: inherit;
  background: repeating-linear-gradient(
    90deg,
    transparent 0 calc(10% - 2px),
    color-mix(in srgb, var(--bg-deep) 86%, transparent) calc(10% - 2px) 10%
  );
}

.prop-card-v2__hit > div > div:last-child > div {
  border-radius: 3px !important;
  box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 13%, transparent);
}

.prop-card-v2__quotes {
  gap: 7px !important;
  padding: 0 14px 14px !important;
}

.prop-card-v2__quote {
  min-height: 48px !important;
  border-radius: 11px !important;
  border-color: var(--human-hairline) !important;
  background: rgba(255, 255, 255, .018) !important;
  box-shadow: none !important;
}

.prop-card-v2__quote:hover {
  border-color: var(--human-hairline-strong) !important;
  background: rgba(255, 255, 255, .032) !important;
}

.prop-card-v2__quote[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--accent) 44%, transparent) !important;
  background: color-mix(in srgb, var(--accent) 10%, transparent) !important;
}

.prop-card-v2__book {
  color: var(--text-3) !important;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: .08em;
}

/* ------------------------------ player analysis */

.player-cinematic-hero {
  border-color: var(--human-hairline) !important;
  border-radius: 22px !important;
  box-shadow: 0 16px 48px rgba(0, 0, 0, .23), inset 0 1px rgba(255, 255, 255, .022) !important;
}

.player-cinematic-hero .ringavatar > span {
  border-radius: 22px !important;
}

.player-line-glance {
  border-color: var(--human-hairline) !important;
  border-radius: 14px !important;
  background: rgba(255, 255, 255, .022) !important;
}

.player-section-nav {
  border: 1px solid var(--human-hairline) !important;
  border-radius: 12px !important;
  background: color-mix(in srgb, var(--surface) 72%, transparent) !important;
  box-shadow: none !important;
}

.player-section-nav button {
  border-radius: 9px !important;
}

.player-section-nav button[aria-pressed="true"] {
  background: var(--surface-2) !important;
  box-shadow: inset 0 0 0 1px var(--human-hairline) !important;
}

.player-explorer-panel {
  border-color: var(--human-hairline) !important;
  box-shadow: var(--human-shadow) !important;
}

/* Bar charts should read like compact analytics, not glowing decoration. */
.player-explorer-panel [title*=" · "] {
  box-shadow: inset 0 1px rgba(255, 255, 255, .12);
  transition: filter 160ms ease, transform 160ms ease;
}

.player-explorer-panel [title*=" · "]:hover {
  filter: brightness(1.13) saturate(1.04);
  transform: scaleX(1.05);
}

/* ------------------------------ sign in */

.auth-shell {
  isolation: isolate;
  background:
    radial-gradient(760px 360px at 8% 2%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 70%),
    var(--surface) !important;
  border-color: var(--human-hairline) !important;
  box-shadow: 0 28px 90px rgba(0, 0, 0, .30), inset 0 1px rgba(255, 255, 255, .025) !important;
}

.auth-story {
  background:
    linear-gradient(155deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 48%),
    color-mix(in srgb, var(--bg-deep) 92%, var(--surface));
}

.auth-story__glow {
  position: absolute;
  width: 330px;
  height: 330px;
  left: -150px;
  top: -155px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  filter: blur(70px);
  opacity: .55;
}

.auth-story__eyebrow {
  border: 1px solid var(--human-hairline);
  border-radius: 999px;
  padding: 7px 10px;
  background: rgba(255, 255, 255, .022);
  color: var(--text-2);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .11em;
  text-transform: uppercase;
}

.auth-trust-row {
  padding: 10px 0;
  border-top: 1px solid var(--human-hairline);
}

.auth-card input {
  min-height: 44px !important;
  border-radius: 11px !important;
  background: rgba(255, 255, 255, .018) !important;
  border-color: var(--human-hairline) !important;
}

.auth-card input:focus {
  border-color: color-mix(in srgb, var(--accent) 50%, transparent) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent) !important;
}

.auth-google {
  box-shadow: inset 0 1px rgba(255, 255, 255, .025);
}

.auth-submit {
  justify-content: center;
  gap: 8px;
}

/* ------------------------------ mobile density */

@media (max-width: 767px) {
  main .sticky.top-16 {
    top: 56px !important;
    margin-inline: -8px !important;
    padding: 8px !important;
    border-radius: 13px !important;
  }

  main .sticky.top-16 .rail {
    gap: 6px !important;
  }

  main .sticky.top-16 .rail button,
  main .sticky.top-16 > div:nth-child(2) > button {
    min-height: 34px !important;
    padding-inline: 10px !important;
  }

  main .sticky.top-16 input[type="search"] {
    min-height: 38px !important;
  }

  main .face.prop-card-v2 {
    border-radius: 15px !important;
  }

  .prop-card-v2__open {
    padding: 12px 12px 9px !important;
  }

  .prop-card-v2__hit {
    padding-inline: 12px !important;
  }

  .prop-card-v2__quotes {
    padding-inline: 12px !important;
    padding-bottom: 12px !important;
  }

  .player-cinematic-hero {
    border-radius: 17px !important;
  }

  .auth-shell {
    border-radius: 18px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  main .face.prop-card-v2,
  .player-explorer-panel [title*=" · "] {
    transition: none !important;
    transform: none !important;
  }
}

```

---

## FILE: apps/oblige-web/app/mobile-density.css

```css
/* Mobile density pass for the live prop board.
   Presentation only: keep providers, research, auth, billing and routing untouched. */

@media (max-width: 767px) {
  /* The board controls were consuming too much of the usable iPhone viewport.
     Let them scroll away instead of pinning a large tray above the feed. */
  main .sticky.top-16 {
    position: relative !important;
    top: auto !important;
    z-index: 10 !important;
    gap: 6px !important;
    margin-inline: 0 !important;
    padding: 6px !important;
    border-radius: 10px !important;
  }

  main .sticky.top-16 .rail {
    display: flex !important;
    gap: 6px !important;
    margin-inline: 0 !important;
    padding: 0 0 2px !important;
    overflow-x: auto !important;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  main .sticky.top-16 .rail::-webkit-scrollbar,
  main .sticky.top-16 > div:nth-child(2)::-webkit-scrollbar {
    display: none;
  }

  main .sticky.top-16 .rail button {
    min-height: 32px !important;
    padding-inline: 10px !important;
    border-radius: 8px !important;
    font-size: 11px !important;
  }

  /* Search, Filters and sort controls stay on one compact horizontal row.
     The row scrolls sideways instead of wrapping into a second line. */
  main .sticky.top-16 > div:nth-child(2) {
    flex-wrap: nowrap !important;
    gap: 6px !important;
    overflow-x: auto !important;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  main .sticky.top-16 > div:nth-child(2) > label {
    flex: 0 0 clamp(170px, 49vw, 210px) !important;
    min-width: 170px !important;
  }

  main .sticky.top-16 input[type="search"] {
    min-height: 34px !important;
    height: 34px !important;
    padding-left: 32px !important;
    border-radius: 8px !important;
    font-size: 12px !important;
  }

  main .sticky.top-16 > div:nth-child(2) > button,
  main .sticky.top-16 .board-filter-trigger {
    min-height: 34px !important;
    height: 34px !important;
    padding-inline: 10px !important;
    border-radius: 8px !important;
    font-size: 11px !important;
    white-space: nowrap;
  }

  .board-filter-panel {
    gap: 6px !important;
    padding: 8px !important;
    border-radius: 9px !important;
    max-height: min(46vh, 340px) !important;
  }

  .board-filter-field {
    gap: 4px !important;
  }

  .board-filter-field select,
  .board-filter-reset {
    min-height: 36px !important;
    height: 36px !important;
  }

  /* Reduce dead space above the feed, but only on the live board container. */
  main > div[class*="max-w-"]:has(> .sticky.top-16) {
    padding-top: 14px !important;
    padding-bottom: 66px !important;
  }

  main > div[class*="max-w-"]:has(> .sticky.top-16) > div:first-child {
    margin-bottom: 10px !important;
  }

  main > div[class*="max-w-"]:has(> .sticky.top-16) > div:first-child h1 {
    font-size: 26px !important;
  }

  .board-kicker {
    margin-bottom: 3px !important;
    font-size: 9px !important;
  }

  /* Dense feed cards: preserve all real data but fit materially more props
     on one phone screen. */
  main .face.prop-card-v2 {
    border-radius: 11px !important;
  }

  .prop-card-v2__open {
    gap: 7px !important;
    padding: 9px 10px 6px !important;
  }

  .prop-card-v2__identity {
    min-height: 44px !important;
    gap: 9px !important;
  }

  .prop-card-v2__identity .ringavatar {
    width: 44px !important;
    height: 44px !important;
  }

  .player-portrait-stack {
    min-width: 46px !important;
  }

  .player-portrait-stack .ringavatar + .ringavatar {
    margin-left: -14px !important;
  }

  .prop-card-v2__identity > span:nth-child(2) > span:first-child {
    font-size: 14px !important;
    line-height: 1.1 !important;
  }

  .prop-card-v2__meta {
    margin-top: 2px !important;
    font-size: 10px !important;
    line-height: 1.2 !important;
  }

  .prop-card-v2__identity > span:last-child {
    font-size: 9px !important;
  }

  .prop-card-v2__market-row {
    gap: 10px !important;
    padding-top: 7px !important;
  }

  .prop-card-v2__market-label {
    gap: 0 !important;
  }

  .prop-card-v2__market-label > span:first-child {
    font-size: 11px !important;
  }

  .prop-card-v2__market-label > span:last-child {
    font-size: 9px !important;
    line-height: 1.2 !important;
  }

  .prop-card-v2__line {
    font-size: 23px !important;
  }

  .prop-card-v2__hit {
    padding: 0 10px 7px !important;
  }

  .prop-card-v2__hit > div,
  .prop-card-v2__hit > span {
    gap: 4px !important;
  }

  .prop-card-v2__hit > div > div:first-child {
    font-size: 10px !important;
  }

  .prop-card-v2__hit > div > div:last-child {
    height: 5px !important;
  }

  .prop-card-v2__quotes {
    gap: 6px !important;
    padding: 0 10px 9px !important;
  }

  .prop-card-v2__quote {
    min-height: 38px !important;
    padding-inline: 10px !important;
    border-radius: 8px !important;
    font-size: 11px !important;
  }

  .prop-card-v2__book {
    margin-top: 0 !important;
    font-size: 8px !important;
  }

  /* Tighten the feed rhythm and reclaim a little more viewport from the nav. */
  main .mt-5.grid:has(> .prop-card-v2),
  main .mt-5.grid:has(> .rv) {
    margin-top: 10px !important;
    gap: 8px !important;
  }

  nav[aria-label="Sections"] a {
    min-height: 50px !important;
    gap: 1px !important;
    font-size: 9px !important;
  }

  nav[aria-label="Sections"] svg {
    width: 18px !important;
    height: 18px !important;
  }
}

```

---

## FILE: apps/oblige-web/app/player-shell.css

```css
/* Premium player-analysis shell. Presentation only; data contracts stay untouched. */

.player-app-shell {
  --player-nav-top: 72px;
}

.player-section-anchor {
  scroll-margin-top: 154px;
}

.player-cinematic-hero {
  min-height: 250px;
  padding: 24px !important;
  background:
    radial-gradient(760px 300px at 92% -4%, rgba(123,130,255,.24), transparent 64%),
    radial-gradient(540px 280px at -4% 110%, rgba(67,211,208,.10), transparent 68%),
    linear-gradient(145deg, rgba(15,20,42,.98), rgba(6,9,20,.99)) !important;
}

.player-cinematic-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(5,8,18,.20), transparent 42%),
    repeating-linear-gradient(90deg, transparent 0 79px, rgba(255,255,255,.012) 80px);
  opacity: .8;
}

.player-cinematic-hero > * {
  position: relative;
  z-index: 2;
}

.player-identity-row {
  min-height: 118px;
}

.player-cinematic-hero .ringavatar {
  transform: scale(1.06);
  box-shadow:
    0 0 0 4px rgba(123,130,255,.13),
    0 0 0 1px rgba(180,189,255,.32),
    0 22px 54px rgba(0,0,0,.50) !important;
}

.player-line-glance {
  background:
    linear-gradient(135deg, rgba(255,255,255,.05), rgba(255,255,255,.018)) !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
  backdrop-filter: blur(20px);
}

.player-section-nav {
  position: sticky;
  top: var(--player-nav-top);
  z-index: 23;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
  width: min(620px, 100%);
  margin: 16px auto 0;
  padding: 5px;
  border: 1px solid rgba(145,158,255,.14);
  border-radius: 999px;
  background: rgba(7,10,22,.86);
  box-shadow: 0 14px 46px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.035);
  backdrop-filter: blur(24px) saturate(1.15);
}

.player-section-nav button {
  min-height: 40px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #7f8ba7;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -.01em;
  cursor: pointer;
  transition: color .2s ease, background-color .2s ease, box-shadow .2s ease, transform .2s ease;
}

.player-section-nav button:hover {
  color: #eef1ff;
  background: rgba(123,130,255,.07);
}

.player-section-nav button:active {
  transform: scale(.97);
}

.player-section-nav button[aria-pressed='true'] {
  color: #fff;
  background: linear-gradient(135deg, #707aff, #5862dc 64%, #4b8eb7);
  box-shadow: 0 8px 24px rgba(65,74,205,.30), inset 0 1px 0 rgba(255,255,255,.16);
}

.player-section-block {
  margin-top: 30px;
}

.player-section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 13px;
  padding: 0 2px;
}

.player-section-heading h2 {
  margin: 4px 0 0;
  max-width: 720px;
  color: #f7f8ff;
  font-size: clamp(21px, 2.4vw, 30px) !important;
  font-weight: 760;
  line-height: 1.08;
  letter-spacing: -.04em !important;
}

.player-section-kicker {
  color: #818db0;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .15em;
  text-transform: uppercase;
}

.player-section-count {
  flex: none;
  padding: 7px 10px;
  border: 1px solid rgba(145,158,255,.12);
  border-radius: 999px;
  background: rgba(255,255,255,.025);
  color: #8390aa;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.player-market-rail {
  padding: 3px 0 6px;
}

.player-market-rail button {
  min-height: 45px !important;
  padding-inline: 17px !important;
}

.player-explorer-panel {
  overflow: hidden;
  border-radius: 24px !important;
  background:
    radial-gradient(720px 240px at 90% -20%, rgba(112,122,255,.10), transparent 68%),
    rgba(8,12,26,.86) !important;
}

.player-split-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.player-split-card {
  position: relative;
  overflow: hidden;
  min-height: 124px;
  padding: 16px;
  border: 1px solid rgba(145,158,255,.13);
  border-radius: 20px;
  background:
    radial-gradient(340px 130px at 100% 0%, rgba(123,130,255,.08), transparent 68%),
    rgba(9,13,28,.82);
  box-shadow: 0 18px 52px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.025);
}

.player-split-card::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: #55607a;
  opacity: .55;
}

.player-split-card[data-tone='pos']::after {
  background: #48dfb3;
}

.player-split-card[data-tone='neg']::after {
  background: #ff7097;
}

.player-split-card[data-tone='mid']::after {
  background: #f1bd59;
}

.player-split-topline,
.player-split-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.player-split-topline {
  color: #8995af;
  font-size: 11px;
  font-weight: 650;
}

.player-split-card > strong {
  display: block;
  margin-top: 12px;
  color: #f8f9ff;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -.045em;
}

.player-split-card[data-tone='pos'] > strong {
  color: #58e7bd;
}

.player-split-card[data-tone='neg'] > strong {
  color: #ff7d9f;
}

.player-split-card[data-tone='mid'] > strong {
  color: #f3c56d;
}

.player-split-meta {
  margin-top: 11px;
  color: #68758e;
  font-size: 10px;
}

.player-detail-grid > div > [class*='shadow-[var(--shadow-1)]'] {
  margin-top: 0 !important;
  min-height: 100%;
}

.player-back-link {
  color: #77849f !important;
}

.player-back-link:hover {
  color: #f4f6ff !important;
}

@media (min-width: 1024px) {
  .player-cinematic-hero {
    min-height: 274px;
    padding: 30px !important;
  }

  .player-cinematic-hero .ringavatar {
    transform: scale(1.13);
    margin-right: 7px;
  }

  .player-section-nav {
    top: 68px;
  }
}

@media (max-width: 767px) {
  .player-app-shell {
    --player-nav-top: 63px;
    padding-inline: 12px !important;
  }

  .player-section-anchor {
    scroll-margin-top: 130px;
  }

  .player-cinematic-hero {
    min-height: 0;
    padding: 18px !important;
    border-radius: 22px !important;
  }

  .player-identity-row {
    align-items: flex-start !important;
    min-height: 104px;
  }

  .player-cinematic-hero .ringavatar {
    transform: scale(1);
  }

  .player-line-glance {
    margin-top: 15px !important;
    padding: 13px !important;
  }

  .player-section-nav {
    top: 62px;
    width: 100%;
    margin-top: 12px;
    gap: 3px;
    padding: 4px;
    border-radius: 18px;
  }

  .player-section-nav button {
    min-height: 39px;
    padding-inline: 5px;
    border-radius: 14px;
    font-size: 11px;
  }

  .player-section-block {
    margin-top: 24px;
  }

  .player-section-heading {
    align-items: flex-start;
    margin-bottom: 11px;
  }

  .player-section-heading h2 {
    font-size: 21px !important;
  }

  .player-section-count {
    display: none;
  }

  .player-explorer-panel {
    border-radius: 19px !important;
    padding: 14px !important;
  }

  .player-split-grid {
    grid-template-columns: 1fr;
    gap: 9px;
  }

  .player-split-card {
    min-height: 0;
    padding: 14px 15px;
    border-radius: 17px;
  }

  .player-split-card > strong {
    margin-top: 9px;
    font-size: 28px;
  }

  .player-detail-grid {
    gap: 12px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-section-nav button {
    transition: none;
  }
}

```

---

## FILE: apps/oblige-web/app/reference-acceptance.css

```css
/*
 * Visual acceptance layer.
 *
 * This file is intentionally last in the cascade. The supplied sports-product
 * references are the acceptance target: compact chrome, quiet surfaces, tight
 * prop-card rhythm, clear player identity, and materially more real data above
 * the fold. No API, auth, provider, research, or routing behavior lives here.
 */

body:has(.board-shell) {
  background: #07090d;
}

/* ------------------------------------------------------------------ chrome */

header[data-board="true"] {
  border-bottom-color: color-mix(in srgb, var(--text) 8%, transparent) !important;
  background: color-mix(in srgb, #07090d 94%, transparent) !important;
  box-shadow: none !important;
}

header[data-board="true"] > div {
  min-height: 54px !important;
  height: 54px !important;
}

header[data-board="true"] .op-mark {
  box-shadow: none !important;
}

nav[aria-label="Sections"][data-board="true"] {
  box-shadow: 0 -8px 28px rgba(0, 0, 0, .18) !important;
}

/* ------------------------------------------------------------------- board */

.board-shell {
  --board-hairline: color-mix(in srgb, var(--text) 9%, transparent);
  --board-hairline-strong: color-mix(in srgb, var(--text) 16%, transparent);
}

.board-summary h1 {
  font-weight: 780 !important;
  letter-spacing: -.04em !important;
  line-height: 1 !important;
}

.board-toolbar {
  border-color: var(--board-hairline) !important;
  box-shadow: none !important;
}

.board-leagues {
  display: flex;
  gap: 5px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  overscroll-behavior-inline: contain;
  -webkit-overflow-scrolling: touch;
}

.board-leagues::-webkit-scrollbar {
  display: none;
}

.board-toolbar button,
.board-toolbar input,
.board-filter-panel select {
  box-shadow: none !important;
}

.board-toolbar input[type="search"] {
  border-color: var(--board-hairline) !important;
  background: rgba(255, 255, 255, .025) !important;
}

.board-toolbar input[type="search"]:focus {
  border-color: color-mix(in srgb, var(--accent) 42%, transparent) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 7%, transparent) !important;
}

.board-filter-trigger,
.board-sort-pills button {
  border-color: var(--board-hairline) !important;
  background: rgba(255, 255, 255, .022) !important;
}

.board-filter-panel {
  border: 1px solid var(--board-hairline) !important;
  background: color-mix(in srgb, #0b0e14 97%, transparent) !important;
  box-shadow: 0 18px 55px rgba(0, 0, 0, .38) !important;
}

.board-filter-field select,
.board-filter-reset {
  border-color: var(--board-hairline) !important;
  background: rgba(255, 255, 255, .025) !important;
}

.board-grid {
  align-items: start;
}

/* ----------------------------------------------------------- prop geometry */

main .face.prop-card-v2 {
  overflow: hidden;
  border: 1px solid var(--board-hairline) !important;
  border-radius: 14px !important;
  background: #0c0f14 !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .16) !important;
}

main .face.prop-card-v2::after {
  opacity: .32 !important;
}

.prop-card-v2 .facebg {
  opacity: .30 !important;
  filter: saturate(.82) contrast(.92);
}

@media (hover: hover) {
  main .face.prop-card-v2:hover {
    transform: translateY(-1px) !important;
    border-color: var(--board-hairline-strong) !important;
    box-shadow: 0 11px 30px rgba(0, 0, 0, .21) !important;
  }
}

.prop-card-v2__open {
  gap: 0 !important;
  padding: 11px 11px 8px !important;
}

.prop-card-v2__identity {
  min-height: 50px !important;
  gap: 9px !important;
}

.prop-card-v2__identity .ringavatar {
  width: 50px !important;
  height: 50px !important;
  box-shadow: 0 0 0 1px var(--board-hairline-strong) !important;
}

.prop-card-v2__identity .ringavatar > span {
  border-radius: 11px !important;
}

.prop-card-v2__identity .ringavatar img {
  transform: scale(1.07);
}

.prop-card-v2__identity > span:nth-child(2) > span:first-child {
  font-size: 14px !important;
  font-weight: 690 !important;
  line-height: 1.15 !important;
  letter-spacing: -.018em !important;
}

.prop-card-v2__meta {
  margin-top: 2px !important;
  font-size: 9.5px !important;
  line-height: 1.25 !important;
  color: var(--text-3) !important;
}

.prop-card-v2__identity > span:last-child {
  padding: 3px 6px !important;
  border-radius: 6px !important;
  font-size: 8.5px !important;
}

.prop-card-v2__market-row {
  margin-top: 8px !important;
  gap: 10px !important;
  padding-top: 7px !important;
  border-color: var(--board-hairline) !important;
}

.prop-card-v2__market-label {
  gap: 0 !important;
}

.prop-card-v2__market-label > span:first-child {
  font-size: 11px !important;
  font-weight: 650 !important;
  color: var(--text-2) !important;
}

.prop-card-v2__market-label > span:last-child {
  margin-top: 1px !important;
  font-size: 8.5px !important;
  line-height: 1.15 !important;
  color: var(--text-3) !important;
}

.prop-card-v2__line {
  font-size: 23px !important;
  line-height: .95 !important;
  letter-spacing: -.04em !important;
}

.prop-card-v2__hit {
  padding: 0 11px 8px !important;
}

.prop-card-v2__hit > div {
  gap: 5px !important;
}

.prop-card-v2__hit > div > div:first-child {
  font-size: 9px !important;
}

/* Real-game L10 strip. Keep every observed game visible without turning the
   compact feed card into a full analytics chart. */
.prop-card-v2__hit [aria-label^="Last "] {
  height: 31px !important;
  gap: 3px !important;
  padding: 4px 5px 3px !important;
  border-color: var(--board-hairline) !important;
  border-radius: 7px !important;
  background: rgba(255, 255, 255, .022) !important;
}

.prop-card-v2__hit [aria-label^="Last "] > span > span {
  border-radius: 2px !important;
}

.prop-card-v2__quotes {
  gap: 5px !important;
  padding: 0 11px 10px !important;
}

.prop-card-v2__quote {
  min-height: 39px !important;
  border-radius: 8px !important;
  border-color: var(--board-hairline) !important;
  background: rgba(255, 255, 255, .024) !important;
  font-size: 10.5px !important;
}

.prop-card-v2__quote:hover {
  border-color: var(--board-hairline-strong) !important;
  background: rgba(255, 255, 255, .037) !important;
}

.prop-card-v2__book {
  margin-top: 0 !important;
  max-width: 110px !important;
  font-size: 7.5px !important;
  line-height: 1.15 !important;
  letter-spacing: .045em !important;
}

/* ------------------------------------------------------------ player page */

.player-app-shell {
  max-width: 1260px !important;
}

.player-cinematic-hero {
  border-radius: 16px !important;
  border-color: color-mix(in srgb, var(--text) 10%, transparent) !important;
  box-shadow: 0 10px 32px rgba(0, 0, 0, .18) !important;
}

.player-line-glance {
  border-radius: 10px !important;
  border-color: color-mix(in srgb, var(--text) 9%, transparent) !important;
  background: rgba(255, 255, 255, .022) !important;
}

.player-section-nav,
.player-explorer-panel,
.player-split-card {
  border-color: color-mix(in srgb, var(--text) 9%, transparent) !important;
  box-shadow: none !important;
}

/* --------------------------------------------------------------- iPhone */

@media (max-width: 767px) {
  header[data-board="true"] > div {
    height: 44px !important;
    min-height: 44px !important;
    gap: 8px !important;
    padding-inline: 10px !important;
  }

  header[data-board="true"] a[aria-label="Oblige Props home"] {
    gap: 7px !important;
  }

  header[data-board="true"] .op-mark {
    width: 25px !important;
    height: 25px !important;
    border-radius: 7px !important;
    font-size: 9px !important;
  }

  header[data-board="true"] .op-wordmark {
    font-size: 14px !important;
    letter-spacing: -.035em !important;
  }

  .board-mobile-account {
    width: 30px !important;
    height: 30px !important;
    border-color: var(--board-hairline) !important;
    background: rgba(255, 255, 255, .022);
  }

  .board-shell {
    padding-inline: 8px !important;
    padding-top: 5px !important;
    padding-bottom: 57px !important;
  }

  .board-summary {
    min-height: 27px;
    margin-bottom: 4px !important;
    align-items: center !important;
  }

  .board-summary__title {
    display: flex;
    align-items: baseline;
    gap: 7px;
  }

  .board-summary .board-kicker {
    display: none !important;
  }

  .board-summary h1 {
    margin: 0 !important;
    font-size: 18px !important;
  }

  .board-summary__meta {
    max-width: 62%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9.5px !important;
  }

  .board-stale {
    margin-bottom: 5px !important;
    padding: 6px 8px !important;
    border-radius: 7px !important;
    font-size: 9px !important;
  }

  .board-toolbar,
  main .board-toolbar.sticky.top-14 {
    position: sticky !important;
    top: 44px !important;
    z-index: 24 !important;
    gap: 4px !important;
    margin-inline: -8px !important;
    padding: 4px 8px 5px !important;
    border-width: 1px 0 !important;
    border-radius: 0 !important;
    background: color-mix(in srgb, #07090d 95%, transparent) !important;
    box-shadow: 0 7px 18px rgba(0, 0, 0, .12) !important;
    backdrop-filter: blur(18px) saturate(1.05) !important;
  }

  .board-leagues {
    gap: 4px !important;
    padding: 0 !important;
  }

  .board-leagues button,
  main .board-toolbar .board-leagues button {
    min-height: 27px !important;
    height: 27px !important;
    padding-inline: 8px !important;
    border-radius: 6px !important;
    font-size: 9.5px !important;
  }

  .board-control-row {
    gap: 5px !important;
  }

  .board-search input,
  main .board-toolbar input[type="search"] {
    height: 32px !important;
    min-height: 32px !important;
    border-radius: 7px !important;
    padding-left: 29px !important;
    font-size: 11px !important;
  }

  .board-filter-trigger,
  main .board-toolbar .board-filter-trigger {
    height: 32px !important;
    min-height: 32px !important;
    padding-inline: 9px !important;
    border-radius: 7px !important;
    font-size: 9.5px !important;
  }

  .board-filter-panel {
    position: absolute !important;
    top: calc(100% + 5px) !important;
    left: 8px !important;
    right: 8px !important;
    z-index: 45 !important;
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 6px !important;
    max-height: min(55vh, 390px) !important;
    overflow-y: auto !important;
    padding: 8px !important;
    border-radius: 10px !important;
  }

  .board-filter-field {
    gap: 3px !important;
  }

  .board-filter-field > span {
    font-size: 8.5px !important;
  }

  .board-filter-field select,
  .board-filter-reset {
    height: 34px !important;
    min-height: 34px !important;
    border-radius: 7px !important;
    font-size: 10px !important;
  }

  .board-filter-reset {
    align-self: end;
  }

  .board-grid {
    margin-top: 7px !important;
    gap: 7px !important;
  }

  main .face.prop-card-v2 {
    border-radius: 11px !important;
    box-shadow: 0 5px 15px rgba(0, 0, 0, .13) !important;
  }

  .prop-card-v2__open {
    padding: 8px 9px 6px !important;
  }

  .prop-card-v2__identity {
    min-height: 44px !important;
    gap: 8px !important;
  }

  .prop-card-v2__identity .ringavatar {
    width: 44px !important;
    height: 44px !important;
  }

  .prop-card-v2__identity .ringavatar > span {
    border-radius: 9px !important;
  }

  .player-portrait-stack {
    min-width: 45px !important;
  }

  .prop-card-v2__identity > span:nth-child(2) > span:first-child {
    font-size: 13px !important;
  }

  .prop-card-v2__meta {
    font-size: 8.5px !important;
  }

  .prop-card-v2__identity > span:last-child {
    font-size: 7.5px !important;
  }

  .prop-card-v2__market-row {
    margin-top: 6px !important;
    padding-top: 5px !important;
  }

  .prop-card-v2__market-label > span:first-child {
    font-size: 10px !important;
  }

  .prop-card-v2__market-label > span:last-child {
    font-size: 7.5px !important;
  }

  .prop-card-v2__line {
    font-size: 21px !important;
  }

  .prop-card-v2__hit {
    padding: 0 9px 6px !important;
  }

  .prop-card-v2__hit > div {
    gap: 3px !important;
  }

  .prop-card-v2__hit > div > div:first-child {
    font-size: 8px !important;
  }

  .prop-card-v2__hit [aria-label^="Last "] {
    height: 27px !important;
    padding: 3px 4px 2px !important;
  }

  .prop-card-v2__quotes {
    gap: 5px !important;
    padding: 0 9px 8px !important;
  }

  .prop-card-v2__quote {
    min-height: 35px !important;
    border-radius: 7px !important;
    padding-inline: 8px !important;
    font-size: 9.5px !important;
  }

  .prop-card-v2__book {
    font-size: 7px !important;
  }

  nav[aria-label="Sections"][data-board="true"] {
    inset-inline: 0 !important;
    bottom: 0 !important;
    border-width: 1px 0 0 !important;
    border-radius: 0 !important;
    background: color-mix(in srgb, #07090d 96%, transparent) !important;
  }

  nav[aria-label="Sections"][data-board="true"] a {
    min-height: 43px !important;
    margin: 0 !important;
    gap: 0 !important;
    border-radius: 0 !important;
    font-size: 8px !important;
  }

  nav[aria-label="Sections"][data-board="true"] svg {
    width: 16px !important;
    height: 16px !important;
  }

  body:has(.board-shell) footer {
    display: none !important;
  }

  /* The reference treats the player page as a compact analytics sheet rather
     than a marketing hero. */
  .player-app-shell {
    padding: 8px 8px 58px !important;
  }

  .player-back-link {
    min-height: 30px !important;
    font-size: 10px !important;
  }

  .player-cinematic-hero {
    margin-top: 5px !important;
    padding: 11px !important;
    border-radius: 12px !important;
  }

  .player-cinematic-hero .ringavatar {
    width: 58px !important;
    height: 58px !important;
  }

  .player-cinematic-hero h1 {
    font-size: 24px !important;
    line-height: 1 !important;
    letter-spacing: -.045em !important;
  }

  .player-line-glance {
    margin-top: 9px !important;
    padding: 9px !important;
  }

  .player-line-glance .num.text-\[length\:var\(--fs-2xl\)\] {
    font-size: 25px !important;
  }

  .player-section-nav {
    position: sticky !important;
    top: 44px !important;
    z-index: 18 !important;
    gap: 2px !important;
    margin-top: 7px !important;
    padding: 3px !important;
    border-radius: 9px !important;
    background: color-mix(in srgb, #07090d 94%, transparent) !important;
  }

  .player-section-nav button {
    min-height: 31px !important;
    padding-inline: 8px !important;
    font-size: 9px !important;
  }

  .player-section-block {
    margin-top: 11px !important;
  }

  .player-section-heading {
    margin-bottom: 7px !important;
  }

  .player-section-heading h2 {
    font-size: 15px !important;
    line-height: 1.15 !important;
  }

  .player-section-kicker,
  .player-section-count {
    font-size: 8px !important;
  }

  .player-explorer-panel {
    padding: 10px !important;
    border-radius: 11px !important;
  }
}

@media (min-width: 1280px) {
  .board-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  }

  .board-shell {
    max-width: 1500px !important;
  }
}

```

---

## FILE: apps/oblige-web/app/reference-acceptance-desktop.css

```css
/* Final desktop visual-acceptance correction.
 * The supplied Prop Board reference uses three desktop columns. Keep this
 * presentation-only rule after reference-acceptance.css in the cascade.
 */
@media (min-width: 1280px) {
  .board-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  }
}

```

---

## FILE: apps/oblige-web/app/reference-filters.css

```css
/* Real board filter presentation for the approved mobile reference direction. */

.board-filter-trigger {
  display: inline-flex;
  background: #0b1724;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .02);
  transition: border-color 160ms ease, color 160ms ease, background-color 160ms ease;
}

.board-filter-trigger:hover,
.board-filter-trigger[aria-expanded="true"] {
  border-color: rgb(72 237 155 / .34) !important;
  background: #0d1c2a !important;
  color: #dce8f3 !important;
}

.board-filter-panel {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 9px;
  align-items: end;
  padding: 11px;
  border: 1px solid #193147;
  border-radius: 12px;
  background: linear-gradient(160deg, rgb(10 23 36 / .98), rgb(6 14 23 / .98));
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .02);
}

.board-filter-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.board-filter-field > span {
  color: #71869b;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .11em;
  text-transform: uppercase;
}

.board-filter-field select {
  width: 100%;
  min-height: 40px;
  padding: 0 32px 0 11px;
  border: 1px solid #1d354a;
  border-radius: 9px;
  background: #091522;
  color: #e8f0f7;
  font: 600 12px/1 var(--font-sans);
  outline: none;
}

.board-filter-field select:focus {
  border-color: rgb(72 237 155 / .48);
  box-shadow: 0 0 0 3px rgb(72 237 155 / .07);
}

.board-filter-reset {
  min-height: 40px;
  padding: 0 13px;
  border: 1px solid #1d354a;
  border-radius: 9px;
  background: #0b1825;
  color: #93a6b9;
  font: 700 11px/1 var(--font-sans);
  white-space: nowrap;
}

.board-filter-reset:hover:not(:disabled) {
  border-color: rgb(72 237 155 / .35);
  color: #52eca3;
}

.board-filter-reset:disabled {
  opacity: .42;
}

@media (max-width: 920px) {
  .board-filter-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .board-filter-reset {
    grid-column: 1 / -1;
  }
}

@media (max-width: 560px) {
  .board-filter-trigger {
    flex: 0 0 auto;
    min-height: 38px !important;
    border-radius: 9px !important;
    padding-inline: 11px !important;
  }

  .board-filter-panel {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 10px;
    max-height: min(54vh, 420px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .board-filter-field select {
    min-height: 42px;
    font-size: 11px;
  }
}

```

---

## FILE: apps/oblige-web/app/reference-mounted-board.css

```css
/*
 * Visual-acceptance overrides for the board that is actually mounted at /board.
 * BetHoopsBoard keeps all of its existing data, auth, model, research, SSE and
 * navigation behavior; this layer only tightens hierarchy, density and surface
 * treatment to the supplied ObligeProps references.
 */

main:has([aria-label="Prop dashboard views"]) > div {
  min-height: calc(100vh - 3.5rem) !important;
  padding: 12px 12px 68px !important;
  background:
    radial-gradient(circle at 50% -12%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 34rem),
    #07090d !important;
}

main:has([aria-label="Prop dashboard views"]) > div > section {
  width: min(100%, 1240px) !important;
  color: var(--text) !important;
  --card-bg: rgba(255, 255, 255, .025) !important;
  --card-border: color-mix(in srgb, var(--text) 9%, transparent) !important;
  --text-main: var(--text) !important;
  --text-muted: var(--text-3) !important;
  --accent-color: var(--accent) !important;
  --accent-hover: color-mix(in srgb, var(--accent) 82%, white) !important;
}

/* Keep the board identity and view switcher useful without paying a hero-sized
   vertical cost before the first live prop. */
main:has([aria-label="Prop dashboard views"]) header:has([aria-label="Prop dashboard views"]) {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 12px !important;
  min-height: 36px !important;
  margin: 0 0 8px !important;
  text-align: left !important;
  animation: none !important;
}

main:has([aria-label="Prop dashboard views"]) header:has([aria-label="Prop dashboard views"]) > p {
  display: none !important;
}

main:has([aria-label="Prop dashboard views"]) header:has([aria-label="Prop dashboard views"]) > h1 {
  margin: 0 !important;
  color: var(--text) !important;
  background: none !important;
  -webkit-text-fill-color: currentColor !important;
  font-size: 18px !important;
  line-height: 1 !important;
  font-weight: 780 !important;
  letter-spacing: -.04em !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Prop dashboard views"] {
  display: flex !important;
  gap: 4px !important;
  margin: 0 !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Prop dashboard views"] button {
  min-height: 30px !important;
  padding: 5px 9px !important;
  border-radius: 7px !important;
  box-shadow: none !important;
  background: rgba(255, 255, 255, .022) !important;
  font-size: 10px !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Prop dashboard views"] button[aria-selected="true"] {
  border-color: color-mix(in srgb, var(--accent) 50%, transparent) !important;
  background: color-mix(in srgb, var(--accent) 18%, #0b0e14) !important;
  color: var(--text) !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Prop dashboard views"] svg {
  width: 14px !important;
  height: 14px !important;
}

/* Controls: two thin horizontal rails around one compact search row. */
main:has([aria-label="Prop dashboard views"]) div:has(> [aria-label="Sport"]):has(> [aria-label="Market"]) {
  display: grid !important;
  gap: 5px !important;
  margin-bottom: 8px !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Sport"],
main:has([aria-label="Prop dashboard views"]) [aria-label="Market"] {
  display: flex !important;
  gap: 4px !important;
  overflow-x: auto !important;
  padding: 0 !important;
  scrollbar-width: none !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Sport"]::-webkit-scrollbar,
main:has([aria-label="Prop dashboard views"]) [aria-label="Market"]::-webkit-scrollbar {
  display: none !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Sport"] button,
main:has([aria-label="Prop dashboard views"]) [aria-label="Market"] button {
  min-height: 28px !important;
  height: 28px !important;
  padding: 4px 8px !important;
  border-radius: 7px !important;
  border-color: color-mix(in srgb, var(--text) 9%, transparent) !important;
  background: rgba(255, 255, 255, .022) !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  font-size: 9.5px !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Sport"] button[aria-pressed="true"],
main:has([aria-label="Prop dashboard views"]) [aria-label="Market"] button[aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--accent) 50%, transparent) !important;
  background: color-mix(in srgb, var(--accent) 16%, #0b0e14) !important;
  color: var(--text) !important;
}

main:has([aria-label="Prop dashboard views"]) [aria-label="Market"] svg {
  width: 13px !important;
  height: 13px !important;
}

main:has([aria-label="Prop dashboard views"]) div:has(> label > input[type="search"]) {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
}

main:has([aria-label="Prop dashboard views"]) label:has(input[type="search"]) {
  min-height: 34px !important;
  height: 34px !important;
  padding: 0 10px !important;
  border-radius: 8px !important;
  border-color: color-mix(in srgb, var(--text) 9%, transparent) !important;
  background: rgba(255, 255, 255, .025) !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

main:has([aria-label="Prop dashboard views"]) label:has(input[type="search"]) input {
  font-size: 11px !important;
}

main:has([aria-label="Prop dashboard views"]) label:has(input[type="search"]) svg {
  width: 14px !important;
  height: 14px !important;
}

main:has([aria-label="Prop dashboard views"]) [class*="feedStatus"] {
  min-height: 30px !important;
  height: 30px !important;
  padding: 0 8px !important;
  border-radius: 7px !important;
  box-shadow: none !important;
  font-size: 9px !important;
}

/* Quiet board surface and compact heading. */
main:has([aria-label="Prop dashboard views"]) [class*="glassPanel"] {
  padding: 10px !important;
  border-radius: 12px !important;
  border-color: color-mix(in srgb, var(--text) 8%, transparent) !important;
  background: #090c11 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  animation: none !important;
}

main:has([aria-label="Prop dashboard views"]) [class*="panelHeading"] {
  align-items: center !important;
  gap: 8px !important;
  margin-bottom: 8px !important;
}

main:has([aria-label="Prop dashboard views"]) [class*="panelHeading"] h2 {
  margin-top: 1px !important;
  font-size: 13px !important;
  line-height: 1.15 !important;
  font-weight: 680 !important;
}

main:has([aria-label="Prop dashboard views"]) [class*="panelKicker"] {
  font-size: 8px !important;
  letter-spacing: .08em !important;
  color: var(--text-3) !important;
}

main:has([aria-label="Prop dashboard views"]) [class*="panelMeta"] {
  font-size: 9px !important;
  color: var(--text-3) !important;
}

/* The supplied desktop board is a deliberate three-column research surface,
   not a four-column auto-fill gallery. */
main:has([aria-label="Prop dashboard views"]) div:has(> article) {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
  gap: 10px !important;
  align-items: start !important;
}

/* Prop cards: information first, restrained surface treatment. */
main:has([aria-label="Prop dashboard views"]) article {
  padding: 11px !important;
  border-radius: 12px !important;
  border-color: color-mix(in srgb, var(--text) 10%, transparent) !important;
  background: #0c0f14 !important;
  box-shadow: none !important;
}

@media (hover: hover) {
  main:has([aria-label="Prop dashboard views"]) article:hover {
    transform: translateY(-1px) !important;
    border-color: color-mix(in srgb, var(--text) 17%, transparent) !important;
    background: #0e1218 !important;
    box-shadow: 0 10px 24px rgba(0, 0, 0, .18) !important;
  }
}

main:has([aria-label="Prop dashboard views"]) article [class*="recommendationBadge"] {
  padding: 4px 6px !important;
  border-bottom-left-radius: 7px !important;
  font-size: 8px !important;
  letter-spacing: .04em !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="recommendationBadge"] svg {
  width: 11px !important;
  height: 11px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="cardHeader"] {
  padding-right: 54px !important;
  margin-bottom: 6px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="playerIdentity"] {
  gap: 8px !important;
}

main:has([aria-label="Prop dashboard views"]) article img {
  width: 44px !important;
  height: 44px !important;
  border-radius: 10px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="playerName"] {
  font-size: 13px !important;
  line-height: 1.15 !important;
  letter-spacing: -.015em !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="matchupBadge"] {
  margin-top: 2px !important;
  font-size: 9px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="statsRow"] {
  gap: 8px !important;
  margin-top: 6px !important;
  padding-top: 6px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="statLabel"] {
  margin-bottom: 1px !important;
  font-size: 8.5px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="statValue"] {
  font-size: 21px !important;
  line-height: 1 !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="statValue"][data-tone="neutral"] {
  max-width: 120px !important;
  font-size: 10px !important;
  line-height: 1.1 !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="contextGrid"] {
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  gap: 4px !important;
  margin-top: 6px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="contextGrid"] span {
  min-height: 25px !important;
  padding: 4px 5px !important;
  border-radius: 6px !important;
  font-size: 8.5px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="contextGrid"] svg {
  width: 12px !important;
  height: 12px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="quoteRow"] {
  gap: 4px !important;
  margin-top: 4px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="quoteRow"] span {
  min-height: 28px !important;
  padding: 6px 7px !important;
  border-radius: 6px !important;
  font-size: 9px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="cardFooter"] {
  gap: 6px !important;
  margin-top: 6px !important;
  padding-top: 6px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="cardFooter"] > span {
  font-size: 8px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="cardFooter"] button {
  min-height: 27px !important;
  padding: 5px 7px !important;
  border-radius: 6px !important;
  background: rgba(255, 255, 255, .035) !important;
  color: var(--text-2) !important;
  font-size: 8.5px !important;
}

main:has([aria-label="Prop dashboard views"]) article [class*="cardFooter"] button:hover {
  background: color-mix(in srgb, var(--accent) 16%, #0b0e14) !important;
  color: var(--text) !important;
}

/* Tablet keeps useful density without forcing desktop-sized cards. */
@media (min-width: 721px) and (max-width: 1023px) {
  main:has([aria-label="Prop dashboard views"]) div:has(> article) {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}

/* iPhone acceptance: first live props must arrive quickly, with no oversized
   hero or stacked one-column context blocks consuming the viewport. */
@media (max-width: 720px) {
  main:has([aria-label="Prop dashboard views"]) > div {
    padding: 5px 8px 58px !important;
  }

  main:has([aria-label="Prop dashboard views"]) header:has([aria-label="Prop dashboard views"]) {
    min-height: 31px !important;
    margin-bottom: 5px !important;
    gap: 6px !important;
  }

  main:has([aria-label="Prop dashboard views"]) header:has([aria-label="Prop dashboard views"]) > h1 {
    font-size: 15px !important;
  }

  main:has([aria-label="Prop dashboard views"]) [aria-label="Prop dashboard views"] button {
    min-height: 28px !important;
    padding: 4px 7px !important;
    font-size: 9px !important;
  }

  main:has([aria-label="Prop dashboard views"]) [aria-label="Sport"] button,
  main:has([aria-label="Prop dashboard views"]) [aria-label="Market"] button {
    min-height: 27px !important;
    height: 27px !important;
    padding-inline: 8px !important;
    font-size: 9px !important;
  }

  main:has([aria-label="Prop dashboard views"]) label:has(input[type="search"]) {
    min-height: 32px !important;
    height: 32px !important;
    border-radius: 7px !important;
  }

  main:has([aria-label="Prop dashboard views"]) [class*="feedStatus"] {
    display: none !important;
  }

  main:has([aria-label="Prop dashboard views"]) [class*="glassPanel"] {
    padding: 7px !important;
    border-radius: 10px !important;
  }

  main:has([aria-label="Prop dashboard views"]) [class*="panelHeading"] {
    margin-bottom: 6px !important;
  }

  main:has([aria-label="Prop dashboard views"]) [class*="panelHeading"] h2 {
    font-size: 11.5px !important;
  }

  main:has([aria-label="Prop dashboard views"]) [class*="panelMeta"] {
    font-size: 8px !important;
  }

  main:has([aria-label="Prop dashboard views"]) div:has(> article) {
    grid-template-columns: 1fr !important;
    gap: 7px !important;
  }

  main:has([aria-label="Prop dashboard views"]) article {
    padding: 9px !important;
    border-radius: 10px !important;
  }

  main:has([aria-label="Prop dashboard views"]) article img {
    width: 42px !important;
    height: 42px !important;
    border-radius: 9px !important;
  }

  main:has([aria-label="Prop dashboard views"]) article [class*="statValue"] {
    font-size: 19px !important;
  }

  main:has([aria-label="Prop dashboard views"]) article [class*="contextGrid"] {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}

```

---

## FILE: apps/oblige-web/app/reference-player-sheet.css

```css
/*
 * Player-analysis visual acceptance layer.
 *
 * The supplied mobile reference is the source of truth for hierarchy and density:
 * compact identity, market rail, controls, filters, sample strip, chart, supporting
 * context, and a bottom navigation that does not cover the data. Presentation only;
 * no provider, auth, polling, research, or routing behavior is changed here.
 */

body:has(.player-app-shell) {
  background:
    radial-gradient(760px 240px at 50% 0%, rgba(66, 63, 206, .20), transparent 62%),
    linear-gradient(180deg, #080b1d 0, #060816 230px, #050711 100%);
}

body:has(.player-app-shell) .player-cinematic-hero,
body:has(.player-app-shell) .player-explorer-panel,
body:has(.player-app-shell) .player-split-card {
  box-shadow: none !important;
}

body:has(.player-app-shell) footer {
  background: #050711;
}

.player-app-shell {
  --player-sheet-line: rgba(154, 164, 207, .16);
  --player-sheet-line-strong: rgba(154, 164, 207, .26);
  --player-sheet-surface: #0a0e20;
  --player-sheet-surface-2: #0f1429;
  --player-sheet-muted: #8e98b7;
}

.player-market-rail {
  scrollbar-width: none;
  overscroll-behavior-inline: contain;
  -webkit-overflow-scrolling: touch;
}

.player-market-rail::-webkit-scrollbar {
  display: none;
}

@media (max-width: 767px) {
  /* ------------------------------------------------------------- page chrome */

  body:has(.player-app-shell) header {
    border-bottom-color: rgba(154, 164, 207, .10) !important;
    background: rgba(5, 7, 17, .92) !important;
    backdrop-filter: blur(18px) saturate(1.05) !important;
  }

  body:has(.player-app-shell) header > div {
    height: 48px !important;
    min-height: 48px !important;
    justify-content: center;
    gap: 0 !important;
    padding-inline: 12px !important;
  }

  body:has(.player-app-shell) header > div > a:first-child {
    gap: 7px !important;
  }

  body:has(.player-app-shell) header .op-mark {
    width: 26px !important;
    height: 26px !important;
    border-radius: 8px !important;
    box-shadow: none !important;
    font-size: 8px !important;
  }

  body:has(.player-app-shell) header .op-wordmark {
    font-size: 16px !important;
    letter-spacing: -.025em !important;
  }

  body:has(.player-app-shell) header > div > div:last-child {
    display: none !important;
  }

  .player-app-shell {
    width: 100% !important;
    max-width: 760px !important;
    padding: 0 8px calc(78px + env(safe-area-inset-bottom)) !important;
  }

  .player-back-link {
    min-height: 36px !important;
    margin: 0 2px !important;
    gap: 5px !important;
    font-size: 11px !important;
    font-weight: 650 !important;
    color: #9ba6c6 !important;
    touch-action: manipulation;
  }

  .player-back-link svg {
    width: 16px !important;
    height: 16px !important;
  }

  /* ---------------------------------------------------------- identity header */

  .player-cinematic-hero {
    min-height: 0 !important;
    margin: 0 -8px !important;
    padding: 10px 14px 11px !important;
    border-width: 1px 0 !important;
    border-color: rgba(154, 164, 207, .10) !important;
    border-radius: 0 !important;
    background:
      radial-gradient(480px 150px at 70% -35%, rgba(80, 77, 218, .20), transparent 72%),
      linear-gradient(180deg, rgba(13, 18, 46, .96), rgba(8, 11, 28, .98)) !important;
  }

  .player-cinematic-hero::before {
    display: none !important;
  }

  .player-identity-row {
    min-height: 58px !important;
    align-items: center !important;
    gap: 10px !important;
  }

  .player-cinematic-hero .ringavatar {
    width: 54px !important;
    height: 54px !important;
    transform: none !important;
    box-shadow: 0 0 0 1px rgba(177, 187, 225, .30) !important;
  }

  .player-cinematic-hero .player-identity-row > span:first-child > span:last-child {
    width: 20px !important;
    height: 20px !important;
    right: -2px !important;
    bottom: -2px !important;
    border-width: 2px !important;
    font-size: 7px !important;
  }

  .player-cinematic-hero .player-identity-row > div > div:first-child {
    display: none !important;
  }

  .player-cinematic-hero h1 {
    margin: 0 !important;
    font-size: 21px !important;
    line-height: 1.04 !important;
    font-weight: 800 !important;
    letter-spacing: -.042em !important;
  }

  .player-cinematic-hero h1 + p {
    margin-top: 4px !important;
    gap: 4px 7px !important;
    font-size: 11px !important;
    line-height: 1.28 !important;
    color: #9aa5c4 !important;
  }

  .player-line-glance {
    min-height: 48px !important;
    margin-top: 9px !important;
    padding: 7px 10px !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: center !important;
    gap: 10px !important;
    border: 1px solid rgba(64, 213, 148, .38) !important;
    border-radius: 9px !important;
    background: linear-gradient(180deg, rgba(14, 27, 37, .96), rgba(10, 17, 28, .98)) !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .025) !important;
    backdrop-filter: none !important;
  }

  .player-line-glance p:first-child {
    font-size: 11px !important;
    font-weight: 700 !important;
  }

  .player-line-glance p:last-child {
    margin-top: 1px !important;
    font-size: 8.5px !important;
  }

  .player-line-glance > div:last-child {
    gap: 11px !important;
  }

  .player-line-glance > div:last-child > span:first-child {
    font-size: 23px !important;
  }

  .player-line-glance > div:last-child > span:last-child {
    gap: 0 !important;
    line-height: 1.15 !important;
  }

  .player-line-glance > div:last-child > span:last-child > span {
    font-size: 10px !important;
  }

  /* The reference uses the market rail as the primary local navigation. */
  .player-section-nav {
    display: none !important;
  }

  /* -------------------------------------------------------------- market rail */

  #player-props {
    margin: 0 -8px !important;
  }

  #player-props .player-section-heading {
    display: none !important;
  }

  .player-market-rail {
    display: flex !important;
    gap: 0 !important;
    margin: 0 !important;
    padding: 0 8px !important;
    overflow-x: auto !important;
    border-bottom: 1px solid var(--player-sheet-line) !important;
    background: rgba(8, 11, 28, .97) !important;
  }

  .player-market-rail button {
    position: relative;
    min-height: 44px !important;
    height: 44px !important;
    margin: 0 !important;
    padding: 0 13px !important;
    gap: 5px !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    color: #8089a8 !important;
    font-size: 11px !important;
    font-weight: 720 !important;
    letter-spacing: -.012em !important;
    touch-action: manipulation;
  }

  .player-market-rail button::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 0;
    height: 3px;
    border-radius: 3px 3px 0 0;
    background: transparent;
  }

  .player-market-rail button[aria-selected='true'] {
    color: #f7f8ff !important;
    background: linear-gradient(180deg, rgba(85, 80, 225, .16), rgba(85, 80, 225, .07)) !important;
  }

  .player-market-rail button[aria-selected='true']::after {
    background: linear-gradient(90deg, #7c66ff, #a55cff) !important;
  }

  .player-market-rail button .num {
    padding: 2px 5px;
    border-radius: 999px;
    background: rgba(148, 160, 207, .12);
    color: #9ca7c4 !important;
    font-size: 8px !important;
  }

  /* ---------------------------------------------------------- research sheet */

  #player-trends {
    margin: 0 -8px !important;
    padding: 0 8px !important;
  }

  #player-trends > .player-section-heading {
    display: none !important;
  }

  .player-explorer-panel {
    margin: 0 -8px !important;
    padding: 12px 12px 13px !important;
    border-width: 0 0 1px !important;
    border-color: var(--player-sheet-line) !important;
    border-radius: 0 !important;
    background:
      radial-gradient(480px 190px at 50% 100%, rgba(18, 131, 94, .10), transparent 72%),
      #080c1c !important;
  }

  .player-explorer-panel > div {
    gap: 12px !important;
  }

  /* Stepper / side / book / favourite: compact, but retain usable hit areas. */
  .player-explorer-panel output[aria-live='polite'] {
    min-width: 64px !important;
    padding: 9px 7px !important;
    font-size: 18px !important;
  }

  .player-explorer-panel output[aria-live='polite'] + button,
  .player-explorer-panel button:has(+ output[aria-live='polite']) {
    width: 40px !important;
    height: 40px !important;
    min-width: 40px !important;
    min-height: 40px !important;
  }

  .player-explorer-panel output[aria-live='polite'] + button svg,
  .player-explorer-panel button:has(+ output[aria-live='polite']) svg {
    width: 16px !important;
    height: 16px !important;
  }

  .player-explorer-panel [role='group'][aria-label='Side'] {
    min-height: 40px !important;
    border-radius: 9px !important;
  }

  .player-explorer-panel [role='group'][aria-label='Side'] button {
    min-height: 40px !important;
    padding-inline: 10px !important;
    font-size: 10px !important;
  }

  .player-explorer-panel [aria-label='Sportsbook'] {
    min-width: 142px !important;
    min-height: 40px !important;
    height: 40px !important;
    border-radius: 9px !important;
    padding-inline: 10px !important;
    font-size: 10px !important;
  }

  .player-explorer-panel button[aria-label^='Follow'],
  .player-explorer-panel button[aria-label^='Unfollow'] {
    width: 40px !important;
    height: 40px !important;
    min-width: 40px !important;
    min-height: 40px !important;
    border-radius: 9px !important;
  }

  .player-explorer-panel button[aria-label^='Follow'] svg,
  .player-explorer-panel button[aria-label^='Unfollow'] svg {
    width: 18px !important;
    height: 18px !important;
  }

  /* Filters are one short decision row instead of a tall block. */
  .player-explorer-panel [class*='grid-cols-2'][class*='items-end'] {
    grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    gap: 7px !important;
  }

  .player-explorer-panel [class*='grid-cols-2'][class*='items-end'] > div {
    gap: 4px !important;
  }

  .player-explorer-panel [class*='grid-cols-2'][class*='items-end'] > div > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 8.5px !important;
    font-weight: 650 !important;
    color: #8f99b6 !important;
  }

  .player-explorer-panel [class*='grid-cols-2'][class*='items-end'] button[role='combobox'] {
    min-height: 40px !important;
    height: 40px !important;
    border-radius: 9px !important;
    padding-inline: 9px !important;
    font-size: 10px !important;
  }

  .player-explorer-panel button:has(.lucide-rotate-ccw) {
    grid-column: auto !important;
    min-width: 40px !important;
    min-height: 40px !important;
    width: 40px !important;
    height: 40px !important;
    padding: 0 !important;
    border: 1px solid var(--player-sheet-line) !important;
    border-radius: 9px !important;
    overflow: hidden;
    color: transparent !important;
    background: #0d1225 !important;
  }

  .player-explorer-panel button:has(.lucide-rotate-ccw) svg {
    position: absolute;
    width: 16px !important;
    height: 16px !important;
    color: #8f99b6 !important;
  }

  /* Hit-rate strip: contiguous compact cards like the supplied reference. */
  .player-explorer-panel .rail {
    gap: 0 !important;
    margin-inline: 0 !important;
    padding: 0 !important;
    overflow-x: auto !important;
    border-color: rgba(154, 164, 207, .11) !important;
    border-radius: 9px !important;
    background: #050816 !important;
    scrollbar-width: none;
  }

  .player-explorer-panel .rail::-webkit-scrollbar {
    display: none;
  }

  .player-explorer-panel .rail > button {
    min-width: 78px !important;
    min-height: 68px !important;
    flex: 1 0 78px !important;
    gap: 2px !important;
    padding: 8px 9px !important;
    border: 0 !important;
    border-right: 1px solid rgba(154, 164, 207, .09) !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  .player-explorer-panel .rail > button:last-child {
    border-right: 0 !important;
  }

  .player-explorer-panel .rail > button[aria-pressed='true'] {
    background: linear-gradient(180deg, rgba(92, 84, 222, .16), rgba(92, 84, 222, .06)) !important;
    box-shadow: inset 0 0 0 1px rgba(112, 103, 235, .22) !important;
  }

  .player-explorer-panel .rail > button > span:first-child {
    font-size: 11px !important;
  }

  .player-explorer-panel .rail > button > span:nth-child(2) {
    font-size: 10px !important;
  }

  .player-explorer-panel .rail > button > span:last-child {
    font-size: 9px !important;
  }

  /* Chart region gets the visual weight; surrounding copy is intentionally quiet. */
  .player-explorer-panel h3 {
    font-size: 11px !important;
  }

  .player-explorer-panel h3 + div {
    font-size: 9.5px !important;
  }

  .player-explorer-panel [title*=' · '] {
    border-radius: 5px 5px 2px 2px !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .12);
  }

  /* --------------------------------------------------------- supporting stats */

  #player-splits {
    margin: 10px 0 0 !important;
  }

  #player-splits .player-section-heading {
    margin-bottom: 6px !important;
    padding-inline: 1px !important;
  }

  #player-splits .player-section-kicker {
    display: none !important;
  }

  #player-splits .player-section-heading h2 {
    font-size: 13px !important;
    letter-spacing: -.02em !important;
  }

  .player-split-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    gap: 7px !important;
  }

  .player-split-card {
    min-height: 92px !important;
    padding: 10px 9px !important;
    border-color: var(--player-sheet-line) !important;
    border-radius: 10px !important;
    background: #0b1022 !important;
  }

  .player-split-topline {
    font-size: 8.5px !important;
  }

  .player-split-card > strong {
    margin-top: 8px !important;
    font-size: 22px !important;
  }

  .player-split-meta {
    margin-top: 7px !important;
    display: grid !important;
    gap: 1px !important;
    font-size: 8px !important;
  }

  .player-split-card::after {
    height: 2px !important;
  }

  .player-detail-grid {
    margin-top: 10px !important;
    gap: 9px !important;
  }

  /* ------------------------------------------------------------ bottom nav */

  body:has(.player-app-shell) nav[aria-label='Sections'] {
    left: 8px !important;
    right: 8px !important;
    bottom: max(7px, env(safe-area-inset-bottom)) !important;
    overflow: hidden;
    border: 1px solid rgba(147, 158, 200, .24) !important;
    border-radius: 16px !important;
    background: rgba(10, 14, 29, .94) !important;
    box-shadow: 0 14px 40px rgba(0, 0, 0, .40) !important;
    backdrop-filter: blur(22px) saturate(1.08) !important;
    padding-bottom: 0 !important;
  }

  body:has(.player-app-shell) nav[aria-label='Sections'] a {
    min-height: 56px !important;
    gap: 2px !important;
    border-radius: 12px !important;
    margin: 4px !important;
    font-size: 9px !important;
    touch-action: manipulation;
  }

  body:has(.player-app-shell) nav[aria-label='Sections'] a[aria-current='page'] {
    background: linear-gradient(180deg, rgba(76, 98, 238, .88), rgba(65, 79, 211, .88)) !important;
    color: white !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .18) !important;
  }

  body:has(.player-app-shell) nav[aria-label='Sections'] svg {
    width: 18px !important;
    height: 18px !important;
  }

  body:has(.player-app-shell) footer {
    display: none !important;
  }
}

@media (min-width: 768px) {
  /* Desktop keeps the existing research architecture, but removes the oversized
     marketing treatment so the visual language stays consistent with mobile. */
  .player-cinematic-hero {
    min-height: 220px !important;
    border-color: var(--player-sheet-line) !important;
    background:
      radial-gradient(620px 230px at 88% -10%, rgba(79, 75, 205, .18), transparent 68%),
      linear-gradient(145deg, #0c1027, #080b18) !important;
  }

  .player-section-nav {
    border-color: var(--player-sheet-line) !important;
    background: rgba(8, 11, 24, .90) !important;
    box-shadow: none !important;
  }

  .player-explorer-panel,
  .player-split-card {
    border-color: var(--player-sheet-line) !important;
    background-color: var(--player-sheet-surface) !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-market-rail button,
  .player-explorer-panel button,
  body:has(.player-app-shell) nav[aria-label='Sections'] a {
    transition: none !important;
  }
}

```

---

## FILE: apps/oblige-web/app/reference-shell.css

```css
/* Oblige Props reference pass.
   Matches the approved black/navy + Oblige green sports-research direction.
   Presentation only: no provider, auth, billing, API or research contracts change here. */

html[data-direction] {
  --bg: #050b13;
  --bg-deep: #03070d;
  --surface: #09131f;
  --surface-2: #0d1927;
  --surface-3: #122235;
  --line: #1a2d40;
  --line-strong: #29445c;
  --text: #f6f9fc;
  --text-2: #aebccd;
  --text-3: #74879c;
  --accent: #48ed9b;
  --accent-ink: #04140d;
  --accent-soft: rgb(72 237 155 / .12);
  --pos: #48ed9b;
  --neg: #ff5f73;
  --warn: #f5c659;
  --info: #6ea8ff;
  --radius: 12px;
  --radius-sm: 9px;
  --radius-lg: 18px;
  --font-display: var(--font-sans);
  --font-body: var(--font-sans);
  --font-num: var(--font-mono);
  --display-weight: 800;
  --display-tracking: -.03em;
  --display-case: none;
  --face-1: #07111b;
  --face-2: #0d1d2c;
  --face-surface: #0b1723;
  --face-surface-2: #112437;
  --face-line: #1e354a;
  --face-line-strong: #2c5168;
  --face-text: #f7fbff;
  --face-text-2: #afc0d2;
  --face-text-3: #71879d;
  --face-ring: linear-gradient(145deg, #54f0a4 0%, #2acb82 55%, #19865d 100%);
  --face-glow: rgba(72, 237, 155, .18);
}

body {
  background:
    radial-gradient(900px 460px at 88% -8%, rgb(26 151 101 / .10), transparent 62%),
    radial-gradient(760px 420px at -10% 18%, rgb(33 83 120 / .10), transparent 64%),
    #050b13 !important;
}

body::before {
  opacity: .018 !important;
}

/* ---------- chrome ---------- */
header {
  background: rgb(5 11 19 / .93) !important;
  border-bottom: 1px solid #152639 !important;
  box-shadow: 0 12px 34px rgb(0 0 0 / .20) !important;
}

header > div {
  max-width: 1380px !important;
}

.op-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  border: 1px solid rgb(72 237 155 / .28);
  background: linear-gradient(145deg, #0e201d, #07120f) !important;
  color: #53f0a7 !important;
  font: 800 11px/1 var(--font-sans) !important;
  letter-spacing: -.04em;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .035), 0 8px 22px rgb(0 0 0 / .28) !important;
}

.op-wordmark {
  color: #f7fbff;
  font-weight: 800 !important;
  letter-spacing: -.045em !important;
  white-space: nowrap;
}

.op-wordmark__accent {
  color: #4dec9e;
}

header nav[aria-label="Primary"] {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

header nav[aria-label="Primary"] a {
  color: #8294aa !important;
}

header nav[aria-label="Primary"] a:hover,
header nav[aria-label="Primary"] a[aria-current="page"] {
  color: #f7fbff !important;
  background: transparent !important;
}

header nav[aria-label="Primary"] a span {
  background: #48ed9b !important;
}

/* ---------- board ---------- */
.board-kicker {
  margin-bottom: 6px;
  color: #54eca4;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .15em;
  text-transform: uppercase;
}

main > div[class*="max-w-"] > div:first-child h1 {
  font-size: clamp(29px, 5vw, 44px) !important;
  font-weight: 800 !important;
  letter-spacing: -.045em !important;
}

main .sticky.top-16 {
  top: 66px !important;
  border: 1px solid #182b3f !important;
  border-radius: 15px !important;
  padding: 11px !important;
  background: rgb(7 15 24 / .94) !important;
  box-shadow: 0 16px 44px rgb(0 0 0 / .28), inset 0 1px 0 rgb(255 255 255 / .025) !important;
  backdrop-filter: blur(22px) saturate(1.05) !important;
}

main .sticky.top-16 .rail button,
main .sticky.top-16 > div:last-child > button {
  min-height: 38px !important;
  border-radius: 9px !important;
  border-color: #1b3146 !important;
  background: #0b1724 !important;
  color: #98a9bc !important;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / .02) !important;
}

main .sticky.top-16 button[aria-pressed="true"] {
  color: #04130c !important;
  background: linear-gradient(135deg, #55efa6, #3edb91) !important;
  border-color: transparent !important;
  box-shadow: 0 8px 22px rgb(31 187 118 / .16) !important;
}

main .sticky.top-16 input[type="search"] {
  min-height: 42px !important;
  border-color: #1b3146 !important;
  border-radius: 10px !important;
  background: #091521 !important;
}

main .sticky.top-16 input[type="search"]:focus {
  border-color: rgb(72 237 155 / .52) !important;
  box-shadow: 0 0 0 3px rgb(72 237 155 / .08) !important;
}

/* ---------- prop cards ---------- */
main .face.prop-card-v2 {
  border: 1px solid #1b3043 !important;
  border-radius: 15px !important;
  background:
    radial-gradient(260px 110px at 92% -12%, rgb(72 237 155 / .07), transparent 70%),
    linear-gradient(160deg, #0b1724 0%, #07111b 100%) !important;
  box-shadow: 0 16px 42px rgb(0 0 0 / .26), inset 0 1px 0 rgb(255 255 255 / .025) !important;
  transform: none !important;
}

main .face.prop-card-v2:hover {
  border-color: #28485d !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 20px 54px rgb(0 0 0 / .34), 0 0 0 1px rgb(72 237 155 / .025) !important;
}

main .face.prop-card-v2::after {
  background: linear-gradient(135deg, rgb(255 255 255 / .025), transparent 30% 76%, rgb(72 237 155 / .018)) !important;
}

.prop-card-v2__open {
  gap: 12px !important;
  padding: 14px 14px 10px !important;
}

.prop-card-v2__identity {
  min-height: 54px;
}

.player-portrait-stack {
  display: flex;
  align-items: center;
  min-width: 58px;
}

.player-portrait-stack .ringavatar + .ringavatar {
  margin-left: -17px;
}

.player-portrait-stack .ringavatar {
  flex: none;
}

main .ringavatar {
  box-shadow: 0 0 0 2px #11273a, 0 8px 22px rgb(0 0 0 / .30) !important;
}

.prop-card-v2__meta {
  color: #7f93a8;
  font-size: 11px;
}

.prop-card-v2__market-row {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto !important;
  gap: 14px !important;
  align-items: center !important;
  padding-top: 11px !important;
  border-top-color: #172b3d !important;
}

.prop-card-v2__market-label {
  display: grid;
  gap: 2px;
}

.prop-card-v2__market-label > span:first-child {
  color: #b7c4d2;
  font-size: 12px;
  font-weight: 650;
}

.prop-card-v2__market-label > span:last-child {
  color: #60778d;
  font-size: 10px;
}

.prop-card-v2__line {
  color: #f7fbff;
  font-size: 28px !important;
  line-height: 1;
}

.prop-card-v2__hit {
  padding: 0 14px 11px;
}

.prop-card-v2__quotes {
  gap: 7px !important;
  padding: 0 14px 14px !important;
}

.prop-card-v2__quote {
  min-height: 48px !important;
  border-color: #1b3146 !important;
  border-radius: 10px !important;
  background: #0b1825 !important;
}

.prop-card-v2__quote:hover {
  border-color: #31536c !important;
  background: #0e1d2c !important;
}

.prop-card-v2__quote[data-side="OVER"][aria-pressed="true"] {
  border-color: rgb(72 237 155 / .46) !important;
  background: rgb(72 237 155 / .10) !important;
  color: #5af0a9 !important;
}

.prop-card-v2__quote[data-side="UNDER"][aria-pressed="true"] {
  border-color: rgb(111 166 255 / .42) !important;
  background: rgb(111 166 255 / .09) !important;
  color: #88b8ff !important;
}

.prop-card-v2__book {
  margin-top: 1px;
  color: #62788f;
  font-size: 9px;
  font-weight: 600;
  text-transform: none;
}

/* ---------- player research ---------- */
.player-cinematic-hero {
  border: 1px solid #1c3448 !important;
  border-radius: 20px !important;
  background:
    radial-gradient(620px 250px at 100% 0%, rgb(52 226 145 / .12), transparent 66%),
    radial-gradient(480px 260px at 0% 100%, rgb(31 83 118 / .10), transparent 68%),
    linear-gradient(160deg, #0b1825, #07111b) !important;
  box-shadow: 0 22px 62px rgb(0 0 0 / .34) !important;
}

.player-cinematic-hero h1 {
  color: #f7fbff !important;
  font-weight: 800 !important;
  letter-spacing: -.045em !important;
}

.player-line-glance {
  border-color: #1d354a !important;
  background: rgb(5 12 19 / .62) !important;
}

.player-section-nav {
  border-color: #193047 !important;
  background: rgb(7 15 24 / .86) !important;
}

.player-section-nav button[aria-pressed="true"] {
  color: #07110c !important;
  background: #49ec9d !important;
  box-shadow: none !important;
}

.player-section-kicker,
.player-section-count {
  color: #57e9a5 !important;
}

.player-split-card[data-tone="pos"] {
  border-color: rgb(72 237 155 / .32) !important;
  background: rgb(72 237 155 / .055) !important;
}

main [data-best="true"] {
  border-color: rgb(72 237 155 / .44) !important;
  background: rgb(72 237 155 / .085) !important;
}

/* ---------- mobile bottom navigation ---------- */
nav[aria-label="Sections"] {
  inset-inline: 0 !important;
  bottom: 0 !important;
  border: 0 !important;
  border-top: 1px solid #17293a !important;
  border-radius: 0 !important;
  background: rgb(4 10 17 / .97) !important;
  box-shadow: 0 -10px 32px rgb(0 0 0 / .28) !important;
  backdrop-filter: blur(22px) !important;
}

nav[aria-label="Sections"] a {
  min-height: 58px !important;
  margin: 0 !important;
  border-radius: 0 !important;
}

nav[aria-label="Sections"] a[aria-current="page"] {
  color: #4dec9f !important;
  background: linear-gradient(180deg, rgb(72 237 155 / .07), transparent) !important;
}

footer {
  background: #03070d !important;
  border-color: #142537 !important;
}

@media (max-width: 767px) {
  header > div {
    height: 58px !important;
    padding-inline: 14px !important;
    gap: 12px !important;
  }

  .op-mark {
    display: none;
  }

  .op-wordmark {
    font-size: 18px !important;
  }

  header a[href="/board"] {
    min-height: 36px !important;
    padding-inline: 11px !important;
    border-radius: 9px !important;
  }

  main > div[class*="max-w-"] {
    padding-inline: 12px !important;
  }

  main .sticky.top-16 {
    top: 58px !important;
    margin-inline: -2px !important;
    padding: 9px !important;
    border-radius: 12px !important;
  }

  main .sticky.top-16 .rail {
    margin-inline: -2px;
    padding-bottom: 2px;
  }

  main .sticky.top-16 .rail button,
  main .sticky.top-16 > div:last-child > button {
    min-height: 36px !important;
    padding-inline: 12px !important;
  }

  main .face.prop-card-v2 {
    border-radius: 13px !important;
  }

  .prop-card-v2__open {
    padding: 12px 12px 9px !important;
  }

  .prop-card-v2__hit {
    padding-inline: 12px;
  }

  .prop-card-v2__quotes {
    padding: 0 12px 12px !important;
  }

  .player-cinematic-hero {
    border-radius: 16px !important;
    padding: 15px !important;
  }

  .player-identity-row {
    gap: 12px !important;
  }

  .player-line-glance {
    margin-top: 14px !important;
    padding: 12px !important;
  }

  footer {
    display: none;
  }
}

@media (min-width: 1024px) {
  main > div[class*="max-w-"] {
    max-width: 1380px !important;
  }

  main .face.prop-card-v2 {
    min-height: 100%;
  }
}

```

---

## FILE: apps/oblige-web/components/terminal-board.module.css

```css
.shell {
  min-height: calc(100vh - 56px);
  background:
    radial-gradient(900px 440px at 50% -160px, rgba(42, 97, 170, .16), transparent 70%),
    #080c14;
  color: #eaf0f8;
  padding: 0 0 calc(78px + env(safe-area-inset-bottom));
}

.terminal {
  width: min(1600px, 100%);
  margin: 0 auto;
  padding: 14px 16px 38px;
}

.terminalHeader {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 22px;
  padding: 6px 2px 16px;
}

.terminalEyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 7px;
  color: #61e8ad;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.terminalHeader h1 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: clamp(24px, 3vw, 38px);
  font-weight: 760;
  letter-spacing: -.045em;
}

.terminalHeader p {
  max-width: 680px;
  margin: 7px 0 0;
  color: #7f8da3;
  font-size: 12px;
}

.headerMetrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(86px, 1fr));
  gap: 7px;
  min-width: 300px;
}

.headerMetrics > div {
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 10px;
  background: rgba(255, 255, 255, .025);
  padding: 8px 10px;
}

.headerMetrics span,
.headerMetrics b {
  display: block;
}

.headerMetrics span {
  color: #657289;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.headerMetrics b {
  margin-top: 2px;
  font-family: var(--font-mono);
  color: #dbe4f1;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.headerMetrics b[data-live="true"] {
  color: #61e8ad;
}

.commandBar {
  position: sticky;
  top: 54px;
  z-index: 28;
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 13px;
  background: rgba(8, 12, 20, .92);
  box-shadow: 0 12px 36px rgba(0, 0, 0, .18);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.leagueRail,
.evRail {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: none;
}

.leagueRail::-webkit-scrollbar,
.evRail::-webkit-scrollbar {
  display: none;
}

.leagueRail button,
.evRail button {
  flex: none;
  height: 29px;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 7px;
  background: rgba(255, 255, 255, .025);
  color: #7e8ba1;
  padding: 0 10px;
  font-size: 10px;
  font-weight: 700;
  transition: border-color .16s ease, color .16s ease, background-color .16s ease, transform .16s ease;
}

.leagueRail button:active,
.evRail button:active {
  transform: scale(.97);
}

.leagueRail button:hover,
.evRail button:hover {
  color: #cfd9e7;
  border-color: rgba(255, 255, 255, .14);
}

.leagueRail button.active,
.evRail button.active {
  border-color: rgba(97, 232, 173, .35);
  background: rgba(97, 232, 173, .10);
  color: #7bf0bd;
}

.filterRow {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(150px, 220px) minmax(145px, 205px) auto;
  gap: 6px;
}

.searchBox,
.selectControl,
.slipButton {
  min-width: 0;
  height: 36px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 8px;
  background: rgba(255, 255, 255, .025);
  color: #dbe4ef;
}

.searchBox,
.selectControl {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}

.searchBox svg,
.selectControl svg {
  flex: none;
  color: #607088;
}

.searchBox input,
.selectControl select {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #dce5f0;
  font-size: 11px;
}

.searchBox input::placeholder {
  color: #536176;
}

.selectControl select {
  cursor: pointer;
}

.selectControl option {
  background: #0b1019;
  color: #e9eef6;
}

.slipButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  font-size: 11px;
  font-weight: 800;
}

.slipButton span {
  display: grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 999px;
  background: #61e8ad;
  color: #06110d;
  font-family: var(--font-mono);
  font-size: 9px;
}

.evRail {
  min-height: 29px;
}

.evRail > span:first-child {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  color: #617088;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.resultCount {
  margin-left: auto;
  flex: none;
  padding: 0 5px;
  color: #657289;
  font-family: var(--font-mono);
  font-size: 9px;
}

.matrixWrap {
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 12px;
  background: #0a0f18;
}

.matrix {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 10px;
}

.matrix thead {
  background: #0b111b;
}

.matrix th {
  height: 35px;
  padding: 0 8px;
  border-bottom: 1px solid rgba(255, 255, 255, .075);
  color: #5f6e84;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .08em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.matrix th:nth-child(1) { width: 22%; }
.matrix th:nth-child(2) { width: 10%; }
.matrix th:nth-child(3) { width: 5.5%; }
.matrix th:nth-child(4),
.matrix th:nth-child(5) { width: 10.5%; }
.matrix th:nth-child(6),
.matrix th:nth-child(7),
.matrix th:nth-child(8) { width: 5.5%; }
.matrix th:nth-child(9) { width: 7%; }
.matrix th:nth-child(10) { width: 6.5%; }
.matrix th:nth-child(11) { width: 2.5%; }

.matrix tbody tr {
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, .052);
  transition: background-color .14s ease, box-shadow .14s ease;
}

.matrix tbody tr:last-child {
  border-bottom: 0;
}

.matrix tbody tr:hover {
  background: rgba(92, 139, 201, .055);
  box-shadow: inset 2px 0 0 rgba(97, 232, 173, .55);
}

.matrix td {
  min-width: 0;
  height: 59px;
  padding: 6px 8px;
  color: #aeb9ca;
  vertical-align: middle;
}

.playerCell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.playerCell img {
  width: 37px;
  height: 37px;
  flex: none;
  border: 1px solid rgba(255, 255, 255, .10);
  border-radius: 8px;
  object-fit: cover;
  background: #111825;
}

.playerCell > span {
  min-width: 0;
}

.playerCell b,
.playerCell small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playerCell b {
  color: #e9eff7;
  font-size: 11px;
  font-weight: 700;
}

.playerCell small {
  margin-top: 3px;
  color: #59687f;
  font-size: 8px;
}

.marketCell {
  overflow: hidden;
  color: #95a3b7;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.numCell,
.rateCell,
.modelCell,
.evCell {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.numCell {
  color: #e3e9f2 !important;
  font-size: 11px;
  font-weight: 700;
}

.quoteButton,
.selectedQuote {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 2px;
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 7px;
  background: rgba(255, 255, 255, .024);
  padding: 5px 6px;
  text-align: left;
  transition: border-color .14s ease, background-color .14s ease, transform .14s ease;
}

.quoteButton:hover {
  border-color: rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .045);
}

.quoteButton:active,
.selectedQuote:active {
  transform: scale(.98);
}

.selectedQuote {
  border-color: rgba(97, 232, 173, .38);
  background: rgba(97, 232, 173, .095);
}

.quoteButton span,
.selectedQuote span {
  color: #d7e0ec;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
}

.selectedQuote span {
  color: #75edba;
}

.quoteButton small,
.selectedQuote small {
  min-width: 0;
  overflow: hidden;
  color: #536176;
  font-size: 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rateCell b,
.rateCell small,
.modelCell b,
.modelCell small,
.evCell b,
.evCell small {
  display: block;
}

.rateCell b {
  color: #a8b5c7;
  font-size: 10px;
}

.rateCell[data-high="true"] b {
  color: #63e7ad;
}

.rateCell small,
.modelCell small,
.evCell small {
  margin-top: 2px;
  color: #56657b;
  font-size: 7px;
  text-transform: uppercase;
}

.modelCell b {
  color: #d8e1ec;
  font-size: 10px;
}

.evCell b {
  color: #8795a9;
  font-size: 10px;
}

.evCell[data-positive="true"] b {
  color: #64e8ae;
}

.loadingDot,
.unavailable {
  color: #526177;
  font-family: var(--font-mono);
}

.rowChevron {
  color: #4f5d72;
}

.mobileRows {
  display: none;
}

.loadMoreWrap {
  display: grid;
  place-items: center;
  padding: 14px 0 0;
}

.loadMoreWrap button {
  height: 34px;
  border: 1px solid rgba(255, 255, 255, .09);
  border-radius: 8px;
  background: rgba(255, 255, 255, .03);
  color: #9dabbd;
  padding: 0 14px;
  font-size: 10px;
  font-weight: 700;
}

.drawerBackdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, .48);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.inspector,
.slipDrawer {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  width: min(540px, 94vw);
  height: 100%;
  flex-direction: column;
  overflow-y: auto;
  border-left: 1px solid rgba(255, 255, 255, .10);
  background: #090e17;
  box-shadow: -24px 0 60px rgba(0, 0, 0, .36);
  animation: drawerIn .22s cubic-bezier(.16, 1, .3, 1);
}

.slipDrawer {
  width: min(390px, 94vw);
}

@keyframes drawerIn {
  from { transform: translateX(34px); opacity: .5; }
  to { transform: translateX(0); opacity: 1; }
}

.drawerHeader {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  height: 52px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, .075);
  background: rgba(9, 14, 23, .95);
  padding: 0 15px;
  backdrop-filter: blur(14px);
}

.drawerHeader > span {
  color: #8d9aae;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.drawerHeader button {
  display: grid;
  width: 31px;
  height: 31px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 8px;
  background: rgba(255, 255, 255, .025);
  color: #8795a8;
}

.inspectorHero {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px 14px;
}

.inspectorHero img {
  width: 64px;
  height: 64px;
  flex: none;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 13px;
  object-fit: cover;
  background: #111825;
}

.inspectorHero > div {
  min-width: 0;
}

.inspectorHero span {
  color: #61e8ad;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.inspectorHero h2 {
  margin-top: 4px;
  color: #edf2f9;
  font-size: 21px;
  letter-spacing: -.035em;
}

.inspectorHero p {
  margin: 5px 0 0;
  color: #647389;
  font-size: 9px;
}

.inspectorLine {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  margin: 0 16px 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 10px;
  background: rgba(255, 255, 255, .075);
}

.inspectorLine > div {
  min-width: 0;
  background: #0c121d;
  padding: 9px;
}

.inspectorLine span,
.inspectorLine b {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspectorLine span {
  color: #5e6d83;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.inspectorLine b {
  margin-top: 3px;
  color: #dce4ee;
  font-family: var(--font-mono);
  font-size: 10px;
}

.inspectorLine b[data-positive="true"] {
  color: #61e8ad;
}

.drawerSection {
  padding: 13px 16px;
  border-top: 1px solid rgba(255, 255, 255, .065);
}

.sectionHeading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 9px;
}

.sectionHeading span {
  color: #c8d2df;
  font-size: 10px;
  font-weight: 800;
}

.sectionHeading small {
  color: #59677c;
  font-size: 8px;
}

.hitStrip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.hitStrip > div {
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 9px;
  background: rgba(255, 255, 255, .022);
  padding: 9px;
}

.hitStrip span,
.hitStrip b,
.hitStrip small {
  display: block;
}

.hitStrip span {
  color: #607088;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: .08em;
}

.hitStrip b {
  margin-top: 4px;
  color: #dce5ef;
  font-family: var(--font-mono);
  font-size: 17px;
}

.hitStrip small {
  margin-top: 3px;
  color: #526177;
  font-size: 7px;
}

.bookMatrix {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 9px;
}

.bookMatrixHead,
.bookMatrixRow {
  display: grid;
  grid-template-columns: 1.5fr .8fr .7fr .8fr;
  align-items: center;
  min-height: 32px;
  padding: 0 9px;
}

.bookMatrixHead {
  background: rgba(255, 255, 255, .028);
  color: #55647a;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.bookMatrixRow {
  border-top: 1px solid rgba(255, 255, 255, .05);
  color: #95a3b6;
  font-family: var(--font-mono);
  font-size: 8px;
}

.bookMatrixRow span:last-child {
  color: #d4deeb;
  font-weight: 700;
}

.drawerEmpty {
  margin: 0;
  padding: 16px;
  color: #607088;
  font-size: 9px;
}

.inspectorActions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 10px 16px 12px;
}

.inspectorActions button {
  display: grid;
  gap: 2px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 9px;
  background: rgba(255, 255, 255, .026);
  padding: 10px;
  text-align: left;
}

.inspectorActions button[data-selected="true"] {
  border-color: rgba(97, 232, 173, .38);
  background: rgba(97, 232, 173, .09);
}

.inspectorActions span,
.inspectorActions b,
.inspectorActions small {
  display: block;
}

.inspectorActions span {
  color: #617087;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.inspectorActions b {
  color: #d9e3ee;
  font-family: var(--font-mono);
  font-size: 13px;
}

.inspectorActions small {
  color: #526177;
  font-size: 7px;
}

.fullResearch {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0 16px 18px;
  border: 1px solid rgba(97, 232, 173, .25);
  border-radius: 9px;
  background: rgba(97, 232, 173, .08);
  color: #77eeba;
  font-size: 10px;
  font-weight: 800;
  text-decoration: none;
}

.slipIntro {
  display: flex;
  gap: 10px;
  margin: 12px 14px 4px;
  border: 1px solid rgba(90, 169, 255, .14);
  border-radius: 9px;
  background: rgba(90, 169, 255, .05);
  padding: 10px;
  color: #7e91a9;
}

.slipIntro svg {
  flex: none;
  margin-top: 1px;
  color: #6daeff;
}

.slipIntro p {
  margin: 0;
  font-size: 9px;
  line-height: 1.5;
}

.slipList {
  display: grid;
  gap: 6px;
  padding: 10px 14px;
}

.slipItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 9px;
  background: rgba(255, 255, 255, .024);
  padding: 10px;
}

.slipItem > div {
  min-width: 0;
}

.slipItem span,
.slipItem b,
.slipItem small {
  display: block;
}

.slipItem span {
  color: #61e8ad;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.slipItem b {
  margin-top: 3px;
  overflow: hidden;
  color: #dce5ef;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slipItem small {
  margin-top: 3px;
  color: #5c6a80;
  font-family: var(--font-mono);
  font-size: 8px;
}

.slipItem > button {
  display: grid;
  width: 29px;
  height: 29px;
  flex: none;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, .07);
  border-radius: 7px;
  background: transparent;
  color: #6b798e;
}

.slipEmpty {
  display: grid;
  justify-items: center;
  padding: 44px 18px;
  color: #607088;
  text-align: center;
}

.slipEmpty svg {
  margin-bottom: 9px;
}

.slipEmpty b {
  color: #9eabba;
  font-size: 11px;
}

.slipEmpty p {
  max-width: 28ch;
  margin: 6px 0 0;
  font-size: 9px;
  line-height: 1.55;
}

.clearSlip {
  height: 36px;
  margin: auto 14px 14px;
  border: 1px solid rgba(255, 255, 255, .08);
  border-radius: 8px;
  background: rgba(255, 255, 255, .025);
  color: #8795a8;
  font-size: 9px;
  font-weight: 800;
}

.statePanel,
.loadingEmbedded,
.loadingPage {
  display: grid;
  min-height: 260px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: #66758b;
  text-align: center;
}

.statePanel h2 {
  color: #b8c3d2;
  font-size: 15px;
}

.statePanel p,
.loadingEmbedded p,
.loadingPage p {
  margin: 0;
  color: #5f6d82;
  font-size: 10px;
}

.loadingPage {
  min-height: calc(100vh - 60px);
  background: #080c14;
}

.loadingBar {
  width: 150px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, .07);
}

.loadingBar::after {
  content: "";
  display: block;
  width: 45%;
  height: 100%;
  border-radius: inherit;
  background: #61e8ad;
  animation: loadingSweep 1s ease-in-out infinite alternate;
}

@keyframes loadingSweep {
  from { transform: translateX(-20%); }
  to { transform: translateX(140%); }
}

.signInShell {
  min-height: calc(100vh - 60px);
  background: #080c14;
  padding: 42px 16px 100px;
}

@media (max-width: 1100px) {
  .terminal {
    padding-inline: 10px;
  }

  .headerMetrics {
    min-width: 250px;
  }

  .matrix th:nth-child(1) { width: 23%; }
  .matrix th:nth-child(2) { width: 11%; }

  .matrix th:nth-child(6),
  .matrix th:nth-child(8) {
    display: none;
  }

  .matrix td:nth-child(6),
  .matrix td:nth-child(8) {
    display: none;
  }

  .matrix th:nth-child(7) { width: 7%; }
}

@media (max-width: 820px) {
  .shell {
    padding-bottom: calc(68px + env(safe-area-inset-bottom));
  }

  .terminal {
    padding: 7px 7px 28px;
  }

  .terminalHeader {
    align-items: center;
    padding: 4px 2px 9px;
  }

  .terminalHeader p {
    display: none;
  }

  .terminalHeader h1 {
    font-size: 20px;
  }

  .terminalEyebrow {
    margin-bottom: 4px;
    font-size: 8px;
  }

  .headerMetrics {
    grid-template-columns: repeat(2, auto);
    min-width: 0;
    gap: 4px;
  }

  .headerMetrics > div {
    min-width: 66px;
    padding: 6px 7px;
  }

  .headerMetrics > div:nth-child(3) {
    display: none;
  }

  .headerMetrics span {
    font-size: 7px;
  }

  .headerMetrics b {
    font-size: 8px;
  }

  .commandBar {
    top: 53px;
    gap: 5px;
    padding: 6px;
    border-radius: 9px;
  }

  .leagueRail button,
  .evRail button {
    height: 27px;
    padding-inline: 8px;
    font-size: 9px;
  }

  .filterRow {
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 5px;
  }

  .searchBox,
  .selectControl,
  .slipButton {
    height: 34px;
  }

  .searchBox {
    padding-inline: 8px;
  }

  .searchBox input {
    font-size: 10px;
  }

  .selectControl {
    width: 38px;
    padding: 0;
    justify-content: center;
  }

  .selectControl select {
    position: absolute;
    width: 38px;
    opacity: 0;
    cursor: pointer;
  }

  .selectControl:nth-of-type(3) {
    display: none;
  }

  .slipButton {
    padding-inline: 9px;
    font-size: 9px;
  }

  .slipButton > svg {
    display: none;
  }

  .evRail > span:first-child {
    display: none;
  }

  .resultCount {
    font-size: 8px;
  }

  .matrixWrap {
    display: none;
  }

  .mobileRows {
    display: grid;
    gap: 5px;
    margin-top: 6px;
  }

  .mobileRow {
    border: 1px solid rgba(255, 255, 255, .07);
    border-radius: 10px;
    background: #0a0f18;
    overflow: hidden;
  }

  .mobileIdentity {
    display: grid;
    width: 100%;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    padding: 8px;
    text-align: left;
  }

  .mobileIdentity img {
    width: 40px;
    height: 40px;
    border: 1px solid rgba(255, 255, 255, .09);
    border-radius: 8px;
    object-fit: cover;
    background: #121927;
  }

  .mobileIdentity > span {
    min-width: 0;
  }

  .mobileIdentity b,
  .mobileIdentity small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobileIdentity b {
    color: #e7edf6;
    font-size: 11px;
    font-weight: 750;
  }

  .mobileIdentity small {
    margin-top: 3px;
    color: #59687e;
    font-size: 8px;
  }

  .mobileEv {
    color: #61e8ad;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    white-space: nowrap;
  }

  .mobileMeta {
    display: flex;
    min-width: 0;
    gap: 4px;
    overflow-x: auto;
    padding: 0 8px 6px;
    scrollbar-width: none;
  }

  .mobileMeta::-webkit-scrollbar {
    display: none;
  }

  .mobileMeta span {
    flex: none;
    border: 1px solid rgba(255, 255, 255, .06);
    border-radius: 6px;
    background: rgba(255, 255, 255, .022);
    color: #647389;
    padding: 4px 6px;
    font-size: 7px;
  }

  .mobileMeta b {
    color: #aebaca;
    font-family: var(--font-mono);
  }

  .mobileQuotes {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 5px;
    border-top: 1px solid rgba(255, 255, 255, .055);
    padding: 6px 8px 8px;
  }

  .mobileQuotes > button {
    display: grid;
    gap: 1px;
    min-width: 0;
    min-height: 42px;
    align-content: center;
    border: 1px solid rgba(255, 255, 255, .07);
    border-radius: 7px;
    background: rgba(255, 255, 255, .024);
    padding: 5px 7px;
    text-align: left;
  }

  .mobileQuotes > button[data-selected="true"] {
    border-color: rgba(97, 232, 173, .38);
    background: rgba(97, 232, 173, .09);
  }

  .mobileQuotes span,
  .mobileQuotes b,
  .mobileQuotes small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mobileQuotes span {
    color: #65748a;
    font-size: 7px;
    font-weight: 800;
  }

  .mobileQuotes b {
    color: #dce5ef;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .mobileQuotes small {
    color: #526177;
    font-size: 7px;
  }

  .mobileQuotes .inspectButton {
    width: 48px;
    place-items: center;
    color: #77869b;
    padding: 0;
    text-align: center;
  }

  .inspectButton svg {
    margin: auto;
  }

  .inspectButton {
    font-size: 0;
  }

  .inspector,
  .slipDrawer {
    width: 100%;
    border-left: 0;
  }

  .inspectorLine {
    grid-template-columns: repeat(2, 1fr);
  }

  .bookMatrixHead,
  .bookMatrixRow {
    grid-template-columns: 1.4fr .8fr .7fr .8fr;
  }
}

@media (max-width: 470px) {
  .terminalHeader h1 {
    font-size: 18px;
  }

  .headerMetrics > div {
    min-width: 58px;
  }

  .leagueRail {
    margin-inline: -2px;
  }

  .filterRow {
    grid-template-columns: minmax(0, 1fr) 36px 54px;
  }

  .slipButton {
    padding-inline: 6px;
  }

  .slipButton span {
    min-width: 17px;
    height: 17px;
    font-size: 8px;
  }

  .evRail button {
    padding-inline: 7px;
  }

  .resultCount {
    display: none;
  }

  .mobileIdentity {
    grid-template-columns: 38px minmax(0, 1fr) auto;
  }

  .mobileIdentity img {
    width: 38px;
    height: 38px;
  }

  .mobileEv {
    font-size: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .inspector,
  .slipDrawer {
    animation: none;
  }

  .loadingBar::after {
    animation: none;
    width: 100%;
  }
}

```

---

## FILE: apps/oblige-web/components/terminal-board.tsx

```tsx
'use client';

import * as React from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronRight,
  CircleDollarSign,
  Layers3,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { BoardMeta, PropGroup, PropRow, Side } from '@/lib/types';
import {
  ApiError,
  artworkUrl,
  fetchAccount,
  fetchBoard,
  fetchResearch,
  windowOf,
} from '@/lib/api';
import { pctValue } from '@/lib/utils';
import { SignInPanel } from '@/components/sign-in';
import styles from './terminal-board.module.css';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
const INITIAL_ROWS = 40;
const LOAD_MORE_ROWS = 40;
const FALLBACK_REFRESH_MS = 60_000;
const STREAM_REFRESH_DEBOUNCE_MS = 450;
const ALL = 'ALL';

type FeedMode = 'connecting' | 'live' | 'fallback';

type ModelPrediction = {
  available?: boolean;
  projection?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
  probabilityPush?: number;
  engine?: string;
  code?: string;
  message?: string;
  generatedAt?: string;
  expiresAt?: string;
};

type RateWindow = {
  hits: number | null;
  sample: number | null;
  rate: number | null;
};

type ResearchSummary = {
  l5: RateWindow | null;
  l10: RateWindow | null;
  l20: RateWindow | null;
};

type MlTarget = {
  sport: string;
  eventId: string;
  playerId: string;
  playerName: string;
  marketId: string;
  sportsbookKey: string;
  gameStartTime: string;
  line: number;
  entityType: 'player';
  live: boolean;
  isAlternate: false;
};

type EvSelection = {
  side: Side;
  ev: number;
  probability: number;
  price: number;
  sportsbook: string;
};

type SlipSelection = {
  id: string;
  groupKey: string;
  player: string;
  market: string;
  line: number;
  side: Side;
  sportsbook: string;
  price: number | null;
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown) {
  return String(value || '').trim();
}

function numberOf(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceLabel(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number > 0 ? `+${number}` : String(number);
}

function timeLabel(value: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function quoteBook(row: PropRow | null | undefined) {
  return text(row?.sportsbook || row?.sportsbookKey) || 'Book unavailable';
}

function probability01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  if (number <= 1) return number;
  if (number <= 100) return number / 100;
  return null;
}

function americanDecimal(value: unknown) {
  const odds = Number(value);
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function evFor(group: PropGroup, prediction?: ModelPrediction): EvSelection | null {
  if (!prediction?.available) return null;

  const candidates: EvSelection[] = [];
  const add = (side: Side, probabilityRaw: unknown, quote: PropRow | null) => {
    const probability = probability01(probabilityRaw);
    const price = numberOf(quote?.price);
    const decimal = americanDecimal(price);
    if (probability === null || price === null || decimal === null) return;
    candidates.push({
      side,
      probability,
      price,
      sportsbook: quoteBook(quote),
      ev: (probability * decimal - 1) * 100,
    });
  };

  add('OVER', prediction.probabilityOver, group.bestOver);
  add('UNDER', prediction.probabilityUnder, group.bestUnder);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.ev - a.ev)[0];
}

function targetFor(group: PropGroup): MlTarget | null {
  const quote = group.bestOver || group.bestUnder || group.quotes[0];
  const eventId = text(quote?.eventId);
  const playerId = text(group.providerPlayerId);
  const marketId = text(group.marketId);
  const sportsbookKey = text(quote?.sportsbookKey || quote?.sportsbook);
  const gameStartTime = text(group.startsAt);
  if (!eventId || !playerId || !marketId || !sportsbookKey || !gameStartTime) return null;
  if (!Number.isFinite(Date.parse(gameStartTime))) return null;

  return {
    sport: group.sport,
    eventId,
    playerId,
    playerName: group.player,
    marketId,
    sportsbookKey,
    gameStartTime: new Date(gameStartTime).toISOString(),
    line: group.line,
    entityType: 'player',
    live: group.live,
    isAlternate: false,
  };
}

async function fetchPredictions(groups: PropGroup[], signal?: AbortSignal) {
  const output: Record<string, ModelPrediction> = {};
  const jobs = groups
    .map((group) => ({ group, target: targetFor(group) }))
    .filter((job): job is { group: PropGroup; target: MlTarget } => Boolean(job.target));

  for (const group of groups) {
    if (!targetFor(group)) {
      output[group.key] = {
        available: false,
        code: 'TARGET_UNVERIFIED',
        message: 'A verified model target is not available for this exact prop.',
      };
    }
  }

  if (!jobs.length) return output;

  const response = await fetch('/api/props/ml', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      props: jobs.map((job, index) => ({ ...job.target, key: String(index) })),
    }),
  });

  if (response.status === 401) throw new ApiError('Sign in to view model estimates.', 401, 'AUTH_REQUIRED');
  if (!response.ok) throw new ApiError('Model estimates are temporarily unavailable.', response.status, 'MODEL_FEED_UNAVAILABLE');

  const body = (await response.json()) as { ok?: boolean; results?: Record<string, ModelPrediction> };
  if (!body.ok || !body.results) {
    throw new ApiError('Model estimates are temporarily unavailable.', 502, 'MODEL_FEED_UNAVAILABLE');
  }

  jobs.forEach((job, index) => {
    output[job.group.key] = body.results?.[String(index)] || {
      available: false,
      code: 'MODEL_FEED_UNAVAILABLE',
      message: 'No verified model estimate is available for this prop.',
    };
  });

  return output;
}

function rateWindow(window: ReturnType<typeof windowOf>): RateWindow | null {
  if (!window) return null;
  const rate = pctValue(window.hitRate ?? null);
  const hits = finite(window.hits) ? window.hits : null;
  const sampleRaw = window.sampleSize ?? window.games;
  const sample = finite(sampleRaw) ? sampleRaw : null;
  if (rate === null && hits === null && sample === null) return null;
  return { rate, hits, sample };
}

function rateLabel(window: RateWindow | null | undefined) {
  if (window === undefined) return '…';
  if (!window || window.rate === null) return '—';
  return `${Math.round(window.rate)}%`;
}

function hitSample(window: RateWindow | null | undefined) {
  if (!window || !finite(window.hits) || !finite(window.sample)) return null;
  return `${window.hits}/${window.sample}`;
}

function selectionId(groupKey: string, side: Side) {
  return `${groupKey}|${side}`;
}

export function TerminalBoard() {
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [sport, setSport] = React.useState('NFL');
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [market, setMarket] = React.useState(ALL);
  const [book, setBook] = React.useState(ALL);
  const [evFloor, setEvFloor] = React.useState<number | null>(null);
  const [shown, setShown] = React.useState(INITIAL_ROWS);
  const [predictions, setPredictions] = React.useState<Record<string, ModelPrediction>>({});
  const [research, setResearch] = React.useState<Record<string, ResearchSummary | null>>({});
  const [feedMode, setFeedMode] = React.useState<FeedMode>('connecting');
  const [inspector, setInspector] = React.useState<PropGroup | null>(null);
  const [slip, setSlip] = React.useState<SlipSelection[]>([]);
  const [slipOpen, setSlipOpen] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (checking || !account) return;
    let cancelled = false;
    let activeController: AbortController | null = null;
    let stream: EventSource | null = null;
    let streamRefreshTimer: number | null = null;

    const load = async (initial: boolean) => {
      if (activeController) return;
      const controller = new AbortController();
      activeController = controller;
      if (initial) {
        setLoading(true);
        setError('');
      }

      try {
        const board = await fetchBoard(sport, controller.signal);
        if (cancelled) return;
        setGroups(board.groups);
        setMeta(board.meta);
        if (initial) {
          setMarket(ALL);
          setBook(ALL);
          setEvFloor(null);
          setShown(INITIAL_ROWS);
          setPredictions({});
          setResearch({});
          setInspector(null);
        }
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        if (initial) setError(cause instanceof Error ? cause.message : 'The live prop board is unavailable.');
      } finally {
        if (activeController === controller) activeController = null;
        if (!cancelled && initial) setLoading(false);
      }
    };

    const refreshQuietly = () => {
      if (streamRefreshTimer !== null) return;
      streamRefreshTimer = window.setTimeout(() => {
        streamRefreshTimer = null;
        if (!cancelled && document.visibilityState === 'visible') void load(false);
      }, STREAM_REFRESH_DEBOUNCE_MS);
    };

    setFeedMode('connecting');
    void load(true);

    if (typeof window.EventSource === 'function') {
      stream = new EventSource(`/api/apex/stream?sport=${encodeURIComponent(sport)}`);
      stream.onopen = () => {
        if (!cancelled) setFeedMode('live');
      };
      stream.addEventListener('ready', () => {
        if (!cancelled) setFeedMode('live');
      });
      stream.addEventListener('market', refreshQuietly);
      stream.addEventListener('resync', refreshQuietly);
      stream.onerror = () => {
        if (!cancelled) setFeedMode('fallback');
      };
    } else {
      setFeedMode('fallback');
    }

    const fallbackTick = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const interval = window.setInterval(fallbackTick, FALLBACK_REFRESH_MS);
    document.addEventListener('visibilitychange', fallbackTick);

    return () => {
      cancelled = true;
      activeController?.abort();
      stream?.close();
      if (streamRefreshTimer !== null) window.clearTimeout(streamRefreshTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', fallbackTick);
    };
  }, [checking, account, sport]);

  const markets = React.useMemo(
    () => [...new Set(groups.map((group) => group.market).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  const books = React.useMemo(() => {
    const names = new Set<string>();
    groups.forEach((group) => group.quotes.forEach((quote) => {
      const value = quoteBook(quote);
      if (value !== 'Book unavailable') names.add(value);
    }));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [groups]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();

    return groups
      .filter((group) => {
        if (market !== ALL && group.market !== market) return false;
        if (book !== ALL && !group.quotes.some((quote) => quoteBook(quote) === book)) return false;
        if (
          needle &&
          !`${group.player} ${group.market} ${group.matchup} ${group.team || ''} ${group.opponent || ''}`
            .toLowerCase()
            .includes(needle)
        ) return false;

        if (evFloor !== null) {
          const best = evFor(group, predictions[group.key]);
          if (!best || best.ev < evFloor) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const evA = evFor(a, predictions[a.key])?.ev ?? -Infinity;
        const evB = evFor(b, predictions[b.key])?.ev ?? -Infinity;
        if (evA !== evB) return evB - evA;
        const l10A = research[a.key]?.l10?.rate ?? -1;
        const l10B = research[b.key]?.l10?.rate ?? -1;
        return l10B - l10A || a.player.localeCompare(b.player);
      });
  }, [book, evFloor, groups, market, predictions, query, research]);

  const page = React.useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  const pageKey = page.map((group) => group.key).join('|');

  React.useEffect(() => {
    if (!account || !page.length) return;
    const missing = page.filter((group) => predictions[group.key] === undefined);
    if (!missing.length) return;

    const controller = new AbortController();
    void fetchPredictions(missing, controller.signal)
      .then((rows) => setPredictions((current) => ({ ...current, ...rows })))
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const queue = page.filter((group) => research[group.key] === undefined);
    if (!queue.length) return () => controller.abort();

    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift();
        if (!group) break;

        try {
          const row = await fetchResearch(group, 'OVER', controller.signal);
          const summary: ResearchSummary = {
            l5: rateWindow(windowOf(row, 'last5', 'l5', 'lastFive')),
            l10: rateWindow(windowOf(row, 'last10', 'l10', 'lastTen')),
            l20: rateWindow(windowOf(row, 'last20', 'l20', 'lastTwenty')),
          };
          if (!controller.signal.aborted) {
            setResearch((current) => ({ ...current, [group.key]: summary }));
          }
        } catch {
          if (!controller.signal.aborted) {
            setResearch((current) => ({ ...current, [group.key]: null }));
          }
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  const visibleBooks = React.useMemo(() => {
    if (!inspector) return [];
    return [...inspector.quotes].sort((a, b) => {
      const bookOrder = quoteBook(a).localeCompare(quoteBook(b));
      if (bookOrder) return bookOrder;
      return text(a.side).localeCompare(text(b.side));
    });
  }, [inspector]);

  const feedLabel = meta.stale
    ? 'cached'
    : feedMode === 'live'
      ? 'streaming'
      : feedMode === 'connecting'
        ? 'connecting'
        : 'fallback';

  const selectSide = React.useCallback((group: PropGroup, side: Side) => {
    const quote = side === 'OVER' ? group.bestOver : group.bestUnder;
    const id = selectionId(group.key, side);
    setSlip((current) => {
      if (current.some((item) => item.id === id)) return current.filter((item) => item.id !== id);
      return [
        ...current,
        {
          id,
          groupKey: group.key,
          player: group.player,
          market: group.market,
          line: group.line,
          side,
          sportsbook: quoteBook(quote),
          price: numberOf(quote?.price),
        },
      ].slice(-12);
    });
  }, []);

  if (checking) return <TerminalLoading />;

  if (!account) {
    return (
      <div className={styles.signInShell}>
        <SignInPanel onSignedIn={setAccount} />
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <section className={styles.terminal}>
        <header className={styles.terminalHeader}>
          <div>
            <div className={styles.terminalEyebrow}>
              <Sparkles size={13} aria-hidden="true" />
              Oblige Props v2
            </div>
            <h1>Research Terminal</h1>
            <p>Streaming prop research, multi-book prices, verified history and model context.</p>
          </div>

          <div className={styles.headerMetrics}>
            <div>
              <span>Feed</span>
              <b data-live={feedMode === 'live' && !meta.stale ? 'true' : 'false'}>{feedLabel}</b>
            </div>
            <div>
              <span>Props</span>
              <b>{groups.length.toLocaleString()}</b>
            </div>
            <div>
              <span>Books</span>
              <b>{(meta.sportsbookCount ?? books.length) || '—'}</b>
            </div>
          </div>
        </header>

        <div className={styles.commandBar}>
          <div className={styles.leagueRail} role="group" aria-label="League">
            {SPORTS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={sport === option}
                className={sport === option ? styles.active : ''}
                onClick={() => setSport(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <div className={styles.filterRow}>
            <label className={styles.searchBox}>
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search players, teams or markets</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search player / team / market"
              />
            </label>

            <label className={styles.selectControl}>
              <Activity size={14} aria-hidden="true" />
              <span className="sr-only">Market</span>
              <select value={market} onChange={(event) => setMarket(event.target.value)}>
                <option value={ALL}>All markets</option>
                {markets.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <label className={styles.selectControl}>
              <BookOpen size={14} aria-hidden="true" />
              <span className="sr-only">Sportsbook</span>
              <select value={book} onChange={(event) => setBook(event.target.value)}>
                <option value={ALL}>All books</option>
                {books.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>

            <button
              type="button"
              className={styles.slipButton}
              onClick={() => {
                setInspector(null);
                setSlipOpen(true);
              }}
            >
              <Layers3 size={15} aria-hidden="true" />
              Slip
              {slip.length ? <span>{slip.length}</span> : null}
            </button>
          </div>

          <div className={styles.evRail} role="group" aria-label="Minimum expected value">
            <span><SlidersHorizontal size={13} /> EV filter</span>
            {[
              { label: 'All', value: null },
              { label: '0%+', value: 0 },
              { label: '2%+', value: 2 },
              { label: '5%+', value: 5 },
              { label: '10%+', value: 10 },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={evFloor === option.value}
                className={evFloor === option.value ? styles.active : ''}
                onClick={() => setEvFloor(option.value)}
              >
                {option.label}
              </button>
            ))}
            <span className={styles.resultCount}>{filtered.length.toLocaleString()} matching</span>
          </div>
        </div>

        {error ? (
          <div className={styles.statePanel}>
            <Activity size={24} />
            <h2>Prop stream unavailable</h2>
            <p>{error}</p>
          </div>
        ) : loading && !groups.length ? (
          <TerminalLoading embedded />
        ) : !filtered.length ? (
          <div className={styles.statePanel}>
            <Search size={24} />
            <h2>No props match this view</h2>
            <p>Change the league, book, market, EV threshold, or search text.</p>
          </div>
        ) : (
          <>
            <DesktopMatrix
              rows={page}
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={(group) => {
                setSlipOpen(false);
                setInspector(group);
              }}
              onSelect={selectSide}
            />
            <MobileMatrix
              rows={page}
              predictions={predictions}
              research={research}
              slip={slip}
              onInspect={(group) => {
                setSlipOpen(false);
                setInspector(group);
              }}
              onSelect={selectSide}
            />

            {shown < filtered.length ? (
              <div className={styles.loadMoreWrap}>
                <button type="button" onClick={() => setShown((value) => value + LOAD_MORE_ROWS)}>
                  Load {Math.min(LOAD_MORE_ROWS, filtered.length - shown)} more
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {inspector ? (
        <Inspector
          group={inspector}
          prediction={predictions[inspector.key]}
          research={research[inspector.key]}
          quotes={visibleBooks}
          slip={slip}
          onClose={() => setInspector(null)}
          onSelect={selectSide}
        />
      ) : null}

      {slipOpen ? (
        <SlipDrawer
          selections={slip}
          onClose={() => setSlipOpen(false)}
          onRemove={(id) => setSlip((current) => current.filter((item) => item.id !== id))}
          onClear={() => setSlip([])}
        />
      ) : null}
    </div>
  );
}

function DesktopMatrix({
  rows,
  predictions,
  research,
  slip,
  onInspect,
  onSelect,
}: {
  rows: PropGroup[];
  predictions: Record<string, ModelPrediction>;
  research: Record<string, ResearchSummary | null>;
  slip: SlipSelection[];
  onInspect: (group: PropGroup) => void;
  onSelect: (group: PropGroup, side: Side) => void;
}) {
  return (
    <div className={styles.matrixWrap}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th className={styles.playerColumn}>Player / game</th>
            <th>Market</th>
            <th>Line</th>
            <th>Best over</th>
            <th>Best under</th>
            <th>L5</th>
            <th>L10</th>
            <th>L20</th>
            <th>Model</th>
            <th>EV</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((group) => {
            const prediction = predictions[group.key];
            const summary = research[group.key];
            const bestEv = evFor(group, prediction);
            const projection = prediction?.available && finite(prediction.projection) ? prediction.projection : null;
            const overSelected = slip.some((item) => item.id === selectionId(group.key, 'OVER'));
            const underSelected = slip.some((item) => item.id === selectionId(group.key, 'UNDER'));

            return (
              <tr key={group.key} onClick={() => onInspect(group)}>
                <td className={styles.playerCell}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
                    alt=""
                    onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
                  />
                  <span>
                    <b>{group.player}</b>
                    <small>{group.matchup} · {timeLabel(group.startsAt)}</small>
                  </span>
                </td>
                <td className={styles.marketCell}>{group.market}</td>
                <td className={styles.numCell}>{group.line}</td>
                <td>
                  <button
                    type="button"
                    className={overSelected ? styles.selectedQuote : styles.quoteButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(group, 'OVER');
                    }}
                  >
                    <span>O {priceLabel(group.bestOver?.price)}</span>
                    <small>{quoteBook(group.bestOver)}</small>
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className={underSelected ? styles.selectedQuote : styles.quoteButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(group, 'UNDER');
                    }}
                  >
                    <span>U {priceLabel(group.bestUnder?.price)}</span>
                    <small>{quoteBook(group.bestUnder)}</small>
                  </button>
                </td>
                <RateCell window={summary === undefined ? undefined : summary?.l5 ?? null} />
                <RateCell window={summary === undefined ? undefined : summary?.l10 ?? null} />
                <RateCell window={summary === undefined ? undefined : summary?.l20 ?? null} />
                <td className={styles.modelCell}>
                  {prediction === undefined ? (
                    <span className={styles.loadingDot}>…</span>
                  ) : projection !== null ? (
                    <>
                      <b>{projection.toFixed(1)}</b>
                      <small>{projection > group.line ? 'OVER lean' : projection < group.line ? 'UNDER lean' : 'at line'}</small>
                    </>
                  ) : (
                    <span className={styles.unavailable}>—</span>
                  )}
                </td>
                <td className={styles.evCell} data-positive={bestEv && bestEv.ev > 0 ? 'true' : 'false'}>
                  {bestEv ? (
                    <>
                      <b>{bestEv.ev >= 0 ? '+' : ''}{bestEv.ev.toFixed(1)}%</b>
                      <small>{bestEv.side}</small>
                    </>
                  ) : (
                    <span className={styles.unavailable}>—</span>
                  )}
                </td>
                <td><ChevronRight size={16} className={styles.rowChevron} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MobileMatrix({
  rows,
  predictions,
  research,
  slip,
  onInspect,
  onSelect,
}: {
  rows: PropGroup[];
  predictions: Record<string, ModelPrediction>;
  research: Record<string, ResearchSummary | null>;
  slip: SlipSelection[];
  onInspect: (group: PropGroup) => void;
  onSelect: (group: PropGroup, side: Side) => void;
}) {
  return (
    <div className={styles.mobileRows}>
      {rows.map((group) => {
        const prediction = predictions[group.key];
        const summary = research[group.key];
        const bestEv = evFor(group, prediction);
        const overSelected = slip.some((item) => item.id === selectionId(group.key, 'OVER'));
        const underSelected = slip.some((item) => item.id === selectionId(group.key, 'UNDER'));

        return (
          <article key={group.key} className={styles.mobileRow}>
            <button type="button" className={styles.mobileIdentity} onClick={() => onInspect(group)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
                alt=""
                onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
              />
              <span>
                <b>{group.player}</b>
                <small>{group.matchup}</small>
              </span>
              <span className={styles.mobileEv}>
                {bestEv ? `${bestEv.ev >= 0 ? '+' : ''}${bestEv.ev.toFixed(1)}% EV` : 'EV —'}
              </span>
            </button>

            <div className={styles.mobileMeta}>
              <span><b>{group.line}</b> {group.market}</span>
              <span>L5 <b>{rateLabel(summary === undefined ? undefined : summary?.l5 ?? null)}</b></span>
              <span>L10 <b>{rateLabel(summary === undefined ? undefined : summary?.l10 ?? null)}</b></span>
              <span>L20 <b>{rateLabel(summary === undefined ? undefined : summary?.l20 ?? null)}</b></span>
            </div>

            <div className={styles.mobileQuotes}>
              <button
                type="button"
                data-selected={overSelected ? 'true' : 'false'}
                onClick={() => onSelect(group, 'OVER')}
              >
                <span>OVER</span>
                <b>{priceLabel(group.bestOver?.price)}</b>
                <small>{quoteBook(group.bestOver)}</small>
              </button>
              <button
                type="button"
                data-selected={underSelected ? 'true' : 'false'}
                onClick={() => onSelect(group, 'UNDER')}
              >
                <span>UNDER</span>
                <b>{priceLabel(group.bestUnder?.price)}</b>
                <small>{quoteBook(group.bestUnder)}</small>
              </button>
              <button type="button" className={styles.inspectButton} onClick={() => onInspect(group)}>
                <BarChart3 size={15} />
                Inspect
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function RateCell({ window }: { window: RateWindow | null | undefined }) {
  const sample = hitSample(window);
  return (
    <td className={styles.rateCell} data-high={window?.rate !== null && window?.rate !== undefined && window.rate >= 60 ? 'true' : 'false'}>
      <b>{rateLabel(window)}</b>
      {sample ? <small>{sample}</small> : null}
    </td>
  );
}

function Inspector({
  group,
  prediction,
  research,
  quotes,
  slip,
  onClose,
  onSelect,
}: {
  group: PropGroup;
  prediction?: ModelPrediction;
  research?: ResearchSummary | null;
  quotes: PropRow[];
  slip: SlipSelection[];
  onClose: () => void;
  onSelect: (group: PropGroup, side: Side) => void;
}) {
  const ev = evFor(group, prediction);
  const projection = prediction?.available && finite(prediction.projection) ? prediction.projection : null;

  return (
    <div className={styles.drawerBackdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className={styles.inspector} aria-label="Player inspector">
        <div className={styles.drawerHeader}>
          <span>Player inspector</span>
          <button type="button" aria-label="Close inspector" onClick={onClose}><X size={18} /></button>
        </div>

        <div className={styles.inspectorHero}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
            alt=""
            onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
          />
          <div>
            <span>{group.sport} · {group.team || 'Team unavailable'}</span>
            <h2>{group.player}</h2>
            <p>{group.matchup} · {timeLabel(group.startsAt)}</p>
          </div>
        </div>

        <div className={styles.inspectorLine}>
          <div><span>Market</span><b>{group.market}</b></div>
          <div><span>Line</span><b>{group.line}</b></div>
          <div><span>Model</span><b>{projection !== null ? projection.toFixed(1) : '—'}</b></div>
          <div><span>Best EV</span><b data-positive={ev && ev.ev > 0 ? 'true' : 'false'}>{ev ? `${ev.ev >= 0 ? '+' : ''}${ev.ev.toFixed(1)}%` : '—'}</b></div>
        </div>

        <section className={styles.drawerSection}>
          <div className={styles.sectionHeading}>
            <span>Hit-rate windows</span>
            <small>verified game log</small>
          </div>
          <div className={styles.hitStrip}>
            {[
              { label: 'L5', window: research === undefined ? undefined : research?.l5 ?? null },
              { label: 'L10', window: research === undefined ? undefined : research?.l10 ?? null },
              { label: 'L20', window: research === undefined ? undefined : research?.l20 ?? null },
            ].map(({ label, window }) => (
              <div key={label}>
                <span>{label}</span>
                <b>{rateLabel(window)}</b>
                <small>{hitSample(window) || 'sample unavailable'}</small>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.drawerSection}>
          <div className={styles.sectionHeading}>
            <span>Multi-book matrix</span>
            <small>{new Set(quotes.map((quote) => quoteBook(quote))).size} books</small>
          </div>

          <div className={styles.bookMatrix}>
            <div className={styles.bookMatrixHead}>
              <span>Book</span><span>Side</span><span>Line</span><span>Price</span>
            </div>
            {quotes.length ? quotes.map((quote, index) => (
              <div key={`${quoteBook(quote)}-${quote.side}-${quote.line}-${index}`} className={styles.bookMatrixRow}>
                <span>{quoteBook(quote)}</span>
                <span>{text(quote.side).toUpperCase() || '—'}</span>
                <span>{numberOf(quote.line) ?? group.line}</span>
                <span>{priceLabel(quote.price)}</span>
              </div>
            )) : <p className={styles.drawerEmpty}>No verified book matrix is available for this line.</p>}
          </div>
        </section>

        <div className={styles.inspectorActions}>
          <button
            type="button"
            data-selected={slip.some((item) => item.id === selectionId(group.key, 'OVER')) ? 'true' : 'false'}
            onClick={() => onSelect(group, 'OVER')}
          >
            <span>Best over</span>
            <b>{priceLabel(group.bestOver?.price)}</b>
            <small>{quoteBook(group.bestOver)}</small>
          </button>
          <button
            type="button"
            data-selected={slip.some((item) => item.id === selectionId(group.key, 'UNDER')) ? 'true' : 'false'}
            onClick={() => onSelect(group, 'UNDER')}
          >
            <span>Best under</span>
            <b>{priceLabel(group.bestUnder?.price)}</b>
            <small>{quoteBook(group.bestUnder)}</small>
          </button>
        </div>

        <a
          className={styles.fullResearch}
          href={`/research?${new URLSearchParams({
            sport: group.sport,
            player: group.player,
            market: group.market,
            line: String(group.line),
          })}`}
        >
          Open full player research
          <ChevronRight size={16} />
        </a>
      </aside>
    </div>
  );
}

function SlipDrawer({
  selections,
  onClose,
  onRemove,
  onClear,
}: {
  selections: SlipSelection[];
  onClose: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className={styles.drawerBackdrop} onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className={styles.slipDrawer} aria-label="Research slip">
        <div className={styles.drawerHeader}>
          <span>Research slip · {selections.length}</span>
          <button type="button" aria-label="Close slip" onClick={onClose}><X size={18} /></button>
        </div>

        <div className={styles.slipIntro}>
          <Zap size={17} />
          <p>Keep lines you want to compare together. This is a research list, not a wager placement screen.</p>
        </div>

        <div className={styles.slipList}>
          {selections.length ? selections.map((item) => (
            <article key={item.id} className={styles.slipItem}>
              <div>
                <span>{item.side} · {item.sportsbook}</span>
                <b>{item.player}</b>
                <small>{item.market} · {item.line} · {priceLabel(item.price)}</small>
              </div>
              <button type="button" aria-label={`Remove ${item.player}`} onClick={() => onRemove(item.id)}>
                <X size={15} />
              </button>
            </article>
          )) : (
            <div className={styles.slipEmpty}>
              <CircleDollarSign size={24} />
              <b>No research selections yet</b>
              <p>Tap an Over or Under price in the terminal to add it here.</p>
            </div>
          )}
        </div>

        {selections.length ? (
          <button type="button" className={styles.clearSlip} onClick={onClear}>Clear research slip</button>
        ) : null}
      </aside>
    </div>
  );
}

function TerminalLoading({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={embedded ? styles.loadingEmbedded : styles.loadingPage}>
      <div className={styles.loadingBar} />
      <p>Opening Oblige Props v2 terminal…</p>
    </div>
  );
}

```

---

## FILE: apps/oblige-web/components/bethoops-board.module.css

```css
/*
 * Visual structure adapted from BetHoopsXG (MIT License, Copyright 2024 Tony Mao).
 * Original notice is preserved in ../NOTICE-BetHoopsXG.txt.
 */

.pageShell {
  min-height: calc(100vh - 4rem);
  padding: 1.5rem 1rem 4rem;
  background:
    radial-gradient(circle at 8% 4%, rgba(99, 102, 241, 0.10), transparent 34rem),
    radial-gradient(circle at 92% 8%, rgba(192, 132, 252, 0.08), transparent 28rem),
    linear-gradient(135deg, #0f172a 0%, #151935 48%, #1e1b4b 100%);
}

.signInShell {
  min-height: calc(100vh - 4rem);
  padding: 2rem 1rem 5rem;
  background: linear-gradient(135deg, #0f172a, #1e1b4b);
}

.appContainer {
  width: min(100%, 1240px);
  margin: 0 auto;
  color: #f8fafc;
  --card-bg: rgba(255, 255, 255, 0.05);
  --card-border: rgba(255, 255, 255, 0.10);
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --accent-color: #6366f1;
  --accent-hover: #818cf8;
  --over-color: #10b981;
  --under-color: #ef4444;
  --over-bg: rgba(16, 185, 129, 0.10);
  --under-bg: rgba(239, 68, 68, 0.10);
}

.appHeader {
  text-align: center;
  margin-bottom: 2rem;
  animation: fadeInDown .55s ease-out both;
}

.eyebrow {
  margin: 0 0 .4rem;
  color: #a5b4fc;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .13em;
  text-transform: uppercase;
}

.appTitle {
  margin: 0 0 .35rem;
  font-size: clamp(2.35rem, 7vw, 3.25rem);
  line-height: .95;
  font-weight: 800;
  letter-spacing: -.055em;
  background: linear-gradient(90deg, #818cf8, #c084fc);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.appSubtitle {
  max-width: 650px;
  margin: 0 auto;
  color: var(--text-muted);
  font-size: .98rem;
  line-height: 1.55;
}

.tabBar {
  display: flex;
  justify-content: center;
  gap: .5rem;
  margin-top: 1.25rem;
}

.tabBtn,
.statBtn {
  border: 1px solid var(--card-border);
  color: var(--text-muted);
  cursor: pointer;
  transition: transform .2s ease, color .2s ease, background .2s ease, border-color .2s ease, box-shadow .2s ease;
}

.tabBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .42rem;
  min-height: 40px;
  padding: .55rem 1.1rem;
  border-radius: 999px;
  background: rgba(15, 23, 42, .45);
  font-size: .86rem;
  font-weight: 600;
}

.tabBtn:hover,
.statBtn:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, .08);
  transform: translateY(-1px);
}

.active {
  background: var(--accent-color) !important;
  border-color: var(--accent-hover) !important;
  color: #fff !important;
  box-shadow: 0 0 15px rgba(99, 102, 241, .35);
}

.controlStack {
  display: grid;
  gap: .85rem;
  margin-bottom: 1.1rem;
}

.rail {
  display: flex;
  gap: .55rem;
  overflow-x: auto;
  padding: .1rem .05rem .25rem;
  scrollbar-width: none;
}

.rail::-webkit-scrollbar { display: none; }

.statBtn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  min-height: 38px;
  padding: .55rem .95rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, .045);
  backdrop-filter: blur(10px);
  color: #cbd5e1;
  font-size: .78rem;
  font-weight: 600;
  white-space: nowrap;
}

.searchRow {
  display: flex;
  align-items: center;
  gap: .75rem;
}

.searchField {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: .65rem;
  min-height: 44px;
  padding: 0 .9rem;
  border: 1px solid var(--card-border);
  border-radius: .85rem;
  background: rgba(0, 0, 0, .17);
  color: #94a3b8;
  backdrop-filter: blur(10px);
}

.searchField input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #f8fafc;
  font: inherit;
  font-size: .88rem;
}

.searchField input::placeholder { color: #64748b; }

.feedStatus {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: .45rem;
  min-height: 40px;
  padding: 0 .75rem;
  border: 1px solid rgba(16,185,129,.18);
  border-radius: 999px;
  background: rgba(16,185,129,.07);
  color: #6ee7b7;
  font-size: .73rem;
  font-weight: 700;
}

.feedStatus > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 9px rgba(52,211,153,.7);
}

.feedStatus[data-stale='true'] {
  border-color: rgba(245,158,11,.2);
  background: rgba(245,158,11,.08);
  color: #fbbf24;
}

.feedStatus[data-stale='true'] > span {
  background: #f59e0b;
  box-shadow: 0 0 9px rgba(245,158,11,.55);
}

.glassPanel {
  padding: clamp(1rem, 3vw, 1.65rem);
  border: 1px solid var(--card-border);
  border-radius: 1.25rem;
  background: rgba(255,255,255,.045);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.42);
  animation: slideUp .5s ease-out both;
}

.panelHeading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.1rem;
}

.panelHeading h2 {
  margin: .18rem 0 0;
  color: #fff;
  font-size: clamp(1.05rem, 3vw, 1.35rem);
  font-weight: 700;
  letter-spacing: -.02em;
}

.panelKicker {
  color: #818cf8;
  font-size: .69rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.panelMeta {
  color: #94a3b8;
  font-size: .76rem;
  font-weight: 600;
}

.predictionsGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(285px, 1fr));
  gap: 1rem;
}

.predictionCard {
  position: relative;
  overflow: hidden;
  min-width: 0;
  padding: 1.15rem;
  border: 1px solid var(--card-border);
  border-radius: 1rem;
  background: rgba(0,0,0,.22);
  transition: transform .22s ease, box-shadow .22s ease, background .22s ease, border-color .22s ease;
}

.predictionCard:hover {
  transform: translateY(-3px);
  border-color: rgba(129,140,248,.34);
  background: rgba(255,255,255,.055);
  box-shadow: 0 14px 30px rgba(0,0,0,.28);
}

.recommendationBadge {
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: .18rem;
  padding: .48rem .75rem;
  border-left: 1px solid var(--card-border);
  border-bottom: 1px solid var(--card-border);
  border-bottom-left-radius: .85rem;
  font-size: .68rem;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.recommendationOver {
  background: var(--over-bg);
  color: var(--over-color);
}

.recommendationUnder {
  background: var(--under-bg);
  color: #f87171;
}

.recommendationNeutral {
  background: rgba(148,163,184,.08);
  color: #94a3b8;
}

.cardHeader {
  padding-right: 4.6rem;
  margin-bottom: .85rem;
}

.playerIdentity {
  display: flex;
  align-items: center;
  gap: .75rem;
  min-width: 0;
}

.playerAvatar {
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 14px;
  object-fit: cover;
  object-position: center top;
  background: rgba(255,255,255,.04);
}

.playerIdentity > div { min-width: 0; }

.playerName {
  margin: 0;
  overflow: hidden;
  color: #fff;
  font-size: 1rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.matchupBadge {
  display: block;
  max-width: 100%;
  margin-top: .2rem;
  overflow: hidden;
  color: #94a3b8;
  font-size: .73rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statsRow {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-top: .85rem;
  padding-top: .85rem;
  border-top: 1px solid var(--card-border);
}

.statBlock {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.alignRight { text-align: right; align-items: flex-end; }

.statLabel {
  margin-bottom: .18rem;
  color: #94a3b8;
  font-size: .68rem;
  line-height: 1.2;
}

.statValue {
  color: #fff;
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -.03em;
}

.statValue[data-tone='over'] { color: var(--over-color); }
.statValue[data-tone='under'] { color: #f87171; }
.statValue[data-tone='neutral'] { color: #cbd5e1; font-size: .84rem; letter-spacing: 0; }

.contextGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .5rem;
  margin-top: .9rem;
}

.contextGrid span {
  display: flex;
  align-items: center;
  gap: .35rem;
  min-width: 0;
  padding: .48rem .55rem;
  border: 1px solid rgba(255,255,255,.07);
  border-radius: .65rem;
  background: rgba(255,255,255,.035);
  color: #b6c0cf;
  font-size: .69rem;
  font-weight: 600;
}

.quoteRow {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .5rem;
  margin-top: .5rem;
}

.quoteRow span {
  padding: .5rem .6rem;
  border-radius: .62rem;
  background: rgba(15,23,42,.56);
  color: #cbd5e1;
  font-size: .72rem;
}

.quoteRow span:first-child b { color: #34d399; }
.quoteRow span:last-child b { color: #f87171; }

.cardFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .8rem;
  margin-top: .85rem;
  padding-top: .75rem;
  border-top: 1px solid rgba(255,255,255,.06);
}

.cardFooter > span {
  min-width: 0;
  overflow: hidden;
  color: #64748b;
  font-size: .67rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cardFooter button,
.tableAction {
  flex: 0 0 auto;
  border: 0;
  border-radius: .6rem;
  background: rgba(99,102,241,.14);
  color: #a5b4fc;
  cursor: pointer;
  font: inherit;
  font-size: .7rem;
  font-weight: 700;
  transition: background .2s ease, color .2s ease;
}

.cardFooter button { padding: .45rem .62rem; }
.cardFooter button:hover,
.tableAction:hover { background: #6366f1; color: #fff; }

.loadingContainer {
  display: flex;
  min-height: 260px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  text-align: center;
}

.spinner {
  width: 44px;
  height: 44px;
  margin-bottom: .8rem;
  border: 3px solid rgba(255,255,255,.1);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin .9s linear infinite;
}

.emptyState,
.errorMessage {
  display: grid;
  justify-items: center;
  gap: .45rem;
  padding: 2.5rem 1rem;
  border-radius: 1rem;
  text-align: center;
}

.emptyState {
  color: #94a3b8;
  background: rgba(255,255,255,.025);
  border: 1px dashed rgba(255,255,255,.10);
}

.errorMessage {
  color: #fca5a5;
  background: rgba(239,68,68,.08);
  border: 1px solid rgba(239,68,68,.20);
}

.emptyState h3,
.errorMessage h2 { margin: 0; color: #f8fafc; }
.emptyState p,
.errorMessage p { margin: 0; max-width: 55ch; }

.performanceNotice {
  margin-bottom: 1rem;
  padding: .75rem .85rem;
  border: 1px solid rgba(99,102,241,.18);
  border-radius: .75rem;
  background: rgba(99,102,241,.07);
  color: #aeb8ff;
  font-size: .76rem;
  line-height: 1.5;
}

.historySummary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: .75rem;
  margin-bottom: 1rem;
}

.summaryCard {
  display: flex;
  align-items: center;
  gap: .75rem;
  padding: .9rem;
  border: 1px solid var(--card-border);
  border-radius: .85rem;
  background: rgba(0,0,0,.22);
}

.summaryCard > div { display: flex; flex-direction: column; }

.summaryNumber {
  font-size: 1.4rem;
  font-weight: 800;
  line-height: 1;
}

.summaryLabel {
  margin-top: .24rem;
  color: #94a3b8;
  font-size: .63rem;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.summaryWins { color: #34d399; }
.summaryLosses { color: #f87171; }
.summaryRate { color: #a5b4fc; }

.historyTableWrapper {
  overflow-x: auto;
  border: 1px solid var(--card-border);
  border-radius: .85rem;
}

.historyTable {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  color: #cbd5e1;
  font-size: .76rem;
}

.historyTable th {
  padding: .68rem .78rem;
  border-bottom: 1px solid var(--card-border);
  background: rgba(0,0,0,.28);
  color: #7f8da2;
  font-size: .63rem;
  font-weight: 700;
  letter-spacing: .05em;
  text-align: left;
  text-transform: uppercase;
}

.historyTable td {
  padding: .68rem .78rem;
  border-bottom: 1px solid rgba(255,255,255,.045);
  white-space: nowrap;
}

.historyTable tr:last-child td { border-bottom: 0; }
.historyTable tbody tr:hover { background: rgba(255,255,255,.025); }

.cellPlayer {
  color: #fff;
  font-weight: 700;
}

.cellPlayer small {
  display: block;
  max-width: 210px;
  margin-top: .12rem;
  overflow: hidden;
  color: #64748b;
  font-size: .62rem;
  font-weight: 500;
  text-overflow: ellipsis;
}

.historyTable [data-lean='over'] { color: #34d399; font-weight: 700; }
.historyTable [data-lean='under'] { color: #f87171; font-weight: 700; }
.historyTable [data-lean='even'] { color: #94a3b8; font-weight: 700; }

.tableAction { padding: .38rem .55rem; }

@media (max-width: 720px) {
  .pageShell { padding: 1rem .65rem 5rem; }
  .appHeader { margin-bottom: 1.35rem; }
  .appSubtitle { padding-inline: .5rem; font-size: .88rem; }
  .searchRow { align-items: stretch; }
  .feedStatus { padding-inline: .6rem; font-size: .66rem; }
  .predictionsGrid { grid-template-columns: 1fr; gap: .75rem; }
  .predictionCard { padding: .95rem; }
  .historySummary { grid-template-columns: 1fr; }
  .panelHeading { align-items: start; }
}

@media (max-width: 480px) {
  .tabBar { display: grid; grid-template-columns: 1fr 1fr; }
  .tabBtn { width: 100%; padding-inline: .7rem; }
  .feedStatus { display: none; }
  .glassPanel { padding: .75rem; border-radius: 1rem; }
  .playerAvatar { width: 44px; height: 44px; }
  .contextGrid { grid-template-columns: 1fr; }
  .cardFooter { align-items: end; }
}

@media (prefers-reduced-motion: reduce) {
  .appHeader,
  .glassPanel,
  .spinner { animation: none !important; }
  .predictionCard,
  .tabBtn,
  .statBtn { transition: none !important; }
}

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeInDown { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }

```

---

## FILE: apps/oblige-web/components/bethoops-board.tsx

```tsx
'use client';

/*
 * UI structure adapted from the MIT-licensed BetHoopsXG project by Tony Mao.
 * See ../NOTICE-BetHoopsXG.txt for the preserved license notice.
 * Data, authentication, billing, research, and model contracts remain ObligeProps-owned.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Search,
  Target,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import type { BoardMeta, PropGroup } from '@/lib/types';
import {
  ApiError,
  artworkUrl,
  fetchAccount,
  fetchBoard,
  fetchResearch,
  windowOf,
} from '@/lib/api';
import { pctValue } from '@/lib/utils';
import { SignInPanel } from '@/components/sign-in';
import styles from './bethoops-board.module.css';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
const PAGE_SIZE = 24;
const FALLBACK_REFRESH_MS = 60_000;
const STREAM_REFRESH_DEBOUNCE_MS = 500;
const ALL = 'ALL';

type Tab = 'predictions' | 'history';
type FeedMode = 'connecting' | 'live' | 'fallback';

type ModelPrediction = {
  available?: boolean;
  projection?: number;
  probabilityOver?: number;
  probabilityUnder?: number;
  probabilityPush?: number;
  engine?: string;
  code?: string;
  message?: string;
  generatedAt?: string;
  expiresAt?: string;
  validation?: {
    observations?: number;
    events?: number;
  };
};

type ResearchSummary = {
  hits: number | null;
  sample: number | null;
  rate: number | null;
};

type MlTarget = {
  sport: string;
  eventId: string;
  playerId: string;
  playerName: string;
  marketId: string;
  sportsbookKey: string;
  gameStartTime: string;
  line: number;
  entityType: 'player';
  live: boolean;
  isAlternate: false;
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown) {
  return String(value || '').trim();
}

function price(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number > 0 ? `+${number}` : String(number);
}

function timeLabel(value: string | null) {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function targetFor(group: PropGroup): MlTarget | null {
  const quote = group.bestOver || group.bestUnder || group.quotes[0];
  const eventId = text(quote?.eventId);
  const playerId = text(group.providerPlayerId);
  const marketId = text(group.marketId);
  const sportsbookKey = text(quote?.sportsbookKey || quote?.sportsbook);
  const gameStartTime = text(group.startsAt);
  if (!eventId || !playerId || !marketId || !sportsbookKey || !gameStartTime) return null;
  if (!Number.isFinite(Date.parse(gameStartTime))) return null;

  return {
    sport: group.sport,
    eventId,
    playerId,
    playerName: group.player,
    marketId,
    sportsbookKey,
    gameStartTime: new Date(gameStartTime).toISOString(),
    line: group.line,
    entityType: 'player',
    live: group.live,
    isAlternate: false,
  };
}

async function fetchPredictions(groups: PropGroup[], signal?: AbortSignal) {
  const output: Record<string, ModelPrediction> = {};
  const jobs = groups
    .map((group) => ({ group, target: targetFor(group) }))
    .filter((job): job is { group: PropGroup; target: MlTarget } => Boolean(job.target));

  for (const group of groups) {
    if (!targetFor(group)) {
      output[group.key] = {
        available: false,
        code: 'TARGET_UNVERIFIED',
        message: 'A verified model target is not available for this exact prop.',
      };
    }
  }

  if (!jobs.length) return output;

  const response = await fetch('/api/props/ml', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      props: jobs.map((job, index) => ({ ...job.target, key: String(index) })),
    }),
  });

  if (response.status === 401) throw new ApiError('Sign in to view model estimates.', 401, 'AUTH_REQUIRED');
  if (!response.ok) throw new ApiError('Model estimates are temporarily unavailable.', response.status, 'MODEL_FEED_UNAVAILABLE');

  const body = (await response.json()) as { ok?: boolean; results?: Record<string, ModelPrediction> };
  if (!body.ok || !body.results) throw new ApiError('Model estimates are temporarily unavailable.', 502, 'MODEL_FEED_UNAVAILABLE');

  jobs.forEach((job, index) => {
    output[job.group.key] = body.results?.[String(index)] || {
      available: false,
      code: 'MODEL_FEED_UNAVAILABLE',
      message: 'No verified model estimate is available for this prop.',
    };
  });

  return output;
}

export function BetHoopsBoard() {
  const router = useRouter();
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);
  const [sport, setSport] = React.useState('NFL');
  const [tab, setTab] = React.useState<Tab>('predictions');
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [market, setMarket] = React.useState(ALL);
  const [predictions, setPredictions] = React.useState<Record<string, ModelPrediction>>({});
  const [research, setResearch] = React.useState<Record<string, ResearchSummary | null>>({});
  const [feedMode, setFeedMode] = React.useState<FeedMode>('connecting');

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (checking || !account) return;
    let cancelled = false;
    let activeController: AbortController | null = null;
    let stream: EventSource | null = null;
    let streamRefreshTimer: number | null = null;

    const load = async (initial: boolean) => {
      if (activeController) return;
      const controller = new AbortController();
      activeController = controller;
      if (initial) {
        setLoading(true);
        setError('');
      }
      try {
        const board = await fetchBoard(sport, controller.signal);
        if (cancelled) return;
        setGroups(board.groups);
        setMeta(board.meta);
        if (initial) {
          setMarket(ALL);
          setPredictions({});
          setResearch({});
        }
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        if (initial) {
          setError(cause instanceof Error ? cause.message : 'The live prop board is unavailable.');
        }
      } finally {
        if (activeController === controller) activeController = null;
        if (!cancelled && initial) setLoading(false);
      }
    };

    const refreshQuietly = () => {
      if (streamRefreshTimer !== null) return;
      streamRefreshTimer = window.setTimeout(() => {
        streamRefreshTimer = null;
        if (!cancelled && document.visibilityState === 'visible') void load(false);
      }, STREAM_REFRESH_DEBOUNCE_MS);
    };

    setFeedMode('connecting');
    void load(true);

    if (typeof window.EventSource === 'function') {
      stream = new EventSource(`/api/apex/stream?sport=${encodeURIComponent(sport)}`);
      stream.onopen = () => {
        if (!cancelled) setFeedMode('live');
      };
      stream.addEventListener('ready', () => {
        if (!cancelled) setFeedMode('live');
      });
      stream.addEventListener('market', refreshQuietly);
      stream.addEventListener('resync', refreshQuietly);
      stream.onerror = () => {
        if (!cancelled) setFeedMode('fallback');
        // EventSource automatically reconnects with Last-Event-ID. The slower
        // interval below is only a safety net while the stream is unavailable.
      };
    } else {
      setFeedMode('fallback');
    }

    const fallbackTick = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const fallbackInterval = window.setInterval(fallbackTick, FALLBACK_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      activeController?.abort();
      stream?.close();
      if (streamRefreshTimer !== null) window.clearTimeout(streamRefreshTimer);
      window.clearInterval(fallbackInterval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [checking, account, sport]);

  const markets = React.useMemo(
    () => [...new Set(groups.map((group) => group.market).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (market !== ALL && group.market !== market) return false;
      if (!needle) return true;
      return `${group.player} ${group.market} ${group.matchup} ${group.team || ''} ${group.opponent || ''}`
        .toLowerCase()
        .includes(needle);
    });
  }, [groups, market, query]);

  const page = React.useMemo(() => filtered.slice(0, PAGE_SIZE), [filtered]);
  const pageKey = page.map((group) => group.key).join('|');

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    void fetchPredictions(page, controller.signal)
      .then((rows) => setPredictions((current) => ({ ...current, ...rows })))
      .catch((cause) => {
        if (cause instanceof ApiError && cause.status === 401) setAccount(null);
      });
    return () => controller.abort();
    // pageKey captures the exact visible target list without re-running on object identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  React.useEffect(() => {
    if (!account || !page.length) return;
    const controller = new AbortController();
    const queue = page.filter((group) => research[group.key] === undefined);
    if (!queue.length) return () => controller.abort();

    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift();
        if (!group) break;
        try {
          const row = await fetchResearch(group, 'OVER', controller.signal);
          const l10 = windowOf(row, 'last10', 'l10', 'lastTen');
          const rate = pctValue(l10?.hitRate ?? null);
          const hits = finite(l10?.hits) ? l10.hits : null;
          const sampleRaw = l10?.sampleSize ?? l10?.games;
          const sample = finite(sampleRaw) ? sampleRaw : null;
          if (!controller.signal.aborted) {
            setResearch((current) => ({
              ...current,
              [group.key]: rate === null && hits === null && sample === null ? null : { hits, sample, rate },
            }));
          }
        } catch {
          if (!controller.signal.aborted) setResearch((current) => ({ ...current, [group.key]: null }));
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    return () => controller.abort();
    // pageKey captures the exact visible target list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, pageKey]);

  const displayPage = React.useMemo(() => {
    return [...page].sort((a, b) => {
      const pa = predictions[a.key];
      const pb = predictions[b.key];
      const edgeA = pa?.available && finite(pa.projection) ? Math.abs(pa.projection - a.line) : -1;
      const edgeB = pb?.available && finite(pb.projection) ? Math.abs(pb.projection - b.line) : -1;
      return edgeB - edgeA || a.player.localeCompare(b.player);
    });
  }, [page, predictions]);

  const historyRows = React.useMemo(
    () =>
      displayPage
        .map((group) => ({ group, summary: research[group.key], prediction: predictions[group.key] }))
        .filter((row) => row.summary !== undefined),
    [displayPage, research, predictions],
  );

  const historyTotals = React.useMemo(() => {
    let hits = 0;
    let samples = 0;
    let available = 0;
    for (const row of historyRows) {
      if (!row.summary || !finite(row.summary.hits) || !finite(row.summary.sample) || row.summary.sample <= 0) continue;
      hits += row.summary.hits;
      samples += row.summary.sample;
      available += 1;
    }
    const misses = Math.max(samples - hits, 0);
    const rate = samples > 0 ? (hits / samples) * 100 : null;
    return { hits, misses, samples, rate, available };
  }, [historyRows]);

  function openResearch(group: PropGroup) {
    const params = new URLSearchParams({
      sport: group.sport,
      player: group.player,
      market: group.market,
      line: String(group.line),
    });
    router.push(`/research?${params}`);
  }

  if (checking) {
    return <BoardLoading />;
  }

  if (!account) {
    return (
      <div className={styles.signInShell}>
        <SignInPanel onSignedIn={setAccount} />
      </div>
    );
  }

  const feedLabel = meta.stale
    ? 'Latest cached feed'
    : feedMode === 'live'
      ? 'Live stream'
      : feedMode === 'connecting'
        ? 'Connecting live…'
        : 'Live feed · fallback sync';

  return (
    <div className={styles.pageShell}>
      <section className={styles.appContainer}>
        <header className={styles.appHeader}>
          <p className={styles.eyebrow}>PropLine market data · ObligeProps research</p>
          <h1 className={styles.appTitle}>ObligeProps</h1>
          <p className={styles.appSubtitle}>Live player props with verified model projections and recent-game context.</p>
          <div className={styles.tabBar} role="tablist" aria-label="Prop dashboard views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'predictions'}
              className={`${styles.tabBtn} ${tab === 'predictions' ? styles.active : ''}`}
              onClick={() => setTab('predictions')}
            >
              <Target size={16} /> Today's Props
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'history'}
              className={`${styles.tabBtn} ${tab === 'history' ? styles.active : ''}`}
              onClick={() => setTab('history')}
            >
              <BarChart3 size={16} /> Performance
            </button>
          </div>
        </header>

        <div className={styles.controlStack}>
          <div className={styles.rail} role="group" aria-label="Sport">
            {SPORTS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.statBtn} ${sport === option ? styles.active : ''}`}
                aria-pressed={sport === option}
                onClick={() => setSport(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <div className={styles.searchRow}>
            <label className={styles.searchField}>
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search players, teams or props</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search players, teams, or props…"
              />
            </label>
            <span className={styles.feedStatus} data-stale={meta.stale || feedMode === 'fallback' ? 'true' : 'false'}>
              <span />
              {feedLabel}
            </span>
          </div>

          <div className={styles.rail} role="group" aria-label="Market">
            <button
              type="button"
              className={`${styles.statBtn} ${market === ALL ? styles.active : ''}`}
              aria-pressed={market === ALL}
              onClick={() => setMarket(ALL)}
            >
              <Activity size={16} /> All Props
            </button>
            {markets.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.statBtn} ${market === option ? styles.active : ''}`}
                aria-pressed={market === option}
                onClick={() => setMarket(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className={styles.errorMessage} role="alert">
            <AlertCircle size={42} />
            <h2>Failed to load the prop board</h2>
            <p>{error}</p>
          </div>
        ) : tab === 'history' ? (
          <PerformanceView rows={historyRows} totals={historyTotals} onOpen={openResearch} />
        ) : (
          <div className={styles.glassPanel}>
            <div className={styles.panelHeading}>
              <div>
                <span className={styles.panelKicker}>{sport} prop board</span>
                <h2>{loading ? 'Loading props…' : `${filtered.length.toLocaleString()} props available`}</h2>
              </div>
              <span className={styles.panelMeta}>
                {meta.sportsbookCount ? `${meta.sportsbookCount} books` : 'Book count unavailable'}
              </span>
            </div>

            {loading ? (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner} />
                <p>Loading PropLine markets and verified model targets…</p>
              </div>
            ) : displayPage.length === 0 ? (
              <div className={styles.emptyState}>
                <AlertCircle size={42} />
                <h3>No matching props right now.</h3>
                <p>Try another sport, market, or search.</p>
              </div>
            ) : (
              <div className={styles.predictionsGrid}>
                {displayPage.map((group) => (
                  <PredictionCard
                    key={group.key}
                    group={group}
                    prediction={predictions[group.key]}
                    summary={research[group.key]}
                    onOpen={() => openResearch(group)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function PredictionCard({
  group,
  prediction,
  summary,
  onOpen,
}: {
  group: PropGroup;
  prediction?: ModelPrediction;
  summary?: ResearchSummary | null;
  onOpen: () => void;
}) {
  const hasProjection = prediction?.available === true && finite(prediction.projection);
  const diff = hasProjection ? prediction.projection! - group.line : null;
  const recommendation = diff === null ? null : Math.abs(diff) < 0.2 ? 'PASS' : diff > 0 ? 'OVER' : 'UNDER';
  const isOver = recommendation === 'OVER';
  const isUnder = recommendation === 'UNDER';
  const books = new Set(group.quotes.map((quote) => text(quote.sportsbook || quote.sportsbookKey)).filter(Boolean)).size;

  return (
    <article className={styles.predictionCard}>
      {recommendation && recommendation !== 'PASS' ? (
        <div
          className={`${styles.recommendationBadge} ${isOver ? styles.recommendationOver : styles.recommendationUnder}`}
        >
          {recommendation} {isOver ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      ) : (
        <div className={`${styles.recommendationBadge} ${styles.recommendationNeutral}`}>
          {recommendation === 'PASS' ? 'CLOSE' : 'MODEL —'}
        </div>
      )}

      <div className={styles.cardHeader}>
        <div className={styles.playerIdentity}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artworkUrl(group.sport, group.player, group.team, group.providerPlayerId)}
            alt=""
            className={styles.playerAvatar}
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden';
            }}
          />
          <div>
            <h3 className={styles.playerName}>{group.player}</h3>
            <span className={styles.matchupBadge}>{group.matchup}</span>
          </div>
        </div>
      </div>

      <div className={styles.statsRow}>
        <div className={styles.statBlock}>
          <span className={styles.statLabel}>Line · {group.market}</span>
          <span className={styles.statValue}>{group.line}</span>
        </div>
        <div className={`${styles.statBlock} ${styles.alignRight}`}>
          <span className={styles.statLabel}>Model projection</span>
          <span
            className={styles.statValue}
            data-tone={isOver ? 'over' : isUnder ? 'under' : 'neutral'}
          >
            {hasProjection ? prediction.projection!.toFixed(1) : 'Unavailable'}
          </span>
        </div>
      </div>

      <div className={styles.contextGrid}>
        <span>
          <TrendingUp size={14} />
          {summary === undefined
            ? 'L10 loading…'
            : summary?.rate !== null && summary?.rate !== undefined
              ? `L10 ${Math.round(summary.rate)}%${finite(summary.hits) && finite(summary.sample) ? ` · ${summary.hits}/${summary.sample}` : ''}`
              : 'L10 unavailable'}
        </span>
        <span>
          <BookOpen size={14} /> {books || '—'} {books === 1 ? 'book' : 'books'}
        </span>
      </div>

      <div className={styles.quoteRow}>
        <span>
          <b>Over</b> {price(group.bestOver?.price)}
        </span>
        <span>
          <b>Under</b> {price(group.bestUnder?.price)}
        </span>
      </div>

      <div className={styles.cardFooter}>
        <span>{timeLabel(group.startsAt)}</span>
        <button type="button" onClick={onOpen}>Open analysis</button>
      </div>
    </article>
  );
}

function PerformanceView({
  rows,
  totals,
  onOpen,
}: {
  rows: Array<{ group: PropGroup; summary: ResearchSummary | null | undefined; prediction: ModelPrediction | undefined }>;
  totals: { hits: number; misses: number; samples: number; rate: number | null; available: number };
  onOpen: (group: PropGroup) => void;
}) {
  return (
    <div className={styles.glassPanel}>
      <div className={styles.performanceNotice}>
        Verified recent-game results for the current slate. This is historical hit-rate context, not a claim about model profitability.
      </div>

      <div className={styles.historySummary}>
        <div className={`${styles.summaryCard} ${styles.summaryWins}`}>
          <Trophy size={24} />
          <div><span className={styles.summaryNumber}>{totals.hits}</span><span className={styles.summaryLabel}>L10 hits</span></div>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryLosses}`}>
          <Activity size={24} />
          <div><span className={styles.summaryNumber}>{totals.misses}</span><span className={styles.summaryLabel}>L10 misses</span></div>
        </div>
        <div className={`${styles.summaryCard} ${styles.summaryRate}`}>
          <TrendingUp size={24} />
          <div>
            <span className={styles.summaryNumber}>{totals.rate === null ? '—' : `${totals.rate.toFixed(1)}%`}</span>
            <span className={styles.summaryLabel}>Weighted hit rate</span>
          </div>
        </div>
      </div>

      <div className={styles.historyTableWrapper}>
        <table className={styles.historyTable}>
          <thead>
            <tr><th>Player</th><th>Market</th><th>Line</th><th>L10</th><th>Rate</th><th>Model</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(({ group, summary, prediction }) => {
              const projection = prediction?.available && finite(prediction.projection) ? prediction.projection : null;
              const lean = projection === null ? '—' : projection > group.line ? 'Over' : projection < group.line ? 'Under' : 'Even';
              return (
                <tr key={group.key}>
                  <td className={styles.cellPlayer}>{group.player}<small>{group.matchup}</small></td>
                  <td>{group.market}</td>
                  <td>{group.line}</td>
                  <td>{summary && finite(summary.hits) && finite(summary.sample) ? `${summary.hits}/${summary.sample}` : 'Unavailable'}</td>
                  <td>{summary?.rate !== null && summary?.rate !== undefined ? `${Math.round(summary.rate)}%` : '—'}</td>
                  <td><span data-lean={lean.toLowerCase()}>{lean}</span></td>
                  <td><button type="button" className={styles.tableAction} onClick={() => onOpen(group)}>Research</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoardLoading() {
  return (
    <div className={styles.pageShell}>
      <div className={styles.appContainer}>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner} />
          <p>Opening ObligeProps…</p>
        </div>
      </div>
    </div>
  );
}

```

---

## FILE: apps/oblige-web/components/board-view.tsx

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { BoardMeta, PropGroup } from '@/lib/types';
import { ApiError, fetchAccount, fetchBoard, fetchResearch, windowOf } from '@/lib/api';
import { cn, pctValue } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PropCard, PropCardSkeleton, type PropCardStats } from '@/components/face-card';
import { Reveal } from '@/components/motion';
import { SignInPanel } from '@/components/sign-in';

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'WNBA', 'SOCCER'];
const SORTS = [
  { id: 'hit', label: 'Hit rate' },
  { id: 'line', label: 'Line' },
  { id: 'name', label: 'A–Z' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

/** Enough cards to fill a tall screen without asking the research route for
 * hundreds of histories nobody scrolled to. */
const PAGE_SIZE = 24;
const ALL = 'ALL';
const AUTO_REFRESH_MS = 15_000;

const bookName = (value: unknown) => String(value || '').trim();
const sortedUnique = (values: Array<string | null | undefined>) =>
  [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function BoardView() {
  const router = useRouter();
  const [account, setAccount] = React.useState<{ id: string; email?: string } | null>(null);
  const [checking, setChecking] = React.useState(true);

  const [sport, setSport] = React.useState('NFL');
  const [groups, setGroups] = React.useState<PropGroup[]>([]);
  const [meta, setMeta] = React.useState<BoardMeta>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [nonce, setNonce] = React.useState(0);

  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [sort, setSort] = React.useState<SortId>('line');
  const [shown, setShown] = React.useState(PAGE_SIZE);
  const [picks, setPicks] = React.useState<Record<string, 'OVER' | 'UNDER'>>({});
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [marketFilter, setMarketFilter] = React.useState(ALL);
  const [teamFilter, setTeamFilter] = React.useState(ALL);
  const [opponentFilter, setOpponentFilter] = React.useState(ALL);
  const [bookFilter, setBookFilter] = React.useState(ALL);

  /** Hit rates arrive per card from the research route, so the board renders
   * immediately and each card fills in as its history lands. */
  const [stats, setStats] = React.useState<Record<string, PropCardStats>>({});

  React.useEffect(() => {
    const controller = new AbortController();
    fetchAccount(controller.signal)
      .then(setAccount)
      .finally(() => setChecking(false));
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    if (checking || !account) return;

    let cancelled = false;
    let activeController: AbortController | null = null;

    const loadBoard = async (initial: boolean) => {
      if (activeController) return;
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 20000);

      if (initial) {
        setLoading(true);
        setError('');
      }

      try {
        const board = await fetchBoard(sport, controller.signal);
        if (cancelled) return;

        setGroups(board.groups);
        setMeta(board.meta);
        setError('');

        if (initial) {
          setShown(PAGE_SIZE);
          setMarketFilter(ALL);
          setTeamFilter(ALL);
          setOpponentFilter(ALL);
          setBookFilter(ALL);
        }
      } catch (cause: unknown) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setAccount(null);
          return;
        }
        if (initial) {
          setError(
            controller.signal.aborted
              ? 'The prop board took too long to respond. Try again.'
              : cause instanceof Error
                ? cause.message
                : 'The live prop board is unavailable.',
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        if (!cancelled && initial) setLoading(false);
      }
    };

    void loadBoard(true);

    const refreshVisibleBoard = () => {
      if (document.visibilityState === 'visible') void loadBoard(false);
    };
    const interval = window.setInterval(refreshVisibleBoard, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshVisibleBoard);

    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisibleBoard);
    };
  }, [checking, account, sport, nonce]);

  const filterOptions = React.useMemo(() => {
    const books: string[] = [];
    for (const group of groups) {
      for (const quote of group.quotes) {
        const value = bookName(quote.sportsbook || quote.sportsbookKey);
        if (value) books.push(value);
      }
    }
    return {
      markets: sortedUnique(groups.map((group) => group.market)),
      teams: sortedUnique(groups.map((group) => group.team)),
      opponents: sortedUnique(groups.map((group) => group.opponent)),
      books: sortedUnique(books),
    };
  }, [groups]);

  const activeFilterCount = [marketFilter, teamFilter, opponentFilter, bookFilter].filter((value) => value !== ALL).length;

  const visible = React.useMemo(() => {
    const filtered = groups.filter((group) => {
      if (debounced && !`${group.player} ${group.market} ${group.matchup}`.toLowerCase().includes(debounced)) return false;
      if (marketFilter !== ALL && group.market !== marketFilter) return false;
      if (teamFilter !== ALL && group.team !== teamFilter) return false;
      if (opponentFilter !== ALL && group.opponent !== opponentFilter) return false;
      if (
        bookFilter !== ALL &&
        !group.quotes.some((quote) => bookName(quote.sportsbook || quote.sportsbookKey) === bookFilter)
      ) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === 'name') return a.player.localeCompare(b.player);
      if (sort === 'line') return b.line - a.line;
      const ra = stats[a.key]?.rate ?? -1;
      const rb = stats[b.key]?.rate ?? -1;
      return rb - ra || a.player.localeCompare(b.player);
    });
    return sorted;
  }, [groups, debounced, sort, stats, marketFilter, teamFilter, opponentFilter, bookFilter]);

  const page = visible.slice(0, shown);

  const requested = React.useRef(new Set<string>());
  const inflight = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    inflight.current = controller;
    return () => {
      controller.abort();
      inflight.current = null;
    };
  }, []);

  React.useEffect(() => {
    requested.current = new Set();
    setStats({});
  }, [sport]);

  const pageKeys = page.map((group) => group.key).join('|');

  React.useEffect(() => {
    const controller = inflight.current;
    if (!controller) return;
    const wanted = page.filter((group) => !requested.current.has(group.key));
    if (!wanted.length) return;
    for (const group of wanted) requested.current.add(group.key);

    const queue = [...wanted];
    const worker = async () => {
      while (queue.length && !controller.signal.aborted) {
        const group = queue.shift()!;
        try {
          const research = await fetchResearch(group, 'OVER', controller.signal);
          const last10 = windowOf(research, 'last10', 'l10', 'lastTen');
          const rate = pctValue(last10?.hitRate ?? null);
          const hits = last10?.hits ?? null;
          const sample = last10?.sampleSize ?? last10?.games ?? null;
          if (controller.signal.aborted) return;
          setStats((prev) => ({
            ...prev,
            [group.key]: rate === null && hits === null ? null : { hits, sample, rate },
          }));
        } catch {
          if (!controller.signal.aborted) {
            setStats((prev) => ({ ...prev, [group.key]: null }));
          }
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, wanted.length) }, worker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKeys]);

  function openPlayer(group: PropGroup) {
    const params = new URLSearchParams({
      sport: group.sport,
      player: group.player,
      market: group.market,
      line: String(group.line),
    });
    router.push(`/research?${params}`);
  }

  function resetFilters() {
    setMarketFilter(ALL);
    setTeamFilter(ALL);
    setOpponentFilter(ALL);
    setBookFilter(ALL);
  }

  if (checking) {
    return (
      <div className="board-loading-shell mx-auto w-full max-w-[var(--maxw)] px-3 py-4 sm:px-4 md:px-8">
        <div className="board-grid grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <PropCardSkeleton key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="mx-auto w-full max-w-[var(--maxw)] px-4 py-10 md:px-8">
        <SignInPanel onSignedIn={setAccount} />
      </div>
    );
  }

  return (
    <div className="board-shell mx-auto w-full max-w-[var(--maxw)] px-3 pt-2 pb-16 sm:px-4 md:px-6 md:pt-5 lg:px-8">
      <div className="board-summary mb-2.5 flex items-end justify-between gap-3 md:mb-4">
        <div className="board-summary__title min-w-0">
          <div className="board-kicker">Live player prop research</div>
          <h1 className="text-[length:var(--fs-xl)]" style={{ textTransform: 'var(--display-case)' as 'none' }}>
            Props
          </h1>
        </div>
        <p className="board-summary__meta shrink-0 text-right text-[length:var(--fs-xs)] text-[var(--text-3)] md:text-[length:var(--fs-sm)]">
          {loading
            ? 'Loading live board…'
            : `${visible.length.toLocaleString()} props${meta.sportsbookCount ? ` · ${meta.sportsbookCount} books` : ''}`}
        </p>
      </div>

      {meta.stale && (
        <p className="board-stale mb-2.5 flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-3 py-2 text-[length:var(--fs-xs)] text-[var(--warn)] md:mb-4 md:text-[length:var(--fs-sm)]">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          Live feed temporarily delayed. Showing the latest available prices.
        </p>
      )}

      <div className="board-toolbar sticky top-14 z-20 grid gap-1.5 border-y border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] py-1.5 backdrop-blur-xl md:top-16 md:gap-2 md:rounded-[14px] md:border md:px-2.5 md:py-2.5">
        <div className="board-leagues rail" role="group" aria-label="League">
          {SPORTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === sport}
              onClick={() => setSport(option)}
              className={cn(
                'flex-none min-h-8 rounded-[8px] border px-2.5 text-[11px] font-semibold md:min-h-9 md:rounded-[9px] md:px-3 md:text-[length:var(--fs-xs)]',
                'transition-[color,background-color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[.97]',
                option === sport
                  ? 'border-[color-mix(in_srgb,var(--accent)_48%,transparent)] bg-[color-mix(in_srgb,var(--accent)_13%,var(--surface))] text-[var(--text)]'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="board-control-row flex items-center gap-1.5">
          <label className="board-search relative flex min-w-0 flex-1 items-center">
            <Search
              className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--text-3)] md:left-3 md:size-4"
              aria-hidden="true"
            />
            <span className="sr-only">Search players or markets</span>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search players, teams…"
              autoComplete="off"
              className="h-9 min-h-9 rounded-[9px] pl-8 text-xs md:h-10 md:min-h-10 md:rounded-[10px] md:pl-9"
            />
          </label>

          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
            className={cn(
              'board-filter-trigger inline-flex h-9 min-h-9 flex-none items-center gap-1.5 rounded-[9px] border px-2.5 text-[11px] font-semibold md:h-10 md:min-h-10 md:px-3 md:text-[length:var(--fs-xs)]',
              activeFilterCount
                ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] text-[var(--accent)]'
                : 'border-[var(--line)] text-[var(--text-2)]',
            )}
          >
            <SlidersHorizontal className="size-3.5 md:size-4" aria-hidden="true" />
            <span>Filters{activeFilterCount ? ` ${activeFilterCount}` : ''}</span>
          </button>

          <div className="board-sort-pills hidden items-center gap-1.5 md:flex" aria-label="Sort props">
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === sort}
                onClick={() => setSort(option.id)}
                className={cn(
                  'min-h-10 flex-none rounded-[9px] border px-3 text-[length:var(--fs-xs)] font-semibold transition-colors duration-150',
                  option.id === sort
                    ? 'border-[color-mix(in_srgb,var(--accent)_44%,transparent)] bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface))] text-[var(--text)]'
                    : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {filtersOpen && (
          <div className="board-filter-panel" aria-label="Advanced prop filters">
            <label className="board-filter-field board-filter-sort md:hidden">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortId)}>
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <FilterSelect label="Market" value={marketFilter} onChange={setMarketFilter} options={filterOptions.markets} />
            <FilterSelect label="Team" value={teamFilter} onChange={setTeamFilter} options={filterOptions.teams} />
            <FilterSelect label="Opponent" value={opponentFilter} onChange={setOpponentFilter} options={filterOptions.opponents} />
            <FilterSelect label="Sportsbook" value={bookFilter} onChange={setBookFilter} options={filterOptions.books} />
            <button type="button" onClick={resetFilters} disabled={!activeFilterCount} className="board-filter-reset">
              Reset filters
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <TriangleAlert className="size-7 text-[var(--warn)]" aria-hidden="true" />
          <h2 className="text-[length:var(--fs-md)] normal-case">{error}</h2>
          <Button variant="ghost" size="sm" onClick={() => setNonce((value) => value + 1)}>
            Try again
          </Button>
        </div>
      ) : loading && !groups.length ? (
        <div className="board-grid mt-2.5 grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 md:mt-4 md:gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <PropCardSkeleton key={index} />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="grid justify-items-center gap-3 py-16 text-center">
          <Search className="size-7 text-[var(--text-3)]" aria-hidden="true" />
          <h2 className="text-[length:var(--fs-md)] normal-case">No props match that filter</h2>
          <p className="max-w-[46ch] text-[length:var(--fs-sm)] text-[var(--text-3)]">
            Try a different league or clear the filters to see everything {sport} has priced.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setSort('line');
              resetFilters();
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          <div className="board-grid mt-2.5 grid gap-2.5 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 md:mt-4 md:gap-3">
            {page.map((group, index) => (
              <Reveal key={group.key} delay={Math.min(index * 30, 210)}>
                <PropCard
                  group={group}
                  stats={stats[group.key] ?? null}
                  loading={!(group.key in stats)}
                  onOpen={openPlayer}
                  onPick={(picked, side) =>
                    setPicks((prev) => ({
                      ...prev,
                      [picked.key]: prev[picked.key] === side ? undefined! : side,
                    }))
                  }
                  picked={picks[group.key] ?? null}
                  delay={Math.min(index * 30, 210)}
                />
              </Reveal>
            ))}
          </div>

          {shown < visible.length && (
            <div className="mt-6 grid justify-items-center gap-2 md:mt-8">
              <Button variant="ghost" onClick={() => setShown((value) => value + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, visible.length - shown)} more
              </Button>
              <span className="text-[length:var(--fs-xs)] text-[var(--text-3)]">
                {shown.toLocaleString()} of {visible.length.toLocaleString()}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="board-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={ALL}>All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

```

---

## FILE: apps/oblige-web/components/site-chrome.tsx

```tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Home, LayoutGrid, Menu, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const NAV = [
  { href: '/board', label: 'Props' },
  { href: '/research', label: 'Research' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/account', label: 'Account' },
];

const MOBILE_NAV = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/board', label: 'Props', icon: LayoutGrid },
  { href: '/research', label: 'Research', icon: BarChart3 },
  { href: '/account', label: 'Profile', icon: User },
];

const MOBILE_MENU = [
  { href: '/account', label: 'Account / Profile' },
  { href: '/research', label: 'Research' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/account', label: 'Help / Support' },
];

function Wordmark({ footer = false }: { footer?: boolean }) {
  return (
    <span
      className={cn(
        'op-wordmark font-display',
        footer ? 'text-[length:var(--fs-md)]' : 'text-[length:var(--fs-md)] max-[519px]:text-[length:var(--fs-base)]',
      )}
    >
      Oblige<span className="op-wordmark__accent">Props</span>
    </span>
  );
}

export function SiteHeader() {
  const [stuck, setStuck] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const pathname = usePathname();
  const board = pathname.startsWith('/board');
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setStuck(window.scrollY > 24);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      data-stuck={stuck}
      data-board={board ? 'true' : 'false'}
      className={cn(
        'sticky top-0 z-30 border-b border-transparent',
        'bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl',
        'transition-[border-color,background-color] duration-300 ease-[var(--ease-out)]',
        'data-[stuck=true]:border-[var(--line)] data-[stuck=true]:bg-[color-mix(in_srgb,var(--bg)_94%,transparent)]',
      )}
    >
      <div
        className={cn(
          'mx-auto flex w-full max-w-[var(--maxw)] items-center gap-6 px-4 md:px-8',
          'h-16 transition-[height] duration-300 ease-[var(--ease-out)]',
          stuck && 'h-14',
        )}
      >
        <Link href="/" className="flex flex-none items-center gap-3" aria-label="Oblige Props home">
          <span aria-hidden="true" className="op-mark">OP</span>
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="ml-4 hidden gap-5 lg:flex">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative py-2 text-[length:var(--fs-sm)] font-medium',
                  'transition-colors duration-200 ease-[var(--ease-out)]',
                  active ? 'text-[var(--text)]' : 'text-[var(--text-2)] hover:text-[var(--text)]',
                )}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-x-0 bottom-0 h-0.5 origin-left rounded-sm bg-[var(--accent)]',
                    'transition-transform duration-300 ease-[var(--ease-out)]',
                    active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto flex items-center gap-2" ref={menuRef}>
          {board && (
            <button
              type="button"
              className="board-mobile-menu-trigger hidden size-8 items-center justify-center rounded-[8px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] text-[var(--text-2)] max-[767px]:inline-flex"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="board-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
            </button>
          )}

          {board && menuOpen && (
            <div
              id="board-mobile-menu"
              className="board-mobile-menu absolute right-0 top-[calc(100%+8px)] z-50 hidden min-w-[190px] overflow-hidden rounded-[12px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-deep)_97%,transparent)] p-1.5 shadow-2xl backdrop-blur-xl max-[767px]:grid"
            >
              {MOBILE_MENU.map((item, index) => (
                <Link
                  key={`${item.href}-${item.label}-${index}`}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-[8px] px-3 py-2.5 text-[12px] font-semibold text-[var(--text-2)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] hover:text-[var(--text)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}

          <Button
            asChild
            size="sm"
            variant="ghost"
            className={cn('max-[519px]:hidden', board && 'max-[767px]:hidden')}
          >
            <Link href="/account">Account</Link>
          </Button>
          <Button asChild size="sm" className={cn(board && 'max-[767px]:hidden')}>
            <Link href="/board">Open Props</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/** Bottom bar on phones. On the prop board it gets out of the way while the
 *  customer scrolls down and returns immediately when they reverse direction. */
export function MobileNav() {
  const pathname = usePathname();
  const board = pathname.startsWith('/board');
  const [hidden, setHidden] = React.useState(false);
  const lastY = React.useRef(0);
  const frame = React.useRef<number | null>(null);
  const touchY = React.useRef<number | null>(null);

  React.useEffect(() => {
    setHidden(false);
    lastY.current = Math.max(0, window.scrollY || 0);
    if (!board) return;

    const updateFromY = (value: number) => {
      const y = Math.max(0, value || 0);
      const previous = lastY.current;

      if (y <= 8) setHidden(false);
      else if (y > previous + 6) setHidden(true);
      else if (y < previous - 2) setHidden(false);

      lastY.current = y;
    };

    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        updateFromY(window.scrollY);
      });
    };

    const onTouchStart = (event: TouchEvent) => {
      touchY.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      const previousY = touchY.current;
      if (nextY == null || previousY == null) return;

      const delta = nextY - previousY;
      if (Math.abs(delta) < 6) return;

      if (delta < 0 && window.scrollY > 8) setHidden(true);
      else if (delta > 0) setHidden(false);

      touchY.current = nextY;
    };

    const onPageShow = () => {
      setHidden(false);
      lastY.current = Math.max(0, window.scrollY || 0);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('pageshow', onPageShow, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('pageshow', onPageShow);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      touchY.current = null;
    };
  }, [board]);

  return (
    <nav
      aria-label="Sections"
      data-board={board ? 'true' : 'false'}
      data-scroll-hidden={board && hidden ? 'true' : 'false'}
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 lg:hidden',
        'border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg-deep)_94%,transparent)] backdrop-blur-xl',
        'pb-[env(safe-area-inset-bottom)]',
        'transition-[transform,opacity] duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
      )}
      style={{
        transform:
          board && hidden
            ? 'translate3d(0, calc(100% + 24px + env(safe-area-inset-bottom)), 0)'
            : 'translate3d(0, 0, 0)',
        opacity: board && hidden ? 0 : 1,
        pointerEvents: board && hidden ? 'none' : 'auto',
      }}
    >
      {MOBILE_NAV.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'grid min-h-14 content-center justify-items-center gap-[3px]',
              'text-[10px] font-semibold tracking-wide',
              'transition-colors duration-200 ease-[var(--ease-out)]',
              active ? 'text-[var(--accent)]' : 'text-[var(--text-3)]',
            )}
          >
            <item.icon className="size-5" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--bg-deep)] py-12">
      <div className="mx-auto w-full max-w-[var(--maxw)] px-4 md:px-8">
        <div className="grid gap-8 [&>*]:min-w-0 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Wordmark footer />
            <p className="mt-4 max-w-[36ch] text-[length:var(--fs-sm)] leading-relaxed text-[var(--text-3)]">
              Player prop research with the line history attached. obligeprops.com
            </p>
          </div>
          <FooterColumn
            title="Product"
            links={[
              { href: '/board', label: 'Props' },
              { href: '/research', label: 'Player research' },
              { href: '/#pricing', label: 'Pricing' },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { href: '/account', label: 'Support' },
              { href: '/account', label: 'Account' },
            ]}
          />
          <FooterColumn
            title="Legal"
            links={[
              { href: '/terms', label: 'Terms' },
              { href: '/privacy', label: 'Privacy' },
              { href: '/responsible-play', label: 'Responsible play' },
            ]}
          />
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-4 border-t border-[var(--line)] pt-6 text-[length:var(--fs-xs)] text-[var(--text-3)]">
          <span>© {new Date().getFullYear()} Oblige Props. Research only — not betting advice.</span>
          <span>21+ · If gambling stops being fun, call 1-800-GAMBLER.</span>
        </div>
      </div>
    </footer>
  );
}

const NOT_MIGRATED = new Set(['/terms', '/privacy', '/responsible-play']);

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h4 className="mb-4 text-[length:var(--fs-xs)] font-semibold uppercase tracking-[.14em] text-[var(--text-3)]">
        {title}
      </h4>
      <ul className="grid list-none gap-3 p-0">
        {links.map((link) => {
          const className =
            'text-[length:var(--fs-sm)] text-[var(--text-2)] transition-colors duration-200 ease-[var(--ease-out)] hover:text-[var(--text)]';
          return (
            <li key={`${link.href}-${link.label}`}>
              {NOT_MIGRATED.has(link.href) ? (
                <a href={link.href} className={className}>
                  {link.label}
                </a>
              ) : (
                <Link href={link.href} className={className}>
                  {link.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

```

---
