// Headless check of Image Prep, Palette Match, Compass. Serve the site root, then: node tests/prep_match_compass_browser_test.mjs <port>
import { chromium } from "/Users/kai/Documents/Work/Career/career-ops/node_modules/playwright-core/index.mjs";
import zlib from "node:zlib"; import fs from "node:fs"; import path from "node:path";
const port = process.argv[2] || 8765, base = `http://127.0.0.1:${port}`, dir = path.dirname(new URL(import.meta.url).pathname);
function png(w, h, f) {
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(f(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const v of b) c = t[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const logo = path.join(dir, "prep_logo_test.png");
fs.writeFileSync(logo, png(300, 240, (x, y) => Math.hypot(x - 110, y - 120) < 70 ? [214, 40, 40, 255] : (x > 190 && x < 260 && y > 60 && y < 180) ? [30, 91, 216, 255] : [250, 250, 250, 255]));
const photo = "/Users/kai/Daniel/hueforge/makerworld/work/fuji_crop.png";
const browser = await chromium.launch({ executablePath: "/Users/kai/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
const results = []; let bad = 0;
const check = (n, ok, extra = "") => { results.push(`${ok ? "ok  " : "FAIL"} ${n} ${extra}`); if (!ok) bad++; };
async function page(url, width = 1280, ctx) {
  ctx = ctx || await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage(); const errs = [];
  p.on("console", m => m.type() === "error" && errs.push(m.text())); p.on("pageerror", e => errs.push(e.message));
  await p.goto(base + url); return { p, errs, ctx };
}
const colours = p => p.evaluate(() => { const c = document.getElementById("cv"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, s = new Set(); for (let i = 0; i < d.length; i += 4 * 97) s.add(d.slice(i, i + 4).join()); return s.size; });
async function dl(p, sel) { const [d] = await Promise.all([p.waitForEvent("download"), p.click(sel)]); return fs.statSync(await d.path()).size; }

{ const { p, errs, ctx } = await page("/image-prep/");
  await p.setInputFiles("#drop input", logo); await p.waitForSelector("#tools", { state: "visible" });
  await p.click("[data-t=up]"); await p.click("#apply"); await p.waitForFunction(() => document.getElementById("cv").width === 600); check("prep upscale 2x", true, "300 -> 600 px");
  await p.click("[data-t=crop]"); await p.selectOption("#cropA", "1"); await p.waitForTimeout(300);
  const b = await p.locator("#cbox").boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.mouse.move(b.x + b.width / 2 - 40, b.y + b.height / 2, { steps: 4 }); await p.mouse.up();
  await p.click("#apply"); await p.waitForTimeout(300); const cw = await p.evaluate(() => [cv.width, cv.height]); check("prep crop 1:1", cw[0] === cw[1], cw.join("x"));
  await p.click("[data-t=bg]"); await p.waitForTimeout(800); await p.click("#apply"); await p.waitForTimeout(500);
  const alpha = await p.evaluate(() => cv.getContext("2d").getImageData(0, 0, 1, 1).data[3]); check("prep auto background, corner transparent", alpha === 0, "alpha " + alpha);
  await p.click("[data-t=post]"); await p.fill("#poN", "3"); await p.dispatchEvent("#poN", "input"); await p.waitForTimeout(1200); await p.click("#apply"); await p.waitForTimeout(500);
  const n = await colours(p); check("prep posterize 3 bands", n >= 2 && n <= 5, n + " RGBA values sampled");
  await p.click("#undo"); await p.waitForTimeout(300); check("prep undo", (await p.textContent("#hist")).startsWith("3"));
  check("prep export PNG", (await dl(p, "#exp")) > 100);
  await p.click("#save"); await p.waitForTimeout(500); const url = p.url(); check("prep save project", url.includes("?project="), url);
  await p.setInputFiles("#drop input", photo); await p.waitForTimeout(800); await p.click("[data-t=bg]"); await p.selectOption("#bgM", "pick"); await p.click("#cv", { position: { x: 5, y: 5 } }); await p.waitForTimeout(1500);
  check("prep click-pick colour", (await p.textContent("#bgInfo")).includes("Picked"));
  await p.click("[data-t=post]"); await p.selectOption("#poM", "colour"); await p.waitForTimeout(3000);
  await p.screenshot({ path: path.join(dir, "shots/image-prep.png"), fullPage: true });
  const r = await page(url.replace(base, ""), 1280, ctx); await r.p.waitForTimeout(1500);
  check("prep restore ?project", await r.p.isVisible("#tools") && await r.p.evaluate(() => cv.width) === 480);
  check("prep no console errors", !errs.length && !r.errs.length, [...errs, ...r.errs].join(" | ")); await ctx.close(); }

{ const { p, errs, ctx } = await page("/palette-match/");
  await p.setInputFiles("#drop input", photo); await p.waitForFunction(() => document.querySelectorAll("#tbl tbody tr").length > 0, null, { timeout: 20000 });
  check("match recolour", true, await p.textContent("#fit"));
  await p.check("#dith"); await p.waitForTimeout(1500); check("match dither", (await p.textContent("#fit")).includes("deltaE"), await p.textContent("#fit"));
  await p.fill("#n", "3"); await p.click("#sug"); await p.waitForTimeout(3000);
  const rows = await p.locator("#tbl tbody tr").count(); check("match suggest 3", rows === 3, rows + " rows: " + (await p.locator("#tbl tbody").innerText()).replace(/\s+/g, " "));
  check("match export PNG", (await dl(p, "#exp")) > 100);
  await p.click("#save"); await p.waitForTimeout(500); const url = p.url(); check("match save project", url.includes("?project="));
  await p.screenshot({ path: path.join(dir, "shots/palette-match.png"), fullPage: true });
  const r = await page(url.replace(base, ""), 1280, ctx); await r.p.waitForTimeout(4000); check("match restore ?project", await r.p.locator("#tbl tbody tr").count() === 3);
  check("match no console errors", !errs.length && !r.errs.length, [...errs, ...r.errs].join(" | ")); await ctx.close(); }

for (const [img, tag] of [[logo, "logo"], [photo, "photo"]]) {
  const { p, errs, ctx } = await page("/compass/");
  await p.setInputFiles("#drop input", img); await p.waitForSelector("#out .card", { timeout: 20000 });
  check(`compass ${tag} advice`, true, "mode: " + await p.textContent("#out b") + " | filaments: " + (await p.locator("#out tbody").innerText()).replace(/\s+/g, " "));
  await p.click("#save"); await p.waitForTimeout(500); const url = p.url();
  await p.screenshot({ path: path.join(dir, `shots/compass-${tag}.png`), fullPage: true });
  const r = await page(url.replace(base, ""), 1280, ctx); await r.p.waitForTimeout(2000); check(`compass ${tag} restore ?project`, await r.p.isVisible("#out .card"));
  check(`compass ${tag} no console errors`, !errs.length && !r.errs.length, [...errs, ...r.errs].join(" | ")); await ctx.close();
}
for (const t of ["image-prep", "palette-match", "compass"]) {
  const { p, errs, ctx } = await page(`/${t}/`, 375); await p.setInputFiles("#drop input", photo); await p.waitForTimeout(3000);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check(`${t} phone 375px, no sideways scroll`, over <= 0, "overflow " + over);
  await p.screenshot({ path: path.join(dir, `shots/${t}-phone.png`), fullPage: true }); check(`${t} phone no errors`, !errs.length, errs.join(" | ")); await ctx.close();
}
await browser.close(); console.log(results.join("\n")); console.log(bad ? `${bad} FAILED` : "all ok"); process.exit(bad ? 1 : 0);
