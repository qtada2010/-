'use strict';
// ==========================================================================
// 🎨 siteTheme.js — هوية لوحة التحكم البصرية (كانت مضمّنة داخل dashboard.js)
//
// نُقلت إلى ملف مستقل حتى يصبح تعديل المظهر مفهوماً ومعزولاً عن منطق الصفحات.
// الملف يصدّر وسم <style> واحداً يُحقن تلقائياً في كل صفحة عبر ميدلوير في
// dashboard.js، فأي تعديل هنا ينعكس على الموقع كله في مكان واحد.
//
// الملف مقسوم إلى طبقتين:
//   1) الطبقة الأساسية — الهوية والألوان والعناصر (كما كانت، بلون بنفسجي).
//   2) طبقة العمق 3D  — ظلال متعددة، زجاجية، إضاءة، وحركة تفاعلية.
//      كلها إضافات بصرية بحتة: لا تغيّر أي تخطيط ولا تخفي أي عنصر، وتتعطّل
//      تلقائياً لمن يفعّل «تقليل الحركة» في نظامه.
//
// 🎨 لتغيير لون الهوية بالكامل: عدّل متغيرات --accent في :root أدناه فقط.
// ==========================================================================

const BASE_LAYER = `  :root { color-scheme:dark; --ink:#0d0d0e; --surface:#161517; --surface-raised:#1b1a1d; --stroke:#2d2b31; --text:#f4f4f4; --muted:#a7a4ae; --accent:#7b5cf0; --accent-soft:#a68bf7; --accent-deep:#4c2f9e; }
  html { scroll-behavior:smooth; background:#0d0d0e; }
  *,*::before,*::after { box-sizing:border-box; }
  body { margin:0; color:var(--text) !important; font-family:"IBM Plex Sans Arabic","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif; line-height:1.7; background-color:var(--ink) !important; background-image:radial-gradient(ellipse at 10% 0%,rgba(81,31,162,.09),transparent 34%),radial-gradient(ellipse at 92% 18%,rgba(76,78,65,.05),transparent 30%),linear-gradient(145deg,#0d0d0e 0%,#111012 52%,#0d0d0e 100%) !important; }
  nav { position:sticky; top:0; z-index:40; background:rgba(13,14,18,.94) !important; border-color:#29272c !important; box-shadow:0 10px 30px rgba(0,0,0,.22); backdrop-filter:blur(16px); }
  nav:not(.landing-nav) .links,nav:not(.landing-nav) > div { display:flex; align-items:center; flex-wrap:wrap; gap:5px; }
  nav:not(.landing-nav) a { display:inline-flex; align-items:center; min-height:38px; margin:0 !important; padding:8px 11px; border:1px solid transparent; border-radius:9px; color:#bcb9c1 !important; font-size:13px; text-decoration:none; transition:background .2s ease,border-color .2s ease,color .2s ease,transform .2s ease; }
  nav:not(.landing-nav) a:hover { transform:translateY(-1px); border-color:#29282c; background:#1b1a1e; color:#d6d0f0 !important; text-shadow:none; }
  nav:not(.landing-nav) a[href="/logout"] { color:#a795db !important; }
  nav:not(.landing-nav) a[href="/logout"]:hover { border-color:#4a343d; background:#21181d; color:#f0d4df !important; }
  a { color:#9f84f0 !important; transition:color .2s ease,text-shadow .2s ease; }
  a:hover { color:#cfc8ed !important; text-shadow:0 0 16px rgba(125,60,229,.20); }
  .card,.panel,.container,.login-card { background-color:rgba(19,20,25,.96) !important; border-color:#2d2b31 !important; box-shadow:0 14px 38px rgba(0,0,0,.20); }
  .container { width:min(1100px,calc(100% - 36px)); margin:32px auto !important; padding:clamp(20px,3.2vw,36px) !important; border-radius:20px !important; }
  .login-card { border-radius:22px !important; }
  .card { transition:border-color .28s ease,box-shadow .28s ease,transform .28s cubic-bezier(.2,.8,.2,1); }
  .card:hover { border-color:rgba(127,66,226,.30) !important; box-shadow:0 18px 42px rgba(0,0,0,.27),0 8px 28px rgba(75,26,153,.08); }
  .item,.list-item,.reward-item { display:flex; align-items:center; justify-content:space-between; gap:16px; margin:10px 0; padding:14px 16px; border:1px solid #2d2b31 !important; border-radius:13px; background:linear-gradient(145deg,#1a191c,#151416) !important; color:#e8e7e9; transition:transform .22s ease,border-color .22s ease,background .22s ease; }
  .item:hover,.list-item:hover,.reward-item:hover { transform:translateY(-2px); border-color:#37353c !important; }
  .item form,.list-item form,.reward-item form { width:auto; flex-shrink:0; margin:0 !important; }
  .item form button,.list-item form button,.reward-item form button { width:auto !important; margin:0 !important; }
  h1,h2,h3 { color:#efeef6 !important; }
  .eyebrow,.section-title,.command-arrow { color:#a68bf7 !important; }
  .intro,.help,.muted,.command-description { color:var(--muted) !important; }
  .card-head { border-color:#2d2b31 !important; }
  code { color:#ae9af2 !important; }
  .pill { color:#c5bbea !important; background:rgba(71,31,136,.20) !important; border:1px solid rgba(127,66,226,.20); }
  .notice { color:#cac1eb !important; background:#151417 !important; border-color:rgba(127,66,226,.28) !important; }
  .alias-editor,.role-picker { background:#121113 !important; border-color:#2f2d33 !important; }
  .alias-chip { color:#c9bfeb !important; background:#1b1a1e !important; border-color:#351d5a !important; }
  .role-chip { color:#c8beeb !important; background:#18171a !important; border-color:#362353 !important; }
  label { color:#d9d7dc !important; font-weight:650; }
  input:not([type="checkbox"]):not([type="radio"]),select,textarea { color:#f4f4f4 !important; background:#101011 !important; border-color:#343238 !important; border-radius:10px; }
  input::placeholder,textarea::placeholder { color:#787481 !important; }
  input:focus,select:focus,textarea:focus { outline:none; border-color:#6537ca !important; box-shadow:0 0 0 3px rgba(93,33,190,.16); }
  input[type="checkbox"],input[type="radio"] { accent-color:#7b5cf0 !important; }
  select option { color:#f4f4f4; background:#171719; }
  hr { border-color:#2d2b31 !important; opacity:.9; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:12px 14px; border-bottom:1px solid #2d2b31; text-align:right; }
  th { color:#cac8ce; font-weight:700; background:#1a191c; }
  td { color:#e3e3e4; }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]) { position:relative; isolation:isolate; overflow:hidden; border:1px solid rgba(163,113,244,.22) !important; color:#fafafd !important; background:linear-gradient(115deg,#472189 0%,#3d1a75 52%,#50279d 100%) !important; background-size:180% 180% !important; box-shadow:0 5px 17px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.08); transition:transform .24s cubic-bezier(.2,.8,.2,1),box-shadow .24s ease,filter .24s ease,background-position .4s ease !important; }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role])::after { content:""; position:absolute; top:-80%; bottom:-80%; left:-38%; width:24%; pointer-events:none; background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent); transform:translateX(-180%) rotate(18deg); transition:transform .62s cubic-bezier(.2,.7,.2,1); }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]):hover { transform:translateY(-2px); background-position:100% 50% !important; filter:brightness(1.09); box-shadow:0 9px 23px rgba(42,15,85,.32),0 0 0 1px rgba(161,106,249,.13); }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]):hover::after { transform:translateX(680%) rotate(18deg); }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]):active { transform:translateY(0) scale(.975); filter:brightness(.97); box-shadow:0 3px 10px rgba(0,0,0,.28); }
  form[action*="delete"] button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]),.danger-button,button.danger { background:linear-gradient(115deg,#61333d,#4a2730 55%,#69404a) !important; border-color:rgba(216,151,166,.25) !important; }
  form[action*="delete"] button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]):hover,.danger-button:hover,button.danger:hover { background-position:100% 50% !important; box-shadow:0 9px 23px rgba(87,37,49,.3) !important; }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]):focus-visible,.command-toggle:focus-visible,.category-tab:focus-visible { outline:2px solid #a68bf7 !important; outline-offset:3px; }
  .command-toggle { transition:transform .24s ease,color .24s ease; }
  .command-toggle:hover { transform:translateY(-1px); }
  .command-toggle:active { transform:scale(.995); }
  .command-toggle:hover .command-title { color:#cfc8ed; }
  [data-remove-alias],[data-remove-role] { color:#a68bf7 !important; transition:transform .2s ease,color .2s ease; }
  [data-remove-alias]:hover,[data-remove-role]:hover { transform:rotate(90deg) scale(1.12); color:#d4cdef !important; }
  [data-remove-alias]:active,[data-remove-role]:active { transform:scale(.9); }
  @keyframes dashboardEntrance { from { opacity:0; transform:translateY(9px); } to { opacity:1; transform:translateY(0); } }
  nav { animation:dashboardEntrance .46s ease-out both; }
  .wrap,main:not(.wrap),.container { animation:dashboardEntrance .56s cubic-bezier(.2,.75,.25,1) both; }
  @media(max-width:760px) { nav:not(.landing-nav) { align-items:stretch !important; flex-direction:column; gap:7px !important; } nav:not(.landing-nav) .links,nav:not(.landing-nav) > div { width:100%; overflow-x:auto; flex-wrap:nowrap; padding-bottom:3px; scrollbar-width:thin; } nav:not(.landing-nav) a { flex:0 0 auto; } nav:not(.landing-nav) > a[href="/logout"] { align-self:flex-end; } .container { width:calc(100% - 24px); margin:18px auto !important; } .container form > div[style*="display:flex"]:not(.checkbox-row) { align-items:stretch; flex-wrap:wrap; } .container form > div[style*="display:flex"]:not(.checkbox-row) > div { min-width:min(100%,220px); flex:1 1 220px !important; } .item,.list-item,.reward-item { align-items:flex-start; flex-direction:column; } .item form,.list-item form,.reward-item form { width:100%; } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto !important; animation-duration:.01ms !important; animation-iteration-count:1 !important; transition-duration:.01ms !important; } }
`;

// ==========================================================================
// 🧊 طبقة العمق والتجسيم (3D)
//
// مبنية بالكامل على متغيرات --accent، فتتبع أي لون هوية تختاره تلقائياً.
// قاعدة التصميم هنا: العمق يأتي من الضوء والظل والطبقات — لا من تحريك
// العناصر من أماكنها. لذلك لا قاعدة واحدة تغيّر عرضاً أو ارتفاعاً أو تموضعاً،
// وبذلك يستحيل أن تُزيح زراً أو تُخفي حقلاً.
// ==========================================================================
const DEPTH_LAYER = `
  /* ---------- متغيرات العمق ---------- */
  :root {
    --d-glass: rgba(255,255,255,.045);
    --d-glass-line: rgba(255,255,255,.085);
    --d-glow: rgba(131,77,217,.38);
    --d-glow-soft: rgba(131,77,217,.16);
    --d-lift-1: 0 1px 2px rgba(0,0,0,.30), 0 3px 8px rgba(0,0,0,.22);
    --d-lift-2: 0 2px 4px rgba(0,0,0,.32), 0 8px 20px rgba(0,0,0,.28), 0 18px 48px rgba(0,0,0,.22);
    --d-lift-3: 0 3px 6px rgba(0,0,0,.34), 0 14px 34px rgba(0,0,0,.32), 0 34px 80px rgba(0,0,0,.30);
    --d-inset-top: inset 0 1px 0 rgba(255,255,255,.07);
    --d-inset-deep: inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.35);
  }

  /* ---------- خلفية حيّة: هالات بنفسجية تتنفس ببطء خلف المحتوى ---------- */
  /* عنصر ثابت خلف كل شيء (z-index سالب) فلا يعترض أي نقرة أو تمرير. */
  body::before {
    content: ""; position: fixed; inset: -25%; z-index: -2; pointer-events: none;
    background:
      radial-gradient(42% 38% at 18% 14%, rgba(131,77,217,.16), transparent 68%),
      radial-gradient(38% 34% at 84% 24%, rgba(164,117,240,.11), transparent 66%),
      radial-gradient(46% 42% at 62% 88%, rgba(86,39,161,.13), transparent 70%);
    filter: blur(14px);
    animation: dAurora 26s ease-in-out infinite alternate;
  }
  @keyframes dAurora {
    0%   { transform: translate3d(0,0,0) scale(1); opacity: .85; }
    50%  { transform: translate3d(1.5%,-1.5%,0) scale(1.06); opacity: 1; }
    100% { transform: translate3d(-1.5%,1%,0) scale(1.03); opacity: .9; }
  }

  /* شبكة دقيقة تعطي إحساس «سطح» تحت المحتوى */
  body::after {
    content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
    background-image:
      linear-gradient(rgba(255,255,255,.016) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.016) 1px, transparent 1px);
    background-size: 58px 58px;
    mask-image: radial-gradient(74% 62% at 50% 34%, #000 36%, transparent 100%);
    -webkit-mask-image: radial-gradient(74% 62% at 50% 34%, #000 36%, transparent 100%);
  }

  /* ---------- البطاقات والحاويات: زجاج بعمق حقيقي ---------- */
  .card, .panel, .container, .login-card {
    position: relative;
    backdrop-filter: blur(13px) saturate(130%);
    -webkit-backdrop-filter: blur(13px) saturate(130%);
    box-shadow: var(--d-lift-2), var(--d-inset-top) !important;
  }
  /* حافة علوية مضيئة: توحي أن الضوء يأتي من الأعلى، وهي أساس الإحساس المجسّم */
  .card::before, .panel::before, .login-card::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 1px; pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent);
  }
  .card:hover {
    box-shadow: var(--d-lift-3), var(--d-inset-top), 0 0 0 1px var(--d-glow-soft) !important;
  }

  /* ---------- بطاقات الأوامر: ميل خفيف ثلاثي الأبعاد ---------- */
  .commands-page .card-grid { perspective: 1400px; }
  .commands-page .cmd-card {
    transform-style: preserve-3d;
    transition: transform .34s cubic-bezier(.2,.8,.2,1), box-shadow .34s ease, border-color .34s ease;
  }
  .commands-page .cmd-card:hover {
    transform: translateY(-3px) rotateX(1.3deg);
    box-shadow: var(--d-lift-3), 0 0 0 1px var(--d-glow-soft), 0 0 34px -12px var(--d-glow) !important;
  }
  /* البطاقة المفتوحة تستوي تماماً حتى تبقى القراءة والتعديل مريحين */
  .commands-page .cmd-card.is-open:hover { transform: none; }

  /* نقطة الحالة: كرة مضيئة لا دائرة مسطّحة */
  .commands-page .state-dot {
    background-image: radial-gradient(circle at 32% 28%, rgba(255,255,255,.65), transparent 58%);
  }
  .commands-page .state-dot.is-on {
    box-shadow: 0 0 0 3px rgba(127,191,143,.14), 0 0 11px rgba(127,191,143,.55);
  }

  /* ---------- الأزرار: جسم له سُمك يُضغط فعلاً ---------- */
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]) {
    box-shadow:
      0 1px 0 rgba(255,255,255,.14) inset,
      0 -2px 0 rgba(0,0,0,.34) inset,
      0 4px 0 -1px rgba(0,0,0,.30),
      0 10px 22px -8px var(--d-glow) !important;
  }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]):hover {
    transform: translateY(-2px) !important;
    box-shadow:
      0 1px 0 rgba(255,255,255,.18) inset,
      0 -2px 0 rgba(0,0,0,.34) inset,
      0 7px 0 -1px rgba(0,0,0,.32),
      0 18px 34px -10px var(--d-glow) !important;
  }
  button:not(.command-toggle):not(.category-tab):not([data-remove-alias]):not([data-remove-role]):active {
    transform: translateY(1px) !important;
    box-shadow:
      0 1px 0 rgba(255,255,255,.10) inset,
      0 -1px 0 rgba(0,0,0,.30) inset,
      0 1px 0 -1px rgba(0,0,0,.30),
      0 6px 14px -8px var(--d-glow) !important;
  }

  /* ---------- الحقول: محفورة في السطح ---------- */
  input:not([type="checkbox"]):not([type="radio"]), select, textarea {
    box-shadow: inset 0 2px 5px rgba(0,0,0,.34), inset 0 1px 0 rgba(0,0,0,.22) !important;
    transition: box-shadow .22s ease, border-color .22s ease;
  }
  input:not([type="checkbox"]):not([type="radio"]):focus, select:focus, textarea:focus {
    box-shadow:
      inset 0 2px 5px rgba(0,0,0,.30),
      0 0 0 3px var(--d-glow-soft),
      0 0 20px -6px var(--d-glow) !important;
  }

  /* ---------- الشريط العلوي: زجاج عائم ---------- */
  nav {
    backdrop-filter: blur(18px) saturate(150%);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
    box-shadow: 0 1px 0 rgba(255,255,255,.05) inset, 0 12px 34px rgba(0,0,0,.30) !important;
  }
  nav:not(.landing-nav) a.is-active,
  nav:not(.landing-nav) a[aria-current="page"] {
    border-color: var(--d-glow) !important;
    background: linear-gradient(180deg, rgba(131,77,217,.22), rgba(131,77,217,.10)) !important;
    color: #eeecf9 !important;
  }

  /* ---------- العناوين: تدرّج لوني بدل لون مسطّح ---------- */
  h1 {
    background: linear-gradient(180deg, #ffffff 0%, #c9c0eb 96%);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    text-shadow: 0 10px 34px rgba(131,77,217,.22);
  }
  /* احتياط: لو لم يدعم المتصفح قص الخلفية على النص يبقى العنوان ظاهراً */
  @supports not ((-webkit-background-clip: text) or (background-clip: text)) {
    h1 { -webkit-text-fill-color: currentColor; background: none; }
  }

  /* ---------- الرقائق والشارات: حبّات بارزة ---------- */
  .pill, .alias-chip, .role-chip, .stat {
    box-shadow: var(--d-inset-top), 0 2px 5px rgba(0,0,0,.26) !important;
  }

  /* ---------- الجداول والعناصر المصفوفة ---------- */
  .item, .list-item, .reward-item {
    box-shadow: var(--d-lift-1), var(--d-inset-top);
  }
  .item:hover, .list-item:hover, .reward-item:hover {
    box-shadow: var(--d-lift-2), var(--d-inset-top), 0 0 0 1px var(--d-glow-soft);
  }

  /* ---------- شريط التمرير بهوية الموقع ---------- */
  * { scrollbar-width: thin; scrollbar-color: #483568 #141316; }
  ::-webkit-scrollbar { width: 11px; height: 11px; }
  ::-webkit-scrollbar-track { background: #111012; }
  ::-webkit-scrollbar-thumb {
    border: 3px solid #111012; border-radius: 99px;
    background: linear-gradient(180deg, #664aa0, #422d63);
  }
  ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #7959c6, #533b7f); }

  /* ---------- التحديد والتركيز ---------- */
  ::selection { background: rgba(131,77,217,.34); color: #fff; }
  :focus-visible { outline: 2px solid var(--d-glow); outline-offset: 2px; }

  /* ---------- احترام تفضيل تقليل الحركة ---------- */
  @media (prefers-reduced-motion: reduce) {
    body::before { animation: none !important; }
    .commands-page .cmd-card:hover { transform: none !important; }
    button:hover, button:active { transform: none !important; }
  }

  /* ---------- الشاشات الصغيرة: نخفّف التأثيرات حفاظاً على الأداء ---------- */
  @media (max-width: 760px) {
    body::before { filter: blur(22px); animation: none; }
    body::after { display: none; }
    .card, .panel, .container, .login-card { backdrop-filter: none; -webkit-backdrop-filter: none; }
    .commands-page .cmd-card:hover { transform: translateY(-2px); }
  }
`;

// ==========================================================================
// ⚠️ معاينة رسالة الإنذار الخاصة
// تحاكي شكل رسالة ديسكورد: نص فوق الإيمبد، ثم إيمبد بشريط لون جانبي.
// كل الألوان من متغيرات الهوية فتتبع أي تغيير لاحق للهوية تلقائياً.
// ==========================================================================
const WARN_DM_LAYER = `
  .warndm-vars { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:6px; }
  .warndm-var {
    font-family:inherit; font-size:12px; cursor:pointer;
    padding:5px 11px; border-radius:999px;
    color:var(--accent-soft) !important;
    background:rgba(131,77,217,.10) !important;
    border:1px solid rgba(131,77,217,.32) !important;
    box-shadow:none !important; transition:transform .16s ease, background .16s ease;
  }
  .warndm-var:hover { transform:translateY(-1px); background:rgba(131,77,217,.20) !important; }
  .warndm-var:active { transform:translateY(0) scale(.96); }

  .warndm-preview {
    border:1px solid var(--stroke); border-radius:14px;
    padding:14px; background:#1e1d20;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 8px 22px rgba(0,0,0,.26);
  }
  .warndm-preview-text { margin:0 0 10px; color:var(--text); font-size:14px; line-height:1.7; white-space:pre-wrap; word-break:break-word; }
  .warndm-preview-text:empty { display:none; }

  .warndm-embed {
    position:relative; border-radius:6px; padding:12px 14px 12px 16px;
    background:#252328; border-left:4px solid var(--accent);
    max-width:480px;
  }
  .warndm-embed[hidden] { display:none; }
  .warndm-embed-body { display:flex; gap:14px; align-items:flex-start; }
  .warndm-embed-main { flex:1; min-width:0; }
  .warndm-embed-title { margin:0 0 6px; font-weight:700; font-size:15px; color:#fff; word-break:break-word; }
  .warndm-embed-title:empty { display:none; }
  .warndm-embed-desc { margin:0; font-size:14px; line-height:1.7; color:#dddce0; white-space:pre-wrap; word-break:break-word; }
  .warndm-embed-desc:empty { display:none; }
  .warndm-embed-footer { margin:10px 0 0; font-size:12px; color:var(--muted); word-break:break-word; }
  .warndm-embed-footer:empty { display:none; }
  .warndm-embed-thumb { width:72px; height:72px; object-fit:cover; border-radius:6px; flex:none; }
  .warndm-embed-thumb[hidden] { display:none; }
  .warndm-embed-image { display:block; margin-top:12px; max-width:100%; border-radius:6px; }
  .warndm-embed-image[hidden] { display:none; }

  @media (max-width: 760px) { .warndm-embed-body { flex-direction:column; } }
`;

const siteLuxeTheme = `<style id="site-luxe-theme">${BASE_LAYER}${DEPTH_LAYER}${WARN_DM_LAYER}</style>`;

module.exports = siteLuxeTheme;
