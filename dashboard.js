const express = require('express');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder
} = require('discord.js');

// يستقبل pool (قاعدة البيانات) و client (بوت الديسكورد) من index.js
module.exports = function createDashboard(pool, client) {

// ==========================================
// 3. خادم الويب ولوحة التحكم الشاملة (Express)
// ==========================================
// 🔖 بصمة النسخة: مجموع تحقّق من محتوى هذا الملف نفسه، يُحسب عند الإقلاع.
//    سببه أن أكثر ما أضاع الوقت في تشخيص «الحفظ لا يعمل» هو عدم اليقين من
//    النسخة التي تعمل فعلاً على الخادم — فكثير من منصّات الاستضافة تحتاج
//    إعادة نشر صريحة، و git pull محلياً لا يغيّر ما تشغّله المنصّة.
//    الآن تظهر البصمة في اللوحة، فتُقارن بالمتوقّع في سطر واحد.
// عدد أوامر السلاش الفعلي — يُقرأ من المصدر الواحد (slashCommandConfig) بدل أي رقم مكتوب يدوياً.
const { SLASH_COMMAND_NAMES: DASHBOARD_SLASH_COMMAND_NAMES } = require('./slashCommandConfig');

const BUILD_ID = require('crypto')
  .createHash('sha1')
  .update(require('fs').readFileSync(__filename))
  .digest('hex')
  .slice(0, 8);
console.log(`🔖 بصمة نسخة لوحة التحكم: ${BUILD_ID}`);

// بصمة العملية نفسها، تُولَّد عشوائياً عند كل إقلاع.
//
// لماذا لا تكفي BUILD_ID: لو شغّل المالك نسختين من *نفس* الكود (وهو ما
// يحدث تلقائياً عند رفع عدد النسخ على منصّات الاستضافة، أو عند بقاء عملية
// قديمة حيّة بعد إعادة النشر) لكانت بصمة البناء متطابقة ولما كُشف التعدّد.
// أما هذه فتختلف حتماً بين عمليتين، فتفضح التعدّد مهما تطابق الكود.
const INSTANCE_ID = require('crypto').randomBytes(3).toString('hex');
console.log(`🧩 معرّف هذه العملية: ${INSTANCE_ID}`);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================================================
// 🛡️ طبقة الأمان والاستقرار (webSafety.js) — لا تغيّر سلوك أي صفحة تعمل بشكل سليم
//  • protectRouteRegistration: يلتقط أخطاء المعالجات async بدل ترك الطلب معلقاً للأبد
//  • protectAgainstCsrf: يحقن توكن CSRF في كل فورم POST ويتحقق منه قبل التنفيذ
// يجب استدعاؤهما هنا (قبل تعريف أي مسار) حتى يشملا كل مسارات اللوحة،
// بما فيها المسارات التي تضيفها ملفات xp.js و welcome.js و autoRoles.js لاحقاً.
// ==========================================================================
const webSafety = require('./webSafety');
const { safeText, safeTextOrNull, safeInteger, safeHexColor, safePathSegment } = webSafety;

// ⚡ الضغط أولاً: كل صفحة تخرج مضغوطة (gzip) فيصبح فتح /commands أسرع بكثير.
// لا يغيّر شيئاً في محتوى الصفحة، ولا يمسّ الطلبات غير النصية.
webSafety.installCompression(app);
webSafety.protectRouteRegistration(app);
webSafety.protectAgainstCsrf(app, process.env.DASHBOARD_PASSWORD || '');
webSafety.installErrorHandler(app);

// 🎨 هوية الموقع البصرية — انتقلت إلى siteTheme.js ليصبح تعديل المظهر
// معزولاً عن منطق الصفحات. الوسم نفسه يُحقن أدناه في كل صفحة تلقائياً.
const siteLuxeTheme = require('./siteTheme');

app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function themedSend(body) {
    // 🛡️ الحارس يبحث عن وسم الثيم نفسه (id="site-luxe-theme") لا عن النص المجرّد.
    // كان يبحث عن النص فقط، فأي صفحة تذكر الاسم في تعليق CSS كانت تُحسب
    // «مُنسَّقة سلفاً» ويتخطّاها الحقن — وهذا ما كان يحدث فعلاً لصفحة /commands:
    // تذكر الاسم في تعليق توضيحي، فتخرج بلا خلفية داكنة وبخلفية المتصفح البيضاء.
    if (typeof body === 'string' && !body.includes('id="site-luxe-theme"')) {
      if (/<\/head>/i.test(body)) {
        body = body.replace(/<\/head>/i, `${siteLuxeTheme}</head>`);
      } else if (/^\s*<(?:h[1-6]|p|div|form|section|article|ul|ol|table|!doctype|html)\b/i.test(body)) {
        body = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>لوحة التحكم</title>${siteLuxeTheme}</head><body><main class="container">${body}</main></body></html>`;
      }
    }
    return originalSend.call(this, body);
  };
  next();
});

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const dashboardAuth = require('./dashboardAuth');
const escapeHtml = require('./htmlEscape');
if (!DASHBOARD_PASSWORD) console.error('❌ المتغير DASHBOARD_PASSWORD غير مضبوط: تسجيل الدخول للوحة التحكم معطّل حتى تضبطه.');

function requireAuth(req, res, next) {
  if (dashboardAuth.isAuthed(req)) {
    return next();
  }
  res.redirect('/login');
}

function getRoleCatalog() {
  const guilds = client.guilds && client.guilds.cache ? [...client.guilds.cache.values()] : [];
  return guilds.map(guild => ({
    id: guild.id,
    name: guild.name,
    roles: [...guild.roles.cache.values()]
      .filter(role => role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
  }));
}

function renderRolePicker(fieldName, fieldId, storedValue) {
  const selectedIds = [...new Set(String(storedValue || '').split(',').map(id => id.trim()).filter(Boolean))];
  const roleCatalog = getRoleCatalog();
  const roleLabels = new Map();
  const groups = roleCatalog.map(guild => {
    const options = guild.roles.map(role => {
      // اسم الرتبة وحده بلا اسم السيرفر: أوضح وأقصر، وهو ما طلبه المالك.
      const label = role.name;
      roleLabels.set(role.id, label);
      return `<option value="${escapeHtml(role.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    return options ? `<optgroup label="${escapeHtml(guild.name)}">${options}</optgroup>` : '';
  }).join('');
  const chips = selectedIds.map(id => {
    const label = roleLabels.get(id) || 'رتبة محفوظة غير متاحة حالياً';
    return `<span class="role-chip" data-selected-role="${escapeHtml(id)}"><span>${escapeHtml(label)}</span><button type="button" data-remove-role="${escapeHtml(id)}" aria-label="إزالة الرتبة ${escapeHtml(label)}">×</button></span>`;
  }).join('');

  return `
    <div class="role-picker" data-role-picker>
      <div class="role-chips" data-role-chips>${chips}</div>
      <div class="role-select-row">
        <select id="${escapeHtml(fieldId)}-choice" data-role-choice>
          <option value="">اختر رتبة من القائمة…</option>
          ${groups}
        </select>
        <button class="role-add" type="button" data-role-add>إضافة رتبة</button>
      </div>
      <input type="hidden" name="${escapeHtml(fieldName)}" data-role-values value="${escapeHtml(selectedIds.join(','))}">
      <p class="role-picker-help" data-role-error role="status">${roleCatalog.some(guild => guild.roles.length) ? 'اضغط الرتبة لتُضاف فوراً — يمكنك تحديد أكثر من رتبة.' : 'لا توجد رتب محمّلة حالياً من سيرفرات البوت.'}</p>
    </div>
  `;
}

function combineRoleAndUserIds(roleIds, userIds) {
  return [...new Set([roleIds, userIds]
    .flatMap(value => String(value || '').split(','))
    .map(value => value.trim())
    .filter(Boolean))].join(',');
}

function splitRoleAndUnmatchedIds(storedValue) {
  const knownRoleIds = new Set(getRoleCatalog().flatMap(guild => guild.roles.map(role => role.id)));
  const values = [...new Set(String(storedValue || '').split(',').map(value => value.trim()).filter(Boolean))];
  return {
    roleIds: values.filter(value => knownRoleIds.has(value)).join(','),
    unmatchedIds: values.filter(value => !knownRoleIds.has(value)).join(',')
  };
}

// ==========================================
// 🏠 صفحة الهبوط العامة (Landing Page) — هي الصفحة الرئيسية الآن (/)
// أي زائر يدخل الموقع يشوفها مباشرة أولاً، بدل ما يوديه على تسجيل الدخول.
// واجهة عامة داكنة وفاخرة مع عناصر ثلاثية الأبعاد وتفاصيل المنصة قبل تسجيل الدخول.
// ==========================================
app.get('/', (req, res) => {
  const botName = (client.user && client.user.username) ? client.user.username : 'لوحة التحكم';
  const botAvatar = (client.user && client.user.displayAvatarURL) ? client.user.displayAvatarURL({ dynamic: true }) : '';
  const safeBotName = escapeHtml(botName);
  const brandMarkup = botAvatar
    ? `<img src="${escapeHtml(botAvatar)}" alt="${safeBotName}" class="brand-avatar">`
    : '<span class="brand-mark">ON</span>';
  const featureList = [
    ['🎫', 'منظومة تذاكر متكاملة', 'أنشئ لوحات بأزرار أو قوائم، ونظّم الاستلام والإغلاق وإعادة الفتح من مكان واحد.'],
    ['🧾', 'حفظ سجلات التذاكر', 'احفظ المحادثات والملفات كسجل واضح للرجوع إليه ومتابعة الحالات.'],
    ['📊', 'إحصاءات الاستلام', 'تابع استلام الإدارة والوسطاء، وعدّل السجلات أو صفّرها بصلاحيات مخصصة.'],
    ['⚙️', 'مركز تحكم الأوامر', 'فعّل أو عطّل الأوامر، وأضف اختصاراتك، واضبط صلاحيات كل مجموعة.'],
    ['🛡️', 'صلاحيات دقيقة', 'وزّع الصلاحيات على رتب وأعضاء محددين بدل الاعتماد على إعداد واحد للجميع.'],
    ['🔨', 'أدوات الإشراف', 'إدارة الحظر والمهل الزمنية والرتب والمسح والتحكم في القنوات من أوامر منظمة.'],
    ['🔐', 'إدارة القنوات', 'تحكم بالمشاهدة والكتابة والقفل والإخفاء، وحدد قنوات الاقتراحات والضريبة.'],
    ['📝', 'تقديمات الإدارة', 'استقبل طلبات التقديم داخل ديسكورد وراجعها من إعدادات واضحة.'],
    ['🏰', 'نظام الكلانات', 'نظّم الكلانات والتقديمات والمسؤولين مع ضبط مستقل للصلاحيات.'],
    ['⭐', 'الإكسبي والمكافآت', 'تابع تفاعل الأعضاء والمستويات، واربط الإنجاز برتب المكافآت.'],
    ['🎭', 'الرتب التلقائية', 'امنح الرتب المحددة تلقائياً عند انضمام العضو إلى السيرفر.'],
    ['👋', 'ترحيب قابل للتخصيص', 'جهّز رسائل ترحيب نصية أو إيمبد تناسب هوية مجتمعك.'],
    ['💬', 'الاقتراحات والمجتمع', 'خصص قنوات الاقتراحات وأدر التفاعل داخل السيرفر بطريقة مرتبة.'],
    ['💰', 'أوامر يومية مفيدة', 'حاسبة ضريبة، استدعاء الأعضاء، ورسائل إدارية بإعدادات وصلاحيات واضحة.'],
    ['📈', 'متابعة وإدارة مركزية', 'اجمع إعدادات السيرفر وإحصاءاته في لوحة واحدة سهلة الوصول.'],
    ['🧭', 'سجل المالك والتنبيهات', 'حدد قناة لسجل الأخطاء وتابع ما يحتاج انتباه الإدارة.'],
    ['✨', `${DASHBOARD_SLASH_COMMAND_NAMES.length} أمر سلاش موحّد`, 'أوامر معلومات وإشراف وصوت وإكسبي، مع اختصارات مجرّدة قابلة للإدارة.']
  ];
  const featureCards = featureList.map(([icon, title, description], index) => `
    <article class="feature-card" style="--feature-index:${index}">
      <span class="feature-icon" aria-hidden="true">${icon}</span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      <span class="feature-card-index">${String(index + 1).padStart(2, '0')}</span>
    </article>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="theme-color" content="#090a0e">
      <title>${safeBotName} — منصة الإدارة</title>
      <style>
        * { box-sizing:border-box; }
        html { scroll-behavior:smooth; }
        body { margin:0; min-height:100vh; overflow-x:hidden; font-family:"IBM Plex Sans Arabic","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif; color:#f4f1f8; background:#090a0e; }
        .landing-scene { position:fixed; inset:0; z-index:0; overflow:hidden; perspective:1100px; pointer-events:none; }
        .landing-scene::before { content:""; position:absolute; inset:0; opacity:.24; background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px); background-size:74px 74px; mask-image:linear-gradient(to bottom,black,transparent 80%); }
        .scene-glow { position:absolute; width:38vw; height:38vw; min-width:300px; min-height:300px; border-radius:50%; filter:blur(105px); opacity:.12; background:#59398c; }
        .scene-glow-a { top:-18vw; right:-11vw; }
        .scene-glow-b { bottom:-21vw; left:-14vw; width:45vw; height:45vw; background:#6536b1; opacity:.075; }
        .scene-object { position:absolute; transform:translate3d(var(--move-x,0px),var(--move-y,0px),0); transform-style:preserve-3d; transition:transform .65s cubic-bezier(.2,.75,.25,1); will-change:transform; }
        .cube-object { top:16%; left:9%; width:142px; height:142px; }
        .cube-rotator { position:relative; width:100%; height:100%; transform-style:preserve-3d; animation:cubeOrbit 34s linear infinite; }
        .cube-face { position:absolute; inset:0; display:block; border:1px solid rgba(127,66,226,.28); background:linear-gradient(145deg,rgba(79,39,144,.12),rgba(22,19,26,.08)); box-shadow:inset 0 0 34px rgba(91,35,182,.06); backdrop-filter:blur(3px); }
        .cube-front { transform:translateZ(71px); }
        .cube-back { transform:rotateY(180deg) translateZ(71px); }
        .cube-right { transform:rotateY(90deg) translateZ(71px); }
        .cube-left { transform:rotateY(-90deg) translateZ(71px); }
        .cube-top { transform:rotateX(90deg) translateZ(71px); }
        .cube-bottom { transform:rotateX(-90deg) translateZ(71px); }
        .cube-core { position:absolute; inset:30%; border:1px solid rgba(163,113,244,.5); border-radius:10px; transform:translateZ(24px) rotate(24deg); box-shadow:0 0 35px rgba(75,26,153,.20); }
        .orbit-object { top:35%; right:8%; width:230px; height:230px; }
        .orbit-ring { position:absolute; inset:0; border:1px solid rgba(127,66,226,.22); border-radius:50%; transform-style:preserve-3d; }
        .orbit-ring-one { transform:rotateX(67deg) rotateY(-18deg); animation:ringTurn 31s linear infinite; }
        .orbit-ring-two { inset:18px; transform:rotateX(75deg) rotateY(40deg); border-color:rgba(105,50,193,.14); animation:ringTurn 25s linear infinite reverse; }
        .orbit-ring-three { inset:43px; transform:rotateY(64deg) rotateX(24deg); border-color:rgba(116,61,204,.19); }
        .orbit-core { position:absolute; top:50%; left:50%; width:36px; height:36px; border-radius:50%; transform:translate(-50%,-50%); background:radial-gradient(circle at 32% 28%,#c7a6fb,#54299a 44%,#201a2a 78%); box-shadow:0 0 45px rgba(103,46,194,.32); }
        .sphere-object { bottom:13%; left:30%; width:86px; height:86px; border-radius:50%; background:radial-gradient(circle at 31% 26%,rgba(211,186,252,.92),rgba(126,69,217,.56) 16%,rgba(58,44,81,.28) 43%,rgba(19,19,17,.08) 74%); box-shadow:inset -14px -20px 34px rgba(4,4,8,.52),0 0 54px rgba(87,33,173,.16); animation:sphereFloat 7s ease-in-out infinite; }
        .prism-object { right:27%; bottom:15%; width:72px; height:72px; }
        .prism { width:100%; height:100%; border:1px solid rgba(127,66,226,.28); background:linear-gradient(135deg,rgba(71,31,136,.15),rgba(24,21,29,.08)); clip-path:polygon(50% 0,96% 26%,96% 76%,50% 100%,4% 76%,4% 26%); transform:rotate(19deg); animation:prismFloat 9s ease-in-out infinite; }
        .landing-nav { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; width:min(1220px,calc(100% - 48px)); min-height:82px; margin:0 auto; padding:0 4px; border-bottom:1px solid rgba(255,255,255,.075); }
        .landing-nav-actions { display:flex; align-items:center; gap:8px; }
        .brand { display:flex; align-items:center; gap:12px; text-decoration:none; color:#f6f3fa !important; }
        .brand-avatar,.brand-mark { width:42px; height:42px; border-radius:14px; border:1px solid rgba(127,66,226,.24); object-fit:cover; }
        .brand-mark { display:grid; place-items:center; background:linear-gradient(145deg,#231c2e,#17151d); color:#d3b9fc; font-size:13px; font-weight:800; letter-spacing:.12em; box-shadow:inset 0 1px 0 rgba(255,255,255,.09); }
        .brand-copy { display:flex; flex-direction:column; gap:2px; }
        .brand-copy strong { color:#f5f2f8; font-size:15px; font-weight:750; }
        .brand-copy small { color:#888691; font-size:11px; letter-spacing:.11em; }
        .nav-feature-link { display:inline-flex; align-items:center; gap:9px; padding:10px 15px; border:1px solid rgba(125,98,169,.15); border-radius:999px; color:#c8bdD6 !important; background:rgba(255,255,255,.025); text-decoration:none; font-size:13px; transition:all .25s ease; }
        .nav-feature-link:hover { border-color:rgba(127,66,226,.35); background:rgba(71,31,136,.09); transform:translateY(-1px); }
        .landing-main { position:relative; z-index:1; width:min(1220px,calc(100% - 48px)); margin:0 auto; }
        .hero { display:grid; grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr); align-items:center; gap:60px; min-height:570px; padding:62px 0 78px; }
        .hero-copy { max-width:690px; }
        .hero-kicker { display:inline-flex; align-items:center; gap:10px; margin-bottom:25px; padding:8px 13px; border:1px solid rgba(127,66,226,.18); border-radius:999px; background:rgba(24,21,31,.68); color:#a475f0; font-size:12px; }
        .live-dot { width:7px; height:7px; border-radius:50%; background:#8b54e4; box-shadow:0 0 12px rgba(127,66,226,.75); }
        .hero h1 { margin:0; max-width:720px; color:#f6f3f8; font-size:clamp(42px,6vw,76px); font-weight:850; line-height:1.35; letter-spacing:normal; }
        .hero h1 span { display:block; color:#a475f0; }
        .hero-copy > p { max-width:610px; margin:22px 0 28px; color:#b2afbb; font-size:17px; line-height:2; }
        .hero-points { display:flex; flex-wrap:wrap; gap:10px 20px; color:#9b98a4; font-size:12px; }
        .hero-points span { display:inline-flex; align-items:center; gap:7px; }
        .hero-points span::before { content:""; width:5px; height:5px; border-radius:50%; background:#834dd9; }
        .hero-visual { position:relative; display:grid; place-items:center; min-height:350px; perspective:1000px; }
        .hero-halo { position:absolute; width:330px; height:330px; border-radius:50%; background:radial-gradient(circle,rgba(71,31,136,.20),rgba(33,27,44,.08) 46%,transparent 72%); filter:blur(12px); }
        .control-preview { position:relative; width:min(100%,410px); padding:22px; border:1px solid rgba(127,66,226,.18); border-radius:22px; background:linear-gradient(145deg,rgba(28,26,34,.88),rgba(16,17,22,.90)); box-shadow:0 35px 90px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.07); backdrop-filter:blur(18px); transform:rotateY(-8deg) rotateX(3deg); animation:previewFloat 8s ease-in-out infinite; }
        .preview-top { display:flex; justify-content:space-between; align-items:center; gap:16px; padding-bottom:17px; border-bottom:1px solid rgba(255,255,255,.075); }
        .preview-title { display:flex; flex-direction:column; gap:5px; }
        .preview-title strong { color:#f0edf5; font-size:14px; }
        .preview-title span { color:#83818c; font-size:11px; }
        .preview-status { display:inline-flex; align-items:center; gap:7px; padding:6px 9px; border:1px solid rgba(127,66,226,.20); border-radius:999px; color:#b392e8; font-size:10px; }
        .preview-status i { width:6px; height:6px; border-radius:50%; background:#9667e1; box-shadow:0 0 9px rgba(127,66,226,.7); }
        .preview-stats { display:grid; grid-template-columns:repeat(2,1fr); gap:11px; padding:17px 0; }
        .preview-stat { padding:13px; border:1px solid rgba(255,255,255,.065); border-radius:13px; background:rgba(255,255,255,.025); }
        .preview-stat span { display:block; color:#9996a2; font-size:10px; }
        .preview-stat strong { display:block; margin-top:7px; color:#f2edf8; font-size:21px; font-weight:750; }
        .preview-stat small { color:#8a5ed0; font-size:10px; }
        .preview-list { display:grid; gap:8px; }
        .preview-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:11px 12px; border:1px solid rgba(255,255,255,.055); border-radius:11px; background:rgba(255,255,255,.018); }
        .preview-row span { color:#b7b3bf; font-size:11px; }
        .preview-row b { color:#c3a8ed; font-size:11px; font-weight:600; }
        .preview-row b::before { content:""; display:inline-block; width:5px; height:5px; margin-left:7px; border-radius:50%; background:#834dd9; vertical-align:middle; }
        .features-shell { position:relative; margin:8px 0 28px; padding:clamp(24px,4vw,48px); border:1px solid rgba(127,66,226,.14); border-radius:27px; background:linear-gradient(145deg,rgba(18,19,24,.97),rgba(15,16,21,.94)); box-shadow:0 30px 80px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.045); overflow:hidden; }
        .features-shell::before { content:""; position:absolute; top:-170px; left:-130px; width:400px; height:400px; border-radius:50%; background:radial-gradient(circle,rgba(71,31,136,.12),transparent 69%); pointer-events:none; }
        .features-heading { position:relative; display:flex; justify-content:space-between; align-items:end; gap:24px; margin-bottom:30px; }
        .features-overline { display:block; margin-bottom:9px; color:#834dd9; font-size:11px; font-weight:750; }
        .features-heading h2 { margin:0; color:#f3f0f7; font-size:clamp(24px,3vw,36px); font-weight:800; line-height:1.4; }
        .features-heading p { max-width:390px; margin:0; color:#96939e; font-size:13px; line-height:1.9; }
        .features-grid { position:relative; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
        .features-actions { position:relative; display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:18px; padding-top:18px; border-top:1px solid rgba(255,255,255,.07); color:#96939e; font-size:12px; }
        .features-button { display:inline-flex; align-items:center; gap:9px; min-height:42px; padding:0 15px; border:1px solid #362354; border-radius:10px; background:linear-gradient(120deg,#1f0e3a,#1a1523); color:#eee8f6 !important; text-decoration:none; font-weight:700; transition:transform .2s ease,border-color .2s ease,background .2s ease; }
        .features-button:hover { transform:translateY(-2px); border-color:#54299a; background:#1c0f31; }
        .feature-card { position:relative; min-height:173px; padding:19px 18px; border:1px solid rgba(255,255,255,.07); border-radius:16px; background:linear-gradient(145deg,rgba(26,27,33,.90),rgba(19,20,25,.96)); box-shadow:inset 0 1px 0 rgba(255,255,255,.025); transform-style:preserve-3d; transition:border-color .28s ease,background .28s ease,box-shadow .28s ease,transform .28s cubic-bezier(.2,.8,.2,1); animation:featureArrive .55s cubic-bezier(.2,.8,.2,1) both; animation-delay:calc(var(--feature-index,0) * 35ms); }
        .feature-card:hover { border-color:rgba(127,66,226,.30); background:linear-gradient(145deg,#202027,#191a20); box-shadow:0 14px 32px rgba(0,0,0,.28),0 0 24px rgba(71,31,136,.09); transform:translateY(-4px) perspective(900px) rotateX(var(--tilt-y,0deg)) rotateY(var(--tilt-x,0deg)); }
        .feature-icon { display:grid; place-items:center; width:39px; height:39px; margin-bottom:17px; border:1px solid rgba(127,66,226,.16); border-radius:12px; background:rgba(71,31,136,.11); font-size:18px; transform:translateZ(16px); }
        .feature-card h3 { position:relative; margin:0 0 8px; color:#ebe7f0; font-size:14px; font-weight:750; transform:translateZ(12px); }
        .feature-card p { position:relative; margin:0; max-width:32em; color:#9996a1; font-size:12px; line-height:1.85; transform:translateZ(8px); }
        .feature-card-index { position:absolute; top:17px; left:17px; color:rgba(178,163,201,.28); font-size:10px; font-weight:700; letter-spacing:.08em; }
        .access-cta { display:flex; justify-content:space-between; align-items:center; gap:24px; margin:22px 0 64px; padding:25px 29px; border:1px solid rgba(127,66,226,.18); border-radius:20px; background:linear-gradient(110deg,rgba(25,20,34,.84),rgba(18,19,24,.94) 66%); box-shadow:0 20px 55px rgba(0,0,0,.25); }
        .access-copy strong { display:block; margin-bottom:5px; color:#f2eef7; font-size:19px; }
        .access-copy span { color:#a29eaa; font-size:12px; line-height:1.8; }
        .access-actions { display:flex; align-items:center; gap:14px; flex-shrink:0; }
        .access-button { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:48px; padding:0 20px; border:1px solid rgba(127,66,226,.27); border-radius:12px; background:linear-gradient(125deg,#3e1d73,#2a1848 58%,#441e82); box-shadow:0 8px 22px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.07); color:#fff !important; text-decoration:none; font-size:13px; font-weight:750; transition:transform .24s ease,box-shadow .24s ease,filter .24s ease; }
        .access-button:hover { transform:translateY(-3px); filter:brightness(1.12); box-shadow:0 13px 28px rgba(0,0,0,.34),0 0 22px rgba(83,36,158,.15); }
        .access-button:active { transform:translateY(0) scale(.98); }
        .access-note { color:#827f8a; font-size:11px; }
        .site-footer { position:relative; z-index:1; padding:22px 24px 30px; border-top:1px solid rgba(255,255,255,.065); color:#777681; text-align:center; font-size:11px; }
        @keyframes cubeOrbit { from { transform:rotateX(-22deg) rotateY(0deg) rotateZ(0deg); } to { transform:rotateX(338deg) rotateY(360deg) rotateZ(360deg); } }
        @keyframes ringTurn { from { rotate:0deg; } to { rotate:360deg; } }
        @keyframes sphereFloat { 0%,100% { translate:0 0; } 50% { translate:0 -18px; } }
        @keyframes prismFloat { 0%,100% { translate:0 0; rotate:0deg; } 50% { translate:0 -14px; rotate:14deg; } }
        @keyframes previewFloat { 0%,100% { translate:0 0; } 50% { translate:0 -10px; } }
        @keyframes featureArrive { from { opacity:0; translate:0 12px; } to { opacity:1; translate:0 0; } }
        @media(max-width:980px) { .hero { grid-template-columns:1fr 340px; gap:32px; } .features-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .cube-object { left:1%; } .orbit-object { right:0; } }
        @media(max-width:720px) { .landing-nav,.landing-main { width:calc(100% - 32px); } .landing-nav { min-height:70px; } .landing-nav-actions { gap:5px; } .landing-nav-actions .nav-feature-link { padding:8px 10px; font-size:11px; } .hero { grid-template-columns:1fr; min-height:auto; gap:15px; padding:58px 0 42px; } .hero h1 { font-size:clamp(39px,11vw,58px); } .hero-copy > p { font-size:15px; } .hero-visual { min-height:300px; } .control-preview { width:min(100%,430px); transform:none; } .features-heading { display:block; } .features-heading p { margin-top:10px; } .features-actions { align-items:flex-start; flex-direction:column; } .features-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .feature-card { min-height:168px; padding:16px 14px; } .access-cta { align-items:flex-start; flex-direction:column; padding:22px; } .access-actions { align-items:flex-start; flex-direction:column; } .scene-object { opacity:.52; } .orbit-object { right:-95px; top:44%; } .cube-object { left:-55px; top:22%; } .sphere-object { left:10%; bottom:10%; } .prism-object { right:12%; bottom:7%; } }
        @media(max-width:420px) { .features-grid { grid-template-columns:1fr; } .feature-card { min-height:145px; } .hero-kicker { font-size:10px; } .preview-stat strong { font-size:18px; } .features-shell { padding:22px 16px; border-radius:20px; } }
        @media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; scroll-behavior:auto !important; } }
      </style>
    </head>
    <body>
      <div class="landing-scene" data-pointer-scene aria-hidden="true">
        <div class="scene-glow scene-glow-a"></div><div class="scene-glow scene-glow-b"></div>
        <div class="scene-object cube-object" data-depth="25"><div class="cube-rotator"><i class="cube-face cube-front"></i><i class="cube-face cube-back"></i><i class="cube-face cube-right"></i><i class="cube-face cube-left"></i><i class="cube-face cube-top"></i><i class="cube-face cube-bottom"></i><i class="cube-core"></i></div></div>
        <div class="scene-object orbit-object" data-depth="-32"><i class="orbit-ring orbit-ring-one"></i><i class="orbit-ring orbit-ring-two"></i><i class="orbit-ring orbit-ring-three"></i><i class="orbit-core"></i></div>
        <div class="scene-object sphere-object" data-depth="38"></div>
        <div class="scene-object prism-object" data-depth="-20"><div class="prism"></div></div>
      </div>
      <nav class="landing-nav">
        <a class="brand" href="/" aria-label="الصفحة الرئيسية">
          ${brandMarkup}
          <span class="brand-copy"><strong>${safeBotName}</strong><small>CONTROL SUITE</small></span>
        </a>
        <div class="landing-nav-actions"><a class="nav-feature-link" href="#features">اكتشف المنصة <span aria-hidden="true">↓</span></a><a class="nav-feature-link" href="/commands-list">دليل الأوامر</a></div>
      </nav>
      <main class="landing-main">
        <section class="hero">
          <div class="hero-copy">
            <div class="hero-kicker"><i class="live-dot"></i> منصة متكاملة لإدارة مجتمعك على ديسكورد</div>
            <h1>كل أدوات سيرفرك،<span>بتجربة تليق بمجتمعك.</span></h1>
            <p>إدارة أذكى للتذاكر، الأعضاء، الأوامر والصلاحيات — من لوحة واحدة مصممة لتمنحك رؤية أوضح وتحكماً أسهل.</p>
            <div class="hero-points"><span>إعدادات واضحة</span><span>تحكم دقيق بالصلاحيات</span><span>تجربة عربية متكاملة</span></div>
          </div>
          <div class="hero-visual" aria-hidden="true">
            <div class="hero-halo"></div>
            <div class="control-preview">
              <div class="preview-top"><div class="preview-title"><strong>نظرة على المنصة</strong><span>إدارة موحّدة · تجربة منظمة</span></div><div class="preview-status"><i></i> جاهز للإدارة</div></div>
              <div class="preview-stats"><div class="preview-stat"><span>إدارة التذاكر</span><strong>منظّمة</strong><small>من اللوحة إلى الإغلاق</small></div><div class="preview-stat"><span>الصلاحيات</span><strong>مرنة</strong><small>حسب الرتبة والأمر</small></div></div>
              <div class="preview-list"><div class="preview-row"><span>مركز الأوامر</span><b>تفعيل واختصارات</b></div><div class="preview-row"><span>تجربة الأعضاء</span><b>ترحيب ومكافآت</b></div><div class="preview-row"><span>إدارة السيرفر</span><b>أدوات متكاملة</b></div></div>
            </div>
          </div>
        </section>
        <section class="features-shell" id="features">
          <div class="features-heading"><div><span class="features-overline">منظومة واحدة · أدوات متكاملة</span><h2>كل المميزات، قبل ما تسجّل دخولك</h2></div><p>تعرّف على ما توفره لوحة التحكم من أدوات فعلية لإدارة التذاكر، الأوامر، الصلاحيات، ونشاط المجتمع.</p></div>
          <div class="features-grid">${featureCards}</div>
          <div class="features-actions"><span>استعرض طريقة الاستخدام والصلاحيات لكل أمر سلاش.</span><a class="features-button" href="/commands-list">دليل أوامر السلاش <span aria-hidden="true">←</span></a></div>
        </section>
        <section class="access-cta" id="login">
          <div class="access-copy"><strong>جاهز تدير سيرفرك بطريقة أرتب؟</strong><span>سجّل الدخول للوصول إلى إعداداتك ولوحة التحكم الكاملة.</span></div>
          <div class="access-actions"><span class="access-note">إعداداتك تبقى محفوظة في مكان واحد</span><a href="/login" class="access-button">دخول لوحة التحكم <span aria-hidden="true">←</span></a></div>
        </section>
      </main>
      <footer class="site-footer">© 2026 ${safeBotName} · كل الحقوق محفوظة</footer>
      <script>
        (() => {
          const scene = document.querySelector('[data-pointer-scene]');
          if (!scene || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          const objects = Array.from(scene.querySelectorAll('[data-depth]'));
          let frame = 0;
          let pointerX = 0;
          let pointerY = 0;
          const paintScene = () => {
            objects.forEach(object => {
              const depth = Number(object.dataset.depth) || 0;
              object.style.setProperty('--move-x', (pointerX * depth).toFixed(1) + 'px');
              object.style.setProperty('--move-y', (pointerY * depth).toFixed(1) + 'px');
            });
            frame = 0;
          };
          window.addEventListener('pointermove', event => {
            pointerX = (event.clientX / Math.max(window.innerWidth, 1) - .5) * 2;
            pointerY = (event.clientY / Math.max(window.innerHeight, 1) - .5) * 2;
            if (!frame) frame = window.requestAnimationFrame(paintScene);
          }, { passive:true });
          window.addEventListener('pointerleave', () => {
            pointerX = 0;
            pointerY = 0;
            if (!frame) frame = window.requestAnimationFrame(paintScene);
          });
        })();
      </script>
    </body>
    </html>
  `);
});

// دليل عام لأوامر السلاش — صفحة قراءة فقط لا تحتاج تسجيل دخول.
app.get('/commands-list', (req, res) => {
  const commandGroups = [
    {
      title: 'عام ومجتمعي', key: 'general',
      commands: [
        ['credits', '/credits [member] [amount]', 'عرض رصيدك أو رصيد عضو. لإرسال رصيد، حدد العضو والمبلغ.'],
        ['creditsgrant', '/creditsgrant member amount', 'إضافة رصيد ابتدائي لعضو؛ تتطلب صلاحية إدارة السيرفر.'],
        ['rep', '/rep member', 'منح عضو نقطة سمعة واحدة، مرة كل 24 ساعة.'],
        ['moveme', '/moveme channel أو member', 'انقل نفسك إلى روم صوتي محدد أو روم العضو الذي تختاره. يحتاج البوت صلاحية نقل الأعضاء.'],
        ['color', '/color role', 'اختيار رتبة لون اسمها يبدأ بـ Color أو لون ولا تمنح صلاحيات؛ يستبدل لونك السابق.'],
        ['colors', '/colors', 'عرض رتب الألوان القابلة للاختيار.'],
        ['short', '/short url', 'إنشاء رابط مختصر عبر is.gd؛ يُرسل الرابط إلى خدمة خارجية للاختصار.'],
        ['roll', '/roll [sides]', 'رمي نرد؛ عدد الأوجه الافتراضي 6.'],
        ['help', '/help', 'عرض قائمة جميع الأوامر وشرحها مع رابط اللوحة.']
      ]
    },
    {
      title: 'الإكسبي والملف الشخصي', key: 'xp',
      commands: [
        ['profile', '/profile [member]', 'عرض الملف الشخصي والمستوى والترتيب وإجمالي الإكسبي وإكسبي الفترات. وللمالك إضافة اختصارات تُكتب مجرّدة بلا بريفكس من صفحة الأوامر.'],
        ['top', '/top [period] [archive]', 'عرض أعلى 10 أعضاء للفترة الحالية، أو لتاريخ محفوظ في الأرشيف عبر خيار archive مع تحديد الفترة.'],
        ['title', '/title title', 'تعيين لقب يظهر في ملفك الشخصي.'],
        ['setxp', '/setxp member amount', 'تعيين إجمالي XP لعضو؛ يتطلب صلاحية إدارة السيرفر.'],
        ['setlevel', '/setlevel member level', 'تعيين مستوى عضو؛ يتطلب صلاحية إدارة السيرفر.'],
        ['reset', '/reset period [member]', 'تصفير إجمالي XP أو اليومي أو الأسبوعي أو الشهري لعضو أو لأعضاء السيرفر.'],
        ['myinfo', '/myinfo', 'عرض إكسبيك ومرات تصدّرك للتوب وتذاكرك المستلمة.'],
        ['xpmanage', '/xpmanage add|remove member amount period', 'إضافة أو سحب إكسبي من عضو لفترة محددة (كلي أو يومي أو أسبوعي أو شهري).']
      ]
    },
    {
      title: 'معلومات السيرفر والأعضاء', key: 'info',
      commands: [
        ['user', '/user [member]', 'عرض آيدي العضو وتاريخ إنشاء الحساب وتاريخ الانضمام للسيرفر.'],
        ['avatar', '/avatar [member] [type]', 'عرض الصورة العامة أو صورة العضو في السيرفر أو البانر.'],
        ['server', '/server', 'عرض معلومات السيرفر الأساسية.'],
        ['roles', '/roles', 'عرض الرتب وعدد الأعضاء الظاهرين في ذاكرة البوت.']
      ]
    },
    {
      title: 'الإشراف والقنوات والصوت', key: 'moderation',
      commands: [
        ['setnick', '/setnick member [nickname]', 'تغيير لقب عضو؛ عدم تحديد اللقب يزيل اللقب الحالي.'],
        ['ban', '/ban member [duration_minutes] [reason]', 'حظر مؤقت أو دائم؛ الحظر المؤقت يُرفع تلقائياً حتى بعد إعادة تشغيل البوت.'],
        ['unban', '/unban user_id [reason]', 'فك حظر حساب باستخدام آيدي ديسكورد.'],
        ['kick', '/kick member [reason]', 'طرد عضو من السيرفر.'],
        ['vkick', '/vkick member [reason]', 'فصل عضو متصل من الروم الصوتي.'],
        ['time', '/time text|voice member [minutes] [reason]', 'أمر موحّد: Timeout كتابي أو كتم صوتي؛ مدة الكتابي الافتراضية 60 دقيقة.'],
        ['untime', '/untime text|voice member [reason]', 'أمر موحّد لإزالة Timeout الكتابي أو إلغاء الكتم الصوتي.'],
        ['clear', '/clear amount [member]', 'حذف حتى 100 رسالة حديثة، اختيارياً لعضو محدد؛ الرسائل الأقدم من 14 يوماً لا تُحذف بالجملة.'],
        ['move', '/move member [channel]', 'نقل عضو إلى روم صوتي محدد أو إلى رومك الحالي.'],
        ['lock', '/lock [channel] [reason]', 'قفل الكتابة في روم نصي.'],
        ['unlock', '/unlock [channel]', 'فتح الكتابة في روم نصي.'],
        ['hide', '/hide [channel]', 'إخفاء قناة عن الأعضاء؛ صلاحيات هذا الأمر مستقلة.'],
        ['show', '/show [channel]', 'إظهار قناة للأعضاء؛ صلاحيات هذا الأمر مستقلة عن /hide.'],
        ['slowmode', '/slowmode seconds [channel]', 'تعيين مهلة الإبطاء بالثواني؛ صفر يوقفها.'],
        ['mute', '/mute text|voice member [minutes] [reason]', 'كتم عضو كتابياً فقط أو صوتياً فقط.'],
        ['unmute', '/unmute text|voice member [reason]', 'فك الكتم الكتابي أو الصوتي عن عضو.'],
        ['channel', '/channel view|write|rename|tax|suggestions …', 'التحكم بصلاحيات الروم الحالي واسمه ورومات الضريبة والاقتراحات.']
      ]
    },
    {
      title: 'الرتب والألوان', key: 'roles',
      commands: [
        ['role', '/role give|remove|multiple ...', 'إعطاء أو سحب رتبة لعضو، أو تنفيذ العملية لحاملي رتبة أساس. التنفيذ الجماعي محدود بأول 100 عضو حمايةً للسيرفر.'],
        ['setcolor', '/setcolor role hex', 'تغيير لون رتبة بصيغة Hex مثل #4f46e5.']
      ]
    },
    {
      title: 'النقاط والإنذارات', key: 'records',
      commands: [
        ['points', '/points set|increase|decrease|list|reset', 'إدارة نقاط الأعضاء وعرض قائمة النقاط؛ يتطلب صلاحية إدارة الرسائل.'],
        ['warn', '/warn member reason', 'تسجيل إنذار محفوظ في قاعدة البيانات؛ يتطلب صلاحية إدارة الرسائل.'],
        ['warn_remove', '/warn_remove warning_id أو member', 'حذف إنذار محدد أو جميع إنذارات عضو؛ يتطلب صلاحية إدارة الرسائل.'],
        ['warnings', '/warnings [member]', 'عرض إنذاراتك أو إنذارات عضو؛ عرض عضو آخر يتطلب صلاحية إدارة الرسائل.']
      ]
    },
    {
      title: 'التذاكر والاستلام', key: 'tickets',
      commands: [
        ['ticket', '/ticket close|save|delete|add|remove|rename', 'أوامر التحكم بالتذكرة من داخل روم التذكرة.'],
        ['claimstats', '/claimstats add|remove|reset|resetall type member amount', 'التحكم بسجل التذاكر المستلمة للإدارة والوسطاء.']
      ]
    },
    {
      title: 'حالة البوت وسجلاته', key: 'system',
      commands: [
        ['botstatus', '/botstatus set|about', 'إدارة حالة البوت ووصفه.'],
        ['logchannel', '/logchannel [channel]', 'تحديد روم استقبال سجلات أخطاء البوت.']
      ]
    },
    {
      title: 'الضريبة والاستدعاء والتحدث والكلانات', key: 'extras',
      commands: [
        ['tax', '/tax amount', 'حساب المبلغ الصافي والمبلغ المطلوب تحويله بعد الضريبة.'],
        ['come', '/come member', 'إرسال إشعار استدعاء بالخاص للعضو مع رابط مباشر للروم.'],
        ['say', '/say text', 'نشر نص باسم البوت في الروم الحالي.'],
        ['clan', '/clan create', 'لوحات نظام الكلانات وإنشاء كلان جديد برتبته وروماته.']
      ]
    }
  ];

  // 🔤 ترتيب أوامر كل مجموعة أبجدياً (a → z) بدل ترتيب كتابتها في الكود،
  // حتى يجد الزائر الأمر الذي يبحث عنه في موضعه المتوقَّع داخل المجموعة.
  // المجموعات نفسها تبقى بترتيبها المقصود (من العام إلى المتخصص).
  const { sortByName } = require('./commandSorting');
  for (const group of commandGroups) {
    group.commands = sortByName(group.commands, ([name]) => name);
  }

  const commandCount = commandGroups.reduce((count, group) => count + group.commands.length, 0);
  const groupsHTML = commandGroups.map(group => `
    <section class="command-group" data-command-group="${group.key}">
      <header class="command-group-heading"><div><span class="command-group-kicker">COMMAND CATEGORY</span><h2>${escapeHtml(group.title)}</h2></div><span class="command-group-count">${group.commands.length} أوامر</span></header>
      <div class="command-directory-grid">
        ${group.commands.map(([name, usage, description]) => `
          <article class="directory-command" data-command-card data-search="${escapeHtml(`${name} ${usage} ${description}`)}">
            <div class="directory-command-top"><code>/${escapeHtml(name)}</code><span class="directory-command-dot" aria-hidden="true"></span></div>
            <p>${escapeHtml(description)}</p>
            <div class="directory-usage"><span>الاستخدام</span><code>${escapeHtml(usage)}</code></div>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');

  res.send(`
    <!doctype html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="theme-color" content="#090a0e">
      <title>دليل أوامر السلاش — ${escapeHtml(client.user?.username || 'البوت')}</title>
      <style>
        .directory-nav { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px clamp(12px,4vw,34px); border-bottom:1px solid #25262e; }
        .command-directory { width:min(1180px,calc(100% - 36px)); margin:0 auto; padding:38px 0 70px; }
        .directory-hero { position:relative; overflow:hidden; padding:clamp(24px,5vw,46px); border:1px solid #282232; border-radius:24px; background:radial-gradient(ellipse at 0 0,rgba(71,31,136,.15),transparent 46%),linear-gradient(130deg,#19181f,#111217 72%); box-shadow:0 24px 70px rgba(0,0,0,.27); }
        .directory-hero::after { content:"/"; position:absolute; left:5%; top:-80px; color:rgba(127,66,226,.045); font-size:300px; font-weight:900; line-height:1; pointer-events:none; }
        .directory-hero-content { position:relative; z-index:1; max-width:760px; }
        .directory-eyebrow,.command-group-kicker { color:#834dd9; font-size:10px; font-weight:800; letter-spacing:.13em; }
        .directory-hero h1 { margin:8px 0 10px; color:#f3f0f7; font-size:clamp(28px,5vw,44px); line-height:1.3; }
        .directory-hero p { max-width:700px; margin:0; color:#a4a1ad; font-size:14px; line-height:1.9; }
        .directory-badge { display:inline-flex; align-items:center; gap:8px; margin-top:22px; padding:7px 11px; border:1px solid #342b43; border-radius:999px; background:#17151c; color:#b597e5; font-size:11px; }
        .directory-tools { position:sticky; top:68px; z-index:20; display:flex; align-items:center; justify-content:space-between; gap:16px; margin:22px 0 30px; padding:10px 12px; border:1px solid #292a33; border-radius:14px; background:rgba(15,16,20,.95); box-shadow:0 12px 30px rgba(0,0,0,.24); backdrop-filter:blur(14px); }
        .directory-search { width:min(100%,430px); min-height:44px; margin:0; padding:10px 13px; border:1px solid #2b2436; border-radius:10px; background:#101116; color:#eeeaf5; font:inherit; }
        .directory-search::placeholder { color:#807c89; }
        .directory-result-count { flex:0 0 auto; color:#aaa5b1; font-size:12px; }
        .command-group { margin:0 0 34px; }
        .command-group-heading { display:flex; align-items:end; justify-content:space-between; gap:14px; margin:0 2px 13px; }
        .command-group-heading h2 { margin:4px 0 0; color:#eeeaf5; font-size:20px; }
        .command-group-count { padding:5px 9px; border:1px solid #292332; border-radius:999px; color:#a9a3af; background:#15151a; font-size:10px; white-space:nowrap; }
        .command-directory-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
        .directory-command { display:flex; min-height:178px; flex-direction:column; padding:16px; border:1px solid #292a33; border-radius:15px; background:linear-gradient(145deg,#17181e,#121318); box-shadow:0 8px 22px rgba(0,0,0,.14); transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease; }
        .directory-command:hover { transform:translateY(-3px); border-color:#3b2065; box-shadow:0 16px 32px rgba(0,0,0,.25); }
        .directory-command-top { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .directory-command-top code { color:#ac81f2; font-size:15px; font-weight:800; direction:ltr; unicode-bidi:isolate; }
        .directory-command-dot { width:7px; height:7px; border-radius:50%; background:#7443c2; box-shadow:0 0 12px rgba(155,130,184,.4); }
        .directory-command p { flex:1; margin:11px 0 15px; color:#aaa6b1; font-size:12px; line-height:1.8; }
        .directory-usage { display:flex; flex-direction:column; gap:6px; padding-top:11px; border-top:1px solid #282830; }
        .directory-usage span { color:#787581; font-size:10px; }
        .directory-usage code { color:#c3a3f5; font-size:11px; direction:ltr; text-align:left; unicode-bidi:plaintext; overflow-wrap:anywhere; }
        .directory-empty { display:none; margin:35px 0; padding:24px; border:1px dashed #2f293a; border-radius:14px; color:#a9a3af; text-align:center; }
        .directory-empty.is-visible { display:block; }
        .directory-footer { padding:16px 18px; border:1px solid #292831; border-radius:14px; color:#918c98; background:#131419; font-size:12px; line-height:1.8; }
        .directory-footer a { color:#a475f0 !important; }
        @media(max-width:900px) { .command-directory-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media(max-width:620px) { .command-directory { width:calc(100% - 24px); padding:22px 0 45px; } .directory-tools { top:72px; align-items:stretch; flex-direction:column; } .directory-search { width:100%; } .command-directory-grid { grid-template-columns:1fr; } .directory-command { min-height:155px; } .command-group-heading { align-items:flex-start; } }
        @media(prefers-reduced-motion:reduce) { .directory-command,.features-button { transition:none; } }
      </style>
    </head>
    <body>
      <nav class="directory-nav">
        <div class="links"><a href="/">الرئيسية</a><a href="/commands-list">دليل الأوامر</a></div>
        <a href="/login">دخول لوحة التحكم</a>
      </nav>
      <main class="command-directory">
        <header class="directory-hero"><div class="directory-hero-content">
          <span class="directory-eyebrow">SLASH COMMANDS · QUICK GUIDE</span>
          <h1>دليل أوامر البوت</h1>
          <p>ابحث عن الأمر، راجع طريقة استخدامه والصلاحية المطلوبة، ثم استخدمه بالسلاش / أو بالاختصار المجرّد الذي يضبطه المسؤول. أوامر الإشراف تظل خاضعة لصلاحيات البوت وترتيب الرتب.</p>
          <span class="directory-badge">✨ دليل كامل: ${commandCount} أمر · متاح للجميع</span>
        </div></header>
        <div class="directory-tools"><input class="directory-search" type="search" id="commandSearch" placeholder="ابحث باسم الأمر أو وظيفته…" aria-label="ابحث في الأوامر"><span class="directory-result-count" id="commandResultCount" aria-live="polite">${commandCount} أمر</span></div>
        ${groupsHTML}
        <div class="directory-empty" id="commandEmpty">ما لقينا أوامر تطابق بحثك. جرّب كلمة ثانية.</div>
        <aside class="directory-footer">ملاحظات: <code>/short</code> يرسل الرابط إلى خدمة is.gd الخارجية. رتب الألوان القابلة للاختيار يجب أن يبدأ اسمها بـ <code>Color</code> أو <code>لون</code> وألا تمنح صلاحيات. <a href="/">العودة إلى الصفحة الرئيسية</a>.</aside>
      </main>
      <script>
        (() => {
          const input = document.getElementById('commandSearch');
          const cards = [...document.querySelectorAll('[data-command-card]')];
          const groups = [...document.querySelectorAll('[data-command-group]')];
          const count = document.getElementById('commandResultCount');
          const empty = document.getElementById('commandEmpty');
          const filter = () => {
            const term = input.value.trim().toLocaleLowerCase('ar');
            let visible = 0;
            for (const card of cards) {
              const match = card.dataset.search.toLocaleLowerCase('ar').includes(term);
              card.hidden = !match;
              if (match) visible++;
            }
            for (const group of groups) group.hidden = !group.querySelector('[data-command-card]:not([hidden])');
            count.textContent = visible + ' من ' + cards.length + ' أمر';
            empty.classList.toggle('is-visible', visible === 0);
          };
          input.addEventListener('input', filter);
        })();
      </script>
    </body>
    </html>
  `);
});

app.get('/login', (req, res) => {
  const loginError = req.query.error === '1' ? '<p class="login-error" role="alert">كلمة المرور غير صحيحة. حاول مرة أخرى.</p>' : '';
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>تسجيل الدخول — لوحة التحكم</title>
      <style>
        body { font-family:"IBM Plex Sans Arabic","Noto Sans Arabic","Segoe UI",Tahoma,Arial,sans-serif; background:#090a0e; color:#f2f0f6; display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0; padding:24px; }
        .login-card { position:relative; background:linear-gradient(145deg,#191920,#121318); padding:clamp(26px,5vw,42px); border-radius:22px; box-shadow:0 28px 80px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.05); width:100%; max-width:430px; text-align:right; border:1px solid #282232; }
        .login-brand { display:flex; align-items:center; gap:12px; margin-bottom:30px; }
        .login-brand-mark { display:grid; place-items:center; width:46px; height:46px; border:1px solid #362354; border-radius:15px; color:#c5a4fa; background:linear-gradient(145deg,#231c2e,#17151d); font-size:13px; font-weight:800; letter-spacing:.1em; }
        .login-brand-copy strong { display:block; color:#f2eff6; font-size:14px; }
        .login-brand-copy span { color:#898591; font-size:10px; letter-spacing:.1em; }
        .login-eyebrow { color:#834dd9; font-size:11px; font-weight:700; }
        .login-card h2 { margin:7px 0 8px; color:#f3f0f7; font-size:26px; }
        .login-description { margin:0 0 24px; color:#a4a1ad; font-size:13px; line-height:1.8; }
        .login-card label { display:block; margin:0 0 7px; color:#d8d4df; font-size:12px; font-weight:700; }
        .login-card input[type="password"] { width:100%; min-height:48px; padding:12px 14px; margin:0 0 15px; border-radius:10px; border:1px solid #33313a; background:#0d0e12; color:#fff; box-sizing:border-box; font:inherit; }
        .login-card button { width:100%; min-height:48px; padding:12px; border-radius:10px; font-weight:750; }
        .login-error { padding:10px 12px; border:1px solid #65404b; border-radius:10px; color:#efcbd4; background:#25191e; font-size:12px; }
        .login-bottom { display:flex; justify-content:space-between; gap:12px; margin-top:20px; padding-top:16px; border-top:1px solid #2a2931; font-size:12px; }
        .login-back { color:#976bdd !important; text-decoration:none; }
        .login-secure { color:#85828d; }
        @media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }
      </style>
    </head>
    <body>
      <main class="login-card">
        <div class="login-brand"><span class="login-brand-mark">ON</span><span class="login-brand-copy"><strong>مركز إدارة السيرفر</strong><span>CONTROL SUITE</span></span></div>
        <span class="login-eyebrow">مساحة خاصة بالمشرفين</span>
        <h2>أهلاً بعودتك</h2>
        <p class="login-description">أدخل كلمة مرور اللوحة للوصول إلى إعدادات التذاكر والأعضاء وأنظمة السيرفر.</p>
        ${loginError}
        <form action="/login" method="POST">
          <label for="dashboardPassword">كلمة المرور</label>
          <input id="dashboardPassword" type="password" name="password" placeholder="أدخل كلمة المرور" autocomplete="current-password" required>
          <button type="submit">دخول آمن <span aria-hidden="true">←</span></button>
        </form>
        <div class="login-bottom"><a href="/" class="login-back">الرجوع للصفحة الرئيسية</a><span class="login-secure">🔒 اتصال آمن</span></div>
      </main>
    </body>
    </html>
  `);
});

app.post('/login', (req, res) => {
  if (dashboardAuth.isLoginBlocked(req)) {
    return res.status(429).send('⛔ محاولات دخول خاطئة كثيرة. حاول مرة أخرى بعد 15 دقيقة.');
  }
  if (dashboardAuth.checkPassword(req.body.password)) {
    dashboardAuth.clearLoginFailures(req);
    res.setHeader('Set-Cookie', `auth_pass=${dashboardAuth.makeToken()}; ${dashboardAuth.cookieAttributes(req)}`);
    res.redirect('/dashboard');
  } else {
    dashboardAuth.recordLoginFailure(req);
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'auth_pass=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  res.redirect('/login');
});

// مركز التحكم بعد تسجيل الدخول — مدخل موحّد لكل أقسام اللوحة.
app.get('/dashboard', requireAuth, (req, res) => {
  const botName = escapeHtml(client.user && client.user.username ? client.user.username : 'لوحة التحكم');
  const modules = [
    ['🎫', 'لوحات التذاكر', '/panel', 'أنشئ لوحات التذاكر وعدّل الأزرار والقوائم وطريقة الاستلام.', 'التذاكر'],
    ['⚙️', 'الأوامر والكلانات', '/commands', 'تحكم بالتفعيل والاختصارات والصلاحيات، بما فيها إعدادات الكلانات.', 'مركز الأوامر'],
    ['📝', 'تقديمات الإدارة', '/apply-setup', 'اضبط نموذج التقديم وروم الاستقبال ومراجعة الطلبات.', 'التقديمات'],
    ['📊', 'الإحصائيات', '/stats', 'تابع مؤشرات التذاكر المسجلة من لوحة واحدة.', 'نظرة عامة'],
    ['⭐', 'إعدادات الإكسبي', '/xp-settings', 'اضبط الإكسبي والكول داون ومواعيد تصفير التوب.', 'نظام XP'],
    ['🏅', 'رتب المكافآت', '/xp-rewards', 'اربط المستويات بالرتب التي يحصل عليها الأعضاء.', 'المكافآت'],
    ['🗂️', 'أرشيف التوب', '/xp-archive', 'اعرض الأرشيف اليومي والأسبوعي والشهري.', 'الأرشيف'],
    ['🎭', 'الرتب التلقائية', '/auto-roles', 'حدّد الرتب التي تُمنح لأعضاء تختارهم عند دخولهم.', 'الأعضاء'],
    ['👋', 'رسالة الترحيب', '/welcome-settings', 'خصص رسالة الترحيب والقناة وطريقة عرضها.', 'التواصل']
  ];
  const moduleCards = modules.map(([icon, title, href, description, badge], index) => `
    <a class="hub-module" href="${href}" style="--module-index:${index}">
      <span class="hub-module-icon" aria-hidden="true">${icon}</span>
      <span class="hub-module-badge">${escapeHtml(badge)}</span>
      <strong>${escapeHtml(title)}</strong>
      <span class="hub-module-description">${escapeHtml(description)}</span>
      <span class="hub-module-arrow" aria-hidden="true">←</span>
    </a>
  `).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>الرئيسية — ${botName}</title>
      <style>
        .dashboard-home { width:min(1200px,calc(100% - 40px)); margin:0 auto; padding:42px 0 72px; }
        .hub-hero { position:relative; display:flex; justify-content:space-between; align-items:center; gap:30px; margin-bottom:28px; padding:clamp(24px,4vw,42px); overflow:hidden; border:1px solid #282232; border-radius:24px; background:radial-gradient(ellipse at 0% 0%,rgba(71,31,136,.14),transparent 48%),linear-gradient(120deg,#18171e,#121318 70%); box-shadow:0 24px 64px rgba(0,0,0,.25); }
        .hub-hero::after { content:""; position:absolute; left:-50px; bottom:-140px; width:260px; height:260px; border:1px solid rgba(127,66,226,.08); border-radius:50%; box-shadow:0 0 0 28px rgba(127,66,226,.025),0 0 0 60px rgba(127,66,226,.018); pointer-events:none; }
        .hub-hero-copy { position:relative; z-index:1; max-width:720px; }
        .hub-eyebrow { color:#8a5ed0; font-size:11px; font-weight:750; letter-spacing:.08em; }
        .hub-hero h1 { margin:8px 0 9px; color:#f3f0f7; font-size:clamp(28px,4vw,42px); line-height:1.35; }
        .hub-hero p { max-width:650px; margin:0; color:#a5a1ad; font-size:14px; line-height:1.9; }
        .hub-hero-action { position:relative; z-index:1; display:inline-flex; align-items:center; gap:10px; flex-shrink:0; padding:13px 17px; border:1px solid rgba(127,66,226,.2); border-radius:12px; background:linear-gradient(120deg,#38215e,#221c2b); color:#f8f5fc !important; text-decoration:none; font-size:13px; font-weight:700; box-shadow:0 10px 28px rgba(0,0,0,.25); transition:transform .22s ease,box-shadow .22s ease,background .22s ease; }
        .hub-hero-action:hover { transform:translateY(-2px); background:linear-gradient(120deg,#432375,#2a134f); box-shadow:0 14px 30px rgba(0,0,0,.32); }
        .hub-section-heading { display:flex; justify-content:space-between; align-items:end; gap:16px; margin:30px 2px 16px; }
        .hub-section-heading h2 { margin:0; color:#ece9f1; font-size:20px; }
        .hub-section-heading p { margin:3px 0 0; color:#898692; font-size:12px; }
        .hub-count { padding:6px 10px; border:1px solid #282232; border-radius:999px; color:#bcb2c9; background:#141319; font-size:11px; white-space:nowrap; }
        .hub-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
        .hub-module { position:relative; display:flex; min-height:195px; flex-direction:column; align-items:flex-start; padding:20px; overflow:hidden; border:1px solid #292a33; border-radius:17px; background:linear-gradient(145deg,#17181e,#121318); color:#f0edf5 !important; text-decoration:none; box-shadow:0 10px 28px rgba(0,0,0,.15); transition:transform .25s cubic-bezier(.2,.8,.2,1),border-color .25s ease,box-shadow .25s ease,background .25s ease; animation:dashboardEntrance .48s ease both; animation-delay:calc(var(--module-index,0) * 45ms); }
        .hub-module::after { content:""; position:absolute; top:-60%; left:-55%; width:35%; height:220%; background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent); transform:rotate(18deg) translateX(-180%); transition:transform .7s ease; pointer-events:none; }
        .hub-module:hover { transform:translateY(-4px); border-color:#3f236c; background:linear-gradient(145deg,#1b1a22,#15151b); box-shadow:0 20px 40px rgba(0,0,0,.27),0 0 26px rgba(71,31,136,.08); }
        .hub-module:hover::after { transform:rotate(18deg) translateX(520%); }
        .hub-module-icon { display:grid; place-items:center; width:42px; height:42px; margin-bottom:15px; border:1px solid #342b43; border-radius:13px; background:#1a1523; font-size:19px; }
        .hub-module-badge { position:absolute; top:22px; left:18px; padding:4px 8px; border:1px solid #282232; border-radius:999px; color:#a6a1ae; background:#141319; font-size:10px; }
        .hub-module strong { margin-bottom:6px; color:#f0edf5; font-size:15px; }
        .hub-module-description { max-width:36em; color:#9a97a2; font-size:12px; line-height:1.8; }
        .hub-module-arrow { position:absolute; right:19px; bottom:16px; color:#8a5ed0; font-size:18px; transition:transform .22s ease; }
        .hub-module:hover .hub-module-arrow { transform:translateX(-4px); }
        .hub-footer { margin-top:22px; padding:15px 18px; border:1px solid #25262e; border-radius:14px; color:#8c8994; background:rgba(17,18,23,.75); font-size:12px; }
        @media(max-width:900px) { .hub-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media(max-width:620px) { .dashboard-home { width:calc(100% - 24px); padding:24px 0 42px; } .hub-hero { align-items:flex-start; flex-direction:column; } .hub-grid { grid-template-columns:1fr; } .hub-module { min-height:165px; } .hub-section-heading { align-items:flex-start; flex-direction:column; } }
        @media(prefers-reduced-motion:reduce) { .hub-module,.hub-hero-action { animation:none; transition:none; } }
      </style>
    </head>
    <body>
      <nav>
        <div class="links">
          <a href="/dashboard">الرئيسية</a>
          <a href="/panel">التذاكر</a>
          <a href="/commands">الأوامر</a>
          <a href="/stats">الإحصائيات</a>
        </div>
        <a href="/logout">تسجيل الخروج</a>
      </nav>
      <main class="dashboard-home">
        <section class="hub-hero">
          <div class="hub-hero-copy">
            <span class="hub-eyebrow">مساحة الإدارة · ${botName}</span>
            <h1>أهلاً بك في مركز التحكم</h1>
            <p>كل أدوات إدارة مجتمعك مرتبة وواضحة. اختر القسم الذي تريد العمل عليه، واحفظ إعداداتك من الصفحة نفسها.</p>
          </div>
          <a class="hub-hero-action" href="/commands"><span aria-hidden="true">⚙️</span> إدارة الأوامر والصلاحيات</a>
        </section>
        <div class="hub-section-heading"><div><h2>أقسام لوحة التحكم</h2><p>إعدادات التذاكر والأعضاء والأنظمة في مكان واحد.</p></div><span class="hub-count">${modules.length} أقسام</span></div>
        <section class="hub-grid" aria-label="أقسام لوحة التحكم">${moduleCards}</section>
        <div class="hub-footer">💡 إعدادات الأوامر والكلانات ضمن <a href="/commands">مركز الأوامر</a>، ودليل الأوامر الجديدة في <a href="/commands-list">صفحة أوامر السلاش</a>.</div>
      </main>
    </body>
    </html>
  `);
});

// ==========================================
// إدارة لوحات التذاكر
// ==========================================
app.get('/panel', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM panels');
  let panelsListHTML = '';

  for (const p of result.rows) {
    const optionsRes = await pool.query('SELECT COUNT(*) FROM panel_options WHERE panel_id = $1', [p.panel_id]);
    const optionsCount = optionsRes.rows[0].count;

    panelsListHTML += `
      <div style="background:#0f172a; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid #334155; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h3 style="margin:0; color:#38bdf8;">📌 المعرف: ${escapeHtml(p.panel_id)} - ${escapeHtml(p.title)}</h3>
          <p style="margin:5px 0 0 0; color:#94a3b8; font-size:14px;">
            النوع: <strong>${p.type === 'select' ? 'قائمة منسدلة 📜' : 'أزرار 🔘'}</strong> |
            الشكل: <strong>${p.message_type === 'plain' ? 'رسالة عادية' : 'إيمبد'}</strong> |
            الخيارات: <strong>${optionsCount}</strong> | الروم: ${escapeHtml(p.channel_id)}
          </p>
        </div>
        <div>
          <a href="/edit-panel/${escapeHtml(p.panel_id)}" style="background:#0284c7; color:white; padding:8px 15px; border-radius:5px; text-decoration:none; font-weight:bold; margin-left:5px;">✏️ تعديل</a>
          <form method="POST" action="/delete-panel/${escapeHtml(p.panel_id)}" style="display:inline; margin:0;"><button type="submit" onclick="return confirm('هل أنت متأكد من حذف هذه اللوحة بالكام؟')" style="background:#ef4444; color:white; padding:8px 15px; border-radius:5px; font-weight:bold; border:none; cursor:pointer; font-family:inherit; font-size:inherit;">🗑️ حذف</button></form>
        </div>
      </div>
    `;
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>إدارة اللوحات</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin:0; padding:0; }
        nav { background: #1e293b; padding: 15px 30px; display: flex; justify-content: space-between; border-bottom: 1px solid #334155; }
        nav .links a { color: #38bdf8; text-decoration: none; font-weight: bold; margin-left: 20px; }
        .container { max-width: 900px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
        h1, h2 { color: #38bdf8; }
        label { display: block; margin-top: 12px; font-weight: bold; color:#cbd5e1; }
        input, select, textarea { width: 100%; padding: 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; }
        button { margin-top: 20px; width: 100%; padding: 12px; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
      </style>
    </head>
    <body>
      <nav>
        <div class="links">
          <a href="/dashboard">الرئيسية 🏠</a>
          <a href="/panel">إدارة التذاكر ⚙️</a>
          <a href="/apply-setup">تقديم الإدارة 📝</a>
          <a href="/commands">إدارة الأوامر ⚡</a>
          <a href="/stats">الإحصائيات 📊</a>
          <a href="/xp-settings">الإكسبي ⭐</a>
          <a href="/xp-rewards">رتب المكافأة 🎖️</a>
          <a href="/auto-roles">الرتب التلقائية 🎭</a>
          <a href="/welcome-settings">لوحة الترحيب 👋</a>
        </div>
        <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
      </nav>
      <div class="container">
        <h1>➕ إنشاء / إضافة لوحة جديدة</h1>
        <form action="/create-panel" method="POST">
          <label>معرف اللوحة الفريد (Panel ID):</label>
          <input type="text" name="panelId" placeholder="main_support_panel" required>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>نوع التفاعل باللوحة:</label>
              <select name="type">
                <option value="buttons">أزرار تفاعلية (Buttons) 🔘</option>
                <option value="select">قائمة منسدلة (Select Menu) 📜</option>
              </select>
            </div>
            <div style="flex:1;">
              <label>نوع الرسالة:</label>
              <select name="messageType">
                <option value="embed">رسالة إيمبد (Embed) 🎨</option>
                <option value="plain">رسالة نصية عادية 💬</option>
              </select>
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>لون الإيموجي/الإيمبد (Hex Color):</label>
              <input type="color" name="color" value="#0284c7" style="height:40px;">
            </div>
            <div style="flex:2;">
              <label>رابط الصورة المرفقة مع اللوحة (اختياري URL):</label>
              <input type="url" name="imageUrl" placeholder="https://i.imgur.com/example.png">
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي روم اللوحة:</label>
              <input type="text" name="channelId" required>
            </div>
            <div style="flex:1;">
              <label>آيدي كاتيجوري التذاكر:</label>
              <input type="text" name="categoryId" required>
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي رتبة الإدارة العادية:</label>
              <input type="text" name="adminRoleId" required>
            </div>
            <div style="flex:1;">
              <label>آيدي رتبة الإدارة العليا:</label>
              <input type="text" name="highAdminRoleId" required>
            </div>
          </div>

          <label>آيدي روم اللوق (سجل التذاكر والترانسكريبت):</label>
          <input type="text" name="logChannelId" required>

          <label>عنوان اللوحة:</label>
          <input type="text" name="title" value="تكت الدعم الفني والوساطة 🤝" required>

          <label>وصف اللوحة:</label>
          <textarea name="description" rows="2" required>اختر القسم المناسب من الأسفل لفتح تذكرة مباشرة مع طاقم الإدارة.</textarea>

          <hr style="margin: 20px 0; border-color: #334155;">
          <p style="color:#94a3b8; font-size:13px; margin:0 0 5px 0;">📌 زر الاستلام التلقائي (يظهر مع رسالة الترحيب داخل التذكرة):</p>

          <div style="display:flex; gap:15px; align-items:center;">
            <div style="flex:1;">
              <label style="display:flex; align-items:center; gap:8px; margin-top:12px;">
                <input type="checkbox" name="claimAdminEnabled" style="width:auto; margin:0;"> تفعيل زر استلام الإدارة
              </label>
            </div>
            <div style="flex:1;">
              <label style="display:flex; align-items:center; gap:8px; margin-top:12px;">
                <input type="checkbox" name="claimMediatorEnabled" style="width:auto; margin:0;"> تفعيل زر استلام الوسطاء
              </label>
            </div>
          </div>

          <label>آيدي رتبة الوسطاء (تُستخدم فقط لزر استلام الوسطاء):</label>
          <input type="text" name="mediatorRoleId" placeholder="اختياري - يلزم فقط عند تفعيل زر استلام الوسطاء">

          <button type="submit">حفظ اللوحة والانتقال لإضافة الأزرار/الخيارات ➡️</button>
        </form>

        <hr style="margin: 30px 0; border-color: #334155;">
        <h2>📋 اللوحات المسجلة بداخل النظام:</h2>
        ${panelsListHTML || '<p>لا توجد لوحات منشأة حالياً.</p>'}
      </div>
    </body>
    </html>
  `);
});

app.post('/create-panel', requireAuth, async (req, res) => {
  const d = req.body || {};

  // 🛡️ [إصلاح] قبل هذا التحقق كان أي حقل ناقص في النموذج يرمي
  // "Cannot read properties of undefined (reading 'trim')" فيبقى الطلب معلقاً بلا رد.
  const panelId = safeText(d.panelId);
  if (!panelId) return res.status(400).send('❌ معرّف اللوحة (panelId) مطلوب!');

  await pool.query(`
    INSERT INTO panels (panel_id, channel_id, category_id, admin_role_id, high_admin_role_id, log_channel_id, title, description, type, message_type, image_url, color, claim_admin_enabled, claim_mediator_enabled, mediator_role_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (panel_id) DO UPDATE SET
      channel_id = EXCLUDED.channel_id,
      category_id = EXCLUDED.category_id,
      admin_role_id = EXCLUDED.admin_role_id,
      high_admin_role_id = EXCLUDED.high_admin_role_id,
      log_channel_id = EXCLUDED.log_channel_id,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      type = EXCLUDED.type,
      message_type = EXCLUDED.message_type,
      image_url = EXCLUDED.image_url,
      color = EXCLUDED.color,
      claim_admin_enabled = EXCLUDED.claim_admin_enabled,
      claim_mediator_enabled = EXCLUDED.claim_mediator_enabled,
      mediator_role_id = EXCLUDED.mediator_role_id;
  `, [
    panelId,
    safeText(d.channelId),
    safeText(d.categoryId),
    safeText(d.adminRoleId),
    safeText(d.highAdminRoleId),
    safeText(d.logChannelId),
    safeText(d.title),
    safeText(d.description),
    safeText(d.type, 'buttons'),
    safeText(d.messageType, 'embed'),
    safeTextOrNull(d.imageUrl),
    // 🛡️ [إصلاح] لون غير صالح كان يُحفظ ثم يُسقط نشر اللوحة لاحقاً عند setColor
    safeHexColor(d.color),
    d.claimAdminEnabled === 'on',
    d.claimMediatorEnabled === 'on',
    safeTextOrNull(d.mediatorRoleId)
  ]);

  // 🛡️ [إصلاح] ترميز المعرّف يمنع إعادة التوجيه إلى موقع خارجي عبر قيمة مثل //example.com
  res.redirect(`/edit-panel/${safePathSegment(panelId)}`);
});

app.post('/delete-panel/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM panels WHERE panel_id = $1', [req.params.id]);
  res.redirect('/panel');
});

app.get('/edit-panel/:id', requireAuth, async (req, res) => {
  const pRes = await pool.query('SELECT * FROM panels WHERE panel_id = $1', [req.params.id]);
  const panel = pRes.rows[0];
  if (!panel) return res.send('اللوحة غير موجودة');

  const optionsRes = await pool.query('SELECT * FROM panel_options WHERE panel_id = $1 ORDER BY id ASC', [panel.panel_id]);
  let optionsHTML = '';

  optionsRes.rows.forEach((opt, index) => {
    const hasCustomSettings = opt.category_id || opt.admin_role_id || opt.high_admin_role_id;
    optionsHTML += `
      <div style="background:#0f172a; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid #334155;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="color:#5f0ae8; font-weight:bold;">#${index + 1} الخيار: ${escapeHtml(opt.label)}</span>
          <div>
            <a href="/edit-option/${escapeHtml(opt.id)}/${escapeHtml(panel.panel_id)}" style="color:#38bdf8; font-weight:bold; text-decoration:none; margin-left:15px;">✏️ تعديل</a>
            <form method="POST" action="/delete-option/${escapeHtml(opt.id)}/${escapeHtml(panel.panel_id)}" style="display:inline; margin:0;"><button type="submit" style="background:none; padding:0; color:#ef4444; font-weight:bold; border:none; cursor:pointer; font-family:inherit; font-size:inherit;">🗑️ حذف</button></form>
          </div>
        </div>
        <p style="margin:5px 0; color:#94a3b8; font-size:14px;">الوصف: ${escapeHtml(opt.description || 'بدون')} | الإيموجي: ${escapeHtml(opt.emoji || 'بدون')} | لون الزر: <strong>${escapeHtml(opt.button_style)}</strong></p>
        <p style="margin:5px 0; color:#38bdf8; font-size:13px;">رسالة الترحيب: ${escapeHtml(opt.welcome_message)}</p>
        ${hasCustomSettings ? `<p style="margin:5px 0; color:#650bf5; font-size:13px;">⚙️ إعدادات خاصة: ${opt.category_id ? `كاتيجوري: <code>${escapeHtml(opt.category_id)}</code> ` : ''}${opt.admin_role_id ? `| رتبة إدارة: <code>${escapeHtml(opt.admin_role_id)}</code> ` : ''}${opt.high_admin_role_id ? `| رتبة عليا: <code>${escapeHtml(opt.high_admin_role_id)}</code>` : ''}</p>` : ''}
      </div>
    `;
  });

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>تعديل اللوحة ${escapeHtml(panel.panel_id)}</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin:0; padding:0; }
        nav { background: #1e293b; padding: 15px 30px; display: flex; justify-content: space-between; border-bottom: 1px solid #334155; }
        nav .links a { color: #38bdf8; text-decoration: none; font-weight: bold; margin-left: 20px; }
        .container { max-width: 900px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
        h1, h2, h3 { color: #38bdf8; }
        label { display: block; margin-top: 10px; font-weight: bold; color:#cbd5e1; }
        input, select, textarea { width: 100%; padding: 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; }
        .btn-add { background: #10b981; color: white; padding: 12px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%; margin-top: 15px; }
        .btn-send { background: #0284c7; color: white; padding: 15px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; width: 48%; font-size: 15px; }
        .btn-update { background: #650bf5; color: white; padding: 15px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; width: 48%; font-size: 15px; }
      </style>
    </head>
    <body>
      <nav>
        <div class="links">
          <a href="/dashboard">الرئيسية 🏠</a>
          <a href="/panel">إدارة التذاكر ⚙️</a>
          <a href="/apply-setup">تقديم الإدارة 📝</a>
          <a href="/commands">إدارة الأوامر ⚡</a>
          <a href="/stats">الإحصائيات 📊</a>
          <a href="/xp-settings">الإكسبي ⭐</a>
          <a href="/xp-rewards">رتب المكافأة 🎖️</a>
          <a href="/auto-roles">الرتب التلقائية 🎭</a>
          <a href="/welcome-settings">لوحة الترحيب 👋</a>
        </div>
        <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
      </nav>
      <div class="container">
        <h1>⚙️ التحكم الكامل في اللوحة: ${escapeHtml(panel.title)}</h1>

        <h2>✏️ تعديل إعدادات اللوحة الأساسية:</h2>
        <form action="/create-panel" method="POST" style="background:#0f172a; padding:20px; border-radius:8px; border:1px solid #334155;">
          <input type="hidden" name="panelId" value="${escapeHtml(panel.panel_id)}">

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>نوع التفاعل باللوحة:</label>
              <select name="type">
                <option value="buttons" ${panel.type === 'buttons' ? 'selected' : ''}>أزرار تفاعلية (Buttons) 🔘</option>
                <option value="select" ${panel.type === 'select' ? 'selected' : ''}>قائمة منسدلة (Select Menu) 📜</option>
              </select>
            </div>
            <div style="flex:1;">
              <label>نوع الرسالة:</label>
              <select name="messageType">
                <option value="embed" ${panel.message_type === 'embed' ? 'selected' : ''}>رسالة إيمبد (Embed) 🎨</option>
                <option value="plain" ${panel.message_type === 'plain' ? 'selected' : ''}>رسالة نصية عادية 💬</option>
              </select>
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>لون الإيموجي/الإيمبد (Hex Color):</label>
              <input type="color" name="color" value="${escapeHtml(panel.color || '#0284c7')}" style="height:40px;">
            </div>
            <div style="flex:2;">
              <label>رابط الصورة المرفقة مع اللوحة (اختياري URL):</label>
              <input type="url" name="imageUrl" value="${escapeHtml(panel.image_url || '')}" placeholder="https://i.imgur.com/example.png">
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي روم اللوحة:</label>
              <input type="text" name="channelId" value="${escapeHtml(panel.channel_id || '')}" required>
            </div>
            <div style="flex:1;">
              <label>آيدي كاتيجوري التذاكر (الافتراضي):</label>
              <input type="text" name="categoryId" value="${escapeHtml(panel.category_id || '')}" required>
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي رتبة الإدارة العادية (الافتراضية):</label>
              <input type="text" name="adminRoleId" value="${escapeHtml(panel.admin_role_id || '')}" required>
            </div>
            <div style="flex:1;">
              <label>آيدي رتبة الإدارة العليا (الافتراضية):</label>
              <input type="text" name="highAdminRoleId" value="${escapeHtml(panel.high_admin_role_id || '')}" required>
            </div>
          </div>

          <label>آيدي روم اللوق (سجل التذاكر والترانسكريبت):</label>
          <input type="text" name="logChannelId" value="${escapeHtml(panel.log_channel_id || '')}" required>

          <label>عنوان اللوحة:</label>
          <input type="text" name="title" value="${escapeHtml(panel.title || '')}" required>

          <label>وصف اللوحة:</label>
          <textarea name="description" rows="2" required>${escapeHtml(panel.description || '')}</textarea>

          <hr style="margin: 20px 0; border-color: #334155;">
          <p style="color:#94a3b8; font-size:13px; margin:0 0 5px 0;">📌 زر الاستلام التلقائي (يظهر مع رسالة الترحيب داخل التذكرة):</p>

          <div style="display:flex; gap:15px; align-items:center;">
            <div style="flex:1;">
              <label style="display:flex; align-items:center; gap:8px; margin-top:12px;">
                <input type="checkbox" name="claimAdminEnabled" style="width:auto; margin:0;" ${panel.claim_admin_enabled ? 'checked' : ''}> تفعيل زر استلام الإدارة
              </label>
            </div>
            <div style="flex:1;">
              <label style="display:flex; align-items:center; gap:8px; margin-top:12px;">
                <input type="checkbox" name="claimMediatorEnabled" style="width:auto; margin:0;" ${panel.claim_mediator_enabled ? 'checked' : ''}> تفعيل زر استلام الوسطاء
              </label>
            </div>
          </div>

          <label>آيدي رتبة الوسطاء (تُستخدم فقط لزر استلام الوسطاء):</label>
          <input type="text" name="mediatorRoleId" value="${escapeHtml(panel.mediator_role_id || '')}" placeholder="اختياري - يلزم فقط عند تفعيل زر استلام الوسطاء">

          <button type="submit" class="btn-add">💾 حفظ تعديلات اللوحة</button>
        </form>

        <hr style="margin: 30px 0; border-color: #334155;">

        <h2>➕ إضافة زر / خيار جديد للوحة:</h2>
        <form action="/add-option" method="POST" style="background:#0f172a; padding:20px; border-radius:8px; border:1px solid #334155;">
          <input type="hidden" name="panelId" value="${escapeHtml(panel.panel_id)}">

          <div style="display:flex; gap:15px;">
            <div style="flex:2;">
              <label>اسم الخيار / الزر (Label):</label>
              <input type="text" name="label" placeholder="مثال: طلب وسيط جديد" required>
            </div>
            <div style="flex:1;">
              <label>لون الزر (ButtonStyle):</label>
              <select name="buttonStyle">
                <option value="Primary">أزرق (Primary)</option>
                <option value="Secondary">رمادي (Secondary)</option>
                <option value="Success">أخضر (Success)</option>
                <option value="Danger">أحمر (Danger)</option>
              </select>
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:2;">
              <label>الوصف الفرعي (يظهر تحت الاسم إذا كانت اللوحة قائمة منسدلة):</label>
              <input type="text" name="description" placeholder="وساطة سريعة لجميع المبالغ">
            </div>
            <div style="flex:1;">
              <label>الإيموجي (اختياري):</label>
              <input type="text" name="emoji" placeholder="🤝">
            </div>
          </div>

          <label>رسالة الترحيب الخاّصة التي تُرسل بداخل التكت فور فتح هذا الخيار:</label>
          <textarea name="welcomeMessage" rows="2" required>أهلاً بك! تم فتح التذكرة بنجاح، انتظر رد الإدارة.</textarea>

          <hr style="margin: 20px 0; border-color: #334155;">
          <p style="color:#94a3b8; font-size:13px; margin:0 0 5px 0;">⚙️ إعدادات خاصة لهذا الزر (اختياري - اتركها فارغة لاستخدام إعدادات اللوحة الافتراضية):</p>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي كاتيجوري خاص بهذا الزر:</label>
              <input type="text" name="categoryId" placeholder="اختياري">
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي رتبة إدارة عادية خاصة بهذا الزر:</label>
              <input type="text" name="adminRoleId" placeholder="اختياري">
            </div>
            <div style="flex:1;">
              <label>آيدي رتبة إدارة عليا خاصة بهذا الزر:</label>
              <input type="text" name="highAdminRoleId" placeholder="اختياري">
            </div>
          </div>

          <button type="submit" class="btn-add">➕ إضافة الزر/الخيار إلى اللوحة</button>
        </form>

        <hr style="margin: 30px 0; border-color: #334155;">
        <h2>📋 الخيارات والأزرار الحالية (${optionsRes.rows.length}):</h2>
        ${optionsHTML || '<p>لا يوجد خيارات مضافة لهذه اللوحة بعد.</p>'}

        ${optionsRes.rows.length > 0 ? `
          <div style="display:flex; justify-content:space-between; margin-top:20px;">
            <form action="/publish-panel" method="POST" style="width:48%;">
              <input type="hidden" name="panelId" value="${escapeHtml(panel.panel_id)}">
              <input type="hidden" name="mode" value="update">
              <button type="submit" class="btn-update">🔄 تحديث اللوحة القديمة بفروم ديسكورد</button>
            </form>

            <form action="/publish-panel" method="POST" style="width:48%;">
              <input type="hidden" name="panelId" value="${escapeHtml(panel.panel_id)}">
              <input type="hidden" name="mode" value="new">
              <button type="submit" class="btn-send">🚀 إرسال لوحة جديدة بداخل الروم</button>
            </form>
          </div>
        ` : ''}
      </div>
    </body>
    </html>
  `);
});

app.post('/add-option', requireAuth, async (req, res) => {
  const d = req.body || {};
  const optionId = `opt_${Date.now()}`;

  // 🛡️ [إصلاح] الاسم (label) إلزامي لزر ديسكورد؛ غيابه كان يرمي خطأ ويترك الطلب معلقاً
  const panelId = safeText(d.panelId);
  const label = safeText(d.label);
  if (!panelId) return res.status(400).send('❌ معرّف اللوحة (panelId) مطلوب!');
  if (!label) return res.status(400).send('❌ اسم الخيار/الزر (label) مطلوب!');

  await pool.query(`
    INSERT INTO panel_options (panel_id, option_id, label, description, emoji, welcome_message, button_style, category_id, admin_role_id, high_admin_role_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    panelId,
    optionId,
    label,
    safeText(d.description),
    safeText(d.emoji),
    safeText(d.welcomeMessage),
    safeText(d.buttonStyle, 'Primary'),
    safeTextOrNull(d.categoryId),
    safeTextOrNull(d.adminRoleId),
    safeTextOrNull(d.highAdminRoleId)
  ]);

  res.redirect(`/edit-panel/${safePathSegment(panelId)}`);
});

app.post('/delete-option/:optId/:panelId', requireAuth, async (req, res) => {
  // 🛡️ [إصلاح] العمود id من نوع SERIAL؛ تمرير قيمة غير رقمية كان يُفشل الاستعلام
  const optionId = safeInteger(req.params.optId);
  if (optionId === null) return res.status(400).send('❌ معرّف الخيار غير صالح!');

  await pool.query('DELETE FROM panel_options WHERE id = $1', [optionId]);
  res.redirect(`/edit-panel/${safePathSegment(req.params.panelId)}`);
});

// ==========================================
// تعديل زر/خيار موجود بعد إنشائه (بما فيه الكتيجوري والرتب الخاصة)
// ==========================================
app.get('/edit-option/:optId/:panelId', requireAuth, async (req, res) => {
  // 🛡️ [إصلاح] العمود id من نوع SERIAL؛ قيمة غير رقمية كانت تُفشل الاستعلام بدل عرض رسالة واضحة
  const requestedOptionId = safeInteger(req.params.optId);
  if (requestedOptionId === null) return res.status(400).send('الخيار غير موجود');

  const optRes = await pool.query('SELECT * FROM panel_options WHERE id = $1', [requestedOptionId]);
  const opt = optRes.rows[0];
  if (!opt) return res.send('الخيار غير موجود');

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>تعديل الخيار ${escapeHtml(opt.label)}</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin:0; padding:0; }
        nav { background: #1e293b; padding: 15px 30px; display: flex; justify-content: space-between; border-bottom: 1px solid #334155; }
        nav .links a { color: #38bdf8; text-decoration: none; font-weight: bold; margin-left: 20px; }
        .container { max-width: 900px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
        h1, h2 { color: #38bdf8; }
        label { display: block; margin-top: 10px; font-weight: bold; color:#cbd5e1; }
        input, select, textarea { width: 100%; padding: 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; }
        button { margin-top: 20px; width: 100%; padding: 12px; background: #650bf5; color: #000; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
      </style>
    </head>
    <body>
      <nav>
        <div class="links">
          <a href="/dashboard">الرئيسية 🏠</a>
          <a href="/panel">إدارة التذاكر ⚙️</a>
          <a href="/apply-setup">تقديم الإدارة 📝</a>
          <a href="/commands">إدارة الأوامر ⚡</a>
          <a href="/stats">الإحصائيات 📊</a>
          <a href="/xp-settings">الإكسبي ⭐</a>
          <a href="/xp-rewards">رتب المكافأة 🎖️</a>
          <a href="/auto-roles">الرتب التلقائية 🎭</a>
          <a href="/welcome-settings">لوحة الترحيب 👋</a>
        </div>
        <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
      </nav>
      <div class="container">
        <h1>✏️ تعديل الزر/الخيار: ${escapeHtml(opt.label)}</h1>
        <form action="/update-option" method="POST">
          <input type="hidden" name="optId" value="${escapeHtml(opt.id)}">
          <input type="hidden" name="panelId" value="${escapeHtml(opt.panel_id)}">

          <div style="display:flex; gap:15px;">
            <div style="flex:2;">
              <label>اسم الخيار / الزر (Label):</label>
              <input type="text" name="label" value="${escapeHtml(opt.label || '')}" required>
            </div>
            <div style="flex:1;">
              <label>لون الزر (ButtonStyle):</label>
              <select name="buttonStyle">
                <option value="Primary" ${opt.button_style === 'Primary' ? 'selected' : ''}>أزرق (Primary)</option>
                <option value="Secondary" ${opt.button_style === 'Secondary' ? 'selected' : ''}>رمادي (Secondary)</option>
                <option value="Success" ${opt.button_style === 'Success' ? 'selected' : ''}>أخضر (Success)</option>
                <option value="Danger" ${opt.button_style === 'Danger' ? 'selected' : ''}>أحمر (Danger)</option>
              </select>
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:2;">
              <label>الوصف الفرعي (يظهر تحت الاسم إذا كانت اللوحة قائمة منسدلة):</label>
              <input type="text" name="description" value="${escapeHtml(opt.description || '')}">
            </div>
            <div style="flex:1;">
              <label>الإيموجي (اختياري):</label>
              <input type="text" name="emoji" value="${escapeHtml(opt.emoji || '')}">
            </div>
          </div>

          <label>رسالة الترحيب الخاّصة التي تُرسل بداخل التكت فور فتح هذا الخيار:</label>
          <textarea name="welcomeMessage" rows="2" required>${escapeHtml(opt.welcome_message || '')}</textarea>

          <hr style="margin: 20px 0; border-color: #334155;">
          <p style="color:#94a3b8; font-size:13px; margin:0 0 5px 0;">⚙️ إعدادات خاصة لهذا الزر (اختياري - اتركها فارغة لاستخدام إعدادات اللوحة الافتراضية):</p>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي كاتيجوري خاص بهذا الزر:</label>
              <input type="text" name="categoryId" value="${escapeHtml(opt.category_id || '')}" placeholder="اختياري">
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>آيدي رتبة إدارة عادية خاصة بهذا الزر:</label>
              <input type="text" name="adminRoleId" value="${escapeHtml(opt.admin_role_id || '')}" placeholder="اختياري">
            </div>
            <div style="flex:1;">
              <label>آيدي رتبة إدارة عليا خاصة بهذا الزر:</label>
              <input type="text" name="highAdminRoleId" value="${escapeHtml(opt.high_admin_role_id || '')}" placeholder="اختياري">
            </div>
          </div>

          <button type="submit">💾 حفظ تعديلات الزر</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/update-option', requireAuth, async (req, res) => {
  const d = req.body || {};

  // 🛡️ [إصلاح] نفس المشكلة السابقة: حقول ناقصة كانت ترمي خطأ ويبقى الطلب معلقاً بلا رد
  const optionId = safeInteger(d.optId);
  const label = safeText(d.label);
  if (optionId === null) return res.status(400).send('❌ معرّف الخيار غير صالح!');
  if (!label) return res.status(400).send('❌ اسم الخيار/الزر (label) مطلوب!');

  await pool.query(`
    UPDATE panel_options SET
      label = $1,
      description = $2,
      emoji = $3,
      welcome_message = $4,
      button_style = $5,
      category_id = $6,
      admin_role_id = $7,
      high_admin_role_id = $8
    WHERE id = $9
  `, [
    label,
    safeText(d.description),
    safeText(d.emoji),
    safeText(d.welcomeMessage),
    safeText(d.buttonStyle, 'Primary'),
    safeTextOrNull(d.categoryId),
    safeTextOrNull(d.adminRoleId),
    safeTextOrNull(d.highAdminRoleId),
    optionId
  ]);

  res.redirect(`/edit-panel/${safePathSegment(d.panelId)}`);
});

app.post('/publish-panel', requireAuth, async (req, res) => {
  const { panelId, mode } = req.body;
  const pRes = await pool.query('SELECT * FROM panels WHERE panel_id = $1', [panelId]);
  const panel = pRes.rows[0];
  const optionsRes = await pool.query('SELECT * FROM panel_options WHERE panel_id = $1 ORDER BY id ASC', [panelId]);

  if (!panel || optionsRes.rows.length === 0) {
    return res.send('❌ يجب إضافة خيار واحد على الأقل قبل إرسال أو تحديث اللوحة!');
  }

  try {
    const channel = await client.channels.fetch(panel.channel_id);
    if (!channel) return res.send('❌ تعذر الوصول لروم اللوحة بالديسكورد!');

    // 🛡️ [إصلاح] حدود ديسكورد: 25 خياراً كحد أقصى للقائمة المنسدلة، و25 زراً (5 صفوف × 5).
    // بدون هذا التحقق كانت العملية تفشل برسالة API غامضة بدل رسالة واضحة للمستخدم.
    const optionsCount = optionsRes.rows.length;
    if (panel.type === 'select' && optionsCount > 25) {
      return res.send(`❌ القائمة المنسدلة تدعم 25 خياراً كحد أقصى (لديك ${optionsCount}). احذف بعض الخيارات ثم أعد المحاولة.`);
    }
    if (panel.type !== 'select' && optionsCount > 25) {
      return res.send(`❌ الأزرار تدعم 25 زراً كحد أقصى في الرسالة الواحدة (لديك ${optionsCount}). احذف بعض الأزرار ثم أعد المحاولة.`);
    }

    const components = [];

    if (panel.type === 'select') {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`ticket_select_${panel.panel_id}`)
        .setPlaceholder('اختر القسم المطلوب من هنا... 🔽');

      optionsRes.rows.forEach(opt => {
        const optionBuilder = new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setValue(opt.option_id);

        if (opt.description && opt.description.trim() !== '') {
          optionBuilder.setDescription(opt.description.trim());
        }
        if (opt.emoji && opt.emoji.trim() !== '') {
          try { optionBuilder.setEmoji(opt.emoji.trim()); } catch (e) {}
        }

        selectMenu.addOptions(optionBuilder);
      });

      components.push(new ActionRowBuilder().addComponents(selectMenu));

    } else {
      let currentRow = new ActionRowBuilder();
      optionsRes.rows.forEach((opt, idx) => {
        if (idx > 0 && idx % 5 === 0) {
          components.push(currentRow);
          currentRow = new ActionRowBuilder();
        }

        let style = ButtonStyle.Primary;
        if (opt.button_style === 'Secondary') style = ButtonStyle.Secondary;
        if (opt.button_style === 'Success') style = ButtonStyle.Success;
        if (opt.button_style === 'Danger') style = ButtonStyle.Danger;

        const btn = new ButtonBuilder()
          .setCustomId(`ticket_btn_${opt.option_id}`)
          .setLabel(opt.label)
          .setStyle(style);

        if (opt.emoji && opt.emoji.trim() !== '') {
          try { btn.setEmoji(opt.emoji.trim()); } catch (e) {}
        }

        currentRow.addComponents(btn);
      });
      components.push(currentRow);
    }

    let messagePayload = {};

    if (panel.message_type === 'embed') {
      const embed = new EmbedBuilder()
        .setTitle(panel.title)
        .setDescription(panel.description)
        // 🛡️ [إصلاح] لون محفوظ بصيغة تالفة (من بيانات قديمة) كان يرمي خطأ ويمنع نشر اللوحة
        .setColor(safeHexColor(panel.color));

      // 🛡️ [إصلاح] رابط صورة غير صالح كان يرمي خطأ ويمنع نشر اللوحة بالكامل.
      // الآن تُنشر اللوحة بدون الصورة مع تسجيل تنبيه، بدل فشل العملية كلها.
      if (panel.image_url) {
        try {
          embed.setImage(panel.image_url);
        } catch (imageError) {
          console.warn(`⚠️ تم تجاهل رابط صورة غير صالح للوحة ${panel.panel_id}:`, imageError.message);
        }
      }

      messagePayload = { embeds: [embed], components: components };
    } else {
      let contentText = `**${panel.title}**\n\n${panel.description}`;
      if (panel.image_url) {
        contentText += `\n${panel.image_url}`;
      }
      messagePayload = { content: contentText, components: components };
    }

    let sentMessage;
    if (mode === 'update' && panel.last_message_id) {
      try {
        const oldMsg = await channel.messages.fetch(panel.last_message_id);
        if (oldMsg) {
          sentMessage = await oldMsg.edit(messagePayload);
        }
      } catch (e) {
        console.log('تعذر العثور على الرسالة القديمة، سيتم إرسال جديدة.');
      }
    }

    if (!sentMessage) {
      sentMessage = await channel.send(messagePayload);
      await pool.query('UPDATE panels SET last_message_id = $1 WHERE panel_id = $2', [sentMessage.id, panel.panel_id]);
    }

    res.send('<h2>✅ تم نشر/تحديث اللوحة بنجاح بداخل السيرفر!</h2><a href="/panel">العودة للوحة التحكم</a>');
  } catch (err) {
    console.error('خطأ أثناء نشر اللوحة:', err);
    res.send(`❌ حدث خطأ أثناء الإرسال: ${err.message}`);
  }
});

// ==========================================
// 4. نظام تقديم الإدارة (إعداد الرتب التلقائية)
// ==========================================
app.get('/apply-setup', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM apply_setup WHERE id = $1', ['main_apply']);
  const appData = result.rows[0] || {};

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>إعداد تقديم الإدارة</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin:0; padding:0; }
        nav { background: #1e293b; padding: 15px 30px; display: flex; justify-content: space-between; border-bottom: 1px solid #334155; }
        nav .links a { color: #38bdf8; text-decoration: none; font-weight: bold; margin-left: 20px; }
        .container { max-width: 900px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
        h1, h2 { color: #5f0ae8; }
        label { display: block; margin-top: 12px; font-weight: bold; color:#cbd5e1; }
        input, textarea { width: 100%; padding: 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; }
        button { margin-top: 20px; padding: 12px; background: #5f0ae8; color: #000; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%; font-size: 15px; }
      </style>
    </head>
    <body>
      <nav>
        <div class="links">
          <a href="/dashboard">الرئيسية 🏠</a>
          <a href="/panel">إدارة التذاكر ⚙️</a>
          <a href="/apply-setup">تقديم الإدارة 📝</a>
          <a href="/commands">إدارة الأوامر ⚡</a>
          <a href="/stats">الإحصائيات 📊</a>
          <a href="/xp-settings">الإكسبي ⭐</a>
          <a href="/xp-rewards">رتب المكافأة 🎖️</a>
          <a href="/auto-roles">الرتب التلقائية 🎭</a>
          <a href="/welcome-settings">لوحة الترحيب 👋</a>
        </div>
        <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
      </nav>
      <div class="container">
        <h1>📝 التحكم بصفحة ولوحة تقديم الإدارة</h1>
        <form action="/save-apply-setup" method="POST">

          <h2>⚙️ إعدادات الرومات والصلاحيات والرتب:</h2>
          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>روم إرسال بنر التقديم (للأعضاء):</label>
              <input type="text" name="submitChannelId" value="${escapeHtml(appData.submit_channel_id || '')}" required>
            </div>
            <div style="flex:1;">
              <label>روم وصول الطلبات (للإدارة):</label>
              <input type="text" name="reviewChannelId" value="${escapeHtml(appData.review_channel_id || '')}" required>
            </div>
          </div>

          <div style="display:flex; gap:15px;">
            <div style="flex:1;">
              <label>روم إرسال النتائج (قبول/رفض):</label>
              <input type="text" name="resultsChannelId" value="${escapeHtml(appData.results_channel_id || '')}" required>
            </div>
            <div style="flex:1;">
              <label>آيدي رتبة الإدارة العليا (صلاحية القبول/الرفض):</label>
              <input type="text" name="highAdminRoleId" value="${escapeHtml(appData.high_admin_role_id || '')}" required>
            </div>
          </div>

          <label style="color:#10b981;">🎖️ آيدي الرتبة التي يحصل عليها المتقدم تلقائياً عند القبول (اختياري):</label>
          <input type="text" name="acceptedRoleId" value="${escapeHtml(appData.accepted_role_id || '')}" placeholder="آيدي رتبة الإدارة الجدد">

          <hr style="margin: 25px 0; border-color: #334155;">
          <h2>🖼️ رسالة التقديم (التي تظهر بفروم التقديم):</h2>
          <label>عنوان رسالة التقديم:</label>
          <input type="text" name="title" value="${escapeHtml(appData.title || 'تقديم الإدارة الرسمية 👑')}" required>

          <label>الوصف:</label>
          <textarea name="description" rows="2" required>${escapeHtml(appData.description || 'اضغط على الزر بأسفل الرسالة للبدء بتعبئة نموذج التقديم للإدارة.')}</textarea>

          <label>رابط الصورة المرفقة (URL):</label>
          <input type="url" name="imageUrl" value="${escapeHtml(appData.image_url || '')}">

          <hr style="margin: 25px 0; border-color: #334155;">
          <h2>❓ أسئلة التقديم (الأسئلة التي تظهر للعضو):</h2>
          <label>السؤال الأول:</label>
          <input type="text" name="q1" value="${escapeHtml(appData.q1 || 'هل رح تحط اشعار؟')}" required>

          <label>السؤال الثاني:</label>
          <input type="text" name="q2" value="${escapeHtml(appData.q2 || 'هل رح تحط رابط سيرفر بوصف حقك؟')}" required>

          <label>السؤال الثالث:</label>
          <input type="text" name="q3" value="${escapeHtml(appData.q3 || 'هل انت إداري بسيرفر ثاني؟')}" required>

          <label>السؤال الرابع:</label>
          <input type="text" name="q4" value="${escapeHtml(appData.q4 || 'هل عندك شغل يشغلك عن السيرفر؟')}" required>

          <label>السؤال الخامس (اختياري):</label>
          <input type="text" name="q5" value="${escapeHtml(appData.q5 || '')}">

          <button type="submit" style="background:#10b981; color:#fff;">💾 حفظ الإعدادات ونشر بنر التقديم بالديسكورد</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/save-apply-setup', requireAuth, async (req, res) => {
  const d = req.body || {};

  // 🛡️ [إصلاح] حقول ناقصة كانت ترمي TypeError فيبقى الطلب معلقاً بلا رد.
  // العنوان والوصف إلزاميان لأن ديسكورد يرفض إيمبد بعنوان أو وصف فارغ.
  const submitChannelId = safeText(d.submitChannelId);
  const applyTitle = safeText(d.title);
  const applyDescription = safeText(d.description);
  if (!applyTitle) return res.status(400).send('❌ عنوان التقديم مطلوب!');
  if (!applyDescription) return res.status(400).send('❌ وصف التقديم مطلوب!');

  await pool.query(`
    INSERT INTO apply_setup (id, title, description, image_url, submit_channel_id, review_channel_id, results_channel_id, high_admin_role_id, accepted_role_id, q1, q2, q3, q4, q5)
    VALUES ('main_apply', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      image_url = EXCLUDED.image_url,
      submit_channel_id = EXCLUDED.submit_channel_id,
      review_channel_id = EXCLUDED.review_channel_id,
      results_channel_id = EXCLUDED.results_channel_id,
      high_admin_role_id = EXCLUDED.high_admin_role_id,
      accepted_role_id = EXCLUDED.accepted_role_id,
      q1 = EXCLUDED.q1,
      q2 = EXCLUDED.q2,
      q3 = EXCLUDED.q3,
      q4 = EXCLUDED.q4,
      q5 = EXCLUDED.q5;
  `, [
    applyTitle,
    applyDescription,
    safeText(d.imageUrl),
    submitChannelId,
    safeText(d.reviewChannelId),
    safeText(d.resultsChannelId),
    safeText(d.highAdminRoleId),
    safeText(d.acceptedRoleId),
    safeText(d.q1),
    safeText(d.q2),
    safeText(d.q3),
    safeText(d.q4),
    safeText(d.q5)
  ]);

  try {
    if (!submitChannelId) throw new Error('آيدي روم التقديم غير محدد');
    const submitChannel = await client.channels.fetch(submitChannelId);
    if (submitChannel) {
      const applyEmbed = new EmbedBuilder()
        .setTitle(applyTitle)
        .setDescription(applyDescription)
        .setColor(0xeab308);

      // 🛡️ [إصلاح] رابط صورة غير صالح كان يمنع نشر بنر التقديم كلياً
      const applyImageUrl = safeText(d.imageUrl);
      if (applyImageUrl) {
        try {
          applyEmbed.setImage(applyImageUrl);
        } catch (imageError) {
          console.warn('⚠️ تم تجاهل رابط صورة غير صالح في لوحة التقديم:', imageError.message);
        }
      }

      const applyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('start_apply_form')
          .setLabel('تقديم إدارة 📝')
          .setStyle(ButtonStyle.Primary)
      );

      const sentMsg = await submitChannel.send({ embeds: [applyEmbed], components: [applyRow] });
      await pool.query('UPDATE apply_setup SET last_message_id = $1 WHERE id = $2', [sentMsg.id, 'main_apply']);
    }
  } catch (err) {
    console.error('خطأ أثناء نشر لوحة التقديم:', err);
  }

  res.send('<h2>✅ تم حفظ الإعدادات ونشر بنر التقديم بالديسكورد بنجاح!</h2><a href="/apply-setup">العودة</a>');
});

// إدارة جميع الأوامر وصلاحياتها من لوحة موحدة.
app.get('/commands', requireAuth, async (req, res) => {
  const { getTaxCommandConfig, getComeCommandConfig, getSayCommandConfig, getCloseCommandConfig, getCommandControlConfig, getWarnDmConfig, WARN_DM_VARIABLES } = require('./commandConfig');
  const { getSlashCommandConfig, SLASH_COMMAND_NAMES, LEGACY_PREFIX_ROUTES } = require('./slashCommandConfig');
  const { FORM_ACTION_CATEGORIES, getSlashCommandCategories } = require('./commandCategories');
  const { sortByName } = require('./commandSorting');
  const slashCommandData = require('./slashCommands').commandData;
  const [config, comeConfig, sayConfig, closeConfig, controlConfig, warnDmConfig, slashConfig, permissionResult] = await Promise.all([
    // fresh في كل القراءات: صفحة الأوامر يجب أن تعرض ما في قاعدة البيانات
    // فعلاً لا ما في الذاكرة المؤقتة، وإلا بدا للمستخدم أن تعديله اختفى.
    getTaxCommandConfig(pool, { fresh: true }),
    getComeCommandConfig(pool, { fresh: true }),
    getSayCommandConfig(pool, { fresh: true }),
    getCloseCommandConfig(pool, { fresh: true }),
    getCommandControlConfig(pool, { fresh: true }),
    getWarnDmConfig(pool, { fresh: true }),
    // fresh: حتى لا تعرض اللوحة قيمة من الذاكرة لم تثبت في قاعدة البيانات
    getSlashCommandConfig(pool, { fresh: true }),
    pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions'])
  ]);
  const commandPermissions = permissionResult.rows[0] || {};
  const taxRoleId = commandPermissions.tax_role_id || '';
  const comeRoleId = commandPermissions.come_role_id || '';
  const sayRoleId = commandPermissions.say_role_id || '';
  const closePermission = commandPermissions.close_permission || 'both';
  const clanCommandPermissionParts = splitRoleAndUnmatchedIds(commandPermissions.clan_cmd_role_id);
  const renderAliasChips = aliasList => aliasList.map(alias =>
    `<span class="alias-chip"><span>${escapeHtml(alias)}</span><button type="button" data-remove-alias="${escapeHtml(alias)}" aria-label="إزالة الاختصار ${escapeHtml(alias)}">×</button></span>`
  ).join('');
  // 🔓 لم تبقَ قائمة أسماء محجوبة: الرفض الوحيد في المحرّر هو أن يكون
  // الاختصار مستخدماً في أمر آخر (وتُذكر اسم صاحبه) أو أن يزيد عن 32 حرفاً.
  const renderModerationAliasEditor = (id, name, canonicalName, aliasList) => `
    <div class="alias-editor" data-alias-editor data-canonical="${escapeHtml(canonicalName)}">
      <div class="alias-chips" data-alias-chips>${renderAliasChips(aliasList)}</div>
      <div class="alias-entry">
        <input id="moderationAlias-${escapeHtml(id)}" class="alias-input" type="text" maxlength="32" data-alias-input placeholder="أي كلمة أو رمز حتى 32 حرفاً — يعمل كما تكتبه">
        <button class="alias-add" type="button" data-alias-add>Add</button>
      </div>
      <input type="hidden" name="${escapeHtml(name)}" data-alias-values value="${escapeHtml(JSON.stringify(aliasList))}">
      <p class="alias-error" data-alias-error role="status"></p>
    </div>
  `;
  // 🧩 أوامر لها بطاقة مخصّصة أغنى في الأعلى (نصوص وألوان وخيارات)،
  // فلا نكرّرها هنا حتى لا تظهر بطاقتان لنفس الأمر في الصفحة.
  const COMMANDS_WITH_CUSTOM_CARDS = new Set(['tax', 'come', 'say']);
  // 🔤 تُعرض البطاقات مرتّبة أبجدياً (a → z) بدل ترتيب تعريفها في الكود،
  // حتى يجد المستخدم أي أمر بالموضع المتوقَّع. sortByName لا تعدّل المصفوفة
  // الأصلية، فترتيب تسجيل أوامر السلاش في ديسكورد يبقى كما هو تماماً.
  // 🔢 أعداد كل تصنيف تُحسب على الخادم وتُطبع في التبويبات مباشرة، فلا تظهر
  //    أصفار لحظة ثم تقفز عند تشغيل السكربت — وكانت الأرقام تبدو خاطئة بسببها.
  // 🎫 بطاقات أوامر التكت مخفية من هذه الصفحة بقرار المالك (تبقى تعمل بالبريفكس)،
  //    لذلك لا تدخل في أعداد البطاقات المعروضة هنا، لكن الدليل /commands-list يعرضها.
  // 🗺️ أصحاب الاختصارات: كل اسم أمر رسمي له صاحب، لتُعرف الحالة الوحيدة
  // التي يُرفض فيها الاختصار: أنه مستخدم في أمر آخر — مع ذكر اسمه في الرسالة.
  // أوامر التكت ليست لها بطاقات في الصفحة لكنها تعمل بالبريفكس داخل التكت،
  // فتُسجَّل هنا حتى لا يُضاف اختصار يتعارض معها.
  const aliasOwnerLabels = Object.fromEntries(slashCommandData.map(command => [command.name, `/${command.name}`]));
  Object.assign(aliasOwnerLabels, {
    close: 'أوامر التكت', save: 'أوامر التكت', delete: 'أوامر التكت',
    add: 'أوامر التكت', remove: 'أوامر التكت', rename: 'أوامر التكت',
    claim: 'استلام التكت', 'استلام': 'استلام التكت'
  });
  // 🗂️ أقسام صفحة الأوامر: كل أمر يُعرض داخل قسمه (تصنيفه الأساسي)،
  // والأقسام مرتّبة بنفس ترتيب التبويبات حتى تبقى الصفحة متوقَّعة.
  // 🗂️ كل بطاقة في الصفحة تنتمي لقسم واحد بالضبط (لا عضوية مزدوجة)،
  // وترتيب التبويبات هو ترتيب الأقسام في الصفحة نفسها.
  const SECTION_ORDER = ['admin', 'owner', 'xp', 'services', 'other'];
  const SECTION_META = {
    admin: { emoji: '🛡️', label: 'الإدارة والإشراف' },
    owner: { emoji: '👑', label: 'الأونر والنظام' },
    xp: { emoji: '📈', label: 'الإكسبي والمستويات' },
    services: { emoji: '🧰', label: 'معلومات وخدمات' },
    other: { emoji: '📦', label: 'أدوات عامة' },
    custom: { emoji: '⚙️', label: 'أوامر مخصّصة' },
    system: { emoji: '🛡️', label: 'صلاحية الإدارة العامة' }
  };
  const sectionOf = name => getSlashCommandCategories(name)[0] || 'other';
  const makeCommandControl = (groupName, label, help, editorDefinitions = []) => ({
    enabled: controlConfig[groupName].enabled,
    label,
    help,
    editors: editorDefinitions.map(({ field, canonical, label: editorLabel }) => ({
      id: `${groupName}-${field}`,
      name: field,
      canonical,
      label: editorLabel,
      aliases: controlConfig[groupName][field] || []
    }))
  });
  // ⚙️ جسم الصلاحية (النموذج وحقوله) — بلا بطاقة ولا هيكل.
  // يُستخدم في مكانين: بطاقة صلاحية مستقلة (مثل صلاحية الإدارة العامة)،
  // أو مدمجاً داخل بطاقة الأمر نفسه حتى لا يظهر الأمر مرتين في الصفحة.
  const renderCommandPermissionBody = ({ slug, action, description = '', fields = [], extra = '', control = null, submitLabel = 'حفظ الصلاحيات 💾' }) => `
      <form action="${escapeHtml(action)}" method="POST" data-permission-form="${escapeHtml(slug)}">
        ${description ? `<p class="help permission-description">${escapeHtml(description)}</p>` : ''}
        <div class="form">
          <div class="grid">
            ${control ? `
              <div>
                <label for="commandControl-${escapeHtml(slug)}">${escapeHtml(control.label || 'حالة الأوامر')}</label>
                <div class="toggle"><input id="commandControl-${escapeHtml(slug)}" type="checkbox" name="enabled" ${control.enabled ? 'checked' : ''}><span>تفعيل الأوامر</span></div>
                <p class="help">${escapeHtml(control.help || 'عند إيقافها لن يستجيب البوت للأوامر أو اختصاراتها.')}</p>
              </div>
              ${control.editors.map(editor => `
                <div>
                  <label>${escapeHtml(editor.label)}</label>
                  ${renderModerationAliasEditor(`control-${slug}-${editor.id}`, editor.name, editor.canonical, editor.aliases)}
                  ${editor.help ? `<p class="help">${escapeHtml(editor.help)}</p>` : ''}
                </div>
              `).join('')}
            ` : ''}
            ${fields.map(field => `
              <div>
                <label>${escapeHtml(field.label)}</label>
                ${renderRolePicker(field.name, `permission-${slug}-${field.name}`, field.value)}
                ${field.help ? `<p class="help">${escapeHtml(field.help)}</p>` : ''}
              </div>
            `).join('')}
            ${extra}
          </div>
          <div class="actions">
            <button type="submit">${escapeHtml(submitLabel)}</button>
            <a class="back" href="/dashboard">العودة للوحة التحكم</a>
          </div>
        </div>
      </form>
  `;

  const renderCommandPermissionCard = ({ slug, title, command, description, action, fields, extra = '', control = null }) => `
    <section class="card cmd-card" data-command-categories="system" data-command-kind="system" data-command-state="${!control || control.enabled ? 'on' : 'off'}" data-command-search-text="${escapeHtml(`${title} ${command} ${description}`)}">
      <header class="card-head">
        <button class="command-toggle" type="button" data-command-toggle aria-expanded="false" aria-controls="permission-${escapeHtml(slug)}-panel">
          <span class="command-info">
            <span class="command-title">
              <span class="state-dot ${!control || control.enabled ? 'is-on' : 'is-off'}" title="${!control || control.enabled ? 'مفعّل' : 'متوقف'}" aria-hidden="true"></span>
              <span class="cmd-name">${escapeHtml(title)}</span>
            </span>
            <span class="cmd-forms"><code class="form-slash">${escapeHtml(command)}</code></span>
            <span class="command-description">${escapeHtml(description)}</span>
          </span>
          <span class="command-trailing">
            <span class="command-arrow" aria-hidden="true">⌄</span>
          </span>
        </button>
      </header>
      <div class="settings-accordion" id="permission-${escapeHtml(slug)}-panel" aria-hidden="true" inert>
        <div class="settings-accordion-inner">
          ${renderCommandPermissionBody({ slug, action, description: '', fields, extra, control, submitLabel: 'حفظ صلاحيات الأمر 💾' })}
        </div>
      </div>
    </section>
  `;


  // ======================================================================
  // ⚙️ بطاقات الأوامر المخصّصة (الضريبة · الاستدعاء · التحدث · إغلاق التذكرة)
  //
  // تُعرَّف كبيانات ثم تُرتَّب أبجدياً قبل العرض، تماماً مثل بطاقات الصلاحيات،
  // حتى يكون ترتيب الصفحة كلها متوقَّعاً وموحّداً.
  // ⚠️ محتوى البطاقات ووظيفتها لم يتغيّرا؛ تغيّر ترتيب العرض فقط.
  // ======================================================================
  const customCommandCardList = [
    { title: '💰 حاسبة الضريبة', html: `
<section class="card cmd-card" data-command-categories="custom" data-command-kind="custom" data-command-state="${config.enabled ? 'on' : 'off'}" data-command-search-text="💰 حاسبة الضريبة">
          <header class="card-head">
            <button class="command-toggle" type="button" data-command-toggle aria-expanded="false" aria-controls="tax-settings-panel">
              <span class="command-info">
                <span class="command-title"><span class="state-dot ${config.enabled ? 'is-on' : 'is-off'}" aria-hidden="true"></span><span class="cmd-name">💰 حاسبة الضريبة</span></span>
                <span class="cmd-forms"><code class="form-slash">/tax &lt;المبلغ&gt;</code></span>
                <span class="command-description">يحسب المبلغ الصافي والمبلغ المطلوب تحويله بعد الضريبة.</span>
              </span>
              <span class="command-trailing">
                <span class="command-arrow" aria-hidden="true">⌄</span>
              </span>
            </button>
          </header>
          <form action="/save-command-tax" method="POST">
            <div class="settings-accordion" id="tax-settings-panel" aria-hidden="true" inert>
              <div class="settings-accordion-inner">
                <div class="form">
                  <div class="grid">
              <div>
                <label for="enabled">حالة الأمر</label>
                <div class="toggle"><input id="enabled" type="checkbox" name="enabled" ${config.enabled ? 'checked' : ''}><span>تفعيل الأمر</span></div>
                <p class="help">عند إيقافه، لن يستجيب البوت لأمر الضريبة أو أسمائه البديلة.</p>
              </div>
              <div>
                <label for="aliasInput-tax">اختصارات الأمر</label>
                <div class="alias-editor" data-alias-editor data-canonical="tax">
                  <div class="alias-chips" data-alias-chips>${renderAliasChips(config.aliases)}</div>
                  <div class="alias-entry">
                    <input id="aliasInput-tax" class="alias-input" type="text" maxlength="32" data-alias-input placeholder="أي كلمة أو رمز حتى 32 حرفاً — يعمل كما تكتبه">
                    <button class="alias-add" type="button" data-alias-add>Add</button>
                  </div>
                  <input type="hidden" name="aliases" data-alias-values value="${escapeHtml(JSON.stringify(config.aliases))}">
                  <p class="alias-error" data-alias-error role="status"></p>
                </div>
                <p class="help">اكتب الاختصار مثل <code>ضريبة</code>؛ يعمل مباشرة بلا بريفكس. الاسم الأساسي الآن <code>/tax</code>.</p>
              </div>
              <div>
                <label for="taxRatePercent">نسبة الضريبة (%)</label>
                <input id="taxRatePercent" type="number" name="taxRatePercent" min="0" max="99" step="0.01" value="${config.taxRatePercent}" required>
                <p class="help">القيمة الافتراضية 5%، ويمكن ضبط نسبة مختلفة لهذا السيرفر.</p>
              </div>
              <div>
                <label>الرولات المسموح لها باستخدام أمر الضريبة</label>
                ${renderRolePicker('taxRoleId', 'taxRoleId', taxRoleId)}
                <p class="help">اترك القائمة فارغة لاستخدام رتبة ادمن ستريس الافتراضية. رتبة الإدارة العامة والمدراء تحتفظ بصلاحيتها.</p>
              </div>
            </div>

            <h3 class="section-title">تخصيص الرد</h3>
            <div class="grid">
              <div>
                <label for="embedTitle">عنوان الإيمبد</label>
                <input id="embedTitle" name="embedTitle" value="${escapeHtml(config.embedTitle)}" maxlength="256" required>
              </div>
              <div>
                <label for="embedColor">لون الإيمبد</label>
                <input id="embedColor" type="color" name="embedColor" value="${escapeHtml(config.embedColor)}">
              </div>
              <div>
                <label for="originalLabel">اسم خانة المبلغ الأصلي</label>
                <input id="originalLabel" name="originalLabel" value="${escapeHtml(config.originalLabel)}" maxlength="256" required>
              </div>
              <div>
                <label for="netLabel">اسم خانة المبلغ الصافي</label>
                <input id="netLabel" name="netLabel" value="${escapeHtml(config.netLabel)}" maxlength="256" required>
              </div>
              <div>
                <label for="grossLabel">اسم خانة المبلغ المطلوب تحويله</label>
                <input id="grossLabel" name="grossLabel" value="${escapeHtml(config.grossLabel)}" maxlength="256" required>
              </div>
            </div>
            <div class="actions">
              <button type="submit">حفظ إعدادات الأمر 💾</button>
              <a class="back" href="/dashboard">العودة للوحة التحكم</a>
            </div>
                </div>
              </div>
            </div>
          </form>
        </section>` },
    { title: '⚠️ رسالة الإنذار الخاصة', html: `
<section class="card cmd-card" data-command-categories="custom" data-command-kind="custom" data-command-state="${warnDmConfig.enabled ? 'on' : 'off'}" data-command-search-text="⚠️ رسالة الإنذار الخاصة warn dm">
          <header class="card-head">
            <button class="command-toggle" type="button" data-command-toggle aria-expanded="false" aria-controls="warndm-settings-panel">
              <span class="command-info">
                <span class="command-title"><span class="state-dot ${warnDmConfig.enabled ? 'is-on' : 'is-off'}" aria-hidden="true"></span><span class="cmd-name">⚠️ رسالة الإنذار الخاصة</span></span>
                <span class="cmd-forms"><code class="form-slash">/warn &lt;العضو&gt; &lt;السبب&gt;</code></span>
                <span class="command-description">الرسالة التي تصل العضو بالخاص عند إنذاره — نص وإيمبد قابلان للتخصيص بالكامل.</span>
              </span>
              <span class="command-trailing">
                <span class="command-arrow" aria-hidden="true">⌄</span>
              </span>
            </button>
          </header>
          <form action="/save-warn-dm" method="POST" data-warndm-form>
            <div class="settings-accordion" id="warndm-settings-panel" aria-hidden="true" inert>
              <div class="settings-accordion-inner">
                <div class="form">
                  <div class="grid">
                    <div style="grid-column:1/-1;">
                      <label for="warnDmEnabled">حالة الإشعار</label>
                      <div class="toggle"><input id="warnDmEnabled" type="checkbox" name="enabled" ${warnDmConfig.enabled ? 'checked' : ''}><span>إرسال رسالة خاصة للعضو عند إنذاره</span></div>
                      <p class="help">عند إيقافه يُسجَّل الإنذار كالمعتاد لكن لا تصل العضو أي رسالة. إيقافه لا يعطّل أمر <code>/warn</code> إطلاقاً.</p>
                    </div>

                    <div style="grid-column:1/-1;">
                      <label>المتغيرات المتاحة</label>
                      <div class="warndm-vars">${WARN_DM_VARIABLES.map(v => `<button type="button" class="warndm-var" data-warndm-var="${escapeHtml(v.key)}" title="${escapeHtml(v.description)}">${escapeHtml(v.key)}</button>`).join('')}</div>
                      <p class="help">اضغط أي متغير لإدراجه في آخر حقل كتبت فيه. تُستبدل تلقائياً عند الإرسال.</p>
                    </div>

                    <div style="grid-column:1/-1;">
                      <label for="warnDmMessageText">النص فوق الإيمبد</label>
                      <textarea id="warnDmMessageText" name="messageText" rows="2" maxlength="1800" data-warndm-input placeholder="اتركه فارغاً للاكتفاء بالإيمبد">${escapeHtml(warnDmConfig.messageText)}</textarea>
                    </div>

                    <div style="grid-column:1/-1;">
                      <label for="warnDmEmbedEnabled">الإيمبد</label>
                      <div class="toggle"><input id="warnDmEmbedEnabled" type="checkbox" name="embedEnabled" ${warnDmConfig.embedEnabled ? 'checked' : ''} data-warndm-input><span>إرفاق إيمبد مع الرسالة</span></div>
                    </div>

                    <div>
                      <label for="warnDmEmbedTitle">عنوان الإيمبد</label>
                      <input id="warnDmEmbedTitle" name="embedTitle" value="${escapeHtml(warnDmConfig.embedTitle)}" maxlength="256" data-warndm-input>
                    </div>
                    <div>
                      <label for="warnDmEmbedColor">لون الإيمبد</label>
                      <input id="warnDmEmbedColor" type="color" name="embedColor" value="${escapeHtml(warnDmConfig.embedColor)}" data-warndm-input>
                    </div>

                    <div style="grid-column:1/-1;">
                      <label for="warnDmEmbedDescription">نص الإيمبد</label>
                      <textarea id="warnDmEmbedDescription" name="embedDescription" rows="5" maxlength="4000" data-warndm-input>${escapeHtml(warnDmConfig.embedDescription)}</textarea>
                    </div>

                    <div>
                      <label for="warnDmEmbedImageUrl">صورة كبيرة (رابط)</label>
                      <input id="warnDmEmbedImageUrl" name="embedImageUrl" value="${escapeHtml(warnDmConfig.embedImageUrl)}" maxlength="500" placeholder="https://..." data-warndm-input>
                      <p class="help">روابط <code>https</code> فقط. اتركه فارغاً لإخفاء الصورة.</p>
                    </div>
                    <div>
                      <label for="warnDmEmbedThumbnailUrl">صورة مصغّرة (رابط)</label>
                      <input id="warnDmEmbedThumbnailUrl" name="embedThumbnailUrl" value="${escapeHtml(warnDmConfig.embedThumbnailUrl)}" maxlength="500" placeholder="https://..." data-warndm-input>
                    </div>

                    <div style="grid-column:1/-1;">
                      <label for="warnDmEmbedFooter">الفوتر</label>
                      <input id="warnDmEmbedFooter" name="embedFooter" value="${escapeHtml(warnDmConfig.embedFooter)}" maxlength="2048" data-warndm-input>
                    </div>

                    <div style="grid-column:1/-1;">
                      <label>المعاينة المباشرة</label>
                      <div class="warndm-preview" data-warndm-preview>
                        <p class="warndm-preview-text" data-warndm-preview-text></p>
                        <div class="warndm-embed" data-warndm-preview-embed>
                          <div class="warndm-embed-body">
                            <div class="warndm-embed-main">
                              <p class="warndm-embed-title" data-warndm-preview-title></p>
                              <p class="warndm-embed-desc" data-warndm-preview-desc></p>
                              <p class="warndm-embed-footer" data-warndm-preview-footer></p>
                            </div>
                            <img class="warndm-embed-thumb" data-warndm-preview-thumb alt="">
                          </div>
                          <img class="warndm-embed-image" data-warndm-preview-image alt="">
                        </div>
                      </div>
                      <p class="help">المعاينة تستخدم بيانات تجريبية لتوضيح شكل الرسالة بعد استبدال المتغيرات.</p>
                    </div>
                  </div>
                  <div class="actions">
                    <button type="submit">حفظ إعدادات الإنذار 💾</button>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </section>` },
    { title: '🔔 الاستدعاء', html: `
<section class="card cmd-card" data-command-categories="custom" data-command-kind="custom" data-command-state="${comeConfig.enabled ? 'on' : 'off'}" data-command-search-text="🔔 الاستدعاء">
          <header class="card-head">
            <button class="command-toggle" type="button" data-command-toggle aria-expanded="false" aria-controls="come-settings-panel">
              <span class="command-info">
                <span class="command-title"><span class="state-dot ${comeConfig.enabled ? 'is-on' : 'is-off'}" aria-hidden="true"></span><span class="cmd-name">🔔 الاستدعاء</span></span>
                <span class="cmd-forms"><code class="form-slash">/come &lt;العضو&gt;</code></span>
                <span class="command-description">يرسل للعضو رسالة خاصة فيها استدعاء ورابط مباشر للروم.</span>
              </span>
              <span class="command-trailing">
                <span class="command-arrow" aria-hidden="true">⌄</span>
              </span>
            </button>
          </header>
          <form action="/save-command-come" method="POST">
            <div class="settings-accordion" id="come-settings-panel" aria-hidden="true" inert>
              <div class="settings-accordion-inner">
                <div class="form">
                  <div class="grid">
                    <div>
                      <label for="comeEnabled">حالة الأمر</label>
                      <div class="toggle"><input id="comeEnabled" type="checkbox" name="enabled" ${comeConfig.enabled ? 'checked' : ''}><span>تفعيل الأمر</span></div>
                      <p class="help">عند إيقافه لن يستجيب البوت للأمر أو أسمائه البديلة.</p>
                    </div>
                    <div>
                      <label for="aliasInput-come">اختصارات الأمر</label>
                      <div class="alias-editor" data-alias-editor data-canonical="come">
                        <div class="alias-chips" data-alias-chips>${renderAliasChips(comeConfig.aliases)}</div>
                        <div class="alias-entry">
                          <input id="aliasInput-come" class="alias-input" type="text" maxlength="32" data-alias-input placeholder="أي كلمة أو رمز حتى 32 حرفاً — يعمل كما تكتبه">
                          <button class="alias-add" type="button" data-alias-add>Add</button>
                        </div>
                        <input type="hidden" name="aliases" data-alias-values value="${escapeHtml(JSON.stringify(comeConfig.aliases))}">
                        <p class="alias-error" data-alias-error role="status"></p>
                      </div>
                      <p class="help">اختصار مثل <code>تعال</code> يعمل مباشرة بلا بريفكس. الاسم الأساسي الآن <code>/come</code>.</p>
                    </div>
                    <div>
                      <label>الرولات المسموح لها باستخدام أمر الاستدعاء</label>
                      ${renderRolePicker('comeRoleId', 'comeRoleId', comeRoleId)}
                      <p class="help">اترك القائمة فارغة لاستخدام رتبة ادمن ستريس الافتراضية.</p>
                    </div>
                    <div>
                      <label for="comeEmbedTitle">عنوان رسالة الاستدعاء</label>
                      <input id="comeEmbedTitle" name="embedTitle" value="${escapeHtml(comeConfig.embedTitle)}" maxlength="256" required>
                    </div>
                    <div>
                      <label for="comeEmbedColor">لون الإيمبد</label>
                      <input id="comeEmbedColor" type="color" name="embedColor" value="${escapeHtml(comeConfig.embedColor)}">
                    </div>
                    <div style="grid-column:1/-1;">
                      <label for="comeEmbedDescription">نص رسالة الاستدعاء</label>
                      <textarea id="comeEmbedDescription" name="embedDescription" rows="6" maxlength="4000" required>${escapeHtml(comeConfig.embedDescription)}</textarea>
                      <p class="help">متغيرات قابلة للإدراج: <code>{admin}</code> اسم الإداري، <code>{member}</code> اسم العضو، <code>{channel}</code> الروم، و<code>{link}</code> رابط الرسالة.</p>
                    </div>
                  </div>
                  <div class="actions">
                    <button type="submit">حفظ إعدادات الأمر 💾</button>
                    <a class="back" href="/dashboard">العودة للوحة التحكم</a>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </section>` },
    { title: '🗣️ التحدث', html: `
<section class="card cmd-card" data-command-categories="custom" data-command-kind="custom" data-command-state="${sayConfig.enabled ? 'on' : 'off'}" data-command-search-text="🗣️ التحدث">
          <header class="card-head">
            <button class="command-toggle" type="button" data-command-toggle aria-expanded="false" aria-controls="say-settings-panel">
              <span class="command-info">
                <span class="command-title"><span class="state-dot ${sayConfig.enabled ? 'is-on' : 'is-off'}" aria-hidden="true"></span><span class="cmd-name">🗣️ التحدث</span></span>
                <span class="cmd-forms"><code class="form-slash">/say &lt;النص&gt;</code></span>
                <span class="command-description">ينشر النص الذي تكتبه في الروم، مع إمكانية التحكم بحذف الأمر والمنشنات.</span>
              </span>
              <span class="command-trailing">
                <span class="command-arrow" aria-hidden="true">⌄</span>
              </span>
            </button>
          </header>
          <form action="/save-command-say" method="POST">
            <div class="settings-accordion" id="say-settings-panel" aria-hidden="true" inert>
              <div class="settings-accordion-inner">
                <div class="form">
                  <div class="grid">
                    <div>
                      <label for="sayEnabled">حالة الأمر</label>
                      <div class="toggle"><input id="sayEnabled" type="checkbox" name="enabled" ${sayConfig.enabled ? 'checked' : ''}><span>تفعيل الأمر</span></div>
                      <p class="help">عند إيقافه لن يستجيب البوت للأمر أو أسمائه البديلة.</p>
                    </div>
                    <div>
                      <label for="aliasInput-say">اختصارات الأمر</label>
                      <div class="alias-editor" data-alias-editor data-canonical="say">
                        <div class="alias-chips" data-alias-chips>${renderAliasChips(sayConfig.aliases)}</div>
                        <div class="alias-entry">
                          <input id="aliasInput-say" class="alias-input" type="text" maxlength="32" data-alias-input placeholder="أي كلمة أو رمز حتى 32 حرفاً — يعمل كما تكتبه">
                          <button class="alias-add" type="button" data-alias-add>Add</button>
                        </div>
                        <input type="hidden" name="aliases" data-alias-values value="${escapeHtml(JSON.stringify(sayConfig.aliases))}">
                        <p class="alias-error" data-alias-error role="status"></p>
                      </div>
                      <p class="help">اكتب اختصاراً مثل <code>تكلم</code> وسيعمل بلا بريفكس. الاسم الأساسي الآن <code>/say</code>.</p>
                    </div>
                    <div>
                      <label>الرولات المسموح لها باستخدام أمر التحدث</label>
                      ${renderRolePicker('sayRoleId', 'sayRoleId', sayRoleId)}
                      <p class="help">اترك القائمة فارغة لاستخدام رتبة ادمن ستريس الافتراضية.</p>
                    </div>
                    <div>
                      <label for="sayMentionPolicy">المنشنات المسموح بها في الرسالة</label>
                      <select id="sayMentionPolicy" name="mentionPolicy">
                        <option value="all" ${sayConfig.mentionPolicy === 'all' ? 'selected' : ''}>جميع المنشنات (السلوك الحالي)</option>
                        <option value="users" ${sayConfig.mentionPolicy === 'users' ? 'selected' : ''}>منشن الأعضاء فقط</option>
                        <option value="roles" ${sayConfig.mentionPolicy === 'roles' ? 'selected' : ''}>منشن الرتب فقط</option>
                        <option value="none" ${sayConfig.mentionPolicy === 'none' ? 'selected' : ''}>منع جميع المنشنات</option>
                      </select>
                      <p class="help">اختر إن كانت رسالة البوت تستطيع تنبيه أعضاء أو رتب.</p>
                    </div>
                    <div>
                      <label for="sayDeleteInvocation">رسالة الأمر</label>
                      <div class="toggle"><input id="sayDeleteInvocation" type="checkbox" name="deleteInvocation" ${sayConfig.deleteInvocation ? 'checked' : ''}><span>حذف رسالة الإداري بعد النشر</span></div>
                      <p class="help">الخيار مفعل افتراضياً كما في سلوك البوت الحالي.</p>
                    </div>
                  </div>
                  <div class="actions">
                    <button type="submit">حفظ إعدادات الأمر 💾</button>
                    <a class="back" href="/dashboard">العودة للوحة التحكم</a>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </section>` },
    { title: '🔒 إغلاق التذكرة', ticketOnly: true, html: `
<section class="card cmd-card" data-command-categories="tickets" data-command-kind="custom" data-command-state="${closeConfig.enabled ? 'on' : 'off'}" data-command-search-text="🔒 إغلاق التذكرة">
          <header class="card-head">
            <button class="command-toggle" type="button" data-command-toggle aria-expanded="false" aria-controls="close-settings-panel">
              <span class="command-info">
                <span class="command-title"><span class="state-dot ${closeConfig.enabled ? 'is-on' : 'is-off'}" aria-hidden="true"></span><span class="cmd-name">🔒 إغلاق التذكرة</span></span>
                <span class="cmd-forms"><code class="form-slash">/ticket close</code><code class="form-prefix">!close</code></span>
                <span class="command-description">يقفل التذكرة ويعرض أزرار إعادة الفتح وحفظ السجل وحذف التذكرة.</span>
              </span>
              <span class="command-trailing">
                <span class="command-arrow" aria-hidden="true">⌄</span>
              </span>
            </button>
          </header>
          <form action="/save-command-close" method="POST">
            <div class="settings-accordion" id="close-settings-panel" aria-hidden="true" inert>
              <div class="settings-accordion-inner">
                <div class="form">
                  <div class="grid">
                    <div>
                      <label for="closeEnabled">حالة الأمر</label>
                      <div class="toggle"><input id="closeEnabled" type="checkbox" name="enabled" ${closeConfig.enabled ? 'checked' : ''}><span>تفعيل الأمر</span></div>
                      <p class="help">عند إيقافه لن ينفذ البوت <code>!close</code> أو الاختصارات.</p>
                    </div>
                    <div>
                      <label for="aliasInput-close">اختصارات الأمر</label>
                      <div class="alias-editor" data-alias-editor data-canonical="close">
                        <div class="alias-chips" data-alias-chips>${renderAliasChips(closeConfig.aliases)}</div>
                        <div class="alias-entry">
                          <input id="aliasInput-close" class="alias-input" type="text" maxlength="32" data-alias-input placeholder="أي كلمة أو رمز حتى 32 حرفاً — يعمل كما تكتبه">
                          <button class="alias-add" type="button" data-alias-add>Add</button>
                        </div>
                        <input type="hidden" name="aliases" data-alias-values value="${escapeHtml(JSON.stringify(closeConfig.aliases))}">
                        <p class="alias-error" data-alias-error role="status"></p>
                      </div>
                      <p class="help">مثال: أضف <code>قفل</code> ثم اكتب <code>قفل</code> مباشرة داخل التذكرة بدون <code>!</code>.</p>
                    </div>
                    <div>
                      <label for="ticketCommandsEnabled">أوامر التذاكر الإضافية</label>
                      <div class="toggle"><input id="ticketCommandsEnabled" type="checkbox" name="ticketCommandsEnabled" ${controlConfig.ticketCommands.enabled ? 'checked' : ''}><span>تفعيل أوامر الحفظ والحذف والإدارة</span></div>
                      <p class="help">يشمل !save و!delete و!add و!remove و!rename واختصاراتها؛ لا يغيّر إعداد أمر !close أعلاه.</p>
                    </div>
                    <div>
                      <label>اختصارات !save</label>
                      ${renderModerationAliasEditor('ticket-save', 'saveAliases', 'save', controlConfig.ticketCommands.saveAliases)}
                    </div>
                    <div>
                      <label>اختصارات !delete</label>
                      ${renderModerationAliasEditor('ticket-delete', 'deleteAliases', 'delete', controlConfig.ticketCommands.deleteAliases)}
                    </div>
                    <div>
                      <label>اختصارات !add داخل التذكرة</label>
                      ${renderModerationAliasEditor('ticket-add', 'addAliases', 'add', controlConfig.ticketCommands.addAliases)}
                    </div>
                    <div>
                      <label>اختصارات !remove داخل التذكرة</label>
                      ${renderModerationAliasEditor('ticket-remove', 'removeAliases', 'remove', controlConfig.ticketCommands.removeAliases)}
                    </div>
                    <div>
                      <label>اختصارات !rename داخل التذكرة</label>
                      ${renderModerationAliasEditor('ticket-rename', 'renameAliases', 'rename', controlConfig.ticketCommands.renameAliases)}
                    </div>
                    <div>
                      <label for="closePermission">من يستطيع إغلاق التذكرة؟</label>
                      <select id="closePermission" name="closePermission">
                        <option value="both" ${closePermission === 'both' ? 'selected' : ''}>صاحب التذكرة والإدارة</option>
                        <option value="admin_only" ${closePermission === 'admin_only' ? 'selected' : ''}>الإدارة فقط</option>
                      </select>
                    </div>
                    <div>
                      <label for="deletePermission">من يستطيع حذف التذكرة؟</label>
                      <select id="deletePermission" name="deletePermission">
                        <option value="high_admin" ${!commandPermissions.delete_permission || commandPermissions.delete_permission === 'high_admin' ? 'selected' : ''}>الإدارة العليا فقط</option>
                        <option value="all_admin" ${commandPermissions.delete_permission === 'all_admin' ? 'selected' : ''}>جميع طاقم الإدارة</option>
                      </select>
                    </div>
                    <div>
                      <label for="savePermission">من يستطيع حفظ الترانسكريبت؟</label>
                      <select id="savePermission" name="savePermission">
                        <option value="both" ${!commandPermissions.save_permission || commandPermissions.save_permission === 'both' ? 'selected' : ''}>صاحب التذكرة والإدارة</option>
                        <option value="admin_only" ${commandPermissions.save_permission === 'admin_only' ? 'selected' : ''}>الإدارة فقط</option>
                      </select>
                    </div>
                  </div>
                  <div class="actions">
                    <button type="submit">حفظ إعدادات الأمر 💾</button>
                    <a class="back" href="/dashboard">العودة للوحة التحكم</a>
                  </div>
                </div>
              </div>
            </div>
          </form>
        </section>` }
  ];
  const customCardList = sortByName(customCommandCardList.filter(card => !card.ticketOnly), card => card.title);
  const customCommandCards = customCardList.map(card => card.html).join('\n');

  // ======================================================================
  // 🛡️ بطاقات صلاحيات الأوامر والأنظمة
  //
  // كانت هذه البطاقات مكتوبة واحدة تلو الأخرى داخل الصفحة بترتيب عشوائي،
  // فيصعب إيجاد بطاقة معيّنة أو إضافة واحدة جديدة في مكانها الصحيح.
  // الآن تُعرَّف كبيانات، وتُرتَّب أبجدياً حسب عنوانها الظاهر قبل العرض.
  // لإضافة صلاحية جديدة: أضف عنصراً للمصفوفة فقط — الترتيب يتكفّل بالباقي.
  //
  // ⚠️ محتوى كل بطاقة ووظيفتها لم يتغيّرا إطلاقاً؛ تغيّر ترتيب العرض فقط.
  // ======================================================================
  const permissionCardList = [
    {
      title: 'صلاحية الإدارة العامة',
      html: renderCommandPermissionCard({
        slug: 'global', title: 'صلاحية الإدارة العامة', command: 'كل الأوامر',
        description: 'أي عضو يحمل إحدى هذه الرتب يتجاوز قيود الرتبة الخاصة بكل أمر.',
        action: '/save-command-permissions/global',
        fields: [{ name: 'allCommandsRoleId', label: 'رولات الإدارة العامة', value: commandPermissions.all_commands_role_id }]
      })
    },
    {
      title: 'إدارة سجل استلام التذاكر',
      ticketOnly: true,
      html: renderCommandPermissionCard({
        slug: 'claim', title: 'إدارة سجل استلام التذاكر', command: 'أوامر الاستلام  ·  /claimstats',
        description: 'تفعيل وإضافة اختصارات لأوامر تسجيل وسحب وتصفير إحصاءات الاستلام للإدارة والوسطاء.',
        action: '/save-command-permissions/claim',
        control: makeCommandControl('claim', 'حالة أوامر سجل الاستلام', 'عند الإيقاف لن تعمل أوامر تسجيل أو تصفير الاستلام أو اختصاراتها.', [
          { field: 'addAdminAliases', canonical: 'اضافة-استلام-اداري', label: 'اختصارات إضافة استلام الإدارة' },
          { field: 'removeAdminAliases', canonical: 'سحب-استلام-اداري', label: 'اختصارات سحب استلام الإدارة' },
          { field: 'clearAdminAliases', canonical: 'تصفير-استلام-اداري', label: 'اختصارات تصفير استلام الإدارة لشخص' },
          { field: 'clearAllAdminAliases', canonical: 'تصفير-الكل-استلام-اداري', label: 'اختصارات تصفير استلام الإدارة للجميع' },
          { field: 'addMediatorAliases', canonical: 'اضافة-استلام-وسيط', label: 'اختصارات إضافة استلام الوسطاء' },
          { field: 'removeMediatorAliases', canonical: 'سحب-استلام-وسيط', label: 'اختصارات سحب استلام الوسطاء' },
          { field: 'clearMediatorAliases', canonical: 'تصفير-استلام-وسيط', label: 'اختصارات تصفير استلام وسيط لشخص' },
          { field: 'clearAllMediatorAliases', canonical: 'تصفير-الكل-استلام-وسيط', label: 'اختصارات تصفير استلام الوسطاء للجميع' },
          { field: 'clearAllAliases', canonical: 'تصفير-استلام', label: 'اختصارات تصفير استلام شخص (الإدارة والوسطاء)' },
          { field: 'clearAllProfilesAliases', canonical: 'تصفير-الكل-استلام', label: 'اختصارات تصفير سجل الجميع' }
        ]),
        fields: [{ name: 'claimRoleId', label: 'الرولات المسموح لها بأوامر سجل الاستلام', value: commandPermissions.claim_role_id }]
      })
    },
    {
      title: 'صلاحيات مشاهدة وكتابة الروم',
      mergeInto: 'channel',
      blockTitle: '🔐 صلاحيات مشاهدة وكتابة الروم',
      submitLabel: 'حفظ صلاحيات المشاهدة والكتابة 💾',
      body: renderCommandPermissionBody({
        slug: 'channel-access', title: 'صلاحيات مشاهدة وكتابة الروم', command: '/channel view / write',
        description: 'حدد الرولات المسموح لها بمنح أعضاء أو رولات صلاحية مشاهدة الروم أو الكتابة فيه.',
        action: '/save-command-permissions/channel-access',
        control: makeCommandControl('channelAccess', 'حالة أوامر صلاحيات الروم', 'عند الإيقاف لن تعمل أوامر منح المشاهدة والكتابة أو اختصاراتها.', [
          { field: 'addAliases', canonical: 'اضافة', label: 'اختصارات مجرّدة لأمر منح المشاهدة' },
          { field: 'writeAliases', canonical: 'كتابة', label: 'اختصارات مجرّدة لأمر منح الكتابة' }
        ]),
        fields: [
          { name: 'addViewRoleId', label: 'رولات أمر منح المشاهدة', value: commandPermissions.add_view_role_id },
          { name: 'writeRoleId', label: 'رولات أمر منح الكتابة', value: commandPermissions.write_role_id }
        ]
      })
    },
    {
      title: 'تحديد رومات حاسبة الضريبة',
      mergeInto: 'channel',
      blockTitle: '💰 رومات حاسبة الضريبة التلقائية',
      submitLabel: 'حفظ رومات الضريبة 💾',
      body: renderCommandPermissionBody({
        slug: 'tax-channel', title: 'تحديد رومات حاسبة الضريبة', command: '/channel tax',
        description: 'صلاحية اختيار وإزالة الرومات التي تعمل فيها حاسبة الضريبة التلقائية.',
        action: '/save-command-permissions/tax-channel',
        control: makeCommandControl('taxChannel', 'حالة أمر تحديد رومات الضريبة', 'يتحكم هذا الأمر بالرومات التي تعمل فيها الحاسبة التلقائية المنفصلة عن /tax.', [
          { field: 'aliases', canonical: 'ضريبة', label: 'اختصارات مجرّدة لأمر رومات الضريبة' }
        ]),
        fields: [{ name: 'taxChannelRoleId', label: 'الرولات المسموح لها بتحديد رومات الضريبة', value: commandPermissions.tax_channel_role_id }]
      })
    },
    {
      title: 'إدارة رومات الاقتراحات',
      mergeInto: 'channel',
      blockTitle: '💡 رومات نظام الاقتراحات',
      submitLabel: 'حفظ رومات الاقتراحات 💾',
      body: renderCommandPermissionBody({
        slug: 'suggestions', title: 'إدارة رومات الاقتراحات', command: '/channel suggestions',
        description: 'صلاحية إضافة أو إزالة الرومات المستخدمة لنظام الاقتراحات.',
        action: '/save-command-permissions/suggestions',
        control: makeCommandControl('suggestions', 'حالة أمر الاقتراحات', 'عند الإيقاف لا يمكن إضافة أو إزالة رومات الاقتراحات من هذا الأمر.', [
          { field: 'aliases', canonical: 'اقتراحات', label: 'اختصارات مجرّدة لأمر رومات الاقتراحات' }
        ]),
        fields: [{ name: 'suggestionsRoleId', label: 'الرولات المسموح لها بإدارة رومات الاقتراحات', value: commandPermissions.suggestions_role_id }]
      })
    },
    {
      title: 'تغيير اسم الروم',
      mergeInto: 'channel',
      blockTitle: '✏️ صلاحية تغيير اسم الروم',
      submitLabel: 'حفظ صلاحية تغيير الاسم 💾',
      body: renderCommandPermissionBody({
        slug: 'rename', title: 'تغيير اسم الروم', command: '/channel rename',
        description: 'صلاحية تغيير اسم الروم الحالي.',
        action: '/save-command-permissions/rename',
        control: makeCommandControl('renameChannel', 'حالة تغيير اسم الروم', 'عند الإيقاف لا يعمل الأمر ولا اختصاراته المجرّدة.', [
          { field: 'aliases', canonical: 'r', label: 'اختصارات مجرّدة لأمر تغيير اسم الروم' }
        ]),
        fields: [{ name: 'renameRoleId', label: 'الرولات المسموح لها بتغيير اسم الروم', value: commandPermissions.rename_role_id }]
      })
    },
    {
      title: 'إدارة حالة البوت',
      mergeInto: 'botstatus',
      blockTitle: '🛠️ صلاحيات المسار القديم (الحالة · الحالة2)',
      body: renderCommandPermissionBody({
        slug: 'status', title: 'إدارة حالة البوت', command: '/botstatus set / about',
        description: 'صلاحية تغيير حالة البوت أو وصفه من أوامر النظام.',
        action: '/save-command-permissions/status',
        control: makeCommandControl('status', 'حالة أوامر البوت', 'تفعيل أو تعطيل تغيير حالة البوت ووصفه مع اختصارات كل أمر.', [
          { field: 'statusAliases', canonical: 'الحالة', label: 'اختصارات مجرّدة لأمر حالة البوت' },
          { field: 'status2Aliases', canonical: 'الحالة2', label: 'اختصارات مجرّدة لأمر وصف البوت' }
        ]),
        fields: [{ name: 'statusRoleId', label: 'الرولات المسموح لها بأوامر الحالة', value: commandPermissions.status_role_id }]
      })
    },
    {
      title: 'إعطاء وسحب الرتبة تلقائياً',
      mergeInto: 'role',
      blockTitle: '🔄 صلاحيات المسار القديم (الرول)',
      body: renderCommandPermissionBody({
        slug: 'role-toggle', title: 'إعطاء وسحب الرتبة تلقائياً', command: '/role toggle',
        description: 'صلاحية تبديل رتبة العضو: يمنحها له إن لم تكن معه ويسحبها إن كانت معه.',
        action: '/save-command-permissions/role-toggle',
        control: makeCommandControl('roleToggle', 'حالة تبديل الرتب', 'عند الإيقاف لا يعمل الأمر ولا اختصاراته المجرّدة.', [
          { field: 'aliases', canonical: 'رول', label: 'اختصارات مجرّدة لأمر الرول' }
        ]),
        fields: [{ name: 'roleToggleRoleId', label: 'الرولات المسموح لها بأمر الرول', value: commandPermissions.role_toggle_role_id }]
      })
    },
    {
      title: '🏰 صلاحيات نظام الكلانات',
      mergeInto: 'clan',
      blockTitle: '🏰 صلاحيات نظام الكلانات',
      submitLabel: 'حفظ صلاحيات الكلانات 💾',
      body: `
      <form action="/save-command-permissions/clans" method="POST" data-permission-form="clans">
        <p class="help permission-description">حدد رولات مسؤولي الكلانات ورولات وأشخاص استخدام أوامر الكلانات.</p>
        <div class="form">
          <div class="grid">
                    <div>
                      <label for="commandControl-clans">حالة أوامر الكلانات</label>
                      <div class="toggle"><input id="commandControl-clans" type="checkbox" name="enabled" ${controlConfig.clans.enabled ? 'checked' : ''}><span>تفعيل الأوامر</span></div>
                      <p class="help">عند الإيقاف لن تعمل أوامر إنشاء الكلان أو التقديم ولا اختصاراتها.</p>
                    </div>
                    <div>
                      <label>اختصارات مجرّدة لأمر الكلان</label>
                      ${renderModerationAliasEditor('control-clans-clan', 'clanAliases', 'كلان', controlConfig.clans.clanAliases)}
                    </div>
                    <div>
                      <label>اختصارات مجرّدة لأمر تقديم الكلان</label>
                      ${renderModerationAliasEditor('control-clans-apply', 'applyAliases', 'تقديم-كلان', controlConfig.clans.applyAliases)}
                    </div>
                    <div>
                      <label>رولات مسؤولي الكلانات</label>
                      ${renderRolePicker('clanManagerRoleId', 'command-clanManagerRoleId', commandPermissions.clan_manager_role_id)}
                      <p class="help">هذه الرولات ترى جميع الكلانات وروماتها.</p>
                    </div>
                    <div>
                      <label>رولات استخدام أوامر الكلانات</label>
                      ${renderRolePicker('clanCmdRoleIds', 'command-clanCmdRoleIds', clanCommandPermissionParts.roleIds)}
                      <p class="help">اختيار الرولات لا يحتاج كتابة آيديات أو فواصل.</p>
                    </div>
                    <div>
                      <label for="clanCommandUserIds">آيديات الأشخاص المسموح لهم (اختياري)</label>
                      <input id="clanCommandUserIds" type="text" name="clanCmdUserIds" value="${escapeHtml(clanCommandPermissionParts.unmatchedIds)}" placeholder="آيدي شخص أو أكثر، مفصولة بفواصل">
                    </div>
                  </div>
                            </div>
          <div class="actions">
            <button type="submit">حفظ صلاحيات الكلانات 💾</button>
            <a class="back" href="/dashboard">العودة للوحة التحكم</a>
          </div>
        </div>
      </form>`
    },
    {
      title: 'تحديد روم سجل الأخطاء',
      mergeInto: 'logchannel',
      blockTitle: '📝 صلاحيات المسار القديم (سجل الأخطاء)',
      body: renderCommandPermissionBody({
        slug: 'owner-log', title: 'تحديد روم سجل الأخطاء', command: '/logchannel',
        description: 'حدد روم استقبال سجلات الأخطاء من البوت، مع إمكانية التحكم بالأمر واختصاراته.',
        action: '/save-command-permissions/owner-log',
        control: makeCommandControl('ownerLog', 'حالة أمر سجل الأخطاء', 'عند الإيقاف لن يعمل الأمر ولا اختصاراته المجرّدة.', [
          { field: 'aliases', canonical: 'logowner', label: 'اختصارات مجرّدة لأمر سجل الأخطاء' }
        ]),
        fields: []
      })
    }
  ];
  // 🔗 البطاقات التي صارت داخل بطاقة أمرها: تُجمع باسم الأمر لتُحقن هناك مرة
  // واحدة، فلا يظهر الأمر في بطاقتين (بطاقة صلاحية + بطاقة أمر) كما كان.
  const mergedPermissionBlocks = {};
  for (const card of permissionCardList) {
    if (!card.mergeInto) continue;
    (mergedPermissionBlocks[card.mergeInto] = mergedPermissionBlocks[card.mergeInto] || [])
      .push({ title: card.blockTitle || card.title, body: card.body });
  }
  const renderMergedPermissionBlocks = name => (mergedPermissionBlocks[name] || []).map(block => `
              <div class="merged-permission">
                <h3 class="merged-permission-title">${escapeHtml(block.title)}</h3>
                ${block.body}
              </div>`).join('');
  const permissionCardSelection = sortByName(permissionCardList.filter(card => !card.ticketOnly && !card.mergeInto), card => card.title);
  const permissionCards = permissionCardSelection.map(card => card.html).join('\n');

  const slashCardEntries = sortByName(
      slashCommandData.filter(command => !COMMANDS_WITH_CUSTOM_CARDS.has(command.name)
        && !getSlashCommandCategories(command.name).includes('tickets')),
      command => command.name
    )
    .map(command => {
    const settings = slashConfig.commands[command.name];
    const subcommandNames = (command.options || []).filter(option => option.type === 1).map(option => option.name);
    const syntax = subcommandNames.length ? `/${command.name} ${subcommandNames.join('|')}` : `/${command.name}`;
    // 🔁 الأوامر القديمة التي يغطّيها هذا الأمر — تُعرض في البطاقة حتى يعرف
    // المستخدم أين ذهب أمره القديم بدل أن يظنه حُذف.
    const LEGACY_EQUIVALENTS = {
      time: ['!timeout'],
      untime: ['!untimeout'],
      mute: ['!mute', '!كتم-كتابي', '!كتم-صوتي'],
      unmute: ['!unmute', '!فك-كتم-كتابي', '!فك-كتم-صوتي'],
      top: ['!توب', '!توب-يومي', '!توب-اسبوعي', '!توب-شهري'],
      profile: ['!اكسبي', '!رتبتي', '!rank'],
      role: ['!رتبة', '!شرتبة', '!رول'],
      ticket: ['!close', '!save', '!delete', '!add', '!remove', '!rename'],
      channel: ['!اضافة', '!كتابة', '!r', '!ضريبة', '!اقتراحات'],
      botstatus: ['!الحالة', '!الحالة2'],
      logchannel: ['!logowner'],
      clan: ['!كلان', '!تقديم-كلان'],
      myinfo: ['!معلوماتي'],
      claimstats: ['!اضافة-استلام-اداري', '!سحب-استلام-اداري', '!تصفير-استلام-اداري', '!تصفير-الكل-استلام-اداري',
                   '!اضافة-استلام-وسيط', '!سحب-استلام-وسيط', '!تصفير-استلام-وسيط', '!تصفير-الكل-استلام-وسيط',
                   '!تصفير-استلام', '!تصفير-الكل-استلام'],
      xpmanage: ['!اضافة-اكسبي', '!سحب-اكسبي', '!اضافة-اكسبي-يومي', '!سحب-اكسبي-يومي',
                 '!اضافة-اكسبي-اسبوعي', '!سحب-اكسبي-اسبوعي', '!اضافة-اكسبي-شهري', '!سحب-اكسبي-شهري']
    };
    const legacyList = LEGACY_EQUIVALENTS[command.name] || [];
    const legacy = legacyList.join(' / ');
    // نص البحث يجمع الاسم والوصف والاختصارات حتى يجدها البحث السريع بأي صيغة
    const searchHaystack = [command.name, command.description, syntax, ...(settings.aliases || []), legacy || '']
      .filter(Boolean).join(' ');
    return { section: sectionOf(command.name), html: `
      <section class="card cmd-card" data-command-categories="${escapeHtml(sectionOf(command.name))}" data-slash-command="${escapeHtml(command.name)}" data-command-kind="slash" data-command-state="${settings.enabled ? 'on' : 'off'}" data-command-search-text="${escapeHtml(searchHaystack)}">
        <header class="card-head">
          <button class="command-toggle" type="button" data-command-toggle aria-expanded="false" aria-controls="slash-command-${escapeHtml(command.name)}-panel">
            <span class="command-info">
              <span class="command-title">
                <span class="state-dot ${settings.enabled ? 'is-on' : 'is-off'}" title="${settings.enabled ? 'الأمر مفعّل' : 'الأمر متوقف'}" aria-hidden="true"></span>
                <span class="cmd-name">${escapeHtml(command.name)}</span>
                <span class="cmd-section-chip" data-section="${sectionOf(command.name)}">${SECTION_META[sectionOf(command.name)].emoji} ${SECTION_META[sectionOf(command.name)].label}</span>
              </span>
              <span class="cmd-forms">
                <code class="form-slash">${escapeHtml(syntax)}</code>
                ${(settings.aliases || []).length ? `<span class="form-more" title="${escapeHtml((settings.aliases || []).join('  '))}">+${(settings.aliases || []).length} اختصار</span>` : ''}
              </span>
              <span class="command-description">${escapeHtml(command.description || 'أمر سلاش')}</span>
            </span>
            <span class="command-trailing"><span class="command-arrow" aria-hidden="true">⌄</span></span>
          </button>
        </header>
        <div class="settings-accordion" id="slash-command-${escapeHtml(command.name)}-panel" aria-hidden="true" inert>
          <div class="settings-accordion-inner">
            <form action="/save-slash-command/${escapeHtml(command.name)}" method="POST">
            <div class="form"><div class="grid">
              <div>
                <label for="slash-enabled-${escapeHtml(command.name)}">حالة الأمر</label>
                <div class="toggle"><input id="slash-enabled-${escapeHtml(command.name)}" type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}><span>تفعيل /${escapeHtml(command.name)}</span></div>
                <p class="help">عند التعطيل يتوقف الأمر واختصاراته المجرّدة.</p>
              </div>
              <div>
                <label>اختصارات تُكتب مجرّدة (بدون بريفكس)</label>
                ${renderModerationAliasEditor(`slash-${command.name}`, 'aliases', command.name, settings.aliases)}
                <p class="help">أي حرف أو رمز حتى 32 حرفاً، ويعمل كما كتبته: مجرّداً أو بـ <code>!</code> أو بـ <code>$</code> — وحتى كلمتين. يُرفض في حالتين فقط: أن يكون مستخدماً في أمر آخر، أو أن يزيد عن 32 حرفاً.</p>
                ${command.name === 'role' ? `<label>اختصارات أمر /role give (تُكتب مجرّدة)</label>${renderModerationAliasEditor('slash-role-give', 'giveAliases', 'role-give', settings.giveAliases || [])}<label>اختصارات أمر /role remove (تُكتب مجرّدة)</label>${renderModerationAliasEditor('slash-role-remove', 'removeAliases', 'role-remove', settings.removeAliases || [])}` : ''}
              </div>
              <div>
                <label>الرولات المسموح لها باستخدام الأمر</label>
                ${renderRolePicker('allowedRoleIds', `slash-${command.name}-roles`, settings.roleIds.join(','))}
                <p class="help">عند تحديد رولات تصبح هي المسموح لها (مع مالك السيرفر وصلاحية Administrator). وتظل صلاحيات البوت وترتيب الرتب مطبقة.</p>
              </div>
              <div>
                <label for="slash-users-${escapeHtml(command.name)}">آيديات أشخاص مسموح لهم (اختياري)</label>
                <input id="slash-users-${escapeHtml(command.name)}" type="text" name="allowedUserIds" value="${escapeHtml(settings.userIds.join(', '))}" placeholder="آيدي شخص أو أكثر، مفصولة بفواصل">
                <p class="help">يمكن إضافة أشخاص مباشرة إلى جانب الرولات.</p>
              </div>
              ${command.name === 'clear' ? `<div><label for="slash-clear-cleanup">تنظيف رسالة الأمر والتأكيد</label><select id="slash-clear-cleanup" name="clearCleanupMode"><option value="both" ${commandPermissions.clear_cleanup_mode === 'both' ? 'selected' : ''}>رسالة الأمر والتأكيد</option><option value="bot_only" ${!commandPermissions.clear_cleanup_mode || commandPermissions.clear_cleanup_mode === 'bot_only' ? 'selected' : ''}>تأكيد البوت فقط</option><option value="user_only" ${commandPermissions.clear_cleanup_mode === 'user_only' ? 'selected' : ''}>رسالة الأمر فقط</option><option value="none" ${commandPermissions.clear_cleanup_mode === 'none' ? 'selected' : ''}>لا تحذف أياً منهما</option></select></div>` : ''}
            </div><div class="actions"><button type="submit">حفظ إعدادات /${escapeHtml(command.name)} 💾</button><a class="back" href="/dashboard">العودة للوحة التحكم</a></div></div>
            </form>
${renderMergedPermissionBlocks(command.name)}
          </div>
        </div>
      </section>
    ` };
  });
  // 🔢 مصدر واحد للأعداد: تُحسب من البطاقات المعروضة نفسها — كل بطاقة في قسم
  // واحد، فمجموع الأقسام يساوي تبويب «كل الأوامر» دائماً بلا تكرار ولا نقص.
  const sectionCounts = new Map();
  const addSectionCount = (slug, count) => sectionCounts.set(slug, (sectionCounts.get(slug) || 0) + count);
  slashCardEntries.forEach(entry => addSectionCount(entry.section, 1));
  addSectionCount('custom', customCardList.length);
  addSectionCount('system', permissionCardSelection.length);
  const sectionCount = slug => sectionCounts.get(slug) || 0;
  const allCardsCount = [...sectionCounts.values()].reduce((total, count) => total + count, 0);
  // 🟢 حالة التشغيل تُقرأ من البطاقات المعروضة نفسها (لا رقم مكتوب يدوياً)،
  // فلا يظهر «0» في الترويسة لحظة ثم يقفز بعد تشغيل السكربت.
  const renderedCardsHTML = customCommandCards + permissionCards + slashCardEntries.map(entry => entry.html).join('');
  const onCardsCount = (renderedCardsHTML.match(/data-command-state="on"/g) || []).length;
  // 🗂️ التبويبات بترتيب الأقسام الظاهرة أمام المستخدم: المخصّصة ثم الصلاحية العامة ثم أقسام السلاش.
  const TAB_SECTIONS = ['custom', 'system', ...SECTION_ORDER].filter(slug => sectionCount(slug) > 0);

  const slashCommandSections = SECTION_ORDER.map(slug => {
    const cards = slashCardEntries.filter(entry => entry.section === slug);
    if (!cards.length) return '';
    const meta = SECTION_META[slug];
    return `
        <section class="group group--section" data-command-group data-category-section="${slug}">
          <div class="group-head">
            <h2>${meta.emoji} ${meta.label}</h2>
            <span class="group-count" data-group-count>${cards.length} أمر</span>
            <span class="rule"></span>
          </div>
          <div class="card-grid">
${cards.map(card => card.html).join('')}
          </div>
        </section>`;
  }).filter(Boolean).join('\n');

  const savedSlashName = typeof req.query.saved === 'string' && req.query.saved.startsWith('slash-')
    ? req.query.saved.slice('slash-'.length)
    : '';
  const savedNotice = req.query.saved === 'tax'
    ? '<div class="notice">✅ تم حفظ إعدادات أمر الضريبة وتطبيقها مباشرة.</div>'
    : req.query.saved === 'come'
      ? '<div class="notice">✅ تم حفظ إعدادات أمر الاستدعاء وتطبيقها مباشرة.</div>'
      : req.query.saved === 'say'
        ? '<div class="notice">✅ تم حفظ إعدادات أمر التحدث وتطبيقها مباشرة.</div>'
        : req.query.saved === 'close'
          ? '<div class="notice">✅ تم حفظ إعدادات أمر إغلاق التذكرة وتطبيقها مباشرة.</div>'
          : req.query.saved === 'permissions'
            ? '<div class="notice">✅ تم حفظ صلاحيات الأوامر وتطبيقها مباشرة.</div>'
            : SLASH_COMMAND_NAMES.includes(savedSlashName)
              ? `<div class="notice">✅ تم حفظ إعدادات <code>/${escapeHtml(savedSlashName)}</code> وحده وتطبيقها مباشرة.</div>`
              : req.query.saved === 'slash'
                ? '<div class="notice">✅ تم حفظ إعدادات أمر السلاش المحدد واختصاراته المجرّدة.</div>'
                : '';

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>إدارة الأوامر</title>
      <style>
        /* ================================================================
           🎨 صفحة إدارة الأوامر
           مبنية على هوية اللوحة البرونزية الداكنة نفسها (site-luxe-theme)
           حتى لا تتصادم لوحتا ألوان في صفحة واحدة.
           • كل المتغيرات مسبوقة بـ --cp- حتى لا تتعارض مع متغيرات الثيم العام.
           • القواعد الخاصة بالصفحة مُقيّدة بـ .commands-page لترجّح على الثيم العام
             الذي يُحقَن بعد هذه الكتلة في <head>.
           ================================================================ */
        .commands-page {
          --cp-surface: rgba(19,20,25,.96);
          --cp-surface-2: #1b1c22;
          --cp-surface-3: #22232b;
          --cp-sunken: #0e0f13;
          --cp-line: #292a33;
          --cp-line-soft: #232430;
          --cp-text: #f2f2f6;
          --cp-dim: #a3a4af;
          --cp-faint: #7e7f8b;
          --cp-accent: #a475f0;
          --cp-accent-2: #834dd9;
          --cp-accent-deep: #5627a1;
          --cp-ok: #7fbf8f;
          --cp-off: #6c6d78;
          --cp-danger: #e08c8c;
          --cp-radius: 14px;
          --cp-radius-sm: 10px;
          --cp-shadow: 0 14px 38px rgba(0,0,0,.26);
          --cp-ring: 0 0 0 3px rgba(127,66,226,.26);
          max-width: 1180px; margin: auto; padding: 26px 20px 90px;
        }

        /* ---------------- ترويسة الصفحة ---------------- */
        .commands-page .page-head { margin-bottom: 18px; }
        .commands-page .eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .09em; }
        .commands-page h1 { margin: 6px 0 8px; font-size: 29px; font-weight: 800; letter-spacing: -.01em; }
        .commands-page .intro { max-width: 72ch; margin: 0; line-height: 1.8; }

        .commands-page .stat-strip { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 16px; }
        .commands-page .stat {
          display: inline-flex; align-items: baseline; gap: 8px;
          padding: 8px 14px; border: 1px solid var(--cp-line-soft);
          border-radius: 999px; background: var(--cp-sunken);
        }
        .commands-page .stat b { font-size: 16px; color: var(--cp-accent); font-variant-numeric: tabular-nums; }
        .commands-page .stat span { color: var(--cp-faint); font-size: 12.5px; }
        .commands-page .notice { margin: 16px 0 0; padding: 12px 16px; border-radius: var(--cp-radius-sm); line-height: 1.7; }

        /* ---------------- شريط الأدوات اللاصق ---------------- */
        .commands-page .toolbar {
          position: sticky; top: 10px; z-index: 20;
          margin-top: 18px; padding: 11px;
          border: 1px solid var(--cp-line); border-radius: var(--cp-radius);
          background: rgba(16,17,22,.97); box-shadow: var(--cp-shadow);
          backdrop-filter: blur(16px);
        }
        .commands-page .toolbar-row { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
        .commands-page .toolbar-row + .toolbar-row { margin-top: 9px; }

        .commands-page .search-field { position: relative; flex: 1 1 290px; min-width: 0; }
        .commands-page .search-field input { width: 100%; min-height: 44px; padding: 10px 40px 10px 38px; }
        .commands-page .search-field input:focus { box-shadow: var(--cp-ring); }
        .commands-page .search-icon { position: absolute; top: 50%; right: 13px; transform: translateY(-50%); color: var(--cp-faint); font-size: 14px; pointer-events: none; }
        .commands-page .search-clear {
          position: absolute; top: 50%; left: 7px; transform: translateY(-50%);
          min-width: 0; padding: 4px 8px; border: 0; border-radius: 7px;
          background: transparent !important; color: var(--cp-faint) !important;
          font-size: 16px; line-height: 1; box-shadow: none !important;
        }
        .commands-page .search-clear:hover { background: var(--cp-surface-3) !important; color: var(--cp-text) !important; }
        .commands-page .search-clear[hidden] { display: none; }

        /* مجموعة أزرار نوع الأمر */
        .commands-page .segmented { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--cp-line); border-radius: var(--cp-radius-sm); background: var(--cp-sunken); }
        .commands-page .segmented button {
          padding: 8px 14px; border: 0; border-radius: 7px;
          background: transparent !important; color: var(--cp-dim) !important;
          font: inherit; font-size: 13.5px; font-weight: 700; box-shadow: none !important;
          transition: background .18s ease, color .18s ease;
        }
        .commands-page .segmented button::after { display: none !important; }
        .commands-page .segmented button:hover { background: var(--cp-surface-2) !important; color: var(--cp-text) !important; transform: none; }
        .commands-page .segmented button.is-active {
          background: linear-gradient(135deg, rgba(86,39,161,.55), rgba(127,66,226,.28)) !important;
          color: #e1d0fd !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.07) !important;
        }

        /* تبويبات التصنيف */
        .commands-page .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
        /* 🗂️ أقسام الأوامر: شبكة لكل قسم داخل إطار واحد، مع شارة ملوّنة للتصنيف */
        .commands-page .group--section { margin-top: 20px; padding-top: 4px; }
        .commands-page .group--section .group-head { margin-bottom: 10px; }
        .commands-page .group--section .group-head h2 { font-size: 17px; }
        .commands-page .cmd-section-chip {
          flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
          border: 1px solid var(--cp-line); background: var(--cp-surface-3); color: var(--cp-faint); white-space: nowrap;
        }
        .commands-page .cmd-section-chip[data-section="admin"] { border-color: rgba(239,68,68,.35); background: rgba(239,68,68,.12); color: #f0a1a1; }
        .commands-page .cmd-section-chip[data-section="owner"] { border-color: rgba(245,158,11,.38); background: rgba(245,158,11,.13); color: #f0c987; }
        .commands-page .cmd-section-chip[data-section="xp"] { border-color: rgba(34,197,94,.35); background: rgba(34,197,94,.12); color: #9fd9b4; }
        .commands-page .cmd-section-chip[data-section="services"] { border-color: rgba(56,189,248,.35); background: rgba(56,189,248,.12); color: #a4d6f5; }
        /* عند اختيار تصنيف من التبويبات: تُخفى عناوين الأقسام ويصير العرض شبكة واحدة نظيفة */
        .commands-page.is-category-filtered .group--section .group-head { display: none; }
        .commands-page.is-category-filtered .group--section { margin-top: 0; }

        .commands-page .category-tab {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 13px; border: 1px solid var(--cp-line-soft); border-radius: 999px;
          background: var(--cp-sunken); color: var(--cp-dim);
          font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer;
          transition: background .18s ease, color .18s ease, border-color .18s ease;
        }
        .commands-page .category-tab:hover { border-color: rgba(127,66,226,.32); background: var(--cp-surface-2); color: var(--cp-text); }
        .commands-page .category-tab.is-active { border-color: rgba(127,66,226,.45); background: rgba(71,31,136,.26); color: #d3b9fc; }
        .commands-page .category-count {
          display: inline-grid; place-items: center; min-width: 21px; height: 21px; padding: 0 6px;
          border-radius: 999px; background: rgba(255,255,255,.06);
          font-size: 11.5px; font-variant-numeric: tabular-nums;
        }
        .commands-page .category-tab.is-active .category-count { background: rgba(164,117,240,.18); }

        .commands-page .results-line {
          display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;
          margin: 13px 2px 2px; color: var(--cp-faint); font-size: 12.5px;
        }
        .commands-page .reset-filters {
          padding: 5px 12px; border: 1px solid var(--cp-line) !important; border-radius: 999px;
          background: transparent !important; color: var(--cp-dim) !important;
          font: inherit; font-size: 12.5px; box-shadow: none !important;
        }
        .commands-page .reset-filters::after { display: none !important; }
        .commands-page .reset-filters:hover { border-color: rgba(127,66,226,.5) !important; color: var(--cp-accent) !important; transform: none; }
        .commands-page .reset-filters[hidden] { display: none; }

        /* ---------------- مجموعات البطاقات ---------------- */
        .commands-page .group { margin-top: 26px; }
        .commands-page .group-head { display: flex; align-items: center; gap: 12px; margin: 0 2px 10px; }
        .commands-page .group-head h2 { margin: 0; font-size: 16px; font-weight: 800; white-space: nowrap; }
        .commands-page .group-head .rule { flex: 1; height: 1px; background: var(--cp-line); }
        .commands-page .group-head .group-count { color: var(--cp-faint); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .commands-page .group-hint { margin: 0 2px 13px; color: var(--cp-faint); font-size: 12.5px; line-height: 1.7; }

        /* شبكة البطاقات — تتكيّف تلقائياً مع عرض الشاشة */
        .commands-page .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(335px, 1fr)); gap: 12px; align-items: start; }

        /* ---------------- البطاقة ---------------- */
        .commands-page .cmd-card { border-radius: var(--cp-radius); overflow: hidden; }
        /* البطاقة المفتوحة تمتد على عرض الشبكة كاملاً لتريح العين أثناء التعديل */
        .commands-page .cmd-card.is-open { grid-column: 1 / -1; border-color: rgba(127,66,226,.42) !important; box-shadow: var(--cp-shadow); }
        .commands-page .card-head { padding: 0; border: 0 !important; }
        .commands-page .command-toggle {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
          width: 100%; padding: 14px 16px; border: 0; border-radius: var(--cp-radius);
          background: transparent; color: inherit; font: inherit; text-align: right; cursor: pointer;
        }
        .commands-page .command-toggle:hover { transform: none; background: rgba(255,255,255,.015); }
        .commands-page .command-info { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
        .commands-page .command-title { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; row-gap: 4px; font-size: 15.5px; font-weight: 800; }
        .commands-page .cmd-name { overflow-wrap: anywhere; }
        /* نقطة الحالة تُظهر إن كان الأمر مفعّلاً دون الحاجة لفتح البطاقة */
        .commands-page .state-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
        .commands-page .state-dot.is-on { background: var(--cp-ok); box-shadow: 0 0 0 3px rgba(127,191,143,.15); }
        .commands-page .state-dot.is-off { background: var(--cp-off); box-shadow: 0 0 0 3px rgba(108,109,120,.15); }

        /* صيغة استدعاء الأمر: شارة السلاش فقط (البريفكس انتهى) */
        .commands-page .cmd-forms { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .commands-page .cmd-forms code {
          padding: 3px 9px; border-radius: 7px; font-size: 12px;
          font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
          direction: ltr; unicode-bidi: isolate; white-space: nowrap;
        }
        .commands-page .form-slash { border: 1px solid rgba(127,66,226,.34); background: rgba(71,31,136,.20); color: #c4a2fb !important; }
        .commands-page .form-more { padding: 3px 9px; border: 1px solid var(--cp-line); border-radius: 7px; background: var(--cp-surface-3); color: var(--cp-faint); font-size: 11.5px; cursor: help; }
        .commands-page .command-description { font-size: 13px; font-weight: 400; line-height: 1.65; }
        .commands-page .command-trailing { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding-top: 2px; }
        .commands-page .command-arrow { display: inline-block; font-size: 22px; line-height: 1; transition: transform .3s ease; }
        .commands-page .command-toggle[aria-expanded="true"] .command-arrow { transform: rotate(180deg); }

        .commands-page .settings-accordion { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .36s ease, opacity .26s ease; }
        .commands-page .settings-accordion.is-open { grid-template-rows: 1fr; opacity: 1; }
        .commands-page .settings-accordion-inner { min-height: 0; overflow: hidden; }

        /* ---------------- النماذج ---------------- */
        .commands-page .form { padding: 2px 16px 18px; border-top: 1px solid var(--cp-line-soft); }
        .commands-page .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(265px, 1fr)); gap: 15px; margin-top: 15px; }
        .commands-page label { display: block; margin: 0 0 6px; font-size: 13px; }
        .commands-page input, .commands-page select, .commands-page textarea {
          width: 100%; padding: 10px 12px; border-radius: var(--cp-radius-sm); font: inherit; font-size: 14px;
        }
        .commands-page input:focus, .commands-page select:focus, .commands-page textarea:focus { box-shadow: var(--cp-ring); }
        .commands-page textarea { resize: vertical; line-height: 1.7; min-height: 86px; }
        .commands-page input[type=color] { height: 42px; padding: 4px; cursor: pointer; }
        .commands-page .help { margin: 6px 0 0; font-size: 12px; line-height: 1.65; }
        .commands-page .toggle { display: flex; align-items: center; gap: 10px; min-height: 42px; color: var(--cp-dim); font-size: 13.5px; }
        .commands-page .toggle input { width: 18px; height: 18px; accent-color: var(--cp-accent-deep); }
        .commands-page .section-title { margin: 22px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--cp-line); font-size: 14.5px; }
        /* 🔗 كتل الصلاحيات المدمجة داخل بطاقة الأمر: فاصل واضح بلا بطاقة مكرّرة */
        .commands-page .merged-permission { margin-top: 20px; padding-top: 16px; border-top: 1px dashed var(--cp-line); }
        .commands-page .merged-permission-title { margin: 0 0 10px; font-size: 14px; color: #f0c987; }
        .commands-page .merged-permission .actions { margin-top: 10px; }
        .commands-page .permission-description { margin: 0 0 10px; }
        .commands-page .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 13px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--cp-line-soft); }
        .commands-page .muted { font-size: 13px; }

        /* محرّر الاختصارات ومنتقي الرتب */
        /* ⚡ سلاسة التحكم: كل عنصر تفاعلي يستجيب فوراً وبحركة قصيرة، فلا
           يكون التفاعل جافاً. كل الحركات ≤ ٠٫٢ ثانية حتى لا تشعر بالبطء. */
        .commands-page .cmd-card { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
        .commands-page .cmd-card:hover { transform: translateY(-2px); }
        .commands-page .category-tab { transition: background-color .16s ease, color .16s ease, transform .12s ease; }
        .commands-page .category-tab:active { transform: scale(.97); }
        .commands-page .alias-chip, .commands-page .role-chip {
          animation: cp-chip-in .18s ease-out both;
          transition: background-color .15s ease, border-color .15s ease;
        }
        @keyframes cp-chip-in { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: scale(1); } }
        .commands-page button, .commands-page .kind-tab, .commands-page .category-tab { cursor: pointer; }
        .commands-page input, .commands-page select, .commands-page textarea {
          transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease;
        }
        .commands-page input:focus, .commands-page select:focus, .commands-page textarea:focus {
          outline: none; box-shadow: var(--cp-ring); border-color: var(--cp-accent);
        }
        .commands-page .settings-accordion { transition: max-height .22s ease, opacity .18s ease; }
        /* من يفضّل بلا حركة (أو يحتاجها لأسباب صحية) يحصل على ذلك فوراً */
        @media (prefers-reduced-motion: reduce) {
          .commands-page *, .commands-page *::before, .commands-page *::after {
            animation-duration: .001ms !important; animation-iteration-count: 1 !important;
            transition-duration: .001ms !important; scroll-behavior: auto !important;
          }
          .commands-page .cmd-card:hover { transform: none; }
        }
        .commands-page .alias-editor, .commands-page .role-picker { display: flex; flex-direction: column; gap: 9px; padding: 10px; border-radius: var(--cp-radius-sm); }
        .commands-page .alias-chips, .commands-page .role-chips { display: flex; flex-wrap: wrap; gap: 7px; min-height: 8px; }
        .commands-page .alias-chip, .commands-page .role-chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 999px; font-size: 12.5px; }
        .commands-page .alias-chip button, .commands-page .role-chip button { margin: 0; padding: 0 2px; border: 0; background: transparent !important; color: inherit !important; font-size: 17px; line-height: 1; opacity: .7; box-shadow: none !important; }
        .commands-page .alias-chip button:hover, .commands-page .role-chip button:hover { color: var(--cp-danger) !important; opacity: 1; }
        .commands-page .alias-entry, .commands-page .role-select-row { display: flex; gap: 8px; }
        .commands-page .alias-entry .alias-input, .commands-page .role-select-row select { flex: 1; min-width: 0; }
        .commands-page .alias-add, .commands-page .role-add { flex: 0 0 auto; width: auto; padding: 9px 15px; white-space: nowrap; }
        .commands-page .alias-error { min-height: 0; margin: 0; color: var(--cp-danger); font-size: 12px; }
        .commands-page .role-picker-help { margin: 0; color: var(--cp-faint); font-size: 12px; line-height: 1.6; }

        /* حالة «لا نتائج» */
        .commands-page .empty-state { display: none; margin-top: 22px; padding: 44px 20px; border: 1px dashed var(--cp-line); border-radius: var(--cp-radius); background: var(--cp-sunken); text-align: center; color: var(--cp-dim); }
        .commands-page .empty-state.is-visible { display: block; }
        .commands-page .empty-state strong { display: block; margin-bottom: 6px; color: var(--cp-text); font-size: 16px; }

        .commands-page .next { margin-top: 26px; padding: 16px 19px; border: 1px dashed var(--cp-line); border-radius: var(--cp-radius); color: var(--cp-faint); font-size: 13px; line-height: 1.8; }
        .commands-page .category-hidden { display: none !important; }

        /* زر العودة لأعلى الصفحة */
        .to-top {
          position: fixed; bottom: 22px; left: 22px; z-index: 25;
          display: grid; place-items: center; width: 44px; height: 44px; padding: 0;
          border: 1px solid #292a33 !important; border-radius: 50%;
          background: rgba(19,20,25,.96) !important; color: #a475f0 !important;
          font-size: 18px; box-shadow: 0 14px 38px rgba(0,0,0,.3) !important;
          opacity: 0; pointer-events: none; transform: translateY(8px);
          transition: opacity .25s ease, transform .25s ease;
        }
        .to-top::after { display: none !important; }
        .to-top.is-visible { opacity: 1; pointer-events: auto; transform: translateY(0); }

        @media (max-width: 760px) {
          .commands-page { padding: 18px 13px 80px; }
          .commands-page h1 { font-size: 23px; }
          .commands-page .toolbar { top: 6px; padding: 9px; }
          .commands-page .card-grid { grid-template-columns: 1fr; }
          .commands-page .tabs { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 3px; scrollbar-width: thin; }
          .commands-page .category-tab { flex: 0 0 auto; }
          .commands-page .segmented { width: 100%; }
          .commands-page .segmented button { flex: 1; padding: 8px 6px; font-size: 12.5px; }
          .commands-page .actions { flex-direction: column; align-items: stretch; }
          .to-top { bottom: 14px; left: 14px; }
        }

        /* ====== 💾 شريط الحفظ الموحّد ====== */
        .save-bar {
          position: fixed; inset-inline: 0; bottom: 0; z-index: 60;
          padding: 12px clamp(12px, 4vw, 28px) calc(12px + env(safe-area-inset-bottom, 0px));
          background: linear-gradient(to top, var(--ink) 55%, color-mix(in srgb, var(--ink) 70%, transparent));
          border-top: 1px solid var(--stroke);
          backdrop-filter: blur(10px);
          animation: save-bar-in .22s ease-out;
        }
        .save-bar[hidden] { display: none; }
        @keyframes save-bar-in { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .save-bar-inner {
          max-width: 1180px; margin: 0 auto;
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        }
        .save-bar-spacer { flex: 1 1 auto; }
        .save-bar-dot {
          width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto;
          background: var(--accent-soft);
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-soft) 70%, transparent);
          animation: save-bar-pulse 2s ease-out infinite;
        }
        @keyframes save-bar-pulse {
          70% { box-shadow: 0 0 0 7px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .save-bar-text { font-size: 13.5px; font-weight: 600; color: var(--text); }
        .save-bar-build {
          font: 600 11px/1 ui-monospace, monospace; color: var(--muted);
          border: 1px solid var(--stroke); border-radius: 6px; padding: 5px 8px; letter-spacing: .5px;
        }
        .save-bar button {
          font: inherit; font-weight: 700; font-size: 13.5px; cursor: pointer;
          padding: 9px 20px; border-radius: 10px; border: 1px solid transparent;
          transition: transform .14s ease, filter .14s ease, background .14s ease;
        }
        .save-bar button:disabled { opacity: .6; cursor: progress; }
        .save-bar button:not(:disabled):hover { transform: translateY(-1px); filter: brightness(1.08); }
        .save-bar button:not(:disabled):active { transform: translateY(0); }
        .save-bar-cancel {
          background: transparent; color: var(--muted); border-color: var(--stroke);
        }
        .save-bar-cancel:not(:disabled):hover { color: var(--text); background: var(--surface-raised); }
        .save-bar-save {
          background: linear-gradient(135deg, var(--accent), var(--accent-deep));
          color: #fff;
          box-shadow: 0 6px 18px -6px color-mix(in srgb, var(--accent) 75%, transparent);
        }
        .save-bar.is-busy .save-bar-dot { animation: none; background: var(--muted); }
        .save-bar.is-done { border-top-color: #2f7d55; }
        .save-bar.is-done .save-bar-dot { animation: none; background: #3fa86f; }
        .save-bar.is-error { border-top-color: #8c3b4a; }
        .save-bar.is-error .save-bar-dot { animation: none; background: #d4687c; }
        .save-bar.is-error .save-bar-text { color: #f0b8c2; }

        /* البطاقة المعدَّلة تُعلَّم بخط جانبي حتى يعرف المستخدم أين تغييراته */
        .cmd-card.is-dirty {
          border-color: color-mix(in srgb, var(--accent) 55%, var(--stroke));
          box-shadow: inset 3px 0 0 0 var(--accent);
        }

        /* الشريط يحجب أسفل الصفحة، فنرفع زر «أعلى» فوقه */
        body:has(.save-bar:not([hidden])) .to-top { bottom: 78px; }
        body:has(.save-bar:not([hidden])) { padding-bottom: 74px; }

        @media (max-width: 720px) {
          .save-bar-text { flex: 1 1 100%; order: -1; }
          .save-bar button { flex: 1 1 auto; }
        }
        @media (prefers-reduced-motion: reduce) {
          .commands-page .command-arrow, .commands-page .settings-accordion, .to-top { transition: none !important; }
          .save-bar, .save-bar-dot { animation: none !important; }
        }
      </style>
    </head>
    <body>
      <nav>
        <div>
          <a href="/dashboard">الرئيسية 🏠</a>
          <a href="/commands">إدارة الأوامر ⚡</a>
        </div>
        <a href="/logout" style="color:#f87171">تسجيل الخروج 🚪</a>
      </nav>
      <main class="wrap commands-page">
        <header class="page-head">
          <div class="eyebrow">COMMAND CENTER</div>
          <h1>إدارة أوامر البوت</h1>
          <p class="intro">كل أوامر البوت في مكان واحد. <strong>كل الأوامر تعمل بالسلاش <code>/</code></strong> — وأوامر التكت وحدها تبقى بالبريفكس <code>!</code>. كل بطاقة تعرض صيغة الأمر، والاختصار المجرّد (بلا بريفكس) يعمل أيضاً. استخدم البحث أو التصنيفات للوصول للأمر بسرعة، ثم اضغط على البطاقة لفتح إعداداتها. تُحفظ التغييرات فوراً دون إعادة تشغيل البوت.</p>
          <div class="stat-strip">
            <span class="stat"><b data-stat-total>${allCardsCount}</b><span>أمر قابل للتحكم</span></span>
            <span class="stat"><b data-stat-on>${onCardsCount}</b><span>مُفعَّل</span></span>
            <span class="stat"><b data-stat-off>${allCardsCount - onCardsCount}</b><span>متوقف</span></span>
            <span class="stat"><b>سلاش /</b><span>لكل أمر · والتكت !</span></span>
          </div>
        </header>
        <div class="notice">✨ <strong>جديد:</strong> صارت كل الأوامر تعمل بالسلاش فقط عبر <code>/</code> — وتُستثنى أوامر التكت وحدها فتبقى بالبريفكس <code>!</code> كما هي. <a href="/commands-list">افتح دليل الأوامر العام</a> للتفاصيل.</div>
        ${savedNotice}

        <!-- شريط الأدوات: بحث + نوع الأمر + التصنيفات. يبقى ظاهراً أثناء التمرير -->
        <div class="toolbar">
          <div class="toolbar-row">
            <div class="search-field">
              <span class="search-icon" aria-hidden="true">🔍</span>
              <label for="commandSearch" class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">بحث سريع عن أمر</label>
              <input id="commandSearch" type="search" data-command-search autocomplete="off"
                     placeholder="ابحث باسم الأمر أو وصفه أو اختصاره… مثال: حظر، mute، إغلاق">
              <button type="button" class="search-clear" data-search-clear hidden aria-label="مسح البحث">✕</button>
            </div>
            <div class="segmented" role="group" aria-label="نوع صيغة الأمر">
              <button type="button" class="is-active" data-kind-filter="all">الكل</button>
              <button type="button" data-kind-filter="slash">سلاش /</button>
              <button type="button" data-kind-filter="custom">مخصّصة</button>
              <button type="button" data-kind-filter="system">صلاحيات</button>
            </div>
          </div>
          <div class="toolbar-row">
            <div class="tabs" role="tablist" aria-label="تصنيفات الأوامر">
              <button class="category-tab is-active" type="button" role="tab" aria-selected="true" data-category-filter="all">
                كل الأوامر <span class="category-count" data-category-count>${allCardsCount}</span>
              </button>
${TAB_SECTIONS.map(slug => `              <button class="category-tab" type="button" role="tab" aria-selected="false" data-category-filter="${slug}">
                ${SECTION_META[slug].emoji} ${SECTION_META[slug].label} <span class="category-count" data-category-count>${sectionCount(slug)}</span>
              </button>`).join('\n')}
            </div>
          </div>
        </div>

        <div class="results-line">
          <span data-category-results aria-live="polite"></span>
          <button type="button" class="reset-filters" data-reset-filters hidden>إعادة ضبط عوامل التصفية</button>
        </div>

        <div class="empty-state" data-empty-state>
          <strong>لا يوجد أمر مطابق</strong>
          جرّب كلمة بحث أقصر، أو اختر تصنيف «كل الأوامر».
        </div>

        <!-- 1) الأوامر المخصّصة ذات الإعدادات الخاصة -->
        <section class="group group--section" data-command-group data-category-section="custom">
          <div class="group-head">
            <h2>⚙️ أوامر مخصّصة بإعدادات خاصة</h2>
            <span class="group-count" data-group-count>${sectionCount('custom')} أمر</span>
            <span class="rule"></span>
          </div>
          <p class="group-hint">أوامر لها نصوص وألوان وخيارات تتحكم بها بالكامل من هنا.</p>
          <div class="card-grid">
        ${customCommandCards}
          </div>
        </section>

        <!-- 2) صلاحيات الأوامر والأنظمة -->
        <section class="group group--section" data-command-group data-category-section="system">
          <div class="group-head">
            <h2>🛡️ صلاحية الإدارة العامة</h2>
            <span class="group-count" data-group-count>${sectionCount('system')} أمر</span>
            <span class="rule"></span>
          </div>
          <p class="group-hint">صلاحية واحدة تتجاوز كل قيود الأوامر. أما صلاحيات كل نظام فأصبحت داخل بطاقة الأمر نفسه — بلا بطاقات مكرّرة.</p>
          <div class="card-grid">
        ${permissionCards}
          </div>
        </section>

        <!-- 3) أوامر السلاش -->
        <section class="group" data-command-group>
          <div class="group-head">
            <h2>⚡ أوامر السلاش</h2>
            <span class="rule"></span>
          </div>
          <p class="group-hint">كل أمر هنا يعمل بـ <code>/الأمر</code> (سلاش فقط)، ومرتّب داخل قسمه — ويمكنك تفعيله أو إيقافه وإضافة اختصارات مجرّدة له.</p>
${slashCommandSections}
        </section>
        <aside class="next">🧩 كل أوامر البوت وصلاحياتها مجمّعة في هذه الصفحة. اضغط <code>/</code> في أي وقت للانتقال إلى حقل البحث، و<code>Esc</code> لمسحه.</aside>
      </main>
      <button type="button" class="to-top" data-to-top aria-label="العودة إلى أعلى الصفحة">↑</button>

      <!-- 💾 شريط الحفظ الموحّد: يظهر عند أول تعديل ويحفظ كل الأوامر دفعة واحدة -->
      <div class="save-bar" data-save-bar data-disabled="${process.env.DASHBOARD_SAVE_BAR === 'off' ? '1' : '0'}" hidden role="status" aria-live="polite">
        <div class="save-bar-inner">
          <span class="save-bar-dot" aria-hidden="true"></span>
          <span class="save-bar-text" data-save-bar-text>لديك تغييرات غير محفوظة</span>
          <span class="save-bar-spacer"></span>
          <span class="save-bar-build" data-instance="${INSTANCE_ID}" title="بصمة النسخة العاملة على الخادم · معرّف العملية ${INSTANCE_ID}">${BUILD_ID}</span>
          <button type="button" class="save-bar-cancel" data-save-cancel>إلغاء التغييرات</button>
          <button type="button" class="save-bar-save" data-save-all>حفظ كل التغييرات</button>
        </div>
      </div>
      <script>
        // ====================================================================
        // 🚨 مُبلِّغ أخطاء مرئي
        //
        // سبب وجوده: خطأ واحد في هذا السكربت يُسقطه بالكامل، فتفتح الصفحة
        // وتبدو سليمة تماماً بينما لا يعمل فيها شيء — لا حفظ ولا بحث ولا
        // فلترة. وقع هذا فعلاً من قبل. وبلا متصفح أمام المطوّر يستحيل
        // معرفة السبب، فتتحول المعالجة إلى تخمين.
        //
        // الآن يظهر الخطأ على الشاشة بنصّه وموضعه، فتكفي صورة واحدة لتشخيصه.
        // يُسجَّل أولاً قبل أي شيفرة أخرى حتى يلتقط ما يقع بعده.
        // ====================================================================
        window.addEventListener('error', event => {
          try {
            let box = document.getElementById('js-error-box');
            if (!box) {
              box = document.createElement('div');
              box.id = 'js-error-box';
              box.setAttribute('style', 'position:fixed;top:0;inset-inline:0;z-index:9999;'
                + 'background:#7f1d2e;color:#ffe8ec;font:600 13px/1.6 system-ui,sans-serif;'
                + 'padding:10px 14px;direction:rtl;text-align:right;max-height:45vh;overflow:auto;'
                + 'box-shadow:0 6px 24px rgba(0,0,0,.5)');
              document.body.appendChild(box);
            }
            const where = (event.filename || 'الصفحة') + ':' + (event.lineno || '?');
            const item = document.createElement('div');
            item.textContent = '🚨 خطأ في سكربت الصفحة — ' + (event.message || 'غير معروف')
              + '  (' + where + ')';
            box.appendChild(item);
          } catch (ignored) { /* لا نُسقط الصفحة بسبب مُبلِّغ الأخطاء نفسه */ }
        });
      </script>
      <script>
        // 🗂️ فكّ قيمة الاختصارات: JSON (الصيغة الحالية) أو نص مفصول بفواصل (صيغة قديمة)
        function parseAliasValues(raw) {
          const text = String(raw || '').trim();
          if (text.startsWith('[')) {
            try {
              const parsed = JSON.parse(text);
              if (Array.isArray(parsed)) return parsed.map(String);
            } catch (ignored) { /* ليست JSON → نكمل بالصيغة القديمة */ }
          }
          return text.split(',').map(part => part.trim()).filter(Boolean);
        }

        // 🗺️ كل اختصار معروف في الصفحة → اسم صاحبه، لرسالة «مستخدم في … سابقاً»
        const aliasOwnerLabels = ${JSON.stringify(aliasOwnerLabels)};
        const aliasOwners = new Map();
        // 🔓 «!x» و«$x» و«x» اختصار واحد عند التشغيل، فيُحسبون هنا مالكاً
        // واحداً أيضاً — وإلا قَبِلت اللوحة اختصارين متصادمين فعلياً.
        const aliasCompareKeys = alias => {
          const key = String(alias || '').trim().toLowerCase();
          if (!key) return [];
          const bare = (key[0] === '!' || key[0] === '$') ? key.slice(1).trim() : key;
          return bare && bare !== key ? [key, bare] : [key];
        };
        const claimAliasOwner = (alias, label) => {
          for (const key of aliasCompareKeys(alias)) {
            if (!aliasOwners.has(key)) aliasOwners.set(key, label);
          }
        };
        for (const [name, label] of Object.entries(aliasOwnerLabels)) claimAliasOwner(name, label);
        document.querySelectorAll('[data-alias-editor]').forEach(editor => {
          const label = (editor.closest('.cmd-card')?.querySelector('.cmd-name')?.textContent || '').trim() || 'أمر آخر';
          parseAliasValues(editor.querySelector('[data-alias-values]')?.value).forEach(alias => claimAliasOwner(alias, label));
        });

        document.querySelectorAll('[data-alias-editor]').forEach(editor => {
          const aliasInput = editor.querySelector('[data-alias-input]');
          const aliasChips = editor.querySelector('[data-alias-chips]');
          const aliasValues = editor.querySelector('[data-alias-values]');
          const aliasError = editor.querySelector('[data-alias-error]');
          // 🔖 اسم هذا الأمر كما يظهر على بطاقته، ليُذكر في رسالة الرفض عند الحاجة
          const ownerLabel = (editor.closest('.cmd-card')?.querySelector('.cmd-name')?.textContent || '').trim()
            || (editor.getAttribute('data-canonical') || 'أمر آخر');
          let aliases = parseAliasValues(aliasValues.value);

          function renderAliases() {
            aliasChips.replaceChildren();
            aliases.forEach(alias => {
              const chip = document.createElement('span');
              chip.className = 'alias-chip';
              const label = document.createElement('span');
              label.textContent = alias;
              const remove = document.createElement('button');
              remove.type = 'button';
              remove.dataset.removeAlias = alias;
              remove.setAttribute('aria-label', 'إزالة الاختصار ' + alias);
              remove.textContent = '×';
              chip.append(label, remove);
              aliasChips.append(chip);
            });
            aliasValues.value = JSON.stringify(aliases);
            // الحقل المخفي يتغيّر برمجياً فلا يُطلق input تلقائياً؛
            // نُطلقه يدوياً ليعرف شريط الحفظ أن هناك تعديلاً.
            aliasValues.dispatchEvent(new Event('input', { bubbles: true }));
          }

          // عند «إلغاء التغييرات» يُعاد الحقل المخفي لقيمته الأصلية،
          // فنعيد رسم الرقائق منه حتى لا تبقى معروضة بعد التراجع.
          editor.closest('form')?.addEventListener('dashboard:restored', () => {
            aliases = parseAliasValues(aliasValues.value);
            renderAliases();
          });

          // قواعد الاختصارات في اللوحة — مطابقة تماماً لما يخزّنه الخادم
          // (aliasRules.js): أي نص مسموح حتى 32 حرفاً، مرفوضٌ في حالتين فقط:
          // الطول، أو أنه مستخدم مسبقاً في أمر آخر (وتُذكر اسم صاحبه).
          const ALIAS_MAX = 32;
          function aliasRejection(alias) {
            if (!alias) return 'اكتب اختصاراً أولاً.';
            if (Array.from(alias).length > ALIAS_MAX) {
              return 'الاختصار أطول من ' + ALIAS_MAX + ' حرفاً — اختصره.';
            }
            return null;
          }
          function addAlias() {
            const alias = aliasInput.value.trim().toLowerCase();
            if (alias.length > ALIAS_MAX * 4) { // نص أطول بكثير من الحد: نقصّه أولاً
              aliasInput.value = Array.from(alias).slice(0, ALIAS_MAX).join('');
            }
            const cleaned = aliasInput.value.trim().toLowerCase();
            const reason = aliasRejection(cleaned);
            if (reason) {
              aliasError.textContent = reason;
              return;
            }
            // 🚫 الحالة الوحيدة للرفض غير الطول: الاختصار مستخدم في أمر آخر.
            //    وتُذكر اسم صاحبه حتى يعرف المالك أين يُستخدم بدل التخمين.
            //    ⚠️ اسم الأمر نفسه ليس تعارضاً: «$help» على بطاقة help مقبول
            //    (اختصار المالك لاسم أمره)، فلا يُرفض المالك بسبب اسمه هو.
            const previousOwner = aliasCompareKeys(cleaned)
              .map(key => aliasOwners.get(key))
              .find(owner => owner && owner !== ownerLabel && owner !== '/' + ownerLabel);
            if (previousOwner) {
              aliasError.textContent = 'هذا الاختصار مستخدم في «' + previousOwner + '» سابقاً — اختر اسماً غيره.';
              return;
            }
            aliases.push(cleaned);
            claimAliasOwner(cleaned, ownerLabel);
            aliasInput.value = '';
            aliasError.textContent = '';
            renderAliases();
          }

          editor.querySelector('[data-alias-add]').addEventListener('click', addAlias);
          aliasInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); addAlias(); }
          });
          aliasChips.addEventListener('click', event => {
            const remove = event.target.closest('[data-remove-alias]');
            if (!remove) return;
            aliases = aliases.filter(alias => alias !== remove.dataset.removeAlias);
            // إزالة الاختصار تحرّره للأوامر الأخرى (بكل صيغه)
            for (const key of aliasCompareKeys(remove.dataset.removeAlias)) {
              if (aliasOwners.get(key) === ownerLabel) aliasOwners.delete(key);
            }
            aliasError.textContent = '';
            renderAliases();
          });
          // ⚠️ فخّ أوقع المستخدم فعلاً: من يكتب الاختصار في الخانة ثم يضغط
          //    «حفظ» مباشرة دون الضغط على Add كان نصّه يضيع بصمت، فيظن أن
          //    الحفظ معطوب بينما الاختصار لم يدخل النموذج أصلاً.
          //    الآن نُرحّل أي نص معلّق تلقائياً قبل الحفظ.
          function flushPendingAlias() {
            if (aliasInput.value.trim()) addAlias();
            renderAliases();
          }
          editor.closest('form').addEventListener('submit', flushPendingAlias);
        });

        document.querySelectorAll('[data-role-picker]').forEach(picker => {
          const chips = picker.querySelector('[data-role-chips]');
          const selector = picker.querySelector('[data-role-choice]');
          const values = picker.querySelector('[data-role-values]');
          const status = picker.querySelector('[data-role-error]');
          const selectedRoleIds = values.value.split(',').map(id => id.trim()).filter(Boolean);
          const labelById = new Map(Array.from(chips.querySelectorAll('[data-selected-role]')).map(chip => [chip.dataset.selectedRole, chip.querySelector('span').textContent]));

          function renderRoles() {
            chips.replaceChildren();
            selectedRoleIds.forEach(roleId => {
              const chip = document.createElement('span');
              chip.className = 'role-chip';
              const label = document.createElement('span');
              label.textContent = labelById.get(roleId) || 'رتبة محفوظة غير متاحة حالياً';
              const remove = document.createElement('button');
              remove.type = 'button';
              remove.dataset.removeRole = roleId;
              remove.setAttribute('aria-label', 'إزالة الرتبة ' + label.textContent);
              remove.textContent = '×';
              chip.append(label, remove);
              chips.append(chip);
            });
            values.value = selectedRoleIds.join(',');
            // الحقل المخفي يتغيّر برمجياً فلا يُطلق input تلقائياً؛ بدونه
            // لا يرصد شريط الحفظ تعديلات الرتب إطلاقاً.
            values.dispatchEvent(new Event('input', { bubbles: true }));
          }

          // ➕ إضافة الرتبة فور اختيارها: طلب المالك أن تكون النقرة وحدها كافية
          //    بدل «اختر ثم اضغط إضافة». زر الإضافة باقٍ لمن يفضّله.
          function addSelectedRole() {
            const roleId = selector.value;
            if (!roleId) return false;
            if (selectedRoleIds.includes(roleId)) {
              status.textContent = 'هذه الرتبة مضافة بالفعل.';
              selector.value = '';
              return false;
            }
            const option = selector.options[selector.selectedIndex];
            labelById.set(roleId, option.textContent);
            selectedRoleIds.push(roleId);
            selector.value = '';
            status.textContent = '';
            renderRoles();
            return true;
          }

          selector.addEventListener('change', () => { addSelectedRole(); });
          picker.querySelector('[data-role-add]').addEventListener('click', () => {
            if (!selector.value) {
              status.textContent = 'اختر رتبة من القائمة أولاً.';
              return;
            }
            addSelectedRole();
          });
          chips.addEventListener('click', event => {
            const remove = event.target.closest('[data-remove-role]');
            if (!remove) return;
            const index = selectedRoleIds.indexOf(remove.dataset.removeRole);
            if (index !== -1) selectedRoleIds.splice(index, 1);
            status.textContent = '';
            renderRoles();
          });
          // نفس فخّ الاختصارات: رتبة مختارة في القائمة ولم يُضغط لها «إضافة».
          function flushPendingRole() {
            const pending = selector.value;
            if (pending && !selectedRoleIds.includes(pending)) {
              const option = selector.options[selector.selectedIndex];
              if (option) labelById.set(pending, option.textContent);
              selectedRoleIds.push(pending);
              selector.value = '';
            }
            renderRoles();
          }
          picker.closest('form').addEventListener('submit', flushPendingRole);
        });

        // ================================================================
        // ⚡ فتح/إغلاق بطاقة الأمر
        // البطاقة المفتوحة تأخذ عرض الشبكة كاملاً (is-open) لتسهيل التعديل.
        // ================================================================
        document.querySelectorAll('[data-command-toggle]').forEach(commandToggle => {
          const commandSettings = document.getElementById(commandToggle.getAttribute('aria-controls'));
          if (!commandSettings) return;
          const card = commandToggle.closest('.cmd-card');
          commandToggle.addEventListener('click', () => {
            const shouldExpand = commandToggle.getAttribute('aria-expanded') !== 'true';
            commandToggle.setAttribute('aria-expanded', String(shouldExpand));
            commandSettings.classList.toggle('is-open', shouldExpand);
            commandSettings.setAttribute('aria-hidden', String(!shouldExpand));
            commandSettings.inert = !shouldExpand;
            if (card) card.classList.toggle('is-open', shouldExpand);
          });
        });

        // ================================================================
        // 🔎 التصفية: بحث نصي + نوع الأمر + التصنيف، تعمل مجتمعة
        // ================================================================
        const categoryByFormAction = ${JSON.stringify(FORM_ACTION_CATEGORIES)};
        const categoryCards = Array.from(document.querySelectorAll('.cmd-card'));
        const categoryTabs = Array.from(document.querySelectorAll('[data-category-filter]'));
        const kindButtons = Array.from(document.querySelectorAll('[data-kind-filter]'));
        const commandGroups = Array.from(document.querySelectorAll('[data-command-group]'));
        const categoryResults = document.querySelector('[data-category-results]');
        const commandSearch = document.querySelector('[data-command-search]');
        const searchClear = document.querySelector('[data-search-clear]');
        const resetFilters = document.querySelector('[data-reset-filters]');
        const emptyState = document.querySelector('[data-empty-state]');
        let activeCategory = 'all';
        let activeKind = 'all';

        // تجهيز بيانات كل بطاقة مرة واحدة (التصنيف + نص البحث) لتفادي إعادة الحساب
        categoryCards.forEach(card => {
          const action = card.querySelector('form')?.getAttribute('action') || '';
          const categories = card.dataset.commandCategories
            ? card.dataset.commandCategories.split(/\s+/).filter(Boolean)
            : (categoryByFormAction[action] || ['other']);
          card.dataset.commandCategories = categories.join(' ');
          // نص البحث: ما جهّزه الخادم + عنوان البطاقة وصيغها، لا محتوى النموذج كاملاً
          const head = card.querySelector('.command-info')?.textContent || '';
          card._searchText = ((card.dataset.commandSearchText || '') + ' ' + head).toLocaleLowerCase();
        });

        const categoryCounts = new Map();
        categoryCards.forEach(card => card.dataset.commandCategories.split(/\s+/).forEach(category => {
          categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
        }));

        // إحصاءات الترويسة: الإجمالي والمفعّل والمتوقف
        const totalOn = categoryCards.filter(card => card.dataset.commandState === 'on').length;
        const setStat = (selector, value) => {
          const node = document.querySelector(selector);
          if (node) node.textContent = String(value);
        };
        setStat('[data-stat-total]', categoryCards.length);
        setStat('[data-stat-on]', totalOn);
        setStat('[data-stat-off]', categoryCards.length - totalOn);

        function labelForCategory(category) {
          if (category === 'all') return 'كل الأوامر';
          const tab = categoryTabs.find(item => item.dataset.categoryFilter === category);
          return tab ? tab.childNodes[0].textContent.trim() : 'التصنيف';
        }

        function applyFilters() {
          const query = (commandSearch?.value || '').trim().toLocaleLowerCase();
          let visibleCount = 0;

          categoryCards.forEach(card => {
            const inCategory = activeCategory === 'all'
              || card.dataset.commandCategories.split(/\s+/).includes(activeCategory);
            const inKind = activeKind === 'all' || card.dataset.commandKind === activeKind;
            const matchesSearch = !query || card._searchText.includes(query);
            const show = inCategory && inKind && matchesSearch;
            card.classList.toggle('category-hidden', !show);
            if (show) visibleCount++;
          });

          // إخفاء عنوان أي مجموعة لم يبقَ فيها بطاقة ظاهرة
          commandGroups.forEach(group => {
            const groupCards = Array.from(group.querySelectorAll('.cmd-card'));
            const shown = groupCards.filter(card => !card.classList.contains('category-hidden')).length;
            group.classList.toggle('category-hidden', shown === 0);
            const counter = group.querySelector('[data-group-count]');
            // نُظهر «X من N» فقط عند وجود تصفية تخفي بعض البطاقات، وإلا يبقى
            // العدد الصريح «N أمر» كما حسبه الخادم — بلا أرقام مزدوجة مربكة.
            if (counter) counter.textContent = shown === groupCards.length ? groupCards.length + ' أمر' : shown + ' من ' + groupCards.length;
          });

          // 🔎 عند اختيار تصنيف: يُضاف صنف يخفي عناوين الأقسام حتى تبقى النتيجة شبكة واحدة مرتّبة
          document.querySelector('.commands-page')?.classList.toggle('is-category-filtered', activeCategory !== 'all');

          const filtersActive = Boolean(query) || activeCategory !== 'all' || activeKind !== 'all';
          if (resetFilters) resetFilters.hidden = !filtersActive;
          if (searchClear) searchClear.hidden = !query;
          if (emptyState) emptyState.classList.toggle('is-visible', visibleCount === 0);

          if (categoryResults) {
            if (visibleCount === 0) {
              categoryResults.textContent = 'لا توجد أوامر مطابقة.';
            } else if (filtersActive) {
              categoryResults.textContent = 'يُعرض ' + visibleCount + ' من أصل ' + categoryCards.length + ' أمر'
                + (activeCategory === 'all' ? '' : ' · التصنيف: ' + labelForCategory(activeCategory))
                + (query ? ' · البحث: "' + query + '"' : '');
            } else {
              categoryResults.textContent = 'تُعرض جميع الأوامر (' + categoryCards.length + '). ابحث أو اختر تصنيفاً للتصفية.';
            }
          }
        }

        // ⌨️ تحكّم أسرع: اضغط / للانتقال إلى البحث مباشرة، وEsc لمسحه،
        //    والخروج من أي قائمة مفتوحة. لا يتعارض مع الكتابة داخل الحقول.
        document.addEventListener('keydown', event => {
          const target = event.target;
          const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
          if (event.key === '/' && !typing && commandSearch) {
            event.preventDefault();
            commandSearch.focus();
            commandSearch.select();
            return;
          }
          if (event.key === 'Escape' && commandSearch && document.activeElement === commandSearch) {
            commandSearch.value = '';
            applyFilters();
            commandSearch.blur();
          }
        });

        // تبويبات التصنيف (مع تنقّل بالأسهم لسهولة الوصول)
        categoryTabs.forEach(tab => {
          const category = tab.dataset.categoryFilter;
          const count = category === 'all' ? categoryCards.length : (categoryCounts.get(category) || 0);
          tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
          const counter = tab.querySelector('[data-category-count]');
          if (counter) counter.textContent = count;
          tab.addEventListener('keydown', event => {
            let nextIndex = categoryTabs.indexOf(tab);
            if (event.key === 'ArrowLeft') nextIndex++;
            else if (event.key === 'ArrowRight') nextIndex--;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = categoryTabs.length - 1;
            else return;
            event.preventDefault();
            const nextTab = categoryTabs[(nextIndex + categoryTabs.length) % categoryTabs.length];
            nextTab.focus();
            nextTab.click();
          });
          tab.addEventListener('click', () => {
            activeCategory = category;
            categoryTabs.forEach(item => {
              const selected = item === tab;
              item.classList.toggle('is-active', selected);
              item.setAttribute('aria-selected', String(selected));
              item.tabIndex = selected ? 0 : -1;
            });
            applyFilters();
          });
        });

        // أزرار نوع الأمر (سلاش / مخصّصة / صلاحيات)
        kindButtons.forEach(button => {
          button.addEventListener('click', () => {
            activeKind = button.dataset.kindFilter;
            kindButtons.forEach(item => item.classList.toggle('is-active', item === button));
            applyFilters();
          });
        });

        commandSearch?.addEventListener('input', applyFilters);
        searchClear?.addEventListener('click', () => {
          if (!commandSearch) return;
          commandSearch.value = '';
          commandSearch.focus();
          applyFilters();
        });
        resetFilters?.addEventListener('click', () => {
          if (commandSearch) commandSearch.value = '';
          activeKind = 'all';
          kindButtons.forEach(item => item.classList.toggle('is-active', item.dataset.kindFilter === 'all'));
          const allTab = categoryTabs.find(item => item.dataset.categoryFilter === 'all');
          if (allTab) allTab.click(); else applyFilters();
        });

        // اختصار "/" لوضع المؤشر في حقل البحث فوراً
        document.addEventListener('keydown', event => {
          if (event.key === '/' && document.activeElement !== commandSearch
              && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
            event.preventDefault();
            commandSearch?.focus();
          }
          if (event.key === 'Escape' && document.activeElement === commandSearch && commandSearch.value) {
            commandSearch.value = '';
            applyFilters();
          }
        });

        // زر العودة لأعلى الصفحة
        const toTop = document.querySelector('[data-to-top]');
        if (toTop) {
          toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
          const syncToTop = () => toTop.classList.toggle('is-visible', window.scrollY > 420);
          window.addEventListener('scroll', syncToTop, { passive: true });
          syncToTop();
        }

        // ======================================================================
        // ⚠️ معاينة رسالة الإنذار الخاصة — تتحدث مع كل ضغطة زر.
        // تستخدم textContent حصراً (لا innerHTML) فلا يمكن حقن HTML من الحقول.
        // ======================================================================
        (() => {
          const form = document.querySelector('[data-warndm-form]');
          if (!form) return;

          const SAMPLE = {
            '{العضو}': 'سالم',
            '{السبب}': 'مخالفة قوانين الشات',
            '{المشرف}': 'أحمد',
            '{السيرفر}': document.title.replace(/\\s*[-|·].*$/, '') || 'السيرفر',
            '{رقم_الإنذار}': '42',
            '{عدد_الإنذارات}': '3'
          };
          const fill = text => String(text || '').replace(/\\{[^{}]*\\}/g, m =>
            Object.prototype.hasOwnProperty.call(SAMPLE, m) ? SAMPLE[m] : m);

          const get = name => form.querySelector('[name="' + name + '"]');
          const preview = form.querySelector('[data-warndm-preview]');
          const elText = form.querySelector('[data-warndm-preview-text]');
          const elEmbed = form.querySelector('[data-warndm-preview-embed]');
          const elTitle = form.querySelector('[data-warndm-preview-title]');
          const elDesc = form.querySelector('[data-warndm-preview-desc]');
          const elFooter = form.querySelector('[data-warndm-preview-footer]');
          const elImage = form.querySelector('[data-warndm-preview-image]');
          const elThumb = form.querySelector('[data-warndm-preview-thumb]');
          if (!preview) return;

          // رابط https فقط — نفس قاعدة الخادم، حتى لا تَعِد المعاينة بما يُرفض.
          const safeUrl = value => /^https:\\/\\/[^\\s<>"']+$/i.test(String(value || '').trim())
            ? String(value).trim() : '';

          const render = () => {
            const enabled = get('enabled').checked;
            preview.style.opacity = enabled ? '1' : '.45';

            elText.textContent = fill(get('messageText').value);

            const embedOn = get('embedEnabled').checked;
            const title = fill(get('embedTitle').value);
            const desc = fill(get('embedDescription').value);
            const footer = fill(get('embedFooter').value);
            const image = safeUrl(get('embedImageUrl').value);
            const thumb = safeUrl(get('embedThumbnailUrl').value);

            elEmbed.hidden = !embedOn || !(title || desc || footer || image || thumb);
            elEmbed.style.borderLeftColor = get('embedColor').value;
            elTitle.textContent = title;
            elDesc.textContent = desc;
            elFooter.textContent = footer;
            elImage.hidden = !image; if (image) elImage.src = image;
            elThumb.hidden = !thumb; if (thumb) elThumb.src = thumb;
          };

          form.querySelectorAll('[data-warndm-input], [name="enabled"]').forEach(field => {
            field.addEventListener('input', render);
            field.addEventListener('change', render);
          });

          // أزرار المتغيرات: تُدرج في آخر حقل نصي لمسه المستخدم.
          let lastField = form.querySelector('[name="embedDescription"]');
          form.querySelectorAll('textarea[data-warndm-input], input[type="text"][data-warndm-input], input:not([type])[data-warndm-input]').forEach(field => {
            field.addEventListener('focus', () => { lastField = field; });
          });
          form.querySelectorAll('[data-warndm-var]').forEach(button => {
            button.addEventListener('click', () => {
              if (!lastField) return;
              const token = button.getAttribute('data-warndm-var');
              const start = lastField.selectionStart ?? lastField.value.length;
              const end = lastField.selectionEnd ?? lastField.value.length;
              lastField.value = lastField.value.slice(0, start) + token + lastField.value.slice(end);
              lastField.focus();
              lastField.setSelectionRange(start + token.length, start + token.length);
              render();
            });
          });

          render();
        })();

        // ======================================================================
        // 💾 شريط الحفظ الموحّد
        //
        // المشكلة: كل أمر له زر حفظ خاص، فتعديل خمسة أوامر = خمس حفظات
        // وخمس إعادات تحميل للصفحة. الآن نرصد كل التعديلات ونحفظها دفعة
        // واحدة بلا إعادة تحميل إطلاقاً.
        //
        // الأمان: نرسل الفورم كما هو عبر fetch، فيذهب حقل _csrf المحقون
        // تلقائياً مع البيانات — لا نتجاوز أي فحص أمني.
        //
        // ملاحظة: أزرار الحفظ الفردية تبقى تعمل كما كانت، فمن اعتادها لم
        // يفقد شيئاً.
        // ======================================================================
        (() => {
          const bar = document.querySelector('[data-save-bar]');
          if (!bar) return;
          // 🔌 مفتاح إيقاف: بضبط DASHBOARD_SAVE_BAR=off في بيئة البوت يختفي
          //    الشريط تماماً وتعود أزرار البطاقات لإرسالها الأصلي القديم
          //    حرفياً. يضمن أن اللوحة تظل صالحة للعمل مهما حدث للشريط.
          if (bar.dataset.disabled === '1') { bar.remove(); return; }
          const barText = bar.querySelector('[data-save-bar-text]');
          const saveButton = bar.querySelector('[data-save-all]');
          const cancelButton = bar.querySelector('[data-save-cancel]');

          const forms = Array.from(document.querySelectorAll('.cmd-card form'))
            .filter(form => (form.getAttribute('method') || '').toLowerCase() === 'post');
          if (!forms.length) return;

          // لقطة الحالة الأصلية لكل حقل، لنعرف ما تغيّر ولنستطيع التراجع.
          const snapshot = new WeakMap();
          const fieldsOf = form => Array.from(form.elements).filter(el => el.name);

          const captureForm = form => {
            const state = new Map();
            fieldsOf(form).forEach(el => {
              state.set(el, el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
            });
            snapshot.set(form, state);
          };
          forms.forEach(captureForm);

          const isDirty = form => {
            const state = snapshot.get(form);
            if (!state) return false;
            return fieldsOf(form).some(el => {
              const before = state.get(el);
              if (before === undefined) return true;
              const now = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
              return now !== before;
            });
          };

          const titleOf = form => {
            const card = form.closest('.cmd-card');
            const name = card && card.querySelector('.cmd-name');
            return name ? name.textContent.trim() : 'أمر';
          };

          // ================================================================
          // 🔒 منع الاختلاط بين زر البطاقة وشريط الحفظ
          //
          // المشكلة التي وقعت فعلاً: كان زر البطاقة يُرسل الفورم إرسالاً
          // أصلياً (انتقال صفحة)، وكان حارس المغادرة يرى تعديلاً غير محفوظ
          // فيوقف الانتقال ويعرض تحذير المتصفح «تغييراتك قد لا تُحفظ».
          // من يقرأ تلك الجملة يضغط «ابقَ» بداهةً — فيُلغى الإرسال ولا
          // يُحفظ شيء. أي أن الحارس كان يخنق الحفظ الذي جاء ليحميه.
          //
          // العلاج البنيوي: مسار حفظ **واحد** لا غير. زر البطاقة لم يعد
          // يُرسل الفورم بنفسه، بل يمرّ على نفس دالة الحفظ التي يستعملها
          // الشريط. وما دام المساران صارا شفرة واحدة فلا مجال لتضاربهما.
          //
          // فوق ذلك قفل مشترك: أثناء أي حفظ تُعطَّل كل الأزرار — زر الشريط
          // وأزرار كل البطاقات — فلا يمكن إطلاق حفظين متوازيين على نفس
          // الأمر ولا ضغط زر أثناء عمل الآخر.
          //
          // وشبكة أمان: لو تعذّر fetch لأي سبب، يعود الزر تلقائياً للإرسال
          // الأصلي القديم مع رفع حارس المغادرة، فلا يبقى المستخدم عاجزاً.
          // ================================================================
          const state = { busy: false, allowUnload: false, syncing: false };

          function refresh() {
            if (state.busy) return;
            const dirty = forms.filter(isDirty);
            forms.forEach(form => {
              const card = form.closest('.cmd-card');
              if (isDirty(form)) card.classList.add('is-dirty');
              else card.classList.remove('is-dirty');
            });
            if (!dirty.length) { bar.hidden = true; return; }
            bar.hidden = false;
            barText.textContent = dirty.length === 1
              ? 'تعديل غير محفوظ في: ' + titleOf(dirty[0])
              : 'تعديلات غير محفوظة في ' + dirty.length + ' أوامر';
          }

          // رصد أي تغيير داخل البطاقات
          document.addEventListener('input', event => {
            if (event.target.closest && event.target.closest('.cmd-card form')) refresh();
          });
          document.addEventListener('change', event => {
            if (event.target.closest && event.target.closest('.cmd-card form')) refresh();
          });

          cancelButton.addEventListener('click', () => {
            if (state.busy) return; // القفل: لا تراجع أثناء حفظ جارٍ
            forms.filter(isDirty).forEach(form => {
              const stored = snapshot.get(form);
              fieldsOf(form).forEach(el => {
                const before = stored.get(el);
                if (before === undefined) return;
                if (el.type === 'checkbox' || el.type === 'radio') el.checked = before;
                else el.value = before;
              });
              // محرّرات الاختصارات ترسم رقائقها من الحقل المخفي
              form.dispatchEvent(new CustomEvent('dashboard:restored', { bubbles: true }));
            });
            bar.classList.remove('is-error', 'is-done');
            refresh();
          });

          const submitButtonsOf = form => Array.from(form.querySelectorAll('button[type="submit"]'));
          const allSubmitButtons = forms.reduce((all, form) => all.concat(submitButtonsOf(form)), []);

          function setBusy(on) {
            state.busy = on;
            saveButton.disabled = on;
            cancelButton.disabled = on;
            allSubmitButtons.forEach(button => { button.disabled = on; });
            if (on) bar.classList.add('is-busy');
            else bar.classList.remove('is-busy');
          }

          /** يرسل فورماً واحداً. يرمي عند الفشل. */
          async function postForm(form) {
            // ⚠️ حاسم: عدة محرّرات في الصفحة (الاختصارات، منتقي الرتب) تزامن
            // حقولها المخفية عبر مستمع submit. الإرسال بـ fetch مباشرةً لا
            // يُطلق ذلك الحدث، فكانت تلك المزامنات تُتخطّى بالكامل ويُرسل
            // النموذج بقيم غير محدَّثة — وهذا يُفقد ما كتبه المستخدم للتوّ.
            // لذلك نُطلق submit حقيقياً أولاً ليعمل كل مزامن مسجَّل عليه،
            // وعلامة syncing تمنع معالجنا من ملاحقة الحدث ويدخل في تكرار.
            state.syncing = true;
            try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
            finally { state.syncing = false; }

            const response = await fetch(form.getAttribute('action'), {
              method: 'POST',
              body: new URLSearchParams(new FormData(form)),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              credentials: 'same-origin'
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            captureForm(form);
            form.closest('.cmd-card').classList.remove('is-dirty');
          }

          // ================================================================
          // 🔎 تحقّق فعلي بعد الحفظ
          //
          // الدرس الذي كلّفنا جولات: fetch يعتبر أي رد 2xx نجاحاً، ويتبع
          // التحويلات بصمت. فلو ردّ الخادم بصفحة دخول أو صفحة خطأ أو ردّ
          // وسيط من بروكسي، يرى العميل 200 ويعلن «تم الحفظ» ولم يُحفظ شيء.
          // والمستخدم لا يكتشف ذلك إلا بإعادة تحميل الصفحة يدوياً.
          //
          // الحل: نفعل نيابةً عنه ما كان يفعله بيده — نعيد جلب الصفحة
          // ونقارن القيم المخزّنة فعلاً بما أرسلناه. فإن لم تتطابق نقولها
          // صراحةً بدل إظهار نجاح كاذب.
          // ================================================================
          // المقارنة تتسامح مع التطبيع المشروع الذي يجريه الخادم، وإلا صرخ
          // التحقق بلا سبب. أبرز مثال: حقل اللون يفرض عليه المتصفح الأحرف
          // الصغيرة بينما يخزّنه الخادم بالكبيرة — اختلاف شكلي لا معنى له.
          // الاختصارات يطبّعها الخادم بقواعد ثابتة: فراغات وحروف صغيرة وإزالة
          // التكرار، ويُسقط الاختصار المطابق لاسم الأمر نفسه. فنطبّق القواعد
          // نفسها قبل المقارنة، وإلا بدا التطبيع المشروع «حفظاً لم يثبت».
          // فكّ قيمة الاختصارات (JSON أو نص مفصول بفواصل): نسخة محلية لأن سكربت
          // الشريط يُستدعى مستقلاً عمّا قبله في الاختبارات وفي الصفحة.
          const aliasListOf = raw => {
            const text = String(raw == null ? '' : raw).trim();
            if (text.startsWith('[')) {
              try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) return parsed.map(String);
              } catch (ignored) { /* ليست JSON → الصيغة القديمة */ }
            }
            return text.split(',').map(part => part.trim()).filter(Boolean);
          };

          const comparable = (value, field) => {
            const editor = field && field.closest ? field.closest('[data-alias-editor]') : null;
            // الاختصارات تُخزَّن JSON، والمقارنة تطبّق تطبيع الخادم نفسه
            // (حروف صغيرة + إزالة المكرر) وإلا بدا التطبيع المشروع «حفظاً لم يثبت».
            if (editor) {
              return [...new Set(aliasListOf(value).map(alias => alias.trim().toLowerCase()).filter(Boolean))].join(',');
            }
            const text = String(value).split(',').map(part => part.trim()).filter(Boolean).join(',');
            if (text.charAt(0) === '#') return text.toLowerCase();
            return text;
          };

          async function verifySaved(saved, beforeSave) {
            const response = await fetch(window.location.pathname, {
              credentials: 'same-origin',
              headers: { 'Cache-Control': 'no-cache' }
            });
            if (!response.ok) throw new Error('تعذّر إعادة قراءة الصفحة');
            const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');

            // أقوى دليل يمكن جمعه من المتصفح: هل الصفحة التي أعاد الخادم
            // إرسالها صادرة عن نفس النسخة التي كتبنا إليها؟ اختلاف البصمة
            // يعني أن أكثر من نسخة من البوت تعمل خلف نفس العنوان، فالحفظ
            // يذهب إلى واحدة والقراءة تأتي من أخرى — وهذا وحده كافٍ لضياع
            // التعديلات مهما كان الكود سليماً.
            const myNode = document.querySelector('.save-bar-build');
            const theirNode = fresh.querySelector('.save-bar-build');
            const myBuild = myNode ? myNode.textContent.trim() : '';
            const theirBuild = theirNode ? theirNode.textContent.trim() : '';
            const myInstance = myNode ? (myNode.getAttribute('data-instance') || '') : '';
            const theirInstance = theirNode ? (theirNode.getAttribute('data-instance') || '') : '';

            if (myBuild && theirBuild && myBuild !== theirBuild) {
              return {
                split: 'build',
                details: ['نسخة بصمتها ' + myBuild + ' وأخرى بصمتها ' + theirBuild]
              };
            }
            // نفس الكود لكن عمليتان مختلفتان: لا تكشفه البصمة وحدها.
            if (myInstance && theirInstance && myInstance !== theirInstance) {
              return {
                split: 'instance',
                details: ['عملية ' + myInstance + ' وأخرى ' + theirInstance]
              };
            }

            // نُظهر القيمتين لا اسم الحقل وحده: بغير ذلك يبقى السبب مجهولاً.
            const show = value => {
              const text = String(value);
              if (!text) return 'فارغ';
              return '«' + (text.length > 40 ? text.slice(0, 40) + '…' : text) + '»';
            };
            // ⚠️ فرق جوهري: «الخادم أعاد قيمة مختلفة» ليس دليل فشل الكتابة.
            // الخادم يطبّع قيماً كثيرة عمداً (اختصار مكرر، اختصار يساوي اسم
            // الأمر، فراغات، حالة أحرف، نص أطول من حدّ ديسكورد…). لكن عودة
            // القيمة **كما كانت قبل الحفظ** تعني أن الكتابة لم يظهر لها أثر.
            // فالأولى تُعرض كتطبيع (نجاح)، والثانية وحدها تُعرض كضياع.
            const details = [];
            const lost = [];
            saved.forEach(form => {
              const target = fresh.querySelector('form[action="' + form.getAttribute('action') + '"]');
              if (!target) return;
              const previousState = beforeSave ? beforeSave.get(form) : snapshot.get(form);
              fieldsOf(form).forEach(field => {
                if (field.name === '_csrf') return;
                const other = target.elements[field.name];
                if (!other || other.length !== undefined) return;
                const toggle = field.type === 'checkbox' || field.type === 'radio';
                const mine = toggle ? field.checked : comparable(field.value, field);
                const theirs = toggle ? other.checked : comparable(other.value, field);
                if (mine === theirs) return;
                const shownMine = toggle ? (mine ? 'مفعّل' : 'معطّل') : show(field.value);
                const shownTheirs = toggle ? (theirs ? 'مفعّل' : 'معطّل') : show(other.value);
                const previous = previousState ? previousState.get(field) : undefined;
                const previousComparable = previous === undefined ? undefined : (toggle ? previous : comparable(previous, field));
                const record = titleOf(form) + ' · ' + field.name + ': أرسلنا ' + shownMine + ' لكن الخادم أعاد ' + shownTheirs;
                if (previousComparable !== undefined && previousComparable === theirs) lost.push(record);
                else details.push(record);
              });
            });
            return { split: '', details: details, lost: lost };
          }

          // ------------------------- مسار الشريط -------------------------
          saveButton.addEventListener('click', async () => {
            const dirty = forms.filter(isDirty);
            if (!dirty.length || state.busy) return;
            setBusy(true);
            bar.classList.remove('is-error', 'is-done');

            // 🔖 لقطة ما قبل الحفظ: postForm يحدّث اللقطة بالقيم الجديدة بعد كل
            //    إرسال ناجح، فنحتفظ هنا بما كان قبل الحفظ لنعرف لاحقاً: هل تغيّرت
            //    القيمة في قاعدة البيانات فعلاً، أم عادت كما كانت (بلا أثر)؟
            const beforeSave = new Map(dirty.map(form => [form, snapshot.get(form)]));

            let done = 0;
            const failed = [];
            for (const form of dirty) {
              barText.textContent = 'جارٍ الحفظ… ' + (done + failed.length + 1) + ' من ' + dirty.length;
              try { await postForm(form); done += 1; }
              catch (error) { failed.push(titleOf(form)); }
            }

            setBusy(false);
            if (failed.length) {
              bar.classList.add('is-error');
              barText.textContent = 'تعذّر حفظ: ' + failed.join(' · ') + ' — حاول مرة أخرى.';
              return;
            }
            // لا نعلن النجاح قبل أن نتأكد منه فعلياً
            barText.textContent = 'جارٍ التحقق من الحفظ…';
            let report = null;
            try { report = await verifySaved(dirty, beforeSave); }
            catch (error) { report = null; }

            if (report && report.split === 'build') {
              bar.classList.add('is-error');
              barText.textContent = 'تعمل نسختان مختلفتان من الكود في نفس الوقت ('
                + report.details[0] + '). الحفظ يذهب إلى واحدة والقراءة تأتي من '
                + 'الأخرى فتضيع التعديلات. أعد النشر وأوقف العملية القديمة.';
              return;
            }

            if (report && report.split === 'instance') {
              bar.classList.add('is-error');
              barText.textContent = 'يعمل أكثر من نسخة من البوت في نفس الوقت ('
                + report.details[0] + '). أنزل عدد النسخ إلى واحدة فقط، فالنسخ '
                + 'تتناوب على الطلبات وتكتب فوق بعضها.';
              return;
            }

            // 🔎 حكم قاعدة البيانات: نطلبه فقط عند الشك، فنقول للمستخدم في
            //    السطر نفسه هل العلّة من قاعدة البيانات أم من قيمة رفضها
            //    الخادم — بدل تحويله إلى تشخيص يدوي في كل مرة.
            if (report && report.lost.length) {
              bar.classList.add('is-error');
              let verdict = ' شغّل node diagnoseSaving.js للتشخيص الكامل.';
              try {
                const health = await fetch('/save-health', {
                  credentials: 'same-origin',
                  headers: { 'Cache-Control': 'no-cache' }
                });
                if (health.ok) {
                  const info = await health.json();
                  if (info.botSettingsValueType === 'jsonb') {
                    verdict = ' قاعدة البيانات سليمة (jsonb) — فالقيمة غالباً مرفوضة بقواعد الأمر لا ضائعة.';
                  } else {
                    verdict = ' ⚠️ عمود الإعدادات في قاعدة البيانات نوعه ' + info.botSettingsValueType
                      + ' وليس jsonb — هذا سبب ضياع الحفظ، ويُصلَح عند إعادة تشغيل البوت بالنسخة الجديدة.';
                  }
                }
              } catch (error) { /* تعذّر الفحص: نُبقي الرسالة العامة */ }
              barText.textContent = 'هذه القيم عادت كما كانت قبل الحفظ (بلا أثر للكتابة): '
                + report.lost.slice(0, 2).join(' · ')
                + (report.lost.length > 2 ? ' وغيرها' : '') + ' —' + verdict;
              return;
            }

            if (report && report.details.length) {
              bar.classList.add('is-done');
              barText.textContent = 'تم حفظ ' + done + (done === 1 ? ' أمر ✅' : ' أوامر ✅')
                + ' — وطبّع الخادم: ' + report.details.slice(0, 2).join(' · ')
                + (report.details.length > 2 ? ' وغيرها' : '')
                + ' (القيم المرفوضة لا تُخزَّن، وهذا سلوك مقصود)';
              setTimeout(() => { bar.classList.remove('is-done'); refresh(); }, 4000);
              return;
            }

            bar.classList.add('is-done');
            barText.textContent = report === null
              ? 'تم حفظ ' + done + (done === 1 ? ' أمر ✅' : ' أوامر ✅') + ' (تعذّر التحقق)'
              : 'تم حفظ ' + done + (done === 1 ? ' أمر ✅' : ' أوامر ✅') + ' — وتم التأكد من ثباتها';
            setTimeout(() => { bar.classList.remove('is-done'); refresh(); }, 2600);
          });

          // --------------------- مسار زر البطاقة ------------------------
          // نعترض الإرسال دائماً ونمرّره على نفس الدالة، فلا ينتقل المتصفح
          // ولا يُستفزّ حارس المغادرة أصلاً.
          forms.forEach(form => {
            form.addEventListener('submit', async event => {
              if (state.syncing) return; // حدث مزامنة أطلقناه نحن، لا ضغطة زر
              event.preventDefault();
              if (state.busy) return; // القفل: حفظ آخر جارٍ

              const buttons = submitButtonsOf(form);
              const labels = buttons.map(button => button.textContent);
              setBusy(true);
              buttons.forEach(button => { button.textContent = 'جارٍ الحفظ…'; });

              try {
                await postForm(form);
                buttons.forEach(button => { button.textContent = 'تم الحفظ ✅'; });
                setTimeout(() => {
                  buttons.forEach((button, index) => { button.textContent = labels[index]; });
                }, 1600);
                setBusy(false);
                refresh();
              } catch (error) {
                // شبكة أمان: نعود للإرسال الأصلي كما كان قبل الشريط.
                // form.submit() لا يمرّ بمستمعي submit فلا يتكرر الاعتراض.
                buttons.forEach((button, index) => { button.textContent = labels[index]; });
                state.allowUnload = true;
                setBusy(false);
                form.submit();
              }
            });
          });

          // ------------------------ حارس المغادرة ------------------------
          // لم يعد يعترض الحفظ إطلاقاً لأن الحفظ لم يعد ينقل الصفحة.
          // يبقى لحالته الوحيدة المشروعة: إغلاق التبويب أو الانتقال برابط
          // بينما هناك تعديل لم يُحفظ.
          window.addEventListener('beforeunload', event => {
            if (state.allowUnload || state.busy) return;
            if (!forms.some(isDirty)) return;
            event.preventDefault();
            event.returnValue = '';
          });

          refresh();
        })();

        applyFilters();
      </script>
    </body>
    </html>
  `);
});

app.post('/save-slash-command/:name', requireAuth, async (req, res) => {
  const { SLASH_COMMAND_NAMES, getSlashCommandConfig, saveSlashCommandConfig } = require('./slashCommandConfig');
  const name = String(req.params.name || '').toLowerCase();
  if (!SLASH_COMMAND_NAMES.includes(name)) return res.status(404).send('أمر سلاش غير معروف.');
  // ⚠️ fresh إلزامية: الحفظ يقرأ الإعدادات كلها ويعيد كتابتها كلها، فالقراءة
  //    من ذاكرة قديمة تكتب حالة قديمة فوق تعديلات أوامر أخرى حُفظت للتوّ
  //    وتمحوها بلا أي رسالة خطأ. يظهر ذلك عند حفظ عدة أوامر دفعة واحدة.
  const current = await getSlashCommandConfig(pool, { fresh: true });
  await saveSlashCommandConfig(pool, {
    ...current,
    commands: {
      ...current.commands,
      [name]: {
        enabled: req.body.enabled === 'on',
        aliases: req.body.aliases || '',
        giveAliases: req.body.giveAliases || '',
        removeAliases: req.body.removeAliases || '',
        roleIds: String(req.body.allowedRoleIds || '').split(','),
        userIds: String(req.body.allowedUserIds || '').split(',')
      }
    }
  });
  if (name === 'clear') {
    const cleanupMode = ['both', 'bot_only', 'user_only', 'none'].includes(req.body.clearCleanupMode) ? req.body.clearCleanupMode : 'bot_only';
    await pool.query(
      `INSERT INTO permissions (key, clear_cleanup_mode) VALUES ('main_permissions', $1)
       ON CONFLICT (key) DO UPDATE SET clear_cleanup_mode = EXCLUDED.clear_cleanup_mode;`,
      [cleanupMode]
    );
  }
  return res.redirect(`/commands?saved=slash-${encodeURIComponent(name)}`);
});

app.post('/save-command-tax', requireAuth, async (req, res) => {
  const { saveTaxCommandConfig } = require('./commandConfig');
  const d = req.body;
  const taxRatePercent = Number(d.taxRatePercent);
  if (!Number.isFinite(taxRatePercent) || taxRatePercent < 0 || taxRatePercent > 99) {
    return res.status(400).send('❌ نسبة الضريبة يجب أن تكون بين 0 و99%. <a href="/commands">العودة</a>');
  }

  await saveTaxCommandConfig(pool, {
    enabled: d.enabled === 'on',
    aliases: d.aliases || '',
    taxRatePercent,
    embedTitle: d.embedTitle,
    originalLabel: d.originalLabel,
    netLabel: d.netLabel,
    grossLabel: d.grossLabel,
    embedColor: d.embedColor
  });

  await pool.query(
    `INSERT INTO permissions (key, tax_role_id) VALUES ('main_permissions', $1)
     ON CONFLICT (key) DO UPDATE SET tax_role_id = EXCLUDED.tax_role_id;`,
    [(d.taxRoleId || '').trim()]
  );
  return res.redirect('/commands?saved=tax');
});

app.post('/save-command-come', requireAuth, async (req, res) => {
  const { saveComeCommandConfig } = require('./commandConfig');
  const d = req.body;
  await saveComeCommandConfig(pool, {
    enabled: d.enabled === 'on',
    aliases: d.aliases || '',
    embedTitle: d.embedTitle,
    embedDescription: d.embedDescription,
    embedColor: d.embedColor
  });

  await pool.query(
    `INSERT INTO permissions (key, come_role_id) VALUES ('main_permissions', $1)
     ON CONFLICT (key) DO UPDATE SET come_role_id = EXCLUDED.come_role_id;`,
    [(d.comeRoleId || '').trim()]
  );
  return res.redirect('/commands?saved=come');
});

app.post('/save-warn-dm', requireAuth, async (req, res) => {
  // التطبيع كله داخل normalizeWarnDmConfig: روابط https فقط، ألوان hex فقط،
  // وقصّ أطوال ديسكورد. فلا يصل أي مدخل خام إلى البوت.
  const { saveWarnDmConfig } = require('./commandConfig');
  const d = req.body;
  await saveWarnDmConfig(pool, {
    enabled: d.enabled === 'on',
    messageText: d.messageText,
    embedEnabled: d.embedEnabled === 'on',
    embedTitle: d.embedTitle,
    embedDescription: d.embedDescription,
    embedColor: d.embedColor,
    embedImageUrl: d.embedImageUrl,
    embedThumbnailUrl: d.embedThumbnailUrl,
    embedFooter: d.embedFooter
  });
  return res.redirect('/commands?saved=warn-dm');
});

app.post('/save-command-say', requireAuth, async (req, res) => {
  const { saveSayCommandConfig } = require('./commandConfig');
  const d = req.body;
  await saveSayCommandConfig(pool, {
    enabled: d.enabled === 'on',
    aliases: d.aliases || '',
    deleteInvocation: d.deleteInvocation === 'on',
    mentionPolicy: d.mentionPolicy
  });

  await pool.query(
    `INSERT INTO permissions (key, say_role_id) VALUES ('main_permissions', $1)
     ON CONFLICT (key) DO UPDATE SET say_role_id = EXCLUDED.say_role_id;`,
    [(d.sayRoleId || '').trim()]
  );
  return res.redirect('/commands?saved=say');
});

app.post('/save-command-close', requireAuth, async (req, res) => {
  const { saveCloseCommandConfig, getCommandControlConfig, saveCommandControlConfig } = require('./commandConfig');
  const d = req.body;
  const allowedClosePermissions = ['both', 'admin_only'];
  const allowedDeletePermissions = ['high_admin', 'all_admin'];
  const closePermission = allowedClosePermissions.includes(d.closePermission) ? d.closePermission : 'both';
  const deletePermission = allowedDeletePermissions.includes(d.deletePermission) ? d.deletePermission : 'high_admin';
  const savePermission = allowedClosePermissions.includes(d.savePermission) ? d.savePermission : 'both';

  await saveCloseCommandConfig(pool, {
    enabled: d.enabled === 'on',
    aliases: d.aliases || ''
  });
  const currentControlConfig = await getCommandControlConfig(pool);
  await saveCommandControlConfig(pool, {
    ...currentControlConfig,
    ticketCommands: {
      enabled: d.ticketCommandsEnabled === 'on',
      saveAliases: d.saveAliases || '',
      deleteAliases: d.deleteAliases || '',
      addAliases: d.addAliases || '',
      removeAliases: d.removeAliases || '',
      renameAliases: d.renameAliases || ''
    }
  });
  await pool.query(
    `INSERT INTO permissions (key, close_permission, delete_permission, save_permission)
     VALUES ('main_permissions', $1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET close_permission = EXCLUDED.close_permission,
       delete_permission = EXCLUDED.delete_permission, save_permission = EXCLUDED.save_permission;`,
    [closePermission, deletePermission, savePermission]
  );
  return res.redirect('/commands?saved=close');
});

const permissionField = fieldName => body => String(body[fieldName] || '').trim();
const commandPermissionGroups = {
  global: { permissions: { all_commands_role_id: permissionField('allCommandsRoleId') } },
  claim: { controlGroup: 'claim', permissions: { claim_role_id: permissionField('claimRoleId') } },
  'channel-access': {
    controlGroup: 'channelAccess',
    permissions: { add_view_role_id: permissionField('addViewRoleId'), write_role_id: permissionField('writeRoleId') }
  },
  'tax-channel': { controlGroup: 'taxChannel', permissions: { tax_channel_role_id: permissionField('taxChannelRoleId') } },
  suggestions: { controlGroup: 'suggestions', permissions: { suggestions_role_id: permissionField('suggestionsRoleId') } },
  rename: { controlGroup: 'renameChannel', permissions: { rename_role_id: permissionField('renameRoleId') } },
  status: { controlGroup: 'status', permissions: { status_role_id: permissionField('statusRoleId') } },
  'role-toggle': { controlGroup: 'roleToggle', permissions: { role_toggle_role_id: permissionField('roleToggleRoleId') } },
  clans: {
    controlGroup: 'clans',
    permissions: {
      clan_manager_role_id: permissionField('clanManagerRoleId'),
      clan_cmd_role_id: body => combineRoleAndUserIds(body.clanCmdRoleIds, body.clanCmdUserIds)
    }
  },
  'owner-log': { controlGroup: 'ownerLog', permissions: {} }
};

app.post('/save-command-permissions/:group', requireAuth, async (req, res) => {
  const group = commandPermissionGroups[req.params.group];
  if (!group) return res.status(404).send('مجموعة صلاحيات غير معروفة.');

  const columns = Object.keys(group.permissions);
  if (columns.length) {
    const values = columns.map(column => group.permissions[column](req.body));
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const updates = columns.map(column => `${column} = EXCLUDED.${column}`).join(', ');
    await pool.query(
      `INSERT INTO permissions (key, ${columns.join(', ')}) VALUES ('main_permissions', ${placeholders})
       ON CONFLICT (key) DO UPDATE SET ${updates};`,
      values
    );
  }

  if (group.controlGroup) {
    const { getCommandControlConfig, saveCommandControlConfig } = require('./commandConfig');
    const current = await getCommandControlConfig(pool);
    const previous = current[group.controlGroup];
    const nextGroup = { ...previous, enabled: req.body.enabled === 'on' };
    for (const field of Object.keys(previous)) {
      if (field !== 'enabled' && Object.prototype.hasOwnProperty.call(req.body, field)) nextGroup[field] = req.body[field] || '';
    }
    await saveCommandControlConfig(pool, { ...current, [group.controlGroup]: nextGroup });
  }

  if (req.params.group === 'clear') {
    const allowedCleanupModes = ['both', 'bot_only', 'user_only', 'none'];
    const cleanupMode = allowedCleanupModes.includes(req.body.clearCleanupMode) ? req.body.clearCleanupMode : 'bot_only';
    await pool.query('UPDATE permissions SET clear_cleanup_mode = $1 WHERE key = $2', [cleanupMode, 'main_permissions']);
  }
  return res.redirect('/commands?saved=permissions');
});

// إدارة الصلاحيات المتقدمة
// ==========================================================================
// 🩺 /save-health — جواب قاطع على سؤال «هل الحفظ معطوب في قاعدة البيانات؟»
//
// يقرأ نوع عمود bot_settings.value مرة واحدة، لأن هذا العمود وحده هو سبب
// أشهر حالة «حفظ يبدو فاشلاً وهو ناجح»: إن كان نصاً (TEXT) عادت كل إعدادات
// الأوامر نصوصاً فأسقطتها اللوحة إلى القيم الافتراضية. لا يُعدّل شيئاً،
// ويُستخدم من شريط الحفظ عند أي شك، ومن المالك من المتصفح مباشرة.
// ==========================================================================
app.get('/save-health', requireAuth, async (req, res) => {
  let valueType = 'unknown';
  try {
    const result = await pool.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'bot_settings' AND column_name = 'value';`
    );
    valueType = (result.rows[0] && result.rows[0].data_type) || 'missing';
  } catch (error) {
    valueType = 'error';
  }
  res.json({ buildId: BUILD_ID, instanceId: INSTANCE_ID, botSettingsValueType: valueType });
});

app.get('/admin-commands', requireAuth, (req, res) => res.redirect('/commands'));
app.post('/save-admin-commands', requireAuth, (req, res) => res.redirect('/commands'));

// الإحصائيات
app.get('/stats', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT total_tickets FROM stats WHERE key = $1', ['main_stats']);
  const totalTickets = result.rows[0] ? result.rows[0].total_tickets : 0;

  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>الإحصائيات</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin:0; padding:0; }
        nav { background: #1e293b; padding: 15px 30px; display: flex; justify-content: space-between; border-bottom: 1px solid #334155; }
        nav .links a { color: #38bdf8; text-decoration: none; font-weight: bold; margin-left: 20px; }
        .container { max-width: 800px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
        h1, h2 { color: #38bdf8; }
      </style>
    </head>
    <body>
      <nav>
        <div class="links">
          <a href="/dashboard">الرئيسية 🏠</a>
          <a href="/panel">إدارة التذاكر ⚙️</a>
          <a href="/apply-setup">تقديم الإدارة 📝</a>
          <a href="/commands">إدارة الأوامر ⚡</a>
          <a href="/stats">الإحصائيات 📊</a>
          <a href="/xp-settings">الإكسبي ⭐</a>
          <a href="/xp-rewards">رتب المكافأة 🎖️</a>
          <a href="/auto-roles">الرتب التلقائية 🎭</a>
          <a href="/welcome-settings">لوحة الترحيب 👋</a>
        </div>
        <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
      </nav>
      <div class="container">
        <h1>📊 إحصائيات التذاكر للسيرفر (125K)</h1>
        <h2>إجمالي التذاكر المفتوحة بالتاريخ: <span style="color:#10b981;">${totalTickets}</span></h2>
      </div>
    </body>
    </html>
  `);
});

app.listen(process.env.PORT || 3000, () => console.log('🌐 خادم لوحة التحكم يعمل بنجاح!'));


  return app;
};
