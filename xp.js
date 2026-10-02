const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { safeText, safeInteger } = require('./webSafety');

// ==========================================================================
// 🟢 نظام الإكسبي والمستويات والتوب (xp.js) — ملف مستقل بالكامل
// لا يلمس أي جدول أو ملف قديم إطلاقاً: ينشئ جداوله الخاصة به هنا، ويضيف
// صفحات جديدة على نفس سيرفر الداشبورد (app) الممرر له من index.js فقط.
// ==========================================================================
const { registerSystemSlashHandler } = require('./systemSlashBridge');
const { isPrefixBlocked } = require('./prefixPolicy');

module.exports = function createXpSystem(client, pool, app) {

  const PREFIX = '!';
  const ADMIN_PREFIX = '$';

  // ------------------------------------------------------------------------
  // 1. إنشاء جداول نظام الإكسبي الخاصة به فقط (IF NOT EXISTS)
  // ------------------------------------------------------------------------
  async function initXpTables() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS xp_settings (
          key VARCHAR(50) PRIMARY KEY,
          xp_per_message INT DEFAULT 15,
          cooldown_seconds INT DEFAULT 60,
          xp_admin_role_id VARCHAR(100) DEFAULT '',
          levelup_channel_id VARCHAR(100) DEFAULT '',
          last_daily_reset VARCHAR(20) DEFAULT '',
          last_weekly_reset VARCHAR(20) DEFAULT '',
          last_monthly_reset VARCHAR(20) DEFAULT '',
          reset_hour_utc INT DEFAULT 0,
          reset_day_of_week INT DEFAULT 1
        );
      `);

      // احتياطاً في حال كان الجدول منشأ مسبقاً بدون هذين العمودين
      await pool.query(`
        ALTER TABLE xp_settings ADD COLUMN IF NOT EXISTS reset_hour_utc INT DEFAULT 0;
      `);
      await pool.query(`
        ALTER TABLE xp_settings ADD COLUMN IF NOT EXISTS reset_day_of_week INT DEFAULT 1;
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS xp_users (
          user_id VARCHAR(100) PRIMARY KEY,
          total_xp BIGINT DEFAULT 0,
          level INT DEFAULT 0,
          daily_xp BIGINT DEFAULT 0,
          weekly_xp BIGINT DEFAULT 0,
          monthly_xp BIGINT DEFAULT 0,
          last_message_at BIGINT DEFAULT 0
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS xp_level_rewards (
          level INT PRIMARY KEY,
          role_id VARCHAR(100)
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS xp_archive (
          id SERIAL PRIMARY KEY,
          period_type VARCHAR(10),
          period_label VARCHAR(30),
          user_id VARCHAR(100),
          xp_amount BIGINT,
          rank INT
        );
      `);

      // صف الإعدادات الافتراضي إن لم يكن موجوداً
      await pool.query(`
        INSERT INTO xp_settings (key) VALUES ('main_xp')
        ON CONFLICT (key) DO NOTHING;
      `);

      console.log('⭐ تم تجهيز جداول نظام الإكسبي بنجاح!');
    } catch (err) {
      console.error('❌ خطأ أثناء إنشاء جداول نظام الإكسبي:', err);
    }
  }
  initXpTables();

  // ------------------------------------------------------------------------
  // 2. دوال مساعدة عامة
  // ------------------------------------------------------------------------
  async function getSettings() {
    const res = await pool.query('SELECT * FROM xp_settings WHERE key = $1', ['main_xp']);
    return res.rows[0] || {
      xp_per_message: 15, cooldown_seconds: 60, xp_admin_role_id: '',
      levelup_channel_id: '', last_daily_reset: '', last_weekly_reset: '', last_monthly_reset: '', reset_hour_utc: 0, reset_day_of_week: 1
    };
  }

  async function getOrCreateUser(userId) {
    let res = await pool.query('SELECT * FROM xp_users WHERE user_id = $1', [userId]);
    if (res.rows[0]) return res.rows[0];
    await pool.query(`
      INSERT INTO xp_users (user_id) VALUES ($1)
      ON CONFLICT (user_id) DO NOTHING;
    `, [userId]);
    res = await pool.query('SELECT * FROM xp_users WHERE user_id = $1', [userId]);
    return res.rows[0];
  }

  // صيغة احتساب الإكسبي المطلوب لكل مستوى (مشابهة لأنظمة الإكسبي المعروفة)
  function xpNeededForLevel(level) {
    return 5 * (level * level) + (50 * level) + 100;
  }

  // حساب المستوى الحالي انطلاقاً من مجموع الإكسبي الكلي
  function calculateLevel(totalXp) {
    let level = 0;
    let remaining = totalXp;
    while (remaining >= xpNeededForLevel(level)) {
      remaining -= xpNeededForLevel(level);
      level++;
      if (level > 2000) break; // حماية من حلقة لا نهائية
    }
    return level;
  }

  async function hasXpPermission(member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const settings = await getSettings();
    if (settings.xp_admin_role_id && member.roles.cache.has(settings.xp_admin_role_id)) return true;
    return false;
  }

  function createXpEmbed(title, description, color) {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color || '#0284c7').setTimestamp();
  }

  // مزامنة رتبة المكافأة: تُزال الرتبة القديمة وتُضاف الجديدة الأعلى (بدون تراكم)
  async function syncLevelRewardRole(guild, userId, newLevel) {
    try {
      const rewardsRes = await pool.query('SELECT * FROM xp_level_rewards ORDER BY level ASC');
      const rewards = rewardsRes.rows;
      if (rewards.length === 0) return;

      let targetRoleId = null;
      for (const r of rewards) {
        if (newLevel >= r.level) targetRoleId = r.role_id;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      for (const r of rewards) {
        if (r.role_id && r.role_id !== targetRoleId && member.roles.cache.has(r.role_id)) {
          await member.roles.remove(r.role_id).catch(() => {});
        }
      }

      if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
        await member.roles.add(targetRoleId).catch(() => {});
      }
    } catch (err) {
      console.error('❌ خطأ أثناء مزامنة رتبة مكافأة الإكسبي:', err);
    }
  }

  async function sendLevelUpMessage(message, member, newLevel) {
    const settings = await getSettings();
    const embed = createXpEmbed(
      '🎉 لفل أب!',
      `تهانينا ${member} ! لقد وصلت إلى المستوى **${newLevel}** 🎊`,
      '#22c55e'
    );

    let targetChannel = message.channel;
    if (settings.levelup_channel_id) {
      const ch = message.guild.channels.cache.get(settings.levelup_channel_id);
      if (ch) targetChannel = ch;
    }

    targetChannel.send({ embeds: [embed] }).catch(() => {});
  }

  // ------------------------------------------------------------------------
  // 3. منح الإكسبي التلقائي عند كل رسالة (مع الكول داون)
  // ------------------------------------------------------------------------
  client.on('messageCreate', async (message) => {
    // 🚦 لا إكسبي على رسائل الأوامر: «!» أوامر البريفكس، و«$» أوامر التكت.
    if (message.author.bot || !message.guild
      || message.content.startsWith(PREFIX) || message.content.startsWith(ADMIN_PREFIX)) return;

    try {
      const settings = await getSettings();
      const user = await getOrCreateUser(message.author.id);

      const now = Date.now();
      const cooldownMs = (settings.cooldown_seconds || 0) * 1000;
      if (now - Number(user.last_message_at || 0) < cooldownMs) return;

      const gainedXp = settings.xp_per_message || 0;
      if (gainedXp <= 0) return;

      const newTotalXp = Number(user.total_xp) + gainedXp;
      const oldLevel = user.level;
      const newLevel = calculateLevel(newTotalXp);

      await pool.query(`
        UPDATE xp_users SET
          total_xp = $1, level = $2,
          daily_xp = daily_xp + $3, weekly_xp = weekly_xp + $3, monthly_xp = monthly_xp + $3,
          last_message_at = $4
        WHERE user_id = $5;
      `, [newTotalXp, newLevel, gainedXp, now, message.author.id]);

      if (newLevel > oldLevel) {
        await syncLevelRewardRole(message.guild, message.author.id, newLevel);
        await sendLevelUpMessage(message, message.member, newLevel);
      }
    } catch (err) {
      console.error('❌ خطأ أثناء منح الإكسبي التلقائي:', err);
    }
  });

  // ------------------------------------------------------------------------
  // 4. مؤقت تصفير وأرشفة الفترات (يومي/أسبوعي/شهري) — تلقائي بالكامل
  // ------------------------------------------------------------------------
  // تُطبَّق إزاحة "ساعة التصفير" على الوقت قبل حساب تسمية اليوم/الأسبوع/الشهر،
  // بحيث تصير لحظة تغيّر التسمية (وبالتالي التصفير) عند الساعة المحددة من الموقع (بتوقيت UTC) بدل منتصف الليل دائماً.
  function shiftForResetHour(date, resetHourUtc) {
    return new Date(date.getTime() - (Number(resetHourUtc) || 0) * 60 * 60 * 1000);
  }

  function getDailyLabel(d) {
    return d.toISOString().slice(0, 10); // مثال: 2026-08-13
  }
  function getMonthlyLabel(d) {
    return d.toISOString().slice(0, 7); // مثال: 2026-08
  }
  // startDay: يوم بداية الأسبوع المختار من الموقع (0=الأحد, 1=الاثنين, ... 6=السبت)
  // التسمية هي تاريخ أول يوم بالأسبوع (بدل رقم أسبوع ثابت)، لتدعم أي يوم بداية يختاره المستخدم
  function getWeeklyLabel(dateIn, startDay) {
    // 🛡️ [إصلاح توقيت] كانت تُستخدم دوال التوقيت المحلي (getFullYear/getMonth/getDate)
    // داخل Date.UTC، بينما كل بقية الحسابات في الملف تعتمد UTC (toISOString و getUTCDay).
    // على خادم بتوقيت غير UTC (مثل Asia/Dubai = UTC+4) كان ذلك ينتج تاريخاً مختلفاً
    // عن اليومي/الشهري قرب منتصف الليل، فيحدث التصفير الأسبوعي في يوم خاطئ.
    // على خادم UTC النتيجة مطابقة تماماً للسابق، فلا يتغير أي سلوك قائم.
    const d = new Date(Date.UTC(dateIn.getUTCFullYear(), dateIn.getUTCMonth(), dateIn.getUTCDate()));
    const chosenStartDay = Number(startDay);
    const currentDay = d.getUTCDay(); // 0..6
    let diff = currentDay - (isNaN(chosenStartDay) ? 1 : chosenStartDay);
    if (diff < 0) diff += 7;
    d.setUTCDate(d.getUTCDate() - diff);
    return d.toISOString().slice(0, 10); // مثال: 2026-08-09 (بداية الأسبوع)
  }

  async function archiveAndReset(periodType, periodLabel, column) {
    if (!periodLabel) return; // أول تشغيل للبوت، لا يوجد فترة سابقة لأرشفتها
    try {
      const usersRes = await pool.query(`SELECT user_id, ${column} AS xp FROM xp_users WHERE ${column} > 0 ORDER BY ${column} DESC`);
      let rank = 1;
      for (const row of usersRes.rows) {
        await pool.query(`
          INSERT INTO xp_archive (period_type, period_label, user_id, xp_amount, rank)
          VALUES ($1, $2, $3, $4, $5);
        `, [periodType, periodLabel, row.user_id, row.xp, rank]);
        rank++;
      }
      await pool.query(`UPDATE xp_users SET ${column} = 0;`);
      console.log(`⭐ تمت أرشفة وتصفير توب (${periodType}) للفترة: ${periodLabel}`);
    } catch (err) {
      console.error(`❌ خطأ أثناء أرشفة/تصفير الفترة (${periodType}):`, err);
    }
  }

  async function checkPeriodResets() {
    try {
      const settings = await getSettings();
      const now = new Date();
      const shiftedNow = shiftForResetHour(now, settings.reset_hour_utc);

      const currentDaily = getDailyLabel(shiftedNow);
      const currentWeekly = getWeeklyLabel(shiftedNow, settings.reset_day_of_week);
      const currentMonthly = getMonthlyLabel(shiftedNow);

      if (settings.last_daily_reset !== currentDaily) {
        await archiveAndReset('daily', settings.last_daily_reset, 'daily_xp');
        await pool.query(`UPDATE xp_settings SET last_daily_reset = $1 WHERE key = 'main_xp';`, [currentDaily]);
      }
      if (settings.last_weekly_reset !== currentWeekly) {
        await archiveAndReset('weekly', settings.last_weekly_reset, 'weekly_xp');
        await pool.query(`UPDATE xp_settings SET last_weekly_reset = $1 WHERE key = 'main_xp';`, [currentWeekly]);
      }
      if (settings.last_monthly_reset !== currentMonthly) {
        await archiveAndReset('monthly', settings.last_monthly_reset, 'monthly_xp');
        await pool.query(`UPDATE xp_settings SET last_monthly_reset = $1 WHERE key = 'main_xp';`, [currentMonthly]);
      }
    } catch (err) {
      console.error('❌ خطأ أثناء فحص تصفير الفترات:', err);
    }
  }
  setInterval(checkPeriodResets, 5 * 60 * 1000); // فحص كل 5 دقائق
  setTimeout(checkPeriodResets, 15 * 1000); // فحص أولي بعد الإقلاع

  // ------------------------------------------------------------------------
  // 5. أوامر الإدارة بالبريفكس ! (إضافة/سحب الإكسبي؛ التصفير يمر عبر /reset الموحد)
  // ------------------------------------------------------------------------
  // 🟢 [إصلاح: تعارض المبلغ مع آيدي الهدف] يتجاهل أي رمز هو آيدي رقمي صريح (15-21 رقم)
  // حتى لا يُقرأ آيدي الشخص المستهدف (عند كتابته خاماً بدل منشن) على أنه المبلغ
  function extractAmount(args) {
    for (const a of args) {
      if (/^\d{15,21}$/.test(a)) continue;
      const n = parseInt(a, 10); // 🛡️ [إصلاح] تحديد الأساس 10 يمنع تفسير "0x10" كـ 16
      if (!isNaN(n)) return n;
    }
    return null;
  }

  // 🟢 [إصلاح: مشكلة منشن الرد التلقائي] يحدد الهدف فقط من منشن صريح <@id> مكتوب
  // داخل نص الرسالة أو آيدي رقمي صريح ضمن الأرغيومنتس، ويتجاهل تماماً المنشن الذي
  // يضيفه ديسكورد تلقائياً عند عمل Reply على رسالة شخص (بدون كتابة منشنه فعلياً)
  async function resolveTargetMember(message, args) {
    for (const token of args) {
      const mentionMatch = token.match(/^<@!?(\d+)>$/);
      const id = mentionMatch ? mentionMatch[1] : (/^\d{15,21}$/.test(token) ? token : null);
      if (id) {
        const member = await message.guild.members.fetch(id).catch(() => null);
        if (member) return member;
      }
    }
    return null;
  }

  // تعريف الفترات المدعومة لأوامر الإضافة/السحب/التصفير
  const PERIODS = {
    total: { column: 'total_xp', label: '', suffix: '' },
    daily: { column: 'daily_xp', label: 'اليومي', suffix: '-يومي' },
    weekly: { column: 'weekly_xp', label: 'الأسبوعي', suffix: '-اسبوعي' },
    monthly: { column: 'monthly_xp', label: 'الشهري', suffix: '-شهري' }
  };

  // ==========================================================================
  // ⭐ نواة تغيير الإكسبي — مصدر واحد يستخدمه البريفكس (!اضافة-اكسبي)
  // وأمر السلاش (/xpmanage) حتى لا يختلف حسابهما أبداً.
  // تُرجع نص الرد فقط، ولا تعرف شيئاً عن الرسالة أو التفاعل.
  // ==========================================================================
  // نواة مشتركة لبناء إيمبد "معلوماتي" — يستخدمها !معلوماتي و /myinfo
  async function buildMyInfoEmbed(target) {
    const userRow = await getOrCreateUser(target.id);

    const archiveRes = await pool.query(`
      SELECT period_type, COUNT(*) AS times
      FROM xp_archive
      WHERE user_id = $1 AND rank = 1
      GROUP BY period_type;
    `, [target.id]);

    let dailyTopCount = 0, weeklyTopCount = 0, monthlyTopCount = 0;
    archiveRes.rows.forEach(row => {
      if (row.period_type === 'daily') dailyTopCount = Number(row.times);
      if (row.period_type === 'weekly') weeklyTopCount = Number(row.times);
      if (row.period_type === 'monthly') monthlyTopCount = Number(row.times);
    });

    const claimRes = await pool.query('SELECT * FROM claim_stats WHERE user_id = $1', [target.id]);
    const claimRow = claimRes.rows[0] || { admin_claims: 0, mediator_claims: 0 };

    return createXpEmbed(
      `📋 معلومات ${target.user.username}`,
      `**⭐ المستوى:** ${userRow.level}\n**⭐ الإكسبي الكلي:** ${Number(userRow.total_xp).toLocaleString()}\n\n` +
      `**🏆 مرات المركز الأول (توب يومي):** ${dailyTopCount}\n**🏆 مرات المركز الأول (توب أسبوعي):** ${weeklyTopCount}\n**🏆 مرات المركز الأول (توب شهري):** ${monthlyTopCount}\n\n` +
      `**📌 تذاكر مستلمة (إدارة):** ${Number(claimRow.admin_claims || 0)}\n**🤝 تذاكر مستلمة (وسطاء):** ${Number(claimRow.mediator_claims || 0)}`,
      '#0284c7'
    );
  }

  async function applyXpChange(guild, target, amount, periodKey, mode) {
    const period = PERIODS[periodKey];
    const isAdd = mode === 'add';
    await getOrCreateUser(target.id);

    if (periodKey === 'total') {
      const userRow = await getOrCreateUser(target.id);
      const newTotalXp = isAdd
        ? Number(userRow.total_xp) + amount
        : Math.max(0, Number(userRow.total_xp) - amount);
      const oldLevel = userRow.level;
      const newLevel = calculateLevel(newTotalXp);
      await pool.query(`UPDATE xp_users SET total_xp = $1, level = $2 WHERE user_id = $3;`, [newTotalXp, newLevel, target.id]);
      if (newLevel !== oldLevel) await syncLevelRewardRole(guild, target.id, newLevel);
    } else if (isAdd) {
      await pool.query(`UPDATE xp_users SET ${period.column} = ${period.column} + $1 WHERE user_id = $2;`, [amount, target.id]);
    } else {
      await pool.query(`UPDATE xp_users SET ${period.column} = GREATEST(0, ${period.column} - $1) WHERE user_id = $2;`, [amount, target.id]);
    }

    return isAdd
      ? `✅ تم إضافة **${amount}** إكسبي ${period.label} إلى ${target}`
      : `✅ تم سحب **${amount}** إكسبي ${period.label} من ${target}`;
  }

  async function handleAddXp(message, args, periodKey) {
    const allowed = await hasXpPermission(message.member);
    if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر الإكسبي.');

    const target = await resolveTargetMember(message, args);
    const amount = extractAmount(args);
    if (!target || amount === null || amount <= 0) return message.reply('⚠️ الاستخدام: `!اضافة-اكسبي' + PERIODS[periodKey].suffix + ' @شخص المبلغ`');

    return message.reply(await applyXpChange(message.guild, target, amount, periodKey, 'add'));
  }

  async function handleRemoveXp(message, args, periodKey) {
    const allowed = await hasXpPermission(message.member);
    if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر الإكسبي.');

    const target = await resolveTargetMember(message, args);
    const amount = extractAmount(args);
    if (!target || amount === null || amount <= 0) return message.reply('⚠️ الاستخدام: `!سحب-اكسبي' + PERIODS[periodKey].suffix + ' @شخص المبلغ`');

    return message.reply(await applyXpChange(message.guild, target, amount, periodKey, 'remove'));
  }

  // ------------------------------------------------------------------------
  // 7. الاستماع للأوامر
  // ------------------------------------------------------------------------
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || message.__slashCommandHandled || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // 🚦 أوامر الإكسبي العربية صارت سلاش فقط (/xpmanage · /myinfo).
    if (isPrefixBlocked(command)) {
      message.__slashCommandHandled = true;
      return;
    }

    try {
      // ===== الإكسبي الكلي (الإجمالي) =====
      if (command === 'اضافة-اكسبي') return handleAddXp(message, args, 'total');
      if (command === 'سحب-اكسبي') return handleRemoveXp(message, args, 'total');

      // ===== الإكسبي اليومي =====
      if (command === 'اضافة-اكسبي-يومي') return handleAddXp(message, args, 'daily');
      if (command === 'سحب-اكسبي-يومي') return handleRemoveXp(message, args, 'daily');

      // ===== الإكسبي الأسبوعي =====
      if (command === 'اضافة-اكسبي-اسبوعي') return handleAddXp(message, args, 'weekly');
      if (command === 'سحب-اكسبي-اسبوعي') return handleRemoveXp(message, args, 'weekly');

      // ===== الإكسبي الشهري =====
      if (command === 'اضافة-اكسبي-شهري') return handleAddXp(message, args, 'monthly');
      if (command === 'سحب-اكسبي-شهري') return handleRemoveXp(message, args, 'monthly');

      // ===== أمر معلوماتي: الإكسبي + مرات التصدر بالتوب + التذاكر المستلمة (إدارة/وسطاء) =====
      if (command === 'معلوماتي') {
        const target = (await resolveTargetMember(message, args)) || message.member;
        const embed = await buildMyInfoEmbed(target);
        return message.channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('❌ خطأ أثناء تنفيذ أمر إكسبي:', err);
      return message.reply('❌ حدث خطأ أثناء تنفيذ الأمر.').catch(() => {});
    }
  });

  // ==========================================================================
  // 8. صفحات الموقع (Dashboard) الخاصة بنظام الإكسبي — على نفس app الموجود
  // لا تلمس أي روت قديم بـ dashboard.js، فقط تضيف روتات جديدة بمسارات جديدة.
  // ==========================================================================
  if (app) {
    const dashboardAuth = require('./dashboardAuth');
    const escapeHtml = require('./htmlEscape');

    function requireAuthXp(req, res, next) {
      if (dashboardAuth.isAuthed(req)) return next();
      res.redirect('/login');
    }

    const pageWrapper = (title, body) => `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin:0; padding:0; }
          nav { background: #1e293b; padding: 15px 30px; display: flex; justify-content: space-between; align-items:center; border-bottom: 1px solid #334155; }
          nav .links a { color: #38bdf8; text-decoration: none; font-weight: bold; margin-left: 20px; }
          .container { max-width: 850px; margin: 40px auto; background: #1e293b; padding: 30px; border-radius: 12px; border: 1px solid #334155; }
          h1, h2 { color: #38bdf8; }
          label { display: block; margin-top: 15px; font-weight: bold; color:#cbd5e1; }
          input, select { width: 100%; padding: 10px; margin-top: 5px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; box-sizing: border-box; }
          button { margin-top: 25px; width: 100%; padding: 12px; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
          .item { background:#0f172a; padding:12px 15px; border-radius:8px; margin-bottom:10px; border:1px solid #334155; display:flex; justify-content:space-between; align-items:center; }
        </style>
      </head>
      <body>
        <nav>
          <div class="links">
            <a href="/dashboard">الرئيسية 🏠</a>
            <a href="/panel">التذاكر 🎫</a>
            <a href="/commands">الأوامر ⚙️</a>
            <a href="/xp-settings">إعدادات الإكسبي ⭐</a>
            <a href="/xp-rewards">رتب المكافأة 🎖️</a>
            <a href="/xp-archive">أرشيف التوب 🗂️</a>
            <a href="/auto-roles">الرتب التلقائية 🎭</a>
            <a href="/welcome-settings">الترحيب 👋</a>
          </div>
          <a href="/logout" style="color:#ef4444; font-weight:bold; text-decoration:none;">تسجيل الخروج 🚪</a>
        </nav>
        <div class="container">${body}</div>
      </body>
      </html>
    `;

    // صفحة إعدادات الإكسبي
    app.get('/xp-settings', requireAuthXp, async (req, res) => {
      const s = await getSettings();
      const saved = req.query.saved === '1';
      res.send(pageWrapper('إعدادات نظام الإكسبي', `
        <h1>⭐ إعدادات نظام الإكسبي</h1>
        ${saved ? '<div class="notice">✅ تم حفظ إعدادات الإكسبي بنجاح.</div>' : ''}
        <form action="/save-xp-settings" method="POST">
          <label>عدد الإكسبي لكل رسالة:</label>
          <input type="number" name="xpPerMessage" value="${escapeHtml(s.xp_per_message)}" min="0" required>

          <label>الكول داون بين كل رسالة تحسب إكسبي (بالثواني):</label>
          <input type="number" name="cooldownSeconds" value="${escapeHtml(s.cooldown_seconds)}" min="0" required>

          <label>آيدي رتبة إدارة أوامر الإكسبي (تُترك فارغة = المدراء فقط):</label>
          <input type="text" name="xpAdminRoleId" value="${escapeHtml(s.xp_admin_role_id || '')}">

          <label>آيدي روم رسائل اللفل أب (تُترك فارغة = نفس روم الرسالة):</label>
          <input type="text" name="levelupChannelId" value="${escapeHtml(s.levelup_channel_id || '')}">

          <label>ساعة تصفير التوب اليومي/الأسبوعي/الشهري (بتوقيت UTC، من 0 إلى 23):</label>
          <input type="number" name="resetHourUtc" value="${escapeHtml(s.reset_hour_utc)}" min="0" max="23" required>
          <p style="color:#94a3b8; font-size:13px; margin-top:5px;">مثال: إذا توقيتك UTC+3 وتبي التصفير الساعة 12 صباحاً بتوقيتك، ضع هنا 21 (منتصف الليل - 3). اليومي يتصفر كل يوم بهالساعة، والأسبوعي بأول يوم الأسبوع المختار تحت بهالساعة، والشهري أول كل شهر بهالساعة.</p>

          <label>يوم بداية الأسبوع (يوم تصفير التوب الأسبوعي):</label>
          <select name="resetDayOfWeek">
            <option value="0" ${Number(s.reset_day_of_week) === 0 ? 'selected' : ''}>الأحد</option>
            <option value="1" ${Number(s.reset_day_of_week) === 1 ? 'selected' : ''}>الاثنين</option>
            <option value="2" ${Number(s.reset_day_of_week) === 2 ? 'selected' : ''}>الثلاثاء</option>
            <option value="3" ${Number(s.reset_day_of_week) === 3 ? 'selected' : ''}>الأربعاء</option>
            <option value="4" ${Number(s.reset_day_of_week) === 4 ? 'selected' : ''}>الخميس</option>
            <option value="5" ${Number(s.reset_day_of_week) === 5 ? 'selected' : ''}>الجمعة</option>
            <option value="6" ${Number(s.reset_day_of_week) === 6 ? 'selected' : ''}>السبت</option>
          </select>

          <button type="submit">حفظ الإعدادات 💾</button>
        </form>
      `));
    });

    app.post('/save-xp-settings', requireAuthXp, async (req, res) => {
      const d = req.body;
      let resetHourUtc = parseInt(d.resetHourUtc);
      if (isNaN(resetHourUtc) || resetHourUtc < 0 || resetHourUtc > 23) resetHourUtc = 0;

      let resetDayOfWeek = parseInt(d.resetDayOfWeek);
      if (isNaN(resetDayOfWeek) || resetDayOfWeek < 0 || resetDayOfWeek > 6) resetDayOfWeek = 1;

      await pool.query(`
        UPDATE xp_settings SET
          xp_per_message = $1, cooldown_seconds = $2,
          xp_admin_role_id = $3, levelup_channel_id = $4, reset_hour_utc = $5, reset_day_of_week = $6
        WHERE key = 'main_xp';
      `, [
        // 🛡️ [إصلاح] قيمة سالبة كانت تُحفظ وتخصم إكسبي من الأعضاء مع كل رسالة
        Math.max(0, safeInteger(d.xpPerMessage, 0)),
        Math.max(0, safeInteger(d.cooldownSeconds, 0)),
        safeText(d.xpAdminRoleId),
        safeText(d.levelupChannelId),
        resetHourUtc,
        resetDayOfWeek
      ]);
      res.redirect('/xp-settings?saved=1');
    });

    // صفحة رتب المكافأة
    app.get('/xp-rewards', requireAuthXp, async (req, res) => {
      const rewardsRes = await pool.query('SELECT * FROM xp_level_rewards ORDER BY level ASC');
      let rewardsHTML = '';
      for (const r of rewardsRes.rows) {
        rewardsHTML += `
          <div class="item">
            <span>🎖️ المستوى <strong>${escapeHtml(r.level)}</strong> ← الرتبة: <code>${escapeHtml(r.role_id)}</code></span>
            <form method="POST" action="/delete-xp-reward/${escapeHtml(r.level)}" style="display:inline; margin:0;"><button type="submit" onclick="return confirm('هل أنت متأكد من حذف هذه المكافأة؟')" style="background:#ef4444; color:white; padding:6px 12px; border-radius:5px; font-weight:bold; border:none; cursor:pointer; font-family:inherit; font-size:inherit;">🗑️ حذف</button></form>
          </div>
        `;
      }

      res.send(pageWrapper('رتب مكافأة الإكسبي', `
        <h1>🎖️ رتب مكافأة المستويات</h1>
        <p style="color:#94a3b8;">عند وصول العضو لمستوى معين تُمنح له الرتبة المحددة تلقائياً (وتُسحب الرتبة السابقة الأقل).</p>
        ${rewardsHTML || '<p style="color:#94a3b8;">لا توجد رتب مكافأة مضافة بعد.</p>'}
        <hr style="margin:25px 0; border-color:#334155;">
        <h2>➕ إضافة رتبة مكافأة جديدة</h2>
        <form action="/add-xp-reward" method="POST">
          <label>المستوى المطلوب:</label>
          <input type="number" name="level" min="1" required>

          <label>آيدي الرتبة:</label>
          <input type="text" name="roleId" required>

          <button type="submit">إضافة 💾</button>
        </form>
      `));
    });

    app.post('/add-xp-reward', requireAuthXp, async (req, res) => {
      const { level, roleId } = req.body || {};

      // 🛡️ [إصلاح] مستوى غير رقمي كان ينتج NaN فيرفضه PostgreSQL
      // ويبقى الطلب معلقاً بلا رد نهائياً بدل إظهار رسالة واضحة.
      const levelNumber = safeInteger(level);
      if (levelNumber === null || levelNumber < 0) {
        return res.status(400).send('❌ رقم المستوى غير صالح! يجب أن يكون رقماً صحيحاً أكبر من أو يساوي 0.');
      }

      await pool.query(`
        INSERT INTO xp_level_rewards (level, role_id) VALUES ($1, $2)
        ON CONFLICT (level) DO UPDATE SET role_id = EXCLUDED.role_id;
      `, [levelNumber, safeText(roleId)]);
      res.redirect('/xp-rewards');
    });

    app.post('/delete-xp-reward/:level', requireAuthXp, async (req, res) => {
      // 🛡️ [إصلاح] نفس المشكلة: قيمة غير رقمية في الرابط كانت تُفشل الاستعلام
      const levelNumber = safeInteger(req.params.level);
      if (levelNumber === null) return res.status(400).send('❌ رقم المستوى غير صالح!');

      await pool.query('DELETE FROM xp_level_rewards WHERE level = $1', [levelNumber]);
      res.redirect('/xp-rewards');
    });

    // 🟢 صفحة عرض كل الأرشيف المتوفر فعلياً (يومي/أسبوعي/شهري) مع الأمر الجاهز لكل فترة
    app.get('/xp-archive', requireAuthXp, async (req, res) => {
      const archiveRes = await pool.query(`
        SELECT period_type, period_label, COUNT(*) AS members
        FROM xp_archive
        GROUP BY period_type, period_label
        ORDER BY period_type, period_label DESC;
      `);

      const groups = { daily: [], weekly: [], monthly: [] };
      archiveRes.rows.forEach(r => { if (groups[r.period_type]) groups[r.period_type].push(r); });

      function renderGroup(title, cmdTrigger, rows) {
        if (rows.length === 0) return `<h2>${title}</h2><p style="color:#94a3b8;">لا يوجد أرشيف بهذه الفترة بعد (لسا ما مرّ عليها تصفير كامل).</p>`;
        let html = `<h2>${title}</h2>`;
        rows.forEach(r => {
          html += `
            <div class="item">
              <span>📅 <strong>${escapeHtml(r.period_label)}</strong> — عدد الأعضاء بالأرشيف: ${escapeHtml(r.members)}</span>
              <code style="background:#0f172a; padding:6px 10px; border-radius:5px; user-select:all;">${escapeHtml(cmdTrigger + r.period_label)}</code>
            </div>
          `;
        });
        return html;
      }

      res.send(pageWrapper('أرشيف التوب', `
        <h1>🗂️ أرشيف التوب (يومي / أسبوعي / شهري)</h1>
        <p style="color:#94a3b8;">انسخ أمر السلاش المكتوب أمام أي فترة والصقه في أي روم بالسيرفر لعرض توب تلك الفترة بالضبط — بدل تخمين التاريخ. وإن لم يُنفَّذ عند اللصق، اكتب <code>/top</code> ثم اختر الفترة (اليومي · الأسبوعي · الشهري) واكتب التاريخ في خيار <code>archive</code>.</p>
        ${renderGroup('📆 الأرشيف اليومي', '/top period:اليومي archive:', groups.daily)}
        <hr style="margin:20px 0; border-color:#334155;">
        ${renderGroup('📆 الأرشيف الأسبوعي', '/top period:الأسبوعي archive:', groups.weekly)}
        <hr style="margin:20px 0; border-color:#334155;">
        ${renderGroup('📆 الأرشيف الشهري', '/top period:الشهري archive:', groups.monthly)}
      `));
    });
  }

  // ==========================================================================
  // ⭐ نسخ السلاش من أوامر الإكسبي (/xpmanage و /myinfo)
  // تجمع أوامر البريفكس الثمانية في أمر واحد بخيار "الفترة"، وتستخدم
  // نفس نواة applyXpChange حتى لا يختلف الحساب عن نسخة البريفكس.
  // ==========================================================================
  registerSystemSlashHandler('xpmanage', async (interaction) => {
    const say = (content) => interaction.replied || interaction.deferred
      ? interaction.followUp({ content, ephemeral: true }).catch(() => {})
      : interaction.reply({ content, ephemeral: true }).catch(() => {});

    const allowed = await hasXpPermission(interaction.member);
    if (!allowed) return say('❌ ليس لديك صلاحية استخدام أوامر الإكسبي.');

    const targetUser = interaction.options.getUser('member');
    const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!target) return say('❌ العضو غير موجود في هذا السيرفر.');

    const amount = interaction.options.getInteger('amount');
    if (!Number.isSafeInteger(amount) || amount <= 0) return say('⚠️ أدخل مقداراً صحيحاً أكبر من صفر.');

    const periodKey = interaction.options.getString('period') || 'total';
    if (!PERIODS[periodKey]) return say('⚠️ الفترة المحددة غير معروفة.');

    const mode = interaction.options.getSubcommand() === 'add' ? 'add' : 'remove';
    return say(await applyXpChange(interaction.guild, target, amount, periodKey, mode));
  });

  registerSystemSlashHandler('myinfo', async (interaction) => {
    const targetUser = interaction.options.getUser('member');
    const target = targetUser
      ? await interaction.guild.members.fetch(targetUser.id).catch(() => null)
      : interaction.member;
    if (!target) {
      return interaction.reply({ content: '❌ العضو غير موجود في هذا السيرفر.', ephemeral: true }).catch(() => {});
    }
    const embed = await buildMyInfoEmbed(target);
    return interaction.reply({ embeds: [embed] });
  });

  console.log('⭐ تم تحميل نظام الإكسبي والتوب بنجاح!');
};
// ==========================================================================
// 🔴 نهاية نظام الإكسبي والمستويات والتوب (xp.js)
// ==========================================================================
