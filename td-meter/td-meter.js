import { header, dropZone, download, loadImage } from "../assets/ui.js";
import { getFilaments, updateFilament, onLibraryChange } from "../assets/library.js";
import { cardLayout, cardSTL, fitTD, lumLinear, OPAQUE_T } from "./td.js";
header("TD Meter");
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const opts = () => ({ layer: Math.max(0.02, +$("lh").value || 0.08), first: Math.max(0.02, +$("fl").value || 0.08) });
const thick = () => cardLayout(opts()).thickness;

function cardInfo() { const L = cardLayout(opts()); $("cardinfo").textContent = `${L.width} × ${L.depth} mm. Steps ${L.thickness[0]} to ${L.thickness.at(-1)} mm. Frame ${L.frameH} mm.`; drawManual(); refit(); }
$("lh").oninput = $("fl").oninput = cardInfo;
$("stl").onclick = () => { const o = opts(); download(`td-step-card-${o.layer}mm.stl`, cardSTL(o).stl, "model/stl"); };

// mode tabs
document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  $("m-photo").hidden = b.dataset.m !== "photo"; $("m-manual").hidden = b.dataset.m !== "manual"; mode = b.dataset.m; refit();
});
let mode = "photo";

// ---- photo mode
const cv = $("photo"), ctx = cv.getContext("2d", { willReadFrequently: true });
let img = null, pixels = null, clicks = [], drag = null;
const names = () => ["open window", ...thick().map((t, i) => `step ${i + 1}`)];
dropZone($("drop"), { accept: "image/*", onFiles: async ([f]) => {
  try { img = await loadImage(f); } catch { $("res").textContent = "Could not read that image."; return; }
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
  ctx.drawImage(img, 0, 0, cv.width, cv.height); pixels = ctx.getImageData(0, 0, cv.width, cv.height);
  clicks = []; $("photowrap").hidden = false; redraw(); refit();
} });
const rad = () => Math.max(3, Math.round(Math.min(cv.width, cv.height) / 80));
function sample(x, y) { // mean linear luminance in a small square
  const r = rad(); let s = 0, n = 0;
  for (let j = Math.max(0, y - r); j <= Math.min(cv.height - 1, y + r); j++) for (let i = Math.max(0, x - r); i <= Math.min(cv.width - 1, x + r); i++) {
    const o = (j * cv.width + i) * 4; s += lumLinear(pixels.data[o], pixels.data[o + 1], pixels.data[o + 2]); n++;
  }
  return s / n;
}
const pos = e => { const b = cv.getBoundingClientRect(); return [Math.round((e.clientX - b.left) * cv.width / b.width), Math.round((e.clientY - b.top) * cv.height / b.height)]; };
cv.onpointerdown = e => { if (!pixels) return; cv.setPointerCapture(e.pointerId); drag = { a: pos(e), b: pos(e) }; };
cv.onpointermove = e => { if (drag) { drag.b = pos(e); redraw(); } };
cv.onpointerup = e => {
  if (!drag) return; const [a, b] = [drag.a, pos(e)]; drag = null;
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) > cv.width / 20) { // a line: window centre -> last step centre
    const fr = cardLayout(opts()).stepFrac; clicks = [a, ...fr.map(f => [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f)])];
  } else if (clicks.length < 9) clicks.push(b);
  redraw(); refit();
};
$("undo").onclick = () => { clicks.pop(); redraw(); refit(); };
$("clear").onclick = () => { clicks = []; redraw(); refit(); };
function redraw() {
  ctx.putImageData(pixels, 0, 0); const r = rad(), lw = Math.max(2, r / 2);
  if (drag) { ctx.strokeStyle = "#ff8a3d"; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(...drag.a); ctx.lineTo(...drag.b); ctx.stroke(); }
  clicks.forEach(([x, y], i) => {
    ctx.lineWidth = lw; ctx.strokeStyle = i ? "#ff8a3d" : "#3dc4ff"; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
    ctx.font = `bold ${r * 3}px system-ui`; ctx.fillStyle = "#000"; ctx.fillText(i ? i : "O", x + r + 3, y - r + 1); ctx.fillStyle = "#fff"; ctx.fillText(i ? i : "O", x + r + 2, y - r);
  });
  $("hint").textContent = clicks.length < 9 ? `Click the ${names()[clicks.length]}.` : "All 9 points set. Undo to change one, or drag a new line.";
}

// ---- manual mode
function drawManual() {
  const old = [...document.querySelectorAll("#vals input")].map(i => i.value);
  $("vals").innerHTML = names().map((n, i) => `<div><label for="v${i}">${i ? `${n} · ${thick()[i - 1]} mm` : "Open window"}</label><input id="v${i}" type="number" step="any" min="0" value="${esc(old[i] ?? "")}"></div>`).join("");
}
$("calc").onclick = refit;

// ---- fit + chart
let last = null;
function points() {
  const t = thick();
  if (mode === "manual") { const v = [...document.querySelectorAll("#vals input")].map(i => parseFloat(i.value)); return v[0] > 0 ? t.map((x, i) => ({ t: x, T: v[i + 1] / v[0] })).filter(p => isFinite(p.T)) : []; }
  if (!pixels || clicks.length < 2) return [];
  const I0 = sample(...clicks[0]); return clicks.slice(1).map((c, i) => ({ t: t[i], T: sample(...c) / I0 }));
}
function refit() {
  const pts = points(); last = null; $("save").disabled = true;
  if (!pts.length) { $("res").innerHTML = `<span class="muted">${mode === "manual" ? "Type the open window value and at least 2 steps." : "No measurement yet."}</span>`; chart([], null); return; }
  const r = fitTD(pts);
  if (!r.ok) { $("res").innerHTML = `<p class="note bad">${esc(r.reason)}</p>`; chart(pts, null); return; }
  last = r; $("save").disabled = false;
  const warn = [];
  if (r.r2 < 0.9) warn.push("The steps do not follow a clean curve (R² below 0.9). Check the clicks and the light.");
  if (pts.some(p => p.T >= 1)) warn.push("Some steps are as bright as the open window. The photo may be overexposed: lower the exposure.");
  if (r.used < pts.length) warn.push(`${pts.length - r.used} step(s) were skipped (black or brighter than the window).`);
  $("res").innerHTML = `<div class="big">TD ≈ ${r.td.toFixed(2)}</div><div class="small muted">k = ${r.k.toFixed(2)} per mm · surface ${(r.surface * 100).toFixed(0)} % · fit R² = ${r.r2.toFixed(3)} · ${r.used} steps used</div>${warn.map(w => `<p class="note small">${w}</p>`).join("")}`;
  chart(pts, r);
}
function chart(pts, r) {
  const c = $("chart"), g = c.getContext("2d"), W = c.width, H = c.height, css = getComputedStyle(document.body);
  const fg = css.getPropertyValue("--text").trim() || "#ddd", mu = css.getPropertyValue("--muted").trim() || "#999";
  g.clearRect(0, 0, W, H);
  const L = 56, R = 16, T = 16, B = 40, tmax = Math.max(thick().at(-1) * 1.1, r ? Math.min(r.td * 1.05, thick().at(-1) * 6) : 0);
  const X = t => L + (W - L - R) * t / tmax, Y = v => T + (H - T - B) * (1 - Math.min(1.05, Math.max(0, v)) / 1.05);
  g.strokeStyle = mu; g.fillStyle = mu; g.font = "13px system-ui"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(L, T); g.lineTo(L, H - B); g.lineTo(W - R, H - B); g.stroke();
  for (const v of [0, 0.25, 0.5, 0.75, 1]) { g.fillText(`${v * 100}%`, 8, Y(v) + 4); g.globalAlpha = .2; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.globalAlpha = 1; }
  const step = tmax > 3 ? 1 : tmax > 1.2 ? 0.5 : 0.2;
  for (let t = 0; t <= tmax + 1e-9; t += step) g.fillText(t.toFixed(1), X(t) - 8, H - B + 18);
  g.fillText("thickness (mm)", W / 2 - 40, H - 6); g.fillText("light through", L + 6, T + 12);
  if (r) {
    g.strokeStyle = "#ff8a3d"; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 200; i++) { const t = tmax * i / 200; const y = Y(Math.exp(r.a - r.k * t)); i ? g.lineTo(X(t), y) : g.moveTo(X(t), y); } g.stroke();
    g.setLineDash([5, 5]); g.strokeStyle = mu; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(OPAQUE_T)); g.lineTo(W - R, Y(OPAQUE_T)); g.stroke();
    if (r.td <= tmax) { g.beginPath(); g.moveTo(X(r.td), T); g.lineTo(X(r.td), H - B); g.stroke(); g.fillStyle = fg; g.fillText(`TD ${r.td.toFixed(2)}`, Math.min(X(r.td) + 4, W - 70), T + 28); }
    g.setLineDash([]);
  }
  g.fillStyle = "#3dc4ff"; for (const p of pts) { g.beginPath(); g.arc(X(p.t), Y(p.T), 5, 0, 7); g.fill(); }
  if (!pts.length) { g.fillStyle = mu; g.fillText("Points and the fitted curve appear here.", L + 20, H / 2); }
}

// ---- save
function fillSelect() { const v = $("fil").value; $("fil").innerHTML = getFilaments().map(f => `<option value="${esc(f.id)}">${esc(f.name)} (${esc(f.brand)}) · TD ${f.td}</option>`).join(""); if (v) $("fil").value = v; }
$("save").onclick = () => {
  if (!last) return; const id = $("fil").value, f = getFilaments().find(x => x.id === id); if (!f) return;
  const td = +last.td.toFixed(2); updateFilament(id, { td });
  $("saved").innerHTML = `<p class="note ok small">Saved TD ${td} to ${esc(f.name)} (was ${f.td}).</p>`;
};
onLibraryChange(fillSelect); fillSelect(); cardInfo();
