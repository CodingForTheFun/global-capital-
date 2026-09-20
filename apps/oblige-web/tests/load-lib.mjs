import { readFileSync } from 'node:fs';
import ts from 'typescript';
const urls = new Map();
export function moduleUrl(name) {
  const url = new URL(`../lib/${name.replace(/\.ts$/, '')}.ts`, import.meta.url);
  if (urls.has(url.href)) return urls.get(url.href);
  let js = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  js = js.replace(/from (['"])(\.\/[^'"]+)\1/g, (_, quote, path) => `from ${JSON.stringify(moduleUrl(path.slice(2)))}`);
  const result = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  urls.set(url.href, result);
  return result;
}
export const loadLib = name => import(moduleUrl(name));
