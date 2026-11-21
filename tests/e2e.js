/* End-to-end UI tests with Playwright (Chromium headless).
   Run: NODE_PATH=/workspace/arch-test/node_modules node tests/e2e.js */
"use strict";
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");

const ROOT = path.join(__dirname, "..");
const overlaps = require("./overlap.js");
const SHOTS = path.join(ROOT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "arch-e2e-"));
const PORT = 19000 + Math.floor(Math.random() * 900);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
let proc, passed = 0, failed = 0;
const results = [];
function ok(cond, name, extra = "") {
  if (cond) { passed++; results.push("✔ " + name); }
  else { failed++; results.push("✖ " + name + (extra ? " — " + extra : "")); }
}
const secrets = () => fs.readFileSync(path.join(DATA, "SECRETS.txt"), "utf8");

async function startServer() {
  if (process.env.BASE) return;
  await new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [path.join(ROOT, "server.js")], { env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => String(d).includes("يعمل") && resolve());
    proc.stderr.on("data", (d) => process.stderr.write(d));
    setTimeout(() => reject(new Error("server start timeout")), 8000);
  });
}

async function audit(page, label) {
  // horizontal overflow, RTL, tap targets, clipped text
  const r = await page.evaluate(() => {
    const out = { overflowX: document.documentElement.scrollWidth > innerWidth + 1, dir: document.documentElement.dir, small: [], clipped: [] };
    const vis = (el) => { const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && !el.closest("[hidden]") && !el.closest(".world"); };
    for (const el of document.querySelectorAll("button, a, input, select, label.btn")) {
      if (!vis(el)) continue;
      if (el.closest(".sheet:not(.is-open)")) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 40 || b.height < 40) out.small.push(`${el.tagName}.${el.className}#${el.id} ${Math.round(b.width)}x${Math.round(b.height)} "${(el.textContent || "").trim().slice(0, 20)}"`);
    }
    for (const el of document.querySelectorAll(".hud *, .sheet.is-open *, .topbar *, .adm *, .login-card *")) {
      if (!vis(el) || el.children.length) continue;
      const s = getComputedStyle(el);
      if (s.textOverflow === "ellipsis") continue;
      if (el.scrollWidth > el.clientWidth + 2 && s.overflow !== "visible" && el.clientWidth > 0) out.clipped.push(el.className + " " + el.textContent.trim().slice(0, 24));
    }
    return out;
  });
  ok(!r.overflowX, `${label}: no horizontal overflow`);
  ok(r.dir === "rtl", `${label}: RTL document`);
  ok(r.small.length === 0, `${label}: tap targets ≥ 40px`, r.small.join(" | "));
  ok(r.clipped.length === 0, `${label}: no clipped text`, r.clipped.join(" | "));
}

async function mapAudit(page, label) {
  await page.waitForTimeout(800);
  const o = await overlaps(page);
  const bad = o.filter((x) => (/× ship/.test(x) && +x.split(": ")[1] > 150) || +x.split(": ")[1] > 700);
  ok(bad.length === 0, `${label}: ships don't overlap each other / labels / whale`, bad.join(" | "));
}

async function run() {
  await startServer();
  const ADMIN_PASS = /كلمة المرور: (\S+)/.exec(secrets())[1];
  const browser = await chromium.launch();
  const errors = []; let expected401 = 0;
  const track = (p, tag) => {
    p.on("console", (m) => { if (m.type() !== "error") return; if (/status of 401/.test(m.text())) { expected401++; return; } errors.push(`${tag}: ${m.text()}`); });
    p.on("pageerror", (e) => errors.push(`${tag}: ${e}`));
    p.on("dialog", (d) => d.accept());
  };

  /* ═══ MOBILE (390x844) ═══ */
  const mob = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" };
  const pctx = await browser.newContext(mob);
  const p = await pctx.newPage(); track(p, "player-mobile");
  await p.goto(BASE); await p.waitForSelector("#view-login:not([hidden])"); await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(SHOTS, "final-login-mobile.png") });
  await audit(p, "login mobile");

  await p.fill("#login-name", "تجربة"); await p.fill("#login-pin", "1111"); await p.tap("#btn-login");
  await p.waitForFunction(() => document.querySelector("#login-error").textContent.length > 0);
  ok((await p.textContent("#login-error")).includes("غلط"), "wrong PIN shows Arabic error");

  await p.fill("#login-pin", "2027"); await p.tap("#btn-login");
  await p.waitForSelector("#view-game:not([hidden])"); await p.waitForTimeout(1500);
  ok(await p.isVisible("#hud-choose"), "player sees 'choose destination' button");
  ok((await p.locator(".ship.is-mine").count()) === 1, "own ship highlighted on map");
  ok((await p.locator(".ship.is-leader").count()) === 1, "exactly one leader ship (gold name)");
  ok((await p.locator(".island").count()) === 22, "22 islands rendered (7×3 + central)");
  const imgsOk = await p.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  ok(imgsOk.length === 0, "all images load", imgsOk.join(","));
  await p.screenshot({ path: path.join(SHOTS, "final-map-mobile.png") });
  await audit(p, "map mobile");
  await mapAudit(p, "map mobile");

  // pinch-free zoom via fit/me buttons, then pick a move by tapping island
  const sc0 = await p.evaluate(() => APP.view.scale);
  await p.tap("#zoom-me"); await p.waitForTimeout(700);
  ok((await p.evaluate(() => APP.view.scale)) > sc0, "'my ship' button zooms to own ship");
  await p.tap("#zoom-fit"); await p.waitForTimeout(700);
  await p.locator('.island[data-id="dawn"] img').tap(); await p.waitForSelector("#sheet.is-open"); await p.waitForTimeout(600);
  ok((await p.textContent("#sheet-body")).includes("شاطئ الفجر"), "island sheet opens on tap");
  await p.screenshot({ path: path.join(SHOTS, "final-island-mobile.png") });
  await audit(p, "island sheet mobile");
  await p.tap("#sail-go"); await p.waitForTimeout(900);
  ok(!(await p.isVisible("#sheet.is-open")), "sheet closes after choosing");
  ok((await p.textContent("#hud")).includes("شاطئ الفجر"), "HUD shows chosen destination");
  ok((await p.locator("#route-svg path").count()) === 1, "route line drawn to destination");
  // energy-insufficient island shows disabled button
  await p.tap("#zoom-fit"); await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('.island[data-id="mystery"]').click()); await p.waitForTimeout(500);
  ok(await p.locator("#sail-go").isDisabled(), "locked central island cannot be chosen");
  await p.tap("#sheet-close"); await p.waitForTimeout(400);

  // own ship sheet
  await p.evaluate(() => APP.openShip(APP.st.myTeam.id)); await p.waitForTimeout(900);
  ok((await p.textContent("#sheet-body")).includes("سجل طاقمكم"), "own ship sheet shows team log");
  ok((await p.locator("#sheet-body .big-ship .flag i").count()) >= 10, "big ship has waving flag strips");
  await p.screenshot({ path: path.join(SHOTS, "final-ship-mobile.png") });
  await audit(p, "ship sheet mobile");
  await p.tap("#sheet-close"); await p.waitForTimeout(400);

  // leaderboard
  await p.tap("#btn-board"); await p.waitForSelector(".board-row"); await p.waitForTimeout(900);
  const totals = await p.$$eval(".board-row .row-gold b", (els) => els.map((e) => e.textContent));
  ok(await p.locator(".board-row.is-first .rank img").count() === 1, "#1 row has golden anchor");
  ok(totals.length === 6, "leaderboard lists 6 teams");
  await p.screenshot({ path: path.join(SHOTS, "final-leaderboard-mobile.png") });
  await audit(p, "leaderboard mobile");
  await p.tap("#sheet-close"); await p.waitForTimeout(400);
  const goldBefore = await p.evaluate(() => APP.st.myTeam.total);

  /* ═══ ADMIN on mobile ═══ */
  const actx = await browser.newContext(mob);
  const a = await actx.newPage(); track(a, "admin-mobile");
  await a.goto(BASE); await a.waitForSelector("#view-login:not([hidden])");
  await a.fill("#login-name", "admin"); await a.fill("#login-pin", ADMIN_PASS); await a.tap("#btn-login");
  await a.waitForSelector(".adm-top"); await a.waitForTimeout(800);
  ok(await a.isVisible("#p-reveal"), "admin panel opens after admin login");
  await a.screenshot({ path: path.join(SHOTS, "final-admin-mobile.png") });
  await audit(a, "admin mobile (day tab)");
  // answers: demo team (t2) first correct
  await a.tap('.adm-tab[data-tab="answers"]'); await a.waitForTimeout(300);
  await a.tap('.seg[data-team="t2"] button[data-v="first"]');
  await a.tap('.seg[data-team="t1"] button[data-v="right"]');
  await a.screenshot({ path: path.join(SHOTS, "final-admin-answers-mobile.png") });
  await audit(a, "admin mobile (answers tab)");
  await a.tap("#res-apply"); await a.waitForTimeout(800);
  for (const tab of ["gold", "teams", "players", "log"]) {
    await a.tap(`.adm-tab[data-tab="${tab}"]`); await a.waitForTimeout(300);
    await audit(a, `admin mobile (${tab} tab)`);
    if (tab === "gold") await a.screenshot({ path: path.join(SHOTS, "final-admin-gold-mobile.png") });
  }
  // player gets +3000 and +5 energy live
  await p.waitForFunction((g) => APP.st.myTeam.total === g + 3000, goldBefore, { timeout: 12000 }).then(() => ok(true, "player sees +3,000 live after admin result")).catch(() => ok(false, "player sees +3,000 live after admin result"));

  // close + reveal
  await a.tap('.adm-tab[data-tab="day"]'); await a.waitForTimeout(300);
  await a.tap("#p-close"); await a.waitForTimeout(700);
  await p.waitForFunction(() => APP.st.phase === "closed", null, { timeout: 12000 }).then(() => ok(true, "player sees choosing closed")).catch(() => ok(false, "player sees choosing closed"));
  await a.tap("#p-reveal"); await a.waitForTimeout(800);
  ok(!(await a.isVisible("#view-admin")), "admin returns to map after reveal");
  await p.waitForFunction(() => APP.st.phase === "revealed" && APP.st.myTeam.island === "dawn", null, { timeout: 12000 }).then(() => ok(true, "player's ship moved to destination after reveal")).catch(() => ok(false, "player's ship moved after reveal"));
  await p.waitForTimeout(400);
  ok((await p.locator(".cinema-banner").count()) === 1 || (await p.locator(".ship.is-sailing").count()) > 0, "reveal plays banner / sailing animation");
  await p.waitForTimeout(3200);
  const shipAtDawn = await p.evaluate(() => { const el = document.querySelector(".ship.is-mine"); const isle = GAME.islandById("dawn"); return Math.hypot(parseFloat(el.style.left) - isle.x, parseFloat(el.style.top) - isle.y) < 190; });
  ok(shipAtDawn, "ship rests next to the new island after animation");
  const after = await p.evaluate(() => ({ total: APP.st.myTeam.total, energy: APP.st.myTeam.energy }));
  ok(after.total === goldBefore + 3000 + 2000, "first-visit reward +2,000 added (power island)", JSON.stringify(after));
  await p.tap("#btn-board"); await p.waitForTimeout(800);
  const boardTxt = await p.textContent(".board-row.is-mine .row-gold b");
  ok(boardTxt.replace(/\s/g, "").includes((goldBefore + 5000).toLocaleString("ar-SA")), "leaderboard updated with new total", boardTxt);
  await p.tap("#sheet-close"); await p.waitForTimeout(400);
  await mapAudit(p, "map after reveal mobile");
  await p.screenshot({ path: path.join(SHOTS, "final-map-after-reveal-mobile.png") });

  // whale draw in beginnings (player's region) → cinema card for everyone
  await a.evaluate(() => window.ADMIN.open()); await a.waitForSelector("#w-draw");
  await a.tap('[data-whale="beginnings"]'); await a.waitForTimeout(700);
  await a.tap("#w-draw"); await a.waitForTimeout(600);
  await p.waitForSelector(".cinema-card", { timeout: 12000 }).then(() => ok(true, "whale draw shows cinematic card to players")).catch(() => ok(false, "whale draw cinematic"));
  await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(SHOTS, "final-whale-mobile.png") });
  const wc = p.locator(".cinema-card button"); if (await wc.count()) await wc.tap();
  await p.waitForTimeout(500);

  // menu + logout
  await p.tap("#btn-menu"); await p.waitForSelector("#m-logout");
  await audit(p, "menu mobile");
  await p.tap("#m-logout"); await p.waitForSelector("#view-login:not([hidden])");
  ok(true, "logout returns to login screen");
  const meAfter = await p.evaluate(() => fetch("/api/state").then((r) => r.json()).then((d) => d.me));
  ok(meAfter === null, "session cleared after logout");

  // spectator mode
  await p.tap("#btn-spectate"); await p.waitForSelector("#view-game:not([hidden])"); await p.waitForTimeout(600);
  ok((await p.textContent("#hud")).includes("تتفرج"), "spectator mode works without login");

  /* ═══ LAPTOP (1440x900) ═══ */
  const lctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const l = await lctx.newPage(); track(l, "player-laptop");
  await l.goto(BASE); await l.waitForSelector("#view-login:not([hidden])"); await l.waitForTimeout(900);
  await l.screenshot({ path: path.join(SHOTS, "final-login-laptop.png") });
  await audit(l, "login laptop");
  await l.fill("#login-name", "تجربة"); await l.fill("#login-pin", "2027"); await l.click("#btn-login");
  await l.waitForSelector("#view-game:not([hidden])"); await l.waitForTimeout(1500);
  await l.screenshot({ path: path.join(SHOTS, "final-map-laptop.png") });
  await audit(l, "map laptop");
  await mapAudit(l, "map laptop");
  // wheel zoom and drag pan
  const s0 = await l.evaluate(() => APP.view.scale);
  await l.mouse.move(600, 450); await l.mouse.wheel(0, -400); await l.waitForTimeout(300);
  const s1 = await l.evaluate(() => APP.view.scale);
  ok(s1 > s0, "mouse wheel zooms in");
  const x0 = await l.evaluate(() => APP.view.x);
  await l.mouse.move(600, 450); await l.mouse.down(); await l.mouse.move(450, 420, { steps: 8 }); await l.mouse.up();
  const x1 = await l.evaluate(() => APP.view.x);
  ok(x1 !== x0, "mouse drag pans the map");
  await l.click("#zoom-fit"); await l.waitForTimeout(700);
  await l.click(".ship.is-leader .ship-body"); await l.waitForSelector("#sheet.is-open"); await l.waitForTimeout(800);
  ok((await l.textContent("#sheet-body")).includes("المركز الأول"), "clicking leader ship opens its sheet");
  await l.screenshot({ path: path.join(SHOTS, "final-ship-laptop.png") });
  await l.click("#sheet-close"); await l.waitForTimeout(400);
  await l.click("#btn-board"); await l.waitForTimeout(900);
  await l.screenshot({ path: path.join(SHOTS, "final-leaderboard-laptop.png") });
  await audit(l, "leaderboard laptop");
  await l.keyboard.press("Escape"); await l.waitForTimeout(400);
  ok(!(await l.isVisible("#sheet.is-open")), "Escape closes sheet");

  const alctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const al = await alctx.newPage(); track(al, "admin-laptop");
  await al.goto(BASE); await al.waitForSelector("#login-name");
  await al.fill("#login-name", "admin"); await al.fill("#login-pin", ADMIN_PASS); await al.click("#btn-login");
  await al.waitForSelector(".adm-top"); await al.waitForTimeout(700);
  await al.screenshot({ path: path.join(SHOTS, "final-admin-laptop.png") });
  await audit(al, "admin laptop");

  ok(expected401 === 1, "only the deliberate wrong-PIN attempt returned 401", String(expected401));
  ok(errors.length === 0, "no console / page errors", errors.join(" | "));
  await browser.close();
}

run().catch((e) => { failed++; results.push("✖ crashed: " + (e.stack || e)); })
  .finally(() => {
    if (proc) proc.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log(results.join("\n"));
    console.log(`\nE2E: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
