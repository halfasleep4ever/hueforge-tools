import { header, dropZone, download, loadImage } from "../assets/ui.js";
import { getFilaments, filamentChecklist, hexToRgb, onLibraryChange } from "../assets/library.js";
import { saveProject, getProject, projectIdFromUrl } from "../assets/projects.js";
import { quantize, cleanSpecks, compact, traceMask, layerMask, components, strokeStats, extrude, newMesh, make3MFFiles, stlBinary, hex } from "../assets/vector.js";
import earcut from "https://cdn.jsdelivr.net/npm/earcut@2.2.4/+esm";
import { zipSync } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

header("Wall Art Studio");
const $ = id => document.getElementById(id);
let file = null, img = null, Q = null, qKey = "", order = [], heights = {}, out = null, timer = 0;
let libSel = getFilaments().slice(0, 4).map(f => f.id);
filamentChecklist($("lib"), { selected: libSel, onChange: s => { libSel = s; go(); } });
const fillFrameColours = () => { const v = $("fc").value; $("fc").innerHTML = getFilaments().map(f => `<option value="${f.id}">${f.name}</option>`).join(""); if (v) $("fc").value = v; };
fillFrameColours(); onLibraryChange(fillFrameColours);
for (const [i, o] of [["k", "kv"], ["speck", "sv"]]) $(i).addEventListener("input", () => $(o).textContent = (+$(i).value).toFixed(i === "k" ? 0 : 1));
$("mode").onchange = () => { $("autoBox").hidden = $("mode").value !== "auto"; $("libBox").hidden = $("mode").value === "auto"; go(); };
for (const id of ["k", "speck", "wmm", "bed", "ppm", "back", "bridges", "bw", "frame", "fw", "fh", "fc", "noz", "showThin"]) $(id).addEventListener("input", () => go());
dropZone($("drop"), { accept: "image/png,image/jpeg,image/webp,image/svg+xml,.svg", onFiles: ([f]) => setFile(f) });

async function setFile(f) {
  file = f; qKey = "";
  try { img = await loadImage(f); } catch { $("status").textContent = "Could not read that file."; return; }
  if (!img.naturalWidth) { img.width = 1000; img.height = 1000; } // SVG without a size
  $("drop").textContent = f.name || "picture"; go(0);
}
function go(delay = 200) { clearTimeout(timer); if (img) timer = setTimeout(() => { try { build(); } catch (e) { console.error(e); $("status").textContent = "Error: " + e.message; } }, delay); }

// ---- 3D view ----
const view = $("view"), renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); view.append(renderer.domElement);
const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, 1, 1, 5000), controls = new OrbitControls(cam, renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-1, -2, 3); scene.add(sun);
scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--panel2").trim() || "#1e222b");
const group = new THREE.Group(); scene.add(group);
function resize() { const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(view); resize();
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, cam); })();
let fitted = "";
function show(parts, W, H) {
  group.children.slice().forEach(m => { m.geometry.dispose(); group.remove(m); });
  for (const p of parts) {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(p.mesh.pos, 3)); g.setIndex(p.mesh.idx); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex(p.color)), roughness: 0.7, flatShading: true })));
  }
  const key = W + "x" + H; if (fitted === key) return; fitted = key;
  controls.target.set(W / 2, H / 2, 0); cam.up.set(0, 0, 1); cam.position.set(W / 2, -H * 0.6, Math.max(W, H) * 1.5); controls.update();
}

// ---- build ----
function build() {
  const t0 = performance.now(), wmm = Math.max(10, +$("wmm").value || 150);
  let ppm = +$("ppm").value; ppm = Math.min(ppm, 1200 / wmm);
  const w = Math.round(wmm * ppm), h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth || w));
  const lib = $("mode").value === "lib", fil = getFilaments().filter(f => libSel.includes(f.id));
  const key = [file?.name, file?.size, w, h, $("mode").value, $("k").value, lib ? libSel.join() : "", $("speck").value].join("|");
  if (key !== qKey) {
    if (lib && fil.length < 2) { $("status").textContent = "Tick at least 2 filaments."; return; }
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    let q = quantize(g.getImageData(0, 0, w, h).data, w, h, lib ? { palette: fil.map(f => hexToRgb(f.hex)) } : { k: +$("k").value });
    const names = lib ? fil.map(f => f.name).filter((_, j) => q.map[j] !== 255) : q.colors.map(hex);
    cleanSpecks(q.labels, w, h, Math.round(+$("speck").value * ppm * ppm));
    q.colors.forEach((c, j) => c.name = names[j]);
    q = compact(q.labels, q.colors);
    Q = { ...q, w, h, ppm }; qKey = key;
    order = q.counts.map((_, j) => j).sort((a, b) => q.counts[b] - q.counts[a]);
    heights = {}; order.forEach((l, i) => heights[l] = i === 0 ? 1.6 : 0.6);
  }
  const { w: W, h: H } = Q, cut = $("back").value === "cut", noz = +$("noz").value || 0.4, minMm = 2 * noz;
  const labels = Q.labels.slice();
  let layerOrder = order.slice();
  if (cut) { const bg = layerOrder.shift(); for (let i = 0; i < labels.length; i++) if (labels[i] === bg) labels[i] = 255; }
  else for (let i = 0; i < labels.length; i++) if (labels[i] === 255) labels[i] = layerOrder[0];
  const frameOn = $("frame").checked, F = frameOn ? +$("fw").value || 6 : 0;
  const warns = [];
  // floating pieces (only possible without a plate)
  let islands = 0;
  if (cut && layerOrder.length) {
    const m0 = layerMask(labels, layerOrder, 0), cc = components(m0, W, H, (a, b) => a === b, v => !v);
    const attached = new Uint8Array(cc.count); let big = 0; cc.sizes.forEach((s, j) => { if (s > cc.sizes[big]) big = j; }); attached[big] = 1;
    if (frameOn) for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const c = cc.comp[y * W + x]; if (c >= 0) attached[c] = 1; }
    if (frameOn) for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const c = cc.comp[y * W + x]; if (c >= 0) attached[c] = 1; }
    islands = attached.reduce((s, a) => s + (a ? 0 : 1), 0);
    if (islands && $("bridges").checked) { addBridges(labels, m0, cc, attached, W, H, Math.max(1, +$("bw").value * Q.ppm), layerOrder[0], frameOn); }
    if (islands) warns.push([$("bridges").checked ? "ok" : "bad", $("bridges").checked ? `${islands} floating piece(s) joined with bridges.` : `${islands} floating piece(s): they would fall out. Tick "Add bridges" or use a base plate.`]);
  }
  // layers, thin check, meshes
  const tf = (x, y) => [x / Q.ppm + F, (H - y) / Q.ppm + F];
  let z = 0; const parts = [], rows = [], thinAll = new Uint8Array(W * H);
  layerOrder.forEach((l, i) => {
    const m = layerMask(labels, layerOrder, i), hgt = Math.max(0.08, +heights[l] || 0.6);
    let st = null;
    if (i > 0 || cut) { st = strokeStats(m, W, H, Q.ppm, minMm); st.thin.forEach((v, j) => v && (thinAll[j] = 1)); }
    const mesh = newMesh(); extrude(mesh, traceMask(m, W, H), z, z + hgt, tf, earcut);
    const col = Q.colors[l]; parts.push({ name: `${i + 1} ${col.name}`, color: [col[0], col[1], col[2]], mesh });
    rows.push({ l, i, col, z0: z, hgt, st }); z += hgt;
  });
  if (frameOn) {
    const fp = F * Q.ppm, mesh = newMesh(), ff = getFilaments().find(f => f.id === $("fc").value) || { name: "Frame", hex: "#111111" };
    extrude(mesh, [{ outer: [-fp, -fp, W + fp, -fp, W + fp, H + fp, -fp, H + fp], holes: [[0, 0, W, 0, W, H, 0, H]] }], 0, Math.max(0.4, +$("fh").value || 4), tf, earcut);
    parts.push({ name: `Frame ${ff.name}`, color: hexToRgb(ff.hex), mesh });
  }
  const outW = W / Q.ppm + 2 * F, outH = H / Q.ppm + 2 * F, bed = +$("bed").value || 256;
  if (outW > bed || outH > bed) warns.push(["bad", `${outW.toFixed(0)} × ${outH.toFixed(0)} mm is bigger than your ${bed} mm bed.`]);
  const thinRows = rows.filter(r => r.st && !r.st.ok);
  if (thinRows.length) warns.push(["", `Thin parts below ${minMm.toFixed(1)} mm (2 × nozzle) in: ${thinRows.map(r => r.col.name).join(", ")}. They are red in the flat view. Make the art bigger, raise "Remove specks", or accept that they may not print.`]);
  else warns.push(["ok", `No lines thinner than ${minMm.toFixed(1)} mm.`]);
  if (!cut) warns.push(["ok", "No floating parts: every layer sits on the one below."]);
  $("warn").innerHTML = warns.map(([c, t]) => `<div class="note ${c}">${t}</div>`).join("");
  $("layers").innerHTML = `<tr><th></th><th>Colour</th><th>Height mm</th><th>Starts at</th><th>Thinnest</th><th></th></tr>` + rows.map(r => `<tr><td><span class="swatch" style="background:${hex(r.col)}"></span></td><td>${r.col.name}${r.i === 0 ? ` <span class="muted small">(${cut ? "bottom" : "plate"})</span>` : ""}</td>
    <td><input type="number" step="0.2" min="0.2" value="${r.hgt}" data-l="${r.l}"></td><td>${r.z0.toFixed(1)}</td>
    <td>${r.st ? `<span style="color:var(--${r.st.ok ? "ok" : "warn"})">${r.st.thinnestMm.toFixed(1)} mm</span>` : "—"}</td>
    <td><button class="ghost mini" data-up="${r.l}" ${r.i === 0 ? "disabled" : ""}>▲</button> <button class="ghost mini" data-dn="${r.l}" ${r.i === rows.length - 1 ? "disabled" : ""}>▼</button></td></tr>`).join("");
  $("layers").querySelectorAll("input").forEach(e => e.onchange = () => { heights[e.dataset.l] = +e.value; go(0); });
  $("layers").querySelectorAll("[data-up],[data-dn]").forEach(b => b.onclick = () => {
    const l = +(b.dataset.up ?? b.dataset.dn), j = order.indexOf(l), k = j + (b.dataset.up != null ? -1 : 1);
    if (k < 0 || k >= order.length) return; [order[j], order[k]] = [order[k], order[j]]; go(0);
  });
  drawFlat(labels, layerOrder, thinAll, W, H);
  show(parts, outW, outH);
  const tris = parts.reduce((s, p) => s + p.mesh.idx.length / 3, 0);
  $("status").textContent = `${outW.toFixed(0)} × ${outH.toFixed(0)} × ${Math.max(z, frameOn ? +$("fh").value : 0).toFixed(1)} mm, ${parts.length} parts, ${tris.toLocaleString()} triangles, ${Math.round(performance.now() - t0)} ms.`;
  out = { parts, base: (file?.name || "art").replace(/\.\w+$/, "") };
  for (const b of ["d3mf", "dstl", "save"]) $(b).disabled = !parts.length;
  document.body.dataset.done = (+document.body.dataset.done || 0) + 1;
}

function addBridges(labels, m0, cc, attached, W, H, bwPx, fillLabel, frameOn) {
  const edge = (m, p) => { const x = p % W; return (x === 0 || !m[p - 1]) || (x === W - 1 || !m[p + 1]) || p < W || !m[p - W] || p >= W * (H - 1) || !m[p + W]; };
  const bound = new Map(); // comp -> boundary pixels
  for (let p = 0; p < W * H; p++) if (m0[p] && edge(m0, p)) { const c = cc.comp[p]; (bound.get(c) || bound.set(c, []).get(c)).push(p); }
  const sample = (a, n) => a.length <= n ? a : Array.from({ length: n }, (_, i) => a[Math.floor(i * a.length / n)]);
  let targets = []; for (const [c, a] of bound) if (attached[c]) targets.push(...a); targets = sample(targets, 4000);
  const stamp = (x0, y0, x1, y1) => {
    const r = bwPx / 2, L = Math.hypot(x1 - x0, y1 - y0), steps = Math.max(1, Math.ceil(L * 2));
    for (let s = 0; s <= steps; s++) { const cx = x0 + (x1 - x0) * s / steps, cy = y0 + (y1 - y0) * s / steps;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (x >= 0 && y >= 0 && x < W && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= r * r && labels[y * W + x] === 255) labels[y * W + x] = fillLabel; }
  };
  for (const [c, a] of bound) {
    if (attached[c]) continue;
    let best = Infinity, bp = 0, bt = [0, 0];
    for (const p of sample(a, 300)) {
      const x = p % W, y = (p - x) / W;
      for (const t of targets) { const tx = t % W, ty = (t - tx) / W, d = (tx - x) ** 2 + (ty - y) ** 2; if (d < best) { best = d; bp = p; bt = [tx, ty]; } }
      if (frameOn) for (const [tx, ty] of [[-1, y], [W, y], [x, -1], [x, H]]) { const d = (tx - x) ** 2 + (ty - y) ** 2; if (d < best) { best = d; bp = p; bt = [tx, ty]; } }
    }
    stamp(bp % W, Math.floor(bp / W), bt[0], bt[1]);
  }
}

function drawFlat(labels, layerOrder, thin, W, H) {
  const c = $("flat"); c.width = W; c.height = H; const g = c.getContext("2d"), im = g.createImageData(W, H), showThin = $("showThin").checked;
  const lut = new Map(layerOrder.map(l => [l, Q.colors[l]]));
  for (let p = 0; p < W * H; p++) {
    const col = lut.get(labels[p]); const o = p * 4;
    if (showThin && thin[p]) { im.data[o] = 255; im.data[o + 1] = 30; im.data[o + 2] = 30; im.data[o + 3] = 255; }
    else if (col) { im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255; }
  }
  g.putImageData(im, 0, 0);
}

$("d3mf").onclick = () => download(out.base + "_wallart.3mf", zipSync(make3MFFiles(out.parts, { title: out.base })), "model/3mf");
$("dstl").onclick = () => { const f = {}; out.parts.forEach(p => f[p.name.replace(/[^\w-]+/g, "_") + ".stl"] = stlBinary(p.mesh)); download(out.base + "_stl.zip", zipSync(f), "application/zip"); };
const ids = ["mode", "k", "speck", "wmm", "bed", "ppm", "back", "bw", "fw", "fh", "fc", "noz"], checks = ["bridges", "frame"];
$("save").onclick = async () => {
  await saveProject({ id: projectIdFromUrl() || undefined, tool: "wall-art-studio", name: out.base,
    data: { settings: Object.fromEntries(ids.map(i => [i, $(i).value])), checks: Object.fromEntries(checks.map(i => [i, $(i).checked])), libSel, image: file },
    thumb: renderer.domElement.toDataURL("image/png") });
  $("status").textContent = "Saved to Projects.";
};
const pid = projectIdFromUrl();
if (pid) getProject(pid).then(p => {
  if (!p?.data) return; for (const [k, v] of Object.entries(p.data.settings || {})) if ($(k)) $(k).value = v;
  for (const [k, v] of Object.entries(p.data.checks || {})) if ($(k)) $(k).checked = v;
  if (p.data.libSel) libSel = p.data.libSel; $("mode").onchange(); if (p.data.image) setFile(p.data.image);
});
