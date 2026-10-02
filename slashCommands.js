const https = require('https');
const crypto = require('crypto');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

const P = PermissionFlagsBits;
const {
  getSlashCommandConfig,
  SLASH_COMMAND_NAMES
} = require('./slashCommandConfig');
const registerSlashPrefix = require('./slashPrefix');
const { fetchXpLeaderboard, buildXpLeaderboardEmbed, PERIODS } = require('./xpLeaderboard');
const { getTaxCommandConfig, getComeCommandConfig, getSayCommandConfig, getWarnDmConfig } = require('./commandConfig');
const { sendWarnDirectMessage } = require('./warnDirectMessage');
const { parseDuration, formatDuration, DURATION_HINT } = require('./duration');
const { buildTaxPayload, buildComePayload, buildSayPayload } = require('./customCommands');
const { SYSTEM_SLASH_COMMANDS, getSystemSlashHandler } = require('./systemSlashBridge');
const voiceChannelTypes = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const textChannelTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const commandBuilders = [
  new SlashCommandBuilder().setName('credits').setDescription('عرض رصيدك أو تحويل رصيد لعضو')
    .addUserOption(o => o.setName('member').setDescription('العضو المستلم أو صاحب الرصيد'))
    .addIntegerOption(o => o.setName('amount').setDescription('مقدار الرصيد المراد تحويله').setMinValue(1)),
  new SlashCommandBuilder().setName('creditsgrant').setDescription('إضافة رصيد لعضو (إدارة السيرفر)')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('عدد النقاط').setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName('rep').setDescription('منح عضو نقطة سمعة (مرة كل 24 ساعة)')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder().setName('moveme').setDescription('انقل نفسك إلى روم صوتي أو روم الشخص المحدد')
    .addChannelOption(o => o.setName('channel').setDescription('الروم الصوتي الهدف').addChannelTypes(...voiceChannelTypes))
    .addUserOption(o => o.setName('member').setDescription('انضم إلى روم هذا العضو')),
  new SlashCommandBuilder().setName('color').setDescription('أضف لنفسك رتبة لون اسمها يبدأ بـ Color أو لون')
    .addRoleOption(o => o.setName('role').setDescription('رتبة اللون').setRequired(true)),
  new SlashCommandBuilder().setName('colors').setDescription('عرض الرتب الملونة القابلة للاختيار'),
  new SlashCommandBuilder().setName('short').setDescription('إنشاء رابط مختصر عبر خدمة is.gd الخارجية')
    .addStringOption(o => o.setName('url').setDescription('الرابط الذي تريد اختصاره').setRequired(true)),
  new SlashCommandBuilder().setName('roll').setDescription('ارمِ نرداً عشوائياً')
    .addIntegerOption(o => o.setName('sides').setDescription('عدد أوجه النرد (الافتراضي 6)').setMinValue(2).setMaxValue(1000000)),
  new SlashCommandBuilder().setName('profile').setDescription('عرض ملفك الشخصي ومستواك وترتيبك أو ملف عضو آخر')
    .addUserOption(o => o.setName('member').setDescription('العضو')),
  new SlashCommandBuilder().setName('top').setDescription('عرض لوحة الترتيب الحالية أو أرشيف فترة سابقة')
    .addStringOption(o => o.setName('period').setDescription('الفترة الزمنية').addChoices(
      { name: 'الإجمالي', value: 'total' }, { name: 'اليومي', value: 'daily' },
      { name: 'الأسبوعي', value: 'weekly' }, { name: 'الشهري', value: 'monthly' }
    ))
    .addStringOption(o => o.setName('archive').setDescription('تسمية الأرشيف مثل 2026-09-30 أو 2026-09').setMaxLength(30)),
  new SlashCommandBuilder().setName('title').setDescription('تعيين لقب ملفك في الإكسبي')
    .addStringOption(o => o.setName('title').setDescription('اللقب').setMaxLength(40).setRequired(true)),
  new SlashCommandBuilder().setName('setxp').setDescription('تعيين إجمالي إكسبي عضو (إدارة)')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('إجمالي الإكسبي').setMinValue(0).setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('تعيين مستوى عضو (إدارة)')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('level').setDescription('المستوى').setMinValue(0).setMaxValue(1000).setRequired(true)),
  new SlashCommandBuilder().setName('user').setDescription('عرض معلومات عضو')
    .addUserOption(o => o.setName('member').setDescription('العضو')),
  new SlashCommandBuilder().setName('avatar').setDescription('عرض صورة أو بانر عضو')
    .addUserOption(o => o.setName('member').setDescription('العضو'))
    .addStringOption(o => o.setName('type').setDescription('نوع الصورة').addChoices(
      { name: 'الصورة العامة', value: 'avatar' }, { name: 'صورة العضو في السيرفر', value: 'server' }, { name: 'البانر', value: 'banner' }
    )),
  new SlashCommandBuilder().setName('server').setDescription('عرض معلومات السيرفر'),
  new SlashCommandBuilder().setName('roles').setDescription('عرض رتب السيرفر وعدد أعضائها'),
  new SlashCommandBuilder().setName('setnick').setDescription('تغيير لقب عضو')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('nickname').setDescription('اللقب الجديد؛ لا تحدد الخيار لإزالة اللقب الحالي').setMaxLength(32)),
  new SlashCommandBuilder().setName('ban').setDescription('حظر عضو مؤقتاً أو بشكل دائم')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('duration_minutes').setDescription('المدة: 30 أو 2h أو 7d — اتركها فارغة للحظر الدائم').setMaxLength(20))
    .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)),
  new SlashCommandBuilder().setName('unban').setDescription('فك حظر حساب باستخدام آيديه')
    .addStringOption(o => o.setName('user_id').setDescription('آيدي الحساب المحظور').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)),
  new SlashCommandBuilder().setName('kick').setDescription('طرد عضو من السيرفر')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)),
  new SlashCommandBuilder().setName('vkick').setDescription('فصل عضو من الروم الصوتي')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)),
  new SlashCommandBuilder().setName('time').setDescription('إعطاء تايم أوت كتابي أو كتم عضو صوتياً')
    .addSubcommand(s => s.setName('text').setDescription('تطبيق Timeout كتابي')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('minutes').setDescription('المدة: 30 أو 2h أو 7d (الافتراضي 60 دقيقة)').setMaxLength(20))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)))
    .addSubcommand(s => s.setName('voice').setDescription('كتم عضو في الروم الصوتي')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500))),
  // ==========================================================================
  // 🔇 كتم مُنفصل: كتابي فقط أو صوتي فقط
  // الفرق عن /time: أمر Timeout في ديسكورد يمنع الكتابة *والتحدث* معاً،
  // بينما /mute text يمنع الكتابة فقط (يبقى العضو قادراً على التحدث صوتياً)،
  // و /mute voice يمنع التحدث فقط (يبقى قادراً على الكتابة).
  // ==========================================================================
  // 📖 قائمة المساعدة — وُحِّدت هنا بعد أن كانت تُسجَّل منفصلة في ready.js،
  // فصارت تعمل بالسلاش (/help) والبريفكس (!help) و$help معاً.
  new SlashCommandBuilder().setName('help').setDescription('عرض قائمة جميع الأوامر وشرحها مع رابط اللوحة'),

  // 🎫 أوامر التذكرة — تعمل داخل روم التذكرة فقط (نفس شرط نسخة البريفكس)
  new SlashCommandBuilder().setName('ticket').setDescription('أوامر التحكم بالتذكرة من داخل روم التذكرة')
    .addSubcommand(sub => sub.setName('close').setDescription('إغلاق التذكرة (مثل !close)'))
    .addSubcommand(sub => sub.setName('save').setDescription('حفظ الترانسكريبت وإرساله لروم اللوق (مثل !save)'))
    .addSubcommand(sub => sub.setName('delete').setDescription('حذف التذكرة نهائياً (مثل !delete)'))
    .addSubcommand(sub => sub.setName('add').setDescription('إضافة عضو إلى التذكرة (مثل !add)')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true)))
    .addSubcommand(sub => sub.setName('remove').setDescription('إزالة عضو من التذكرة (مثل !remove)')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true)))
    .addSubcommand(sub => sub.setName('rename').setDescription('تغيير اسم التذكرة (مثل !rename)')
      .addStringOption(o => o.setName('name').setDescription('الاسم الجديد').setRequired(true))),

  // 📋 سجل الاستلام — بديل أوامر !اضافة-استلام-* و !تصفير-استلام-* العشرة
  new SlashCommandBuilder().setName('claimstats').setDescription('التحكم بسجل التذاكر المستلمة للإدارة والوسطاء')
    .addSubcommand(sub => sub.setName('add').setDescription('إضافة تذاكر مستلمة لعضو (مثل !اضافة-استلام-اداري)')
      .addStringOption(o => o.setName('type').setDescription('النوع').setRequired(true)
        .addChoices({ name: 'إداري', value: 'admin' }, { name: 'وسيط', value: 'mediator' }))
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('العدد (الافتراضي 1)').setMinValue(1)))
    .addSubcommand(sub => sub.setName('remove').setDescription('سحب تذاكر مستلمة من عضو (مثل !سحب-استلام-اداري)')
      .addStringOption(o => o.setName('type').setDescription('النوع').setRequired(true)
        .addChoices({ name: 'إداري', value: 'admin' }, { name: 'وسيط', value: 'mediator' }))
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('العدد (الافتراضي 1)').setMinValue(1)))
    .addSubcommand(sub => sub.setName('reset').setDescription('تصفير سجل الاستلام لعضو (مثل !تصفير-استلام)')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('النوع (الافتراضي: الكل)')
        .addChoices({ name: 'إداري', value: 'admin' }, { name: 'وسيط', value: 'mediator' }, { name: 'إدارة ووسطاء', value: 'both' })))
    .addSubcommand(sub => sub.setName('resetall').setDescription('تصفير سجل الاستلام لكل الأعضاء (مثل !تصفير-الكل-استلام)')
      .addStringOption(o => o.setName('type').setDescription('النوع (الافتراضي: الكل)')
        .addChoices({ name: 'إداري', value: 'admin' }, { name: 'وسيط', value: 'mediator' }, { name: 'إدارة ووسطاء', value: 'both' }))),

  // ⭐ إدارة الإكسبي — بديل أوامر !اضافة-اكسبي-* و !سحب-اكسبي-* الثمانية
  new SlashCommandBuilder().setName('xpmanage').setDescription('إضافة أو سحب إكسبي من عضو لفترة محددة')
    .addSubcommand(sub => sub.setName('add').setDescription('إضافة إكسبي لعضو')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('مقدار الإكسبي').setMinValue(1).setRequired(true))
      .addStringOption(o => o.setName('period').setDescription('الفترة (الافتراضي: الإجمالي)')
        .addChoices({ name: 'الإجمالي', value: 'total' }, { name: 'يومي', value: 'daily' }, { name: 'أسبوعي', value: 'weekly' }, { name: 'شهري', value: 'monthly' })))
    .addSubcommand(sub => sub.setName('remove').setDescription('سحب إكسبي من عضو')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('مقدار الإكسبي').setMinValue(1).setRequired(true))
      .addStringOption(o => o.setName('period').setDescription('الفترة (الافتراضي: الإجمالي)')
        .addChoices({ name: 'الإجمالي', value: 'total' }, { name: 'يومي', value: 'daily' }, { name: 'أسبوعي', value: 'weekly' }, { name: 'شهري', value: 'monthly' }))),
  new SlashCommandBuilder().setName('myinfo').setDescription('عرض إكسبيك ومرات تصدّرك للتوب وتذاكرك المستلمة')
    .addUserOption(o => o.setName('member').setDescription('عضو آخر (الافتراضي: أنت)')),

  // 🏰 الكلانات
  new SlashCommandBuilder().setName('clan').setDescription('لوحات نظام الكلانات')
    .addSubcommand(sub => sub.setName('create').setDescription('فتح لوحة إنشاء كلان جديد'))
    .addSubcommand(sub => sub.setName('apply-panel').setDescription('نشر لوحة التقديم على الكلانات')),

  // 🌉 نسخ السلاش من أوامر system.js (المنطق يبقى هناك عبر systemSlashBridge).
  // جُمعت أوامر الروم الخمسة في أمر واحد بأوامر فرعية بدل خمس بطاقات منفصلة.
  new SlashCommandBuilder().setName('channel').setDescription('التحكم بصلاحيات الروم الحالي واسمه ووظائفه')
    .addSubcommand(sub => sub.setName('view').setDescription('منح عضو أو رتبة صلاحية رؤية هذا الروم')
      .addUserOption(o => o.setName('member').setDescription('العضو'))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة')))
    .addSubcommand(sub => sub.setName('write').setDescription('منح عضو أو رتبة صلاحية الكتابة في هذا الروم')
      .addUserOption(o => o.setName('member').setDescription('العضو'))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة')))
    .addSubcommand(sub => sub.setName('rename').setDescription('تغيير اسم الروم الحالي')
      .addStringOption(o => o.setName('name').setDescription('الاسم الجديد').setRequired(true)))
    .addSubcommand(sub => sub.setName('tax').setDescription('تفعيل أو إلغاء حاسبة الضريبة التلقائية في روم')
      .addChannelOption(o => o.setName('channel').setDescription('الروم (الافتراضي: الروم الحالي)')))
    .addSubcommand(sub => sub.setName('suggestions').setDescription('تفعيل أو إلغاء نظام الاقتراحات في روم')
      .addChannelOption(o => o.setName('channel').setDescription('الروم (الافتراضي: الروم الحالي)'))),
  new SlashCommandBuilder().setName('botstatus').setDescription('إدارة حالة البوت ووصفه')
    .addSubcommand(sub => sub.setName('set').setDescription('عرض أزرار تغيير حالة البوت'))
    .addSubcommand(sub => sub.setName('about').setDescription('تحديد وصف بروفايل البوت في ديسكورد')
      .addStringOption(o => o.setName('description').setDescription('الوصف الجديد').setMaxLength(400).setRequired(true))),
  new SlashCommandBuilder().setName('logchannel').setDescription('تحديد روم استقبال سجلات أخطاء البوت')
    .addChannelOption(o => o.setName('channel').setDescription('الروم (الافتراضي: الروم الحالي)')),
  // 🧩 نسخ السلاش من الأوامر المخصّصة التي كانت بالبريفكس فقط ($tax / $come / $say)
  new SlashCommandBuilder().setName('tax').setDescription('حساب المبلغ الصافي والمبلغ المطلوب تحويله بعد الضريبة')
    .addIntegerOption(o => o.setName('amount').setDescription('المبلغ قبل الضريبة').setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName('come').setDescription('إرسال إشعار استدعاء بالخاص للعضو مع رابط مباشر للروم')
    .addUserOption(o => o.setName('member').setDescription('العضو المطلوب استدعاؤه').setRequired(true)),
  new SlashCommandBuilder().setName('say').setDescription('نشر نص باسم البوت في الروم الحالي')
    .addStringOption(o => o.setName('text').setDescription('النص المراد نشره').setRequired(true)),
  new SlashCommandBuilder().setName('mute').setDescription('كتم عضو كتابياً فقط أو صوتياً فقط')
    .addSubcommand(s => s.setName('text').setDescription('منع العضو من الكتابة فقط — يبقى قادراً على التحدث صوتياً')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('minutes').setDescription('المدة: 30 أو 2h أو 7d — اتركه فارغاً لكتم دائم').setMaxLength(20))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)))
    .addSubcommand(s => s.setName('voice').setDescription('منع العضو من التحدث صوتياً فقط — يبقى قادراً على الكتابة')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500))),
  new SlashCommandBuilder().setName('unmute').setDescription('فك الكتم الكتابي أو الصوتي عن عضو')
    .addSubcommand(s => s.setName('text').setDescription('فك الكتم الكتابي')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)))
    .addSubcommand(s => s.setName('voice').setDescription('فك الكتم الصوتي')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500))),
  new SlashCommandBuilder().setName('untime').setDescription('إزالة تايم أوت كتابي أو إلغاء كتم الصوت')
    .addSubcommand(s => s.setName('text').setDescription('إزالة Timeout كتابي')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500)))
    .addSubcommand(s => s.setName('voice').setDescription('إلغاء كتم الصوت')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(500))),
  new SlashCommandBuilder().setName('clear').setDescription('حذف مجموعة رسائل من الروم الحالي')
    .addIntegerOption(o => o.setName('amount').setDescription('عدد الرسائل (الافتراضي 100)').setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('member').setDescription('حذف رسائل هذا العضو فقط')),
  new SlashCommandBuilder().setName('move').setDescription('نقل عضو إلى روم صوتي أو إلى رومك الحالي')
    .addUserOption(o => o.setName('member').setDescription('العضو المراد نقله').setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('الروم الصوتي الهدف؛ اتركه فارغاً لاستخدام رومك').addChannelTypes(...voiceChannelTypes)),
  new SlashCommandBuilder().setName('role').setDescription('إدارة الرتب')
    .addSubcommand(s => s.setName('give').setDescription('إعطاء رتبة لعضو')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('سحب رتبة من عضو')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true)))
    .addSubcommand(s => s.setName('toggle').setDescription('تبديل رتبة: تُعطى إن لم تكن معه وتُسحب إن كانت')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true)))
    .addSubcommand(s => s.setName('multiple').setDescription('إعطاء أو سحب رتبة من أعضاء يملكون رتبة أساس')
      .addStringOption(o => o.setName('action').setDescription('العملية').setRequired(true).addChoices({ name: 'إعطاء', value: 'give' }, { name: 'سحب', value: 'remove' }))
      .addRoleOption(o => o.setName('role').setDescription('الرتبة المستهدفة').setRequired(true))
      .addRoleOption(o => o.setName('required_role').setDescription('طبّق العملية على حاملي هذه الرتبة فقط').setRequired(true))),
  new SlashCommandBuilder().setName('points').setDescription('نظام نقاط الإدارة')
    .addSubcommand(s => s.setName('set').setDescription('تعيين نقاط عضو')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('النقاط').setMinValue(0).setRequired(true)))
    .addSubcommand(s => s.setName('increase').setDescription('إضافة نقاط لعضو')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('عدد النقاط').setMinValue(1).setRequired(true)))
    .addSubcommand(s => s.setName('decrease').setDescription('خصم نقاط من عضو')
      .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('عدد النقاط').setMinValue(1).setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('عرض نقاط عضو أو قائمة الأعلى')
      .addUserOption(o => o.setName('member').setDescription('العضو'))
      .addIntegerOption(o => o.setName('page').setDescription('رقم الصفحة').setMinValue(1)))
    .addSubcommand(s => s.setName('reset').setDescription('تصفير نقاط عضو أو جميع أعضاء السيرفر')
      .addUserOption(o => o.setName('member').setDescription('اتركه فارغاً لتصفير الجميع'))),
  new SlashCommandBuilder().setName('warn').setDescription('تسجيل إنذار على عضو')
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('سبب الإنذار').setMaxLength(500).setRequired(true)),
  new SlashCommandBuilder().setName('warn_remove').setDescription('حذف إنذار برقمِه أو حذف إنذارات عضو')
    .addIntegerOption(o => o.setName('warning_id').setDescription('رقم إنذار محدد').setMinValue(1))
    .addUserOption(o => o.setName('member').setDescription('العضو؛ يحذف كل إنذاراته إذا لم تحدد رقم إنذار')),
  new SlashCommandBuilder().setName('warnings').setDescription('عرض إنذاراتك أو إنذارات عضو')
    .addUserOption(o => o.setName('member').setDescription('العضو (يتطلب صلاحية إدارة الرسائل عند عرض عضو آخر)')),
  new SlashCommandBuilder().setName('lock').setDescription('قفل الكتابة في روم نصي')
    .addChannelOption(o => o.setName('channel').setDescription('الروم (الافتراضي: الحالي)').addChannelTypes(...textChannelTypes))
    .addStringOption(o => o.setName('reason').setDescription('السبب').setMaxLength(300)),
  new SlashCommandBuilder().setName('unlock').setDescription('فتح الكتابة في روم نصي')
    .addChannelOption(o => o.setName('channel').setDescription('الروم (الافتراضي: الحالي)').addChannelTypes(...textChannelTypes)),
  new SlashCommandBuilder().setName('hide').setDescription('إخفاء قناة عن الأعضاء')
    .addChannelOption(o => o.setName('channel').setDescription('القناة (الافتراضي: الحالية)')),
  new SlashCommandBuilder().setName('show').setDescription('إظهار قناة للأعضاء')
    .addChannelOption(o => o.setName('channel').setDescription('القناة (الافتراضي: الحالية)')),
  new SlashCommandBuilder().setName('setcolor').setDescription('تغيير لون رتبة إلى قيمة Hex')
    .addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true))
    .addStringOption(o => o.setName('hex').setDescription('مثال: #4f46e5').setRequired(true)),
  new SlashCommandBuilder().setName('slowmode').setDescription('تعيين مهلة الإبطاء لروم نصي')
    .addIntegerOption(o => o.setName('seconds').setDescription('الثواني (0 لإيقافها)').setMinValue(0).setMaxValue(21600).setRequired(true))
    .addChannelOption(o => o.setName('channel').setDescription('الروم (الافتراضي: الحالي)').addChannelTypes(...textChannelTypes)),
  new SlashCommandBuilder().setName('reset').setDescription('تصفير إكسبي عضو أو أعضاء السيرفر')
    .addStringOption(o => o.setName('period').setDescription('القيمة التي تريد تصفيرها').setRequired(true).addChoices(
      { name: 'الإجمالي والمستوى', value: 'total' }, { name: 'اليومي', value: 'daily' },
      { name: 'الأسبوعي', value: 'weekly' }, { name: 'الشهري', value: 'monthly' }, { name: 'الكل', value: 'all' }
    ))
    .addUserOption(o => o.setName('member').setDescription('اتركه فارغاً لتطبيق التصفير على أعضاء السيرفر'))
];

const commandData = commandBuilders.map(command => command.toJSON());
if (commandData.length !== SLASH_COMMAND_NAMES.length || commandData.some(command => !SLASH_COMMAND_NAMES.includes(command.name))) {
  throw new Error('قائمة أوامر السلاش لا تطابق قائمة إعدادات لوحة التحكم.');
}

function safeReason(value, fallback) {
  const reason = String(value || '').trim();
  return (reason || fallback || 'لم يحدد سبب').slice(0, 500);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function escapeInline(value) {
  return String(value || '').replace(/[\\`*_{}[\]()<>]/g, '\\$&').slice(0, 180);
}

function levelForXp(totalXp) {
  let remaining = Math.max(0, Number(totalXp) || 0);
  let level = 0;
  while (level < 1000) {
    const needed = 5 * level * level + 50 * level + 100;
    if (remaining < needed) break;
    remaining -= needed;
    level++;
  }
  return level;
}

function xpForLevel(targetLevel) {
  let total = 0;
  for (let level = 0; level < targetLevel; level++) total += 5 * level * level + 50 * level + 100;
  return total;
}

function shortenUrl(rawUrl) {
  return new Promise((resolve, reject) => {
    const apiUrl = new URL('https://is.gd/create.php');
    apiUrl.searchParams.set('format', 'simple');
    apiUrl.searchParams.set('url', rawUrl);
    const request = https.get(apiUrl, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 2048) request.destroy(new Error('رد خدمة الروابط طويل أكثر من المتوقع.')); });
      response.on('end', () => {
        const result = body.trim();
        if (response.statusCode !== 200 || !/^https:\/\/is\.gd\/[A-Za-z0-9]+$/.test(result)) {
          return reject(new Error(result.startsWith('Error:') ? result.slice(7) : 'تعذر إنشاء الرابط المختصر.'));
        }
        resolve(result);
      });
    });
    request.setTimeout(8000, () => request.destroy(new Error('انتهت مهلة الاتصال بخدمة الروابط.')));
    request.on('error', reject);
  });
}

module.exports = function registerSlashCommands(client, pool) {
  const dbReady = pool.query(`
    CREATE TABLE IF NOT EXISTS bot_credits (
      guild_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      balance BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS bot_reputation (
      guild_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      score INT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS bot_rep_cooldowns (
      guild_id VARCHAR(100) NOT NULL,
      giver_id VARCHAR(100) NOT NULL,
      last_given_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, giver_id)
    );
    CREATE TABLE IF NOT EXISTS xp_titles (
      guild_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      title VARCHAR(40) NOT NULL DEFAULT '',
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS moderation_points (
      guild_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      points BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS moderation_warnings (
      id SERIAL PRIMARY KEY,
      guild_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      moderator_id VARCHAR(100) NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS moderation_warnings_guild_user_idx ON moderation_warnings (guild_id, user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS scheduled_unbans (
      guild_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      unban_at TIMESTAMPTZ NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS xp_users (
      user_id VARCHAR(100) PRIMARY KEY,
      total_xp BIGINT DEFAULT 0,
      level INT DEFAULT 0,
      daily_xp BIGINT DEFAULT 0,
      weekly_xp BIGINT DEFAULT 0,
      monthly_xp BIGINT DEFAULT 0,
      last_message_at BIGINT DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS xp_level_rewards (level INT PRIMARY KEY, role_id VARCHAR(100));
    CREATE TABLE IF NOT EXISTS scheduled_unmutes (
      guild_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      unmute_at TIMESTAMPTZ NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (guild_id, user_id)
    );
  `).catch(error => {
    console.error('❌ تعذر تجهيز جداول أوامر السلاش الإضافية:', error);
    throw error;
  });

  const unbanTimers = new Map();
  const maxTimerDelay = 2147480000;

  function scheduleUnban(row) {
    const key = `${row.guild_id}:${row.user_id}`;
    const previous = unbanTimers.get(key);
    if (previous) clearTimeout(previous);
    const remaining = Math.max(0, new Date(row.unban_at).getTime() - Date.now());
    const timer = setTimeout(async () => {
      unbanTimers.delete(key);
      try {
        const current = await pool.query('SELECT unban_at,reason FROM scheduled_unbans WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id]);
        if (!current.rows.length) return;
        const currentRow = { ...row, ...current.rows[0] };
        if (new Date(currentRow.unban_at).getTime() > Date.now()) return scheduleUnban(currentRow);
        const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id);
        await guild.members.unban(row.user_id, `انتهت مدة الحظر المؤقت: ${currentRow.reason || 'بدون سبب'}`);
        await pool.query('DELETE FROM scheduled_unbans WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id]);
      } catch (error) {
        if (Number(error.code || error.rawError?.code) === 10026) {
          await pool.query('DELETE FROM scheduled_unbans WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id]).catch(() => {});
          return;
        }
        console.error('❌ تعذّر تنفيذ فك الحظر المجدول؛ ستتم إعادة المحاولة:', error.message || error);
        const retryRow = { ...row, unban_at: new Date(Date.now() + 60_000) };
        await pool.query('UPDATE scheduled_unbans SET unban_at=$3 WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id, retryRow.unban_at]).catch(() => {});
        scheduleUnban(retryRow);
      }
    }, Math.min(remaining, maxTimerDelay));
    timer.unref();
    unbanTimers.set(key, timer);
  }

  // ==========================================================================
  // 🔇 الكتم الكتابي (/mute text) — يعتمد على رتبة كتم تمنع الكتابة فقط
  // العضو يبقى قادراً على التحدث في الرومات الصوتية، على عكس Timeout الذي يمنع الاثنين.
  // ==========================================================================
  const MUTED_ROLE_NAME = 'Muted';
  const MUTED_ROLE_ALIASES = ['muted', 'مكتوم', 'كتم', 'mute'];
  const unmuteTimers = new Map();

  // يبحث عن رتبة كتم موجودة مسبقاً، وإن لم توجد ينشئها ويضبط صلاحياتها على كل الرومات
  async function getOrCreateMutedRole(guild) {
    let role = guild.roles.cache.find(r => MUTED_ROLE_ALIASES.includes(r.name.trim().toLowerCase()));
    if (!role) {
      role = await guild.roles.create({
        name: MUTED_ROLE_NAME,
        color: 0x5a5a66,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: 'رتبة الكتم الكتابي الخاصة بأمر /mute text'
      });
    }
    await syncMutedRoleOverwrites(guild, role);
    return role;
  }

  // يمنع الكتابة والتفاعل في كل الرومات النصية، دون المساس بصلاحيات الصوت
  async function syncMutedRoleOverwrites(guild, role) {
    const deniedText = {
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      AddReactions: false
    };
    let failed = 0;
    for (const channel of guild.channels.cache.values()) {
      const isTextLike = channel.type === ChannelType.GuildText
        || channel.type === ChannelType.GuildAnnouncement
        || channel.type === ChannelType.GuildForum
        || channel.type === ChannelType.GuildCategory;
      if (!isTextLike || !channel.permissionOverwrites) continue;

      const existing = channel.permissionOverwrites.cache.get(role.id);
      // لا نعيد الكتابة إن كانت الصلاحيات مضبوطة أصلاً (تقليل طلبات الـ API)
      if (existing && existing.deny.has(P.SendMessages)) continue;
      try {
        await channel.permissionOverwrites.edit(role, deniedText, { reason: 'ضبط رتبة الكتم الكتابي' });
      } catch (error) {
        failed++;
      }
    }
    if (failed) console.warn(`⚠️ تعذر ضبط رتبة الكتم على ${failed} روم (صلاحيات البوت أو ترتيب رتبته).`);
  }

  // جدولة فك الكتم الكتابي تلقائياً عند انتهاء المدة
  function scheduleUnmute(row) {
    const key = `${row.guild_id}:${row.user_id}`;
    const previous = unmuteTimers.get(key);
    if (previous) clearTimeout(previous);
    const remaining = Math.max(0, new Date(row.unmute_at).getTime() - Date.now());
    const timer = setTimeout(async () => {
      unmuteTimers.delete(key);
      try {
        const current = await pool.query('SELECT unmute_at FROM scheduled_unmutes WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id]);
        if (!current.rows.length) return;
        // أُعيد ضبط المدة أثناء الانتظار — نعيد الجدولة بدل فك الكتم مبكراً
        if (new Date(current.rows[0].unmute_at).getTime() > Date.now()) {
          return scheduleUnmute({ ...row, unmute_at: current.rows[0].unmute_at });
        }
        const guild = client.guilds.cache.get(row.guild_id) || await client.guilds.fetch(row.guild_id);
        const member = await guild.members.fetch(row.user_id).catch(() => null);
        const role = guild.roles.cache.find(r => MUTED_ROLE_ALIASES.includes(r.name.trim().toLowerCase()));
        if (member && role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role, 'انتهت مدة الكتم الكتابي');
        }
        await pool.query('DELETE FROM scheduled_unmutes WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id]);
      } catch (error) {
        console.error('❌ تعذّر تنفيذ فك الكتم المجدول؛ ستتم إعادة المحاولة بعد دقيقة:', error.message || error);
        const retryAt = new Date(Date.now() + 60_000);
        await pool.query('UPDATE scheduled_unmutes SET unmute_at=$3 WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id, retryAt]).catch(() => {});
        scheduleUnmute({ ...row, unmute_at: retryAt });
      }
    }, Math.min(remaining, maxTimerDelay));
    timer.unref();
    unmuteTimers.set(key, timer);
  }

  function cancelScheduledUnmute(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const timer = unmuteTimers.get(key);
    if (timer) clearTimeout(timer);
    unmuteTimers.delete(key);
  }

  client.once('ready', async () => {
    try {
      await dbReady;
      const pending = await pool.query('SELECT guild_id,user_id,unban_at,reason FROM scheduled_unbans');
      for (const row of pending.rows) scheduleUnban(row);
      console.log(`⏱️ تم تحميل ${pending.rowCount} موعد فك حظر مؤقت.`);
    } catch (error) {
      console.error('❌ تعذر تحميل مواعيد فك الحظر المؤقت:', error);
    }

    try {
      await dbReady;
      const pendingMutes = await pool.query('SELECT guild_id,user_id,unmute_at,reason FROM scheduled_unmutes');
      for (const row of pendingMutes.rows) scheduleUnmute(row);
      console.log(`⏱️ تم تحميل ${pendingMutes.rowCount} موعد فك كتم كتابي مؤقت.`);
    } catch (error) {
      console.error('❌ تعذر تحميل مواعيد فك الكتم الكتابي:', error);
    }
  });

  // إبقاء رتبة الكتم فعّالة في أي روم جديد يُنشأ بعد ضبطها
  client.on('channelCreate', async (channel) => {
    try {
      if (!channel.guild || !channel.permissionOverwrites) return;
      const role = channel.guild.roles.cache.find(r => MUTED_ROLE_ALIASES.includes(r.name.trim().toLowerCase()));
      if (!role) return;
      const isTextLike = channel.type === ChannelType.GuildText
        || channel.type === ChannelType.GuildAnnouncement
        || channel.type === ChannelType.GuildForum;
      if (!isTextLike) return;
      await channel.permissionOverwrites.edit(role, {
        SendMessages: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        AddReactions: false
      }, { reason: 'تطبيق رتبة الكتم الكتابي على روم جديد' });
    } catch (error) {
      console.warn('⚠️ تعذر تطبيق رتبة الكتم على روم جديد:', error.message || error);
    }
  });

  async function reply(interaction, content, options = {}) {
    const payload = { content, allowedMentions: { parse: [] }, ...options };
    const ephemeral = options.ephemeral === undefined ? true : options.ephemeral;
    delete payload.ephemeral;
    if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
    return interaction.reply({ ...payload, ephemeral });
  }

  async function getActor(interaction) {
    return interaction.guild.members.fetch(interaction.user.id);
  }

  async function hasConfiguredCommandAccess(interaction, commandName = interaction.commandName) {
    const config = await getSlashCommandConfig(pool);
    const settings = config.commands[commandName];
    if (!settings) return false;
    const hasLegacyRoleFallback = commandName === 'role' && !settings.roleIds.length;
    if (!settings.roleIds.length && !settings.userIds.length && !config.globalRoleIds.length && !hasLegacyRoleFallback) return false;
    const actor = await getActor(interaction).catch(() => null);
    if (!actor) return false;
    if (actor.id === interaction.guild.ownerId || actor.permissions.has(P.Administrator)) return true;
    if (settings.userIds.includes(actor.id)) return true;
    if (settings.roleIds.some(roleId => actor.roles.cache.has(roleId))) return true;
    if (config.globalRoleIds.some(roleId => actor.roles.cache.has(roleId))) return true;
    if (hasLegacyRoleFallback) {
      const defaultRole = interaction.guild.roles.cache.find(role => role.name === 'ادمن ستريس');
      if (defaultRole && actor.roles.cache.has(defaultRole.id)) return true;
    }
    return false;
  }

  async function authorizeCommand(interaction) {
    const config = await getSlashCommandConfig(pool);
    const settings = config.commands[interaction.commandName];
    if (!settings || !settings.enabled) {
      await reply(interaction, `⛔ الأمر \`/${interaction.commandName}\` متوقف حالياً.`);
      return null;
    }
    if (!settings.roleIds.length && !settings.userIds.length) return settings;
    if (await hasConfiguredCommandAccess(interaction, interaction.commandName)) return settings;
    if (interaction.commandName === 'reset') {
      const actor = await getActor(interaction).catch(() => null);
      if (actor && await hasLegacyXpAdminRole(actor)) return settings;
    }
    await reply(interaction, '❌ لا تملك صلاحية استخدام هذا الأمر؛ راجع مسؤول السيرفر.');
    return null;
  }

  async function hasLegacyXpAdminRole(actor) {
    try {
      const result = await pool.query('SELECT xp_admin_role_id FROM xp_settings WHERE key = $1', ['main_xp']);
      const roleIds = String(result.rows[0]?.xp_admin_role_id || '').split(',').map(id => id.trim()).filter(Boolean);
      return roleIds.some(roleId => actor.roles.cache.has(roleId));
    } catch (_) {
      return false;
    }
  }

  async function requirePermission(interaction, permission, label) {
    const actor = await getActor(interaction);
    const hasDiscordPermission = actor.permissions.has(permission);
    const hasConfiguredAccess = await hasConfiguredCommandAccess(interaction);
    const legacyXpRoleAccess = interaction.commandName === 'reset' && await hasLegacyXpAdminRole(actor);
    if (!hasDiscordPermission && !hasConfiguredAccess && !legacyXpRoleAccess) {
      await reply(interaction, `❌ تحتاج إلى صلاحية **${label}** لاستخدام هذا الأمر، أو أن يضيفك مسؤول السيرفر إلى صلاحياته.`);
      return null;
    }
    return actor;
  }

  async function getMember(interaction, optionName = 'member') {
    const user = interaction.options.getUser(optionName);
    if (!user) return null;
    return interaction.guild.members.fetch(user.id).catch(() => null);
  }

  function actorCanManageTarget(guild, actor, target) {
    return actor.id === guild.ownerId || actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
  }

  function actorCanManageRole(guild, actor, role) {
    return actor.id === guild.ownerId || actor.roles.highest.comparePositionTo(role) > 0;
  }

  async function syncRewardRole(member, newLevel) {
    const rewards = await pool.query('SELECT level, role_id FROM xp_level_rewards ORDER BY level ASC');
    let targetRoleId = null;
    for (const reward of rewards.rows) if (newLevel >= Number(reward.level)) targetRoleId = reward.role_id;
    const rewardRoleIds = new Set(rewards.rows.map(row => row.role_id));
    for (const roleId of rewardRoleIds) {
      if (roleId !== targetRoleId && member.roles.cache.has(roleId)) {
        const role = member.guild.roles.cache.get(roleId);
        if (role && role.editable) await member.roles.remove(role).catch(() => {});
      }
    }
    if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
      const role = member.guild.roles.cache.get(targetRoleId);
      if (role && role.editable) await member.roles.add(role).catch(() => {});
    }
  }

  async function ensureXpUser(userId) {
    await pool.query('INSERT INTO xp_users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
    const result = await pool.query('SELECT * FROM xp_users WHERE user_id = $1', [userId]);
    return result.rows[0];
  }

  function isColorRole(role) {
    return /^(?:color|لون)(?:\s|[-:#])/i.test(role.name) && role.permissions.bitfield === 0n;
  }

  async function getXpTitle(guildId, userId) {
    const result = await pool.query('SELECT title FROM xp_titles WHERE guild_id = $1 AND user_id = $2', [guildId, userId]);
    return result.rows[0] ? result.rows[0].title : '';
  }

  async function execute(interaction) {
    await dbReady;
    const name = interaction.commandName;
    const guild = interaction.guild;

    // 📖 /help يُعالَج قبل فحص السيرفر لأنه كان — ولا يزال — يعمل في الرسائل
    // الخاصة أيضاً. داخل السيرفر يحترم مفتاح التفعيل مثل بقية الأوامر.
    if (name === 'help') {
      if (guild && !await authorizeCommand(interaction)) return;
      const helpHandler = getSystemSlashHandler('help');
      if (!helpHandler) return reply(interaction, '❌ قائمة المساعدة غير جاهزة بعد. أعد المحاولة بعد لحظات.');
      return helpHandler(interaction);
    }

    if (!guild) return reply(interaction, 'هذا الأمر متاح داخل السيرفر فقط.');
    if (!await authorizeCommand(interaction)) return;

    if (name === 'roll') {
      const sides = interaction.options.getInteger('sides') || 6;
      return reply(interaction, `🎲 النتيجة: **${crypto.randomInt(1, sides + 1)}** (من 1 إلى ${formatNumber(sides)})`, { ephemeral: false });
    }

    if (name === 'short') {
      const raw = interaction.options.getString('url');
      let parsed;
      try { parsed = new URL(raw); } catch { return reply(interaction, '❌ أدخل رابطاً صالحاً يبدأ بـ http:// أو https://.'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        return reply(interaction, '❌ يُسمح فقط بروابط ويب HTTP أو HTTPS العادية.');
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const shortUrl = await shortenUrl(parsed.href);
        return reply(interaction, `🔗 الرابط المختصر: ${shortUrl}`);
      } catch (error) {
        return reply(interaction, `❌ ${escapeInline(error.message)}`);
      }
    }

    if (name === 'credits' || name === 'creditsgrant') {
      const targetUser = interaction.options.getUser('member');
      const amount = interaction.options.getInteger('amount');
      const actorId = interaction.user.id;
      if (targetUser && !await guild.members.fetch(targetUser.id).catch(() => null)) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      if (name === 'creditsgrant') {
        if (!await requirePermission(interaction, P.ManageGuild, 'إدارة السيرفر')) return;
        await pool.query(`INSERT INTO bot_credits (guild_id, user_id, balance) VALUES ($1,$2,$3)
          ON CONFLICT (guild_id,user_id) DO UPDATE SET balance = bot_credits.balance + EXCLUDED.balance`, [guild.id, targetUser.id, amount]);
        return reply(interaction, `✅ أُضيف **${formatNumber(amount)}** من الرصيد إلى <@${targetUser.id}>.`);
      }
      if (amount && !targetUser) return reply(interaction, '❌ حدّد العضو المستلم مع مقدار التحويل.');
      if (amount && targetUser.id === actorId) return reply(interaction, '❌ لا يمكنك تحويل الرصيد إلى نفسك.');
      if (amount) {
        const connection = await pool.connect();
        try {
          await connection.query('BEGIN');
          await connection.query('INSERT INTO bot_credits (guild_id,user_id,balance) VALUES ($1,$2,0) ON CONFLICT DO NOTHING', [guild.id, actorId]);
          const sender = await connection.query('SELECT balance FROM bot_credits WHERE guild_id=$1 AND user_id=$2 FOR UPDATE', [guild.id, actorId]);
          if (Number(sender.rows[0].balance) < amount) {
            await connection.query('ROLLBACK');
            return reply(interaction, '❌ رصيدك غير كافٍ للتحويل.');
          }
          await connection.query('UPDATE bot_credits SET balance=balance-$1 WHERE guild_id=$2 AND user_id=$3', [amount, guild.id, actorId]);
          await connection.query(`INSERT INTO bot_credits (guild_id,user_id,balance) VALUES ($1,$2,$3)
            ON CONFLICT (guild_id,user_id) DO UPDATE SET balance=bot_credits.balance+EXCLUDED.balance`, [guild.id, targetUser.id, amount]);
          await connection.query('COMMIT');
          return reply(interaction, `✅ حُوّل **${formatNumber(amount)}** إلى <@${targetUser.id}>.`);
        } catch (error) {
          await connection.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          connection.release();
        }
      }
      const accountId = targetUser ? targetUser.id : actorId;
      const account = await pool.query('SELECT balance FROM bot_credits WHERE guild_id=$1 AND user_id=$2', [guild.id, accountId]);
      return reply(interaction, `💳 رصيد <@${accountId}>: **${formatNumber(account.rows[0]?.balance || 0)}**`, { ephemeral: false });
    }

    if (name === 'rep') {
      const targetUser = interaction.options.getUser('member');
      if (targetUser.id === interaction.user.id) return reply(interaction, '❌ لا يمكنك منح السمعة لنفسك.');
      if (!await guild.members.fetch(targetUser.id).catch(() => null)) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const cooldown = await connection.query(`INSERT INTO bot_rep_cooldowns (guild_id,giver_id,last_given_at)
          VALUES ($1,$2,NOW()) ON CONFLICT (guild_id,giver_id) DO UPDATE SET last_given_at=NOW()
          WHERE bot_rep_cooldowns.last_given_at <= NOW() - INTERVAL '24 hours' RETURNING giver_id`, [guild.id, interaction.user.id]);
        if (!cooldown.rowCount) {
          await connection.query('ROLLBACK');
          return reply(interaction, '⏳ يمكنك منح نقطة سمعة واحدة كل 24 ساعة.');
        }
        const result = await connection.query(`INSERT INTO bot_reputation (guild_id,user_id,score) VALUES ($1,$2,1)
          ON CONFLICT (guild_id,user_id) DO UPDATE SET score=bot_reputation.score+1 RETURNING score`, [guild.id, targetUser.id]);
        await connection.query('COMMIT');
        return reply(interaction, `✨ منحت <@${targetUser.id}> نقطة سمعة. رصيده الآن **${formatNumber(result.rows[0].score)}**.`, { ephemeral: false });
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    }

    if (name === 'moveme') {
      const actor = await getActor(interaction);
      const channel = interaction.options.getChannel('channel');
      const otherUser = interaction.options.getUser('member');
      if (!!channel === !!otherUser) return reply(interaction, '❌ اختر روم صوتي أو عضواً واحداً فقط.');
      const otherMember = otherUser ? await guild.members.fetch(otherUser.id).catch(() => null) : null;
      const destination = channel || otherMember?.voice.channel;
      if (!destination) return reply(interaction, '❌ العضو المحدد ليس في روم صوتي أو لم تحدد روم هدف.');
      const botMember = guild.members.me;
      if (!botMember || !botMember.permissions.has(P.MoveMembers)) return reply(interaction, '❌ يحتاج البوت إلى صلاحية نقل الأعضاء.');
      if (!actor.permissionsIn(destination).has(P.Connect)) return reply(interaction, '❌ لا تملك صلاحية الاتصال بالروم الهدف.');
      try {
        await actor.voice.setChannel(destination, 'طلب نقل العضو نفسه');
        return reply(interaction, `✅ تم نقلك إلى **${escapeInline(destination.name)}**.`, { ephemeral: false });
      } catch (error) {
        return reply(interaction, `❌ تعذر نقلك: ${escapeInline(error.message)}`);
      }
    }

    if (name === 'move') {
      const moderator = await requirePermission(interaction, P.MoveMembers, 'نقل الأعضاء');
      if (!moderator) return;
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      if (!actorCanManageTarget(guild, moderator, member)) return reply(interaction, '❌ لا يمكنك نقل عضو أعلى منك.');
      if (!member.voice.channel) return reply(interaction, '❌ العضو ليس متصلاً بروم صوتي.');
      const destination = interaction.options.getChannel('channel') || moderator.voice.channel;
      if (!destination) return reply(interaction, '❌ حدّد روم الهدف أو انضم إلى روم صوتي أولاً.');
      if (!guild.members.me?.permissions.has(P.MoveMembers)) return reply(interaction, '❌ يحتاج البوت إلى صلاحية نقل الأعضاء.');
      try {
        await member.voice.setChannel(destination, safeReason('', `نقل بواسطة ${interaction.user.tag}`));
        return reply(interaction, `✅ تم نقل **${escapeInline(member.user.tag)}** إلى **${escapeInline(destination.name)}**.`);
      } catch (error) {
        return reply(interaction, `❌ تعذر نقل العضو: ${escapeInline(error.message)}`);
      }
    }

    if (name === 'color') {
      const role = interaction.options.getRole('role');
      const member = await getActor(interaction);
      if (!role.editable || role.id === guild.id || role.managed || !isColorRole(role)) return reply(interaction, '❌ اختر رتبة اسمها يبدأ بـ Color أو لون، ولا تمنح صلاحيات.');
      if (role.position >= member.roles.highest.position) return reply(interaction, '❌ يجب أن تكون رتبة اللون أدنى من أعلى رتبة لديك.');
      try {
        await member.roles.add(role, 'اختار العضو لوناً من أمر /color');
        const previousColorRoles = member.roles.cache.filter(previous => previous.id !== role.id && isColorRole(previous) && previous.editable);
        if (previousColorRoles.size) await member.roles.remove(previousColorRoles, 'استبدال رتبة اللون من أمر /color');
        return reply(interaction, `🎨 تم تحديث لونك إلى **${escapeInline(role.name)}**.`, { ephemeral: false });
      } catch (error) {
        return reply(interaction, `❌ تعذر إضافة الرتبة: ${escapeInline(error.message)}`);
      }
    }

    if (name === 'colors') {
      const roles = guild.roles.cache.filter(role => role.id !== guild.id && !role.managed && role.editable && isColorRole(role) && role.hexColor !== '#000000')
        .sort((a, b) => b.position - a.position).first(25);
      if (!roles.length) return reply(interaction, 'لا توجد رتب ألوان قابلة للاختيار حالياً.');
      const embed = new EmbedBuilder().setColor(0x7964a8).setTitle('🎨 رتب الألوان المتاحة')
        .setDescription(roles.map(role => `${role} — ${role.hexColor}`).join('\n'));
      return reply(interaction, '', { embeds: [embed], ephemeral: false });
    }

    if (name === 'profile') {
      const user = interaction.options.getUser('member') || interaction.user;
      const xp = await ensureXpUser(user.id);
      const title = await getXpTitle(guild.id, user.id);
      const rankResult = await pool.query('SELECT COUNT(*)::int + 1 AS rank FROM xp_users WHERE total_xp > $1', [xp.total_xp]);
      const embed = new EmbedBuilder().setColor(0x7964a8)
        .setTitle(`👤 ملف وترتيب ${user.username}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'المستوى', value: String(xp.level), inline: true },
          { name: 'الترتيب', value: `#${formatNumber(rankResult.rows[0].rank)}`, inline: true },
          { name: 'إجمالي XP', value: formatNumber(xp.total_xp), inline: true },
          { name: 'XP اليوم', value: formatNumber(xp.daily_xp), inline: true },
          { name: 'XP الأسبوع', value: formatNumber(xp.weekly_xp), inline: true },
          { name: 'XP الشهر', value: formatNumber(xp.monthly_xp), inline: true }
        );
      if (title) embed.setDescription(`**${escapeInline(title)}**`);
      return reply(interaction, '', { embeds: [embed], ephemeral: false });
    }

    if (name === 'top') {
      const requestedPeriod = interaction.options.getString('period') || 'total';
      const period = PERIODS[requestedPeriod] ? requestedPeriod : 'total';
      const archiveLabel = interaction.options.getString('archive');
      // 🗂️ الأرشيف محفوظ لكل فترة على حدة (يومي · أسبوعي · شهري)؛ فلو جاء
      // التاريخ وحده بلا فترة لعرضنا التوب الكلي بصمت فيظن صاحبه أن الأرشيف
      // خربان. ننبّهه صراحةً بدل التباس صامت — وهذا ما كان يحدث فعلاً.
      if (archiveLabel && period === 'total') {
        return reply(interaction, `⚠️ لتحديد أرشيف فترةٍ ما اختر الفترة مع التاريخ أيضاً (اليومي · الأسبوعي · الشهري). مثال: /top period:اليومي archive:${escapeInline(archiveLabel)} — وكل التواريخ المتاحة في صفحة أرشيف التوب باللوحة.`);
      }
      const data = await fetchXpLeaderboard(pool, period, archiveLabel);
      if (!data.rows.length) {
        return reply(interaction, data.archiveLabel
          ? `📭 لا يوجد أرشيف محفوظ للفترة «${data.period.label}» بتاريخ ${escapeInline(data.archiveLabel)} — راجع صفحة أرشيف التوب باللوحة لمعرفة التواريخ المتاحة.`
          : '📭 لا توجد بيانات كافية لعرض التوب لهذه الفترة.');
      }
      const pageSize = 10;
      const totalPages = Math.ceil(data.rows.length / pageSize);
      let page = 0;
      const idSuffix = String(interaction.id || interaction.user.id).slice(-32);
      const buildButtons = currentPage => [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`xp-top-prev:${idSuffix}`).setLabel('◀️ السابق').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
        new ButtonBuilder().setCustomId(`xp-top-next:${idSuffix}`).setLabel('التالي ▶️').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1)
      )];
      await reply(interaction, '', {
        embeds: [buildXpLeaderboardEmbed(data, page, totalPages, pageSize)],
        components: totalPages > 1 ? buildButtons(page) : [],
        ephemeral: false
      });
      if (totalPages <= 1) return;
      const sentMessage = await interaction.fetchReply();
      const collector = sentMessage.createMessageComponentCollector({
        filter: component => component.customId === `xp-top-prev:${idSuffix}` || component.customId === `xp-top-next:${idSuffix}`,
        time: 10 * 60 * 1000
      });
      collector.on('collect', async component => {
        if (component.user.id !== interaction.user.id) {
          return component.reply({ content: '❌ هذا الزر مخصص لمن استخدم الأمر فقط.', ephemeral: true }).catch(() => {});
        }
        if (component.customId.startsWith('xp-top-prev:') && page > 0) page--;
        if (component.customId.startsWith('xp-top-next:') && page < totalPages - 1) page++;
        await component.update({ embeds: [buildXpLeaderboardEmbed(data, page, totalPages, pageSize)], components: buildButtons(page) }).catch(() => {});
      });
      collector.on('end', () => sentMessage.edit({ components: [] }).catch(() => {}));
      return;
    }

    if (name === 'title') {
      const title = interaction.options.getString('title').trim();
      await pool.query(`INSERT INTO xp_titles (guild_id,user_id,title) VALUES ($1,$2,$3)
        ON CONFLICT (guild_id,user_id) DO UPDATE SET title=EXCLUDED.title`, [guild.id, interaction.user.id, title]);
      return reply(interaction, `✅ تم تحديث لقبك إلى **${escapeInline(title)}**.`);
    }

    if (name === 'setxp' || name === 'setlevel') {
      if (!await requirePermission(interaction, P.ManageGuild, 'إدارة السيرفر')) return;
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      const xp = await ensureXpUser(member.id);
      const amount = name === 'setxp' ? interaction.options.getInteger('amount') : xpForLevel(interaction.options.getInteger('level'));
      const level = levelForXp(amount);
      await pool.query('UPDATE xp_users SET total_xp=$1, level=$2 WHERE user_id=$3', [amount, level, member.id]);
      await syncRewardRole(member, level);
      return reply(interaction, `✅ تم تحديث بيانات <@${member.id}>: المستوى **${level}**، إجمالي XP **${formatNumber(amount)}**.`);
    }

    if (name === 'user') {
      const user = interaction.options.getUser('member') || interaction.user;
      const member = await guild.members.fetch(user.id).catch(() => null);
      const embed = new EmbedBuilder().setColor(0x7964a8).setTitle(`👤 ${user.tag || user.username}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'آيدي المستخدم', value: user.id, inline: true },
          { name: 'الحساب أُنشئ', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'انضم للسيرفر', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'ليس عضواً حالياً', inline: true }
        );
      return reply(interaction, '', { embeds: [embed], ephemeral: false });
    }

    if (name === 'avatar') {
      const user = interaction.options.getUser('member') || interaction.user;
      const type = interaction.options.getString('type') || 'avatar';
      let imageUrl;
      if (type === 'server') {
        const member = await guild.members.fetch(user.id).catch(() => null);
        imageUrl = member ? member.displayAvatarURL({ size: 1024 }) : null;
      } else if (type === 'banner') {
        const fetched = await client.users.fetch(user.id, { force: true });
        imageUrl = fetched.bannerURL({ size: 1024 });
      } else {
        imageUrl = user.displayAvatarURL({ size: 1024 });
      }
      if (!imageUrl) return reply(interaction, 'لا توجد صورة من هذا النوع لهذا الحساب.');
      const embed = new EmbedBuilder().setColor(0x7964a8).setTitle(`🖼️ ${type === 'banner' ? 'بانر' : 'صورة'} ${escapeInline(user.username)}`).setImage(imageUrl);
      return reply(interaction, '', { embeds: [embed], ephemeral: false });
    }

    if (name === 'server') {
      const embed = new EmbedBuilder().setColor(0x7964a8).setTitle(`ℹ️ ${escapeInline(guild.name)}`)
        .addFields(
          { name: 'الأعضاء', value: formatNumber(guild.memberCount), inline: true },
          { name: 'القنوات', value: formatNumber(guild.channels.cache.size), inline: true },
          { name: 'الرتب', value: formatNumber(guild.roles.cache.size), inline: true },
          { name: 'أُنشئ', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'مالك السيرفر', value: `<@${guild.ownerId}>`, inline: true },
          { name: 'آيدي السيرفر', value: guild.id, inline: true }
        );
      const iconUrl = guild.iconURL({ size: 256 });
      if (iconUrl) embed.setThumbnail(iconUrl);
      return reply(interaction, '', { embeds: [embed], ephemeral: false });
    }

    if (name === 'roles') {
      const rows = guild.roles.cache.filter(role => role.id !== guild.id).sort((a, b) => b.position - a.position).first(25);
      const memberCounts = new Map();
      for (const member of guild.members.cache.values()) {
        for (const roleId of member.roles.cache.keys()) memberCounts.set(roleId, (memberCounts.get(roleId) || 0) + 1);
      }
      const description = rows.length ? rows.map(role => `**${escapeInline(role.name)}** — ${formatNumber(memberCounts.get(role.id) || 0)} عضو`).join('\n') : 'لا توجد رتب.';
      const embed = new EmbedBuilder().setColor(0x7964a8).setTitle(`🏷️ رتب ${escapeInline(guild.name)}`).setDescription(description);
      return reply(interaction, '', { embeds: [embed], ephemeral: false });
    }

    if (name === 'setnick') {
      const actor = await requirePermission(interaction, P.ManageNicknames, 'إدارة الألقاب');
      if (!actor) return;
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      if (!member.manageable || !actorCanManageTarget(guild, actor, member)) return reply(interaction, '❌ لا يمكن تغيير لقب عضو أعلى منك أو أعلى من رتبة البوت.');
      const nickname = interaction.options.getString('nickname');
      await member.setNickname(nickname || null, `تغيير لقب بواسطة ${interaction.user.tag}`);
      return reply(interaction, `✅ تم تحديث لقب <@${member.id}>.`);
    }

    if (name === 'ban' || name === 'kick' || name === 'vkick') {
      const permission = name === 'ban' ? P.BanMembers : name === 'kick' ? P.KickMembers : P.MoveMembers;
      const label = name === 'ban' ? 'حظر الأعضاء' : name === 'kick' ? 'طرد الأعضاء' : 'نقل الأعضاء';
      const actor = await requirePermission(interaction, permission, label);
      if (!actor) return;
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      if (!actorCanManageTarget(guild, actor, member)) return reply(interaction, '❌ لا يمكنك تطبيق هذا الإجراء على عضو أعلى منك.');
      const reason = safeReason(interaction.options.getString('reason'), `بواسطة ${interaction.user.tag}`);
      if (name === 'vkick') {
        if (!member.voice.channel) return reply(interaction, '❌ العضو ليس في روم صوتي.');
        await member.voice.disconnect(reason);
      } else if (name === 'ban') {
        if (!member.bannable) return reply(interaction, '❌ لا أستطيع حظر هذا العضو؛ تحقق من ترتيب الرتب وصلاحيات البوت.');
        // المدة تقبل الآن الوحدات: 30 دقيقة · 2h ساعتان · 7d أسبوع · دائم
        const parsedBan = parseDuration(interaction.options.getString('duration_minutes'));
        if (!parsedBan.ok) return reply(interaction, `❌ ${parsedBan.reason}\n${DURATION_HINT}`);
        const durationMinutes = parsedBan.permanent ? null : parsedBan.minutes;
        if (durationMinutes) {
          const unbanAt = new Date(Date.now() + durationMinutes * 60_000);
          await pool.query(`INSERT INTO scheduled_unbans (guild_id,user_id,unban_at,reason) VALUES ($1,$2,$3,$4)
            ON CONFLICT (guild_id,user_id) DO UPDATE SET unban_at=EXCLUDED.unban_at,reason=EXCLUDED.reason`,
          [guild.id, member.id, unbanAt, reason]);
          try {
            await member.ban({ reason });
          } catch (error) {
            await pool.query('DELETE FROM scheduled_unbans WHERE guild_id=$1 AND user_id=$2', [guild.id, member.id]).catch(() => {});
            throw error;
          }
          scheduleUnban({ guild_id: guild.id, user_id: member.id, unban_at: unbanAt, reason });
          return reply(interaction, `✅ تم حظر <@${member.id}> لمدة **${durationMinutes} دقيقة**؛ سيُرفع الحظر تلقائياً.`);
        }
        await member.ban({ reason });
        await pool.query('DELETE FROM scheduled_unbans WHERE guild_id=$1 AND user_id=$2', [guild.id, member.id]);
      } else {
        if (!member.kickable) return reply(interaction, '❌ لا أستطيع طرد هذا العضو؛ تحقق من ترتيب الرتب وصلاحيات البوت.');
        await member.kick(reason);
      }
      return reply(interaction, `✅ تم تنفيذ **${name}** على <@${member.id}>.`, { ephemeral: false });
    }

    if (name === 'unban') {
      if (!await requirePermission(interaction, P.BanMembers, 'حظر الأعضاء')) return;
      const userId = interaction.options.getString('user_id').trim();
      if (!/^\d{17,20}$/.test(userId)) return reply(interaction, '❌ آيدي ديسكورد غير صالح.');
      await guild.members.unban(userId, safeReason(interaction.options.getString('reason'), `بواسطة ${interaction.user.tag}`));
      await pool.query('DELETE FROM scheduled_unbans WHERE guild_id=$1 AND user_id=$2', [guild.id, userId]);
      return reply(interaction, `✅ تم فك الحظر عن الحساب ${userId}.`, { ephemeral: false });
    }

    // ==========================================================================
    // 🔇 /mute و /unmute — كتم كتابي فقط أو صوتي فقط
    // ==========================================================================
    // 🌉 أوامر ينفّذها system.js بنفسه (منطقها ومتغيّراتها موجودة هناك)
    if (SYSTEM_SLASH_COMMANDS.includes(name)) {
      const systemHandler = getSystemSlashHandler(name);
      if (!systemHandler) return reply(interaction, '❌ هذا الأمر غير جاهز بعد. أعد تشغيل البوت ثم حاول مجدداً.');
      return systemHandler(interaction);
    }

    // ======================================================================
    // 🧩 /tax و /come و /say — نفس منطق البريفكس تماماً عبر customCommands.js
    // الصلاحيات تُقرأ من نفس جدول main_permissions الذي تستخدمه نسخة البريفكس.
    // ======================================================================
    if (name === 'tax' || name === 'come' || name === 'say') {
      const permissionColumn = { tax: 'tax_role_id', come: 'come_role_id', say: 'say_role_id' }[name];
      const denyMessage = {
        tax: '❌ لا تمتلك صلاحية استخدام أمر الضريبة!',
        come: '❌ لا تمتلك صلاحية أمر الاستدعاء!',
        say: '❌ لا تمتلك صلاحية استخدام أمر التحدث!'
      }[name];

      // نفس قاعدة الصلاحية في ticketHelpers.hasAdminCommandPermission
      let allowed = interaction.member.permissions.has(P.Administrator);
      if (!allowed) {
        const permsRow = await pool.query('SELECT * FROM permissions WHERE key = $1', ['main_permissions'])
          .then(r => r.rows[0]).catch(() => null);
        if (permsRow) {
          const roleMatches = value => String(value || '').split(/[\s,]+/).filter(Boolean)
            .some(roleId => interaction.member.roles.cache.has(roleId));
          allowed = roleMatches(permsRow.all_commands_role_id) || roleMatches(permsRow[permissionColumn]);
          if (!allowed && !permsRow[permissionColumn]) {
            const fallbackRole = guild.roles.cache.find(r => r.name === 'ادمن ستريس');
            allowed = Boolean(fallbackRole && interaction.member.roles.cache.has(fallbackRole.id));
          }
        }
      }
      if (!allowed) return reply(interaction, denyMessage);

      if (name === 'tax') {
        const taxConfig = await getTaxCommandConfig(pool);
        if (!taxConfig.enabled) return reply(interaction, '⛔ أمر الضريبة متوقف حالياً من لوحة التحكم.');
        const result = buildTaxPayload(taxConfig, interaction.options.getInteger('amount'));
        if (result.error) return reply(interaction, result.error);
        return interaction.reply({ ...result.payload, ephemeral: false });
      }

      if (name === 'come') {
        const comeConfig = await getComeCommandConfig(pool);
        if (!comeConfig.enabled) return reply(interaction, '⛔ أمر الاستدعاء متوقف حالياً من لوحة التحكم.');
        const targetUser = interaction.options.getUser('member');
        const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
        if (!targetMember) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
        const result = buildComePayload(comeConfig, {
          adminTag: interaction.user.tag,
          memberTag: targetMember.user.tag,
          channelMention: interaction.channel ? interaction.channel.toString() : '',
          messageUrl: `https://discord.com/channels/${guild.id}/${interaction.channelId}`
        });
        try {
          await targetMember.send(result.payload);
        } catch {
          return reply(interaction, '❌ تعذر إرسال رسالة بالخاص للشخص.');
        }
        return reply(interaction, `✅ تم إرسال إشعار استدعاء بالخاص لـ <@${targetMember.id}>.`);
      }

      const sayConfig = await getSayCommandConfig(pool);
      if (!sayConfig.enabled) return reply(interaction, '⛔ أمر التحدث متوقف حالياً من لوحة التحكم.');
      const result = buildSayPayload(sayConfig, interaction.options.getString('text'));
      if (result.error) return reply(interaction, result.error);
      if (!interaction.channel) return reply(interaction, '❌ تعذر الوصول إلى الروم الحالي.');
      await interaction.channel.send(result.payload);
      return reply(interaction, '✅ تم نشر الرسالة.');
    }

    if (name === 'mute' || name === 'unmute') {
      const action = interaction.options.getSubcommand();
      const isVoice = action === 'voice';
      const isRemoving = name === 'unmute';
      const permission = isVoice ? P.MuteMembers : P.ModerateMembers;
      const actor = await requirePermission(interaction, permission, isVoice ? 'كتم الأعضاء صوتياً' : 'إدارة الأعضاء');
      if (!actor) return;
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      if (!actorCanManageTarget(guild, actor, member)) return reply(interaction, '❌ لا يمكنك تطبيق هذا الإجراء على عضو أعلى منك.');
      const reason = safeReason(interaction.options.getString('reason'), `بواسطة ${interaction.user.tag}`);

      // ----- كتم صوتي فقط: العضو يبقى قادراً على الكتابة -----
      if (isVoice) {
        if (!member.voice.channel) return reply(interaction, '❌ العضو ليس في روم صوتي حالياً، لذا لا يمكن تطبيق الكتم الصوتي عليه.');
        try {
          await member.voice.setMute(!isRemoving, reason);
        } catch (error) {
          return reply(interaction, '❌ تعذر تنفيذ الكتم الصوتي. تأكد أن للبوت صلاحية **كتم الأعضاء** وأن رتبته أعلى من رتبة العضو.');
        }
        return reply(interaction, isRemoving
          ? `🔊 تم فك الكتم الصوتي عن <@${member.id}> — يستطيع التحدث الآن.`
          : `🔇 تم كتم <@${member.id}> صوتياً فقط — ما زال يستطيع الكتابة.`);
      }

      // ----- كتم كتابي فقط: العضو يبقى قادراً على التحدث صوتياً -----
      let mutedRole;
      try {
        mutedRole = await getOrCreateMutedRole(guild);
      } catch (error) {
        return reply(interaction, '❌ تعذر تجهيز رتبة الكتم. تأكد أن للبوت صلاحية **إدارة الرتب** وأن رتبته أعلى من رتبة الكتم.');
      }

      const botMember = guild.members.me;
      if (botMember && mutedRole.comparePositionTo(botMember.roles.highest) >= 0) {
        return reply(interaction, `❌ رتبة **${mutedRole.name}** أعلى من رتبة البوت. ارفع رتبة البوت فوقها ثم أعد المحاولة.`);
      }

      if (isRemoving) {
        if (!member.roles.cache.has(mutedRole.id)) return reply(interaction, 'ℹ️ هذا العضو ليس مكتوماً كتابياً أصلاً.');
        await member.roles.remove(mutedRole, reason);
        await pool.query('DELETE FROM scheduled_unmutes WHERE guild_id=$1 AND user_id=$2', [guild.id, member.id]).catch(() => {});
        cancelScheduledUnmute(guild.id, member.id);
        return reply(interaction, `🔊 تم فك الكتم الكتابي عن <@${member.id}> — يستطيع الكتابة الآن.`);
      }

      await member.roles.add(mutedRole, reason);
      const parsedMute = parseDuration(interaction.options.getString('minutes'));
      if (!parsedMute.ok) return reply(interaction, `❌ ${parsedMute.reason}\n${DURATION_HINT}`);
      const minutes = parsedMute.permanent ? null : parsedMute.minutes;

      if (minutes) {
        const unmuteAt = new Date(Date.now() + minutes * 60 * 1000);
        await pool.query(`
          INSERT INTO scheduled_unmutes (guild_id, user_id, unmute_at, reason) VALUES ($1,$2,$3,$4)
          ON CONFLICT (guild_id, user_id) DO UPDATE SET unmute_at = EXCLUDED.unmute_at, reason = EXCLUDED.reason
        `, [guild.id, member.id, unmuteAt, reason]);
        scheduleUnmute({ guild_id: guild.id, user_id: member.id, unmute_at: unmuteAt, reason });
        return reply(interaction, `🔇 تم كتم <@${member.id}> كتابياً لمدة **${formatDuration(minutes)}** — ما زال يستطيع التحدث صوتياً.`);
      }

      // كتم دائم: نزيل أي موعد فك سابق حتى لا يُفك تلقائياً
      await pool.query('DELETE FROM scheduled_unmutes WHERE guild_id=$1 AND user_id=$2', [guild.id, member.id]).catch(() => {});
      cancelScheduledUnmute(guild.id, member.id);
      return reply(interaction, `🔇 تم كتم <@${member.id}> كتابياً حتى فك الكتم يدوياً — ما زال يستطيع التحدث صوتياً.`);
    }

    if (name === 'time' || name === 'untime') {
      const action = interaction.options.getSubcommand();
      const isVoice = action === 'voice';
      const isRemoving = name === 'untime';
      const permission = isVoice ? P.MuteMembers : P.ModerateMembers;
      const actor = await requirePermission(interaction, permission, isVoice ? 'كتم الأعضاء صوتياً' : 'إدارة Timeout');
      if (!actor) return;
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      if (!actorCanManageTarget(guild, actor, member)) return reply(interaction, '❌ لا يمكنك تطبيق هذا الإجراء على عضو أعلى منك.');
      const reason = safeReason(interaction.options.getString('reason'), `بواسطة ${interaction.user.tag}`);
      if (isVoice) {
        if (!member.voice.channel) return reply(interaction, '❌ العضو ليس في روم صوتي.');
        await member.voice.setMute(!isRemoving, reason);
        return reply(interaction, isRemoving ? `🔊 أُلغي الكتم الصوتي عن <@${member.id}>.` : `🔇 تم كتم <@${member.id}> صوتياً.`);
      }
      if (isRemoving) {
        await member.timeout(null, reason);
        return reply(interaction, `✅ أُلغي Timeout عن <@${member.id}>.`);
      }
      const parsedTime = parseDuration(interaction.options.getString('minutes'));
      if (!parsedTime.ok) return reply(interaction, `❌ ${parsedTime.reason}\n${DURATION_HINT}`);
      // ديسكورد يسمح بحد أقصى 28 يوماً للـ Timeout — نوضّح بدل أن يفشل الطلب.
      const minutes = parsedTime.minutes || 60;
      if (minutes > 40320) return reply(interaction, '❌ أقصى مدة Timeout في ديسكورد 28 يوماً (`28d`).');
      await member.timeout(minutes * 60 * 1000, reason);
      return reply(interaction, `🔇 تم تطبيق Timeout على <@${member.id}> لمدة **${formatDuration(minutes)}**.`);
    }

    if (name === 'clear') {
      if (!await requirePermission(interaction, P.ManageMessages, 'إدارة الرسائل')) return;
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased() || !channel.messages) return reply(interaction, '❌ هذا الأمر يعمل في الرومات النصية فقط.');
      const selectedUser = interaction.options.getUser('member');
      const member = selectedUser ? await guild.members.fetch(selectedUser.id).catch(() => null) : null;
      if (selectedUser && !member) return reply(interaction, '❌ العضو المحدد غير موجود في السيرفر.');
      const requestedAmount = interaction.options.getInteger('amount');
      if (!member && !requestedAmount) return reply(interaction, 'اكتب العدد: `/clear amount [member]` أو اذكر عضواً لمسح رسائله.');
      const amount = requestedAmount || 100;
      if (amount < 1 || amount > 100) return reply(interaction, '❌ اختر عدداً من 1 إلى 100.');

      if (interaction.isPrefixCommand) {
        const permissionResult = await pool.query('SELECT clear_cleanup_mode FROM permissions WHERE key = $1', ['main_permissions']);
        const cleanupMode = permissionResult.rows[0]?.clear_cleanup_mode || 'bot_only';
        const deleteInvocation = cleanupMode === 'both' || cleanupMode === 'user_only';
        const deleteConfirmation = cleanupMode === 'both' || cleanupMode === 'bot_only';
        let collected = [];
        if (member) {
          let lastId = null;
          let scans = 0;
          while (collected.length < 100 && scans < 10) {
            const fetchOptions = { limit: 100 };
            if (lastId) fetchOptions.before = lastId;
            const fetched = await channel.messages.fetch(fetchOptions);
            if (!fetched.size) break;
            lastId = fetched.last().id;
            scans++;
            collected.push(...fetched.filter(item => item.author.id === member.id && item.id !== interaction.sourceMessage.id).values());
          }
          collected = collected.slice(0, 100);
        } else {
          const fetched = await channel.messages.fetch({ limit: amount });
          collected = [...fetched.values()].filter(item => item.id !== interaction.sourceMessage.id).slice(0, amount);
        }
        if (!collected.length) return reply(interaction, '⚠️ لم أجد رسائل مطابقة للمسح.');
        if (deleteInvocation) await interaction.sourceMessage.delete().catch(() => {});
        await channel.bulkDelete(collected, true);
        const confirmation = await channel.send(`🧹 تم مسح **${collected.length}** رسالة${member ? ` لـ **${escapeInline(member.user.tag)}**` : ''} بنجاح.`);
        if (deleteConfirmation) setTimeout(() => confirmation.delete().catch(() => {}), 3000);
        return confirmation;
      }

      await interaction.deferReply({ ephemeral: true });
      let collected = [];
      if (member) {
        let lastId = null;
        let scans = 0;
        while (collected.length < 100 && scans < 10) {
          const fetchOptions = { limit: 100 };
          if (lastId) fetchOptions.before = lastId;
          const fetched = await channel.messages.fetch(fetchOptions);
          if (!fetched.size) break;
          lastId = fetched.last().id;
          scans++;
          collected.push(...fetched.filter(item => item.author.id === member.id).values());
        }
        collected = collected.slice(0, 100);
      } else {
        const fetched = await channel.messages.fetch({ limit: amount });
        collected = [...fetched.values()];
      }
      if (!collected.length) return reply(interaction, 'لم أجد رسائل مطابقة ضمن الرسائل المتاحة.');
      const deleted = await channel.bulkDelete(collected, true);
      return reply(interaction, `🧹 حُذفت **${deleted.size}** رسالة${member ? ` لـ <@${member.id}>` : ''}. الرسائل الأقدم من 14 يوماً لا يمكن حذفها بالجملة.`);
    }

    if (name === 'role') {
      const actor = await requirePermission(interaction, P.ManageRoles, 'إدارة الرتب');
      if (!actor) return;
      const action = interaction.options.getSubcommand();
      const role = interaction.options.getRole('role');
      if (!role.editable || role.id === guild.id || role.managed || role.permissions.has(P.Administrator)) return reply(interaction, '❌ لا يمكن للبوت إدارة هذه الرتبة.');
      if (!actorCanManageRole(guild, actor, role)) return reply(interaction, '❌ لا يمكنك إدارة رتبة أعلى منك.');
      if (action === 'multiple') {
        const requiredRole = interaction.options.getRole('required_role');
        if (!requiredRole) return reply(interaction, '❌ حدّد رتبة الأساس لتحديد الأعضاء المستهدفين.');
        await interaction.deferReply({ ephemeral: true });
        const members = await guild.members.fetch();
        const targets = members.filter(member => member.roles.cache.has(requiredRole.id) && actorCanManageTarget(guild, actor, member));
        const selectedAction = interaction.options.getString('action');
        const batch = [...targets.values()].slice(0, 100);
        let completed = 0;
        for (const target of batch) {
          if (!target.manageable) continue;
          try {
            if (selectedAction === 'give' && !target.roles.cache.has(role.id)) await target.roles.add(role);
            if (selectedAction === 'remove' && target.roles.cache.has(role.id)) await target.roles.remove(role);
            completed++;
          } catch (_) { /* استمر على بقية الأعضاء حتى فشل عضو لا يوقف العملية كلها */ }
        }
        const capped = targets.size > batch.length ? ' (حُدّ التنفيذ بأول 100 عضو كحماية)' : '';
        return reply(interaction, `✅ اكتملت العملية على **${completed}** عضو${capped}.`);
      }
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      if (!member.manageable || !actorCanManageTarget(guild, actor, member)) return reply(interaction, '❌ لا يمكن إدارة عضو أعلى منك أو أعلى من رتبة البوت.');
      // 🔁 toggle: نفس سلوك !رول — تُسحب إن كانت معه، وتُعطى إن لم تكن
      if (action === 'toggle') {
        const hadRole = member.roles.cache.has(role.id);
        if (hadRole) await member.roles.remove(role, `بواسطة ${interaction.user.tag}`);
        else await member.roles.add(role, `بواسطة ${interaction.user.tag}`);
        return reply(interaction, hadRole
          ? `✅ تم سحب رتبة **${escapeInline(role.name)}** من <@${member.id}> (كانت معه مسبقاً).`
          : `✅ تم إعطاء رتبة **${escapeInline(role.name)}** إلى <@${member.id}>.`);
      }
      if (action === 'give') await member.roles.add(role, `بواسطة ${interaction.user.tag}`);
      else await member.roles.remove(role, `بواسطة ${interaction.user.tag}`);
      return reply(interaction, `✅ ${action === 'give' ? 'أُعطيت' : 'سُحبت'} رتبة **${escapeInline(role.name)}** من <@${member.id}>.`);
    }

    if (name === 'points') {
      if (!await requirePermission(interaction, P.ManageMessages, 'إدارة الرسائل')) return;
      const action = interaction.options.getSubcommand();
      const selectedUser = interaction.options.getUser('member');
      const member = selectedUser ? await guild.members.fetch(selectedUser.id).catch(() => null) : null;
      if (selectedUser && !member) return reply(interaction, '❌ العضو المحدد غير موجود في هذا السيرفر.');
      if (action === 'set' || action === 'increase' || action === 'decrease') {
        if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
        const amount = interaction.options.getInteger('amount');
        const current = await pool.query('SELECT points FROM moderation_points WHERE guild_id=$1 AND user_id=$2', [guild.id, member.id]);
        const before = Number(current.rows[0]?.points || 0);
        const next = action === 'set' ? amount : action === 'increase' ? before + amount : Math.max(0, before - amount);
        await pool.query(`INSERT INTO moderation_points (guild_id,user_id,points) VALUES ($1,$2,$3)
          ON CONFLICT (guild_id,user_id) DO UPDATE SET points=EXCLUDED.points`, [guild.id, member.id, next]);
        return reply(interaction, `✅ نقاط <@${member.id}> أصبحت **${formatNumber(next)}**.`);
      }
      if (action === 'reset') {
        if (member) {
          await pool.query('DELETE FROM moderation_points WHERE guild_id=$1 AND user_id=$2', [guild.id, member.id]);
          return reply(interaction, `✅ تم تصفير نقاط <@${member.id}>.`);
        }
        await pool.query('DELETE FROM moderation_points WHERE guild_id=$1', [guild.id]);
        return reply(interaction, '✅ تم تصفير نقاط جميع أعضاء هذا السيرفر.');
      }
      if (action === 'list' && member) {
        const result = await pool.query('SELECT points FROM moderation_points WHERE guild_id=$1 AND user_id=$2', [guild.id, member.id]);
        return reply(interaction, `📊 نقاط <@${member.id}>: **${formatNumber(result.rows[0]?.points || 0)}**.`, { ephemeral: false });
      }
      const page = interaction.options.getInteger('page') || 1;
      const result = await pool.query('SELECT user_id,points FROM moderation_points WHERE guild_id=$1 ORDER BY points DESC,user_id LIMIT 10 OFFSET $2', [guild.id, (page - 1) * 10]);
      if (!result.rows.length) return reply(interaction, 'لا توجد نقاط مسجلة لهذه الصفحة.');
      const lines = result.rows.map((row, index) => `**${(page - 1) * 10 + index + 1}.** <@${row.user_id}> — **${formatNumber(row.points)}**`);
      return reply(interaction, `🏅 **نقاط الإدارة — صفحة ${page}**\n${lines.join('\n')}`, { ephemeral: false });
    }

    if (name === 'warn') {
      if (!await requirePermission(interaction, P.ManageMessages, 'إدارة الرسائل')) return;
      const member = await getMember(interaction);
      if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
      const reason = interaction.options.getString('reason').trim();
      const result = await pool.query(`INSERT INTO moderation_warnings (guild_id,user_id,moderator_id,reason)
        VALUES ($1,$2,$3,$4) RETURNING id`, [guild.id, member.id, interaction.user.id, reason]);
      const warningId = result.rows[0].id;

      // ======================================================================
      // 📨 تنبيه العضو بالخاص برسالة يتحكم بها المالك من اللوحة.
      //
      // ترتيب مقصود: الإنذار سُجِّل في قاعدة البيانات أعلاه *قبل* محاولة
      // الإرسال. فلو كان خاص العضو مغلقاً أو فشل أي شيء هنا، يبقى الإنذار
      // مسجّلاً ويبقى الأمر ناجحاً — الإشعار خدمة إضافية لا شرط للتنفيذ.
      // كل هذا الجزء داخل try واحد لئلا يُسقط أمر الإنذار مهما حدث.
      // ======================================================================
      let dmStatus = 'disabled';
      try {
        const warnDmConfig = await getWarnDmConfig(pool);
        if (warnDmConfig.enabled) {
          const countResult = await pool.query(
            'SELECT COUNT(*)::int AS total FROM moderation_warnings WHERE guild_id=$1 AND user_id=$2',
            [guild.id, member.id]
          );
          dmStatus = await sendWarnDirectMessage(member.user, warnDmConfig, {
            '{العضو}': member.user.username,
            '{السبب}': reason,
            '{المشرف}': interaction.user.username,
            '{السيرفر}': guild.name,
            '{رقم_الإنذار}': String(warningId),
            '{عدد_الإنذارات}': String(countResult.rows[0]?.total ?? 1)
          });
        }
      } catch (dmError) {
        console.error('تعذر إرسال إنذار الخاص (الإنذار مسجَّل على أي حال):', dmError);
        dmStatus = 'blocked';
      }

      const dmNote = dmStatus === 'sent' ? '\n📨 أُرسل تنبيه للعضو بالخاص.'
        : dmStatus === 'blocked' ? '\n📪 تعذّر إرسال الخاص للعضو (خاصه مغلق).'
        : '';
      return reply(interaction, `⚠️ تم تسجيل إنذار **#${warningId}** على <@${member.id}>. السبب: ${escapeInline(reason)}${dmNote}`);
    }

    if (name === 'warn_remove') {
      if (!await requirePermission(interaction, P.ManageMessages, 'إدارة الرسائل')) return;
      const warningId = interaction.options.getInteger('warning_id');
      const member = await getMember(interaction);
      if (!!warningId === !!member) return reply(interaction, '❌ حدّد رقم إنذار أو عضواً واحداً لحذف جميع إنذاراته.');
      const result = warningId
        ? await pool.query('DELETE FROM moderation_warnings WHERE guild_id=$1 AND id=$2 RETURNING id', [guild.id, warningId])
        : await pool.query('DELETE FROM moderation_warnings WHERE guild_id=$1 AND user_id=$2 RETURNING id', [guild.id, member.id]);
      return reply(interaction, result.rowCount ? `✅ تم حذف **${result.rowCount}** إنذار.` : 'لم أعثر على إنذارات مطابقة.');
    }

    if (name === 'warnings') {
      const targetUser = interaction.options.getUser('member') || interaction.user;
      if (targetUser.id !== interaction.user.id && !await requirePermission(interaction, P.ManageMessages, 'إدارة الرسائل')) return;
      const result = await pool.query('SELECT id,moderator_id,reason,created_at FROM moderation_warnings WHERE guild_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 10', [guild.id, targetUser.id]);
      if (!result.rows.length) return reply(interaction, `لا توجد إنذارات مسجلة لـ <@${targetUser.id}>.`);
      const lines = result.rows.map(row => `**#${row.id}** — ${escapeInline(row.reason)}\n<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R> · المشرف <@${row.moderator_id}>`);
      return reply(interaction, `⚠️ **آخر إنذارات <@${targetUser.id}>**\n${lines.join('\n\n')}`);
    }

    if (name === 'lock' || name === 'unlock') {
      if (!await requirePermission(interaction, P.ManageChannels, 'إدارة القنوات')) return;
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel || !channel.permissionOverwrites) return reply(interaction, '❌ اختر روم نصي صالحاً.');
      const locked = name === 'lock';
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: !locked }, {
        reason: safeReason(interaction.options.getString('reason'), `${locked ? 'قفل' : 'فتح'} بواسطة ${interaction.user.tag}`)
      });
      return reply(interaction, `✅ تم ${locked ? 'قفل' : 'فتح'} <#${channel.id}>.`);
    }

    if (name === 'hide' || name === 'show') {
      if (!await requirePermission(interaction, P.ManageChannels, 'إدارة القنوات')) return;
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel || !channel.permissionOverwrites) return reply(interaction, '❌ اختر قناة صالحة.');
      const hidden = name === 'hide';
      await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: !hidden }, {
        reason: `${hidden ? 'إخفاء' : 'إظهار'} القناة بواسطة ${interaction.user.tag}`
      });
      return reply(interaction, `✅ تم ${hidden ? 'إخفاء' : 'إظهار'} <#${channel.id}> ${hidden ? 'عن' : 'ل'} الأعضاء.`);
    }

    if (name === 'setcolor') {
      const actor = await requirePermission(interaction, P.ManageRoles, 'إدارة الرتب');
      if (!actor) return;
      const role = interaction.options.getRole('role');
      const hex = interaction.options.getString('hex').trim();
      if (!role.editable || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return reply(interaction, '❌ تحقق من صلاحية الرتبة واكتب لوناً بصيغة Hex مثل `#4f46e5`.');
      if (!actorCanManageRole(guild, actor, role)) return reply(interaction, '❌ لا يمكنك تعديل رتبة أعلى منك.');
      await role.setColor(hex.startsWith('#') ? hex : `#${hex}`, `بواسطة ${interaction.user.tag}`);
      return reply(interaction, `🎨 تم تحديث لون رتبة **${escapeInline(role.name)}**.`);
    }

    if (name === 'slowmode') {
      if (!await requirePermission(interaction, P.ManageChannels, 'إدارة القنوات')) return;
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel || typeof channel.setRateLimitPerUser !== 'function') return reply(interaction, '❌ اختر روم نصي يدعم الإبطاء.');
      const seconds = interaction.options.getInteger('seconds');
      await channel.setRateLimitPerUser(seconds, `بواسطة ${interaction.user.tag}`);
      return reply(interaction, `✅ تم ضبط الإبطاء في <#${channel.id}> إلى **${seconds} ثانية**.`);
    }

    if (name === 'reset') {
      if (!await requirePermission(interaction, P.ManageGuild, 'إدارة السيرفر')) return;
      const period = interaction.options.getString('period');
      const user = interaction.options.getUser('member');
      let userIds;
      if (user) {
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return reply(interaction, '❌ العضو غير موجود في هذا السيرفر.');
        userIds = [member.id];
      } else {
        await interaction.deferReply({ ephemeral: true });
        const members = await guild.members.fetch();
        userIds = [...members.keys()];
      }
      if (!userIds.length) return reply(interaction, 'لم أجد أعضاء لتصفير بياناتهم.');
      const values = { total: 'total_xp=0,level=0', daily: 'daily_xp=0', weekly: 'weekly_xp=0', monthly: 'monthly_xp=0', all: 'total_xp=0,level=0,daily_xp=0,weekly_xp=0,monthly_xp=0' };
      const assignments = values[period];
      const result = await pool.query(`UPDATE xp_users SET ${assignments} WHERE user_id = ANY($1::varchar[])`, [userIds]);
      if (period === 'total' || period === 'all') {
        for (const id of userIds) {
          const member = guild.members.cache.get(id);
          if (member) await syncRewardRole(member, 0).catch(() => {});
        }
      }
      return reply(interaction, `✅ تم تصفير **${result.rowCount}** سجل XP (${period})${user ? ` للعضو <@${user.id}>` : ' لأعضاء السيرفر'}.`);
    }
  }

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() || !commandBuilders.some(command => command.name === interaction.commandName)) return;
    try {
      await execute(interaction);
    } catch (error) {
      console.error(`❌ خطأ في /${interaction.commandName}:`, error);
      const message = error && error.code === 50013
        ? '❌ صلاحيات البوت أو ترتيب رتبه لا يسمحان بتنفيذ ذلك.'
        : '❌ تعذر تنفيذ الأمر. تحقق من صلاحيات العضو والبوت ثم أعد المحاولة.';
      await reply(interaction, message).catch(() => {});
    }
  });

  registerSlashPrefix(client, pool, commandData, execute);
  console.log(`✅ تم تحميل ${commandBuilders.length} أمر سلاش إضافي مع بريفكس موحّد.`);
};

module.exports.commandData = commandData;
