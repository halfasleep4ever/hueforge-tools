// Logo Chain Studio geometry.
// Chain: print-in-place, alternating links. "Flat" links lie on the bed; their joining sides are
// raised gates (a bar held up by corner posts). "Upright" links are rectangular loops standing on
// edge; each passes under a gate of one flat link and over it, then the same for the next one.
// So every link is closed and they come off the bed already joined. Corner flat links turn the
// chain, so it can zigzag to fit the bed.
import { deps, fromManifold } from "../assets/mesh3d.js";

export const CHAIN = { bar: 1.6, floor: 1.2, gate: 1.2, clear: 0.4, size: 10, gapA: 1.6 };
const DIRS = { E: [1, 0], W: [-1, 0], N: [0, 1], S: [0, -1] };
const OPP = { E: "W", W: "E", N: "S", S: "N" };

export function chainDims(c = CHAIN) {
  // a corner link holds two upright links at right angles: keep them apart by the clearance
  const a = Math.max(c.size / 2, 2.5 * c.bar + 2 * c.clear + 0.1), P = 2 * a + c.gapA;
  const zg0 = c.floor + c.clear, zg1 = zg0 + c.gate, zt0 = zg1 + c.clear, zt1 = zt0 + c.floor;
  return { a, P, zg0, zg1, zt0, zt1, height: zt1 };
}
const box = (M, x0, y0, z0, x1, y1, z1) => M.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);

// Flat link centred at (cx, cy) with gates on the given sides ("E","W","N","S").
export function flatLink(cx, cy, gates, c = CHAIN) {
  const { Manifold: M } = deps().wasm, d = chainDims(c), a = d.a, b = c.bar, parts = [];
  const side = { E: [a - b, -a, a, a], W: [-a, -a, -a + b, a], N: [-a, a - b, a, a], S: [-a, -a, a, -a + b] };
  const posts = new Set();
  for (const s of ["E", "W", "N", "S"]) {
    const [x0, y0, x1, y1] = side[s];
    if (gates.includes(s)) {
      parts.push(box(M, x0, y0, d.zg0, x1, y1, d.zg1));
      const ends = s === "E" || s === "W" ? [[x0, -a], [x0, a - b]] : [[-a, y0], [a - b, y0]];
      for (const e of ends) posts.add(e.join(","));
    } else parts.push(box(M, x0, y0, 0, x1, y1, c.floor));
  }
  for (const k of posts) { const [x, y] = k.split(",").map(Number); parts.push(box(M, x, y, 0, x + b, y + b, d.zg1)); }
  const m = M.union(parts).translate([cx, cy, 0]); parts.forEach(p => p.delete()); return m;
}
// Upright link between flat links at p and p + dir*P.
export function uprightLink(px, py, dir, c = CHAIN) {
  const { Manifold: M } = deps().wasm, d = chainDims(c), a = d.a, b = c.bar;
  const u0 = a - b - c.clear - b, u1 = d.P - u0; // along the chain, from link p's centre
  const outer = box(M, u0, -b / 2, 0, u1, b / 2, d.zt1), inner = box(M, u0 + b, -b / 2 - 1, c.floor, u1 - b, b / 2 + 1, d.zt0);
  let m = outer.subtract(inner); outer.delete(); inner.delete();
  const ang = { E: 0, N: 90, W: 180, S: 270 }[dir];
  const r = m.rotate([0, 0, ang]).translate([px, py, 0]); m.delete(); return r;
}

// Zigzag path of flat-link cells that fits the bed. Returns [{x,y,in,out}].
export function chainPath(nFlat, maxCols, P, start = [0, 0], firstIn = "S") {
  const cells = []; let col = 0, row = 0, goE = true;
  for (let k = 0; k < nFlat; k++) {
    cells.push({ x: start[0] + col * P, y: start[1] + row * P });
    if ((goE && col === maxCols - 1) || (!goE && col === 0)) { row++; goE = !goE; } else col += goE ? 1 : -1;
  }
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k], n = cells[k + 1], p = cells[k - 1];
    const dir = (q, r) => r.x > q.x ? "E" : r.x < q.x ? "W" : r.y > q.y ? "N" : "S";
    c.in = p ? OPP[dir(p, c)] : firstIn; c.out = n ? dir(c, n) : null;
  }
  return cells;
}

// Build chain manifolds. Returns {flats:[], uprights:[], links:[in chain order]}
export function buildChain({ length = 450, bedW = 250, bedH = 250, start = [0, 0], firstIn = "S", leadIn = true, c = CHAIN }) {
  const d = chainDims(c), nFlat = Math.max(2, Math.round(length / d.P));
  const maxCols = Math.max(2, Math.floor((bedW - 10) / d.P));
  const cells = chainPath(nFlat, maxCols, d.P, start, firstIn), links = [];
  cells.forEach((cell, k) => {
    if (k === 0 && leadIn) links.push({ kind: "up", m: uprightLink(cell.x + DIRS[firstIn][0] * d.P, cell.y + DIRS[firstIn][1] * d.P, OPP[firstIn], c) });
    links.push({ kind: "flat", m: flatLink(cell.x, cell.y, [cell.in, cell.out].filter(Boolean), c) });
    if (cell.out) links.push({ kind: "up", m: uprightLink(cell.x, cell.y, cell.out, c) });
  });
  return { links, cells, nFlat, length: (links.length) * d.P / 2, dims: d };
}

// ---------- logo -> pendant ----------
// labels: Int16Array w*h (-1 = background, else colour index). Grid pixel size px mm.
// Removes diagonal-only contacts so the extruded mesh is manifold.
export function cleanMask(mask, w, h) {
  let changed = true;
  while (changed) { changed = false;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const a = mask[y * w + x], b = mask[y * w + x + 1], c = mask[(y + 1) * w + x], e = mask[(y + 1) * w + x + 1];
      if (a && e && !b && !c) { mask[y * w + x + 1] = 1; changed = true; }
      else if (b && c && !a && !e) { mask[y * w + x] = 1; changed = true; }
    }
  }
  return mask;
}
// Extrude a binary mask (row 0 = top of image) into a watertight mesh, z0..z1. Rows are merged into runs.
export function extrudeMask(mask, w, h, px, z0, z1, ox = 0, oy = 0) {
  const pos = [], idx = [], vmap = new Map();
  const V = (gx, gy, top) => { const k = (gy * (w + 1) + gx) * 2 + (top ? 1 : 0); let v = vmap.get(k);
    if (v === undefined) { v = pos.length / 3; vmap.set(k, v); pos.push(ox + gx * px, oy + (h - gy) * px, top ? z1 : z0); } return v; };
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    // y grows downward in grid, upward in mm: vertex (gx,gy) -> (x, h-gy)
    quad(V(x, y + 1, 1), V(x + 1, y + 1, 1), V(x + 1, y, 1), V(x, y, 1)); // top, normal +z
    quad(V(x, y, 0), V(x + 1, y, 0), V(x + 1, y + 1, 0), V(x, y + 1, 0)); // bottom
    if (!at(x, y - 1)) quad(V(x, y, 0), V(x, y, 1), V(x + 1, y, 1), V(x + 1, y, 0));
    if (!at(x, y + 1)) quad(V(x + 1, y + 1, 0), V(x + 1, y + 1, 1), V(x, y + 1, 1), V(x, y + 1, 0));
    if (!at(x - 1, y)) quad(V(x, y + 1, 0), V(x, y + 1, 1), V(x, y, 1), V(x, y, 0));
    if (!at(x + 1, y)) quad(V(x + 1, y, 0), V(x + 1, y, 1), V(x + 1, y + 1, 1), V(x + 1, y + 1, 0));
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
export function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice(); const out = new Uint8Array(w * h), r2 = r * r;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!mask[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r2) continue; const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h) out[Y * w + X] = 1; } }
  return out;
}
// k-means on opaque pixels. data = RGBA Uint8ClampedArray. Returns {labels, centers}
export function quantize(data, w, h, k, { alphaCut = 128, bg = null, bgTol = 40 } = {}) {
  const n = w * h, labels = new Int16Array(n).fill(-1), pts = [];
  for (let i = 0; i < n; i++) { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (data[i * 4 + 3] < alphaCut) continue; if (bg && Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < bgTol) continue; pts.push(i); }
  if (!pts.length) return { labels, centers: [] };
  let C = []; for (let j = 0; j < k; j++) { const i = pts[Math.floor((j + 0.5) * pts.length / k)]; C.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]); }
  // farthest-point seeding for distinct colours
  C = [C[0]]; while (C.length < k) { let best = -1, bi = pts[0]; for (let s = 0; s < pts.length; s += Math.max(1, pts.length >> 12)) { const i = pts[s]; const dmin = Math.min(...C.map(c => (data[i * 4] - c[0]) ** 2 + (data[i * 4 + 1] - c[1]) ** 2 + (data[i * 4 + 2] - c[2]) ** 2)); if (dmin > best) { best = dmin; bi = i; } } C.push([data[bi * 4], data[bi * 4 + 1], data[bi * 4 + 2]]); }
  for (let it = 0; it < 12; it++) {
    const S = C.map(() => [0, 0, 0, 0]);
    for (const i of pts) { let bj = 0, bd = Infinity; for (let j = 0; j < C.length; j++) { const d = (data[i * 4] - C[j][0]) ** 2 + (data[i * 4 + 1] - C[j][1]) ** 2 + (data[i * 4 + 2] - C[j][2]) ** 2; if (d < bd) { bd = d; bj = j; } }
      labels[i] = bj; const s = S[bj]; s[0] += data[i * 4]; s[1] += data[i * 4 + 1]; s[2] += data[i * 4 + 2]; s[3]++; }
    C = C.map((c, j) => S[j][3] ? [S[j][0] / S[j][3], S[j][1] / S[j][3], S[j][2] / S[j][3]] : c);
  }
  return { labels, centers: C };
}
// Majority filter to drop single-pixel specks (keeps edges clean for printing)
export function despeckle(labels, w, h) {
  const out = labels.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, cnt = new Map();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const l = labels[i + dy * w + dx]; cnt.set(l, (cnt.get(l) || 0) + 1); }
    let bl = labels[i], bc = 0; for (const [l, c] of cnt) if (c > bc) { bc = c; bl = l; } if (bc >= 5) out[i] = bl; }
  return out;
}

// Pendant + chain. layers: [{mask, colorIndex}] already sized w×h at px mm per pixel.
// Returns objects per colour: [{name, mesh, extruder}] and info.
export function buildNecklace({ labels, w, h, px, nColors, baseColor = 0, base = 1.6, layer = 0.8, border = 1.5,
  length = 450, bedW = 250, bedH = 250, c = CHAIN }) {
  const { Manifold: M } = deps().wasm, d = chainDims(c);
  const any = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) any[i] = labels[i] >= 0 ? 1 : 0;
  const plate = cleanMask(dilate(any, w, h, Math.round(border / px)), w, h);
  const W = w * px, H = h * px;
  // pendant lower-left at (0,0); bail on top centre is a flat link with a gate facing north
  const bailX = W / 2;
  // top of the plate anywhere (the chain must stay above it) and under the bail (for the joint)
  const topOf = (x0, x1) => { for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) if (plate[y * w + x]) return (h - y) * px; return 0; };
  const plateTop = topOf(0, w - 1), midTop = topOf(Math.max(0, Math.floor(w / 2 - 2 / px)), Math.min(w - 1, Math.ceil(w / 2 + 2 / px)));
  const by = plateTop + d.a - c.bar - 0.2;
  const plateMesh = extrudeMask(plate, w, h, px, 0, base);
  const plateMan = (() => { const W2 = deps().wasm; const m = new W2.Mesh({ numProp: 3, vertProperties: plateMesh.pos, triVerts: plateMesh.idx }); m.merge(); return new W2.Manifold(m); })();
  const bail = flatLink(bailX, by, ["N"], c);
  const neck = box(M, bailX - c.bar, midTop - 1.5, 0, bailX + c.bar, by - d.a + c.bar, base); // solid joint from plate into the bail
  const baseMan = M.union([plateMan, bail, neck]); [plateMan, bail, neck].forEach(m => m.delete());
  // chain starts one cell above the bail; zigzag to the right and up
  const chain = buildChain({ length, bedW: bedW - bailX + d.a, bedH, start: [bailX, by + d.P], firstIn: "S", leadIn: true, c });
  const objs = [];
  const baseMesh = fromManifold(baseMan); baseMan.delete();
  const linkMeshes = chain.links.map(l => fromManifold(l.m));
  chain.links.forEach(l => l.m.delete());
  // colour layers sit on the plate
  const layers = [];
  for (let ci = 0; ci < nColors; ci++) {
    const m = new Uint8Array(w * h); let cnt = 0; for (let i = 0; i < w * h; i++) if (labels[i] === ci) { m[i] = 1; cnt++; }
    if (!cnt || ci === baseColor) continue;
    cleanMask(m, w, h); layers.push({ ci, mesh: extrudeMask(m, w, h, px, base, base + layer) });
  }
  const top = by + d.P * (1 + Math.max(...chain.cells.map(q => (q.y - by - d.P) / d.P))) + d.a;
  const right = Math.max(W, ...chain.cells.map(q => q.x + d.a));
  const warn = []; if (right > bedW || top > bedH) warn.push(`Layout is ${right.toFixed(0)} × ${top.toFixed(0)} mm: bigger than the bed. Make the chain shorter or the pendant smaller.`);
  return { base: baseMesh, links: linkMeshes, layers, chain, size: [W, H], layoutSize: [right, top], warn };
}

// --- clearance helpers (used by tests and the page's self-check) ---
function ptTri(p, a, b, c) { // squared distance point-triangle (Ericson)
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  const q = (x) => { const v = sub(p, x); return dot(v, v); };
  if (d1 <= 0 && d2 <= 0) return q(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return q(b);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return q([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return q(c);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return q([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return q([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return q([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}
function segSeg(p1, q1, p2, q2) { // squared distance between segments
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s, t; const cc = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
  s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - cc * e) / den)) : 0;
  t = (b * s + f) / e; if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -cc / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - cc) / a)); }
  const x = sub([p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t]); return dot(x, x);
}
// Minimum distance between two (small) meshes: vertex-face both ways plus edge-edge.
export function meshDistance(A, B) {
  const v = (m, i) => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]];
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (let i = 0; i < P.pos.length / 3; i++) { const p = v(P, i);
    for (let t = 0; t < Q.idx.length; t += 3) best = Math.min(best, ptTri(p, v(Q, Q.idx[t]), v(Q, Q.idx[t + 1]), v(Q, Q.idx[t + 2]))); }
  const edges = m => { const e = []; for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) e.push([v(m, m.idx[t + k]), v(m, m.idx[t + (k + 1) % 3])]); return e; };
  const EA = edges(A), EB = edges(B);
  for (const [a0, a1] of EA) for (const [b0, b1] of EB) best = Math.min(best, segSeg(a0, a1, b0, b1));
  return Math.sqrt(best);
}
