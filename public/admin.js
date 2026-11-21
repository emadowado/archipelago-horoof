/* أرخبيل الحروف — لوحة القبطان (عماد) */
(() => {
"use strict";
const G = window.GAME;
const { RULES, REGIONS } = G;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = G.fmt;
const arNum = (n) => Number(n).toLocaleString("ar-SA");
const A = { tab: "day", data: null, results: {}, busy: false };
const TICON = { shell: "/img/shell.webp", chest: "/img/chest.webp", crown: "/img/crown.webp" };
const SHIP_NAMES = { galleon: "غليون (٣ صواري)", brig: "بريغ (صاريين)", sloop: "سلوب (صاري واحد)" };

const api = (...a) => window.APP.api(...a);
const toast = (...a) => window.APP.toast(...a);

async function load() { A.data = await api("GET", "/api/admin/full"); }
async function act(url, body, okMsg) {
  if (A.busy) return false;
  A.busy = true;
  try {
    await api("POST", url, body || {});
    if (okMsg) toast(okMsg, "ok");
    await load();
    await window.APP.refresh();
    render();
    return true;
  } catch (e) { toast(e.message, "err"); return false; }
  finally { A.busy = false; }
}

async function open() {
  const v = $("#view-admin");
  v.hidden = false;
  v.innerHTML = `<div class="adm"><div class="empty">جاري التحميل…</div></div>`;
  try { await load(); render(); } catch (e) { toast(e.message, "err"); close(); }
}
function close() { $("#view-admin").hidden = true; window.APP.fitView(false); }
async function refresh() { if ($("#view-admin").hidden || A.busy) return; try { await load(); render(true); } catch {} }

const TABS = [["day", "اليوم والحركات"], ["answers", "نتائج السؤال"], ["gold", "الذهب والكنوز"], ["teams", "الطواقم"], ["players", "اللاعبين"], ["log", "السجل"]];
function render(soft) {
  const v = $("#view-admin");
  const focused = document.activeElement && v.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if (soft && focused) return; // don't clobber what Emad is typing
  const scroll = v.scrollTop;
  v.innerHTML = `<div class="adm">
    <div class="adm-top"><h1>لوحة القبطان</h1><button class="btn btn-ghost btn-sm" id="adm-map">الخريطة</button><button class="btn btn-ghost btn-sm" id="adm-out">خروج</button></div>
    <nav class="adm-tabs">${TABS.map(([k, l]) => `<button class="adm-tab ${A.tab === k ? "is-active" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav>
    <div id="adm-body">${({ day: dayTab, answers: answersTab, gold: goldTab, teams: teamsTab, players: playersTab, log: logTab })[A.tab]()}</div>
  </div>`;
  $("#adm-map").onclick = close;
  $("#adm-out").onclick = () => window.APP.logout();
  $$(".adm-tab", v).forEach((b) => b.onclick = () => { A.tab = b.dataset.tab; render(); v.scrollTop = 0; });
  ({ day: bindDay, answers: bindAnswers, gold: bindGold, teams: bindTeams, players: bindPlayers, log: () => {} })[A.tab]();
  if (soft) v.scrollTop = scroll;
}

/* ─── Day tab ─── */
function dayTab() {
  const d = A.data;
  const moved = d.teams.filter((t) => t.move).length;
  const phaseLbl = { choosing: "🟢 مرحلة الاختيار مفتوحة", closed: "🟠 الاختيار مقفل — جاهز للكشف", revealed: "🟡 التحركات مكشوفة" }[d.phase];
  const w = d.whale;
  const inRegion = d.teams.filter((t) => G.islandById(t.island).region === w.region);
  const winner = w.result && w.result.day === d.day && w.result.teamId ? d.teams.find((t) => t.id === w.result.teamId) : null;
  return `
  <section class="panel adm-card">
    <h2>اليوم الحالي</h2>
    <div class="adm-row" style="justify-content:space-between">
      <div class="stepper"><button id="d-minus" aria-label="اليوم السابق">−</button><span class="val num">${arNum(d.day)}</span><button id="d-plus" aria-label="اليوم التالي">+</button></div>
      <span class="status-pill">${phaseLbl}</span>
    </div>
    <p class="hint" style="margin-top:10px">الجزيرة الذهبية تظهر يوم ٩، وجزيرة التيجان يوم ١٢ تلقائياً.</p>
  </section>
  <section class="panel adm-card">
    <h2>الحركات</h2>
    <p class="hint">اختار ${arNum(moved)} من ${arNum(d.teams.length)} طواقم وجهتهم. الترتيب الصحيح: اعتمد نتائج السؤال ← اقفل الاختيار ← اكشف ← ابدأ اليوم الجاي.</p>
    <div class="adm-grid">
      <button class="btn btn-ghost" id="p-open" ${d.phase === "choosing" ? "disabled" : ""}>افتح الاختيار</button>
      <button class="btn btn-ghost" id="p-close" ${d.phase !== "choosing" ? "disabled" : ""}>اقفل الاختيار</button>
      <button class="btn btn-gold" id="p-reveal" ${d.phase === "revealed" ? "disabled" : ""}>اكشف تحركات اليوم</button>
      <button class="btn btn-teal" id="p-next" ${d.day >= RULES.DAYS ? "disabled" : ""}>ابدأ اليوم ${arNum(Math.min(d.day + 1, RULES.DAYS))}</button>
    </div>
    <table class="adm-table" style="margin-top:12px"><thead><tr><th>الطاقم</th><th>المرسى</th><th>الطاقة</th><th>الوجهة</th></tr></thead><tbody>
      ${d.teams.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td>${esc(G.islandById(t.island).name)}</td><td class="num">${arNum(t.energy)}</td><td>${t.move ? `${esc(G.islandById(t.move.dest).name)} <span class="muted">(${arNum(t.move.cost)}⚡)</span>` : `<span class="muted">—</span>`}</td></tr>`).join("")}
    </tbody></table>
  </section>
  <section class="panel adm-card">
    <h2>الحوت</h2>
    <p class="hint">الحوت الحين في <b>${esc(REGIONS[w.region].name)}</b> • في المنطقة ${arNum(inRegion.length)} سفن. الجائزة كنز صدفة ${fmt(RULES.TREASURE.shell)}.</p>
    <div class="adm-grid">
      ${["beginnings", "danger", "edge"].map((r) => `<button class="btn ${w.region === r ? "btn-teal" : "btn-ghost"}" data-whale="${r}">${REGIONS[r].name}</button>`).join("")}
      <button class="btn btn-ghost" data-whale="random">منطقة عشوائية</button>
    </div>
    <button class="btn btn-gold btn-lg" id="w-draw" style="margin-top:12px" ${w.drawnDay === d.day ? "disabled" : ""}>🐋 قرعة الحوت</button>
    ${w.drawnDay === d.day ? `<p class="hint" style="margin:8px 0 0;text-align:center">${winner ? `فاز اليوم: <b>${esc(winner.name)}</b>` : "ما كان فيه سفن بالمنطقة"}</p>` : ""}
  </section>
  <section class="panel adm-card">
    <h2>ضيف حروف</h2>
    <p class="hint">الضيف ياخذ ${fmt(RULES.GUEST)} ذهب على كتابة السؤال، ويظهر في قائمة الضيوف بدون ما يدخل ترتيب السفن.</p>
    <div class="adm-row"><input class="input" id="g-name" maxlength="30" placeholder="اسم ضيف اليوم" /><button class="btn btn-gold" id="g-add" style="flex:0 0 auto">سجّل الضيف</button></div>
    ${d.guests.length ? `<div class="guests" style="margin-top:10px">${d.guests.slice().reverse().map((g) => `<div><span>${esc(g.name)} • اليوم ${arNum(g.day)}</span><span class="num">\u200F+\u200F${fmt(g.gold)}</span></div>`).join("")}</div>` : ""}
  </section>`;
}
function bindDay() {
  const d = A.data;
  $("#d-minus").onclick = () => d.day > 1 && act("/api/admin/day", { day: d.day - 1 }, "تم تغيير اليوم");
  $("#d-plus").onclick = () => d.day < RULES.DAYS && act("/api/admin/day", { day: d.day + 1 }, "تم تغيير اليوم");
  $("#p-open").onclick = () => act("/api/admin/phase", { phase: "choosing" }, "فُتحت مرحلة الاختيار");
  $("#p-close").onclick = () => act("/api/admin/phase", { phase: "closed" }, "قُفل الاختيار");
  $("#p-reveal").onclick = async () => { if (confirm("تكشف تحركات كل الطواقم الحين؟")) { if (await act("/api/admin/reveal", {}, "انكشفت التحركات!")) close(); } };
  $("#p-next").onclick = () => confirm(`تبدأ اليوم ${d.day + 1}؟ بتنفتح مرحلة الاختيار والحوت يظهر بمنطقة جديدة.`) && act("/api/admin/nextday", {}, "بدأ يوم جديد");
  $$("[data-whale]").forEach((b) => b.onclick = () => act("/api/admin/whale", { region: b.dataset.whale }, "تحرك الحوت"));
  $("#w-draw").onclick = async () => { if (await act("/api/admin/whaledraw", {}, "تمت القرعة")) close(); };
  $("#g-add").onclick = () => { const n = $("#g-name").value.trim(); if (!n) return toast("اكتب اسم الضيف", "err"); act("/api/admin/guest", { name: n }, "تم تسجيل الضيف"); };
}

/* ─── Answers tab ─── */
const RES = [["none", "ما جاوب"], ["wrong", "غلط"], ["right", "صح"], ["first", "أول صح"]];
function answersTab() {
  const d = A.data;
  const saved = d.results[d.day] || {};
  A.results = Object.assign({}, saved, A.resultsDraftDay === d.day ? A.results : {});
  A.resultsDraftDay = d.day;
  return `<section class="panel adm-card">
    <h2>نتائج سؤال اليوم ${arNum(d.day)}</h2>
    <p class="hint">اختر لكل طاقم وبعدين اعتمد. أول صح = ${fmt(RULES.FIRST_CORRECT)} + ٥ طاقة • صح = ${fmt(RULES.CORRECT)} + ٣ طاقة • غلط = ${fmt(RULES.WRONG)} + ١ طاقة. لو عدّلت بعد الاعتماد، يتحسب الفرق بس (ما يتكرر الذهب).</p>
    <div class="res-list">${d.teams.map((t) => `<div class="res-row"><div class="nm"><img src="${esc(t.flag)}" alt="">${esc(t.name)}</div>
      <div class="seg" data-team="${t.id}">${RES.map(([v, l]) => `<button data-v="${v}" class="${(A.results[t.id] || "none") === v ? "on" : ""}">${l}</button>`).join("")}</div></div>`).join("")}</div>
    <button class="btn btn-gold btn-lg" id="res-apply" style="margin-top:14px">اعتمد النتائج</button>
  </section>`;
}
function bindAnswers() {
  $$(".seg").forEach((seg) => $$("button", seg).forEach((b) => b.onclick = () => {
    const tid = seg.dataset.team, v = b.dataset.v;
    if (v === "first") for (const k of Object.keys(A.results)) if (A.results[k] === "first" && k !== tid) A.results[k] = "right";
    A.results[tid] = v;
    render();
  }));
  $("#res-apply").onclick = async () => {
    const results = {};
    for (const t of A.data.teams) results[t.id] = A.results[t.id] || "none";
    if (await act("/api/admin/results", { day: A.data.day, results }, "اعتُمدت النتائج")) A.results = {};
  };
}

/* ─── Gold tab ─── */
function goldTab() {
  const d = A.data;
  return `<section class="panel adm-card">
    <h2>منح أو خصم</h2>
    <label class="lbl">الطاقم<select class="input" id="gd-team">${d.teams.map((t) => `<option value="${t.id}">${esc(t.name)} — ${fmt(t.total)}</option>`).join("")}</select></label>
    <div class="preset-grid" style="margin-top:12px">
      <button class="preset" data-p='{"coins":2000,"energy":3,"note":"جواب صحيح"}'>جواب صحيح<small>\u200F+\u200F${fmt(2000)} • \u200F+\u200F٣⚡</small></button>
      <button class="preset" data-p='{"coins":3000,"energy":5,"note":"أول جواب صحيح"}'>أول جواب صحيح<small>\u200F+\u200F${fmt(3000)} • \u200F+\u200F٥⚡</small></button>
      <button class="preset" data-p='{"coins":500,"energy":1,"note":"محاولة خاطئة"}'>محاولة خاطئة<small>\u200F+\u200F${fmt(500)} • \u200F+\u200F١⚡</small></button>
      <button class="preset" data-p='{"coins":2000,"note":"غزو ناجح"}'>غزو ناجح<small>\u200F+\u200F${fmt(2000)}</small></button>
      <button class="preset" data-p='{"treasure":"shell","tcount":1,"note":"كنز صدفة"}'><span><img src="${TICON.shell}" alt=""> صدفة</span><small>\u200F+\u200F${fmt(RULES.TREASURE.shell)}</small></button>
      <button class="preset" data-p='{"treasure":"chest","tcount":1,"note":"كنز صندوق"}'><span><img src="${TICON.chest}" alt=""> صندوق</span><small>\u200F+\u200F${fmt(RULES.TREASURE.chest)}</small></button>
      <button class="preset" data-p='{"treasure":"crown","tcount":1,"note":"كنز تاج"}'><span><img src="${TICON.crown}" alt=""> تاج</span><small>\u200F+\u200F${fmt(RULES.TREASURE.crown)}</small></button>
      <button class="preset neg" data-p='{"coins":-2000,"note":"سُرق بالغزو"}'>خسارة غزو<small>\u200F−\u200F${fmt(2000)}</small></button>
      <button class="preset neg" data-p='{"coins":-8000,"note":"عجلة الغنيمة"}'>عجلة: خسارة<small>\u200F−\u200F${fmt(8000)}</small></button>
      <button class="preset" data-p='{"coins":8000,"note":"عجلة الغنيمة"}'>عجلة: ربح<small>\u200F+\u200F${fmt(8000)}</small></button>
      <button class="preset neg" data-p='{"coins":-2000,"note":"جزية أمان"}'>جزية أمان<small>\u200F−\u200F${fmt(2000)}</small></button>
      <button class="preset neg" data-p='{"treasure":"shell","tcount":-1,"note":"سحب كنز صدفة"}'>سحب صدفة<small>\u200F−\u200F${fmt(RULES.TREASURE.shell)}</small></button>
    </div>
  </section>
  <section class="panel adm-card">
    <h2>مبلغ مخصص</h2>
    <div class="adm-grid">
      <label class="lbl">عملات (+ أو −)<input class="input num" id="gc-coins" type="number" inputmode="numeric" step="500" placeholder="مثلاً 1500 أو -1000" dir="ltr" /></label>
      <label class="lbl">طاقة (+ أو −)<input class="input num" id="gc-energy" type="number" inputmode="numeric" placeholder="0" dir="ltr" /></label>
    </div>
    <label class="lbl" style="margin-top:10px">السبب (يظهر للطاقم)<input class="input" id="gc-note" maxlength="120" placeholder="مثلاً: ماراثون المدفع ٨/١٠" /></label>
    <button class="btn btn-gold btn-lg" id="gc-apply" style="margin-top:12px">طبّق</button>
  </section>
  <section class="panel adm-card">
    <h2>آخر الحركات المالية</h2>
    ${window.APP.logHTML(d.log.filter((l) => l.coins || l.treasure).slice(0, 25).map((l) => ({ ...l, note: (l.teamId ? (d.teams.find((t) => t.id === l.teamId) || {}).name + ": " : "") + l.note })))}
  </section>`;
}
function bindGold() {
  $$(".preset").forEach((b) => b.onclick = () => {
    const p = JSON.parse(b.dataset.p);
    const tid = $("#gd-team").value;
    const name = A.data.teams.find((t) => t.id === tid).name;
    act("/api/admin/award", { teamId: tid, ...p }, `تم: ${p.note} — ${name}`).then(() => { const s = $("#gd-team"); if (s) s.value = tid; });
  });
  $("#gc-apply").onclick = () => {
    const tid = $("#gd-team").value;
    const coins = Number($("#gc-coins").value || 0), energy = Number($("#gc-energy").value || 0);
    if (!coins && !energy) return toast("اكتب مبلغ أو طاقة", "err");
    act("/api/admin/award", { teamId: tid, coins, energy, note: $("#gc-note").value.trim() }, "تم التطبيق").then(() => { const s = $("#gd-team"); if (s) s.value = tid; });
  };
}

/* ─── Teams tab ─── */
function teamsTab() {
  const d = A.data;
  const isles = G.ISLANDS.filter((i) => i.type !== "mystery");
  return `<section class="panel adm-card">
    <h2>طاقم جديد</h2>
    <div class="adm-row"><input class="input" id="nt-name" maxlength="30" placeholder="اسم الطاقم" /><button class="btn btn-gold" id="nt-add" style="flex:0 0 auto">أضف</button></div>
    <p class="hint" style="margin:8px 0 0">بعد الإضافة، أرسل كود الطاقم للاعبين عشان يسجلون بأنفسهم، أو أضفهم من تبويب اللاعبين.</p>
  </section>
  ${d.teams.map((t) => `<section class="panel adm-card team-card" data-team="${t.id}">
    <div class="top"><img class="fl" src="${esc(t.flag)}" alt=""><b>${esc(t.name)}</b><span class="code" title="كود الانضمام">${esc(t.code)}</span></div>
    <div class="muted" style="font-size:13px;font-weight:700">الأعضاء: ${t.members.length ? t.members.map(esc).join("، ") : "—"} • الذهب ${fmt(t.total)}</div>
    <div class="adm-grid">
      <label class="lbl">الاسم<input class="input" data-f="name" value="${esc(t.name)}" maxlength="30" /></label>
      <label class="lbl">السفينة<select class="input" data-f="ship">${Object.entries(SHIP_NAMES).map(([k, l]) => `<option value="${k}" ${t.ship === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="lbl">المرسى<select class="input" data-f="island">${isles.map((i) => `<option value="${i.id}" ${t.island === i.id ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select></label>
      <label class="lbl">الطاقة<input class="input num" data-f="energy" type="number" min="0" max="12" value="${t.energy}" dir="ltr" /></label>
    </div>
    <div class="adm-row">
      <button class="btn btn-gold btn-sm" data-act="save">احفظ</button>
      <label class="btn btn-ghost btn-sm" style="cursor:pointer">ارفع العلم<input type="file" accept="image/png,image/jpeg,image/webp" data-act="flag" hidden /></label>
      <button class="btn btn-ghost btn-sm" data-act="code">كود جديد</button>
      <button class="btn btn-danger btn-sm" data-act="del">احذف</button>
    </div>
  </section>`).join("")}`;
}
function bindTeams() {
  $("#nt-add").onclick = () => { const n = $("#nt-name").value.trim(); if (!n) return toast("اكتب اسم الطاقم", "err"); act("/api/admin/team", { name: n }, "أُضيف الطاقم"); };
  $$(".team-card").forEach((card) => {
    const id = card.dataset.team;
    const val = (f) => card.querySelector(`[data-f="${f}"]`).value;
    card.querySelector('[data-act="save"]').onclick = () => act("/api/admin/team", { id, name: val("name"), ship: val("ship"), island: val("island"), energy: Number(val("energy")) }, "انحفظ الطاقم");
    card.querySelector('[data-act="code"]').onclick = () => act("/api/admin/team", { id, newCode: true }, "تم توليد كود جديد");
    card.querySelector('[data-act="del"]').onclick = () => confirm("متأكد تحذف الطاقم؟ لاعبينه بيصيرون بدون طاقم.") && act("/api/admin/team/delete", { id }, "انحذف الطاقم");
    card.querySelector('[data-act="flag"]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const dataUrl = await resizeImage(f, 640, 400); act("/api/admin/flag", { teamId: id, dataUrl }, "تم رفع العلم"); }
      catch { toast("ما قدرنا نقرأ الصورة", "err"); }
    };
  });
}
function resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxW / img.width, maxH / img.height);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = c.toDataURL("image/webp", 0.88);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
      resolve(out);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/* ─── Players tab ─── */
function playersTab() {
  const d = A.data;
  const teamOpts = (sel) => `<option value="">بدون طاقم</option>` + d.teams.map((t) => `<option value="${t.id}" ${sel === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  return `<section class="panel adm-card">
    <h2>لاعب جديد</h2>
    <div class="adm-grid">
      <label class="lbl">اسم القرصان<input class="input" id="np-name" maxlength="24" /></label>
      <label class="lbl">الرمز (٤–٨ أرقام)<input class="input num" id="np-pin" inputmode="numeric" maxlength="8" dir="ltr" /></label>
      <label class="lbl">الطاقم<select class="input" id="np-team">${teamOpts("")}</select></label>
    </div>
    <button class="btn btn-gold" id="np-add" style="margin-top:12px;width:100%">أضف اللاعب</button>
  </section>
  <section class="panel adm-card">
    <h2>كل اللاعبين (${arNum(d.players.length)})</h2>
    ${d.players.map((p) => `<div class="team-card" data-player="${p.id}">
      <div class="top"><b style="font-size:18px">${esc(p.name)}</b>${p.role === "admin" ? `<span class="badge badge-type">القبطان</span>` : ""}</div>
      ${p.role === "admin" ? "" : `<div class="adm-row"><select class="input" data-f="team" style="flex:2 1 160px">${teamOpts(p.teamId)}</select><button class="btn btn-ghost btn-sm" data-act="team">انقل</button></div>`}
      <div class="adm-row"><input class="input num" data-f="pin" placeholder="${p.role === "admin" ? "كلمة مرور جديدة" : "رمز جديد"}" dir="ltr" style="flex:2 1 160px" /><button class="btn btn-ghost btn-sm" data-act="pin">غيّر الرمز</button>${p.role === "admin" ? "" : `<button class="btn btn-danger btn-sm" data-act="del">احذف</button>`}</div>
    </div>`).join("")}
  </section>`;
}
function bindPlayers() {
  $("#np-add").onclick = () => act("/api/admin/player", { name: $("#np-name").value.trim(), pin: $("#np-pin").value.trim(), teamId: $("#np-team").value || null }, "أُضيف اللاعب");
  $$("[data-player]").forEach((row) => {
    const id = row.dataset.player;
    const q = (s) => row.querySelector(s);
    if (q('[data-act="team"]')) q('[data-act="team"]').onclick = () => act("/api/admin/player", { id, teamId: q('[data-f="team"]').value || null }, "تم النقل");
    q('[data-act="pin"]').onclick = () => { const pin = q('[data-f="pin"]').value.trim(); if (!pin) return toast("اكتب الرمز الجديد", "err"); act("/api/admin/player/pin", { id, pin }, "تم تغيير الرمز"); };
    if (q('[data-act="del"]')) q('[data-act="del"]').onclick = () => confirm("تحذف اللاعب؟") && act("/api/admin/player/delete", { id }, "انحذف اللاعب");
  });
}

/* ─── Log tab ─── */
function logTab() {
  const d = A.data;
  const list = d.log.slice(0, 200).map((l) => ({ ...l, note: (l.teamId ? ((d.teams.find((t) => t.id === l.teamId) || {}).name || "طاقم محذوف") + ": " : "") + l.note }));
  return `<section class="panel adm-card"><h2>سجل كل شي</h2>${window.APP.logHTML(list)}</section>`;
}

window.ADMIN = { open, close, refresh };
})();
