import { header, dropZone, download } from "../assets/ui.js";
import { listProjects, saveProject, getProject, deleteProject } from "../assets/projects.js";
header("Projects");
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const msg = (t, cls = "ok") => { $("msg").innerHTML = t ? `<p class="note ${cls}">${t}</p>` : ""; };
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
const toolName = t => String(t || "unknown").replace(/-/g, " ").replace(/^./, c => c.toUpperCase());
const thumbUrls = [];
function thumbSrc(t) { if (!t) return ""; if (typeof t === "string") return t; if (t instanceof Blob) { const u = URL.createObjectURL(t); thumbUrls.push(u); return u; } return ""; }

async function draw() {
  thumbUrls.splice(0).forEach(u => URL.revokeObjectURL(u));
  const ps = await listProjects();
  $("list").innerHTML = ps.length ? ps.map(p => `<div class="pj" data-id="${esc(p.id)}">
    ${thumbSrc(p.thumb) ? `<img class="th" alt="" src="${esc(thumbSrc(p.thumb))}">` : `<div class="th"></div>`}
    <div class="info"><b class="nm">${esc(p.name || "Untitled")}</b><div class="muted small">${esc(toolName(p.tool))} · changed ${esc(ago(p.updated))}</div></div>
    <span class="row"><a class="btn" href="../${encodeURIComponent(p.tool || "")}/?project=${encodeURIComponent(p.id)}">Open</a>
    <button class="ghost" data-a="ren">Rename</button><button class="ghost" data-a="del">Delete</button></span></div>`).join("")
    : `<p class="muted">No saved projects yet. Tools that can save work will show their projects here.</p>`;
}
$("list").addEventListener("click", async e => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const row = b.closest(".pj"), id = row.dataset.id, p = await getProject(id); if (!p) return draw();
  if (b.dataset.a === "del") { if (confirm(`Delete "${p.name || "Untitled"}"? This cannot be undone.`)) { await deleteProject(id); msg("Project deleted."); draw(); } return; }
  const info = row.querySelector(".info"), inp = Object.assign(document.createElement("input"), { value: p.name || "" });
  inp.setAttribute("aria-label", "New name"); info.querySelector(".nm").replaceWith(inp); inp.select();
  let done = false;
  const finish = async ok => { if (done) return; done = true; const v = inp.value.trim(); if (ok && v && v !== p.name) await saveProject({ ...p, name: v }); draw(); };
  inp.onkeydown = ev => { if (ev.key === "Enter") finish(true); if (ev.key === "Escape") finish(false); };
  inp.onblur = () => finish(true);
});

// Blobs (images, files) are stored as data URLs so the export is one plain JSON file.
const blobToData = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function pack(v) {
  if (v instanceof Blob) return { __blob: await blobToData(v), type: v.type };
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return { __blob: await blobToData(new Blob([v])), type: "", buffer: true };
  if (Array.isArray(v)) return Promise.all(v.map(pack));
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = await pack(v[k]); return o; }
  return v;
}
async function unpack(v) {
  if (v && typeof v === "object" && typeof v.__blob === "string") { const b = await (await fetch(v.__blob)).blob(); return v.buffer ? await b.arrayBuffer() : (v.type ? new Blob([b], { type: v.type }) : b); }
  if (Array.isArray(v)) return Promise.all(v.map(unpack));
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = await unpack(v[k]); return o; }
  return v;
}
$("exp").onclick = async () => {
  const ps = await listProjects(); if (!ps.length) return msg("Nothing to export yet.", "");
  download(`hueforge-projects-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "hueforge-tools", kind: "projects", version: 1, projects: await pack(ps) }), "application/json");
  msg(`Exported ${ps.length} project${ps.length > 1 ? "s" : ""}.`);
};
const zone = document.createElement("div"); zone.hidden = true; document.body.append(zone);
dropZone(zone, { accept: ".json,application/json", onFiles: async ([f]) => {
  try {
    const j = JSON.parse(await f.text()), arr = Array.isArray(j) ? j : j.projects;
    if (!Array.isArray(arr)) throw new Error("no project list in the file");
    const have = new Set((await listProjects()).map(p => p.id)); let n = 0, re = 0;
    for (const raw of arr) {
      if (!raw || typeof raw !== "object" || !raw.tool) continue;
      const p = await unpack(raw), keep = p.updated;
      if (have.has(p.id)) re++;
      await saveProject(p); if (keep) await updateTime(p.id, keep); n++;
    }
    msg(`Imported ${n} project${n === 1 ? "" : "s"}${re ? ` (${re} replaced an existing one with the same id)` : ""}.`); draw();
  } catch (err) { msg(`Could not import ${esc(f.name)}: ${esc(err.message)}`, "bad"); }
} });
// saveProject always stamps "now"; keep the original change time on import
function updateTime(id, t) {
  return new Promise((res, rej) => { const r = indexedDB.open("hft-projects", 1); r.onsuccess = () => { const tx = r.result.transaction("p", "readwrite"), s = tx.objectStore("p"); const g = s.get(id); g.onsuccess = () => { if (g.result) s.put({ ...g.result, updated: t }); }; tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; r.onerror = () => rej(r.error); });
}
$("imp").onclick = () => zone.click();
draw();
