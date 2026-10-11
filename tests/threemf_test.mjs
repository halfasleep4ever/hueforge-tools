// node tests/threemf_test.mjs  (run `npm install` in tests/ first)
import assert from "node:assert/strict";
import earcut from "earcut";
import { zipSync, unzipSync, strFromU8 } from "fflate";
import { traceMask, layerMask, extrude, newMesh, edgeCheck, make3MFFiles, stlBinary, boxPolys } from "../assets/vector.js";

const w = 60, h = 40, lab = new Uint8Array(w * h);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const r = Math.hypot(x - 20, y - 20); lab[y * w + x] = r < 6 ? 2 : r < 14 ? 1 : (x > 40 && x < 55 && y > 5 && y < 35 && !(x > 44 && x < 51 && y > 12 && y < 28)) ? 2 : 0;
}
lab[3 * w + 3] = 1; lab[4 * w + 4] = 1; // diagonal-touching pixels (saddle)
const order = [0, 1, 2], s = 0.5, tf = (x, y) => [x * s, (h - y) * s];
const parts = order.map((l, i) => {
  const mesh = newMesh(); const ps = traceMask(layerMask(lab, order, i), w, h);
  extrude(mesh, ps, i === 0 ? 0 : 1 + (i - 1) * 0.6, 1 + i * 0.6, tf, earcut);
  return { name: "C" + i, color: [i * 80, 100, 200], mesh, polys: ps.length };
});
const frame = newMesh(); extrude(frame, [{ outer: [-4, -4, w + 4, -4, w + 4, h + 4, -4, h + 4], holes: [[0, 0, 0, h, w, h, w, 0]] }], 0, 3, tf, earcut);
parts.push({ name: "Frame", color: [20, 20, 20], mesh: frame });

const zip = zipSync(make3MFFiles(parts, { title: "Test" }));
const files = unzipSync(zip);
for (const f of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model", "Metadata/model_settings.config"]) assert.ok(files[f], "missing " + f);
const xml = strFromU8(files["3D/3dmodel.model"]);
const objs = [...xml.matchAll(/<object id="(\d+)"[^>]*>(.*?)<\/object>/gs)];
const meshObjs = objs.filter(o => o[2].includes("<mesh>"));
assert.equal(meshObjs.length, parts.length);
assert.equal((xml.match(/<base /g) || []).length, parts.length);
assert.ok(/<components>(<component objectid="\d+"\/>){4}<\/components>/.test(xml));
meshObjs.forEach((o, j) => {
  const verts = [...o[2].matchAll(/<vertex x="([-\d.e]+)" y="([-\d.e]+)" z="([-\d.e]+)"\/>/g)];
  const tris = [...o[2].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].flatMap(m => [+m[1], +m[2], +m[3]]);
  assert.equal(verts.length, parts[j].mesh.pos.length / 3); assert.equal(tris.length, parts[j].mesh.idx.length);
  assert.ok(tris.every(i => i < verts.length));
  const e = edgeCheck(tris);
  // signed volume must be positive (outward normals)
  const P = verts.map(v => [+v[1], +v[2], +v[3]]); let vol = 0;
  for (let t = 0; t < tris.length; t += 3) { const [a, b, c] = [P[tris[t]], P[tris[t + 1]], P[tris[t + 2]]]; vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  console.log(`ok  ${parts[j].name}: ${verts.length} vertices, ${tris.length / 3} triangles, ${e.edges} directed edges, open ${e.open}, volume ${vol.toFixed(1)} mm3`);
  assert.ok(e.closed, parts[j].name + " not closed"); assert.ok(vol > 0);
});
// base volume = area * thickness: 60*40 px * 0.25 mm2 * 1 mm = 600
const cfg = strFromU8(files["Metadata/model_settings.config"]);
assert.equal((cfg.match(/<part /g) || []).length, parts.length);
const stl = stlBinary(parts[1].mesh); assert.equal(new DataView(stl.buffer).getUint32(80, true), parts[1].mesh.idx.length / 3);
assert.equal(stl.length, 84 + 50 * parts[1].mesh.idx.length / 3);
console.log(`ok  zip ${zip.length} bytes, config has ${parts.length} parts, STL size matches\n\nall 3MF tests passed`);
