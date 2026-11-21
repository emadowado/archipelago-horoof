/* أرخبيل الحروف — السيرفر
   تشغيل:  node server.js   (PORT=8080 افتراضياً)
   التخزين:
     - بدون DATABASE_URL: data/state.json والأعلام في data/uploads/
     - مع DATABASE_URL (Postgres): الحالة كاملة صف jsonb واحد في app_state، والأعلام bytea في app_files
   متغيرات البيئة: PORT, DATABASE_URL, ADMIN_PASSWORD, DATA_DIR, SECRETS_FILE, PGSSL (disable|require) */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const G = require("./shared/game.js");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const UPLOADS = path.join(DATA_DIR, "uploads");
const SECRETS_FILE = process.env.SECRETS_FILE || path.join(DATA_DIR, "SECRETS.txt");
const SESSION_DAYS = 30;
const DATABASE_URL = process.env.DATABASE_URL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const STORAGE = DATABASE_URL ? "postgres" : "file";
try { fs.mkdirSync(UPLOADS, { recursive: true }); } catch (e) { if (STORAGE === "file") throw e; }

/* ───────── helpers ───────── */
const now = () => Date.now();
const rid = (n = 8) => crypto.randomBytes(n).toString("hex");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const normName = (s) => String(s || "").normalize("NFKC").trim().replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة$/g, "ه").toLowerCase();
const cleanText = (s, max = 40) => String(s || "").normalize("NFKC").replace(/[<>\u0000-\u001f]/g, "").trim().replace(/\s+/g, " ").slice(0, max);

function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  const h = crypto.scryptSync(String(pin), salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${salt}$${h}`;
}
function checkPin(pin, stored) {
  const [, salt, h] = String(stored).split("$");
  if (!salt || !h) return false;
  const test = crypto.scryptSync(String(pin), salt, 32, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(test, Buffer.from(h, "hex"));
}
function strongPassword(len = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_!@#%";
  const b = crypto.randomBytes(len);
  return Array.from(b, (x) => chars[x % chars.length]).join("");
}
function randPin() { return String(crypto.randomInt(1000, 10000)); }
function joinCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(6), (x) => chars[x % chars.length]).join("");
}

/* ───────── state ───────── */
let S = null;
function seed() {
  const fromEnv = !!ADMIN_PASSWORD;
  const adminPass = fromEnv ? ADMIN_PASSWORD : strongPassword(22);
  const demoPin = "2027";
  const teamsSeed = [
    { name: "أسطول التيجان", ship: "galleon", flag: "/flags/02.svg", members: ["فهد", "ناصر"], island: "lighthouse", coins: 31500, tr: { shell: 2, chest: 1 }, energy: 7 },
    { name: "قراصنة الفجر", ship: "brig", flag: "/flags/03.svg", members: ["تجربة", "خالد"], island: "marina", coins: 24000, tr: { shell: 1 }, energy: 6 },
    { name: "ذئاب البحر", ship: "sloop", flag: "/flags/04.svg", members: ["يوسف", "بندر"], island: "reefs", coins: 21500, tr: { shell: 2 }, energy: 5 },
    { name: "راية السهام", ship: "galleon", flag: "/flags/05.svg", members: ["عمر", "تركي"], island: "cannon", coins: 19000, tr: { shell: 1 }, energy: 8 },
    { name: "كنز الحروف", ship: "brig", flag: "/flags/06.svg", members: ["فيصل", "راشد"], island: "firstletter", coins: 16500, tr: {}, energy: 4 },
    { name: "سفن الظل", ship: "sloop", flag: "/flags/07.svg", members: ["حمد", "عبدالله"], island: "fog", coins: 12000, tr: { shell: 1 }, energy: 9 }
  ];
  const st = {
    v: 1, day: 7, phase: "choosing", revealSeq: 0, lastReveal: null,
    whale: { region: "danger", angle: 30, drawnDay: null, result: null, seq: 0 },
    teams: [], players: [], sessions: {}, log: [], results: {}, guests: [], islands: {}, moveHistory: []
  };
  const creds = [];
  teamsSeed.forEach((t, i) => {
    const id = "t" + (i + 1);
    st.teams.push({
      id, name: t.name, ship: t.ship, flag: t.flag, island: t.island, energy: t.energy, coins: t.coins,
      treasures: { shell: t.tr.shell || 0, chest: t.tr.chest || 0, crown: t.tr.crown || 0 },
      code: joinCode(), move: null, created: now()
    });
    for (const m of t.members) {
      const pin = m === "تجربة" ? demoPin : randPin();
      st.players.push({ id: "p" + rid(5), name: m, key: normName(m), pin: hashPin(pin), teamId: id, role: "player", created: now() });
      creds.push(`${m.padEnd(10)}  رمز: ${pin}   (طاقم ${t.name})`);
    }
  });
  // a few islands already claimed so the map tells a story
  st.islands = { lighthouse: { claimedBy: "t1", day: 5 }, reefs: { claimedBy: "t3", day: 4 }, cannon: { claimedBy: "t4", day: 6 } };
  st.players.push({ id: "padmin", name: "admin", key: normName("admin"), pin: hashPin(adminPass), teamId: null, role: "admin", created: now() });
  st.log.push({ id: rid(6), ts: now(), day: 7, teamId: null, type: "info", note: "بداية تجريبية: يوم 7، مرحلة الاختيار", by: "النظام" });
  const txt = [
    "أرخبيل الحروف — بيانات الدخول (سرّي، لا تنشره)",
    "=================================================",
    "",
    "حساب القبطان (لوحة التحكم):",
    `  اسم القرصان: admin`,
    fromEnv ? "  كلمة المرور: (من متغير البيئة ADMIN_PASSWORD)" : `  كلمة المرور: ${adminPass}`,
    "",
    "حساب تجريبي للاعب:",
    `  اسم القرصان: تجربة`,
    `  الرمز: ${demoPin}   (طاقم قراصنة الفجر)`,
    "",
    "باقي اللاعبين التجريبيين:",
    ...creds.map((c) => "  " + c),
    "",
    "أكواد الانضمام للطواقم (للتسجيل الجديد):",
    ...st.teams.map((t) => `  ${t.name}: ${t.code}`),
    ""
  ].join("\n");
  try {
    fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
    fs.writeFileSync(SECRETS_FILE, txt, { mode: 0o600 });
    console.log("Seeded demo data. Logins written to", SECRETS_FILE);
  } catch { console.log("Seeded demo data (secrets file not writable)."); }
  console.log(fromEnv ? "Admin password: taken from ADMIN_PASSWORD." : "Admin password: generated (not logged); see the secrets file or set ADMIN_PASSWORD.");
  return st;
}

/* ───────── storage: JSON file or Postgres ───────── */
const store = STORAGE === "postgres" ? pgStore() : fileStore();

function fileStore() {
  return {
    async init() {},
    async load() { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return null; } },
    // atomic write: tmp file then rename (sync = naturally serialized)
    save(state) {
      const tmp = STATE_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, STATE_FILE);
    },
    async flush() {},
    async putFile(name, buf) { fs.writeFileSync(path.join(UPLOADS, name), buf); },
    async delFile(name) { try { fs.unlinkSync(path.join(UPLOADS, path.basename(name))); } catch {} },
    getFile: null, // served from disk by serveStatic
    async close() {},
    async healthy() { return true; }
  };
}

function pgStore() {
  const { Pool } = require("pg");
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(DATABASE_URL);
  const sslMode = process.env.PGSSL || (local || /sslmode=disable/.test(DATABASE_URL) ? "disable" : "require");
  let pool = null;
  const makePool = (ssl) => { const p = new Pool({ connectionString: DATABASE_URL, max: 4, ssl: ssl ? { rejectUnauthorized: false } : false }); p.on("error", (e) => console.error("pg pool error:", e.message)); return p; };
  const LOCK_KEY = 772027; // advisory lock: one writer at a time, even across instances
  let pending = null, writing = null;
  async function writeLoop() {
    while (pending) {
      const json = pending; pending = null;
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
        await c.query("INSERT INTO app_state (id, data, updated_at) VALUES (1, $1::jsonb, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()", [json]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        console.error("pg save failed, will retry:", e.message);
        if (!pending) pending = json;
        await new Promise((r) => setTimeout(r, 1000));
      } finally { c.release(); }
    }
  }
  const fileCache = new Map();
  return {
    async init() {
      pool = makePool(sslMode !== "disable");
      try { await pool.query("SELECT 1"); }
      catch (e) {
        if (!/does not support SSL/i.test(e.message)) throw e;
        await pool.end().catch(() => {}); pool = makePool(false); // e.g. a private-network DB without TLS
        await pool.query("SELECT 1");
      }
      await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS app_files (name text PRIMARY KEY, mime text NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    },
    async load() {
      const r = await pool.query("SELECT data FROM app_state WHERE id = 1");
      return r.rows[0] ? r.rows[0].data : null;
    },
    // coalescing, serialized writer: latest state always wins, never two writes at once
    save(state) {
      pending = JSON.stringify(state);
      if (!writing) writing = writeLoop().finally(() => { writing = null; if (pending) store.save(JSON.parse(pending)); });
    },
    async flush() { while (writing) await writing; },
    async putFile(name, buf, mime) {
      await pool.query("INSERT INTO app_files (name, mime, data) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data", [name, mime, buf]);
      fileCache.set(name, { mime, data: buf });
    },
    async delFile(name) { name = path.basename(name); fileCache.delete(name); await pool.query("DELETE FROM app_files WHERE name = $1", [name]); },
    async getFile(name) {
      if (fileCache.has(name)) return fileCache.get(name);
      const r = await pool.query("SELECT mime, data FROM app_files WHERE name = $1", [name]);
      if (!r.rows[0]) return null;
      const f = { mime: r.rows[0].mime, data: r.rows[0].data };
      fileCache.set(name, f);
      return f;
    },
    async close() { await this.flush(); if (pool) await pool.end(); },
    async healthy() { try { await pool.query("SELECT 1"); return true; } catch { return false; } }
  };
}

async function load() {
  await store.init();
  S = await store.load();
  if (!S) { S = seed(); save(); await store.flush(); }
  // ADMIN_PASSWORD (if set) is authoritative: keeps the admin login in sync with the env var
  const admin = S.players.find((p) => p.role === "admin");
  if (ADMIN_PASSWORD && admin && !checkPin(ADMIN_PASSWORD, admin.pin)) {
    admin.pin = hashPin(ADMIN_PASSWORD);
    for (const [k, v] of Object.entries(S.sessions)) if (v.uid === admin.id) delete S.sessions[k];
    save();
    console.log("Admin password updated from ADMIN_PASSWORD.");
  }
  ensureRequestedAccounts();
  console.log(`Storage: ${STORAGE}`);
}
// Idempotent data migration: accounts Emad asked for. Only adds what is missing, never overwrites.
function ensureRequestedAccounts() {
  let changed = false;
  const TEAM = "قراصنة مدار";
  let team = S.teams.find((t) => normName(t.name) === normName(TEAM));
  if (!team) {
    const used = new Set(S.teams.map((t) => t.flag));
    const flags = fs.readdirSync(path.join(PUB, "flags")).filter((f) => f.endsWith(".svg")).map((f) => "/flags/" + f);
    const taken = new Set(S.teams.map((t) => t.island));
    const isle = G.ISLANDS.find((i) => i.type !== "rare" && i.type !== "mystery" && i.region === "beginnings" && !taken.has(i.id)) || G.islandById("marina");
    team = {
      id: "t" + rid(4), name: TEAM, ship: "brig", flag: flags.find((f) => !used.has(f)) || flags[0], island: isle.id,
      energy: G.RULES.START_ENERGY, coins: 0, treasures: { shell: 0, chest: 0, crown: 0 }, code: joinCode(), move: null, created: now()
    };
    S.teams.push(team);
    S.log.push({ id: rid(6), ts: now(), day: S.day, teamId: team.id, type: "info", note: `طاقم جديد: ${TEAM}`, by: "النظام" });
    changed = true;
  }
  const key = normName("1");
  const u = S.players.find((x) => x.key === key);
  if (!u) {
    S.players.push({ id: "p" + rid(5), name: "1", key, pin: hashPin("11"), teamId: team.id, role: "player", created: now() });
    changed = true;
  } else if (!u.teamId && u.role !== "admin") { u.teamId = team.id; changed = true; }
  if (changed) { S.v++; save(); console.log("Requested accounts ensured."); }
}
function save() { store.save(S); }
function commit() {
  S.v++;
  save();
  broadcast();
}

/* ───────── sessions & auth ───────── */
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function getUser(req) {
  const tok = parseCookies(req).arch_sid;
  if (!tok) return null;
  const s = S.sessions[sha(tok)];
  if (!s || s.exp < now()) return null;
  return S.players.find((p) => p.id === s.uid) || null;
}
function isHttps(req) { return req.headers["x-forwarded-proto"] === "https" || !!req.socket.encrypted; }
function setSession(req, res, user) {
  const tok = crypto.randomBytes(32).toString("base64url");
  S.sessions[sha(tok)] = { uid: user.id, exp: now() + SESSION_DAYS * 864e5 };
  // prune expired
  for (const [k, v] of Object.entries(S.sessions)) if (v.exp < now()) delete S.sessions[k];
  res.setHeader("Set-Cookie", `arch_sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? "; Secure" : ""}`);
}
function clearSession(req, res) {
  const tok = parseCookies(req).arch_sid;
  if (tok) delete S.sessions[sha(tok)];
  res.setHeader("Set-Cookie", `arch_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
// Rate limit: per IP and per name
const attempts = new Map();
function clientIp(req) {
  return (req.headers["cf-connecting-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket.remoteAddress || "").trim();
}
function limited(key, max, windowMs) {
  const t = now();
  const arr = (attempts.get(key) || []).filter((x) => t - x < windowMs);
  attempts.set(key, arr);
  return arr.length >= max;
}
function hit(key) { const a = attempts.get(key) || []; a.push(now()); attempts.set(key, a); }

/* ───────── views ───────── */
function publicTeam(t) {
  const members = S.players.filter((p) => p.teamId === t.id).map((p) => p.name);
  return { id: t.id, name: t.name, ship: t.ship, flag: t.flag, island: t.island, coins: t.coins, treasures: t.treasures, total: G.teamTotal(t), members, moved: !!t.move };
}
function leaderId() {
  const arr = [...S.teams].sort((a, b) => G.teamTotal(b) - G.teamTotal(a) || a.name.localeCompare(b.name, "ar"));
  return arr.length ? arr[0].id : null;
}
function stateFor(user) {
  const out = {
    v: S.v, day: S.day, phase: S.phase,
    whale: { region: S.whale.region, angle: S.whale.angle, drawnDay: S.whale.drawnDay, result: S.whale.result, seq: S.whale.seq },
    teams: S.teams.map(publicTeam), leader: leaderId(), islands: S.islands, lastReveal: S.lastReveal,
    guests: S.guests.slice(-10), me: null, myTeam: null
  };
  if (user) {
    out.me = { id: user.id, name: user.name, role: user.role, teamId: user.teamId };
    const t = S.teams.find((x) => x.id === user.teamId);
    if (t) {
      out.myTeam = { ...publicTeam(t), energy: t.energy, move: t.move };
      out.myLog = S.log.filter((l) => l.teamId === t.id).slice(-60).reverse();
    }
    if (user.role === "admin") out.energies = Object.fromEntries(S.teams.map((t) => [t.id, t.energy]));
  }
  return out;
}

/* ───────── game actions ───────── */
function addLog(entry, by) {
  S.log.push({ id: rid(6), ts: now(), day: S.day, by: by || "النظام", ...entry });
  if (S.log.length > 3000) S.log.splice(0, S.log.length - 3000);
}
function applyGold(team, { coins = 0, treasure = null, tcount = 1, energy = 0 }, note, by, type = "gold") {
  team.coins = Math.max(0, (team.coins || 0) + coins);
  if (treasure) team.treasures[treasure] = Math.max(0, (team.treasures[treasure] || 0) + tcount);
  if (energy) team.energy = Math.max(0, Math.min(G.RULES.ENERGY_CAP, team.energy + energy));
  addLog({ teamId: team.id, type, coins, treasure, tcount: treasure ? tcount : 0, energy, note }, by);
}
function revealMoves(by) {
  const moves = [];
  const arrivals = {};
  for (const t of S.teams) {
    const from = t.island;
    if (!t.move || t.move.dest === from) { t.move = null; continue; }
    const dest = t.move.dest;
    const cost = G.travelCost(from, dest);
    const isle = G.islandById(dest);
    if (!isle || cost == null || !G.islandVisible(isle, S.day) || isle.locked) {
      addLog({ teamId: t.id, type: "move", note: "حركة غير صالحة، أُلغيت" }, by);
      moves.push({ teamId: t.id, from, to: from, ok: false, reason: "invalid" }); t.move = null; continue;
    }
    if (t.energy < cost) {
      addLog({ teamId: t.id, type: "move", note: `الطاقة ما كفت للإبحار إلى ${isle.name}، بقيت السفينة مكانها` }, by);
      moves.push({ teamId: t.id, from, to: from, ok: false, reason: "energy" }); t.move = null; continue;
    }
    t.energy -= cost;
    t.island = dest;
    addLog({ teamId: t.id, type: "move", energy: -cost, note: `أبحرت من ${G.islandById(from).name} إلى ${isle.name} (−${cost} طاقة)` }, by);
    moves.push({ teamId: t.id, from, to: dest, ok: true, cost });
    (arrivals[dest] = arrivals[dest] || []).push(t);
    t.move = null;
  }
  // First-visit island effects (one claimant per island; ties → random)
  for (const [iid, teams] of Object.entries(arrivals)) {
    const isle = G.islandById(iid);
    if (S.islands[iid] && S.islands[iid].claimedBy) continue;
    if (!["power", "rare", "trap"].includes(isle.type)) continue;
    const winner = teams[crypto.randomInt(teams.length)];
    const r = G.islandReward(isle);
    S.islands[iid] = { claimedBy: winner.id, day: S.day };
    if (isle.type === "trap") {
      applyGold(winner, { energy: -1 }, `وقعت في فخ ${isle.name}: −1 طاقة`, by, "trap");
    } else {
      applyGold(winner, { coins: r.coins || 0, treasure: r.treasure || null }, `أول من رسى على ${isle.name}: ${r.label}`, by, "island");
    }
    const m = moves.find((x) => x.teamId === winner.id); if (m) m.claimed = iid;
  }
  S.revealSeq++;
  S.lastReveal = { seq: S.revealSeq, day: S.day, ts: now(), moves };
  S.moveHistory.push(S.lastReveal);
  S.phase = "revealed";
  addLog({ teamId: null, type: "reveal", note: `كُشفت تحركات اليوم ${S.day}` }, by);
}
function teamsInRegion(region) {
  return S.teams.filter((t) => G.islandById(t.island).region === region);
}
function whaleDraw(by) {
  const pool = teamsInRegion(S.whale.region);
  S.whale.seq++;
  S.whale.drawnDay = S.day;
  if (!pool.length) {
    S.whale.result = { day: S.day, teamId: null, seq: S.whale.seq, pool: [] };
    addLog({ teamId: null, type: "whale", note: `قرعة الحوت يوم ${S.day}: ما فيه سفن في ${G.REGIONS[S.whale.region].name}` }, by);
    return;
  }
  const w = pool[crypto.randomInt(pool.length)];
  applyGold(w, { treasure: "shell" }, `فازت بقرعة الحوت في ${G.REGIONS[S.whale.region].name}: كنز صدفة ${G.fmt(G.RULES.TREASURE.shell)}`, by, "whale");
  S.whale.result = { day: S.day, teamId: w.id, seq: S.whale.seq, pool: pool.map((t) => t.id) };
}
function applyResults(day, results, by) {
  S.results[day] = S.results[day] || {};
  const prev = S.results[day];
  let firstCount = 0;
  for (const v of Object.values(results)) if (v === "first") firstCount++;
  if (firstCount > 1) throw new Error("أول جواب صحيح لفريق واحد فقط");
  for (const t of S.teams) {
    const nv = results[t.id];
    if (!nv || !(nv in G.RESULT_GOLD)) continue;
    const ov = prev[t.id] || "none";
    if (nv === ov) continue;
    const dc = G.RESULT_GOLD[nv] - G.RESULT_GOLD[ov];
    const de = G.RULES.ENERGY[nv] - G.RULES.ENERGY[ov];
    const labels = { none: "بلا جواب", wrong: "محاولة خاطئة", right: "جواب صحيح", first: "أول جواب صحيح" };
    applyGold(t, { coins: dc, energy: de }, `سؤال يوم ${day}: ${labels[nv]}${ov !== "none" ? ` (بدل ${labels[ov]})` : ""}`, by, "answer");
    prev[t.id] = nv;
  }
}

/* ───────── SSE ───────── */
const clients = new Set();
function broadcast() {
  const msg = `data: ${JSON.stringify({ v: S.v })}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch {} }
}
setInterval(() => { for (const c of clients) { try { c.write(": ping\n\n"); } catch {} } }, 20000);

/* ───────── http plumbing ───────── */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
};
function send(res, code, body, headers = {}) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(code, { ...SEC_HEADERS, "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(data);
}
const err = (res, code, msg) => send(res, code, { error: msg });
function readJson(req, limit = 3e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("الطلب كبير"), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("JSON غير صالح"), { code: 400 })); } });
    req.on("error", reject);
  });
}
async function serveUpload(req, res, urlPath) {
  const name = path.basename(decodeURIComponent(urlPath));
  if (!/^[a-z0-9-]+\.(png|jpg|webp)$/i.test(name)) return err(res, 404, "not found");
  const f = await store.getFile(name);
  if (!f) return err(res, 404, "not found");
  const etag = `"${crypto.createHash("sha1").update(f.data).digest("hex").slice(0, 16)}"`;
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
  res.writeHead(200, { ...SEC_HEADERS, "Content-Type": f.mime, "Content-Length": f.data.length, ETag: etag, "Cache-Control": "public, max-age=3600" });
  res.end(req.method === "HEAD" ? undefined : f.data);
}
function serveStatic(req, res, urlPath) {
  if (store.getFile && urlPath.startsWith("/uploads/")) return serveUpload(req, res, urlPath);
  let base = PUB, rel = urlPath;
  if (urlPath === "/game.js") { base = path.join(ROOT, "shared"); rel = "/game.js"; }
  else if (urlPath.startsWith("/uploads/")) { base = UPLOADS; rel = urlPath.slice("/uploads".length); }
  if (rel === "/" || rel === "") rel = "/index.html";
  let fp;
  try { fp = path.join(base, path.normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, "")); } catch { return err(res, 400, "bad path"); }
  if (!fp.startsWith(base + path.sep) && fp !== base) return err(res, 403, "forbidden");
  fs.stat(fp, (e, st) => {
    if (e || !st.isFile()) {
      if (!path.extname(rel)) return serveStatic(req, res, "/index.html");
      return err(res, 404, "not found");
    }
    const ext = path.extname(fp).toLowerCase();
    const longCache = /\.(webp|png|jpg|jpeg|woff2|svg)$/.test(ext) && !urlPath.startsWith("/uploads/");
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": st.size, ETag: etag, "Cache-Control": longCache ? "public, max-age=604800" : "no-cache" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(fp).pipe(res);
  });
}

/* ───────── routes ───────── */
const SHIPS = ["galleon", "brig", "sloop"];
function requireUser(req, res) { const u = getUser(req); if (!u) { err(res, 401, "سجّل دخولك أول"); return null; } return u; }
function requireAdmin(req, res) { const u = getUser(req); if (!u) { err(res, 401, "سجّل دخولك أول"); return null; } if (u.role !== "admin") { err(res, 403, "هذي للقبطان بس"); return null; } return u; }
function validPin(pin, admin) {
  pin = String(pin || "");
  return admin ? pin.length >= 8 && pin.length <= 64 : /^[0-9]{4,8}$/.test(pin);
}
function findTeam(id) { return S.teams.find((t) => t.id === id); }

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  // CSRF guard for all state-changing requests
  if (m !== "GET" && m !== "HEAD") {
    if (req.headers["x-requested-with"] !== "arch") return err(res, 403, "طلب غير مسموح");
    const ct = req.headers["content-type"] || "";
    if (!ct.startsWith("application/json")) return err(res, 415, "JSON فقط");
  }
  if (p === "/api/events" && m === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write(`retry: 3000\ndata: ${JSON.stringify({ v: S.v })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (p === "/api/health") return send(res, 200, { ok: true, v: S.v, storage: STORAGE });
  if (p === "/api/state" && m === "GET") return send(res, 200, stateFor(getUser(req)));

  if (p === "/api/login" && m === "POST") {
    const b = await readJson(req, 4096);
    const ip = clientIp(req);
    const key = normName(b.name);
    if (limited("ip:" + ip, 20, 10 * 60e3) || limited("n:" + key, 6, 15 * 60e3)) return err(res, 429, "محاولات كثيرة، جرّب بعد ربع ساعة");
    const u = S.players.find((x) => x.key === key);
    if (!u || !checkPin(b.pin, u.pin)) { hit("ip:" + ip); hit("n:" + key); return err(res, 401, "اسم القرصان أو الرمز غلط"); }
    attempts.delete("n:" + key);
    setSession(req, res, u); save();
    return send(res, 200, { ok: true, me: { id: u.id, name: u.name, role: u.role, teamId: u.teamId } });
  }
  if (p === "/api/register" && m === "POST") {
    const b = await readJson(req, 4096);
    const ip = clientIp(req);
    if (limited("reg:" + ip, 8, 30 * 60e3)) return err(res, 429, "محاولات كثيرة، جرّب بعدين");
    hit("reg:" + ip);
    const name = cleanText(b.name, 24);
    if (name.length < 2) return err(res, 400, "اسم القرصان قصير");
    if (!validPin(b.pin)) return err(res, 400, "الرمز لازم يكون من 4 إلى 8 أرقام");
    const code = String(b.code || "").trim().toUpperCase();
    const team = S.teams.find((t) => t.code === code);
    if (!team) return err(res, 400, "كود الطاقم غلط، اطلبه من عماد");
    if (S.players.filter((x) => x.teamId === team.id).length >= 2) return err(res, 400, "الطاقم مكتمل (شخصين)");
    if (S.players.some((x) => x.key === normName(name))) return err(res, 409, "الاسم مأخوذ، اختر اسم ثاني");
    const u = { id: "p" + rid(5), name, key: normName(name), pin: hashPin(b.pin), teamId: team.id, role: "player", created: now() };
    S.players.push(u);
    addLog({ teamId: team.id, type: "info", note: `انضم ${name} للطاقم` }, name);
    setSession(req, res, u); commit();
    return send(res, 200, { ok: true, me: { id: u.id, name: u.name, role: u.role, teamId: u.teamId } });
  }
  if (p === "/api/logout" && m === "POST") { clearSession(req, res); save(); return send(res, 200, { ok: true }); }

  if (p === "/api/move" && m === "POST") {
    const u = requireUser(req, res); if (!u) return;
    const team = findTeam(u.teamId);
    if (!team) return err(res, 400, "ما عندك طاقم");
    if (S.phase !== "choosing") return err(res, 409, "مرحلة الاختيار مقفلة");
    const b = await readJson(req, 4096);
    if (b.dest == null || b.dest === team.island) { team.move = null; addLog({ teamId: team.id, type: "choice", note: `${u.name} ألغى حركة اليوم` }, u.name); commit(); return send(res, 200, { ok: true, move: null }); }
    const isle = G.islandById(b.dest);
    if (!isle || !G.islandVisible(isle, S.day)) return err(res, 400, "الجزيرة غير موجودة");
    if (isle.locked) return err(res, 400, "هذي الجزيرة مقفلة لين يكشف سرها عماد");
    const cost = G.travelCost(team.island, isle.id);
    if (cost > team.energy) return err(res, 400, `الطاقة ما تكفي: تحتاج ${cost} وعندك ${team.energy}`);
    team.move = { dest: isle.id, cost, by: u.name, ts: now(), day: S.day };
    addLog({ teamId: team.id, type: "choice", note: `${u.name} اختار الإبحار إلى ${isle.name} (${cost} طاقة)` }, u.name);
    commit();
    return send(res, 200, { ok: true, move: team.move });
  }

  /* ─── admin ─── */
  if (p.startsWith("/api/admin/")) {
    const a = requireAdmin(req, res); if (!a) return;
    const by = "القبطان";
    if (p === "/api/admin/full" && m === "GET") {
      return send(res, 200, {
        teams: S.teams.map((t) => ({ ...publicTeam(t), energy: t.energy, code: t.code, move: t.move })),
        players: S.players.map((x) => ({ id: x.id, name: x.name, teamId: x.teamId, role: x.role })),
        log: S.log.slice(-400).reverse(), results: S.results, guests: S.guests, day: S.day, phase: S.phase, whale: S.whale, islands: S.islands
      });
    }
    const b = m === "POST" ? await readJson(req) : {};
    switch (p) {
      case "/api/admin/day": {
        const d = Math.round(Number(b.day));
        if (!(d >= 1 && d <= G.RULES.DAYS)) return err(res, 400, "اليوم من 1 إلى 19");
        S.day = d; addLog({ type: "info", note: `تغيّر اليوم إلى ${d}` }, by); break;
      }
      case "/api/admin/phase": {
        if (!["choosing", "closed"].includes(b.phase)) return err(res, 400, "مرحلة غير معروفة");
        S.phase = b.phase; addLog({ type: "info", note: b.phase === "choosing" ? "فُتحت مرحلة الاختيار" : "قُفلت مرحلة الاختيار" }, by); break;
      }
      case "/api/admin/reveal": {
        if (S.phase === "revealed") return err(res, 409, "تحركات اليوم مكشوفة من قبل");
        revealMoves(by); break;
      }
      case "/api/admin/nextday": {
        if (S.day >= G.RULES.DAYS) return err(res, 400, "هذا آخر يوم");
        for (const t of S.teams) t.move = null;
        S.day++; S.phase = "choosing";
        const regs = ["beginnings", "danger", "edge"];
        S.whale.region = regs[crypto.randomInt(3)]; S.whale.angle = 20 + crypto.randomInt(80); S.whale.result = null; S.whale.drawnDay = null;
        addLog({ type: "info", note: `بداية اليوم ${S.day}. الحوت ظهر في ${G.REGIONS[S.whale.region].name}` }, by); break;
      }
      case "/api/admin/whale": {
        const regs = ["beginnings", "danger", "edge"];
        const r = b.region === "random" ? regs[crypto.randomInt(3)] : b.region;
        if (!regs.includes(r)) return err(res, 400, "منطقة غير معروفة");
        S.whale.region = r; S.whale.angle = 20 + crypto.randomInt(80); S.whale.result = null; S.whale.drawnDay = null;
        addLog({ type: "info", note: `الحوت في ${G.REGIONS[r].name}` }, by); break;
      }
      case "/api/admin/whaledraw": {
        if (S.whale.drawnDay === S.day && !b.force) return err(res, 409, "قرعة الحوت لهذا اليوم تمت");
        whaleDraw(by); break;
      }
      case "/api/admin/results": {
        const d = Math.round(Number(b.day || S.day));
        if (!(d >= 1 && d <= G.RULES.DAYS)) return err(res, 400, "يوم غير صالح");
        try { applyResults(d, b.results || {}, by); } catch (e) { return err(res, 400, e.message); }
        break;
      }
      case "/api/admin/award": {
        const t = findTeam(b.teamId); if (!t) return err(res, 404, "الطاقم غير موجود");
        const coins = Math.round(Number(b.coins || 0));
        const energy = Math.round(Number(b.energy || 0));
        const treasure = b.treasure && G.RULES.TREASURE[b.treasure] ? b.treasure : null;
        const tcount = treasure ? Math.round(Number(b.tcount || 1)) : 0;
        if (Math.abs(coins) > 1e6 || Math.abs(energy) > 12 || Math.abs(tcount) > 10) return err(res, 400, "قيمة كبيرة");
        if (!coins && !energy && !tcount) return err(res, 400, "ما فيه تغيير");
        applyGold(t, { coins, energy, treasure, tcount }, cleanText(b.note, 120) || (coins >= 0 ? "مكافأة من القبطان" : "خصم من القبطان"), by, "gold");
        break;
      }
      case "/api/admin/guest": {
        const name = cleanText(b.name, 30); if (!name) return err(res, 400, "اكتب اسم الضيف");
        S.guests.push({ id: rid(5), day: S.day, name, gold: G.RULES.GUEST, ts: now() });
        addLog({ type: "guest", coins: G.RULES.GUEST, note: `ضيف حروف يوم ${S.day}: ${name} (+${G.fmt(G.RULES.GUEST)})` }, by); break;
      }
      case "/api/admin/team": {
        const name = cleanText(b.name, 30);
        if (b.id) {
          const t = findTeam(b.id); if (!t) return err(res, 404, "الطاقم غير موجود");
          if (name) t.name = name;
          if (SHIPS.includes(b.ship)) t.ship = b.ship;
          if (b.island && G.islandById(b.island)) t.island = b.island;
          if (b.energy != null) t.energy = Math.max(0, Math.min(G.RULES.ENERGY_CAP, Math.round(Number(b.energy))));
          if (b.newCode) t.code = joinCode();
          addLog({ teamId: t.id, type: "info", note: `تعديل بيانات الطاقم` }, by);
        } else {
          if (name.length < 2) return err(res, 400, "اكتب اسم الطاقم");
          if (S.teams.length >= 20) return err(res, 400, "الحد 20 طاقم");
          const id = "t" + rid(4);
          const flags = fs.readdirSync(path.join(PUB, "flags")).filter((f) => f.endsWith(".svg"));
          S.teams.push({ id, name, ship: SHIPS.includes(b.ship) ? b.ship : SHIPS[S.teams.length % 3], flag: "/flags/" + flags[S.teams.length % flags.length], island: b.island && G.islandById(b.island) ? b.island : "marina", energy: G.RULES.START_ENERGY, coins: 0, treasures: { shell: 0, chest: 0, crown: 0 }, code: joinCode(), move: null, created: now() });
          addLog({ teamId: id, type: "info", note: `طاقم جديد: ${name}` }, by);
        }
        break;
      }
      case "/api/admin/team/delete": {
        const t = findTeam(b.id); if (!t) return err(res, 404, "الطاقم غير موجود");
        S.teams = S.teams.filter((x) => x.id !== t.id);
        S.players.forEach((x) => { if (x.teamId === t.id) x.teamId = null; });
        addLog({ type: "info", note: `حُذف الطاقم ${t.name}` }, by); break;
      }
      case "/api/admin/flag": {
        const t = findTeam(b.teamId); if (!t) return err(res, 404, "الطاقم غير موجود");
        const mm = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ""));
        if (!mm) return err(res, 400, "الصورة لازم PNG أو JPG أو WEBP");
        const buf = Buffer.from(mm[2], "base64");
        if (buf.length > 1.5e6) return err(res, 413, "الصورة كبيرة");
        const magic = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[mm[1]];
        if (!magic.every((x, i) => buf[i] === x)) return err(res, 400, "ملف الصورة غير صالح");
        const fn = `${t.id}-${rid(4)}.${mm[1] === "jpeg" ? "jpg" : mm[1]}`;
        await store.putFile(fn, buf, "image/" + mm[1]);
        if (t.flag && t.flag.startsWith("/uploads/")) await store.delFile(path.basename(t.flag)).catch(() => {});
        t.flag = "/uploads/" + fn;
        addLog({ teamId: t.id, type: "info", note: "تحديث علم السفينة" }, by); break;
      }
      case "/api/admin/player": {
        if (b.id) {
          const u = S.players.find((x) => x.id === b.id); if (!u) return err(res, 404, "اللاعب غير موجود");
          if (b.name) { const n = cleanText(b.name, 24); if (S.players.some((x) => x.id !== u.id && x.key === normName(n))) return err(res, 409, "الاسم مأخوذ"); u.name = n; u.key = normName(n); }
          if (b.teamId !== undefined && u.role !== "admin") {
            if (b.teamId && !findTeam(b.teamId)) return err(res, 404, "الطاقم غير موجود");
            if (b.teamId && S.players.filter((x) => x.teamId === b.teamId && x.id !== u.id).length >= 2) return err(res, 400, "الطاقم مكتمل");
            u.teamId = b.teamId || null;
          }
        } else {
          const n = cleanText(b.name, 24);
          // the captain may create short names / short PINs on purpose (self-signup still needs 4–8 digits)
          if (n.length < 1) return err(res, 400, "اسم قصير");
          if (S.players.some((x) => x.key === normName(n))) return err(res, 409, "الاسم مأخوذ");
          if (!/^[0-9]{2,8}$/.test(String(b.pin || ""))) return err(res, 400, "الرمز من 2 إلى 8 أرقام");
          if (b.teamId && !findTeam(b.teamId)) return err(res, 404, "الطاقم غير موجود");
          if (b.teamId && S.players.filter((x) => x.teamId === b.teamId).length >= 2) return err(res, 400, "الطاقم مكتمل");
          S.players.push({ id: "p" + rid(5), name: n, key: normName(n), pin: hashPin(b.pin), teamId: b.teamId || null, role: "player", created: now() });
        }
        break;
      }
      case "/api/admin/player/pin": {
        const u = S.players.find((x) => x.id === b.id); if (!u) return err(res, 404, "اللاعب غير موجود");
        if (!validPin(b.pin, u.role === "admin")) return err(res, 400, u.role === "admin" ? "كلمة المرور 8 خانات على الأقل" : "الرمز من 4 إلى 8 أرقام");
        u.pin = hashPin(b.pin);
        for (const [k, v] of Object.entries(S.sessions)) if (v.uid === u.id) delete S.sessions[k];
        addLog({ type: "info", note: `إعادة تعيين رمز ${u.name}` }, by); break;
      }
      case "/api/admin/player/delete": {
        const u = S.players.find((x) => x.id === b.id); if (!u) return err(res, 404, "اللاعب غير موجود");
        if (u.role === "admin") return err(res, 400, "ما ينحذف حساب القبطان");
        S.players = S.players.filter((x) => x.id !== u.id);
        for (const [k, v] of Object.entries(S.sessions)) if (v.uid === u.id) delete S.sessions[k];
        break;
      }
      case "/api/admin/island": {
        const isle = G.islandById(b.id); if (!isle) return err(res, 404, "الجزيرة غير موجودة");
        if (b.reset) delete S.islands[isle.id];
        break;
      }
      default: return err(res, 404, "غير موجود");
    }
    commit();
    return send(res, 200, { ok: true });
  }
  return err(res, 404, "غير موجود");
}

const ready = load();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") {
      const ok = !!S && (await store.healthy());
      return send(res, ok ? 200 : 503, { ok, storage: STORAGE });
    }
    if (!S) await ready;
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return err(res, 405, "method");
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!e.code) console.error(e);
    if (!res.headersSent) err(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, e.code ? e.message : "خطأ في السيرفر");
  }
});
server.keepAliveTimeout = 65000;
if (require.main === module) {
  ready.then(() => {
    server.listen(PORT, "0.0.0.0", () => console.log(`أرخبيل الحروف يعمل على http://localhost:${PORT}`));
  }).catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
  const shutdown = () => { server.close(); store.close().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
module.exports = { server, ready, _state: () => S };
