// 使い方: npm install && node build.mjs  → index.html（単一ファイル・オフライン動作）を生成
import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/app.js'], bundle: true, format: 'iife', minify: true, write: false, platform: 'browser', target: 'es2020', legalComments: 'eof', logLevel: 'warning' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const wasm = fs.readFileSync('node_modules/web-ifc/web-ifc.wasm').toString('base64');
const html = fs.readFileSync('src/template.html', 'utf8').split('/*__WASM__*/').join(wasm).split('/*__BUNDLE__*/').join(js);
fs.writeFileSync('index.html', html);
console.log('index.html', (html.length / 1048576).toFixed(2), 'MB');
