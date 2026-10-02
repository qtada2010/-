'use strict';

const { parseStoredJson } = require('./storedJson');
const { normalizeAliases: normalizeAliasList } = require('./aliasRules');

const TAX_COMMAND_DEFAULTS = Object.freeze({
  enabled: true,
  aliases: [],
  taxRatePercent: 5,
  embedTitle: '💰 حاسبة ضريبة ProBot',
  originalLabel: 'المبلغ الأصلي:',
  netLabel: 'المبلغ الصافي:',
  grossLabel: 'المبلغ الواجب تحويله:',
  embedColor: '#059669'
});

const COME_COMMAND_DEFAULTS = Object.freeze({
  enabled: true,
  aliases: [],
  embedTitle: '🔔 لديك استدعاء في السيرفر!',
  embedDescription: 'تم استدعاؤك بواسطة الإداري: **{admin}**\n\n📌 **الروم:** {channel}\n🔗 [اضغط هنا للذهاب للروم]({link})',
  embedColor: '#EAB308'
});

const SAY_COMMAND_DEFAULTS = Object.freeze({
  enabled: true,
  aliases: [],
  deleteInvocation: true,
  mentionPolicy: 'all'
});

const CLOSE_COMMAND_DEFAULTS = Object.freeze({
  enabled: true,
  aliases: []
});

const MODERATION_COMMAND_DEFAULTS = Object.freeze({
  ban: Object.freeze({ enabled: true, banAliases: [], unbanAliases: [] }),
  timeout: Object.freeze({ enabled: true, timeAliases: [], untimeAliases: [] }),
  rank: Object.freeze({ enabled: true, rankAliases: [], unrankAliases: [] })
});

// ==========================================================================
// ⚠️ رسالة الإنذار الخاصة (DM)
//
// عند تنفيذ /warn تُرسل للعضو رسالة خاصة قابلة للتخصيص بالكامل من اللوحة:
// نص بمتغيرات + إيمبد (عنوان، لون، صورة، فوتر) + مفتاح تشغيل/إيقاف.
//
// المتغيرات المدعومة تُعرَّف في WARN_DM_VARIABLES ليبقى مصدرها واحداً
// تستعمله اللوحة للعرض والبوت للاستبدال، فلا يتفرّقان أبداً.
// ==========================================================================
const WARN_DM_VARIABLES = Object.freeze([
  { key: '{العضو}', description: 'اسم العضو المُنذَر' },
  { key: '{السبب}', description: 'سبب الإنذار' },
  { key: '{المشرف}', description: 'اسم المشرف الذي أصدر الإنذار' },
  { key: '{السيرفر}', description: 'اسم السيرفر' },
  { key: '{رقم_الإنذار}', description: 'رقم الإنذار التسلسلي' },
  { key: '{عدد_الإنذارات}', description: 'إجمالي إنذارات العضو بعد هذا الإنذار' }
]);

const WARN_DM_DEFAULTS = Object.freeze({
  enabled: true,
  // النص العادي يظهر فوق الإيمبد؛ اتركه فارغاً للاكتفاء بالإيمبد.
  messageText: 'مرحباً {العضو}، وصلك إنذار من إدارة **{السيرفر}**.',
  embedEnabled: true,
  embedTitle: '⚠️ إنذار رسمي',
  embedDescription: '**السبب:** {السبب}\n**المشرف:** {المشرف}\n**رقم الإنذار:** #{رقم_الإنذار}\n**عدد إنذاراتك:** {عدد_الإنذارات}',
  embedColor: '#834DD9',
  embedImageUrl: '',
  embedThumbnailUrl: '',
  embedFooter: '{السيرفر} · يرجى الالتزام بالقوانين'
});

const COMMAND_CONTROL_DEFAULTS = Object.freeze({
  claim: Object.freeze({ enabled: true, addAdminAliases: [], removeAdminAliases: [], clearAdminAliases: [], clearAllAdminAliases: [], addMediatorAliases: [], removeMediatorAliases: [], clearMediatorAliases: [], clearAllMediatorAliases: [], clearAllAliases: [], clearAllProfilesAliases: [] }),
  channelAccess: Object.freeze({ enabled: true, addAliases: [], writeAliases: [] }),
  taxChannel: Object.freeze({ enabled: true, aliases: [] }),
  suggestions: Object.freeze({ enabled: true, aliases: [] }),
  channelModeration: Object.freeze({ enabled: true, lockAliases: [], unlockAliases: [], hideAliases: [], showAliases: [] }),
  clear: Object.freeze({ enabled: true, aliases: [] }),
  renameChannel: Object.freeze({ enabled: true, aliases: [] }),
  status: Object.freeze({ enabled: true, statusAliases: [], status2Aliases: [] }),
  roleToggle: Object.freeze({ enabled: true, aliases: [] }),
  clans: Object.freeze({ enabled: true, clanAliases: [], applyAliases: [] }),
  ticketCommands: Object.freeze({ enabled: true, saveAliases: [], deleteAliases: [], addAliases: [], removeAliases: [], renameAliases: [] }),
  ownerLog: Object.freeze({ enabled: true, aliases: [] })
});

const COMMAND_CONTROL_ALIAS_DEFINITIONS = Object.freeze([
  ['claim', 'addAdminAliases', 'اضافة-استلام-اداري'], ['claim', 'removeAdminAliases', 'سحب-استلام-اداري'],
  ['claim', 'clearAdminAliases', 'تصفير-استلام-اداري'], ['claim', 'clearAllAdminAliases', 'تصفير-الكل-استلام-اداري'],
  ['claim', 'addMediatorAliases', 'اضافة-استلام-وسيط'], ['claim', 'removeMediatorAliases', 'سحب-استلام-وسيط'],
  ['claim', 'clearMediatorAliases', 'تصفير-استلام-وسيط'], ['claim', 'clearAllMediatorAliases', 'تصفير-الكل-استلام-وسيط'],
  ['claim', 'clearAllAliases', 'تصفير-استلام'], ['claim', 'clearAllProfilesAliases', 'تصفير-الكل-استلام'],
  ['channelAccess', 'addAliases', 'اضافة'],
  ['channelAccess', 'writeAliases', 'كتابة'],
  ['taxChannel', 'aliases', 'ضريبة'], ['suggestions', 'aliases', 'اقتراحات'],
  ['channelModeration', 'lockAliases', 'lock'], ['channelModeration', 'unlockAliases', 'unlock'],
  ['channelModeration', 'hideAliases', 'hide'], ['channelModeration', 'showAliases', 'show'],
  ['clear', 'aliases', 'مسح'], ['renameChannel', 'aliases', 'r'],
  ['status', 'statusAliases', 'الحالة'], ['status', 'status2Aliases', 'الحالة2'],
  ['roleToggle', 'aliases', 'رول'], ['clans', 'clanAliases', 'كلان'], ['clans', 'applyAliases', 'تقديم-كلان'],
  ['ticketCommands', 'saveAliases', 'save'], ['ticketCommands', 'deleteAliases', 'delete'],
  ['ticketCommands', 'addAliases', 'add'], ['ticketCommands', 'removeAliases', 'remove'],
  ['ticketCommands', 'renameAliases', 'rename'], ['ownerLog', 'aliases', 'logowner']
]);

function normalizeTaxCommandConfig(value = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const parsedRate = Number(config.taxRatePercent);

  return {
    enabled: config.enabled !== false,
    // `$tax` remains a stable built-in command; these are extra names for it.
    aliases: normalizeAliases(config.aliases, 'tax'),
    taxRatePercent: Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 99
      ? parsedRate
      : TAX_COMMAND_DEFAULTS.taxRatePercent,
    embedTitle: normalizeText(config.embedTitle, TAX_COMMAND_DEFAULTS.embedTitle, 256),
    originalLabel: normalizeText(config.originalLabel, TAX_COMMAND_DEFAULTS.originalLabel, 256),
    netLabel: normalizeText(config.netLabel, TAX_COMMAND_DEFAULTS.netLabel, 256),
    grossLabel: normalizeText(config.grossLabel, TAX_COMMAND_DEFAULTS.grossLabel, 256),
    embedColor: normalizeColor(config.embedColor, TAX_COMMAND_DEFAULTS.embedColor)
  };
}

function normalizeComeCommandConfig(value = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    enabled: config.enabled !== false,
    // `$come` stays as the canonical name; custom names are additional aliases.
    aliases: normalizeAliases(config.aliases, 'come'),
    embedTitle: normalizeText(config.embedTitle, COME_COMMAND_DEFAULTS.embedTitle, 256),
    embedDescription: normalizeText(config.embedDescription, COME_COMMAND_DEFAULTS.embedDescription, 4000),
    embedColor: normalizeColor(config.embedColor, COME_COMMAND_DEFAULTS.embedColor)
  };
}

function normalizeSayCommandConfig(value = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const mentionPolicies = ['all', 'users', 'roles', 'none'];

  return {
    enabled: config.enabled !== false,
    // `$say` remains available as the canonical command.
    aliases: normalizeAliases(config.aliases, 'say'),
    deleteInvocation: config.deleteInvocation !== false,
    mentionPolicy: mentionPolicies.includes(config.mentionPolicy)
      ? config.mentionPolicy
      : SAY_COMMAND_DEFAULTS.mentionPolicy
  };
}

function normalizeCloseCommandConfig(value = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: config.enabled !== false,
    aliases: normalizeAliases(config.aliases, 'close')
  };
}

// 🔓 (2026-10-02) لا قائمة أسماء محجوبة بعد اليوم — طلب المالك: أي نص حتى
// 32 حرفاً. الرفض الوحيد أن يكون الاختصار مستخدماً في مكان آخر، و«!x» و«$x»
// و«x» اختصار واحد عند التشغيل فتُحجز صيغه الثلاث معاً.
function aliasClaimKeys(alias) {
  const key = String(alias == null ? '' : alias).trim().toLowerCase();
  if (!key) return [];
  const bare = (key[0] === '!' || key[0] === '$') ? key.slice(1).trim() : key;
  return bare && bare !== key ? [key, bare] : [key];
}

function makeAliasClaimer() {
  const claimed = new Set();
  return alias => {
    const keys = aliasClaimKeys(alias);
    if (keys.some(key => claimed.has(key))) return false;
    keys.forEach(key => claimed.add(key));
    return true;
  };
}

function normalizeModerationCommandConfig(value = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const claimAlias = makeAliasClaimer();
  const normalizeUniqueAliases = value => normalizeAliases(value).filter(claimAlias);
  const group = key => config[key] && typeof config[key] === 'object' && !Array.isArray(config[key]) ? config[key] : {};
  const ban = group('ban');
  const timeout = group('timeout');
  const rank = group('rank');

  return {
    ban: {
      enabled: ban.enabled !== false,
      banAliases: normalizeUniqueAliases(ban.banAliases),
      unbanAliases: normalizeUniqueAliases(ban.unbanAliases)
    },
    timeout: {
      enabled: timeout.enabled !== false,
      timeAliases: normalizeUniqueAliases(timeout.timeAliases),
      untimeAliases: normalizeUniqueAliases(timeout.untimeAliases)
    },
    rank: {
      enabled: rank.enabled !== false,
      rankAliases: normalizeUniqueAliases(rank.rankAliases),
      unrankAliases: normalizeUniqueAliases(rank.unrankAliases)
    }
  };
}

function resolveModerationCommandAlias(command, value = {}) {
  const config = normalizeModerationCommandConfig(value);
  const name = String(command || '').trim().toLowerCase();
  if (config.ban.banAliases.includes(name)) return 'ban';
  if (config.ban.unbanAliases.includes(name)) return 'unban';
  if (config.timeout.timeAliases.includes(name)) return 'time';
  if (config.timeout.untimeAliases.includes(name)) return 'untime';
  if (config.rank.rankAliases.includes(name)) return 'رتبة';
  if (config.rank.unrankAliases.includes(name)) return 'شرتبة';
  return null;
}

function normalizeCommandControlConfig(value = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  // 🔓 لا أسماء محجوبة: أي اختصار يكتبه المالك يعمل، والرفض الوحيد تكراره.
  const claimAlias = makeAliasClaimer();
  const normalized = Object.fromEntries(Object.entries(COMMAND_CONTROL_DEFAULTS).map(([groupName, defaults]) => {
    const group = config[groupName] && typeof config[groupName] === 'object' && !Array.isArray(config[groupName])
      ? config[groupName]
      : {};
    const result = { enabled: group.enabled !== false };
    for (const field of Object.keys(defaults)) {
      if (field !== 'enabled') result[field] = [];
    }
    return [groupName, result];
  }));

  for (const [groupName, fieldName] of COMMAND_CONTROL_ALIAS_DEFINITIONS) {
    const group = config[groupName] && typeof config[groupName] === 'object' && !Array.isArray(config[groupName])
      ? config[groupName]
      : {};
    normalized[groupName][fieldName] = normalizeAliases(group[fieldName]).filter(claimAlias);
  }
  return normalized;
}

function resolveCommandControlAlias(command, value = {}) {
  const config = normalizeCommandControlConfig(value);
  const name = String(command || '').trim().toLowerCase();
  for (const [groupName, fieldName, canonical] of COMMAND_CONTROL_ALIAS_DEFINITIONS) {
    if (config[groupName][fieldName].includes(name)) return canonical;
  }
  return null;
}

/**
 * مطابقة اختصار أوامر النظام على أكثر من كلمة («رول عام» مثلاً).
 * يُجرّب أطول صيغة أولاً، ويرجع اسم الأمر الرسمي وعدد الكلمات المطابقة.
 * عند عدم وجود اختصار متعدد الكلمات يعطي نفس نتيجة resolveCommandControlAlias.
 */
function resolveCommandControlAliasPhrase(words, value = {}) {
  const list = (Array.isArray(words) ? words : []).map(word => String(word == null ? '' : word).trim().toLowerCase()).filter(Boolean);
  const max = Math.min(list.length, 4);
  for (let size = max; size >= 1; size--) {
    const target = resolveCommandControlAlias(list.slice(0, size).join(' '), value);
    if (target) return { target, words: size };
  }
  return null;
}

// القواعد كلها في aliasRules.js: أي حرف أو رمز مسموح حتى 32 حرفاً،
// ولا رفض إلا للطول (والتكرار يُفحص في اللوحة حيث تُعرف أسماء الأصحاب).
function normalizeAliases(value) {
  return normalizeAliasList(value);
}

/** رابط صورة آمن: https فقط، وإلا يُهمَل (يمنع حقن javascript: وغيره) */
function normalizeImageUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (!/^https:\/\/[^\s<>"']+$/i.test(text)) return '';
  return text.slice(0, 500);
}

/** نص اختياري: يُسمح بتركه فارغاً، بعكس normalizeText التي تعيد الافتراضي */
function normalizeOptionalText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : '';
}

function normalizeWarnDmConfig(value = {}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  // أول تشغيل (لا يوجد إعداد محفوظ إطلاقاً) → القالب الافتراضي الجاهز،
  // حتى لا يجد المالك بطاقة فارغة ويظن الميزة معطّلة.
  // أما بعد أول حفظ فنحترم أي حقل يفرّغه عمداً ولا نعيد ملأه.
  if (!Object.keys(config).length) return { ...WARN_DM_DEFAULTS };

  return {
    enabled: config.enabled !== false,
    messageText: normalizeOptionalText(config.messageText, 1800),
    embedEnabled: config.embedEnabled !== false,
    embedTitle: normalizeOptionalText(config.embedTitle, 256),
    embedDescription: normalizeOptionalText(config.embedDescription, 4000),
    embedColor: normalizeColor(config.embedColor, WARN_DM_DEFAULTS.embedColor),
    embedImageUrl: normalizeImageUrl(config.embedImageUrl),
    embedThumbnailUrl: normalizeImageUrl(config.embedThumbnailUrl),
    embedFooter: normalizeOptionalText(config.embedFooter, 2048)
  };
}

function normalizeText(value, fallback, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : fallback;
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value.toUpperCase() : fallback;
}

const COMMAND_CONFIG_CACHE_TTL_MS = 5000;
const commandConfigCaches = new WeakMap();

function getPoolConfigCache(pool) {
  let cache = commandConfigCaches.get(pool);
  if (!cache) {
    cache = new Map();
    commandConfigCaches.set(pool, cache);
  }
  return cache;
}

/**
 * يقرأ إعداد أمر واحد من bot_settings.
 *
 * @param {{fresh?: boolean}} [options] fresh: تجاوز الذاكرة المؤقتة.
 *
 * ⚠️ لماذا تحتاج اللوحة fresh — نفس العلّة التي أصابت إعدادات الأوامر:
 * الذاكرة المؤقتة عمرها خمس ثوانٍ وهي خاصة بكل نسخة من البوت. فإن عرضت
 * اللوحة الإعدادات منها، أظهرت قيمة قد لا تكون ثابتة في قاعدة البيانات —
 * إما لأن نسخة أخرى كتبت بعدها، أو لأن الكتابة لم تثبت أصلاً. فتكذب
 * الواجهة على المستخدم ويبدو أن تعديله «اختفى» بعد إعادة التحميل.
 *
 * الذاكرة تبقى للمسار الساخن: قراءة الإعداد عند كل أمر يُنفَّذ في ديسكورد.
 */
async function getCommandConfig(pool, key, normalize, options = {}) {
  const cache = getPoolConfigCache(pool);
  const cached = options.fresh ? null : cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return normalize(cached.value);

  const result = await pool.query('SELECT value FROM bot_settings WHERE key = $1', [key]);
  // parseStoredJson: قاعدة قديمة تُرجع القيمة نصاً (عمود TEXT) فيجب تحويلها
  // إلى كائن، وإلا استُبدلت كل الإعدادات بالقيم الافتراضية رغم نجاح الحفظ.
  const value = normalize(parseStoredJson(result.rows[0] && result.rows[0].value));
  cache.set(key, { value, expiresAt: Date.now() + COMMAND_CONFIG_CACHE_TTL_MS });
  return normalize(value);
}

async function saveCommandConfig(pool, key, normalize, value) {
  const config = normalize(value);
  await pool.query(
    `INSERT INTO bot_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
    [key, JSON.stringify(config)]
  );
  getPoolConfigCache(pool).set(key, {
    value: config,
    expiresAt: Date.now() + COMMAND_CONFIG_CACHE_TTL_MS
  });
  return config;
}

const getTaxCommandConfig = (pool, options) => getCommandConfig(pool, 'command_tax_config', normalizeTaxCommandConfig, options);
const saveTaxCommandConfig = (pool, value) => saveCommandConfig(pool, 'command_tax_config', normalizeTaxCommandConfig, value);
const getComeCommandConfig = (pool, options) => getCommandConfig(pool, 'command_come_config', normalizeComeCommandConfig, options);
const saveComeCommandConfig = (pool, value) => saveCommandConfig(pool, 'command_come_config', normalizeComeCommandConfig, value);
const getSayCommandConfig = (pool, options) => getCommandConfig(pool, 'command_say_config', normalizeSayCommandConfig, options);
const saveSayCommandConfig = (pool, value) => saveCommandConfig(pool, 'command_say_config', normalizeSayCommandConfig, value);
const getCloseCommandConfig = (pool, options) => getCommandConfig(pool, 'command_close_config', normalizeCloseCommandConfig, options);
const saveCloseCommandConfig = (pool, value) => saveCommandConfig(pool, 'command_close_config', normalizeCloseCommandConfig, value);
const getWarnDmConfig = (pool, options) => getCommandConfig(pool, 'command_warn_dm_config', normalizeWarnDmConfig, options);
const saveWarnDmConfig = (pool, value) => saveCommandConfig(pool, 'command_warn_dm_config', normalizeWarnDmConfig, value);
const getModerationCommandConfig = (pool, options) => getCommandConfig(pool, 'command_moderation_config', normalizeModerationCommandConfig, options);
const saveModerationCommandConfig = (pool, value) => saveCommandConfig(pool, 'command_moderation_config', normalizeModerationCommandConfig, value);
const getCommandControlConfig = (pool, options) => getCommandConfig(pool, 'command_control_config', normalizeCommandControlConfig, options);
const saveCommandControlConfig = (pool, value) => saveCommandConfig(pool, 'command_control_config', normalizeCommandControlConfig, value);

module.exports = {
  TAX_COMMAND_DEFAULTS,
  COME_COMMAND_DEFAULTS,
  SAY_COMMAND_DEFAULTS,
  CLOSE_COMMAND_DEFAULTS,
  MODERATION_COMMAND_DEFAULTS,
  WARN_DM_DEFAULTS,
  WARN_DM_VARIABLES,
  COMMAND_CONTROL_DEFAULTS,
  normalizeTaxCommandConfig,
  normalizeComeCommandConfig,
  normalizeSayCommandConfig,
  normalizeCloseCommandConfig,
  normalizeModerationCommandConfig,
  normalizeWarnDmConfig,
  resolveModerationCommandAlias,
  normalizeCommandControlConfig,
  resolveCommandControlAlias,
  resolveCommandControlAliasPhrase,
  getTaxCommandConfig,
  saveTaxCommandConfig,
  getComeCommandConfig,
  saveComeCommandConfig,
  getSayCommandConfig,
  saveSayCommandConfig,
  getCloseCommandConfig,
  saveCloseCommandConfig,
  getModerationCommandConfig,
  saveModerationCommandConfig,
  getWarnDmConfig,
  saveWarnDmConfig,
  getCommandControlConfig,
  saveCommandControlConfig
};
