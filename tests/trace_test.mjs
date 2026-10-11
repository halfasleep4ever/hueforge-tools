// node tests/trace_test.mjs  (run `npm install` in tests/ first)
import assert from "node:assert/strict";
import { traceMask, polyArea, simplifyPolys, layerMask, components, strokeStats, buildSvg } from "../assets/vector.js";

let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log("ok  " + name); };
const grid = (w, h, f) => { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = f(x, y) ? 1 : 0; return m; };
const count = m => m.reduce((s, v) => s + v, 0);
const totalArea = ps => ps.reduce((s, p) => s + polyArea(p), 0);

ok("square: 1 polygon, 0 holes, exact area", () => {
  const m = grid(20, 20, (x, y) => x >= 3 && x < 15 && y >= 4 && y < 10);
  const ps = traceMask(m, 20, 20);
  assert.equal(ps.length, 1); assert.equal(ps[0].holes.length, 0); assert.equal(ps[0].outer.length / 2, 4);
  assert.equal(totalArea(ps), 72);
});
ok("ring with 2 holes", () => {
  const m = grid(40, 30, (x, y) => x >= 2 && x < 38 && y >= 2 && y < 28 && !(x >= 6 && x < 14 && y >= 6 && y < 20) && !(x >= 20 && x < 34 && y >= 8 && y < 24));
  const ps = traceMask(m, 40, 30);
  assert.equal(ps.length, 1); assert.equal(ps[0].holes.length, 2); assert.equal(totalArea(ps), count(m));
});
ok("island inside a hole = 2 polygons", () => {
  const m = grid(30, 30, (x, y) => { const r = Math.max(Math.abs(x - 15), Math.abs(y - 15)); return r >= 10 && r < 13 || r < 4; });
  const ps = traceMask(m, 30, 30);
  assert.equal(ps.length, 2); assert.equal(ps.reduce((s, p) => s + p.holes.length, 0), 1); assert.equal(totalArea(ps), count(m));
});
ok("diagonal touch: 2 polygons (4-connected)", () => {
  const m = grid(4, 4, (x, y) => (x === 1 && y === 1) || (x === 2 && y === 2));
  const ps = traceMask(m, 4, 4);
  assert.equal(ps.length, 2); assert.equal(totalArea(ps), 2);
});
ok("disk with ring hole: exact, and simplified within 1%", () => {
  const W = 300, m = grid(W, W, (x, y) => { const r = Math.hypot(x + 0.5 - 150, y + 0.5 - 150); return r < 120 && r >= 50; });
  const ps = traceMask(m, W, W);
  assert.equal(ps.length, 1); assert.equal(ps[0].holes.length, 1); assert.equal(totalArea(ps), count(m));
  const sp = simplifyPolys(ps, 1.0), a = totalArea(sp), err = Math.abs(a - count(m)) / count(m);
  console.log(`    vertices ${ps[0].outer.length / 2 + ps[0].holes[0].length / 2} -> ${sp[0].outer.length / 2 + sp[0].holes[0].length / 2}, area err ${(err * 100).toFixed(3)}%`);
  assert.ok(err < 0.01);
});
ok("random label map: every layer exact, stacked layers nest", () => {
  let s = 1; const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const w = 120, h = 90, lab = new Uint8Array(w * h);
  const blobs = Array.from({ length: 25 }, () => [R() * w, R() * h, 5 + R() * 20, Math.floor(R() * 4)]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let l = 0; for (const [cx, cy, r, c] of blobs) if (Math.hypot(x - cx, y - cy) < r) l = c; lab[y * w + x] = l; }
  const order = [0, 1, 2, 3];
  let prev = Infinity;
  for (let i = 0; i < 4; i++) {
    for (const stacked of [true, false]) {
      const m = layerMask(lab, order, i, stacked), ps = traceMask(m, w, h);
      assert.equal(totalArea(ps), count(m));
      const holes = ps.reduce((t, p) => t + p.holes.length, 0);
      assert.equal(ps.length, components(m, w, h, (a, b) => a === b, v => !v).count);
      if (stacked) { assert.ok(count(m) <= prev); prev = count(m); }
      if (i === 1 && stacked) console.log(`    layer 1 stacked: ${ps.length} polygons, ${holes} holes`);
    }
  }
  const svg = buildSvg([{ name: "a", color: [1, 2, 3], polys: traceMask(layerMask(lab, order, 1), w, h) }], w, h);
  assert.ok(svg.includes('fill-rule="evenodd"'));
});
ok("stroke width: 1.0 mm line passes, 0.5 mm line warns (10 px/mm)", () => {
  const thick = grid(100, 40, (x, y) => x >= 10 && x < 90 && y >= 15 && y < 25);
  const thin = grid(100, 40, (x, y) => x >= 10 && x < 90 && y >= 15 && y < 20);
  const a = strokeStats(thick, 100, 40, 10, 0.8), b = strokeStats(thin, 100, 40, 10, 0.8);
  console.log(`    thinnest: ${a.thinnestMm.toFixed(2)} mm / ${b.thinnestMm.toFixed(2)} mm`);
  assert.ok(a.ok); assert.ok(!b.ok); assert.ok(Math.abs(a.thinnestMm - 1.0) <= 0.1); assert.ok(Math.abs(b.thinnestMm - 0.5) <= 0.1);
});
console.log(`\n${pass} tests passed`);
