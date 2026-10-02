'use strict';
// ==========================================================================
// 🗂️ commandCategories.js — تصنيف كل أمر إلى القسم الذي ينتمي إليه
//
// تُستخدم هذه الخرائط في صفحة الأوامر لتصفية البطاقات حسب التصنيف
// (تذاكر / إدارة / إشراف أعلى / مالك / إكسبي / خدمات / أخرى).
//
// 📌 المدخلات مرتّبة أبجدياً عمداً. عند إضافة أمر جديد ضعه في موضعه الأبجدي
//    حتى تبقى القائمة قابلة للمسح بالعين ولا تتحول إلى كومة عشوائية.
//    الترتيب هنا للقراءة فقط — البحث يتم بالمفتاح ولا يتأثر بالترتيب إطلاقاً.
// ==========================================================================

const COMMAND_CATEGORIES = Object.freeze({
  admin: Object.freeze(['admin']),
  other: Object.freeze(['other']),
  owner: Object.freeze(['owner']),
  senior: Object.freeze(['senior']),
  services: Object.freeze(['services']),
  tickets: Object.freeze(['tickets']),
  xp: Object.freeze(['xp'])
});

// 🔗 أي قسم تتبعه كل استمارة حفظ في صفحة الأوامر
const FORM_ACTION_CATEGORIES = Object.freeze({
  '/save-command-come': COMMAND_CATEGORIES.services,
  '/save-command-permissions/channel-access': COMMAND_CATEGORIES.admin,
  '/save-command-permissions/clans': COMMAND_CATEGORIES.admin,
  '/save-command-permissions/global': COMMAND_CATEGORIES.senior,
  '/save-command-permissions/owner-log': COMMAND_CATEGORIES.owner,
  '/save-command-permissions/rename': COMMAND_CATEGORIES.admin,
  '/save-command-permissions/role-toggle': COMMAND_CATEGORIES.admin,
  '/save-command-permissions/status': COMMAND_CATEGORIES.owner,
  '/save-command-permissions/suggestions': COMMAND_CATEGORIES.admin,
  '/save-command-permissions/tax-channel': COMMAND_CATEGORIES.admin,
  '/save-command-say': COMMAND_CATEGORIES.services,
  '/save-command-tax': COMMAND_CATEGORIES.services,
  '/save-warn-dm': COMMAND_CATEGORIES.admin
});

// ⚡ تصنيف حسب المهمة لا حسب نوع التفاعل، حتى تظهر أوامر السلاش والبريفكس معاً في مكانها.
const SLASH_COMMAND_CATEGORIES = Object.freeze({
  avatar: COMMAND_CATEGORIES.services,
  ban: COMMAND_CATEGORIES.admin,
  botstatus: COMMAND_CATEGORIES.owner,
  channel: COMMAND_CATEGORIES.admin,
  claimstats: COMMAND_CATEGORIES.tickets,
  clan: COMMAND_CATEGORIES.services,
  clear: COMMAND_CATEGORIES.admin,
  color: COMMAND_CATEGORIES.services,
  colors: COMMAND_CATEGORIES.services,
  come: COMMAND_CATEGORIES.admin,
  credits: COMMAND_CATEGORIES.services,
  creditsgrant: COMMAND_CATEGORIES.admin,
  help: COMMAND_CATEGORIES.other,
  hide: COMMAND_CATEGORIES.admin,
  kick: COMMAND_CATEGORIES.admin,
  lock: COMMAND_CATEGORIES.admin,
  logchannel: COMMAND_CATEGORIES.owner,
  move: COMMAND_CATEGORIES.admin,
  moveme: COMMAND_CATEGORIES.admin,
  mute: COMMAND_CATEGORIES.admin,
  myinfo: COMMAND_CATEGORIES.xp,
  points: COMMAND_CATEGORIES.admin,
  profile: COMMAND_CATEGORIES.xp,
  rep: COMMAND_CATEGORIES.services,
  reset: Object.freeze(['admin', 'xp']),
  role: COMMAND_CATEGORIES.admin,
  roles: COMMAND_CATEGORIES.services,
  roll: COMMAND_CATEGORIES.other,
  say: COMMAND_CATEGORIES.admin,
  server: COMMAND_CATEGORIES.services,
  setcolor: COMMAND_CATEGORIES.admin,
  setlevel: Object.freeze(['admin', 'xp']),
  setnick: COMMAND_CATEGORIES.admin,
  setxp: Object.freeze(['admin', 'xp']),
  short: COMMAND_CATEGORIES.other,
  show: COMMAND_CATEGORIES.admin,
  slowmode: COMMAND_CATEGORIES.admin,
  tax: COMMAND_CATEGORIES.services,
  ticket: COMMAND_CATEGORIES.tickets,
  time: COMMAND_CATEGORIES.admin,
  title: COMMAND_CATEGORIES.xp,
  top: COMMAND_CATEGORIES.xp,
  unban: COMMAND_CATEGORIES.admin,
  unlock: COMMAND_CATEGORIES.admin,
  unmute: COMMAND_CATEGORIES.admin,
  untime: COMMAND_CATEGORIES.admin,
  user: COMMAND_CATEGORIES.services,
  vkick: COMMAND_CATEGORIES.admin,
  warn: COMMAND_CATEGORIES.admin,
  warn_remove: COMMAND_CATEGORIES.admin,
  warnings: COMMAND_CATEGORIES.admin,
  xpmanage: COMMAND_CATEGORIES.xp
});

function getSlashCommandCategories(name) {
  return SLASH_COMMAND_CATEGORIES[name] || COMMAND_CATEGORIES.other;
}

module.exports = {
  COMMAND_CATEGORIES,
  FORM_ACTION_CATEGORIES,
  SLASH_COMMAND_CATEGORIES,
  getSlashCommandCategories
};
