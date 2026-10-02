'use strict';
// ==========================================================================
// اختبارات ترتيب الأوامر — تضمن أن قوائم الأوامر تبقى مرتّبة أبجدياً
// في كل الواجهات، وأن الترتيب لا يحذف أو يكرّر أي أمر.
// ==========================================================================
const test = require('node:test');
const assert = require('node:assert');

const { compareNames, sortByName, sortKey } = require('./commandSorting');
const { SLASH_COMMAND_CATEGORIES, FORM_ACTION_CATEGORIES } = require('./commandCategories');

test('الأسماء الإنجليزية ترتَّب من a إلى z بغض النظر عن حالة الأحرف', () => {
  assert.deepEqual(
    sortByName(['warn', 'Ban', 'avatar', 'role', 'Clear']),
    ['avatar', 'Ban', 'Clear', 'role', 'warn']
  );
});

test('الأرقام داخل الأسماء ترتَّب رقمياً لا نصياً', () => {
  // الترتيب النصي يضع status10 قبل status2 — المقارن الرقمي يصحّح ذلك
  assert.deepEqual(
    sortByName(['status10', 'status2', 'status']),
    ['status', 'status2', 'status10']
  );
});

test('الإيموجي في بداية العنوان لا يؤثر على موضعه', () => {
  // الترتيب يتم على النص بعد إزالة الإيموجي:
  // «اغلاق» ثم «اوامر» (غ قبل و) ثم «حاسبه» (ا قبل ح).
  assert.deepEqual(
    sortByName(['💰 حاسبة الضريبة', 'أوامر عامة', '🔒 إغلاق التذكرة']),
    ['🔒 إغلاق التذكرة', 'أوامر عامة', '💰 حاسبة الضريبة']
  );
});

test('صيغ الألف والهمزة والتاء المربوطة تُعامل كصيغة واحدة', () => {
  assert.equal(sortKey('الإدارة'), sortKey('الادارة'));
  assert.equal(sortKey('إغلاق'), sortKey('اغلاق'));
  assert.equal(compareNames('الإدارة العامة', 'الادارة العامة'), 0);
});

test('الترتيب لا يعدّل المصفوفة الأصلية', () => {
  // مهم: مصفوفات مثل commandData مشتركة مع تسجيل أوامر السلاش،
  // وترتيبها في مكانها قد يغيّر سلوكاً آخر في البوت.
  const original = ['warn', 'ban', 'avatar'];
  const copy = [...original];
  const sorted = sortByName(original);
  assert.deepEqual(original, copy, 'المصفوفة الأصلية تغيّرت!');
  assert.notStrictEqual(sorted, original);
});

test('الترتيب لا يحذف ولا يكرّر أي عنصر', () => {
  const names = Object.keys(SLASH_COMMAND_CATEGORIES);
  const sorted = sortByName(names);
  assert.equal(sorted.length, names.length);
  assert.deepEqual([...sorted].sort(), [...names].sort());
});

test('ملف commandCategories مكتوب بترتيب أبجدي', () => {
  // يمنع عودة الملف إلى الفوضى عند إضافة أوامر جديدة لاحقاً.
  for (const [label, keys] of [
    ['SLASH_COMMAND_CATEGORIES', Object.keys(SLASH_COMMAND_CATEGORIES)],
    ['FORM_ACTION_CATEGORIES', Object.keys(FORM_ACTION_CATEGORIES)]
  ]) {
    assert.deepEqual(
      keys,
      sortByName(keys),
      `${label} لم يعد مرتّباً أبجدياً — ضع المدخل الجديد في موضعه الصحيح.`
    );
  }
});

test('ترتيب أوامر كاتالوج المساعدة قابل للتطبيق على كل الأقسام', () => {
  const sample = [
    { title: 'مسح الرسائل' }, { title: 'إضافة رتبة' }, { title: '🏰 الكلانات' }
  ];
  const sorted = sortByName(sample, cmd => cmd.title);
  assert.deepEqual(sorted.map(c => c.title), ['إضافة رتبة', '🏰 الكلانات', 'مسح الرسائل']);
});
