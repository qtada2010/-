'use strict';

const { parseStoredJson } = require('./storedJson');
const { normalizeAliases } = require('./aliasRules');

const SLASH_COMMAND_NAMES = Object.freeze([
  'help', 'credits', 'creditsgrant', 'rep', 'moveme', 'color', 'colors', 'short', 'roll',
  'profile', 'top', 'title', 'setxp', 'setlevel', 'user', 'avatar', 'server', 'roles',
  'setnick', 'ban', 'unban', 'kick', 'vkick', 'time', 'untime', 'mute', 'unmute', 'tax', 'come', 'say', 'channel', 'botstatus', 'logchannel', 'ticket', 'claimstats', 'xpmanage', 'myinfo', 'clan', 'clear', 'move', 'role',
  'points', 'warn', 'warn_remove', 'warnings', 'lock', 'unlock', 'hide', 'show', 'setcolor', 'slowmode', 'reset'
]);

// أسماء قديمة تظل تعمل كبريفكس وتحوّل إلى الأمر الموحد، دون تسجيل أوامر سلاش مكررة.
const LEGACY_PREFIX_ROUTES = Object.freeze({
  timeout: { command: 'time', subcommand: 'text' },
  untimeout: { command: 'untime', subcommand: 'text' },
  // ملاحظة توافق: !mute و !unmute كانا يوجّهان سابقاً إلى (time/untime voice) أي الكتم الصوتي.
  // صارا الآن أمرين مستقلين /mute و /unmute، وبقي السلوك الافتراضي للبريفكس صوتياً
  // (انظر defaultSubcommand في slashPrefix.js) حتى لا يتغير أي استخدام قائم.
  'كتم': { command: 'mute' },
  'فك-كتم': { command: 'unmute' },
  'كتم-كتابي': { command: 'mute', subcommand: 'text' },
  'كتم-صوتي': { command: 'mute', subcommand: 'voice' },
  'فك-كتم-كتابي': { command: 'unmute', subcommand: 'text' },
  'فك-كتم-صوتي': { command: 'unmute', subcommand: 'voice' },
  'توب': { command: 'top' },
  'توب-كلي': { command: 'top', values: { period: 'total' } },
  'توب-يومي': { command: 'top', values: { period: 'daily' } },
  'توب-اسبوعي': { command: 'top', values: { period: 'weekly' } },
  'توب-أسبوعي': { command: 'top', values: { period: 'weekly' } },
  'توب-شهري': { command: 'top', values: { period: 'monthly' } },
  تصفير: { command: 'reset', values: { period: 'total' }, requireOptions: ['member'], prefixUsage: '!تصفير @العضو' },
  'تصفير-يومي': { command: 'reset', values: { period: 'daily' }, requireOptions: ['member'], prefixUsage: '!تصفير-يومي @العضو' },
  'تصفير-اسبوعي': { command: 'reset', values: { period: 'weekly' }, requireOptions: ['member'], prefixUsage: '!تصفير-اسبوعي @العضو' },
  'تصفير-أسبوعي': { command: 'reset', values: { period: 'weekly' }, requireOptions: ['member'], prefixUsage: '!تصفير-أسبوعي @العضو' },
  'تصفير-شهري': { command: 'reset', values: { period: 'monthly' }, requireOptions: ['member'], prefixUsage: '!تصفير-شهري @العضو' },
  'تصفير-الكل': { command: 'reset', values: { period: 'total' } },
  'تصفير-الكل-يومي': { command: 'reset', values: { period: 'daily' } },
  'تصفير-الكل-اسبوعي': { command: 'reset', values: { period: 'weekly' } },
  'تصفير-الكل-أسبوعي': { command: 'reset', values: { period: 'weekly' } },
  'تصفير-الكل-شهري': { command: 'reset', values: { period: 'monthly' } },
  اكسبي: { command: 'profile' },
  رتبتي: { command: 'profile' },
  rank: { command: 'profile' },
  رتبة: { command: 'role', subcommand: 'give' },
  شرتبة: { command: 'role', subcommand: 'remove' }
});

// Prefixes owned by the older system remain reserved so a custom alias cannot shadow them.
const RESERVED_PREFIX_NAMES = new Set([
  ...SLASH_COMMAND_NAMES,
  ...Object.keys(LEGACY_PREFIX_ROUTES),
  'help', 'tax', 'come', 'say', 'close', 'claim', 'claim-panel',
  'اضافة', 'add', 'كتابة', 'write', 'ضريبة', 'tax-channel', 'اقتراحات', 'set-suggestions',
  'lock', 'unlock', 'hide', 'show', 'clear', 'مسح', 'r', 'rename', 'status', 'الحالة', 'status2', 'الحالة2',
  'رتبة', 'شرتبة', 'رول', 'كلان', 'تقديم-كلان', 'logowner', 'معلوماتي',
  'mute', 'unmute', 'كتم', 'فك-كتم', 'كتم-كتابي', 'كتم-صوتي', 'فك-كتم-كتابي', 'فك-كتم-صوتي',
  'اضافة-اكسبي', 'سحب-اكسبي', 'تصفير', 'تصفير-الكل', 'تصفير-يومي', 'تصفير-الكل-يومي',
  'تصفير-اسبوعي', 'تصفير-الكل-اسبوعي', 'تصفير-شهري', 'تصفير-الكل-شهري',
  'اضافة-اكسبي-يومي', 'سحب-اكسبي-يومي', 'اضافة-اكسبي-اسبوعي', 'سحب-اكسبي-اسبوعي',
  'اضافة-اكسبي-شهري', 'سحب-اكسبي-شهري'
]);

const DEFAULTS = Object.freeze({
  globalRoleIds: Object.freeze([]),
  commands: Object.freeze(Object.fromEntries(SLASH_COMMAND_NAMES.map(name => [name, Object.freeze({
    enabled: true,
    aliases: Object.freeze([]),
    roleIds: Object.freeze([]),
    userIds: Object.freeze([]),
    ...(name === 'role' ? { giveAliases: Object.freeze([]), removeAliases: Object.freeze([]) } : {})
  })])))
});

const cacheByPool = new WeakMap();
const CACHE_TTL_MS = 3000;

function uniqueStrings(value, pattern = /^[^,\s]{1,32}$/u) {
  const entries = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(entries.map(entry => String(entry || '').trim()).filter(entry => pattern.test(entry)))];
}

function normalizeSlashCommandConfig(value = {}, extraReserved = []) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sourceCommands = source.commands && typeof source.commands === 'object' && !Array.isArray(source.commands)
    ? source.commands
    : source;
  const commands = {};
  // ==========================================================================
  // 🔓 الأسماء المحجوزة لم تعد تمنع الاختصارات.
  //
  // كانت RESERVED_PREFIX_NAMES تمنع المالك من استعمال أي اسم أمر أو اسم عربي
  // قديم كاختصار («رول» مثلاً كان مرفوضاً). بعد حذف الأوامر العربية المثبّتة
  // صارت تلك الأسماء حرّة فعلياً، فلا سبب لحجزها.
  //
  // الممنوع الوحيد الباقي: تكرار الاختصار نفسه — سواء مرتين في الأمر ذاته أو
  // على أمرين مختلفين، لأن اختصاراً واحداً لا يمكن أن يشير إلى أمرين.
  // لا خطر من اختصار يساوي اسم أمر: التوجيه يفحص الاسم الرسمي أولاً دائماً.
  //
  // و«!x» و«$x» و«x» اختصار واحد عند التشغيل (الاختصار يعمل بأي بريفكس)،
  // فتُحجز صيغه الثلاث مجتمعةً — وإلا صار أيّ الأوامر يفوز عشوائياً.
  // ==========================================================================
  const claimedAliases = new Set();

  const claimAliasKeys = alias => {
    const key = String(alias || '').trim().toLowerCase();
    if (!key) return [];
    const bare = (key[0] === '!' || key[0] === '$') ? key.slice(1).trim() : key;
    return bare && bare !== key ? [key, bare] : [key];
  };

  for (const name of SLASH_COMMAND_NAMES) {
    const item = sourceCommands[name] && typeof sourceCommands[name] === 'object' && !Array.isArray(sourceCommands[name])
      ? sourceCommands[name]
      : {};
    const aliases = [];
    // أي حرف أو رمز مسموح (حتى 32 حرفاً) — والمكرر بين الأوامر يُرفض هنا
    // لأن اختصاراً واحداً لا يمكن أن يشير إلى أمرين.
    for (const normalized of normalizeAliases(item.aliases)) {
      const keys = claimAliasKeys(normalized);
      if (keys.some(key => claimedAliases.has(key))) continue;
      keys.forEach(key => claimedAliases.add(key));
      aliases.push(normalized);
    }
    const commandSettings = {
      enabled: item.enabled !== false,
      aliases,
      roleIds: uniqueStrings(item.roleIds, /^[0-9]{5,25}$/),
      userIds: uniqueStrings(item.userIds, /^[0-9]{5,25}$/)
    };
    if (name === 'role') {
      for (const field of ['giveAliases', 'removeAliases']) {
        commandSettings[field] = [];
        for (const alias of normalizeAliases(item[field])) {
          const normalized = alias.toLowerCase();
          const keys = claimAliasKeys(normalized);
          if (keys.some(key => claimedAliases.has(key))) continue;
          keys.forEach(key => claimedAliases.add(key));
          commandSettings[field].push(normalized);
        }
      }
    }
    commands[name] = commandSettings;
  }

  return {
    globalRoleIds: uniqueStrings(source.globalRoleIds, /^[0-9]{5,25}$/),
    commands
  };
}

function getCachedSlashCommandConfig(pool) {
  const entry = cacheByPool.get(pool);
  return entry ? normalizeSlashCommandConfig(entry.value) : normalizeSlashCommandConfig(DEFAULTS);
}

function getAdditionalReservedAliases(moderation, controls) {
  const aliases = [];
  const migratedFields = {
    moderation: {
      ban: ['banAliases', 'unbanAliases'],
      timeout: ['timeAliases', 'untimeAliases'],
      rank: ['rankAliases', 'unrankAliases']
    },
    controls: {
      clear: ['aliases'],
      channelModeration: ['lockAliases', 'unlockAliases', 'hideAliases', 'showAliases']
    }
  };
  const collect = (groups, migratedByGroup) => {
    for (const [groupName, group] of Object.entries(groups || {})) {
      const ignoredFields = new Set(migratedByGroup[groupName] || []);
      for (const [key, value] of Object.entries(group || {})) {
        if (!key.toLowerCase().includes('alias') || ignoredFields.has(key)) continue;
        // ⚠️ لا اسم رسمي واحد هنا: هذه حقول اختصارات قديمة متفرّقة تُجمع
        // كأسماء محجوزة فقط، فلا معنى لفحص «الأمر نفسه» — ولذلك null.
        aliases.push(...normalizeAliases(value, null));
      }
    }
  };
  collect(moderation, migratedFields.moderation);
  collect(controls, migratedFields.controls);
  return [...new Set(aliases.map(alias => alias.toLowerCase()))];
}

function appendLegacyAliases(value, commandName, field, aliases) {
  const valid = normalizeAliases(aliases, null);
  if (!valid.length) return;
  const current = value.commands[commandName][field] || [];
  value.commands[commandName][field] = [...new Set([...current, ...valid])];
}

function migrateSlashAliases(value, moderation, controls) {
  appendLegacyAliases(value, 'ban', 'aliases', moderation.ban?.banAliases);
  appendLegacyAliases(value, 'unban', 'aliases', moderation.ban?.unbanAliases);
  appendLegacyAliases(value, 'time', 'aliases', moderation.timeout?.timeAliases);
  appendLegacyAliases(value, 'untime', 'aliases', moderation.timeout?.untimeAliases);
  appendLegacyAliases(value, 'role', 'giveAliases', moderation.rank?.rankAliases);
  appendLegacyAliases(value, 'role', 'removeAliases', moderation.rank?.unrankAliases);
  appendLegacyAliases(value, 'clear', 'aliases', (controls.clear?.aliases || []).filter(alias => String(alias).trim().toLowerCase() !== 'مسح'));
  appendLegacyAliases(value, 'lock', 'aliases', controls.channelModeration?.lockAliases);
  appendLegacyAliases(value, 'unlock', 'aliases', controls.channelModeration?.unlockAliases);
  appendLegacyAliases(value, 'hide', 'aliases', controls.channelModeration?.hideAliases);
  appendLegacyAliases(value, 'show', 'aliases', controls.channelModeration?.showAliases);
}

/**
 * يقرأ إعدادات أوامر السلاش.
 *
 * @param {object} pool
 * @param {{fresh?: boolean}} [options]
 *   fresh: تجاوز الذاكرة المؤقتة والقراءة من قاعدة البيانات مباشرة.
 *
 * ⚠️ متى يجب أن تكون fresh صحيحة — وهذا كان مصدر عطل حقيقي:
 *
 * حفظ أي أمر يقرأ الإعدادات **كلها** ثم يعيد كتابتها كلها (الإعدادات
 * مخزّنة ككائن JSON واحد). فإذا جاءت القراءة من ذاكرة مؤقتة قديمة، كُتبت
 * الحالة القديمة فوق تعديلات أوامر أخرى حُفظت للتوّ — فتختفي بلا أي خطأ.
 * يظهر ذلك بوضوح عند حفظ عدة أوامر دفعة واحدة، وأشد منه إذا كان البوت
 * يعمل بأكثر من نسخة، إذ لكل نسخة ذاكرتها المستقلة.
 *
 * كذلك عرض صفحة اللوحة: القراءة من الذاكرة قد تُظهر قيمة لم تثبت فعلاً في
 * قاعدة البيانات، فتكذب الواجهة على المستخدم.
 *
 * الذاكرة المؤقتة تبقى للمسار الساخن وحده: البحث عن الاختصارات عند كل
 * رسالة، حيث السرعة مطلوبة وقِدَم ثلاث ثوانٍ غير ضار.
 */
async function getSlashCommandConfig(pool, options = {}) {
  const cached = options.fresh ? null : cacheByPool.get(pool);
  if (cached && cached.expiresAt > Date.now()) return normalizeSlashCommandConfig(cached.value);
  const [settingsResult, permissionResult] = await Promise.all([
    pool.query('SELECT key,value FROM bot_settings WHERE key = ANY($1::text[])', [['slash_command_config', 'command_moderation_config', 'command_control_config']]),
    pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions'])
  ]);
  // parseStoredJson: قاعدة قديمة تُرجع القيمة نصاً (عمود TEXT) — بلا تحويلها
  // إلى كائن تضيع كل الاختصارات والرولات المحفوظة وتظهر الافتراضية فقط.
  const settings = new Map(settingsResult.rows.map(row => [row.key, parseStoredJson(row.value)]));
  const saved = settings.get('slash_command_config');
  const extraReserved = getAdditionalReservedAliases(settings.get('command_moderation_config'), settings.get('command_control_config'));
  let value = normalizeSlashCommandConfig(saved || {}, extraReserved);
  const legacyModeration = settings.get('command_moderation_config') || {};
  const legacyControl = settings.get('command_control_config') || {};
  const permissions = permissionResult.rows[0] || {};
  const splitIds = input => [...new Set(String(input || '').split(',').map(id => id.trim()).filter(id => /^[0-9]{5,25}$/.test(id)))];
  value.globalRoleIds = splitIds(permissions.all_commands_role_id);

  // ترحيل إعدادات أوامر ! القديمة مرة واحدة إلى عناصرها المنفردة دون فقد الاختصارات أو الرولات.
  if (!saved) {
    const merge = (name, aliases, roleIds = [], enabled = true) => {
      value.commands[name] = {
        ...value.commands[name],
        enabled: enabled !== false,
        aliases: [...new Set([...(value.commands[name]?.aliases || []), ...(aliases || [])])],
        roleIds: [...new Set([...(value.commands[name]?.roleIds || []), ...roleIds])]
      };
    };
    const ban = legacyModeration.ban || {};
    const timeout = legacyModeration.timeout || {};
    merge('ban', [], splitIds(permissions.ban_role_id), ban.enabled);
    merge('unban', [], splitIds(permissions.ban_role_id), ban.enabled);
    merge('time', [], splitIds(permissions.timeout_role_id), timeout.enabled);
    merge('untime', [], splitIds(permissions.timeout_role_id), timeout.enabled);
    merge('clear', [], splitIds(permissions.clear_role_id), legacyControl.clear?.enabled);
    merge('lock', [], splitIds(permissions.lock_role_id), legacyControl.channelModeration?.enabled);
    merge('unlock', [], splitIds(permissions.lock_role_id), legacyControl.channelModeration?.enabled);
    merge('hide', [], splitIds(permissions.hide_role_id), legacyControl.channelModeration?.enabled);
    merge('show', [], splitIds(permissions.hide_role_id), legacyControl.channelModeration?.enabled);
    const rank = legacyModeration.rank || {};
    const legacyRankAccessIds = splitIds(permissions.rank_role_id);
    merge('role', [], legacyRankAccessIds, rank.enabled);
    // historically this field accepted both role IDs and explicit user IDs
    value.commands.role.userIds = [...new Set([...(value.commands.role.userIds || []), ...legacyRankAccessIds])];
  } else {
    // Add newly split hide/show controls when a saved config predates those commands.
    const savedCommands = saved.commands && typeof saved.commands === 'object' && !Array.isArray(saved.commands)
      ? saved.commands
      : saved;
    for (const name of ['hide', 'show']) {
      if (Object.prototype.hasOwnProperty.call(savedCommands, name)) continue;
      value.commands[name] = {
        ...value.commands[name],
        enabled: legacyControl.channelModeration?.enabled !== false,
        roleIds: [...new Set([...(value.commands[name]?.roleIds || []), ...splitIds(permissions.hide_role_id)])]
      };
    }
  }

  migrateSlashAliases(value, legacyModeration, legacyControl);
  value = normalizeSlashCommandConfig(value, extraReserved);
  cacheByPool.set(pool, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return normalizeSlashCommandConfig(value, extraReserved);
}

async function saveSlashCommandConfig(pool, value) {
  const legacyResult = await pool.query('SELECT key,value FROM bot_settings WHERE key = ANY($1::text[])', [['command_moderation_config', 'command_control_config']]);
  const legacySettings = new Map(legacyResult.rows.map(row => [row.key, parseStoredJson(row.value)]));
  const legacyModeration = legacySettings.get('command_moderation_config') || {};
  const legacyControl = legacySettings.get('command_control_config') || {};
  const extraReserved = getAdditionalReservedAliases(legacyModeration, legacyControl);
  let config = normalizeSlashCommandConfig(value, extraReserved);
  migrateSlashAliases(config, legacyModeration, legacyControl);
  config = normalizeSlashCommandConfig(config, extraReserved);
  await pool.query(
    `INSERT INTO bot_settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
    ['slash_command_config', JSON.stringify(config)]
  );

  const clearAliases = (settings, groups) => {
    for (const [groupName, fieldNames] of Object.entries(groups)) {
      if (!settings[groupName]) continue;
      for (const fieldName of fieldNames) settings[groupName][fieldName] = [];
    }
  };
  const moderation = legacySettings.get('command_moderation_config');
  if (moderation) {
    clearAliases(moderation, {
      ban: ['banAliases', 'unbanAliases'],
      timeout: ['timeAliases', 'untimeAliases'],
      rank: ['rankAliases', 'unrankAliases']
    });
    await pool.query('UPDATE bot_settings SET value = $2::jsonb WHERE key = $1', ['command_moderation_config', JSON.stringify(moderation)]);
  }
  const controls = legacySettings.get('command_control_config');
  if (controls) {
    clearAliases(controls, { clear: ['aliases'], channelModeration: ['lockAliases', 'unlockAliases', 'hideAliases', 'showAliases'] });
    await pool.query('UPDATE bot_settings SET value = $2::jsonb WHERE key = $1', ['command_control_config', JSON.stringify(controls)]);
  }

  cacheByPool.set(pool, { value: config, expiresAt: Date.now() + CACHE_TTL_MS });
  return normalizeSlashCommandConfig(config);
}

// ==========================================================================
// 🎯 نقطة التوجيه الوحيدة: من اسم مكتوب بالبريفكس إلى أمر فعلي.
//
// 📌 سياسة الأسماء (مقصودة): لكل أمر اسم واحد فقط، يُستدعى بصيغتين لا ثالث لهما:
//        /الأمر        (سلاش)
//        !الأمر        (بريفكس)
//
// لا اختصارات، ولا أسماء عربية بديلة، ولا أسماء قديمة. السبب: تعدّد الأسماء
// للأمر الواحد كان يربك الأعضاء (أي اسم الصحيح؟) ويجعل التوثيق مستحيل المواكبة،
// ويفتح باب تضارب بين اختصار يضيفه المستخدم واسم أمر قائم.
//
// LEGACY_PREFIX_ROUTES لم يُحذف من الملف عمداً: ما زال يُستخدم كقائمة أسماء
// محجوزة (RESERVED_PREFIX_NAMES) ولعرض «الأسماء السابقة» في صفحة الأوامر،
// حتى يعرف العضو أين ذهب أمره القديم بدل أن يظنه اختفى بلا أثر.
// ==========================================================================
// ==========================================================================
// 🎯 نقطة التوجيه الوحيدة: من اسم مكتوب بالبريفكس إلى أمر فعلي.
//
// 📌 سياسة الأسماء (مقصودة) — يُقبل مصدران اثنان فقط:
//        ١) الاسم الرسمي للأمر:        /ban   ·   !ban
//        ٢) اختصار يحدّده المالك من لوحة التحكم:   !بان · !لف · !برا
//
// ❌ ما لا يُقبل: الأسماء العربية المثبّتة داخل الكود (LEGACY_PREFIX_ROUTES)
//    مثل !توب و!كتم و!تصفير. هذه أُلغيت لأنها كانت مفروضة على كل السيرفرات
//    بلا تحكم، وتربك العضو (أي اسم هو الصحيح؟) وتستحيل مواكبتها بالتوثيق.
//    الفرق الجوهري: الاختصار الآن قرار صاحب السيرفر، لا شيء مفروض عليه.
//
// LEGACY_PREFIX_ROUTES لم يُحذف من الملف عمداً: ما زال يُستخدم كقائمة أسماء
// محجوزة (RESERVED_PREFIX_NAMES) تمنع العضو من اختيار اختصار يصطدم باسم قديم،
// ولعرض «الأسماء السابقة» في صفحة الأوامر حتى يعرف أين ذهب أمره القديم.
// ==========================================================================
function resolveSlashPrefixRoute(name, configValue) {
  const command = String(name || '').trim().toLowerCase();
  if (SLASH_COMMAND_NAMES.includes(command)) return { command };

  // ⛔ لا نستشير LEGACY_PREFIX_ROUTES هنا إطلاقاً — هذا هو سطر الإلغاء.
  //    إبقاؤه محذوفاً هو ما يمنع عودة الأوامر العربية المثبّتة.

  // ✅ اختصارات لوحة التحكم: يحدّدها المالك بنفسه فتعمل.
  const config = normalizeSlashCommandConfig(configValue);
  for (const [canonical, settings] of Object.entries(config.commands)) {
    if (canonical === 'role' && settings.giveAliases?.includes(command)) return { command: canonical, subcommand: 'give' };
    if (canonical === 'role' && settings.removeAliases?.includes(command)) return { command: canonical, subcommand: 'remove' };
    if (settings.aliases.includes(command)) return { command: canonical, alias: true };
  }
  return null;
}

function normalizePrefixRoute(name, configValue, pool) {
  const route = resolveSlashPrefixRoute(name, configValue);
  if (route) return route;
  return pool ? getSlashCommandConfig(pool).then(config => resolveSlashPrefixRoute(name, config)) : null;
}

module.exports = {
  SLASH_COMMAND_NAMES,
  LEGACY_PREFIX_ROUTES,
  DEFAULT_SLASH_COMMAND_CONFIG: DEFAULTS,
  normalizeSlashCommandConfig,
  getSlashCommandConfig,
  getCachedSlashCommandConfig,
  saveSlashCommandConfig,
  resolveSlashPrefixRoute,
  normalizePrefixRoute,
  RESERVED_PREFIX_NAMES
};
