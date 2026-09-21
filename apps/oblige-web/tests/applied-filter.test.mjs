import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const source = readFileSync(new URL('../components/applied-filter.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace("import './applied-filter.css';", ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
const { AppliedFilter } = module.exports;

function elements(node, type) {
  if (!React.isValidElement(node)) return [];
  return [...(node.type === type ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => elements(child, type))];
}
const fields = [
  { label: 'Opponent', value: 'BKN', other: 'NYK', reset: 'All' },
  { label: 'Season', value: '2026', other: '2025', reset: 'All' },
  { label: 'Home / Away', value: 'home', other: 'away', reset: 'All' },
  { label: 'Book', value: 'draftkings', other: 'fanduel', reset: 'Best prices' },
];
for (const field of fields) {
  test(`${field.label}: direct native select applies once without an editor`, () => {
    const calls = [];
    const tree = AppliedFilter({ label: field.label, value: field.value, options: [
      { value: 'all', label: field.reset }, { value: field.value, label: field.value }, { value: field.other, label: field.other },
    ], onApply: next => calls.push(next) });
    assert.equal(tree.type, 'label');
    assert.equal(tree.props['data-filter-mode'], 'instant');
    for (const removed of ['details', 'summary', 'form', 'button']) assert.equal(elements(tree, removed).length, 0);
    const selects = elements(tree, 'select');
    assert.equal(selects.length, 1);
    assert.equal(selects[0].props['aria-label'], field.label);
    assert.equal(selects[0].props.value, field.value);
    assert.deepEqual(calls, [], 'rendering must not change any filter');
    selects[0].props.onChange({ currentTarget: { value: field.other } });
    assert.deepEqual(calls, [field.other], 'selection applies synchronously, with no Apply step');
    selects[0].props.onChange({ currentTarget: { value: field.value } });
    selects[0].props.onChange({ currentTarget: { value: 'not-an-option' } });
    assert.deepEqual(calls, [field.other], 'unchanged and invalid choices are ignored');
    selects[0].props.onChange({ currentTarget: { value: 'all' } });
    assert.deepEqual(calls, [field.other, 'all']);
    const html = renderToStaticMarkup(tree);
    assert.ok(html.includes(field.reset));
    assert.ok(!html.includes('Only this filter will change'));
    assert.ok(!html.includes('op-filter-editor'));
  });
}
test('resetting one field preserves every other field', () => {
  let state = Object.fromEntries(fields.map(field => [field.label, field.value]));
  for (const field of fields) {
    const before = { ...state };
    const tree = AppliedFilter({ label: field.label, value: state[field.label], options: [
      { value: 'all', label: field.reset }, { value: field.value, label: field.value },
    ], onApply: next => { state = { ...state, [field.label]: next }; } });
    elements(tree, 'select')[0].props.onChange({ currentTarget: { value: 'all' } });
    assert.deepEqual(state, { ...before, [field.label]: 'all' });
  }
});
test('custom reset values remain available inside the dropdown', () => {
  const calls = [];
  const tree = AppliedFilter({ label: 'Example', value: 'active', clearValue: '', options: [
    { value: 'active', label: 'Active' },
  ], onApply: next => calls.push(next) });
  const select = elements(tree, 'select')[0];
  assert.equal(elements(select, 'option')[0].props.value, '');
  select.props.onChange({ currentTarget: { value: '' } });
  assert.deepEqual(calls, ['']);
});
test('an unavailable selection is not silently displayed or applied as All', () => {
  const calls = [];
  const tree = AppliedFilter({ label: 'Opponent', value: 'expired-team', options: [
    { value: 'all', label: 'All' }, { value: 'BKN', label: 'BKN' },
  ], onApply: next => calls.push(next) });
  const select = elements(tree, 'select')[0];
  const selected = elements(select, 'option').find(option => option.props.value === 'expired-team');
  assert.equal(selected.props.disabled, true);
  assert.equal(selected.props.children, 'Unavailable');
  assert.deepEqual(calls, []);
  select.props.onChange({ currentTarget: { value: 'BKN' } });
  assert.deepEqual(calls, ['BKN']);
});
