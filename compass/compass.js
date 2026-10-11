import { header, dropZone, loadImage } from "../assets/ui.js";
import { getFilaments } from "../assets/library.js";
import { saveProject, getProject, projectIdFromUrl } from "../assets/projects.js";
import * as I from "../assets/imaging.js";
header("Compass");
const $ = id => document.getElementById(id);
let name = "image", projId = null, img = null;
dropZone($("drop"), { accept: "image/*", onFiles: async ([f]) => { name = f.name.replace(/\.[^.]+$/, ""); projId = null; const el = await loadImage(f); go(I.fromSource(el, 800), el.naturalWidth, el.naturalHeight); } });

export function advise(a, fullW, fullH, lib) {
  const flat = a.distinctColours <= 10 && a.edgeShare < 0.12, grey = a.colourfulness < 8;
  let mode, why;
  if (flat) { mode = "Flat colour (Color Match, or FlatForge-style one colour per region)"; why = `Few colours (${a.distinctColours}) with clean areas: each colour can be its own filament.`; }
  else if (grey) { mode = "Standard luminance stack (greyscale, dark to light)"; why = "The picture has almost no colour, so a dark-to-light filament stack fits it."; }
  else { mode = "Standard luminance stack, with a few colour swaps (try Color Match for exact colours)"; why = "A photo-like picture with many tones: brightness carries the detail, colour swaps add colour."; }
  const steps = [];
  const short = Math.min(fullW, fullH);
  if (short < 800) steps.push(`<a href="../image-prep/">Upscale</a> 2x: the short side is only ${short} px. Aim for about 1000 px or more.`);
  if (a.transparentBorder > 0.5) steps.push("Background is already transparent. Good.");
  else if (a.borderUniformity > 0.8 && a.backgroundShare > 0.05) steps.push(`<a href="../image-prep/">Remove background</a>: the border is one even colour <span class="swatch" style="background:${I.rgbToHex(a.borderColour)}"></span> (${Math.round(a.backgroundShare * 100)}% of the picture).`);
  else if (a.borderUniformity < 0.5) steps.push("Background is busy. Consider cutting out the subject, or keep it as part of the art.");
  steps.push(`<a href="../image-prep/">Crop</a> to your plate or print size.`);
  if (a.tonalRange < 55) steps.push(`Low tone range (${Math.round(a.tonalRange)} of 100). Raise contrast before you import, or the layers will look flat.`);
  if (flat) steps.push(`<a href="../image-prep/">Posterize</a> by colour to ${Math.min(12, Math.max(2, a.distinctColours))} bands, with speck removal, to get clean edges.`);
  else if (a.edgeShare > 0.25) steps.push("Lots of fine detail. Small details under about 0.4 mm will not print; a light blur or smoothing can help.");
  steps.push(`<a href="../palette-match/">Palette Match</a>: check how the picture looks with only your filaments.`);
  // filaments
  const n = flat ? Math.min(8, Math.max(2, a.distinctColours)) : grey ? 4 : 5;
  const pickIdx = I.suggestColours(img, lib.map(f => I.hexToRgb(f.hex)), n);
  let chosen = pickIdx.map(i => lib[i]);
  if (!flat) { // a luminance stack needs a dark base and a light top
    const byL = [...lib].sort((x, y) => lum(x) - lum(y));
    if (byL[0] && !chosen.includes(byL[0])) chosen.push(byL[0]);
    if (byL.at(-1) && !chosen.includes(byL.at(-1))) chosen.push(byL.at(-1));
  }
  chosen.sort((x, y) => lum(x) - lum(y));
  return { mode, why, steps, chosen, flat };
}
const lum = f => I.luminance(...I.hexToRgb(f.hex));

function go(i, fw, fh) {
  img = i; const c = I.toCanvas(img, $("prev")); c.style.display = "";
  const a = I.analyse(img), lib = getFilaments(), r = advise(a, fw, fh, lib);
  const pct = v => Math.round(v * 100) + "%";
  $("statsC").style.display = "";
  $("stats").innerHTML = [["Size", `${fw} x ${fh} px`], ["Tone range", `${Math.round(a.lMin)} to ${Math.round(a.lMax)} (of 100)`], ["Contrast", a.contrast < 12 ? "low" : a.contrast < 25 ? "medium" : "high"],
    ["Distinct colours", a.distinctColours], ["Colourfulness", a.colourfulness < 8 ? "almost grey" : a.colourfulness < 25 ? "soft colour" : "strong colour"],
    ["Background", `${pct(a.borderUniformity)} of border is one colour`], ["Background share", pct(a.backgroundShare)], ["Detail (edges)", pct(a.edgeShare)],
    ["Subject", a.backgroundShare > 0.05 ? `about ${pct(1 - a.backgroundShare)} of the picture` : "fills the picture"]].map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join("");
  const base = r.chosen[0];
  $("out").innerHTML = `<div class="card"><h2 style="margin-top:0">Suggested mode</h2><p><b>${r.mode}</b></p><p class="muted">${r.why}</p></div>
  <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Suggested prep steps</h2><ol>${r.steps.map(s => `<li>${s}</li>`).join("")}</ol></div>
  <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Suggested filament order</h2><p class="small muted">From your library, dark to light (bottom to top).</p>
  <table><thead><tr><th>#</th><th></th><th>Filament</th><th>TD</th></tr></thead><tbody>${r.chosen.map((f, i) => `<tr><td>${i + 1}</td><td><span class="swatch" style="background:${f.hex}"></span></td><td>${f.name} <span class="muted small">${f.brand}</span></td><td>${f.td}</td></tr>`).join("")}</tbody></table>
  <p class="small muted">${r.flat ? "For flat colour the order matters less: put the colour that covers the most area or the darkest first." : "Higher TD lets more light through; put high-TD light colours on top."} <a href="../library/">Edit library</a></p></div>
  <div class="card" style="margin-top:12px"><h2 style="margin-top:0">Suggested layers</h2><ul>
  <li>Layer height: <b>0.08 mm</b>.</li><li>First layer: 0.16 mm (or your printer's normal first layer).</li>
  <li>Base: ${base ? `<span class="swatch" style="background:${base.hex}"></span> ${base.name}` : "your darkest filament"}, about ${base && base.td < 1.5 ? "0.4 to 0.6" : "0.6 to 0.8"} mm thick so light does not shine through from below.</li></ul>
  <div class="row"><button class="ghost" id="save">Save project</button><span class="small muted" id="msg"></span></div></div>`;
  $("save").onclick = async () => { const p = await saveProject({ ...(projId ? { id: projId } : {}), tool: "compass", name, data: { image: I.toDataURL(img), fw, fh }, thumb: I.toDataURL(img, 240) }); projId = p.id; history.replaceState(null, "", "?project=" + p.id); $("msg").textContent = "Saved to Projects."; };
}
const pid = projectIdFromUrl();
if (pid) getProject(pid).then(async p => { if (!p || p.tool !== "compass") return; projId = p.id; name = p.name; go(I.fromSource(await I.loadDataURL(p.data.image), 800), p.data.fw, p.data.fh); });
