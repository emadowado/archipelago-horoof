const { chromium } = require("playwright");
const BASE = process.env.BASE || "http://localhost:8080";
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const [label, vp] of [["mobile", { width: 390, height: 844 }], ["laptop", { width: 1366, height: 768 }]]) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: label === "mobile" ? 2 : 1 });
    await p.goto(BASE, { waitUntil: "networkidle" });
    await p.evaluate(async () => { await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "arch" }, body: JSON.stringify({ name: "1", pin: "11" }) }); });
    await p.goto(BASE, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await p.evaluate(() => {
      window.__lt = []; window.__fr = []; window.__run = true;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: false });
      let last = performance.now();
      const tick = (t) => { window.__fr.push(t - last); last = t; if (window.__run) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    // pan around for ~4s, then wheel-zoom in/out, then idle across a poll tick
    const cx = vp.width / 2, cy = vp.height / 3;
    await p.mouse.move(cx, cy); await p.mouse.down();
    for (let i = 0; i < 120; i++) { await p.mouse.move(cx + Math.sin(i / 10) * 140, cy + Math.cos(i / 13) * 120); }
    await p.mouse.up();
    for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, i < 20 ? 60 : -60); await p.waitForTimeout(16); }
    await p.waitForTimeout(9000);
    const r = await p.evaluate(() => { window.__run = false; const f = window.__fr.slice(5); const sorted = [...f].sort((a, b) => a - b);
      const avg = f.reduce((a, b) => a + b, 0) / f.length; return { frames: f.length, fps: Math.round(1000 / avg), p95ms: Math.round(sorted[Math.floor(f.length * 0.95)]), maxms: Math.round(sorted[f.length - 1]), over50: f.filter((x) => x > 50).length, longtasks: window.__lt }; });
    out[label] = r;
    await p.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
