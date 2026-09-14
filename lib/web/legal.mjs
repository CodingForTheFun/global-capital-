// Terms, privacy and responsible-gaming pages.
//
// Payment processors will not onboard a sports-adjacent product without these,
// and a signup form that collects an email needs a privacy policy wherever
// GDPR or CCPA reach. So they are a prerequisite for selling, not decoration.
//
// Everything here describes what the code actually does, checked against it:
// the account store keeps an email, a password hash and timestamps; one
// HttpOnly session cookie; no analytics library, no advertising pixel and no
// external resource on any page. Nothing is claimed that the code does not do.
//
// The operator's legal identity is configuration, not a guess. LEGAL_ENTITY,
// LEGAL_CONTACT_EMAIL and LEGAL_JURISDICTION come from the environment, and the
// governing-law clause is omitted entirely when no jurisdiction is set rather
// than inventing one.
import { headTags, siteOrigin } from './public-surface.mjs';

const text = value => String(value ?? '').trim();
const escape = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function legalIdentity(env = process.env) {
  return {
    entity: text(env.LEGAL_ENTITY) || 'ObligePay',
    contact: text(env.LEGAL_CONTACT_EMAIL) || text(env.ACCOUNT_OWNER_EMAIL) || 'support@obligepay.com',
    jurisdiction: text(env.LEGAL_JURISDICTION),
    updated: text(env.LEGAL_UPDATED) || new Date().toISOString().slice(0, 10),
  };
}

const SHELL_CSS = `
*{box-sizing:border-box}
:root{--bg:#081321;--panel:#102139;--line:#29425f;--text:#eaf2ff;--muted:#a5b7ce;--blue:#5ea1ff;--green:#33e49b}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--blue)}
.wrap{max-width:760px;margin:0 auto;padding:34px 20px 80px}
header{display:flex;align-items:center;gap:11px;margin-bottom:38px}
header img{width:30px;height:30px}
header b{font-size:19px;font-weight:800;letter-spacing:-.035em}
header b i{font-style:normal;color:var(--blue)}
header a{margin-left:auto;color:var(--muted);text-decoration:none;font-size:14px}
header a:hover{color:var(--text)}
h1{font-size:34px;line-height:1.15;letter-spacing:-.035em;margin:0 0 6px}
.updated{color:var(--muted);font-size:14px;margin:0 0 30px}
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

function shell({ title, description, path, body, origin }) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} — Auto Scout</title>
<meta name="description" content="${escape(description)}">
${headTags(origin, { path, title: `${title} — Auto Scout`, description })}
<style>${SHELL_CSS}</style></head><body>
<div class="wrap">
<header><img src="/brand/icon-32.png" alt=""><b>Auto <i>Scout</i></b><a href="/">← Back to Auto Scout</a></header>
${body}
<footer>
<a href="/">Home</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/responsible-gaming">Responsible gaming</a>
</footer>
</div></body></html>`;
}

function termsBody({ entity, contact, jurisdiction, updated }) {
  return `<h1>Terms of Service</h1>
<p class="updated">Last updated ${escape(updated)}</p>

<div class="callout">
<p><b>Auto Scout is a research tool, not a sportsbook.</b> It does not accept wagers, hold funds, or process bets. It shows publicly available lines, historical game logs and calculations derived from them.</p>
<p>Nothing here is betting advice or a prediction of any outcome. You alone are responsible for what you do with the information.</p>
</div>

<h2>1. Who we are</h2>
<p>Auto Scout (&ldquo;the service&rdquo;) is operated by ${escape(entity)}. You can reach us at <a href="mailto:${escape(contact)}">${escape(contact)}</a>.</p>

<h2>2. Eligibility</h2>
<p>You must be at least 18 years old to create an account, and old enough to legally view sports betting information where you live — in much of the United States that is 21. You are responsible for knowing and following the law in your own jurisdiction. Sports betting is restricted or prohibited in many places; the availability of this service is not a statement that betting is legal where you are.</p>

<h2>3. Your account</h2>
<ul>
<li>Provide an email address you control, and keep your password to yourself.</li>
<li>One person per account. Do not share credentials or resell access.</li>
<li>Tell us promptly at <a href="mailto:${escape(contact)}">${escape(contact)}</a> if you believe your account has been used without your permission.</li>
<li>We may suspend or close an account that is being used to abuse the service, break these terms, or break the law.</li>
</ul>

<h2>4. What the numbers are, and are not</h2>
<p>The service reports hit rates counted from completed games, lines published by sportsbooks and daily fantasy operators, and fair-value figures derived from prices those books post. Where a figure is a model estimate rather than an observation, it is labelled as one on screen.</p>
<ul>
<li>Historical hit rates describe the past. They are not probabilities for any future game.</li>
<li>Lines and prices are gathered from public sources and may be delayed, incomplete or withdrawn by the operator at any time. Always confirm a number with the book before acting on it.</li>
<li>Where data is unavailable, the service says so rather than filling the gap with an estimate.</li>
</ul>

<h2>5. Acceptable use</h2>
<ul>
<li>Do not scrape, bulk-export or redistribute the service&rsquo;s output as your own product.</li>
<li>Do not attempt to break, overload, or gain unauthorised access to the service or other users&rsquo; accounts.</li>
<li>Do not use the service where doing so would break the law that applies to you.</li>
</ul>

<h2>6. Availability</h2>
<p>The service is provided as it is, without any warranty. Upstream data sources can change or disappear without notice, and features may change, pause or be removed. We do not guarantee uninterrupted availability or that any particular sport, league, book or market will be covered.</p>

<h2>7. Limitation of liability</h2>
<p>To the fullest extent the law allows, ${escape(entity)} is not liable for any loss arising from your use of the service, including gambling losses, lost profits, or decisions made using information shown here. Some jurisdictions do not allow certain limitations, in which case the narrowest permitted limitation applies.</p>

<h2>8. Changes to these terms</h2>
<p>We may update these terms as the service changes. The date at the top shows the current version. Continuing to use the service after a change means you accept the updated terms.</p>
${jurisdiction ? `
<h2>9. Governing law</h2>
<p>These terms are governed by the laws of ${escape(jurisdiction)}, without regard to conflict-of-law rules.</p>` : ''}

<h2>${jurisdiction ? '10' : '9'}. Contact</h2>
<p>Questions about these terms: <a href="mailto:${escape(contact)}">${escape(contact)}</a>.</p>`;
}

function privacyBody({ entity, contact, jurisdiction, updated }) {
  return `<h1>Privacy Policy</h1>
<p class="updated">Last updated ${escape(updated)}</p>

<div class="callout">
<p><b>We run no analytics, no advertising pixels and no third-party trackers.</b> The pages load no external scripts, fonts or images, so no other company is watching you use this site.</p>
<p>We set exactly one cookie, and it exists to keep you signed in.</p>
</div>

<h2>What we collect</h2>
<ul>
<li><b>Your email address</b>, because an account needs an identity and a way to recover access.</li>
<li><b>A hash of your password.</b> The password itself is never stored and cannot be recovered from the hash — that is why a reset replaces it rather than reminding you of it.</li>
<li><b>Account timestamps</b>: when the account was created, when it last signed in, and whether the email has been verified.</li>
<li><b>Research you save</b>, so it is there when you come back.</li>
<li><b>Short-lived sign-in codes</b>, stored hashed and single-use, for email verification and password resets.</li>
</ul>
<p>We do not ask for, and have no use for, your name, address, date of birth, payment card or any gambling account.</p>

<h2>Cookies</h2>
<p>One cookie, <code>sp_account</code>. It holds a signed session token, is marked HttpOnly so page scripts cannot read it, SameSite=Lax so it is not sent from other sites, and Secure in production. It is strictly necessary to keep you signed in; there are no advertising or analytics cookies to consent to. Signing out clears it.</p>

<h2>Where the sports data comes from</h2>
<p>Lines, odds and game logs are fetched by our servers from publicly available sources, including sportsbooks, daily fantasy operators and league statistics providers. <b>Your browser never contacts them</b>, and we never send them anything about you — the request comes from us, and it contains no information identifying any user.</p>

<h2>How we use what we hold</h2>
<p>Only to run the service: to sign you in, keep your saved research, protect accounts from abuse, and reply when you contact us. We do not sell personal data, we do not share it with advertisers, and we do not build a profile of you for marketing.</p>

<h2>How long we keep it</h2>
<p>Your account details stay for as long as the account exists. Ask us to delete your account and we remove the account record and its saved research. Sign-in codes expire in minutes and are discarded once used.</p>

<h2>Your rights</h2>
<p>Wherever you live, you can ask us to show you what we hold about you, correct it, or delete it. If you are in the UK, EU, or a US state with a privacy statute such as California, those rights are yours by law and we honour them regardless of where you are. Email <a href="mailto:${escape(contact)}">${escape(contact)}</a> and we will act on it.</p>

<h2>Security</h2>
<p>Passwords are stored only as hashes. Sessions are signed and expire. Sign-in attempts are rate-limited and repeated failures lock an account temporarily. Traffic is served over HTTPS only. No system is perfect, so use a password you do not reuse elsewhere.</p>

<h2>Children</h2>
<p>The service is not for anyone under 18, and we do not knowingly collect anything from them. If you believe a minor has created an account, tell us and we will remove it.</p>

<h2>Changes</h2>
<p>If this policy changes, the date at the top changes with it. A change that materially affects what we collect or why will be announced to account holders.</p>

<h2>Contact</h2>
<p>${escape(entity)} — <a href="mailto:${escape(contact)}">${escape(contact)}</a>${jurisdiction ? `. Data is processed under the laws of ${escape(jurisdiction)}.` : '.'}</p>`;
}

function responsibleBody({ contact, updated }) {
  return `<h1>Responsible gaming</h1>
<p class="updated">Last updated ${escape(updated)}</p>

<div class="callout">
<p><b>Nothing on Auto Scout is a prediction, a tip, or advice to place a bet.</b> A hit rate is a count of what already happened. A fair value is what a sportsbook&rsquo;s own prices imply. Neither tells you what will happen tonight.</p>
<p>No research removes the house edge, and no tool makes betting a way to make money.</p>
</div>

<h2>What this tool will never do</h2>
<ul>
<li>Tell you a bet is going to win, or describe any selection as safe, guaranteed or a lock.</li>
<li>Invent a number when the data is missing — it says the data is missing instead.</li>
<li>Hide how a figure was produced. Where something is a model estimate, it is labelled as an estimate.</li>
<li>Encourage you to chase a loss, raise a stake to recover, or bet more than you planned.</li>
</ul>

<h2>Signs worth taking seriously</h2>
<ul>
<li>Betting more than you can comfortably lose, or betting money set aside for something else.</li>
<li>Chasing losses, or raising stakes to get back to even.</li>
<li>Hiding how much you bet from people close to you.</li>
<li>Feeling anxious, low or irritable when you are not betting.</li>
<li>Borrowing to bet.</li>
</ul>

<h2>Where to get help</h2>
<p><b>United States</b> — National Problem Gambling Helpline: call or text <b>1-800-522-4700</b> (1-800-GAMBLER). Free, confidential, 24/7. More at <a href="https://www.ncpgambling.org/help-treatment/" rel="noopener noreferrer" target="_blank">ncpgambling.org</a>.</p>
<p><b>United Kingdom</b> — National Gambling Helpline: <b>0808 8020 133</b>, or <a href="https://www.begambleaware.org/" rel="noopener noreferrer" target="_blank">BeGambleAware</a>.</p>
<p><b>Canada</b> — <a href="https://www.connexontario.ca/" rel="noopener noreferrer" target="_blank">ConnexOntario</a>, 1-866-531-2600.</p>
<p><b>Anywhere</b> — <a href="https://www.gamblersanonymous.org/" rel="noopener noreferrer" target="_blank">Gamblers Anonymous</a> lists meetings worldwide.</p>

<h2>Practical steps</h2>
<ul>
<li>Decide what you can lose before you start, and stop there.</li>
<li>Set deposit and time limits with your sportsbook. Most offer them; they work.</li>
<li>Use self-exclusion if limits are not holding. It is designed for exactly that.</li>
<li>Keep betting money separate from money you need.</li>
</ul>

<h2>Closing your account here</h2>
<p>If stepping away from research tools would help, email <a href="mailto:${escape(contact)}">${escape(contact)}</a> and we will close your account and delete your saved research. We will not ask you to reconsider.</p>`;
}

const PAGES = Object.freeze({
  '/terms': { title: 'Terms of Service', description: 'The terms that apply to using Auto Scout.', body: termsBody },
  '/privacy': { title: 'Privacy Policy', description: 'What Auto Scout collects, why, and what it never does.', body: privacyBody },
  '/responsible-gaming': { title: 'Responsible gaming', description: 'Auto Scout is research, not advice — and where to get help.', body: responsibleBody },
});

export const LEGAL_PATHS = Object.freeze(Object.keys(PAGES));

/** Render one legal page, or null when the path is not one. */
export function legalPage(pathname, { env = process.env, origin = siteOrigin(env) } = {}) {
  const page = PAGES[String(pathname || '').replace(/\/+$/, '') || '/'];
  if (!page) return null;
  const identity = legalIdentity(env);
  return shell({
    title: page.title, description: page.description, path: pathname,
    body: page.body(identity), origin,
  });
}

/**
 * Serve a legal page if this request is for one.
 * @returns true when the response has been written.
 */
export function serveLegal(req, res, options = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const html = legalPage(pathname, options);
  if (!html) return false;
  const body = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=1800',
    'content-length': body.length,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
