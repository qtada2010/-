'use strict';

// ============================================================================
// ⚡ سرعة فتح الصفحات: الضغط (gzip) بدل إرسال نصف مليون حرف كما هي
//
// عطل «الصفحة بطيئة»: صفحة /commands تحمل ٦٤ بطاقة أمر ≫ حجمها ~480 ألف حرف،
// فتُرسل كما هي وتأخذ وقتاً ملحوظاً على الشبكات العادية. الحل ضغط gzip المدمج
// في Node (بلا أي اعتمادية): نفس الصفحة تصل ~45 ألفاً.
//
// هذا الملف يفتح الخادم فعلاً ويقيس: هل يخرج الرد مضغوطاً؟ وهل يُفكّ إلى نفس
// المحتوى بالحرف؟ وهل يبقى من لا يقبل الضغط يعمل كما كان؟
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const zlib = require('node:zlib');

const { createMockPool, createMockClient, applyFixedEnvironment } = require('./mockEnvironment');

applyFixedEnvironment();
process.env.PORT = '0';

const express = require('express');
const originalListen = express.application.listen;
const opened = [];
express.application.listen = function captured(...args) {
  const server = originalListen.apply(this, args);
  opened.push(server);
  server.unref();
  return server;
};
const app = require('./dashboard')(createMockPool(), createMockClient());
express.application.listen = originalListen;

const authCookie = `auth_pass=${require('./dashboardAuth').makeToken()}`;

function fetchPage(route, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get({ host: '127.0.0.1', port, path: route, headers: { cookie: authCookie, ...headers } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close();
          resolve({ headers: response.headers, raw: Buffer.concat(chunks) });
        });
      }).on('error', error => { server.close(); reject(error); });
    });
  });
}

test.after(() => opened.forEach(server => server.close()));

test('صفحة /commands تخرج مضغوطة لمن يقبل gzip', async () => {
  const { headers, raw } = await fetchPage('/commands', { 'accept-encoding': 'gzip' });

  assert.strictEqual(headers['content-encoding'], 'gzip', 'الترويسة تخبر المتصفح أنها مضغوطة');
  assert.match(headers.vary || '', /Accept-Encoding/, 'الرد يختلف بالطلب فيجب ألّا يُخزَّن خطأً');

  assert.match(headers['content-type'] || '', /text\/html/,
    'ويبقى النوع HTML حتى يعرضه المتصفح صفحة لا ملفاً');

  const html = zlib.gunzipSync(raw).toString('utf8');
  assert.ok(html.includes('<title>'), 'وبعد فكّ الضغط تصل الصفحة سليمة');
  assert.ok(html.includes('category-count'), 'وبكل محتواها');
});

test('الضغط يوفّر أغلب حجم الصفحة فعلاً', async () => {
  const { raw } = await fetchPage('/commands', { 'accept-encoding': 'gzip' });
  const plain = await fetchPage('/commands');

  const saved = 1 - raw.length / plain.raw.length;
  assert.ok(saved > 0.7,
    `الضغط يجب أن يوفّر أكثر من ٧٠٪ (وفّر ${Math.round(saved * 100)}٪ فعلاً)`);
  assert.ok(!plain.headers['content-encoding'], 'ومن لا يقبل الضغط يستلم الصفحة كما هي');
  assert.ok(plain.raw.toString('utf8').includes('<title>'));
});

test('الردود الصغيرة لا تُضغط حتى لا تكبر', async () => {
  const { headers } = await fetchPage('/login', { 'accept-encoding': 'gzip' });
  const size = Number(headers['content-length'] || 0);
  if (size && size < 1024) assert.ok(!headers['content-encoding'], 'لا ضغط تحت الكيلوبايت');
});
