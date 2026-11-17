// IFC 構成分析（形状は生成しない）。ブラウザ・Node 共通
const SKIP = new Set(['IFCOPENINGELEMENT', 'IFCOPENINGSTANDARDCASE', 'IFCVOIDINGFEATURE', 'IFCVIRTUALELEMENT']);
const BODY_IDS = new Set(['Body', 'Facetation', 'Brep', 'Tessellation', 'SurfaceModel']);
const NON_BODY = new Set(['Axis', 'Box', 'FootPrint', 'Annotation', 'Profile', 'Reference', 'Clearance', 'CoG', 'Lighting']);

export const val = (v) => (v == null ? '' : typeof v === 'object' && 'value' in v ? v.value : v);
export const refs = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((r) => (r && typeof r === 'object' ? r.value : r)).filter((x) => x != null);

// ---------- ⑤ 容量: テキスト走査 ----------
export const CATS = [
  ['関係', /^IFCREL/],
  ['プロパティ', /^IFC(PROPERTY|COMPLEXPROPERTY|ELEMENTQUANTITY|QUANTITY|PHYSICALCOMPLEXQUANTITY)/],
  ['配置', /^IFC(LOCALPLACEMENT|AXIS2PLACEMENT|GRIDPLACEMENT|LINEARPLACEMENT)/],
  ['表現スタイル', /^IFC(STYLEDITEM|PRESENTATIONSTYLE|SURFACESTYLE|COLOURRGB|CURVESTYLE|FILLAREASTYLE|PRESENTATIONLAYER|DRAUGHTINGPREDEFINED|INDEXEDCOLOURMAP|TEXTSTYLE)/],
  ['形状', /^IFC(CARTESIAN|DIRECTION|VECTOR|POLY|FACE|ORIENTEDEDGE|EDGE|VERTEX|CLOSEDSHELL|OPENSHELL|CONNECTEDFACESET|SHELLBASED|FACETEDBREP|ADVANCEDBREP|MANIFOLDSOLIDBREP|EXTRUDED|REVOLVED|SWEPT|SURFACECURVESWEPT|FIXEDREFERENCESWEPT|BOOLEAN|HALFSPACE|POLYGONALBOUNDEDHALFSPACE|TRIANGULATED|INDEXED|TESSELLATED|POLYGONALFACESET|MAPPEDITEM|REPRESENTATIONMAP|SHAPEREPRESENTATION|PRODUCTDEFINITIONSHAPE|PRODUCTREPRESENTATION|.*PROFILEDEF|CIRCLE|ELLIPSE|LINE$|TRIMMEDCURVE|COMPOSITECURVE|BSPLINE|RATIONALBSPLINE|PLANE|CYLINDRICALSURFACE|SURFACEOFLINEAR|SURFACEOFREVOLUTION|CURVEBOUNDED|BOUNDINGBOX|CSGSOLID|BLOCK|SPHERE|RIGHTCIRCULAR|GEOMETRICREPRESENTATION|GEOMETRICSET|SHAPEASPECT|OFFSETCURVE|CARTESIANTRANSFORMATION|SECTIONEDSPINE|GEOMETRICCURVESET|SWEPTDISKSOLID|EXTRUDEDAREASOLID)/],
];
export function categoryOf(t) {
  for (const [c, re] of CATS) if (re.test(t)) return c;
  return 'その他';
}
export function scanBytes(buf) {
  const n = buf.length;
  const head = new TextDecoder('latin1').decode(buf.subarray(0, Math.min(n, 65536)));
  const di = head.indexOf('DATA;');
  const header = di >= 0 ? head.slice(0, di) : head.slice(0, 4000);
  const types = new Map();
  const nameCache = new Map();
  let i = di >= 0 ? di + 5 : 0;
  let total = 0, count = 0;
  while (i < n) {
    if (buf[i] !== 35) { i++; continue; }
    const start = i++;
    while (i < n && buf[i] >= 48 && buf[i] <= 57) i++;
    while (i < n && buf[i] === 32) i++;
    if (buf[i] !== 61) continue;
    i++;
    while (i < n && (buf[i] === 32 || buf[i] === 10 || buf[i] === 13)) i++;
    const ns = i;
    let h = 0;
    while (i < n && buf[i] !== 40 && buf[i] !== 32) { h = (h * 31 + buf[i]) | 0; i++; }
    let name = nameCache.get(h);
    if (!name) { name = String.fromCharCode.apply(null, buf.subarray(ns, i)).toUpperCase(); nameCache.set(h, name); }
    let inStr = false;
    while (i < n) { const c = buf[i]; if (c === 39) inStr = !inStr; else if (c === 59 && !inStr) break; i++; }
    const bytes = i - start + 1;
    i++;
    let t = types.get(name);
    if (!t) { t = { name, count: 0, bytes: 0 }; types.set(name, t); }
    t.count++; t.bytes += bytes; total += bytes; count++;
  }
  return { header, types: [...types.values()], total, count };
}

function decodeStep(s) {
  return s.replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (m, hx) => {
    let o = '';
    for (let k = 0; k < hx.length; k += 4) o += String.fromCharCode(parseInt(hx.slice(k, k + 4), 16));
    return o;
  }).replace(/''/g, "'");
}
export function parseHeader(h) {
  const args = (fn) => {
    const m = h.match(new RegExp(fn + '\\s*\\(([\\s\\S]*?)\\);'));
    if (!m) return [];
    const out = [];
    let cur = '', depth = 0, inStr = false;
    for (const c of m[1]) {
      if (c === "'") inStr = !inStr;
      if (!inStr && c === '(') depth++;
      if (!inStr && c === ')') depth--;
      if (!inStr && depth === 0 && c === ',') { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(cur.trim());
    return out.map((x) => decodeStep(x.replace(/^\(|\)$/g, '').replace(/'/g, '')));
  };
  const fd = args('FILE_DESCRIPTION'), fn = args('FILE_NAME'), fs = args('FILE_SCHEMA');
  return { description: fd[0] || '', timestamp: fn[1] || '', preprocessor: fn[4] || '', originating: fn[5] || '', schema: fs[0] || '' };
}

// ---------- web-ifc を使った分析 ----------
export async function analyzeModel(api, W, mid, onProgress = () => {}, yieldUI = async () => {}) {
  const ids = (type, inh = false) => { const v = api.GetLineIDsWithType(mid, type, inh); const a = new Array(v.size()); for (let i = 0; i < a.length; i++) a[i] = v.get(i); return a; };
  const tcache = new Map();
  const tname = (id) => {
    const code = api.GetLineType(mid, id);
    let s = tcache.get(code);
    if (s === undefined) { s = (api.GetNameFromTypeCode(code) || '').toUpperCase(); tcache.set(code, s); }
    return s;
  };
  const pretty = (u) => PRETTY[u] || u;
  const line = (id) => api.GetLine(mid, id);
  let tick = 0;
  const step = async (p, msg) => { if (++tick % 2000 === 0) { onProgress(p, msg); await yieldUI(); } };

  // 要素
  const elemIds = ids(W.IFCELEMENT, true).filter((id) => !SKIP.has(tname(id)));
  const el = new Map();
  for (const id of elemIds) el.set(id, { id, cls: pretty(tname(id)), type: 0, psets: [], body: 'none', rep: '', src: 0, srcIsType: false, sharedOwn: false });

  // アプリケーション・単位
  const info = { apps: [], lengthUnit: '', proxies: 0 };
  for (const a of ids(W.IFCAPPLICATION)) { const A = line(a); info.apps.push([val(A.ApplicationFullName), val(A.Version)].filter(Boolean).join(' ')); }
  for (const ua of ids(W.IFCUNITASSIGNMENT)) for (const u of refs(line(ua).Units)) {
    const U = line(u);
    if (val(U.UnitType) === 'LENGTHUNIT') info.lengthUnit = [val(U.Prefix), val(U.Name)].filter(Boolean).join(' ');
  }
  for (const e of el.values()) if (e.cls === 'IfcBuildingElementProxy') info.proxies++;

  // ① タイプ
  onProgress(0.05, 'タイプを集計中');
  const types = new Map();
  for (const tid of ids(W.IFCTYPEOBJECT, true)) {
    const T = line(tid);
    types.set(tid, { id: tid, cls: pretty(tname(tid)), name: val(T.Name), psets: refs(T.HasPropertySets), maps: refs(T.RepresentationMaps), n: 0 });
  }
  const typeMaps = new Set();
  for (const T of types.values()) T.maps.forEach((m) => typeMaps.add(m));
  for (const rid of ids(W.IFCRELDEFINESBYTYPE)) {
    await step(0.08, 'タイプを集計中');
    const r = line(rid);
    const tid = val(r.RelatingType);
    const T = types.get(tid);
    for (const c of refs(r.RelatedObjects)) { const e = el.get(c); if (e) { e.type = tid; if (T) { T.n++; T.ecls = e.cls; } } }
  }

  // ② 形状
  const srcInner = new Map();
  const itemUse = new Map();
  let k = 0;
  for (const e of el.values()) {
    if (++k % 1000 === 0) { onProgress(0.1 + 0.35 * (k / el.size), `形状の構成を解析中（${k.toLocaleString()} / ${el.size.toLocaleString()}）`); await yieldUI(); }
    const L = line(e.id);
    const pds = val(L.Representation);
    if (!pds) continue;
    const reps = refs(line(pds).Representations).map((r) => ({ id: r, R: line(r) }));
    let body = reps.filter((x) => BODY_IDS.has(val(x.R.RepresentationIdentifier)));
    if (!body.length) body = reps.filter((x) => !NON_BODY.has(val(x.R.RepresentationIdentifier)));
    if (!body.length) continue;
    let mapped = 0, own = 0;
    const kinds = new Set();
    for (const { R } of body) {
      for (const it of refs(R.Items)) {
        if (tname(it) === 'IFCMAPPEDITEM') {
          mapped++;
          const src = val(line(it).MappingSource);
          if (!e.src) e.src = src;
          let inner = srcInner.get(src);
          if (inner === undefined) {
            try { inner = val(line(val(line(src).MappedRepresentation)).RepresentationType) || '?'; } catch (x) { inner = '?'; }
            srcInner.set(src, inner);
          }
          kinds.add('Mapped→' + inner);
          if (typeMaps.has(src)) e.srcIsType = true;
        } else {
          own++;
          itemUse.set(it, (itemUse.get(it) || 0) + 1);
          if (!e.ownItem) e.ownItem = it;
          kinds.add(val(R.RepresentationType) || pretty(tname(it)));
        }
      }
    }
    e.body = mapped && own ? 'mixed' : mapped ? 'mapped' : own ? 'own' : 'none';
    e.rep = [...kinds].join(' + ');
  }
  for (const e of el.values()) if (e.ownItem && itemUse.get(e.ownItem) > 1) e.sharedOwn = true;

  // ③ プロパティ
  const psetUse = new Map();
  const rels = ids(W.IFCRELDEFINESBYPROPERTIES);
  k = 0;
  for (const rid of rels) {
    if (++k % 2000 === 0) { onProgress(0.45 + 0.15 * (k / rels.length), `プロパティの関係を解析中（${k.toLocaleString()} / ${rels.length.toLocaleString()}）`); await yieldUI(); }
    const r = line(rid);
    const defs = refs(r.RelatingPropertyDefinition);
    const objs = refs(r.RelatedObjects);
    for (const d of defs) psetUse.set(d, (psetUse.get(d) || 0) + objs.length);
    for (const c of objs) { const e = el.get(c); if (e) e.psets.push(...defs); }
  }
  for (const T of types.values()) for (const p of T.psets) psetUse.set(p, (psetUse.get(p) || 0) + Math.max(1, T.n));
  const psetCache = new Map();
  const pset = (pid) => {
    let ps = psetCache.get(pid);
    if (ps) return ps;
    ps = { name: '', props: [] };
    try {
      const L = line(pid);
      ps.name = String(val(L.Name) || pretty(tname(pid)));
      for (const p of refs(L.HasProperties || L.Quantities)) {
        const P = line(p);
        ps.props.push({ id: p, name: String(val(P.Name)), v: propVal(P) });
      }
    } catch (x) { /* 参照切れ */ }
    psetCache.set(pid, ps);
    return ps;
  };

  // ③④ 要素ごと集計
  const typeProps = new Map();
  const typeKeys = new Map();
  k = 0;
  for (const e of el.values()) {
    if (++k % 1000 === 0) { onProgress(0.6 + 0.35 * (k / el.size), `プロパティを解析中（${k.toLocaleString()} / ${el.size.toLocaleString()}）`); await yieldUI(); }
    e.nInstPsets = e.psets.length;
    e.nInstProps = 0; e.nShared = 0; e.dupType = 0;
    for (const p of e.psets) { e.nInstProps += pset(p).props.length; if ((psetUse.get(p) || 0) > 1) e.nShared++; }
    const T = types.get(e.type);
    e.nTypeProps = 0;
    if (!T) continue;
    let tp = typeProps.get(T.id);
    if (!tp) {
      tp = new Map();
      for (const p of T.psets) for (const q of pset(p).props) tp.set(q.name, String(q.v));
      typeProps.set(T.id, tp);
    }
    e.nTypeProps = tp.size;
    let km = typeKeys.get(T.id);
    if (!km) { km = new Map(); typeKeys.set(T.id, km); }
    for (const p of e.psets) {
      const ps = pset(p);
      for (const q of ps.props) {
        const sv = String(q.v);
        if (tp.has(q.name) && tp.get(q.name) === sv) e.dupType++;
        const key = ps.name + '\t' + q.name;
        let x = km.get(key);
        if (!x) { x = { v: sv, same: true, ids: new Set(), n: 0 }; km.set(key, x); }
        else if (x.v !== sv) x.same = false;
        x.ids.add(q.id); x.n++;
      }
    }
  }

  // ④ 重複候補
  const dupByKey = new Map();
  for (const [tid, km] of typeKeys) {
    const T = types.get(tid);
    if (T.n < 2) continue;
    for (const [key, x] of km) {
      if (!x.same || x.n < T.n || x.ids.size < 2) continue;
      let d = dupByKey.get(key);
      if (!d) { d = { key, types: 0, instances: 0, reducible: 0, classes: new Set() }; dupByKey.set(key, d); }
      d.types++; d.instances += x.n; d.reducible += x.ids.size - 1; d.classes.add(T.ecls);
    }
  }
  const dupByClass = new Map();
  for (const [tid, km] of typeKeys) {
    const T = types.get(tid);
    if (T.n < 2) continue;
    for (const x of km.values()) if (x.same && x.n >= T.n && x.ids.size > 1) dupByClass.set(T.ecls, (dupByClass.get(T.ecls) || 0) + x.ids.size - 1);
  }

  onProgress(0.98, '集計中');
  return summarize({ el, types, info, psetUse, dupByKey, dupByClass, srcInner, typeMaps });
}

function propVal(P) {
  const f = (v) => { v = val(v); return typeof v === 'number' ? Number(v.toFixed(6)) : v; };
  if (P.NominalValue !== undefined) return f(P.NominalValue);
  if (P.EnumerationValues) return refs2(P.EnumerationValues).join(', ');
  if (P.ListValues) return refs2(P.ListValues).join(', ');
  for (const key of Object.keys(P)) if (/Value$/.test(key) && P[key] != null) return f(P[key]);
  return '';
}
const refs2 = (a) => (Array.isArray(a) ? a : [a]).map((x) => val(x));

function summarize({ el, types, info, psetUse, dupByKey, dupByClass, typeMaps }) {
  const byCls = new Map();
  const tot = newAgg('（全体）');
  for (const e of el.values()) {
    let a = byCls.get(e.cls);
    if (!a) { a = newAgg(e.cls); byCls.set(e.cls, a); }
    addAgg(a, e); addAgg(tot, e);
  }
  for (const a of [...byCls.values(), tot]) finishAgg(a, dupByClass, types);
  tot.dup = [...dupByClass.values()].reduce((s, x) => s + x, 0);
  const repKinds = new Map();
  for (const e of el.values()) if (e.rep) repKinds.set(e.rep, (repKinds.get(e.rep) || 0) + 1);
  const unusedTypes = [...types.values()].filter((T) => T.n === 0).length;
  const typeRows = [...types.values()].map((T) => ({ cls: T.cls, ecls: T.ecls || '', name: T.name, n: T.n, psets: T.psets.length, maps: T.maps.length }));
  const psetsTotal = psetUse.size;
  const psetsShared = [...psetUse.values()].filter((n) => n > 1).length;
  return {
    total: tot, classes: [...byCls.values()].sort((a, b) => b.n - a.n), repKinds: [...repKinds].sort((a, b) => b[1] - a[1]),
    nTypes: types.size, unusedTypes, typeRows, info, psetsTotal, psetsShared, typeMapCount: typeMaps.size,
    dupKeys: [...dupByKey.values()].map((d) => ({ ...d, classes: [...d.classes].join(', ') })).sort((a, b) => b.reducible - a.reducible),
  };
}
function newAgg(cls) {
  return { cls, n: 0, typed: 0, typeSet: new Set(), mapped: 0, own: 0, mixed: 0, none: 0, srcIsType: 0, sharedOwn: 0, geoSrc: new Set(),
    instPsets: 0, instProps: 0, typeProps: 0, sharedPsets: 0, dupType: 0, typedInstProps: 0 };
}
function addAgg(a, e) {
  a.n++;
  if (e.type) { a.typed++; a.typeSet.add(e.type); a.typedInstProps += e.nInstProps; }
  a[e.body]++;
  if (e.srcIsType) a.srcIsType++;
  if (e.sharedOwn) a.sharedOwn++;
  if (e.src) a.geoSrc.add('m' + e.src); else if (e.ownItem) a.geoSrc.add('o' + e.ownItem);
  a.instPsets += e.nInstPsets; a.instProps += e.nInstProps; a.typeProps += e.nTypeProps; a.sharedPsets += e.nShared; a.dupType += e.dupType;
}
function finishAgg(a, dupByClass) {
  a.nTypes = a.typeSet.size; delete a.typeSet;
  a.geoSources = a.geoSrc.size; delete a.geoSrc;
  const withGeo = a.n - a.none;
  a.typedPct = a.n ? a.typed / a.n : 0;
  a.mappedPct = withGeo ? (a.mapped + a.mixed) / withGeo : 0;
  a.reuse = a.geoSources ? withGeo / a.geoSources : 0;
  a.dup = dupByClass.get(a.cls) || 0;
  a.typePropShare = a.instProps + a.typeProps ? a.typeProps / (a.instProps + a.typeProps) : 0;
  a.verdict = verdict(a);
}
export function verdict(a) {
  if (!a.n) return '';
  if (a.typedPct >= 0.8) return a.mappedPct >= 0.5 ? 'タイプ構成（形状もタイプで共有）' : 'タイプ構成（形状はインスタンスごと）';
  if (a.typedPct >= 0.2) return '混在';
  return a.mappedPct >= 0.5 ? 'インスタンス構成（形状は共有）' : 'フルインスタンス構成';
}

const PRETTY = {};
export function initPretty(W) {
  for (const ns of [W.IFC2X3, W.IFC4, W.IFC4X3]) for (const key of Object.keys(ns || {})) if (/^Ifc[A-Z]/.test(key)) PRETTY[key.toUpperCase()] = key;
}
export const prettyName = (u) => PRETTY[u] || u;
