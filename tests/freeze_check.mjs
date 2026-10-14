// Measures how long the page is frozen while Puzzle Studio cuts a big puzzle, and screenshots the
// Logo Chain 3D view at phone width. Usage: node tests/freeze_check.mjs <port> [rows] [cols]
const port = process.argv[2] || 8795, rows = process.argv[3] || 8, cols = process.argv[4] || 8;
const { chromium } = await import("/Users/kai/Documents/Work/Career/career-ops/node_modules/playwright-core/index.mjs");
const exe = "/Users/kai/.cache/puppeteer/chrome-headless-shell/mac_arm-131.0.6778.204/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const browser = await chromium.launch({ executablePath: exe, args: process.env.GPU ? ["--use-angle=metal", "--enable-gpu"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const SHOTS = new URL("./shots/", import.meta.url).pathname, base = `http://localhost:${port}`;
const REAL3MF = process.env.HFT_3MF || "/Users/kai/Daniel/hueforge/makerworld/ready/04_im_snoozin_it/im_snoozin_it_colormatch.3mf";
const PNG = process.env.HFT_PNG || "/Users/kai/Daniel/hueforge/makerworld/ready/04_im_snoozin_it/source_flat.png";
const which = process.env.ONLY || "both";
if (which !== "chain") {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  p.on("pageerror", e => console.log("pageerror", e.message)); p.on("console", m => /SHOWMS/.test(m.text()) && console.log(m.text()));
  await p.goto(base + "/puzzle-studio/");
  await p.evaluate(() => { window.__long = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ type: "longtask", buffered: false }); });
  await p.setInputFiles("#drop input[type=file]", REAL3MF);
  await p.waitForFunction(() => /Ready/.test(document.getElementById("stats").textContent), null, { timeout: 120000 });
  const load = await p.evaluate(() => { const l = window.__long; window.__long = []; return l; });
  await p.fill("#rows", String(rows)); await p.fill("#cols", String(cols));
  const t0 = Date.now(); await p.click("#cut");
  await p.waitForFunction(() => /pieces of about/.test(document.getElementById("stats").textContent), null, { timeout: 300000 });
  await p.waitForTimeout(1000);
  const cut = await p.evaluate(() => window.__long);
  const f = a => `longest ${Math.max(0, ...a).toFixed(0)} ms, total ${a.reduce((s, x) => s + x, 0).toFixed(0)} ms in ${a.length} long tasks`;
  console.log(`load: ${f(load)}`); console.log(`cut ${rows}x${cols} (${((Date.now() - t0) / 1000).toFixed(1)} s): ${f(cut)}`);
  console.log((await p.textContent("#stats")).replace(/\s+/g, " "));
  await p.screenshot({ path: SHOTS + "freeze_puzzle.png" });
}
if (which !== "puzzle") for (const [w, h] of [[390, 844], [1280, 1000]]) {
  const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await p.goto(base + "/logo-chain-studio/");
  await p.setInputFiles("#drop input[type=file]", process.env.LOGO || PNG);
  await p.waitForFunction(() => /Chain/.test(document.getElementById("stats").textContent), null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  await (await p.$("#view")).screenshot({ path: SHOTS + `chainview_${w}.png` });
  console.log(`chain view ${w}px saved`);
}
await browser.close();
