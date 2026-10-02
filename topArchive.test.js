'use strict';

// ============================================================================
// 🗂️ أرشيف التوب — عقد ثابت (2026-10-02)
//
// ما كان يحدث فعلاً:
//   • صفحة /xp-archive تعرض أوامر جاهزة `!توب-يومي <تاريخ>` لا يعالجها البوت
//     إطلاقاً (الأسماء العربية القديمة أُلغيت مع سياسة «سلاش فقط»)، فيظن
//     صاحب البوت أن الأرشيف خربان.
//   • /top بتاريخ الأرشيف وحده يعرض التوب الكلي بصمت بلا أي تنبيه.
//
// العقد الذي يحرسه هذا الملف:
//   1) الصفحة تعرض أمر السلاش الصحيح القابل للصق: /top period:… archive:…
//   2) /top بتاريخ بلا فترة ← تنبيه صريح يطلب تحديد الفترة (لا عرض صامت)
//   3) /top بفترة وتاريخ بلا أرشيف محفوظ ← رسالة «لا يوجد أرشيف» واضحة
//   4) /top بفترة وتاريخ موجود ← يعرض صفوف الأرشيف نفسها
//   5) رسائل «$» (أوامر التكت) لا تمنح إكسبي — بينما الرسائل العادية تمنحه
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

// xp.js يُشغّل مؤقّتات دورية (فحص التصفير وأرشفة الفترات). نُزيل ارتباطها
// ببقاء العملية حتى لا ينتظر مشغّل الاختبارات انتهاءها.
const realSetTimeout = global.setTimeout;
const realSetInterval = global.setInterval;
global.setTimeout = (...args) => {
  const timer = realSetTimeout(...args);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
};
global.setInterval = (...args) => {
  const timer = realSetInterval(...args);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
};

const { commandData } = require('./slashCommands');

// ---------------------------------------------------------------------------
// أدوات مشتركة: pool وهمي + client وهمي + تفاعل سلاش وهمي
// ---------------------------------------------------------------------------
function createPool(state = {}) {
  const store = { queries: [], archiveRows: [], xpUsers: [], settings: null, ...state };
  return {
    store,
    query: async (sql, params = []) => {
      const text = String(sql);
      store.queries.push(text);
      if (/FROM xp_archive/i.test(text)) return { rows: store.archiveRows, rowCount: store.archiveRows.length };
      if (/FROM xp_users WHERE user_id = \$1/i.test(text)) {
        const row = store.xpUsers.find(user => user.user_id === params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/FROM xp_settings/i.test(text)) return { rows: store.settings ? [store.settings] : [], rowCount: store.settings ? 1 : 0 };
      if (/FROM bot_settings/i.test(text)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }
  };
}

function createClient() {
  const listeners = [];
  return {
    listeners,
    on: (event, fn) => { if (event === 'messageCreate') listeners.push(fn); },
    once: () => {},
    isReady: () => true,
    users: { fetch: async id => ({ id, username: 'سالم' }) },
    guilds: { cache: { get: () => null }, fetch: async () => null }
  };
}

function makeInteraction({ period = null, archive = null, sent }) {
  return {
    id: 'interaction-1',
    commandName: 'top',
    user: { id: '1', username: 'سالم' },
    member: { permissions: { has: () => true }, roles: { cache: { has: () => false }, highest: { comparePositionTo: () => 1 } } },
    guild: { id: '10', ownerId: '1', name: 'ON', members: { fetch: async () => null, cache: { get: () => null } } },
    options: { getString: name => (name === 'period' ? period : name === 'archive' ? archive : null) },
    isChatInputCommand: () => true,
    deferred: false,
    replied: false,
    reply: async payload => { sent.push(payload); return {}; },
    editReply: async payload => { sent.push(payload); return {}; },
    followUp: async payload => { sent.push(payload); return {}; },
    fetchReply: async () => ({ createMessageComponentCollector: () => ({ on() {} }), edit: async () => ({}) })
  };
}

// نلتقط مستمعي interactionCreate من slashCommands مباشرةً
function registerSlashCommands(client, pool) {
  const listeners = [];
  const realOn = client.on;
  client.on = (event, fn) => {
    if (event === 'interactionCreate') listeners.push(fn);
    return realOn(event, fn);
  };
  require('./slashCommands')(client, pool);
  return listeners;
}

test('‏/top بتاريخ أرشيف بلا فترة ← تنبيه صريح يطلب الفترة بدل عرض التوب الكلي', async () => {
  const state = { archiveRows: [] };
  const pool = createPool(state);
  const client = createClient();
  const listeners = registerSlashCommands(client, pool);
  const sent = [];
  await Promise.all(listeners.map(fn => fn(makeInteraction({ period: null, archive: '2026-09-21', sent }))));

  assert.equal(sent.length, 1, 'رد واحد فقط');
  assert.match(String(sent[0].content), /الفترة/, 'يطلب تحديد الفترة');
  assert.match(String(sent[0].content), /2026-09-21/, 'ويذكر التاريخ الذي كتبه');
  assert.ok(!sent[0].embeds, 'ولا يعرض أي توب');
});

test('‏/top بفترة وتاريخ موجود ← يعرض صفوف الأرشيف نفسها', async () => {
  const state = { archiveRows: [{ user_id: '11', xp: 500, rank: 1 }, { user_id: '12', xp: 250, rank: 2 }] };
  const pool = createPool(state);
  const client = createClient();
  const listeners = registerSlashCommands(client, pool);
  const sent = [];
  await Promise.all(listeners.map(fn => fn(makeInteraction({ period: 'weekly', archive: '2026-09-21', sent }))));

  const embed = sent[0] && sent[0].embeds && sent[0].embeds[0];
  assert.ok(embed, 'يُرسل إيمبد التوب');
  assert.match(embed.data.title, /أرشيف 2026-09-21/, 'العنوان يذكر الأرشيف المطلوب');
  assert.match(embed.data.description, /<@11>/, 'ويعرض صفوف الأرشيف');
});

test('‏/top بفترة وتاريخ بلا أرشيف محفوظ ← رسالة «لا يوجد أرشيف» واضحة', async () => {
  const state = { archiveRows: [] };
  const pool = createPool(state);
  const client = createClient();
  const listeners = registerSlashCommands(client, pool);
  const sent = [];
  await Promise.all(listeners.map(fn => fn(makeInteraction({ period: 'daily', archive: '2020-01-01', sent }))));

  assert.match(String(sent[0].content), /لا يوجد أرشيف/, 'رسالة صريحة لا فراغ');
  assert.match(String(sent[0].content), /2020-01-01/, 'وتذكر التاريخ');
});

test('صفحة أرشيف التوب تعرض أوامر سلاش تعمل فعلاً — لا الأسماء القديمة الميتة', async () => {
  const routes = {};
  const app = { get: (path, ...handlers) => { routes[path] = handlers[handlers.length - 1]; }, post: () => {} };
  const pool = createPool({
    archiveRows: [
      { period_type: 'daily', period_label: '2026-09-30', members: '4' },
      { period_type: 'weekly', period_label: '2026-09-21', members: '7' },
      { period_type: 'monthly', period_label: '2026-09', members: '11' }
    ]
  });
  const client = createClient();
  require('./xp')(client, pool, app);

  let body = '';
  await routes['/xp-archive']({}, { send: html => { body = html; } });

  assert.match(body, /\/top period:اليومي archive:2026-09-30/, 'أمر اليومي جاهز للصق');
  assert.match(body, /\/top period:الأسبوعي archive:2026-09-21/, 'وأمر الأسبوعي');
  assert.match(body, /\/top period:الشهري archive:2026-09/, 'وأمر الشهري');
  assert.ok(!/!توب/.test(body), 'ولا يبقى أي أمر قديم لا يعمل');
});

test('رسائل «$» (أوامر التكت) لا تمنح إكسبي — والرسائل العادية تمنحه', async () => {
  const pool = createPool({
    settings: { key: 'main_xp', xp_per_message: 15, cooldown_seconds: 0, reset_hour_utc: 0, reset_day_of_week: 1 },
    xpUsers: [{ user_id: '1', total_xp: 10, level: 1, last_message_at: 0 }]
  });
  const client = createClient();
  require('./xp')(client, pool, { get: () => {}, post: () => {} });
  const autoxp = client.listeners[0];
  assert.equal(typeof autoxp, 'function', 'مستمع الإكسبي التلقائي مسجَّل أولاً');

  const message = content => ({
    author: { bot: false, id: '1', username: 'سالم' },
    guild: { id: '10' },
    member: { id: '1' },
    channel: { id: '20', send: async () => ({}) },
    content
  });
  const grants = () => pool.store.queries.filter(sql => /UPDATE xp_users/i.test(sql)).length;

  pool.store.queries.length = 0;
  await autoxp(message('$close'));
  assert.equal(grants(), 0, '$close لا يمنح إكسبي');

  pool.store.queries.length = 0;
  await autoxp(message('!close'));
  assert.equal(grants(), 0, '!close كذلك');

  pool.store.queries.length = 0;
  await autoxp(message('مرحبا بالجميع'));
  assert.equal(grants(), 1, 'الرسالة العادية تمنح إكسبي كما هي');
});
