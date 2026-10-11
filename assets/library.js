// Shared filament library (every tool reads it). Stored in this browser only (localStorage).
const KEY = "hft.filaments.v1";
export const DEFAULTS = [
  { id: "f1", name: "Black", brand: "Generic PLA", hex: "#111111", td: 0.6 },
  { id: "f2", name: "White", brand: "Generic PLA", hex: "#F4F4F0", td: 5.0 },
  { id: "f3", name: "Gray", brand: "Generic PLA", hex: "#8A8D91", td: 1.8 },
  { id: "f4", name: "Red", brand: "Generic PLA", hex: "#D62828", td: 2.0 },
  { id: "f5", name: "Yellow", brand: "Generic PLA", hex: "#F7C600", td: 4.5 },
  { id: "f6", name: "Blue", brand: "Generic PLA", hex: "#1E5BD8", td: 1.5 },
  { id: "f7", name: "Cyan", brand: "Generic PLA", hex: "#3FB7E8", td: 3.0 },
  { id: "f8", name: "Brown", brand: "Generic PLA", hex: "#5A3A22", td: 1.0 },
];
function read() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : null; } catch { return null; } }
export function getFilaments() { return read() || DEFAULTS.map(f => ({ ...f })); }
export function saveFilaments(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} window.dispatchEvent(new Event("hft-library")); }
export function addFilament(f) { const l = getFilaments(); l.push({ id: "f" + Date.now().toString(36), ...f }); saveFilaments(l); return l; }
export function updateFilament(id, patch) { saveFilaments(getFilaments().map(f => f.id === id ? { ...f, ...patch } : f)); }
export function removeFilament(id) { saveFilaments(getFilaments().filter(f => f.id !== id)); }
export function onLibraryChange(cb) { window.addEventListener("hft-library", cb); window.addEventListener("storage", e => { if (e.key === KEY) cb(); }); }
export function hexToRgb(h) { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
export function rgbToHex([r, g, b]) { return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase(); }
// a <select>-style picker: returns chosen filament ids
export function filamentChecklist(el, { selected = [], max = 99, onChange } = {}) {
  const draw = () => {
    const sel = new Set(selected);
    el.innerHTML = getFilaments().map(f => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0;color:var(--text)">
      <input type="checkbox" value="${f.id}" ${sel.has(f.id) ? "checked" : ""}><span class="swatch" style="background:${f.hex}"></span>
      ${f.name} <span class="muted small">${f.brand} · TD ${f.td}</span></label>`).join("") + `<a class="small" href="../library/">Edit library →</a>`;
    el.querySelectorAll("input").forEach(i => i.onchange = () => {
      selected = [...el.querySelectorAll("input:checked")].map(x => x.value).slice(0, max); onChange && onChange(selected);
    });
  };
  draw(); onLibraryChange(draw);
  return { get: () => selected };
}
