// Shared image functions. Images are plain {width, height, data: Uint8ClampedArray RGBA}
// (same shape as canvas ImageData), so these also run in Node for tests.

export function makeImage(width, height, data) {
  return { width, height, data: data || new Uint8ClampedArray(width * height * 4) };
}
export function cloneImage(img) { return makeImage(img.width, img.height, new Uint8ClampedArray(img.data)); }

// ---------- colour ----------
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = lin(i);
const fLab = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;

export function rgbToLab(r, g, b) {
  const R = LIN[r | 0], G = LIN[g | 0], B = LIN[b | 0];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function labToRgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = t => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
  const x = inv(fx) * 0.95047, y = inv(fy), z = inv(fz) * 1.08883;
  const R = x * 3.2406 - y * 1.5372 - z * 0.4986, G = -x * 0.9689 + y * 1.8758 + z * 0.0415, B = x * 0.0557 - y * 0.2040 + z * 1.0570;
  const g = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
  return [R, G, B].map(c => Math.max(0, Math.min(255, Math.round(g(c)))));
}
export function deltaE(l1, l2) { const d0 = l1[0] - l2[0], d1 = l1[1] - l2[1], d2 = l1[2] - l2[2]; return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2); }
// relative luminance 0..1 (WCAG / Rec.709)
export function luminance(r, g, b) { return 0.2126 * LIN[r | 0] + 0.7152 * LIN[g | 0] + 0.0722 * LIN[b | 0]; }
export function hexToRgb(h) { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
export function rgbToHex([r, g, b]) { return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase(); }

// opaque pixel samples (Lab), at most `max`
export function sampleLab(img, max = 20000) {
  const n = img.width * img.height, step = Math.max(1, Math.floor(n / max)), out = [];
  for (let i = 0; i < n; i += step) { const p = i * 4; if (img.data[p + 3] < 128) continue; out.push(rgbToLab(img.data[p], img.data[p + 1], img.data[p + 2])); }
  return out;
}

// ---------- quantize ----------
// k-means in Lab. Returns palette as [[r,g,b], ...] sorted dark to light.
export function kmeansLab(img, k, { iterations = 12, max = 20000 } = {}) {
  const pts = sampleLab(img, max); if (!pts.length) return [];
  k = Math.min(k, pts.length);
  // k-means++ style seeding (deterministic: farthest point)
  const C = [pts[Math.floor(pts.length / 2)].slice()];
  const dist = pts.map(p => deltaE(p, C[0]));
  while (C.length < k) {
    let bi = 0; for (let i = 1; i < pts.length; i++) if (dist[i] > dist[bi]) bi = i;
    if (dist[bi] === 0) break;
    C.push(pts[bi].slice()); for (let i = 0; i < pts.length; i++) dist[i] = Math.min(dist[i], deltaE(pts[i], C[C.length - 1]));
  }
  const asg = new Int32Array(pts.length);
  for (let it = 0; it < iterations; it++) {
    const s = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { const j = nearest(pts[i], C); asg[i] = j; const t = s[j]; t[0] += pts[i][0]; t[1] += pts[i][1]; t[2] += pts[i][2]; t[3]++; }
    let moved = 0;
    s.forEach((t, j) => { if (!t[3]) return; const n = [t[0] / t[3], t[1] / t[3], t[2] / t[3]]; moved += deltaE(n, C[j]); C[j] = n; });
    if (moved < 0.5) break;
  }
  return C.map(c => labToRgb(...c)).sort((a, b) => luminance(...a) - luminance(...b));
}

// median cut (RGB boxes split on widest channel, averaged). Palette sorted dark to light.
export function medianCut(img, k) {
  const px = []; const d = img.data;
  const n = img.width * img.height, step = Math.max(1, Math.floor(n / 40000));
  for (let i = 0; i < n; i += step) { const p = i * 4; if (d[p + 3] >= 128) px.push([d[p], d[p + 1], d[p + 2]]); }
  if (!px.length) return [];
  let boxes = [px];
  while (boxes.length < k) {
    let bi = -1, bc = 0, br = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; } if (hi - lo > br) { br = hi - lo; bi = i; bc = c; } } });
    if (bi < 0 || br === 0) break;
    const b = boxes[bi].sort((x, y) => x[bc] - y[bc]), m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  return boxes.map(b => { const s = [0, 0, 0]; for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map(v => Math.round(v / b.length)); })
    .sort((a, b) => luminance(...a) - luminance(...b));
}

export function nearest(lab, labs) { let bi = 0, bd = Infinity; for (let j = 0; j < labs.length; j++) { const d = deltaE(lab, labs[j]); if (d < bd) { bd = d; bi = j; } } return bi; }

// Map each pixel to the nearest palette colour (deltaE in Lab).
// Returns {image, index (Int16Array, -1 = transparent), counts, meanDeltaE}.
export function mapToPalette(img, palette, { dither = false } = {}) {
  const { width: w, height: h } = img, src = img.data, out = new Uint8ClampedArray(src.length);
  const labs = palette.map(c => rgbToLab(...c)), index = new Int16Array(w * h), counts = new Array(palette.length).fill(0);
  const cache = new Map(); let sumE = 0, nE = 0;
  const err = dither ? new Float32Array(w * h * 3) : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    if (src[p + 3] < 128) { index[i] = -1; continue; }
    let r = src[p], g = src[p + 1], b = src[p + 2];
    if (dither) { r = clamp(r + err[i * 3]); g = clamp(g + err[i * 3 + 1]); b = clamp(b + err[i * 3 + 2]); }
    const key = (r << 16) | (g << 8) | b; let j = cache.get(key), lab;
    if (j === undefined) { lab = rgbToLab(r, g, b); j = nearest(lab, labs); if (cache.size < 200000) cache.set(key, j); }
    if (!dither) sumE += deltaE(lab || rgbToLab(r, g, b), labs[j]); nE++; // dithered: error is measured on a blurred result below
    index[i] = j; counts[j]++;
    const c = palette[j]; out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2]; out[p + 3] = 255;
    if (dither) { // Floyd-Steinberg
      const e = [r - c[0], g - c[1], b - c[2]];
      const add = (xx, yy, f) => { if (xx < 0 || xx >= w || yy >= h) return; const q = (yy * w + xx) * 3; err[q] += e[0] * f; err[q + 1] += e[1] * f; err[q + 2] += e[2] * f; };
      add(x + 1, y, 7 / 16); add(x - 1, y + 1, 3 / 16); add(x, y + 1, 5 / 16); add(x + 1, y + 1, 1 / 16);
    }
  }
  const image = makeImage(w, h, out);
  if (dither) { const bl = blur3(image), step = Math.max(1, Math.floor(w * h / 20000)); sumE = 0; nE = 0; // what the eye sees from a distance
    for (let i = 0; i < w * h; i += step) { if (index[i] < 0) continue; const p = i * 4; sumE += deltaE(rgbToLab(src[p], src[p + 1], src[p + 2]), rgbToLab(bl.data[p], bl.data[p + 1], bl.data[p + 2])); nE++; } }
  return { image, index, counts, meanDeltaE: nE ? sumE / nE : 0 };
}
const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;

// Greedy pick of the n library colours that best cover the picture (lowest mean deltaE).
// colours: [[r,g,b],...]; returns chosen indices.
export function suggestColours(img, colours, n) {
  const pts = sampleLab(img, 4000), labs = colours.map(c => rgbToLab(...c));
  const best = new Float32Array(pts.length).fill(Infinity), chosen = [];
  n = Math.min(n, colours.length);
  for (let s = 0; s < n; s++) {
    let bj = -1, bScore = Infinity;
    for (let j = 0; j < labs.length; j++) {
      if (chosen.includes(j)) continue; let sc = 0;
      for (let i = 0; i < pts.length; i++) sc += Math.min(best[i], deltaE(pts[i], labs[j]));
      if (sc < bScore) { bScore = sc; bj = j; }
    }
    chosen.push(bj); for (let i = 0; i < pts.length; i++) best[i] = Math.min(best[i], deltaE(pts[i], labs[bj]));
  }
  return chosen;
}

// ---------- geometry ----------
export function crop(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.min(img.width - x, Math.round(w))); h = Math.max(1, Math.min(img.height - y, Math.round(h)));
  const out = makeImage(w, h);
  for (let r = 0; r < h; r++) out.data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return out;
}

// Bicubic (Catmull-Rom) upscale with premultiplied alpha, then a light unsharp mask.
export function upscale(img, factor, { sharpen: amount = 0.35 } = {}) {
  const { width: w, height: h, data: s } = img, W = Math.round(w * factor), H = Math.round(h * factor), o = new Uint8ClampedArray(W * H * 4);
  const cub = t => { t = Math.abs(t); return t <= 1 ? 1.5 * t ** 3 - 2.5 * t ** 2 + 1 : t < 2 ? -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2 : 0; };
  const px = (x, y) => (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
  for (let Y = 0; Y < H; Y++) {
    const sy = (Y + 0.5) / factor - 0.5, y0 = Math.floor(sy), wy = [-1, 0, 1, 2].map(k => cub(sy - (y0 + k)));
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) / factor - 0.5, x0 = Math.floor(sx);
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const f = cub(sx - (x0 + i - 1)) * wy[j]; if (!f) continue; const p = px(x0 + i - 1, y0 + j - 1), al = s[p + 3] / 255;
        r += s[p] * al * f; g += s[p + 1] * al * f; b += s[p + 2] * al * f; a += al * f;
      }
      const q = (Y * W + X) * 4;
      if (a > 0.001) { o[q] = r / a; o[q + 1] = g / a; o[q + 2] = b / a; } o[q + 3] = a * 255;
    }
  }
  const up = makeImage(W, H, o);
  return amount > 0 ? sharpen(up, amount) : up;
}
export function blur3(img) {
  const { width: w, height: h, data: s } = img, o = new Uint8ClampedArray(s.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let t = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const k = (dx && dy) ? 1 : (dx || dy) ? 2 : 4; t += s[(yy * w + xx) * 4 + c] * k; n += k; }
    o[(y * w + x) * 4 + c] = t / n;
  }
  return makeImage(w, h, o);
}
export function sharpen(img, amount = 0.5) {
  const b = blur3(img), o = new Uint8ClampedArray(img.data);
  for (let i = 0; i < o.length; i++) { if ((i & 3) === 3) continue; o[i] = img.data[i] + (img.data[i] - b.data[i]) * amount; }
  return makeImage(img.width, img.height, o);
}

// ---------- background ----------
export function borderColour(img) { // median of border pixels
  const { width: w, height: h, data: d } = img, r = [], g = [], b = [];
  const add = (x, y) => { const p = (y * w + x) * 4; r.push(d[p]); g.push(d[p + 1]); b.push(d[p + 2]); };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); } for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  const med = a => a.sort((x, y) => x - y)[a.length >> 1];
  return [med(r), med(g), med(b)];
}
// Make pixels near `colour` transparent. mode "flood": only connected from seeds (default: whole border);
// mode "global": everywhere. tolerance = deltaE; feather = px of soft edge.
export function removeBackground(img, colour, { tolerance = 12, feather = 1, mode = "flood", seeds = null } = {}) {
  const { width: w, height: h, data: s } = img, n = w * h, ref = rgbToLab(...colour), mask = new Uint8Array(n);
  const near = i => s[i * 4 + 3] < 8 || deltaE(rgbToLab(s[i * 4], s[i * 4 + 1], s[i * 4 + 2]), ref) <= tolerance;
  if (mode === "global") { for (let i = 0; i < n; i++) if (near(i)) mask[i] = 1; }
  else {
    const st = [];
    const push = i => { if (!mask[i] && near(i)) { mask[i] = 1; st.push(i); } };
    if (seeds) seeds.forEach(([x, y]) => push(Math.round(y) * w + Math.round(x)));
    else { for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); } }
    while (st.length) { const i = st.pop(), x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < n - w) push(i + w); }
  }
  const o = new Uint8ClampedArray(s);
  let alpha = new Float32Array(n); for (let i = 0; i < n; i++) alpha[i] = mask[i] ? 0 : 1;
  for (let f = 0; f < feather; f++) { // box blur alpha, only lowering kept pixels at edges
    const a2 = new Float32Array(alpha);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (mask[i]) continue; let t = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; t += alpha[yy * w + xx]; c++; } a2[i] = Math.min(alpha[i], t / c); }
    alpha = a2;
  }
  for (let i = 0; i < n; i++) o[i * 4 + 3] = Math.round(s[i * 4 + 3] * alpha[i]);
  return makeImage(w, h, o);
}

// ---------- posterize ----------
// By luminance: n equal grey-level bands, each painted with the band's mean colour (or grey if gray=true).
export function posterizeLuma(img, n, { gray = true } = {}) {
  const { width: w, height: h, data: s } = img, idx = new Int16Array(w * h), sum = Array.from({ length: n }, () => [0, 0, 0, 0]);
  for (let i = 0; i < w * h; i++) {
    if (s[i * 4 + 3] < 128) { idx[i] = -1; continue; }
    const L = rgbToLab(s[i * 4], s[i * 4 + 1], s[i * 4 + 2])[0] / 100; // perceptual lightness
    const j = Math.min(n - 1, Math.floor(L * n)); idx[i] = j; const t = sum[j]; t[0] += s[i * 4]; t[1] += s[i * 4 + 1]; t[2] += s[i * 4 + 2]; t[3]++;
  }
  const pal = sum.map((t, j) => gray ? labToRgb((j + 0.5) / n * 100, 0, 0) : t[3] ? [t[0] / t[3], t[1] / t[3], t[2] / t[3]].map(Math.round) : labToRgb((j + 0.5) / n * 100, 0, 0));
  return { index: idx, palette: pal };
}
export function posterizeColour(img, n) {
  const pal = kmeansLab(img, n), m = mapToPalette(img, pal);
  return { index: m.index, palette: pal };
}
// Majority filter on an index map (smoothing), `passes` times.
export function smoothIndex(index, w, h, passes = 1) {
  let a = index;
  for (let p = 0; p < passes; p++) {
    const b = new Int16Array(a);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (a[i] < 0) continue; const c = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = a[i + dy * w + dx]; if (v >= 0) c.set(v, (c.get(v) || 0) + 1); }
      let bv = a[i], bc = c.get(a[i]) || 0; c.forEach((k, v) => { if (k > bc) { bc = k; bv = v; } }); b[i] = bv;
    }
    a = b;
  }
  return a;
}
// Merge connected regions smaller than minSize pixels into their most common neighbour.
export function removeSpecks(index, w, h, minSize = 8) {
  const a = new Int16Array(index), seen = new Uint8Array(w * h), reg = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || a[s] < 0) continue; const v = a[s]; reg.length = 0; const st = [s]; seen[s] = 1;
    while (st.length) { const i = st.pop(); reg.push(i); const x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && !seen[j] && a[j] === v) { seen[j] = 1; st.push(j); } }
    if (reg.length >= minSize) continue;
    const c = new Map();
    for (const i of reg) { const x = i % w; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (j >= 0 && j < w * h && a[j] !== v && a[j] >= 0) c.set(a[j], (c.get(a[j]) || 0) + 1); }
    let bv = v, bc = 0; c.forEach((k, u) => { if (k > bc) { bc = k; bv = u; } });
    for (const i of reg) { a[i] = bv; seen[i] = 0; } // let merged pixels be revisited as part of the bigger region
    for (const i of reg) seen[i] = 1;
  }
  return a;
}
export function renderIndex(index, palette, w, h) {
  const o = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const j = index[i]; if (j < 0) continue; const c = palette[j]; o[i * 4] = c[0]; o[i * 4 + 1] = c[1]; o[i * 4 + 2] = c[2]; o[i * 4 + 3] = 255; }
  return makeImage(w, h, o);
}

// ---------- analysis (for Compass) ----------
export function analyse(img) {
  const { width: w, height: h, data: d } = img, n = w * h;
  const Ls = [], bins = new Map(); let opaque = 0, sat = 0;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4; if (d[p + 3] < 128) { L[i] = -1; continue; } opaque++;
    const lab = rgbToLab(d[p], d[p + 1], d[p + 2]); L[i] = lab[0]; Ls.push(lab[0]); sat += Math.hypot(lab[1], lab[2]);
    const key = (d[p] >> 4) << 8 | (d[p + 1] >> 4) << 4 | (d[p + 2] >> 4); bins.set(key, (bins.get(key) || 0) + 1);
  }
  Ls.sort((a, b) => a - b); const q = f => Ls.length ? Ls[Math.floor(f * (Ls.length - 1))] : 0;
  const mean = Ls.reduce((a, b) => a + b, 0) / (Ls.length || 1);
  const sd = Math.sqrt(Ls.reduce((a, b) => a + (b - mean) ** 2, 0) / (Ls.length || 1));
  const minShare = opaque * 0.002; let distinct = 0; bins.forEach(v => { if (v >= minShare) distinct++; });
  let edges = 0, ec = 0; // share of pixels with strong lightness change
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (L[i] < 0) continue; const gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w]; ec++; if (Math.hypot(gx, gy) > 12) edges++; }
  const bc = borderColour(img), bl = rgbToLab(...bc); let bNear = 0, bTot = 0, transparentBorder = 0;
  const chk = (x, y) => { const p = (y * w + x) * 4; bTot++; if (d[p + 3] < 128) { transparentBorder++; bNear++; return; } if (deltaE(rgbToLab(d[p], d[p + 1], d[p + 2]), bl) < 10) bNear++; };
  for (let x = 0; x < w; x++) { chk(x, 0); chk(x, h - 1); } for (let y = 1; y < h - 1; y++) { chk(0, y); chk(w - 1, y); }
  let bgShare = 0; // share of image that is background-like (flood from border)
  if (bNear / bTot > 0.6) { const r = removeBackground(img, bc, { tolerance: 10, feather: 0 }); for (let i = 0; i < n; i++) if (r.data[i * 4 + 3] === 0) bgShare++; bgShare /= n; }
  return {
    width: w, height: h, opaqueShare: opaque / n,
    lMin: q(0.01), lMax: q(0.99), tonalRange: q(0.99) - q(0.01), contrast: sd, meanL: mean,
    distinctColours: distinct, colourfulness: sat / (opaque || 1), edgeShare: ec ? edges / ec : 0,
    borderColour: bc, borderUniformity: bNear / bTot, transparentBorder: transparentBorder / bTot, backgroundShare: bgShare,
  };
}

// ---------- browser helpers (need a DOM) ----------
// Draw an <img>/<canvas> into an image object, scaled down so the long side is <= maxSide.
export function fromSource(src, maxSide = 4096) {
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height, s = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s));
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height); return makeImage(d.width, d.height, d.data);
}
export function toCanvas(img, canvas = document.createElement("canvas")) {
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0); return canvas;
}
export function toBlob(img) { return new Promise(r => toCanvas(img).toBlob(r, "image/png")); }
export function toDataURL(img, maxSide = 0) {
  const c = toCanvas(img); if (!maxSide || Math.max(img.width, img.height) <= maxSide) return c.toDataURL("image/png");
  const s = maxSide / Math.max(img.width, img.height), t = document.createElement("canvas"); t.width = Math.round(img.width * s); t.height = Math.round(img.height * s);
  t.getContext("2d").drawImage(c, 0, 0, t.width, t.height); return t.toDataURL("image/png");
}
export function loadDataURL(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
