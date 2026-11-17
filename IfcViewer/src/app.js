import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import * as WEBIFC from 'web-ifc';

const APP_VERSION = 'v2026-11-17';

THREE.ColorManagement.enabled = false;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yieldUI = () => new Promise((r) => setTimeout(r, 0));
document.querySelectorAll('.app-ver').forEach((el) => (el.textContent = APP_VERSION));

// ---------- web-ifc ----------
const api = new WEBIFC.IfcAPI();
let apiReady = null;
function initIfc() {
  if (apiReady) return apiReady;
  const b64 = $('#wasm-b64').textContent.trim();
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: 'application/wasm' }));
  apiReady = api.Init(() => url, true);
  return apiReady;
}
const ids = (mid, type, inh = false) => {
  const v = api.GetLineIDsWithType(mid, type, inh);
  const a = new Array(v.size());
  for (let i = 0; i < a.length; i++) a[i] = v.get(i);
  return a;
};
const tname = (mid, id) => (api.GetNameFromTypeCode(api.GetLineType(mid, id)) || '').toUpperCase();
const val = (v) => (v == null ? '' : typeof v === 'object' && 'value' in v ? v.value : v);
const refs = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((r) => (typeof r === 'object' ? r.value : r)).filter((x) => x != null);

const SKIP_TYPES = new Set(['IFCOPENINGELEMENT', 'IFCOPENINGSTANDARDCASE', 'IFCVOIDINGFEATURE', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCPROJECT', 'IFCANNOTATION', 'IFCGRID', 'IFCVIRTUALELEMENT', 'IFCDISTRIBUTIONPORT', 'IFCSPATIALZONE', 'IFCEXTERNALSPATIALELEMENT']);
const SYS_TYPES = new Set(['IFCSYSTEM', 'IFCDISTRIBUTIONSYSTEM', 'IFCDISTRIBUTIONCIRCUIT', 'IFCBUILDINGSYSTEM', 'IFCBUILTSYSTEM']);
const prettyCls = (n) => {
  const u = String(n).toUpperCase();
  const m = CLS_NAMES[u];
  return m || (u.startsWith('IFC') ? 'Ifc' + u.slice(3).toLowerCase().replace(/(^|_)(\w)/g, (a, b, c) => c.toUpperCase()) : n);
};
const CLS_NAMES = {};
for (const ns of [WEBIFC.IFC2X3, WEBIFC.IFC4, WEBIFC.IFC4X3]) {
  for (const k of Object.keys(ns || {})) if (/^Ifc[A-Z]/.test(k)) CLS_NAMES[k.toUpperCase()] = k;
}

// ---------- three ----------
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.prepend(renderer.domElement);
const syncBg = () => { renderer.setClearColor(new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--view').trim() || '#e9ecf0')); needRender = true; };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncBg);
const labelRenderer = new CSS2DRenderer({ element: $('#labels') });
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 2.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(0.6, 1, 0.4);
scene.add(sun);
const persp = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
persp.position.set(20, 20, 20);
const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
ortho.up.set(0, 0, -1);
let camera = persp;
const ctl3 = new OrbitControls(persp, renderer.domElement);
ctl3.enableDamping = false;
const ctl2 = new OrbitControls(ortho, renderer.domElement);
ctl2.enableRotate = false;
ctl2.screenSpacePanning = true;
ctl2.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
ctl2.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
ctl2.enabled = false;
let needRender = true;
const req = () => (needRender = true);
syncBg();
ctl3.addEventListener('change', req);
ctl2.addEventListener('change', req);
const labelGroup = new THREE.Group();
scene.add(labelGroup);
const hlGroup = new THREE.Group();
scene.add(hlGroup);

const matOpaque = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
const capUniform = { value: 0 };
matOpaque.onBeforeCompile = (sh) => {
  sh.uniforms.uCap = capUniform;
  sh.fragmentShader = 'uniform float uCap;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (uCap > 0.5 && !gl_FrontFacing) gl_FragColor = vec4(0.28, 0.28, 0.3, 1.0);');
};
const matTrans = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false });
const matSpace = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
const matHL = new THREE.MeshBasicMaterial({ color: 0xff7a00, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
const pickMat = new THREE.ShaderMaterial({
  vertexShader: `attribute vec3 pickColor; varying vec3 vPick;
#include <clipping_planes_pars_vertex>
void main(){ vPick = pickColor;
#include <begin_vertex>
#include <project_vertex>
#include <clipping_planes_vertex>
}`,
  fragmentShader: `varying vec3 vPick;
#include <clipping_planes_pars_fragment>
void main(){
#include <clipping_planes_fragment>
gl_FragColor = vec4(vPick, 1.0); }`,
  side: THREE.DoubleSide,
  clipping: true,
});
const pickRT = new THREE.WebGLRenderTarget(1, 1);

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  persp.aspect = w / h;
  persp.updateProjectionMatrix();
  const hh = (ortho.top - ortho.bottom) / 2;
  ortho.left = -hh * (w / h);
  ortho.right = hh * (w / h);
  ortho.updateProjectionMatrix();
  req();
}
new ResizeObserver(resize).observe(viewport);
(function loop() {
  requestAnimationFrame(loop);
  if (!needRender) return;
  needRender = false;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
})();

// ---------- state ----------
const models = [];
const pickTable = [null];
let offset = null;
let nextModelNo = 1;
const classVis = new Map([['IfcSpace', false]]);
let isolateSet = null;
let selection = [];
let colorMode = 'original';
let colorKey = '';
let sysKey = '';
const sysHidden = new Set();
let mode2D = false;
let diffResult = null;
const MODEL_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16'];
const keyLabel = new Map();
const labelKey = new Map();
const ATTR_KEYS = [
  ['@Model', 'モデル'], ['@Class', 'IFCクラス'], ['@Name', 'Name'], ['@LongName', 'LongName'], ['@ObjectType', 'ObjectType'],
  ['@Tag', 'Tag'], ['@GlobalId', 'GlobalId'], ['@Type', 'タイプ名'], ['@Storey', '階'], ['@System', '系統（IfcSystem）'],
];
for (const [k, l] of ATTR_KEYS) { keyLabel.set(k, '属性 / ' + l); labelKey.set('属性 / ' + l, k); }
const keyOf = (label) => labelKey.get(label.trim()) || '';
const labelOf = (key) => keyLabel.get(key) || '';

// ---------- busy ----------
function busy(msg, p) {
  $('#busy').style.display = msg ? 'flex' : 'none';
  if (msg) $('#busyMsg').textContent = msg;
  $('#busyBar').style.width = Math.round((p || 0) * 100) + '%';
}

// ---------- loading ----------
function lengthScale(mid) {
  for (const uid of ids(mid, WEBIFC.IFCUNITASSIGNMENT)) {
    const ua = api.GetLine(mid, uid);
    for (const u of refs(ua.Units)) {
      const L = api.GetLine(mid, u);
      if (val(L.UnitType) !== 'LENGTHUNIT') continue;
      const t = tname(mid, u);
      if (t === 'IFCSIUNIT') return { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[val(L.Prefix)] || 1;
      const n = String(val(L.Name)).toUpperCase();
      if (n.includes('FOOT') || n.includes('FEET')) return 0.3048;
      if (n.includes('INCH')) return 0.0254;
    }
  }
  return 1;
}

class ChunkBuilder {
  constructor(kind) { this.kind = kind; this.parts = []; this.nv = 0; this.ni = 0; this.ranges = []; }
}

async function loadFile(file) {
  await initIfc();
  busy(`読み込み中: ${file.name}（${(file.size / 1048576).toFixed(1)} MB）`, 0);
  await yieldUI();
  let buf = new Uint8Array(await file.arrayBuffer());
  busy(`解析中: ${file.name}`, 0.02);
  await yieldUI();
  const mid = api.OpenModel(buf, { COORDINATE_TO_ORIGIN: false });
  buf = null;
  if (mid < 0) throw new Error('IFCを開けませんでした');
  const no = nextModelNo++;
  const m = {
    id: mid, no, name: file.name.replace(/\.ifc$/i, ''), size: file.size, schema: api.GetModelSchema(mid),
    color: MODEL_COLORS[(no - 1) % MODEL_COLORS.length], visible: true, elements: new Map(), chunks: [], group: new THREE.Group(),
    storeys: [], app: '', psetCache: new Map(), types: new Map(), objPsets: new Map(), objType: new Map(), keys: new Set(), indexed: false, indexProgress: 0, bbox: new THREE.Box3(),
  };
  m.group.name = m.name;
  try {
    const hdr = api.GetHeaderLine(mid, WEBIFC.FILE_NAME);
    const a5 = hdr?.arguments?.[5], a6 = hdr?.arguments?.[4];
    m.app = [val(a5), val(a6)].filter((x) => x && typeof x === 'string').join(' / ');
  } catch (e) { /* header optional */ }
  try {
    const appIds = ids(mid, WEBIFC.IFCAPPLICATION);
    if (appIds.length) {
      const a = api.GetLine(mid, appIds[0]);
      m.app = [val(a.ApplicationFullName), val(a.Version)].filter(Boolean).join(' ');
    }
  } catch (e) { /* optional */ }

  const scale = lengthScale(mid);
  // product ids
  const prodIds = ids(mid, WEBIFC.IFCPRODUCT, true).filter((id) => !SKIP_TYPES.has(tname(mid, id)));
  const builders = { opaque: [], trans: [], space: [] };
  const getBuilder = (kind) => {
    const arr = builders[kind];
    let b = arr[arr.length - 1];
    if (!b || b.nv > 3_000_000) { b = new ChunkBuilder(kind); arr.push(b); }
    return b;
  };
  const v3 = new THREE.Vector3();
  const BATCH = 400;
  for (let s = 0; s < prodIds.length; s += BATCH) {
    busy(`形状を生成中: ${file.name}（${Math.min(s + BATCH, prodIds.length)} / ${prodIds.length}）`, 0.05 + 0.75 * (s / prodIds.length));
    await yieldUI();
    api.StreamMeshes(mid, prodIds.slice(s, s + BATCH), (mesh) => {
      const eid = mesh.expressID;
      const cls = prettyCls(tname(mid, eid));
      const isSpace = cls === 'IfcSpace';
      let el = m.elements.get(eid);
      if (!el) {
        el = { eid, cls, isSpace, ranges: [], pick: pickTable.length, psets: [], typeId: 0, sys: [], storeyId: 0 };
        pickTable.push({ m, el });
        m.elements.set(eid, el);
      }
      const pg = mesh.geometries;
      const n = pg.size();
      for (let gi = 0; gi < n; gi++) {
        const g = pg.get(gi);
        const geom = api.GetGeometry(mid, g.geometryExpressID);
        const vd = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const id = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
        const t = g.flatTransformation;
        const c = g.color;
        if (!offset) offset = new THREE.Vector3(Math.round(t[12]), Math.round(t[13]), Math.round(t[14]));
        const kind = isSpace ? 'space' : c.w < 0.99 ? 'trans' : 'opaque';
        const b = getBuilder(kind);
        const nv = vd.length / 6;
        const pos = new Float32Array(nv * 3), nor = new Int8Array(nv * 3), col = new Uint8Array(nv * 3), pk = new Uint8Array(nv * 3);
        const cr = isSpace ? 140 : Math.round(c.x * 255), cg = isSpace ? 190 : Math.round(c.y * 255), cb = isSpace ? 255 : Math.round(c.z * 255);
        const p = el.pick, pr = (p >> 16) & 255, pgc = (p >> 8) & 255, pb = p & 255;
        for (let i = 0; i < nv; i++) {
          const x = vd[i * 6], y = vd[i * 6 + 1], z = vd[i * 6 + 2];
          pos[i * 3] = t[0] * x + t[4] * y + t[8] * z + t[12] - offset.x;
          pos[i * 3 + 1] = t[1] * x + t[5] * y + t[9] * z + t[13] - offset.y;
          pos[i * 3 + 2] = t[2] * x + t[6] * y + t[10] * z + t[14] - offset.z;
          const nx = vd[i * 6 + 3], ny = vd[i * 6 + 4], nz = vd[i * 6 + 5];
          v3.set(t[0] * nx + t[4] * ny + t[8] * nz, t[1] * nx + t[5] * ny + t[9] * nz, t[2] * nx + t[6] * ny + t[10] * nz).normalize();
          nor[i * 3] = v3.x * 127; nor[i * 3 + 1] = v3.y * 127; nor[i * 3 + 2] = v3.z * 127;
          col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb;
          pk[i * 3] = pr; pk[i * 3 + 1] = pgc; pk[i * 3 + 2] = pb;
        }
        const idx = new Uint32Array(id.length);
        for (let i = 0; i < id.length; i++) idx[i] = id[i] + b.nv;
        b.parts.push({ pos, nor, col, pk, idx });
        const last = b.ranges[b.ranges.length - 1];
        if (last && last.el === el && last.iStart + last.iCount === b.ni) {
          last.iCount += idx.length; last.vCount += nv;
        } else {
          const r = { el, b, iStart: b.ni, iCount: idx.length, vStart: b.nv, vCount: nv };
          b.ranges.push(r);
          el.ranges.push(r);
        }
        b.nv += nv; b.ni += idx.length;
        geom.delete();
      }
    });
  }
  for (const eid of prodIds) {
    if (m.elements.has(eid)) continue;
    const cls = prettyCls(tname(mid, eid));
    m.elements.set(eid, { eid, cls, isSpace: cls === 'IfcSpace', ranges: [], pick: 0, psets: [], typeId: 0, sys: [], storeyId: 0, noGeo: true });
  }
  busy(`メッシュを構築中: ${file.name}`, 0.82);
  await yieldUI();
  for (const kind of ['opaque', 'trans', 'space']) {
    for (const b of builders[kind]) {
      if (!b.nv) continue;
      const pos = new Float32Array(b.nv * 3), nor = new Int8Array(b.nv * 3), col = new Uint8Array(b.nv * 3), pk = new Uint8Array(b.nv * 3), idx = new Uint32Array(b.ni);
      let vo = 0, io = 0;
      for (const p of b.parts) {
        pos.set(p.pos, vo * 3); nor.set(p.nor, vo * 3); col.set(p.col, vo * 3); pk.set(p.pk, vo * 3); idx.set(p.idx, io);
        vo += p.pos.length / 3; io += p.idx.length;
      }
      b.parts = null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
      const colAttr = new THREE.BufferAttribute(col, 3, true);
      geo.setAttribute('color', colAttr);
      geo.setAttribute('pickColor', new THREE.BufferAttribute(pk, 3, true));
      const dispIdx = new THREE.BufferAttribute(idx.slice(), 1);
      geo.setIndex(dispIdx);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      m.bbox.union(geo.boundingBox);
      const mesh = new THREE.Mesh(geo, kind === 'opaque' ? matOpaque : kind === 'trans' ? matTrans : matSpace);
      if (kind === 'trans') mesh.renderOrder = 1;
      if (kind === 'space') mesh.renderOrder = 2;
      m.group.add(mesh);
      const chunk = { kind, mesh, geo, master: idx, dispIdx, origCol: col.slice(), colAttr, pos, ranges: b.ranges };
      for (const r of b.ranges) r.b = chunk;
      m.chunks.push(chunk);
    }
  }
  scene.add(m.group);

  busy(`属性を読み込み中: ${file.name}`, 0.88);
  await yieldUI();
  let k = 0;
  for (const el of m.elements.values()) {
    if (++k % 3000 === 0) { busy(`属性を読み込み中: ${file.name}（${k} / ${m.elements.size}）`, 0.88 + 0.08 * (k / m.elements.size)); await yieldUI(); }
    const L = api.GetLine(mid, el.eid);
    el.name = val(L.Name); el.gid = val(L.GlobalId); el.objType = val(L.ObjectType); el.tag = val(L.Tag); el.longName = val(L.LongName);
  }
  // spatial structure
  const parent = new Map();
  for (const rid of ids(mid, WEBIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const r = api.GetLine(mid, rid);
    const p = val(r.RelatingStructure);
    for (const c of refs(r.RelatedElements)) parent.set(c, p);
  }
  const SPATIAL = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE']);
  for (const rid of ids(mid, WEBIFC.IFCRELAGGREGATES)) {
    const r = api.GetLine(mid, rid);
    const p = val(r.RelatingObject);
    const pt = tname(mid, p);
    for (const c of refs(r.RelatedObjects)) {
      if (!parent.has(c)) parent.set(c, p);
      const el = m.elements.get(c);
      if (el && !SPATIAL.has(pt)) {
        const P = api.GetLine(mid, p);
        el.parent = { id: p, cls: prettyCls(pt), name: val(P.Name) };
      }
    }
  }
  const storeyIds = new Set(ids(mid, WEBIFC.IFCBUILDINGSTOREY));
  for (const sid of storeyIds) {
    const S = api.GetLine(mid, sid);
    let elev = 0;
    try { elev = api.GetWorldTransformMatrix(mid, val(S.ObjectPlacement))[14] * scale; } catch (e) { elev = Number(val(S.Elevation)) * scale || 0; }
    m.storeys.push({ id: sid, name: val(S.Name) || val(S.LongName) || '#' + sid, y: elev - offset.y });
  }
  m.storeys.sort((a, b) => a.y - b.y);
  const storeyById = new Map(m.storeys.map((s) => [s.id, s]));
  for (const el of m.elements.values()) {
    let p = parent.get(el.eid), guard = 0;
    while (p && !storeyIds.has(p) && guard++ < 20) p = parent.get(p);
    el.storey = p && storeyById.get(p) ? storeyById.get(p) : null;
  }
  // IfcSystem groups
  for (const rid of ids(mid, WEBIFC.IFCRELASSIGNSTOGROUP)) {
    const r = api.GetLine(mid, rid);
    const g = val(r.RelatingGroup);
    if (!g || !SYS_TYPES.has(tname(mid, g))) continue;
    const G = api.GetLine(mid, g);
    const gname = val(G.Name) || val(G.LongName) || '#' + g;
    for (const c of refs(r.RelatedObjects)) {
      const el = m.elements.get(c);
      if (el && !el.sys.includes(gname)) el.sys.push(gname);
    }
  }
  // space label anchors
  for (const el of m.elements.values()) if (el.isSpace && el.ranges.length) el.anchor = spaceAnchor(el);

  for (const el of m.elements.values()) if (!classVis.has(el.cls)) classVis.set(el.cls, true);
  models.push(m);
  busy('');
  return m;
}

function spaceAnchor(el) {
  let minY = Infinity, ax = 0, az = 0, aw = 0;
  const bb = new THREE.Box3();
  for (const r of el.ranges) {
    const P = r.b.pos;
    for (let v = r.vStart; v < r.vStart + r.vCount; v++) {
      bb.expandByPoint(new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
    }
  }
  minY = bb.min.y;
  for (const r of el.ranges) {
    const P = r.b.pos, I = r.b.master;
    for (let i = r.iStart; i < r.iStart + r.iCount; i += 3) {
      const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
      if (Math.abs(P[a + 1] - minY) > 0.02 || Math.abs(P[b + 1] - minY) > 0.02 || Math.abs(P[c + 1] - minY) > 0.02) continue;
      const w = Math.abs((P[b] - P[a]) * (P[c + 2] - P[a + 2]) - (P[c] - P[a]) * (P[b + 2] - P[a + 2])) / 2;
      ax += ((P[a] + P[b] + P[c]) / 3) * w; az += ((P[a + 2] + P[b + 2] + P[c + 2]) / 3) * w; aw += w;
    }
  }
  const c = bb.getCenter(new THREE.Vector3());
  return aw > 0 ? new THREE.Vector3(ax / aw, minY, az / aw) : new THREE.Vector3(c.x, minY, c.z);
}

// ---------- property index ----------
function propVal(P) {
  if (P.NominalValue !== undefined) return fmt(val(P.NominalValue));
  if (P.EnumerationValues) return refs2(P.EnumerationValues).join(', ');
  if (P.ListValues) return refs2(P.ListValues).join(', ');
  if (P.UpperBoundValue !== undefined || P.LowerBoundValue !== undefined) return `${fmt(val(P.LowerBoundValue))}〜${fmt(val(P.UpperBoundValue))}`;
  for (const k of Object.keys(P)) if (/Value$/.test(k) && P[k] != null && k !== 'expressID') return fmt(val(P[k]));
  return '';
}
const refs2 = (a) => (Array.isArray(a) ? a : [a]).map((x) => fmt(val(x)));
function fmt(v) {
  if (v === true || v === 'T') return 'TRUE';
  if (v === false || v === 'F') return 'FALSE';
  if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toFixed(4));
  return v ?? '';
}
function parsePset(m, pid) {
  let ps = m.psetCache.get(pid);
  if (ps) return ps;
  ps = { name: '', props: new Map() };
  try {
    const L = api.GetLine(m.id, pid);
    ps.name = val(L.Name) || prettyCls(tname(m.id, pid));
    for (const p of refs(L.HasProperties || L.Quantities)) {
      const P = api.GetLine(m.id, p);
      const n = val(P.Name);
      if (n) ps.props.set(String(n), propVal(P));
    }
  } catch (e) { /* broken reference */ }
  m.psetCache.set(pid, ps);
  return ps;
}
async function indexProps(m) {
  const mid = m.id;
  const rels = ids(mid, WEBIFC.IFCRELDEFINESBYPROPERTIES);
  const trels = ids(mid, WEBIFC.IFCRELDEFINESBYTYPE);
  const total = rels.length + trels.length || 1;
  let n = 0;
  const step = async () => {
    if (++n % 1500 === 0) { m.indexProgress = n / total; renderModels(); await yieldUI(); }
  };
  for (const rid of trels) {
    await step();
    const r = api.GetLine(mid, rid);
    const tid = val(r.RelatingType);
    if (!tid) continue;
    let T = m.types.get(tid);
    if (!T) {
      const TL = api.GetLine(mid, tid);
      T = { name: val(TL.Name), psets: refs(TL.HasPropertySets) };
      m.types.set(tid, T);
    }
    for (const c of refs(r.RelatedObjects)) { const el = m.elements.get(c); if (el) el.typeId = tid; else m.objType.set(c, tid); }
  }
  for (const rid of rels) {
    await step();
    const r = api.GetLine(mid, rid);
    const defs = refs(r.RelatingPropertyDefinition);
    for (const c of refs(r.RelatedObjects)) {
      const el = m.elements.get(c);
      if (el) el.psets.push(...defs);
      else { const a = m.objPsets.get(c); if (a) a.push(...defs); else m.objPsets.set(c, defs.slice()); }
    }
  }
  const all = new Set();
  for (const el of m.elements.values()) for (const p of el.psets) all.add(p);
  for (const T of m.types.values()) for (const p of T.psets) all.add(p);
  for (const el of m.elements.values()) if (el.parent) {
    el.parent.psets = m.objPsets.get(el.parent.id) || [];
    el.parent.psets.forEach((p) => all.add(p));
    const pt = m.types.get(m.objType.get(el.parent.id));
    if (pt) pt.psets.forEach((p) => { el.parent.psets.push(p); all.add(p); });
  }
  m.objPsets.clear();
  let i = 0;
  for (const pid of all) {
    if (++i % 1500 === 0) { m.indexProgress = 0.5 + 0.5 * (i / all.size); renderModels(); await yieldUI(); }
    const ps = parsePset(m, pid);
    for (const k of ps.props.keys()) { m.keys.add(ps.name + '\t' + k); m.keys.add('*\t' + k); }
  }
  m.indexed = true;
  m.indexProgress = 1;
}
function rebuildKeyList() {
  const all = new Set();
  for (const m of models) for (const k of m.keys) all.add(k);
  const sorted = [...all].sort((a, b) => (b[0] === '*') - (a[0] === '*') || a.localeCompare(b, 'ja'));
  for (const k of sorted) {
    const [ps, p] = k.split('\t');
    const l = `${ps === '*' ? '（全Pset）' : ps} / ${p}`;
    keyLabel.set(k, l); labelKey.set(l, k);
  }
  const opts = [...ATTR_KEYS.map(([k]) => k), ...sorted].map((k) => `<option value="${esc(labelOf(k))}">`);
  $('#keyList').innerHTML = opts.join('');
}

function getVal(m, el, key) {
  if (key[0] === '@') {
    switch (key) {
      case '@Model': return m.name;
      case '@Class': return el.cls;
      case '@Name': return el.name ?? '';
      case '@LongName': return el.longName ?? '';
      case '@ObjectType': return el.objType ?? '';
      case '@Tag': return el.tag ?? '';
      case '@GlobalId': return el.gid ?? '';
      case '@Type': return (m.types.get(el.typeId) || {}).name ?? '';
      case '@Storey': return el.storey ? el.storey.name : '';
      case '@System': return el.sys.join(', ');
      default: return '';
    }
  }
  const t = key.indexOf('\t');
  const psn = key.slice(0, t), pn = key.slice(t + 1);
  const any = psn === '*';
  const T = m.types.get(el.typeId);
  for (const pid of [...el.psets, ...(T ? T.psets : []), ...(el.parent?.psets || [])]) {
    const ps = parsePset(m, pid);
    if ((any || ps.name === psn) && ps.props.has(pn)) return ps.props.get(pn);
  }
  return '';
}
function allProps(m, el) {
  const out = new Map();
  for (const [k] of ATTR_KEYS) if (!['@Model', '@GlobalId'].includes(k)) out.set(k, getVal(m, el, k));
  const add = (pid) => { const ps = parsePset(m, pid); for (const [n, v] of ps.props) { const k = ps.name + '\t' + n; if (!out.has(k)) out.set(k, v); } };
  el.psets.forEach(add);
  const T = m.types.get(el.typeId);
  if (T) T.psets.forEach(add);
  return out;
}

// ---------- visibility / colors ----------
const sysVal = (m, el) => (sysKey ? String(getVal(m, el, sysKey) ?? '') : '');
function elemVisible(m, el) {
  if (!m.visible) return false;
  if (el.isSpace) return mode2D ? $('#spaceFill').checked : classVis.get('IfcSpace');
  if (!classVis.get(el.cls)) return false;
  if (sysHidden.size && sysHidden.has(sysVal(m, el))) return false;
  if (isolateSet && !isolateSet.has(el)) return false;
  return true;
}
function applyVisibility() {
  for (const m of models) {
    m.group.visible = m.visible;
    for (const c of m.chunks) {
      const a = c.dispIdx.array;
      let o = 0;
      for (const r of c.ranges) {
        if (!elemVisible(m, r.el)) continue;
        a.set(c.master.subarray(r.iStart, r.iStart + r.iCount), o);
        o += r.iCount;
      }
      c.geo.setDrawRange(0, o);
      c.dispIdx.needsUpdate = true;
      c.mesh.visible = o > 0;
    }
  }
  updateHighlight();
  req();
}
function hsl(i) {
  const c = new THREE.Color().setHSL(((i * 0.618034) % 1), 0.62, 0.55);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}
const hex = (c) => '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
const GRAY = [190, 190, 190];
let legend = [];
function colorFn() {
  if (colorMode === 'original') return null;
  if (colorMode === 'model') return (m) => new THREE.Color(m.color).toArray().map((x) => Math.round(x * 255));
  if (colorMode === 'diff') {
    const C = { add: [34, 197, 94], del: [239, 68, 68], chg: [245, 158, 11], same: [200, 200, 200] };
    return (m, el) => { const s = diffResult?.status.get(el); return s ? C[s] : [225, 225, 225]; };
  }
  const keyFn = colorMode === 'class' ? (m, el) => el.cls
    : colorMode === 'storey' ? (m, el) => (el.storey ? el.storey.name : '')
    : colorMode === 'system' ? (m, el) => sysVal(m, el)
    : (m, el) => (colorKey ? String(getVal(m, el, colorKey) ?? '') : '');
  const vals = new Map();
  for (const m of models) for (const el of m.elements.values()) { const v = keyFn(m, el); vals.set(v, (vals.get(v) || 0) + 1); }
  const sorted = [...vals.keys()].filter((v) => v !== '').sort((a, b) => String(a).localeCompare(String(b), 'ja', { numeric: true }));
  const cmap = new Map(sorted.map((v, i) => [v, hsl(i)]));
  legend = sorted.map((v) => ({ v, c: cmap.get(v), n: vals.get(v), keyFn }));
  if (vals.has('')) legend.push({ v: '', c: GRAY, n: vals.get(''), keyFn });
  return (m, el) => cmap.get(keyFn(m, el)) || GRAY;
}
function applyColors() {
  legend = [];
  const fn = colorFn();
  for (const m of models) {
    for (const c of m.chunks) {
      const a = c.colAttr.array;
      if (!fn) { a.set(c.origCol); c.colAttr.needsUpdate = true; continue; }
      for (const r of c.ranges) {
        if (r.el.isSpace && colorMode !== 'property' && colorMode !== 'diff' && colorMode !== 'storey') { a.set(c.origCol.subarray(r.vStart * 3, (r.vStart + r.vCount) * 3), r.vStart * 3); continue; }
        const col = fn(m, r.el);
        for (let v = r.vStart; v < r.vStart + r.vCount; v++) { a[v * 3] = col[0]; a[v * 3 + 1] = col[1]; a[v * 3 + 2] = col[2]; }
      }
      c.colAttr.needsUpdate = true;
    }
  }
  renderLegend();
  req();
}
function renderLegend() {
  const L = $('#legend');
  if (colorMode === 'model') {
    L.innerHTML = models.map((m) => `<div class="li"><span class="sw" style="background:${m.color}"></span><span>${esc(m.name)}</span></div>`).join('');
  } else if (colorMode === 'diff') {
    L.innerHTML = [['#22c55e', '追加（新のみ）'], ['#ef4444', '削除（旧のみ）'], ['#f59e0b', '変更'], ['#c8c8c8', '同一']].map(([c, t]) => `<div class="li"><span class="sw" style="background:${c}"></span><span>${t}</span></div>`).join('');
  } else if (legend.length) {
    L.innerHTML = legend.slice(0, 200).map((x, i) => `<div class="li" data-i="${i}"><span class="sw" style="background:${hex(x.c)}"></span><span>${esc(x.v === '' ? '（値なし）' : x.v)} <span class="muted">${x.n}</span></span></div>`).join('') + (legend.length > 200 ? `<div class="muted">ほか ${legend.length - 200} 件</div>` : '');
  } else L.innerHTML = '';
  L.style.display = L.innerHTML ? 'block' : 'none';
}
$('#legend').addEventListener('click', (e) => {
  const li = e.target.closest('.li[data-i]');
  if (!li) return;
  const x = legend[+li.dataset.i];
  const sel = [];
  for (const m of models) for (const el of m.elements.values()) if (x.keyFn(m, el) === x.v && elemVisible(m, el)) sel.push({ m, el });
  setSelection(sel);
});

// ---------- selection / picking ----------
function pickAt(cx, cy) {
  const rect = renderer.domElement.getBoundingClientRect();
  const dpr = renderer.getPixelRatio();
  const W = renderer.domElement.width, H = renderer.domElement.height;
  const x = Math.round((cx - rect.left) * dpr), y = Math.round((cy - rect.top) * dpr);
  camera.setViewOffset(W, H, x, y, 1, 1);
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(pickRT);
  renderer.clear();
  hlGroup.visible = false;
  scene.overrideMaterial = pickMat;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  hlGroup.visible = true;
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevClear, prevAlpha);
  camera.clearViewOffset();
  const px = new Uint8Array(4);
  renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, px);
  req();
  const id = (px[0] << 16) | (px[1] << 8) | px[2];
  return id ? pickTable[id] : null;
}
let downPt = null;
renderer.domElement.addEventListener('pointerdown', (e) => (downPt = [e.clientX, e.clientY, e.button]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPt || downPt[2] !== 0) return;
  if (Math.hypot(e.clientX - downPt[0], e.clientY - downPt[1]) > 4) return;
  const hit = pickAt(e.clientX, e.clientY);
  if (e.ctrlKey || e.shiftKey) {
    if (!hit) return;
    const i = selection.findIndex((s) => s.el === hit.el);
    const next = selection.slice();
    if (i >= 0) next.splice(i, 1); else next.push(hit);
    setSelection(next);
  } else setSelection(hit ? [hit] : []);
});
renderer.domElement.addEventListener('dblclick', () => zoomTo(selection));

function setSelection(sel, fromList) {
  selection = sel;
  updateHighlight();
  renderProps();
  if (!fromList) {
    if ($('#listScope').value === 'selected') renderList();
    else markListSel();
  }
}
function updateHighlight() {
  hlGroup.clear();
  let tri = 0;
  for (const { el } of selection) for (const r of el.ranges) tri += r.iCount;
  if (!tri || tri > 9_000_000) { req(); return; }
  const pos = new Float32Array(tri * 3);
  let o = 0;
  for (const { m, el } of selection) {
    if (!elemVisible(m, el)) continue;
    for (const r of el.ranges) {
      const P = r.b.pos, I = r.b.master;
      for (let i = r.iStart; i < r.iStart + r.iCount; i++) { const v = I[i] * 3; pos[o++] = P[v]; pos[o++] = P[v + 1]; pos[o++] = P[v + 2]; }
    }
  }
  if (!o) { req(); return; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
  const mesh = new THREE.Mesh(g, matHL);
  mesh.renderOrder = 5;
  hlGroup.add(mesh);
  req();
}
function boxOf(list) {
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const { el } of list) for (const r of el.ranges) {
    const P = r.b.pos;
    for (let i = r.vStart; i < r.vStart + r.vCount; i++) b.expandByPoint(v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  }
  return b;
}
function sceneBox() {
  const b = new THREE.Box3();
  for (const m of models) if (m.visible) b.union(m.bbox);
  return b;
}
function fitBox(b) {
  if (b.isEmpty()) return;
  const c = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  if (mode2D) {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    const half = Math.max(size.z / 2, size.x / 2 / (w / h)) * 1.1 + 0.5;
    ortho.top = half; ortho.bottom = -half; ortho.left = -half * (w / h); ortho.right = half * (w / h); ortho.zoom = 1;
    ortho.position.set(c.x, planY() + 500, c.z);
    ctl2.target.set(c.x, planY(), c.z);
    ortho.near = 0.1; ortho.far = 2000;
    ortho.updateProjectionMatrix();
    ctl2.update();
  } else {
    const r = Math.max(size.length() / 2, 0.5);
    const dist = r / Math.sin((persp.fov * Math.PI) / 360) * 1.05;
    const dir = persp.position.clone().sub(ctl3.target).normalize();
    if (!isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(1, 0.8, 1).normalize();
    persp.position.copy(c).addScaledVector(dir, dist);
    persp.near = Math.max(0.01, dist / 2000);
    persp.far = dist + r * 20;
    persp.updateProjectionMatrix();
    ctl3.target.copy(c);
    ctl3.update();
  }
  req();
}
function zoomTo(list) { if (list.length) fitBox(boxOf(list)); }

// ---------- properties panel ----------
function renderProps() {
  const P = $('#props');
  if (!selection.length) { P.innerHTML = '<div class="hint">要素をクリックするとプロパティを表示します。Ctrl / Shift + クリックで複数選択。</div>'; return; }
  if (selection.length > 1) {
    const by = new Map();
    for (const { m, el } of selection) { const k = `${m.name} / ${el.cls}`; by.set(k, (by.get(k) || 0) + 1); }
    P.innerHTML = `<div class="psec"><div>${selection.length} 要素を選択中</div><table>${[...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join('')}</table></div><div class="hint">一覧タブの「選択中の要素」で詳細を確認できます。</div>`;
    return;
  }
  const { m, el } = selection[0];
  const rows = (arr) => `<table>${arr.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const T = m.types.get(el.typeId);
  let html = `<div class="psec"><div>基本情報</div>${rows([
    ['モデル', m.name], ['IFCクラス', el.cls], ['Name', el.name], ['LongName', el.longName], ['ObjectType', el.objType], ['Tag', el.tag], ['GlobalId', el.gid],
    ['タイプ名', T ? T.name : ''], ['親要素', el.parent ? `${el.parent.cls} ${el.parent.name || ''}` : ''], ['階', el.storey ? el.storey.name : ''], ['系統（IfcSystem）', el.sys.join(', ')], ['ExpressID', '#' + el.eid],
  ].filter(([, v]) => v !== '' && v != null))}</div>`;
  if (!m.indexed) html += `<div class="hint">プロパティ索引を作成中です（${Math.round(m.indexProgress * 100)}%）…</div>`;
  const sec = (pid, suffix) => {
    const ps = parsePset(m, pid);
    if (!ps.props.size) return '';
    return `<div class="psec"><div>${esc(ps.name)}${suffix}</div>${rows([...ps.props])}</div>`;
  };
  html += el.psets.map((p) => sec(p, '')).join('');
  if (T) html += T.psets.map((p) => sec(p, ' <span class="muted">（タイプ）</span>')).join('');
  if (el.parent?.psets) html += el.parent.psets.map((p) => sec(p, ' <span class="muted">（親要素）</span>')).join('');
  P.innerHTML = html;
}
$('#props').addEventListener('click', (e) => {
  const h = e.target.closest('.psec>div:first-child');
  if (h) h.parentElement.classList.toggle('closed');
});

// ---------- left panels ----------
function renderModels() {
  const L = $('#modelList');
  if (!models.length) { L.innerHTML = '<div class="hint">モデルが読み込まれていません。</div>'; return; }
  L.innerHTML = models.map((m, i) => {
    const nSys = new Set(); let nSp = 0;
    for (const el of m.elements.values()) { el.sys.forEach((s) => nSys.add(s)); if (el.isSpace) nSp++; }
    return `<div class="model" data-i="${i}">
      <div class="t"><input type="checkbox" data-a="vis" ${m.visible ? 'checked' : ''}><span class="sw" style="background:${m.color}"></span><b title="${esc(m.name)}">${esc(m.name)}</b><button class="x" data-a="fit" title="このモデルを全体表示">⤢</button><button class="x" data-a="rm" title="閉じる">✕</button></div>
      <div class="meta">${esc(m.schema)} ／ ${(m.size / 1048576).toFixed(1)} MB ／ 要素 ${m.elements.size.toLocaleString()} ／ 部屋 ${nSp} ／ 階 ${m.storeys.length}${nSys.size ? ` ／ IfcSystem ${nSys.size}` : ''}<br>${esc(m.app || '')}${m.indexed ? '' : `<br><span style="color:var(--warn)">プロパティ索引を作成中 ${Math.round(m.indexProgress * 100)}%</span>`}</div>
    </div>`;
  }).join('');
}
$('#modelList').addEventListener('click', (e) => {
  const box = e.target.closest('.model');
  if (!box) return;
  const m = models[+box.dataset.i];
  const a = e.target.dataset.a;
  if (a === 'vis') { m.visible = e.target.checked; applyVisibility(); renderList(); }
  if (a === 'fit') fitBox(m.bbox);
  if (a === 'rm') removeModel(m);
});
function removeModel(m) {
  scene.remove(m.group);
  for (const c of m.chunks) c.geo.dispose();
  for (const el of m.elements.values()) if (el.pick) pickTable[el.pick] = null;
  api.CloseModel(m.id);
  models.splice(models.indexOf(m), 1);
  selection = selection.filter((s) => s.m !== m);
  if (diffResult && (diffResult.a === m || diffResult.b === m)) { diffResult = null; $('#diffTable').innerHTML = ''; if (colorMode === 'diff') setColorMode('original'); }
  if (isolateSet) for (const el of m.elements.values()) isolateSet.delete(el);
  rebuildKeyList();
  refreshAll();
}

let levels = [];
function buildLevels() {
  const prevY = curLevel() ? curLevel().y : null;
  const all = [];
  for (const m of models) for (const s of m.storeys) all.push({ m, s });
  all.sort((a, b) => a.s.y - b.s.y);
  levels = [];
  for (const x of all) {
    const last = levels[levels.length - 1];
    if (last && Math.abs(last.y - x.s.y) < 0.15) { last.names.add(x.s.name); last.storeys.add(x.s); }
    else levels.push({ y: x.s.y, names: new Set([x.s.name]), storeys: new Set([x.s]) });
  }
  const sel = $('#levelSel');
  sel.innerHTML = levels.map((l, i) => `<option value="${i}">${esc([...l.names].join(' / '))}（${(l.y + (offset ? offset.y : 0)).toFixed(3)}）</option>`).join('');
  if (prevY !== null && levels.length) {
    let bi = 0;
    levels.forEach((l, i) => { if (Math.abs(l.y - prevY) < Math.abs(levels[bi].y - prevY)) bi = i; });
    sel.value = String(bi);
  } else {
    const i = levels.findIndex((l) => Math.abs(l.y + (offset ? offset.y : 0)) < 0.15);
    sel.value = String(Math.max(0, i));
  }
  $('#levelList').innerHTML = levels.map((l, i) => {
    let n = 0;
    for (const m of models) for (const el of m.elements.values()) if (el.storey && l.storeys.has(el.storey)) n++;
    return `<div class="item" data-i="${i}"><span class="name">${esc([...l.names].join(' / '))}</span><span class="cnt">EL ${(l.y + (offset ? offset.y : 0)).toFixed(3)} ／ ${n}</span></div>`;
  }).join('');
}
$('#levelList').addEventListener('click', (e) => {
  const it = e.target.closest('.item');
  if (!it) return;
  $('#levelSel').value = it.dataset.i;
  if (!mode2D) set2D(true); else applyPlan();
});
const curLevel = () => levels[+$('#levelSel').value] || null;
const planY = () => (curLevel() ? curLevel().y : 0);

function sysEntries() {
  const map = new Map();
  for (const m of models) for (const el of m.elements.values()) {
    if (el.isSpace) continue;
    const v = sysVal(m, el);
    let e = map.get(v);
    if (!e) { e = { v, counts: new Map() }; map.set(v, e); }
    e.counts.set(m, (e.counts.get(m) || 0) + 1);
  }
  return [...map.values()].sort((a, b) => (a.v === '') - (b.v === '') || String(a.v).localeCompare(String(b.v), 'ja', { numeric: true }));
}
let sysCache = [];
function renderSystems() {
  $('#sysKey').value = labelOf(sysKey);
  sysCache = sysEntries();
  const f = $('#sysFilter').value.trim().toLowerCase();
  const pal = new Map();
  sysCache.filter((e) => e.v !== '').forEach((e, i) => pal.set(e.v, hex(hsl(i))));
  if (!sysKey) { $('#sysList').innerHTML = '<div class="item muted">判定キーを選択してください。</div>'; return; }
  $('#sysList').innerHTML = sysCache.map((e, i) => {
    if (f && !String(e.v).toLowerCase().includes(f)) return '';
    const cnt = [...e.counts].map(([m, n]) => `<span title="${esc(m.name)}" style="color:${m.color}">●</span>${n}`).join(' ');
    return `<div class="item" data-i="${i}"><input type="checkbox" ${sysHidden.has(e.v) ? '' : 'checked'}><span class="sw" style="background:${pal.get(e.v) || '#bebebe'}"></span><span class="name" title="${esc(e.v)}">${esc(e.v === '' ? '（系統なし）' : e.v)}</span><span class="cnt">${cnt}</span></div>`;
  }).join('') || '<div class="item muted">該当なし</div>';
}
$('#sysList').addEventListener('click', (e) => {
  const it = e.target.closest('.item[data-i]');
  if (!it) return;
  const s = sysCache[+it.dataset.i];
  if (e.target.type === 'checkbox') {
    if (e.target.checked) sysHidden.delete(s.v); else sysHidden.add(s.v);
    applyVisibility(); renderList();
  } else if (e.target.classList.contains('name')) {
    const sel = [];
    for (const m of models) for (const el of m.elements.values()) if (!el.isSpace && sysVal(m, el) === s.v && elemVisible(m, el)) sel.push({ m, el });
    setSelection(sel);
  }
});
$('#sysAll').onclick = () => { sysHidden.clear(); renderSystems(); applyVisibility(); renderList(); };
$('#sysNone').onclick = () => { sysCache.forEach((e) => sysHidden.add(e.v)); renderSystems(); applyVisibility(); renderList(); };
$('#sysColor').onclick = () => setColorMode('system');
$('#sysFilter').oninput = renderSystems;
$('#sysKey').onchange = (e) => {
  const k = keyOf(e.target.value);
  if (!k && e.target.value) return;
  sysKey = k; sysHidden.clear();
  renderSystems(); applyVisibility();
  if (colorMode === 'system') applyColors();
};
function autoSysKey() {
  if (sysKey) return;
  for (const m of models) for (const el of m.elements.values()) if (el.sys.length) { sysKey = '@System'; return; }
  const keys = new Set();
  for (const m of models) for (const k of m.keys) keys.add(k);
  const arr = [...keys];
  const pref = [/^(system name|システム名|系統名|システム名称|系統)$/i, /^(system type|システム タイプ|システムタイプ)$/i, /system|システム|系統/i];
  for (const re of pref) {
    const hit = arr.filter((k) => re.test(k.split('\t')[1])).sort((a, b) => (b[0] === '*') - (a[0] === '*') || a.localeCompare(b));
    if (hit.length) { sysKey = hit[0]; return; }
  }
}

function renderClasses() {
  const cnt = new Map();
  for (const m of models) for (const el of m.elements.values()) cnt.set(el.cls, (cnt.get(el.cls) || 0) + 1);
  const f = $('#clsFilter').value.trim().toLowerCase();
  $('#clsList').innerHTML = [...cnt].sort((a, b) => a[0].localeCompare(b[0])).filter(([c]) => !f || c.toLowerCase().includes(f))
    .map(([c, n]) => `<div class="item" data-c="${esc(c)}"><input type="checkbox" ${classVis.get(c) ? 'checked' : ''}><span class="name">${esc(c)}</span><span class="cnt">${n.toLocaleString()}</span></div>`).join('') || '<div class="item muted">なし</div>';
}
$('#clsList').addEventListener('click', (e) => {
  const it = e.target.closest('.item[data-c]');
  if (!it) return;
  const c = it.dataset.c;
  if (e.target.type === 'checkbox') { classVis.set(c, e.target.checked); applyVisibility(); renderList(); }
  else if (e.target.classList.contains('name')) {
    const sel = [];
    for (const m of models) for (const el of m.elements.values()) if (el.cls === c && elemVisible(m, el)) sel.push({ m, el });
    setSelection(sel);
  }
});
$('#clsFilter').oninput = renderClasses;
const setAllCls = (v) => { for (const k of classVis.keys()) classVis.set(k, v); renderClasses(); applyVisibility(); renderList(); };
$('#clsAll').onclick = () => setAllCls(true);
$('#clsNone').onclick = () => setAllCls(false);

// tabs
$('#ltabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#ltabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('aside .pane').forEach((p) => p.classList.toggle('on', p.id === b.dataset.p));
});
$('#btabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  document.querySelectorAll('#btabs button[data-p]').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.bpane').forEach((p) => p.classList.toggle('on', p.id === b.dataset.p));
  $('#bottom').classList.remove('closed');
  $('#btnBottom').textContent = '▼ 閉じる';
  if (b.dataset.p === 'bPivot') renderPivot();
});
$('#btnBottom').onclick = () => {
  const c = $('#bottom').classList.toggle('closed');
  $('#btnBottom').textContent = c ? '▲ 開く' : '▼ 閉じる';
};
{
  let sy = 0, sh = 0;
  const mv = (e) => { $('#bottom').style.height = Math.max(80, Math.min(window.innerHeight - 160, sh + sy - e.clientY)) + 'px'; };
  $('#resizer').addEventListener('pointerdown', (e) => {
    sy = e.clientY; sh = $('#bottom').offsetHeight;
    $('#bottom').classList.remove('closed');
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true });
  });
}

// ---------- 2D plan ----------
function set2D(on) {
  mode2D = on;
  $('#btn2d').classList.toggle('on', on);
  $('#btn3d').classList.toggle('on', !on);
  camera = on ? ortho : persp;
  ctl2.enabled = on;
  ctl3.enabled = !on;
  if (on) {
    document.querySelectorAll('#ltabs button').forEach((x) => x.classList.toggle('on', x.dataset.p === 'pLevels'));
    document.querySelectorAll('aside .pane').forEach((p) => p.classList.toggle('on', p.id === 'pLevels'));
  }
  applyPlan(true);
}
function applyPlan(refit) {
  const lv = curLevel();
  const lo = parseFloat($('#cutLow').value) || 0, hi = parseFloat($('#cutHigh').value) || 1.5;
  const clip = (mode2D || $('#clip3d').checked) && lv;
  capUniform.value = clip ? 1 : 0;
  renderer.clippingPlanes = clip ? [new THREE.Plane(new THREE.Vector3(0, 1, 0), -(lv.y + lo)), new THREE.Plane(new THREE.Vector3(0, -1, 0), lv.y + hi)] : [];
  labelGroup.clear();
  if (mode2D && lv && $('#spaceLabel').checked) {
    const lm = $('#labelMode').value, lk = keyOf($('#labelKey').value);
    const placed = [];
    for (const m of models) {
      if (!m.visible) continue;
      for (const el of m.elements.values()) {
        if (!el.isSpace || !el.anchor) continue;
        const onLevel = el.storey ? lv.storeys.has(el.storey) : Math.abs(el.anchor.y - lv.y) < 0.5;
        if (!onLevel) continue;
        const d = document.createElement('div');
        d.className = 'rlabel';
        const t = lm === 'name' ? el.name : lm === 'long' ? el.longName || el.name : [el.name, el.longName].filter(Boolean).join(' ');
        if (placed.some((q) => q.t === t && q.p.distanceTo(el.anchor) < 1)) continue;
        placed.push({ t, p: el.anchor });
        d.innerHTML = esc(t || '') + (lk ? `<small>${esc(getVal(m, el, lk))}</small>` : '');
        const o = new CSS2DObject(d);
        o.position.set(el.anchor.x, lv.y + 0.05, el.anchor.z);
        labelGroup.add(o);
      }
    }
  }
  $('#planbar').style.display = mode2D ? 'block' : 'none';
  if (lv) $('#planbar').textContent = `2D平面: ${[...lv.names].join(' / ')}　表示範囲 FL${lo >= 0 ? '+' : ''}${lo}〜FL+${hi} m`;
  applyVisibility();
  if (refit) {
    if (mode2D) fitBox(sceneBox()); else fitBox(sceneBox());
  }
  req();
}
$('#btn3d').onclick = () => set2D(false);
$('#btn2d').onclick = () => set2D(true);
['#levelSel', '#cutLow', '#cutHigh', '#spaceFill', '#spaceLabel', '#labelMode', '#labelKey', '#clip3d'].forEach((s) => ($(s).onchange = () => applyPlan(s === '#levelSel' && mode2D)));

// ---------- toolbar ----------
$('#btnOpen').onclick = () => $('#file').click();
$('#file').onchange = (e) => { openFiles([...e.target.files]); e.target.value = ''; };
$('#btnFit').onclick = () => fitBox(sceneBox());
$('#btnZoomSel').onclick = () => zoomTo(selection);
$('#btnIsolate').onclick = () => { if (!selection.length) return; isolateSet = new Set(selection.map((s) => s.el)); applyVisibility(); renderList(); };
$('#btnUnisolate').onclick = () => { isolateSet = null; applyVisibility(); renderList(); };
function setColorMode(v) {
  colorMode = v;
  $('#colorMode').value = v;
  $('#colorKey').style.display = v === 'property' ? '' : 'none';
  applyColors();
}
$('#colorMode').onchange = (e) => setColorMode(e.target.value);
$('#colorKey').onchange = (e) => { colorKey = keyOf(e.target.value); applyColors(); };
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input,select,textarea')) return;
  if (e.key === 'Escape') setSelection([]);
  if (e.key === 'f' || e.key === 'F') fitBox(sceneBox());
});
viewport.addEventListener('dragover', (e) => { e.preventDefault(); viewport.classList.add('dragover'); });
viewport.addEventListener('dragleave', () => viewport.classList.remove('dragover'));
viewport.addEventListener('drop', (e) => {
  e.preventDefault();
  viewport.classList.remove('dragover');
  openFiles([...e.dataTransfer.files].filter((f) => /\.ifc$/i.test(f.name)));
});

let loading = Promise.resolve();
function openFiles(files) {
  for (const f of files) {
    loading = loading.then(async () => {
      try {
        const first = !models.length;
        const m = await loadFile(f);
        $('#drop').style.display = 'none';
        refreshAll();
        if (first) fitBox(sceneBox());
        m.indexPromise = indexProps(m).then(() => {
          rebuildKeyList();
          autoSysKey();
          refreshAll();
          if (colorMode === 'property' || colorMode === 'system') applyColors();
        });
      } catch (err) {
        console.error(err);
        busy('');
        alert(`読み込みに失敗しました: ${f.name}\n${err.message || err}`);
      }
    });
  }
}
function refreshAll() {
  renderModels();
  buildLevels();
  renderSystems();
  renderClasses();
  renderListSelectors();
  renderList();
  renderDiffSelectors();
  if ($('#bPivot').classList.contains('on')) renderPivot();
  renderProps();
  applyColors();
  applyPlan(false);
}

// ---------- list ----------
let listCols = ['@Model', '@Class', '@Name', '@Storey', '@Type'];
let listSort = { col: -1, dir: 1 };
let listRows = [];
function renderListSelectors() {
  const ms = $('#listModel'), cs = $('#listClass');
  const pm = ms.value, pc = cs.value;
  ms.innerHTML = '<option value="">全モデル</option>' + models.map((m, i) => `<option value="${m.no}">${esc(m.name)}</option>`).join('');
  const cls = new Set();
  for (const m of models) for (const el of m.elements.values()) cls.add(el.cls);
  cs.innerHTML = '<option value="">全クラス</option>' + [...cls].sort().map((c) => `<option>${esc(c)}</option>`).join('');
  ms.value = [...ms.options].some((o) => o.value === pm) ? pm : '';
  cs.value = [...cs.options].some((o) => o.value === pc) ? pc : '';
}
function scopeItems(scope) {
  if (scope === 'selected') return selection.slice();
  const out = [];
  for (const m of models) for (const el of m.elements.values()) if (scope === 'all' || elemVisible(m, el)) out.push({ m, el });
  return out;
}
function computeList() {
  const mno = $('#listModel').value, cls = $('#listClass').value, f = $('#listFilter').value.trim().toLowerCase();
  let items = scopeItems($('#listScope').value).filter(({ m, el }) => (!mno || String(m.no) === mno) && (!cls || el.cls === cls));
  let rows = items.map((it) => ({ it, v: listCols.map((k) => getVal(it.m, it.el, k)) }));
  if (f) rows = rows.filter((r) => r.v.some((x) => String(x).toLowerCase().includes(f)));
  if (listSort.col >= 0 && listSort.col < listCols.length) {
    const c = listSort.col, d = listSort.dir;
    rows.sort((a, b) => {
      const x = a.v[c], y = b.v[c];
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
      return String(x).localeCompare(String(y), 'ja', { numeric: true }) * d;
    });
  }
  return rows;
}
const LIST_MAX = 2000;
function renderList() {
  listRows = computeList();
  const head = `<thead><tr>${listCols.map((k, i) => `<th data-i="${i}">${esc(labelOf(k).replace(/^属性 \/ /, ''))}${listSort.col === i ? (listSort.dir > 0 ? ' ▲' : ' ▼') : ''}<span class="rm" data-rm="${i}" title="列を削除">✕</span></th>`).join('')}</tr></thead>`;
  const body = listRows.slice(0, LIST_MAX).map((r, i) => `<tr data-i="${i}">${r.v.map((x) => `<td${typeof x === 'number' ? ' class="num"' : ''} title="${esc(x)}">${esc(x)}</td>`).join('')}</tr>`).join('');
  $('#listTable').innerHTML = head + `<tbody>${body}</tbody>`;
  $('#listInfo').textContent = `${listRows.length.toLocaleString()} 件` + (listRows.length > LIST_MAX ? `（先頭 ${LIST_MAX} 件を表示。CSVは全件）` : '');
  markListSel();
}
function markListSel() {
  const s = new Set(selection.map((x) => x.el));
  $('#listTable').querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('sel', s.has(listRows[+tr.dataset.i]?.it.el)));
}
$('#listTable').addEventListener('click', (e) => {
  const rm = e.target.dataset.rm;
  if (rm !== undefined) { listCols.splice(+rm, 1); listSort.col = -1; renderList(); return; }
  const th = e.target.closest('th');
  if (th) { const i = +th.dataset.i; listSort = { col: i, dir: listSort.col === i ? -listSort.dir : 1 }; renderList(); return; }
  const tr = e.target.closest('tbody tr');
  if (tr) { setSelection([listRows[+tr.dataset.i].it], true); markListSel(); }
});
$('#listTable').addEventListener('dblclick', (e) => { if (e.target.closest('tbody tr')) zoomTo(selection); });
['#listScope', '#listModel', '#listClass'].forEach((s) => ($(s).onchange = renderList));
let ft;
$('#listFilter').oninput = () => { clearTimeout(ft); ft = setTimeout(renderList, 250); };
$('#listAddCol').onchange = (e) => {
  const k = keyOf(e.target.value);
  if (k && !listCols.includes(k)) { listCols.push(k); renderList(); }
  e.target.value = '';
};
$('#listSelect').onclick = () => setSelection(listRows.map((r) => r.it));
function csv(rows) {
  const q = (x) => { const s = String(x ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#listCsv').onclick = () => download('ifc_list.csv', csv([listCols.map((k) => labelOf(k).replace(/^属性 \/ /, '')), ...listRows.map((r) => r.v)]));

// ---------- pivot ----------
let pivData = null;
$('#pivRow').value = labelOf('@Class');
$('#pivAgg').onchange = () => { $('#pivVal').style.display = $('#pivAgg').value === 'sum' ? '' : 'none'; renderPivot(); };
['#pivRow', '#pivVal', '#pivScope'].forEach((s) => ($(s).onchange = renderPivot));
function renderPivot() {
  const rk = keyOf($('#pivRow').value) || '@Class';
  const sum = $('#pivAgg').value === 'sum', vk = keyOf($('#pivVal').value);
  const rows = new Map();
  for (const { m, el } of scopeItems($('#pivScope').value)) {
    const r = String(getVal(m, el, rk) ?? '');
    let e = rows.get(r);
    if (!e) { e = new Map(); rows.set(r, e); }
    let c = e.get(m);
    if (!c) { c = { n: 0, items: [] }; e.set(m, c); }
    const v = sum ? parseFloat(getVal(m, el, vk)) : 1;
    c.n += isFinite(v) ? v : 0;
    c.items.push({ m, el });
  }
  const keys = [...rows.keys()].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  const f = (n) => (Number.isInteger(n) ? n.toLocaleString() : Number(n.toFixed(3)).toLocaleString());
  pivData = { keys, rows };
  $('#pivTable').innerHTML = `<thead><tr><th>${esc(labelOf(rk).replace(/^属性 \/ /, ''))}</th>${models.map((m) => `<th><span style="color:${m.color}">●</span> ${esc(m.name)}</th>`).join('')}<th>合計</th></tr></thead><tbody>` +
    keys.map((k, i) => {
      const e = rows.get(k);
      let t = 0;
      const cells = models.map((m, j) => { const c = e.get(m); if (c) t += c.n; return c ? `<td class="num click" data-r="${i}" data-m="${j}">${f(c.n)}</td>` : '<td class="num muted">-</td>'; }).join('');
      return `<tr><td>${esc(k === '' ? '（値なし）' : k)}</td>${cells}<td class="num">${f(t)}</td></tr>`;
    }).join('') + '</tbody>';
}
$('#pivTable').addEventListener('click', (e) => {
  const td = e.target.closest('td[data-r]');
  if (!td) return;
  const c = pivData.rows.get(pivData.keys[+td.dataset.r]).get(models[+td.dataset.m]);
  if (c) setSelection(c.items);
});
$('#pivCsv').onclick = () => {
  if (!pivData) return;
  const rk = keyOf($('#pivRow').value) || '@Class';
  download('ifc_pivot.csv', csv([[labelOf(rk), ...models.map((m) => m.name)], ...pivData.keys.map((k) => [k, ...models.map((m) => pivData.rows.get(k).get(m)?.n ?? '')])]));
};

// ---------- diff ----------
function renderDiffSelectors() {
  const a = $('#diffA'), b = $('#diffB');
  const pa = a.value, pb = b.value;
  const opts = models.map((m) => `<option value="${m.no}">${esc(m.name)}</option>`).join('');
  a.innerHTML = opts; b.innerHTML = opts;
  if (models.some((m) => String(m.no) === pa)) a.value = pa;
  if (models.some((m) => String(m.no) === pb)) b.value = pb;
  else if (models.length > 1) b.value = String(models[models.length - 1].no);
  $('#diffRun').disabled = models.length < 2;
}
const norm = (v) => (typeof v === 'number' ? String(Number(v.toFixed(3))) : String(v ?? ''));
$('#diffRun').onclick = async () => {
  const A = models.find((m) => String(m.no) === $('#diffA').value), B = models.find((m) => String(m.no) === $('#diffB').value);
  if (!A || !B || A === B) { alert('異なる2つのモデルを選択してください。'); return; }
  busy('プロパティ索引の完了を待っています…', 0.1);
  await A.indexPromise; await B.indexPromise;
  busy('比較中…', 0.5);
  await yieldUI();
  const ga = new Map(), gb = new Map();
  for (const el of A.elements.values()) if (el.gid) ga.set(el.gid, el);
  for (const el of B.elements.values()) if (el.gid) gb.set(el.gid, el);
  const onlyCols = $('#diffScope').value === 'cols';
  const rows = [], status = new Map();
  let same = 0;
  for (const [gid, ea] of ga) {
    const eb = gb.get(gid);
    if (!eb) { rows.push({ st: 'del', m: A, el: ea, changes: [] }); status.set(ea, 'del'); continue; }
    const changes = [];
    if (onlyCols) {
      for (const k of listCols) { if (k === '@Model') continue; const x = norm(getVal(A, ea, k)), y = norm(getVal(B, eb, k)); if (x !== y) changes.push([k, x, y]); }
    } else {
      const pa = allProps(A, ea), pb = allProps(B, eb);
      for (const k of new Set([...pa.keys(), ...pb.keys()])) { const x = norm(pa.get(k)), y = norm(pb.get(k)); if (x !== y) changes.push([k, x, y]); }
    }
    if (changes.length) { rows.push({ st: 'chg', m: B, el: eb, changes }); status.set(ea, 'chg'); status.set(eb, 'chg'); }
    else { same++; status.set(ea, 'same'); status.set(eb, 'same'); }
  }
  for (const [gid, eb] of gb) if (!ga.has(gid)) { rows.push({ st: 'add', m: B, el: eb, changes: [] }); status.set(eb, 'add'); }
  diffResult = { a: A, b: B, rows, status, same };
  busy('');
  $('#diffColor').disabled = false;
  $('#diffCsv').disabled = false;
  $('#colorMode').querySelector('[value=diff]').disabled = false;
  renderDiff();
};
const ST = { add: ['追加', 'st-add'], del: ['削除', 'st-del'], chg: ['変更', 'st-chg'] };
const chgText = (c) => c.map(([k, x, y]) => `${labelOf(k).replace(/^属性 \/ /, '') || k.replace('\t', ' / ')}: ${x || '(空)'} → ${y || '(空)'}`).join(' ｜ ');
let diffRows = [];
function renderDiff() {
  if (!diffResult) return;
  const f = $('#diffFilter').value;
  diffRows = diffResult.rows.filter((r) => !f || r.st === f);
  const n = (s) => diffResult.rows.filter((r) => r.st === s).length;
  $('#diffInfo').innerHTML = `<span class="chip st-add">追加 ${n('add')}</span><span class="chip st-del">削除 ${n('del')}</span><span class="chip st-chg">変更 ${n('chg')}</span><span class="chip">同一 ${diffResult.same}</span>`;
  $('#diffTable').innerHTML = `<thead><tr><th>区分</th><th>IFCクラス</th><th>Name</th><th>GlobalId</th><th>変更内容</th></tr></thead><tbody>` +
    diffRows.slice(0, LIST_MAX).map((r, i) => `<tr data-i="${i}"><td class="${ST[r.st][1]}">${ST[r.st][0]}</td><td>${esc(r.el.cls)}</td><td>${esc(r.el.name)}</td><td>${esc(r.el.gid)}</td><td title="${esc(chgText(r.changes))}">${esc(chgText(r.changes))}</td></tr>`).join('') + '</tbody>';
}
$('#diffFilter').onchange = renderDiff;
$('#diffTable').addEventListener('click', (e) => {
  const tr = e.target.closest('tbody tr');
  if (!tr) return;
  const r = diffRows[+tr.dataset.i];
  setSelection([{ m: r.m, el: r.el }]);
  if (r.st === 'chg') {
    const P = $('#props');
    P.insertAdjacentHTML('afterbegin', `<div class="psec"><div>変更内容（旧 → 新）</div><table>${r.changes.map(([k, x, y]) => `<tr><td>${esc(labelOf(k) || k.replace('\t', ' / '))}</td><td>${esc(x || '(空)')} → <b>${esc(y || '(空)')}</b></td></tr>`).join('')}</table></div>`);
  }
});
$('#diffTable').addEventListener('dblclick', () => zoomTo(selection));
$('#diffColor').onclick = () => setColorMode('diff');
$('#diffCsv').onclick = () => download('ifc_diff.csv', csv([['区分', 'IFCクラス', 'Name', 'GlobalId', 'プロパティ', '旧', '新'],
  ...diffResult.rows.flatMap((r) => (r.changes.length ? r.changes.map(([k, x, y]) => [ST[r.st][0], r.el.cls, r.el.name, r.el.gid, labelOf(k) || k.replace('\t', ' / '), x, y]) : [[ST[r.st][0], r.el.cls, r.el.name, r.el.gid, '', '', '']]))]));

// ---------- init ----------
renderModels();
renderList();
renderDiffSelectors();
initIfc().catch((e) => alert('web-ifc の初期化に失敗しました: ' + e.message));
window.__ifcviewer = { models, openFiles, setSelection, set2D, setColorMode, get selection() { return selection; } };
