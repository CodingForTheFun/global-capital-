import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const layout = read('../app/layout.tsx');
const globals = read('../app/globals.css');
const chrome = read('../components/site-chrome.tsx');

test('the app has one global stylesheet and the layout imports only it', () => {
  // Fifteen stacked "pass" stylesheets used to override each other with
  // !important until a rule for one page broke another. One file, one cascade.
  assert.deepEqual(readdirSync(new URL('../app/', import.meta.url)).filter((name) => name.endsWith('.css')), ['globals.css']);
  assert.deepEqual(layout.match(/import '\.\/[^']+\.css';/g), ["import './globals.css';"]);
});

test('!important is reserved for the reduced-motion reset', () => {
  const count = (globals.match(/!important;/g) || []).length;
  assert.ok(count <= 4, `globals.css has ${count} !important declarations`);
});

test('fonts load from this origin, which the production CSP allows', () => {
  // lib/web/public-surface.mjs sends font-src 'self' and style-src 'self', so a
  // Google Fonts stylesheet is blocked and every visitor gets the fallback face.
  assert.doesNotMatch(layout, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(globals, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const files = [...globals.matchAll(/url\('\.\/(fonts\/[^']+\.woff2)'\)/g)].map((match) => match[1]);
  assert.equal(files.length, 4);
  for (const file of files) assert.ok(existsSync(new URL('../app/' + file, import.meta.url)), file);
});

test('the phone dock keeps five core destinations in one row; research opens from a prop', () => {
  const block = chrome.match(/const MOBILE_NAV = \[([\s\S]*?)\];/)[1];
  const hrefs = [...block.matchAll(/href: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ['/board', '/moves', '/games', '/news', '/account']);
  assert.match(chrome, /repeat\(\$\{MOBILE_NAV\.length\}, minmax\(0, 1fr\)\)/, 'columns follow the item count');
});

/** WCAG 2 relative luminance and contrast ratio for #rrggbb. */
function luminance(hex) {
  const channel = (i) => {
    const value = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('text and accent tokens meet WCAG AA on the surfaces they sit on', () => {
  const root = globals.match(/:root \{([\s\S]*?)\n\}/)[1];
  const token = (name) => {
    const match = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`));
    assert.ok(match, `--${name} is a #rrggbb token`);
    return match[1];
  };
  const pairs = [
    ['text', 'bg'], ['text-2', 'bg'], ['text-3', 'bg'], ['text-3', 'surface-2'],
    ['accent', 'bg'], ['accent', 'surface-2'], ['accent-ink', 'accent-fill'],
    ['pos', 'surface'], ['neg', 'surface'],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(token(fg), token(bg));
    assert.ok(ratio >= 4.5, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
  }
});

test('solid controls use the fill accent so their white label stays readable', () => {
  for (const file of ['../components/ui/button.tsx', '../components/ui/tabs.tsx']) {
    const source = read(file);
    assert.match(source, /bg-\[var\(--accent-fill\)\]/, file);
    assert.doesNotMatch(source, /bg-\[var\(--accent\)\]/, file);
  }
});

test('the board keeps green and red for research data and the accent for interaction', () => {
  const board = read('../components/terminal-board.module.css');
  const terminal = read('../components/terminal-board.tsx');
  assert.doesNotMatch(board, /#61e8ad|97, 232, 173/, 'no legacy hard-coded green is left');
  assert.match(board, /\.mobileHeatCell\[data-tone="good"\][\s\S]*var\(--pos\)/, 'strong hit rates use the positive token');
  assert.match(board, /\.evPill\[data-tone="pos"\][\s\S]*var\(--pos\)/, 'positive EV uses the positive token');
  assert.doesNotMatch(board, /#[0-9a-fA-F]{6}\b/, 'the board takes every colour from the global tokens');
  assert.match(board, /data-selected="true"[\s\S]*var\(--terminal-accent\)/, 'selection stays on the interaction accent');
  assert.match(terminal, /className=\{styles\.heatCell\} data-tone=/);
  assert.match(terminal, /className=\{styles\.mobileHeatCell\} data-tone=/);
});

test('the responsible-play line is on every page, phones included', () => {
  assert.match(chrome, /1-800-GAMBLER/);
  assert.doesNotMatch(chrome, /<footer className="hidden/);
});
