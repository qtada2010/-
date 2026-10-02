const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');
const {
  getTaxCommandConfig, getComeCommandConfig, getSayCommandConfig, getCloseCommandConfig,
  getCommandControlConfig, resolveCommandControlAlias, resolveCommandControlAliasPhrase, COMMAND_CONTROL_DEFAULTS
} = require('./commandConfig');
const { buildTaxPayload, buildComePayload, buildSayPayload } = require('./customCommands');
const { registerSystemSlashHandler } = require('./systemSlashBridge');
const { isPrefixBlocked } = require('./prefixPolicy');
const { aliasWordCount } = require('./aliasRules');

// يستقبل client, pool, PREFIX, ADMIN_PREFIX, state, ودوال المساعدة (helpers) من index.js
// ==========================================================================
// 📋 إيمبد الاستخدام لأوامر «$» (come · tax · say)
//
// هذه الأوامر تُعالَج هنا لا في slashPrefix.js، فكانت ترد بسطر نصي مقتضب
// بينما بقية الأوامر تعرض إيمبداً إرشادياً. الدالة توحّد التجربة: نفس
// الإيمبد ونفس المصدر (commandUsage.js) فلا يتفرّع الشكل مع الوقت.
//
// ترجع true إن أُرسل الإيمبد، فينهي المستدعي بـ return.
// ==========================================================================
async function replyUsage(message, commandName, reason, aliases, roleIds) {
  try {
    const { buildUsageEmbed } = require('./commandUsage');
    const { commandData } = require('./slashCommands');
    const command = commandData.find(item => item.name === commandName);
    if (!command) return message.reply(reason).catch(() => {});
    const embed = buildUsageEmbed(command, {
      reason,
      username: message.author?.username || '',
      actorMention: `<@${message.author.id}>`,
      aliases: aliases || [],
      roleIds: (roleIds || []).filter(id => /^[0-9]{5,25}$/.test(String(id))),
      prefix: '$'
    });
    return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } })
      .catch(() => message.reply(reason).catch(() => {}));
  } catch {
    // أي خلل في بناء الإيمبد يجب ألا يحرم العضو من الإرشاد النصي.
    return message.reply(reason).catch(() => {});
  }
}

module.exports = function registerMessageCreateEvent(client, pool, PREFIX, ADMIN_PREFIX, state, helpers) {
  const { hasAdminCommandPermission, getTicketInfo, resolveTicketSettings, saveTranscript, resolveExplicitTarget } = helpers;

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || message.__slashCommandHandled) return;

  try {



  const hasAdminPrefix = message.content.startsWith(ADMIN_PREFIX);
  const hasBotPrefix = message.content.startsWith(PREFIX);
  // 🔓 (2026-10-02) اختصار المالك يعمل بأي بريفكس: «!اختصار» يصل إلى صاحبه
  // أيضاً، لأن المالك هو من كتبه. نفحص الأوامر المخصّصة (ضريبة · استدعاء ·
  // تحدّث) قبل البوابة، وإلا لزم «!» أن يعبُرها للأبد. النداء المكرّر بلا
  // كلفة: إعدادات هذه الأوامر في ذاكرة مؤقتة مدّتها خمس ثوانٍ.
  let botAliasText = '';
  if (hasBotPrefix && !hasAdminPrefix) {
    const botPrefixText = message.content.slice(PREFIX.length).trim();
    const botPrefixWords = botPrefixText.split(/ +/).filter(Boolean);
    if (botPrefixWords.length) {
      const [aliasTax, aliasCome, aliasSay] = await Promise.all([
        getTaxCommandConfig(pool).catch(() => null),
        getComeCommandConfig(pool).catch(() => null),
        getSayCommandConfig(pool).catch(() => null)
      ]);
      const isOwnerAlias = [aliasTax, aliasCome, aliasSay].some(config =>
        config && aliasWordCount(config.aliases, botPrefixWords) > 0);
      if (isOwnerAlias) botAliasText = botPrefixText;
    }
  }
  if (hasAdminPrefix || !hasBotPrefix || botAliasText) {
    const commandText = hasAdminPrefix
      ? message.content.slice(ADMIN_PREFIX.length).trim()
      : (botAliasText || message.content.trim());
    const commandWords = commandText.split(/ +/).filter(Boolean);
    const command = (commandWords[0] || '').toLowerCase();
    // 🚦 أوامر «$» (come · say · tax) صارت سلاش فقط — صامتة تماماً بلا أي رد،
    // ويبقى الاختصار المجرّد بلا بريفكس هو البديل.
    if (hasAdminPrefix && isPrefixBlocked(command)) {
      message.__slashCommandHandled = true;
      return;
    }
    // 🚦 رفض صامت لأي استدعاء بالبريفكس لهذه الأوامر — بالاسم الرسمي أو بالاختصار.
    const refusePrefix = () => {
      message.__slashCommandHandled = true;
      return;
    };
    let perms = null;
    const getMainPermissions = async () => {
      if (perms) return perms;
      const result = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions']);
      perms = result.rows[0] || {};
      return perms;
    };

    const taxConfig = await getTaxCommandConfig(pool);
    const taxAliasWords = aliasWordCount(taxConfig.aliases, commandWords);
    const isTaxCommand = (hasAdminPrefix && command === 'tax') || taxAliasWords > 0;
    if (isTaxCommand) {
      // الصامت هو الاسم الرسمي $tax وحده؛ اختصار المالك يعمل بأي بريفكس.
      if (hasAdminPrefix && command === 'tax') return refusePrefix();
      if (!taxConfig.enabled) return;

      const mainPermissions = await getMainPermissions();
      const allowed = await hasAdminCommandPermission(message.member, mainPermissions.tax_role_id, 'ادمن ستريس');
      if (!allowed) return message.reply('❌ لا تمتلك صلاحية استخدام أمر الضريبة!');

      // 🧩 نفس المنطق المستخدم في أمر السلاش /tax (مصدر واحد في customCommands.js)
      const taxResult = buildTaxPayload(taxConfig, commandWords.slice(taxAliasWords || 1)[0]);
      if (taxResult.error) return replyUsage(message, 'tax', taxResult.error, taxConfig.aliases, [mainPermissions.tax_role_id]);

      return message.channel.send(taxResult.payload);
    }

    const comeConfig = await getComeCommandConfig(pool);
    const comeAliasWords = aliasWordCount(comeConfig.aliases, commandWords);
    const isComeCommand = (hasAdminPrefix && command === 'come') || comeAliasWords > 0;
    if (isComeCommand) {
      if (hasAdminPrefix && command === 'come') return refusePrefix();
      if (!comeConfig.enabled) return;

      const mainPermissions = await getMainPermissions();
      const allowed = await hasAdminCommandPermission(message.member, mainPermissions.come_role_id, 'ادمن ستريس');
      if (!allowed) return message.reply('❌ لا تمتلك صلاحية أمر الاستدعاء!');

      const targetMember = await resolveExplicitTarget(message.guild, commandWords.slice(comeAliasWords || 1));
      if (!targetMember) return replyUsage(message, 'come', 'لم تحدّد العضو — منشن أو آيدي.', comeConfig.aliases, [mainPermissions.come_role_id]);

      try {
        // 🧩 نفس المنطق المستخدم في أمر السلاش /come (مصدر واحد في customCommands.js)
        const comeResult = buildComePayload(comeConfig, {
          adminTag: message.author.tag,
          memberTag: targetMember.user.tag,
          channelMention: message.channel.toString(),
          messageUrl: message.url
        });

        await targetMember.send(comeResult.payload);
        return message.reply(`✅ تم إرسال إشعار استدعاء بالخاص لـ ${targetMember}.`);
      } catch (err) {
        return message.reply('❌ تعذر إرسال رسالة بالخاص للشخص.');
      }
    }

    const sayConfig = await getSayCommandConfig(pool);
    const sayAliasWords = aliasWordCount(sayConfig.aliases, commandWords);
    const isSayCommand = (hasAdminPrefix && command === 'say') || sayAliasWords > 0;
    if (isSayCommand) {
      if (hasAdminPrefix && command === 'say') return refusePrefix();
      if (!sayConfig.enabled) return;

      const mainPermissions = await getMainPermissions();
      const allowed = await hasAdminCommandPermission(message.member, mainPermissions.say_role_id, 'ادمن ستريس');
      if (!allowed) return message.reply('❌ لا تمتلك صلاحية استخدام أمر التحدث!');

      // 🧩 نفس المنطق المستخدم في أمر السلاش /say (مصدر واحد في customCommands.js)
      const sayResult = buildSayPayload(sayConfig, commandWords.slice(sayAliasWords || 1).join(' '));
      if (sayResult.error) return replyUsage(message, 'say', sayResult.error, sayConfig.aliases, [mainPermissions.say_role_id]);

      if (sayConfig.deleteInvocation) await message.delete().catch(() => {});
      return message.channel.send(sayResult.payload);
    }

  }

  const ownerLogConfig = await getCommandControlConfig(pool).catch(err => {
    console.error('❌ تعذر تحميل إعدادات !logowner:', err);
    return COMMAND_CONTROL_DEFAULTS;
  });
  // 🔓 (2026-10-02) «!» و«$» سواء: اختصار المالك يعمل بأي بريفكس.
  const ownerLogContent = message.content.trim();
  const ownerLogPrefix = (ownerLogContent[0] === PREFIX || ownerLogContent[0] === ADMIN_PREFIX) ? ownerLogContent[0] : '';
  const ownerLogHasPrefix = Boolean(ownerLogPrefix);
  const ownerLogText = ownerLogPrefix ? ownerLogContent.slice(1).trim() : ownerLogContent;
  const ownerLogRequested = (ownerLogText.split(/ +/)[0] || '').toLowerCase();
  const ownerLogAlias = resolveCommandControlAlias(ownerLogRequested, ownerLogConfig);
  const isOwnerLogCommand = (ownerLogHasPrefix && ownerLogRequested === 'logowner') || ownerLogAlias === 'logowner';
  // 🚦 !logowner صار سلاش فقط (/logchannel) — صامت تماماً، أما اختصار المالك
  // فيعمل بأي بريفكس (مجرّداً · «!» · «$»).
  if (isOwnerLogCommand && ownerLogHasPrefix && ownerLogRequested === 'logowner') {
    message.__slashCommandHandled = true;
    return;
  }
  if (isOwnerLogCommand && ownerLogConfig.ownerLog.enabled) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply('❌ يتطلب Administrator!');
    const channel = message.mentions.channels.first() || message.channel;
    state.ownerLogChannelId = channel.id;
    // 🟢 [إصلاح: مشكلة 13] حفظها في قاعدة البيانات حتى لا تُفقد عند إعادة تشغيل البوت
    try {
      await pool.query(
        `INSERT INTO bot_settings (key, value) VALUES ('owner_log_channel_id', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = $1::jsonb;`,
        [JSON.stringify(channel.id)]
      );
    } catch (err) {
      console.error('❌ خطأ أثناء حفظ قناة لوق المالك:', err);
    }
    return message.reply(`✅ تم تحديد ${channel} كقناة لوق الأخطاء.`);
  }

  // 🎫 أوامر التكت تعمل بـ «!» وبـ «$» — «$» مخصّص لأوامر التكت حسب قاعدة المالك.
  const hasTicketPrefix = message.content.startsWith(PREFIX) || message.content.startsWith(ADMIN_PREFIX);
  const ticketCommandText = hasTicketPrefix ? message.content.slice(1).trim() : message.content.trim();
  const ticketWords = ticketCommandText.split(/ +/).filter(Boolean);
  const requestedTicketCommand = (ticketWords[0] || '').toLowerCase();
  let commandControlConfig = COMMAND_CONTROL_DEFAULTS;
  try { commandControlConfig = await getCommandControlConfig(pool); } catch (err) {
    console.error('❌ تعذر تحميل إعدادات أوامر التذكرة:', err);
  }
  // 🔓 اختصار المالك لأوامر التكت يعمل بأي بريفكس وبأكثر من كلمة أيضاً.
  const ticketAliasMatch = resolveCommandControlAliasPhrase(ticketWords, commandControlConfig);
  const ticketAliasTarget = ticketAliasMatch ? ticketAliasMatch.target : null;
  const command = ticketAliasTarget || requestedTicketCommand;
  const args = ticketWords.slice(ticketAliasMatch ? ticketAliasMatch.words : 1);
  const closeConfig = await getCloseCommandConfig(pool);
  const ticketActionCommands = ['save', 'delete', 'add', 'remove', 'rename'];
  const isTicketActionCommand = ticketActionCommands.includes(command);
  const isCloseCommand = (hasTicketPrefix && command === 'close') || aliasWordCount(closeConfig.aliases, ticketWords) > 0;
  if (!hasTicketPrefix && !isCloseCommand && !(isTicketActionCommand && ticketAliasTarget)) return;
  if (isTicketActionCommand && !commandControlConfig.ticketCommands.enabled) return;
  if (isCloseCommand && !closeConfig.enabled) return;

  const ticketData = await getTicketInfo(message.channel);
  if (!ticketData) return;

  const panelRes = await pool.query('SELECT * FROM panels WHERE panel_id = $1', [ticketData.panelId]);
  const config = panelRes.rows[0];
  if (!config) return;

  let ticketOption = null;
  if (ticketData.optionId) {
    const optRes = await pool.query('SELECT * FROM panel_options WHERE option_id = $1', [ticketData.optionId]);
    ticketOption = optRes.rows[0] || null;
  }
  const ticketSettings = resolveTicketSettings(config, ticketOption);

  const permRes = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions']);
  const perms = permRes.rows[0] || {};

  const isAdmin = message.member.roles.cache.has(ticketSettings.adminRoleId);
  const isHighAdmin = message.member.roles.cache.has(ticketSettings.highAdminRoleId);
  const isOwner = message.author.id === ticketData.ownerId;

  if (isCloseCommand) {
    const closeAllowed = perms.close_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
    if (!closeAllowed) return message.reply('❌ لا تمتلك صلاحية إغلاق التذكرة!');

    await message.channel.permissionOverwrites.edit(ticketData.ownerId, { ViewChannel: false });

    const closedEmbed = new EmbedBuilder().setTitle('🔒 تم إغلاق التذكرة').setColor(0xef4444);
    const closedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_reopen').setLabel('إعادة فتح').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_save_log').setLabel('حفظ الترانسكريبت').setEmoji('📜').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('حذف التكت').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    );

    return message.channel.send({ embeds: [closedEmbed], components: [closedRow] });
  }

  if (command === 'save') {
    const saveAllowed = perms.save_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
    if (!saveAllowed) return message.reply('❌ لا تمتلك صلاحية حفظ الترانسكريبت!');

    const success = await saveTranscript(message.channel, config, message.author, ticketData);
    if (success) return message.reply('✅ تم إنشاء ملف الترانسكريبت وإرساله إلى روم اللوق!');
    return message.reply('❌ تعذر العثور على قناة اللوق.');
  }

  if (command === 'delete') {
    const deleteAllowed = perms.delete_permission === 'all_admin' ? (isAdmin || isHighAdmin) : isHighAdmin;
    if (!deleteAllowed) return message.reply('❌ لا تمتلك صلاحية حذف التذكرة!');

    await message.reply('🗑️ جاري حذف التذكرة...');
    setTimeout(() => message.channel.delete().catch(() => {}), 3000);
  }

  if (command === 'add') {
    if (!isAdmin && !isHighAdmin) return message.reply('❌ مخصص للإدارة فقط!');
    const targetMember = await resolveExplicitTarget(message.guild, args);
    if (!targetMember) return message.reply('❌ يرجى منشن الشخص!');

    await message.channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true, SendMessages: true });
    return message.reply(`✅ تم إضافة ${targetMember} إلى التذكرة.`);
  }

  if (command === 'remove') {
    if (!isAdmin && !isHighAdmin) return message.reply('❌ مخصص للإدارة فقط!');
    const targetMember = await resolveExplicitTarget(message.guild, args);
    if (!targetMember) return message.reply('❌ يرجى منشن الشخص!');

    await message.channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: false, SendMessages: false });
    return message.reply(`🚫 تم إزالة ${targetMember} من التذكرة.`);
  }

  // =================================================================
  // 🟢 [بداية أمر: تغيير اسم التذكرة (!rename)]
  // ملاحظة: أمر !r العام (في system.js) صار بحرف مختلف، فما في تعارض بينه وبين هذا الأمر.
  // =================================================================
  if (command === 'rename') {
    if (!isAdmin && !isHighAdmin) return message.reply('❌ مخصص للإدارة فقط!');

    const newName = args.join('-');
    if (!newName) return message.reply('⚠️ اكتب الاسم الجديد للتذكرة. مثال: `!rename اسم-جديد`');

    try {
      await message.channel.setName(newName);
      return message.reply(`🏷️ تم تغيير اسم التذكرة إلى: **${newName}**`);
    } catch (err) {
      console.error('خطأ أثناء تغيير اسم التذكرة:', err);
      return message.reply('❌ حدث خطأ أثناء تغيير اسم التذكرة.');
    }
  }
  // =================================================================
  // 🔴 [نهاية أمر: تغيير اسم التذكرة (!rename)]
  // =================================================================
  } catch (err) {
    console.error('❌ خطأ غير متوقع أثناء معالجة رسالة:', err);
  }
});

// ==========================================================================
// 🎫 نسخة السلاش من أوامر التذكرة (/ticket)
// تُسجَّل هنا لأنها تحتاج نفس الـ helpers القادمة من index.js
// (getTicketInfo, resolveTicketSettings, saveTranscript)، فيبقى منطق
// الصلاحيات في مصدر واحد ولا يتفرّع عن نسخة البريفكس.
// ==========================================================================
registerSystemSlashHandler('ticket', async (interaction) => {
  const say = (content) => interaction.replied || interaction.deferred
    ? interaction.followUp({ content, ephemeral: true }).catch(() => {})
    : interaction.reply({ content, ephemeral: true }).catch(() => {});

  const sub = interaction.options.getSubcommand();
  const channel = interaction.channel;
  if (!channel) return say('❌ تعذر الوصول إلى الروم الحالي.');

  // نفس بوابات التفعيل المستخدمة في نسخة البريفكس
  let controlConfig = COMMAND_CONTROL_DEFAULTS;
  try { controlConfig = await getCommandControlConfig(pool); } catch (err) {
    console.error('❌ تعذر تحميل إعدادات أوامر التذكرة:', err);
  }
  const closeConfig = await getCloseCommandConfig(pool);
  if (sub === 'close' && !closeConfig.enabled) return say('⛔ أمر إغلاق التذكرة متوقف حالياً من لوحة التحكم.');
  if (sub !== 'close' && !controlConfig.ticketCommands.enabled) return say('⛔ أوامر التذكرة متوقفة حالياً من لوحة التحكم.');

  const ticketData = await getTicketInfo(channel);
  if (!ticketData) return say('❌ هذا الأمر يُستخدم داخل روم التذكرة فقط.');

  const panelRes = await pool.query('SELECT * FROM panels WHERE panel_id = $1', [ticketData.panelId]);
  const config = panelRes.rows[0];
  if (!config) return say('❌ تعذر العثور على إعدادات هذه التذكرة.');

  let ticketOption = null;
  if (ticketData.optionId) {
    const optRes = await pool.query('SELECT * FROM panel_options WHERE option_id = $1', [ticketData.optionId]);
    ticketOption = optRes.rows[0] || null;
  }
  const ticketSettings = resolveTicketSettings(config, ticketOption);

  const permRes = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions']);
  const perms = permRes.rows[0] || {};

  const isAdmin = interaction.member.roles.cache.has(ticketSettings.adminRoleId);
  const isHighAdmin = interaction.member.roles.cache.has(ticketSettings.highAdminRoleId);
  const isOwner = interaction.user.id === ticketData.ownerId;

  if (sub === 'close') {
    const closeAllowed = perms.close_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
    if (!closeAllowed) return say('❌ لا تمتلك صلاحية إغلاق التذكرة!');

    await channel.permissionOverwrites.edit(ticketData.ownerId, { ViewChannel: false });
    const closedEmbed = new EmbedBuilder().setTitle('🔒 تم إغلاق التذكرة').setColor(0xef4444);
    const closedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_reopen').setLabel('إعادة فتح').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_save_log').setLabel('حفظ الترانسكريبت').setEmoji('📜').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_delete').setLabel('حذف التكت').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    );
    await interaction.reply({ content: '🔒 جاري إغلاق التذكرة...', ephemeral: true });
    return channel.send({ embeds: [closedEmbed], components: [closedRow] });
  }

  if (sub === 'save') {
    const saveAllowed = perms.save_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
    if (!saveAllowed) return say('❌ لا تمتلك صلاحية حفظ الترانسكريبت!');
    await interaction.deferReply({ ephemeral: true });
    const success = await saveTranscript(channel, config, interaction.user, ticketData);
    return say(success
      ? '✅ تم إنشاء ملف الترانسكريبت وإرساله إلى روم اللوق!'
      : '❌ تعذر العثور على قناة اللوق.');
  }

  if (sub === 'delete') {
    const deleteAllowed = perms.delete_permission === 'all_admin' ? (isAdmin || isHighAdmin) : isHighAdmin;
    if (!deleteAllowed) return say('❌ لا تمتلك صلاحية حذف التذكرة!');
    await interaction.reply({ content: '🗑️ جاري حذف التذكرة...', ephemeral: true });
    setTimeout(() => channel.delete().catch(() => {}), 3000);
    return;
  }

  if (sub === 'add' || sub === 'remove') {
    if (!isAdmin && !isHighAdmin) return say('❌ مخصص للإدارة فقط!');
    const targetUser = interaction.options.getUser('member');
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) return say('❌ العضو غير موجود في هذا السيرفر.');

    const allow = sub === 'add';
    await channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: allow, SendMessages: allow });
    return say(allow
      ? `✅ تم إضافة <@${targetMember.id}> إلى التذكرة.`
      : `🚫 تم إزالة <@${targetMember.id}> من التذكرة.`);
  }

  // rename
  if (!isAdmin && !isHighAdmin) return say('❌ مخصص للإدارة فقط!');
  // نفس تحويل المسافات إلى شرطات المستخدم في !rename
  const newName = interaction.options.getString('name').trim().split(/ +/).filter(Boolean).join('-');
  if (!newName) return say('⚠️ اكتب الاسم الجديد للتذكرة.');
  try {
    await channel.setName(newName);
    return say(`🏷️ تم تغيير اسم التذكرة إلى: **${newName}**`);
  } catch (err) {
    console.error('خطأ أثناء تغيير اسم التذكرة:', err);
    return say('❌ حدث خطأ أثناء تغيير اسم التذكرة.');
  }
});

};
