#!/usr/bin/env node
'use strict';
// ==========================================================================
// 🎨 recolorTheme.js — تحويل هوية الموقع من البرونزي/الذهبي إلى البنفسجي
//
// لماذا تدوير درجة اللون بدل تبديل الألوان يدوياً؟
// الهوية الأصلية مضبوطة بعناية: كل لون له إضاءة وتشبّع محسوبان ليعطيا تبايناً
// مقروءاً مع النص والخلفية. لو بدّلنا الألوان يدوياً واحداً واحداً، سنكسر تلك
// العلاقات ونحتاج ضبط كل شيء من جديد.
//
// بدلاً من ذلك نحوّل كل لون إلى HSL، ونغيّر درجة اللون (Hue) وحدها من نطاق
// الذهبي/البرونزي إلى البنفسجي، مع إبقاء الإضاءة (Lightness) والشفافية (Alpha)
// كما هما تماماً. النتيجة: نفس التصميم بالضبط، بلون مختلف، وبنفس درجة التباين.
//
// الاستخدام:  node recolorTheme.js <ملف...>
// ==========================================================================

const fs = require('fs');

// نطاق الدرجات المعتبَر «ذهبي/برونزي» (الأصفر إلى البرتقالي)
const GOLD_HUE_MIN = 20;
const GOLD_HUE_MAX = 62;
// درجة البنفسجي المستهدفة
const PURPLE_HUE = 263;
// الحد الأدنى للتشبّع حتى يُعتبر اللون ملوَّناً لا رمادياً
const MIN_SATURATION = 0.06;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
}

/** هل هذا اللون ضمن النطاق الذهبي الذي نريد تحويله؟ */
function isGold(r, g, b) {
  const [h, s] = rgbToHsl(r, g, b);
  return s >= MIN_SATURATION && h >= GOLD_HUE_MIN && h <= GOLD_HUE_MAX;
}

/** يحوّل لوناً ذهبياً إلى نظيره البنفسجي بنفس الإضاءة */
function toPurple(r, g, b) {
  const [, s, l] = rgbToHsl(r, g, b);
  // البرونزي الأصلي هادئ التشبّع، والبنفسجي عند التشبّع نفسه يبدو باهتاً ورمادياً.
  // لذا نرفع التشبّع تدريجياً: الألوان التي كانت واضحة اللون (الإبرازات والأزرار)
  // ترتفع كثيراً لتصبح بنفسجياً حيوياً، والألوان الخافتة جداً (حدود وخلفيات شبه
  // رمادية) ترتفع قليلاً فقط حتى لا تتحول إلى بقع بنفسجية صارخة.
  const boosted = s >= 0.22
    ? Math.min(0.92, s * 1.85)   // ألوان الإبراز: بنفسجي حيوي
    : Math.min(0.40, s * 1.35);  // لمسات خافتة: تبقى هادئة
  return hslToRgb(PURPLE_HUE, boosted, l);
}

const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

let totalChanged = 0;

for (const file of process.argv.slice(2)) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = 0;

  // --- ألوان hex بست خانات ---
  source = source.replace(/#([0-9a-fA-F]{6})\b/g, (whole, hex) => {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (!isGold(r, g, b)) return whole;
    changed++;
    return toHex(...toPurple(r, g, b));
  });

  // --- ألوان hex بثلاث خانات ---
  source = source.replace(/#([0-9a-fA-F]{3})\b/g, (whole, hex) => {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if (!isGold(r, g, b)) return whole;
    changed++;
    return toHex(...toPurple(r, g, b));
  });

  // --- ألوان rgb/rgba (الشفافية تبقى كما هي حرفياً) ---
  source = source.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,[^)]*)?\)/g,
    (whole, r, g, b, alpha) => {
      const [R, G, B] = [+r, +g, +b];
      if (!isGold(R, G, B)) return whole;
      changed++;
      const [nr, ng, nb] = toPurple(R, G, B);
      return alpha ? `rgba(${nr},${ng},${nb}${alpha})` : `rgb(${nr},${ng},${nb})`;
    });

  fs.writeFileSync(file, source);
  totalChanged += changed;
  console.log(`🎨 ${file} — حُوّل ${changed} لون`);
}

console.log(`\n✅ الإجمالي: ${totalChanged} لون ذهبي → بنفسجي (الإضاءة والشفافية كما هي).`);
