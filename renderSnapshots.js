#!/usr/bin/env node
'use strict';
// ==========================================================================
// 🔬 renderSnapshots.js — أداة تحقّق (ليست جزءاً من تشغيل البوت)
//
// الغرض: التقاط ناتج HTML لكل صفحة في لوحة التحكم باستخدام قاعدة بيانات
// وهمية وعميل ديسكورد وهمي، وحفظه في مجلد لقطات. بتشغيلها قبل أي تعديل
// وبعده، نستطيع مقارنة الناتج سطراً بسطر والتأكد أن التعديل لم يغيّر
// أي شيء غير المقصود تغييره.
//
// الاستخدام:
//   node renderSnapshots.js <مجلد-الإخراج>
//
// مثال:
//   node renderSnapshots.js .snapshots/before
//   node renderSnapshots.js .snapshots/after
//   diff -ru .snapshots/before .snapshots/after
// ==========================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createMockPool, createMockClient, applyFixedEnvironment } = require('./mockEnvironment');

const outDir = process.argv[2];
if (!outDir) {
  console.error('الاستخدام: node renderSnapshots.js <مجلد-الإخراج>');
  process.exit(1);
}

// قيم بيئة ثابتة حتى تكون اللقطات قابلة للتكرار بالضبط
applyFixedEnvironment();

// --------------------------------------------------------------------------
// البيئة الوهمية (قاعدة بيانات + عميل ديسكورد) تأتي من mockEnvironment.js
// حتى يستخدم هذا الملف وأداة المعاينة التعريف نفسه بالضبط.
// --------------------------------------------------------------------------
const pool = createMockPool();
const client = createMockClient();

// dashboard.js ينادي app.listen على process.env.PORT عند تحميله. نضبطه على 0
// (منفذ حر عشوائي) حتى لا تتعارض اللقطات مع أي خادم آخر يعمل على 3000.
process.env.PORT = '0';

// --------------------------------------------------------------------------
// بناء التطبيق كما يبنيه index.js (نفس الترتيب) دون تسجيل الدخول للديسكورد
// --------------------------------------------------------------------------
const app = require(path.resolve(__dirname, 'dashboard'))(pool, client);

// المسارات التي تُرجع صفحات HTML (GET فقط — لا نُجري أي POST حتى لا نغيّر شيئاً)
const ROUTES = [
  '/',
  '/commands-list',
  '/login',
  '/dashboard',
  '/panel',
  '/edit-panel/1',
  '/edit-option/1/1',
  '/apply-setup',
  '/commands',
  '/commands?saved=tax',
  '/commands?saved=permissions',
  '/stats'
];

const dashboardAuth = require(path.resolve(__dirname, 'dashboardAuth'));
const authCookie = `auth_pass=${dashboardAuth.makeToken()}`;

function fileNameFor(route) {
  return (route === '/' ? 'root' : route.replace(/^\//, '').replace(/[/?=&]/g, '_')) + '.html';
}

const server = http.createServer(app);

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  fs.mkdirSync(outDir, { recursive: true });

  for (const route of ROUTES) {
    const body = await new Promise(resolve => {
      http.get({ host: '127.0.0.1', port, path: route, headers: { cookie: authCookie } }, response => {
        // ⚠️ نجمع Buffers ثم نحوّلها دفعة واحدة. الجمع النصي المباشر (data += chunk)
        // يكسر الحروف العربية التي تقع على حدود chunkين، فتظهر فروق وهمية في المقارنة.
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve(`HTTP ${response.statusCode}\n${Buffer.concat(chunks).toString('utf8')}`));
      }).on('error', err => resolve(`REQUEST ERROR: ${err.message}`));
    });
    fs.writeFileSync(path.join(outDir, fileNameFor(route)), body);
    console.log(`📸 ${route}  →  ${fileNameFor(route)}  (${body.length} حرف)`);
  }

  server.close();
  process.exit(0);
});
