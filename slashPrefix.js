'use strict';

const {
  getSlashCommandConfig,
  getCachedSlashCommandConfig,
  SLASH_COMMAND_NAMES
} = require('./slashCommandConfig');
const { buildUsageEmbed } = require('./commandUsage');
const { parseDuration } = require('./duration');

// أسماء الخيارات التي تمثّل مدة زمنية — نصية الصيغة لكن محدودة المحتوى.
const DURATION_OPTIONS = new Set(['duration_minutes', 'minutes', 'duration']);

const OPTION = Object.freeze({ SUBCOMMAND: 1, STRING: 3, INTEGER: 4, USER: 6, CHANNEL: 7, ROLE: 8 });

function extractSnowflake(value, mentionType) {
  const patterns = {
    user: /^<@!?([0-9]{5,25})>$/,
    role: /^<@&([0-9]{5,25})>$/,
    channel: /^<#([0-9]{5,25})>$/
  };
  return String(value || '').match(patterns[mentionType])?.[1] || (/^[0-9]{5,25}$/.test(value || '') ? value : null);
}

// 🔤 تطبيع النص العربي لمطابقة الخيارات: يوحّد الهمزات والألف المقصورة
// والتاء المربوطة ويزيل التشكيل، حتى يقبل الأمر "اداري" و"إداري" معاً.
function normalizeArabic(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')   // التشكيل والتطويل
    .replace(/[\u0622\u0623\u0625]/g, '\u0627') // آ أ إ → ا
    .replace(/\u0649/g, '\u064A')             // ى → ي
    .replace(/\u0629/g, '\u0647')             // ة → ه
    .trim();
}

// ==========================================================================
// 🔤 مطابقة قيم الخيارات ذات القائمة (choices) بالبريفكس
//
// في السلاش يختار العضو من قائمة منسدلة، أما بالبريفكس فهو يكتب القيمة يدوياً.
// فنقبل أربع صيغ، بالترتيب، وأول تطابق يفوز:
//
//   1) القيمة الرسمية كاملة          !top weekly
//   2) الاسم المعروض أو مرادف عربي   !top الأسبوعي  ·  !top اسبوعي
//   3) الكلمة الإنجليزية الشائعة     !top week
//   4) بادئة فريدة (حرف أو أكثر)     !top w   →  weekly
//
// البادئة تُقبل فقط إن كانت **فريدة**. لو بدأت قيمتان بالحرف نفسه يُرفض الحرف
// ويظهر للعضو إيمبد الاستخدام مع القيم المتاحة — أفضل من تخمين خاطئ صامت.
// ==========================================================================

// مرادفات عربية وإنجليزية شائعة لا تُشتق آلياً من القيمة نفسها.
const CHOICE_SYNONYMS = Object.freeze({
  all: 'total', total_xp: 'total', 'كلي': 'total', 'اجمالي': 'total',
  day: 'daily', 'يومي': 'daily',
  week: 'weekly', 'اسبوعي': 'weekly',
  month: 'monthly', 'شهري': 'monthly'
});

function matchChoice(option, rawValue) {
  const choices = option.choices || [];
  const typed = String(rawValue || '').trim();
  if (!typed) return null;
  const lower = typed.toLocaleLowerCase();
  const target = normalizeArabic(typed);

  // 1) تطابق تام مع القيمة الرسمية
  const exact = choices.find(item => String(item.value).toLocaleLowerCase() === lower);
  if (exact) return exact.value;

  // 2) تطابق مع الاسم المعروض بعد تطبيع الهمزة والألف
  //    (العضو يكتب «اسبوعي» ونحن نعرض «الأسبوعي»)
  const byName = choices.find(item =>
    normalizeArabic(item.value) === target || normalizeArabic(item.name) === target
  );
  if (byName) return byName.value;

  // 3) مرادف معروف
  const synonym = CHOICE_SYNONYMS[lower] || CHOICE_SYNONYMS[target];
  if (synonym) {
    const matched = choices.find(item => item.value === synonym);
    if (matched) return matched.value;
  }

  // 4) بادئة فريدة — هنا يعمل الاختصار بحرف واحد: d / w / m / t
  const prefixMatches = choices.filter(item =>
    String(item.value).toLocaleLowerCase().startsWith(lower)
  );
  if (prefixMatches.length === 1) return prefixMatches[0].value;

  return null;
}

async function resolveOptionValue(option, token, message) {
  if (option.type === OPTION.USER) {
    const mentioned = message.mentions.users.find(user => user.id === extractSnowflake(token, 'user'));
    if (mentioned) return mentioned;
    const id = extractSnowflake(token, 'user');
    if (id) {
      const member = await message.guild.members.fetch(id).catch(() => null);
      if (member) return member.user;
      return message.client.users.fetch(id).catch(() => null);
    }
    const needle = String(token || '').replace(/^@/, '').toLocaleLowerCase();
    const member = message.guild.members.cache.find(candidate =>
      [candidate.user.username, candidate.user.tag, candidate.displayName].some(value => String(value || '').toLocaleLowerCase() === needle)
    );
    return member ? member.user : null;
  }

  if (option.type === OPTION.ROLE) {
    const id = extractSnowflake(token, 'role');
    if (id) return message.guild.roles.cache.get(id) || null;
    const needle = String(token || '').replace(/^@/, '').toLocaleLowerCase();
    return message.guild.roles.cache.find(role => role.name.toLocaleLowerCase() === needle) || null;
  }

  if (option.type === OPTION.CHANNEL) {
    const id = extractSnowflake(token, 'channel');
    if (id) return message.guild.channels.cache.get(id) || await message.guild.channels.fetch(id).catch(() => null);
    const needle = String(token || '').replace(/^#/, '').toLocaleLowerCase();
    return message.guild.channels.cache.find(channel => channel.name?.toLocaleLowerCase() === needle) || null;
  }

  if (option.type === OPTION.INTEGER) {
    if (!/^-?\d+$/.test(String(token || ''))) return null;
    const value = Number(token);
    return Number.isSafeInteger(value) ? value : null;
  }

  if (option.type === OPTION.STRING) {
    const value = String(token || '');
    if (option.choices?.length) return matchChoice(option, value);

    // ======================================================================
    // ⏱️ خيارات المدة نصية (لتقبل 2h و7d) لكنها ليست نصاً حراً.
    //
    // بدونها كان «!ban @عضو سبب الحظر» يضع كلمة «سبب» في خانة المدة،
    // لأن أي نص يُقبل. نتحقق من الصيغة فإن لم تكن مدة أعدنا null،
    // فيتخطّاها المحلّل (الخيار اختياري) وتذهب الكلمة إلى السبب كما يجب.
    // ======================================================================
    if (DURATION_OPTIONS.has(option.name)) {
      return parseDuration(value).ok ? value : null;
    }
    return value;
  }

  return token;
}

function defaultSubcommand(commandName, args, route) {
  if (commandName === 'time' || commandName === 'untime') return 'text';
  // توافق خلفي: !mute و !unmute كانا يعنيان الكتم الصوتي قبل فصل الأمر،
  // فنُبقي الافتراضي صوتياً ما لم يُكتب text صراحةً (!mute text @عضو).
  if (commandName === 'mute' || commandName === 'unmute') {
    return args[0] === 'text' || args[0] === 'voice' ? args.shift() : 'voice';
  }
  if (commandName === 'points') return 'list';
  if (commandName === 'role' && route.alias) return 'give';
  if (commandName === 'role') return null;
  return args[0] || null;
}

function buildUsage(commandName, subcommand, options) {
  const required = options.filter(option => option.required).map(option => `<${option.name}>`);
  return `!${commandName}${subcommand ? ` ${subcommand}` : ''}${required.length ? ` ${required.join(' ')}` : ''}`;
}

async function parsePrefixOptions(commandData, argsInput, route, message) {
  const args = [...argsInput];
  const values = { ...(route.values || {}) };
  let subcommand = route.subcommand || null;
  let options = commandData.options || [];
  const subcommands = options.filter(option => option.type === OPTION.SUBCOMMAND);

  if (subcommands.length) {
    if (!subcommand && subcommands.some(option => option.name === args[0])) subcommand = args.shift();
    if (!subcommand) subcommand = defaultSubcommand(commandData.name, args, route);
    const selected = subcommands.find(option => option.name === subcommand);
    if (!selected) return { error: `حدد نوع الأمر: ${subcommands.map(option => `\`${option.name}\``).join(' أو ')}.`, errorSubcommand: null };
    options = selected.options || [];

    // تقبل الصيغتين الشائعتين: !time @عضو 10 و !time 10 @عضو.
    if (commandData.name === 'time' && subcommand === 'text' && /^\d+$/.test(args[0] || '') && args[1]) {
      const first = args.shift();
      args.splice(1, 0, first);
    }
  }

  let cursor = 0;
  for (const option of options) {
    if (Object.prototype.hasOwnProperty.call(values, option.name)) continue;
    if (cursor >= args.length) {
      if (option.required) return { error: `ينقص الخيار المطلوب **${option.name}**.`, errorSubcommand: subcommand };
      continue;
    }

    if (option.type === OPTION.STRING && ['reason', 'title', 'nickname'].includes(option.name)) {
      const remaining = args.slice(cursor).join(' ').trim();
      if (!remaining) {
        if (option.required) return { error: `ينقص الخيار المطلوب **${option.name}**.`, errorSubcommand: subcommand };
        continue;
      }
      values[option.name] = remaining;
      cursor = args.length;
      continue;
    }

    const token = args[cursor];
    const resolved = await resolveOptionValue(option, token, message);
    if (resolved === null || resolved === undefined) {
      if (option.required) return { error: `تعذر فهم الخيار **${option.name}**.`, errorSubcommand: subcommand };

      // ======================================================================
      // 🔤 خيار اختياري بقائمة مغلقة + العضو كتب قيمة خارج القائمة = خطأ مطبعي.
      //
      // سابقاً كنا نتجاهله بصمت وننفّذ الأمر بالقيمة الافتراضية، فيظن العضو
      // أن طلبه نُفّذ. مثال: «!top wekly» كان يعرض التوب الإجمالي بلا أي تنبيه.
      // الآن نعرض إيمبد الاستخدام موضّحاً القيم المقبولة واختصاراتها.
      //
      // ملاحظة أمان: الخيار الاختياري الوحيد بقائمة مغلقة يتبعه خيار آخر في
      // البوت كله هو top.period (يتبعه archive). وتمرير archive بدون فترة
      // لا يعمل أصلاً — xpLeaderboard.js يتجاهل الأرشيف عندما تكون الفترة
      // «الإجمالي» — فلا سلوك صالح يُفقد بهذا التغيير.
      // ======================================================================
      if (option.choices?.length) {
        const allowed = option.choices.map(item => `\`${item.value}\``).join(' · ');
        return {
          error: `القيمة \`${String(token).slice(0, 40)}\` غير معروفة للخيار **${option.name}**.\nالقيم المقبولة: ${allowed}`,
          errorSubcommand: subcommand
        };
      }
      continue;
    }
    values[option.name] = resolved;
    cursor++;
  }

  // ==========================================================================
  // 🛡️ [إصلاح خطير — فقدان بيانات] فرض الخيارات الإلزامية الخاصة بالاختصار نفسه.
  //
  // كان الحقلان requireOptions و prefixUsage معرّفين في slashCommandConfig.js
  // لكن لم يقرأهما أي جزء من الكود إطلاقاً. النتيجة العملية:
  //   • !تصفير بدون منشن كان يصفّر إكسبي *كل أعضاء السيرفر* بصمت،
  //     رغم أن الاختصار مخصص لعضو واحد (ولهذا يوجد !تصفير-الكل منفصلاً).
  //
  // الآن يُطلب الخيار الناقص برسالة الاستخدام الصحيحة بدل تنفيذ تصفير شامل.
  // اختصارات "الكل" لا تحتوي requireOptions فيبقى سلوكها كما هو تماماً.
  // ==========================================================================
  if (Array.isArray(route.requireOptions)) {
    for (const requiredName of route.requireOptions) {
      const provided = values[requiredName];
      if (provided === undefined || provided === null || provided === '') {
        const usage = route.prefixUsage || buildUsage(commandData.name, subcommand, options);
        return { error: `الاستخدام الصحيح: \`${usage}\``, errorSubcommand: subcommand };
      }
    }
  }

  return { values, subcommand };
}

function makeMessageInteraction(message, commandName, parsed) {
  let replyMessage = null;
  const interaction = {
    commandName,
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    user: message.author,
    sourceMessage: message,
    isPrefixCommand: true,
    id: `${message.id}${Date.now()}`.slice(0, 40),
    deferred: false,
    replied: false,
    options: {
      getString: name => typeof parsed.values[name] === 'string' ? parsed.values[name] : null,
      getInteger: name => Number.isInteger(parsed.values[name]) ? parsed.values[name] : null,
      getUser: name => parsed.values[name]?.id && parsed.values[name]?.username ? parsed.values[name] : null,
      getRole: name => parsed.values[name]?.id && parsed.values[name]?.members ? parsed.values[name] : null,
      getChannel: name => parsed.values[name]?.id && parsed.values[name]?.guild ? parsed.values[name] : null,
      getSubcommand: () => parsed.subcommand
    },
    isChatInputCommand: () => true,
    async reply(payload) {
      const clean = typeof payload === 'string' ? { content: payload } : { ...payload };
      delete clean.ephemeral;
      clean.allowedMentions = clean.allowedMentions || { parse: [] };
      replyMessage = await message.reply(clean);
      interaction.replied = true;
      return replyMessage;
    },
    async deferReply() {
      interaction.deferred = true;
      replyMessage = await message.reply('⏳ جارٍ تنفيذ الأمر…');
      return replyMessage;
    },
    async editReply(payload) {
      const clean = typeof payload === 'string' ? { content: payload } : { ...payload };
      delete clean.ephemeral;
      clean.allowedMentions = clean.allowedMentions || { parse: [] };
      if (replyMessage) return replyMessage.edit(clean);
      replyMessage = await message.reply(clean);
      interaction.replied = true;
      return replyMessage;
    },
    async fetchReply() {
      return replyMessage;
    }
  };
  return interaction;
}

// ==========================================================================
// 📇 فهرس اختصارات المالك
//
// 🔓 (2026-10-02) الاختصار يعمل كما كتبه المالك حرفياً:
//   • قد يحتوي «!» أو «$» في أوله — فيُطابق بالصيغتين (بالبريفكس وبدونه)،
//     فلا يهمّ هل كتبه المالك «شيء» أم «!شيء» أم «$شيء».
//   • قد يتكوّن من أكثر من كلمة («حظر عام») — فيُطابق على عدة كلمات.
//
// يُبنى مرة كل خمس ثوانٍ لكل pool — نفس عمر كاش الإعدادات — فلا يُعاد بناؤه
// مع كل رسالة. البحث نفسه O(1) لكل صيغة.
// ==========================================================================
const BARE_ALIAS_TTL_MS = 5000;
const bareAliasCache = new Map();
const ALIAS_PREFIXES = ['!', '$'];

/** صيغ المطابقة لاختصار واحد: كما هو، وبدون بريفكس أوله. */
function aliasKeys(alias) {
  const key = String(alias == null ? '' : alias).trim().toLocaleLowerCase();
  if (!key) return [];
  const bare = ALIAS_PREFIXES.includes(key[0]) ? key.slice(1).trim() : key;
  return bare && bare !== key ? [key, bare] : [key];
}

function buildBareAliasIndex(config) {
  const index = new Map();
  let maxWords = 1;
  const add = (alias, route) => {
    let inserted = false;
    for (const key of aliasKeys(alias)) {
      if (!index.has(key)) { index.set(key, route); inserted = true; }
    }
    if (inserted) maxWords = Math.max(maxWords, keyWordCount(alias));
  };
  for (const [command, settings] of Object.entries(config?.commands || {})) {
    for (const alias of settings.aliases || []) add(alias, { command, alias: true });
    for (const alias of settings.giveAliases || []) add(alias, { command, subcommand: 'give' });
    for (const alias of settings.removeAliases || []) add(alias, { command, subcommand: 'remove' });
  }
  return { index, maxWords };
}

function keyWordCount(alias) {
  return String(alias == null ? '' : alias).trim().split(/\s+/).filter(Boolean).length || 1;
}

/**
 * يبحث عن اختصار المالك في بداية الرسالة: يجرّب أطول صيغة أولاً (كلمتان ثم
 * كلمة) بكل الأشكال (بالبريفكس وبدونه)، حتى يعمل الاختصار متعدد الكلمات.
 */
function lookupBareAlias(pool, config, words) {
  const cached = bareAliasCache.get(pool);
  let index, maxWords;
  if (cached && cached.expiresAt > Date.now() && cached.config === config) {
    ({ index, maxWords } = cached);
  } else {
    ({ index, maxWords } = buildBareAliasIndex(config));
    bareAliasCache.set(pool, { index, maxWords, config, expiresAt: Date.now() + BARE_ALIAS_TTL_MS });
  }
  const length = Math.min(words.length, maxWords);
  for (let size = length; size >= 1; size--) {
    const candidate = words.slice(0, size).join(' ').toLocaleLowerCase();
    for (const key of aliasKeys(candidate)) {
      const route = index.get(key);
      if (route) return { ...route, aliasWords: size };
    }
  }
  return null;
}

module.exports = function registerSlashPrefix(client, pool, commandData, execute) {
  const dataByName = new Map(commandData.map(command => [command.name, command]));
  const configReady = getSlashCommandConfig(pool).catch(error => {
    console.error('تعذر تحميل إعدادات أوامر السلاش قبل استقبال البريفكس:', error);
    return getCachedSlashCommandConfig(pool);
  });

  client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // ======================================================================
    // 🔑 صيغتا الاستدعاء
    //
    //   !ban @عضو        ← الاسم الرسمي، يلزمه البريفكس دائماً
    //   لف @عضو          ← اختصار حدّده المالك، يعمل مجرّداً بلا بريفكس
    //
    // لماذا الاسم الرسمي يلزمه بريفكس والاختصار لا؟
    // أسماء الأوامر كلمات إنجليزية شائعة (top · say · color · roll). لو عملت
    // مجرّدة لردّ البوت على محادثات عادية باستمرار. أما الاختصار فكلمة اختارها
    // المالك بنفسه ليستدعي بها أمراً، فتشغيلها مجرّدة هو المقصود منها.
    //
    // الأداء: الرسائل بلا بريفكس تُفحص بعملية بحث واحدة في Map جاهز (O(1))
    // قبل أي عمل آخر، فالرسائل العادية تخرج فوراً بلا أي استعلام أو تحليل.
    // ======================================================================
    const content = message.content.trim();
    if (!content || content.startsWith('/')) return;

    // ======================================================================
    // 🔓 (2026-10-02) الاختصار يعمل كما كتبه المالك — بأي بريفكس وبأي كلمات.
    //
    // كان الخلل الذي أبلغ عنه المالك: نُزيل «!» قبل المطابقة، فيصير الاختصار
    // المحفوظ «!شيء» غير قابل للمطابقة أبداً؛ ثم تُطبَّق سياسة البريفكس على
    // الاختصارات فتُسكِت «!اختصار» أيضاً. القاعدتان الآن:
    //   • الاسم الرسمي (ban · top …): سلاش فقط — لا يعمل من هذا المسار إطلاقاً.
    //   • اختصار المالك: يعمل مجرّداً وبـ «!» وبـ «$» على السواء.
    // ======================================================================
    const prefixChar = (content[0] === '!' || content[0] === '$') ? content[0] : '';
    const words = (prefixChar ? content.slice(1) : content).trim().split(/\s+/).filter(Boolean);
    const requestedName = (words[0] || '').toLocaleLowerCase();
    if (!requestedName) return;

    // الاسم الرسمي يُفحص دائماً قبل أي اختصار، فلا يستطيع اختصار أن يحجبه.
    if (SLASH_COMMAND_NAMES.includes(requestedName)) return;

    let config = getCachedSlashCommandConfig(pool);
    let route = lookupBareAlias(pool, config, words);
    if (!route) {
      config = await configReady;
      route = lookupBareAlias(pool, config, words);
    }
    if (!route) return;

    const parts = words.slice(route.aliasWords || 1);
    // منع مستمعات الأوامر القديمة من تشغيل تنفيذ ثانٍ للاسم نفسه.
    message.__slashCommandHandled = true;
    const command = dataByName.get(route.command);
    if (!command) return;

    try {
      const settings = config.commands[route.command];
      if (!settings?.enabled) return message.reply(`⛔ الأمر \`/${route.command}\` متوقف حالياً.`);
      const parsed = await parsePrefixOptions(command, parts, route, message);
      if (parsed.error) {
        // ⚠️ الأمر لم يُنفَّذ (معطيات ناقصة أو غير مفهومة) — نعرض إيمبداً
        // إرشادياً يشرح الصيغة والأمثلة والصلاحية بدل سطر نصي مقتضب.
        // هذا المسار لا يُبلَغ إطلاقاً عندما ينجح الأمر، فالأوامر التي تعمل
        // بلا معطيات (مثل !profile) لا يرى أصحابها هذا الإيمبد أبداً.
        // الاختصارات والرتب تُقرأ من إعدادات اللوحة لحظة الخطأ، فما يراه
        // العضو في الإيمبد هو ما هو مفعّل فعلاً لا قائمة مكتوبة يدوياً.
        const commandSettings = config.commands?.[route.command] || {};
        const allowedRoleIds = [
          ...(commandSettings.roleIds || []),
          ...(config.globalRoleIds || [])
        ];
        const embed = buildUsageEmbed(command, {
          reason: parsed.error,
          subcommand: parsed.errorSubcommand || route.subcommand || null,
          username: message.author?.username || '',
          actorMention: `<@${message.author.id}>`,
          aliases: commandSettings.aliases || [],
          roleIds: [...new Set(allowedRoleIds)],
          // لو استُدعي الأمر باختصار نعرض الأمثلة بالصيغة نفسها
          // التي يستعملها العضو فعلاً، لا بصيغة لم يكتبها قط.
          prefix: prefixChar,
          invokedAs: prefixChar ? null : words.slice(0, route.aliasWords || 1).join(' ')
        });
        return message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } })
          // لو تعذّر إرسال الإيمبد (صلاحية Embed Links مثلاً) نرجع للنص العادي
          // حتى لا يضيع الإرشاد على العضو بصمت.
          .catch(() => message.reply(parsed.error).catch(() => {}));
      }
      const interaction = makeMessageInteraction(message, route.command, parsed);
      await execute(interaction);
    } catch (error) {
      console.error(`❌ خطأ أثناء تنفيذ بريفكس /${route.command}:`, error);
      if (!message.__slashCommandHandledReply) {
        message.__slashCommandHandledReply = true;
        return message.reply(error?.code === 50013
          ? '❌ صلاحيات البوت أو ترتيب رتبه لا يسمحان بتنفيذ ذلك.'
          : '❌ تعذر تنفيذ الأمر. تحقق من صيغة الاستخدام وصلاحيات البوت ثم أعد المحاولة.').catch(() => {});
      }
    }
  });
};

// ==========================================================================
// 🛡️ [إصلاح] تصدير دوال داخلية للاختبارات.
// الدالة parsePrefixOptions كانت معرّفة بالأعلى لكنها غير مُصدَّرة إطلاقاً،
// ما جعل اختبار commandRouting.test.js يفشل بـ "parsePrefixOptions is not a function".
// الإضافة هنا لا تغيّر أي سلوك: registerSlashPrefix يبقى هو التصدير الأساسي.
// ==========================================================================
module.exports.parsePrefixOptions = parsePrefixOptions;
module.exports.buildUsage = buildUsage;
module.exports.extractSnowflake = extractSnowflake;
