// Puzzle Studio geometry: jigsaw outlines on a grid, each extruded through the full height
// and intersected with the model (Manifold booleans). Heights and Z are never changed.
import { deps, toManifold, fromManifold, bounds } from "../assets/mesh3d.js";

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// One edge from A to B with an optional tab. dir = +1 / -1 (side of the bump), 0 = straight.
function edge(A, B, dir, knob, out) {
  const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const P = (s, t) => out.push([A[0] + ux * s + nx * t * dir, A[1] + uy * s + ny * t * dir]);
  if (!dir) { P(0, 0); return; }
  const r = knob / 2, w = r * 0.62, neck = r * 0.45, cy = neck + r, m = L / 2;
  const y0 = cy - Math.sqrt(r * r - w * w);
  P(0, 0); P(m - w * 1.6, 0); P(m - w * 1.15, 0.05 * r); P(m - w, y0 * 0.5); P(m - w, y0);
  const a0 = Math.atan2(y0 - cy, -w), a1 = Math.atan2(y0 - cy, w); // go around the far side of the head
  let sweep = a1 - a0; if (sweep > 0) sweep -= 2 * Math.PI; // clockwise through the top (t>0)
  for (let i = 1; i < 28; i++) { const a = a0 + sweep * i / 28; P(m + r * Math.cos(a), cy + r * Math.sin(a)); }
  P(m + w, y0); P(m + w, y0 * 0.5); P(m + w * 1.15, 0.05 * r); P(m + w * 1.6, 0);
}

// Layout: returns piece outlines (polygons) in model XY, before the gap is applied.
export function layout(bb, rows, cols, knob, seed = 7) {
  const R = rng(seed), [x0, y0] = bb.min, [x1, y1] = bb.max, pad = 1;
  const X = i => i === 0 ? x0 - pad : i === cols ? x1 + pad : x0 + (x1 - x0) * i / cols;
  const Y = j => j === 0 ? y0 - pad : j === rows ? y1 + pad : y0 + (y1 - y0) * j / rows;
  const H = [], V = []; // H[j][i]: edge between row j-1 and j at column i; V[j][i]: between col i-1 and i
  for (let j = 0; j <= rows; j++) { H[j] = []; for (let i = 0; i < cols; i++) H[j][i] = j === 0 || j === rows ? 0 : (R() < 0.5 ? 1 : -1); }
  for (let j = 0; j < rows; j++) { V[j] = []; for (let i = 0; i <= cols; i++) V[j][i] = i === 0 || i === cols ? 0 : (R() < 0.5 ? 1 : -1); }
  const pieces = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const pts = [];
    // counter-clockwise: bottom (left->right), right (up), top (right->left), left (down)
    // edge(): bump goes to the left of travel when dir=+1. Shared edges keep one global sign.
    edge([X(i), Y(j)], [X(i + 1), Y(j)], -H[j][i], knob, pts);
    edge([X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], -V[j][i + 1], knob, pts);
    edge([X(i + 1), Y(j + 1)], [X(i), Y(j + 1)], H[j + 1][i], knob, pts);
    edge([X(i), Y(j + 1)], [X(i), Y(j)], V[j][i], knob, pts);
    pieces.push({ row: j, col: i, poly: pts });
  }
  return pieces;
}

// Cut. Returns { pieces: [{name, mesh, area, warn}], original volume, total volume, warnings }
export function cutPuzzle(mesh, { rows = 3, cols = 3, knob = 0, gap = 0.2, minWidth = 6, minArea = 150, seed = 7, onProgress } = {}) {
  const { Manifold: M, CrossSection: CS } = deps().wasm;
  const bb = bounds(mesh), cw = bb.size[0] / cols, ch = bb.size[1] / rows;
  if (!knob) knob = Math.min(cw, ch) * 0.28;
  const warnings = [];
  if (knob > Math.min(cw, ch) * 0.4) warnings.push(`Knob ${knob.toFixed(1)} mm is big for ${cw.toFixed(0)} × ${ch.toFixed(0)} mm pieces. Knobs may clash.`);
  if (knob * 0.62 * 2 - gap < minWidth * 0.5) warnings.push(`Knob necks are about ${(knob * 0.62 * 2 - gap).toFixed(1)} mm wide. They may break.`);
  let model;
  try { model = toManifold(mesh); } catch (e) { throw new Error("The model is not watertight, so it cannot be cut. (" + e.message + ")"); }
  if (model.status && model.status().value) { /* status codes differ between versions */ }
  const origVol = model.getProperties().volume;
  const zLo = bb.min[2] - 1, zH = bb.size[2] + 2, out = [];
  const L = layout(bb, rows, cols, knob, seed);
  L.forEach((p, k) => {
    onProgress && onProgress(k, L.length);
    let cs = new CS([p.poly], "Positive"); if (gap > 0) { const c2 = cs.offset(-gap / 2, "Round", 2, 16); cs.delete(); cs = c2; }
    const prism = cs.extrude(zH).translate([0, 0, zLo]);
    const part = model.intersect(prism);
    const name = `piece_r${p.row + 1}c${p.col + 1}`, w = [];
    const proj = part.project(), area = proj.area();
    if (area < minArea) w.push(`area ${area.toFixed(0)} mm²`);
    const opened = proj.offset(-minWidth / 2, "Round", 2, 16).offset(minWidth / 2, "Round", 2, 16);
    const lost = area - opened.area();
    if (area > 0 && lost / area > 0.12) w.push(`parts narrower than ${minWidth} mm`);
    if (part.isEmpty()) w.push("empty");
    out.push({ name, row: p.row, col: p.col, mesh: fromManifold(part), volume: part.getProperties().volume, area, warn: w });
    [cs, prism, part, proj, opened].forEach(o => o.delete());
  });
  model.delete();
  for (const p of out) if (p.warn.length) warnings.push(`${p.name}: ${p.warn.join(", ")}`);
  return { pieces: out, origVol, totalVol: out.reduce((s, p) => s + p.volume, 0), knob, cell: [cw, ch], warnings };
}
