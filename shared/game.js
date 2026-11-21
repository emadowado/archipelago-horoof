/* أرخبيل الحروف — قواعد اللعبة والجزر (مشتركة بين السيرفر والمتصفح)
   عدّل أسماء الجزر وأنواعها وجوائزها من هنا. */
(function (root) {
  const RULES = {
    CORRECT: 2000,         // جواب صحيح
    FIRST_CORRECT: 3000,   // أول جواب صحيح (2,000 + بونص 1,000)
    WRONG: 500,            // محاولة خاطئة
    GUEST: 4000,           // ضيف حروف
    WHALE_TREASURE: "shell", // الحوت = كنز صدفة 5,000
    TREASURE: { shell: 5000, chest: 15000, crown: 20000 },
    ENERGY: { first: 5, right: 3, wrong: 1, none: 0 },
    ENERGY_CAP: 12,
    START_ENERGY: 5,
    BEGINNINGS_GOLD: 2000,
    DAYS: 19
  };
  const RESULT_GOLD = { none: 0, wrong: RULES.WRONG, right: RULES.CORRECT, first: RULES.FIRST_CORRECT };

  const TREASURE_NAMES = { shell: "كنز الصدفة", chest: "كنز الصندوق", crown: "كنز التاج" };

  const MAP = { W: 1400, H: 1400, CX: 700, CY: 700, SEA_R: 600, INNER_R: 330, OUTER_R: 495 };

  const REGIONS = {
    beginnings: { id: "beginnings", name: "بحر البدايات", order: 0, a0: 210, a1: 330, color: "#3ad1b6" },
    danger: { id: "danger", name: "محيط المخاطر", order: 1, a0: 330, a1: 450, color: "#5aa0e0" },
    edge: { id: "edge", name: "حافة العالم", order: 2, a0: 90, a1: 210, color: "#e6c05c" },
    center: { id: "center", name: "قلب الأرخبيل", order: 1, a0: 0, a1: 0, color: "#f0d060" }
  };

  // type: empty | power | challenge | trap | rare | mystery
  const ISLANDS = [
    { id: "marina", name: "جزيرة المرسى", region: "beginnings", type: "empty", art: "palm",
      lore: "هنا ترسو السفن أول ما تدخل الأرخبيل. الشاطئ هادئ والمرسى قديم منحوت في الصخر. نقطة انطلاق آمنة، ومنها يبدأ كل طاقم رحلته نحو المجهول." },
    { id: "dawn", name: "شاطئ الفجر", region: "beginnings", type: "power", art: "sand",
      lore: "أول ضوء في رمضان يلامس هذا الشاطئ قبل بقية الجزر. تحت الرمال الدافئة صندوق صغير من أيام بحّارة سبقوكم." },
    { id: "callrock", name: "صخرة النداء", region: "beginnings", type: "empty", art: "rock", flip: true,
      lore: "صخرة عالية يُسمع منها نداء السفن البعيدة إذا هبّ الهواء. ما عليها كنز، لكنها محطة هادئة في بحر البدايات." },
    { id: "haven", name: "خليج الأمان", region: "beginnings", type: "power", art: "palm", flip: true,
      lore: "خليج محمي بالصخور من ثلاث جهات، والموج فيه بالكاد يتحرك. في قاعه الهادئ كنز تركه طاقم نجا من عاصفة قديمة." },
    { id: "firstletter", name: "جزيرة الحرف الأول", region: "beginnings", type: "challenge", art: "ruins",
      lore: "على بوابة حجرية حرف عربي محفور يتبدل مع كل زائر. من يفك سر الحرف يفتح صندوق التحدي ويخرج بكنز." },
    { id: "quietsands", name: "رمال الهدوء", region: "beginnings", type: "empty", art: "sand", flip: true,
      lore: "امتداد من الرمال البيضاء لا يقطعه إلا أثر أقدام نادرة. فارغة تماماً، ولهذا هي الأكثر عرضة للغرق إن لم يزرها أحد." },
    { id: "smalltreasures", name: "جزيرة الكنوز الصغيرة", region: "beginnings", type: "power", art: "rock",
      lore: "جزيرة صغيرة مخادعة، تبدو صخرة لا تستحق الزيارة. في خليجها الرملي صندوق يمنح طاقمك قدرة تدخلون بها النهائي." },

    { id: "fog", name: "جزيرة الضباب", region: "danger", type: "challenge", art: "ruins", flip: true,
      lore: "ضباب كثيف لا ينقشع إلا ساعات قليلة. في قلبه لوحة أحجيات، ومن يقرأها ويصيب يأخذ الكنز." },
    { id: "reefs", name: "شعاب الأسرار", region: "danger", type: "power", art: "palm",
      lore: "شعاب مرجانية تحيط بجزيرة منخفضة، والممر إليها ضيق. في تجويف مرجاني صندوق مختوم بختم قراصنة لا يُعرف اسمهم." },
    { id: "oldpirates", name: "جزيرة القراصنة القدامى", region: "danger", type: "power", art: "rock", flip: true,
      lore: "بقايا مخيم ومراسي حديد صدئة، وكأن طاقماً عظيماً عاش هنا ثم اختفى. تحت الصخرة صندوق يقال إنه وصيتهم الأخيرة." },
    { id: "currents", name: "جزر التيار", region: "danger", type: "trap", art: "trap",
      lore: "تيار قوي يغيّر اتجاهه بلا إنذار. أول رسو هنا يوقع السفينة في دوامة تسرق طاقة الطاقم." },
    { id: "cannon", name: "صخرة المدفع", region: "danger", type: "power", art: "storm",
      lore: "بركان صغير وصخرة شاهقة عليها مدفع قديم متجه نحو البحر المفتوح. من يصل أولاً يأخذ الكنز والقدرة." },
    { id: "traps", name: "جزيرة الفخاخ", region: "danger", type: "trap", art: "trap", flip: true,
      lore: "جزيرة خادعة المظهر، مليئة بالحبائل والحفر المغطاة. النظام نفسه زرع فيها فخاً جاهزاً ينتظر أول زائر." },
    { id: "quietstorm", name: "جزيرة العاصفة الهادئة", region: "danger", type: "challenge", art: "storm", flip: true,
      lore: "تبدو هادئة من بعيد، حتى تقترب فيلتف الهواء بغتة حول الصاري. أجب سؤالها لتنال كنزاً." },

    { id: "lighthouse", name: "منارة النهاية", region: "edge", type: "power", art: "lighthouse",
      lore: "منارة عالية في أقصى الخريطة، ضوءها يُرى من محيط المخاطر في الليالي الصافية. في غرفتها العليا كنز ثمين." },
    { id: "bones", name: "جزيرة الحوت", region: "edge", type: "challenge", art: "ruins",
      lore: "جزيرة على شكل ظهر حوت نائم. يقول الصيادون إن المكان يختبر الزوار بسؤال قبل أن يسمح لهم بالكنز." },
    { id: "worldsend", name: "رأس العالم", region: "edge", type: "power", art: "rock",
      lore: "آخر رأس صخري على الخرائط القديمة، وبعده: هنا تنتهي الأرض. في شق الصخر صندوق معدني ثقيل." },
    { id: "golden", name: "الجزيرة الذهبية", region: "edge", type: "rare", art: "gold", appearsDay: 9,
      lore: "تولد فجأة يوم 9 رمضان ببريق ذهبي على الماء. من يرسو عليها أولاً يأخذ قدرتين وكنز التاج." },
    { id: "crowns", name: "جزيرة التيجان", region: "edge", type: "rare", art: "crown", appearsDay: 12,
      lore: "تظهر يوم 12، تعلوها صخور تشبه التيجان. فيها وصية ملوك البحر: قدرتان وكنز التاج لمن سبق." },
    { id: "sunsetisle", name: "مرسى الغروب", region: "edge", type: "power", art: "lighthouse", flip: true,
      lore: "آخر ضوء يلامس هذا المرسى عند مغرب رمضان. تحت أحد ألواحه صندوق يفتحه من يصل مع آخر شعاع." },
    { id: "starbell", name: "بئر النجوم", region: "edge", type: "challenge", art: "ruins", flip: true,
      lore: "بئر قديمة يُقال إن قاعها يعكس النجوم في وضح النهار. من يقرأ السر يفتح تحدياً ثميناً." },

    { id: "mystery", name: "الجزيرة المجهولة", region: "center", type: "mystery", art: "mystery", locked: true,
      lore: "جزيرة عظيمة في قلب الأرخبيل، لا يظهر منها إلا علامة استفهام. سرّها مؤجّل إلى يوم يختاره عماد." }
  ];

  const TYPE_LABELS = {
    empty: "فارغة", power: "قدرة + كنز", challenge: "تحدي", trap: "فخ", rare: "نادرة", mystery: "مجهولة"
  };

  function polar(deg, r) {
    const a = (deg * Math.PI) / 180;
    return { x: MAP.CX + r * Math.cos(a), y: MAP.CY - r * Math.sin(a) };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Layout: 7 islands per 120° sector (3 inner ring + 4 outer ring)
  (function layout() {
    const by = { beginnings: [], danger: [], edge: [] };
    ISLANDS.forEach((i) => by[i.region] && by[i.region].push(i));
    for (const [rid, list] of Object.entries(by)) {
      const r = REGIONS[rid];
      const pad = 15, u0 = r.a0 + pad, span = r.a1 - r.a0 - pad * 2;
      list.slice(0, 3).forEach((isle, i) => {
        const t = (i + 0.5) / 3;
        const p = polar(u0 + span * t + ((hashStr(isle.id) % 7) - 3), MAP.INNER_R + ((hashStr(isle.id + "r") % 25) - 12));
        Object.assign(isle, { x: Math.round(p.x), y: Math.round(p.y) });
      });
      list.slice(3, 7).forEach((isle, i) => {
        const t = (i + 0.5) / 4;
        const p = polar(u0 + span * t + ((hashStr(isle.id) % 7) - 3), MAP.OUTER_R + ((hashStr(isle.id + "r") % 21) - 10));
        Object.assign(isle, { x: Math.round(p.x), y: Math.round(p.y) });
      });
    }
    const m = ISLANDS.find((i) => i.id === "mystery");
    m.x = MAP.CX; m.y = MAP.CY;
  })();

  const islandById = (id) => ISLANDS.find((i) => i.id === id);

  function travelCost(fromId, toId) {
    const a = islandById(fromId), b = islandById(toId);
    if (!a || !b) return null;
    if (a.region === "center" || b.region === "center") return 3;
    const d = Math.abs(REGIONS[a.region].order - REGIONS[b.region].order);
    return 1 + (d === 0 ? 1 : d === 1 ? 2 : 3);
  }

  function islandVisible(isle, day) {
    return !isle.appearsDay || day >= isle.appearsDay;
  }

  // What an island gives to its first visitor
  function islandReward(isle) {
    if (isle.type === "power") {
      if (isle.region === "beginnings") return { coins: RULES.BEGINNINGS_GOLD, label: `قدرة + ${fmt(RULES.BEGINNINGS_GOLD)} ذهب` };
      if (isle.region === "danger") return { treasure: "shell", label: `قدرة + كنز صدفة ${fmt(RULES.TREASURE.shell)}` };
      return { treasure: "chest", label: `قدرة أقوى + كنز صندوق ${fmt(RULES.TREASURE.chest)}` };
    }
    if (isle.type === "rare") return { treasure: "crown", label: `قدرتان + كنز تاج ${fmt(RULES.TREASURE.crown)}` };
    if (isle.type === "trap") return { energy: -1, label: "فخ: أول زائر يخسر طاقة" };
    if (isle.type === "challenge") return { label: `تحدي: النجاح = قدرة + كنز صدفة ${fmt(RULES.TREASURE.shell)}` };
    if (isle.type === "mystery") return { label: "سرّها مؤجّل" };
    return { label: "بلا قدرة ولا ذهب" };
  }

  function teamTotal(t) {
    const tr = t.treasures || {};
    return (t.coins || 0) + (tr.shell || 0) * RULES.TREASURE.shell + (tr.chest || 0) * RULES.TREASURE.chest + (tr.crown || 0) * RULES.TREASURE.crown;
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString("ar-SA");
  }

  const api = { RULES, RESULT_GOLD, TREASURE_NAMES, MAP, REGIONS, ISLANDS, TYPE_LABELS, polar, islandById, travelCost, islandVisible, islandReward, teamTotal, fmt };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GAME = api;
})(typeof window !== "undefined" ? window : globalThis);
