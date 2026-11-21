/* أرخبيل الحروف — واجهة اللاعب والخريطة */
(() => {
"use strict";
const G = window.GAME;
const { MAP, REGIONS, ISLANDS, RULES } = G;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = G.fmt;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const arNum = (n) => Number(n).toLocaleString("ar-SA");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ART = {
  palm: "/img/isle_palm.webp", sand: "/img/isle_sand.webp", rock: "/img/isle_rock.webp", ruins: "/img/isle_ruins.webp",
  trap: "/img/isle_trap.webp", storm: "/img/isle_storm.webp", lighthouse: "/img/isle_lighthouse.webp", gold: "/img/isle_gold.webp",
  crown: "/img/isle_crown.webp", mystery: "/img/isle_mystery.webp"
};
const SHIP_ART = {
  galleon: { src: "/img/ship_galleon.webp", mast: 0.419, ratio: 1 },
  brig: { src: "/img/ship_brig.webp", mast: 0.344, ratio: 497 / 520 },
  sloop: { src: "/img/ship_sloop.webp", mast: 0.435, ratio: 491 / 520 }
};
const SHIP_NAMES = { galleon: "غليون", brig: "بريغ", sloop: "سلوب" };
const TICON = { shell: "/img/shell.webp", chest: "/img/chest.webp", crown: "/img/crown.webp" };
const PHASE_TEXT = { choosing: "مرحلة الاختيار", closed: "الاختيار مقفل", revealed: "كُشفت التحركات" };

const app = {
  st: null, me: null, spectate: false, built: false,
  view: { scale: 1, x: 0, y: 0, min: 0.2, max: 2.4 },
  seen: { reveal: null, whale: null, total: null },
  sheetKind: null, sheetArg: null
};
window.APP = app;

/* ───────── API ───────── */
async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json", "X-Requested-With": "arch" } : { "X-Requested-With": "arch" },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data.error || "صار خطأ، جرّب مرة ثانية"); e.status = res.status; throw e; }
  return data;
}
app.api = api;

/* ───────── Toasts ───────── */
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " is-" + kind : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 320); }, 2800);
}
app.toast = toast;

/* ───────── Flag (waving strips) ───────── */
function flagHTML(src, w, h, strips = 7, extraStyle = "") {
  let s = "";
  for (let i = 0; i < strips; i++) {
    const t = i / (strips - 1);            // 0 at pole (right), 1 at fly end
    const amp = (t * h * 0.07).toFixed(2);
    const sk = (t * 3).toFixed(2);
    s += `<i style="background-image:url('${esc(src)}');background-size:${w}px ${h}px;background-position:${(-(strips - 1 - i) * w / strips).toFixed(2)}px 0;--amp:${amp}px;--sk:${sk};animation-delay:${(-i * (1.1 / strips)).toFixed(3)}s"></i>`;
  }
  return `<div class="flag" style="width:${w}px;height:${h}px;${extraStyle}">${s}</div>`;
}
app.flagHTML = flagHTML;

function shipHTML(team, width, strips = 6) {
  const a = SHIP_ART[team.ship] || SHIP_ART.galleon;
  const fw = Math.round(width * 0.34), fh = Math.round(fw * 0.64);
  const mastX = width * a.mast;
  // flag streams to the left (toward stern) from the mast top
  const left = Math.round(mastX - fw), top = Math.round(width * 0.01);
  return `<img src="${a.src}" alt="" draggable="false">${flagHTML(team.flag, fw, fh, strips, `left:${left}px;top:${top}px`)}`;
}
app.shipHTML = shipHTML;

/* ───────── Boot ───────── */
async function boot() {
  bindLogin();
  bindGameChrome();
  try {
    app.st = await api("GET", "/api/state");
  } catch (e) {
    toast("ما قدرنا نوصل للسيرفر، نحاول مرة ثانية…", "err");
    setTimeout(boot, 3000);
    return;
  }
  app.me = app.st.me;
  hideSplash();
  if (app.me) enterGame();
  else if (sessionStorage.getItem("arch_spectate") === "1") { app.spectate = true; enterGame(); }
  else showLogin();
  startRealtime();
}
function hideSplash() { const s = $("#splash"); s.classList.add("is-done"); setTimeout(() => s.remove(), 600); }

/* ───────── Login / register ───────── */
function showLogin() {
  $("#view-login").hidden = false;
  $("#view-game").hidden = true;
  $("#view-admin").hidden = true;
}
function bindLogin() {
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => { x.classList.toggle("is-active", x === t); x.setAttribute("aria-selected", x === t); });
    $("#form-login").hidden = t.dataset.tab !== "login";
    $("#form-register").hidden = t.dataset.tab !== "register";
  }));
  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#login-name").value.trim(), pin = $("#login-pin").value;
    const errEl = $("#login-error");
    errEl.textContent = "";
    if (!name || !pin) { errEl.textContent = "اكتب اسم القرصان والرمز"; return; }
    const btn = $("#btn-login"); btn.disabled = true;
    try {
      await api("POST", "/api/login", { name, pin });
      $("#login-pin").value = "";
      await afterAuth();
    } catch (err) { errEl.textContent = err.message; shake($(".login-card")); }
    finally { btn.disabled = false; }
  });
  $("#form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#reg-error"); errEl.textContent = "";
    const body = { name: $("#reg-name").value.trim(), pin: $("#reg-pin").value, code: $("#reg-code").value.trim() };
    if (!/^[0-9]{4,8}$/.test(body.pin)) { errEl.textContent = "الرمز لازم يكون من ٤ إلى ٨ أرقام"; return; }
    const btn = e.submitter || $("#form-register .btn"); btn.disabled = true;
    try { await api("POST", "/api/register", body); await afterAuth(); toast("حيّاك في الطاقم يا قرصان!", "ok"); }
    catch (err) { errEl.textContent = err.message; shake($(".login-card")); }
    finally { btn.disabled = false; }
  });
  $("#btn-spectate").addEventListener("click", () => { sessionStorage.setItem("arch_spectate", "1"); app.spectate = true; enterGame(); });
}
function shake(el) { el.animate([{ transform: "translateX(0)" }, { transform: "translateX(-8px)" }, { transform: "translateX(8px)" }, { transform: "translateX(-5px)" }, { transform: "translateX(0)" }], { duration: 380, easing: "ease-out" }); }
async function afterAuth() {
  sessionStorage.removeItem("arch_spectate");
  app.spectate = false;
  app.st = await api("GET", "/api/state");
  app.me = app.st.me;
  app.seen.total = null;
  enterGame();
  if (app.me && app.me.role === "admin" && window.ADMIN) window.ADMIN.open();
}
async function logout() {
  try { await api("POST", "/api/logout", {}); } catch {}
  sessionStorage.removeItem("arch_spectate");
  app.me = null; app.spectate = false;
  closeSheet();
  $("#view-admin").hidden = true;
  app.st = await api("GET", "/api/state");
  showLogin();
}
app.logout = logout;

/* ───────── Game view ───────── */
function enterGame() {
  $("#view-login").hidden = true;
  $("#view-game").hidden = false;
  if (!app.built) { buildMap(); bindGestures(); app.built = true; requestAnimationFrame(() => initialView()); }
  app.seen.reveal = app.st.lastReveal ? app.st.lastReveal.seq : 0;
  app.seen.whale = app.st.whale.seq;
  renderAll(null);
  if (app.me && app.me.role === "admin" && window.ADMIN && !$("#view-admin").hidden) window.ADMIN.refresh();
}
app.enterGame = enterGame;

function myTeam() { return app.st && app.st.myTeam; }
function teamById(id) { return app.st.teams.find((t) => t.id === id); }
app.teamById = teamById;
function leaderId() { return app.st.leader; }

/* ───────── Map construction ───────── */
const svgNS = "http://www.w3.org/2000/svg";
function S(tag, attrs, parent) {
  const el = document.createElementNS(svgNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}
function arcPath(a0, a1, r, sweep) {
  const p0 = G.polar(a0, r), p1 = G.polar(a1, r);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} A${r},${r} 0 ${large} ${sweep} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
}
const FK = MAP.W / 1400; // scale factor vs the original 1400px chart
function buildMap() {
  const svg = $("#map-svg");
  svg.innerHTML = "";
  const defs = S("defs", {}, svg);
  const tints = { beginnings: ["#43e6c6", 0.26], danger: ["#3d8fe0", 0.22], edge: ["#f0c050", 0.2] };
  for (const [id, [c, o]] of Object.entries(tints)) {
    const g = S("radialGradient", { id: "tint-" + id, cx: MAP.CX, cy: MAP.CY, r: MAP.SEA_R, gradientUnits: "userSpaceOnUse" }, defs);
    S("stop", { offset: "0.25", "stop-color": c, "stop-opacity": 0 }, g);
    S("stop", { offset: "0.7", "stop-color": c, "stop-opacity": o * 0.6 }, g);
    S("stop", { offset: "1", "stop-color": c, "stop-opacity": o }, g);
  }
  const gold = S("linearGradient", { id: "goldLine", x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
  S("stop", { offset: "0", "stop-color": "#fff1b8" }, gold); S("stop", { offset: ".5", "stop-color": "#d9a033" }, gold); S("stop", { offset: "1", "stop-color": "#f6cf5f" }, gold);
  const clip = S("clipPath", { id: "seaClip" }, defs);
  S("circle", { cx: MAP.CX, cy: MAP.CY, r: MAP.SEA_R }, clip);

  const sea = S("g", { "clip-path": "url(#seaClip)" }, svg);
  // region tints
  for (const id of ["beginnings", "danger", "edge"]) {
    const r = REGIONS[id];
    const p0 = G.polar(r.a0, MAP.SEA_R + 4), p1 = G.polar(r.a1, MAP.SEA_R + 4);
    S("path", { d: `M${MAP.CX},${MAP.CY} L${p0.x},${p0.y} A${MAP.SEA_R + 4},${MAP.SEA_R + 4} 0 0 0 ${p1.x},${p1.y} Z`, fill: `url(#tint-${id})` }, sea);
  }
  // rhumb lines (old-map compass lines)
  const rh = S("g", { stroke: "#f6e3a8", "stroke-width": 1, opacity: 0.13 }, sea);
  for (let i = 0; i < 32; i++) { const p = G.polar(i * 11.25, MAP.SEA_R); S("line", { x1: MAP.CX, y1: MAP.CY, x2: p.x, y2: p.y }, rh); }
  S("circle", { cx: MAP.CX, cy: MAP.CY, r: MAP.SEA_R * 0.69, fill: "none", stroke: "#f6e3a8", "stroke-width": 1.5, "stroke-dasharray": "2 10", opacity: 0.35 }, sea);
  S("circle", { cx: MAP.CX, cy: MAP.CY, r: MAP.SEA_R * 0.93, fill: "none", stroke: "#f6e3a8", "stroke-width": 1, opacity: 0.25 }, sea);
  // sector dividers
  for (const id of ["beginnings", "danger", "edge"]) {
    const r = REGIONS[id];
    const a = G.polar(r.a0, 175 * FK), b = G.polar(r.a0, MAP.SEA_R);
    S("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#2a1606", "stroke-width": 7, opacity: 0.35, "stroke-linecap": "round" }, sea);
    S("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "url(#goldLine)", "stroke-width": 3, "stroke-dasharray": "14 10", "stroke-linecap": "round", opacity: 0.9 }, sea);
  }
  // curved region names on the parchment rim, like an old chart
  for (const id of ["beginnings", "danger", "edge"]) {
    const r = REGIONS[id];
    const mid = (r.a0 + r.a1) / 2;
    const upper = Math.sin((mid * Math.PI) / 180) > 0;
    const rr = upper ? MAP.SEA_R + 42 * FK : MAP.SEA_R + 58 * FK;
    const d = upper ? arcPath(mid + 40, mid - 40, rr, 1) : arcPath(mid - 40, mid + 40, rr, 0);
    S("path", { id: "arc-" + id, d, fill: "none" }, defs);
    for (const [stroke, sw, fill] of [["#f3e2bd", 8 * FK, "#f3e2bd"], [null, 0, "#4a2a0c"]]) {
      const t = S("text", { class: "region-arc", "text-anchor": "middle", fill, "dominant-baseline": "middle" }, svg);
      if (stroke) { t.setAttribute("stroke", stroke); t.setAttribute("stroke-width", sw); t.setAttribute("stroke-linejoin", "round"); }
      const tp = S("textPath", { href: "#arc-" + id, startOffset: "50%" }, t);
      tp.textContent = r.name;
    }
    // little gold diamonds flanking the name
    for (const off of [-19, 19]) {
      const p = G.polar(mid + off * (upper ? 1 : -1), rr);
      S("path", { d: `M${p.x},${p.y - 9 * FK} L${p.x + 7 * FK},${p.y} L${p.x},${p.y + 9 * FK} L${p.x - 7 * FK},${p.y} Z`, fill: r.color, stroke: "#4a2a0c", "stroke-width": 2 * FK }, svg);
    }
  }
  // compass rose (bottom-left corner)
  const cg = S("g", { transform: `translate(${150 * FK} ${MAP.H - 150 * FK}) scale(${FK})`, opacity: 0.9 }, svg);
  S("circle", { r: 78, fill: "rgba(90,55,18,.08)", stroke: "#6b4520", "stroke-width": 2 }, cg);
  S("circle", { r: 64, fill: "none", stroke: "#6b4520", "stroke-width": 1, "stroke-dasharray": "3 4" }, cg);
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0, L = long ? 70 : 42, w = long ? 11 : 7;
    const g = S("g", { transform: `rotate(${i * 45})` }, cg);
    S("path", { d: `M0,${-L} L${w},0 L0,0 Z`, fill: long ? "#7a4a1a" : "#a87a3a" }, g);
    S("path", { d: `M0,${-L} L${-w},0 L0,0 Z`, fill: long ? "#d9a033" : "#e8cf96" }, g);
  }
  S("circle", { r: 7, fill: "#d9a033", stroke: "#5a3712", "stroke-width": 2 }, cg);
  const n = S("text", { y: -86, "text-anchor": "middle", "font-family": "Lalezar", "font-size": 26, fill: "#5a3712" }, cg); n.textContent = "ش";
  // cartouche (top-right)
  const ct = S("g", { transform: `translate(${MAP.W - 195 * FK} ${122 * FK}) scale(${FK})` }, svg);
  S("path", { d: "M-128,-40 Q-140,-40 -140,-28 L-140,28 Q-140,40 -128,40 L128,40 Q140,40 140,28 L140,-28 Q140,-40 128,-40 Z", fill: "rgba(250,236,200,.75)", stroke: "#6b4520", "stroke-width": 2.5 }, ct);
  S("path", { d: "M-130,-31 L130,-31 M-130,31 L130,31", stroke: "#b8862a", "stroke-width": 1.2 }, ct);
  const t1 = S("text", { y: -2, "text-anchor": "middle", "font-family": "Lalezar", "font-size": 34, fill: "#4a2c0e" }, ct); t1.textContent = "أرخبيل الحروف";
  const t2 = S("text", { y: 24, "text-anchor": "middle", "font-family": "El Messiri", "font-weight": 700, "font-size": 15, fill: "#7a5428" }, ct); t2.textContent = "خريطة حروف مع عماد • ١٤٤٨";
  // corner ornaments
  const orn = (x, y, src, w) => { const im = S("image", { href: src, x: x - w / 2, y: y - w / 2, width: w, height: w, opacity: 0.85 }, svg); return im; };
  orn(118 * FK, 128 * FK, "/img/anchor.webp", 120 * FK);
  orn(MAP.W - 122 * FK, MAP.H - 132 * FK, "/img/chest.webp", 120 * FK);
  // waves & foam: little painted wave glyphs and foam rings in the open water (static = cheap)
  const wv = S("g", { fill: "none", stroke: "#e9fbff", "stroke-linecap": "round", opacity: 0.5 }, sea);
  let sd = 77;
  const rnd = () => { sd = (Math.imul(sd, 1103515245) + 12345) >>> 0; return sd / 4294967296; };
  const clearOf = (x, y, d) => ISLANDS.every((i) => Math.hypot(i.x - x, i.y - y) > d) && G.SCENERY.every((o) => Math.hypot(o.x - x, o.y - y) > d * 0.8);
  for (let n = 0, tries = 0; n < 70 && tries < 2000; tries++) {
    const p = G.polar(rnd() * 360, 240 + rnd() * (MAP.SEA_R - 300));
    if (!clearOf(p.x, p.y, 150)) continue;
    n++;
    const s = 0.8 + rnd() * 0.9, w = 26 * s;
    S("path", { d: `M${p.x - w},${p.y} q${w / 2},${-10 * s} ${w},0 t${w},0`, "stroke-width": 3.2 * s }, wv);
    if (n % 3 === 0) S("path", { d: `M${p.x - w * 0.6},${p.y + 14 * s} q${w * 0.3},${-7 * s} ${w * 0.6},0 t${w * 0.6},0`, "stroke-width": 2.4 * s, opacity: 0.7 }, wv);
  }
  for (const o of G.SCENERY) S("ellipse", { cx: o.x, cy: o.y + o.w * 0.18, rx: o.w * 0.62, ry: o.w * 0.24, fill: "none", stroke: "#f2fdff", "stroke-width": 3, "stroke-dasharray": "10 14", opacity: 0.35 }, sea);
  buildScenery();

  // islands
  const layer = $("#islands-layer");
  layer.innerHTML = "";
  for (const isle of ISLANDS) {
    const el = document.createElement("div");
    el.className = "island" + (isle.flip ? " flip" : "") + (isle.type === "rare" ? " is-rare" : "") + (isle.type === "mystery" ? " is-mystery" : "");
    el.dataset.id = isle.id;
    const w = isleW(isle);
    el.style.cssText = `left:${isle.x}px;top:${isle.y}px;width:${w}px`;
    el.innerHTML = `<img src="${ART[isle.art]}" alt="" draggable="false" loading="eager" decoding="async"><span class="island-label">${esc(isle.name)}</span>`;
    el.addEventListener("click", (e) => { if (dragGuard()) return; e.stopPropagation(); openIsland(isle.id); });
    layer.appendChild(el);
  }
}

function isleW(isle) { return isle.type === "mystery" ? 340 : isle.type === "rare" ? 200 : 180; }
const SCN_ART = { rocks: "/img/sc_rocks.webp", wreck: "/img/sc_wreck.webp", stacks: "/img/sc_stacks.webp", kraken: "/img/sc_kraken.webp", beacon: "/img/sc_beacon.webp", sandbar: "/img/sc_sandbar.webp" };
function buildScenery() {
  const layer = $("#scenery-layer");
  layer.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const o of G.SCENERY) {
    const el = document.createElement("div");
    el.className = `scn kind-${o.kind}${o.flip ? " flip" : ""}`;
    el.style.cssText = `left:${o.x}px;top:${o.y}px;width:${o.w}px`;
    el.innerHTML = `<img src="${SCN_ART[o.kind]}" alt="" draggable="false" decoding="async"${o.kind === "kraken" ? ' class="kraken-bob"' : ""}>`;
    frag.appendChild(el);
  }
  // sea mist banks (soft static gradients)
  let sd = 9;
  const rnd = () => { sd = (Math.imul(sd, 1103515245) + 12345) >>> 0; return sd / 4294967296; };
  for (let i = 0; i < 7; i++) {
    const p = G.polar(i * 51 + rnd() * 30, MAP.SEA_R * (0.55 + rnd() * 0.38));
    const m = document.createElement("div");
    m.className = "mist";
    const w = 420 + rnd() * 320;
    m.style.cssText = `left:${p.x}px;top:${p.y}px;width:${w}px;height:${w * 0.42}px`;
    frag.appendChild(m);
  }
  // seagull flocks drifting over the sea (transform-only animation)
  for (const [x, y, d] of [[MAP.CX + 820, MAP.CY - 760, 0], [MAP.CX + 300, MAP.CY + 140, -18], [MAP.CX + 900, MAP.CY + 380, -33]]) {
    const g = document.createElement("div");
    g.className = "gulls";
    g.style.cssText = `left:${x}px;top:${y}px;animation-delay:${d}s`;
    g.innerHTML = `<img src="/img/sc_gulls.webp" alt="" draggable="false" decoding="async">`;
    frag.appendChild(g);
  }
  layer.appendChild(frag);
  observeOffscreen($$(".gulls, .scn.kind-kraken", layer));
}
/* pause CSS animations of things that are off-screen */
let offIO = null;
function observeOffscreen(els) {
  if (!("IntersectionObserver" in window)) return;
  if (!offIO) offIO = new IntersectionObserver((ents) => { for (const e of ents) e.target.classList.toggle("off", !e.isIntersecting); }, { root: null, rootMargin: "80px" });
  els.forEach((el) => offIO.observe(el));
}

/* ───────── Rendering ───────── */
function renderAll(prev) {
  renderTop();
  renderIslands();
  renderWhale();
  renderShips(prev);
  renderRoute();
  renderHud();
  renderDock();
  if (app.sheetKind) refreshSheet();
}
app.renderAll = renderAll;

function renderTop() {
  const st = app.st;
  $("#day-text").textContent = window.innerWidth < 900 ? `اليوم ${arNum(st.day)}` : `اليوم ${arNum(st.day)} من رمضان`;
  $("#phase-text").textContent = PHASE_TEXT[st.phase] || "";
  const chip = $("#day-chip");
  chip.classList.toggle("is-closed", st.phase === "closed");
  chip.classList.toggle("is-revealed", st.phase === "revealed");
  const name = app.me ? app.me.name : "؟";
  $("#avatar").textContent = name.trim().charAt(0) || "ق";
  $("#zoom-me").hidden = !myTeam();
}

function renderIslands() {
  const st = app.st, mt = myTeam();
  for (const el of $$(".island")) {
    const isle = G.islandById(el.dataset.id);
    const visible = G.islandVisible(isle, st.day);
    el.classList.toggle("is-hidden-rare", !visible);
    el.classList.toggle("is-claimed", !!(st.islands[isle.id] && st.islands[isle.id].claimedBy));
    el.classList.toggle("is-here", !!(mt && mt.island === isle.id));
    const target = !!(mt && mt.move && mt.move.dest === isle.id && st.phase !== "revealed");
    el.classList.toggle("is-target", target);
    let ring = el.querySelector(".target-ring");
    if (target && !ring) { ring = document.createElement("div"); ring.className = "target-ring"; el.prepend(ring); }
    if (!target && ring) ring.remove();
  }
}

function whalePos() {
  const w = app.st.whale, r = REGIONS[w.region];
  const off = (w.angle % 2 === 0) ? 45 : 75;
  const p = G.polar(r.a0 + off, MAP.INNER_R * 0.62);
  return p;
}
function renderWhale() {
  const layer = $("#whale-layer");
  let el = layer.querySelector(".whale");
  if (!el) {
    el = document.createElement("div");
    el.className = "whale";
    el.innerHTML = `<img src="/img/whale.webp" alt="الحوت" draggable="false"><span class="whale-tag">الحوت</span>`;
    el.addEventListener("click", (e) => { if (dragGuard()) return; e.stopPropagation(); openWhale(); });
    layer.appendChild(el);
  }
  const p = whalePos();
  el.style.left = p.x + "px"; el.style.top = p.y + "px";
}

/* Ship placement: greedy, collision-aware. Each ship is docked beside its island
   at the candidate spot that overlaps least with islands, labels, the whale and
   ships already placed. Boxes assume the zoomed-out ship scale so the overview
   stays readable. */
const sgn = (v) => `\u200F${v > 0 ? "+" : "−"}\u200F`;
window.SGN = sgn;
function rectOverlap(a, b) {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}
const _mctx = document.createElement("canvas").getContext("2d");
function textW(str, font) { _mctx.font = font; return _mctx.measureText(str).width; }
function shipRect(x, y, name, k) {
  const nw = (textW(name, "900 15px Cairo") + 22) * k, hw = Math.max(42 * k, nw / 2);
  return { l: x - hw, r: x + hw, t: y - 64 * k, b: y + 46 * k };
}
function isleRects(isle, lk) {
  const w = isleW(isle), h = w * 0.92;
  const body = { l: isle.x - w * 0.36, r: isle.x + w * 0.36, t: isle.y - h * 0.34, b: isle.y + h * 0.3 };
  const el = document.querySelector(`.island[data-id="${isle.id}"]`), lb = el && el.querySelector(".island-label");
  const lw = (lb && lb.offsetWidth ? lb.offsetWidth : textW(isle.name, "800 15px Cairo") + 24) / 2;
  const ly = isle.y + (el && el.offsetHeight ? el.offsetHeight : h) / 2 - 14;
  const label = { l: isle.x - lw * lk, r: isle.x + lw * lk, t: ly, b: ly + (lb && lb.offsetHeight ? lb.offsetHeight : 28) * lk };
  return { body, label };
}
const SHIP_CANDS = (() => {
  const out = [];
  [[76, 4], [-76, 4], [62, -52], [-62, -52], [100, 50], [-100, 50]].forEach((c, i) => out.push([c[0], c[1], i * 0.4]));
  for (const r of [95, 125, 160]) for (let a = 0; a < 360; a += 20) {
    const rad = a * Math.PI / 180;
    out.push([Math.cos(rad) * r, Math.sin(rad) * r * 0.85, 1.2 + r / 80]);
  }
  return out;
})();
let shipLayoutCache = { key: "", pos: {} };
function layoutShips(teams) {
  const K = layoutK(), mt = myTeam(), target = mt && mt.move ? mt.move.dest : null;
  const key = teams.map((t) => t.id + ":" + t.island + ":" + t.name).join("|") + "|" + (app.st.whale ? app.st.whale.region + app.st.whale.angle : "") + "|" + K.key + "|" + (mt ? mt.island + target : "");
  if (shipLayoutCache.key === key) return shipLayoutCache.pos;
  const isles = ISLANDS.filter((i) => G.islandVisible(i, app.st.day)).map((i) => {
    const shown = !K.far || (mt && (mt.island === i.id || target === i.id)) || i.type === "mystery";
    return { i, shown, ...isleRects(i, K.label) };
  });
  const wp = app.st.whale ? whalePos() : null;
  const obstacles = [];
  if (wp) obstacles.push({ rc: { l: wp.x - 75, r: wp.x + 75, t: wp.y - 55, b: wp.y + 90 }, w: 3 });
  for (const o of G.SCENERY) obstacles.push({ rc: { l: o.x - o.w * 0.4, r: o.x + o.w * 0.4, t: o.y - o.w * 0.4, b: o.y + o.w * 0.35 }, w: 0.8 });
  const placed = [], pos = {};
  const order = [...teams].sort((a, b) => a.island.localeCompare(b.island) || a.id.localeCompare(b.id));
  for (const team of order) {
    const home = G.islandById(team.island) || G.islandById("marina");
    const k = (home.type === "mystery" ? 2.3 : 1.15) * Math.max(1, K.ship * 0.75);
    let best = null;
    for (const [dx, dy, pref] of SHIP_CANDS) {
      const x = home.x + dx * k, y = home.y + dy * k;
      const rc = shipRect(x, y, team.name, K.ship);
      let cost = pref * 2500;
      for (const o of isles) {
        const lab = o.shown ? rectOverlap(rc, o.label) * 6 : 0;
        cost += lab + rectOverlap(rc, o.body) * (o.i.id === home.id ? 0.1 : 0.6);
      }
      for (const o of obstacles) cost += rectOverlap(rc, o.rc) * o.w;
      for (const p of placed) cost += rectOverlap(rc, p) * 6;
      for (const [cx, cy] of [[rc.l, rc.t], [rc.r, rc.t], [rc.l, rc.b], [rc.r, rc.b], [x, rc.b]]) {
        const d = Math.hypot(cx - MAP.CX, cy - MAP.CY);
        if (d > MAP.SEA_R - 10) cost += (d - MAP.SEA_R + 10) * 300;
      }
      if (!best || cost < best.cost) best = { cost, x, y, rc };
    }
    placed.push(best.rc);
    pos[team.id] = { x: Math.round(best.x), y: Math.round(best.y) };
  }
  shipLayoutCache = { key, pos };
  return pos;
}
function shipPos(team, teams) { return layoutShips(teams)[team.id]; }
function renderShips(prev) {
  const layer = $("#ships-layer");
  const st = app.st, mt = myTeam(), lid = leaderId();
  const existing = new Map($$(".ship", layer).map((el) => [el.dataset.id, el]));
  const animate = [];
  for (const team of st.teams) {
    let el = existing.get(team.id);
    const key = team.ship + "|" + team.flag;
    if (!el) {
      el = document.createElement("div");
      el.className = "ship";
      el.dataset.id = team.id;
      el.innerHTML = `<div class="ship-body"><div class="ship-art"></div><div class="ship-name"><span class="nm"></span></div></div>`;
      el.querySelector(".ship-body").addEventListener("click", (e) => { if (dragGuard()) return; e.stopPropagation(); openShip(team.id); });
      layer.appendChild(el);
      observeOffscreen([el]);
    }
    existing.delete(team.id);
    if (el.dataset.key !== key) { el.querySelector(".ship-art").innerHTML = shipHTML(team, 84, 5); el.dataset.key = key; }
    el.querySelector(".ship-name .nm").textContent = team.name;
    el.classList.toggle("is-mine", !!(mt && mt.id === team.id));
    el.classList.toggle("is-leader", team.id === lid);
    const p = shipPos(team, st.teams);
    const prevTeam = prev && prev.teams.find((t) => t.id === team.id);
    if (prevTeam && prevTeam.island !== team.island && el.dataset.x) {
      animate.push({ el, from: { x: +el.dataset.x, y: +el.dataset.y }, to: p });
    } else if (!el.classList.contains("is-sailing")) {
      placeShip(el, p);
    }
    el.dataset.x = p.x; el.dataset.y = p.y;
  }
  existing.forEach((el) => el.remove());
  if (animate.length) sailAll(animate);
}
function placeShip(el, p) { el.style.left = p.x + "px"; el.style.top = p.y + "px"; }

function sailAll(list) {
  list.forEach((a, i) => setTimeout(() => sail(a.el, a.from, a.to), i * 220));
}
function sail(el, from, to) {
  const dur = 2600;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // curve bows away from the map center for a natural sea route
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  const ox = mx - MAP.CX, oy = my - MAP.CY, ol = Math.hypot(ox, oy) || 1;
  const bow = Math.min(160, len * 0.35);
  const c = { x: mx + (ox / ol) * bow, y: my + (oy / ol) * bow };
  el.classList.add("is-sailing");
  el.classList.toggle("face-left", dx < 0);
  const t0 = performance.now();
  let lastWake = 0;
  function frame(now) {
    const t = clamp((now - t0) / dur, 0, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const u = 1 - e;
    const x = u * u * from.x + 2 * u * e * c.x + e * e * to.x;
    const y = u * u * from.y + 2 * u * e * c.y + e * e * to.y;
    placeShip(el, { x, y });
    if (now - lastWake > 110 && t < 0.95) {
      lastWake = now;
      const w = document.createElement("div");
      w.className = "wake"; w.style.left = x + "px"; w.style.top = y + "px";
      $("#ships-layer").appendChild(w);
      setTimeout(() => w.remove(), 1400);
    }
    if (t < 1) requestAnimationFrame(frame);
    else { el.classList.remove("is-sailing", "face-left"); placeShip(el, to); }
  }
  requestAnimationFrame(frame);
}

function renderRoute() {
  const svg = $("#route-svg");
  svg.innerHTML = "";
  const mt = myTeam();
  if (!mt || !mt.move || app.st.phase === "revealed") return;
  const from = shipPos(mt, app.st.teams), isle = G.islandById(mt.move.dest);
  if (!isle) return;
  const mx = (from.x + isle.x) / 2, my = (from.y + isle.y) / 2;
  const ox = mx - MAP.CX, oy = my - MAP.CY, ol = Math.hypot(ox, oy) || 1;
  const bow = Math.min(140, Math.hypot(isle.x - from.x, isle.y - from.y) * 0.3);
  const c = { x: mx + (ox / ol) * bow, y: my + (oy / ol) * bow };
  S("path", { class: "route-path", d: `M${from.x},${from.y} Q${c.x},${c.y} ${isle.x},${isle.y}` }, svg);
}

const BOLT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2 4 14h7l-1.5 8L20 10h-7l.5-8z" fill="#7ff5de" stroke="#0b5e52" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
function energyHTML(n) {
  let bars = "";
  for (let i = 0; i < RULES.ENERGY_CAP; i++) bars += `<b class="${i < n ? "on" : ""}"></b>`;
  return `<span class="energy">${BOLT}<span class="num">${arNum(n)}</span><span class="energy-bar" aria-hidden="true">${bars}</span></span>`;
}
function treasuresHTML(tr, cls = "tr") {
  return ["shell", "chest", "crown"].map((k) => `<span class="${cls}" title="${G.TREASURE_NAMES[k]}"><img src="${TICON[k]}" alt="">${arNum(tr[k] || 0)}</span>`).join("");
}

function renderHud() {
  const hud = $("#hud"), st = app.st, mt = myTeam();
  hud.className = "hud panel";
  if (!mt) {
    if (app.me && app.me.role === "admin") {
      hud.innerHTML = `<div class="hud-spectate"><p>أنت القبطان. تحكم باليوم والذهب من اللوحة.</p><button class="btn btn-gold btn-sm" id="hud-admin">لوحة القبطان</button></div>`;
      $("#hud-admin").onclick = () => window.ADMIN && window.ADMIN.open();
    } else if (app.me) {
      hud.innerHTML = `<div class="hud-spectate"><p>حسابك ما انضم لطاقم بعد. كلّم عماد.</p><button class="btn btn-ghost btn-sm" id="hud-out">خروج</button></div>`;
      $("#hud-out").onclick = logout;
    } else {
      hud.innerHTML = `<div class="hud-spectate"><p>تتفرج على الخريطة. سجّل دخولك عشان تختار حركة طاقمك.</p><button class="btn btn-gold btn-sm" id="hud-login">دخول</button></div>`;
      $("#hud-login").onclick = () => { sessionStorage.removeItem("arch_spectate"); app.spectate = false; showLogin(); };
    }
    return;
  }
  const isle = G.islandById(mt.island);
  const isLeader = mt.id === leaderId();
  let action = "";
  if (st.phase === "choosing") {
    if (mt.move) {
      const d = G.islandById(mt.move.dest);
      action = `<div class="hud-note">وجهتكم: <b>${esc(d.name)}</b> • ${arNum(mt.move.cost)} طاقة • اختارها ${esc(mt.move.by)}</div>
        <div class="hud-action adm-row"><button class="btn btn-ghost" id="hud-change">غيّر الوجهة</button><button class="btn btn-ghost" id="hud-cancel">ابقَ مكانك</button></div>`;
    } else {
      action = `<div class="hud-action"><button class="btn btn-gold btn-lg" id="hud-choose">اختر وجهة اليوم</button></div>`;
    }
  } else if (st.phase === "closed") {
    action = `<div class="hud-note">الاختيار مقفل. ${mt.move ? `وجهتكم <b>${esc(G.islandById(mt.move.dest).name)}</b>،` : "ما اخترتوا حركة، بتبقى السفينة مكانها."} الكشف الساعة ٣ العصر.</div>`;
  } else {
    action = `<div class="hud-note">كُشفت تحركات اليوم. الاختيار الجاي يفتح مع اليوم ${arNum(Math.min(st.day + 1, RULES.DAYS))}.</div>`;
  }
  hud.innerHTML = `
    <div class="hud-row">
      <button class="hud-ship" id="hud-ship" aria-label="سفينتنا">${shipHTML(mt, 64, 4)}</button>
      <div class="hud-meta">
        <div class="hud-team ${isLeader ? "is-leader" : ""}">${esc(mt.name)}</div>
        <div class="hud-sub">مرساكم: ${esc(isle.name)} • ${esc(REGIONS[isle.region].name)}</div>
      </div>
      <div class="hud-gold"><div class="amt num"><img src="/img/coin.webp" alt="">${fmt(mt.total)}</div><div class="lbl">مجموع الذهب</div></div>
    </div>
    <div class="hud-stats">${energyHTML(mt.energy)}${treasuresHTML(mt.treasures)}</div>
    ${action}`;
  $("#hud-ship").onclick = () => openShip(mt.id);
  const ch = $("#hud-choose"); if (ch) ch.onclick = () => { toast("اضغط على أي جزيرة في الخريطة عشان تختارها"); fitView(true); };
  const chg = $("#hud-change"); if (chg) chg.onclick = () => toast("اضغط على الجزيرة الجديدة في الخريطة");
  const cn = $("#hud-cancel"); if (cn) cn.onclick = () => chooseMove(null);
  // gold change feedback
  if (app.seen.total != null && mt.total !== app.seen.total) {
    const diff = mt.total - app.seen.total;
    toast(`${sgn(diff)}${fmt(Math.abs(diff))} ذهب لطاقمكم`, diff > 0 ? "ok" : "err");
    if (diff > 0) coinBurst($(".hud-gold"));
  }
  app.seen.total = mt.total;
}
function renderDock() {
  const dock = $("#my-dock"), mt = myTeam();
  const hud = $("#hud");
  if (hud) document.documentElement.style.setProperty("--hud-h", hud.offsetHeight + "px");
  if (!mt) { dock.hidden = true; dock.dataset.sig = ""; return; }
  const sig = [mt.id, mt.name, mt.ship, mt.flag, mt.total].join("|");
  dock.hidden = false;
  if (dock.dataset.sig === sig) return;
  dock.dataset.sig = sig;
  dock.innerHTML = `<span class="dock-ship">${shipHTML(mt, 62, 4)}</span><span class="dock-txt"><span class="dock-tag">سفينتك</span><b>${esc(mt.name)}</b><span class="dock-gold num"><img src="/img/coin.webp" alt="">${fmt(mt.total)}</span></span>`;
}
function focusMyShip() {
  const mt = myTeam(); if (!mt) return;
  const p = shipPos(mt, app.st.teams);
  const a = mapArea();
  const s = Math.max(app.view.scale, window.innerWidth >= 900 ? 0.6 : 0.42);
  // on phones the ship sheet covers the lower half, so aim the ship into the upper part of the map
  focusWorld(p.x, p.y + (window.innerWidth < 900 ? (a.h * 0.22) / s : 0), s);
  openShip(mt.id);
}
app.focusMyShip = focusMyShip;

async function chooseMove(dest) {
  try {
    await api("POST", "/api/move", { dest });
    toast(dest ? `تم! وجهتكم ${G.islandById(dest).name}` : "تم إلغاء الحركة، بتبقون مكانكم", "ok");
    await refresh();
    closeSheet();
  } catch (e) { toast(e.message, "err"); }
}

/* ───────── Sheets ───────── */
function openSheet(kind, arg, html) {
  app.sheetKind = kind; app.sheetArg = arg;
  $("#sheet-body").innerHTML = html;
  $("#sheet-body").scrollTop = 0;
  const sc = $("#scrim"); sc.hidden = false; sc.classList.remove("is-leaving");
  const sh = $("#sheet"); sh.classList.add("is-open"); sh.setAttribute("aria-hidden", "false");
}
function closeSheet() {
  if (!app.sheetKind) return;
  app.sheetKind = null;
  const sh = $("#sheet"); sh.classList.remove("is-open"); sh.setAttribute("aria-hidden", "true");
  const sc = $("#scrim"); sc.classList.add("is-leaving"); setTimeout(() => { if (!app.sheetKind) sc.hidden = true; }, 250);
}
app.closeSheet = closeSheet;
function refreshSheet() {
  const k = app.sheetKind, a = app.sheetArg;
  const body = $("#sheet-body"), top = body.scrollTop;
  if (k === "island") body.innerHTML = islandHTML(a), bindIsland(a);
  else if (k === "ship") body.innerHTML = shipSheetHTML(a), bindShipSheet();
  else if (k === "board") body.innerHTML = boardHTML(), bindBoard();
  else if (k === "menu") body.innerHTML = menuHTML(), bindMenu();
  else if (k === "whale") body.innerHTML = whaleHTML();
  body.scrollTop = top;
}

function regionBadge(rid) { const r = REGIONS[rid]; return `<span class="badge badge-region" style="background:${r.color}">${esc(r.name)}</span>`; }

function islandHTML(id) {
  const isle = G.islandById(id), st = app.st, mt = myTeam();
  const reward = G.islandReward(isle);
  const claim = st.islands[id] && st.islands[id].claimedBy ? teamById(st.islands[id].claimedBy) : null;
  const here = st.teams.filter((t) => t.island === id);
  let sail = "";
  if (mt && mt.island !== id) {
    const cost = G.travelCost(mt.island, id);
    const can = st.phase === "choosing" && !isle.locked && cost <= mt.energy;
    const why = isle.locked ? "هذي الجزيرة مقفلة لين يكشف سرها عماد" : st.phase !== "choosing" ? "مرحلة الاختيار مقفلة الحين" : cost > mt.energy ? `الطاقة ما تكفي (عندكم ${arNum(mt.energy)})` : "";
    const chosen = mt.move && mt.move.dest === id;
    sail = `<div class="sail-box">
      <div class="row"><span>تكلفة الإبحار من ${esc(G.islandById(mt.island).name)}</span><span class="energy">${BOLT}<span class="num">${arNum(cost)}</span></span></div>
      ${chosen ? `<button class="btn btn-ghost btn-block" id="sail-cancel">هذي وجهتكم ✓ — إلغاء</button>` :
        `<button class="btn btn-teal btn-lg" id="sail-go" ${can ? "" : "disabled"}>أبحر إلى ${esc(isle.name)}</button>`}
      ${why && !chosen ? `<p class="muted" style="margin-top:8px;font-size:13px;font-weight:700;text-align:center">${why}</p>` : ""}
    </div>`;
  } else if (mt && mt.island === id) {
    sail = `<div class="sail-box"><div class="row" style="margin:0"><span>سفينتكم راسية هنا ⚓</span></div></div>`;
  }
  return `
    <div class="isle-hero"><img src="${ART[isle.art]}" class="${isle.flip ? "flip" : ""}" alt=""></div>
    <div class="sheet-kicker">${regionBadge(isle.region)} <span class="badge badge-type">${esc(G.TYPE_LABELS[isle.type])}</span></div>
    <h2 class="sheet-title" style="padding-left:0">${esc(isle.name)}</h2>
    <div class="kv">
      <div><dt>الجائزة</dt><dd style="font-size:14.5px">${esc(reward.label)}</dd></div>
      <div><dt>الحالة</dt><dd style="font-size:14.5px">${claim ? `أخذها ${esc(claim.name)}` : isle.type === "power" || isle.type === "rare" ? "الكنز ينتظر أول زائر" : isle.type === "trap" ? "الفخ جاهز" : "—"}</dd></div>
    </div>
    ${sail}
    <div class="paper lore">${esc(isle.lore)}</div>
    <div class="section-h">السفن الراسية</div>
    ${here.length ? `<div class="isle-ships">${here.map((t) => `<button data-ship="${t.id}"><img src="${esc(t.flag)}" alt="">${esc(t.name)}</button>`).join("")}</div>` : `<div class="empty" style="padding:10px">ما فيه سفن هنا الحين</div>`}`;
}
function bindIsland(id) {
  const go = $("#sail-go"); if (go) go.onclick = () => chooseMove(id);
  const c = $("#sail-cancel"); if (c) c.onclick = () => chooseMove(null);
  $$("[data-ship]", $("#sheet-body")).forEach((b) => b.onclick = () => openShip(b.dataset.ship));
}
function openIsland(id) {
  const isle = G.islandById(id);
  if (!G.islandVisible(isle, app.st.day)) return;
  openSheet("island", id, islandHTML(id)); bindIsland(id);
}

function shipSheetHTML(id) {
  const t = teamById(id), st = app.st, mt = myTeam();
  if (!t) return `<div class="empty">الطاقم غير موجود</div>`;
  const isLeader = t.id === leaderId();
  const rank = [...st.teams].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ar")).findIndex((x) => x.id === t.id) + 1;
  const isle = G.islandById(t.island);
  const mine = mt && mt.id === t.id;
  return `
    <div class="ship-hero">
      ${isLeader ? `<img class="anchor-badge" src="/img/anchor.webp" alt="المركز الأول">` : ""}
      <div class="big-ship">${shipHTML(t, 250, 16)}</div>
    </div>
    <div class="ship-title">
      <div class="sheet-kicker">${isLeader ? "👑 صاحب المركز الأول — مستهدف للغزو" : `المركز ${arNum(rank)}`}${mine ? " • طاقمك" : ""}</div>
      <h2 class="${isLeader ? "is-leader" : ""}">${esc(t.name)}</h2>
      <p>${t.members.length ? t.members.map(esc).join(" و ") : "بدون أعضاء بعد"} • ${SHIP_NAMES[t.ship] || ""}</p>
    </div>
    <div class="kv">
      <div><dt>مجموع الذهب</dt><dd class="num"><img src="/img/coin.webp" alt="">${fmt(t.total)}</dd></div>
      <div><dt>العملات</dt><dd class="num">${fmt(t.coins)}</dd></div>
      <div><dt>المرسى</dt><dd style="font-size:15px">${esc(isle.name)}</dd></div>
      <div><dt>المنطقة</dt><dd style="font-size:15px">${esc(REGIONS[isle.region].name)}</dd></div>
      ${mine ? `<div><dt>الطاقة</dt><dd>${energyHTML(mt.energy)}</dd></div><div><dt>حركة اليوم</dt><dd style="font-size:15px">${mt.move ? esc(G.islandById(mt.move.dest).name) : "ما فيه"}</dd></div>` : ""}
    </div>
    <div class="section-h">الخزينة</div>
    <div class="treasure-row">
      ${["shell", "chest", "crown"].map((k) => `<div class="treasure-card ${t.treasures[k] ? "" : "is-empty"}"><img src="${TICON[k]}" alt=""><b class="num">${arNum(t.treasures[k] || 0)}</b><span>${G.TREASURE_NAMES[k]}<br>${fmt(RULES.TREASURE[k])}</span></div>`).join("")}
    </div>
    ${mine ? `<div class="section-h">سجل طاقمكم</div>${logHTML(app.st.myLog || [])}` : ""}`;
}
function bindShipSheet() {}
function openShip(id) { openSheet("ship", id, shipSheetHTML(id)); }

function logIcon(l) {
  if (l.treasure) return `<img src="${TICON[l.treasure]}" alt="">`;
  if (l.type === "move" || l.type === "choice") return "⛵";
  if (l.type === "trap") return "☠️";
  if (l.type === "whale") return `<img src="/img/whale.webp" alt="">`;
  if (l.coins) return `<img src="/img/coin.webp" alt="">`;
  if (l.energy) return "⚡";
  return "📜";
}
function logHTML(list) {
  if (!list.length) return `<div class="empty">ما فيه شي بالسجل للحين</div>`;
  return `<ul class="log">${list.map((l) => {
    let amt = "";
    if (l.coins) amt = `<span class="amt ${l.coins > 0 ? "pos" : "neg"} num">${sgn(l.coins)}${fmt(Math.abs(l.coins))}</span>`;
    else if (l.treasure) amt = `<span class="amt ${l.tcount > 0 ? "pos" : "neg"} num">${sgn(l.tcount)}${fmt(Math.abs(l.tcount) * RULES.TREASURE[l.treasure])}</span>`;
    else if (l.energy) amt = `<span class="amt ${l.energy > 0 ? "pos" : "neg"} num">${sgn(l.energy)}${arNum(Math.abs(l.energy))}⚡</span>`;
    const d = new Date(l.ts);
    return `<li><span class="ico">${logIcon(l)}</span><span class="txt">${esc(l.note)}<small>اليوم ${arNum(l.day)} • ${d.toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" })}</small></span>${amt}</li>`;
  }).join("")}</ul>`;
}
app.logHTML = logHTML;

function boardHTML() {
  const st = app.st, mt = myTeam();
  const sorted = [...st.teams].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ar"));
  const rows = sorted.map((t, i) => {
    const r = i + 1;
    const rank = r === 1 ? `<span class="rank"><img src="/img/anchor.webp" alt="١"></span>` : `<span class="rank r${r}">${arNum(r)}</span>`;
    return `<li class="board-row ${r === 1 ? "is-first" : ""} ${mt && mt.id === t.id ? "is-mine" : ""}" data-team="${t.id}" style="animation-delay:${i * 60}ms">
      ${rank}
      <div class="row-flag">${flagHTML(t.flag, 52, 36, 8)}</div>
      <div class="row-names"><b>${esc(t.name)}</b><span>${t.members.map(esc).join(" و ") || "—"}</span>
        <div class="row-tr">${["shell", "chest", "crown"].filter((k) => t.treasures[k]).map((k) => `<i><img src="${TICON[k]}" alt="">${arNum(t.treasures[k])}</i>`).join("")}</div></div>
      <div class="row-gold"><b class="num">${fmt(t.total)}<img src="/img/coin.webp" alt=""></b><span>ذهب</span></div>
    </li>`;
  }).join("");
  const guests = (st.guests || []).slice().reverse();
  return `
    <div class="board-head"><img src="/img/coin.webp" alt=""><div><div class="sheet-kicker">اليوم ${arNum(st.day)} من رمضان</div><h2 class="gold-text">الليدر بورد</h2></div></div>
    <ol class="board-list">${rows}</ol>
    <p class="muted" style="font-size:12.5px;font-weight:700;margin-top:12px;line-height:1.7">المجموع = العملات + قيمة الكنوز (الصدفة ${fmt(RULES.TREASURE.shell)} • الصندوق ${fmt(RULES.TREASURE.chest)} • التاج ${fmt(RULES.TREASURE.crown)})</p>
    ${guests.length ? `<div class="section-h">ضيوف حروف</div><div class="guests">${guests.map((g) => `<div><span>${esc(g.name)} • اليوم ${arNum(g.day)}</span><span class="num">+${fmt(g.gold)}</span></div>`).join("")}</div>` : ""}`;
}
function bindBoard() { $$("[data-team]", $("#sheet-body")).forEach((r) => r.onclick = () => openShip(r.dataset.team)); }
function openBoard() { openSheet("board", null, boardHTML()); bindBoard(); }

function menuHTML() {
  const me = app.me, mt = myTeam();
  if (!me) return `<h2 class="sheet-title">أهلاً بك</h2><p class="muted" style="margin:8px 0 16px;font-weight:700">أنت تتفرج على الخريطة.</p><button class="btn btn-gold btn-lg" id="m-login">دخول</button>`;
  return `
    <div class="menu-card" style="margin-top:44px"><span class="avatar">${esc(me.name.charAt(0))}</span><div><b style="font-family:var(--display);font-size:22px;font-weight:400">${esc(me.name)}</b><div class="muted" style="font-weight:700;font-size:14px">${me.role === "admin" ? "القبطان" : mt ? "طاقم " + esc(mt.name) : "بدون طاقم"}</div></div></div>
    <div class="menu-list">
      ${me.role === "admin" ? `<button class="btn btn-gold btn-lg" id="m-admin">لوحة القبطان</button>` : ""}
      ${mt ? `<button class="btn btn-ghost btn-lg" id="m-ship">سفينتنا وسجلنا</button>` : ""}
      <button class="btn btn-ghost btn-lg" id="m-board">الليدر بورد</button>
      <button class="btn btn-ghost btn-lg" id="m-rules">القوانين باختصار</button>
      <button class="btn btn-danger btn-lg" id="m-logout">تسجيل خروج</button>
    </div>`;
}
function bindMenu() {
  const b = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  b("#m-login", () => { closeSheet(); sessionStorage.removeItem("arch_spectate"); showLogin(); });
  b("#m-admin", () => { closeSheet(); window.ADMIN && window.ADMIN.open(); });
  b("#m-ship", () => openShip(myTeam().id));
  b("#m-board", openBoard);
  b("#m-rules", openRules);
  b("#m-logout", logout);
}
function openMenu() { openSheet("menu", null, menuHTML()); bindMenu(); }
function openRules() {
  openSheet("rules", null, `
    <h2 class="sheet-title">القوانين باختصار</h2>
    <div class="paper lore" style="font-family:var(--body);font-size:14.5px">
      <b>سؤال اليوم:</b> أول جواب صح ${fmt(RULES.FIRST_CORRECT)} ذهب و٥ طاقة، الجواب الصح ${fmt(RULES.CORRECT)} و٣ طاقة، المحاولة الغلط ${fmt(RULES.WRONG)} وطاقة وحدة.<br>
      <b>الإبحار:</b> نفس المنطقة ٢ طاقة، منطقة مجاورة ٣، من بحر البدايات لحافة العالم ٤. حركة وحدة باليوم قبل ٢:٣٠ العصر، وكل الحركات تنكشف مع بعض الساعة ٣.<br>
      <b>الطاقة:</b> حدها ١٢ والزيادة تضيع.<br>
      <b>الكنوز:</b> الصدفة ${fmt(RULES.TREASURE.shell)}، الصندوق ${fmt(RULES.TREASURE.chest)}، التاج ${fmt(RULES.TREASURE.crown)}. أول من يرسى على جزيرة قدرة ياخذ كنزها.<br>
      <b>الحوت:</b> يظهر كل يوم بمنطقة، وسفينة وحدة عشوائية من سفن المنطقة تفوز بكنز صدفة.<br>
      <b>الفخ:</b> أول زائر يخسر طاقة.<br>
      <b>الترتيب:</b> بمجموع الذهب (عملات + كنوز). الأول اسمه يلمع ذهبي… ويصير هدف للكل.
    </div>`);
}

function whaleHTML() {
  const w = app.st.whale, r = REGIONS[w.region];
  const pool = app.st.teams.filter((t) => G.islandById(t.island).region === w.region);
  const winner = w.result && w.result.day === app.st.day && w.result.teamId ? teamById(w.result.teamId) : null;
  return `
    <div class="isle-hero"><img src="/img/whale.webp" alt=""></div>
    <div class="sheet-kicker">${regionBadge(w.region)}</div>
    <h2 class="sheet-title" style="padding-left:0">حوت اليوم</h2>
    <p class="muted" style="font-weight:700;line-height:1.8">ظهر الحوت في <b style="color:var(--text)">${esc(r.name)}</b>. كل السفن الراسية في هالمنطقة تدخل القرعة، وفائز واحد ياخذ <b style="color:var(--gold-2)">كنز صدفة ${fmt(RULES.TREASURE.shell)}</b>.</p>
    ${winner ? `<div class="sail-box" style="text-align:center;font-weight:900;font-size:17px">🐋 فاز بالقرعة: <span class="gold-text">${esc(winner.name)}</span></div>` : ""}
    <div class="section-h">السفن في القرعة (${arNum(pool.length)})</div>
    ${pool.length ? `<div class="isle-ships">${pool.map((t) => `<button data-ship="${t.id}"><img src="${esc(t.flag)}" alt="">${esc(t.name)}</button>`).join("")}</div>` : `<div class="empty">ما فيه سفن في هالمنطقة الحين</div>`}`;
}
function openWhale() { openSheet("whale", null, whaleHTML()); $$("[data-ship]", $("#sheet-body")).forEach((b) => b.onclick = () => openShip(b.dataset.ship)); }

/* ───────── Cinematics ───────── */
function banner(text) {
  const c = $("#cinema"); c.hidden = false;
  const b = document.createElement("div"); b.className = "cinema-banner"; b.textContent = text;
  c.appendChild(b);
  setTimeout(() => { b.remove(); if (!c.children.length) c.hidden = true; }, 2500);
}
function whaleCinema(team) {
  const c = $("#cinema"); c.hidden = false;
  const card = document.createElement("div");
  card.className = "cinema-card paper";
  card.innerHTML = team
    ? `<img class="whale-img" src="/img/whale.webp" alt=""><h3>الحوت اختار!</h3><p>كنز صدفة <b>${fmt(RULES.TREASURE.shell)}</b> ذهب يروح لـ</p><h3 style="margin-top:4px;color:#7a4a0e">${esc(team.name)}</h3><button class="btn btn-gold btn-lg" style="margin-top:14px">يا سلام!</button>`
    : `<img class="whale-img" src="/img/whale.webp" alt=""><h3>الحوت غاص…</h3><p>ما كان فيه سفن في المنطقة، فراح الكنز مع الحوت.</p><button class="btn btn-gold btn-lg" style="margin-top:14px">حسافة</button>`;
  c.appendChild(card);
  if (team) setTimeout(() => coinBurst(card), 500);
  const close = () => { card.classList.add("is-leaving"); setTimeout(() => { card.remove(); if (!c.children.length) c.hidden = true; }, 340); };
  card.querySelector("button").onclick = close;
  setTimeout(close, 7000);
}
function coinBurst(target) {
  if (!target) return;
  const r = target.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 14; i++) {
    const c = document.createElement("img");
    c.src = "/img/coin.webp"; c.className = "coin-burst"; c.alt = "";
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
    c.style.cssText = `left:${cx}px;top:${cy}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--rot:${(Math.random() * 720 - 360) | 0}deg;animation-delay:${i * 30}ms`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1600);
  }
}

/* ───────── Realtime ───────── */
let refreshing = null, pendingRefresh = false;
async function refresh() {
  if (refreshing) { pendingRefresh = true; return refreshing; }
  refreshing = (async () => {
    try {
      const prev = app.st;
      const next = await api("GET", "/api/state");
      app.st = next;
      const wasMe = app.me && app.me.id;
      app.me = next.me;
      if (wasMe && !app.me) { toast("انتهت الجلسة، سجّل دخولك مرة ثانية", "err"); showLogin(); return; }
      if ($("#view-game").hidden) return;
      // Nothing changed? Don't touch the DOM (this is what caused the periodic flicker on phones).
      const sig = JSON.stringify(next);
      if (sig === app.lastSig) return;
      app.lastSig = sig;
      renderAll(prev);
      // cinematic triggers
      if (next.lastReveal && next.lastReveal.seq !== app.seen.reveal) {
        app.seen.reveal = next.lastReveal.seq;
        banner(`كُشفت تحركات اليوم ${arNum(next.lastReveal.day)}!`);
        if (window.innerWidth < 900) fitView(true);
      }
      if (next.whale.seq !== app.seen.whale) {
        app.seen.whale = next.whale.seq;
        if (next.whale.result) setTimeout(() => whaleCinema(next.whale.result.teamId ? teamById(next.whale.result.teamId) : null), 300);
      }
      if (window.ADMIN && !$("#view-admin").hidden) window.ADMIN.refresh();
    } catch (e) { /* network hiccup: next tick will retry */ }
    finally {
      refreshing = null;
      if (pendingRefresh) { pendingRefresh = false; refresh(); }
    }
  })();
  return refreshing;
}
app.refresh = refresh;
function startRealtime() {
  let es = null, lastV = app.st ? app.st.v : 0;
  const connect = () => {
    try {
      es = new EventSource("/api/events");
      es.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (d.v !== lastV) { lastV = d.v; if (!app.st || d.v !== app.st.v) refresh(); } } catch {} };
      es.onerror = () => { /* browser auto-reconnects */ };
    } catch {}
  };
  connect();
  // safety net: polling (also covers proxies that buffer SSE)
  setInterval(() => { if (!document.hidden && !isMoving()) refresh(); }, 8000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}

/* ───────── Pan / zoom ───────── */
let moved = false, movedAt = 0;
function dragGuard() { return moved || performance.now() - movedAt < 120; }
const SHIP_MAX = 2.4, LABEL_MAX = 2.6, FAR_AT = 0.22;
let viewRaf = 0, lastVars = "", movingT = 0;
function isMoving() { return $("#world").classList.contains("is-moving"); }
function markMoving() {
  const w = $("#world");
  if (!w.classList.contains("is-moving")) w.classList.add("is-moving");
  clearTimeout(movingT);
  movingT = setTimeout(() => { w.classList.remove("is-moving"); applyVars(); }, 220);
}
// Gesture frames are coalesced into one write per animation frame.
function scheduleView() {
  markMoving();
  if (viewRaf) return;
  viewRaf = requestAnimationFrame(() => { viewRaf = 0; applyView(); });
}
function applyView() {
  const v = app.view, w = $("#world");
  w.style.transform = `translate3d(${v.x.toFixed(1)}px, ${v.y.toFixed(1)}px, 0) scale(${v.scale.toFixed(4)})`;
  // the size-compensation variables restyle every island/ship, so only change them in coarse steps
  // and never mid-gesture (that was the main source of jank while pinching)
  if (!isMoving()) applyVars();
}
function applyVars() {
  const w = $("#world"), lk = layoutK();
  const key = lk.ship + "/" + lk.label + "/" + lk.far;
  if (key !== lastVars) {
    lastVars = key;
    w.style.setProperty("--ship-k", lk.ship);
    w.style.setProperty("--label-k", lk.label);
    w.classList.toggle("is-far", lk.far);
  }
  if (app.st && lk.key !== lastLayoutK) { lastLayoutK = lk.key; clearTimeout(applyView.t); applyView.t = setTimeout(() => renderShips(null), 120); }
}
let lastLayoutK = "";
const shipBase = () => (window.innerWidth >= 900 ? 0.55 : 0.5);
function layoutK() {
  const sc = app.view ? app.view.scale : 0.4;
  const ship = Math.round(clamp(shipBase() / sc, 1, SHIP_MAX) * 10) / 10, label = Math.round(clamp(0.8 / sc, 1, LABEL_MAX) * 5) / 5;
  return { ship, label, far: sc < FAR_AT, key: ship + "/" + label + "/" + (sc < FAR_AT) };
}
function mapArea() {
  const vp = $("#viewport");
  const vw = vp.clientWidth, vh = vp.clientHeight;
  const desktop = vw >= 900;
  const top = desktop ? 80 : 86 + parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top") || 0);
  const hud = $("#hud");
  const bottom = desktop ? 20 : (hud ? hud.offsetHeight + 16 : 180);
  const right = desktop && hud ? 416 : 0;
  return { vw: vw - right, vh, top, bottom, h: vh - top - bottom };
}
function fitView(anim) {
  const a = mapArea(), v = app.view;
  const target = (window.innerWidth >= 900 ? 1340 : 1250) * FK;
  const s = Math.min(a.vw / target, a.h / target);
  v.min = s * 0.9;
  v.max = Math.max(1.6, s * 5);
  v.scale = s;
  v.x = (a.vw - MAP.W * s) / 2;
  v.y = a.top + (a.h - MAP.H * s) / 2;
  setAnim(anim); applyView();
}
app.fitView = fitView;
function setAnim(on) {
  const w = $("#world");
  if (on) { w.classList.add("is-anim"); clearTimeout(setAnim.t); setAnim.t = setTimeout(() => w.classList.remove("is-anim"), 650); }
  else w.classList.remove("is-anim");
}
function clampView() {
  const a = mapArea(), v = app.view;
  const w = MAP.W * v.scale, h = MAP.H * v.scale;
  const mx = a.vw * 0.45, my = a.h * 0.45;
  v.x = clamp(v.x, a.vw - w - mx, mx);
  v.y = clamp(v.y, a.top + a.h - h - my, a.top + my);
}
function zoomAt(cx, cy, ns, anim) {
  const v = app.view;
  ns = clamp(ns, v.min, v.max);
  v.x = cx - (cx - v.x) * (ns / v.scale);
  v.y = cy - (cy - v.y) * (ns / v.scale);
  v.scale = ns;
  clampView(); setAnim(anim);
  if (anim) applyView(); else scheduleView();
}
// Opening view: phones start zoomed in on your own ship (or the map centre), not the tiny whole-map overview.
function initialView() {
  fitView(false);
  const mt = myTeam(), a = mapArea();
  if (window.innerWidth >= 900) {
    if (mt) { const p = shipPos(mt, app.st.teams); focusWorld(p.x, p.y, app.view.scale * 1.5, false); }
    return;
  }
  const s = a.vw / 1100;
  if (mt) { const p = shipPos(mt, app.st.teams); focusWorld(p.x, p.y, s, false); }
  else focusWorld(MAP.CX, MAP.CY, a.vw / 1500, false);
}
app.initialView = initialView;
function focusWorld(x, y, s, anim = true) {
  const a = mapArea(), v = app.view;
  v.scale = clamp(s, v.min, v.max);
  v.x = a.vw / 2 - x * v.scale;
  v.y = a.top + a.h / 2 - y * v.scale;
  clampView(); setAnim(anim); applyView();
}
app.focusWorld = focusWorld;
function bindGestures() {
  const vp = $("#viewport");
  const pts = new Map();
  let last = null, pinch = null, downAt = null, lastTap = 0;
  vp.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; downAt = { x: e.clientX, y: e.clientY }; moved = false; }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: app.view.scale }; }
  });
  window.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = vp.getBoundingClientRect();
      zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, pinch.s * (d / pinch.d));
      moved = true;
    } else if (pts.size === 1 && last) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (!moved && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 7) return;
      if (!moved) { moved = true; vp.classList.add("is-panning"); try { vp.setPointerCapture(e.pointerId); } catch {} }
      app.view.x += dx; app.view.y += dy; last = { x: e.clientX, y: e.clientY };
      clampView(); scheduleView();
    }
  }, { passive: true });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const p = [...pts.values()][0]; last = { x: p.x, y: p.y }; }
    if (pts.size === 0) {
      vp.classList.remove("is-panning");
      if (moved) movedAt = performance.now();
      else if (e.pointerType === "touch" && e.target.closest(".viewport") && !e.target.closest(".island,.ship-body,.whale")) {
        const t = performance.now();
        if (t - lastTap < 300) { const rect = vp.getBoundingClientRect(); zoomAt(e.clientX - rect.left, e.clientY - rect.top, app.view.scale * 1.8, true); lastTap = 0; }
        else lastTap = t;
      }
      setTimeout(() => { moved = false; }, 0);
    }
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = vp.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, app.view.scale * f);
  }, { passive: false });
  vp.addEventListener("dblclick", (e) => { if (e.target.closest(".island,.ship-body,.whale")) return; const rect = vp.getBoundingClientRect(); zoomAt(e.clientX - rect.left, e.clientY - rect.top, app.view.scale * 1.8, true); });
  // Phones fire resize when the URL bar shows/hides: only re-fit on a real width change, otherwise just keep the view in bounds.
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    clearTimeout(bindGestures.rt);
    bindGestures.rt = setTimeout(() => {
      const v = app.view, a = mapArea();
      if (Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; fitView(false); return; }
      const t = (window.innerWidth >= 900 ? 1340 : 1250) * FK;
      v.min = Math.min(a.vw / t, a.h / t) * 0.9;
      clampView(); applyView();
    }, 150);
  });
}

function bindGameChrome() {
  $("#btn-board").addEventListener("click", openBoard);
  $("#btn-menu").addEventListener("click", openMenu);
  $("#zoom-in").addEventListener("click", () => { const a = mapArea(); zoomAt(a.vw / 2, a.top + a.h / 2, app.view.scale * 1.5, true); });
  $("#zoom-out").addEventListener("click", () => { const a = mapArea(); zoomAt(a.vw / 2, a.top + a.h / 2, app.view.scale / 1.5, true); });
  $("#zoom-fit").addEventListener("click", () => fitView(true));
  $("#zoom-me").addEventListener("click", () => { const mt = myTeam(); if (!mt) return; const p = shipPos(mt, app.st.teams); focusWorld(p.x, p.y, Math.max(app.view.scale, window.innerWidth >= 900 ? 0.6 : 0.45)); });
  $("#my-dock").addEventListener("click", focusMyShip);
  $("#scrim").addEventListener("click", closeSheet);
  $("#sheet-close").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  // swipe down to close sheet (mobile)
  const sheet = $("#sheet"); let sy = null;
  sheet.addEventListener("touchstart", (e) => { if ($("#sheet-body").scrollTop <= 0) sy = e.touches[0].clientY; else sy = null; }, { passive: true });
  sheet.addEventListener("touchmove", (e) => { if (sy == null || window.innerWidth >= 900) return; const dy = e.touches[0].clientY - sy; if (dy > 0) sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sheet.addEventListener("touchend", (e) => { if (sy == null) return; const dy = (e.changedTouches[0].clientY - sy); sheet.style.transform = ""; if (dy > 110) closeSheet(); sy = null; });
}

app.openShip = (id) => openShip(id);
app.openBoard = openBoard;
app.showLogin = showLogin;
document.addEventListener("DOMContentLoaded", boot);
})();
