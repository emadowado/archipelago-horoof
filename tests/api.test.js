/* API tests: node --test tests/api.test.js
   Postgres mode: TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres node --test tests/api.test.js
   (creates and drops a throwaway database) */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const G = require("../shared/game.js");

const ROOT = path.join(__dirname, "..");
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "arch-test-"));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let proc, LOGS = "";
const PG_ADMIN = process.env.TEST_PG_ADMIN_URL || "";
const PG_DB = "arch_test_" + Math.random().toString(36).slice(2, 10);
const DB_URL = PG_ADMIN ? PG_ADMIN.replace(/\/[^/?]*(\?|$)/, `/${PG_DB}$1`) : "";
const MODE = PG_ADMIN ? "postgres" : "file";
async function pgAdmin(sql, url = PG_ADMIN) {
  const { Client: PgClient } = require("pg");
  const c = new PgClient({ connectionString: url }); await c.connect();
  try { return await c.query(sql); } finally { await c.end(); }
}

function start(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT, DATA_DIR: DATA, ...extraEnv };
    delete env.DATABASE_URL; delete env.ADMIN_PASSWORD;
    if (DB_URL) env.DATABASE_URL = DB_URL;
    Object.assign(env, extraEnv);
    proc = spawn(process.execPath, [path.join(ROOT, "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d) => { LOGS += d; if (String(d).includes("يعمل")) resolve(); });
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.on("exit", (c) => c && reject(new Error("server exited " + c)));
  });
}
function stop() { return new Promise((r) => { proc.once("exit", r); proc.kill(); }); }

class Client {
  constructor() { this.cookie = ""; }
  async req(method, url, body, { csrf = true, ct = "application/json", ip } = {}) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (method !== "GET" && csrf) headers["x-requested-with"] = "arch";
    if (body !== undefined) headers["content-type"] = ct;
    if (ip) headers["x-forwarded-for"] = ip;
    const res = await fetch(BASE + url, { method, headers, body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined, redirect: "manual" });
    const sc = res.headers.get("set-cookie");
    if (sc) { const m = /arch_sid=([^;]*)/.exec(sc); this.cookie = m && m[1] ? `arch_sid=${m[1]}` : ""; this.lastSetCookie = sc; }
    let data = null; const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req("GET", u); }
  post(u, b = {}, o) { return this.req("POST", u, b, o); }
  async login(name, pin, ip) { return this.post("/api/login", { name, pin }, { ip }); }
}

let ADMIN_PASS;
const admin = new Client(), demo = new Client(), khaled = new Client(), anon = new Client();
const secrets = () => fs.readFileSync(path.join(DATA, "SECRETS.txt"), "utf8");
function pinOf(name) { const m = new RegExp(`${name}\\s+رمز: (\\d+)`).exec(secrets()); return m && m[1]; }

test.before(async () => {
  if (PG_ADMIN) await pgAdmin(`CREATE DATABASE ${PG_DB}`);
  await start();
  ADMIN_PASS = /كلمة المرور: (\S+)/.exec(secrets())[1];
});
test.after(async () => {
  await stop(); fs.rmSync(DATA, { recursive: true, force: true });
  if (PG_ADMIN) await pgAdmin(`DROP DATABASE IF EXISTS ${PG_DB} WITH (FORCE)`);
});

test("static files, security headers, traversal blocked", async () => {
  let r = await anon.get("/");
  assert.equal(r.status, 200);
  assert.match(r.data, /أرخبيل الحروف/);
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  r = await anon.get("/game.js"); assert.equal(r.status, 200);
  r = await fetch(BASE + "/img/ship_galleon.webp"); assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/webp");
  for (const u of ["/..%2fserver.js", "/%2e%2e/server.js", "/uploads/..%2f..%2fserver.js", "/uploads/../state.json"]) {
    const x = await fetch(BASE + u); const t = await x.text();
    assert.ok(!t.includes("require(\"http\")") && !t.includes("\"sessions\""), "traversal leaked for " + u);
  }
});

test("public state has no private data", async () => {
  const r = await anon.get("/api/state");
  assert.equal(r.status, 200);
  assert.equal(r.data.me, null);
  assert.equal(r.data.myTeam, null);
  assert.equal(r.data.energies, undefined);
  assert.equal(r.data.teams.length, 7);
  assert.equal(r.data.teams.filter((t) => t.name === "قراصنة مدار").length, 1, "requested team exists once");
  for (const t of r.data.teams) { assert.equal(t.code, undefined); assert.equal(t.energy, undefined); assert.equal(t.move, undefined); }
  assert.ok(!JSON.stringify(r.data).includes("scrypt"));
});

test("login: wrong pin rejected, correct sets HttpOnly cookie", async () => {
  let r = await demo.login("تجربة", "0000");
  assert.equal(r.status, 401);
  r = await demo.login("  تجربة ", "2027");
  assert.equal(r.status, 200);
  assert.match(demo.lastSetCookie, /HttpOnly/); assert.match(demo.lastSetCookie, /SameSite=Lax/);
  r = await demo.get("/api/state");
  assert.equal(r.data.me.name, "تجربة");
  assert.equal(r.data.myTeam.name, "قراصنة الفجر");
  assert.equal(typeof r.data.myTeam.energy, "number");
  r = await khaled.login("خالد", pinOf("خالد")); assert.equal(r.status, 200);
  r = await admin.login("admin", ADMIN_PASS); assert.equal(r.status, 200);
  assert.equal(r.data.me.role, "admin");
});

test("login rate limit per name", async () => {
  const c = new Client();
  const pin = pinOf("فهد");
  for (let i = 0; i < 6; i++) { const r = await c.login("فهد", "9999", "10.0.0." + i); assert.equal(r.status, 401); }
  let r = await c.login("فهد", pin, "10.0.1.1");
  assert.equal(r.status, 429, "locked even with correct pin");
  // other accounts unaffected
  r = await new Client().login("ناصر", pinOf("ناصر"), "10.0.2.1"); assert.equal(r.status, 200);
});

test("login rate limit per IP", async () => {
  const c = new Client();
  for (let i = 0; i < 20; i++) await c.login("nobody" + i, "1111", "10.9.9.9");
  const r = await c.login("تجربة", "2027", "10.9.9.9");
  assert.equal(r.status, 429);
});

test("CSRF guard and content-type", async () => {
  let r = await demo.post("/api/move", { dest: "dawn" }, { csrf: false }); assert.equal(r.status, 403);
  r = await demo.post("/api/move", "dest=dawn", { ct: "application/x-www-form-urlencoded" }); assert.equal(r.status, 415);
  r = await demo.post("/api/move", "{bad json"); assert.equal(r.status, 400);
});

const ADMIN_ROUTES = ["full", "day", "phase", "reveal", "nextday", "whale", "whaledraw", "results", "award", "guest", "team", "team/delete", "flag", "player", "player/pin", "player/delete", "island"];
test("permissions: players and anonymous cannot use admin endpoints", async () => {
  for (const r of ADMIN_ROUTES) {
    const m = r === "full" ? "GET" : "POST";
    const a = await anon.req(m, "/api/admin/" + r, m === "POST" ? { teamId: "t1", coins: 999999, day: 3 } : undefined);
    assert.equal(a.status, 401, "anon " + r);
    const p = await demo.req(m, "/api/admin/" + r, m === "POST" ? { teamId: "t1", coins: 999999, day: 3 } : undefined);
    assert.equal(p.status, 403, "player " + r);
  }
  const s = await anon.get("/api/state");
  assert.equal(s.data.day, 7, "nothing changed");
  const r = await anon.post("/api/move", { dest: "dawn" }); assert.equal(r.status, 401);
});

test("register: validation, team code, capacity, duplicates", async () => {
  const full = await admin.get("/api/admin/full");
  assert.equal(full.status, 200);
  const t1 = full.data.teams.find((t) => t.id === "t1");
  const c = new Client();
  let r = await c.post("/api/register", { name: "سندباد", pin: "12", code: t1.code }); assert.equal(r.status, 400);
  r = await c.post("/api/register", { name: "سندباد", pin: "1234", code: "WRONG1" }); assert.equal(r.status, 400);
  r = await c.post("/api/register", { name: "سندباد", pin: "1234", code: t1.code }); assert.equal(r.status, 400, "team of 2 is full");
  r = await admin.post("/api/admin/team", { name: "طاقم الاختبار" }); assert.equal(r.status, 200);
  const nt = (await admin.get("/api/admin/full")).data.teams.find((t) => t.name === "طاقم الاختبار");
  r = await c.post("/api/register", { name: "تجربه", pin: "1234", code: nt.code.toLowerCase() }); assert.equal(r.status, 409, "normalized duplicate name");
  r = await c.post("/api/register", { name: "<b>سندباد</b>", pin: "1234", code: nt.code.toLowerCase() }); assert.equal(r.status, 200);
  assert.equal(r.data.me.name, "bسندباد/b", "html stripped");
  const s = await c.get("/api/state"); assert.equal(s.data.myTeam.id, nt.id);
  // cleanup test team
  r = await admin.post("/api/admin/team/delete", { id: nt.id }); assert.equal(r.status, 200);
});

test("move flow: validation and teammates share the move", async () => {
  let s = (await demo.get("/api/state")).data;
  assert.equal(s.phase, "choosing");
  assert.equal(s.myTeam.island, "marina");
  const energy = s.myTeam.energy; // 6
  let r = await demo.post("/api/move", { dest: "mystery" }); assert.equal(r.status, 400, "locked island");
  r = await demo.post("/api/move", { dest: "golden" }); assert.equal(r.status, 400, "rare island hidden before day 9");
  r = await demo.post("/api/move", { dest: "nowhere" }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/team", { id: "t2", energy: 3 }); assert.equal(r.status, 200);
  r = await demo.post("/api/move", { dest: "lighthouse" }); assert.equal(r.status, 400, "needs 4 energy, has 3");
  r = await admin.post("/api/admin/team", { id: "t2", energy }); assert.equal(r.status, 200);
  r = await demo.post("/api/move", { dest: "dawn" });
  assert.equal(r.status, 200); assert.equal(r.data.move.cost, 2);
  s = (await khaled.get("/api/state")).data;
  assert.equal(s.myTeam.move.dest, "dawn"); assert.equal(s.myTeam.move.by, "تجربة");
  r = await khaled.post("/api/move", { dest: "haven" }); assert.equal(r.status, 200, "teammate can change it");
  r = await demo.post("/api/move", { dest: "dawn" }); assert.equal(r.status, 200);
  const pub = (await anon.get("/api/state")).data.teams.find((t) => t.id === "t2");
  assert.equal(pub.moved, true); assert.equal(pub.move, undefined, "destination stays secret");
});

test("phase closed blocks moves; reveal applies moves, energy, first-visit rewards, traps", async () => {
  // t3 (ذئاب البحر at reefs, energy 5) → traps (same region trap, cost 2)
  const yusuf = new Client(); assert.equal((await yusuf.login("يوسف", pinOf("يوسف"))).status, 200);
  assert.equal((await yusuf.post("/api/move", { dest: "traps" })).status, 200);
  // t6 (سفن الظل at fog, energy 9) → lighthouse (danger→edge adjacent: cost 3, already claimed by t1)
  const hamad = new Client(); assert.equal((await hamad.login("حمد", pinOf("حمد"))).status, 200);
  assert.equal((await hamad.post("/api/move", { dest: "lighthouse" })).status, 200);
  const before = (await admin.get("/api/admin/full")).data.teams;
  const b = (id) => before.find((t) => t.id === id);
  let r = await admin.post("/api/admin/phase", { phase: "closed" }); assert.equal(r.status, 200);
  r = await demo.post("/api/move", { dest: "callrock" }); assert.equal(r.status, 409);
  r = await admin.post("/api/admin/reveal"); assert.equal(r.status, 200);
  const after = (await admin.get("/api/admin/full")).data;
  const a = (id) => after.teams.find((t) => t.id === id);
  assert.equal(after.phase, "revealed");
  // t2 → dawn (power, beginnings): -2 energy, +2000 coins (first visitor)
  assert.equal(a("t2").island, "dawn");
  assert.equal(a("t2").energy, b("t2").energy - 2);
  assert.equal(a("t2").coins, b("t2").coins + 2000);
  assert.equal(after.islands.dawn.claimedBy, "t2");
  // t3 → traps: -2 sail, -1 trap
  assert.equal(a("t3").island, "traps");
  assert.equal(a("t3").energy, b("t3").energy - 3);
  // t6 → lighthouse: already claimed, no reward
  assert.equal(a("t6").island, "lighthouse");
  assert.equal(a("t6").energy, b("t6").energy - 3);
  assert.equal(a("t6").total, b("t6").total);
  // teams without moves stay
  assert.equal(a("t1").island, b("t1").island);
  const pub = (await anon.get("/api/state")).data;
  assert.equal(pub.lastReveal.moves.find((m) => m.teamId === "t2").to, "dawn");
  r = await admin.post("/api/admin/reveal"); assert.equal(r.status, 409, "no double reveal");
});

test("daily results: gold math, energy, idempotent, diff on change", async () => {
  const t = () => admin.get("/api/admin/full").then((r) => Object.fromEntries(r.data.teams.map((x) => [x.id, x])));
  const b = await t();
  let r = await admin.post("/api/admin/results", { day: 7, results: { t1: "first", t2: "right", t3: "wrong", t4: "none" } });
  assert.equal(r.status, 200);
  let a = await t();
  assert.equal(a.t1.coins - b.t1.coins, 3000); assert.equal(a.t2.coins - b.t2.coins, 2000); assert.equal(a.t3.coins - b.t3.coins, 500); assert.equal(a.t4.coins, b.t4.coins);
  assert.equal(a.t1.energy, Math.min(12, b.t1.energy + 5));
  assert.equal(a.t2.energy, Math.min(12, b.t2.energy + 3));
  assert.equal(a.t3.energy, b.t3.energy + 1);
  // re-apply identical: no change
  r = await admin.post("/api/admin/results", { day: 7, results: { t1: "first", t2: "right", t3: "wrong", t4: "none" } });
  const a2 = await t();
  for (const id of ["t1", "t2", "t3", "t4"]) assert.equal(a2[id].coins, a[id].coins);
  // change t1 first→right and t2 right→first : diff only
  r = await admin.post("/api/admin/results", { day: 7, results: { t1: "right", t2: "first" } });
  const a3 = await t();
  assert.equal(a3.t1.coins - b.t1.coins, 2000); assert.equal(a3.t2.coins - b.t2.coins, 3000);
  r = await admin.post("/api/admin/results", { day: 7, results: { t1: "first", t2: "first" } }); assert.equal(r.status, 400, "only one first");
  // energy cap
  await admin.post("/api/admin/team", { id: "t5", energy: 11 });
  await admin.post("/api/admin/results", { day: 7, results: { t5: "first" } });
  assert.equal((await t()).t5.energy, 12);
});

test("whale: empty region, winner in region gets shell (+5,000), once per day", async () => {
  let s = (await admin.get("/api/admin/full")).data;
  const byRegion = (r) => s.teams.filter((t) => G.islandById(t.island).region === r);
  const empty = ["beginnings", "danger", "edge"].find((r) => byRegion(r).length === 0);
  if (empty) {
    await admin.post("/api/admin/whale", { region: empty });
    let r = await admin.post("/api/admin/whaledraw"); assert.equal(r.status, 200);
    s = (await admin.get("/api/admin/full")).data;
    assert.equal(s.whale.result.teamId, null);
  }
  await admin.post("/api/admin/whale", { region: "danger" });
  s = (await admin.get("/api/admin/full")).data;
  const pool = byRegion("danger").map((t) => t.id);
  assert.ok(pool.length > 0);
  const before = Object.fromEntries(s.teams.map((t) => [t.id, t]));
  let r = await admin.post("/api/admin/whaledraw"); assert.equal(r.status, 200);
  s = (await admin.get("/api/admin/full")).data;
  const w = s.whale.result.teamId;
  assert.ok(pool.includes(w), "winner must be in whale region");
  const wt = s.teams.find((t) => t.id === w);
  assert.equal(wt.treasures.shell, before[w].treasures.shell + 1);
  assert.equal(wt.total - before[w].total, 5000);
  r = await admin.post("/api/admin/whaledraw"); assert.equal(r.status, 409);
  const pub = (await anon.get("/api/state")).data;
  assert.equal(pub.whale.result.teamId, w);
});

test("award: coins, treasures, totals formula, clamp at zero, limits", async () => {
  const get = async () => (await admin.get("/api/admin/full")).data.teams.find((t) => t.id === "t4");
  const b = await get();
  let r = await admin.post("/api/admin/award", { teamId: "t4", treasure: "crown", tcount: 1, note: "test" }); assert.equal(r.status, 200);
  r = await admin.post("/api/admin/award", { teamId: "t4", treasure: "chest", tcount: 1 }); assert.equal(r.status, 200);
  r = await admin.post("/api/admin/award", { teamId: "t4", coins: 1500 }); assert.equal(r.status, 200);
  let a = await get();
  assert.equal(a.total - b.total, 20000 + 15000 + 1500);
  assert.equal(a.total, a.coins + a.treasures.shell * 5000 + a.treasures.chest * 15000 + a.treasures.crown * 20000);
  r = await admin.post("/api/admin/award", { teamId: "t4", coins: -999999 }); assert.equal(r.status, 200);
  a = await get(); assert.equal(a.coins, 0);
  r = await admin.post("/api/admin/award", { teamId: "t4", coins: 5e6 }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/award", { teamId: "zzz", coins: 5 }); assert.equal(r.status, 404);
  r = await admin.post("/api/admin/award", { teamId: "t4" }); assert.equal(r.status, 400);
  const log = (await admin.get("/api/admin/full")).data.log;
  assert.ok(log.some((l) => l.teamId === "t4" && l.treasure === "crown"));
  const tlog = (await new Client().get("/api/state")).data.myLog; assert.equal(tlog, undefined);
});

test("guest gets 4,000 logged, not on leaderboard", async () => {
  const r = await admin.post("/api/admin/guest", { name: "متابع الانستا" }); assert.equal(r.status, 200);
  const s = (await anon.get("/api/state")).data;
  assert.equal(s.guests.at(-1).gold, 4000);
  assert.ok(!s.teams.some((t) => t.name === "متابع الانستا"));
});

test("next day resets phase and moves; day bounds", async () => {
  let r = await admin.post("/api/admin/nextday"); assert.equal(r.status, 200);
  let s = (await admin.get("/api/admin/full")).data;
  assert.equal(s.day, 8); assert.equal(s.phase, "choosing");
  assert.ok(s.teams.every((t) => !t.move));
  assert.equal(s.whale.result, null);
  r = await admin.post("/api/admin/day", { day: 20 }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/day", { day: 0 }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/day", { day: 9 }); assert.equal(r.status, 200);
  r = await demo.post("/api/move", { dest: "golden" });
  // golden appears day 9: valid target now (cost from dawn = 4); demo team energy may vary
  assert.ok([200, 400].includes(r.status));
  if (r.status === 400) assert.match(r.data.error, /الطاقة/);
  r = await admin.post("/api/admin/day", { day: 19 }); r = await admin.post("/api/admin/nextday"); assert.equal(r.status, 400);
  await admin.post("/api/admin/day", { day: 8 });
});

test("teams & flags: create, edit, upload valid image, reject bad", async () => {
  let r = await admin.post("/api/admin/team", { name: "س" }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/team", { id: "t5", name: "كنز الحروف الجديد", ship: "galleon", island: "haven" }); assert.equal(r.status, 200);
  let t5 = (await admin.get("/api/admin/full")).data.teams.find((t) => t.id === "t5");
  assert.equal(t5.name, "كنز الحروف الجديد"); assert.equal(t5.ship, "galleon"); assert.equal(t5.island, "haven");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  r = await admin.post("/api/admin/flag", { teamId: "t5", dataUrl: "data:image/png;base64," + png }); assert.equal(r.status, 200);
  t5 = (await admin.get("/api/admin/full")).data.teams.find((t) => t.id === "t5");
  assert.match(t5.flag, /^\/uploads\/t5-[0-9a-f]+\.png$/);
  const img = await fetch(BASE + t5.flag); assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
  r = await admin.post("/api/admin/flag", { teamId: "t5", dataUrl: "data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64") }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/flag", { teamId: "t5", dataUrl: "data:image/png;base64," + Buffer.from("<html>not png</html>").toString("base64") }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/team", { id: "t5", newCode: true }); assert.equal(r.status, 200);
});

test("players: admin create, move, reset PIN invalidates sessions, delete", async () => {
  let r = await admin.post("/api/admin/player", { name: "بحار جديد", pin: "4321", teamId: null }); assert.equal(r.status, 200);
  r = await admin.post("/api/admin/player", { name: "بحار جديد", pin: "4321" }); assert.equal(r.status, 409);
  r = await admin.post("/api/admin/player", { name: "بحار ثاني", pin: "1" }); assert.equal(r.status, 400);
  r = await admin.post("/api/admin/player", { name: "بحار ثاني", pin: "12a" }); assert.equal(r.status, 400);
  {
    // requested account: pirate "1" with PIN "11" on «قراصنة مدار»
    const c1 = new Client(); const lr = await c1.login("1", "11"); assert.equal(lr.status, 200);
    const st = (await c1.get("/api/state")).data;
    assert.equal(st.myTeam && st.myTeam.name, "قراصنة مدار");
    assert.equal((await new Client().login("1", "12")).status, 401);
  }
  r = await admin.post("/api/admin/player", { name: "بحار ثالث", pin: "1234", teamId: "t1" }); assert.equal(r.status, 400, "t1 full");
  const c = new Client(); assert.equal((await c.login("بحار جديد", "4321")).status, 200);
  const p = (await admin.get("/api/admin/full")).data.players.find((x) => x.name === "بحار جديد");
  r = await admin.post("/api/admin/player/pin", { id: p.id, pin: "8765" }); assert.equal(r.status, 200);
  assert.equal((await c.get("/api/state")).data.me, null, "old session revoked");
  assert.equal((await c.login("بحار جديد", "4321")).status, 401);
  assert.equal((await c.login("بحار جديد", "8765")).status, 200);
  r = await admin.post("/api/admin/player/delete", { id: p.id }); assert.equal(r.status, 200);
  assert.equal((await c.get("/api/state")).data.me, null);
  r = await admin.post("/api/admin/player/delete", { id: "padmin" }); assert.equal(r.status, 400);
});

test("SSE pushes version updates", async () => {
  const got = await new Promise((resolve, reject) => {
    const req = http.get(BASE + "/api/events", (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream");
      let buf = "", n = 0;
      res.on("data", async (d) => {
        buf += d; const msgs = buf.split("\n\n").filter((x) => x.startsWith("data:") || x.includes("\ndata:"));
        if (msgs.length >= 1 && n === 0) { n = 1; await admin.post("/api/admin/award", { teamId: "t3", coins: 500, note: "sse" }); }
        if (msgs.length >= 2) { req.destroy(); resolve(msgs); }
      });
    });
    req.on("error", (e) => { if (e.code !== "ECONNRESET") reject(e); });
    setTimeout(() => reject(new Error("SSE timeout")), 5000);
  });
  assert.ok(got.length >= 2);
});

test("logout clears session; state persists across restart", async () => {
  const c = new Client(); await c.login("عمر", pinOf("عمر"));
  let r = await c.post("/api/logout"); assert.equal(r.status, 200);
  assert.equal((await c.get("/api/state")).data.me, null);
  const before = (await anon.get("/api/state")).data;
  await stop(); await start();
  const after = (await anon.get("/api/state")).data;
  assert.equal(after.day, before.day);
  assert.deepEqual(after.teams.map((t) => t.total), before.teams.map((t) => t.total));
  assert.equal((await admin.get("/api/state")).data.me.role, "admin", "sessions survive restart");
  const t5 = after.teams.find((t) => t.id === "t5");
  assert.equal((await fetch(BASE + t5.flag)).status, 200, "uploaded flag survives restart");
});

test(`storage mode (${MODE}): /healthz and where data lives`, async () => {
  const r = await anon.get("/healthz");
  assert.equal(r.status, 200); assert.equal(r.data.ok, true); assert.equal(r.data.storage, MODE);
  assert.equal((await anon.get("/api/health")).data.storage, MODE);
  if (MODE === "postgres") {
    const st = await pgAdmin("SELECT data->>'day' AS day, jsonb_array_length(data->'teams') AS n FROM app_state WHERE id = 1", DB_URL);
    assert.equal(st.rows.length, 1); assert.ok(+st.rows[0].n >= 6);
    const files = await pgAdmin("SELECT name, mime, length(data) AS len FROM app_files", DB_URL);
    assert.ok(files.rows.some((f) => /^t5-/.test(f.name) && f.mime === "image/png" && f.len > 0), "flag stored in Postgres");
    assert.equal(fs.existsSync(path.join(DATA, "state.json")), false, "no state file in DB mode");
    assert.equal(fs.readdirSync(path.join(DATA, "uploads")).length, 0, "no flag files on disk in DB mode");
  } else {
    assert.ok(fs.existsSync(path.join(DATA, "state.json")));
  }
});

test("ADMIN_PASSWORD env is authoritative and never logged; secure cookie behind https proxy", async () => {
  const NEWPASS = "Env-Admin-Pass-" + Math.random().toString(36).slice(2);
  await stop(); LOGS = ""; await start({ ADMIN_PASSWORD: NEWPASS });
  assert.ok(!LOGS.includes(NEWPASS), "password not in logs");
  assert.ok(!LOGS.includes(ADMIN_PASS), "old password not in logs");
  const a = new Client();
  assert.equal((await a.login("admin", ADMIN_PASS)).status, 401, "old admin password rejected");
  assert.equal((await admin.get("/api/state")).data.me, null, "old admin sessions revoked");
  const r = await a.req("POST", "/api/login", { name: "admin", pin: NEWPASS }, {});
  assert.equal(r.status, 200);
  const res = await fetch(BASE + "/api/login", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "arch", "x-forwarded-proto": "https" }, body: JSON.stringify({ name: "تجربة", pin: "2027" }) });
  assert.match(res.headers.get("set-cookie"), /; Secure/);
  assert.match(res.headers.get("set-cookie"), /HttpOnly/);
});
