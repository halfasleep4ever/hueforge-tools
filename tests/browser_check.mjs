// Headless check of the three 3D tools. Usage: node tests/browser_check.mjs <port> [playwright-core path]
import fs from "fs";
const port = process.argv[2] || 8765, PW = process.argv[3] || "/Users/kai/Documents/Work/Career/career-ops/node_modules/playwright-core/index.mjs";
const { chromium } = await import(PW);
const exe = "/Users/kai/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const SHOTS = new URL("./shots/", import.meta.url).pathname, base = `http://localhost:${port}`;
const REAL3MF = process.env.HFT_3MF || "/Users/kai/Daniel/hueforge/makerworld/ready/04_im_snoozin_it/im_snoozin_it_colormatch.3mf";
const PNG = process.env.HFT_PNG || "/Users/kai/Daniel/hueforge/makerworld/ready/04_im_snoozin_it/source_flat.png";
const out = []; let bad = 0;
async function page(path, width, fn) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 }, acceptDownloads: true });
  const p = await ctx.newPage(), errs = [];
  p.on("console", m => { if (m.type() === "error") errs.push(m.text()); }); p.on("pageerror", e => errs.push(String(e)));
  await p.goto(base + path, { waitUntil: "load" });
  const note = await fn(p);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (errs.length || sw > 0) bad++;
  out.push(`${path} @${width}px: ${errs.length ? "ERRORS " + errs.join(" | ") : "no console errors"}; horizontal overflow ${sw}px; ${note || ""}`);
  await ctx.close();
}
const dl = async (p, sel) => { const [d] = await Promise.all([p.waitForEvent("download"), p.click(sel)]); const f = SHOTS + "dl_" + d.suggestedFilename(); await d.saveAs(f); return `${d.suggestedFilename()} ${fs.statSync(f).size} B`; };
for (const w of [1280, 390]) {
  await page("/frame-studio/", w, async p => {
    await p.waitForFunction(() => /Opening you see/.test(document.getElementById("stats").textContent), null, { timeout: 60000 });
    await p.fill("#w", "120"); await p.check("#hanger"); await p.check("#tabs"); await p.fill("#border", "15");
    await p.waitForTimeout(800); await p.waitForTimeout(800);
    await p.screenshot({ path: SHOTS + `frame_${w}.png`, fullPage: w < 600 });
    const s = await p.textContent("#stats"); return s.replace(/\s+/g, " ") + " | " + (w > 600 ? await dl(p, "#dl") : "");
  });
  await page("/puzzle-studio/", w, async p => {
    await p.setInputFiles("#drop input[type=file]", REAL3MF);
    await p.waitForFunction(() => /Ready/.test(document.getElementById("stats").textContent), null, { timeout: 120000 });
    await p.click("#cut");
    await p.waitForFunction(() => /pieces of about/.test(document.getElementById("stats").textContent), null, { timeout: 180000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: SHOTS + `puzzle_${w}.png`, fullPage: w < 600 });
    const s = (await p.textContent("#file")) + " | " + (await p.textContent("#stats")) + " | " + (await p.textContent("#warn"));
    return s.replace(/\s+/g, " ") + " | " + (w > 600 ? (await dl(p, "#dl3mf")) + ", " + (await dl(p, "#dlzip")) : "");
  });
  for (const [img, tag] of [[PNG, "png"], [new URL("./fixtures/logo.svg", import.meta.url).pathname, "svg"]]) {
    if (w < 600 && tag === "svg") continue;
    await page("/logo-chain-studio/", w, async p => {
      await p.setInputFiles("#drop input[type=file]", img);
      await p.waitForFunction(() => /Chain/.test(document.getElementById("stats").textContent), null, { timeout: 120000 });
      await p.waitForTimeout(1500);
      await p.screenshot({ path: SHOTS + `chain_${tag}_${w}.png`, fullPage: w < 600 });
      const s = (await p.textContent("#stats")) + " | " + (await p.textContent("#warn"));
      return s.replace(/\s+/g, " ") + " | " + (w > 600 ? (await dl(p, "#dl3mf")) + ", " + (await dl(p, "#dlstl")) : "");
    });
  }
}
await browser.close(); console.log(out.join("\n")); process.exit(bad ? 1 : 0);
