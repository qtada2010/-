'use strict';

// ============================================================================
// ⏱️ تحليل المدد الزمنية — مصدر واحد لكل أوامر البوت
//
// يقبل:
//   30      → 30 دقيقة   (رقم مجرّد = دقائق، للتوافق مع كل ما كُتب سابقاً)
//   30m     → 30 دقيقة
//   2h      → ساعتان
//   7d      → سبعة أيام
//   1w      → أسبوع
//   1h30m   → ساعة ونصف  (تركيب عدة وحدات)
//   دائم    → بلا نهاية (null)
//
// الوحدات بالعربية مدعومة أيضاً: د/دقيقة · س/ساعة · ي/يوم · ا/اسبوع
//
// 📌 قرار التوافق: الرقم المجرّد يبقى دقائق كما كان دائماً، فكل من اعتاد
//    «!ban @عضو 60» يحصل على النتيجة نفسها تماماً بعد هذا التغيير.
// ============================================================================

const MINUTE = 1;
const HOUR = 60;
const DAY = 60 * 24;
const WEEK = DAY * 7;

// الترتيب مهم: الوحدات الأطول حرفياً أولاً حتى لا تبتلع الأقصر جزءاً منها.
const UNITS = Object.freeze({
  دقيقة: MINUTE, دقائق: MINUTE, د: MINUTE,
  ساعات: HOUR, ساعة: HOUR, س: HOUR,
  اسبوع: WEEK, أسبوع: WEEK, اسابيع: WEEK, أسابيع: WEEK,
  يوم: DAY, ايام: DAY, أيام: DAY, ي: DAY,
  minutes: MINUTE, minute: MINUTE, mins: MINUTE, min: MINUTE, m: MINUTE,
  hours: HOUR, hour: HOUR, hrs: HOUR, hr: HOUR, h: HOUR,
  days: DAY, day: DAY, d: DAY,
  weeks: WEEK, week: WEEK, w: WEEK
});

// كلمات تعني «بلا مدة» أي حظر/كتم دائم
const PERMANENT_WORDS = Object.freeze(['دائم', 'نهائي', 'ابدي', 'أبدي', 'perm', 'permanent', 'forever', 'inf', 'infinite']);

/** تطبيع عربي خفيف: توحيد الهمزات والألف المقصورة وحذف التشكيل */
function normalizeArabic(text) {
  return String(text)
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

// 🛠️ المفاتيح أعلاه مكتوبة بصيغتها الطبيعية («ساعة»)، لكن المقارنة تتم بعد
// التطبيع الذي يحوّل ة→ه. لذا نبني خريطة مطبَّعة مرة واحدة، وإلا فشل «2ساعة»
// لأن «ساعه» المطبَّعة لا توجد بين المفاتيح الأصلية.
const NORMALIZED_UNITS = Object.freeze(Object.fromEntries(
  Object.entries(UNITS).map(([key, value]) => [normalizeArabic(key).toLowerCase(), value])
));

/**
 * يحوّل نص مدة إلى دقائق.
 *
 * @param {string|number} input النص المكتوب
 * @returns {{minutes:number|null, permanent:boolean, ok:boolean, reason?:string}}
 *   ok=false يعني النص غير مفهوم ويجب عرض إرشاد للعضو.
 *   permanent=true يعني «بلا نهاية» (minutes=null).
 */
function parseDuration(input) {
  if (input === null || input === undefined || input === '') {
    return { minutes: null, permanent: false, ok: true };
  }

  // رقم خالص (بما فيه القادم من خيار سلاش رقمي) = دقائق
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0
      ? { minutes: Math.floor(input), permanent: false, ok: true }
      : { minutes: null, permanent: false, ok: false, reason: 'الرقم يجب أن يكون أكبر من صفر.' };
  }

  const raw = String(input).trim();
  if (!raw) return { minutes: null, permanent: false, ok: true };

  const normalized = normalizeArabic(raw).toLowerCase().replace(/\s+/g, '');

  if (PERMANENT_WORDS.some(word => normalizeArabic(word).toLowerCase() === normalized)) {
    return { minutes: null, permanent: true, ok: true };
  }

  // رقم مجرّد → دقائق (التوافق الخلفي)
  if (/^\d+$/.test(normalized)) {
    const value = Number(normalized);
    return value > 0
      ? { minutes: value, permanent: false, ok: true }
      : { minutes: null, permanent: false, ok: false, reason: 'المدة يجب أن تكون أكبر من صفر.' };
  }

  // تركيب: رقم+وحدة، مكرر (2h30m)
  const pattern = /(\d+)\s*([a-z\u0600-\u06FF]+)/g;
  let total = 0;
  let matched = 0;
  let consumed = 0;
  let match;

  while ((match = pattern.exec(normalized)) !== null) {
    const amount = Number(match[1]);
    const unitKey = match[2];
    const unit = NORMALIZED_UNITS[unitKey];
    if (unit === undefined) {
      return { minutes: null, permanent: false, ok: false, reason: `الوحدة \`${match[2]}\` غير معروفة.` };
    }
    total += amount * unit;
    matched += 1;
    consumed += match[0].length;
  }

  // أي حرف زائد خارج الأنماط المفهومة = خطأ مطبعي، لا نخمّن.
  if (!matched || consumed !== normalized.length) {
    return { minutes: null, permanent: false, ok: false, reason: 'صيغة المدة غير مفهومة.' };
  }
  if (total <= 0) {
    return { minutes: null, permanent: false, ok: false, reason: 'المدة يجب أن تكون أكبر من صفر.' };
  }

  return { minutes: total, permanent: false, ok: true };
}

/** يعرض المدة بالعربية: 90 → «ساعة و30 دقيقة» */
function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return 'دائم';
  let rest = Math.max(0, Math.floor(minutes));
  const parts = [];
  const push = (count, one, two, many) => {
    if (!count) return;
    if (count === 1) parts.push(one);
    else if (count === 2) parts.push(two);
    else if (count <= 10) parts.push(`${count} ${many}`);
    else parts.push(`${count} ${one}`);
  };
  const days = Math.floor(rest / DAY); rest -= days * DAY;
  const hours = Math.floor(rest / HOUR); rest -= hours * HOUR;
  push(days, 'يوم', 'يومان', 'أيام');
  push(hours, 'ساعة', 'ساعتان', 'ساعات');
  push(rest, 'دقيقة', 'دقيقتان', 'دقائق');
  return parts.length ? parts.join(' و') : 'أقل من دقيقة';
}

/** سطر مساعدة موحّد يُعرض في الإيمبد والأوصاف */
const DURATION_HINT = 'أمثلة: `30` دقيقة · `2h` ساعتان · `7d` أسبوع · `1h30m` · `دائم`';

module.exports = { parseDuration, formatDuration, DURATION_HINT, UNITS };
