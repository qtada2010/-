'use strict';

// ============================================================================
// 🏷️ قواعد الاختصارات: حرية كاملة — والرفض في حالتين فقط
//
// طلب المالك (النسخة النهائية): «خلّني أقدر أضيف أي أمر، بشرط ما يكون موجوداً
// في أي أمر سابقاً، أو يكون أطول من 32 حرفاً — هنا فقط يرفض».
//   1) مستخدم مسبقاً في أمر آخر → رسالة تذكر اسم صاحبه.
//   2) أطول من 32 حرفاً.
// وما عدا ذلك مسموح: `$come` للأمر come، والفاصلة، والمسافة، والرموز، والإيموجي.
//
// التخزين: صفيف JSON في الحقل المخفي (لأن الفاصلة صارت مسموحة داخل الاختصار).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  ALIAS_MAX_LENGTH,
  isAliasAllowed,
  isAllowedLength,
  aliasRejectionReason,
  parseAliasList,
  normalizeAliases
} = require('./aliasRules');

test('الرموز والأرقام والعربية والإنجليزية مسموحة كلها', () => {
  for (const alias of ['&*&@*', '!!!', '@everyone', '#حظر', '₪', '★', 'x_y-z', 'لف', '12345', 'تعال']) {
    assert.ok(isAliasAllowed(alias), `${alias} يجب أن يكون مسموحاً`);
  }
});

test('الاختصار المطابق لاسم الأمر نفسه مسموح الآن ($help للأمر help)', () => {
  for (const alias of ['$help', '/help', 'help', 'come', '!come']) {
    assert.strictEqual(aliasRejectionReason(alias, 'help'), null, `${alias} مرفوض بغير حق`);
  }
});

test('الفاصلة والمسافة مسموحتان أيضاً — لم يبقَ إلا الرفضان المذكوران', () => {
  for (const alias of ['a,b', 'a b', 'حظر, عام', '#حظر عام']) {
    assert.strictEqual(aliasRejectionReason(alias), null, `${alias} يجب أن يكون مسموحاً`);
  }
});

test('الحد الأقصى 32 حرفاً — وما فوقه مرفوض برسالة', () => {
  const exactly = 'a'.repeat(ALIAS_MAX_LENGTH);
  const tooLong = 'a'.repeat(ALIAS_MAX_LENGTH + 1);
  assert.ok(isAllowedLength(exactly), '32 حرفاً مسموحة');
  assert.ok(!isAllowedLength(tooLong), '33 حرفاً مرفوضة');
  assert.match(aliasRejectionReason(tooLong), /32/);
  assert.strictEqual(aliasRejectionReason(exactly), null);
});

test('الحالتان الوحيدتان للرفض: الطول، أو الفراغ', () => {
  // أي نص آخر مقبول شكلاً — أما التكرار فيُفحص في اللوحة باسم صاحب الاستخدام.
  const rejected = ['', '   '];
  for (const alias of rejected) assert.ok(aliasRejectionReason(alias), `«${alias}» مرفوض`);
  const accepted = ['$come', '#حظر', 'a,b', 'a b', 'تعال', 'x'.repeat(32)];
  for (const alias of accepted) assert.strictEqual(aliasRejectionReason(alias), null);
});

test('التفكيك يقبل JSON والصفيف والنص المفصول بفواصل', () => {
  assert.deepStrictEqual(parseAliasList('["#حظر","a,b"]'), ['#حظر', 'a,b'], 'JSON هو الصيغة الحالية');
  assert.deepStrictEqual(parseAliasList(['لف']), ['لف'], 'الصفيف كما هو');
  assert.deepStrictEqual(parseAliasList('لف, بان'), ['لف', ' بان'], 'صيغة قديمة مقبولة (التقليم في التطبيع)');
  assert.deepStrictEqual(normalizeAliases('لف, بان'), ['لف', 'بان'], 'التطبيع يُزيل فراغ الفاصل');
  assert.deepStrictEqual(parseAliasList(''), [], 'الفارغ لا شيء');
  assert.deepStrictEqual(parseAliasList('[ليست JSON'), ['[ليست JSON'], 'نص تالف يُعامَل كنص عادي');
});

test('التطبيع: توحيد الحالة، إزالة المكرر، وحذف ما فوق 32', () => {
  assert.deepStrictEqual(
    normalizeAliases(['  Come ', 'come', '#حظر', '#حظر', '$come']),
    ['come', '#حظر', '$come'],
    'المكرر يُزال والحالة تُوحّد ولا شيء يُسقط من الأسماء'
  );
  assert.deepStrictEqual(normalizeAliases('["a,b","a b"]'), ['a,b', 'a b'], 'الفاصلة والمسافة تبقى داخل الاختصار');
  assert.deepStrictEqual(normalizeAliases(['x'.repeat(40), 'قصير']), ['قصير'], 'الطويل وحده يُحذف');
});

test('مطابقة الاختصار على كلمات الرسالة: أطول صيغة تفوز، والبريفكس يُتجاهل', () => {
  const { aliasWordCount, matchAliasPhrase } = require('./aliasRules');
  const aliases = ['حظر عام', 'حظر'];
  assert.equal(aliasWordCount(aliases, ['حظر', 'عام', '<@7>']), 2, 'الأطول يفوز');
  assert.equal(aliasWordCount(aliases, ['حظر', '<@7>']), 1, 'والمفرد يعمل وحده');
  assert.equal(aliasWordCount(aliases, ['حظرة']), 0, 'لا تطابق جزئي');
  assert.equal(aliasWordCount([], ['حظر']), 0, 'قائمة فارغة');
  assert.equal(matchAliasPhrase(['a b'], ['a', 'b', 'c']), true);
  assert.equal(matchAliasPhrase(['a b'], ['a', 'c']), false);
});

test('الخادم يخزّن ما تكتبه اللوحة حرفياً (JSON عبر الحفظ)', () => {
  const { normalizeAliases: serverNormalize } = require('./slashCommandConfig');
  assert.strictEqual(typeof serverNormalize, 'undefined', 'المصدر الوحيد للقواعد هو aliasRules');
});

test('اللوحة تطبّق القواعد نفسها: الرفض بالتكرار مع اسم الصاحب، أو الطول', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
  assert.ok(dashboard.includes('const ALIAS_MAX = 32'), 'حدّ الطول في اللوحة 32');
  assert.ok(dashboard.includes("'هذا الاختصار مستخدم في «'"),
    'رسالة التكرار موجودة');
  assert.ok(dashboard.includes("'» سابقاً — اختر اسماً غيره.'"),
    'وتذكر أن الاختصار مستخدم سابقاً — كما طلب المالك');
  assert.ok(dashboard.includes('aliasCompareKeys(cleaned)') && dashboard.includes('owner !== ownerLabel'),
    'الفحص عبر خريطة أصحاب الاختصارات لا قائمة حجب (وبكل صيغ البريفكس، مع استثناء اسم الأمر نفسه)');
  assert.ok(dashboard.includes('aliasCompareKeys(cleaned)'), 'والصيغ «!x» و«$x» و«x» اختصار واحد في الفحص');
  assert.ok(!dashboard.includes("['$', '/'].some(prefix => alias === prefix + canonical)"),
    'لم يعد هناك منع لاسم الأمر نفسه');
  assert.ok(dashboard.includes('data-alias-values value="${escapeHtml(JSON.stringify(aliasList))}"'),
    'التخزين JSON ليسمح بالفاصلة داخل الاختصار');
});

test('الخادم لم يعد يحصر الاختصارات في الحروف والأرقام', () => {
  const commandConfig = fs.readFileSync(path.join(__dirname, 'commandConfig.js'), 'utf8');
  const slashConfig = fs.readFileSync(path.join(__dirname, 'slashCommandConfig.js'), 'utf8');
  const oldPattern = /\[\\p\{L\}\\p\{N\}_-\]\{1,32\}/;
  assert.ok(!oldPattern.test(commandConfig), 'لا صيغة قديمة في إعدادات الأوامر');
  assert.ok(!oldPattern.test(slashConfig), 'ولا في إعدادات أوامر السلاش');
});
