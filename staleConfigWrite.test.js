'use strict';

// ============================================================================
// حفظ أمر لا يجوز أن يمحو تعديل أمر آخر
//
// العطل الذي يقفله هذا الملف:
// إعدادات كل الأوامر مخزّنة ككائن JSON واحد، فحفظ أمر واحد يقرأ الإعدادات
// كلها ويعيد كتابتها كلها. وكانت تلك القراءة تمرّ على ذاكرة مؤقتة عمرها
// ثلاث ثوانٍ. فإذا جاءت من ذاكرة قديمة كُتبت الحالة القديمة فوق تعديلات
// أوامر أخرى حُفظت للتوّ — وتختفي بلا أي رسالة خطأ.
//
// يظهر بوضوح عند «حفظ كل التغييرات» لعدة أوامر، ويتفاقم إذا كان البوت
// يعمل بأكثر من نسخة إذ لكل نسخة ذاكرتها المستقلة.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const {
  getSlashCommandConfig,
  saveSlashCommandConfig
} = require('./slashCommandConfig');

/** قاعدة بيانات مشتركة في الذاكرة، مع pool مستقل لكل «نسخة» من البوت */
function createSharedDatabase() {
  const rows = {};
  const makePool = () => {
    const pool = {
      async query(sql, params = []) {
        const text = String(sql);
        if (/INSERT INTO bot_settings/i.test(text)) {
          rows[params[0]] = params[1];
          return { rows: [], rowCount: 1 };
        }
        if (/UPDATE bot_settings/i.test(text)) {
          rows[params[0]] = params[1];
          return { rows: [], rowCount: 1 };
        }
        if (/FROM bot_settings/i.test(text)) {
          if (Array.isArray(params[0])) {
            const found = params[0].filter(key => rows[key]).map(key => ({ key, value: JSON.parse(rows[key]) }));
            return { rows: found, rowCount: found.length };
          }
          const key = params[0];
          return { rows: rows[key] ? [{ key, value: JSON.parse(rows[key]) }] : [], rowCount: rows[key] ? 1 : 0 };
        }
        if (/FROM permissions/i.test(text)) return { rows: [{ key: 'main_permissions' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      async connect() { return { query: pool.query, release() {} }; },
      on() {}
    };
    return pool;
  };
  return { rows, makePool };
}

/** يحاكي ما يفعله مسار الحفظ في اللوحة: قراءة الكل ثم دمج أمر واحد */
async function saveOneCommand(pool, name, aliases, { fresh }) {
  const current = await getSlashCommandConfig(pool, fresh ? { fresh: true } : undefined);
  await saveSlashCommandConfig(pool, {
    ...current,
    commands: { ...current.commands, [name]: { enabled: true, aliases, roleIds: [], userIds: [] } }
  });
}

const aliasesOf = (rows, name) => {
  const config = JSON.parse(rows.slash_command_config);
  return (config.commands[name] || {}).aliases || [];
};

test('حفظ عدة أوامر عبر نسختين يحتفظ بكل التعديلات', async () => {
  const db = createSharedDatabase();
  const instanceA = db.makePool();
  const instanceB = db.makePool();

  // كل نسخة تعرض الصفحة أولاً، فتملأ ذاكرتها المؤقتة بالحالة الفارغة
  await getSlashCommandConfig(instanceA);
  await getSlashCommandConfig(instanceB);

  // «حفظ كل التغييرات» موزّعاً على النسختين كما يفعل موزّع الأحمال
  await saveOneCommand(instanceA, 'ban', ['لف'], { fresh: true });
  await saveOneCommand(instanceB, 'kick', ['طرد'], { fresh: true });
  await saveOneCommand(instanceA, 'mute', ['كتم'], { fresh: true });

  assert.deepStrictEqual(aliasesOf(db.rows, 'ban'), ['لف'], 'تعديل ban يجب ألّا يُمحى');
  assert.deepStrictEqual(aliasesOf(db.rows, 'kick'), ['طرد'], 'تعديل kick يجب ألّا يُمحى');
  assert.deepStrictEqual(aliasesOf(db.rows, 'mute'), ['كتم'], 'تعديل mute يجب ألّا يُمحى');
});

test('القراءة القديمة هي فعلاً ما كان يمحو التعديلات', async () => {
  const db = createSharedDatabase();
  const instanceA = db.makePool();
  const instanceB = db.makePool();
  await getSlashCommandConfig(instanceA);
  await getSlashCommandConfig(instanceB);

  // نفس السيناريو لكن بالقراءة من الذاكرة المؤقتة — السلوك قبل الإصلاح
  await saveOneCommand(instanceA, 'ban', ['لف'], { fresh: false });
  await saveOneCommand(instanceB, 'kick', ['طرد'], { fresh: false });

  // نوثّق العطل: النسخة B كتبت فوق تعديل النسخة A
  assert.deepStrictEqual(aliasesOf(db.rows, 'ban'), [],
    'هذا يوثّق العطل القديم: لو فشل هذا التأكيد فقد تغيّر سلوك الذاكرة المؤقتة');
  assert.deepStrictEqual(aliasesOf(db.rows, 'kick'), ['طرد']);
});

test('fresh يتجاوز الذاكرة المؤقتة ويقرأ من قاعدة البيانات', async () => {
  const db = createSharedDatabase();
  const pool = db.makePool();
  await saveSlashCommandConfig(pool, { commands: { ban: { enabled: true, aliases: ['لف'], roleIds: [], userIds: [] } } });

  // كتابة خارجية مباشرة لا تمرّ على هذه النسخة (تحاكي نسخة أخرى)
  const external = JSON.parse(db.rows.slash_command_config);
  external.commands.ban.aliases = ['بان'];
  db.rows.slash_command_config = JSON.stringify(external);

  const cached = await getSlashCommandConfig(pool);
  const fresh = await getSlashCommandConfig(pool, { fresh: true });

  assert.deepStrictEqual(cached.commands.ban.aliases, ['لف'], 'الذاكرة تُرجع القيمة القديمة');
  assert.deepStrictEqual(fresh.commands.ban.aliases, ['بان'], 'fresh تُرجع ما في قاعدة البيانات فعلاً');
});
