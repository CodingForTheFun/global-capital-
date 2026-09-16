import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'oblige-presentation-'));
  mkdirSync(path.join(dir, 'lib/autoscout'), { recursive: true });
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  cpSync(
    path.join(repo, 'lib/autoscout/oblige-props-visual-runtime-patch.mjs'),
    path.join(dir, 'lib/autoscout/oblige-props-visual-runtime-patch.mjs'),
  );
  cpSync(
    path.join(repo, 'scripts/patch-obligeprops-presentation.mjs'),
    path.join(dir, 'scripts/patch-obligeprops-presentation.mjs'),
  );
  return dir;
}

function run(dir) {
  execFileSync(process.execPath, [path.join(dir, 'scripts/patch-obligeprops-presentation.mjs')], {
    cwd: dir,
    stdio: 'pipe',
  });
}

test('final presentation hardening removes the sloppy search glyph and legacy book rail', () => {
  const dir = fixture();
  try {
    run(dir);
    const source = readFileSync(path.join(dir, 'lib/autoscout/oblige-props-visual-runtime-patch.mjs'), 'utf8');
    assert.match(source, /\.asHeaderSearchIcon:before/);
    assert.match(source, /\.asHeaderSearchIcon:after/);
    assert.doesNotMatch(source, />⌕<\/span>/);
    assert.match(source, /#as5 \.asBookRail\{display:none!important\}/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('desktop prop board is patched into a denser research-terminal layout without replacing the book selector', () => {
  const dir = fixture();
  try {
    run(dir);
    const source = readFileSync(path.join(dir, 'lib/autoscout/oblige-props-visual-runtime-patch.mjs'), 'utf8');
    assert.match(source, /Oblige Props research-terminal desktop density pass/);
    assert.match(source, /#as5 \.asGrid,#as5 \.asList\{display:grid!important;grid-template-columns:1fr!important/);
    assert.match(source, /#as5 \.asPropBookStrip\{display:grid!important;grid-template-columns:minmax\(210px,300px\)/);
    assert.match(source, /#as5 \.asBadge\{min-height:54px!important/);
    assert.match(source, /@media\(min-width:1051px\)/);
    assert.doesNotMatch(source, /@media\(max-width:700px\)\{[^}]*\.asPropBookStrip\{display:grid!important;grid-template-columns:minmax\(210px,300px\)/s);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('late customer copy is normalized to Oblige Props and the patch is idempotent', () => {
  const dir = fixture();
  try {
    run(dir);
    const file = path.join(dir, 'lib/autoscout/oblige-props-visual-runtime-patch.mjs');
    const first = readFileSync(file, 'utf8');
    assert.match(first, /function normalizeBrand\(\)/);
    assert.match(first, /Oblige Props research/);
    assert.match(first, /split\('Auto Scout'\)\.join\('Oblige Props'\)/);
    run(dir);
    assert.equal(readFileSync(file, 'utf8'), first, 'a second build pass must not duplicate presentation patches');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
