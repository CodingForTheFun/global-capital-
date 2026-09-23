#!/usr/bin/env node
/**
 * Scope guard for the daily site-improvement employee.
 *
 * The employee may only change the website's presentation code. Anything that
 * moves data, money, identity or security is out of bounds, whatever the
 * change looks like. Run before every employee PR:
 *
 *   node scripts/site-employee/check-scope.mjs [base=origin/production-stable]
 *
 * Exits 1 and lists the offending paths when the diff leaves the allowed area.
 */
import { execFileSync } from 'node:child_process';

// Allowed: UI code and its tests, plus the employee's own notes.
const ALLOWED = [
  /^apps\/oblige-web\/(app|components|lib|hooks)\//,
  /^apps\/oblige-web\/tests\//,
  /^docs\/site-employee\//,
];

// Blocked even inside an allowed folder: data routes, auth, payments and the
// security headers. Checked first, so an allowed prefix can't let them through.
const BLOCKED = [
  /^apps\/oblige-web\/app\/api\//,
  /^apps\/oblige-web\/lib\/api\.ts$/,
  /^apps\/oblige-web\/components\/sign-in\.tsx$/,
  /^apps\/oblige-web\/components\/account-view\.tsx$/,
  /(^|\/)(auth|billing|checkout|paypal|stripe|supabase|provider|providers|ingestion|data-sources)(\/|\.|-)/i,
  /^lib\/web\/public-surface\.mjs$/,
  /^\.github\//,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)Dockerfile$/,
  /(^|\/)next\.config\.[a-z]+$/,
];

export function outOfScope(paths) {
  return paths.filter((path) => BLOCKED.some((re) => re.test(path)) || !ALLOWED.some((re) => re.test(path)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2] || 'origin/production-stable';
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const bad = outOfScope(changed);
  if (bad.length) {
    console.error('Out of scope for the site employee:\n' + bad.map((path) => '  ' + path).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Scope OK: ${changed.length} file(s), all website presentation code.`);
  }
}
