// node tests/td_test.mjs
import assert from "node:assert/strict";
import { fitTD, cardSTL, heightfieldMesh, stlBinary, cardLayout } from "../td-meter/td.js";

let n = 0; const ok = (name, f) => { f(); n++; console.log("ok -", name); };

ok("fit recovers k exactly on clean data", () => {
  const k = 1.4, pts = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ t: 0.08 * i, T: Math.exp(-k * 0.08 * i) }));
  const r = fitTD(pts); assert.ok(r.ok); assert.ok(Math.abs(r.k - k) < 1e-9); assert.ok(Math.abs(r.td - Math.log(1 / 0.03) / k) < 1e-9); assert.ok(r.r2 > 0.9999);
});
ok("fit ignores a constant surface loss (intercept)", () => {
  const k = 1.46, pts = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ t: 0.08 * i, T: 0.88 * Math.exp(-k * 0.08 * i) }));
  const r = fitTD(pts); assert.ok(Math.abs(r.k - k) < 1e-9); assert.ok(Math.abs(r.surface - 0.88) < 1e-9);
});
ok("rising steps are rejected", () => { assert.equal(fitTD([0.3, 0.5, 0.7].map((T, i) => ({ t: 0.08 * (i + 1), T }))).ok, false); });
ok("fit with 3 % noise stays within 5 %", () => {
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const k = 2.5, pts = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ t: 0.08 * i, T: Math.exp(-k * 0.08 * i) * (1 + 0.06 * (rnd() - 0.5)) }));
  const r = fitTD(pts); assert.ok(Math.abs(r.k / k - 1) < 0.05, String(r.k));
});
ok("fit drops black / saturated points and rejects bad input", () => {
  const r = fitTD([{ t: 0.08, T: 0.5 }, { t: 0.16, T: 0.25 }, { t: 0.24, T: 0 }, { t: 0.32, T: 1.2 }]);
  assert.equal(r.used, 2); assert.ok(r.ok);
  assert.equal(fitTD([{ t: 0.08, T: 0.5 }]).ok, false);
  assert.equal(fitTD([{ t: 0.08, T: 0.9 }, { t: 0.16, T: 0.95 }]).ok, true);
  assert.equal(fitTD([{ t: 0.08, T: 0.99999 }, { t: 0.16, T: 0.999995 }]).ok, true);
});

function check(tris) {
  const key = v => v.map(x => x.toFixed(5)).join(",");
  const dir = new Map();
  for (const [a, b, c] of tris) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const k = key(p) + "|" + key(q); dir.set(k, (dir.get(k) || 0) + 1);
  }
  for (const [k, c] of dir) {
    assert.equal(c, 1, "directed edge used twice: " + k);
    const [p, q] = k.split("|"); assert.equal(dir.get(q + "|" + p), 1, "edge without partner: " + k);
  }
  for (const [a, b, c] of tris) { // no degenerate triangles
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    assert.ok(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) > 1e-9);
  }
  // signed volume > 0 means normals point outward
  let vol = 0; for (const [a, b, c] of tris) vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  return vol;
}
ok("single box = 12 triangles, closed, volume right", () => {
  const t = heightfieldMesh([0, 2], [0, 3], [[4]]); assert.equal(t.length, 12); assert.ok(Math.abs(check(t) - 24) < 1e-9);
});
ok("step card is watertight, oriented, and volume matches", () => {
  for (const opts of [{}, { layer: 0.12, first: 0.2 }, { layer: 0.04, first: 0.04 }]) {
    const { tris, layout: L, stl } = cardSTL(opts);
    let want = 0; for (let i = 0; i < L.H.length; i++) for (let j = 0; j < L.H[i].length; j++) want += L.H[i][j] * (L.xs[i + 1] - L.xs[i]) * (L.ys[j + 1] - L.ys[j]);
    assert.ok(Math.abs(check(tris) - want) < 1e-6 * want);
    const dv = new DataView(stl); assert.equal(stl.byteLength, 84 + 50 * tris.length); assert.equal(dv.getUint32(80, true), tris.length);
  }
  const L = cardLayout(); assert.deepEqual(L.thickness, [0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64]); assert.equal(L.H[1][1], 0);
  console.log("   card triangles:", cardSTL().tris.length, "size", cardLayout().width, "x", cardLayout().depth, "mm");
});
ok("stl round-trips first vertex", () => {
  const buf = stlBinary([[[1, 2, 3], [4, 5, 6], [7, 8, 10]]]); const dv = new DataView(buf);
  assert.equal(dv.getFloat32(84 + 12, true), 1); assert.equal(dv.getFloat32(84 + 44, true), 10);
});
console.log(`\n${n} tests passed`);
