import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const terminal = readFileSync(new URL('../components/terminal-board.tsx', import.meta.url), 'utf8');
const betHoops = readFileSync(new URL('../components/bethoops-board.tsx', import.meta.url), 'utf8');

for (const [name, source] of [['terminal board', terminal], ['BetHoops board', betHoops]]) {
  test(name + ' chunks model requests at the backend 24-prop limit', () => {
    assert.match(source, /const batchSize = 24;/);
    assert.match(source, /jobs\.slice\(offset, offset \+ batchSize\)/);
    assert.match(source, /for \(let offset = 0; offset < jobs\.length; offset \+= batchSize\)/);
    assert.doesNotMatch(source, /props: jobs\.map\(/);
  });
}
