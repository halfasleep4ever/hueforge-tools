import { header, dropZone, download, loadImage } from "../assets/ui.js";
import { saveProject, getProject, projectIdFromUrl } from "../assets/projects.js";
import * as I from "../assets/imaging.js";
header("Image Prep");
const $ = id => document.getElementById(id), cv = $("cv"), box = $("cbox");
const MAX = 4096; // longest side we allow
let orig = null, cur = null, hist = [], preview = null, tab = "up", pick = null, name = "image", projId = null, timer = 0;
const ASPECT = [["Free", 0, 0], ["Square 1:1", 1, 1], ["Bambu A1 mini 180 x 180 mm", 180, 180], ["Bambu A1 / P1S / X1 256 x 256 mm", 256, 256], ["Prusa MK4 250 x 210 mm", 250, 210], ["Ender 3 220 x 220 mm", 220, 220], ["Snapmaker U1 270 x 270 mm", 270, 270],
  ["Print 100 x 150 mm (portrait)", 100, 150], ["Print 150 x 100 mm (landscape)", 150, 100], ["Print 4 x 6 in", 4, 6], ["Print 5 x 7 in", 5, 7], ["Print 8 x 10 in", 8, 10], ["A5 148 x 210 mm", 148, 210], ["A4 210 x 297 mm", 210, 297]];
$("cropA").innerHTML = ASPECT.map((a, i) => `<option value="${i}">${a[0]}</option>`).join("");
let cr = { x: 0, y: 0, w: 1, h: 1 }; // crop box in image px

dropZone($("drop"), { accept: "image/*", onFiles: async ([f]) => { name = f.name.replace(/\.[^.]+$/, ""); start(I.fromSource(await loadImage(f), MAX)); projId = null; } });
function start(img) { orig = img; cur = img; hist = []; $("tools").style.display = ""; setTab(tab); }
function show(img) { I.toCanvas(img, cv); $("status").textContent = `${img.width} x ${img.height} px` + (img === preview ? " · preview (press Apply)" : ""); }
function setTab(t) {
  tab = t; document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.t === t));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("on", p.id === "p-" + t));
  box.style.display = t === "crop" ? "block" : "none"; if (t === "crop") initCrop(); schedule(0);
}
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => setTab(b.dataset.t));
document.querySelectorAll("#tools input,#tools select").forEach(e => e.addEventListener("input", () => { labels(); if (e.id === "cropA") initCrop(); schedule(); }));
function labels() { $("upSv").textContent = $("upS").value; $("bgTv").textContent = $("bgT").value; $("bgFv").textContent = $("bgF").value; $("poNv").textContent = $("poN").value; $("poSv").textContent = $("poS").value; $("poKv").textContent = $("poK").value; }
labels();
function schedule(ms = 200) { clearTimeout(timer); timer = setTimeout(run, ms); }

function compute() {
  if (tab === "up") {
    const f = +$("upF").value; if (Math.max(cur.width, cur.height) * f > MAX) throw new Error(`Too big: the result would be over ${MAX} px. Crop first, or use 2x.`);
    return I.upscale(cur, f, { sharpen: +$("upS").value });
  }
  if (tab === "crop") return I.crop(cur, cr.x, cr.y, cr.w, cr.h);
  if (tab === "bg") {
    const tol = +$("bgT").value, feather = +$("bgF").value, mode = $("bgC").checked ? "flood" : "global";
    if ($("bgM").value === "auto") { const c = I.borderColour(cur); $("bgInfo").innerHTML = `Border colour <span class="swatch" style="background:${I.rgbToHex(c)}"></span> ${I.rgbToHex(c)}`; return I.removeBackground(cur, c, { tolerance: tol, feather, mode }); }
    if (!pick) { $("bgInfo").textContent = "Click the picture to pick the background colour."; return cur; }
    $("bgInfo").innerHTML = `Picked <span class="swatch" style="background:${I.rgbToHex(pick.c)}"></span> ${I.rgbToHex(pick.c)}`;
    return I.removeBackground(cur, pick.c, { tolerance: tol, feather, mode, seeds: [[pick.x, pick.y]] });
  }
  const n = +$("poN").value, m = $("poM").value, w = cur.width, h = cur.height;
  const p = m === "colour" ? I.posterizeColour(cur, n) : I.posterizeLuma(cur, n, { gray: m === "luma" });
  let idx = p.index; if (+$("poS").value) idx = I.smoothIndex(idx, w, h, +$("poS").value); if (+$("poK").value) idx = I.removeSpecks(idx, w, h, +$("poK").value);
  const out = I.renderIndex(idx, p.palette, w, h);
  for (let i = 0; i < w * h; i++) if (idx[i] >= 0) out.data[i * 4 + 3] = cur.data[i * 4 + 3] < 128 ? 0 : 255; // keep cut-out
  return out;
}
function run() {
  if (!cur) return;
  if (tab === "crop") { preview = null; show(cur); placeBox(); $("cropInfo").textContent = `${Math.round(cr.w)} x ${Math.round(cr.h)} px`; return; }
  $("status").textContent = "Working…";
  setTimeout(() => { try { preview = tab === "up" ? null : compute(); show(preview || cur); if (tab === "up") $("status").textContent += ` · after upscale: ${cur.width * $("upF").value} x ${cur.height * $("upF").value} px`; } catch (e) { $("status").textContent = e.message; } }, 10);
}
$("apply").onclick = () => {
  try { const r = (tab === "up" || tab === "crop") ? compute() : (preview || compute()); hist.push(cur); if (hist.length > 15) hist.shift(); cur = r; preview = null; pick = null; $("hist").textContent = `${hist.length} step(s) done.`; if (tab === "crop") initCrop(); run(); }
  catch (e) { $("status").textContent = e.message; }
};
$("undo").onclick = () => { if (!hist.length) return; cur = hist.pop(); preview = null; $("hist").textContent = `${hist.length} step(s) done.`; if (tab === "crop") initCrop(); run(); };
$("reset").onclick = () => { if (orig) { hist.push(cur); cur = orig; preview = null; run(); } };
$("exp").onclick = async () => download(name + "-prep.png", await I.toBlob(preview || cur));
$("save").onclick = async () => {
  const p = await saveProject({ ...(projId ? { id: projId } : {}), tool: "image-prep", name, data: { image: I.toDataURL(cur) }, thumb: I.toDataURL(cur, 240) });
  projId = p.id; history.replaceState(null, "", "?project=" + p.id); $("hist").textContent = "Saved to Projects.";
};
// pick colour on click
cv.addEventListener("click", e => {
  if (tab !== "bg" || $("bgM").value !== "pick" || !cur) return;
  const r = cv.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) * cur.width / r.width), y = Math.floor((e.clientY - r.top) * cur.height / r.height), p = (y * cur.width + x) * 4;
  pick = { x, y, c: [cur.data[p], cur.data[p + 1], cur.data[p + 2]] }; schedule(0);
});
// crop box
function initCrop() {
  if (!cur) return; const a = ASPECT[+$("cropA").value]; let w = cur.width, h = cur.height;
  if (a[1]) { const ar = a[1] / a[2]; if (w / h > ar) w = h * ar; else h = w / ar; }
  cr = { x: (cur.width - w) / 2, y: (cur.height - h) / 2, w, h }; placeBox();
}
function placeBox() { const s = cv.getBoundingClientRect().width / cur.width || 1; Object.assign(box.style, { left: cr.x * s + "px", top: cr.y * s + "px", width: cr.w * s + "px", height: cr.h * s + "px" }); $("cropInfo").textContent = `${Math.round(cr.w)} x ${Math.round(cr.h)} px`; }
window.addEventListener("resize", () => cur && tab === "crop" && placeBox());
box.addEventListener("pointerdown", e => {
  e.preventDefault(); box.setPointerCapture(e.pointerId);
  const resize = e.target.tagName === "I", s = cur.width / cv.getBoundingClientRect().width, sx = e.clientX, sy = e.clientY, c0 = { ...cr }, a = ASPECT[+$("cropA").value];
  box.onpointermove = m => {
    const dx = (m.clientX - sx) * s, dy = (m.clientY - sy) * s;
    if (resize) { let w = Math.max(10, Math.min(cur.width - c0.x, c0.w + dx)), h = Math.max(10, Math.min(cur.height - c0.y, c0.h + dy)); if (a[1]) { const ar = a[1] / a[2]; h = w / ar; if (c0.y + h > cur.height) { h = cur.height - c0.y; w = h * ar; } } cr = { ...c0, w, h }; }
    else cr = { ...c0, x: Math.max(0, Math.min(cur.width - c0.w, c0.x + dx)), y: Math.max(0, Math.min(cur.height - c0.h, c0.y + dy)) };
    placeBox();
  };
  box.onpointerup = () => { box.onpointermove = null; };
});
// restore saved project
const pid = projectIdFromUrl();
if (pid) getProject(pid).then(async p => { if (!p || p.tool !== "image-prep") return; projId = p.id; name = p.name; start(I.fromSource(await I.loadDataURL(p.data.image), MAX)); });
