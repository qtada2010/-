'use strict';

// ============================================================================
// اختبارات سياسة البريفكس الجديدة (2026-10-02)
//
// العقد:
//   !ban / $come      ← مرفوض بصمت تام: لا رد إطلاقاً من البوت
//   !close !save !add ← تعمل كما هي: أوامر التذكرة مستثناة بقرار المالك
//   لف (اختصار مجرّد)  ← يعمل: المحذوف هو البريفكس لا الاختصار
//   !كلمة عادية        ← لا يرد البوت إطلاقاً
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { PREFIX_KEPT, isPrefixBlocked } = require('./prefixPolicy');
const registerSlashPrefix = require('./slashPrefix');
const { commandData } = require('./slashCommands');

const CONFIG = {
  globalRoleIds: [],
  commands: Object.fromEntries(commandData.map(command => [command.name, {
    enabled: true,
    aliases: command.name === 'ban' ? ['لف'] : [],
    roleIds: [], userIds: []
  }]))
};

function createHarness() {
  const pool = {
    query: async sql => String(sql).includes('bot_settings')
      ? { rows: [{ key: 'slash_command_config', value: CONFIG }] }
      : { rows: [], rowCount: 0 }
  };
  const listeners = [];
  const client = { on: (event, fn) => { if (event === 'messageCreate') listeners.push(fn); } };
  const executed = [];
  registerSlashPrefix(client, pool, commandData, async interaction => { executed.push(interaction.commandName); });
  return { listeners, executed };
}

const user = { id: '7', username: 'سالم' };

function makeMessage(content) {
  const replies = [];
  return {
    replies,
    message: {
      author: { bot: false, id: '555', username: 'سالم' },
      guild: {
        id: '1', name: 'ON',
        members: { cache: { find: () => null }, fetch: async () => ({ user, id: '7' }) },
        roles: { cache: { find: () => null } },
        channels: { cache: { find: () => null } }
      },
      channel: { id: '2' }, member: {}, content, id: '9',
      mentions: { users: { find: () => user } },
      client: { users: { fetch: async () => user } },
      reply: async payload => { replies.push(payload); return {}; }
    }
  };
}

async function send(content) {
  const harness = createHarness();
  const { message, replies } = makeMessage(content);
  for (const listener of harness.listeners) await listener(message);
  await new Promise(resolve => setTimeout(resolve, 60));
  return { replies, executed: harness.executed };
}

test('كل أمر له سلاش ممنوع بالبريفكس — حتى $come و$say و$tax', () => {
  for (const name of ['ban', 'kick', 'come', 'say', 'tax', 'top', 'profile', 'clan', 'ticket', 'claimstats']) {
    assert.equal(isPrefixBlocked(name), true, `«${name}» يجب أن يكون سلاش فقط`);
  }
});

test('أوامر التذكرة وسجل الاستلام تبقى بالبريفكس (استثناء المالك)', () => {
  for (const name of PREFIX_KEPT) {
    assert.equal(isPrefixBlocked(name), false, `«${name}» يجب أن يبقى يعمل بالبريفكس`);
  }
});

test('أوامر النظام والإكسبي والكلانات القديمة صارت سلاش فقط', () => {
  for (const name of ['رول', 'الحالة', 'الحالة2', 'logowner', 'كلان', 'تقديم-كلان', 'اضافة-اكسبي', 'معلوماتي']) {
    assert.equal(isPrefixBlocked(name), true, `«${name}» يجب أن يكون سلاش فقط`);
  }
});

test('الكلمات العادية لا تُحجب — لا رد على المحادثات', () => {
  for (const name of ['مرحبا', 'hello', 'شلونكم', '']) {
    assert.equal(isPrefixBlocked(name), false);
  }
});

test('!ban مرفوض بصمت — لا ينفّذ ولا يرد إطلاقاً', async () => {
  const { replies, executed } = await send('!ban <@7>');
  assert.deepEqual(executed, [], 'لا يُنفَّذ عبر البريفكس');
  assert.equal(replies.length, 0, 'لا رد: البريفكس انتهى ونسيناه');
});

test('اختصار المالك يعمل مجرّداً وبكل صيغ البريفكس', async () => {
  for (const content of ['لف <@7>', '!لف <@7>', '$لف <@7>']) {
    const { executed, replies } = await send(content);
    assert.deepEqual(executed, ['ban'], `«${content}» يجب أن يشغّل الأمر`);
    assert.equal(replies.length, 0, `«${content}» لا يستدعي رداً`);
  }
});

test('$come لا يحرّك مسار السلاش ويُترك لمستمع messageCreate ليرد بالتوجيه', async () => {
  const { replies, executed } = await send('$come <@7>');
  assert.deepEqual(executed, []);
  assert.equal(replies.length, 0, 'مسؤولية الرد على $come في messageCreate');
});

test('$come و$say و$tax صامتة تماماً في messageCreate: لا رد ولا استعلام', async () => {
  const registerMessageCreateEvent = require('./messageCreate');
  const hits = [];
  const queries = [];
  const pool = { query: async sql => { queries.push(String(sql)); return { rows: [], rowCount: 0 }; } };
  const listeners = [];
  const client = { on: (event, fn) => { if (event === 'messageCreate') listeners.push(fn); } };
  const helpers = {
    hasAdminCommandPermission: async () => true,
    getTicketInfo: async () => null,
    resolveTicketSettings: () => ({}),
    saveTranscript: async () => true,
    resolveExplicitTarget: async () => null
  };
  registerMessageCreateEvent(client, pool, '!', '$', {}, helpers);
  const run = async content => {
    hits.length = 0;
    await listeners[0]({
      author: { bot: false, id: '5', username: 'سالم' }, guild: { id: '1' },
      content, member: {}, channel: { id: '2', toString: () => '<#2>' },
      reply: async payload => { hits.push(payload); return {}; }, delete: async () => {}
    });
    return hits[0];
  };

  const come = await run('$come <@7>');
  assert.equal(come, undefined, '$come لا يرد إطلاقاً');
  assert.equal(queries.length, 0, 'لا يُنفَّذ أي استعلام: الرفض قبل قاعدة البيانات');

  assert.equal(await run('$say مرحبا'), undefined, '$say لا يرد إطلاقاً');
  assert.equal(await run('$tax 100'), undefined, '$tax لا يرد إطلاقاً');
});

test('أوامر التكت تظل تعبر بوابة السلاش فقط إلى مسارها القديم (!close)', async () => {
  const registerMessageCreateEvent = require('./messageCreate');
  const hits = [];
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const listeners = [];
  const client = { on: (event, fn) => { if (event === 'messageCreate') listeners.push(fn); } };
  const helpers = {
    hasAdminCommandPermission: async () => true,
    getTicketInfo: async () => null,
    resolveTicketSettings: () => ({}),
    saveTranscript: async () => true,
    resolveExplicitTarget: async () => null
  };
  registerMessageCreateEvent(client, pool, '!', '$', {}, helpers);
  await listeners[0]({
    author: { bot: false, id: '5', username: 'سالم' }, guild: { id: '1' },
    content: '!close', member: {}, channel: { id: '2', toString: () => '<#2>' },
    reply: async payload => { hits.push(payload); return {}; }, delete: async () => {}
  });
  assert.equal(hits.length, 0, 'لم يُرفض كسلاش فقط بل وصل لمسار التكت (خارج تذكرة = لا رد)');
});

test('اختصار المالك لأمر الاستدعاء يعمل بـ «!» و«$» — والاسم الرسمي يبقى صامتاً', async () => {
  const registerMessageCreateEvent = require('./messageCreate');
  const hits = [];
  const pool = { query: async sql => {
    const text = String(sql);
    if (text.includes('bot_settings')) {
      return { rows: [{ key: 'command_come_config', value: { enabled: true, aliases: ['تاكسي', 'استدعاء سريع'] } }], rowCount: 1 };
    }
    if (text.includes('permissions')) return { rows: [{ come_role_id: '' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  } };
  const listeners = [];
  const client = { on: (event, fn) => { if (event === 'messageCreate') listeners.push(fn); } };
  const helpers = {
    hasAdminCommandPermission: async () => true,
    getTicketInfo: async () => null,
    resolveTicketSettings: () => ({}),
    saveTranscript: async () => true,
    resolveExplicitTarget: async () => null
  };
  registerMessageCreateEvent(client, pool, '!', '$', {}, helpers);
  const run = async content => {
    hits.length = 0;
    await listeners[0]({
      author: { bot: false, id: '5', username: 'سالم' }, guild: { id: '1' },
      content, member: {}, channel: { id: '2', toString: () => '<#2>' },
      reply: async payload => { hits.push(payload); return {}; }, delete: async () => {}
    });
    return hits;
  };

  assert.equal((await run('$come <@7>')).length, 0, '$come الرسمي يبقى صامتاً');
  assert.equal((await run('!come <@7>')).length, 0, '!come الرسمي يبقى صامتاً');
  assert.ok((await run('$تاكسي <@7>')).length > 0, 'اختصار المالك يعمل بـ $');
  assert.ok((await run('!تاكسي <@7>')).length > 0, 'واختصار المالك يعمل بـ !');
  assert.ok((await run('تاكسي <@7>')).length > 0, 'ويعمل مجرّداً');
  assert.ok((await run('!استدعاء سريع <@7>')).length > 0, 'والاختصار المكوّن من كلمتين يعمل أيضاً');
});

test('لا يوجد أي نص توجيه متبقٍ — السياسة صامتة بالكامل', () => {
  assert.equal(require('./prefixPolicy').slashOnlyNotice, undefined);
});
