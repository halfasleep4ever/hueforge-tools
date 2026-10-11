// Shared 3D mesh helpers: STL and 3MF read/write, welding, watertight checks, volume,
// Manifold (boolean library) bridge and a small three.js viewer.
// Works in the browser (loadDeps pulls pinned CDN builds) and in Node (tests call setDeps).
// A mesh here is { pos: Float32Array [x,y,z,...], idx: Uint32Array [a,b,c,...] }.

export const CDN = {
  fflate: "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js",
  manifold: "https://cdn.jsdelivr.net/npm/manifold-3d@2.5.1/manifold.js",
  manifoldWasm: "https://cdn.jsdelivr.net/npm/manifold-3d@2.5.1/manifold.wasm",
};
let D = { fflate: null, wasm: null };
export function setDeps({ fflate, wasm }) { if (fflate) D.fflate = fflate; if (wasm) D.wasm = wasm; }
export function deps() { return D; }
export async function loadDeps({ manifold = true } = {}) {
  if (!D.fflate) D.fflate = await import(CDN.fflate);
  if (manifold && !D.wasm) {
    const Module = (await import(CDN.manifold)).default;
    const w = await Module({ locateFile: () => CDN.manifoldWasm });
    w.setup(); D.wasm = w;
  }
  return D;
}

// ---------- basic mesh ops ----------
export function mergeMeshes(list) {
  let nv = 0, ni = 0; for (const m of list) { nv += m.pos.length; ni += m.idx.length; }
  const pos = new Float32Array(nv), idx = new Uint32Array(ni); let ov = 0, oi = 0;
  for (const m of list) { pos.set(m.pos, ov); const base = ov / 3; for (let i = 0; i < m.idx.length; i++) idx[oi + i] = m.idx[i] + base; ov += m.pos.length; oi += m.idx.length; }
  return { pos, idx };
}
export function transformMesh(m, t) { // t = 3MF 12-number matrix (row vectors)
  if (!t) return m; const p = new Float32Array(m.pos.length);
  for (let i = 0; i < p.length; i += 3) { const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
    p[i] = x * t[0] + y * t[3] + z * t[6] + t[9]; p[i + 1] = x * t[1] + y * t[4] + z * t[7] + t[10]; p[i + 2] = x * t[2] + y * t[5] + z * t[8] + t[11]; }
  return { pos: p, idx: m.idx };
}
export function mulT(a, b) { // apply a then b
  const r = new Array(12);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { let s = i === 3 ? b[9 + j] : 0; for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j]; r[i * 3 + j] = s; }
  return r;
}
export function weld(pos) { // non-indexed triangle soup -> indexed mesh (exact position match)
  const map = new Map(), out = [], idx = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length; i += 3) {
    const k = pos[i] + "," + pos[i + 1] + "," + pos[i + 2]; let v = map.get(k);
    if (v === undefined) { v = out.length / 3; map.set(k, v); out.push(pos[i], pos[i + 1], pos[i + 2]); }
    idx[i / 3] = v;
  }
  return { pos: new Float32Array(out), idx };
}
export function bounds(m) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.pos[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { min: mn, max: mx, size: mx.map((v, k) => v - mn[k]) };
}
export function volume(m) {
  let v = 0; const p = m.pos, ix = m.idx;
  for (let i = 0; i < ix.length; i += 3) { const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]); }
  return v / 6;
}
// Watertight check by edge counting: every undirected edge used by exactly 2 triangles, once in each direction.
export function edgeCheck(m) {
  const w = weld(unindex(m)); const cnt = new Map(); let degenerate = 0;
  const n = w.pos.length / 3;
  for (let i = 0; i < w.idx.length; i += 3) {
    const t = [w.idx[i], w.idx[i + 1], w.idx[i + 2]];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) { degenerate++; continue; }
    for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3]; const k = a < b ? a * n + b : b * n + a;
      const c = cnt.get(k) || [0, 0]; c[a < b ? 0 : 1]++; cnt.set(k, c); }
  }
  let boundary = 0, nonManifold = 0, badOrient = 0;
  for (const [f, r] of cnt.values()) { const s = f + r; if (s === 1) boundary++; else if (s > 2) nonManifold++; else if (f !== 1) badOrient++; }
  return { edges: cnt.size, boundary, nonManifold, badOrient, degenerate, watertight: boundary === 0 && nonManifold === 0 && badOrient === 0 };
}
export function unindex(m) { const p = new Float32Array(m.idx.length * 3); for (let i = 0; i < m.idx.length; i++) { const v = m.idx[i] * 3; p[i * 3] = m.pos[v]; p[i * 3 + 1] = m.pos[v + 1]; p[i * 3 + 2] = m.pos[v + 2]; } return p; }

// ---------- STL ----------
export function parseSTL(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
  if (u8.length === 84 + n * 50 && n > 0) {
    const p = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) p[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
    return weld(p);
  }
  const txt = new TextDecoder().decode(u8), out = [], re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let r;
  while ((r = re.exec(txt))) out.push(+r[1], +r[2], +r[3]);
  if (!out.length) throw new Error("Not an STL file");
  return weld(new Float32Array(out));
}
export function writeSTL(m) {
  const nt = m.idx.length / 3, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode("binary STL, HueForge Tools"), 0); dv.setUint32(80, nt, true);
  for (let i = 0; i < nt; i++) {
    const a = m.idx[i * 3] * 3, b = m.idx[i * 3 + 1] * 3, c = m.idx[i * 3 + 2] * 3, P = m.pos;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    const o = 84 + i * 50; dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    [a, b, c].forEach((v, j) => { dv.setFloat32(o + 12 + j * 12, P[v], true); dv.setFloat32(o + 16 + j * 12, P[v + 1], true); dv.setFloat32(o + 20 + j * 12, P[v + 2], true); });
  }
  return new Uint8Array(buf);
}

// ---------- 3MF ----------
const attr = (s, name) => { const r = new RegExp("(?:^|\\s)" + name.replace(":", "\\:") + "\\s*=\\s*\"([^\"]*)\"").exec(s); return r ? r[1] : null; };
const parseT = s => s ? s.trim().split(/\s+/).map(Number) : null;
function parseModelXML(xml) { // -> Map id -> {mesh?, components:[{path,objectid,t}], name}
  const objs = new Map(), re = /<object\b([^>]*)>([\s\S]*?)<\/object>/g; let r;
  while ((r = re.exec(xml))) {
    const id = attr(r[1], "id"), body = r[2], o = { id, name: attr(r[1], "name"), components: [] };
    const mi = body.indexOf("<mesh");
    if (mi >= 0) {
      const vs = [], ts = [], vre = /<vertex\s([^>]*?)\/?>/g, tre = /<triangle\s([^>]*?)\/?>/g; let v;
      const vEnd = body.indexOf("</vertices>"), vb = body.slice(mi, vEnd), tb = body.slice(vEnd);
      while ((v = vre.exec(vb))) vs.push(+attr(v[1], "x"), +attr(v[1], "y"), +attr(v[1], "z"));
      while ((v = tre.exec(tb))) ts.push(+attr(v[1], "v1"), +attr(v[1], "v2"), +attr(v[1], "v3"));
      o.mesh = { pos: new Float32Array(vs), idx: new Uint32Array(ts) };
    }
    const cre = /<component\s([^>]*?)\/?>/g; let c;
    while ((c = cre.exec(body))) o.components.push({ path: attr(c[1], "p:path"), objectid: attr(c[1], "objectid"), t: parseT(attr(c[1], "transform")) });
    objs.set(id, o);
  }
  return objs;
}
// Returns { files (all zip entries), items: [{name, mesh (world coords), objectId}], mesh (all items merged) }
export function read3MF(buf) {
  const files = D.fflate.unzipSync(new Uint8Array(buf)), dec = new TextDecoder();
  const mainPath = Object.keys(files).find(k => /^3D\/[^/]+\.model$/i.test(k)); if (!mainPath) throw new Error("No 3D model in this 3MF");
  const cache = new Map(); const getModel = p => { p = (p || mainPath).replace(/^\//, ""); if (!cache.has(p)) { if (!files[p]) throw new Error("Missing " + p); cache.set(p, parseModelXML(dec.decode(files[p]))); } return cache.get(p); };
  const main = getModel(mainPath), xml = dec.decode(files[mainPath]);
  const resolve = (path, id, t) => { const o = getModel(path).get(id); if (!o) return [];
    const out = o.mesh && o.mesh.idx.length ? [transformMesh(o.mesh, t)] : [];
    for (const c of o.components) out.push(...resolve(c.path || path, c.objectid, c.t ? (t ? mulT(c.t, t) : c.t) : t));
    return out; };
  const items = [], ire = /<item\s([^>]*?)\/?>/g; let r;
  while ((r = ire.exec(xml))) { const id = attr(r[1], "objectid"), o = main.get(id);
    items.push({ objectId: id, name: (o && o.name) || "object " + id, mesh: mergeMeshes(resolve(mainPath, id, parseT(attr(r[1], "transform")))) }); }
  if (!items.length) throw new Error("No printable objects in this 3MF");
  return { files, items, mesh: mergeMeshes(items.map(i => i.mesh)) };
}
const uuid = (i, s) => `${(s >>> 0).toString(16).padStart(8, "0")}-${(0x1000 + i).toString(16)}-4000-8000-${i.toString(16).padStart(12, "0")}`;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function meshXML(m) {
  const P = m.pos, I = m.idx, parts = ["<mesh><vertices>"];
  for (let i = 0; i < P.length; i += 3) parts.push(`<vertex x="${+P[i].toFixed(5)}" y="${+P[i + 1].toFixed(5)}" z="${+P[i + 2].toFixed(5)}"/>`);
  parts.push("</vertices><triangles>");
  for (let i = 0; i < I.length; i += 3) parts.push(`<triangle v1="${I[i]}" v2="${I[i + 1]}" v3="${I[i + 2]}"/>`);
  parts.push("</triangles></mesh>"); return parts.join("\n");
}
// objects: [{name, mesh (world coords), extruder}]. keep: files from a source 3MF to copy through
// (its 3D/ geometry and model_settings are replaced; everything else is copied byte for byte).
export function write3MF(objects, { keep = null, title = "HueForge Tools" } = {}) {
  const enc = new TextEncoder(), out = {}, n = objects.length, seed = Date.now();
  if (keep) for (const [k, v] of Object.entries(keep)) if (!/^3D\//i.test(k) && k !== "Metadata/model_settings.config" && !k.endsWith("/")) out[k] = v;
  const NS = `xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"`;
  const sub = [`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NS}>\n<metadata name="BambuStudio:3mfVersion">1</metadata>\n<resources>`];
  objects.forEach((o, i) => sub.push(`<object id="${i + 1}" p:UUID="${uuid(i + 1, seed)}" type="model">${meshXML(o.mesh)}</object>`));
  sub.push("</resources>\n<build/>\n</model>");
  const main = [`<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NS}>\n<metadata name="Application">${esc(title)}</metadata>\n<metadata name="BambuStudio:3mfVersion">1</metadata>\n<resources>`];
  objects.forEach((o, i) => main.push(`<object id="${n + i + 1}" p:UUID="${uuid(n + i + 1, seed)}" type="model"><components><component p:path="/3D/Objects/parts.model" objectid="${i + 1}" p:UUID="${uuid(2 * n + i + 1, seed)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>`));
  main.push(`</resources>\n<build p:UUID="${uuid(9999, seed)}">`);
  objects.forEach((o, i) => main.push(`<item objectid="${n + i + 1}" p:UUID="${uuid(3 * n + i + 1, seed)}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>`));
  main.push("</build>\n</model>");
  out["3D/3dmodel.model"] = enc.encode(main.join("\n"));
  out["3D/Objects/parts.model"] = enc.encode(sub.join("\n"));
  out["3D/_rels/3dmodel.model.rels"] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/Objects/parts.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>`);
  if (!out["[Content_Types].xml"]) out["[Content_Types].xml"] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>`);
  if (!out["_rels/.rels"]) out["_rels/.rels"] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>`);
  // model_settings: one object per piece; keep the source plate/assemble blocks as they were
  let plate = `<plate>\n<metadata key="plater_id" value="1"/>\n</plate>`;
  if (keep && keep["Metadata/model_settings.config"]) { const s = new TextDecoder().decode(keep["Metadata/model_settings.config"]); const pm = /<plate>[\s\S]*?<\/plate>/.exec(s); if (pm) plate = pm[0]; }
  const ms = [`<?xml version="1.0" encoding="UTF-8"?>\n<config>`];
  objects.forEach((o, i) => ms.push(`<object id="${n + i + 1}">\n<metadata key="name" value="${esc(o.name)}"/>\n<metadata key="extruder" value="${o.extruder || 1}"/>\n<part id="${i + 1}" subtype="normal_part">\n<metadata key="name" value="${esc(o.name)}"/>\n<metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n</part>\n</object>`));
  ms.push(plate, "</config>");
  out["Metadata/model_settings.config"] = enc.encode(ms.join("\n"));
  return D.fflate.zipSync(out, { level: 6 });
}
export function zipFiles(map) { return D.fflate.zipSync(map, { level: 6 }); }
// extruder number from a HueForge/Orca model_settings.config (first object), default 1
export function sourceExtruder(files) {
  const f = files["Metadata/model_settings.config"]; if (!f) return 1;
  const m = /key="extruder" value="(\d+)"/.exec(new TextDecoder().decode(f)); return m ? +m[1] : 1;
}

// ---------- Manifold bridge ----------
export function toManifold(m) {
  const W = D.wasm; const mesh = new W.Mesh({ numProp: 3, vertProperties: new Float32Array(m.pos), triVerts: new Uint32Array(m.idx) });
  mesh.merge(); return new W.Manifold(mesh);
}
export function fromManifold(man) { const g = man.getMesh(); const np = g.numProp;
  let pos = g.vertProperties; if (np !== 3) { pos = new Float32Array(g.numVert * 3); for (let i = 0; i < g.numVert; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = g.vertProperties[i * np + k]; }
  return { pos: new Float32Array(pos), idx: new Uint32Array(g.triVerts) }; }

// ---------- three.js viewer ----------
export function createViewer(THREE, OrbitControls, el) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  el.append(renderer.domElement); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
  const scene = new THREE.Scene(); scene.background = new THREE.Color(matchMedia("(prefers-color-scheme: light)").matches && document.documentElement.dataset.theme !== "dark" ? "#dfe3ea" : "#2a2f3a"); const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, -2, 3); scene.add(dl);
  const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true;
  let group = new THREE.Group(); scene.add(group);
  const size = () => { const w = el.clientWidth || 400, h = el.clientHeight || 300; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  new ResizeObserver(size).observe(el); size();
  (function loop() { requestAnimationFrame(loop); ctl.update(); renderer.render(scene, cam); })();
  return {
    show(list, { keepView = false } = {}) {
      scene.remove(group); group.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); group = new THREE.Group();
      for (const { mesh, color = "#cccccc" } of list) {
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(mesh.pos, 3)); g.setIndex(new THREE.BufferAttribute(mesh.idx, 1)); g.computeVertexNormals();
        group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, flatShading: true })));
      }
      scene.add(group); if (keepView) return;
      const box = new THREE.Box3().setFromObject(group); if (box.isEmpty()) return; const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length() || 10;
      ctl.target.copy(c); cam.up.set(0, 0, 1); cam.position.set(c.x, c.y - s * 0.9, c.z + s * 0.9); cam.near = s / 100; cam.far = s * 20; cam.updateProjectionMatrix();
    },
  };
}
