'use strict';
// ==========================================================================
// 🏷️ aliasRules.js — قواعد الاختصارات في مكان واحد
//
// طلب المالك (النسخة النهائية): حرية كاملة في الاختصار.
//   • أي نص مسموح: عربي · إنجليزي · أرقام · رموز (`&*&@*` · `#` · `$` · `/`) · إيموجي.
//   • الحد الأقصى 32 حرفاً.
//   • **حالتان فقط للرفض**:
//       1) الاختصار أطول من 32 حرفاً.
//       2) الاختصار مستخدم مسبقاً في أمر آخر — ويُذكر اسم صاحبه في الرسالة.
//     لم يعد مرفوضاً: الاختصار المطابق لاسم الأمر نفسه ($help للامر help)،
//     ولا الفاصلة، ولا المسافة.
//
// التخزين: صفيف JSON داخل الحقل المخفي، لأن الفاصلة صارت مسموحة داخل
// الاختصار نفسه فلم تعد صالحة كفاصل. ويُقبل النص المفصول بفواصل (صيغة قديمة)
// حتى لا تضيع اختصارات محفوظة سابقاً.
// ==========================================================================

const ALIAS_MAX_LENGTH = 32;

/** هل طول الاختصار داخل الحد المسموح؟ */
function isAllowedLength(alias) {
  return [...String(alias == null ? '' : alias)].length <= ALIAS_MAX_LENGTH;
}

/**
 * سبب الرفض، أو null إن كان الاختصار مقبولاً.
 * الرفض الوحيد هنا: الطول. أما التكرار فيُفحص في اللوحة (حيث تُعرف أصحاب
 * الاختصارات) لتُعرض رسالة باسم صاحب الاستخدام.
 */
function aliasRejectionReason(alias) {
  const text = String(alias == null ? '' : alias).trim();
  if (!text) return 'اكتب اختصاراً أولاً.';
  if (!isAllowedLength(text)) return `الاختصار أطول من ${ALIAS_MAX_LENGTH} حرفاً — اختصره.`;
  return null;
}

/** هل الاختصار مقبول شكلاً؟ */
function isAliasAllowed(alias) {
  return aliasRejectionReason(alias) === null;
}

/**
 * يفكّ قيمة حقل الاختصارات: صفيف، أو JSON (الصيغة الحالية)، أو نص مفصول
 * بفواصل (صيغة قديمة / إدخال يدوي).
 */
function parseAliasList(value) {
  if (Array.isArray(value)) return value.map(entry => String(entry == null ? '' : entry));
  const text = String(value == null ? '' : value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(entry => String(entry == null ? '' : entry));
    } catch (error) {
      // ليست JSON صالحة → نكمل بالصيغة القديمة أدناه.
    }
  }
  return text.split(',');
}

/**
 * يُطبّع قائمة اختصارات: تقليم، توحيد الحالة، إزالة المكرر، وحذف ما فوق 32.
 * هذا ما يُخزَّن فعلاً، فيجب أن يطابق ما تراه اللوحة تماماً.
 *
 * @param {string[]|string} value مصفوفة، أو JSON، أو نص مفصول بفواصل
 * @returns {string[]}
 */
function normalizeAliases(value) {
  const entries = parseAliasList(value);
  const result = [];
  const seen = new Set();
  for (const entry of entries) {
    const alias = String(entry == null ? '' : entry).trim().toLowerCase();
    if (!alias || !isAliasAllowed(alias)) continue;
    if (seen.has(alias)) continue;
    seen.add(alias);
    result.push(alias);
  }
  return result;
}

/**
 * كم كلمةً من بداية الرسالة يطابق اختصاراً محفوظاً؟ (0 إن لم يطابق شيء)
 *
 * الاختصار قد يتكوّن من أكثر من كلمة («حظر عام»)، والرسالة تصل ككلمات، فنقبل
 * أطول اختصار يطابق بداية الرسالة. يُستخدم في كل مسارات الاختصارات حتى
 * يعمل الاختصار كما كتبه المالك تماماً.
 */
function aliasWordCount(aliases, words) {
  const list = (Array.isArray(aliases) ? aliases : [])
    .map(alias => String(alias == null ? '' : alias).trim().toLowerCase())
    .filter(Boolean);
  if (!list.length || !words || !words.length) return 0;
  let matched = 0;
  for (const alias of list) {
    const aliasWords = alias.split(/\s+/);
    if (aliasWords.length <= matched || aliasWords.length > words.length) continue;
    if (aliasWords.every((word, index) => word === words[index])) matched = aliasWords.length;
  }
  return matched;
}

/** هل تبدأ الرسالة باختصار محفوظ؟ (بدون عدد الكلمات) */
function matchAliasPhrase(aliases, words) {
  return aliasWordCount(aliases, words) > 0;
}

module.exports = {
  ALIAS_MAX_LENGTH,
  aliasRejectionReason,
  isAliasAllowed,
  isAllowedLength,
  parseAliasList,
  normalizeAliases,
  aliasWordCount,
  matchAliasPhrase
};
