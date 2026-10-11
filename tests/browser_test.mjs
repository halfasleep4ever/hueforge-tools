// node tests/browser_test.mjs <port>   (serve the site root first: python3 -m http.server <port>)
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/kai/Documents/Work/Career/career-ops/node_modules/playwright-core");
const PORT = process.argv[2] || 8765, BASE = `http://localhost:${PORT}`, SHOTS = new URL("./shots/", import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(SHOTS + "../tmp", { recursive: true });
const browser = await chromium.launch({ executablePath: "/Users/kai/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const errors = [], results = [];
const ok = (name, cond, extra = "") => { results.push([name, !!cond]); console.log(cond ? "ok  " : "FAIL", name, extra); };
async function page(path, vw = 1200) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("console", m => { if (m.type() === "error") errors.push(`${path}: ${m.text()}`); });
  p.on("pageerror", e => errors.push(`${path}: ${e.message}`));
  p.on("dialog", d => d.accept());
  await p.goto(BASE + path); await p.waitForLoadState("networkidle"); return p;
}
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

// ---------- library
{
  const p = await page("/library/");
  ok("library: 8 defaults", (await p.locator("#tb tr").count()) === 8);
  await p.click("#add");
  ok("library: add", (await p.locator("#tb tr").count()) === 9);
  const last = p.locator("#tb tr").last();
  await last.locator("[data-k=name]").fill("Test Silk Green");
  await last.locator("[data-k=hex]").fill("#22aa44");
  await last.locator("[data-k=td]").fill("3.3");
  await p.reload(); await p.waitForLoadState("networkidle");
  const lib = await p.evaluate(() => JSON.parse(localStorage.getItem("hft.filaments.v1")));
  const g = lib.find(f => f.name === "Test Silk Green");
  ok("library: inline edit persists", g && g.hex === "#22AA44" && g.td === 3.3, JSON.stringify(g));
  await p.locator("#tb tr").last().locator("[data-a=up]").click();
  ok("library: reorder up", (await p.evaluate(() => JSON.parse(localStorage.getItem("hft.filaments.v1"))[7].name)) === "Test Silk Green");
  await p.click("#sort");
  const order = await p.evaluate(() => JSON.parse(localStorage.getItem("hft.filaments.v1")).map(f => f.name));
  ok("library: sort by luminance", order[0] === "Black" && order.at(-1) === "White", order.join(","));
  await p.locator("#tb tr", { hasText: "" }).filter({ has: p.locator("input[value='Test Silk Green']") }).locator("[data-a=del]").click();
  ok("library: delete", (await p.locator("#tb tr").count()) === 8);
  // imports
  const tmp = SHOTS + "../tmp/"; fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(tmp + "a.csv", "name,brand,hex,td\nMint,Polymaker,#9fe2bf,4.1\n\"Deep, Purple\",Elegoo,5a2a82,1.2\n");
  fs.writeFileSync(tmp + "hf.json", JSON.stringify({ Filaments: [{ Brand: "Bambu", Name: "Jade White", Type: "PLA Basic", Color: "#FFFFFF", Transmissivity: 5.5 }, { Brand: "Bambu", Name: "Orange", Color: "FF6A13", Transmissivity: "2.1" }, { Name: "no colour" }] }));
  const imp = async f => { const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#imp")]); await fc.setFiles(f); await p.waitForTimeout(300); };
  await imp(tmp + "a.csv");
  ok("library: CSV import (quoted comma, no #)", (await p.locator("#tb tr").count()) === 10 && (await p.locator("input[value='Deep, Purple']").count()) === 1);
  await imp(tmp + "hf.json");
  const m = await p.textContent("#msg");
  ok("library: HueForge-guess import + note", (await p.locator("#tb tr").count()) === 12 && /guessed/.test(m) && /Skipped 1/.test(m), m);
  await p.screenshot({ path: SHOTS + "library.png", fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]);
  const exp = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  ok("library: export JSON", exp.length === 12);
  await p.check("#replace"); fs.writeFileSync(tmp + "exp.json", JSON.stringify(exp.slice(0, 3)));
  await imp(tmp + "exp.json");
  ok("library: native JSON import replace", (await p.locator("#tb tr").count()) === 3 && /HueForge Tools JSON/.test(await p.textContent("#msg")));
  await p.click("#reset");
  ok("library: reset", (await p.locator("#tb tr").count()) === 8);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  ok("library: phone no h-scroll", await noHScroll(p));
  await p.screenshot({ path: SHOTS + "library-phone.png", fullPage: true });
  await p.context().close();
}
// ---------- projects
{
  const p = await page("/projects/");
  ok("projects: empty state", /No saved projects/.test(await p.textContent("#list")));
  await p.screenshot({ path: SHOTS + "projects-empty.png" });
  await p.evaluate(async () => {
    const m = await import("/assets/projects.js");
    const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }), g = c.getContext("2d"); g.fillStyle = "#e33"; g.fillRect(0, 0, 64, 64);
    const blob = await new Promise(r => c.toBlob(r));
    await m.saveProject({ id: "ptest1", tool: "palette-match", name: "Cat portrait", data: { colors: ["#111", "#fff"], src: blob }, thumb: c.toDataURL() });
    await m.saveProject({ id: "ptest2", tool: "frame-studio", name: "Frame 20x20", data: { w: 200 } });
  });
  await p.reload(); await p.waitForLoadState("networkidle");
  ok("projects: lists 2", (await p.locator(".pj").count()) === 2);
  ok("projects: open link", (await p.locator(".pj", { hasText: "Cat portrait" }).locator("a").getAttribute("href")) === "../palette-match/?project=ptest1");
  ok("projects: thumb shown", (await p.locator(".pj img.th").count()) === 1);
  await p.locator(".pj", { hasText: "Frame 20x20" }).locator("[data-a=ren]").click();
  await p.locator(".pj input").fill("Frame renamed"); await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  ok("projects: rename", (await p.locator(".pj", { hasText: "Frame renamed" }).count()) === 1);
  await p.screenshot({ path: SHOTS + "projects.png", fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#exp")]);
  const txt = fs.readFileSync(await dl.path(), "utf8"), j = JSON.parse(txt);
  ok("projects: export has data URL for blob", j.projects.length === 2 && /^data:image\/png;base64/.test(j.projects.find(x => x.id === "ptest1").data.src.__blob));
  await p.locator(".pj", { hasText: "Cat portrait" }).locator("[data-a=del]").click(); await p.waitForTimeout(300);
  await p.locator(".pj", { hasText: "Frame renamed" }).locator("[data-a=del]").click(); await p.waitForTimeout(300);
  ok("projects: delete", (await p.locator(".pj").count()) === 0);
  const f = SHOTS + "../tmp/projects.json"; fs.writeFileSync(f, txt);
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#imp")]); await fc.setFiles(f); await p.waitForTimeout(600);
  const back = await p.evaluate(async () => { const m = await import("/assets/projects.js"); const x = await m.getProject("ptest1"); return { isBlob: x.data.src instanceof Blob, type: x.data.src.type, n: (await m.listProjects()).length }; });
  ok("projects: import restores blobs", (await p.locator(".pj").count()) === 2 && back.isBlob && back.type === "image/png", JSON.stringify(back));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  ok("projects: phone no h-scroll", await noHScroll(p));
  await p.screenshot({ path: SHOTS + "projects-phone.png", fullPage: true });
  await p.evaluate(async () => { const m = await import("/assets/projects.js"); await m.deleteProject("ptest1"); await m.deleteProject("ptest2"); });
  await p.context().close();
}
// ---------- td meter
{
  const p = await page("/td-meter/");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#stl")]);
  const stl = fs.readFileSync(await dl.path());
  ok("td: STL download", stl.length === 84 + 50 * stl.readUInt32LE(80) && stl.readUInt32LE(80) > 100, `${stl.readUInt32LE(80)} triangles, ${dl.suggestedFilename()}`);
  // synthetic photo: card on a bright backlight, T = exp(-k t) in linear light, plus noise; k chosen so TD = 2.4
  const TD = 2.4, k = Math.log(1 / 0.03) / TD;
  const png = await p.evaluate(async ({ k }) => {
    const { cardLayout, fromLinear } = await import("/td-meter/td.js");
    const L = cardLayout(), s = 10, c = Object.assign(document.createElement("canvas"), { width: 1200, height: 600 }), g = c.getContext("2d");
    const I0 = 0.85; g.fillStyle = `rgb(${[fromLinear(I0)].map(Math.round).join()},${Math.round(fromLinear(I0))},${Math.round(fromLinear(I0))})`; g.fillRect(0, 0, 1200, 600);
    const ox = 105, oy = 170;
    for (let i = 0; i < L.H.length; i++) for (let j = 0; j < L.H[i].length; j++) {
      const h = L.H[i][j]; if (!h) continue; const v = Math.round(fromLinear(I0 * Math.exp(-k * h)));
      g.fillStyle = `rgb(${v},${Math.round(v * 0.95)},${Math.round(v * 0.9)})`; g.fillRect(ox + L.xs[i] * s, oy + L.ys[j] * s, (L.xs[i + 1] - L.xs[i]) * s + 1, (L.ys[j + 1] - L.ys[j]) * s + 1);
    }
    const d = g.getImageData(0, 0, 1200, 600); let seed = 3; for (let q = 0; q < d.data.length; q += 4) for (let ch = 0; ch < 3; ch++) { seed = (seed * 16807) % 2147483647; d.data[q + ch] = Math.max(0, Math.min(255, d.data[q + ch] + (seed % 7) - 3)); }
    g.putImageData(d, 0, 0);
    const cx = i => ox + (L.xs[i] + L.xs[i + 1]) / 2 * s, cy = oy + (L.ys[1] + L.ys[2]) / 2 * s;
    return { url: c.toDataURL("image/png"), pts: [1, ...L.thickness.map((_, q) => 3 + q)].map(i => [cx(i), cy]) };
  }, { k });
  const f = SHOTS + "../tmp/synthetic_card.png"; fs.writeFileSync(f, Buffer.from(png.url.split(",")[1], "base64"));
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.click("#drop")]); await fc.setFiles(f); await p.waitForTimeout(400);
  const toScreen = async ([x, y]) => { const b = await p.locator("#photo").boundingBox(); return [b.x + x * b.width / 1200, b.y + y * b.height / 600]; };
  for (const pt of png.pts) { const [x, y] = await toScreen(pt); await p.mouse.click(x, y); }
  const td1 = parseFloat((await p.textContent("#res")).match(/TD ≈ ([\d.]+)/)?.[1]);
  ok("td: click flow recovers TD 2.4", Math.abs(td1 - TD) < 0.15, `got ${td1}`);
  await p.screenshot({ path: SHOTS + "td-meter-clicks.png", fullPage: true });
  await p.click("#clear");
  const [a, b] = [await toScreen(png.pts[0]), await toScreen(png.pts[8])];
  await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move((a[0] + b[0]) / 2, a[1], { steps: 5 }); await p.mouse.move(...b, { steps: 5 }); await p.mouse.up();
  const td2 = parseFloat((await p.textContent("#res")).match(/TD ≈ ([\d.]+)/)?.[1]);
  ok("td: line-drag flow recovers TD 2.4", Math.abs(td2 - TD) < 0.15, `got ${td2}`);
  await p.selectOption("#fil", "f4"); await p.click("#save");
  const red = await p.evaluate(() => JSON.parse(localStorage.getItem("hft.filaments.v1")).find(f => f.id === "f4").td);
  ok("td: save to library", red === td2, `Red TD now ${red}`);
  await p.screenshot({ path: SHOTS + "td-meter-line.png", fullPage: true });
  // manual mode
  await p.click("[data-m=manual]");
  const vals = [1000, ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => 1000 * Math.exp(-k * 0.08 * n))];
  for (let i = 0; i < 9; i++) await p.fill(`#v${i}`, vals[i].toFixed(1));
  await p.click("#calc");
  const td3 = parseFloat((await p.textContent("#res")).match(/TD ≈ ([\d.]+)/)?.[1]);
  ok("td: manual mode", Math.abs(td3 - TD) < 0.02, `got ${td3}`);
  await p.screenshot({ path: SHOTS + "td-meter-manual.png", fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  ok("td: phone no h-scroll", await noHScroll(p));
  await p.screenshot({ path: SHOTS + "td-meter-phone.png", fullPage: true });
  await p.context().close();
}
// home page links resolve
{ const p = await page("/"); for (const s of ["library", "projects", "td-meter"]) { const r = await p.request.get(`${BASE}/${s}/`); ok(`home link /${s}/ 200`, r.status() === 200); } await p.context().close(); }
await browser.close();
fs.rmSync(SHOTS + "../tmp", { recursive: true, force: true });
ok("no console errors", errors.length === 0, errors.join("\n"));
const fails = results.filter(r => !r[1]).length;
console.log(`\n${results.length - fails}/${results.length} passed`); process.exit(fails ? 1 : 0);
