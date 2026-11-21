// prints real on-screen overlaps of ships with ships / visible labels / whale
module.exports = async (p) => p.evaluate(() => {
  const R = (el) => el.getBoundingClientRect();
  const vis = (el) => getComputedStyle(el).opacity !== "0" && R(el).width > 0;
  const ov = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const ships = [...document.querySelectorAll(".ship")].map((s) => ({ id: s.querySelector(".nm").textContent, art: R(s.querySelector(".ship-art")), nm: R(s.querySelector(".ship-name")) }));
  const labels = [...document.querySelectorAll(".island-label")].filter(vis).map((l) => ({ id: l.textContent, r: R(l) }));
  const wh = document.querySelector(".whale"); const out = [];
  ships.forEach((a, i) => {
    ships.slice(i + 1).forEach((b) => { const v = ov(a.art, b.art) + ov(a.nm, b.nm) + ov(a.art, b.nm) + ov(a.nm, b.art); if (v > 20) out.push(`ship ${a.id} × ship ${b.id}: ${Math.round(v)}`); });
    labels.forEach((l) => { const v = ov(a.art, l.r) + ov(a.nm, l.r); if (v > 20) out.push(`ship ${a.id} × label ${l.id}: ${Math.round(v)}`); });
    if (wh) { const v = ov(a.art, R(wh)) + ov(a.nm, R(wh)); if (v > 20) out.push(`ship ${a.id} × whale: ${Math.round(v)}`); }
  });
  return out;
});
