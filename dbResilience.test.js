'use strict';

// ============================================================================
// 🧯 صمود الاتصال عند الإقلاع (dbResilience.js)
//
// العطل الذي يقفله هذا الملف — ظهر على الاستضافة فعلاً:
//
//   ❌ خطأ أثناء إنشاء جداول نظام الإكسبي:
//      error: (EMAXCONNSESSION) max clients reached in session mode
//             - max clients are limited to pool_size: 15
//      at async initXpTables (/opt/render/project/src/xp.js:20:7)
//
// السبب: ملفات عدة (database · xp · clans · welcome · autoRoles · system)
// تُنشئ جداولها عند الإقلاع في الوقت نفسه، فيفتح الـ Pool كل اتصالاته دفعة
// واحدة ويتجاوز حد مجمّع Supabase. والنتيجة الأخطر أن نص التهيئة يفشل وتبقى
// الجداول ناقصة، فتبدو ميزة كاملة معطلة.
//
// العلاج يقفله هذا الملف: استعلامات البنية تتسلسل واحداً بعد آخر، وأي
// استعلام يفشل بامتلاء الاتصالات يُعاد تلقائياً بانتظار متزايد.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { installResilientQuery, isConnectionLimitError, isSchemaStatement } = require('./dbResilience');

/** خطأ مطابق لما يرسله مجمّع Supabase حرفياً */
function limitError() {
  const error = new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15');
  error.code = 'XX000';
  error.severity = 'FATAL';
  return error;
}

/** pool وهمي: ينفّذ ردوداً معدّة مسبقاً ويسجّل ما جرى */
function createFakePool(responses) {
  const calls = [];
  const pool = {
    calls,
    async query(text, params) {
      calls.push(text);
      const next = responses[calls.length - 1];
      if (typeof next === 'function') return next(text, params);
      if (next instanceof Error) throw next;
      return next || { rows: [], rowCount: 0 };
    },
    async connect() { return { query: pool.query, release() {} }; },
    on() {}
  };
  return pool;
}

const noWait = () => Promise.resolve();

test('يميّز أخطاء امتلاء الاتصالات عن غيرها', () => {
  assert.ok(isConnectionLimitError(limitError()), 'خطأ Supabase يُعرف من نصّه');
  assert.ok(isConnectionLimitError(Object.assign(new Error('لا مكان'), { code: '53300' })),
    'ورفض الخادم too_many_connections يُعرف من رمزه');
  assert.ok(!isConnectionLimitError(new Error('relation does not exist')));
  assert.ok(!isConnectionLimitError(null));
});

test('يميّز استعلامات البنية التي تُسلسَل', () => {
  assert.ok(isSchemaStatement('CREATE TABLE IF NOT EXISTS xp_users (id INT);'));
  assert.ok(isSchemaStatement('\n      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS x INT;'));
  assert.ok(isSchemaStatement("SELECT data_type FROM information_schema.columns WHERE table_name = 'bot_settings';"),
    'قراءة schema معلوماتية أيضاً جزء من التهيئة');
  assert.ok(!isSchemaStatement("SELECT * FROM xp_users WHERE user_id = '1';"));
  assert.ok(!isSchemaStatement("INSERT INTO bot_settings (key) VALUES ('x');"));
});

test('الاستعلام يفشل مرة ثم ينجح: يُعاد بلا تدخل', async () => {
  const pool = installResilientQuery(createFakePool([
    limitError(),
    { rows: [{ ok: 1 }], rowCount: 1 }
  ]), { wait: noWait, log() {} });

  const result = await pool.query('CREATE TABLE IF NOT EXISTS xp_settings (key VARCHAR(50));');

  assert.deepStrictEqual(result.rows, [{ ok: 1 }], 'النتيجة تصل كما لو لم يحدث شيء');
  assert.strictEqual(pool.calls.length, 2, 'محاولة أولى فاشلة ثم محاولة ناجحة');
});

test('الخطأ غير المتعلق بالاتصالات لا يُعاد (لا نُخفي أعطالاً حقيقية)', async () => {
  const pool = installResilientQuery(createFakePool([
    Object.assign(new Error('syntax error at or near "CREAT"'), { code: '42601' })
  ]), { wait: noWait, log() {} });

  await assert.rejects(() => pool.query('CREAT TABLE x (id INT);'), /syntax error/);
  assert.strictEqual(pool.calls.length, 1, 'لا إعادة محاولة على خطأ صياغة');
});

test('بعد نفاد المحاولات يُرمى الخطأ مع رسالة تشرح الحل', async () => {
  const attempts = 3;
  const logged = [];
  const pool = installResilientQuery(createFakePool(
    Array.from({ length: attempts }, () => limitError())
  ), { maxAttempts: attempts, wait: noWait, log: message => logged.push(message) });

  await assert.rejects(() => pool.query('CREATE TABLE x (id INT);'), /max clients reached/);
  assert.strictEqual(pool.calls.length, attempts, 'يُحاول بالعدد المحدَّد ثم يتوقف');
  assert.strictEqual(logged.length, 1, 'رسالة واحدة تشرح الحل');
  assert.match(logged[0], /6543/, 'تدلّ على مجمّع المعاملات في Supabase');
  assert.match(logged[0], /PG_POOL_MAX/, 'وتدلّ على ضبط عدد الاتصالات');
});

test('استعلامات البنية تتسلسل فلا تفتح موجة اتصالات', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const pool = createFakePool([]);
  pool.query = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight -= 1;
    return { rows: [], rowCount: 0 };
  };
  installResilientQuery(pool, { wait: noWait, log() {} });

  await Promise.all([
    pool.query('CREATE TABLE IF NOT EXISTS a (id INT);'),
    pool.query('CREATE TABLE IF NOT EXISTS b (id INT);'),
    pool.query('ALTER TABLE a ADD COLUMN IF NOT EXISTS x INT;')
  ]);

  assert.strictEqual(maxInFlight, 1,
    'استعلام بنية واحد في الوقت الواحد — وهذا جوهر منع EMAXCONNSESSION');
});

test('الاستعلامات العادية لا تتسلسل فلا تتبطّأ اللوحة', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const pool = createFakePool([]);
  pool.query = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight -= 1;
    return { rows: [], rowCount: 0 };
  };
  installResilientQuery(pool, { wait: noWait, log() {} });

  await Promise.all([
    pool.query('SELECT * FROM xp_users WHERE user_id = $1', ['1']),
    pool.query('SELECT value FROM bot_settings WHERE key = $1', ['x'])
  ]);

  assert.strictEqual(maxInFlight, 2, 'القراءات العادية تبقى متوازية كما كانت');
});

test('فشل استعلام بنية لا يُعطّل الذي بعده', async () => {
  const pool = installResilientQuery(createFakePool([
    Object.assign(new Error('relation "old" does not exist'), { code: '42P01' }),
    { rows: [{ ok: 1 }], rowCount: 1 }
  ]), { wait: noWait, log() {} });

  await assert.rejects(() => pool.query('DROP TABLE old;'), /does not exist/);
  const result = await pool.query('CREATE TABLE IF NOT EXISTS fresh (id INT);');
  assert.deepStrictEqual(result.rows, [{ ok: 1 }], 'السلسلة تُكمل بعد الخطأ');
});

test('الصيغة الكائنية للاستعلام مدعومة ({ text, values })', async () => {
  const pool = installResilientQuery(createFakePool([
    limitError(),
    { rows: [{ ok: 1 }], rowCount: 1 }
  ]), { wait: noWait, log() {} });

  const result = await pool.query({ text: 'CREATE TABLE IF NOT EXISTS x (id INT);', values: [] });
  assert.deepStrictEqual(result.rows, [{ ok: 1 }]);
});

test('الاتصال المخصّص (المعاملات) يُعاد أيضاً عند امتلاء الاتصالات', async () => {
  let attempts = 0;
  const pool = {
    async query() { return { rows: [], rowCount: 0 }; },
    async connect() {
      attempts += 1;
      if (attempts === 1) throw limitError();
      return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
    },
    on() {}
  };
  installResilientQuery(pool, { wait: noWait, log() {} });

  const conn = await pool.connect();
  assert.strictEqual(attempts, 2, 'أُعيدت المحاولة فنجحت');
  assert.ok(typeof conn.release === 'function');
});

test('التركيب مرتين لا يُضاعف المحاولات', async () => {
  const pool = createFakePool([limitError(), { rows: [], rowCount: 0 }]);
  installResilientQuery(pool, { wait: noWait, log() {} });
  installResilientQuery(pool, { wait: noWait, log() {} });

  await pool.query('CREATE TABLE IF NOT EXISTS x (id INT);');
  assert.strictEqual(pool.calls.length, 2, 'غلاف واحد فقط فعّال');
});
