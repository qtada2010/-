const { 
  EmbedBuilder, 
  PermissionFlagsBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder,
  REST,
  Routes
} = require('discord.js');
const state = require('./state');
const {
  getCommandControlConfig,
  resolveCommandControlAliasPhrase,
  COMMAND_CONTROL_DEFAULTS
} = require('./commandConfig');
const getDashboardUrl = require('./dashboardUrl');
const { registerSystemSlashHandler } = require('./systemSlashBridge');
const { isPrefixBlocked } = require('./prefixPolicy');
const { sortByName } = require('./commandSorting');
const { parseStoredJson } = require('./storedJson');

// مصفوفات لحفظ أرقام/آيديهات القنوات في الذاكرة (وتُحمَّل من قاعدة البيانات عند تشغيل البوت — مشكلة 13)
let suggestionsChannelIds = new Set(); // دعم أكثر من روم للاقتراحات
let taxChannelIds = new Set();        // دعم رومات حاسبة الضريبة

// ==========================================================================
// 🟢 [إصلاح: مشكلة 13] استمرارية الإعدادات وأصوات الاقتراحات عبر قاعدة البيانات
// بدل فقدانها عند كل إعادة تشغيل. لا تُغيّر أي سلوك أثناء عمل البوت، فقط تحفظ
// وتستعيد نفس القيم التي كانت تُحفَظ بالذاكرة سابقاً.
// ==========================================================================
async function saveBotSetting(pool, key, value) {
  try {
    await pool.query(
      `INSERT INTO bot_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb;`,
      [key, JSON.stringify(value)]
    );
  } catch (err) {
    console.error('❌ خطأ أثناء حفظ الإعداد', key, err);
  }
}

async function loadPersistedSystemSettings(pool) {
  try {
    // دفاعياً (احتياطاً لو تأخر إنشاء الجداول في database.js)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key VARCHAR(50) PRIMARY KEY,
        value JSONB NOT NULL
      );
    `);

    const res = await pool.query(
      `SELECT key, value FROM bot_settings WHERE key IN ('tax_channel_ids', 'suggestions_channel_ids', 'owner_log_channel_id');`
    );
    for (const row of res.rows) {
      // parseStoredJson: قاعدة قديمة تُرجع القيمة نصاً (عمود TEXT)؛ وبلا تحويلها
      // يتحول النص إلى مجموعة أحرف بدل مصفوفة آيديات فتبدو الرومات غير محفوظة.
      const value = parseStoredJson(row.value);
      if (row.key === 'tax_channel_ids') taxChannelIds = new Set(value || []);
      else if (row.key === 'suggestions_channel_ids') suggestionsChannelIds = new Set(value || []);
      else if (row.key === 'owner_log_channel_id' && value) state.ownerLogChannelId = value;
    }
  } catch (err) {
    console.error('❌ خطأ أثناء تحميل الإعدادات المحفوظة:', err);
  }
}

// دالة تحويل الاختصارات مثل (1m, 1k, 1b) إلى أرقام
function parseAmount(input) {
  if (!input) return null;
  const str = input.toLowerCase().trim();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!match) return null;

  let num = parseFloat(match[1]);
  const unit = match[2];

  if (unit === 'k') num *= 1_000;
  if (unit === 'm') num *= 1_000_000;
  if (unit === 'b') num *= 1_000_000_000;

  return Math.floor(num);
}

const { ADMIN_PREFIX } = require('./discordClient');

module.exports = function(client, PREFIX = '!', pool) {

  loadPersistedSystemSettings(pool); // تحميل الإعدادات المحفوظة عند تشغيل البوت (لا يوقف بقية الإعداد، غير حرج التوقيت)

  async function getPermissions() {
    const result = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions']);
    return result.rows[0] || {};
  }

  // 🟢 [إصلاح: دعم أكثر من رتبة لكل صلاحية] يفكك النص المخزّن (قد يحتوي أكثر من آيدي
  // رتبة مفصولة بفاصلة ,) ويتحقق إن كان العضو يملك أياً منها
  function hasAnyOfRoles(member, rolesString) {
    if (!rolesString) return false;
    return String(rolesString).split(',').map(id => id.trim()).filter(Boolean).some(id => member.roles.cache.has(id));
  }

  async function hasCommandPermission(member, roleColumn, discordPerm) {
    const perms = await getPermissions();

    if (hasAnyOfRoles(member, perms[roleColumn])) {
      return true;
    }

    if (hasAnyOfRoles(member, perms.all_commands_role_id)) {
      return true;
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

    if (discordPerm && member.permissions.has(discordPerm)) {
      return true;
    }

    return false;
  }

  // ==========================================================================
  // 🟢 [إضافة] حفظ آخر حالة/نوت مختارة للبوت بقاعدة البيانات، حتى ترجع تلقائياً
  // بعد أي إعادة تشغيل للبوت بدل ما تختفي (كانت تُطبَّق فقط عبر setPresence
  // بالذاكرة الحية بدون أي تخزين، فتختفي عند أي ريستارت).
  // ==========================================================================
  async function initBotStatusTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bot_status_state (
          key VARCHAR(50) PRIMARY KEY,
          note_text TEXT DEFAULT '',
          presence_status VARCHAR(20) DEFAULT 'online'
        );
      `);

      await pool.query(`
        INSERT INTO bot_status_state (key) VALUES ('main_status')
        ON CONFLICT (key) DO NOTHING;
      `);

      console.log('🔧 تم تجهيز جدول حفظ حالة/نوت البوت بنجاح!');
    } catch (err) {
      console.error('❌ خطأ أثناء إنشاء جدول حالة/نوت البوت:', err);
    }
  }
  initBotStatusTable();

  async function getBotStatusState() {
    const res = await pool.query('SELECT * FROM bot_status_state WHERE key = $1', ['main_status']);
    return res.rows[0] || { note_text: '', presence_status: 'online' };
  }

  // presenceStatus = null يعني: احتفظ بنفس حالة الأونلاين المخزَّنة سابقاً وغيّر النص فقط
  async function saveBotStatusState(noteText, presenceStatus) {
    await pool.query(`
      UPDATE bot_status_state SET note_text = $1, presence_status = COALESCE($2, presence_status)
      WHERE key = 'main_status';
    `, [noteText, presenceStatus]);
  }

  // 🟢 [إضافة] إعادة تطبيق آخر حالة/نوت محفوظة تلقائياً فور اتصال البوت بديسكورد
  // من جديد (بعد أي ريستارت/كراش/تحديث استضافة)، بدل ما يرجع بدون نوت.
  client.once('ready', async () => {
    try {
      const saved = await getBotStatusState();
      if (saved && saved.note_text) {
        await client.user.setPresence({
          activities: [{ name: saved.note_text, type: 4, state: saved.note_text }],
          status: saved.presence_status || 'online'
        });
        console.log('🔁 تم استرجاع آخر حالة/نوت محفوظة للبوت بنجاح!');
      }
    } catch (err) {
      console.error('❌ خطأ أثناء استرجاع حالة/نوت البوت المحفوظة:', err);
    }
  });

  // 🟢 [إصلاح: مشكلة منشن الرد التلقائي] يحدد الهدف فقط من منشن صريح <@id> مكتوب
  // داخل نص الرسالة أو آيدي رقمي صريح ضمن الأرغيومنتس، ويتجاهل تماماً المنشن الذي
  // يضيفه ديسكورد تلقائياً عند عمل Reply على رسالة شخص (بدون كتابة منشنه فعلياً)،
  // لمنع تنفيذ الأوامر (مثل !ban) على الشخص المردود عليه بالغلط
  async function resolveExplicitTarget(guild, args) {
    for (const token of args) {
      const mentionMatch = token.match(/^<@!?(\d+)>$/);
      const id = mentionMatch ? mentionMatch[1] : (/^\d{15,21}$/.test(token) ? token : null);
      if (id) {
        const member = await guild.members.fetch(id).catch(() => null);
        if (member) return member;
      }
    }
    return null;
  }



  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild || message.__slashCommandHandled) return;
    // 🔓 (2026-10-02) يقبل «!» و«$» معاً: اختصار المالك يعمل بأي بريفكس،
    // بينما الأسماء الرسمية تبقى ممنوعة بالبريفكس (سلاش فقط) كما هي.
    const messageText = message.content.trim();
    const prefixChar = (messageText[0] === PREFIX || messageText[0] === ADMIN_PREFIX) ? messageText[0] : '';
    const hasSystemCommandPrefix = Boolean(prefixChar);
    let controlConfig = COMMAND_CONTROL_DEFAULTS;
    try {
      controlConfig = await getCommandControlConfig(pool);
    } catch (err) {
      console.error('❌ تعذر تحميل إعدادات أوامر النظام:', err);
    }
    const systemCommandText = prefixChar ? messageText.slice(1).trim() : messageText;
    const systemCommandWords = systemCommandText.split(/ +/).filter(Boolean);
    const requestedSystemCommand = (systemCommandWords[0] || '').toLowerCase();
    // 🔓 اختصار المالك قد يكون أكثر من كلمة («رول عام») — نطابق أطول صيغة أولاً.
    const controlAliasMatch = resolveCommandControlAliasPhrase(systemCommandWords, controlConfig);
    const aliasTarget = controlAliasMatch ? controlAliasMatch.target : null;
    const resolvedCommand = aliasTarget || requestedSystemCommand;
    const commandArguments = systemCommandWords.slice(controlAliasMatch ? controlAliasMatch.words : 1);
    const hasSystemCommand = hasSystemCommandPrefix || !!aliasTarget;
    // 🚦 سياسة البريفكس: أوامر النظام صارت سلاش فقط (تبقى أوامر التذكرة والاستلام بالبريفكس).
    // ⚠️ لا تُطبَّق على اختصار كتبه المالك بنفسه: الاسم الرسمي وحده هو الممنوع بالبريفكس.
    if (hasSystemCommandPrefix && !aliasTarget && isPrefixBlocked(resolvedCommand)) {
      message.__slashCommandHandled = true;
      return;
    }
    if (['اضافة', 'add', 'كتابة', 'write'].includes(resolvedCommand) && !controlConfig.channelAccess.enabled) return;
    if ((resolvedCommand === 'ضريبة' || resolvedCommand === 'tax-channel') && !controlConfig.taxChannel.enabled) return;
    if ((resolvedCommand === 'اقتراحات' || resolvedCommand === 'set-suggestions') && !controlConfig.suggestions.enabled) return;
    if (resolvedCommand === 'r' && !controlConfig.renameChannel.enabled) return;
    if (resolvedCommand === 'رول' && !controlConfig.roleToggle.enabled) return;
    if (['الحالة', 'status', 'الحالة2', 'status2'].includes(resolvedCommand) && !controlConfig.status.enabled) return;

    // =================================================================
    // 🟢 [بداية أمر: إضافة عضو/رول لمشاهدة الروم (!اضافة)]
    // =================================================================
    if (hasSystemCommand) {
      const args = commandArguments.slice();
      const command = resolvedCommand;

      if (command === 'اضافة' || command === 'add') {
        // 🟢 [إصلاح: مشكلة 14] تجاهل الأمر داخل قنوات التذاكر — لها معالج مخصص في messageCreate.js
        // (بدون هذا الفحص كان يعمل المعالِجان معاً فيصدر ردّان مختلفان لكل استخدام داخل تذكرة)
        let ticketDataCheck = null;
        if (message.channel.topic) {
          try { ticketDataCheck = JSON.parse(message.channel.topic); } catch (e) { ticketDataCheck = null; }
        }
        if (ticketDataCheck) return;

        const allowed = await hasCommandPermission(message.member, 'add_view_role_id', PermissionFlagsBits.ManageChannels);
        if (!allowed) {
          return message.reply('❌ ليس لديك صلاحية إدارة القنوات لاستخدام هذا الأمر.');
        }

        const targetMember = await resolveExplicitTarget(message.guild, args);
        const targetRole = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);

        if (targetMember) {
          await message.channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true });
          return message.reply(`👁️ تم منح **${targetMember.user.tag}** صلاحية رؤية الروم بنجاح!`);
        } else if (targetRole) {
          await message.channel.permissionOverwrites.edit(targetRole.id, { ViewChannel: true });
          return message.reply(`👁️ تم منح رول **${targetRole.name}** صلاحية رؤية الروم بنجاح!`);
        } else {
          return message.reply('⚠️ يرجى منشن عضو/رول أو كتابة الآيدي الخاص به، أو استخدم `/channel view` من قائمة السلاش.');
        }
      }
    }
    // =================================================================
    // 🔴 [نهاية أمر: إضافة عضو/رول لمشاهدة الروم (!اضافة)]
    // =================================================================
    // =================================================================
    // 🟢 [بداية أمر: إعطاء صلاحية الكتابة لعضو/رول (!كتابة)]
    // =================================================================
    if (hasSystemCommand) {
      const args = commandArguments.slice();
      const command = resolvedCommand;

      if (command === 'كتابة' || command === 'write') {
        const allowed = await hasCommandPermission(message.member, 'write_role_id', PermissionFlagsBits.ManageChannels);
        if (!allowed) {
          return message.reply('❌ ليس لديك صلاحية إدارة القنوات لاستخدام هذا الأمر.');
        }

        const targetMember = await resolveExplicitTarget(message.guild, args);
        const targetRole = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);

        if (targetMember) {
          await message.channel.permissionOverwrites.edit(targetMember.id, { SendMessages: true });
          return message.reply(`✍️ تم منح **${targetMember.user.tag}** صلاحية الكتابة بالروم بنجاح!`);
        } else if (targetRole) {
          await message.channel.permissionOverwrites.edit(targetRole.id, { SendMessages: true });
          return message.reply(`✍️ تم منح رول **${targetRole.name}** صلاحية الكتابة بالروم بنجاح!`);
        } else {
          return message.reply('⚠️ يرجى منشن عضو/رول أو كتابة الآيدي الخاص به، أو استخدم `/channel write` من قائمة السلاش.');
        }
      }
    }
    // =================================================================
    // 🔴 [نهاية أمر: إعطاء صلاحية الكتابة لعضو/رول (!كتابة)]
    // =================================================================


    // =================================================================
    // 🟢 [بداية أمر: حاسبة ضريبة بروبوت التلقائية (!ضريبة / !tax)]
    // =================================================================
    if (hasSystemCommand) {
      const args = commandArguments.slice();
      const command = resolvedCommand;

      if (command === 'ضريبة' || command === 'tax-channel') {
        const allowed = await hasCommandPermission(message.member, 'tax_channel_role_id', PermissionFlagsBits.ManageChannels);
        if (!allowed) {
          return message.reply('❌ ليس لديك صلاحية لتحديد رومات الضريبة.');
        }

        const targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]) || message.channel;

        if (taxChannelIds.has(targetChannel.id)) {
          taxChannelIds.delete(targetChannel.id);
          await saveBotSetting(pool, 'tax_channel_ids', [...taxChannelIds]);
          return message.reply(`🗑️ تم إزالة ${targetChannel} من قائمة رومات حاسبة الضريبة.`);
        } else {
          taxChannelIds.add(targetChannel.id);
          await saveBotSetting(pool, 'tax_channel_ids', [...taxChannelIds]);
          return message.reply(`✅ تم إضافة ${targetChannel} كروم رسمي لحاسبة ضريبة بروبوت!`);
        }
      }
    }

    if (taxChannelIds.has(message.channel.id)) {
      const amount = parseAmount(message.content);

      if (amount && amount > 0) {
        const tax = Math.floor(amount * (20 / 19) + 1);
        const taxOnly = tax - amount;

        const taxEmbed = new EmbedBuilder()
          .setTitle('💰 حاسبة ضريبة ProBot')
          .setColor('#22c55e')
          .addFields(
            { name: '💵 المبلغ المطلوب:', value: `\`${amount.toLocaleString()}\``, inline: true },
            { name: '💳 المبلغ مع الضريبة (الكامل):', value: `\`${tax.toLocaleString()}\``, inline: true },
            { name: '📊 مقدار الضريبة (5%):', value: `\`${taxOnly.toLocaleString()}\``, inline: false }
          )
          .setFooter({ text: '💡 يمكنك كتابة اختصارات مثل: 1k, 5m, 1b' })
          .setTimestamp();

        await message.reply({ embeds: [taxEmbed] });
      }
    }
    // =================================================================
    // 🔴 [نهاية أمر: حاسبة ضريبة بروبوت التلقائية (!ضريبة / !tax)]
    // =================================================================


    // =================================================================
    // 🟢 [بداية أمر: الاقتراحات المطور - متعدد الرومات (!اقتراحات)]
    // =================================================================
    if (hasSystemCommand) {
      const args = commandArguments.slice();
      const command = resolvedCommand;

      if (command === 'اقتراحات' || command === 'set-suggestions') {
        const allowed = await hasCommandPermission(message.member, 'suggestions_role_id', PermissionFlagsBits.ManageChannels);
        if (!allowed) {
          return message.reply('❌ ليس لديك صلاحية لتحديد رومات الاقتراحات.');
        }

        const targetChannel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]) || message.channel;

        if (suggestionsChannelIds.has(targetChannel.id)) {
          suggestionsChannelIds.delete(targetChannel.id);
          await saveBotSetting(pool, 'suggestions_channel_ids', [...suggestionsChannelIds]);
          return message.reply(`🗑️ تم إزالة ${targetChannel} من قائمة رومات الاقتراحات.`);
        } else {
          suggestionsChannelIds.add(targetChannel.id);
          await saveBotSetting(pool, 'suggestions_channel_ids', [...suggestionsChannelIds]);
          return message.reply(`✅ تم إضافة ${targetChannel} كروم رسمي للاقتراحات بنجاح!`);
        }
      }
    }

    if (!hasSystemCommand && suggestionsChannelIds.has(message.channel.id)) {
      await message.delete().catch(() => {});

      const suggestionEmbed = new EmbedBuilder()
        .setAuthor({ name: `اقتراح بواسطة: ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
        .setDescription(message.content)
        .setColor('#5f0ae8')
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: '💡 شارك برأيك حول هذا الاقتراح عبر الأزرار بالأسفل' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('suggest_yes').setLabel('0').setEmoji('👍').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('suggest_no').setLabel('0').setEmoji('👎').setStyle(ButtonStyle.Danger)
      );

      const sentMsg = await message.channel.send({ embeds: [suggestionEmbed], components: [row] });
      await client.suggestionVotes.set(sentMsg.id, { yes: new Set(), no: new Set() });
    }
    // =================================================================
    // 🔴 [نهاية أمر: الاقتراحات المطور - متعدد الرومات (!اقتراحات)]
    // =================================================================


    if (!hasSystemCommand) return;
    const args = commandArguments.slice();
    const command = resolvedCommand;


    // =================================================================
    // 🟢 [بداية أمر: تبديل رتبة تلقائياً (!رول) — إعطاء إذا لم تكن معه، وسحب إذا كانت معه]
    // =================================================================
    if (command === 'رول') {
      const allowed = await hasCommandPermission(message.member, 'role_toggle_role_id', PermissionFlagsBits.ManageRoles);
      if (!allowed) return message.reply('❌ ليس لديك صلاحية استخدام هذا الأمر.');

      const target = await resolveExplicitTarget(message.guild, args);
      if (!target)
        return message.reply('⚠️ يرجى منشن العضو.');

      const role =
        message.mentions.roles.first() ||
        message.guild.roles.cache.get(args[1]) ||
        message.guild.roles.cache.find(r => r.name === args.slice(1).join(' '));

      if (!role)
        return message.reply('⚠️ لم يتم العثور على الرتبة.');

      if (!role.editable)
        return message.reply('❌ لا أستطيع التحكم بهذه الرتبة.');

      // 🔒 منع إعطاء/سحب رتبة أعلى من رتبة الشخص المستخدم للأمر نفسه أو مساوية لها (ما عدا صاحب السيرفر)
      if (message.author.id !== message.guild.ownerId && role.position >= message.member.roles.highest.position)
        return message.reply('❌ لا يمكنك التحكم برتبة أعلى من رتبتك أو مساوية لها.');

      if (target.roles.cache.has(role.id)) {
        await target.roles.remove(role);
        message.channel.send(`✅ تم سحب رتبة **${role.name}** من **${target.user.tag}** (كانت معه مسبقاً).`);
      } else {
        await target.roles.add(role);
        message.channel.send(`✅ تم إعطاء رتبة **${role.name}** إلى **${target.user.tag}**.`);
      }
    }
    // =================================================================
    // 🔴 [نهاية أمر: تبديل رتبة تلقائياً (!رول)]
    // =================================================================

    
    // =================================================================
    // 🟢 [بداية أمر: تغيير اسم الروم (!r)]
    // =================================================================
    if (command === 'r') {
      const allowed = await hasCommandPermission(message.member, 'rename_role_id', PermissionFlagsBits.ManageChannels);
      if (!allowed) return message.reply('❌ ليس لديك صلاحية تغيير اسم الروم.');
      const newName = args.join('-');
      if (!newName) return message.reply('⚠️ اكتب الاسم الجديد للروم.');
      await message.channel.setName(newName);
      message.channel.send(`🏷️ تم تغيير اسم الروم إلى: **${newName}**`);
    }
    // =================================================================
    // 🔴 [نهاية أمر: تغيير اسم الروم (!r)]
    // =================================================================

  });


  // =================================================================
  // 🟢 [بداية تفاعلات أزرار الاقتراحات]
  // =================================================================
  if (!client.suggestionVotes) client.suggestionVotes = new Map();

  // 🟢 [إصلاح: مشكلة 13] دفاعياً (احتياطاً لو تأخر إنشاء الجدول في database.js)
  pool.query(`
    CREATE TABLE IF NOT EXISTS suggestion_votes (
      message_id VARCHAR(30) PRIMARY KEY,
      yes_ids JSONB NOT NULL DEFAULT '[]',
      no_ids JSONB NOT NULL DEFAULT '[]'
    );
  `).catch(err => console.error('❌ خطأ أثناء إنشاء جدول أصوات الاقتراحات:', err));

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'suggest_yes' && interaction.customId !== 'suggest_no') return;

    const message = interaction.message;
    const userId = interaction.user.id;

    if (!client.suggestionVotes.has(message.id)) {
      // لم يُصوَّت على هذه الرسالة منذ إعادة تشغيل البوت — نحاول استعادة الأصوات القديمة من قاعدة البيانات
      let restored = { yes: new Set(), no: new Set() };
      try {
        const res = await pool.query('SELECT yes_ids, no_ids FROM suggestion_votes WHERE message_id = $1;', [message.id]);
        if (res.rows[0]) {
          restored = { yes: new Set(res.rows[0].yes_ids || []), no: new Set(res.rows[0].no_ids || []) };
        }
      } catch (err) {
        console.error('❌ خطأ أثناء استعادة أصوات الاقتراح:', err);
      }
      client.suggestionVotes.set(message.id, restored);
    }

    const votes = client.suggestionVotes.get(message.id);

    const hasVotedYes = votes.yes.has(userId);
    const hasVotedNo = votes.no.has(userId);

    if (interaction.customId === 'suggest_yes') {
      if (hasVotedYes) {
        votes.yes.delete(userId);
      } else {
        votes.yes.add(userId);
        votes.no.delete(userId);
      }
    } else if (interaction.customId === 'suggest_no') {
      if (hasVotedNo) {
        votes.no.delete(userId);
      } else {
        votes.no.add(userId);
        votes.yes.delete(userId);
      }
    }

    // 🟢 [إصلاح: مشكلة 13] حفظ الأصوات في قاعدة البيانات حتى لا تُفقد عند إعادة تشغيل البوت
    try {
      await pool.query(
        `INSERT INTO suggestion_votes (message_id, yes_ids, no_ids) VALUES ($1, $2::jsonb, $3::jsonb)
         ON CONFLICT (message_id) DO UPDATE SET yes_ids = $2::jsonb, no_ids = $3::jsonb;`,
        [message.id, JSON.stringify([...votes.yes]), JSON.stringify([...votes.no])]
      );
    } catch (err) {
      console.error('❌ خطأ أثناء حفظ صوت الاقتراح:', err);
    }

    const components = message.components[0].components;
    let yesBtn = ButtonBuilder.from(components[0]);
    let noBtn = ButtonBuilder.from(components[1]);

    yesBtn.setLabel(`${votes.yes.size}`);
    noBtn.setLabel(`${votes.no.size}`);

    const newRow = new ActionRowBuilder().addComponents(yesBtn, noBtn);
    await interaction.update({ components: [newRow] });
  });
  // =================================================================
  // 🔴 [نهاية تفاعلات أزرار الاقتراحات]
  // =================================================================


  // =================================================================
  // 🟢 [بداية أمر المساعدة والقائمة المنسدلة ($help)]
  // =================================================================

  // 🌐 [إضافة] رابط الموقع الرسمي للبوت — يظهر ضمن قائمة المساعدة الرئيسية
  const OFFICIAL_WEBSITE_URL = getDashboardUrl.OFFICIAL_SITE_URL + '/';

  // 🟢 [إعادة بناء شاملة] كتالوج موحّد لجميع أوامر البوت مقسّمة إلى أقسام (فئات)،
  // كل قسم يحتوي أوامره الخاصة به مع شرح احترافي كامل لكل أمر (وصف + طريقة استخدام + صلاحية مطلوبة).
  // هذا الكتالوج هو المصدر الوحيد للبيانات المستخدمة في القائمة المنسدلة وفي عرض تفاصيل كل قسم.
  const COMMANDS_CATALOG = {
    general: {
      label: 'عام ومساعدة',
      emoji: 'ℹ️',
      color: '#0284c7',
      description: 'الأوامر العامة الخاصة بالمساعدة والتعرف على البوت، متاحة لجميع أعضاء السيرفر بدون أي قيود.',
      commands: [
        {
          emoji: '❓',
          title: 'أمر المساعدة',
          description: 'يعرض هذه القائمة الشاملة نفسها: نظرة عامة عن البوت، رابط الموقع الرسمي، وقائمة منسدلة مقسّمة لجميع أقسام الأوامر.',
          usage: '`/help`',
          permissions: 'متاح للجميع'
        }
      ]
    },
    rooms: {
      label: 'إدارة الرومات والقنوات',
      emoji: '🏠',
      color: '#0ea5e9',
      description: 'أوامر خاصة بالتحكم في صلاحيات وإعدادات القنوات النصية داخل السيرفر.',
      commands: [
        {
          emoji: '👁️',
          title: 'إعطاء رؤية الروم',
          description: 'يمنح عضواً أو رولاً محدداً صلاحية رؤية ومشاهدة القناة الحالية التي يُكتب بها الأمر، دون التأثير على أي قناة أخرى.',
          usage: '`/channel view` ثم اختر العضو أو الرول',
          permissions: 'إدارة القنوات (Manage Channels)'
        },
        {
          emoji: '✍️',
          title: 'إعطاء صلاحية الكتابة',
          description: 'يمنح عضواً أو رولاً محدداً صلاحية الكتابة والدردشة داخل القناة الحالية فوراً.',
          usage: '`/channel write` ثم اختر العضو أو الرول',
          permissions: 'إدارة القنوات (Manage Channels)'
        },
        {
          emoji: '🏷️',
          title: 'تغيير اسم الروم',
          description: 'يُغيّر اسم القناة النصية الحالية بسرعة إلى اسم جديد تحدده مباشرة بعد الأمر (يُستبدل الفراغ تلقائياً بشرطة).',
          usage: '`/channel rename` مع الاسم الجديد',
          permissions: 'إدارة القنوات (Manage Channels)'
        },
        {
          emoji: '💰',
          title: 'حاسبة الضريبة التلقائية',
          description: 'يُحدد أو يُلغي روماً كحاسبة ضريبة تلقائية تابعة لبوت ProBot؛ أي مبلغ يُكتب داخل الروم (مثل 1m أو 500k) يتم حساب ضريبته تلقائياً وعرضه بإيمبد مرتب.',
          usage: '`/channel tax` (للروم الحالي أو مع تحديد الروم)',
          permissions: 'إدارة القنوات (Manage Channels)'
        },
        {
          emoji: '💡',
          title: 'رومات الاقتراحات',
          description: 'يُحدد أو يُلغي رومات رسمية للاقتراحات (يدعم أكثر من روم بنفس الوقت). أي رسالة تُكتب داخل هذه الرومات تتحول تلقائياً إلى إيمبد منسّق مع أزرار تصويت (👍 / 👎).',
          usage: '`/channel suggestions` (للروم الحالي أو مع تحديد الروم)',
          permissions: 'إدارة القنوات (Manage Channels)'
        }
      ]
    },
    roles: {
      label: 'إدارة الرتب',
      emoji: '🎭',
      color: '#a855f7',
      description: 'أوامر إدارة الرتب الموحّدة عبر /role.',
      commands: [
        {
          emoji: '🔄',
          title: 'تبديل الرتبة التلقائي',
          description: 'يمنح الرتبة للعضو تلقائياً إذا لم تكن معه، أو يسحبها منه تلقائياً إذا كانت معه مسبقاً — بضغطة أمر واحدة فقط. لا يمكن التحكم برتبة أعلى من رتبة مُستخدم الأمر أو مساوية لها (باستثناء مالك السيرفر).',
          usage: '`/role toggle` مع تحديد العضو والرتبة',
          permissions: 'رتبة صلاحية الأمر (تُضبط من لوحة التحكم) أو إدارة الرتب (Manage Roles) أو المدراء'
        }
      ]
    },
    xp: {
      label: 'نظام الإكسبي والمستويات',
      emoji: '⭐',
      color: '#650bf5',
      description: 'أوامر إدارة الإكسبي الموحّدة عبر /xpmanage، وعرض الملف والترتيب عبر /profile و/top. كل رسالة عادية تمنح إكسبي تلقائياً (المبلغ والكول داون يُضبطان من لوحة التحكم).',
      commands: [
        {
          emoji: '➕',
          title: 'إدارة إكسبي الأعضاء',
          description: 'إضافة أو سحب أو تصفير إكسبي أي عضو يدوياً، لكل من الإكسبي الكلي، اليومي، الأسبوعي، والشهري بشكل منفصل تماماً عن بعضها.',
          usage: '`/xpmanage add` أو `/xpmanage remove` مع تحديد العضو والمبلغ والفترة (يومي/أسبوعي/شهري).',
          permissions: 'رتبة إدارة الإكسبي (تُضبط من لوحة التحكم) أو المدراء'
        },
        {
          emoji: '📋',
          title: 'معلوماتي',
          description: 'يعرض ملخصاً شاملاً عنك: مستواك وإكسبيك الكلي، عدد مرات تصدرك المركز الأول بتوب الإكسبي (يومي/أسبوعي/شهري)، وعدد التذاكر التي استلمتها كإداري وكوسيط.',
          usage: '`/myinfo`',
          permissions: 'متاح للجميع'
        }
      ]
    },
    claims: {
      label: 'استلام التذاكر',
      emoji: '📌',
      color: '#22c55e',
      description: 'أوامر التحكم اليدوي بإحصائيات استلام التذاكر (إدارة/وسطاء) لأي عضو، بالإضافة إلى إمكانية إلغاء الاستلام من داخل التذكرة نفسها.',
      commands: [
        {
          emoji: '📊',
          // 📌 كان هذا القسم يعرض الأسماء العربية القديمة وحدها، فلا يعرف
          // العضو أن للأمر نسخة سلاش موحّدة هي «/claimstats».
          title: 'الأمر الموحّد لسجل الاستلام',
          description: 'إضافة أو سحب أو تصفير عدد التذاكر المستلمة لعضو محدد، أو تصفير سجل الجميع دفعة واحدة. تدعم تحديد النوع (إدارة أو وسطاء) والمقدار.',
          usage: '`/claimstats add|remove|reset|resetall type member amount`',
          permissions: 'رتبة صلاحية الاستلام (تُضبط من لوحة التحكم) أو المدراء'
        },
        {
          emoji: '📥',
          title: 'إضافة / سحب استلام لشخص',
          description: 'يُضيف أو يسحب عدداً معيّناً من التذاكر المستلمة لعضو محدد، لكل من نوع الإدارة والوسطاء بشكل منفصل تماماً.',
          usage:
            '`!اضافة-استلام-اداري @العضو [العدد]` / `!سحب-استلام-اداري @العضو [العدد]`\n' +
            'ونفس الأوامر بإضافة `-وسيط` بدل `-اداري` للتحكم باستلام الوسطاء.',
          permissions: 'رتبة صلاحية الاستلام (تُضبط من لوحة التحكم) أو المدراء'
        },
        {
          emoji: '🗑️',
          title: 'تصفير الاستلام',
          description: 'يُصفّر إحصائيات الاستلام لعضو واحد (لنوع محدد أو للكل معاً)، أو لجميع أعضاء السيرفر دفعة واحدة. بالإضافة إلى زر "إلغاء الاستلام" الذي يظهر تلقائياً بعد استلام أي تذكرة ويسمح بإلغاء الاستلام وفتحها من جديد مع خصم تلقائي من عداد الشخص.',
          usage:
            '`!تصفير-استلام-اداري @العضو` / `!تصفير-الكل-استلام-اداري` (ونفس الشيء بـ `-وسيط`)\n' +
            '`!تصفير-استلام @العضو` (تصفير شامل) / `!تصفير-الكل-استلام` (تصفير الجميع)',
          permissions: 'رتبة صلاحية الاستلام (تُضبط من لوحة التحكم) أو المدراء'
        }
      ]
    },
    clans: {
      label: 'الكلانات والفرق',
      emoji: '🏰',
      color: '#3b82f6',
      description: 'نظام كلانات كامل: إنشاء كلان برتبته ورومات مخفية خاصة به، لوحة تحكم بالأزرار للمسؤول والنائب، ونظام تقديم على الكلانات. العضو يستطيع دخول كلان واحد فقط.',
      commands: [
        {
          emoji: '🏰',
          title: 'إنشاء كلان جديد',
          description: 'يعرض إيمبد لتحديد اسم الكلان وإيموجيه والمسؤول والنائب ثم زر إنشاء. يُنشئ البوت رتبة باسم الكلان، ورتبتين (مسؤول + اسم الكلان / نائب مسؤول + اسم الكلان) تُعطيان تلقائياً للمسؤول والنائب، وكاتيجوري مخفية فيها (لوحة التحكم / أخبار / شات / تقديم الكلان) لا يراها إلا مسؤولو الكلانات وأعضاء رتبة الكلان. روم الأخبار للكتابة فيه المسؤول والنائب فقط.',
          usage: '`/clan create`',
          permissions: 'رتبة أوامر الكلانات (تُضبط من لوحة التحكم) — الافتراضي: رتبة "ادمن ستريس"'
        },
        {
          emoji: '📨',
          title: 'لوحة التقديم على الكلانات',
          description: 'يرسل رسالة فيها زر تقديم؛ يختار العضو اسم الكلان من قائمة ثم يكتب مدة تفاعله وعمره واسمه، فيصل التقديم لروم تقديم ذلك الكلان ليقبله أو يرفضه المسؤول أو النائب، وعند القبول يأخذ العضو رتبة الكلان مباشرة.',
          usage: '`/clan apply-panel`',
          permissions: 'رتبة أوامر الكلانات (تُضبط من لوحة التحكم) — الافتراضي: رتبة "ادمن ستريس"'
        },
        {
          emoji: '🎛️',
          title: 'لوحة تحكم الكلان (بالأزرار)',
          description: 'داخل روم لوحة التحكم الخاص بكل كلان: إضافة عضو، طرد عضو، تحديد/إزالة النائب، تغيير اسم الكلان، تغيير لون الرتبة، تغيير الإيموجي، زخرفة أسماء الرومات، وحذف الكلان. كل تعديل يُطبَّق تلقائياً على الرتبة والرومات.',
          usage: 'أزرار رسالة لوحة التحكم داخل روم الكلان',
          permissions: 'مسؤول الكلان ونائبه فقط (تحديد النائب وحذف الكلان للمسؤول فقط)'
        }
      ]
    },
    tickets: {
      label: 'إدارة التذاكر',
      emoji: '🎫',
      color: '#14b8a6',
      description: 'الأوامر التي تعمل حصراً داخل قنوات التذاكر (تُفتح تلقائياً بعد إنشاء التذكرة عبر لوحة التحكم).',
      commands: [
        {
          emoji: '🎫',
          // 📌 أوامر التذكرة تعمل بالبريفكس «!» (استثناء مقصود في prefixPolicy)،
          // ولها كذلك نسخة سلاش موحّدة «/ticket» لم تكن مذكورة هنا إطلاقاً.
          title: 'الأمر الموحّد للتذكرة',
          description: 'كل أوامر التذكرة في أمر سلاش واحد يُستخدم داخل روم التذكرة: الإغلاق والحفظ والحذف وإضافة عضو أو إزالته وتغيير الاسم. أوامر التذاكر هي الاستثناء الوحيد الذي يعمل بالبريفكس «!» إلى جانب السلاش.',
          usage: '`/ticket close` · `/ticket save` · `/ticket delete` · `/ticket add` · `/ticket remove` · `/ticket rename`',
          permissions: 'حسب كل عملية — تُضبط من لوحة التحكم'
        },
        {
          emoji: '🔒',
          title: 'إغلاق التذكرة',
          description: 'يُغلق التذكرة الحالية أمام صاحبها ويعرض أزراراً لإعادة الفتح، حفظ الترانسكريبت، أو الحذف النهائي.',
          usage: '`!close`',
          permissions: 'إداري التذكرة / إداري عالي (أو صاحب التذكرة حسب إعدادات لوحة التحكم)'
        },
        {
          emoji: '📜',
          title: 'حفظ الترانسكريبت',
          description: 'يحفظ نسخة كاملة تفاعلية (HTML) من محادثة التذكرة ويرسلها مباشرة إلى روم اللوق المحدد بلوحة التحكم.',
          usage: '`!save`',
          permissions: 'إداري التذكرة / إداري عالي (أو صاحب التذكرة حسب إعدادات لوحة التحكم)'
        },
        {
          emoji: '🗑️',
          title: 'حذف التذكرة',
          description: 'يحذف قناة التذكرة نهائياً من السيرفر بعد مهلة قصيرة للتأكيد.',
          usage: '`!delete`',
          permissions: 'إداري عالي (أو حسب وضع الحذف المحدد بلوحة التحكم)'
        },
        {
          emoji: '➕',
          title: 'إضافة عضو للتذكرة',
          description: 'يمنح عضواً محدداً صلاحية رؤية والكتابة داخل التذكرة الحالية.',
          usage: '`!add @العضو`',
          permissions: 'إداري التذكرة / إداري عالي'
        },
        {
          emoji: '➖',
          title: 'إزالة عضو من التذكرة',
          description: 'يسحب من عضو محدد صلاحية رؤية والكتابة داخل التذكرة الحالية.',
          usage: '`!remove @العضو`',
          permissions: 'إداري التذكرة / إداري عالي'
        },
        {
          emoji: '🏷️',
          title: 'تغيير اسم التذكرة',
          description: 'يُغيّر اسم قناة التذكرة الحالية فقط (لا يعمل خارج التذاكر إطلاقاً).',
          usage: '`!rename [الاسم الجديد]`',
          permissions: 'إداري التذكرة / إداري عالي (نفس صلاحيات !add و !remove)'
        }
      ]
    },
    owner: {
      label: 'أوامر المالك والإدارة العليا',
      emoji: '👑',
      color: '#5f0ae8',
      description: 'أوامر حساسة مخصصة حصراً لمالك السيرفر والإدارة العليا؛ للتحكم بحالة البوت نفسه وأدواته الإدارية عالية الصلاحية.',
      commands: [
        {
          emoji: '🔧',
          title: 'تغيير حالة/نوت البوت',
          description: 'يعرض 3 أزرار (نشط ✅ / قيد الصيانة ⚠️ / متوقف ⛔) لتحديث نوت وحالة أونلاين البوت فوراً مع ستيكر مميز لكل خيار. الاختيار يُحفظ تلقائياً بقاعدة البيانات ويرجع تلقائياً بعد أي ريستارت.',
          usage: '`/botstatus set` ثم اختيار الحالة من الأزرار (نشط، قيد الصيانة، أو متوقف)',
          permissions: 'رتبة حالة البوت (تُضبط من لوحة التحكم) أو مدير السيرفر (Administrator)'
        },
        {
          emoji: '📝',
          title: 'تغيير وصف البوت (About Me)',
          description: 'يُحدّث حقل الوصف (About Me) الظاهر في بروفايل تطبيق البوت نفسه بديسكورد مباشرة، بحد أقصى 400 حرف. هذا الوصف محفوظ دائماً بحساب البوت ولا يحتاج إعادة تطبيق بعد الريستارت.',
          usage: '`/botstatus about` مع الوصف الجديد',
          permissions: 'رتبة حالة البوت (تُضبط من لوحة التحكم) أو مدير السيرفر (Administrator)'
        },
        {
          emoji: '📋',
          title: 'تحديد روم لوق الأخطاء',
          description: 'يحدد القناة التي سيُرسل إليها البوت جميع أخطائه التقنية تلقائياً لمتابعتها من قبل المالك.',
          usage: '`/logchannel` مع تحديد الروم',
          permissions: 'مدير السيرفر (Administrator)'
        },
        {
          emoji: '💰',
          title: 'حاسبة الضريبة اليدوية',
          description: 'يحسب الضريبة والمبلغ الصافي والمبلغ الواجب تحويله لمبلغ معيّن يُكتب مباشرة بعد الأمر (مختلف عن حاسبة الضريبة التلقائية للروم).',
          usage: '`/tax [المبلغ]`',
          permissions: 'رتبة الضريبة (تُضبط من لوحة التحكم)'
        },
        {
          emoji: '🔔',
          title: 'استدعاء عضو',
          // ⚠️ كان الاستخدام معروضاً بصيغة «$come @العضو»، وصيغة «$» لأمر
          // له نظير سلاش صارت مرفوضة صامتاً (prefixPolicy + messageCreate)،
          // فكانت القائمة توجّه العضو إلى أمر ميت لا يرد بشيء.
          description: 'يرسل رسالة استدعاء رسمية بالخاص لعضو محدد تتضمن اسم الإداري المستدعي ورابط مباشر للروم.',
          usage: '`/come @العضو` — أو الاختصار الذي يحدّده المالك من لوحة التحكم',
          permissions: 'رتبة الاستدعاء (تُضبط من لوحة التحكم)'
        },
        {
          emoji: '📢',
          title: 'التحدث باسم البوت',
          description: 'يحذف رسالة الأمر ويرسل النص المكتوب كرسالة من البوت نفسه بالروم الحالي.',
          usage: '`/say [الرسالة]` — أو الاختصار الذي يحدّده المالك من لوحة التحكم',
          permissions: 'رتبة التحدث (تُضبط من لوحة التحكم)'
        }
      ]
    },
    slash: {
      label: 'أوامر السلاش الإضافية',
      emoji: '✨',
      color: '#8067b4',
      description: 'كل أمر متاح بسلاشه، وأوامر التكت وحدها تعمل بالبريفكس ! كما هي. ويمكن ضبط الاختصارات والصلاحيات لكل أمر من مركز الأوامر.',
      commands: [
        {
          emoji: '🎲', title: 'أوامر عامة',
          description: 'رمي النرد، اختصار رابط ويب عبر خدمة خارجية، نقل نفسك صوتياً، عرض رتب الألوان، واختيار رتبة لون بدون صلاحيات إدارية.',
          usage: '`/roll` · `/short url` · `/moveme` · `/colors` · `/color role`',
          permissions: 'متاح للجميع؛ نقل الصوت يتطلب صلاحيات البوت المناسبة'
        },
        {
          emoji: '💳', title: 'الرصيد والسمعة',
          description: 'عرض رصيدك أو رصيد عضو، تحويل الرصيد، ومنح نقطة سمعة واحدة كل 24 ساعة. يمكن للإدارة إضافة رصيد ابتدائي عند تفعيل هذا النظام.',
          usage: '`/credits` · `/credits member amount` · `/creditsgrant member amount` · `/rep member`',
          permissions: '`creditsgrant`: إدارة السيرفر؛ `rep` والتحويل متاحان للجميع'
        },
        {
          emoji: '⭐', title: 'الإكسبي والملف الشخصي',
          description: 'عرض الملف والترتيب والتوب، تعيين لقب الملف، وإدارة إكسبي أو مستوى عضو. /reset يدعم تصفير الإجمالي أو إحدى الفترات.',
          usage: '`/profile [member]` · `/top [period] [archive]` · `/title` · `/setxp` · `/setlevel` · `/reset period [member]` — ويمكن للمالك إضافة اختصارات تُكتب مجرّدة بلا بريفكس.',
          permissions: 'العرض واللقب متاحان للجميع؛ التعديل الإداري يتطلب إدارة السيرفر'
        },
        {
          emoji: 'ℹ️', title: 'معلومات السيرفر والأعضاء',
          description: 'عرض معلومات عضو أو السيرفر أو الرتب، واستعراض الصورة العامة أو صورة العضو الخاصة بالسيرفر أو البانر.',
          usage: '`/user` · `/server` · `/roles` · `/avatar`',
          permissions: 'متاح للجميع'
        },
        {
          emoji: '🛡️', title: 'الإشراف',
          // 📌 أُضيفت الأوامر السبعة الناقصة: كانت مذكورة في الوصف النصي فقط
          // دون سطر الاستخدام، فمن يقرأ القائمة لا يعرف أنها موجودة أصلاً.
          description: 'تغيير الألقاب، الحظر وفكّه، الطرد، الفصل أو النقل الصوتي، الإسكات الكتابي والصوتي، Timeout، حذف الرسائل، وقفل القنوات وإبطاؤها.',
          usage:
            '`/ban` · `/unban` · `/kick` · `/vkick` · `/setnick`\n' +
            '`/mute` · `/unmute` · `/time` · `/untime` · `/move`\n' +
            '`/clear` · `/slowmode` · `/lock` · `/unlock` · `/hide` · `/show`\n' +
            '_(لكل أمر إعدادات مستقلة من لوحة التحكم)_',
          permissions: 'صلاحية Discord المناسبة لكل أمر، مع فحص ترتيب الرتب'
        },
        {
          emoji: '🏷️', title: 'الرتب والألوان',
          description: 'إعطاء أو سحب رتبة من عضو، أو تنفيذ ذلك لمجموعة محددة بحاملي رتبة أساس. يمكن للإدارة تغيير لون رتبة.',
          usage: '`/role give` · `/role remove` · `/role multiple` · `/setcolor`',
          permissions: 'إدارة الرتب؛ لا يمكن تجاوز ترتيب رتبة المشرف أو البوت'
        },
        {
          emoji: '⚠️', title: 'الإنذارات والنقاط',
          description: 'تسجيل وعرض وحذف الإنذارات، وإدارة نقاط الإدارة وعرض ترتيبها.',
          usage: '`/warn` · `/warnings` · `/warn_remove` · `/points set|increase|decrease|list|reset`',
          permissions: 'إدارة الرسائل'
        }
      ]
    }
  };

  // 🟢 [موحّد] بناء قائمة المساعدة الكاملة (الإيمبد الرئيسي + الأزرار + القائمة المنسدلة المقسّمة بالأقسام)
  // بدالة واحدة مشتركة بين أمر البريفكس ($help) وأمر السلاش (/help) لضمان نفس الشكل والمحتوى تماماً
  function buildFullHelpMenu(username, guildIconUrl, dashboardUrl) {
    const helpEmbed = new EmbedBuilder()
      .setTitle('📚 قائمة الأوامر الشاملة')
      .setDescription(
        `أهلاً بك **${username}** في نظام المساعدة الشامل! 👋\n\n` +
        `🌐 **الموقع الرسمي:** ${OFFICIAL_WEBSITE_URL}\n\n` +
        `👇 اختر القسم الذي تريد استعراض أوامره وشرحها الكامل من القائمة المنسدلة بالأسفل:`
      )
      .setColor('#0284c7')
      .setThumbnail(client.user.displayAvatarURL({ size: 512 }))
      .setFooter({ text: 'حقوق البوت محفوظة لـ قتادة ©️ 2026', iconURL: guildIconUrl })
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_select_category')
      .setPlaceholder('📂 اختر قسم الأوامر لعرض شرحه الكامل...')
      .addOptions(
        Object.entries(COMMANDS_CATALOG).map(([key, cat]) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(cat.label)
            .setValue(key)
            .setDescription(`عرض جميع أوامر قسم ${cat.label} (${cat.commands.length} أمر)`)
            .setEmoji(cat.emoji)
        )
      );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    return { embeds: [helpEmbed], components: [selectRow] };
  }

  // 🚦 [موحّد] صار /help السلاش هو الصيغة الوحيدة للمساعدة — أي $help قديم يُوجَّه لاستخدام السلاش.
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.content === '$help') {
      // 🚦 صار /help هو الصيغة الوحيدة (سلاش فقط) — أي $help قديم صامت تماماً.
      message.__slashCommandHandled = true;
      return;
    }
  });

  // 🟢 [إعادة بناء] معالجة اختيار قسم من القائمة المنسدلة — يعرض إيمبد احترافي يحتوي جميع
  // أوامر القسم المختار، كل أمر بشرحه ووصفه الكامل، طريقة استخدامه، والصلاحية المطلوبة له
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== 'help_select_category') return;

    const selectedKey = interaction.values[0];
    const category = COMMANDS_CATALOG[selectedKey];

    if (!category) {
      return interaction.reply({ content: '❌ تعذر العثور على معلومات هذا القسم.', ephemeral: true });
    }

    const categoryEmbed = new EmbedBuilder()
      .setTitle(`${category.emoji} قسم: ${category.label}`)
      .setDescription(`${category.description}\n\n📦 **عدد أوامر هذا القسم:** ${category.commands.length}`)
      .setColor(category.color)
      .setThumbnail(client.user.displayAvatarURL({ size: 512 }))
      .addFields(
        // 🔤 أوامر القسم تُعرض مرتّبة أبجدياً حسب عنوانها بدل ترتيب كتابتها في
        // الكاتالوج، حتى تتطابق تجربة البحث هنا مع صفحة الأوامر في اللوحة.
        // sortByName لا تعدّل COMMANDS_CATALOG نفسه، فيبقى المصدر كما هو.
        sortByName(category.commands, cmd => cmd.title).map(cmd => ({
          name: `${cmd.emoji} ${cmd.title}`,
          value: `${cmd.description}\n\n📝 **طريقة الاستخدام:** ${cmd.usage}\n🛡️ **الصلاحية المطلوبة:** ${cmd.permissions}`,
          inline: false
        }))
      )
      .setFooter({ text: 'حقوق البوت محفوظة لـ قتادة ©️ 2026' })
      .setTimestamp();

    return interaction.reply({ embeds: [categoryEmbed], ephemeral: true });
  });
  // =================================================================
  // 🔴 [نهاية أمر المساعدة والقائمة المنسدلة ($help)]
  // =================================================================
  // =================================================================
  // 🟢 [بداية أمر: تغيير حالة/نوت البوت (!الحالة) — 3 خيارات + حماية برتبة من الموقع]
  // =================================================================

  // إعدادات كل خيار من الخيارات الثلاثة (النص، اللون، الإيموجي، الستيكر/الصورة، حالة الأونلاين)
  const BOT_STATUS_OPTIONS = {
    status_active: {
      label: 'نشط',
      emoji: '🟢',
      color: '#22c55e',
      presenceStatus: 'online', // 🟢 أونلاين
      noteText: '🟢 الحالة: نشط ✅',
      sticker: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f7e2.png'
    },
    status_maintenance: {
      label: 'قيد الصيانة',
      emoji: '🛠️',
      color: '#5f0ae8',
      presenceStatus: 'idle', // 🟡 فكرة
      noteText: '🛠️ الحالة: قيد الصيانة ⚠️',
      sticker: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f6e0.png'
    },
    status_stopped: {
      label: 'متوقف',
      emoji: '🔴',
      color: '#ef4444',
      presenceStatus: 'dnd', // 🔴 مزعج/متوقف
      noteText: '🔴 الحالة: متوقف ⛔',
      sticker: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f534.png'
    }
  };

  // أمر إظهار الخيارات الثلاثة: !الحالة
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const statusText = message.content.trim();
    const statusPrefix = (statusText[0] === PREFIX || statusText[0] === ADMIN_PREFIX) ? statusText[0] : '';
    const hasPrefix = Boolean(statusPrefix);
    let controlConfig = COMMAND_CONTROL_DEFAULTS;
    try { controlConfig = await getCommandControlConfig(pool); } catch (err) {
      console.error('❌ تعذر تحميل إعدادات أوامر حالة البوت:', err);
    }
    const commandText = statusPrefix ? statusText.slice(1).trim() : statusText;
    const statusWords = commandText.split(/ +/).filter(Boolean);
    const requestedCommand = (statusWords[0] || '').toLowerCase();
    // 🔓 نفس قاعدة بقية المسارات: الاختصار قد يكون كلمتين.
    const statusAliasMatch = resolveCommandControlAliasPhrase(statusWords, controlConfig);
    const aliasTarget = statusAliasMatch ? statusAliasMatch.target : null;
    const command = aliasTarget || requestedCommand;
    const args = statusWords.slice(statusAliasMatch ? statusAliasMatch.words : 1);
    if (!['الحالة', 'status', 'الحالة2', 'status2'].includes(command) || (!hasPrefix && !aliasTarget)) return;
    // 🚦 صارت سلاش فقط (/botstatus) — إلا اختصار المالك فيعمل بأي بريفكس.
    if (hasPrefix && !aliasTarget && isPrefixBlocked(command)) {
      message.__slashCommandHandled = true;
      return;
    }
    if (!controlConfig.status.enabled) return;

    if (command === 'الحالة' || command === 'status') {
      // 🔒 لا يستخدم هذا الأمر إلا صاحب الرتبة المحددة من الموقع (status_role_id) أو من يملك صلاحية عامة/أدمن
      const allowed = await hasCommandPermission(message.member, 'status_role_id', PermissionFlagsBits.Administrator);
      if (!allowed) {
        return message.reply('❌ ليس لديك صلاحية لاستخدام أمر تغيير حالة البوت.');
      }

      const chooseEmbed = new EmbedBuilder()
        .setTitle('🔧 تغيير حالة البوت')
        .setDescription('اختر الحالة الحالية للبوت من الأزرار بالأسفل، وسيتم تحديث نوت البوت تلقائياً:')
        .setColor('#0284c7')
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: 'نظام إدارة حالة البوت' })
        .setTimestamp();

      const statusRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('status_active').setLabel('نشط').setEmoji('🟢').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('status_maintenance').setLabel('قيد الصيانة').setEmoji('🛠️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('status_stopped').setLabel('متوقف').setEmoji('🔴').setStyle(ButtonStyle.Danger)
      );

      return message.reply({ embeds: [chooseEmbed], components: [statusRow] });
    }

    // 🟢 [إضافة] أمر !الحالة2 — تحديد الوصف (About Me) الخاص ببروفايل تطبيق البوت نفسه بديسكورد
    if (command === 'الحالة2' || command === 'status2') {
      // 🔒 نفس صلاحية أمر !الحالة تماماً (status_role_id من الموقع أو المدراء)
      const allowed = await hasCommandPermission(message.member, 'status_role_id', PermissionFlagsBits.Administrator);
      if (!allowed) {
        return message.reply('❌ ليس لديك صلاحية لاستخدام أمر تحديد وصف البوت.');
      }

      const newDescription = args.join(' ').trim();
      if (!newDescription) {
        return message.reply('⚠️ يرجى كتابة الوصف المطلوب بعد الأمر.\nمثال: `/botstatus about` ثم الوصف، أو أضف اختصاراً مجرّداً لهذا الأمر.');
      }

      if (newDescription.length > 400) {
        return message.reply('⚠️ الوصف طويل جداً! الحد الأقصى المسموح به من ديسكورد هو 400 حرف.');
      }

      try {
        // 🟢 تحديث وصف بروفايل تطبيق البوت (About Me) مباشرة عبر ديسكورد — هذا الوصف
        // محفوظ بحساب البوت نفسه بديسكورد بشكل دائم، فلا يحتاج أي حفظ أو إعادة تطبيق
        // بعد الريستارت (بعكس النوت/الحالة التي تُدار بأمر !الحالة).
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        await rest.patch(Routes.currentApplication(), { body: { description: newDescription } });
      } catch (err) {
        console.error('❌ خطأ أثناء تحديث وصف البوت:', err);
        return message.reply('❌ حدث خطأ أثناء تحديث وصف البوت.');
      }

      const descResultEmbed = new EmbedBuilder()
        .setTitle('✅ تم تحديث وصف البوت بنجاح')
        .setDescription(`تم تغيير الوصف (About Me) إلى:\n\n> ${newDescription}`)
        .setColor('#0284c7')
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: `بواسطة: ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

      return message.reply({ embeds: [descResultEmbed] });
    }
  });

  // معالجة الضغط على أحد الأزرار الثلاثة وتحديث نوت البوت + الرد بإيمبد جميل مع ستيكر
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!BOT_STATUS_OPTIONS[interaction.customId]) return;

    // 🔒 تحقق ثاني عند الضغط الفعلي على الزر (نفس رتبة الموقع المحددة)
    const allowed = await hasCommandPermission(interaction.member, 'status_role_id', PermissionFlagsBits.Administrator);
    if (!allowed) {
      return interaction.reply({ content: '❌ لا تمتلك صلاحية لتغيير حالة البوت!', ephemeral: true });
    }

    const chosen = BOT_STATUS_OPTIONS[interaction.customId];

    try {
      // تحديث نوت (status/presence) بوت الديسكورد نفسه
      await client.user.setPresence({
        activities: [{ name: chosen.noteText, type: 4, state: chosen.noteText }], // type: 4 = Custom Status
        status: chosen.presenceStatus
      });

      // 🟢 [إضافة] حفظ الحالة المختارة بقاعدة البيانات لترجع تلقائياً بعد أي ريستارت
      await saveBotStatusState(chosen.noteText, chosen.presenceStatus);
    } catch (err) {
      console.error('❌ خطأ أثناء تحديث حالة البوت:', err);
    }

    const resultEmbed = new EmbedBuilder()
      .setTitle('✅ تم تحديث حالة البوت بنجاح')
      .setDescription(`تم تغيير نوت البوت إلى:\n\n> ${chosen.emoji} **${chosen.label}**`)
      .setColor(chosen.color)
      .setThumbnail(chosen.sticker)
      .setImage(chosen.sticker)
      .setFooter({ text: `بواسطة: ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();

    return interaction.update({ embeds: [resultEmbed], components: [] });
  });
  // =================================================================
  // 🔴 [نهاية أمر: تغيير حالة/نوت البوت (!الحالة)]
  // =================================================================

  // ==========================================================================
  // 🌉 نسخ السلاش من أوامر هذا الملف
  // تُسجَّل هنا تحديداً لأنها تحتاج نفس المتغيرات المحلية (رومات الضريبة
  // والاقتراحات ودالة الصلاحيات)، فيبقى المنطق في مصدر واحد ولا يتفرّع
  // سلوك /channel عن سلوك !اضافة مع مرور الوقت.
  // ==========================================================================
  const slashReply = (interaction, content) =>
    (interaction.replied || interaction.deferred)
      ? interaction.followUp({ content, ephemeral: true }).catch(() => {})
      : interaction.reply({ content, ephemeral: true }).catch(() => {});

  // 📖 /help — نفس قائمة $help تماماً (نفس الدالة buildFullHelpMenu)
  registerSystemSlashHandler('help', async (interaction) => {
    const guildIconUrl = interaction.guild ? interaction.guild.iconURL({ dynamic: true }) : null;
    const menu = buildFullHelpMenu(interaction.user.username, guildIconUrl, getDashboardUrl());
    return interaction.reply(menu);
  });

  registerSystemSlashHandler('channel', async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.channel;

    // --- /channel view و /channel write : نفس منطق !اضافة و !كتابة ---
    if (sub === 'view' || sub === 'write') {
      const isView = sub === 'view';
      const allowed = await hasCommandPermission(
        interaction.member,
        isView ? 'add_view_role_id' : 'write_role_id',
        PermissionFlagsBits.ManageChannels
      );
      if (!allowed) return slashReply(interaction, '❌ ليس لديك صلاحية إدارة القنوات لاستخدام هذا الأمر.');
      if (!channel) return slashReply(interaction, '❌ تعذر الوصول إلى الروم الحالي.');

      const targetUser = interaction.options.getUser('member');
      const targetRole = interaction.options.getRole('role');
      if (!targetUser && !targetRole) {
        return slashReply(interaction, '⚠️ حدّد عضواً أو رتبة في خيارات الأمر.');
      }

      const permission = isView ? { ViewChannel: true } : { SendMessages: true };
      if (targetUser) {
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) return slashReply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
        await channel.permissionOverwrites.edit(member.id, permission);
        return slashReply(interaction, isView
          ? `👁️ تم منح **${member.user.tag}** صلاحية رؤية الروم بنجاح!`
          : `✍️ تم منح **${member.user.tag}** صلاحية الكتابة بالروم بنجاح!`);
      }
      await channel.permissionOverwrites.edit(targetRole.id, permission);
      return slashReply(interaction, isView
        ? `👁️ تم منح رول **${targetRole.name}** صلاحية رؤية الروم بنجاح!`
        : `✍️ تم منح رول **${targetRole.name}** صلاحية الكتابة بالروم بنجاح!`);
    }

    // --- /channel rename : نفس منطق !r ---
    if (sub === 'rename') {
      const allowed = await hasCommandPermission(interaction.member, 'rename_role_id', PermissionFlagsBits.ManageChannels);
      if (!allowed) return slashReply(interaction, '❌ ليس لديك صلاحية تغيير اسم الروم.');
      if (!channel) return slashReply(interaction, '❌ تعذر الوصول إلى الروم الحالي.');
      // نفس تحويل المسافات إلى شرطات المستخدم في !r
      const newName = interaction.options.getString('name').trim().split(/ +/).filter(Boolean).join('-');
      if (!newName) return slashReply(interaction, '⚠️ اكتب الاسم الجديد للروم.');
      await channel.setName(newName);
      return slashReply(interaction, `🏷️ تم تغيير اسم الروم إلى: **${newName}**`);
    }

    // --- /channel tax و /channel suggestions : نفس منطق !ضريبة و !اقتراحات ---
    const isTax = sub === 'tax';
    const allowed = await hasCommandPermission(
      interaction.member,
      isTax ? 'tax_channel_role_id' : 'suggestions_role_id',
      PermissionFlagsBits.ManageChannels
    );
    if (!allowed) {
      return slashReply(interaction, isTax
        ? '❌ ليس لديك صلاحية لتحديد رومات الضريبة.'
        : '❌ ليس لديك صلاحية لتحديد رومات الاقتراحات.');
    }

    const targetChannel = interaction.options.getChannel('channel') || channel;
    if (!targetChannel) return slashReply(interaction, '❌ تعذر تحديد الروم المطلوب.');

    const store = isTax ? taxChannelIds : suggestionsChannelIds;
    const settingKey = isTax ? 'tax_channel_ids' : 'suggestions_channel_ids';
    if (store.has(targetChannel.id)) {
      store.delete(targetChannel.id);
      await saveBotSetting(pool, settingKey, [...store]);
      return slashReply(interaction, isTax
        ? `🗑️ تم إزالة ${targetChannel} من قائمة رومات حاسبة الضريبة.`
        : `🗑️ تم إزالة ${targetChannel} من قائمة رومات الاقتراحات.`);
    }
    store.add(targetChannel.id);
    await saveBotSetting(pool, settingKey, [...store]);
    return slashReply(interaction, isTax
      ? `✅ تم إضافة ${targetChannel} كروم رسمي لحاسبة ضريبة بروبوت!`
      : `✅ تم إضافة ${targetChannel} كروم رسمي للاقتراحات!`);
  });

  registerSystemSlashHandler('botstatus', async (interaction) => {
    const allowed = await hasCommandPermission(interaction.member, 'status_role_id', PermissionFlagsBits.Administrator);
    const sub = interaction.options.getSubcommand();

    // --- /botstatus set : نفس لوحة أزرار !الحالة ---
    if (sub === 'set') {
      if (!allowed) return slashReply(interaction, '❌ ليس لديك صلاحية لاستخدام أمر تغيير حالة البوت.');
      const chooseEmbed = new EmbedBuilder()
        .setTitle('🔧 تغيير حالة البوت')
        .setDescription('اختر الحالة الحالية للبوت من الأزرار بالأسفل، وسيتم تحديث نوت البوت تلقائياً:')
        .setColor('#0284c7')
        .setThumbnail(client.user.displayAvatarURL())
        .setFooter({ text: 'نظام إدارة حالة البوت' })
        .setTimestamp();
      const statusRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('status_active').setLabel('نشط').setEmoji('🟢').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('status_maintenance').setLabel('قيد الصيانة').setEmoji('🛠️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('status_stopped').setLabel('متوقف').setEmoji('🔴').setStyle(ButtonStyle.Danger)
      );
      // غير مخفي: الأزرار نفسها تتحقق من الصلاحية عند الضغط (كما في !الحالة)
      return interaction.reply({ embeds: [chooseEmbed], components: [statusRow] });
    }

    // --- /botstatus about : نفس منطق !الحالة2 ---
    if (!allowed) return slashReply(interaction, '❌ ليس لديك صلاحية لاستخدام أمر تحديد وصف البوت.');
    const newDescription = interaction.options.getString('description').trim();
    if (!newDescription) return slashReply(interaction, '⚠️ يرجى كتابة الوصف المطلوب.');
    if (newDescription.length > 400) {
      return slashReply(interaction, '⚠️ الوصف طويل جداً! الحد الأقصى المسموح به من ديسكورد هو 400 حرف.');
    }
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      await rest.patch(Routes.currentApplication(), { body: { description: newDescription } });
    } catch (err) {
      console.error('❌ خطأ أثناء تحديث وصف البوت:', err);
      return slashReply(interaction, '❌ حدث خطأ أثناء تحديث وصف البوت.');
    }
    const descResultEmbed = new EmbedBuilder()
      .setTitle('✅ تم تحديث وصف البوت بنجاح')
      .setDescription(`تم تغيير الوصف (About Me) إلى:\n\n> ${newDescription}`)
      .setColor('#0284c7')
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: `بواسطة: ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();
    return interaction.reply({ embeds: [descResultEmbed] });
  });

  registerSystemSlashHandler('logchannel', async (interaction) => {
    // نفس شرط !logowner تماماً: صلاحية Administrator
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return slashReply(interaction, '❌ يتطلب Administrator!');
    }
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel) return slashReply(interaction, '❌ تعذر تحديد الروم المطلوب.');
    state.ownerLogChannelId = channel.id;
    try {
      await pool.query(
        `INSERT INTO bot_settings (key, value) VALUES ('owner_log_channel_id', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = $1::jsonb;`,
        [JSON.stringify(channel.id)]
      );
    } catch (err) {
      console.error('❌ خطأ أثناء حفظ قناة لوق المالك:', err);
    }
    return slashReply(interaction, `✅ تم تحديد ${channel} كقناة لوق الأخطاء.`);
  });

  console.log('⚡ تم تحميل جميع الأوامر المحدثة بنجاح!');

  // 🟢 [موحّد] تصدير دالة بناء قائمة المساعدة الكاملة لاستخدامها في أمر السلاش /help (بنفس الشكل تماماً)
  return { buildFullHelpMenu };
};
