// Pure maths for TD Meter: step-card mesh, binary STL writer, TD fit. No DOM, so Node tests can import it.

export const OPAQUE_T = 0.03; // "almost opaque" = 3 % of the light gets through

// Card layout (mm). Along x: frame | open window | frame | 8 steps | frame. Along y: frame | 20 | frame.
export function cardLayout({ layer = 0.08, first = 0.08, steps = 8, stepW = 10, stepD = 20, frame = 3, frameH = null } = {}) {
  const stepH = n => +(first + (n - 1) * layer).toFixed(4);
  const top = stepH(steps);
  const fh = frameH ?? Math.max(1.0, +(top + 0.4).toFixed(2));
  const xs = [0, frame, frame + stepW, 2 * frame + stepW];
  for (let i = 1; i <= steps; i++) xs.push(2 * frame + stepW + i * stepW);
  xs.push(xs[xs.length - 1] + frame);
  const ys = [0, frame, frame + stepD, 2 * frame + stepD];
  const nx = xs.length - 1, ny = ys.length - 1;
  const H = [];
  for (let i = 0; i < nx; i++) {
    H.push([]);
    for (let j = 0; j < ny; j++) {
      let h = fh;
      if (j === 1) { if (i === 1) h = 0; else if (i >= 3 && i < 3 + steps) h = stepH(i - 2); }
      H[i].push(h);
    }
  }
  // centres of the window and steps, as fraction along the line window-centre -> last-step-centre
  const cx = i => (xs[i] + xs[i + 1]) / 2;
  const x0 = cx(1), x1 = cx(2 + steps);
  const stepFrac = Array.from({ length: steps }, (_, k) => (cx(3 + k) - x0) / (x1 - x0));
  return { xs, ys, H, frameH: fh, thickness: Array.from({ length: steps }, (_, k) => stepH(k + 1)), stepFrac, width: xs[nx], depth: ys[ny] };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Watertight mesh of a height field on a (non-uniform) grid. Cells with height 0 are holes.
export function heightfieldMesh(xs, ys, H) {
  const nx = xs.length - 1, ny = ys.length - 1, tris = [];
  const h = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny) ? 0 : H[i][j];
  const tri = (a, b, c, n) => { const nn = cross(sub(b, a), sub(c, a)); tris.push(dot(nn, n) >= 0 ? [a, b, c] : [a, c, b]); };
  const quad = (a, b, c, d, n) => { tri(a, b, c, n); tri(a, c, d, n); };
  // z levels present at each grid corner (shared by all walls that touch it)
  const levels = (i, j) => [...new Set([0, h(i - 1, j - 1), h(i, j - 1), h(i - 1, j), h(i, j)])].sort((a, b) => a - b);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const z = H[i][j]; if (!(z > 0)) continue;
    const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
    quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1]);
    quad([x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [0, 0, -1]);
  }
  // wall between two corners pA,pB (2D) from lo to hi, outward normal n; zipper-triangulate the two vertical chains
  const wall = (pA, cA, pB, cB, lo, hi, n) => {
    const A = levels(...cA).filter(z => z >= lo && z <= hi).map(z => [pA[0], pA[1], z]);
    const B = levels(...cB).filter(z => z >= lo && z <= hi).map(z => [pB[0], pB[1], z]);
    let a = 0, b = 0;
    while (a < A.length - 1 || b < B.length - 1) {
      if (b >= B.length - 1 || (a < A.length - 1 && A[a + 1][2] <= B[b + 1][2])) { tri(A[a], B[b], A[a + 1], n); a++; }
      else { tri(A[a], B[b], B[b + 1], n); b++; }
    }
  };
  for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) { // walls on x = xs[i]
    const l = h(i - 1, j), r = h(i, j); if (l === r) continue;
    wall([xs[i], ys[j]], [i, j], [xs[i], ys[j + 1]], [i, j + 1], Math.min(l, r), Math.max(l, r), [l > r ? 1 : -1, 0, 0]);
  }
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) { // walls on y = ys[j]
    const d = h(i, j - 1), u = h(i, j); if (d === u) continue;
    wall([xs[i], ys[j]], [i, j], [xs[i + 1], ys[j]], [i + 1, j], Math.min(d, u), Math.max(d, u), [0, d > u ? 1 : -1, 0]);
  }
  return tris;
}

export function stlBinary(tris, name = "hueforge-tools td card") {
  const buf = new ArrayBuffer(84 + 50 * tris.length), dv = new DataView(buf);
  for (let i = 0; i < Math.min(80, name.length); i++) dv.setUint8(i, name.charCodeAt(i) & 127);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const n = cross(sub(b, a), sub(c, a)), L = Math.hypot(...n) || 1;
    for (const v of [n.map(x => x / L), a, b, c]) for (const x of v) { dv.setFloat32(o, x, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return buf;
}

export function cardSTL(opts) { const L = cardLayout(opts); const tris = heightfieldMesh(L.xs, L.ys, L.H); return { layout: L, tris, stl: stlBinary(tris) }; }

// Fit ln T = a - k t by least squares. The intercept a absorbs surface losses and tint
// (T just above 0 mm is below 1 in a real photo). With only 2 points, a = 0 (line through the origin).
// TD = thickness where the decay alone leaves 3 % of the light: ln(1/0.03) / k.
export function fitTD(points, opaque = OPAQUE_T) {
  const p = points.filter(q => q.t > 0 && q.T > 0 && q.T < 1 && isFinite(q.T));
  if (p.length < 2) return { ok: false, reason: "Need at least 2 steps that are darker than the open window and not black.", used: p.length };
  const n = p.length, ys = p.map(q => Math.log(q.T));
  let k, a = 0;
  const mt = p.reduce((s, q) => s + q.t, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = p.reduce((s, q) => s + (q.t - mt) ** 2, 0);
  if (n >= 3 && sxx > 0) { k = -p.reduce((s, q, i) => s + (q.t - mt) * (ys[i] - my), 0) / sxx; a = my + k * mt; }
  else { k = -p.reduce((s, q, i) => s + q.t * ys[i], 0) / p.reduce((s, q) => s + q.t * q.t, 0); }
  if (!(k > 0)) return { ok: false, reason: "Steps do not get darker with thickness. Check the clicks and the order.", used: n };
  let ssr = 0, sst = 0;
  p.forEach((q, i) => { ssr += (ys[i] - a + k * q.t) ** 2; sst += (ys[i] - my) ** 2; });
  return { ok: true, k, a, surface: Math.exp(a), td: Math.log(1 / opaque) / k, r2: sst > 0 ? 1 - ssr / sst : 1, used: n };
}

// sRGB 0-255 -> linear light 0-1 (photos store gamma-encoded values)
export const toLinear = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const fromLinear = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export const lumLinear = (r, g, b) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
