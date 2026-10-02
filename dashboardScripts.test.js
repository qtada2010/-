'use strict';
// ==========================================================================
// 🛡️ حارس سكربتات لوحة التحكم
//
// خلفية الحكاية (خطأ حقيقي وقع وكسر اللوحة بالكامل):
// سكربت الصفحة مكتوب داخل قالب نصي (template literal) في dashboard.js.
// القالب النصي يبتلع الشرطة المائلة العكسية المفردة: ما تكتبه `\/` يصل
// المتصفح كـ `/`. فتحوّل التعبير النمطي
//        /^https:\/\/[^\s<>"']+$/i
// عند الإرسال إلى
//        /^https://[^s<>"']+$/i
// وهذا خطأ صياغي يُسقط **سكربت الصفحة كله**. النتيجة التي رآها المستخدم:
// اللوحة تفتح وتبدو سليمة، لكن لا شيء يستجيب وعدّاد الأوامر صفر — لأن
// applyFilters() لم يُنفَّذ إطلاقاً.
//
// لماذا لم يمسكه شيء؟ لأن `node -c dashboard.js` يفحص الملف لا الصفحة
// المُولَّدة؛ السكربت بالنسبة له مجرد نص داخل قالب. وفحص اللقطات يقارن
// النصوص ولا ينفّذها. فكانت هناك فجوة كاملة.
//
// هذا الملف يسدّها: يطلب كل صفحة فعلياً، يستخرج كل <script> منها،
// ويفحص صياغته. أي حرف هروب يضيع في القالب النصي سيفشل هنا فوراً.
// ==========================================================================
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const vm = require('node:vm');

const { createMockPool, createMockClient, applyFixedEnvironment } = require('./mockEnvironment');

applyFixedEnvironment();
process.env.PORT = '0'; // dashboard.js يستمع عند التحميل — منفذ حر عشوائي

// نفس حيلة dashboardTheme.test.js: dashboard.js ينادي app.listen بنفسه،
// وذلك الخادم يُبقي العملية حيّة فلا ينتهي الاختبار. نلتقطه ونرفع التثبيت.
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

const authCookie = `auth_pass=${require('./dashboardAuth').makeToken()}`;

const PAGES = [
  '/', '/commands-list', '/login', '/dashboard', '/panel',
  '/edit-panel/1', '/edit-option/1/1', '/apply-setup', '/commands', '/stats'
];

function fetchPage(port, route) {
  return new Promise(resolve => {
    http.get({ host: '127.0.0.1', port, path: route, headers: { cookie: authCookie } }, response => {
      // ⚠️ Buffer.concat إلزامي: تجميع النص بـ `data += chunk` يقطع الحروف
      // العربية متعددة البايت عند حدود الأجزاء ويحوّلها إلى U+FFFD.
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  });
}

const extractScripts = html =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);

test('كل سكربت داخل صفحات اللوحة صالح صياغياً', async t => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  let totalScripts = 0;
  try {
    for (const route of PAGES) {
      const html = await fetchPage(port, route);
      const scripts = extractScripts(html);

      await t.test(`${route} — ${scripts.length} سكربت`, () => {
        scripts.forEach((source, index) => {
          totalScripts += 1;
          assert.doesNotThrow(
            () => new vm.Script(source),
            `سكربت رقم ${index + 1} في ${route} مكسور صياغياً — الصفحة ستفتح لكن لا شيء فيها سيعمل.`
          );
        });
      });
    }

    await t.test('الصفحات فعلاً تحتوي سكربتات (الفحص ليس فارغاً)', () => {
      assert.ok(totalScripts >= 3, `عدد السكربتات المفحوصة ${totalScripts} — الاستخراج معطّل على ما يبدو.`);
    });
  } finally {
    server.close();
    openedServers.forEach(opened => opened.close());
  }
});

test('التعبيرات النمطية تصل المتصفح بشرطاتها سليمة', async t => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const html = await fetchPage(port, '/commands');
    const source = extractScripts(html).join('\n');

    await t.test('فحص https في معاينة الإنذار سليم ويعمل', () => {
      const match = /const safeUrl = value => (\/\^https[^\n]*?)\.test/.exec(source);
      assert.ok(match, 'لم أجد تعبير فحص الرابط في الصفحة.');

      // نبنيه فعلياً ونختبر سلوكه — لا نكتفي بأن الصياغة لم ترمِ خطأ.
      const pattern = new vm.Script(`(${match[1]})`).runInNewContext();
      assert.equal(pattern.test('https://cdn.discordapp.com/a.png'), true, 'رابط https صالح يجب أن يُقبل');
      assert.equal(pattern.test('javascript:alert(1)'), false, 'javascript: يجب أن يُرفض');
      assert.equal(pattern.test('http://x.com/a.png'), false, 'http غير المشفّر يجب أن يُرفض');
      assert.equal(pattern.test('https://x.com/a b'), false, 'الرابط بمسافة يجب أن يُرفض');
    });

    await t.test('لا يوجد تسلسل هروب ضائع داخل أي تعبير نمطي', () => {
      // `//` داخل تعبير نمطي يعني أن `\/\/` فقدت شرطاتها في القالب النصي.
      const broken = source.split('\n').filter(line => /=\s*\/\^[^\n]*:\/\//.test(line));
      assert.deepEqual(broken, [], `أسطر فقدت شرطاتها المائلة:\n${broken.join('\n')}`);
    });
  } finally {
    server.close();
    openedServers.forEach(opened => opened.close());
  }
});
