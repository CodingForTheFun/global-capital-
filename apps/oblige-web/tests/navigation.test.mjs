import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../components/site-chrome.tsx', import.meta.url), 'utf8');

function arrayBlock(name) {
  const start = source.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf('];', start);
  assert.notEqual(end, -1, `${name} should terminate`);
  return source.slice(start, end);
}

test('Live Moves stays directly visible in primary navigation', () => {
  assert.match(arrayBlock('NAV'), /href:\s*['"]\/moves['"]/);
});

test('Live Moves stays directly visible in the mobile bottom dock', () => {
  const mobileNav = arrayBlock('MOBILE_NAV');
  assert.match(mobileNav, /href:\s*['"]\/moves['"]/);
  assert.match(mobileNav, /label:\s*['"]Moves['"]/);
});
