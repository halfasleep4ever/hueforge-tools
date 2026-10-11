import { header, dropZone, download, loadImage } from "../assets/ui.js";
import { getFilaments, filamentChecklist, hexToRgb } from "../assets/library.js";
import { saveProject, getProject, projectIdFromUrl } from "../assets/projects.js";
import { quantize, cleanSpecks, traceMask, simplifyPolys, layerMask, buildSvg, hex, compact } from "../assets/vector.js";
import { zipSync, strToU8 } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js";

header("SVG Convert");
const $ = id => document.getElementById(id);
let file = null, img = null, result = null, timer = 0, libSel = getFilaments().slice(0, 4).map(f => f.id);
filamentChecklist($("lib"), { selected: libSel, onChange: s => { libSel = s; go(); } });
for (const [i, o] of [["k", "kv"], ["speck", "sv"], ["eps", "ev"]]) $(i).addEventListener("input", () => $(o).textContent = $(i).value);
$("mode").onchange = () => { $("autoBox").hidden = $("mode").value !== "auto"; $("libBox").hidden = $("mode").value === "auto"; go(); };
for (const id of ["k", "speck", "eps", "size", "stack", "wmm"]) $(id).addEventListener("input", go);
dropZone($("drop"), { accept: "image/png,image/jpeg,image/webp", onFiles: async ([f]) => { await setFile(f); } });

async function setFile(f) {
  file = f; try { img = await loadImage(f); } catch { $("status").textContent = "Could not read that picture."; return; }
  $("drop").textContent = f.name || "picture"; go(0);
}
function go(delay = 250) { clearTimeout(timer); if (img) timer = setTimeout(run, delay); }

function run() {
  const t0 = performance.now(), max = +$("size").value, sc = Math.min(2.5, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
  const c = $("src"); c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.clearRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
  const rgba = g.getImageData(0, 0, w, h).data;
  let names = null, q;
  if ($("mode").value === "lib") {
    const fil = getFilaments().filter(f => libSel.includes(f.id));
    if (fil.length < 2) { $("status").textContent = "Tick at least 2 filaments."; return; }
    q = quantize(rgba, w, h, { palette: fil.map(f => hexToRgb(f.hex)) });
    names = fil.map(f => f.name).filter((_, j) => q.map[j] !== 255);
  } else q = quantize(rgba, w, h, { k: +$("k").value });
  cleanSpecks(q.labels, w, h, +$("speck").value);
  q = compact(q.labels, q.colors.map((c, j) => Object.assign(c, { name: names ? names[j] : null })));
  const order = q.counts.map((n, j) => j).sort((a, b) => q.counts[b] - q.counts[a]); // biggest at the bottom
  const stacked = $("stack").value === "1", eps = +$("eps").value;
  const layers = order.map((l, i) => {
    const polys = simplifyPolys(traceMask(layerMask(q.labels, order, i, stacked), w, h), eps);
    const col = q.colors[l];
    return { name: (col.name || hex(col)).replace(/[^\w#-]+/g, "_"), color: [col[0], col[1], col[2]], polys, holes: polys.reduce((s, p) => s + p.holes.length, 0), px: q.counts[l] };
  });
  const wmm = +$("wmm").value || null;
  const svg = buildSvg(layers, w, h, { widthMm: wmm });
  result = { svg, layers, w, h, wmm, base: (file?.name || "picture").replace(/\.\w+$/, "") };
  $("svgimg").src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  $("layers").innerHTML = `<tr><th></th><th>Colour</th><th>Area</th><th>Shapes</th><th>Holes</th></tr>` + layers.map(L =>
    `<tr><td><span class="swatch" style="background:${hex(L.color)}"></span></td><td>${L.name}</td><td>${(L.px / w / h * 100).toFixed(1)}%</td><td>${L.polys.length}</td><td>${L.holes}</td></tr>`).join("");
  const nodes = layers.reduce((s, L) => s + L.polys.reduce((t, p) => t + p.outer.length / 2 + p.holes.reduce((u, hh) => u + hh.length / 2, 0), 0), 0);
  $("status").textContent = `${layers.length} colours, ${nodes.toLocaleString()} points, ${(svg.length / 1024).toFixed(0)} KB, ${Math.round(performance.now() - t0)} ms.`;
  for (const b of ["dl", "dlz", "save"]) $(b).disabled = false;
  document.body.dataset.done = (+document.body.dataset.done || 0) + 1;
}
$("dl").onclick = () => download(result.base + ".svg", result.svg, "image/svg+xml");
$("dlz").onclick = () => {
  const files = {}; result.layers.forEach((L, i) => files[`${String(i + 1).padStart(2, "0")}_${L.name}.svg`] = strToU8(buildSvg([L], result.w, result.h, { widthMm: result.wmm })));
  files[result.base + "_all.svg"] = strToU8(result.svg);
  download(result.base + "_layers.zip", zipSync(files), "application/zip");
};
const settings = () => Object.fromEntries(["mode", "k", "speck", "eps", "size", "stack", "wmm"].map(id => [id, $(id).value]));
$("save").onclick = async () => {
  const thumb = document.createElement("canvas"), s = 200 / Math.max(result.w, result.h); thumb.width = result.w * s; thumb.height = result.h * s;
  thumb.getContext("2d").drawImage($("svgimg"), 0, 0, thumb.width, thumb.height);
  await saveProject({ id: projectIdFromUrl() || undefined, tool: "svg-convert", name: result.base, data: { settings: settings(), libSel, image: file, svg: result.svg }, thumb: thumb.toDataURL("image/png") });
  $("status").textContent = "Saved to Projects.";
};
const pid = projectIdFromUrl();
if (pid) getProject(pid).then(p => {
  if (!p?.data) return; for (const [k, v] of Object.entries(p.data.settings || {})) if ($(k)) $(k).value = v;
  $("mode").onchange(); if (p.data.libSel) libSel = p.data.libSel; if (p.data.image) setFile(p.data.image);
});
