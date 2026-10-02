// ==========================================================================
// 🟢 أوامر التحكم ببروفايلات استلام التذاكر (claimCommands.js) — ملف مستقل بالكامل
// لا يلمس أي جدول أو ملف قديم إطلاقاً: يستخدم فقط جدول claim_stats الموجود
// مسبقاً، ويربط عمود الصلاحية claim_role_id الموجود أصلاً بجدول permissions
// ولوحة التحكم (كان معدّاً مسبقاً بدون أي أمر يستخدمه فعلياً).
// ==========================================================================
const { getCommandControlConfig, resolveCommandControlAliasPhrase, COMMAND_CONTROL_DEFAULTS } = require('./commandConfig');
const { registerSystemSlashHandler } = require('./systemSlashBridge');

module.exports = function createClaimCommands(client, pool, helpers) {
  const { hasAdminCommandPermission, resolveExplicitTarget } = helpers;
  const PREFIX = '!';
  const ADMIN_PREFIX = '$';

  // أنواع الاستلام المدعومة: إداري / وسيط — كل نوع مرتبط بعمود مستقل بجدول claim_stats
  const TYPES = {
    'اداري': { column: 'admin_claims', label: 'إدارة' },
    'وسيط': { column: 'mediator_claims', label: 'وسطاء' }
  };

  async function getPerms() {
    const result = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions']);
    return result.rows[0] || {};
  }

  // نفس صلاحية claim_role_id الموجودة أصلاً بلوحة التحكم (بدون تعديلها)
  async function checkClaimPermission(member) {
    const perms = await getPerms();
    return hasAdminCommandPermission(member, perms.claim_role_id);
  }

  async function getOrCreateClaimRow(userId) {
    let res = await pool.query('SELECT * FROM claim_stats WHERE user_id = $1', [userId]);
    if (res.rows[0]) return res.rows[0];
    await pool.query(`INSERT INTO claim_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;`, [userId]);
    res = await pool.query('SELECT * FROM claim_stats WHERE user_id = $1', [userId]);
    return res.rows[0];
  }

  async function resolveTargetMember(message, args) {
    return resolveExplicitTarget(message.guild, args);
  }

  // 🟢 [إصلاح: تعارض المبلغ مع آيدي الهدف] يتجاهل أي رمز هو آيدي رقمي صريح (15-21 رقم)
  // حتى لا يُقرأ آيدي الشخص المستهدف (عند كتابته خاماً بدل منشن) على أنه العدد
  function extractAmount(args) {
    for (const a of args) {
      if (/^\d{15,21}$/.test(a)) continue;
      const n = parseInt(a, 10); // 🛡️ [إصلاح] تحديد الأساس 10 يمنع تفسير "0x10" كـ 16
      if (!isNaN(n) && n > 0) return n;
    }
    return null;
  }

  const claimCommandNames = new Set([
    'اضافة-استلام-اداري', 'سحب-استلام-اداري', 'تصفير-استلام-اداري', 'تصفير-الكل-استلام-اداري',
    'اضافة-استلام-وسيط', 'سحب-استلام-وسيط', 'تصفير-استلام-وسيط', 'تصفير-الكل-استلام-وسيط',
    'تصفير-استلام', 'تصفير-الكل-استلام'
  ]);

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    // 🔓 «!» و«$» سواء: سجل الاستلام من أوامر التذكرة التي تعمل بالبريفكسين.
    const claimText = message.content.trim();
    const claimPrefix = (claimText[0] === PREFIX || claimText[0] === ADMIN_PREFIX) ? claimText[0] : '';
    const hasPrefix = Boolean(claimPrefix);
    let controlConfig = COMMAND_CONTROL_DEFAULTS;
    try { controlConfig = await getCommandControlConfig(pool); } catch (err) {
      console.error('❌ تعذر تحميل إعدادات أوامر سجل الاستلام:', err);
    }
    const commandText = hasPrefix ? claimText.slice(1).trim() : claimText;
    const commandWords = commandText.split(/ +/).filter(Boolean);
    const requestedCommand = (commandWords[0] || '').toLowerCase();
    // 🔓 اختصار المالك قد يكون أكثر من كلمة — نطابق أطول صيغة أولاً.
    const claimAliasMatch = resolveCommandControlAliasPhrase(commandWords, controlConfig);
    const aliasTarget = claimAliasMatch ? claimAliasMatch.target : null;
    const command = aliasTarget || requestedCommand;
    if (!claimCommandNames.has(command) || (!hasPrefix && !aliasTarget)) return;
    if (!controlConfig.claim.enabled) return;
    const args = commandWords.slice(claimAliasMatch ? claimAliasMatch.words : 1);

    try {
      // ===== أوامر خاصة بنوع محدد (إداري / وسيط) =====
      for (const typeKey of Object.keys(TYPES)) {
        const type = TYPES[typeKey];

        // إضافة استلام يدوياً لشخص (مثال: !اضافة-استلام-اداري @شخص [العدد])
        if (command === `اضافة-استلام-${typeKey}`) {
          const allowed = await checkClaimPermission(message.member);
          if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر التحكم بالاستلام.');

          const target = await resolveTargetMember(message, args);
          if (!target) return message.reply(`⚠️ الاستخدام: \`!اضافة-استلام-${typeKey} @شخص [العدد]\``);
          const amount = extractAmount(args) || 1;

          await getOrCreateClaimRow(target.id);
          await pool.query(`UPDATE claim_stats SET ${type.column} = ${type.column} + $1 WHERE user_id = $2;`, [amount, target.id]);
          return message.reply(`✅ تم إضافة **${amount}** تذكرة مستلمة (${type.label}) إلى ${target}`);
        }

        // سحب استلام يدوياً من شخص (مثال: !سحب-استلام-وسيط @شخص [العدد])
        if (command === `سحب-استلام-${typeKey}`) {
          const allowed = await checkClaimPermission(message.member);
          if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر التحكم بالاستلام.');

          const target = await resolveTargetMember(message, args);
          if (!target) return message.reply(`⚠️ الاستخدام: \`!سحب-استلام-${typeKey} @شخص [العدد]\``);
          const amount = extractAmount(args) || 1;

          await getOrCreateClaimRow(target.id);
          await pool.query(`UPDATE claim_stats SET ${type.column} = GREATEST(0, ${type.column} - $1) WHERE user_id = $2;`, [amount, target.id]);
          return message.reply(`✅ تم سحب **${amount}** تذكرة مستلمة (${type.label}) من ${target}`);
        }

        // تصفير استلام شخص واحد لنوع محدد (مثال: !تصفير-استلام-اداري @شخص)
        if (command === `تصفير-استلام-${typeKey}`) {
          const allowed = await checkClaimPermission(message.member);
          if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر التحكم بالاستلام.');

          const target = await resolveTargetMember(message, args);
          if (!target) return message.reply('⚠️ يرجى منشن الشخص أو وضع آيديه.');

          await getOrCreateClaimRow(target.id);
          await pool.query(`UPDATE claim_stats SET ${type.column} = 0 WHERE user_id = $1;`, [target.id]);
          return message.reply(`🗑️ تم تصفير التذاكر المستلمة (${type.label}) الخاصة بـ ${target}`);
        }

        // تصفير استلام كل الأعضاء لنوع محدد (مثال: !تصفير-الكل-استلام-وسيط)
        if (command === `تصفير-الكل-استلام-${typeKey}`) {
          const allowed = await checkClaimPermission(message.member);
          if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر التحكم بالاستلام.');

          await pool.query(`UPDATE claim_stats SET ${type.column} = 0;`);
          return message.reply(`🗑️ تم تصفير التذاكر المستلمة (${type.label}) لكافة الأعضاء.`);
        }
      }

      // ===== أوامر شاملة (إدارة + وسطاء معاً) =====

      // تصفير كامل بروفايل الاستلام لشخص واحد (إدارة ووسطاء معاً)
      if (command === 'تصفير-استلام') {
        const allowed = await checkClaimPermission(message.member);
        if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر التحكم بالاستلام.');

        const target = await resolveTargetMember(message, args);
        if (!target) return message.reply('⚠️ يرجى منشن الشخص أو وضع آيديه.');

        await getOrCreateClaimRow(target.id);
        await pool.query(`UPDATE claim_stats SET admin_claims = 0, mediator_claims = 0 WHERE user_id = $1;`, [target.id]);
        return message.reply(`🗑️ تم تصفير كافة التذاكر المستلمة (إدارة + وسطاء) الخاصة بـ ${target}`);
      }

      // تصفير بروفايلات الاستلام لكل الأعضاء (إدارة ووسطاء معاً)
      if (command === 'تصفير-الكل-استلام') {
        const allowed = await checkClaimPermission(message.member);
        if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام أوامر التحكم بالاستلام.');

        await pool.query(`UPDATE claim_stats SET admin_claims = 0, mediator_claims = 0;`);
        return message.reply('🗑️ تم تصفير كافة التذاكر المستلمة (إدارة + وسطاء) لجميع الأعضاء.');
      }
    } catch (err) {
      console.error('❌ خطأ أثناء تنفيذ أمر التحكم بالاستلام:', err);
      return message.reply('❌ حدث خطأ أثناء تنفيذ الأمر.').catch(() => {});
    }
  });

  // ==========================================================================
  // 📋 نسخة السلاش من أوامر سجل الاستلام (/claimstats)
  // تجمع أوامر البريفكس العشرة في أمر واحد بأربعة أوامر فرعية وخيار "النوع"،
  // مع إبقاء المنطق والصلاحية (claim_role_id) في هذا الملف دون تكرار.
  // ==========================================================================
  registerSystemSlashHandler('claimstats', async (interaction) => {
    const say = (content) => interaction.replied || interaction.deferred
      ? interaction.followUp({ content, ephemeral: true }).catch(() => {})
      : interaction.reply({ content, ephemeral: true }).catch(() => {});

    // نفس بوابة التفعيل المستخدمة في نسخة البريفكس
    let controlConfig = COMMAND_CONTROL_DEFAULTS;
    try { controlConfig = await getCommandControlConfig(pool); } catch (err) {
      console.error('❌ تعذر تحميل إعدادات أوامر سجل الاستلام:', err);
    }
    if (!controlConfig.claim.enabled) return say('⛔ أوامر سجل الاستلام متوقفة حالياً من لوحة التحكم.');

    const allowed = await checkClaimPermission(interaction.member);
    if (!allowed) return say('❌ ليس لديك صلاحية استخدام أوامر التحكم بالاستلام.');

    const sub = interaction.options.getSubcommand();
    // خيار السلاش يستخدم قيماً لاتينية؛ نحوّلها لنفس مفاتيح TYPES العربية
    const typeKeyByValue = { admin: 'اداري', mediator: 'وسيط' };
    const selectedType = interaction.options.getString('type');

    if (sub === 'add' || sub === 'remove') {
      const type = TYPES[typeKeyByValue[selectedType]];
      const targetUser = interaction.options.getUser('member');
      const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!target) return say('❌ العضو غير موجود في هذا السيرفر.');
      const amount = interaction.options.getInteger('amount') || 1;

      await getOrCreateClaimRow(target.id);
      if (sub === 'add') {
        await pool.query(`UPDATE claim_stats SET ${type.column} = ${type.column} + $1 WHERE user_id = $2;`, [amount, target.id]);
        return say(`✅ تم إضافة **${amount}** تذكرة مستلمة (${type.label}) إلى <@${target.id}>`);
      }
      await pool.query(`UPDATE claim_stats SET ${type.column} = GREATEST(0, ${type.column} - $1) WHERE user_id = $2;`, [amount, target.id]);
      return say(`✅ تم سحب **${amount}** تذكرة مستلمة (${type.label}) من <@${target.id}>`);
    }

    // reset / resetall — بدون تحديد نوع يُصفَّر النوعان معاً (مثل !تصفير-استلام)
    const scope = selectedType || 'both';

    if (sub === 'reset') {
      const targetUser = interaction.options.getUser('member');
      const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!target) return say('❌ العضو غير موجود في هذا السيرفر.');
      await getOrCreateClaimRow(target.id);

      if (scope === 'both') {
        await pool.query('UPDATE claim_stats SET admin_claims = 0, mediator_claims = 0 WHERE user_id = $1;', [target.id]);
        return say(`🗑️ تم تصفير كافة التذاكر المستلمة (إدارة + وسطاء) الخاصة بـ <@${target.id}>`);
      }
      const type = TYPES[typeKeyByValue[scope]];
      await pool.query(`UPDATE claim_stats SET ${type.column} = 0 WHERE user_id = $1;`, [target.id]);
      return say(`🗑️ تم تصفير التذاكر المستلمة (${type.label}) الخاصة بـ <@${target.id}>`);
    }

    // resetall
    if (scope === 'both') {
      await pool.query('UPDATE claim_stats SET admin_claims = 0, mediator_claims = 0;');
      return say('🗑️ تم تصفير كافة التذاكر المستلمة (إدارة + وسطاء) لجميع الأعضاء.');
    }
    const type = TYPES[typeKeyByValue[scope]];
    await pool.query(`UPDATE claim_stats SET ${type.column} = 0;`);
    return say(`🗑️ تم تصفير التذاكر المستلمة (${type.label}) لكافة الأعضاء.`);
  });
};
