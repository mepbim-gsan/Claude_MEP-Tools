import * as WEBIFC from 'web-ifc';
import { analyzeModel, scanBytes, parseHeader, initPretty, categoryOf, CATS } from './analyze.js';

const APP_VERSION = 'v2026-11-17';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
document.querySelectorAll('.app-ver').forEach((el) => (el.textContent = APP_VERSION));
initPretty(WEBIFC);

const api = new WEBIFC.IfcAPI();
let apiReady = null;
function initIfc() {
  if (apiReady) return apiReady;
  const bin = Uint8Array.from(atob($('#wasm-b64').textContent.trim()), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: 'application/wasm' }));
  apiReady = api.Init(() => url, true);
  return apiReady;
}
function busy(msg, p) {
  $('#busy').style.display = msg ? 'flex' : 'none';
  if (msg) $('#busyMsg').textContent = msg;
  $('#busyBar').style.width = Math.round((p || 0) * 100) + '%';
}

// ---------- 読み込み ----------
const models = [];
async function analyzeFile(file) {
  await initIfc();
  const name = file.name.replace(/\.ifc$/i, '');
  busy(`読み込み中: ${file.name}（${mb(file.size)}）`, 0);
  await yieldUI();
  const buf = new Uint8Array(await file.arrayBuffer());
  busy(`容量を集計中: ${file.name}`, 0.02);
  await yieldUI();
  const scan = scanBytes(buf);
  const header = parseHeader(scan.header);
  busy(`解析中: ${file.name}`, 0.05);
  await yieldUI();
  const mid = api.OpenModel(buf, { COORDINATE_TO_ORIGIN: false });
  if (mid < 0) throw new Error('IFCを開けませんでした');
  try {
    const r = await analyzeModel(api, WEBIFC, mid, (p, msg) => busy(`${file.name}: ${msg}`, 0.05 + p * 0.95), yieldUI);
    models.push({ name, size: file.size, header, scan, r });
  } finally {
    api.CloseModel(mid);
    busy('');
  }
}
let queue = Promise.resolve();
function openFiles(files) {
  for (const f of files) {
    queue = queue.then(async () => {
      try {
        await analyzeFile(f);
        render();
      } catch (e) {
        console.error(e);
        busy('');
        alert(`解析に失敗しました: ${f.name}\n${e.message || e}`);
      }
    });
  }
}
$('#btnOpen').onclick = () => $('#file').click();
$('#file').onchange = (e) => { openFiles([...e.target.files]); e.target.value = ''; };
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragover'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragover'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  openFiles([...e.dataTransfer.files].filter((f) => /\.ifc$/i.test(f.name)));
});

// ---------- 書式 ----------
const mb = (b) => (b >= 104858 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
const pct = (x) => (isFinite(x) ? (x * 100).toFixed(1) + '%' : '-');
const num = (x) => (typeof x === 'number' ? (Number.isInteger(x) ? x.toLocaleString() : x.toLocaleString(undefined, { maximumFractionDigits: 2 })) : x ?? '');
const ratio = (a, b) => (b ? a / b : NaN);

// ---------- タブ定義 ----------
// col: [label, fn(row), kind]  kind: 'num' | 'pct' | 'text' | 'bar'
const classCols = {
  type: [
    ['IFCクラス', (a) => a.cls], ['要素数', (a) => a.n, 'num'], ['タイプあり', (a) => a.typed, 'num'], ['タイプあり率', (a) => a.typedPct, 'pct'],
    ['タイプ数', (a) => a.nTypes, 'num'], ['1タイプあたり要素数', (a) => ratio(a.typed, a.nTypes), 'num'], ['判定', (a) => a.verdict],
  ],
  geo: [
    ['IFCクラス', (a) => a.cls], ['要素数', (a) => a.n, 'num'], ['Mapped（共有形状）', (a) => a.mapped, 'num'], ['独自形状', (a) => a.own, 'num'],
    ['混在', (a) => a.mixed, 'num'], ['形状なし', (a) => a.none, 'num'], ['Mapped率', (a) => a.mappedPct, 'pct'],
    ['タイプの形状を参照', (a) => a.srcIsType, 'num'], ['形状ソース数', (a) => a.geoSources, 'num'], ['再利用率（要素/ソース）', (a) => a.reuse, 'num'],
    ['独自形状を他要素と共有', (a) => a.sharedOwn, 'num'],
  ],
  prop: [
    ['IFCクラス', (a) => a.cls], ['要素数', (a) => a.n, 'num'], ['インスタンスPset/要素', (a) => ratio(a.instPsets, a.n), 'num'],
    ['インスタンスプロパティ/要素', (a) => ratio(a.instProps, a.n), 'num'], ['タイプのプロパティ/要素', (a) => ratio(a.typeProps, a.n), 'num'],
    ['タイプ側の比率', (a) => a.typePropShare, 'pct'], ['共有Pset率', (a) => ratio(a.sharedPsets, a.instPsets), 'pct'],
    ['タイプと同値のインスタンスプロパティ', (a) => a.dupType, 'num'], ['同（比率）', (a) => ratio(a.dupType, a.instProps), 'pct'],
  ],
  dupCls: [
    ['IFCクラス', (a) => a.cls], ['要素数', (a) => a.n, 'num'], ['タイプありのインスタンスプロパティ', (a) => a.typedInstProps, 'num'],
    ['タイプへ移せるプロパティ実体', (a) => a.dup, 'num'], ['比率', (a) => ratio(a.dup, a.typedInstProps), 'pct'],
  ],
};
const TABS = [
  { id: 'sum', label: '概要', desc: 'モデルごとの構成の要約です。複数のモデルを読み込むと横に並べて比較できます。判定はタイプあり率（80%以上でタイプ構成）と、形状が IfcMappedItem で共有されている比率（Mapped率 50%以上）から決めています。', compare: true },
  { id: 'type', label: '① タイプ', variants: [['cls', 'クラス別'], ['list', 'タイプ一覧']], desc: '要素が IfcRelDefinesByType でタイプ（IfcXxxType / Style）に関連付けられているかを集計します。タイプ一覧の「要素数 0」は使われていないタイプです。' },
  { id: 'geo', label: '② 形状', variants: [['cls', 'クラス別'], ['rep', '表現種別']], desc: '形状（Body）が IfcMappedItem（RepresentationMap の共有）か、要素ごとの独自形状かを集計します。再利用率は「形状を持つ要素数 ÷ 形状ソース数」で、1.0 は使い回しなしです。表現種別の Brep / Tessellation はファイルが大きくなりやすい形式です。' },
  { id: 'prop', label: '③ プロパティ', desc: 'プロパティがタイプ側（HasPropertySets）とインスタンス側（IfcRelDefinesByProperties）のどちらにあるかを集計します。共有Pset率は、1つの Pset 実体を複数の要素で共有している割合です。「タイプと同値のインスタンスプロパティ」は、タイプにある同名・同値のプロパティをインスタンスにも重複して出力しているものです。' },
  { id: 'dup', label: '④ 重複候補', variants: [['key', 'プロパティ別'], ['cls', 'クラス別']], desc: '同じタイプの全インスタンスで値が同じなのに、プロパティ実体が要素ごとに別々に出力されているものです（タイプに移すか Pset を共有すれば減らせる候補）。「削減可能な実体数」は実体数 − 1 をタイプごとに合計した値です。タイプのない要素は対象外です。' },
  { id: 'size', label: '⑤ 容量', variants: [['cat', '分類別'], ['ent', 'エンティティ別']], desc: 'ファイル内の各エンティティ（#n=...;）のバイト数を集計します。形状が大半を占める場合は、形状の共有（タイプ化）や表現形式（Brep → SweptSolid）が容量削減の鍵になります。' },
  { id: 'hdr', label: '⑥ 出力情報', desc: 'ファイルヘッダーと IfcApplication から、出力したアプリ・エクスポータ・ビュー定義を表示します（作成者・組織は表示しません）。', compare: true },
];
let tab = 'sum';
const variantOf = {};
let modelIdx = 'all';
let modelPicked = false;
let lastTable = null;

function renderTabs() {
  $('#tabs').innerHTML = TABS.map((t) => `<button data-t="${t.id}" class="${t.id === tab ? 'on' : ''}">${t.label}</button>`).join('');
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  tab = b.dataset.t;
  render();
});

function render() {
  renderModels();
  renderTabs();
  const has = models.length > 0;
  $('#drop').style.display = has ? 'none' : 'flex';
  $('#view').style.display = has ? 'flex' : 'none';
  if (!has) return;
  const T = TABS.find((t) => t.id === tab);
  $('#desc').textContent = T.desc;
  const sel = $('#modelSel');
  const opts = (models.length > 1 ? ['<option value="all">全モデル（比較）</option>'] : []).concat(models.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`));
  sel.innerHTML = opts.join('');
  if (!modelPicked) modelIdx = models.length > 1 ? 'all' : '0';
  if (modelIdx !== 'all' && +modelIdx >= models.length) modelIdx = models.length > 1 ? 'all' : '0';
  sel.value = modelIdx;
  $('#modelSelWrap').style.display = T.compare ? 'none' : '';
  const vw = T.variants ? `<select id="variant">${T.variants.map(([v, l]) => `<option value="${v}"${(variantOf[tab] || T.variants[0][0]) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>` : '';
  $('#info').innerHTML = vw;
  if (T.variants) $('#variant').onchange = (e) => { variantOf[tab] = e.target.value; render(); };
  const v = variantOf[tab] || (T.variants ? T.variants[0][0] : '');
  const ms = modelIdx === 'all' ? models : [models[+modelIdx]];
  const multi = ms.length > 1;
  const withModel = (cols) => (multi ? [['モデル', (r) => r.__m], ...cols] : cols);
  const rowsOf = (fn) => ms.flatMap((m) => fn(m).map((r) => Object.assign(Object.create(r), { __m: m.name })));
  if (tab === 'sum') return table(...summary());
  if (tab === 'hdr') return table(...headerInfo());
  if (tab === 'type' && v === 'cls') return table(withModel(classCols.type), rowsOf((m) => [m.r.total, ...m.r.classes]));
  if (tab === 'type') return table(withModel([['タイプのクラス', (t) => t.cls], ['タイプ名', (t) => t.name], ['要素のクラス', (t) => t.ecls], ['要素数', (t) => t.n, 'num'], ['Pset数', (t) => t.psets, 'num'], ['RepresentationMap数', (t) => t.maps, 'num']]), rowsOf((m) => m.r.typeRows));
  if (tab === 'geo' && v === 'cls') return table(withModel(classCols.geo), rowsOf((m) => [m.r.total, ...m.r.classes]));
  if (tab === 'geo') return table(withModel([['表現種別', (x) => x[0]], ['要素数', (x) => x[1], 'num'], ['比率', (x) => x.share, 'bar']]), rowsOf((m) => m.r.repKinds.map((x) => Object.assign([...x], { share: x[1] / m.r.total.n }))));
  if (tab === 'prop') return table(withModel(classCols.prop), rowsOf((m) => [m.r.total, ...m.r.classes]));
  if (tab === 'dup' && v === 'cls') return table(withModel(classCols.dupCls), rowsOf((m) => [m.r.total, ...m.r.classes]));
  if (tab === 'dup') return table(withModel([['Pset', (d) => d.key.split('\t')[0]], ['プロパティ', (d) => d.key.split('\t')[1]], ['該当タイプ数', (d) => d.types, 'num'], ['インスタンス数', (d) => d.instances, 'num'], ['削減可能な実体数', (d) => d.reducible, 'num'], ['要素のクラス', (d) => d.classes]]), rowsOf((m) => m.r.dupKeys));
  if (tab === 'size' && v === 'cat') return table(withModel([['分類', (x) => x.cat], ['件数', (x) => x.count, 'num'], ['容量', (x) => mb(x.bytes)], ['比率', (x) => x.share, 'bar']]), rowsOf((m) => sizeByCat(m)));
  if (tab === 'size') return table(withModel([['エンティティ', (x) => x.name], ['分類', (x) => categoryOf(x.name)], ['件数', (x) => x.count, 'num'], ['容量', (x) => mb(x.bytes)], ['平均バイト', (x) => Math.round(x.bytes / x.count), 'num'], ['比率', (x) => x.bytes / x.total, 'bar']]), rowsOf((m) => m.scan.types.map((t) => Object.assign(Object.create(t), { total: m.scan.total })).sort((a, b) => b.bytes - a.bytes)));
}
$('#modelSel').onchange = (e) => { modelIdx = e.target.value; modelPicked = true; render(); };

function sizeByCat(m) {
  const map = new Map([...CATS.map(([c]) => c), 'その他'].map((c) => [c, { cat: c, count: 0, bytes: 0 }]));
  for (const t of m.scan.types) { const x = map.get(categoryOf(t.name)); x.count += t.count; x.bytes += t.bytes; }
  return [...map.values()].filter((x) => x.count).map((x) => Object.assign(x, { share: x.bytes / m.scan.total })).sort((a, b) => b.bytes - a.bytes);
}

function summary() {
  const cols = [['項目', (r) => r.k], ...models.map((m) => [m.name, (r) => r.v[models.indexOf(m)], 'auto'])];
  const R = [];
  const sec = (k) => R.push({ k, sec: true, v: [] });
  const row = (k, fn) => R.push({ k, v: models.map(fn) });
  sec('判定');
  row('全体の判定', (m) => m.r.total.verdict);
  row('出力アプリ', (m) => m.r.info.apps.join(', ') || m.header.originating);
  row('スキーマ / ビュー定義', (m) => `${m.header.schema} / ${m.header.description.replace(/^ViewDefinition\s*/i, '')}`);
  row('ファイルサイズ', (m) => mb(m.size));
  sec('① タイプ');
  row('要素数', (m) => num(m.r.total.n));
  row('タイプあり率', (m) => pct(m.r.total.typedPct));
  row('タイプ数（うち未使用）', (m) => `${num(m.r.nTypes)}（${num(m.r.unusedTypes)}）`);
  row('1タイプあたり要素数', (m) => num(ratio(m.r.total.typed, m.r.total.nTypes)));
  row('IfcBuildingElementProxy', (m) => `${num(m.r.info.proxies)}（${pct(m.r.info.proxies / m.r.total.n)}）`);
  sec('② 形状');
  row('Mapped率（共有形状）', (m) => pct(m.r.total.mappedPct));
  row('独自形状の要素', (m) => num(m.r.total.own));
  row('再利用率（要素/形状ソース）', (m) => num(m.r.total.reuse));
  row('主な表現種別', (m) => m.r.repKinds.slice(0, 3).map(([k, n]) => `${k} ${pct(n / m.r.total.n)}`).join(' ／ '));
  sec('③ プロパティ');
  row('インスタンスプロパティ/要素', (m) => num(ratio(m.r.total.instProps, m.r.total.n)));
  row('タイプのプロパティ/要素', (m) => num(ratio(m.r.total.typeProps, m.r.total.n)));
  row('タイプ側の比率', (m) => pct(m.r.total.typePropShare));
  row('Pset実体の共有率', (m) => pct(ratio(m.r.psetsShared, m.r.psetsTotal)));
  row('タイプと同値のインスタンスプロパティ', (m) => `${num(m.r.total.dupType)}（${pct(ratio(m.r.total.dupType, m.r.total.instProps))}）`);
  sec('④ 重複候補');
  row('タイプへ移せるプロパティ実体', (m) => `${num(m.r.total.dup)}（${pct(ratio(m.r.total.dup, m.r.total.instProps))}）`);
  sec('⑤ 容量');
  for (const c of [...CATS.map(([c]) => c), 'その他']) row(c, (m) => { const x = sizeByCat(m).find((y) => y.cat === c); return x ? `${mb(x.bytes)}（${pct(x.share)}）` : '-'; });
  return [cols, R];
}
function headerInfo() {
  const cols = [['項目', (r) => r.k], ...models.map((m, i) => [m.name, (r) => r.v[i]])];
  const R = [];
  const row = (k, fn) => R.push({ k, v: models.map(fn) });
  row('スキーマ', (m) => m.header.schema);
  row('ビュー定義（FILE_DESCRIPTION）', (m) => m.header.description);
  row('作成日時', (m) => m.header.timestamp);
  row('プリプロセッサ（エクスポータ）', (m) => m.header.preprocessor);
  row('出力元システム', (m) => m.header.originating);
  row('IfcApplication', (m) => m.r.info.apps.join(', '));
  row('長さ単位', (m) => m.r.info.lengthUnit);
  row('ファイルサイズ', (m) => mb(m.size));
  row('エンティティ数', (m) => num(m.scan.count));
  row('エンティティ種類数', (m) => num(m.scan.types.length));
  return [cols, R];
}

// ---------- テーブル ----------
let sortState = { tab: '', col: -1, dir: 1 };
function cellHTML(v, kind) {
  if (kind === 'pct') return `<td class="num">${pct(v)}</td>`;
  if (kind === 'num') return `<td class="num">${isFinite(v) ? num(v) : '-'}</td>`;
  if (kind === 'bar') return `<td><span class="bar" style="width:${Math.max(1, Math.round(v * 160))}px"></span>${pct(v)}</td>`;
  return `<td title="${esc(v)}">${esc(v)}</td>`;
}
function table(cols, rows) {
  const key = tab + (variantOf[tab] || '');
  if (sortState.tab !== key) sortState = { tab: key, col: -1, dir: 1 };
  let rs = rows.filter((r) => !r.sec);
  const fixedTop = rs.filter((r) => r.cls === '（全体）');
  if (sortState.col >= 0 && !TABS.find((t) => t.id === tab).compare) {
    const f = cols[sortState.col][1], d = sortState.dir;
    rs = rs.filter((r) => r.cls !== '（全体）').sort((a, b) => {
      const x = f(a), y = f(b);
      if (typeof x === 'number' || typeof y === 'number') return ((isFinite(x) ? x : -1) - (isFinite(y) ? y : -1)) * d;
      return String(x).localeCompare(String(y), 'ja', { numeric: true }) * d;
    });
    rs = [...fixedTop, ...rs];
  } else rs = rows;
  lastTable = { cols, rows: rs };
  $('#tbl').innerHTML = `<thead><tr>${cols.map((c, i) => `<th data-i="${i}">${esc(c[0])}${sortState.col === i ? (sortState.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>` +
    rs.map((r) => (r.sec ? `<tr><td class="sec" colspan="${cols.length}">${esc(r.k)}</td></tr>` : `<tr>${cols.map((c) => cellHTML(c[1](r), c[2])).join('')}</tr>`)).join('') + '</tbody>';
}
$('#tbl').addEventListener('click', (e) => {
  const th = e.target.closest('th');
  if (!th) return;
  const i = +th.dataset.i;
  sortState.dir = sortState.col === i ? -sortState.dir : (i === 0 ? 1 : -1);
  sortState.col = i;
  render();
});
$('#btnCsv').onclick = () => {
  if (!lastTable) return;
  const q = (x) => { const s = String(x ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = (v, kind) => (kind === 'pct' || kind === 'bar' ? (isFinite(v) ? (v * 100).toFixed(2) : '') : typeof v === 'number' ? (isFinite(v) ? Number(v.toFixed(4)) : '') : v);
  const lines = [lastTable.cols.map((c) => c[0]), ...lastTable.rows.map((r) => (r.sec ? [r.k] : lastTable.cols.map((c) => out(c[1](r), c[2]))))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.map((l) => l.map(q).join(',')).join('\r\n')], { type: 'text/csv' }));
  a.download = `ifc_analysis_${TABS.find((t) => t.id === tab).label.replace(/[①-⑥\s]/g, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function renderModels() {
  $('#models').style.display = models.length ? 'flex' : 'none';
  $('#models').innerHTML = models.map((m, i) => `<div class="mcard"><div class="t"><b title="${esc(m.name)}">${esc(m.name)}</b><button class="x" data-rm="${i}" title="閉じる">✕</button></div>
    <div class="meta">${esc(m.header.schema)} ／ ${mb(m.size)} ／ 要素 ${num(m.r.total.n)}<br>${esc(m.r.info.apps.join(', ') || m.header.originating)}</div>
    <div class="verdict">${esc(m.r.total.verdict)}</div></div>`).join('');
}
$('#models').addEventListener('click', (e) => {
  const i = e.target.dataset.rm;
  if (i === undefined) return;
  models.splice(+i, 1);
  render();
});

render();
initIfc().catch((e) => alert('web-ifc の初期化に失敗しました: ' + e.message));
window.__ifcanalyzer = { models, openFiles };
