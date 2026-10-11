import { header, dropZone, download, loadImage } from "../assets/ui.js";
import { hexToRgb } from "../assets/library.js";
import { saveProject, getProject, projectIdFromUrl } from "../assets/projects.js";
import { strokeStats, edt, lightness, traceMask, simplifyPolys, buildSvg, extrude, newMesh, stlBinary } from "../assets/vector.js";
import earcut from "https://cdn.jsdelivr.net/npm/earcut@2.2.4/+esm";

header("Text Studio");
const $ = id => document.getElementById(id), EXPORT_PPM = 10, MIN_MM = 0.8;
let photo = null, photoFile = null, cur = 0, timer = 0;
const blank = () => ({ text: "Daniel", font: "Lilita One", size: 18, col: "#ffffff", ow: 0, oc: "#111111", shadow: "0", x: 0.5, y: 0.8 });
let items = [blank()];
const fields = ["txt", "font", "size", "col", "ow", "oc", "shadow"], key = { txt: "text" };
const mm = () => ({ W: Math.max(20, +$("pw").value || 150), H: Math.max(20, +$("ph").value || 100) });

function syncList() {
  $("item").innerHTML = items.map((it, i) => `<option value="${i}">${i + 1}. ${(it.text || "(empty)").slice(0, 20).replace(/</g, "&lt;")}</option>`).join(""); $("item").value = cur;
  const it = items[cur]; for (const f of fields) $(f).value = it[key[f] || f];
}
$("item").onchange = () => { cur = +$("item").value; syncList(); };
$("add").onclick = () => { items.push({ ...blank(), text: "Text", y: 0.2 }); cur = items.length - 1; syncList(); draw(); };
$("del").onclick = () => { if (items.length > 1) { items.splice(cur, 1); cur = 0; syncList(); draw(); } };
for (const f of fields) $(f).addEventListener("input", () => { const v = $(f).value; items[cur][key[f] || f] = ["size", "ow"].includes(f) ? +v : v; if (f === "txt") syncList(); draw(); });
for (const f of ["pw", "ph"]) $(f).addEventListener("input", () => { if (photo && f === "pw") $("ph").value = Math.round(+$("pw").value * photo.naturalHeight / photo.naturalWidth); draw(); });
dropZone($("drop"), { accept: "image/*", onFiles: ([f]) => setPhoto(f) });
async function setPhoto(f) {
  try { photo = await loadImage(f); } catch { $("status").textContent = "Could not read that picture."; return; }
  photoFile = f; $("drop").textContent = f.name || "picture"; $("ph").value = Math.round(+$("pw").value * photo.naturalHeight / photo.naturalWidth); draw();
}

// ---- rendering ----
function lines(it) { return String(it.text || "").split("\n"); }
function fontOf(it, ppm) { return `${it.font === "system-ui" ? "800 " : ""}${it.size * ppm}px ${it.font === "system-ui" ? "system-ui,sans-serif" : `"${it.font}"`}`; }
function bbox(g, it, ppm, W, H) { // in canvas px
  g.font = fontOf(it, ppm); const L = lines(it), lh = it.size * ppm * 1.15, tw = Math.max(1, ...L.map(l => g.measureText(l).width));
  const cx = it.x * W * ppm, cy = it.y * H * ppm, th = lh * L.length;
  return { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th, cx, cy, lh, L };
}
function drawPhoto(g, W, H, ppm) {
  g.fillStyle = "#808080"; g.fillRect(0, 0, W * ppm, H * ppm);
  if (photo) g.drawImage(photo, 0, 0, W * ppm, H * ppm);
}
// layer: "all" | "fill" (text fill only, black on clear) | "outline" (fill + outline)
function drawText(g, it, ppm, W, H, layer = "all") {
  const b = bbox(g, it, ppm, W, H); g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round"; g.font = fontOf(it, ppm);
  const each = fn => b.L.forEach((l, i) => fn(l, b.cx, b.cy - b.h / 2 + b.lh * (i + 0.5)));
  const solid = layer !== "all";
  if (layer === "all" && it.shadow === "1") { const o = it.size * ppm * 0.06; g.fillStyle = "#000000"; g.strokeStyle = "#000000"; g.lineWidth = 2 * it.ow * ppm; each((l, x, y) => { if (it.ow > 0) g.strokeText(l, x + o, y + o); g.fillText(l, x + o, y + o); }); }
  if (it.ow > 0 && layer !== "fill") { g.strokeStyle = solid ? "#000" : it.oc; g.lineWidth = 2 * it.ow * ppm; each((l, x, y) => g.strokeText(l, x, y)); }
  g.fillStyle = solid ? "#000" : it.col; each((l, x, y) => g.fillText(l, x, y));
  return b;
}
function render(ppm) {
  const { W, H } = mm(), c = document.createElement("canvas"); c.width = Math.round(W * ppm); c.height = Math.round(H * ppm);
  const g = c.getContext("2d"); drawPhoto(g, W, H, ppm); items.forEach(it => drawText(g, it, ppm, W, H)); return c;
}
const cv = $("cv");
function draw() {
  const { W, H } = mm(), ppm = Math.min(6, 1100 / W); cv.width = Math.round(W * ppm); cv.height = Math.round(H * ppm);
  const g = cv.getContext("2d"); drawPhoto(g, W, H, ppm);
  items.forEach((it, i) => { const b = drawText(g, it, ppm, W, H); if (i === cur) { g.setLineDash([6, 4]); g.strokeStyle = "#ff8a3d"; g.lineWidth = 1.5; g.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); g.setLineDash([]); } });
  cv._ppm = ppm; clearTimeout(timer); timer = setTimeout(check, 250);
}

// ---- drag ----
let drag = null;
cv.addEventListener("pointerdown", e => {
  const r = cv.getBoundingClientRect(), k = cv.width / r.width, px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k, { W, H } = mm(), g = cv.getContext("2d");
  for (let i = items.length - 1; i >= 0; i--) { const b = bbox(g, items[i], cv._ppm, W, H); if (px >= b.x - 8 && px <= b.x + b.w + 8 && py >= b.y - 8 && py <= b.y + b.h + 8) { cur = i; syncList(); drag = { dx: px - b.cx, dy: py - b.cy }; cv.setPointerCapture(e.pointerId); cv.classList.add("drag"); draw(); return; } }
});
cv.addEventListener("pointermove", e => {
  if (!drag) return; const r = cv.getBoundingClientRect(), k = cv.width / r.width, { W, H } = mm();
  items[cur].x = Math.min(1, Math.max(0, ((e.clientX - r.left) * k - drag.dx) / (W * cv._ppm))); items[cur].y = Math.min(1, Math.max(0, ((e.clientY - r.top) * k - drag.dy) / (H * cv._ppm))); draw();
});
cv.addEventListener("pointerup", () => { drag = null; cv.classList.remove("drag"); });

// ---- checks ----
function maskOf(it, ppm, layer) { // returns {m, w, h} at ppm over the whole print, alpha > 50%
  const { W, H } = mm(), c = document.createElement("canvas"); c.width = Math.round(W * ppm); c.height = Math.round(H * ppm);
  const g = c.getContext("2d", { willReadFrequently: true }); drawText(g, it, ppm, W, H, layer);
  const d = g.getImageData(0, 0, c.width, c.height).data, m = new Uint8Array(c.width * c.height);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0; return { m, w: c.width, h: c.height };
}
function check() {
  const { W, H } = mm(), ppm = Math.min(EXPORT_PPM, 2400 / Math.max(W, H)), out = [];
  const pc = document.createElement("canvas"); pc.width = Math.round(W * ppm); pc.height = Math.round(H * ppm);
  const pg = pc.getContext("2d", { willReadFrequently: true }); drawPhoto(pg, W, H, ppm); const pd = pg.getImageData(0, 0, pc.width, pc.height).data;
  items.forEach((it, i) => {
    if (!String(it.text).trim()) return; const tag = items.length > 1 ? `Text ${i + 1}: ` : "";
    const f = maskOf(it, ppm, "fill"), st = strokeStats(f.m, f.w, f.h, ppm, MIN_MM);
    out.push(st.ok ? ["ok", `${tag}thinnest stroke about ${st.thinnestMm.toFixed(1)} mm. OK for a 0.4 mm nozzle.`]
      : ["bad", `${tag}thinnest stroke about ${st.thinnestMm.toFixed(1)} mm, below ${MIN_MM} mm. Make the letters bigger or use a bolder font.`]);
    if (it.ow > 0 && it.ow < MIN_MM) out.push(["", `${tag}outline is ${it.ow} mm. Use ${MIN_MM} mm or more so it prints.`]);
    // value contrast: the text colour against what stays visible right around it
    const o = it.ow > 0 ? maskOf(it, ppm, "outline") : f, near = edt(o.m.map(v => 1 - v), o.w, o.h), R = 2 * ppm;
    let sum = 0, n = 0, close = 0; const Lt = lightness(hexToRgb(it.col)), Lo = lightness(hexToRgb(it.oc));
    const Lfront = it.ow > 0 ? Lo : Lt;
    for (let p = 0; p < near.length; p++) if (!o.m[p] && near[p] <= R) { const L = lightness([pd[p * 4], pd[p * 4 + 1], pd[p * 4 + 2]]); sum += L; n++; if (Math.abs(L - Lfront) < 15) close++; }
    const Lbg = n ? sum / n : 50, diff = Math.abs(Lfront - Lbg), pct = n ? close / n * 100 : 0;
    const what = it.ow > 0 ? "outline" : "text";
    const okC = diff >= 30 && pct < 20, mid = diff >= 15;
    out.push([okC ? "ok" : mid ? "" : "bad", `${tag}value contrast ${what} vs picture: ΔL ${diff.toFixed(0)} (${what} ${Lfront.toFixed(0)}, picture ${Lbg.toFixed(0)}); ${pct.toFixed(0)}% of the picture next to it is close in value. ${okC ? "Pass." : "HueForge builds by value: make the " + what + " lighter or darker" + (it.ow > 0 ? "" : ", or add an outline") + "."}`]);
    if (it.ow > 0) { const d2 = Math.abs(Lt - Lo); out.push([d2 >= 30 ? "ok" : "bad", `${tag}text vs outline: ΔL ${d2.toFixed(0)}. ${d2 >= 30 ? "Pass." : "Too close in value to read."}`]); }
  });
  $("checks").innerHTML = out.map(([c, t]) => `<div class="note ${c}">${t}</div>`).join("");
  $("status").textContent = `PNG export: ${Math.round(W * EXPORT_PPM)} × ${Math.round(H * EXPORT_PPM)} px (${EXPORT_PPM} px/mm).`;
  document.body.dataset.done = (+document.body.dataset.done || 0) + 1;
}

// ---- exports ----
const base = () => (photoFile?.name || "text").replace(/\.\w+$/, "") + "_text";
$("png").onclick = () => render(EXPORT_PPM).toBlob(b => download(base() + ".png", b), "image/png");
function textPolys() {
  const { W, H } = mm(), ppm = EXPORT_PPM, c = document.createElement("canvas"); c.width = Math.round(W * ppm); c.height = Math.round(H * ppm);
  const g = c.getContext("2d", { willReadFrequently: true }); items.forEach(it => drawText(g, it, ppm, W, H, "outline"));
  const d = g.getImageData(0, 0, c.width, c.height).data, m = new Uint8Array(c.width * c.height); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return { polys: traceMask(m, c.width, c.height), w: c.width, h: c.height, ppm };
}
$("svg").onclick = () => { const t = textPolys(), { W } = mm(); download(base() + ".svg", buildSvg([{ name: "text", color: hexToRgb(items[0].col), polys: simplifyPolys(t.polys, 0.6) }], t.w, t.h, { widthMm: W }), "image/svg+xml"); };
$("stl").onclick = () => { const t = textPolys(), mesh = newMesh(); extrude(mesh, t.polys, 0, +$("rh").value || 0.8, (x, y) => [x / t.ppm, (t.h - y) / t.ppm], earcut); download(base() + ".stl", stlBinary(mesh), "model/stl"); };
$("save").onclick = async () => {
  const c = render(200 / mm().W);
  await saveProject({ id: projectIdFromUrl() || undefined, tool: "text-studio", name: items[0].text || "Text", data: { items, pw: $("pw").value, ph: $("ph").value, image: photoFile }, thumb: c.toDataURL("image/png") });
  $("status").textContent = "Saved to Projects.";
};
syncList();
Promise.all(["Lilita One", "Bebas Neue", "Pacifico"].map(f => document.fonts.load(`20px "${f}"`))).finally(draw);
const pid = projectIdFromUrl();
if (pid) getProject(pid).then(async p => { if (!p?.data) return; items = p.data.items || items; $("pw").value = p.data.pw; $("ph").value = p.data.ph; cur = 0; syncList(); if (p.data.image) await setPhoto(p.data.image); else draw(); });
