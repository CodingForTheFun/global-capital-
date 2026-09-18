import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const presentation = readFileSync(new URL('../scripts/patch-obligeprops-presentation.mjs', import.meta.url), 'utf8');
const filters = readFileSync(new URL('../lib/ui/prop-filters.mjs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../apex-v2/scout-ui-v5.js', import.meta.url), 'utf8');

test('ObligeProps ships the midnight-electric mobile and desktop visual contract', () => {
  assert.match(presentation, /Oblige Props midnight-electric premium system/);
  assert.match(presentation, /--op-blue:#2f7cff/);
  assert.match(presentation, /--op-violet:#8b5cf6/);
  assert.match(presentation, /--op-green:#2ee6a6/);
  assert.match(presentation, /--op-gold:#f6c453/);
  assert.match(presentation, /#as5 \.asAnalyticsPage \.asPropFilterGrid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
  assert.match(presentation, /@media\(min-width:1051px\)/);
  assert.match(presentation, /@media\(max-width:700px\)/);
  assert.match(presentation, /Oblige Props midnight-electric landing theme/);
});

test('prop detail dropdown filters apply immediately without an Apply button', () => {
  assert.match(filters, /Live filters · selections apply instantly/);
  assert.doesNotMatch(filters, /Apply prop filters|asApplyPropFilters/);
  assert.match(
    ui,
    /document\.querySelectorAll\('\[data-prop-filter\]'\)\.forEach\(el=>el\.onchange=\(\)=>\{drawerState\.propFilters=\{\.\.\.drawerState\.propFilters,\[el\.dataset\.propFilter\]:el\.value\};renderDrawer\(\);\}\);/,
  );
  assert.match(
    ui,
    /document\.getElementById\('asPropVenue'\)\.onchange=e=>\{drawerState\.filter=e\.target\.value;renderDrawer\(\);\};/,
  );
});
