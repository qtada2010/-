const { Pool } = require('pg');
const { installResilientQuery } = require('./dbResilience');

// ==========================================
// 1. الاتصال بقواعد البيانات وتحديث الهيكل
// ==========================================
// 🔌 عدد الاتصالات محدود صراحةً بدل العشرة الافتراضية.
//
// السبب: قواعد مُدارة مثل Supabase تضع حداً لعدد الجلسات المتزامنة (15 جلسة
// في مجمّع الجلسات، ويظهر الخطأ EMAXCONNSESSION عند تجاوزه). والبوت يُنشئ
// جداوله عند الإقلاع من عدة ملفات معاً، فكان يفتح كل اتصالاته دفعة واحدة؛
// وإن عمل بأكثر من نسخة على الاستضافة يتضاعف العدد ويتجاوز الحد فتفشل
// التهيئة. القيمة قابلة للضبط بـ PG_POOL_MAX حسب حجم المجمّع وعدد النسخ.
const POOL_MAX = (() => {
  const parsed = Number.parseInt(process.env.PG_POOL_MAX, 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(parsed, 1), 50);
})();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: POOL_MAX,
  // تحرير الاتصال الخامل سريعاً حتى لا تبقى الجلسات محجوزة بلا داعٍ
  idleTimeoutMillis: 30000,
  // إن امتلأ الـ pool نفشل برسالة واضحة بدل انتظار لا نهائي
  connectionTimeoutMillis: 15000,
  keepAlive: true
});

// 🧯 إصلاح جذري لموجة الاتصالات عند الإقلاع: استعلامات البنية تتسلسل، وأي
// استعلام يفشل بسبب امتلاء الاتصالات يُعاد تلقائياً (انظر dbResilience.js).
// يُركَّب قبل initDatabase() حتى تشمله التهيئة وكل الملفات التي تُمرَّر لها
// نفس الـ pool من index.js.
installResilientQuery(pool);

// 🛡️ بدون هذا المعالج، أي خطأ اتصال خلفي في الـ Pool (مثل انقطاع الشبكة) يوقف العملية كلها فوراً
pool.on('error', (err) => {
  console.error('❌ خطأ غير متوقع في اتصال قاعدة البيانات (Pool):', err);
});

async function initDatabase() {
  try {
    // 1. جدول اللوحات الرئيسي للتذاكر
    await pool.query(`
      CREATE TABLE IF NOT EXISTS panels (
        panel_id VARCHAR(100) PRIMARY KEY,
        channel_id VARCHAR(100),
        category_id VARCHAR(100),
        admin_role_id VARCHAR(100),
        high_admin_role_id VARCHAR(100),
        log_channel_id VARCHAR(100),
        title TEXT,
        description TEXT,
        type VARCHAR(20) DEFAULT 'buttons',
        message_type VARCHAR(20) DEFAULT 'embed',
        image_url TEXT,
        color VARCHAR(20) DEFAULT '#0284c7',
        last_message_id VARCHAR(100)
      );
    `);

    await pool.query(`
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'buttons';
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'embed';
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS image_url TEXT;
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#0284c7';
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS last_message_id VARCHAR(100);
    `);

    // 1.1 أعمدة زر الاستلام التلقائي (يظهر مع رسالة الترحيب) — إدارة / وسطاء
    await pool.query(`
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS claim_admin_enabled BOOLEAN DEFAULT false;
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS claim_mediator_enabled BOOLEAN DEFAULT false;
      ALTER TABLE panels ADD COLUMN IF NOT EXISTS mediator_role_id VARCHAR(100);
    `);

    // 2. جدول الخيارات/الأزرار للوحات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS panel_options (
        id SERIAL PRIMARY KEY,
        panel_id VARCHAR(100) REFERENCES panels(panel_id) ON DELETE CASCADE,
        option_id VARCHAR(100),
        label TEXT,
        description TEXT,
        emoji TEXT,
        welcome_message TEXT,
        button_style VARCHAR(20) DEFAULT 'Primary'
      );
    `);

    await pool.query(`
      ALTER TABLE panel_options ADD COLUMN IF NOT EXISTS button_style VARCHAR(20) DEFAULT 'Primary';
      ALTER TABLE panel_options ADD COLUMN IF NOT EXISTS category_id VARCHAR(100);
      ALTER TABLE panel_options ADD COLUMN IF NOT EXISTS admin_role_id VARCHAR(100);
      ALTER TABLE panel_options ADD COLUMN IF NOT EXISTS high_admin_role_id VARCHAR(100);
    `);

    // 3. جدول صلاحيات الأزرار والأوامر
    await pool.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        key VARCHAR(50) PRIMARY KEY,
        all_commands_role_id VARCHAR(100) DEFAULT '',
        tax_role_id VARCHAR(100) DEFAULT '',
        come_role_id VARCHAR(100) DEFAULT '',
        say_role_id VARCHAR(100) DEFAULT '',
        close_permission VARCHAR(50) DEFAULT 'both',
        delete_permission VARCHAR(50) DEFAULT 'high_admin',
        save_permission VARCHAR(50) DEFAULT 'both'
      );
    `);

    await pool.query(`
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS close_permission VARCHAR(50) DEFAULT 'both';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS delete_permission VARCHAR(50) DEFAULT 'high_admin';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS save_permission VARCHAR(50) DEFAULT 'both';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS claim_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS add_view_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS write_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS tax_channel_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS suggestions_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS ban_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS timeout_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS lock_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS hide_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS clear_role_id VARCHAR(100) DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS rename_role_id VARCHAR(100) DEFAULT '';
    `);

    // 3.1 عمود إضافي: صلاحية رتبة أمر !الحالة (تغيير حالة البوت) — تُضبط من الموقع
    await pool.query(`
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS status_role_id VARCHAR(100) DEFAULT '';
    `);

    // 3.2 عمود إضافي: صلاحية رتبة أمر !رول (تبديل رتبة تلقائياً) — تُضبط من الموقع
    await pool.query(`
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS role_toggle_role_id VARCHAR(100) DEFAULT '';
    `);

    // 3.2.1 عمود إضافي: وضع تنظيف رسالة أمر !clear (يمسح رسالة الأمر ورسالة تأكيد البوت، أو أحدهما، أو لا شيء) — يُضبط من الموقع
    await pool.query(`
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS clear_cleanup_mode VARCHAR(20) DEFAULT 'bot_only';
    `);

    // 3.2.2 عمود إضافي: صلاحية رتبة أمري !رتبة و !شرتبة (إعطاء/سحب رتبة يدوياً) — تُضبط من الموقع
    // إذا تُرك فارغاً، تُستخدم رتبة "ادمن ستريس" تلقائياً كافتراضي (بالإضافة لرتبة الإدارة العامة والمدراء)
    await pool.query(`
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS rank_role_id TEXT DEFAULT '';
    `);

    // 3.2.3 أعمدة إضافية: صلاحيات نظام الكلانات — تُضبط من الموقع
    // clan_manager_role_id: رتبة/رتب "مسؤول الكلانات" (يرون كل الكلانات ورومات كل الكلانات)
    // clan_cmd_role_id: من يستخدم أوامر !كلان و !تقديم-كلان (إذا تُرك فارغاً تُستخدم رتبة "ادمن ستريس" تلقائياً)
    await pool.query(`
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS clan_manager_role_id TEXT DEFAULT '';
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS clan_cmd_role_id TEXT DEFAULT '';
    `);

    // 3.3 [إصلاح: دعم أكثر من رتبة لكل صلاحية] توسيع أعمدة الرتب من VARCHAR(100) إلى TEXT
    // لأن VARCHAR(100) لا يتسع لأكثر من رتبتين أو ثلاث آيديات مفصولة بفاصلة (,)
    await pool.query(`
      ALTER TABLE permissions ALTER COLUMN all_commands_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN tax_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN come_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN say_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN claim_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN add_view_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN write_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN tax_channel_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN suggestions_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN ban_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN timeout_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN lock_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN hide_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN clear_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN rename_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN status_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN role_toggle_role_id TYPE TEXT;
      ALTER TABLE permissions ALTER COLUMN rank_role_id TYPE TEXT;
    `);

    // 4. جدول الإحصائيات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stats (
        key VARCHAR(50) PRIMARY KEY,
        total_tickets INT DEFAULT 0
      );
    `);

    // 4.1 جدول إحصائيات استلام التذاكر (إدارة / وسطاء) لكل عضو
    await pool.query(`
      CREATE TABLE IF NOT EXISTS claim_stats (
        user_id VARCHAR(100) PRIMARY KEY,
        admin_claims INT DEFAULT 0,
        mediator_claims INT DEFAULT 0
      );
    `);

    // 5. جدول نظام تقديم الإدارة (تحديث إضافة رتبة القبول)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS apply_setup (
        id VARCHAR(50) PRIMARY KEY,
        title TEXT,
        description TEXT,
        image_url TEXT,
        submit_channel_id VARCHAR(100),
        review_channel_id VARCHAR(100),
        results_channel_id VARCHAR(100),
        high_admin_role_id VARCHAR(100),
        accepted_role_id VARCHAR(100),
        q1 TEXT,
        q2 TEXT,
        q3 TEXT,
        q4 TEXT,
        q5 TEXT,
        last_message_id VARCHAR(100)
      );
    `);

    await pool.query(`
      ALTER TABLE apply_setup ADD COLUMN IF NOT EXISTS accepted_role_id VARCHAR(100);
    `);

    // 🟢 [إصلاح: مشكلة 13] جدول إعدادات عامة (قنوات الضريبة/الاقتراحات/قناة لوق المالك)
    // بديل عن حفظها في الذاكرة فقط، حتى لا تُفقَد عند إعادة تشغيل البوت
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key VARCHAR(50) PRIMARY KEY,
        value JSONB NOT NULL
      );
    `);

    // 🟢 [إصلاح: «الحفظ لا يعمل» والكتابة في الحقيقة ناجحة]
    // «CREATE TABLE IF NOT EXISTS» لا يغيّر نوع عمود قائم، فقاعدة أُنشئ فيها
    // bot_settings.value نصاً (TEXT) في نسخة قديمة تظلّ نصية إلى الأبد. ونتيجةً
    // لذلك يعود كل إعداد نصاً لا كائناً، فتُسقطه مطبّعات الإعدادات إلى القيم
    // الافتراضية: البطاقة تعرض الافتراضي دائماً، وشريط الحفظ يقول «أرسلنا …
    // لكن الخادم أعاد …»، والاختصارات المحفوظة تختفي — مع أن الكتابة ناجحة.
    // نحوّل العمود مرة واحدة عند الإقلاع، فلا يحتاج المالك أي أمر يدوي.
    // (استعلام نوع العمود أولاً حتى لا نُنفّذ شيئاً إن كان jsonb أصلاً)
    try {
      const valueColumn = await pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'bot_settings' AND column_name = 'value';
      `);
      const dataType = valueColumn.rows[0] && valueColumn.rows[0].data_type;
      if (dataType && dataType !== 'jsonb') {
        await pool.query(`ALTER TABLE bot_settings ALTER COLUMN value TYPE JSONB USING value::jsonb;`);
        console.log(`🛠️ حُوّل عمود bot_settings.value من ${dataType} إلى JSONB — كان يمنع ظهور الإعدادات المحفوظة في اللوحة.`);
      }
    } catch (err) {
      // لا نُسقط الإقلاع: القراءة تتعامل مع القيمة النصية بأمان عبر storedJson.js
      console.error('⚠️ تعذّر تحويل عمود bot_settings.value إلى JSONB:', err.message);
    }

    // 🟢 [إصلاح: مشكلة 13] جدول أصوات الاقتراحات (بديل عن client.suggestionVotes في الذاكرة)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suggestion_votes (
        message_id VARCHAR(30) PRIMARY KEY,
        yes_ids JSONB NOT NULL DEFAULT '[]',
        no_ids JSONB NOT NULL DEFAULT '[]'
      );
    `);

    console.log('🐘 تم تحديث الجداول وإضافة خيار رتبة القبول بنجاح!');
  } catch (err) {
    console.error('❌ خطأ أثناء إعداد قاعدة البيانات:', err);
  }
}
initDatabase();

module.exports = pool;
