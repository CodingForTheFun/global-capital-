import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const chrome = readFileSync(new URL('../components/site-chrome.tsx', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../components/landing-board-preview.tsx', import.meta.url), 'utf8');
const icon = readFileSync(new URL('../app/icon.svg', import.meta.url), 'utf8');

test('homepage uses the approved product-led hero without redundant hero CTA buttons', () => {
  assert.match(page, /Find the edge/);
  assert.match(page, /before the line moves/);
  assert.match(page, /LandingBoardPreview/);
  assert.match(page, /premium-sports-strip/);
  assert.doesNotMatch(page, /premium-actions/);
  assert.doesNotMatch(page, /Explore player research/);
});

test('homepage preview uses the live board contract and never hard-codes sample players', () => {
  assert.match(preview, /fetchBoard\(PREVIEW_SPORT/);
  assert.match(preview, /never fills this space with made-up lines or percentages/);
  assert.doesNotMatch(preview, /Lamar Jackson|Shohei Ohtani|Arch Manning/);
});

test('header and icon use the new Figma-derived Oblige brand mark', () => {
  assert.match(chrome, /\/icon\.svg/);
  assert.match(chrome, /op-brand-mark/);
  assert.match(icon, /#4DA3FF/);
  assert.match(icon, /#68F4D5/);
  assert.match(icon, /M13 35L34 13/);
});
