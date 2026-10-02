#!/usr/bin/env node
'use strict';
// ==========================================================================
// 👀 previewDashboard.js — تشغيل لوحة التحكم للمعاينة فقط
//
// يشغّل صفحات اللوحة ببيانات وهمية، بلا PostgreSQL وبلا اتصال بالديسكورد،
// حتى تتمكن من رؤية الصفحات وتجربة الترتيب والبحث قبل النشر.
//
// الاستخدام:  node previewDashboard.js [المنفذ]
//
// ⚠️ أداة تطوير فقط. لا تستخدمها في الإنتاج — البيانات وهمية والدخول مفتوح
//    بكلمة مرور معاينة ثابتة.
// ==========================================================================

const path = require('path');
const { createMockPool, createMockClient, applyFixedEnvironment } = require('./mockEnvironment');

applyFixedEnvironment();

// dashboard.js ينادي app.listen بنفسه على process.env.PORT، لذا نضبط المنفذ
// قبل تحميله ولا نستمع مرة ثانية (وإلا حدث تعارض EADDRINUSE).
const port = Number(process.argv[2]) || Number(process.env.PORT) || 3000;
process.env.PORT = String(port);

const root = __dirname;

// شريط تنبيه واضح في كل صفحة: هذه معاينة ببيانات وهمية، لا لوحة البوت.
// نرقّع express.response.send قبل تحميل dashboard.js: الترقيع بعد التحميل
// عبر app.use عديم الفائدة لأن المسارات تكون قد سُجّلت وتردّ قبل بلوغه.
// ترتيب التنفيذ: ترقيع dashboard الخاص بـ CSRF يعمل أولاً ثم ينادي هذا.
const expressResponse = require(path.join(root, 'node_modules', 'express')).response;
const originalSend = expressResponse.send;
const PREVIEW_BANNER =
  '<div style="position:sticky;top:0;z-index:999;background:#7b5cf0;color:#fff;'
  + 'font:600 13px/1.5 system-ui,sans-serif;text-align:center;padding:7px 12px;direction:rtl">'
  + '👀 معاينة تجريبية ببيانات وهمية — التعديلات هنا لا تصل بوتك ولا قاعدة بياناته،'
  + ' وتُفقد عند إيقاف المعاينة.</div>';
expressResponse.send = function sendWithBanner(body) {
  if (typeof body === 'string' && /<body[^>]*>/i.test(body) && !body.includes('معاينة تجريبية')) {
    return originalSend.call(this, body.replace(/(<body[^>]*>)/i, `$1${PREVIEW_BANNER}`));
  }
  return originalSend.call(this, body);
};
// persist: true ضروري — بدونه يرد الحفظ 302 «نجح» ثم تعود الحقول فارغة،
// فيبدو الحفظ معطوباً وهو سليم. الآن تُحفظ التعديلات في ذاكرة العملية
// فتتصرّف المعاينة كقاعدة بيانات حقيقية (وتُفقد عند إيقافها).
const app = require(path.join(root, 'dashboard'))(createMockPool({ persist: true }), createMockClient());


// تسجيل دخول تلقائي للمعاينة: يضع كوكي الجلسة ثم يحوّلك لصفحة الأوامر،
// حتى لا تحتاج كتابة كلمة مرور في بيئة معاينة محلية.
const dashboardAuth = require(path.join(root, 'dashboardAuth'));
app.get('/preview', (req, res) => {
  res.setHeader('Set-Cookie', `auth_pass=${dashboardAuth.makeToken()}; ${dashboardAuth.cookieAttributes(req)}`);
  res.redirect('/commands');
});

console.log('');
console.log('👀 معاينة لوحة التحكم تعمل (بيانات وهمية — لا قاعدة بيانات ولا ديسكورد)');
console.log('   التعديلات تُحفظ في الذاكرة للتجربة فقط، وتُفقد عند الإيقاف.');
console.log(`   المنفذ: ${port}`);
console.log('');
console.log('   افتح /preview  → يسجّل دخولك تلقائياً وينقلك لصفحة الأوامر');
console.log('   الصفحات: /  ·  /commands-list  ·  /commands  ·  /dashboard  ·  /panel  ·  /stats');
console.log('');
