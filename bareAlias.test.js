'use strict';

// ============================================================================
// اختبارات الاختصارات المجرّدة (بلا بريفكس)
//
// العقد الجديد (2026-10-02):
//   لف @عضو     ← اختصار حدّده المالك، يعمل مجرّداً
//   !ban @عضو   ← البريفكس انتهى: صامت تماماً بلا أي رد (عدا أوامر التذكرة)
//   top         ← اسم رسمي مجرّد: لا يعمل (وإلا ردّ البوت على محادثات عادية)
//   مرحبا شباب  ← كلام عادي: البوت صامت تماماً
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const registerSlashPrefix = require('./slashPrefix');
const { commandData } = require('./slashCommands');

function buildConfig(extraBanAliases = []) {
  return {
    globalRoleIds: [],
    commands: Object.fromEntries(commandData.map(command => [command.name, {
      enabled: true,
      aliases: command.name === 'ban' ? ['لف', 'بان', 'برا', ...extraBanAliases] : [],
      roleIds: [], userIds: []
    }]))
  };
}

const CONFIG = buildConfig();

function createHarness(config = CONFIG) {
  const pool = {
    query: async sql => String(sql).includes('bot_settings')
      ? { rows: [{ key: 'slash_command_config', value: config }] }
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

async function send(content, config = CONFIG) {
  const harness = createHarness(config);
  const { message, replies } = makeMessage(content);
  for (const listener of harness.listeners) await listener(message);
  await new Promise(resolve => setTimeout(resolve, 60));
  return { replies, executed: harness.executed };
}

test('الاختصار المجرّد يشغّل الأمر بلا بريفكس', async () => {
  const { executed } = await send('لف <@7> 2h سب وشتم');
  assert.deepEqual(executed, ['ban'], 'الاختصار «لف» يجب أن يشغّل الحظر مباشرة');
});

test('كل اختصارات الأمر المجرّدة تعمل', async () => {
  for (const alias of ['لف', 'بان', 'برا']) {
    const { executed } = await send(`${alias} <@7>`);
    assert.deepEqual(executed, ['ban'], `الاختصار «${alias}» يجب أن يعمل مجرّداً`);
  }
});

test('الاختصار المجرّد الناقص يعرض إيمبد الاستخدام', async () => {
  const { replies, executed } = await send('لف');
  assert.equal(executed.length, 0, 'لا يُنفَّذ الأمر بلا عضو');
  assert.equal(replies.length, 1);
  assert.ok(replies[0].embeds?.length, 'يجب أن يُرد بإيمبد إرشادي');
});

test('اختصار المالك يعمل بأي بريفكس كتبه — «!» و«$» والمجرّد سواء', async () => {
  for (const content of ['لف <@7>', '!لف <@7>', '$لف <@7>']) {
    const { replies, executed } = await send(content);
    assert.deepEqual(executed, ['ban'], `«${content}»: الاختصار يعمل`);
    assert.equal(replies.length, 0, `«${content}»: بلا أي رد زائد`);
  }
});

test('الاختصار المحفوظ بعلامة في أوله يعمل بالصيغ الثلاث', async () => {
  // المالك قد يحفظ الاختصار «!ط» أو «$ط» أو «ط» — وكلها يجب أن تعمل.
  for (const stored of ['!ط', '$ط']) {
    const config = buildConfig([stored]);
    const bare = await send('ط <@7>', config);
    assert.deepEqual(bare.executed, ['ban'], `المحفوظ «${stored}» يعمل مجرّداً`);
    const prefixed = await send(`${stored[0]}ط <@7>`, config);
    assert.deepEqual(prefixed.executed, ['ban'], `المحفوظ «${stored}» يعمل ببريفكس ${stored[0]}`);
  }
});

test('اختصار من كلمتين يعمل كما كتبه المالك', async () => {
  const config = buildConfig(['حظر عام']);
  const bare = await send('حظر عام <@7>', config);
  assert.deepEqual(bare.executed, ['ban'], 'الاختصار متعدد الكلمات يعمل مجرّداً');
  const prefixed = await send('!حظر عام <@7>', config);
  assert.deepEqual(prefixed.executed, ['ban'], 'ويعمل بالبريفكس أيضاً');
});

test('الاسم الرسمي المجرّد لا يعمل — حماية من الرد على المحادثات', async () => {
  for (const content of ['top', 'ban <@7>', 'say مرحبا']) {
    const { replies, executed } = await send(content);
    assert.equal(executed.length, 0, `«${content}» يجب ألا يُنفَّذ بلا بريفكس`);
    assert.equal(replies.length, 0, `«${content}» يجب ألا يُرد عليه إطلاقاً`);
  }
});

test('الكلام العادي لا يحرّك البوت إطلاقاً', async () => {
  for (const content of ['مرحبا شباب كيفكم', 'ban', 'لفة', 'xلف', 'هذا كلام فيه لف بالنص']) {
    const { replies, executed } = await send(content);
    assert.equal(executed.length, 0, `«${content}» يجب ألا يُنفَّذ`);
    assert.equal(replies.length, 0, `«${content}» يجب ألا يُرد عليه`);
  }
});

test('أوامر $ و / لا يلمسها هذا المسار', async () => {
  for (const content of ['$come <@7>', '/ban', '$tax 100']) {
    const { replies, executed } = await send(content);
    assert.equal(executed.length, 0, `«${content}» يخص مستمعاً آخر`);
    assert.equal(replies.length, 0);
  }
});

test('الاسم الرسمي مع البريفكس مرفوض بصمت', async () => {
  const { replies, executed } = await send('!top');
  assert.deepEqual(executed, [], 'البريفكس لم يعد يشغّل أوامر السلاش');
  assert.equal(replies.length, 0, 'لا رد إطلاقاً');
});
