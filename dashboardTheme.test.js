'use strict';
// ==========================================================================
// اختبارات الثيم الداكن — تضمن أن كل صفحة في لوحة التحكم تخرج بخلفية داكنة.
//
// خلفية الحكاية: الميدلوير الذي يحقن الثيم كان يتخطّى أي صفحة يرد فيها النص
// «site-luxe-theme»، حتى لو ورد داخل تعليق CSS. وصفحة /commands تذكره في
// تعليق توضيحي، فكانت تخرج بلا ثيم إطلاقاً — أي بخلفية المتصفح البيضاء.
// هذه الاختبارات تمنع عودة ذلك الخطأ بأي صيغة.
// ==========================================================================
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

const {
  createMockPool, createMockClient, applyFixedEnvironment
} = require('./mockEnvironment');

applyFixedEnvironment();
process.env.PORT = '0'; // dashboard.js يستمع عند التحميل — منفذ حر عشوائي

// dashboard.js ينادي app.listen بنفسه عند التحميل، وذلك الخادم يُبقي العملية
// حيّة فلا ينتهي الاختبار أبداً. نلتقط الخادم أثناء إنشائه ثم نرفع عنه
// التثبيت (unref) حتى لا يمنع خروج العملية — دون تعديل dashboard.js نفسه.
const express = require('express');
const originalListen = express.application.listen;
const openedServers = [];
express.application.listen = function capturedListen(...args) {
  const server = originalListen.apply(this, args);
  openedServers.push(server);
  server.unref();
  return server;
};

const app = require('./dashboard')(createMockPool(), createMockClient());

express.application.listen = originalListen;

const dashboardAuth = require('./dashboardAuth');
const authCookie = `auth_pass=${dashboardAuth.makeToken()}`;

// كل الصفحات التي تُرجع HTML كاملاً للمستخدم
const PAGES = [
  '/', '/commands-list', '/login', '/dashboard', '/panel',
  '/edit-panel/1', '/apply-setup', '/commands', '/stats'
];

function fetchPage(port, route) {
  return new Promise(resolve => {
    http.get({ host: '127.0.0.1', port, path: route, headers: { cookie: authCookie } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  });
}

test('كل صفحات اللوحة تُحقن بالثيم الداكن', async t => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    for (const route of PAGES) {
      const html = await fetchPage(port, route);

      await t.test(`${route} فيها وسم الثيم`, () => {
        assert.ok(
          html.includes('<style id="site-luxe-theme">'),
          `صفحة ${route} خرجت بلا ثيم داكن — ستظهر بخلفية المتصفح البيضاء.`
        );
      });

      await t.test(`${route} خلفيتها داكنة`, () => {
        // نتحقّق من المعنى لا من قيمة بعينها: المطلوب أن تكون الخلفية داكنة
        // فعلاً. تثبيت كود لوني حرفي يجعل الاختبار يفشل عند أي تحسين للوحة
        // الألوان رغم أن الصفحة سليمة تماماً — وهذا إنذار كاذب لا حماية.
        const ink = html.match(/--ink:\s*(#[0-9a-fA-F]{6})/);
        assert.ok(ink, `صفحة ${route} لا تعرّف متغيّر لون الخلفية --ink.`);
        const [r, g, b] = [1, 3, 5].map(i => parseInt(ink[1].slice(i, i + 2), 16));
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        assert.ok(
          luminance < 0.2,
          `خلفية صفحة ${route} (${ink[1]}) ليست داكنة — سطوعها ${luminance.toFixed(3)} والمطلوب أقل من 0.2.`
        );
        assert.match(html, /background-color:var\(--ink\)/, `صفحة ${route} لا تطبّق الخلفية الداكنة على body.`);
      });
    }
  } finally {
    server.close();
    openedServers.forEach(opened => opened.close());
  }
});

test('ذكر اسم الثيم داخل تعليق لا يمنع حقنه', () => {
  // هذا هو جوهر الخطأ السابق: الحارس كان يبحث عن النص المجرّد.
  // الآن يبحث عن الوسم نفسه، فالذكر في تعليق لا يخدعه.
  const source = require('node:fs').readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
  assert.ok(
    source.includes(`!body.includes('id="site-luxe-theme"')`),
    'حارس حقن الثيم يجب أن يفحص الوسم id="site-luxe-theme" لا النص المجرّد.'
  );
});
