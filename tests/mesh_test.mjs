// Node tests for assets/mesh3d.js and the Frame, Puzzle and Logo Chain geometry.
// Setup once:  (cd tests && npm i --no-save manifold-3d@2.5.1 fflate@0.8.2)
// Run:         node tests/mesh_test.mjs           (or HFT_DEPS=/path/to/node_modules/ node tests/mesh_test.mjs)
// Optional:    HFT_3MF=/path/to/real_hueforge.3mf  also cuts a real HueForge export.
import fs from "fs";
const DEPS = process.env.HFT_DEPS || new URL("./node_modules/", import.meta.url).pathname;
const M = await import("../assets/mesh3d.js");
const fflate = await import(DEPS + "fflate/esm/index.mjs");
const wasm = await (await import(DEPS + "manifold-3d/manifold.js")).default(); wasm.setup();
M.setDeps({ fflate, wasm });
const F = await import("../frame-studio/frame.js");
const P = await import("../puzzle-studio/puzzle.js");
const C = await import("../logo-chain-studio/chain.js");

let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// synthetic plate: heightfield-like block 60 x 40, top steps 1.0 / 1.6 / 2.2 mm (a mini HueForge plate)
function stepPlate() {
  const a = wasm.Manifold.cube([60, 40, 1.0]), b = wasm.Manifold.cube([40, 40, 0.6]).translate([20, 0, 1.0]), c = wasm.Manifold.cube([20, 40, 0.6]).translate([40, 0, 1.6]);
  const u = wasm.Manifold.union([a, b, c]); const m = M.fromManifold(u); [a, b, c, u].forEach(x => x.delete()); return m; // volume = 2400 + 960 + 480 = 3840
}

// 1. STL round trip
{
  const m = stepPlate(), bin = M.writeSTL(m), back = M.parseSTL(bin.buffer);
  ok(back.idx.length === m.idx.length, "STL round trip: triangle count", `${back.idx.length / 3}`);
  ok(near(M.volume(back), M.volume(m), 1e-3) && near(M.volume(m), 3840, 0.01), "STL round trip: volume", M.volume(back).toFixed(3));
  ok(M.edgeCheck(back).watertight, "STL round trip: still watertight");
  const ascii = "solid t\n" + [...Array(back.idx.length / 3).keys()].map(t => "facet normal 0 0 0\nouter loop\n" + [0, 1, 2].map(k => { const v = back.idx[t * 3 + k] * 3; return `vertex ${back.pos[v]} ${back.pos[v + 1]} ${back.pos[v + 2]}`; }).join("\n") + "\nendloop\nendfacet").join("\n") + "\nendsolid";
  ok(near(M.volume(M.parseSTL(new TextEncoder().encode(ascii).buffer)), 3840, 0.01), "ASCII STL read");
}
// 2. 3MF write -> read, metadata kept
{
  const m = stepPlate(), keep = { "Metadata/custom_gcode_per_layer.xml": new TextEncoder().encode("<custom_gcodes_per_layer><layer top_z=\"1.2\"/></custom_gcodes_per_layer>"), "Metadata/project_settings.config": new TextEncoder().encode("{\"layer_height\":\"0.08\"}") };
  const z = M.write3MF([{ name: "a", mesh: m, extruder: 2 }, { name: "b", mesh: M.transformMesh(m, [1, 0, 0, 0, 1, 0, 0, 0, 1, 70, 0, 0]), extruder: 3 }], { keep });
  const r = M.read3MF(z);
  ok(r.items.length === 2, "3MF write→read: 2 objects");
  ok(near(M.volume(r.mesh), 7680, 0.05), "3MF write→read: volume", M.volume(r.mesh).toFixed(2));
  ok(near(M.bounds(r.items[1].mesh).min[0], 70, 1e-4), "3MF write→read: placement kept");
  ok(Object.keys(keep).every(k => Buffer.compare(Buffer.from(r.files[k]), Buffer.from(keep[k])) === 0), "3MF write→read: metadata files byte-identical");
  ok(/extruder" value="3"/.test(new TextDecoder().decode(r.files["Metadata/model_settings.config"])), "3MF write→read: extruder per object");
}
// 3. Frame watertight, several option sets
for (const o of [{}, { mode: "drop" }, { hanger: true, stand: false }, { tabs: true, border: 14 }, { hanger: true, tabs: true, stand: true, border: 15, radius: 8 }]) {
  const r = F.buildFrame({ ...F.DEFAULTS, ...o }), e = M.edgeCheck(r.mesh);
  ok(e.watertight && r.volume > 0, "Frame watertight " + JSON.stringify(o), `edges ${e.edges}, boundary ${e.boundary}, non-manifold ${e.nonManifold}`);
}
{ const I = F.frameInfo(F.DEFAULTS); ok(near(I.win[0], 94, 1e-9) && near(I.pocket[0], 100.6, 1e-9), "Frame: opening 94 × 144 and pocket 100.6 for a 100 × 150 print"); }
// 4. Puzzle 2 x 2 on the synthetic plate
{
  const m = stepPlate(), gap = 0.2, res = P.cutPuzzle(m, { rows: 2, cols: 2, gap });
  ok(res.pieces.length === 4, "Puzzle 2×2: 4 pieces");
  ok(res.pieces.every(p => M.edgeCheck(p.mesh).watertight), "Puzzle 2×2: every piece watertight");
  // kerf: each interior cut path (with knobs) removes gap × height; measure path length from the layout
  const L = P.layout(M.bounds(m), 2, 2, res.knob, 7);
  const perim = L.reduce((s, p) => s + p.poly.reduce((t, q, i) => t + Math.hypot(q[0] - p.poly[(i + 1) % p.poly.length][0], q[1] - p.poly[(i + 1) % p.poly.length][1]), 0), 0);
  const outer = 2 * (62 + 42), cutLen = (perim - outer) / 2; // shared edges counted twice
  // the cut crosses three step heights; average height along the cuts by sampling is complex -> bound it
  const lossMin = cutLen * gap * 1.0, lossMax = cutLen * gap * 2.2, loss = res.origVol - res.totalVol;
  ok(loss > lossMin * 0.9 && loss < lossMax * 1.1, "Puzzle 2×2: volume = original minus kerf", `orig ${res.origVol.toFixed(1)}, pieces ${res.totalVol.toFixed(1)}, loss ${loss.toFixed(1)} in [${lossMin.toFixed(1)}, ${lossMax.toFixed(1)}]`);
  const g0 = P.cutPuzzle(m, { rows: 2, cols: 2, gap: 0 });
  ok(near(g0.totalVol, g0.origVol, 0.05), "Puzzle gap 0: pieces add up to the original", `${g0.totalVol.toFixed(3)} vs ${g0.origVol.toFixed(3)}`);
  const zb = M.bounds(m), zp = M.mergeMeshes(res.pieces.map(p => p.mesh)), bb = M.bounds(zp);
  ok(near(bb.max[2], zb.max[2], 1e-6) && near(bb.min[2], zb.min[2], 1e-6) && near(bb.size[0], 60, 1e-4), "Puzzle: same size and same heights", `z ${bb.min[2]}..${bb.max[2]}`);
  const small = P.cutPuzzle(m, { rows: 4, cols: 8, gap });
  ok(small.warnings.some(w => /area/.test(w)), "Puzzle: warns about pieces that are too small", small.warnings.find(w => /area/.test(w)));
  // pieces keep the plate's step heights (z values of the top faces are unchanged)
  const zset = new Set(); res.pieces.forEach(p => { for (let i = 2; i < p.mesh.pos.length; i += 3) zset.add(+p.mesh.pos[i].toFixed(4)); });
  ok([...zset].sort().join() === "0,1,1.6,2.2", "Puzzle: only the original Z levels exist", [...zset].join(" "));
}
// 5. Chain clearance + watertight
{
  const W = 80, H = 80, lab = new Int16Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const r = Math.hypot(x - 40, y - 40); if (r < 36) lab[y * W + x] = r < 18 ? 1 : (Math.abs(x - 40) < 6 ? 2 : 0); }
  for (const clear of [0.4, 0.3]) {
    const c = { ...C.CHAIN, clear };
    const n = C.buildNecklace({ labels: lab, w: W, h: H, px: 0.4, nColors: 3, length: 300, bedW: 150, bedH: 200, c });
    let mn = Infinity; for (let i = 0; i + 1 < n.links.length; i++) mn = Math.min(mn, C.meshDistance(n.links[i], n.links[i + 1]));
    mn = Math.min(mn, C.meshDistance(n.base, n.links[0]));
    ok(mn >= clear - 1e-3, `Chain: neighbour link gap ≥ ${clear} mm`, `min ${mn.toFixed(4)} over ${n.links.length} links`);
    let any = Infinity; for (let i = 0; i < n.links.length; i++) for (let j = i + 1; j < n.links.length; j++) { const a = M.bounds(n.links[i]), b = M.bounds(n.links[j]);
      if (a.min[0] > b.max[0] + 1 || b.min[0] > a.max[0] + 1 || a.min[1] > b.max[1] + 1 || b.min[1] > a.max[1] + 1) continue; any = Math.min(any, C.meshDistance(n.links[i], n.links[j])); }
    ok(any >= clear - 1e-3, `Chain: no two links closer than ${clear} mm (corners too)`, `min ${any.toFixed(4)}`);
    ok(n.links.every(l => M.edgeCheck(l).watertight) && M.edgeCheck(n.base).watertight && n.layers.every(l => M.edgeCheck(l.mesh).watertight), "Chain + pendant + colour layers watertight");
    ok(n.layoutSize[0] <= 150 && n.layoutSize[1] <= 200 && !n.warn.length, "Chain: zigzag fits the bed", n.layoutSize.map(v => v.toFixed(0)).join(" × "));
  }
  // interlock by construction: every upright link's opening holds the gate bars of both neighbours
  const d = C.chainDims(), cc = C.CHAIN, a = d.a, u0 = a - 2 * cc.bar - cc.clear;
  ok(u0 + cc.bar < a - cc.bar && d.zg0 > cc.floor && d.zt0 > d.zg1, "Chain: gate bar sits inside the upright link's opening");
}
// 6. Optional: real HueForge export
if (process.env.HFT_3MF && fs.existsSync(process.env.HFT_3MF)) {
  const t = Date.now(), r = M.read3MF(fs.readFileSync(process.env.HFT_3MF));
  ok(M.edgeCheck(r.mesh).watertight, "Real 3MF: source watertight", `${r.mesh.idx.length / 3} triangles`);
  const res = P.cutPuzzle(r.mesh, { rows: 3, cols: 3 });
  const z = M.write3MF(res.pieces.map(p => ({ name: p.name, mesh: p.mesh, extruder: M.sourceExtruder(r.files) })), { keep: r.files }), back = M.read3MF(z);
  const meta = Object.keys(r.files).filter(k => k.startsWith("Metadata/") && k !== "Metadata/model_settings.config");
  ok(meta.every(k => Buffer.compare(Buffer.from(back.files[k]), Buffer.from(r.files[k])) === 0), "Real 3MF: Metadata files copied byte for byte", meta.join(", "));
  const b0 = M.bounds(r.mesh), b1 = M.bounds(back.mesh);
  ok([0, 1, 2].every(k => near(b0.min[k], b1.min[k], 1e-3) && near(b0.max[k], b1.max[k], 1e-3)), "Real 3MF: same position and size after cut", `${(Date.now() - t) / 1000}s`);
  ok(back.items.length === 9 && res.pieces.every(p => M.edgeCheck(p.mesh).watertight), "Real 3MF: 9 watertight pieces");
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
