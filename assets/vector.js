// Vector + mesh helpers for SVG Convert, Wall Art Studio and Text Studio.
// Pure functions, no DOM, so Node tests can import them. earcut is passed in by the caller.

// ---------- colour ----------
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function rgbToLab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const lightness = rgb => rgbToLab(rgb)[0]; // CIE L*, 0..100
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// rgba: Uint8ClampedArray. Returns {labels (255 = transparent), colors: [[r,g,b]], counts}
export function quantize(rgba, w, h, { k = 6, palette = null, alphaCut = 128, seed = 7 } = {}) {
  const n = w * h, labels = new Uint8Array(n).fill(255);
  let centers;
  if (palette && palette.length) centers = palette.map(rgbToLab);
  else {
    const samp = [], step = Math.max(1, Math.floor(n / 30000));
    for (let i = 0; i < n; i += step) if (rgba[i * 4 + 3] >= alphaCut) samp.push(rgbToLab([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]));
    if (!samp.length) return { labels, colors: [], counts: [] };
    const R = rng(seed); centers = [samp[Math.floor(R() * samp.length)]];
    const dist = samp.map(s => d2(s, centers[0]));
    while (centers.length < Math.min(k, samp.length)) { // k-means++
      let tot = 0; for (const d of dist) tot += d; if (tot === 0) break;
      let r = R() * tot, j = 0; while ((r -= dist[j]) > 0 && j < samp.length - 1) j++;
      centers.push(samp[j]); samp.forEach((s, i) => dist[i] = Math.min(dist[i], d2(s, samp[j])));
    }
    for (let it = 0; it < 16; it++) {
      const sum = centers.map(() => [0, 0, 0, 0]);
      for (const s of samp) { let b = 0, bd = Infinity; centers.forEach((c, j) => { const d = d2(s, c); if (d < bd) { bd = d; b = j; } }); const t = sum[b]; t[0] += s[0]; t[1] += s[1]; t[2] += s[2]; t[3]++; }
      centers = centers.map((c, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c);
    }
  }
  const cache = new Int16Array(32768).fill(-1), acc = centers.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const o = i * 4; if (rgba[o + 3] < alphaCut) continue;
    const key = (rgba[o] >> 3) << 10 | (rgba[o + 1] >> 3) << 5 | rgba[o + 2] >> 3;
    let b = cache[key];
    if (b < 0) { const lab = rgbToLab([rgba[o] | 4, rgba[o + 1] | 4, rgba[o + 2] | 4]); let bd = Infinity; centers.forEach((c, j) => { const d = d2(lab, c); if (d < bd) { bd = d; b = j; } }); cache[key] = b; }
    labels[i] = b; const t = acc[b]; t[0] += rgba[o]; t[1] += rgba[o + 1]; t[2] += rgba[o + 2]; t[3]++;
  }
  let colors = palette ? palette.map(p => [...p]) : acc.map(t => t[3] ? [t[0] / t[3], t[1] / t[3], t[2] / t[3]].map(Math.round) : [0, 0, 0]);
  return compact(labels, colors);
}
// drop unused colours and renumber
export function compact(labels, colors) {
  const cnt = new Array(colors.length).fill(0); for (const l of labels) if (l !== 255) cnt[l]++;
  const map = new Array(colors.length).fill(255), out = [], counts = [];
  colors.forEach((c, j) => { if (cnt[j]) { map[j] = out.length; out.push(c); counts.push(cnt[j]); } });
  for (let i = 0; i < labels.length; i++) if (labels[i] !== 255) labels[i] = map[labels[i]];
  return { labels, colors: out, counts, map };
}

// ---------- connected components (4-connected) ----------
export function components(lab, w, h, same = (a, b) => a === b, skip = v => false) {
  const n = w * h, comp = new Int32Array(n).fill(-1), sizes = [], stack = new Int32Array(n);
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || skip(lab[s])) continue;
    let sp = 0, size = 0; stack[sp++] = s; comp[s] = id; const v = lab[s];
    while (sp) {
      const p = stack[--sp]; size++; const x = p % w, y = (p - x) / w;
      if (x > 0 && comp[p - 1] < 0 && same(lab[p - 1], v)) { comp[p - 1] = id; stack[sp++] = p - 1; }
      if (x < w - 1 && comp[p + 1] < 0 && same(lab[p + 1], v)) { comp[p + 1] = id; stack[sp++] = p + 1; }
      if (y > 0 && comp[p - w] < 0 && same(lab[p - w], v)) { comp[p - w] = id; stack[sp++] = p - w; }
      if (y < h - 1 && comp[p + w] < 0 && same(lab[p + w], v)) { comp[p + w] = id; stack[sp++] = p + w; }
    }
    sizes.push(size); id++;
  }
  return { comp, sizes, count: id };
}
// merge regions smaller than minPx into their most common neighbour colour
export function cleanSpecks(labels, w, h, minPx, passes = 2) {
  if (minPx <= 1) return labels;
  for (let pass = 0; pass < passes; pass++) {
    const { comp, sizes } = components(labels, w, h);
    const votes = new Map();
    for (let p = 0; p < w * h; p++) {
      const c = comp[p]; if (c < 0 || sizes[c] >= minPx) continue;
      const x = p % w; let m = votes.get(c); if (!m) votes.set(c, m = new Map());
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q < 0 || q >= w * h || comp[q] === c) continue; const l = labels[q]; if (l === 255) continue; m.set(l, (m.get(l) || 0) + 1);
      }
    }
    const to = new Map(); let changed = 0;
    for (const [c, m] of votes) { let b = -1, bv = 0; for (const [l, v] of m) if (v > bv) { bv = v; b = l; } if (b >= 0) to.set(c, b); }
    for (let p = 0; p < w * h; p++) { const c = comp[p]; if (c >= 0 && to.has(c)) { labels[p] = to.get(c); changed++; } }
    if (!changed) break;
  }
  return labels;
}

// ---------- tracing ----------
// mask: Uint8Array, 1 = filled. Returns polygons [{outer:[x,y,...], holes:[[...]], area}] in pixel-corner coords.
// Boundary edges between pixels, linked with a right-turn rule (diagonal pixels stay apart = 4-connected).
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
export function traceMask(mask, w, h) {
  const W = w + 1, V = W * (h + 1);
  const outA = new Int8Array(V).fill(-1), outB = new Int8Array(V).fill(-1);
  const add = (x, y, d) => { const v = y * W + x; if (outA[v] < 0) outA[v] = d; else outB[v] = d; };
  const f = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!f(x, y - 1)) add(x, y, 0);
    if (!f(x + 1, y)) add(x + 1, y, 1);
    if (!f(x, y + 1)) add(x + 1, y + 1, 2);
    if (!f(x - 1, y)) add(x, y + 1, 3);
  }
  const { comp } = components(mask, w, h, (a, b) => a === b, v => !v);
  const take = (v, d) => { if (outA[v] === d) outA[v] = -1; else outB[v] = -1; };
  const rings = [];
  const walk = v0 => {
    let d = outA[v0] >= 0 ? outA[v0] : outB[v0]; take(v0, d);
    const x0 = v0 % W, y0 = (v0 - x0) / W;
    const px = [x0, x0 - 1, x0 - 1, x0][d], py = [y0, y0, y0 - 1, y0 - 1][d]; // filled pixel right of first edge
    const pts = [x0, y0]; let x = x0, y = y0, area2 = 0;
    for (;;) {
      const nx = x + DX[d], ny = y + DY[d]; area2 += x * ny - nx * y; x = nx; y = ny;
      const v = y * W + x, a = outA[v], b = outB[v];
      if (a < 0 && b < 0) break; // back at start
      let nd = a >= 0 && b >= 0 ? ((a === (d + 1) % 4) ? a : (b === (d + 1) % 4) ? b : a) : (a >= 0 ? a : b);
      take(v, nd);
      if (nd !== d) pts.push(x, y);
      d = nd;
    }
    // drop start point if collinear
    const m = pts.length; if (m >= 6) { const ax = pts[m - 2], ay = pts[m - 1], cx = pts[2], cy = pts[3]; if ((ax === pts[0] && cx === pts[0]) || (ay === pts[1] && cy === pts[1])) pts.splice(0, 2); }
    rings.push({ pts, area: area2 / 2, comp: comp[py * w + px] });
  };
  // start on non-saddle vertices first so each ring closes on its own start edge
  for (let v = 0; v < V; v++) if ((outA[v] >= 0) !== (outB[v] >= 0)) walk(v);
  for (let v = 0; v < V; v++) while (outA[v] >= 0 || outB[v] >= 0) walk(v);
  const byComp = new Map();
  for (const r of rings) { let p = byComp.get(r.comp); if (!p) byComp.set(r.comp, p = { outer: null, holes: [], area: 0 }); if (r.area > 0) p.outer = r.pts; else p.holes.push(r.pts); p.area += r.area; }
  return [...byComp.values()].filter(p => p.outer);
}
export function ringArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }
export function polyArea(poly) { return Math.abs(ringArea(poly.outer)) - poly.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0); }

// Douglas-Peucker on a closed ring
function rdp(pts, i0, i1, eps2, keep) {
  const ax = pts[i0 * 2], ay = pts[i0 * 2 + 1], bx = pts[i1 * 2], by = pts[i1 * 2 + 1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let md = -1, mi = -1;
  for (let i = i0 + 1; i < i1; i++) {
    const px = pts[i * 2] - ax, py = pts[i * 2 + 1] - ay;
    const d = L ? (px * dy - py * dx) ** 2 / L : px * px + py * py;
    if (d > md) { md = d; mi = i; }
  }
  if (md > eps2) { keep[mi] = 1; rdp(pts, i0, mi, eps2, keep); rdp(pts, mi, i1, eps2, keep); }
}
export function simplifyRing(ring, eps) {
  const n = ring.length / 2; if (eps <= 0 || n <= 4) return ring;
  let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = (ring[i * 2] - ring[0]) ** 2 + (ring[i * 2 + 1] - ring[1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const pts = [...ring, ring[0], ring[1]], keep = new Uint8Array(n + 1); keep[0] = keep[far] = keep[n] = 1;
  rdp(pts, 0, far, eps * eps, keep); rdp(pts, far, n, eps * eps, keep);
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i * 2], ring[i * 2 + 1]);
  return out.length >= 6 ? out : [];
}
export function simplifyPolys(polys, eps) {
  if (eps <= 0) return polys;
  return polys.map(p => ({ outer: simplifyRing(p.outer, eps), holes: p.holes.map(h => simplifyRing(h, eps)).filter(h => h.length) })).filter(p => p.outer.length);
}

// Layer masks from a label map. order = label ids bottom to top.
// stacked: layer i covers its colour plus every colour above it (no seams). exact: only its own pixels.
export function layerMask(labels, order, i, stacked = true) {
  const rank = new Int16Array(256).fill(-1); order.forEach((l, j) => rank[l] = j);
  const m = new Uint8Array(labels.length);
  for (let p = 0; p < labels.length; p++) { const r = rank[labels[p]]; m[p] = stacked ? (r >= i ? 1 : 0) : (r === i ? 1 : 0); }
  return m;
}

// ---------- SVG ----------
const fmt = v => (Math.round(v * 100) / 100).toString();
export function polysToPath(polys, s = 1) {
  const ring = r => { let d = "M" + fmt(r[0] * s) + " " + fmt(r[1] * s); for (let i = 2; i < r.length; i += 2) d += "L" + fmt(r[i] * s) + " " + fmt(r[i + 1] * s); return d + "Z"; };
  return polys.map(p => ring(p.outer) + p.holes.map(ring).join("")).join("");
}
export const hex = c => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
// layers: [{name, color:[r,g,b], polys}]; widthMm optional sets physical size
export function buildSvg(layers, w, h, { widthMm = null, scale = 1 } = {}) {
  const size = widthMm ? `width="${fmt(widthMm)}mm" height="${fmt(widthMm * h / w)}mm"` : `width="${w * scale}" height="${h * scale}"`;
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${w * scale} ${h * scale}">\n` +
    layers.map(L => `<g id="${esc(L.name)}" fill="${hex(L.color)}" fill-rule="evenodd"><path d="${polysToPath(L.polys, scale)}"/></g>`).join("\n") + "\n</svg>\n";
}

// ---------- distance transform + stroke width ----------
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s; do { const p = v[k]; s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) ** 2 + f[p]; }
}
// Euclidean distance (px) from each filled pixel to the nearest empty pixel; outside the image counts as empty
export function edt(mask, w, h) {
  const W = w + 2, H = h + 2, g = new Float64Array(W * H), INF = 1e20;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[(y + 1) * W + x + 1] = mask[y * w + x] ? INF : 0;
  const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; edt1d(f, H, d, v, z); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; edt1d(f, W, d, v, z); for (let x = 0; x < W; x++) g[y * W + x] = d[x]; }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(g[(y + 1) * W + x + 1]);
  return out;
}
// Thin parts: pixels a disk of diameter minMm cannot reach (morphological opening). thinnest = narrowest ridge width.
export function strokeStats(mask, w, h, pxPerMm, minMm = 0.8) {
  const dt = edt(mask, w, h), r = minMm * pxPerMm / 2;
  const core = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) core[i] = dt[i] >= r ? 0 : 1; // 1 = not core
  const dc = edt(core, w, h); // distance to nearest core pixel
  const thin = new Uint8Array(w * h); let thinPx = 0, filled = 0, thinnest = Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue; filled++;
    if (dc[i] > r) { thin[i] = 1; thinPx++; }
    const v = dt[i]; let ridge = true;
    for (let dy = -1; dy <= 1 && ridge; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && dt[Y * w + X] > v) { ridge = false; break; } }
    if (ridge) thinnest = Math.min(thinnest, (2 * v - 1) / pxPerMm);
  }
  // corners are always rounded off by the opening: ignore thin blobs smaller than r*r pixels
  const { comp, sizes } = components(thin, w, h, (a, b) => a === b, v => !v);
  for (let i = 0; i < w * h; i++) if (thin[i] && sizes[comp[i]] < r * r) { thin[i] = 0; thinPx--; }
  return { thin, thinPx, filled, thinAreaMm2: thinPx / pxPerMm / pxPerMm, thinnestMm: filled ? Math.max(0, thinnest) : 0, ok: thinPx === 0 };
}

// ---------- meshes ----------
export function newMesh() { return { pos: [], idx: [] }; }
// Extrude polygons between z0 and z1. tf maps pixel (x,y) -> [X,Y] in mm with Y up.
export function extrude(mesh, polys, z0, z1, tf, earcut) {
  for (const p of polys) {
    let rings = [p.outer, ...p.holes].map(r => { const o = []; for (let i = 0; i < r.length; i += 2) o.push(...tf(r[i], r[i + 1])); return o; });
    rings = rings.map((r, j) => { const a = ringArea(r); return (j === 0 ? a < 0 : a > 0) ? reverseRing(r) : r; }); // outer CCW, holes CW
    const flat = [], holeIdx = []; rings.forEach((r, j) => { if (j) holeIdx.push(flat.length / 2); flat.push(...r); });
    const n = flat.length / 2, base = mesh.pos.length / 3;
    for (let i = 0; i < n; i++) mesh.pos.push(flat[i * 2], flat[i * 2 + 1], z0);
    for (let i = 0; i < n; i++) mesh.pos.push(flat[i * 2], flat[i * 2 + 1], z1);
    const tri = earcut(flat, holeIdx, 2);
    for (let t = 0; t < tri.length; t += 3) {
      let a = tri[t], b = tri[t + 1], c = tri[t + 2];
      const cr = (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]);
      if (cr < 0) [b, c] = [c, b];
      mesh.idx.push(base + n + a, base + n + b, base + n + c, base + a, base + c, base + b);
    }
    let off = 0;
    for (const r of rings) {
      const m = r.length / 2;
      for (let i = 0; i < m; i++) {
        const a = base + off + i, b = base + off + (i + 1) % m;
        mesh.idx.push(a, b, b + n, a, b + n, a + n);
      }
      off += m;
    }
  }
  return mesh;
}
function reverseRing(r) { const o = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; }
export function boxPolys(x0, y0, x1, y1) { return [{ outer: [x0, y0, x1, y0, x1, y1, x0, y1], holes: [] }]; }
export function meshArrays(m) { return { positions: Float32Array.from(m.pos), indices: Uint32Array.from(m.idx) }; }
// returns {open, bad} counts: an edge is closed when used once in each direction
export function edgeCheck(indices) {
  const cnt = new Map();
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) { const a = indices[t + k], b = indices[t + (k + 1) % 3]; const key = a + "," + b; cnt.set(key, (cnt.get(key) || 0) + 1); }
  let open = 0, bad = 0;
  for (const [key, c] of cnt) { const [a, b] = key.split(","); const r = cnt.get(b + "," + a) || 0; if (c > 1) bad++; if (r !== c) open++; }
  return { edges: cnt.size, open, bad, closed: open === 0 && bad === 0 };
}
export function stlBinary(mesh) {
  const P = mesh.pos, I = mesh.idx, nt = I.length / 3, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  dv.setUint32(80, nt, true); let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1;
    for (const v of [nx / L, ny / L, nz / L, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
    o += 2;
  }
  return new Uint8Array(buf);
}
// 3MF: parts [{name, color:[r,g,b], mesh}]. Returns {path: Uint8Array}; zip it with fflate.zipSync.
// One object per colour, grouped as parts of one assembly; Metadata/model_settings.config gives Bambu Studio / Orca a part name and extruder per colour.
export function make3MFFiles(parts, { title = "Wall art" } = {}) {
  const enc = s => new TextEncoder().encode(s), esc = s => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const n = parts.length, asm = n + 2; let model = "", mats = "";
  parts.forEach(p => { mats += `<base name="${esc(p.name)}" displaycolor="${hex(p.color).toUpperCase()}FF"/>`; });
  const objs = parts.map((p, j) => {
    const P = p.mesh.pos, I = p.mesh.idx; const v = [], t = [];
    for (let i = 0; i < P.length; i += 3) v.push(`<vertex x="${+P[i].toFixed(4)}" y="${+P[i + 1].toFixed(4)}" z="${+P[i + 2].toFixed(4)}"/>`);
    for (let i = 0; i < I.length; i += 3) t.push(`<triangle v1="${I[i]}" v2="${I[i + 1]}" v3="${I[i + 2]}"/>`);
    return `<object id="${j + 2}" type="model" name="${esc(p.name)}" pid="1" pindex="${j}"><mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh></object>`;
  });
  model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
    `<metadata name="Title">${esc(title)}</metadata><metadata name="Application">HueForge Tools</metadata>\n<resources>\n<basematerials id="1">${mats}</basematerials>\n` +
    objs.join("\n") + `\n<object id="${asm}" type="model" name="${esc(title)}"><components>${parts.map((_, j) => `<component objectid="${j + 2}"/>`).join("")}</components></object>\n` +
    `</resources>\n<build><item objectid="${asm}"/></build>\n</model>\n`;
  const cfg = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n<object id="${asm}">\n<metadata key="name" value="${esc(title)}"/>\n<metadata key="extruder" value="1"/>\n` +
    parts.map((p, j) => `<part id="${j + 2}" subtype="normal_part">\n<metadata key="name" value="${esc(p.name)}"/>\n<metadata key="extruder" value="${j + 1}"/>\n</part>`).join("\n") + `\n</object>\n</config>\n`;
  return {
    "[Content_Types].xml": enc(`<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>`),
    "_rels/.rels": enc(`<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    "3D/3dmodel.model": enc(model),
    "Metadata/model_settings.config": enc(cfg),
  };
}
