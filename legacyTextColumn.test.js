'use strict';

// ============================================================================
// قاعدة قديمة تُرجع قيمة الإعداد نصاً → الحفظ يبدو معطوباً وهو ناجح
// ============================================================================
//
// العطل الذي يقفله هذا الملف:
// عمود bot_settings.value أُنشئ في نسخ قديمة من المشروع نصاً (TEXT)، و
// «CREATE TABLE IF NOT EXISTS» لا يغيّر نوع عمود قائم. فتعود كل الإعدادات
// من قاعدة البيانات نصاً لا كائناً، فتقرأها المطبّعات كائناً فارغاً وتستبدلها
// بالقيم الافتراضية. النتيجة على الشاشة:
//
//   • بطاقة الأمر تعرض القيم الافتراضية دائماً، كأن أحداً لم يحفظ شيئاً.
//   • شريط الحفظ يقول: «أرسلنا … لكن الخادم أعاد …» — والكتابة في الواقع ناجحة.
//
// وهذا بالضبط ما تتعامل معه diagnoseSaving.js بالسطر:
//   typeof row.value === 'string' ? JSON.parse(row.value) : row.value
// فيجب أن يتعامل معه البوت أيضاً، لا أداة التشخيص وحدها.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { getWarnDmConfig, getTaxCommandConfig, WARN_DM_DEFAULTS } = require('./commandConfig');
const { getSlashCommandConfig } = require('./slashCommandConfig');

/**
 * قاعدة بيانات تحاكي عموداً نصياً (TEXT): تُخزّن JSON كنص وتُرجعه نصاً،
 * تماماً كما يفعل pg مع عمود TEXT — وكما كان يفعل المشروع قبل هذا الإصلاح.
 */
function createTextColumnDatabase(rows = {}) {
  const store = { ...rows };
  const pool = {
    async query(sql, params = []) {
      const text = String(sql);
      if (/FROM bot_settings/i.test(text)) {
        const wanted = Array.isArray(params[0]) ? params[0] : [params[0]];
        const found = wanted
          .filter(key => Object.prototype.hasOwnProperty.call(store, key))
          .map(key => ({ key, value: store[key] }));
        return { rows: found, rowCount: found.length };
      }
      if (/INSERT INTO bot_settings/i.test(text)) {
        store[params[0]] = params[1];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { return { query: pool.query, release() {} }; },
    on() {}
  };
  return { store, pool };
}

const json = value => JSON.stringify(value);

test('إعداد رسالة الإنذار يُقرأ صحيحاً عندما تُرجع قاعدة البيانات القيمة نصاً', async () => {
  const { pool } = createTextColumnDatabase({
    command_warn_dm_config: json({
      enabled: true,
      messageText: 'مرحباً {العضو}',
      embedEnabled: true,
      embedTitle: '⚠️ إنذار من ادارة السيرفر',
      embedDescription: '**السبب:** {السبب}',
      embedColor: '#000000',
      embedImageUrl: '',
      embedThumbnailUrl: '',
      embedFooter: '{السيرفر}'
    })
  });

  const config = await getWarnDmConfig(pool, { fresh: true });

  assert.strictEqual(config.embedTitle, '⚠️ إنذار من ادارة السيرفر',
    'العنوان المحفوظ يجب أن يظهر، لا القيمة الافتراضية');
  assert.strictEqual(config.embedColor, '#000000', 'اللون المحفوظ يجب أن يظهر');
  assert.strictEqual(config.messageText, 'مرحباً {العضو}');
  assert.notStrictEqual(config.embedTitle, WARN_DM_DEFAULTS.embedTitle,
    'سقوط القيمة إلى الافتراضي هو العطل نفسه');
});

test('إعداد حاسبة الضريبة يُقرأ صحيحاً عندما تُرجع القاعدة القيمة نصاً', async () => {
  const { pool } = createTextColumnDatabase({
    command_tax_config: json({ enabled: true, taxRatePercent: 7, embedTitle: 'حاسبة السيرفر', aliases: ['ضريبتنا'] })
  });

  const config = await getTaxCommandConfig(pool, { fresh: true });

  assert.strictEqual(config.taxRatePercent, 7, 'النسبة المحفوظة لا الافتراضية');
  assert.strictEqual(config.embedTitle, 'حاسبة السيرفر');
  assert.deepStrictEqual(config.aliases, ['ضريبتنا'], 'الاختصارات المحفوظة لا تضيع');
});

test('اختصارات أوامر السلاش لا تضيع عندما تُرجع القاعدة القيمة نصاً', async () => {
  const { pool } = createTextColumnDatabase({
    slash_command_config: json({
      commands: {
        ban: { enabled: true, aliases: ['باند'], roleIds: ['123456789012345678'], userIds: [] }
      }
    })
  });

  const config = await getSlashCommandConfig(pool, { fresh: true });

  assert.deepStrictEqual(config.commands.ban.aliases, ['باند'],
    'الاختصار المحفوظ يجب أن يُقرأ من النص');
  assert.deepStrictEqual(config.commands.ban.roleIds, ['123456789012345678']);
});

test('نص ليس JSON صالحاً لا يُسقط القراءة', async () => {
  const { pool } = createTextColumnDatabase({ command_warn_dm_config: 'ليست JSON' });

  const config = await getWarnDmConfig(pool, { fresh: true });

  assert.strictEqual(config.embedTitle, WARN_DM_DEFAULTS.embedTitle,
    'نص تالف يُعامل كقيمة فارغة بدل رمي خطأ');
});

// ============================================================================
// 🔥 عطل الإنتاج 2026-10-02: «ReferenceError: commandName is not defined»
//
// حين تكون في قاعدة البيانات حقول اختصارات قديمة (command_moderation_config أو
// command_control_config) كان جمعُ الأسماء المحجوزة يمرّ على كل حقل ويستدعي
// normalizeAliases باسم أمر غير موجود في النطاق — فينهار:
//   • كل أمر سلاش يمرّ بـ authorizeCommand مثل /top
//   • وصفحة /commands كاملة (خطأ 500)
//
// الاختبارات القديمة لم تلتقطه لأن مخزونها الوهمي كان بلا أي حقل اختصار قديم،
// فلا يدخل الحلقة إطلاقاً. هذان الاختباران يقفلان الباب: قاعدة فيها الحقول.
// ============================================================================

const legacyDbRows = {
  command_moderation_config: json({
    ban: { banAliases: ['حظر', 'banned'], unbanAliases: ['فك-حظر'] },
    timeout: { timeAliases: ['كتم-مؤقت'], untimeAliases: ['فك-كتم-مؤقت'] },
    rank: { rankAliases: ['رتبة-يدوي'], unrankAliases: ['سحب-رتبة-يدوي'] }
  }),
  command_control_config: json({
    clear: { aliases: ['تنظيف'] },
    channelModeration: { lockAliases: ['قفل'], unlockAliases: ['فتح'], hideAliases: ['إخفاء'], showAliases: ['إظهار'] },
    // ⚠️ هذه المجموعات ليست في قائمة الترحيل، فحقول اختصاراتها هي التي كانت
    // تمرّ على المتغيّر المفقود وتُسقط القراءة كلها (شكل قاعدة الإنتاج).
    renameChannel: { aliases: ['r'] },
    status: { statusAliases: ['الحالة'] },
    ownerLog: { aliases: ['logowner'] },
    ticketCommands: { saveAliases: ['save'], renameAliases: ['rename'] }
  }),
  slash_command_config: json({
    commands: { ban: { enabled: true, aliases: ['لف'], roleIds: [], userIds: [] } }
  })
};

test('حقول اختصارات قديمة في القاعدة لا تُسقط قراءة إعدادات الأوامر (عطل الإنتاج)', async () => {
  const { pool } = createTextColumnDatabase({ ...legacyDbRows });

  const config = await getSlashCommandConfig(pool, { fresh: true });

  assert.strictEqual(Object.keys(config.commands).length, 52, 'كل الأوامر قُرئت بلا انهيار');
  assert.ok(config.commands.ban.aliases.includes('لف'), 'اختصار المالك محفوظ');
  assert.ok(config.commands.ban.aliases.includes('حظر'), 'الاختصار القديم انتقل للحقل الجديد');
  assert.ok(config.commands.ban.aliases.includes('banned'), 'وكل الاختصارات القديمة انتقلت');
  assert.ok(config.commands.unban.aliases.includes('فك-حظر'), 'اختصارات فك الحظر القديمة انتقلت لأمرها');
  assert.ok(config.commands.lock.aliases.includes('قفل'), 'اختصارات قفل الروم القديمة انتقلت');
  assert.ok(config.commands.clear.aliases.includes('تنظيف'), 'اختصارات مسح الرسائل القديمة انتقلت');
});

test('نفس القاعدة القديمة + قراءة متتابعة (كمسار /commands) لا ترمي استثناءً', async () => {
  const { pool } = createTextColumnDatabase({ ...legacyDbRows });

  await assert.doesNotReject(async () => {
    // مسار صفحة /commands: يقرأ الإعدادات ثلاث مرات متتابعة (سلاش + مخصّص + نظام)
    await getSlashCommandConfig(pool, { fresh: true });
    await getSlashCommandConfig(pool, { fresh: true });
    await getSlashCommandConfig(pool);
  }, 'لا ReferenceError ولا أي رمي آخر');
});
