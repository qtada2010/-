#!/usr/bin/env node
'use strict';

// ============================================================================
// 🩺 diagnoseSaving.js — تشخيص «الحفظ لا يعمل»
//
// شغّل هذا على نفس الخادم الذي يعمل عليه البوت:
//
//     node diagnoseSaving.js
//
// لا يُعدّل أي إعداد من إعداداتك. يكتب مفتاحاً تجريبياً واحداً ثم يحذفه،
// ويقرأ إعداداتك الحقيقية قراءةً فقط ليخبرك بما هو مخزَّن فعلاً.
//
// الهدف: الفصل القاطع بين ثلاثة احتمالات يصعب تمييزها من الشاشة:
//   ١) الكتابة لا تصل قاعدة البيانات أصلاً.
//   ٢) الكتابة تصل وتُحفظ، لكن البوت يعمل بشفرة قديمة فلا يستعملها.
//   ٣) الكتابة تصل، والشفرة حديثة، والمشكلة في المتصفح وحده.
// ============================================================================

const path = require('path');
const fs = require('fs');

const root = __dirname;
const line = () => console.log('─'.repeat(64));
const ok = msg => console.log('  ✅ ' + msg);
const bad = msg => console.log('  ❌ ' + msg);
const warn = msg => console.log('  ⚠️  ' + msg);

(async () => {
  console.log('');
  console.log('🩺 تشخيص حفظ إعدادات اللوحة');
  line();

  // ---------------------------------------------------------------- ١) الشفرة
  console.log('\n[١] إصدار الشفرة الموجودة على هذا الخادم');
  const dashboardSource = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  const hasSaveBar = dashboardSource.includes('data-save-bar');
  const hasUnifiedPath = dashboardSource.includes('العلاج البنيوي: مسار حفظ');
  const hasOldGuard = dashboardSource.includes('window.addEventListener(\'beforeunload\'')
    && !hasUnifiedPath;

  if (!hasSaveBar) {
    warn('لا يوجد شريط حفظ — هذه نسخة أقدم من إضافة الشريط.');
  } else if (hasOldGuard) {
    bad('نسخة وسيطة معطوبة: فيها شريط الحفظ وحارس المغادرة بلا توحيد المسار.');
    bad('هذه بالضبط النسخة التي يُلغي فيها تحذيرُ المتصفح عمليةَ الحفظ.');
    bad('السحب من الفرع لم يكتمل. نفّذ: git pull && أعد تشغيل البوت.');
  } else if (hasUnifiedPath) {
    ok('أحدث نسخة: مسار حفظ موحّد مع منع التضارب.');
  }

  // ------------------------------------------------------------ ٢) الاتصال
  console.log('\n[٢] الاتصال بقاعدة البيانات');
  if (!process.env.DATABASE_URL) {
    bad('المتغير DATABASE_URL غير معرَّف في هذه الجلسة.');
    bad('شغّل الأمر بنفس بيئة البوت، وإلا فالفحص يقيس شيئاً آخر.');
    process.exit(1);
  }

  const { Pool } = require(path.join(root, 'node_modules', 'pg'));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  try {
    const now = await pool.query('SELECT NOW() AS t');
    ok('الاتصال ناجح — وقت الخادم: ' + now.rows[0].t.toISOString());
  } catch (error) {
    bad('تعذّر الاتصال: ' + error.message);
    process.exit(1);
  }

  // -------------------------------------------------------------- ٣) الجدول
  console.log('\n[٣] جدول bot_settings (مستودع كل إعدادات الأوامر)');
  const table = await pool.query(
    `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns WHERE table_name = 'bot_settings'`
  );
  if (!table.rowCount) {
    bad('الجدول غير موجود إطلاقاً — لا يمكن حفظ أي إعداد.');
    bad('يُنشئه initDatabase عند إقلاع البوت؛ راجع سجلّ الإقلاع بحثاً عن خطأ.');
    await pool.end();
    process.exit(1);
  }
  ok('الجدول موجود: ' + table.rows.map(r => r.column_name + ' ' + r.data_type).join(' · '));

  // نوع عمود value هو أسرع تفسير لِما يلي: الكتابة تنجح، والصفحة تعرض الافتراضي.
  const valueType = (table.rows.find(r => r.column_name === 'value') || {}).data_type;
  if (valueType === 'jsonb') {
    ok('نوع عمود value سليم (jsonb) — الإعدادات تُقرأ ككائنات لا كنصوص.');
  } else {
    bad('عمود value نوعه «' + (valueType || 'غير معروف') + '» وليس jsonb — هذه علّة «الحفظ لا يعمل»:');
    bad('الكتابة تصل وتُحفظ، لكن كل إعداد يُقرأ نصاً فتُسقطه اللوحة إلى القيم');
    bad('الافتراضية، فيبدو الحفظ فاشلاً وهو ناجح.');
    bad('العلاج: شغّل البوت بنسخة فيها storedJson.js — يحوّل العمود إلى jsonb عند الإقلاع.');
  }

  const pk = await pool.query(
    `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'bot_settings'::regclass AND i.indisprimary`
  );
  if (pk.rows.some(r => r.attname === 'key')) {
    ok('المفتاح الأساسي على العمود key سليم (ON CONFLICT يعمل).');
  } else {
    bad('لا يوجد مفتاح أساسي على key — كل عمليات الحفظ ستفشل.');
    bad('الإصلاح: ALTER TABLE bot_settings ADD PRIMARY KEY (key);');
  }

  // ------------------------------------------------------- ٤) اختبار كتابة
  console.log('\n[٤] اختبار كتابة فعلي (مفتاح مؤقت يُحذف بعده)');
  const probeKey = '__diag_probe';
  try {
    await pool.query(
      `INSERT INTO bot_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
      [probeKey, JSON.stringify({ at: Date.now() })]
    );
    const back = await pool.query('SELECT value FROM bot_settings WHERE key = $1', [probeKey]);
    if (back.rowCount) ok('الكتابة والقراءة نجحتا — قاعدة البيانات تقبل الحفظ.');
    else bad('الكتابة لم تُثر خطأ لكن القراءة لم تُرجع شيئاً (مُستبعَد جداً).');
    await pool.query('DELETE FROM bot_settings WHERE key = $1', [probeKey]);
  } catch (error) {
    bad('فشلت الكتابة: ' + error.message);
    bad('هذا سبب كافٍ وحده لتعطّل الحفظ بالكامل.');
  }

  // -------------------------------------------- ٥) ماذا يوجد فعلاً الآن
  console.log('\n[٥] إعداداتك المحفوظة فعلاً الآن (قراءة فقط)');
  const stored = await pool.query(
    `SELECT key, value FROM bot_settings WHERE key = ANY($1::text[])`,
    [['slash_command_config', 'command_warn_dm_config']]
  );

  if (!stored.rowCount) {
    warn('لا يوجد أي إعداد محفوظ. إن كنت قد ضغطت حفظ فعلاً فالكتابة لا تصل.');
  }

  stored.rows.forEach(row => {
    const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    if (row.key === 'slash_command_config') {
      const commands = value.commands || {};
      const withAliases = Object.entries(commands)
        .filter(([, settings]) => (settings.aliases || []).length)
        .map(([name, settings]) => '      ' + name + ' → ' + settings.aliases.join(' · '));
      console.log('  • slash_command_config: ' + Object.keys(commands).length + ' أمر');
      if (withAliases.length) {
        ok('اختصارات محفوظة في ' + withAliases.length + ' أمر:');
        withAliases.forEach(l => console.log(l));
      } else {
        warn('لا يوجد أي اختصار محفوظ.');
      }
    }
    if (row.key === 'command_warn_dm_config') {
      console.log('  • command_warn_dm_config: مفعّل=' + value.enabled
        + ' · طول النص=' + String(value.messageText || '').length);
    }
  });

  // ------------------------------------------- ٦) كم نسخة من البوت تعمل؟
  console.log('\n[٦] عدد نسخ البوت المتصلة بقاعدة البيانات');
  // كل نسخة تفتح اتصالات باسم تطبيق واحد؛ تعدّد العناوين يكشف تعدّد النسخ.
  const clients = await pool.query(
    `SELECT client_addr, count(*) AS n FROM pg_stat_activity
      WHERE datname = current_database() AND client_addr IS NOT NULL
      GROUP BY client_addr`
  ).catch(() => null);
  if (!clients) {
    warn('لا صلاحية لقراءة pg_stat_activity — تجاوزنا هذا الفحص.');
  } else if (clients.rowCount > 1) {
    bad('يوجد ' + clients.rowCount + ' عنوان مختلف متصل بقاعدة البيانات:');
    clients.rows.forEach(r => console.log('      ' + r.client_addr + ' — ' + r.n + ' اتصال'));
    bad('تشغيل أكثر من نسخة من البوت يجعل كل نسخة تكتب فوق الأخرى.');
    bad('أوقف النسخ الزائدة وأبقِ واحدة فقط.');
  } else {
    ok('نسخة واحدة متصلة — لا تضارب بين النسخ.');
  }

  // عدد الجلسات المفتوحة الآن: الخطأ EMAXCONNSESSION يقع عند تجاوز حد المجمّع
  // (15 جلسة في مجمّع Supabase للجلسات)، وهو ما يمنع إنشاء الجداول عند الإقلاع.
  const sessions = await pool.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`
  ).catch(() => null);
  const poolMax = Number.parseInt(process.env.PG_POOL_MAX, 10) || 5;
  if (sessions) {
    const open = sessions.rows[0].n;
    console.log('  • جلسات مفتوحة الآن: ' + open + ' — وحجم مجمّع كل نسخة: ' + poolMax
      + (process.env.PG_POOL_MAX ? ' (PG_POOL_MAX)' : ' (افتراضي)'));
    if (open + poolMax > 15) {
      warn('المجموع يقترب من حدّ مجمّع الجلسات (15 عادةً في Supabase) — ينفع استخدام');
      warn('Transaction pooler على المنفذ 6543، أو تقليل PG_POOL_MAX، أو إنزال عدد النسخ.');
    } else {
      ok('المجموع داخل الحدّ المتوقع للمجمّع.');
    }
  }

  // ------------------------------------- ٧) اختبار الكتابة ثم القراءة الباردة
  console.log('\n[٧] هل تثبت الكتابة فعلاً؟ (كتابة ثم قراءة من اتصال جديد)');
  const warnKey = 'command_warn_dm_config';
  const before = await pool.query('SELECT value FROM bot_settings WHERE key = $1', [warnKey]);
  const original = before.rowCount ? before.rows[0].value : null;
  const marker = 'تحقق-' + Date.now();
  try {
    const probe = Object.assign({}, original || { enabled: false }, { embedTitle: marker });
    await pool.query(
      `INSERT INTO bot_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
      [warnKey, JSON.stringify(probe)]
    );
    // اتصال جديد تماماً: يتجاوز أي ذاكرة أو معاملة مفتوحة
    const { Pool: FreshPool } = require(path.join(root, 'node_modules', 'pg'));
    const second = new FreshPool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    const readBack = await second.query('SELECT value FROM bot_settings WHERE key = $1', [warnKey]);
    await second.end();
    const landed = readBack.rowCount && readBack.rows[0].value.embedTitle === marker;
    if (landed) ok('الكتابة ثبتت وقرأها اتصال مستقل — قاعدة البيانات سليمة تماماً.');
    else {
      bad('الكتابة لم تثبت! اتصال مستقل لا يرى ما كُتب للتوّ.');
      bad('أسباب محتملة: القراءة من نسخة احتياطية (read replica)، أو معاملة');
      bad('غير مُثبتة، أو أن DATABASE_URL يشير إلى قاعدتين مختلفتين.');
    }
    // نُعيد القيمة الأصلية فلا نترك أثراً
    if (original) {
      await pool.query('UPDATE bot_settings SET value = $2::jsonb WHERE key = $1', [warnKey, JSON.stringify(original)]);
      ok('أُعيدت قيمتك الأصلية — لم نترك أي تغيير.');
    } else {
      await pool.query('DELETE FROM bot_settings WHERE key = $1', [warnKey]);
    }
  } catch (error) {
    bad('فشل اختبار الكتابة/القراءة: ' + error.message);
  }

  // ------------------------------------------------------------- الخلاصة
  console.log('');
  line();
  console.log('📋 كيف تقرأ النتيجة:');
  console.log('');
  console.log('  • [٤] فشل            → العطل في قاعدة البيانات، والشفرة بريئة.');
  console.log('  • [٤] نجح و[٥] فارغ  → الكتابة ممكنة لكن طلبات الحفظ لا تصل');
  console.log('                          الخادم: المشكلة في المتصفح أو الشفرة.');
  console.log('  • [٤] نجح و[٥] يعرض  → الحفظ يعمل فعلاً! وإن لم يستجب البوت');
  console.log('    ما حفظتَه            فالسبب أنه يعمل بشفرة قديمة: أعد تشغيله.');
  console.log('  • [١] قال «نسخة وسيطة معطوبة» → هذا هو السبب مباشرةً.');
  console.log('  • [٦] أكثر من نسخة      → أوقف الزائدة؛ النسخ تكتب فوق');
  console.log('                             بعضها وهذا يُضيع التعديلات.');
  console.log('  • [٧] فشل                → العطل في قاعدة البيانات نفسها');
  console.log('                             لا في البوت.');
  line();
  console.log('');

  await pool.end();
})().catch(error => {
  console.error('\n❌ توقف التشخيص: ' + error.message);
  process.exit(1);
});
