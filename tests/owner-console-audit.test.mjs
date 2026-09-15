// The owner console has always had an audit endpoint and never shown it.
//
// /api/admin/audit is owner-gated and returns real recorded actions, and the
// access guide promises "all actions are logged" - but nothing in the console
// called it, so there was no way to read that log. These pin the three real
// things the console was missing, and pin that they are built from data the
// console already has rather than invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = () => readFileSync(new URL('../public/owner.html', import.meta.url), 'utf8');
const js = () => readFileSync(new URL('../public/owner.js', import.meta.url), 'utf8');
const css = () => readFileSync(new URL('../public/owner.css', import.meta.url), 'utf8');

test('the console reads the audit endpoint it has always had', () => {
  assert.match(js(), /request\('\/api\/admin\/audit'\)/, 'the audit log must actually be fetched');
  assert.match(html(), /id="auditList"/);
  assert.match(js(), /function renderAudit\(\)/);
});

// A console that blanks because a log failed is worse than one without a log.
test('an audit failure never takes the console down with it', () => {
  assert.match(js(), /request\('\/api\/admin\/audit'\)\.catch\(\(\) => null\)/);
  assert.match(js(), /state\.audit = Array\.isArray\(auditData\?\.entries\) \? auditData\.entries : \[\]/);
});

// An empty log means no action has been taken, which is not an error.
test('an empty audit log reads as empty, not broken', () => {
  assert.match(js(), /No owner actions recorded yet/);
});

test('recent signups come from accounts already loaded, not a new request', () => {
  const source = js();
  assert.match(source, /function renderRecentSignups\(\)/);
  assert.match(source, /state\.members[\s\S]{0,200}Date\.parse\(b\.createdAt\) - Date\.parse\(a\.createdAt\)/,
    'newest first, from the members already fetched');
  assert.match(html(), /id="recentSignups"/);
});

test('quick actions drive the real filter rather than a separate view', () => {
  const source = js();
  assert.match(source, /\[data-quick\]/);
  assert.match(source, /\$\('statusFilter'\)\.value =/, 'a shortcut must set the filter the users panel uses');
  assert.equal((html().match(/data-quick=/g) || []).length, 3);
});

test('the audit section is reachable from the section navigation', () => {
  assert.match(html(), /<a href="#audit">Audit log<\/a>/);
  assert.match(html(), /id="audit"/);
});

test('the additions use the existing panel styling', () => {
  const markup = html();
  assert.match(markup, /<section id="audit" class="panel glass">/);
  assert.match(css(), /\.feed-row\{/);
  assert.match(css(), /\.quick-btn\{/);
});

// Owner surfaces must never be indexed.
test('the console still refuses crawlers', () => {
  assert.match(html(), /name="robots" content="noindex,nofollow,noarchive"/);
});
