const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const getDashboardUrl = require('./dashboardUrl');

// يستقبل client, pool, ودوال المساعدة (helpers), وحالة استلام التذاكر (claimState), ودالة قائمة المساعدة الموحّدة (systemCommands) من index.js
module.exports = function registerInteractionCreateEvent(client, pool, helpers, claimState, systemCommands) {
  const { sendLogError, getTicketInfo, resolveTicketSettings, saveTranscript, createHelpEmbed, handleTicketCreation } = helpers;

client.on('interactionCreate', async (interaction) => {
  try {
    const dashboardUrl = getDashboardUrl();

    // 📖 /help انتقل إلى النظام الموحّد (slashCommands.js + systemSlashBridge)
    // ليحصل على نسخة بريفكس (!help) وبطاقة في صفحة الأوامر مثل بقية الأوامر.

    // 1. فتح نافذة التقديم (Modal)
    if (interaction.isButton() && interaction.customId === 'start_apply_form') {
      const result = await pool.query('SELECT * FROM apply_setup WHERE id = $1', ['main_apply']);
      const appData = result.rows[0];
      if (!appData) return interaction.reply({ content: '❌ لم يتم ضبط إعدادات التقديم بعد من لوحة التحكم!', ephemeral: true });

      const modal = new ModalBuilder()
        .setCustomId('submit_apply_modal')
        .setTitle('نموذج التقديم للإدارة');

      const inputs = [];
      if (appData.q1) inputs.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q1').setLabel(appData.q1.substring(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(true)));
      if (appData.q2) inputs.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q2').setLabel(appData.q2.substring(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(true)));
      if (appData.q3) inputs.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q3').setLabel(appData.q3.substring(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(true)));
      if (appData.q4) inputs.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q4').setLabel(appData.q4.substring(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(true)));
      if (appData.q5) inputs.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q5').setLabel(appData.q5.substring(0, 45)).setStyle(TextInputStyle.Short).setMaxLength(1000).setRequired(false)));

      modal.addComponents(inputs);
      return interaction.showModal(modal);
    }

    // 2. معالجة إرسال نموذج التقديم
    if (interaction.isModalSubmit() && interaction.customId === 'submit_apply_modal') {
      await interaction.deferReply({ ephemeral: true });

      const result = await pool.query('SELECT * FROM apply_setup WHERE id = $1', ['main_apply']);
      const appData = result.rows[0];

      // 🛡️ [إصلاح] لو حُذفت إعدادات التقديم بين فتح النموذج وإرساله، كان الوصول
      // إلى appData.review_channel_id يرمي TypeError فلا يصل المتقدّم أي رد إطلاقاً.
      if (!appData) return interaction.editReply({ content: '❌ لم يتم ضبط إعدادات التقديم بعد من لوحة التحكم!' });

      const reviewChannel = await interaction.guild.channels.fetch(appData.review_channel_id).catch(() => null);
      if (!reviewChannel) return interaction.editReply({ content: '❌ تعذر الوصول لروم مراجعة التقديمات!' });

      const member = interaction.member;
      const joinedServerDays = Math.floor((Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24));
      const joinedDiscordDays = Math.floor((Date.now() - interaction.user.createdTimestamp) / (1000 * 60 * 60 * 24));

      let descText = `👤 **صاحب التقديم:** ${interaction.user} (\`${interaction.user.id}\`)\n\n`;

      if (appData.q1) descText += `**السؤال الأول : ${appData.q1}**\n\`\`\`${interaction.fields.getTextInputValue('q1')}\`\`\`\n`;
      if (appData.q2) descText += `**السؤال الثاني : ${appData.q2}**\n\`\`\`${interaction.fields.getTextInputValue('q2')}\`\`\`\n`;
      if (appData.q3) descText += `**السؤال الثالث : ${appData.q3}**\n\`\`\`${interaction.fields.getTextInputValue('q3')}\`\`\`\n`;
      if (appData.q4) descText += `**السؤال الرابع : ${appData.q4}**\n\`\`\`${interaction.fields.getTextInputValue('q4')}\`\`\`\n`;
      if (appData.q5 && appData.q5.trim() !== '') descText += `**السؤال الخامس : ${appData.q5}**\n\`\`\`${interaction.fields.getTextInputValue('q5')}\`\`\`\n`;

      descText += `\n**انضم للسيرفر منذ :** \`${joinedServerDays} days ago\`\n**انضم للديسكورد منذ :** \`${joinedDiscordDays} days ago\``;

      // 🛡️ [إصلاح] حد وصف الإيمبد في ديسكورد 4096 حرفاً. مع خمس إجابات طويلة كان
      // الوصف يتجاوز الحد فيرفض ديسكورد الرسالة، فيضيع التقديم بالكامل ولا يصل
      // المتقدّم أي رد (تبقى الاستجابة مؤجلة بلا تعديل). الآن يُختصر الوصف بأمان.
      if (descText.length > 4096) {
        descText = `${descText.slice(0, 4040)}\n\n… (تم اختصار التقديم لتجاوزه حد ديسكورد)`;
      }

      const reviewEmbed = new EmbedBuilder()
        .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
        .setDescription(descText)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setColor(0xeab308)
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`apply_accept_${interaction.user.id}`).setLabel('قبول').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId(`apply_reject_${interaction.user.id}`).setLabel('رفض').setStyle(ButtonStyle.Danger).setEmoji('❌'),
        new ButtonBuilder().setCustomId(`apply_reject_reason_${interaction.user.id}`).setLabel('رفض مع سبب').setStyle(ButtonStyle.Secondary).setEmoji('💡')
      );

      await reviewChannel.send({ embeds: [reviewEmbed], components: [actionRow] });
      return interaction.editReply({ content: '✅ تم إرسال تقديمك بنجاح! سيتم مراجعته من قبل الإدارة العليا.' });
    }

    // 3. أزرار القبول والرفض للتقديم (مع إعطاء الرتبة التلقائية)
    if (interaction.isButton() && (interaction.customId.startsWith('apply_accept_') || interaction.customId.startsWith('apply_reject_'))) {
      const result = await pool.query('SELECT * FROM apply_setup WHERE id = $1', ['main_apply']);
      const appData = result.rows[0];

      // 🛡️ [إصلاح] لو حُذفت إعدادات التقديم بعد نشر التقديمات، كان الوصول إلى
      // appData.high_admin_role_id يرمي TypeError فيظهر "فشل التفاعل" بلا تفسير.
      if (!appData) {
        return interaction.reply({ content: '❌ لم يتم ضبط إعدادات التقديم بعد من لوحة التحكم!', ephemeral: true });
      }

      if (!interaction.member.roles.cache.has(appData.high_admin_role_id) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ هذا الأمر مخصص للإدارة العليا فقط!', ephemeral: true });
      }

      const isAccept = interaction.customId.startsWith('apply_accept_');
      const isRejectReason = interaction.customId.startsWith('apply_reject_reason_');
      const targetUserId = interaction.customId.split('_').pop();

      // فتح نافذة كتابة سبب الرفض
      if (isRejectReason) {
        const modal = new ModalBuilder()
          .setCustomId(`reject_modal_reason_${targetUserId}`)
          .setTitle('سبب رفض التقديم');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reject_reason')
          .setLabel('سبب الرفض:')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return interaction.showModal(modal);
      }

      await interaction.deferUpdate();

      const resultsChannel = await interaction.guild.channels.fetch(appData.results_channel_id).catch(() => null);
      const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

      // إعطاء الرتبة تلقائياً في حال القبول
      if (isAccept && targetMember && appData.accepted_role_id) {
        await targetMember.roles.add(appData.accepted_role_id).catch(err => console.error('تعذر إعطاء الرتبة للمقبول:', err));
      }

      const resultEmbed = new EmbedBuilder()
        .setThumbnail(targetMember ? targetMember.user.displayAvatarURL() : interaction.guild.iconURL())
        .setColor(isAccept ? 0x10b981 : 0xef4444)
        .setTimestamp();

      if (isAccept) {
        resultEmbed.setTitle(`تم قبول تقديم ${interaction.guild.name}`)
          .addFields(
            { name: 'صاحب التقديم :', value: targetMember ? `${targetMember}` : `<@${targetUserId}>`, inline: false },
            { name: 'الإداري :', value: `${interaction.user}`, inline: false }
          );
      } else {
        resultEmbed.setTitle(`تم رفض تقديم ${interaction.guild.name}`)
          .addFields(
            { name: 'صاحب التقديم :', value: targetMember ? `${targetMember}` : `<@${targetUserId}>`, inline: false },
            { name: 'الإداري :', value: `${interaction.user}`, inline: false }
          );
      }

      if (resultsChannel) {
        await resultsChannel.send({ embeds: [resultEmbed] });
      }

      // تعطيل الأزرار بعد اتخاذ القرار
      const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
      disabledRow.components.forEach(c => c.setDisabled(true));
      await interaction.message.edit({ components: [disabledRow] });

      return;
    }

    // 4. معالجة Modal سبب الرفض
    if (interaction.isModalSubmit() && interaction.customId.startsWith('reject_modal_reason_')) {
      await interaction.deferUpdate();

      const targetUserId = interaction.customId.replace('reject_modal_reason_', '');
      const reason = interaction.fields.getTextInputValue('reject_reason');

      const result = await pool.query('SELECT * FROM apply_setup WHERE id = $1', ['main_apply']);
      const appData = result.rows[0];

      const resultsChannel = await interaction.guild.channels.fetch(appData.results_channel_id).catch(() => null);
      const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);

      const resultEmbed = new EmbedBuilder()
        .setThumbnail(targetMember ? targetMember.user.displayAvatarURL() : interaction.guild.iconURL())
        .setTitle(`تم رفض تقديم ${interaction.guild.name}`)
        .addFields(
          { name: 'صاحب التقديم :', value: targetMember ? `${targetMember}` : `<@${targetUserId}>`, inline: false },
          { name: 'الإداري :', value: `${interaction.user}`, inline: false },
          { name: 'السبب :', value: `\`\`\`${reason}\`\`\``, inline: false }
        )
        .setColor(0xef4444)
        .setTimestamp();

      if (resultsChannel) {
        await resultsChannel.send({ embeds: [resultEmbed] });
      }

      const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
      disabledRow.components.forEach(c => c.setDisabled(true));
      await interaction.message.edit({ components: [disabledRow] });

      return;
    }

    // التفاعل مع قائمة خيارات التذاكر
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_select_')) {
      const selectedOptionId = interaction.values[0];
      return handleTicketCreation(interaction, selectedOptionId);
    }

    if (interaction.isButton() && interaction.customId.startsWith('ticket_btn_')) {
      const optionId = interaction.customId.replace('ticket_btn_', '');
      return handleTicketCreation(interaction, optionId);
    }

    if (!interaction.guild || !interaction.channel.topic) return;
    const ticketData = await getTicketInfo(interaction.channel);
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

    const isAdmin = interaction.member.roles.cache.has(ticketSettings.adminRoleId);
    const isHighAdmin = interaction.member.roles.cache.has(ticketSettings.highAdminRoleId);
    const isOwner = interaction.user.id === ticketData.ownerId;
    const isMediator = !!(config.mediator_role_id && interaction.member.roles.cache.has(config.mediator_role_id));

    // 🟢 حالة الاستلام (إدارة/وسطاء) تُقرأ من قاعدة البيانات وليس من موضوع القناة
    const claimRow = await claimState.getClaimState(interaction.channel.id);

    // زر استلام التذكرة (إدارة) — يظهر فقط إذا فعّله صاحب اللوحة من الموقع
    // 🟢 تم إصلاحه: الآن التذكرة تُستلم من شخص واحد فقط (لا يمكن لأكثر من إداري استلامها بنفس الوقت)
    // 🟢 حالة الاستلام تُخزَّن بقاعدة البيانات (وليس بموضوع القناة) لتجنب رايت ليمت ديسكورد الصارم على تعديل الموضوع
    if (interaction.isButton() && interaction.customId === 'ticket_claim_admin_btn') {
      if (!isAdmin && !isHighAdmin) return interaction.reply({ content: '❌ لا تمتلك صلاحية استلام التذكرة (إدارة)!', ephemeral: true });

      if (claimRow.claimed_admin_by) {
        return interaction.reply({ content: `❌ التذكرة مستلمة بالفعل (إدارة) من قبل <@${claimRow.claimed_admin_by}>!`, ephemeral: true });
      }

      // 🟢 [إصلاح: الزر لا يستجيب] نؤكد التفاعل فوراً قبل أي عملية بطيئة (تعديل صلاحيات القناة)
      // حتى لا يتجاوز الرد مهلة الـ3 ثواني المسموحة من ديسكورد ويظهر الزر معطّلاً
      await interaction.deferReply();

      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true });

      await pool.query(`
        INSERT INTO claim_stats (user_id, admin_claims) VALUES ($1, 1)
        ON CONFLICT (user_id) DO UPDATE SET admin_claims = claim_stats.admin_claims + 1;
      `, [interaction.user.id]);

      await claimState.setClaimedAdmin(interaction.channel.id, interaction.user.id);

      const claimedEmbed = new EmbedBuilder()
        .setDescription(`📌 **تم استلام التذكرة (إدارة) بواسطة:** ${interaction.user}\nلا يمكن لأحد الكتابة في هذه التذكرة الآن سوى الإداري المستلم والإدارة العليا.`)
        .setColor('#22c55e');

      const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_cancel_claim_admin_btn').setLabel('إلغاء الاستلام').setEmoji('🚫').setStyle(ButtonStyle.Danger)
      );

      return interaction.editReply({ embeds: [claimedEmbed], components: [cancelRow] });
    }

    // 🟢 [جديد] زر إلغاء استلام التذكرة (إدارة)
    if (interaction.isButton() && interaction.customId === 'ticket_cancel_claim_admin_btn') {
      if (!claimRow.claimed_admin_by) {
        return interaction.reply({ content: '❌ لا يوجد استلام (إدارة) نشط لإلغائه!', ephemeral: true });
      }
      if (interaction.user.id !== claimRow.claimed_admin_by && !isHighAdmin) {
        return interaction.reply({ content: '❌ فقط الإداري المستلم أو الإدارة العليا يمكنهم إلغاء الاستلام!', ephemeral: true });
      }

      // 🟢 [إصلاح: الزر لا يستجيب] نؤكد التفاعل فوراً قبل أي عملية بطيئة (تعديل صلاحيات القناة)
      await interaction.deferReply();

      const previousClaimerId = claimRow.claimed_admin_by;
      await interaction.channel.permissionOverwrites.edit(previousClaimerId, { SendMessages: null }).catch(() => {});

      // 🟢 خصم تلقائي من بروفايل المستلم عند إلغاء الاستلام (العداد = الاستلامات النشطة فقط)
      await pool.query(`
        UPDATE claim_stats SET admin_claims = GREATEST(0, admin_claims - 1) WHERE user_id = $1;
      `, [previousClaimerId]);

      await claimState.setClaimedAdmin(interaction.channel.id, null);

      // لا نعيد فتح الكتابة للجميع إلا إذا لم يعد هناك استلام وسطاء نشط أيضاً
      if (!claimRow.claimed_mediator_by) {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }).catch(() => {});
      }

      const cancelledEmbed = new EmbedBuilder()
        .setDescription(`🚫 **تم إلغاء استلام التذكرة (إدارة) بواسطة:** ${interaction.user}\nأصبح بإمكان الإداريين استلام التذكرة من جديد.`)
        .setColor('#f97316');

      return interaction.editReply({ embeds: [cancelledEmbed] });
    }

    // زر استلام التذكرة (وسطاء) — يظهر فقط إذا فعّله صاحب اللوحة من الموقع
    // 🟢 تم إصلاحه: الآن التذكرة تُستلم من شخص واحد فقط (لا يمكن لأكثر من وسيط استلامها بنفس الوقت)
    // 🟢 حالة الاستلام تُخزَّن بقاعدة البيانات (وليس بموضوع القناة) لتجنب رايت ليمت ديسكورد الصارم على تعديل الموضوع
    if (interaction.isButton() && interaction.customId === 'ticket_claim_mediator_btn') {
      if (!isMediator && !isHighAdmin) return interaction.reply({ content: '❌ لا تمتلك صلاحية استلام التذكرة (وسطاء)!', ephemeral: true });

      if (claimRow.claimed_mediator_by) {
        return interaction.reply({ content: `❌ التذكرة مستلمة بالفعل (وسطاء) من قبل <@${claimRow.claimed_mediator_by}>!`, ephemeral: true });
      }

      // 🟢 [إصلاح: الزر لا يستجيب] نؤكد التفاعل فوراً قبل أي عملية بطيئة (تعديل صلاحيات القناة)
      await interaction.deferReply();

      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: true });

      await pool.query(`
        INSERT INTO claim_stats (user_id, mediator_claims) VALUES ($1, 1)
        ON CONFLICT (user_id) DO UPDATE SET mediator_claims = claim_stats.mediator_claims + 1;
      `, [interaction.user.id]);

      await claimState.setClaimedMediator(interaction.channel.id, interaction.user.id);

      const claimedEmbed = new EmbedBuilder()
        .setDescription(`🤝 **تم استلام التذكرة (وسطاء) بواسطة:** ${interaction.user}\nلا يمكن لأحد الكتابة في هذه التذكرة الآن سوى الوسيط المستلم والإدارة العليا.`)
        .setColor('#22c55e');

      const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_cancel_claim_mediator_btn').setLabel('إلغاء الاستلام').setEmoji('🚫').setStyle(ButtonStyle.Danger)
      );

      return interaction.editReply({ embeds: [claimedEmbed], components: [cancelRow] });
    }

    // 🟢 [جديد] زر إلغاء استلام التذكرة (وسطاء)
    if (interaction.isButton() && interaction.customId === 'ticket_cancel_claim_mediator_btn') {
      if (!claimRow.claimed_mediator_by) {
        return interaction.reply({ content: '❌ لا يوجد استلام (وسطاء) نشط لإلغائه!', ephemeral: true });
      }
      if (interaction.user.id !== claimRow.claimed_mediator_by && !isHighAdmin) {
        return interaction.reply({ content: '❌ فقط الوسيط المستلم أو الإدارة العليا يمكنهم إلغاء الاستلام!', ephemeral: true });
      }

      // 🟢 [إصلاح: الزر لا يستجيب] نؤكد التفاعل فوراً قبل أي عملية بطيئة (تعديل صلاحيات القناة)
      await interaction.deferReply();

      const previousClaimerId = claimRow.claimed_mediator_by;
      await interaction.channel.permissionOverwrites.edit(previousClaimerId, { SendMessages: null }).catch(() => {});

      // 🟢 خصم تلقائي من بروفايل المستلم عند إلغاء الاستلام (العداد = الاستلامات النشطة فقط)
      await pool.query(`
        UPDATE claim_stats SET mediator_claims = GREATEST(0, mediator_claims - 1) WHERE user_id = $1;
      `, [previousClaimerId]);

      await claimState.setClaimedMediator(interaction.channel.id, null);

      // لا نعيد فتح الكتابة للجميع إلا إذا لم يعد هناك استلام إدارة نشط أيضاً
      if (!claimRow.claimed_admin_by) {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null }).catch(() => {});
      }

      const cancelledEmbed = new EmbedBuilder()
        .setDescription(`🚫 **تم إلغاء استلام التذكرة (وسطاء) بواسطة:** ${interaction.user}\nأصبح بإمكان الوسطاء استلام التذكرة من جديد.`)
        .setColor('#f97316');

      return interaction.editReply({ embeds: [cancelledEmbed] });
    }

    if (interaction.isButton() && interaction.customId === 'ticket_close_req') {
      const closeAllowed = perms.close_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
      if (!closeAllowed) return interaction.reply({ content: '❌ لا تمتلك الصلاحية إغلاق التذكرة!', ephemeral: true });

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_confirm_close').setLabel('تأكيد الإغلاق').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_cancel_close').setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ content: '⚠️ هل أنت متأكد من إغلاق التذكرة؟', components: [confirmRow] });
    }

    if (interaction.isButton() && interaction.customId === 'ticket_cancel_close') {
      const cancelAllowed = perms.close_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
      if (!cancelAllowed) return interaction.reply({ content: '❌ لا تمتلك الصلاحية إغلاق التذكرة!', ephemeral: true });
      return interaction.message.delete().catch(() => {});
    }

    if (interaction.isButton() && interaction.customId === 'ticket_confirm_close') {
      const confirmCloseAllowed = perms.close_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
      if (!confirmCloseAllowed) return interaction.reply({ content: '❌ لا تمتلك الصلاحية إغلاق التذكرة!', ephemeral: true });

      await interaction.message.delete().catch(() => {});
      await interaction.channel.permissionOverwrites.edit(ticketData.ownerId, { ViewChannel: false });

      const closedEmbed = new EmbedBuilder().setTitle('🔒 تم إغلاق التذكرة').setColor(0xef4444);
      const closedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_reopen').setLabel('إعادة فتح').setEmoji('🔓').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_save_log').setLabel('حفظ الترانسكريبت').setEmoji('📜').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket_delete').setLabel('حذف التكت').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      );

      return interaction.channel.send({ embeds: [closedEmbed], components: [closedRow] });
    }

    if (interaction.isButton() && interaction.customId === 'ticket_reopen') {
      const reopenAllowed = perms.close_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
      if (!reopenAllowed) return interaction.reply({ content: '❌ لا تمتلك صلاحية إعادة فتح التذكرة!', ephemeral: true });

      await interaction.message.delete().catch(() => {});
      await interaction.channel.permissionOverwrites.edit(ticketData.ownerId, { ViewChannel: true });
      return interaction.channel.send({ content: `🔓 تم إعادة فتح التذكرة بواسطة ${interaction.user}` });
    }

    if (interaction.isButton() && interaction.customId === 'ticket_save_log') {
      const saveAllowed = perms.save_permission === 'admin_only' ? (isAdmin || isHighAdmin) : (isAdmin || isHighAdmin || isOwner);
      if (!saveAllowed) return interaction.reply({ content: '❌ لا تمتلك صلاحية حفظ الترانسكريبت!', ephemeral: true });

      await interaction.deferReply();
      const success = await saveTranscript(interaction.channel, config, interaction.user, ticketData);
      if (success) return interaction.editReply({ content: '✅ تم إنشاء ملف الترانسكريبت وإرساله إلى روم اللوق!' });
      return interaction.editReply({ content: '❌ تعذر العثور على قناة اللوق.' });
    }

    if (interaction.isButton() && interaction.customId === 'ticket_delete') {
      const deleteAllowed = perms.delete_permission === 'all_admin' ? (isAdmin || isHighAdmin) : isHighAdmin;
      if (!deleteAllowed) return interaction.reply({ content: '❌ لا تمتلك صلاحية حذف التكت!', ephemeral: true });

      await interaction.reply({ content: '🗑️ سيتم حذف التذكرة خلال 3 ثوانٍ...' });
      await pool.query('DELETE FROM ticket_claims WHERE channel_id = $1', [interaction.channel.id]).catch(() => {});
      setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
    }

  } catch (err) {
    sendLogError('خطأ غير متوقع:', err);
  }
});

};
