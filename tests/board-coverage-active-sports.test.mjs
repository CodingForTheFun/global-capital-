import test from 'node:test';
import assert from 'node:assert/strict';
import { patchBoardCoverageUi } from '../lib/autoscout/board-coverage-runtime-patch.mjs';

function fixture() {
 return `var SPORTS=['NFL'];
var payload={props:[],data:{lines:[]}};var sport='NFL',query='',sideFilter='all',sortBy='shuffle',page=1;
function groups(allBooks=false){return [];}
function renderSports(){return '';}
function viewGroups(){return groups();}
function lineOnlyPolicy(g){return null;}
function propRoute(){try{var match=location.hash.match(/^#prop\\/([^/]+)\\/(.+)$/);return match&&SPORTS.includes(match[1])?{sport:match[1],key:decodeURIComponent(match[2])}:null;}catch{return null;}}
`;
}

test('served client derives visible sport controls from the current board payload', () => {
 const out=patchBoardCoverageUi(fixture());
 assert.match(out,/function boardCoverageAvailableSports\(\)/);
 assert.match(out,/payload&&payload\.props/);
 assert.match(out,/payload&&payload\.data&&payload\.data\.lines/);
 assert.match(out,/var visible=boardCoverageAvailableSports\(\)/);
 assert.match(out,/boardCoverageSportLabel\(v\)/);
 assert.match(out,/boardCoverageSportLabel\(s\)/);
 assert.match(out,/CSS\.escape\(e\.target\.value\)/);
 assert.doesNotMatch(out,/function boardCoverageAvailableSports\(\)[\s\S]*?\bfetch\s*\(/);
 assert.doesNotMatch(out,/function boardCoverageAvailableSports\(\)[\s\S]*?\bsetInterval\s*\(/);
 assert.doesNotThrow(()=>new Function(out));
});
