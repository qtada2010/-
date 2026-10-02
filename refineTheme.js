#!/usr/bin/env node
'use strict';

// ============================================================================
// 🎨 refineTheme.js — تهذيب لوحة ألوان الموقع
//
// المشكلة التي يحلّها:
// التحويل الأول للبنفسجي تمّ بتدوير درجة اللون وحدها، فخرجت 38 لوناً كلها
// على 263° بالضبط. النتيجة ثلاث عِلل بصرية:
//
//   ١) رتابة: لا تدرّج في الدرجة إطلاقاً، فالصفحة تبدو مسطّحة بلا عمق.
//   ٢) رماديات موحلة: ألوان الخلفيات والحدود كانت مصبوغة بنفسجياً بنسبة
//      14–25%، والرمادي المصبوغ في الإضاءة المنخفضة يُقرأ «متّسخاً» لا أنيقاً.
//   ٣) تشبّع زائد: نصوص وحدود بتشبّع 92–100% عند إضاءة عالية = لون باهت
//      فاقع يرهق العين ويضعف التباين مع الخلفية.
//
// العلاج (كله على قناة التشبّع والدرجة، والإضاءة تبقى كما هي حرفياً
// فلا تنكسر أي علاقة تباين مضبوطة):
//
//   • المحايدات (تشبّع ≤ 30%)  → تشبّع 4–6% فقط: رمادي نظيف بلمسة برودة.
//   • الألوان المميِّزة          → تدرّج درجة حسب الإضاءة (248°→268°) فتكتسب
//                                 الصفحة عمقاً، وسقف تشبّع 78% يمنع الفقع.
//   • النصوص الفاتحة جداً       → شبه محايدة، فالأبيض يبقى أبيض.
//
// ملاحظة: هذه أداة تهذيب تُشغَّل مرة واحدة، وليست قاعدة تُفرض باستمرار.
// بعد تشغيلها ضُبطت ألوان الهوية الثلاثة يدوياً (--accent و --accent-soft
// و --accent-deep) لأن الحساب وحده يعطي بنفسجياً صحيحاً لكن بلا روح.
// لذلك إعادة تشغيلها بـ --dry ستقترح تعديل تلك الألوان مجدداً — تجاهِل ذلك،
// فهي اختيارات مقصودة لا انحراف.
//
// الاستعمال: node refineTheme.js [--dry]
// ============================================================================

const fs = require('fs');
const path = require('path');

const THEME_FILE = path.join(__dirname, 'siteTheme.js');
const dryRun = process.argv.includes('--dry');

// -------------------------- تحويلات الألوان --------------------------------

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0));
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = t => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(v => Math.round(v * 255));
}

const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');

// -------------------------- قاعدة التهذيب ----------------------------------

/**
 * درجة اللون تتدرّج مع الإضاءة: الظلال أعمق برودة والإضاءات أدفأ قليلاً.
 * هذا التدرّج البسيط هو ما يعطي الصفحة إحساس العمق بدل اللون الواحد المسطّح.
 */
function hueForLightness(lightness) {
  const DEEP = 268;   // الظلال الغامقة
  const LIGHT = 250;  // الإبرازات الفاتحة
  return DEEP + (LIGHT - DEEP) * Math.min(1, Math.max(0, lightness));
}

// 🚦 ألوان ذات معنى ثابت لا يجوز المساس بها: الأحمر للخطر والحذف، الأخضر
//    للنجاح، الكهرماني للتحذير، السماوي للمعلومات. تحويلها إلى بنفسجي يمحو
//    الإشارة التي يعتمد عليها المستخدم لتمييز زر الحذف من زر الحفظ.
const BRAND_HUE_MIN = 235;
const BRAND_HUE_MAX = 295;
const isBrandHue = h => h >= BRAND_HUE_MIN && h <= BRAND_HUE_MAX;
// الرماديات الباردة قد تميل قليلاً خارج نطاق الهوية (228° مثلاً) فنوسّع لها.
const isCoolNeutralHue = h => h >= 200 && h <= 300;

function refine(hex) {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));

  // رمادي خالص تماماً: مقصود (أسود/أبيض صريح)
  if (s < 0.02) return hex;

  // محايد بارد: نقرّبه من الرمادي النظيف مع لمسة برودة خفيفة جداً
  if (s <= 0.30) {
    if (!isCoolNeutralHue(h)) return hex; // رمادي مائل للأحمر = خلفية خطر، يبقى
    const target = l > 0.88 ? 0.03 : 0.055;
    return toHex(hslToRgb(258, Math.min(s, target), l));
  }

  // لون مشبع خارج عائلة الهوية = لون دلالي، لا نلمسه
  if (!isBrandHue(h)) return hex;

  // عائلة الهوية: تدرّج في الدرجة + سقف تشبّع يمنع الفقع
  const cap = l > 0.80 ? 0.52 : 0.78;
  return toHex(hslToRgb(hueForLightness(l), Math.min(s, cap), l));
}

// -------------------------- التطبيق ----------------------------------------

const source = fs.readFileSync(THEME_FILE, 'utf8');
const changes = [];

const updated = source.replace(/#[0-9a-fA-F]{6}\b/g, match => {
  const next = refine(match.toLowerCase());
  if (next.toLowerCase() !== match.toLowerCase()) changes.push([match, next]);
  return next;
});

const unique = new Map();
changes.forEach(([from, to]) => unique.set(from.toLowerCase(), to));

console.log(`🎨 تهذيب ألوان الثيم${dryRun ? ' (تجربة فقط)' : ''}`);
console.log(`   ألوان فريدة عُدِّلت: ${unique.size}`);
console.log(`   إجمالي المواضع   : ${changes.length}`);
console.log('');
for (const [from, to] of unique) {
  const [h1, s1, l1] = rgbToHsl(...hexToRgb(from));
  const [h2, s2, l2] = rgbToHsl(...hexToRgb(to));
  console.log(`   ${from} → ${to}   تشبّع ${String(Math.round(s1 * 100)).padStart(3)}%→${String(Math.round(s2 * 100)).padStart(3)}%   درجة ${String(Math.round(h1)).padStart(3)}→${String(Math.round(h2)).padStart(3)}   إضاءة ${Math.round(l1 * 100)}% (ثابتة)`);
}

if (!dryRun) {
  fs.writeFileSync(THEME_FILE, updated);
  console.log('\n✅ حُفظ siteTheme.js');
} else {
  console.log('\n(لم يُكتب شيء — تجربة فقط)');
}
