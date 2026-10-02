const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');

// يستقبل client (لإرسال لوق الأخطاء) و pool (قاعدة البيانات) و state (لمعرفة روم لوق الأخطاء) من index.js
module.exports = function createTicketHelpers(client, pool, state) {

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

async function sendLogError(title, error) {
  console.error(title, error);
  if (state.ownerLogChannelId) {
    try {
      const channel = await client.channels.fetch(state.ownerLogChannelId);
      if (channel) {
        // 🛡️ [إصلاح] حدود ديسكورد: قيمة الحقل 1024 حرفاً كحد أقصى ولا تقبل قيمة فارغة.
        // قبل الإصلاح كان أي خطأ طويل (مثل stack trace) أو عنوان فارغ يجعل ديسكورد
        // يرفض الإيمبد، فيبتلعه catch الفارغ أدناه ولا يصل تنبيه الخطأ للمالك إطلاقاً —
        // أي أن نظام تنبيه الأخطاء كان يفشل تحديداً عند الأخطاء المهمة.
        const clampField = (text, max = 1000) => {
          const value = String(text === undefined || text === null || text === '' ? 'غير متوفر' : text);
          return value.length > max ? `${value.slice(0, max)}\n… (تم اختصار الرسالة)` : value;
        };

        const details = error && error.stack ? error.stack : (error && error.message) || error;

        const errEmbed = new EmbedBuilder()
          .setTitle(`⚠️ تنبيه خطأ في البوت`)
          .addFields(
            { name: 'الوصف:', value: clampField(title) },
            { name: 'التفاصيل:', value: `\`\`\`js\n${clampField(details, 900)}\n\`\`\`` }
          )
          .setColor(0xef4444)
          .setTimestamp();
        await channel.send({ embeds: [errEmbed] });
      }
    } catch (e) {
      // 🛡️ [إصلاح] كان catch فارغاً تماماً، فتختفي أسباب فشل إرسال تنبيه الخطأ بلا أثر.
      console.error('❌ تعذر إرسال تنبيه الخطأ إلى روم لوق المالك:', e.message || e);
    }
  }
}

async function getTicketInfo(channel) {
  if (!channel.topic) return null;
  try { return JSON.parse(channel.topic); } catch (e) { return null; }
}

// دمج إعدادات الزر الخاصة (إن وجدت) مع إعدادات اللوحة الافتراضية
function resolveTicketSettings(config, option) {
  return {
    categoryId: (option && option.category_id) ? option.category_id : config.category_id,
    adminRoleId: (option && option.admin_role_id) ? option.admin_role_id : config.admin_role_id,
    highAdminRoleId: (option && option.high_admin_role_id) ? option.high_admin_role_id : config.high_admin_role_id
  };
}

async function saveTranscript(channel, config, user, ticketData) {
  const logChannel = channel.guild.channels.cache.get(config.log_channel_id);
  if (!logChannel) return false;

  try {
    const attachment = await discordTranscripts.createTranscript(channel, {
      limit: -1,
      returnType: 'attachment',
      filename: `${channel.name}-transcript.html`,
      saveImages: true,
      footerText: 'تمت أرشفة التكت بنجاح',
      poweredBy: false
    });

    const logEmbed = new EmbedBuilder()
      .setTitle('🌐 سجل ترانسكريبت تفاعلي (HTML)')
      .setDescription('تحميل الملف المرفق أدناه وفتحه بداخل المتصفح يمنحك التكت الكامل بأسلوب الديسكورد الرسمي.')
      .addFields(
        { name: 'التكت:', value: channel.name, inline: true },
        { name: 'صاحب التكت:', value: `<@${ticketData.ownerId}>`, inline: true },
        { name: 'تم الحفظ بواسطة:', value: `${user}`, inline: true }
      )
      .setColor(0x0284c7)
      .setTimestamp();

    await logChannel.send({ embeds: [logEmbed], files: [attachment] });
    return true;
  } catch (err) {
    sendLogError('خطأ أثناء إنشاء الترانسكريبت التفاعلي:', err);
    return false;
  }
}

// 🟢 [إصلاح: دعم أكثر من رتبة لكل صلاحية] يفكك النص المخزّن (قد يحتوي أكثر من آيدي
// رتبة مفصولة بفاصلة ,) ويتحقق إن كان العضو يملك أياً منها
function hasAnyOfRoles(member, rolesString) {
  if (!rolesString) return false;
  return String(rolesString).split(',').map(id => id.trim()).filter(Boolean).some(id => member.roles.cache.has(id));
}

async function hasAdminCommandPermission(member, specificRoleId, defaultRoleName) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const result = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions']);
  const perms = result.rows[0];
  if (!perms) return false;

  if (hasAnyOfRoles(member, perms.all_commands_role_id)) return true;
  if (hasAnyOfRoles(member, specificRoleId)) return true;

  // 🔷 إذا تُرك الحقل فارغاً بلوحة التحكم، تُستخدم رتبة افتراضية بالاسم (كما في !رتبة/!شرتبة)
  if (!specificRoleId && defaultRoleName) {
    const defaultRole = member.guild.roles.cache.find(r => r.name === defaultRoleName);
    if (defaultRole && member.roles.cache.has(defaultRole.id)) return true;
  }

  return false;
}

function createHelpEmbed(dashboardUrl) {
  return new EmbedBuilder()
    .setTitle('📖 قائمة أوامر البوت والمعلومات الشاملة')
    .setDescription(`أهلاً بك! كل الأوامر تعمل بالسلاش (/) — وأوامر التكت وحدها تعمل بالبريفكس (!).\n\n🌐 **لوحة تحكم البوت:** [اضغط هنا للوصول للوحة التحكم](${dashboardUrl})`)
    .addFields(
      { 
        name: '⚙️ الأوامر الإدارية العامة:', 
        value: 
          `• **\`/tax <المبلغ>\`**\n` +
          `• **\`/come <@العضو>\`**\n` +
          `• **\`/say <الرسالة>\`**\n`
      },
      { 
        name: '🎫 أوامر إدارة التذاكر (داخل التكت):', 
        value: 
          `• **\`!close\`**\n` +
          `• **\`!save\`**\n` +
          `• **\`!delete\`**\n` +
          `• **\`!add <@العضو>\`**\n` +
          `• **\`!remove <@العضو>\`**\n` +
          `• **\`!rename <الاسم_الجديد>\`**\n`
      }
    )
    .setColor(0x0284c7)
    .setFooter({ text: 'تمت البرمجة بواسطة المبرمج: قتادة (Qtada)' });
}

// دالة فتح التذكرة
async function handleTicketCreation(interaction, optionId) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const optRes = await pool.query('SELECT * FROM panel_options WHERE option_id = $1', [optionId]);
    const option = optRes.rows[0];
    if (!option) return interaction.editReply({ content: '❌ هذا الخيار غير مسجل في قاعدة البيانات!' });

    const panelRes = await pool.query('SELECT * FROM panels WHERE panel_id = $1', [option.panel_id]);
    const config = panelRes.rows[0];

    const settings = resolveTicketSettings(config, option);

    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: settings.categoryId,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: settings.adminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: settings.highAdminRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    });

    await pool.query(`
      INSERT INTO stats (key, total_tickets) VALUES ('main_stats', 1)
      ON CONFLICT (key) DO UPDATE SET total_tickets = stats.total_tickets + 1;
    `);

    await ticketChannel.setTopic(JSON.stringify({ ownerId: interaction.user.id, panelId: config.panel_id, optionId: option.option_id }));

    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`تذكرة دعم جديدة | ${option.label}`)
      .setDescription(`${option.welcome_message}\n\n👤 **صاحب التذكرة:** ${interaction.user}`)
      .setColor(config.color || 0x0284c7);

    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close_req').setLabel('إغلاق التذكرة').setEmoji('🔒').setStyle(ButtonStyle.Danger)
    );

    // زر استلام الإدارة (اختياري) — يظهر فقط إذا كان مفعّلاً بإعدادات اللوحة من الموقع
    if (config.claim_admin_enabled) {
      buttonsRow.addComponents(
        new ButtonBuilder().setCustomId('ticket_claim_admin_btn').setLabel('استلام (إدارة)').setEmoji('📌').setStyle(ButtonStyle.Primary)
      );
    }

    // زر استلام الوسطاء (اختياري) — يظهر فقط إذا كان مفعّلاً بإعدادات اللوحة من الموقع
    if (config.claim_mediator_enabled) {
      buttonsRow.addComponents(
        new ButtonBuilder().setCustomId('ticket_claim_mediator_btn').setLabel('استلام (وسطاء)').setEmoji('🤝').setStyle(ButtonStyle.Secondary)
      );
    }

    await ticketChannel.send({ 
      content: `${interaction.user} | <@&${settings.adminRoleId}> | <@&${settings.highAdminRoleId}>`, 
      embeds: [welcomeEmbed], 
      components: [buttonsRow] 
    });

    return interaction.editReply({ content: `✅ تم إنشاء التذكرة بنجاح: ${ticketChannel}` });
  } catch (err) {
    console.error('خطأ أثناء فتح التذكرة:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: '❌ حدث خطأ أثناء إنشاء التذكرة.' });
    }
  }
}

  return {
    sendLogError,
    getTicketInfo,
    resolveTicketSettings,
    saveTranscript,
    hasAdminCommandPermission,
    createHelpEmbed,
    handleTicketCreation,
    resolveExplicitTarget
  };
};
