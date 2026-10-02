#!/usr/bin/env node
'use strict';
// ==========================================================================
// 🔍 compareSnapshots.js — أداة تحقّق (ليست جزءاً من تشغيل البوت)
//
// تقارن لقطتين من مجلدات renderSnapshots وتجيب على سؤال واحد:
// «هل تغيّر أي شيء غير ترتيب العرض؟»
//
// لكل صفحة تتحقق من:
//   1) أن كل بطاقة أمر موجودة قبل وبعد (لا بطاقة ضاعت ولا بطاقة ظهرت)
//   2) أن محتوى كل بطاقة متطابق حرفياً بعد توحيد المسافات
//   3) أن بقية الصفحة (ما عدا البطاقات) متطابقة
//   4) أن كل مسار فورم (action) ما زال موجوداً — أي لا أمر فقد زر الحفظ
//
// الاستخدام:
//   node compareSnapshots.js .snapshots/before .snapshots/after
// ==========================================================================

const fs = require('fs');
const path = require('path');

const [, , beforeDir, afterDir] = process.argv;
if (!beforeDir || !afterDir) {
  console.error('الاستخدام: node compareSnapshots.js <قبل> <بعد>');
  process.exit(1);
}

// الصفحة تعرض الأوامر بشكلين مختلفين:
//  • بطاقات قابلة للتعديل في /commands  →  <section class="card cmd-card">
//  • بطاقات عرض فقط في /commands-list   →  <article class="directory-command">
// نتعامل مع الاثنين حتى تشمل المقارنة كل أسطح عرض الأوامر.
const CARD_RE = /<section class="card cmd-card"[\s\S]*?\n\s*<\/section>|<article class="directory-command"[\s\S]*?<\/article>/g;
// بعض الصفحات تحقن خرائط بحث جاهزة في جافاسكربت الصفحة، مثل:
//     const categoryByFormAction = {"/save-command-tax":["services"], ...};
// ترتيب مفاتيح هذه الخرائط لا أثر له إطلاقاً (الوصول إليها بالمفتاح)، لذا
// نوحّده قبل المقارنة حتى لا يُحسب إعادةُ ترتيب مصدرِ البيانات تغييراً حقيقياً.
function canonicalizeLookups(html) {
  return html.replace(/(= )(\{"[^\n]*?\})(;)/g, (whole, prefix, json, suffix) => {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return whole;
      const sorted = Object.keys(parsed).sort().reduce((acc, k) => { acc[k] = parsed[k]; return acc; }, {});
      return prefix + JSON.stringify(sorted) + suffix;
    } catch {
      return whole;
    }
  });
}

// 🔖 بصمة العملية (INSTANCE_ID) تُولَّد عشوائياً عند كل تشغيل — عمداً، لكشف
// تعدّد النسخ (انظر dashboard.js). فهي تختلف بين لقطتين حتى لو كان الناتج
// مطابقاً حرفياً، فتُلوّن المقارنة بالأحمر بلا سبب وتُخفي أي تغيير حقيقي.
// نوحّدها قبل المقارنة: بصمة البناء (BUILD_ID) تبقى كما هي لأنها تكشف تغيّر
// الكود فعلاً، أما معرّف العملية فلا معنى له في المقارنة.
// المعرّف يظهر مرتين في وسم الشريط: في data-instance وفي نصّ التلميح (title).
const canonicalizeInstanceId = html => html
  .replace(/data-instance="[^"]*"/g, 'data-instance="INSTANCE"')
  .replace(/(معرّف العملية )[0-9a-f]{4,}/g, '$1INSTANCE');

const normalize = html => canonicalizeInstanceId(canonicalizeLookups(html)).replace(/\s+/g, ' ').trim();

function nameOf(markup) {
  const card = markup.match(/class="cmd-name">([^<]+)</);
  if (card) return card[1].trim();
  const directory = markup.match(/<code>\/([^<]+)<\/code>/);
  if (directory) return directory[1].trim();
  return '؟';
}

function cardsOf(html) {
  const map = new Map();
  const order = [];
  for (const match of html.match(CARD_RE) || []) {
    const name = nameOf(match);
    map.set(name, normalize(match));
    order.push(name);
  }
  return { map, order };
}

let failures = 0;
let reorderedPages = 0;

const files = fs.readdirSync(beforeDir).filter(f => f.endsWith('.html')).sort();

for (const file of files) {
  const beforePath = path.join(beforeDir, file);
  const afterPath = path.join(afterDir, file);
  if (!fs.existsSync(afterPath)) {
    console.log(`❌ ${file}: الصفحة مفقودة في اللقطة الجديدة`);
    failures++;
    continue;
  }

  const before = fs.readFileSync(beforePath, 'utf8');
  const after = fs.readFileSync(afterPath, 'utf8');

  const b = cardsOf(before);
  const a = cardsOf(after);

  const problems = [];

  // 1) مجموعة البطاقات نفسها
  const lost = [...b.map.keys()].filter(name => !a.map.has(name));
  const added = [...a.map.keys()].filter(name => !b.map.has(name));
  if (lost.length) problems.push(`بطاقات ضاعت: ${lost.join(', ')}`);
  if (added.length) problems.push(`بطاقات جديدة: ${added.join(', ')}`);

  // 2) محتوى كل بطاقة
  const changed = [...b.map.keys()].filter(name => a.map.has(name) && a.map.get(name) !== b.map.get(name));
  if (changed.length) problems.push(`محتوى تغيّر في: ${changed.join(', ')}`);

  // 3) بقية الصفحة خارج البطاقات
  const shellBefore = normalize(before.replace(CARD_RE, '§'));
  const shellAfter = normalize(after.replace(CARD_RE, '§'));
  if (shellBefore !== shellAfter) problems.push('الهيكل العام للصفحة تغيّر خارج البطاقات');

  // 4) مسارات الحفظ
  const actions = html => [...html.matchAll(/action="([^"]+)"/g)].map(m => m[1]).sort();
  const actionsBefore = actions(before).join('|');
  const actionsAfter = actions(after).join('|');
  if (actionsBefore !== actionsAfter) problems.push('قائمة مسارات الحفظ (form action) تغيّرت');

  const reordered = b.order.join('|') !== a.order.join('|');
  if (reordered) reorderedPages++;

  if (problems.length) {
    failures++;
    console.log(`❌ ${file}`);
    problems.forEach(p => console.log(`     • ${p}`));
  } else {
    const tag = reordered ? `🔤 أُعيد ترتيب ${a.order.length} بطاقة` : '✅ مطابق';
    console.log(`✅ ${file.padEnd(34)} ${tag}`);
  }
}

console.log('');
if (failures) {
  console.log(`❌ فشل التحقق في ${failures} صفحة — راجع التعديل.`);
  process.exit(1);
}
console.log(`✅ ${files.length} صفحة: لا شيء تغيّر سوى الترتيب (${reorderedPages} صفحة أُعيد ترتيبها).`);
