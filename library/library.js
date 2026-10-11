import { header, dropZone, download } from "../assets/ui.js";
import { DEFAULTS, getFilaments, saveFilaments, onLibraryChange, hexToRgb } from "../assets/library.js";
import { parseFilamentFile, normHex } from "./import.js";
header("Filament Library");
const $ = id => document.getElementById(id), tb = $("tb");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lum = h => { const [r, g, b] = hexToRgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const msg = (t, cls = "ok") => { $("msg").innerHTML = t ? `<p class="note ${cls}">${t}</p>` : ""; };
let skip = false; // avoid redraw while typing
function draw() {
  const l = getFilaments();
  tb.innerHTML = l.map((f, i) => `<tr data-id="${esc(f.id)}"><td><span class="swatch" style="background:${esc(f.hex)}"></span></td>
  <td><input data-k="name" value="${esc(f.name)}" aria-label="Name"></td><td><input data-k="brand" value="${esc(f.brand || "")}" aria-label="Brand"></td>
  <td><span class="row" style="gap:4px;flex-wrap:nowrap"><input type="color" data-k="pick" value="${esc(normHex(f.hex) || "#000000").toLowerCase()}" aria-label="Pick colour"><input class="hex" data-k="hex" value="${esc(f.hex)}" aria-label="Hex"></span></td>
  <td><input class="td" type="number" step="0.1" min="0.1" data-k="td" value="${f.td}" aria-label="TD"></td>
  <td class="acts"><button class="ghost" data-a="up" ${i ? "" : "disabled"} title="Move up">↑</button> <button class="ghost" data-a="down" ${i < l.length - 1 ? "" : "disabled"} title="Move down">↓</button> <button class="ghost" data-a="del" title="Delete">Delete</button></td></tr>`).join("")
    || `<tr><td colspan="6" class="muted">No filaments. Add one, or reset to defaults.</td></tr>`;
}
function patch(id, p) { skip = true; saveFilaments(getFilaments().map(f => f.id === id ? { ...f, ...p } : f)); skip = false; }
tb.addEventListener("input", e => {
  const inp = e.target, tr = inp.closest("tr"), k = inp.dataset.k; if (!k || !tr) return;
  const id = tr.dataset.id;
  if (k === "pick") { const h = inp.value.toUpperCase(); tr.querySelector("[data-k=hex]").value = h; tr.querySelector(".swatch").style.background = h; patch(id, { hex: h }); }
  else if (k === "hex") { const h = normHex(inp.value); inp.style.borderColor = h ? "" : "var(--bad)"; if (h) { tr.querySelector("[data-k=pick]").value = h.toLowerCase(); tr.querySelector(".swatch").style.background = h; patch(id, { hex: h }); } }
  else if (k === "td") { const v = parseFloat(inp.value); inp.style.borderColor = v > 0 ? "" : "var(--bad)"; if (v > 0) patch(id, { td: v }); }
  else patch(id, { [k]: inp.value });
});
tb.addEventListener("change", e => { const i = e.target; if (i.dataset.k === "hex") { i.value = getFilaments().find(f => f.id === i.closest("tr").dataset.id)?.hex || i.value; i.style.borderColor = ""; } });
tb.addEventListener("click", e => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const id = b.closest("tr").dataset.id, l = getFilaments(), i = l.findIndex(f => f.id === id);
  if (b.dataset.a === "del") { if (!confirm(`Delete ${l[i].name}?`)) return; l.splice(i, 1); }
  else { const j = b.dataset.a === "up" ? i - 1 : i + 1; [l[i], l[j]] = [l[j], l[i]]; }
  saveFilaments(l);
});
$("add").onclick = () => { const l = getFilaments(); l.push({ id: "f" + Date.now().toString(36), name: "New filament", brand: "", hex: "#808080", td: 1.5 }); saveFilaments(l); const ins = tb.querySelectorAll("input[data-k=name]"); ins[ins.length - 1]?.select(); };
$("sort").onclick = () => saveFilaments(getFilaments().sort((a, b) => lum(a.hex) - lum(b.hex)));
$("exp").onclick = () => download("filament-library.json", JSON.stringify(getFilaments(), null, 2), "application/json");
$("reset").onclick = () => { if (confirm("Replace your library with the 8 default filaments? This cannot be undone.")) { saveFilaments(DEFAULTS.map(f => ({ ...f }))); msg("Library reset to defaults."); } };
const zone = document.createElement("div"); zone.hidden = true; document.body.append(zone);
dropZone(zone, { accept: ".json,.csv,.txt,application/json,text/csv", onFiles: async ([f]) => {
  try {
    const { list, kind, skipped } = parseFilamentFile(f.name, await f.text());
    if (!list.length) return msg(`No filaments found in ${esc(f.name)}. Expected a list with a name and hex colour.`, "bad");
    const base = $("replace").checked ? [] : getFilaments(), t = Date.now().toString(36);
    saveFilaments(base.concat(list.map((x, i) => ({ id: `f${t}${i}`, ...x }))));
    msg(`Imported ${list.length} filament${list.length > 1 ? "s" : ""} from ${esc(f.name)} (${kind}).${skipped ? ` Skipped ${skipped} without a colour.` : ""}${/guessed/.test(kind) ? " The HueForge file format is not documented, so the fields were guessed (Name, Brand, Color, Transmissivity/TD). Check the list." : ""}`, /guessed/.test(kind) ? "" : "ok");
  } catch (err) { msg(`Could not read ${esc(f.name)}: ${esc(err.message)}`, "bad"); }
} });
$("imp").onclick = () => zone.click();
// also accept a file dropped anywhere on the page
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => { e.preventDefault(); if (e.dataTransfer.files.length) zone.ondrop(e); });
onLibraryChange(() => { if (!skip) draw(); });
draw();
