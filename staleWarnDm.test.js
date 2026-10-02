'use strict';

// ============================================================================
// صفحة اللوحة يجب أن تعرض ما في قاعدة البيانات، لا ما في الذاكرة المؤقتة
//
// نفس علّة إعدادات الأوامر، لكنها كانت باقية في إعدادات رسالة الإنذار
// وبقية الأوامر المخصّصة: القراءة تمرّ على ذاكرة عمرها خمس ثوانٍ وهي خاصة
// بكل نسخة من البوت. فإن كتبت نسخة أخرى — أو لم تثبت الكتابة أصلاً — عرضت
// اللوحة قيمة غير حقيقية، فيبدو للمستخدم أن تعديله «اختفى» بعد التحميل.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const { getWarnDmConfig, saveWarnDmConfig } = require('./commandConfig');

function createDatabase() {
  const rows = {};
  const makePool = () => {
    const pool = {
      async query(sql, params = []) {
        const text = String(sql);
        if (/INSERT INTO bot_settings/i.test(text)) { rows[params[0]] = params[1]; return { rows: [], rowCount: 1 }; }
        if (/FROM bot_settings/i.test(text)) {
          const key = params[0];
          return { rows: rows[key] ? [{ value: JSON.parse(rows[key]) }] : [], rowCount: rows[key] ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      },
      async connect() { return { query: pool.query, release() {} }; },
      on() {}
    };
    return pool;
  };
  return { rows, makePool };
}

test('اللوحة تعرض ما كتبته نسخة أخرى، لا نسخة الذاكرة القديمة', async () => {
  const db = createDatabase();
  const dashboardPool = db.makePool();
  const otherInstance = db.makePool();

  await saveWarnDmConfig(dashboardPool, { enabled: true, embedTitle: 'عنوان قديم' });
  await getWarnDmConfig(dashboardPool); // تملأ ذاكرة نسخة اللوحة

  // نسخة أخرى من البوت تحفظ عنواناً جديداً
  await saveWarnDmConfig(otherInstance, { enabled: true, embedTitle: 'عنوان جديد' });

  const cached = await getWarnDmConfig(dashboardPool);
  const fresh = await getWarnDmConfig(dashboardPool, { fresh: true });

  assert.strictEqual(cached.embedTitle, 'عنوان قديم', 'الذاكرة تُرجع القديم — هذا هو مصدر الالتباس');
  assert.strictEqual(fresh.embedTitle, 'عنوان جديد', 'fresh تُرجع ما في قاعدة البيانات فعلاً');
});

test('اللون يُخزَّن بأحرف كبيرة دائماً فلا تضطرب المقارنة', async () => {
  const db = createDatabase();
  const pool = db.makePool();
  const saved = await saveWarnDmConfig(pool, { enabled: true, embedColor: '#ab12cd' });
  assert.strictEqual(saved.embedColor, '#AB12CD',
    'الخادم يرفع حالة الأحرف؛ أي مقارنة مع قيمة المتصفح يجب أن تتجاهل الحالة');
});
