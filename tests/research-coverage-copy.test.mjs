import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculatePropSplits} from '../lib/analytics/research.mjs';
test('research coverage copy describes all-game denominator and honest N/A',()=>{
 const source=readFileSync(new URL('../apex-v2/scout-ui-v5.js',import.meta.url),'utf8');
 assert.ok(source.includes('Hit rate is hits / all eligible games. Pushes are not hits and end a hit streak.'));
 assert.ok(source.includes('N/A means no verified value or no prior matchup'));
 assert.ok(!source.includes('Pushes are excluded from hit rates.'));
 assert.equal(typeof calculatePropSplits,'function');
});
