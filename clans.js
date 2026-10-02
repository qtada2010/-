const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const { getCommandControlConfig, resolveCommandControlAliasPhrase, COMMAND_CONTROL_DEFAULTS } = require('./commandConfig');
const { isPrefixBlocked } = require('./prefixPolicy');
const { ADMIN_PREFIX } = require('./discordClient');

// ==========================================================================
// 🏰 نظام الكلانات / الفرق (clans.js) — ملف مستقل بالكامل
// لا يلمس أي جدول أو ملف قديم إطلاقاً: ينشئ جداوله الخاصة به هنا فقط
// (clans / clan_members / clan_applications)، ويقرأ فقط عمودين جديدين من جدول
// permissions تُضبط من صفحة "صلاحيات الأوامر" بالموقع:
//   • clan_manager_role_id : رتبة/رتب "مسؤول الكلانات" (يرون كل الكلانات)
//   • clan_cmd_role_id     : من يستخدم !كلان و !تقديم-كلان (الافتراضي: "ادمن ستريس")
//
// الأوامر:
//   !كلان          → إيمبد إنشاء كلان (اسم + إيموجي + مسؤول + نائب) ثم زر إنشاء
//   !تقديم-كلان    → رسالة فيها زر تقديم على الكلانات (اختيار الكلان ثم نموذج)
// ==========================================================================
const { registerSystemSlashHandler } = require('./systemSlashBridge');

module.exports = function createClansSystem(client, pool, helpers) {

  const PREFIX = '!';
  const DEFAULT_ROLE_NAME = 'ادمن ستريس';
  const DEFAULT_CLAN_COLOR = '#3b82f6';
  const DEFAULT_CLAN_COLOR_INT = 0x3b82f6;
  const OW_ROLE = 0;   // نوع Overwrite للرتب (حسب Discord API)
  const OW_MEMBER = 1; // نوع Overwrite للأعضاء (حسب Discord API)
  const DRAFT_TTL_MS = 30 * 60 * 1000;
  const P = PermissionFlagsBits;

  // أيموجيات تزيين رومات الكلان
  // زخرفة أسماء رومات الكلان الافتراضية — {emoji} = إيموجي الكلان، {name} = اسم الروم (مثل: الاساطير-اخبار)
  const DEFAULT_CHANNEL_STYLE = '・〢・{emoji}・{name}';
  const CHANNEL_STYLE_MAX = 60;

  // ------------------------------------------------------------------------
  // خطأ موجّه للمستخدم (رسالة جاهزة تُعرض له بدون تسجيلها كخطأ بالبوت)
  // ------------------------------------------------------------------------
  class UserError extends Error {
    constructor(userMessage, reason) {
      super(userMessage);
      this.userMessage = userMessage;
      this.reason = reason || null;
    }
  }

  // مسودات إنشاء الكلان (تخزَّن بالذاكرة فقط لأنها مؤقتة): messageId → بيانات المسودة
  const drafts = new Map();

  // ------------------------------------------------------------------------
  // 1. إنشاء الجداول الخاصة بالنظام فقط (IF NOT EXISTS)
  // ------------------------------------------------------------------------
  async function initClansTables() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS clans (
          id SERIAL PRIMARY KEY,
          guild_id VARCHAR(100) NOT NULL,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL,
          role_id VARCHAR(100),
          category_id VARCHAR(100),
          panel_channel_id VARCHAR(100),
          news_channel_id VARCHAR(100),
          chat_channel_id VARCHAR(100),
          apply_channel_id VARCHAR(100),
          panel_message_id VARCHAR(100),
          leader_id VARCHAR(100) NOT NULL,
          deputy_id VARCHAR(100),
          manager_roles TEXT DEFAULT '',
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS clans_guild_name_uq ON clans (guild_id, LOWER(name));`);
      await pool.query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS leader_role_id VARCHAR(100);`);
      await pool.query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS deputy_role_id VARCHAR(100);`);
      await pool.query(`ALTER TABLE clans ADD COLUMN IF NOT EXISTS channel_style TEXT;`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS clan_members (
          clan_id INT REFERENCES clans(id) ON DELETE CASCADE,
          guild_id VARCHAR(100) NOT NULL,
          user_id VARCHAR(100) NOT NULL,
          joined_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (guild_id, user_id)
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS clan_applications (
          id SERIAL PRIMARY KEY,
          clan_id INT REFERENCES clans(id) ON DELETE CASCADE,
          user_id VARCHAR(100) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          message_id VARCHAR(100),
          decided_by VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS clan_apps_pending_uq ON clan_applications (clan_id, user_id) WHERE status = 'pending';`);

      console.log('🏰 تم تجهيز جداول نظام الكلانات بنجاح!');
    } catch (err) {
      console.error('❌ خطأ أثناء إنشاء جداول نظام الكلانات:', err);
    }
  }
  const initPromise = initClansTables();

  // ------------------------------------------------------------------------
  // 2. أدوات مساعدة عامة
  // ------------------------------------------------------------------------
  function splitIds(str) {
    if (!str) return [];
    return String(str).split(',').map(s => s.trim()).filter(Boolean);
  }

  function esc(text) {
    return String(text).replace(/([\\*_`~|>])/g, '\\$1');
  }

  function codeBlock(text) {
    return '```' + String(text).replace(/`/g, "'") + '```';
  }

  function normalizeDigits(str) {
    return String(str || '')
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
  }

  function cleanName(input) {
    return String(input || '').replace(/\s+/g, ' ').trim();
  }

  function validateName(name) {
    if (!name || name.length < 2) return '❌ اسم الكلان يجب أن يكون حرفين على الأقل.';
    if (name.length > 32) return '❌ اسم الكلان يجب ألا يتجاوز 32 حرفاً.';
    if (!/[\p{L}\p{N}]/u.test(name)) return '❌ اسم الكلان يجب أن يحتوي على حروف أو أرقام.';
    return null;
  }

  // يقبل إيموجي يونيكود واحد فقط (الإيموجيات المخصصة للسيرفر لا تصلح لأسماء الرتب والرومات)
  function parseEmoji(input) {
    const text = String(input || '').trim();
    if (!text) return null;
    if (/<a?:\w+:\d+>/.test(text)) return null;
    let first = text;
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next();
      if (!it.done) first = it.value.segment;
      if (first !== text) return null; // أكثر من إيموجي واحد
    } else if (text.length > 16) {
      return null;
    }
    if (!/\p{Extended_Pictographic}/u.test(first)) return null;
    return first;
  }

  // الفاصل بين كلمات أسماء الرومات (بدل الشرطة -)
  const WORD_SEP = '・';

  function channelSlug(name) {
    const slug = String(name)
      .replace(/[\s_-]+/g, ' ')
      .trim()
      .split(' ')
      .map(word => word.replace(/[^\p{L}\p{N}\p{M}]/gu, ''))
      .filter(Boolean)
      .join(WORD_SEP)
      .toLowerCase()
      .slice(0, 40)
      .replace(new RegExp(`^${WORD_SEP}+|${WORD_SEP}+$`, 'g'), '');
    return slug || 'clan';
  }

  // يطبّق زخرفة الكلان على اسم الروم: يضمن وجود إيموجي الكلان بكل الرومات، ويضيف {name} إن نسيه صاحب الزخرفة
  function renderChannelName(clan, baseName) {
    let template = clan.channel_style || DEFAULT_CHANNEL_STYLE;
    if (!template.includes('{name}')) template += '{name}';
    // يُضاف إيموجي الكلان بالبداية فقط إذا لم يكن موجوداً بالزخرفة (لا كمتغير {emoji} ولا مكتوباً حرفياً) حتى لا يتكرر
    if (!template.includes('{emoji}') && !template.includes(clan.emoji)) template = '{emoji}' + template;
    return template
      .split('{emoji}').join(clan.emoji)
      .split('{name}').join(baseName)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, WORD_SEP)
      .slice(0, 100);
  }

  function channelNames(clan) {
    const slug = channelSlug(clan.name);
    return {
      panel: renderChannelName(clan, ['لوحة', 'التحكم', slug].join(WORD_SEP)),
      news: renderChannelName(clan, [slug, 'اخبار'].join(WORD_SEP)),
      chat: renderChannelName(clan, [slug, 'شات'].join(WORD_SEP)),
      apply: renderChannelName(clan, ['تقديم', 'كلان', slug].join(WORD_SEP))
    };
  }

  // يتأكد أن الزخرفة صالحة قبل حفظها (طول الاسم النهائي + أن الاسم لا يصبح فارغاً)
  function validateChannelStyle(clan, style) {
    if (style.length > CHANNEL_STYLE_MAX) return `❌ الزخرفة يجب ألا تتجاوز ${CHANNEL_STYLE_MAX} حرفاً.`;
    if (/[@#:`\\]/.test(style)) return '❌ الزخرفة لا يجب أن تحتوي على الرموز `@` `#` `:` `\\` أو علامة الاقتباس المائلة.';
    const names = channelNames({ ...clan, channel_style: style });
    for (const name of Object.values(names)) {
      if (name.length > 100) return '❌ الزخرفة طويلة جداً — اسم الروم الناتج يتجاوز حد ديسكورد (100 حرف). اختصرها أو اختصر اسم الكلان.';
    }
    return null;
  }

  function roleAndCategoryName(clan) {
    return `${clan.emoji} ${clan.name}`.slice(0, 100);
  }

  function leaderRoleName(clan) {
    return `مسؤول ${clan.name}`.slice(0, 100);
  }

  function deputyRoleName(clan) {
    return `نائب مسؤول ${clan.name}`.slice(0, 100);
  }

  // 🟢 [إصلاح: تغيير الاسم قد يفشل جزئياً بصمت] يعيد حالة كل عملية (نجحت/فشلت) مع تسميتها،
  // بدل تجاهل الفشل كلياً — حتى تعرف applyClanNaming أي جزء لم يُطبَّق فعلياً (غالباً بسبب حد
  // ديسكورد لتكرار تغيير اسم نفس القناة/الرتبة أكثر من مرتين كل 10 دقائق)
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise.then(() => ({ ok: true, label })).catch(err => {
        console.error('❌ خطأ (كلانات):', err && err.message ? err.message : err);
        return { ok: false, label, reason: 'error', code: err && err.code };
      }),
      new Promise(resolve => setTimeout(() => resolve({ ok: false, label, reason: 'timeout' }), ms))
    ]);
  }

  // ------------------------------------------------------------------------
  // ⏱️ حد ديسكورد لتغيير أسماء الرومات: مرتان فقط كل 10 دقائق لكل روم.
  // بدل تكديس طلبات عالقة بذاكرة البوت (تتنفذ ببطء وبترتيب قديم)، نتتبع الحد بأنفسنا ونؤجل الطلب
  // ونعيد التطبيق تلقائياً بأحدث بيانات الكلان بمجرد انتهاء الحد.
  // ------------------------------------------------------------------------
  const RENAME_LIMIT = 2;
  const RENAME_WINDOW_MS = 10 * 60 * 1000;
  const MAX_NAMING_RETRIES = 6;
  const renameLog = new Map();      // channelId → أوقات آخر عمليات تغيير الاسم
  const appliedTarget = new Map();  // channelId → { target, actual } آخر اسم طُبّق بنجاح (ديسكورد قد يعدّل الاسم قليلاً)
  const retryTimers = new Map();    // clanId → مؤقت إعادة التطبيق التلقائي
  const retryAttempts = new Map();  // clanId → عدد المحاولات التلقائية

  function renameWait(channelId) {
    const now = Date.now();
    const recent = (renameLog.get(channelId) || []).filter(t => now - t < RENAME_WINDOW_MS);
    renameLog.set(channelId, recent);
    return recent.length >= RENAME_LIMIT ? recent[0] + RENAME_WINDOW_MS - now : 0;
  }

  function noteRename(channelId) {
    const list = renameLog.get(channelId) || [];
    list.push(Date.now());
    renameLog.set(channelId, list);
  }

  function scheduleNamingRetry(guild, clanId, delayMs) {
    if (retryTimers.has(clanId)) return;
    const attempts = (retryAttempts.get(clanId) || 0) + 1;
    if (attempts > MAX_NAMING_RETRIES) { retryAttempts.delete(clanId); return; }
    retryAttempts.set(clanId, attempts);

    const timer = setTimeout(async () => {
      retryTimers.delete(clanId);
      try {
        const fresh = await getClanById(clanId);
        if (fresh) await applyClanNaming(guild, fresh, true);
      } catch (err) {
        console.error('❌ خطأ أثناء إعادة تطبيق أسماء الكلان تلقائياً:', err);
      }
    }, Math.max(delayMs, 1000));
    if (timer.unref) timer.unref();
    retryTimers.set(clanId, timer);
  }

  function namingWarning(failed) {
    if (!failed.length) return '';
    return failed.willRetry
      ? `\n⚠️ لم يكتمل تحديث: ${failed.join('، ')}\nالسبب: حد ديسكورد (تغيير اسم الروم مسموح مرتين فقط كل 10 دقائق). سيُطبَّق تلقائياً بمجرد انتهاء الحد — لا داعي لتكرار الأمر.`
      : `\n⚠️ تعذّر تحديث: ${failed.join('، ')} — تأكد أن البوت يملك صلاحية **إدارة القنوات** ثم حاول مرة أخرى.`;
  }

  // ------------------------------------------------------------------------
  // 3. الصلاحيات
  // ------------------------------------------------------------------------
  async function getPerms() {
    try {
      const res = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions']);
      return res.rows[0] || {};
    } catch (err) {
      return {};
    }
  }

  function hasAnyOfRoles(member, rolesString) {
    return splitIds(rolesString).some(id => member.roles.cache.has(id));
  }

  function hasAnyOfRolesOrUser(member, idsString) {
    return splitIds(idsString).some(id => member.roles.cache.has(id) || member.id === id);
  }

  // من يستخدم !كلان و !تقديم-كلان: رتبة الإدارة العامة / الرتبة المحددة بالموقع / الأدمن،
  // وإذا تُرك الحقل فارغاً بالموقع تُستخدم رتبة "ادمن ستريس" تلقائياً
  async function canUseClanCommands(member) {
    if (member.permissions.has(P.Administrator)) return true;
    const perms = await getPerms();
    if (hasAnyOfRoles(member, perms.all_commands_role_id)) return true;
    if (hasAnyOfRolesOrUser(member, perms.clan_cmd_role_id)) return true;
    if (!perms.clan_cmd_role_id) {
      const defaultRole = member.guild.roles.cache.find(r => r.name === DEFAULT_ROLE_NAME);
      if (defaultRole && member.roles.cache.has(defaultRole.id)) return true;
    }
    return false;
  }

  function getManagerRoleIds(guild, perms) {
    return splitIds(perms.clan_manager_role_id).filter(id => id !== guild.id && guild.roles.cache.has(id));
  }

  // ------------------------------------------------------------------------
  // 4. دوال قاعدة البيانات
  // ------------------------------------------------------------------------
  async function getClanById(id) {
    const res = await pool.query('SELECT * FROM clans WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async function getClanByPanelChannel(channelId) {
    const res = await pool.query('SELECT * FROM clans WHERE panel_channel_id = $1', [channelId]);
    return res.rows[0] || null;
  }

  async function getClanOfUser(guildId, userId) {
    const res = await pool.query(
      `SELECT c.* FROM clan_members m JOIN clans c ON c.id = m.clan_id WHERE m.guild_id = $1 AND m.user_id = $2`,
      [guildId, userId]
    );
    return res.rows[0] || null;
  }

  async function isMemberOfClan(clanId, userId) {
    const res = await pool.query('SELECT 1 FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clanId, userId]);
    return res.rowCount > 0;
  }

  // ------------------------------------------------------------------------
  // 5. صلاحيات الرومات (Overwrites)
  // ------------------------------------------------------------------------
  const VIEW_ONLY = { ViewChannel: true, ReadMessageHistory: true };
  const READ_ONLY = { ViewChannel: true, ReadMessageHistory: true, SendMessages: false };
  const FULL_CHAT = { ViewChannel: true, ReadMessageHistory: true, SendMessages: true, EmbedLinks: true, AttachFiles: true, AddReactions: true };
  const NEWS_POSTER = { ViewChannel: true, ReadMessageHistory: true, SendMessages: true, EmbedLinks: true, AttachFiles: true };
  const BOT_ACCESS = { ViewChannel: true, ReadMessageHistory: true, SendMessages: true, EmbedLinks: true, AttachFiles: true };

  function rolePermsFor(kind) {
    switch (kind) {
      case 'panel': return { clan: READ_ONLY, manager: VIEW_ONLY };
      case 'news': return { clan: READ_ONLY, manager: FULL_CHAT };
      case 'chat': return { clan: FULL_CHAT, manager: FULL_CHAT };
      case 'apply': return { clan: READ_ONLY, manager: VIEW_ONLY };
      default: return { clan: VIEW_ONLY, manager: VIEW_ONLY };
    }
  }

  // يحذف الصلاحيات التي لا يملكها البوت نفسه (ديسكورد يمنع تعيين صلاحية لا يملكها المُعيِّن)
  function botFilter(guild, permsObj) {
    const me = guild.members.me;
    const out = {};
    for (const [key, value] of Object.entries(permsObj)) {
      if (!me || me.permissions.has(key)) out[key] = value;
    }
    return out;
  }

  function toOverwrite(guild, id, type, permsObj) {
    const filtered = botFilter(guild, permsObj);
    const allow = [];
    const deny = [];
    for (const [key, value] of Object.entries(filtered)) (value ? allow : deny).push(key);
    return { id, type, allow, deny };
  }

  function buildOverwrites(guild, ctx, kind) {
    const rp = rolePermsFor(kind);
    const list = [
      toOverwrite(guild, guild.roles.everyone.id, OW_ROLE, { ViewChannel: false }),
      toOverwrite(guild, client.user.id, OW_MEMBER, BOT_ACCESS),
      toOverwrite(guild, ctx.roleId, OW_ROLE, rp.clan)
    ];
    for (const managerId of ctx.managerIds) {
      list.push(toOverwrite(guild, managerId, OW_ROLE, rp.manager));
    }
    // روم الأخبار: الكتابة فقط لرتبتي (مسؤول الكلان / نائب المسؤول) — وبقية أعضاء الكلان قراءة فقط
    if (kind === 'news') {
      for (const officerRoleId of [ctx.leaderRoleId, ctx.deputyRoleId]) {
        if (officerRoleId) list.push(toOverwrite(guild, officerRoleId, OW_ROLE, NEWS_POSTER));
      }
    }
    return list;
  }

  async function getClanChannels(guild, clan) {
    const fetchCh = (id) => (id ? guild.channels.fetch(id).catch(() => null) : Promise.resolve(null));
    const [category, panel, news, chat, apply] = await Promise.all([
      fetchCh(clan.category_id), fetchCh(clan.panel_channel_id), fetchCh(clan.news_channel_id),
      fetchCh(clan.chat_channel_id), fetchCh(clan.apply_channel_id)
    ]);
    return { category, panel, news, chat, apply };
  }

  // إعطاء/سحب رتبة (مسؤول الكلان / نائب المسؤول) من عضو
  async function grantRole(guild, roleId, userId) {
    if (!roleId || !userId) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.add(roleId, 'رتبة مسؤولي الكلان').catch(err => console.error('❌ تعذر إعطاء رتبة مسؤولي الكلان:', err.message || err));
  }

  async function revokeRole(guild, roleId, userId) {
    if (!roleId || !userId) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await member.roles.remove(roleId, 'رتبة مسؤولي الكلان').catch(err => console.error('❌ تعذر سحب رتبة مسؤولي الكلان:', err.message || err));
  }

  // يضمن وجود رتبتي (مسؤول / نائب مسؤول) للكلان — يُنشئها إن كانت ناقصة (كلانات قديمة أو رتبة حُذفت يدوياً)
  // ويعطيها لأصحابها ويضبط صلاحية الكتابة في روم الأخبار
  async function ensureOfficerRoles(guild, clan) {
    const fetchRole = (id) => (id ? guild.roles.fetch(id).catch(() => null) : Promise.resolve(null));
    let leaderRole = await fetchRole(clan.leader_role_id);
    let deputyRole = await fetchRole(clan.deputy_role_id);
    if (leaderRole && deputyRole) return;

    const news = clan.news_channel_id ? await guild.channels.fetch(clan.news_channel_id).catch(() => null) : null;
    const reason = 'إصلاح رتب مسؤولي الكلان';

    if (!leaderRole) {
      leaderRole = await guild.roles.create({ name: leaderRoleName(clan), permissions: [], mentionable: false, hoist: false, reason });
      await pool.query('UPDATE clans SET leader_role_id = $1 WHERE id = $2', [leaderRole.id, clan.id]);
      if (news) await news.permissionOverwrites.edit(leaderRole.id, botFilter(guild, NEWS_POSTER), { type: OW_ROLE }).catch(() => {});
      await grantRole(guild, leaderRole.id, clan.leader_id);
    }
    if (!deputyRole) {
      deputyRole = await guild.roles.create({ name: deputyRoleName(clan), permissions: [], mentionable: false, hoist: false, reason });
      await pool.query('UPDATE clans SET deputy_role_id = $1 WHERE id = $2', [deputyRole.id, clan.id]);
      if (news) await news.permissionOverwrites.edit(deputyRole.id, botFilter(guild, NEWS_POSTER), { type: OW_ROLE }).catch(() => {});
      await grantRole(guild, deputyRole.id, clan.deputy_id);
    }
  }

  // ------------------------------------------------------------------------
  // 6. مزامنة رتبة "مسؤول الكلانات" (المضبوطة بالموقع) مع كل الكلانات الموجودة
  // ------------------------------------------------------------------------
  async function syncManagerAccess() {
    try {
      await initPromise;
      if (!client.isReady()) return;
      const perms = await getPerms();
      for (const guild of client.guilds.cache.values()) {
        const desired = getManagerRoleIds(guild, perms);
        const res = await pool.query('SELECT * FROM clans WHERE guild_id = $1', [guild.id]);
        for (const clan of res.rows) {
          await ensureOfficerRoles(guild, clan).catch(err => console.error('❌ خطأ أثناء إصلاح رتب مسؤولي الكلان:', err.message || err));

          const applied = splitIds(clan.manager_roles);
          const toAdd = desired.filter(id => !applied.includes(id));
          const toRemove = applied.filter(id => !desired.includes(id));
          if (!toAdd.length && !toRemove.length) continue;

          const chans = await getClanChannels(guild, clan);
          for (const [kind, ch] of Object.entries(chans)) {
            if (!ch) continue;
            for (const id of toRemove) await ch.permissionOverwrites.delete(id).catch(() => {});
            for (const id of toAdd) {
              await ch.permissionOverwrites.edit(id, botFilter(guild, rolePermsFor(kind).manager), { type: OW_ROLE }).catch(() => {});
            }
          }
          await pool.query('UPDATE clans SET manager_roles = $1 WHERE id = $2', [desired.join(','), clan.id]);
        }
      }
    } catch (err) {
      console.error('❌ خطأ أثناء مزامنة صلاحيات مسؤولي الكلانات:', err);
    }
  }

  // تحديث رسائل لوحات التحكم للكلانات الموجودة عند تشغيل البوت، حتى تظهر فيها الأزرار الجديدة (مثل زخرفة الرومات)
  async function refreshAllPanels() {
    try {
      await initPromise;
      for (const guild of client.guilds.cache.values()) {
        const res = await pool.query('SELECT id FROM clans WHERE guild_id = $1', [guild.id]);
        for (const row of res.rows) await refreshPanel(guild, row.id);
      }
    } catch (err) {
      console.error('❌ خطأ أثناء تحديث لوحات تحكم الكلانات:', err);
    }
  }

  client.once('ready', () => {
    syncManagerAccess();
    refreshAllPanels();
    setInterval(syncManagerAccess, 5 * 60 * 1000);
  });

  // ------------------------------------------------------------------------
  // 7. لوحة التحكم داخل روم الكلان (Embed + أزرار)
  // ------------------------------------------------------------------------
  function panelRows() {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('clan_ctl_add').setLabel('إضافة عضو').setEmoji('➕').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('clan_ctl_kick').setLabel('طرد عضو').setEmoji('➖').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('clan_ctl_deputy').setLabel('تحديد نائب').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('clan_ctl_undeputy').setLabel('إزالة النائب').setEmoji('🚫').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('clan_ctl_rename').setLabel('تغيير الاسم').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('clan_ctl_color').setLabel('تغيير لون الرتبة').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('clan_ctl_emoji').setLabel('تغيير الإيموجي').setEmoji('😀').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('clan_ctl_style').setLabel('زخرفة الرومات').setEmoji('✨').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('clan_ctl_delete').setLabel('حذف الكلان').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      )
    ];
  }

  async function buildPanelEmbed(guild, clan) {
    const role = clan.role_id ? await guild.roles.fetch(clan.role_id).catch(() => null) : null;
    const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM clan_members WHERE clan_id = $1', [clan.id]);
    const count = countRes.rows[0].n;

    return new EmbedBuilder()
      .setTitle(`${clan.emoji} لوحة تحكم كلان ${clan.name}`)
      .setDescription('من هنا يستطيع **المسؤول** و**النائب** فقط إدارة الكلان عبر الأزرار بالأسفل، وكل تعديل يُطبَّق تلقائياً على الرتبة والرومات.')
      .addFields(
        { name: '👑 المسؤول', value: `<@${clan.leader_id}>`, inline: true },
        { name: '🛡️ النائب', value: clan.deputy_id ? `<@${clan.deputy_id}>` : '`لا يوجد`', inline: true },
        { name: '👥 عدد الأعضاء', value: `**${count}**`, inline: true },
        { name: '🎭 رتبة الكلان', value: role ? `${role}` : '`غير موجودة`', inline: true },
        { name: '🎨 لون الرتبة', value: role ? `\`${role.hexColor}\`` : '`-`', inline: true },
        { name: '✨ زخرفة الرومات', value: `\`${clan.channel_style || DEFAULT_CHANNEL_STYLE}\``, inline: true }
      )
      .setColor(role && role.color ? role.color : DEFAULT_CLAN_COLOR_INT)
      .setTimestamp();
  }

  // يعيد رسم رسالة لوحة التحكم (أو يرسلها من جديد إن حُذفت) بعد أي تعديل
  async function refreshPanel(guild, clanId) {
    try {
      const clan = await getClanById(clanId);
      if (!clan || !clan.panel_channel_id) return;
      const channel = await guild.channels.fetch(clan.panel_channel_id).catch(() => null);
      if (!channel) return;

      const embed = await buildPanelEmbed(guild, clan);
      let msg = null;
      if (clan.panel_message_id) msg = await channel.messages.fetch(clan.panel_message_id).catch(() => null);

      if (msg) {
        await msg.edit({ embeds: [embed], components: panelRows() });
      } else {
        const sent = await channel.send({ embeds: [embed], components: panelRows() });
        await pool.query('UPDATE clans SET panel_message_id = $1 WHERE id = $2', [sent.id, clan.id]);
      }
    } catch (err) {
      console.error('❌ خطأ أثناء تحديث لوحة تحكم الكلان:', err);
    }
  }

  // ------------------------------------------------------------------------
  // 8. عمليات الكلان الأساسية
  // ------------------------------------------------------------------------
  async function createClan(guild, data) {
    const name = cleanName(data.name);
    const emoji = data.emoji;

    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me || !me.permissions.has(P.ManageRoles) || !me.permissions.has(P.ManageChannels)) {
      throw new UserError('❌ البوت يحتاج صلاحيتي **إدارة الرتب** و**إدارة القنوات** لإنشاء الكلان.');
    }

    const nameError = validateName(name);
    if (nameError) throw new UserError(nameError);
    if (!emoji) throw new UserError('❌ يجب تحديد إيموجي الكلان.');
    if (!data.leaderId) throw new UserError('❌ يجب تحديد مسؤول الكلان.');
    if (data.deputyId && data.deputyId === data.leaderId) throw new UserError('❌ لا يمكن أن يكون المسؤول والنائب نفس الشخص.');

    const dup = await pool.query('SELECT 1 FROM clans WHERE guild_id = $1 AND LOWER(name) = LOWER($2)', [guild.id, name]);
    if (dup.rowCount) throw new UserError('❌ يوجد كلان بنفس هذا الاسم بالفعل.');

    const leader = await guild.members.fetch(data.leaderId).catch(() => null);
    if (!leader || leader.user.bot) throw new UserError('❌ المسؤول المختار غير صالح (يجب أن يكون عضواً حقيقياً بالسيرفر).');
    const leaderClan = await getClanOfUser(guild.id, leader.id);
    if (leaderClan) throw new UserError(`❌ المسؤول ${leader} ينتمي بالفعل إلى كلان (**${esc(leaderClan.name)}**).`);

    let deputy = null;
    if (data.deputyId) {
      deputy = await guild.members.fetch(data.deputyId).catch(() => null);
      if (!deputy || deputy.user.bot) throw new UserError('❌ النائب المختار غير صالح (يجب أن يكون عضواً حقيقياً بالسيرفر).');
      const deputyClan = await getClanOfUser(guild.id, deputy.id);
      if (deputyClan) throw new UserError(`❌ النائب ${deputy} ينتمي بالفعل إلى كلان (**${esc(deputyClan.name)}**).`);
    }

    const perms = await getPerms();
    const managerIds = getManagerRoleIds(guild, perms);
    const draftClan = { name, emoji };
    const names = channelNames(draftClan);
    const reason = 'إنشاء كلان جديد';

    const created = { role: null, leaderRole: null, deputyRole: null, category: null, channels: [], clanRow: null };
    const cleanup = async () => {
      if (created.clanRow) await pool.query('DELETE FROM clans WHERE id = $1', [created.clanRow.id]).catch(() => {});
      for (const ch of [...created.channels].reverse()) await ch.delete('فشل إنشاء الكلان').catch(() => {});
      if (created.category) await created.category.delete('فشل إنشاء الكلان').catch(() => {});
      if (created.role) await created.role.delete('فشل إنشاء الكلان').catch(() => {});
      if (created.leaderRole) await created.leaderRole.delete('فشل إنشاء الكلان').catch(() => {});
      if (created.deputyRole) await created.deputyRole.delete('فشل إنشاء الكلان').catch(() => {});
    };

    try {
      created.role = await guild.roles.create({
        name: roleAndCategoryName(draftClan),
        color: DEFAULT_CLAN_COLOR,
        permissions: [],
        mentionable: false,
        hoist: false,
        reason
      });

      created.leaderRole = await guild.roles.create({ name: leaderRoleName(draftClan), permissions: [], mentionable: false, hoist: false, reason });
      created.deputyRole = await guild.roles.create({ name: deputyRoleName(draftClan), permissions: [], mentionable: false, hoist: false, reason });

      const ctx = {
        roleId: created.role.id, managerIds,
        leaderRoleId: created.leaderRole.id, deputyRoleId: created.deputyRole.id
      };

      created.category = await guild.channels.create({
        name: roleAndCategoryName(draftClan),
        type: ChannelType.GuildCategory,
        permissionOverwrites: buildOverwrites(guild, ctx, 'category'),
        reason
      });

      const makeChannel = async (kind) => {
        const ch = await guild.channels.create({
          name: names[kind],
          type: ChannelType.GuildText,
          parent: created.category.id,
          permissionOverwrites: buildOverwrites(guild, ctx, kind),
          reason
        });
        created.channels.push(ch);
        return ch;
      };

      const panelCh = await makeChannel('panel');
      const newsCh = await makeChannel('news');
      const chatCh = await makeChannel('chat');
      const applyCh = await makeChannel('apply');

      // حفظ الكلان وأعضائه الأوائل بعملية واحدة (Transaction)
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        const ins = await conn.query(
          `INSERT INTO clans (
            guild_id, name, emoji, role_id, category_id, panel_channel_id, news_channel_id,
            chat_channel_id, apply_channel_id, leader_id, deputy_id, manager_roles,
            leader_role_id, deputy_role_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            guild.id, name, emoji, created.role.id, created.category.id, panelCh.id, newsCh.id,
            chatCh.id, applyCh.id, leader.id, deputy ? deputy.id : null, managerIds.join(','),
            created.leaderRole.id, created.deputyRole.id
          ]
        );
        created.clanRow = ins.rows[0];
        await conn.query('INSERT INTO clan_members (clan_id, guild_id, user_id) VALUES ($1,$2,$3)', [created.clanRow.id, guild.id, leader.id]);
        if (deputy) {
          await conn.query('INSERT INTO clan_members (clan_id, guild_id, user_id) VALUES ($1,$2,$3)', [created.clanRow.id, guild.id, deputy.id]);
        }
        await conn.query('COMMIT');
      } catch (dbErr) {
        await conn.query('ROLLBACK').catch(() => {});
        created.clanRow = null;
        if (dbErr && dbErr.code === '23505') {
          throw new UserError('❌ تعذر الإنشاء: الاسم مستخدم أو أحد الأعضاء المختارين انضم لكلان آخر للتو.');
        }
        throw dbErr;
      } finally {
        conn.release();
      }

      await leader.roles.add(created.role, reason);
      await leader.roles.add(created.leaderRole, reason);
      if (deputy) {
        await deputy.roles.add(created.role, reason);
        await deputy.roles.add(created.deputyRole, reason);
      }

      const embed = await buildPanelEmbed(guild, created.clanRow);
      const sent = await panelCh.send({ embeds: [embed], components: panelRows() });
      await pool.query('UPDATE clans SET panel_message_id = $1 WHERE id = $2', [sent.id, created.clanRow.id]);
      created.clanRow.panel_message_id = sent.id;

      return created.clanRow;
    } catch (err) {
      await cleanup();
      throw err;
    }
  }

  // إضافة عضو للكلان (تُستخدم من الزر، ومن تحديد النائب، ومن قبول التقديم)
  async function addMemberToClan(guild, clan, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw new UserError('❌ هذا العضو غير موجود في السيرفر.', 'left');
    if (member.user.bot) throw new UserError('❌ لا يمكن إضافة بوت إلى كلان.', 'bot');

    const existing = await getClanOfUser(guild.id, userId);
    if (existing) {
      throw new UserError(
        existing.id === clan.id
          ? '⚠️ هذا العضو موجود بالفعل في الكلان.'
          : `❌ هذا العضو ينتمي بالفعل إلى كلان آخر (**${esc(existing.name)}**) — العضو يستطيع دخول كلان واحد فقط.`,
        'in_clan'
      );
    }

    const role = clan.role_id ? await guild.roles.fetch(clan.role_id).catch(() => null) : null;
    if (!role) throw new UserError('❌ رتبة الكلان غير موجودة (ربما حُذفت يدوياً).', 'role_missing');

    try {
      await pool.query('INSERT INTO clan_members (clan_id, guild_id, user_id) VALUES ($1,$2,$3)', [clan.id, guild.id, userId]);
    } catch (err) {
      if (err && err.code === '23505') throw new UserError('❌ هذا العضو ينتمي بالفعل إلى كلان.', 'in_clan');
      throw err;
    }

    try {
      await member.roles.add(role, 'انضمام لكلان');
    } catch (err) {
      await pool.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clan.id, userId]).catch(() => {});
      throw err;
    }

    await refreshPanel(guild, clan.id);
    return member;
  }

  async function removeMemberFromClan(guild, clan, userId) {
    await pool.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clan.id, userId]);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && clan.role_id) {
      await member.roles.remove(clan.role_id, 'طرد من كلان').catch(err => console.error('❌ تعذر سحب رتبة الكلان:', err.message || err));
    }
  }

  // تطبيق الاسم/الإيموجي/الزخرفة الحالية على الرتبة والكاتيجوري (والرومات عند تغيير الاسم أو الزخرفة)
  // يرجع قائمة بالأجزاء التي لم تُطبَّق فعلياً (فارغة = تم كل شيء)، وخاصية willRetry إن جُدولت إعادة تلقائية
  async function applyClanNaming(guild, clan, renameChannels) {
    const targetName = roleAndCategoryName(clan);
    const ops = [];
    const blocked = [];
    const reason = 'تعديل كلان';

    const renameChannel = (ch, name, label) => {
      if (!ch || ch.name === name) return;
      const done = appliedTarget.get(ch.id);
      if (done && done.target === name && done.actual === ch.name) return;
      const wait = renameWait(ch.id);
      if (wait > 0) { blocked.push({ label, wait }); return; }
      noteRename(ch.id);
      ops.push(withTimeout(
        ch.setName(name, reason).then(updated => { appliedTarget.set(ch.id, { target: name, actual: updated && updated.name }); }),
        15000, label
      ));
    };

    const role = clan.role_id ? await guild.roles.fetch(clan.role_id).catch(() => null) : null;
    if (role && role.name !== targetName) ops.push(withTimeout(role.setName(targetName, reason), 15000, 'رتبة الكلان'));

    const chans = await getClanChannels(guild, clan);
    renameChannel(chans.category, targetName, 'الكاتيجوري');

    if (renameChannels) {
      const officerNames = [
        [clan.leader_role_id, leaderRoleName(clan), 'رتبة المسؤول'],
        [clan.deputy_role_id, deputyRoleName(clan), 'رتبة النائب']
      ];
      for (const [officerRoleId, officerName, label] of officerNames) {
        const officerRole = officerRoleId ? await guild.roles.fetch(officerRoleId).catch(() => null) : null;
        if (officerRole && officerRole.name !== officerName) ops.push(withTimeout(officerRole.setName(officerName, reason), 15000, label));
      }

      const names = channelNames(clan);
      const channelLabels = { panel: 'روم لوحة التحكم', news: 'روم الأخبار', chat: 'روم الشات', apply: 'روم التقديم' };
      for (const kind of ['panel', 'news', 'chat', 'apply']) renameChannel(chans[kind], names[kind], channelLabels[kind]);
    }

    const results = await Promise.all(ops);
    const failed = [];
    let retryAfter = 0;
    for (const r of results) {
      if (r.ok) continue;
      if (r.reason === 'timeout') {
        failed.push(`${r.label} (متأخر بسبب حد ديسكورد)`);
        retryAfter = Math.max(retryAfter, RENAME_WINDOW_MS);
      } else {
        failed.push(`${r.label}${r.code ? ` [خطأ ${r.code}]` : ''}`);
      }
    }
    for (const b of blocked) {
      failed.push(`${b.label} (متاح بعد ${Math.ceil(b.wait / 60000)} دقيقة)`);
      retryAfter = Math.max(retryAfter, b.wait);
    }

    failed.willRetry = retryAfter > 0;
    if (failed.willRetry) scheduleNamingRetry(guild, clan.id, retryAfter + 3000);
    else if (!failed.length) retryAttempts.delete(clan.id);
    return failed;
  }

  async function deleteClan(guild, clan) {
    // الحذف من قاعدة البيانات أولاً (يحذف الأعضاء والتقديمات تلقائياً) ثم عناصر ديسكورد
    await pool.query('DELETE FROM clans WHERE id = $1', [clan.id]);

    const chans = await getClanChannels(guild, clan);
    for (const kind of ['apply', 'news', 'chat', 'panel']) {
      if (chans[kind]) await chans[kind].delete('حذف كلان').catch(() => {});
    }
    if (chans.category) await chans.category.delete('حذف كلان').catch(() => {});
    for (const rid of [clan.role_id, clan.leader_role_id, clan.deputy_role_id]) {
      if (!rid) continue;
      const role = await guild.roles.fetch(rid).catch(() => null);
      if (role) await role.delete('حذف كلان').catch(() => {});
    }
  }

  // ------------------------------------------------------------------------
  // 9. الردود ومعالجة الأخطاء
  // ------------------------------------------------------------------------
  async function respond(interaction, content) {
    try {
      if (interaction.replied) return await interaction.followUp({ content, ephemeral: true });
      if (interaction.deferred) return await interaction.editReply({ content, embeds: [], components: [] });
      return await interaction.reply({ content, ephemeral: true });
    } catch (err) {
      console.error('❌ خطأ أثناء الرد (كلانات):', err.message || err);
    }
  }

  async function handleError(interaction, err, context) {
    if (err instanceof UserError) return respond(interaction, err.userMessage);
    if (err && err.code === 50013) {
      return respond(interaction, '❌ البوت لا يملك صلاحيات كافية — تأكد من صلاحيتي إدارة الرتب والقنوات، وأن رتبة البوت أعلى من رتب الكلانات.');
    }
    if (err && err.code === 30005) return respond(interaction, '❌ وصل السيرفر للحد الأقصى من الرتب.');
    if (err && err.code === 30013) return respond(interaction, '❌ وصل السيرفر للحد الأقصى من القنوات.');
    if (helpers && helpers.sendLogError) await helpers.sendLogError(`خطأ في نظام الكلانات (${context}):`, err);
    else console.error('❌ خطأ في نظام الكلانات:', err);
    return respond(interaction, '❌ حدث خطأ غير متوقع، حاول مرة أخرى.');
  }

  // ------------------------------------------------------------------------
  // 10. أمر !كلان — مسودة الإنشاء
  // ------------------------------------------------------------------------
  function draftView(draft) {
    const embed = new EmbedBuilder()
      .setTitle('🏰 إنشاء كلان جديد')
      .setDescription('حدّد بيانات الكلان من الأزرار والقوائم بالأسفل، ثم اضغط **إنشاء الكلان**.\nسيقوم البوت بإنشاء رتبة الكلان وكاتيجوري مخفية فيها رومات الكلان تلقائياً.')
      .addFields(
        { name: '🏷️ اسم الكلان', value: draft.name ? `**${esc(draft.name)}**` : '`لم يُحدد بعد`', inline: true },
        { name: '😀 إيموجي الكلان', value: draft.emoji ? draft.emoji : '`لم يُحدد بعد`', inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '👑 المسؤول', value: draft.leaderId ? `<@${draft.leaderId}>` : '`لم يُحدد بعد`', inline: true },
        { name: '🛡️ النائب (اختياري)', value: draft.deputyId ? `<@${draft.deputyId}>` : '`لم يُحدد بعد`', inline: true }
      )
      .setColor(DEFAULT_CLAN_COLOR_INT)
      .setFooter({ text: 'المسؤول والاسم والإيموجي إلزامية — النائب اختياري ويمكن تحديده لاحقاً من لوحة الكلان' });

    const components = [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId('clan_draft_leader').setPlaceholder('👑 اختر مسؤول الكلان').setMinValues(1).setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId('clan_draft_deputy').setPlaceholder('🛡️ اختر نائب الكلان (اختياري)').setMinValues(1).setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('clan_draft_info').setLabel('اسم الكلان والإيموجي').setEmoji('📝').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('clan_draft_create').setLabel('إنشاء الكلان').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('clan_draft_cancel').setLabel('إلغاء').setEmoji('❌').setStyle(ButtonStyle.Danger)
      )
    ];
    return { embeds: [embed], components };
  }

  async function getDraft(interaction) {
    const draft = interaction.message ? drafts.get(interaction.message.id) : null;
    if (!draft) {
      await respond(interaction, '⌛ انتهت صلاحية هذه المسودة، اكتب `!كلان` من جديد.');
      return null;
    }
    if (draft.creatorId !== interaction.user.id) {
      await respond(interaction, '❌ هذه المسودة تخص شخصاً آخر.');
      return null;
    }
    return draft;
  }

  async function onDraftUserSelect(interaction, which) {
    const draft = await getDraft(interaction);
    if (!draft) return;

    const userId = interaction.values[0];
    const picked = interaction.users ? interaction.users.first() : null;
    if (picked && picked.bot) return respond(interaction, '❌ لا يمكن اختيار بوت.');

    const other = which === 'leader' ? draft.deputyId : draft.leaderId;
    if (other && other === userId) return respond(interaction, '❌ لا يمكن أن يكون المسؤول والنائب نفس الشخص.');

    const existing = await getClanOfUser(interaction.guild.id, userId);
    if (existing) return respond(interaction, `❌ هذا العضو ينتمي بالفعل إلى كلان (**${esc(existing.name)}**) — العضو يستطيع دخول كلان واحد فقط.`);

    if (which === 'leader') draft.leaderId = userId;
    else draft.deputyId = userId;
    return interaction.update(draftView(draft));
  }

  async function onDraftInfoButton(interaction) {
    const draft = await getDraft(interaction);
    if (!draft) return;

    const nameInput = new TextInputBuilder().setCustomId('name').setLabel('اسم الكلان').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true);
    const emojiInput = new TextInputBuilder().setCustomId('emoji').setLabel('إيموجي الكلان (إيموجي واحد)').setStyle(TextInputStyle.Short).setMaxLength(16).setRequired(true);
    if (draft.name) nameInput.setValue(draft.name);
    if (draft.emoji) emojiInput.setValue(draft.emoji);

    const modal = new ModalBuilder().setCustomId('clan_draft_modal').setTitle('بيانات الكلان')
      .addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(emojiInput));
    return interaction.showModal(modal);
  }

  async function onDraftModal(interaction) {
    const draft = await getDraft(interaction);
    if (!draft) return;

    const name = cleanName(interaction.fields.getTextInputValue('name'));
    const emoji = parseEmoji(interaction.fields.getTextInputValue('emoji'));

    const nameError = validateName(name);
    if (nameError) return respond(interaction, nameError);
    if (!emoji) return respond(interaction, '❌ الإيموجي غير صالح — اكتب إيموجي عادي واحد فقط (الإيموجيات المخصصة للسيرفر غير مدعومة).');

    const dup = await pool.query('SELECT 1 FROM clans WHERE guild_id = $1 AND LOWER(name) = LOWER($2)', [interaction.guild.id, name]);
    if (dup.rowCount) return respond(interaction, '❌ يوجد كلان بنفس هذا الاسم بالفعل.');

    draft.name = name;
    draft.emoji = emoji;
    await interaction.deferUpdate();
    return interaction.message.edit(draftView(draft));
  }

  async function onDraftCancel(interaction) {
    const draft = await getDraft(interaction);
    if (!draft) return;
    drafts.delete(interaction.message.id);
    const embed = new EmbedBuilder().setTitle('❌ تم إلغاء إنشاء الكلان').setColor(0xef4444);
    return interaction.update({ embeds: [embed], components: [] });
  }

  async function onDraftCreate(interaction) {
    const draft = await getDraft(interaction);
    if (!draft) return;

    if (!(await canUseClanCommands(interaction.member))) {
      return respond(interaction, '❌ ليس لديك صلاحية إنشاء الكلانات.');
    }
    if (draft.busy) return respond(interaction, '⏳ جاري إنشاء الكلان بالفعل، انتظر قليلاً.');
    if (!draft.name || !draft.emoji) return respond(interaction, '❌ حدّد اسم الكلان والإيموجي أولاً من زر **اسم الكلان والإيموجي**.');
    if (!draft.leaderId) return respond(interaction, '❌ حدّد مسؤول الكلان أولاً من القائمة.');

    draft.busy = true;
    await interaction.deferReply({ ephemeral: true });
    try {
      const clan = await createClan(interaction.guild, draft);
      drafts.delete(interaction.message.id);

      await interaction.editReply({
        content: `✅ تم إنشاء الكلان ${clan.emoji} **${esc(clan.name)}** بنجاح!\n🎭 الرتبة: <@&${clan.role_id}>\n🎛️ لوحة التحكم: <#${clan.panel_channel_id}>`
      });

      const doneEmbed = new EmbedBuilder()
        .setTitle(`✅ تم إنشاء كلان ${clan.emoji} ${clan.name}`)
        .addFields(
          { name: '👑 المسؤول', value: `<@${clan.leader_id}>`, inline: true },
          { name: '🛡️ النائب', value: clan.deputy_id ? `<@${clan.deputy_id}>` : '`لا يوجد`', inline: true },
          { name: '🎭 الرتبة', value: `<@&${clan.role_id}>`, inline: true }
        )
        .setColor(0x10b981)
        .setTimestamp();
      await interaction.message.edit({ embeds: [doneEmbed], components: [] }).catch(() => {});
    } catch (err) {
      draft.busy = false;
      throw err;
    }
  }

  // ------------------------------------------------------------------------
  // 11. أمر !تقديم-كلان — لوحة التقديم + اختيار الكلان + النموذج + قبول/رفض
  // ------------------------------------------------------------------------
  async function pendingApplicationAlive(guild, clan, app) {
    if (!app.message_id || !clan.apply_channel_id) return false;
    const ch = await guild.channels.fetch(clan.apply_channel_id).catch(() => null);
    if (!ch) return false;
    const msg = await ch.messages.fetch(app.message_id).catch(() => null);
    return !!msg;
  }

  async function onApplyStart(interaction) {
    const existing = await getClanOfUser(interaction.guild.id, interaction.user.id);
    if (existing) {
      return respond(interaction, `❌ أنت بالفعل عضو في كلان (**${esc(existing.name)}**)، ولا يمكنك التقديم على كلان آخر.`);
    }

    const res = await pool.query('SELECT id, name, emoji FROM clans WHERE guild_id = $1 ORDER BY id', [interaction.guild.id]);
    if (!res.rows.length) return respond(interaction, '❌ لا توجد كلانات متاحة للتقديم حالياً.');

    const clans = res.rows.slice(0, 125);
    const rows = [];
    for (let i = 0; i < clans.length; i += 25) {
      const chunk = clans.slice(i, i + 25);
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`clan_apply_select_${rows.length}`)
        .setPlaceholder(clans.length > 25 ? `📂 اختر الكلان (قائمة ${rows.length + 1})` : '📂 اختر الكلان الذي تريد التقديم عليه')
        .addOptions(chunk.map(c =>
          new StringSelectMenuOptionBuilder().setLabel(`${c.emoji} ${c.name}`.slice(0, 100)).setValue(String(c.id))
        ));
      rows.push(new ActionRowBuilder().addComponents(menu));
    }

    return interaction.reply({ content: '🏰 **اختر اسم الكلان الذي تريد الانضمام إليه:**', components: rows, ephemeral: true });
  }

  async function onApplySelect(interaction) {
    const clanId = parseInt(interaction.values[0], 10);
    const clan = Number.isInteger(clanId) ? await getClanById(clanId) : null;
    if (!clan || clan.guild_id !== interaction.guild.id) return respond(interaction, '❌ هذا الكلان لم يعد موجوداً.');

    const existing = await getClanOfUser(interaction.guild.id, interaction.user.id);
    if (existing) return respond(interaction, `❌ أنت بالفعل عضو في كلان (**${esc(existing.name)}**).`);

    const pending = await pool.query(`SELECT * FROM clan_applications WHERE clan_id = $1 AND user_id = $2 AND status = 'pending'`, [clan.id, interaction.user.id]);
    if (pending.rows[0]) {
      if (await pendingApplicationAlive(interaction.guild, clan, pending.rows[0])) {
        return respond(interaction, '⏳ لديك تقديم قيد المراجعة على هذا الكلان بالفعل.');
      }
      await pool.query(`UPDATE clan_applications SET status = 'cancelled' WHERE id = $1`, [pending.rows[0].id]);
    }

    const modal = new ModalBuilder()
      .setCustomId(`clan_apply_modal_${clan.id}`)
      .setTitle(`التقديم على كلان ${clan.name}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('interact').setLabel('مدة تفاعلك (مثال: 3 ساعات يومياً)').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('age').setLabel('عمرك').setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(2).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('pname').setLabel('اسمك').setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }

  async function onApplyModal(interaction) {
    const clanId = parseInt(interaction.customId.replace('clan_apply_modal_', ''), 10);
    const interact = interaction.fields.getTextInputValue('interact').trim();
    const ageRaw = normalizeDigits(interaction.fields.getTextInputValue('age')).trim();
    const pname = interaction.fields.getTextInputValue('pname').trim();

    if (!/^\d{1,2}$/.test(ageRaw) || parseInt(ageRaw, 10) < 1) return respond(interaction, '❌ العمر يجب أن يكون رقماً صحيحاً.');
    if (!interact || !pname) return respond(interaction, '❌ يجب تعبئة جميع الخانات.');

    await interaction.deferReply({ ephemeral: true });

    const clan = Number.isInteger(clanId) ? await getClanById(clanId) : null;
    if (!clan || clan.guild_id !== interaction.guild.id) throw new UserError('❌ هذا الكلان لم يعد موجوداً.');

    const existing = await getClanOfUser(interaction.guild.id, interaction.user.id);
    if (existing) throw new UserError(`❌ أنت بالفعل عضو في كلان (**${esc(existing.name)}**).`);

    const applyCh = clan.apply_channel_id ? await interaction.guild.channels.fetch(clan.apply_channel_id).catch(() => null) : null;
    if (!applyCh) throw new UserError('❌ تعذر الوصول لروم تقديمات هذا الكلان، تواصل مع الإدارة.');

    let app;
    try {
      const ins = await pool.query('INSERT INTO clan_applications (clan_id, user_id) VALUES ($1, $2) RETURNING *', [clan.id, interaction.user.id]);
      app = ins.rows[0];
    } catch (err) {
      if (err && err.code === '23505') throw new UserError('⏳ لديك تقديم قيد المراجعة على هذا الكلان بالفعل.');
      throw err;
    }

    try {
      const member = interaction.member;
      const joinedServerDays = member && member.joinedTimestamp ? Math.floor((Date.now() - member.joinedTimestamp) / 86400000) : '-';
      const joinedDiscordDays = Math.floor((Date.now() - interaction.user.createdTimestamp) / 86400000);

      const embed = new EmbedBuilder()
        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
        .setTitle(`📨 طلب انضمام لكلان ${clan.emoji} ${clan.name}`)
        .setDescription(`👤 **المتقدم:** ${interaction.user} (\`${interaction.user.id}\`)`)
        .addFields(
          { name: '📛 الاسم', value: codeBlock(pname) },
          { name: '🎂 العمر', value: codeBlock(ageRaw) },
          { name: '⏱️ مدة التفاعل', value: codeBlock(interact) },
          { name: '📅 انضم للسيرفر منذ', value: `\`${joinedServerDays} days ago\``, inline: true },
          { name: '🌐 انضم للديسكورد منذ', value: `\`${joinedDiscordDays} days ago\``, inline: true }
        )
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setColor(0xeab308)
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`clan_app_accept_${app.id}`).setLabel('قبول').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`clan_app_reject_${app.id}`).setLabel('رفض').setEmoji('❌').setStyle(ButtonStyle.Danger)
      );

      const mentions = [clan.leader_id, clan.deputy_id].filter(Boolean);
      const sent = await applyCh.send({
        content: mentions.map(id => `<@${id}>`).join(' '),
        embeds: [embed],
        components: [row],
        allowedMentions: { users: mentions }
      });
      await pool.query('UPDATE clan_applications SET message_id = $1 WHERE id = $2', [sent.id, app.id]);
    } catch (err) {
      await pool.query('DELETE FROM clan_applications WHERE id = $1', [app.id]).catch(() => {});
      throw err;
    }

    return interaction.editReply({ content: `✅ تم إرسال تقديمك على كلان ${clan.emoji} **${esc(clan.name)}** بنجاح! سيراجعه مسؤول الكلان ونائبه.` });
  }

  async function finalizeApplicationMessage(interaction, color, text) {
    const base = interaction.message.embeds[0];
    const embed = base ? EmbedBuilder.from(base) : new EmbedBuilder();
    embed.setColor(color).addFields({ name: '📌 القرار', value: text });
    await interaction.message.edit({ embeds: [embed], components: [] }).catch(() => {});
  }

  // إرسال رسالة خاصة للمتقدم بنتيجة تقديمه — يرجع false إذا كان الخاص مغلقاً (لا يوقف العملية)
  async function notifyApplicant(guild, clan, userId, isAccept, decider) {
    try {
      const user = await client.users.fetch(userId);
      const embed = new EmbedBuilder()
        .setTitle(isAccept ? `🎉 تم قبولك في كلان ${clan.emoji} ${clan.name}` : `❌ تم رفض تقديمك على كلان ${clan.emoji} ${clan.name}`)
        .setDescription(isAccept
          ? `مبروك! تم قبول تقديمك في الكلان بسيرفر **${esc(guild.name)}** وحصلت على رتبة الكلان.\nتقدر تشوف رومات الكلان الآن.`
          : `للأسف تم رفض تقديمك على الكلان بسيرفر **${esc(guild.name)}**.\nتقدر تقدّم على كلان آخر أو تعيد المحاولة لاحقاً.`)
        .addFields({ name: isAccept ? '✅ قبله' : '❌ رفضه', value: `${esc(decider.tag)}`, inline: true })
        .setColor(isAccept ? 0x10b981 : 0xef4444)
        .setTimestamp();
      await user.send({ embeds: [embed] });
      return true;
    } catch (err) {
      return false;
    }
  }

  async function onApplicationDecision(interaction, isAccept) {
    const appId = parseInt(interaction.customId.split('_').pop(), 10);
    await interaction.deferReply({ ephemeral: true });

    const appRes = Number.isInteger(appId) ? await pool.query('SELECT * FROM clan_applications WHERE id = $1', [appId]) : { rows: [] };
    const app = appRes.rows[0];
    if (!app) {
      await interaction.message.edit({ components: [] }).catch(() => {});
      throw new UserError('❌ هذا التقديم لم يعد موجوداً.');
    }
    const clan = await getClanById(app.clan_id);
    if (!clan) throw new UserError('❌ هذا الكلان لم يعد موجوداً.');

    const uid = interaction.user.id;
    if (uid !== clan.leader_id && uid !== clan.deputy_id) {
      throw new UserError('❌ فقط مسؤول الكلان أو نائبه يستطيع قبول أو رفض التقديمات.');
    }
    if (app.status !== 'pending') {
      await interaction.message.edit({ components: [] }).catch(() => {});
      throw new UserError('⚠️ تم البتّ في هذا التقديم مسبقاً.');
    }

    const claimed = await pool.query(
      `UPDATE clan_applications SET status = $1, decided_by = $2 WHERE id = $3 AND status = 'pending' RETURNING *`,
      [isAccept ? 'accepted' : 'rejected', uid, appId]
    );
    if (!claimed.rowCount) throw new UserError('⚠️ تم البتّ في هذا التقديم مسبقاً.');

    if (!isAccept) {
      await finalizeApplicationMessage(interaction, 0xef4444, `❌ تم الرفض بواسطة ${interaction.user}`);
      const rejectDm = await notifyApplicant(interaction.guild, clan, app.user_id, false, interaction.user);
      return interaction.editReply({ content: `✅ تم رفض التقديم.${rejectDm ? '' : '\n⚠️ تعذّر إرسال رسالة خاصة للمتقدم (الخاص مغلق).'}` });
    }

    try {
      await addMemberToClan(interaction.guild, clan, app.user_id);
    } catch (err) {
      if (err instanceof UserError && (err.reason === 'in_clan' || err.reason === 'left' || err.reason === 'bot')) {
        await pool.query(`UPDATE clan_applications SET status = 'cancelled' WHERE id = $1`, [appId]);
        await finalizeApplicationMessage(interaction, 0x6b7280, `⚠️ تعذر القبول: ${err.userMessage.replace(/^❌ |^⚠️ /, '')}`);
        return interaction.editReply({ content: err.userMessage });
      }
      // خطأ مؤقت (صلاحيات مثلاً): يرجع التقديم قيد المراجعة ليُعاد المحاولة
      await pool.query(`UPDATE clan_applications SET status = 'pending', decided_by = NULL WHERE id = $1`, [appId]).catch(() => {});
      throw err;
    }

    await finalizeApplicationMessage(interaction, 0x10b981, `✅ تم القبول بواسطة ${interaction.user}`);
    const acceptDm = await notifyApplicant(interaction.guild, clan, app.user_id, true, interaction.user);
    return interaction.editReply({ content: `✅ تم قبول <@${app.user_id}> وإعطاؤه رتبة الكلان.${acceptDm ? '' : '\n⚠️ تعذّر إرسال رسالة خاصة للمتقدم (الخاص مغلق).'}` });
  }

  // ------------------------------------------------------------------------
  // 12. أزرار لوحة تحكم الكلان
  // ------------------------------------------------------------------------
  async function getCtl(interaction, leaderOnly) {
    const clan = await getClanByPanelChannel(interaction.channelId);
    if (!clan) {
      await respond(interaction, '❌ هذه الأزرار تعمل فقط داخل روم لوحة تحكم الكلان.');
      return null;
    }
    const isLeader = clan.leader_id === interaction.user.id;
    const isDeputy = clan.deputy_id === interaction.user.id;
    // أصحاب صلاحية أوامر الكلانات (ادمن ستريس افتراضياً / المضبوطة بالموقع / الأدمن) يتحكمون بلوحة أي كلان بكل الأزرار
    const isStaff = (isLeader || isDeputy) ? false : await canUseClanCommands(interaction.member);
    if (isStaff) {
      clan.actorIsStaff = true;
      return clan;
    }
    if (leaderOnly ? !isLeader : !(isLeader || isDeputy)) {
      await respond(interaction, leaderOnly
        ? '❌ هذا الزر مخصص لمسؤول الكلان فقط.'
        : '❌ هذه الأزرار مخصصة لمسؤول الكلان ونائبه فقط.');
      return null;
    }
    return clan;
  }

  function userPickerReply(customId, text) {
    return {
      content: text,
      ephemeral: true,
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder('🔎 ابحث واختر العضو').setMinValues(1).setMaxValues(1)
        )
      ]
    };
  }

  async function onCtlButton(interaction) {
    const id = interaction.customId;
    const leaderOnly = ['clan_ctl_deputy', 'clan_ctl_undeputy', 'clan_ctl_delete'].includes(id);
    const clan = await getCtl(interaction, leaderOnly);
    if (!clan) return;

    switch (id) {
      case 'clan_ctl_add':
        return interaction.reply(userPickerReply('clan_ctl_add_pick', '➕ **اختر العضو الذي تريد إضافته للكلان:**'));

      case 'clan_ctl_kick':
        return interaction.reply(userPickerReply('clan_ctl_kick_pick', '➖ **اختر العضو الذي تريد طرده من الكلان:**'));

      case 'clan_ctl_deputy':
        return interaction.reply(userPickerReply('clan_ctl_deputy_pick', '🛡️ **اختر العضو الذي تريد تعيينه نائباً:**'));

      case 'clan_ctl_undeputy': {
        if (!clan.deputy_id) return respond(interaction, '⚠️ لا يوجد نائب حالياً.');
        await interaction.deferReply({ ephemeral: true });
        const oldDeputy = clan.deputy_id;
        await pool.query('UPDATE clans SET deputy_id = NULL WHERE id = $1', [clan.id]);
        await revokeRole(interaction.guild, clan.deputy_role_id, oldDeputy);
        await refreshPanel(interaction.guild, clan.id);
        return interaction.editReply({ content: '✅ تمت إزالة النائب (يبقى عضواً عادياً في الكلان).' });
      }

      case 'clan_ctl_rename': {
        const input = new TextInputBuilder().setCustomId('name').setLabel('الاسم الجديد للكلان').setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true).setValue(clan.name.slice(0, 32));
        return interaction.showModal(new ModalBuilder().setCustomId('clan_ctl_rename_modal').setTitle('تغيير اسم الكلان').addComponents(new ActionRowBuilder().addComponents(input)));
      }

      case 'clan_ctl_color': {
        const input = new TextInputBuilder().setCustomId('color').setLabel('اللون بصيغة Hex (مثال: #3b82f6)').setStyle(TextInputStyle.Short).setMinLength(6).setMaxLength(7).setRequired(true);
        return interaction.showModal(new ModalBuilder().setCustomId('clan_ctl_color_modal').setTitle('تغيير لون الرتبة').addComponents(new ActionRowBuilder().addComponents(input)));
      }

      case 'clan_ctl_emoji': {
        const input = new TextInputBuilder().setCustomId('emoji').setLabel('الإيموجي الجديد (إيموجي واحد)').setStyle(TextInputStyle.Short).setMaxLength(16).setRequired(true);
        return interaction.showModal(new ModalBuilder().setCustomId('clan_ctl_emoji_modal').setTitle('تغيير إيموجي الكلان').addComponents(new ActionRowBuilder().addComponents(input)));
      }

      case 'clan_ctl_style': {
        const input = new TextInputBuilder()
          .setCustomId('style')
          .setLabel('الزخرفة — {emoji} إيموجيك، {name} اسم الروم')
          .setPlaceholder('مثال: ^{name}& أو {emoji}│{name} — اتركها فارغة للافتراضية')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(CHANNEL_STYLE_MAX)
          .setRequired(false)
          .setValue((clan.channel_style || DEFAULT_CHANNEL_STYLE).slice(0, CHANNEL_STYLE_MAX));
        return interaction.showModal(new ModalBuilder().setCustomId('clan_ctl_style_modal').setTitle('زخرفة رومات الكلان').addComponents(new ActionRowBuilder().addComponents(input)));
      }

      case 'clan_ctl_delete': {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('clan_ctl_delete_confirm').setLabel('تأكيد الحذف النهائي').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('clan_ctl_delete_cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({
          content: `⚠️ **هل أنت متأكد من حذف كلان ${esc(clan.name)}؟**\nسيتم حذف رتبة الكلان وجميع رومات الكلان وبياناته نهائياً ولا يمكن التراجع.`,
          components: [row],
          ephemeral: true
        });
      }
    }
  }

  async function onCtlAddPick(interaction) {
    const clan = await getCtl(interaction, false);
    if (!clan) return;
    await interaction.deferUpdate();
    const member = await addMemberToClan(interaction.guild, clan, interaction.values[0]);
    return interaction.editReply({ content: `✅ تمت إضافة ${member} إلى الكلان وإعطاؤه الرتبة.`, components: [] });
  }

  async function onCtlKickPick(interaction) {
    const clan = await getCtl(interaction, false);
    if (!clan) return;
    await interaction.deferUpdate();

    const targetId = interaction.values[0];
    if (targetId === clan.leader_id) throw new UserError('❌ لا يمكن طرد مسؤول الكلان.');
    if (!(await isMemberOfClan(clan.id, targetId))) throw new UserError('❌ هذا العضو ليس من أعضاء الكلان.');

    if (targetId === clan.deputy_id) {
      if (clan.leader_id !== interaction.user.id && !clan.actorIsStaff) throw new UserError('❌ فقط مسؤول الكلان يستطيع طرد النائب.');
      await pool.query('UPDATE clans SET deputy_id = NULL WHERE id = $1', [clan.id]);
      await revokeRole(interaction.guild, clan.deputy_role_id, targetId);
    }

    await removeMemberFromClan(interaction.guild, clan, targetId);
    await refreshPanel(interaction.guild, clan.id);
    return interaction.editReply({ content: `✅ تم طرد <@${targetId}> من الكلان وسحب رتبته.`, components: [] });
  }

  async function onCtlDeputyPick(interaction) {
    const clan = await getCtl(interaction, true);
    if (!clan) return;
    await interaction.deferUpdate();

    const targetId = interaction.values[0];
    if (targetId === clan.leader_id) throw new UserError('❌ المسؤول لا يمكن أن يكون نائباً.');
    if (targetId === clan.deputy_id) throw new UserError('⚠️ هذا العضو هو النائب بالفعل.');

    const existing = await getClanOfUser(interaction.guild.id, targetId);
    if (existing && existing.id !== clan.id) {
      throw new UserError(`❌ هذا العضو ينتمي بالفعل إلى كلان آخر (**${esc(existing.name)}**).`);
    }
    if (!existing) await addMemberToClan(interaction.guild, clan, targetId); // إضافته للكلان تلقائياً إن لم يكن عضواً

    const oldDeputy = clan.deputy_id;
    await pool.query('UPDATE clans SET deputy_id = $1 WHERE id = $2', [targetId, clan.id]);
    if (oldDeputy) await revokeRole(interaction.guild, clan.deputy_role_id, oldDeputy);
    await grantRole(interaction.guild, clan.deputy_role_id, targetId);
    await refreshPanel(interaction.guild, clan.id);
    return interaction.editReply({ content: `✅ تم تعيين <@${targetId}> نائباً للكلان.`, components: [] });
  }

  async function onCtlRenameModal(interaction) {
    const clan = await getCtl(interaction, false);
    if (!clan) return;

    const newName = cleanName(interaction.fields.getTextInputValue('name'));
    const nameError = validateName(newName);
    if (nameError) return respond(interaction, nameError);

    await interaction.deferReply({ ephemeral: true });

    const dup = await pool.query('SELECT 1 FROM clans WHERE guild_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3', [clan.guild_id, newName, clan.id]);
    if (dup.rowCount) throw new UserError('❌ يوجد كلان آخر بنفس هذا الاسم.');

    try {
      await pool.query('UPDATE clans SET name = $1 WHERE id = $2', [newName, clan.id]);
    } catch (err) {
      if (err && err.code === '23505') throw new UserError('❌ يوجد كلان آخر بنفس هذا الاسم.');
      throw err;
    }

    const updated = await getClanById(clan.id);
    const failedNaming = await applyClanNaming(interaction.guild, updated, true);
    await refreshPanel(interaction.guild, clan.id);
    // 🟢 [إصلاح] لا نعلن نجاحاً كاملاً إذا تعذّر تطبيق جزء منه فعلياً (غالباً بسبب حد ديسكورد لتكرار التعديل)
    const warn = namingWarning(failedNaming);
    return interaction.editReply({ content: `✅ تم تغيير اسم الكلان إلى **${esc(newName)}** (الرتبة والكاتيجوري والرومات).${warn}` });
  }

  async function onCtlColorModal(interaction) {
    const clan = await getCtl(interaction, false);
    if (!clan) return;

    const match = interaction.fields.getTextInputValue('color').trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return respond(interaction, '❌ اللون غير صالح — اكتبه بصيغة Hex مثل `#3b82f6`.');

    await interaction.deferReply({ ephemeral: true });
    const role = clan.role_id ? await interaction.guild.roles.fetch(clan.role_id).catch(() => null) : null;
    if (!role) throw new UserError('❌ رتبة الكلان غير موجودة (ربما حُذفت يدوياً).');

    await role.setColor(`#${match[1]}`, 'تعديل لون كلان');
    await refreshPanel(interaction.guild, clan.id);
    return interaction.editReply({ content: `✅ تم تغيير لون رتبة الكلان إلى \`#${match[1].toLowerCase()}\`.` });
  }

  async function onCtlEmojiModal(interaction) {
    const clan = await getCtl(interaction, false);
    if (!clan) return;

    const emoji = parseEmoji(interaction.fields.getTextInputValue('emoji'));
    if (!emoji) return respond(interaction, '❌ الإيموجي غير صالح — اكتب إيموجي عادي واحد فقط (الإيموجيات المخصصة للسيرفر غير مدعومة).');

    await interaction.deferReply({ ephemeral: true });
    await pool.query('UPDATE clans SET emoji = $1 WHERE id = $2', [emoji, clan.id]);
    const updated = await getClanById(clan.id);
    const failedNaming = await applyClanNaming(interaction.guild, updated, true);
    await refreshPanel(interaction.guild, clan.id);
    const warn = namingWarning(failedNaming);
    return interaction.editReply({ content: `✅ تم تغيير إيموجي الكلان إلى ${emoji}${warn}` });
  }

  async function onCtlStyleModal(interaction) {
    const clan = await getCtl(interaction, false);
    if (!clan) return;

    const raw = interaction.fields.getTextInputValue('style').trim();
    // لو كتب المستخدم إيموجي الكلان نفسه بدل {emoji} نحوّله للمتغير، فيتحدث تلقائياً مع أي تغيير لإيموجي الكلان لاحقاً
    const normalized = raw.split(clan.emoji).join('{emoji}');
    const style = normalized === '' || normalized === DEFAULT_CHANNEL_STYLE ? null : normalized;
    const styleError = style ? validateChannelStyle(clan, style) : null;
    if (styleError) return respond(interaction, styleError);

    await interaction.deferReply({ ephemeral: true });
    await pool.query('UPDATE clans SET channel_style = $1 WHERE id = $2', [style, clan.id]);
    const updated = await getClanById(clan.id);
    const failedNaming = await applyClanNaming(interaction.guild, updated, true);
    await refreshPanel(interaction.guild, clan.id);
    const warn = namingWarning(failedNaming);
    const shown = channelNames(updated).chat;
    return interaction.editReply({ content: `✅ تم تطبيق الزخرفة على رومات الكلان — مثال: \`${shown}\`${warn}` });
  }

  async function onCtlDeleteConfirm(interaction) {
    const clan = await getCtl(interaction, true);
    if (!clan) return;
    await interaction.deferUpdate();
    await deleteClan(interaction.guild, clan);
  }

  // ------------------------------------------------------------------------
  // 13. موجّه التفاعلات (كل customId يبدأ بـ clan_)
  // ------------------------------------------------------------------------
  client.on('interactionCreate', async (interaction) => {
    const id = interaction.customId;
    if (typeof id !== 'string' || !id.startsWith('clan_') || !interaction.guild) return;

    try {
      if (interaction.isButton()) {
        if (id === 'clan_draft_info') return await onDraftInfoButton(interaction);
        if (id === 'clan_draft_create') return await onDraftCreate(interaction);
        if (id === 'clan_draft_cancel') return await onDraftCancel(interaction);
        if (id === 'clan_apply_start') return await onApplyStart(interaction);
        if (id.startsWith('clan_app_accept_')) return await onApplicationDecision(interaction, true);
        if (id.startsWith('clan_app_reject_')) return await onApplicationDecision(interaction, false);
        if (id === 'clan_ctl_delete_confirm') return await onCtlDeleteConfirm(interaction);
        if (id === 'clan_ctl_delete_cancel') return await interaction.update({ content: '✅ تم إلغاء حذف الكلان.', components: [] });
        if (id.startsWith('clan_ctl_')) return await onCtlButton(interaction);
        return;
      }

      if (interaction.isUserSelectMenu()) {
        if (id === 'clan_draft_leader') return await onDraftUserSelect(interaction, 'leader');
        if (id === 'clan_draft_deputy') return await onDraftUserSelect(interaction, 'deputy');
        if (id === 'clan_ctl_add_pick') return await onCtlAddPick(interaction);
        if (id === 'clan_ctl_kick_pick') return await onCtlKickPick(interaction);
        if (id === 'clan_ctl_deputy_pick') return await onCtlDeputyPick(interaction);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        if (id.startsWith('clan_apply_select_')) return await onApplySelect(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        if (id === 'clan_draft_modal') return await onDraftModal(interaction);
        if (id.startsWith('clan_apply_modal_')) return await onApplyModal(interaction);
        if (id === 'clan_ctl_rename_modal') return await onCtlRenameModal(interaction);
        if (id === 'clan_ctl_color_modal') return await onCtlColorModal(interaction);
        if (id === 'clan_ctl_emoji_modal') return await onCtlEmojiModal(interaction);
        if (id === 'clan_ctl_style_modal') return await onCtlStyleModal(interaction);
      }
    } catch (err) {
      await handleError(interaction, err, id);
    }
  });

  // ------------------------------------------------------------------------
  // 14. أوامر الرسائل: !كلان و !تقديم-كلان
  // ------------------------------------------------------------------------
  client.on('messageCreate', async (message) => {
    try {
      // 🛡️ حارس التنفيذ المزدوج: messageCreate.js و system.js و xp.js يتحققون
      // من هذا العلم قبل العمل؛ clans.js وحده لم يكن يتحقق منه. والنتيجة أن
      // اختصاراً مضبوطاً في «إعدادات أوامر السلاش» و«إعدادات الكلانات» معاً
      // كان يُنفَّذ مرتين: مرة عبر slashPrefix (يوجّهه إلى /clan) ومرة هنا.
      // باقي المستمعات مسجّلة بعد slashPrefix، فمن يسبق يكسب — والسلوك الآن
      // موحّد: الرسالة تُعالَج مرة واحدة فقط.
      if (message.author.bot || !message.guild || !message.member || message.__slashCommandHandled) return;
      // 🔓 (2026-10-02) «!» و«$» سواء: اختصار المالك يعمل بأي بريفكس.
      const clanText = message.content.trim();
      const clanPrefix = (clanText[0] === PREFIX || clanText[0] === ADMIN_PREFIX) ? clanText[0] : '';
      const hasPrefix = Boolean(clanPrefix);
      const controlConfig = await getCommandControlConfig(pool).catch(err => {
        console.error('تعذر تحميل إعدادات أوامر الكلانات:', err);
        return COMMAND_CONTROL_DEFAULTS;
      });
      const commandText = clanPrefix ? clanText.slice(1).trim() : clanText;
      const clanWords = commandText.split(/ +/).filter(Boolean);
      const requestedCommand = (clanWords[0] || '').toLowerCase();
      // 🔓 اختصار المالك قد يكون أكثر من كلمة — نطابق أطول صيغة أولاً.
      const clanAliasMatch = resolveCommandControlAliasPhrase(clanWords, controlConfig);
      const aliasTarget = clanAliasMatch ? clanAliasMatch.target : null;
      const command = aliasTarget || requestedCommand;
      const args = clanWords.slice(clanAliasMatch ? clanAliasMatch.words : 1);
      if ((command !== 'كلان' && command !== 'تقديم-كلان') || (!hasPrefix && !aliasTarget)) return;
      // 🚦 أوامر الكلانات صارت سلاش فقط (/clan) — إلا اختصار المالك فيعمل بأي بريفكس.
      if (hasPrefix && !aliasTarget && isPrefixBlocked(command)) {
        message.__slashCommandHandled = true;
        return;
      }
      if (!controlConfig.clans.enabled) return;

      if (!(await canUseClanCommands(message.member))) {
        return message.reply('❌ ليس لديك صلاحية استخدام هذا الأمر.');
      }

      if (command === 'كلان') {
        const draft = { creatorId: message.author.id, name: null, emoji: null, leaderId: null, deputyId: null, busy: false };
        const sent = await message.channel.send(draftView(draft));
        drafts.set(sent.id, draft);
        const timer = setTimeout(() => drafts.delete(sent.id), DRAFT_TTL_MS);
        if (timer.unref) timer.unref();
        return message.delete().catch(() => {});
      }

      if (command === 'تقديم-كلان') {
        const embed = new EmbedBuilder()
          .setTitle('🏰 التقديم على الكلانات')
          .setDescription(
            'هل تريد الانضمام إلى أحد كلانات السيرفر؟\n\n' +
            '1️⃣ اضغط على زر **التقديم على كلان**\n' +
            '2️⃣ اختر اسم الكلان من القائمة\n' +
            '3️⃣ اكتب مدة تفاعلك وعمرك واسمك\n\n' +
            'سيصل طلبك إلى مسؤول الكلان ونائبه للمراجعة.\n' +
            '⚠️ يمكنك الانضمام إلى **كلان واحد فقط**.'
          )
          .setColor(DEFAULT_CLAN_COLOR_INT)
          .setThumbnail(message.guild.iconURL({ dynamic: true }));

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('clan_apply_start').setLabel('التقديم على كلان').setEmoji('📝').setStyle(ButtonStyle.Primary)
        );
        await message.channel.send({ embeds: [embed], components: [row] });
        return message.delete().catch(() => {});
      }
    } catch (err) {
      if (helpers && helpers.sendLogError) helpers.sendLogError('خطأ في أوامر الكلانات:', err);
      else console.error('❌ خطأ في أوامر الكلانات:', err);
    }
  });

  // ------------------------------------------------------------------------
  // 15. مغادرة عضو للسيرفر — تحرير مكانه بالكلان (وترقية النائب إن غادر المسؤول)
  // ------------------------------------------------------------------------
  client.on('guildMemberRemove', async (member) => {
    try {
      await initPromise;
      const clan = await getClanOfUser(member.guild.id, member.id);
      if (!clan) return;

      await pool.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clan.id, member.id]);

      if (clan.deputy_id === member.id) {
        await pool.query('UPDATE clans SET deputy_id = NULL WHERE id = $1', [clan.id]);
      } else if (clan.leader_id === member.id && clan.deputy_id) {
        await pool.query('UPDATE clans SET leader_id = deputy_id, deputy_id = NULL WHERE id = $1', [clan.id]);
        // النائب يترقى لمسؤول: يأخذ رتبة المسؤول ويفقد رتبة النائب
        await grantRole(member.guild, clan.leader_role_id, clan.deputy_id);
        await revokeRole(member.guild, clan.deputy_role_id, clan.deputy_id);
      }
      await refreshPanel(member.guild, clan.id);
    } catch (err) {
      console.error('❌ خطأ أثناء معالجة مغادرة عضو من كلان:', err);
    }
  });

  // ==========================================================================
  // 🏰 نسخة السلاش من أوامر الكلانات (/clan)
  // نفس الصلاحية (canUseClanCommands) ونفس اللوحات المستخدمة في
  // !كلان و !تقديم-كلان، دون تكرار أي منطق.
  // ==========================================================================
  registerSystemSlashHandler('clan', async (interaction) => {
    const say = (content) => interaction.replied || interaction.deferred
      ? interaction.followUp({ content, ephemeral: true }).catch(() => {})
      : interaction.reply({ content, ephemeral: true }).catch(() => {});

    try {
      await initPromise;

      // نفس بوابة التفعيل المستخدمة في نسخة البريفكس
      let controlConfig = COMMAND_CONTROL_DEFAULTS;
      try { controlConfig = await getCommandControlConfig(pool); } catch (err) {
        console.error('❌ تعذر تحميل إعدادات أوامر الكلانات:', err);
      }
      if (!controlConfig.clans.enabled) return say('⛔ أوامر الكلانات متوقفة حالياً من لوحة التحكم.');

      if (!(await canUseClanCommands(interaction.member))) {
        return say('❌ ليس لديك صلاحية استخدام هذا الأمر.');
      }
      if (!interaction.channel) return say('❌ تعذر الوصول إلى الروم الحالي.');

      // /clan create — نفس لوحة !كلان
      if (interaction.options.getSubcommand() === 'create') {
        const draft = { creatorId: interaction.user.id, name: null, emoji: null, leaderId: null, deputyId: null, busy: false };
        const sent = await interaction.channel.send(draftView(draft));
        drafts.set(sent.id, draft);
        const timer = setTimeout(() => drafts.delete(sent.id), DRAFT_TTL_MS);
        if (timer.unref) timer.unref();
        return say('✅ تم فتح لوحة إنشاء الكلان في هذا الروم.');
      }

      // /clan apply-panel — نفس لوحة !تقديم-كلان
      const embed = new EmbedBuilder()
        .setTitle('🏰 التقديم على الكلانات')
        .setDescription(
          'هل تريد الانضمام إلى أحد كلانات السيرفر؟\n\n' +
          '1️⃣ اضغط على زر **التقديم على كلان**\n' +
          '2️⃣ اختر اسم الكلان من القائمة\n' +
          '3️⃣ اكتب مدة تفاعلك وعمرك واسمك\n\n' +
          'سيصل طلبك إلى مسؤول الكلان ونائبه للمراجعة.\n' +
          '⚠️ يمكنك الانضمام إلى **كلان واحد فقط**.'
        )
        .setColor(DEFAULT_CLAN_COLOR_INT)
        .setThumbnail(interaction.guild.iconURL({ dynamic: true }));

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('clan_apply_start').setLabel('التقديم على كلان').setEmoji('📝').setStyle(ButtonStyle.Primary)
      );
      await interaction.channel.send({ embeds: [embed], components: [row] });
      return say('✅ تم نشر لوحة التقديم على الكلانات في هذا الروم.');
    } catch (err) {
      if (helpers && helpers.sendLogError) helpers.sendLogError('خطأ في أوامر الكلانات:', err);
      else console.error('❌ خطأ في أوامر الكلانات:', err);
      return say('❌ حدث خطأ أثناء تنفيذ الأمر.');
    }
  });

  return {};
};
