'use strict';

// ============================================================================
// 🗂️ تنظيم صفحة الأوامر /commands (2026-10-02)
//
// العقد الذي يفرضه هذا الملف:
//   • كل أوامر السلاش مرتّبة داخل أقسام حسب تصنيفها (لا كومة واحدة).
//   • بطاقات التكت وتبويب «التكتات» مخفية، والأوامر نفسها تبقى تعمل بلا حذف.
//   • لا تظهر أي صيغة بريفكس قديمة على البطاقات ($come · !ban · «يعمل أيضاً بـ»).
//   • أعداد التبويبات محسوبة على الخادم ومطابقة للواقع.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

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

function fetchPage(route) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get({ host: '127.0.0.1', port, path: route, headers: { cookie: authCookie } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          server.close();
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      }).on('error', error => { server.close(); reject(error); });
    });
  });
}

test.after(() => opened.forEach(server => server.close()));

let pagePromise = null;
const page = () => (pagePromise ||= fetchPage('/commands'));

test('الأوامر مرتّبة داخل أقسام تصنيف واضحة', async () => {
  const html = await page();
  const sections = [...html.matchAll(/data-category-section="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(sections, ['custom', 'system', 'admin', 'owner', 'xp', 'services', 'other'],
    'أقسام الصفحة بالترتيب المتوقَّع (المخصّصة ثم صلاحية الإدارة العامة ثم أقسام السلاش)');

  for (const slug of sections) {
    const block = html.split(`data-category-section="${slug}"`)[1].split('</section>')[0];
    const cards = [...block.matchAll(/data-command-categories="([^"]+)"/g)].map(m => m[1].split(/\s+/)[0]);
    assert.ok(cards.length > 0, `قسم ${slug} غير فارغ`);
    assert.ok(cards.every(category => category === slug), `كل بطاقة داخل قسمها الصحيح (${slug})`);
  }
  assert.ok(html.includes('⚡ أوامر السلاش'), 'عنوان قسم أوامر السلاش موجود');
});

test('شارة التصنيف تظهر على كل بطاقة سلاش', async () => {
  const html = await page();
  const slashCards = [...html.matchAll(/data-command-kind="slash"/g)].length;
  const chips = [...html.matchAll(/class="cmd-section-chip" data-section="([^"]+)"/g)].map(m => m[1]);
  assert.equal(chips.length, slashCards, 'لكل بطاقة سلاش شارة قسم واحدة');
  assert.ok(chips.every(slug => ['admin', 'owner', 'xp', 'services', 'other'].includes(slug)));
});

test('بطاقات التكت مخفية من الصفحة مع بقاء أوامرها مسجّلة', async () => {
  const html = await page();
  assert.ok(!html.includes('data-slash-command="ticket"'), 'بطاقة /ticket مخفية');
  assert.ok(!html.includes('data-slash-command="claimstats"'), 'بطاقة /claimstats مخفية');
  assert.ok(!html.includes('data-category-filter="tickets"'), 'تبويب التكتات أُزيل');
  assert.ok(!html.includes('data-command-search-text="🔒 إغلاق التذكرة"'), 'بطاقة إغلاق التذكرة مخفية');

  const { commandData } = require('./slashCommands');
  assert.ok(commandData.some(command => command.name === 'ticket'), '/ticket ما زال مسجّلاً في الكود');
  assert.ok(commandData.some(command => command.name === 'claimstats'), '/claimstats ما زال مسجّلاً في الكود');
});

test('لا صيغة بريفكس ظاهرة على أي بطاقة', async () => {
  const html = await page();
  assert.equal((html.match(/<code class="form-prefix">/g) || []).length, 0, 'لا شارة !الأمر ولا $الأمر');
  assert.ok(!html.includes('يعمل أيضاً بـ'), 'سطر «يعمل أيضاً بـ» أُزيل');
  for (const dead of ['$come', '$say', '$tax']) {
    assert.ok(!html.includes(`<code>${dead}`), `${dead} لم يعد معروضاً`);
  }
});

test('لا يظهر أي أمر مرتين: صلاحياته داخل بطاقته لا في بطاقة منفصلة', async () => {
  const html = await page();
  // بطاقة نظام واحدة فقط باقية: صلاحية الإدارة العامة (لا تخصّ أمراً بعينه).
  const systemCards = [...html.matchAll(/data-command-kind="system"/g)].length;
  assert.equal(systemCards, 1, 'بطاقة نظام واحدة (الإدارة العامة)');
  assert.ok(html.includes('data-command-kind="system" data-command-state') && html.includes('صلاحية الإدارة العامة'));

  // القسم الذي كان يكرّر الأوامر لم يعد موجوداً.
  assert.ok(!html.includes('🛡️ صلاحيات الأوامر والأنظمة'), 'قسم البطاقات المكرّرة أُزيل');
  assert.ok(!html.includes('data-permission-form="status"') || html.includes('merged-permission'), 'الصلاحيات المدمجة داخل بطاقة الأمر');

  // كل أمر كان له بطاقتان: بطاقة أمره الآن تحمل صلاحياته داخل نفس القسم.
  for (const [command, expectedBlocks] of [['botstatus', 1], ['logchannel', 1], ['role', 1], ['clan', 1], ['channel', 4]]) {
    const start = html.indexOf(`data-slash-command="${command}"`);
    assert.ok(start > 0, `بطاقة /${command} موجودة`);
    const block = html.slice(start, html.indexOf('</section>', start));
    const merged = (block.match(/class="merged-permission"/g) || []).length;
    assert.equal(merged, expectedBlocks, `/ ${command}: كتل الصلاحيات داخل بطاقته (${expectedBlocks})`);
  }
});

test('أعداد التبويبات = بطاقات أقسامها، ومجموعها = «كل الأوامر» (بلا تكرار أو نقص)', async () => {
  const html = await page();
  const counts = Object.fromEntries(
    [...html.matchAll(/data-category-filter="([^"]+)"[\s\S]*?data-category-count>(\d+)</g)].map(m => [m[1], Number(m[2])])
  );
  // كل قسم معروض له تبويب بنفس عدده بالضبط — لا رقم يخالف ما يراه المستخدم.
  const sectionCounts = Object.fromEntries(
    [...html.matchAll(/data-category-section="([^"]+)"[\s\S]*?data-group-count>(\d+) أمر</g)].map(m => [m[1], Number(m[2])])
  );
  assert.deepEqual(counts, { all: 52, custom: 4, system: 1, admin: 28, owner: 2, xp: 5, services: 9, other: 3 });
  assert.deepEqual(sectionCounts, { custom: 4, system: 1, admin: 28, owner: 2, xp: 5, services: 9, other: 3 },
    'عدّاد كل قسم ظاهر في رأسه');
  const sectionsTotal = Object.entries(counts).filter(([slug]) => slug !== 'all')
    .reduce((total, [, count]) => total + count, 0);
  assert.equal(sectionsTotal, counts.all, 'مجموع الأقسام = «كل الأوامر» (52)');

  // ولا عضوية مزدوجة: لكل بطاقة قسم واحد، ولا بطاقة بلا قسم.
  const cardCategories = [...html.matchAll(/data-command-categories="([^"]+)"/g)].map(m => m[1]);
  assert.equal(cardCategories.length, counts.all, 'لكل بطاقة قسم واحد مذكور');
  assert.ok(cardCategories.every(value => !value.includes(' ')), 'لا بطاقة تنتمي لأكثر من قسم');
  const cards = (html.match(/<section class="card cmd-card"/g) || []).length;
  assert.equal(cards, counts.all, 'عدد البطاقات المعروضة = عدد تبويب «كل الأوامر»');
});

test('دليل الأوامر العام /commands-list يعرض كل أوامر البوت الـ52 بلا نقص أو تكرار', async () => {
  const html = await fetchPage('/commands-list');
  const { commandData } = require('./slashCommands');
  const listed = [...html.matchAll(/<div class="directory-command-top"><code>\/([a-z_]+)<\/code>/g)].map(m => m[1]);

  assert.equal(listed.length, commandData.length, 'عدد أوامر الدليل = عدد أوامر البوت');
  assert.deepEqual([...listed].sort(), commandData.map(command => command.name).sort(), 'الأسماء نفسها بلا نقص');
  assert.equal(new Set(listed).size, listed.length, 'بلا تكرار');
  assert.ok(html.includes(`✨ دليل كامل: ${commandData.length} أمر`), 'الشعار يذكر العدد الكامل الصحيح');

  const groupCounts = [...html.matchAll(/command-group-count">(\d+) أوامر</g)].map(m => Number(m[1]));
  assert.equal(groupCounts.reduce((total, count) => total + count, 0), commandData.length, 'مجموع أقسام الدليل = 52');
});
