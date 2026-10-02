// ==========================================================================
// 🌉 systemSlashBridge.js — جسر بين أوامر السلاش وأوامر نظام system.js
//
// المشكلة التي يحلّها:
//   أوامر مثل !اضافة و !كتابة و !r و !رول و !الحالة منطقها داخل system.js،
//   ويعتمد على متغيرات محليّة هناك (رومات الضريبة، رومات الاقتراحات،
//   دالة الصلاحيات hasCommandPermission...). ونريد لها نسخة سلاش
//   دون نسخ المنطق إلى ملف آخر فيتفرّع السلوك مع الوقت.
//
// الحل:
//   system.js يسجّل معالجاً لكل اسم أمر سلاش، و slashCommands.js يستدعيه.
//   المنطق يبقى في مكان واحد، والتعريف والتسجيل مع ديسكورد يبقيان في مكانهما.
//
// ملاحظة: التسجيل يحدث عند تحميل system.js في index.js، أي قبل وصول أي
// تفاعل من ديسكورد، فلا يوجد سباق زمني.
// ==========================================================================
'use strict';

const handlers = new Map();

// أسماء أوامر السلاش التي تنفّذها وحدات أخرى عبر هذا الجسر.
// slashCommands.js يستخدم القائمة ليعرف أنه يجب تفويض التنفيذ بدل
// البحث عن الأمر في مفاتيح execute الخاصة به.
const SYSTEM_SLASH_COMMANDS = Object.freeze([
  'help',                                // system.js (قائمة المساعدة)
  'channel', 'botstatus', 'logchannel',  // system.js
  'ticket',                              // messageCreate.js (أوامر داخل التذكرة)
  'claimstats',                          // claimCommands.js (سجل الاستلام)
  'xpmanage', 'myinfo',                  // xp.js (إدارة الإكسبي والمعلومات)
  'clan'                                 // clans.js (لوحات الكلانات)
]);

function registerSystemSlashHandler(name, handler) {
  if (typeof handler !== 'function') throw new TypeError(`معالج الأمر ${name} يجب أن يكون دالة`);
  handlers.set(name, handler);
}

function getSystemSlashHandler(name) {
  return handlers.get(name) || null;
}

function hasSystemSlashHandler(name) {
  return handlers.has(name);
}

module.exports = {
  SYSTEM_SLASH_COMMANDS,
  registerSystemSlashHandler,
  getSystemSlashHandler,
  hasSystemSlashHandler
};
