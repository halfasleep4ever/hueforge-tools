import { header, dropZone, download, loadImage } from "../assets/ui.js";
import { getFilaments, filamentChecklist, onLibraryChange } from "../assets/library.js";
import { saveProject, getProject, projectIdFromUrl } from "../assets/projects.js";
import * as I from "../assets/imaging.js";
header("Palette Match");
const $ = id => document.getElementById(id);
let img = null, out = null, name = "image", projId = null, selected = getFilaments().map(f => f.id), pick;
const makeList = () => { pick = filamentChecklist($("list"), { selected, onChange: s => { selected = s; render(); } }); };
makeList(); onLibraryChange(render);
dropZone($("drop"), { accept: "image/*", onFiles: async ([f]) => { name = f.name.replace(/\.[^.]+$/, ""); projId = null; setImage(I.fromSource(await loadImage(f), 2000)); } });
$("dith").onchange = render;
function setImage(i) { img = i; I.toCanvas(img, $("a")); render(); }
function chosen() { const lib = getFilaments(); return selected.map(id => lib.find(f => f.id === id)).filter(Boolean); }
function render() {
  if (!img) return; const fs = chosen();
  if (!fs.length) { $("msg").textContent = "Pick at least one filament."; return; }
  $("msg").textContent = "";
  const m = I.mapToPalette(img, fs.map(f => I.hexToRgb(f.hex)), { dither: $("dith").checked });
  out = m.image; I.toCanvas(out, $("b"));
  const tot = m.counts.reduce((a, b) => a + b, 0) || 1;
  $("tbl").tBodies[0].innerHTML = fs.map((f, i) => [f, m.counts[i]]).sort((x, y) => y[1] - x[1]).map(([f, c]) =>
    `<tr><td><span class="swatch" style="background:${f.hex}"></span></td><td>${f.name} <span class="muted small">${f.brand}</span></td><td>${f.td}</td><td>${(100 * c / tot).toFixed(1)}%</td></tr>`).join("");
  const e = m.meanDeltaE; $("fit").textContent = `Average colour error: ${e.toFixed(1)} deltaE (${e < 5 ? "very close" : e < 12 ? "close" : e < 25 ? "rough" : "far off"}). Lower is better.`;
}
$("sug").onclick = () => {
  if (!img) { $("msg").textContent = "Drop a picture first."; return; }
  const lib = getFilaments(), idx = I.suggestColours(img, lib.map(f => I.hexToRgb(f.hex)), Math.max(1, +$("n").value || 4));
  selected = idx.map(i => lib[i].id); makeList(); render(); $("msg").textContent = `Suggested ${idx.length} filaments that cover this picture best.`;
};
$("exp").onclick = async () => out && download(name + "-matched.png", await I.toBlob(out));
$("save").onclick = async () => {
  if (!img) return;
  const p = await saveProject({ ...(projId ? { id: projId } : {}), tool: "palette-match", name, data: { image: I.toDataURL(img), selected, dither: $("dith").checked }, thumb: I.toDataURL(out || img, 240) });
  projId = p.id; history.replaceState(null, "", "?project=" + p.id); $("msg").textContent = "Saved to Projects.";
};
const pid = projectIdFromUrl();
if (pid) getProject(pid).then(async p => { if (!p || p.tool !== "palette-match") return; projId = p.id; name = p.name; selected = p.data.selected || selected; $("dith").checked = !!p.data.dither; makeList(); setImage(I.fromSource(await I.loadDataURL(p.data.image), 2000)); });
