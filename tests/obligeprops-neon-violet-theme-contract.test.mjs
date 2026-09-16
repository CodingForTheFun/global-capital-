import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyObligePropsNeonVioletTheme } from '../scripts/patch-obligeprops-neon-violet-theme.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const themeSource = readFileSync(path.join(repoRoot, 'scripts/patch-obligeprops-neon-violet-theme.mjs'), 'utf8');
const prepareSource = readFileSync(path.join(repoRoot, 'scripts/prepare-edge-deploy.mjs'), 'utf8');

test('neon violet is the Oblige Props brand color while data semantics stay distinct', () => {
  assert.match(themeSource, /--op-purple:#a64dff/);
  assert.match(themeSource, /--op-magenta:#e056ff/);
  assert.match(themeSource, /--op-green:#2ee6a6/);
  assert.match(themeSource, /--op-red:#ff5470/);
  assert.match(themeSource, /--op-gold:#f6c453/);
  assert.match(themeSource, /\.asDetailLineRow \.asSideBtn\.on\.under/);
  assert.doesNotMatch(themeSource, /\.asDetailLineRow \.asSideBtn\.on\.over/);
  assert.match(themeSource, /@media\(max-width:700px\)/);
  assert.match(themeSource, /Oblige Props neon-violet landing palette/);
  assert.match(themeSource, /Oblige Props neon-violet public-home palette/);
  assert.match(themeSource, /lib\/web\/public-surface\.mjs/);
});

test('production preparation applies the violet pass after the existing presentation system', () => {
  assert.match(prepareSource, /import \{ applyObligePropsNeonVioletTheme \} from '\.\/patch-obligeprops-neon-violet-theme\.mjs';/);
  assert.match(prepareSource, /import '\.\/patch-obligeprops-presentation\.mjs';[\s\S]*applyObligePropsNeonVioletTheme\(\);/);
  assert.doesNotMatch(themeSource, /fetch\s*\(/);
  assert.doesNotMatch(themeSource, /PROPLINE|THE_ODDS_API_KEY|STRIPE_SECRET|SUPABASE_SERVICE/i);
});

test('violet theme patch is idempotent and only changes presentation surfaces', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'oblige-violet-'));
  try {
    for (const dir of ['lib/autoscout', 'lib/auth', 'lib/web', 'public']) mkdirSync(path.join(root, dir), { recursive: true });

    const runtime = path.join(root, 'lib/autoscout/oblige-props-visual-runtime-patch.mjs');
    const landing = path.join(root, 'lib/auth/landing.mjs');
    const publicSurface = path.join(root, 'lib/web/public-surface.mjs');
    const homeCss = path.join(root, 'public/home-v2.css');
    const homeHtml = path.join(root, 'public/index.html');
    const manifest = path.join(root, 'public/manifest.webmanifest');

    writeFileSync(runtime, 'export const css = `<style>BASE</style>`;\n');
    writeFileSync(landing, 'export const html = `<style>BASE</style></head><body>`;\n');
    writeFileSync(publicSurface, 'const tags = [`<meta name="theme-color" content="#070d18">`];\nconst manifest = {\n  background_color: \'#070d18\',\n  theme_color: \'#070d18\',\n};\n');
    writeFileSync(homeCss, ':root{--green:#62e6c8}\n');
    writeFileSync(homeHtml, '<meta name="theme-color" content="#07111f" />\n');
    writeFileSync(manifest, '{\n  "background_color": "#0a101b",\n  "theme_color": "#0a101b"\n}\n');

    const first = applyObligePropsNeonVioletTheme(root);
    assert.equal(first.applied, true);
    assert.match(readFileSync(runtime, 'utf8'), /Oblige Props neon-violet brand palette/);
    assert.match(readFileSync(runtime, 'utf8'), /--op-purple:#a64dff/);
    assert.match(readFileSync(landing, 'utf8'), /Oblige Props neon-violet landing palette/);
    assert.match(readFileSync(homeCss, 'utf8'), /Oblige Props neon-violet public-home palette/);
    assert.match(readFileSync(homeHtml, 'utf8'), /#090313/);
    assert.match(readFileSync(manifest, 'utf8'), /"background_color": "#05020b"/);
    assert.match(readFileSync(manifest, 'utf8'), /"theme_color": "#090313"/);
    assert.match(readFileSync(publicSurface, 'utf8'), /<meta name="theme-color" content="#090313">/);
    assert.match(readFileSync(publicSurface, 'utf8'), /background_color: '#05020b'/);
    assert.match(readFileSync(publicSurface, 'utf8'), /theme_color: '#090313'/);

    const second = applyObligePropsNeonVioletTheme(root);
    assert.equal(second.applied, false);
    assert.equal(readFileSync(runtime, 'utf8').split('/* Oblige Props neon-violet brand palette. */').length - 1, 1);
    assert.equal(readFileSync(landing, 'utf8').split('/* Oblige Props neon-violet landing palette. */').length - 1, 1);
    assert.equal(readFileSync(homeCss, 'utf8').split('/* Oblige Props neon-violet public-home palette. */').length - 1, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
