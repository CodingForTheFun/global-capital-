import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RUNTIME = 'lib/autoscout/oblige-props-visual-runtime-patch.mjs';
const LANDING = 'lib/auth/landing.mjs';
const HOME_CSS = 'public/home-v2.css';
const HOME_HTML = 'public/index.html';
const MANIFEST = 'public/manifest.webmanifest';

const RUNTIME_MARKER = '/* Oblige Props neon-violet brand palette. */';
const LANDING_MARKER = '/* Oblige Props neon-violet landing palette. */';
const HOME_MARKER = '/* Oblige Props neon-violet public-home palette. */';

function appendBefore(source, anchor, addition, label) {
  if (source.includes(addition.split('\n')[0])) return source;
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`[oblige-neon-violet] ${label} anchor count=${count}`);
  return source.replace(anchor, `${addition}\n${anchor}`);
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`[oblige-neon-violet] ${label} anchor count=${count}`);
  return source.replace(from, to);
}

export function applyObligePropsNeonVioletTheme(root = process.cwd()) {
  let changed = false;

  const runtimeFile = path.join(root, RUNTIME);
  if (!existsSync(runtimeFile)) throw new Error('[oblige-neon-violet] visual runtime target missing');
  {
    const source = readFileSync(runtimeFile, 'utf8');
    const css = `${RUNTIME_MARKER}
/* Brand color is neon violet/magenta. Emerald stays semantic for positive/live
   data, red stays semantic for misses/warnings, and gold stays premium/favorite. */
#as5{
 --op-bg:#05020b;--op-surface:#10071d;--op-surface-2:#160b2b;--op-surface-3:#1d1038;
 --op-purple:#a64dff;--op-magenta:#e056ff;--op-indigo:#7566ff;--op-purple-glow:rgba(193,76,255,.30);
 --op-blue:var(--op-purple);--op-blue-2:#b58cff;--op-violet:var(--op-purple);--op-violet-2:var(--op-magenta);
 --op-line:rgba(177,103,255,.43);--op-line-soft:rgba(177,103,255,.22);
 --op-green:#2ee6a6;--op-red:#ff5470;--op-gold:#f6c453;
 --green:var(--op-green);--green2:#18bd83;--blue:#b58cff;--violet:var(--op-purple);--red:var(--op-red);--amber:var(--op-gold);
 background:
  radial-gradient(980px 520px at 13% -190px,rgba(159,70,255,.22),transparent 68%),
  radial-gradient(930px 540px at 87% -180px,rgba(224,86,255,.18),transparent 70%),
  linear-gradient(180deg,#0a0414 0%,#05020b 50%,#030108 100%)!important;
}
#as5 .asTop{background:linear-gradient(180deg,rgba(12,5,25,.95),rgba(7,3,17,.90))!important;border-bottom-color:rgba(184,109,255,.28)!important;box-shadow:0 14px 38px rgba(0,0,0,.30),0 8px 38px rgba(165,73,255,.05)!important}
#as5 .asWordmark .asProps,#as5 .asWordmark .asPay{color:#ca75ff!important;text-shadow:0 0 18px rgba(204,91,255,.30)!important}
#as5 .asHeaderSearch{border-color:rgba(167,102,234,.40)!important;background:linear-gradient(180deg,rgba(24,10,44,.91),rgba(10,5,23,.96))!important}
#as5 .asHeaderSearch:focus-within{border-color:rgba(205,116,255,.88)!important;box-shadow:0 0 0 3px rgba(171,73,255,.13),0 0 24px rgba(184,75,255,.08),0 12px 32px rgba(0,0,0,.20)!important}
#as5 .asHeaderSearchIcon:before{border-color:#c47cff!important}
#as5 .asHeaderSearchIcon:after{background:#c47cff!important}
#as5 .asSport,#as5 .asTypeChip,#as5 .asChip{border-color:rgba(149,91,208,.32)!important;background:linear-gradient(180deg,rgba(25,12,47,.90),rgba(11,6,25,.96))!important}
#as5 .asSport.on,#as5 .asTypeChip.on,#as5 .asChip.on{background:linear-gradient(135deg,#9447ff,#d64cff)!important;border-color:rgba(224,139,255,.88)!important;box-shadow:0 8px 25px rgba(171,66,255,.28),0 0 20px rgba(214,76,255,.10),inset 0 1px 0 rgba(255,255,255,.17)!important}
#as5 .asBoardFilterMenu,#as5 .asFilterSheet,#as5 .asUtility,#as5 .asAdvanced{background:linear-gradient(145deg,rgba(25,11,46,.985),rgba(9,5,22,.995))!important;border-color:rgba(167,101,230,.45)!important}
#as5 .asControl,#as5 .asMarketSelect,#as5 input[type="number"],#as5 input[type="date"],#as5 input[type="datetime-local"]{background:linear-gradient(180deg,rgba(26,13,49,.97),rgba(10,6,25,.99))!important;border-color:rgba(158,96,218,.44)!important}
#as5 .asControl:focus,#as5 .asMarketSelect:focus,#as5 input:focus{border-color:#bd68ff!important;box-shadow:0 0 0 3px rgba(181,80,255,.12)!important}
#as5 .asBtn.asPrimary,#as5 .asFilterTrigger,#as5 #asResearchBatch{background:linear-gradient(135deg,#9748ff,#d94dff)!important;border-color:rgba(222,132,255,.82)!important;box-shadow:0 9px 26px rgba(178,66,255,.24),0 0 20px rgba(221,77,255,.08)!important}
#as5 .asSummaryItem{background:linear-gradient(145deg,rgba(24,12,45,.97),rgba(9,5,22,.99))!important;border-color:rgba(154,94,215,.34)!important}
#as5 .asCard,#as5 .asRow{border-color:rgba(158,95,220,.38)!important;background:linear-gradient(145deg,rgba(24,12,46,.97),rgba(8,4,20,.995))!important}
#as5 .asCard:hover,#as5 .asRow:hover{border-color:rgba(197,112,255,.64)!important;box-shadow:0 18px 48px rgba(0,0,0,.35),0 0 0 1px rgba(193,76,255,.11),0 0 26px rgba(167,67,255,.05)!important}
#as5 .asCard .asAvatar,#as5 .asDrawerAvatar{border-color:rgba(194,111,255,.66)!important;box-shadow:0 9px 24px rgba(0,0,0,.28),0 0 0 3px rgba(185,75,255,.07)!important}
#as5 .asPill,#as5 .asPropBookPicker,#as5 .asOddsChip{background:linear-gradient(180deg,rgba(27,14,51,.95),rgba(11,6,27,.99))!important;border-color:rgba(155,95,215,.36)!important}
#as5 .asPropBookStrip{background:linear-gradient(180deg,rgba(15,7,31,.96),rgba(7,4,18,.99))!important;border-color:rgba(154,94,214,.31)!important}
#as5 .asNav{background:linear-gradient(180deg,rgba(28,13,50,.79),rgba(9,5,23,.90))!important;border-color:rgba(195,111,255,.50)!important;box-shadow:0 20px 54px rgba(0,0,0,.43),inset 0 1px 0 rgba(255,255,255,.07),0 0 34px rgba(185,73,255,.10)!important}
#as5 .asNav .on{background:linear-gradient(135deg,#9748ff,#d64cff)!important;border-color:rgba(225,143,255,.88)!important;box-shadow:0 8px 25px rgba(170,65,255,.31),0 0 22px rgba(216,76,255,.10),inset 0 1px 0 rgba(255,255,255,.18)!important}
#as5 .asNavBrand{background:linear-gradient(180deg,rgba(34,17,61,.84),rgba(14,7,32,.91))!important;border-color:rgba(177,105,235,.48)!important}
#as5 .asAnalyticsPage{background:radial-gradient(760px 350px at 78% -110px,rgba(220,79,255,.15),transparent 70%),radial-gradient(720px 340px at 14% -115px,rgba(151,72,255,.18),transparent 70%),linear-gradient(180deg,#0c0619,#06030e 62%,#04020a)!important;border-left-color:rgba(164,96,222,.24)!important;border-right-color:rgba(164,96,222,.24)!important}
#as5 .asAnalyticsPage .asDrawerHead{background:linear-gradient(180deg,rgba(17,8,34,.97),rgba(8,4,21,.93))!important;border-bottom-color:rgba(167,100,226,.34)!important}
#as5 .asMarketQuickButton.on{border-bottom-color:#cf5cff!important;background:linear-gradient(135deg,rgba(151,72,255,.26),rgba(218,77,255,.25))!important;text-shadow:0 0 16px rgba(204,84,255,.23)!important}
#as5 .asDetailLineRow .asSideBtn.on.under{color:#f0e5ff!important;background:linear-gradient(135deg,rgba(143,62,232,.56),rgba(203,67,239,.44))!important;box-shadow:0 0 0 1px rgba(205,116,255,.48),0 0 22px rgba(185,75,255,.13)!important}
#as5 .asAnalyticsPage .asPropFilterGrid select:focus{border-color:#bd68ff!important;box-shadow:0 0 0 3px rgba(180,78,255,.12)!important}
#as5 .asResearchTab[aria-selected="true"],#as5 .asResearchTab.on{background:linear-gradient(135deg,rgba(151,72,255,.23),rgba(218,77,255,.24))!important;box-shadow:inset 0 -2px 0 #cf5cff!important}
#as5 .asSection{background:linear-gradient(145deg,rgba(22,11,42,.97),rgba(8,4,20,.99))!important;border-color:rgba(157,96,216,.36)!important}
#as5 .asWindow{background:linear-gradient(180deg,rgba(25,13,48,.97),rgba(10,5,25,.99))!important;border-color:rgba(151,91,211,.38)!important}
#as5 .asWindow.on{background:linear-gradient(135deg,rgba(151,72,255,.22),rgba(219,77,255,.23))!important;border-color:rgba(202,114,255,.64)!important;box-shadow:0 0 22px rgba(180,73,255,.10)!important}
#as5 .asToast{background:linear-gradient(135deg,rgba(133,54,224,.98),rgba(201,62,236,.98))!important;border-color:rgba(220,139,255,.62)!important}
#as5 .asCard .asSave:before{color:#c47cff!important;text-shadow:0 0 13px rgba(190,91,255,.22)!important}
#as5 .asCard .asSave.asSaved:before{color:var(--op-gold)!important;text-shadow:0 0 14px rgba(246,196,83,.25)!important}
@media(max-width:700px){
 #as5{background:radial-gradient(570px 340px at 84% -125px,rgba(222,79,255,.16),transparent 68%),radial-gradient(540px 320px at 10% -115px,rgba(153,70,255,.19),transparent 68%),linear-gradient(180deg,#0a0415,#05020b 58%,#030108)!important}
 #as5 .asTop{background:rgba(10,4,22,.92)!important}
 #as5 .asHeaderSearch{background:rgba(18,8,35,.93)!important}
}`;
    const output = appendBefore(source, '</style>`;', css, 'visual runtime style close');
    if (output !== source) {
      writeFileSync(runtimeFile, output, 'utf8');
      changed = true;
    }
  }

  const landingFile = path.join(root, LANDING);
  if (!existsSync(landingFile)) throw new Error('[oblige-neon-violet] landing target missing');
  {
    const source = readFileSync(landingFile, 'utf8');
    const css = `${LANDING_MARKER}
:root{--bg:#05020b;--panel:#10071d;--line:#563070;--text:#faf7ff;--muted:#b9a8cc;--blue:#a64dff;--violet:#a64dff;--magenta:#e056ff;--green:#2ee6a6}
html,body{background:radial-gradient(900px 500px at 12% -170px,rgba(159,70,255,.23),transparent 68%),radial-gradient(880px 520px at 88% -175px,rgba(224,86,255,.19),transparent 70%),linear-gradient(180deg,#0a0414,#05020b 58%,#030108);background-attachment:fixed}
button:focus-visible,input:focus-visible,a:focus-visible{outline-color:#c579ff}
.teaser{opacity:.08}.logo{background:linear-gradient(135deg,#9748ff,#dd50ff);box-shadow:0 10px 30px rgba(174,67,255,.29),0 0 24px rgba(220,80,255,.09),inset 0 1px 0 rgba(255,255,255,.22)}
.brand{color:#fbf8ff}.beta{border-color:#633b7d;background:linear-gradient(135deg,rgba(151,72,255,.17),rgba(218,77,255,.16));color:#e8cfff}
header{border-bottom-color:rgba(165,97,224,.30)}.eyebrow{color:#c985ff}h1 em{background:linear-gradient(90deg,#ae62ff,#e05cff 58%,#8c72ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.card{background:linear-gradient(145deg,rgba(25,12,47,.98),rgba(8,4,21,.995));border-color:rgba(180,105,239,.49);box-shadow:0 30px 84px rgba(0,0,0,.44),0 0 52px rgba(185,72,255,.07),inset 0 1px 0 rgba(255,255,255,.04)}
.tabs{background:#0d061b;border-color:#563070}.tabs button[aria-selected=true]{background:linear-gradient(135deg,#9748ff,#d94dff);box-shadow:0 8px 22px rgba(174,67,255,.25)}
input[type=email],input[type=password],input[type=text]{background:#0e071d;border-color:#56346f}.check input{accent-color:#b35cff}.primary{background:linear-gradient(135deg,#9748ff,#d94dff);box-shadow:0 10px 26px rgba(175,67,255,.26)}.primary:hover{background:linear-gradient(135deg,#a65cff,#e265ff)}
.textBtn{color:#c98cff}.feat{background:linear-gradient(145deg,rgba(23,11,44,.93),rgba(8,4,20,.97));border-color:rgba(157,94,215,.39)}.mark{background:linear-gradient(135deg,rgba(151,72,255,.22),rgba(218,77,255,.19));color:#d6a7ff;border:1px solid rgba(188,113,244,.34)}
footer{border-color:rgba(157,94,215,.29);color:#a894bd}`;
    const output = appendBefore(source, '</style></head><body>', css, 'landing style close');
    if (output !== source) {
      writeFileSync(landingFile, output, 'utf8');
      changed = true;
    }
  }

  const homeCssFile = path.join(root, HOME_CSS);
  if (existsSync(homeCssFile)) {
    const source = readFileSync(homeCssFile, 'utf8');
    if (!source.includes(HOME_MARKER)) {
      const css = `\n${HOME_MARKER}\n:root{--bg:#05020b;--surface:#10071d;--surface-2:#160b2b;--line:rgba(184,108,244,.22);--text:#faf7ff;--muted:#ad9dbf;--green:#62e6c8;--blue:#bd6cff;--amber:#ffcf70;--red:#ff8fa0}\nhtml,body{background:radial-gradient(900px 470px at 18% -190px,rgba(159,70,255,.17),transparent 68%),radial-gradient(840px 460px at 86% -170px,rgba(224,86,255,.13),transparent 70%),var(--bg)}.home-auth-card,.freshness-card,.home-kpi,.home-panel{background:linear-gradient(145deg,#120820,#0b0516);border-color:rgba(183,105,242,.24)}.home-mark{border-color:rgba(202,116,255,.40);background:#1b0b2c;color:#cf80ff;box-shadow:0 0 18px rgba(183,77,255,.12)}.eyebrow{color:#c97cff}.login-form input{background:#0d0618}.login-form input:focus{border-color:rgba(201,112,255,.62);box-shadow:0 0 0 3px rgba(181,76,255,.09)}.primary-btn{border-color:rgba(226,143,255,.55);background:linear-gradient(135deg,#9748ff,#d94dff);color:#fff;box-shadow:0 8px 22px rgba(175,66,255,.20)}.home-topbar,.home-mobile-nav{background:rgba(9,4,20,.96)}.home-nav a.active{background:#211036;color:#fff}.icon-btn,.secondary-btn,.home-cta .secondary-link{background:#140922}.panel-head a{color:#d49aff}.mini-prop,.mini-game,.system-row{background:#0e071b}.home-cta .primary-link{background:linear-gradient(135deg,#9748ff,#d94dff);color:#fff}.home-mobile-nav a.active{color:#cf80ff}\n`;
      writeFileSync(homeCssFile, source + css, 'utf8');
      changed = true;
    }
  }

  const homeHtmlFile = path.join(root, HOME_HTML);
  if (existsSync(homeHtmlFile)) {
    const source = readFileSync(homeHtmlFile, 'utf8');
    const output = replaceRequired(source, '<meta name="theme-color" content="#07111f" />', '<meta name="theme-color" content="#090313" />', 'public theme-color');
    if (output !== source) {
      writeFileSync(homeHtmlFile, output, 'utf8');
      changed = true;
    }
  }

  const manifestFile = path.join(root, MANIFEST);
  if (existsSync(manifestFile)) {
    const source = readFileSync(manifestFile, 'utf8');
    let output = replaceRequired(source, '"background_color": "#0a101b"', '"background_color": "#05020b"', 'manifest background color');
    output = replaceRequired(output, '"theme_color": "#0a101b"', '"theme_color": "#090313"', 'manifest theme color');
    if (output !== source) {
      writeFileSync(manifestFile, output, 'utf8');
      changed = true;
    }
  }

  return { applied: changed, runtime: RUNTIME, landing: LANDING };
}
