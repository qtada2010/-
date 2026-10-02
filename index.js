// ==========================================
// نقطة تشغيل البوت — تجميع كل الملفات المقسّمة
// (يماثل تماماً نفس الترتيب والمنطق الموجود في index.js الأصلي)
// ==========================================

// 🛡️ شبكة أمان عامة: تسجيل أي خطأ غير متوقع بدل إيقاف عملية Node بالكامل
// (لا تغيّر سلوك أي أمر ناجح؛ تمنع فقط توقف البوت كله بسبب خطأ في مكان واحد)
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

// 1. قاعدة البيانات (الاتصال + إنشاء/تحديث الجداول يحدث تلقائياً عند الاستدعاء)
const pool = require('./database');

// 2. عميل الديسكورد + البريفكسات
const { client, PREFIX, ADMIN_PREFIX } = require('./discordClient');

// 3. الحالة المشتركة (روم لوق أخطاء المالك)
const state = require('./state');

// 4. الدوال المساعدة الخاصة بالتذاكر (sendLogError, getTicketInfo, resolveTicketSettings, saveTranscript, hasAdminCommandPermission, createHelpEmbed, handleTicketCreation)
const helpers = require('./ticketHelpers')(client, pool, state);

// 4.1 حالة استلام التذاكر (إدارة/وسطاء) — مخزَّنة بقاعدة البيانات بدل موضوع القناة
const claimState = require('./ticketClaimState')(pool);

// 5. تسجيل أوامر السلاش وإدارة تنفيذها
require('./ready')(client, helpers.sendLogError);
require('./slashCommands')(client, pool);

// 6. خادم الويب ولوحة التحكم الشاملة (Express) — تعمل بنفس منطق app.listen الأصلي
const app = require('./dashboard')(pool, client);

// 7. معالجة أوامر الرسائل (البريفكس)
require('./messageCreate')(client, pool, PREFIX, ADMIN_PREFIX, state, helpers);

// 🔗 استدعاء ملف أوامر النظام والإدارة (system.js) — يُستدعى قبل interactionCreate
// لأنه يُصدّر دالة buildFullHelpMenu المستخدمة الآن أيضاً في أمر السلاش /help (قائمة موحّدة)
const systemCommands = require('./system.js')(client, '!', pool);

// 8. معالجة التفاعلات والنماذج (Apply Forms + Tickets)
require('./interactionCreate')(client, pool, helpers, claimState, systemCommands);

// ⭐ استدعاء نظام الإكسبي والمستويات والتوب (xp.js) — ملف مستقل تماماً
require('./xp.js')(client, pool, app);

// 📌 استدعاء أوامر التحكم ببروفايلات الاستلام (claimCommands.js) — ملف مستقل تماماً
require('./claimCommands.js')(client, pool, helpers);

// 🏰 استدعاء نظام الكلانات والفرق (clans.js) — ملف مستقل تماماً
require('./clans.js')(client, pool, helpers);

// 🎭 استدعاء نظام الرتب التلقائية لشخص محدد عند الدخول (autoRoles.js) — ملف مستقل تماماً
require('./autoRoles.js')(client, pool, app);

// 👋 استدعاء لوحة رسالة الترحيب (welcome.js) — ملف مستقل تماماً
require('./welcome.js')(client, pool, app);

client.login(process.env.DISCORD_TOKEN);
