// The shell every signed-out page shares: legal documents, pricing, checkout.
//
// Self-contained like the landing page — no shared bundle, no build step, no
// external request — so these pages render even when the app behind the gate
// is having a bad day, and so the privacy policy's "no external resources"
// claim stays true on every page that makes it.
import { headTags, siteOrigin } from './public-surface.mjs';

export const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const SHELL_CSS = `
*{box-sizing:border-box}
:root{--bg:#081321;--panel:#102139;--panel2:#0c1a2c;--line:#29425f;--text:#eaf2ff;--muted:#a5b7ce;--blue:#5ea1ff;--green:#33e49b}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--blue)}
.wrap{max-width:760px;margin:0 auto;padding:34px 20px 80px}
.wrap.wide{max-width:920px}
header{display:flex;align-items:center;gap:11px;margin-bottom:38px}
header img{width:30px;height:30px}
header b{font-size:19px;font-weight:800;letter-spacing:-.035em}
header b i{font-style:normal;color:var(--blue)}
header a{margin-left:auto;color:var(--muted);text-decoration:none;font-size:14px}
header a:hover{color:var(--text)}
h1{font-size:34px;line-height:1.15;letter-spacing:-.035em;margin:0 0 6px}
.updated,.sub{color:var(--muted);font-size:14px;margin:0 0 30px}
h2{font-size:19px;letter-spacing:-.02em;margin:34px 0 10px}
p,li{color:#cfdcec}
ul{padding-left:20px}
li{margin-bottom:7px}
.callout{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:16px 18px;margin:26px 0}
.callout p{margin:0;color:#e4eefb}
.callout p+p{margin-top:9px}
footer{margin-top:52px;padding-top:22px;border-top:1px solid var(--line);color:var(--muted);font-size:14px;display:flex;gap:18px;flex-wrap:wrap}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--text)}
@media(max-width:560px){.wrap{padding:22px 16px 60px}h1{font-size:27px}}
`;

/** One page, with the same chrome as every other public page. */
export function pageShell({ title, description, path, body, origin = siteOrigin(), css = '', wide = false }) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Oblige Props</title>
<meta name="description" content="${escapeHtml(description)}">
${headTags(origin, { path, title: `${title} — Oblige Props`, description })}
<style>${SHELL_CSS}${css}</style></head><body>
<div class="wrap${wide ? ' wide' : ''}">
<header><img src="/brand/icon-32.png" alt=""><b>Oblige <i>Props</i></b><a href="/">← Back to Oblige Props</a></header>
${body}
<footer>
<a href="/">Home</a><a href="/pricing">Pricing</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/responsible-gaming">Responsible gaming</a>
</footer>
</div></body></html>`;
}
