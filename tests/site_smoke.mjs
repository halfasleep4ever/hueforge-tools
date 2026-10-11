// Load the hub and every tool page; report console errors and broken links. Usage: node tests/site_smoke.mjs <port>
import { chromium } from "/Users/kai/Documents/Work/Career/career-ops/node_modules/playwright-core/index.mjs";
const port = process.argv[2] || 8791, base = `http://localhost:${port}/`;
const b = await chromium.launch({ executablePath: process.env.CHROME }); const p = await b.newPage();
const errs = []; p.on("console", m => m.type() === "error" && errs.push(m.text())); p.on("pageerror", e => errs.push(e.message));
await p.goto(base); const links = await p.$$eval("a.tool", a => a.map(x => x.getAttribute("href")));
console.log("hub tools:", links.length);
let bad = 0;
for (const l of links) {
  errs.length = 0; const r = await p.goto(base + l); await p.waitForTimeout(1500);
  const h1 = await p.$eval("h1", e => e.textContent).catch(() => "(no h1)");
  const ok = r.status() === 200 && !errs.length; bad += !ok;
  console.log(`${ok ? "ok " : "BAD"} ${l.padEnd(22)} ${r.status()} ${h1.trim()} ${errs.join(" | ")}`);
}
await p.goto(base); await p.screenshot({ path: "tests/shots/hub.png", fullPage: true });
await b.close(); console.log(bad ? `${bad} pages with problems` : "all pages ok"); process.exit(bad ? 1 : 0);
