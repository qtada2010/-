'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SLASH_COMMAND_NAMES,
  getSlashCommandConfig,
  saveSlashCommandConfig,
  resolveSlashPrefixRoute
} = require('./slashCommandConfig');
const { parsePrefixOptions } = require('./slashPrefix');
const { FORM_ACTION_CATEGORIES, SLASH_COMMAND_CATEGORIES } = require('./commandCategories');
const { isPrefixBlocked } = require('./prefixPolicy');

class MemoryPool {
  constructor(settings = {}, permission = {}) {
    this.settings = new Map(Object.entries(settings));
    this.permission = permission;
  }

  async query(sql, params = []) {
    if (sql.includes('SELECT key,value FROM bot_settings')) {
      return { rows: (params[0] || []).filter(key => this.settings.has(key)).map(key => ({ key, value: this.settings.get(key) })) };
    }
    if (sql.includes('SELECT * FROM permissions')) return { rows: [this.permission] };
    if (sql.includes('INSERT INTO bot_settings')) {
      this.settings.set(params[0], JSON.parse(params[1]));
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('UPDATE bot_settings')) {
      this.settings.set(params[0], JSON.parse(params[1]));
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  }
}

const resetCommand = {
  name: 'reset',
  options: [
    { name: 'period', type: 3, required: true, choices: [
      { name: 'الإجمالي والمستوى', value: 'total' },
      { name: 'اليومي', value: 'daily' },
      { name: 'الأسبوعي', value: 'weekly' },
      { name: 'الشهري', value: 'monthly' },
      { name: 'الكل', value: 'all' }
    ] },
    { name: 'member', type: 6, required: false }
  ]
};

function prefixMessage(user) {
  return {
    mentions: { users: { find: predicate => [user].find(predicate) } },
    guild: {
      members: {
        fetch: async () => null,
        cache: { find: () => null }
      },
      roles: { cache: { find: () => null } },
      channels: { cache: { find: () => null } }
    },
    client: { users: { fetch: async () => null } }
  };
}

test('all 52 slash commands are categorized by purpose and ticket/admin filters are complete', () => {
  assert.equal(SLASH_COMMAND_NAMES.length, 52);
  assert.deepEqual(Object.keys(SLASH_COMMAND_CATEGORIES).sort(), [...SLASH_COMMAND_NAMES].sort());
  assert.ok(SLASH_COMMAND_CATEGORIES.ban.includes('admin'));
  assert.ok(SLASH_COMMAND_CATEGORIES.lock.includes('admin'));
  assert.ok(SLASH_COMMAND_CATEGORIES.clear.includes('admin'));
  assert.ok(SLASH_COMMAND_CATEGORIES.setxp.includes('admin'));
  assert.ok(SLASH_COMMAND_CATEGORIES.setxp.includes('xp'));
  // أمرا الكتم المنفصل (كتابي فقط / صوتي فقط)
  assert.ok(SLASH_COMMAND_NAMES.includes('mute'));
  assert.ok(SLASH_COMMAND_NAMES.includes('unmute'));
  assert.ok(SLASH_COMMAND_CATEGORIES.mute.includes('admin'));
  assert.ok(SLASH_COMMAND_CATEGORIES.unmute.includes('admin'));
  // 🎫 [2026-10-02] بطاقات التكت مخفية من صفحة الأوامر بقرار المالك: لا خرائط حفظ
  // تكت داخل الصفحة، لكن التصنيف نفسه يبقى في النموذج ليُستبعد العرض تلقائياً.
  assert.equal(FORM_ACTION_CATEGORIES['/save-command-close'], undefined);
  assert.equal(FORM_ACTION_CATEGORIES['/save-command-permissions/claim'], undefined);
  assert.ok(SLASH_COMMAND_CATEGORIES.ticket.includes('tickets'));
  assert.ok(SLASH_COMMAND_CATEGORIES.claimstats.includes('tickets'));
  assert.ok(FORM_ACTION_CATEGORIES['/save-command-permissions/channel-access'].includes('admin'));
});

test('سياسة الاسم الواحد: اختصارات التصفير العربية لم تعد تُوجَّه', async () => {
  // تغيّرت السياسة عمداً: لكل أمر اسم واحد يُستدعى بـ /الأمر و !الأمر فقط.
  // هذه الأسماء العربية كانت تعمل سابقاً ولم تعد تُوجَّه إلى أي أمر.
  const retiredNames = [
    'تصفير', 'تصفير-يومي', 'تصفير-اسبوعي', 'تصفير-أسبوعي', 'تصفير-شهري',
    'تصفير-الكل', 'تصفير-الكل-يومي', 'تصفير-الكل-اسبوعي', 'تصفير-الكل-شهري'
  ];
  for (const name of retiredNames) {
    assert.equal(resolveSlashPrefixRoute(name), null, `${name} يجب ألا يُوجَّه بعد إلغاء الاختصارات`);
  }
  // الاسم الرسمي وحده هو ما يعمل
  assert.equal(resolveSlashPrefixRoute('reset').command, 'reset');
});

test('/hide و /show يرثان صلاحيات الإظهار القديمة، بلا اختصارات', async () => {
  const pool = new MemoryPool({
    slash_command_config: { commands: { clear: { enabled: true, aliases: [], roleIds: [], userIds: [] } } },
    command_control_config: { channelModeration: { enabled: false, hideAliases: ['اخفاءقديم'], showAliases: ['اظهارقديم'] } }
  }, { hide_role_id: '12345678901234570' });
  const config = await getSlashCommandConfig(pool);
  // وراثة الإعدادات ما زالت تعمل كما كانت
  assert.equal(config.commands.hide.enabled, false);
  assert.equal(config.commands.show.enabled, false);
  assert.deepEqual(config.commands.hide.roleIds, ['12345678901234570']);
  assert.deepEqual(config.commands.show.roleIds, ['12345678901234570']);
  // لكن الاختصارات المحفوظة لم تعد تُوجَّه
  assert.equal(resolveSlashPrefixRoute('اخفاءقديم'), null);
  assert.equal(resolveSlashPrefixRoute('اظهارقديم'), null);
  assert.equal(resolveSlashPrefixRoute('hide').command, 'hide');
  assert.equal(resolveSlashPrefixRoute('show').command, 'show');
});

test('الصلاحيات تُورَّث، واختصارات المالك المحفوظة تبقى تعمل', async () => {
  const pool = new MemoryPool({
    command_moderation_config: {
      ban: { enabled: true, banAliases: ['حظرقديم'], unbanAliases: ['فكقديم'] },
      timeout: { enabled: true, timeAliases: ['تايمقديم'], untimeAliases: ['فك-تايمقديم'] },
      rank: { enabled: true, rankAliases: ['رتبةقديم'], unrankAliases: ['سحب-رتبةقديم'] }
    },
    command_control_config: {
      clear: { enabled: true, aliases: ['مسح', 'تنظيفقديم'] },
      channelModeration: { enabled: true, lockAliases: ['قفلقديم'], unlockAliases: ['فتحقديم'], hideAliases: ['اخفاءقديم'], showAliases: ['اظهارقديم'] }
    }
  }, {
    ban_role_id: '12345678901234567',
    timeout_role_id: '12345678901234568',
    rank_role_id: '12345678901234569',
    clear_role_id: '12345678901234570',
    lock_role_id: '12345678901234571',
    hide_role_id: '12345678901234572'
  });

  const config = await getSlashCommandConfig(pool);

  // الأسماء الرسمية وحدها هي ما يُوجَّه
  for (const name of ['clear', 'ban', 'unban', 'time', 'untime', 'lock', 'unlock', 'hide', 'show']) {
    assert.equal(resolveSlashPrefixRoute(name, config).command, name);
  }

  // اختصارات المالك المحفوظة من الواجهة القديمة تُرحَّل وتبقى تعمل
  const ownerAliases = {
    'حظرقديم': 'ban', 'فكقديم': 'unban', 'تايمقديم': 'time', 'فك-تايمقديم': 'untime',
    'تنظيفقديم': 'clear', 'قفلقديم': 'lock', 'فتحقديم': 'unlock',
    'اخفاءقديم': 'hide', 'اظهارقديم': 'show'
  };
  for (const [alias, target] of Object.entries(ownerAliases)) {
    const route = resolveSlashPrefixRoute(alias, config);
    assert.ok(route, `اختصار المالك «${alias}» يجب أن يبقى يعمل`);
    assert.equal(route.command, target, `«${alias}» يجب أن يوجَّه إلى ${target}`);
  }

  // «مسح» مستثناة عمداً في migrateSlashAliases فلا تُرحَّل
  assert.equal(resolveSlashPrefixRoute('مسح', config), null, '«مسح» مستثناة عمداً');
  assert.deepEqual(config.commands.ban.roleIds, ['12345678901234567']);
  assert.deepEqual(config.commands.clear.roleIds, ['12345678901234570']);
  assert.deepEqual(config.commands.lock.roleIds, ['12345678901234571']);
  assert.deepEqual(config.commands.hide.roleIds, ['12345678901234572']);
  assert.deepEqual(config.commands.show.roleIds, ['12345678901234572']);
  assert.deepEqual(config.commands.role.userIds, ['12345678901234569']);

  await saveSlashCommandConfig(pool, config);
  assert.deepEqual(pool.settings.get('command_control_config').clear.aliases, []);
  assert.deepEqual(pool.settings.get('command_control_config').channelModeration.lockAliases, []);
  assert.deepEqual(pool.settings.get('command_control_config').channelModeration.hideAliases, []);
  assert.deepEqual(pool.settings.get('command_moderation_config').ban.banAliases, []);
  assert.deepEqual(pool.settings.get('slash_command_config').commands.clear.aliases, ['تنظيفقديم']);
  assert.deepEqual(pool.settings.get('slash_command_config').commands.hide.aliases, ['اخفاءقديم']);
  assert.deepEqual(pool.settings.get('slash_command_config').commands.show.aliases, ['اظهارقديم']);
});

// ==========================================================================
// 🔇 أمرا الكتم المنفصل: كتابي فقط (/mute text) وصوتي فقط (/mute voice)
// يتحقق أيضاً من التوافق الخلفي: !mute كان يعني الكتم الصوتي قبل فصل الأمر،
// ويجب أن يبقى كذلك حتى لا يتغير أي استخدام قائم في السيرفر.
// ==========================================================================
const muteCommand = {
  name: 'mute',
  options: [
    { name: 'text', type: 1, options: [
      { name: 'member', type: 6, required: true },
      { name: 'minutes', type: 4, required: false },
      { name: 'reason', type: 3, required: false }
    ] },
    { name: 'voice', type: 1, options: [
      { name: 'member', type: 6, required: true },
      { name: 'reason', type: 3, required: false }
    ] }
  ]
};

test('mute/unmute أمران مستقلان بأمرين فرعيين، بلا اختصارات', async () => {
  const member = { id: '12345678901234567', username: 'member' };

  // الأمران مسجلان كأوامر سلاش مستقلة
  assert.equal(resolveSlashPrefixRoute('mute').command, 'mute');
  assert.equal(resolveSlashPrefixRoute('unmute').command, 'unmute');

  // التوافق الخلفي: !mute @عضو بدون تحديد النوع يبقى كتماً صوتياً كما كان سابقاً
  const legacyRoute = resolveSlashPrefixRoute('mute');
  const legacyParsed = await parsePrefixOptions(muteCommand, [`<@${member.id}>`], legacyRoute, prefixMessage(member));
  assert.equal(legacyParsed.subcommand, 'voice');
  assert.equal(legacyParsed.values.member, member);

  // تحديد النوع صراحةً: !mute text @عضو → كتم كتابي فقط
  const textParsed = await parsePrefixOptions(muteCommand, ['text', `<@${member.id}>`], resolveSlashPrefixRoute('mute'), prefixMessage(member));
  assert.equal(textParsed.subcommand, 'text');
  assert.equal(textParsed.values.member, member);

  // !mute voice @عضو → كتم صوتي فقط
  const voiceParsed = await parsePrefixOptions(muteCommand, ['voice', `<@${member.id}>`], resolveSlashPrefixRoute('mute'), prefixMessage(member));
  assert.equal(voiceParsed.subcommand, 'voice');

  // الأسماء العربية القديمة لم تعد تُوجَّه — النوع يُحدَّد بأمر فرعي صريح
  for (const name of ['كتم', 'كتم-كتابي', 'كتم-صوتي', 'فك-كتم', 'فك-كتم-كتابي', 'فك-كتم-صوتي']) {
    assert.equal(resolveSlashPrefixRoute(name), null, `${name} يجب ألا يُوجَّه`);
  }

  // المدة اختيارية في الكتم الكتابي (كتم دائم عند تركها فارغة)
  const timed = await parsePrefixOptions(muteCommand, ['text', `<@${member.id}>`, '30'], resolveSlashPrefixRoute('mute'), prefixMessage(member));
  assert.equal(timed.values.minutes, 30);
});

// ==========================================================================
// 🧩 الأوامر المخصّصة التي أصبحت تملك صيغة سلاش بعد أن كانت بريفكس فقط.
// الهدف: ضمان التكافؤ — لكل أمر بريفكس نسخة سلاش والعكس.
// ==========================================================================
test('tax/come/say are registered slash commands whose old prefix route is retired', () => {
  for (const name of ['tax', 'come', 'say']) {
    assert.ok(SLASH_COMMAND_NAMES.includes(name), `${name} يجب أن يكون أمر سلاش مسجلاً`);
    const route = resolveSlashPrefixRoute(name);
    assert.ok(route, `المسار القديم يبقى معروفاً للجسر`);
    assert.equal(route.command, name);
    // 🚦 سياسة البريفكس: هذا الأمر سلاش فقط الآن، والاختصار المجرّد هو البديل.
    assert.equal(isPrefixBlocked(name), true, `${name} يجب أن يكون سلاش فقط`);
    assert.ok(SLASH_COMMAND_CATEGORIES[name]?.length > 0, `${name} يجب أن يكون مصنّفاً`);
  }
});

test('shared custom-command logic is identical for slash and prefix', () => {
  const { buildTaxPayload, buildSayPayload, hexToColorInt } = require('./customCommands');

  const taxConfig = {
    taxRatePercent: 10, embedTitle: 'ضريبة', embedColor: '#059669',
    originalLabel: 'الأصلي', netLabel: 'الصافي', grossLabel: 'المطلوب'
  };
  // 1000 بنسبة 10%: الصافي 900 والمطلوب تحويله 1112
  const ok = buildTaxPayload(taxConfig, 1000);
  assert.equal(ok.error, undefined);
  assert.equal(ok.netAmount, 900);
  assert.equal(ok.grossAmount, 1112);

  // مدخلات غير صالحة تُرفض بنفس الرسالة في المسارين
  for (const bad of ['', 'abc', 0, -5, null]) {
    assert.match(buildTaxPayload(taxConfig, bad).error, /مبلغ صحيح/);
  }

  // سياسة المنشنات تُترجم إلى allowedMentions الصحيحة
  assert.deepEqual(buildSayPayload({ mentionPolicy: 'none' }, 'مرحبا').payload.allowedMentions, { parse: [] });
  assert.deepEqual(buildSayPayload({ mentionPolicy: 'users' }, 'مرحبا').payload.allowedMentions, { parse: ['users'] });
  assert.equal(buildSayPayload({ mentionPolicy: 'all' }, 'مرحبا').payload.allowedMentions, undefined);
  assert.match(buildSayPayload({ mentionPolicy: 'all' }, '   ').error, /يرجى كتابة الرسالة/);

  // لون غير صالح يسقط إلى اللون الافتراضي بدل رمي استثناء
  assert.equal(hexToColorInt('#059669'), 0x059669);
  assert.equal(hexToColorInt('غير-صالح', 0x123456), 0x123456);
  assert.equal(hexToColorInt(undefined, 0x123456), 0x123456);
});

// ==========================================================================
// 🌉 أوامر system.js التي صارت لها نسخة سلاش عبر systemSlashBridge.
// ==========================================================================
test('system commands exposed as slash stay routable but are slash-only now', () => {
  for (const name of ['channel', 'botstatus', 'logchannel', 'ticket', 'claimstats', 'xpmanage', 'myinfo', 'clan']) {
    assert.ok(SLASH_COMMAND_NAMES.includes(name), `${name} يجب أن يكون أمر سلاش مسجلاً`);
    const route = resolveSlashPrefixRoute(name);
    assert.ok(route, `المسار القديم يبقى معروفاً للجسر`);
    assert.equal(route.command, name);
    // 🚦 لا استثناء: حتى أوامر النظام صارت سلاش فقط (أوامر التكت وحدها بالبريفكس).
    assert.equal(isPrefixBlocked(name), true, `${name} يجب أن يكون سلاش فقط`);
    assert.ok(SLASH_COMMAND_CATEGORIES[name]?.length > 0, `${name} يجب أن يكون مصنّفاً`);
  }
});

test('every registered slash command has a builder, and vice versa', () => {
  const commandData = require('./slashCommands').commandData;
  const builderNames = commandData.map(command => command.name);

  // لا اسم مسجّل بلا تعريف، ولا تعريف بلا تسجيل — وإلا ظهر أمر لا يعمل
  assert.deepEqual([...builderNames].sort(), [...SLASH_COMMAND_NAMES].sort());
  assert.equal(new Set(builderNames).size, builderNames.length, 'لا يجوز تكرار اسم أمر');

  // كل أمر يجب أن يكون مصنّفاً حتى يظهر تحت تبويب في صفحة الأوامر
  for (const name of builderNames) {
    assert.ok(SLASH_COMMAND_CATEGORIES[name]?.length > 0, `الأمر ${name} غير مصنّف`);
  }

  // التكافؤ الكامل: كل أمر سلاش قابل للاستدعاء بالبريفكس أيضاً
  for (const name of builderNames) {
    const route = resolveSlashPrefixRoute(name);
    assert.ok(route && route.command === name, `!${name} لا يُوجَّه إلى /${name}`);
  }
});

test('/role toggle and /channel subcommands are defined', () => {
  const commandData = require('./slashCommands').commandData;
  const subsOf = name => (commandData.find(c => c.name === name)?.options || [])
    .filter(option => option.type === 1).map(option => option.name);

  assert.deepEqual(subsOf('role'), ['give', 'remove', 'toggle', 'multiple']);
  assert.deepEqual(subsOf('channel'), ['view', 'write', 'rename', 'tax', 'suggestions']);
  assert.deepEqual(subsOf('botstatus'), ['set', 'about']);
  assert.deepEqual(subsOf('mute'), ['text', 'voice']);
  assert.deepEqual(subsOf('unmute'), ['text', 'voice']);
});

// ==========================================================================
// 🔒 التكافؤ الكامل: لا يوجد أمر في البوت بصيغة واحدة فقط.
// هذا الاختبار هو الضمانة ضد نسيان أحد الطرفين عند إضافة أمر جديد.
// ==========================================================================
test('every bridged command is declared, categorized and routable (invocation is slash-only)', () => {
  const { SYSTEM_SLASH_COMMANDS } = require('./systemSlashBridge');
  const commandData = require('./slashCommands').commandData;
  const builderNames = commandData.map(command => command.name);

  for (const name of SYSTEM_SLASH_COMMANDS) {
    assert.ok(builderNames.includes(name), `الأمر ${name} مُفوَّض للجسر لكن بلا تعريف SlashCommandBuilder`);
    assert.ok(SLASH_COMMAND_NAMES.includes(name), `الأمر ${name} غير مسجّل في SLASH_COMMAND_NAMES`);
    assert.ok(SLASH_COMMAND_CATEGORIES[name]?.length > 0, `الأمر ${name} غير مصنّف`);
    const route = resolveSlashPrefixRoute(name);
    assert.ok(route && route.command === name, `المسار القديم لـ ${name} معروف`);
    assert.equal(isPrefixBlocked(name), true, `${name} يجب أن يكون سلاش فقط`);
  }
});

test('grouped subcommands cover every former prefix-only command', () => {
  const commandData = require('./slashCommands').commandData;
  const subsOf = name => (commandData.find(c => c.name === name)?.options || [])
    .filter(option => option.type === 1).map(option => option.name);

  // 6 أوامر تذكرة كانت بالبريفكس فقط
  assert.deepEqual(subsOf('ticket'), ['close', 'save', 'delete', 'add', 'remove', 'rename']);
  // 10 أوامر سجل استلام مجمّعة في 4 أوامر فرعية + خيار النوع
  assert.deepEqual(subsOf('claimstats'), ['add', 'remove', 'reset', 'resetall']);
  // 8 أوامر إكسبي مجمّعة في أمرين فرعيين + خيار الفترة
  assert.deepEqual(subsOf('xpmanage'), ['add', 'remove']);
  // أمرا الكلانات
  assert.deepEqual(subsOf('clan'), ['create', 'apply-panel']);

  // خيار الفترة يغطي الفترات الأربع التي كانت أوامر منفصلة
  const periods = commandData.find(c => c.name === 'xpmanage').options[0].options
    .find(o => o.name === 'period').choices.map(c => c.value);
  assert.deepEqual(periods, ['total', 'daily', 'weekly', 'monthly']);
});

// ==========================================================================
// 🔤 مطابقة الخيارات العربية يجب ألا تنكسر بسبب الهمزة أو الألف المقصورة.
// كان المستخدم يكتب "اداري" (كما في !اضافة-استلام-اداري القديم) فيُرفض الأمر
// لمجرد أن الخيار معروض باسم "إداري".
// ==========================================================================
test('arabic choice matching tolerates hamza and alef variants', async () => {
  const commandData = require('./slashCommands').commandData;
  const claimstats = commandData.find(command => command.name === 'claimstats');
  const userId = '123456789012345678';

  class FakeCollection extends Map {
    find(predicate) { return [...this.values()].find(predicate); }
    first() { return null; }
  }
  const message = {
    guild: {
      roles: { cache: new FakeCollection() },
      channels: { cache: new FakeCollection(), fetch: async () => null },
      members: {
        cache: new FakeCollection(),
        fetch: async id => (id === userId ? { id, user: { id, tag: 'a#1' } } : null)
      }
    },
    client: { users: { fetch: async () => null } },
    mentions: {
      users: new FakeCollection(), roles: new FakeCollection(),
      channels: new FakeCollection(), members: new FakeCollection()
    }
  };

  // الصيغ الثلاث يجب أن تؤدي جميعها إلى القيمة admin
  for (const spelling of ['اداري', 'إداري', 'admin']) {
    const parsed = await parsePrefixOptions(
      claimstats, ['add', spelling, `<@${userId}>`, '5'],
      resolveSlashPrefixRoute('claimstats'), message
    );
    assert.equal(parsed.error, undefined, `الصيغة "${spelling}" يجب أن تُقبل`);
    assert.equal(parsed.subcommand, 'add');
  }
});

// ==========================================================================
// 📖 أمر help كان يُسجَّل منفصلاً في ready.js خارج النظام الموحّد، فلم تكن له
// نسخة بريفكس (!help) ولا بطاقة في صفحة الأوامر. بعد توحيده يجب أن يبقى
// داخل النظام ولا يعود للانفصال.
// ==========================================================================
test('help is part of the unified command system', () => {
  const commandData = require('./slashCommands').commandData;
  const builderNames = commandData.map(command => command.name);

  assert.ok(SLASH_COMMAND_NAMES.includes('help'), 'help يجب أن يكون مسجّلاً');
  assert.equal(builderNames.filter(name => name === 'help').length, 1,
    'help يجب أن يُعرَّف مرة واحدة فقط وإلا رفض ديسكورد الاسم المكرر');
  assert.ok(SLASH_COMMAND_CATEGORIES.help?.length > 0, 'help يجب أن يكون مصنّفاً');

  const route = resolveSlashPrefixRoute('help');
  assert.ok(route && route.command === 'help', '!help يجب أن يعمل كبريفكس');

  // ready.js يجب ألا يعيد تعريف help بعد توحيده
  const readySource = require('node:fs').readFileSync(require('node:path').join(__dirname, 'ready.js'), 'utf8');
  assert.ok(!/setName\(['"]help['"]\)/.test(readySource),
    'ready.js يجب ألا يسجّل help مرة ثانية');
});

// ==========================================================================
// 🛡️ قائمة الأسماء المحجوزة في صفحة /commands صارت تُبنى تلقائياً من أسماء
// أوامر السلاش والمسارات القديمة. هذا الاختبار يضمن أمرين:
//   1) لا يسقط اسم كان محجوزاً من قبل (وإلا سمحت اللوحة باختصار يصطدم بأمر)
//   2) كل أمر جديد يُضاف للبوت يدخل القائمة تلقائياً دون تعديل يدوي
// ==========================================================================
test('كل اسم أمر له صاحب في خريطة الاختصارات — ولا قائمة حجب بعد اليوم', () => {
  const commandData = require('./slashCommands').commandData;
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'dashboard.js'), 'utf8');

  // كل أمر سلاش مسجّل باسمه الرسمي في خريطة الأصحاب، فيُرفض استخدام اسمه
  // كاختصار في أمر آخر برسالة تذكر اسمه — بلا قائمة حجب يدوية تنسى الأوامر الجديدة.
  assert.ok(
    source.includes('const aliasOwnerLabels = Object.fromEntries(slashCommandData.map(command => [command.name, `/${command.name}`]));'),
    'خريطة الأصحاب تُبنى تلقائياً من أسماء الأوامر'
  );
  // أوامر التكت تعمل بالبريفكس ولا بطاقات لها في الصفحة، فتُسجَّل صراحةً
  for (const name of ['close', 'save', 'delete', 'add', 'remove', 'rename']) {
    assert.ok(source.includes(`${name}: 'أوامر التكت'`), `«${name}» له صاحب مسجّل`);
  }
  assert.ok(source.includes("claim: 'استلام التكت'"), 'واستلام التكت كذلك');

  // وقائمة الحجب القديمة أُزيلت من الكود ومن الصفحة
  assert.ok(!source.includes('prefixOnlyCommandNames'), 'قائمة الحجب أُزيلت');
  assert.ok(!source.includes('data-blocked='), 'ولم تعد تُطبع في الصفحة');
});