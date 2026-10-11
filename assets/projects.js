// Saved work (IndexedDB, this browser only). A project = {id, tool, name, updated, data, thumb}
const DB = "hft-projects", STORE = "p";
function open() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function tx(mode, fn) { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out.result ?? out); t.onerror = () => rej(t.error); }); }
export async function saveProject(p) { p = { ...p, id: p.id || "p" + Date.now().toString(36), updated: Date.now() }; await tx("readwrite", s => s.put(p)); return p; }
export async function listProjects() { try { return (await tx("readonly", s => s.getAll())).sort((a, b) => b.updated - a.updated); } catch { return []; } }
export async function getProject(id) { try { return await tx("readonly", s => s.get(id)); } catch { return null; } }
export async function deleteProject(id) { await tx("readwrite", s => s.delete(id)); }
export function projectIdFromUrl() { return new URLSearchParams(location.search).get("project"); }
