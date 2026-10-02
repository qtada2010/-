'use strict';
// ==========================================================================
// 🧯 dbResilience.js — صمود اتصال قاعدة البيانات عند الإقلاع
//
// المشكلة التي يحلّها هذا الملف:
// عند إقلاع البوت تُنشئ عدة ملفات جداولها في الوقت نفسه (database · xp ·
// clans · welcome · autoRoles · system)، وكل ملف يُطلق استعلامات متتابعة.
// فيفتح الـ Pool كل اتصالاته (العشرات الافتراضية) دفعة واحدة. وإن كانت
// القاعدة خلف مجمّع اتصالات محدود الحجم — مثل Supabase — ظهر الخطأ:
//
//   FATAL: (EMAXCONNSESSION) max clients reached in session mode
//          - max clients are limited to pool_size: 15
//
// والأسوأ أن هذا الخطأ يقع عند الإقلاع في نص إنشاء الجداول، فتبقى الجداول
// ناقصة وتبدو ميزة كاملة معطلة بلا سبب ظاهر.
//
// العلاج من مكان واحد (لأن كل الملفات تستعمل نفس الـ pool):
//   1) استعلامات البنية (CREATE/ALTER/DROP) تُنفَّذ **واحداً بعد آخر** بدل
//      دفعة واحدة، فلا يُفتح أكثر من اتصال واحد للتهيئة في الوقت نفسه.
//   2) أي استعلام يفشل بسبب امتلاء الاتصالات يُعاد تلقائياً بانتظار متزايد،
//      فتنتهي معظم حالات EMAXCONNSESSION وحدها بلا تدخل.
//   3) عند الفشل النهائي تظهر رسالة تشرح السبب والحل العملي، بدل خطأ خام.
//
// لا يُدخل الملف أي اعتمادية، ولا يغيّر نتيجة أي استعلام ناجح: هو غلاف
// حول pool.query فقط.
// ==========================================================================

/** أخطاء «امتلاء الاتصالات» — من مجمّع Supabase أو من الخادم نفسه */
function isConnectionLimitError(error) {
  if (!error) return false;
  const message = String(error.message || '');
  const code = String(error.code || '');
  return (
    message.includes('EMAXCONNSESSION') ||
    /max clients reached/i.test(message) ||
    /too many clients/i.test(message) ||
    /remaining connection slots/i.test(message) ||
    code === '53300' // too_many_connections
  );
}

/** استعلام بنية (جدول/عمود/فهرس) — يُنفَّذ متسلسلاً وقت الإقلاع */
function isSchemaStatement(sql) {
  const text = String(sql || '');
  return /^\s*(CREATE|ALTER|DROP|COMMENT\s+ON|REINDEX)\b/i.test(text) ||
    text.includes('information_schema');
}

function normalizeArgs(text, params) {
  if (text && typeof text === 'object') {
    return { text: String(text.text || ''), params: text.values };
  }
  return { text: String(text || ''), params };
}

const RETRY_MESSAGE = '⚠️ اتصالات قاعدة البيانات ممتلئة (max clients reached). تعذّر تنفيذ استعلام';
const ADVICE = [
  '   الحل (أي واحد منها يكفي):',
  '   ١) في Supabase استخدم رابط «Transaction pooler» على المنفذ 6543 بدل 5432',
  '      (Project Settings ← Database ← Connection pooling)، فهو يسمح باتصالات أكثر.',
  '   ٢) قلّل عدد اتصالات البوت: PG_POOL_MAX=3',
  '   ٣) أو ارفع حجم المجمّع (Pool size) من إعدادات Supabase.'
].join('\n');

/**
 * يُركّب على الـ pool غلافاً يقاوم امتلاء الاتصالات.
 *
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {number}   [options.maxAttempts=5]     عدد محاولات الاستعلام الواحد
 * @param {number}   [options.baseDelayMs=500]   أساس الانتظار المتزايد
 * @param {Function} [options.wait]              دالة الانتظار (تُستبدل في الاختبارات)
 * @param {Function} [options.log]               دالة التسجيل (console.error افتراضاً)
 * @returns {import('pg').Pool} نفس الـ pool بعد التركيب
 */
function installResilientQuery(pool, options = {}) {
  if (!pool || typeof pool.query !== 'function') return pool;
  if (pool.__resilientQueryInstalled) return pool;

  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);
  const baseDelayMs = Math.max(1, Number(options.baseDelayMs) || 500);
  const wait = typeof options.wait === 'function'
    ? options.wait
    : ms => new Promise(resolve => setTimeout(resolve, ms));
  const log = typeof options.log === 'function' ? options.log : console.error;

  const originalQuery = pool.query.bind(pool);
  const originalConnect = typeof pool.connect === 'function' ? pool.connect.bind(pool) : null;

  /** ينفّذ عملية، ويُعيد المحاولة إن كان الفشل امتلاء اتصالات */
  async function withRetry(operation, label) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isConnectionLimitError(error) || attempt >= maxAttempts) {
          if (isConnectionLimitError(error)) {
            log(`${RETRY_MESSAGE} ${label} بعد ${attempt} محاولات.\n${ADVICE}`);
          }
          throw error;
        }
        await wait(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  // 🧱 سلسلة واحدة لاستعلامات البنية: لا يتجاوز استعلامان منها في وقت واحد،
  // فتنتهي تهيئة الإقلاع بلا موجة اتصالات. الاختبارات تبقى على الأصل.
  let schemaChain = Promise.resolve();

  pool.query = function resilientQuery(text, params) {
    const { text: sql } = normalizeArgs(text, params);
    const run = () => withRetry(() => originalQuery(text, params), sql.replace(/\s+/g, ' ').trim().slice(0, 80));

    if (!isSchemaStatement(sql)) return run();

    const chained = schemaChain.then(run, run);
    // نُبقي السلسلة سليمة حتى لو فشل استعلام؛ الخطأ يصل للمستدعي كما هو.
    schemaChain = chained.then(() => {}, () => {});
    return chained;
  };

  // 🔌 نفس المعالجة للاتصالات المخصّصة (المعاملات في clans.js و slashCommands.js)
  if (originalConnect) {
    pool.connect = function resilientConnect(...args) {
      if (typeof args[args.length - 1] === 'function') return originalConnect(...args);
      return withRetry(() => originalConnect(...args), 'الحصول على اتصال مخصّص');
    };
  }

  pool.__resilientQueryInstalled = true;
  return pool;
}

module.exports = { installResilientQuery, isConnectionLimitError, isSchemaStatement };
