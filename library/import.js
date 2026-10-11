// Parse filament files: this site's JSON, CSV (name,brand,hex,td), or a HueForge library JSON (format guessed).
export function normHex(v) {
  if (v == null) return null;
  if (typeof v === "number") return "#" + (v & 0xffffff).toString(16).padStart(6, "0").toUpperCase();
  if (Array.isArray(v) && v.length >= 3) { const s = v.slice(0, 3).map(Number); const m = s.every(x => x <= 1) ? 255 : 1; return "#" + s.map(x => Math.round(x * m).toString(16).padStart(2, "0")).join("").toUpperCase(); }
  let s = String(v).trim().replace(/^0x/i, "").replace("#", "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map(c => c + c).join("");
  if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6); // RRGGBBAA
  return /^[0-9a-f]{6}$/i.test(s) ? "#" + s.toUpperCase() : null;
}
const pick = (o, names) => { const keys = Object.keys(o); for (const n of names) { const k = keys.find(k => k.toLowerCase().replace(/[\s_-]/g, "") === n); if (k != null && o[k] !== "" && o[k] != null) return o[k]; } };
export function mapEntry(o) {
  const name = pick(o, ["name", "filamentname", "colorname", "colourname", "title"]);
  const brand = pick(o, ["brand", "manufacturer", "vendor", "maker", "make"]);
  const type = pick(o, ["type", "material"]);
  const hex = normHex(pick(o, ["hex", "color", "colour", "hexcolor", "colorhex", "hexcode", "rgb"]));
  const tdRaw = pick(o, ["td", "transmissivity", "transmissiondistance", "transmission", "tdvalue"]);
  const td = parseFloat(tdRaw);
  if (!hex) return null;
  return { name: String(name ?? hex), brand: [brand, type].filter(Boolean).join(" ") || "", hex, td: isFinite(td) && td > 0 ? +td.toFixed(2) : 1 };
}
function findList(j) {
  if (Array.isArray(j)) return j;
  if (j && typeof j === "object") {
    for (const k of Object.keys(j)) if (/filament|librar|items|list|data/i.test(k) && Array.isArray(j[k])) return j[k];
    for (const v of Object.values(j)) if (Array.isArray(v) && v.length && typeof v[0] === "object") return v;
    for (const v of Object.values(j)) { const r = v && typeof v === "object" ? findList(v) : null; if (r) return r; }
  }
  return null;
}
export function parseCSV(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim()).map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0, -1).map(c => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()));
  if (!rows.length) return [];
  let head = rows[0].map(h => h.toLowerCase());
  let body = rows.slice(1);
  if (!head.some(h => /name|hex|td|brand|colou?r/.test(h))) { head = ["name", "brand", "hex", "td"]; body = rows; }
  return body.map(r => mapEntry(Object.fromEntries(head.map((h, i) => [h, r[i]])))).filter(Boolean);
}
// returns {list, kind, skipped}
export function parseFilamentFile(name, text) {
  if (/\.csv$/i.test(name) || !/^\s*[[{]/.test(text)) { const list = parseCSV(text); return { list, kind: "CSV", skipped: 0 }; }
  const j = JSON.parse(text);
  const arr = findList(j) || [];
  const native = arr.length && arr.every(o => o && typeof o.hex === "string" && "td" in o && "name" in o);
  const list = arr.map(o => o && typeof o === "object" ? mapEntry(o) : null);
  return { list: list.filter(Boolean), kind: native ? "HueForge Tools JSON" : "other JSON (HueForge format guessed)", skipped: list.filter(x => !x).length };
}
