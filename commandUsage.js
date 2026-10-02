'use strict';
// ==========================================================================
// 🧭 commandUsage.js — إيمبد «كيف أستخدم هذا الأمر؟»
//
// متى يظهر؟ عندما يكتب العضو أمراً **ولا ينفَّذ** بسبب نقص في المعطيات:
// نسي منشن العضو، أو لم يحدد المدة، أو كتب قيمة غير مفهومة.
//
// متى لا يظهر؟ عندما ينفَّذ الأمر بنجاح. أمر مثل !profile يعمل بلا معطيات،
// فلا يرى صاحبه هذا الإيمبد إطلاقاً. القاعدة: الإيمبد رد فعل على الفشل فقط،
// ولا يعترض أي أمر ناجح.
//
// لماذا ملف مستقل؟ حتى تكون الصيغ والأمثلة والصلاحيات في مصدر واحد تقرأه
// كل الواجهات (البريفكس، والتوثيق المولَّد لاحقاً)، فلا تتفرّق النسخ.
// ==========================================================================

const { EmbedBuilder } = require('discord.js');
const { DURATION_HINT } = require('./duration');

// أسماء خيارات المدة — نعرض لها تلميح الوحدات (نفس قائمة slashPrefix.js)
const DURATION_OPTION_NAMES = new Set(['duration_minutes', 'minutes', 'duration']);

// أنواع خيارات ديسكورد
const T = {
  SUBCOMMAND: 1, SUBCOMMAND_GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5,
  USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11
};

const TYPE_LABELS = {
  [T.STRING]: 'نص', [T.INTEGER]: 'رقم', [T.BOOLEAN]: 'صح/خطأ',
  [T.USER]: 'عضو', [T.CHANNEL]: 'روم', [T.ROLE]: 'رتبة',
  [T.MENTIONABLE]: 'عضو أو رتبة', [T.NUMBER]: 'رقم', [T.ATTACHMENT]: 'مرفق'
};

// ==========================================================================
// 🛡️ الصلاحية التي يتطلبها كل أمر — جدول صريح مرتّب أبجدياً.
// مكتوب يدوياً عن قصد: استنتاجه من الكود هشّ (بعض الأوامر تتشارك معالجاً
// واحداً)، وهذه القائمة تُقرأ وتُراجَع بالعين بسهولة.
// الأوامر غير المذكورة متاحة للجميع.
// ==========================================================================
const COMMAND_PERMISSIONS = Object.freeze({
  ban: 'حظر الأعضاء',
  botstatus: 'مالك البوت',
  channel: 'إدارة القنوات',
  claimstats: 'إدارة الرسائل',
  clear: 'إدارة الرسائل',
  come: 'إدارة الرسائل',
  creditsgrant: 'إدارة السيرفر',
  hide: 'إدارة القنوات',
  kick: 'طرد الأعضاء',
  lock: 'إدارة القنوات',
  logchannel: 'مالك البوت',
  move: 'نقل الأعضاء',
  mute: 'كتم الأعضاء',
  points: 'إدارة الرسائل',
  reset: 'إدارة السيرفر',
  role: 'إدارة الرتب',
  say: 'إدارة الرسائل',
  setcolor: 'إدارة الرتب',
  setlevel: 'إدارة السيرفر',
  setnick: 'إدارة الألقاب',
  setxp: 'إدارة السيرفر',
  show: 'إدارة القنوات',
  slowmode: 'إدارة القنوات',
  time: 'إسكات الأعضاء',
  unban: 'حظر الأعضاء',
  unlock: 'إدارة القنوات',
  unmute: 'كتم الأعضاء',
  untime: 'إسكات الأعضاء',
  vkick: 'نقل الأعضاء',
  warn: 'إدارة الرسائل',
  warn_remove: 'إدارة الرسائل',
  warnings: 'متاح للجميع (وإدارة الرسائل لعرض غيرك)'
});

/** قيمة مثال واقعية لكل نوع خيار، تُستخدم في بناء الأمثلة تلقائياً */
function sampleFor(option) {
  if (Array.isArray(option.choices) && option.choices.length) return option.choices[0].value;
  switch (option.type) {
    case T.USER:
    case T.MENTIONABLE: return '@العضو';
    case T.CHANNEL: return '#الروم';
    case T.ROLE: return '@الرتبة';
    case T.INTEGER:
    case T.NUMBER: {
      // رقم واقعي للمثال: الحد الأدنى غالباً 1 وهو لا يوضّح شيئاً،
      // فنرفعه إلى 10 ما لم يتجاوز الحد الأعلى المسموح.
      const low = option.min_value ?? 10;
      const readable = Math.max(low, 10);
      return String(option.max_value != null ? Math.min(readable, option.max_value) : readable);
    }
    case T.BOOLEAN: return 'true';
    case T.STRING: {
      // خيارات المدة نصية الآن (تقبل 2h) فنعطيها مثالاً زمنياً لا كلمة «نص».
      if (DURATION_OPTION_NAMES.has(option.name)) return '2h';
      // الوصف غالباً يحمل مثالاً حقيقياً («تسمية الأرشيف مثل 2026-09-30»).
      // استخراجه أدق بكثير من كلمة «نص» العامة ويبقى عاماً لكل الأوامر.
      const hinted = /مثل\s+(\S+)/.exec(option.description || '');
      if (hinted) return hinted[1];
      if (option.name === 'reason') return 'السبب هنا';
      if (option.name === 'nickname') return 'اللقب';
      if (option.name === 'title') return 'اللقب';
      if (option.name === 'url') return 'https://example.com';
      return 'نص';
    }
    default: return 'قيمة';
  }
}

/** هل يصلح الحرف الأول كاختصار؟ فقط إن كان فريداً لكل قيمة في القائمة. */
function uniqueFirstLetters(choices) {
  const letters = choices.map(c => String(c.value).toLocaleLowerCase()[0]);
  return new Set(letters).size === letters.length;
}

/** الخيارات الفعلية للأمر بعد مراعاة الأمر الفرعي المختار */
function optionsFor(command, subcommand) {
  const all = command.options || [];
  const subs = all.filter(o => o.type === T.SUBCOMMAND || o.type === T.SUBCOMMAND_GROUP);
  if (!subs.length) return { options: all, subcommands: [] };
  const selected = subs.find(o => o.name === subcommand);
  return { options: selected ? (selected.options || []) : [], subcommands: subs };
}

// ⚠️ صيغة العرض هي السلاش «/» لا البريفكس «!».
// السياسة الفعلية المنفَّذة في slashPrefix.js: الاسم الرسمي للأمر (ban · top …)
// يعمل **بالسلاش فقط**؛ فـ «!ban» لا يُنفَّذ ولا يرد بشيء. لذلك أي إيمبد
// استخدام يقرأه العضو يجب أن يعرض الصيغة التي تعمل فعلاً، لا صيغة ميتة.

/** سطر الصيغة: /الأمر <مطلوب> [اختياري] */
function buildSyntax(commandName, subcommand, options) {
  const parts = options.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`));
  return `/${commandName}${subcommand ? ` ${subcommand}` : ''}${parts.length ? ' ' + parts.join(' ') : ''}`;
}

/** مثالان: واحد بالحد الأدنى المطلوب، وآخر كامل — إن اختلفا */
function buildExamples(commandName, subcommand, options) {
  const head = `/${commandName}${subcommand ? ` ${subcommand}` : ''}`;
  const requiredOnly = options.filter(o => o.required).map(sampleFor);
  const everything = options.map(sampleFor);

  const examples = [];
  examples.push(`${head}${requiredOnly.length ? ' ' + requiredOnly.join(' ') : ''}`);
  if (everything.length > requiredOnly.length) {
    examples.push(`${head} ${everything.join(' ')}`);
  }
  return [...new Set(examples)];
}

/** مثال واقعي بمنشن الشخص نفسه الذي أخطأ، لا «@العضو» المجرّدة */
function sampleForWithActor(option, actorMention) {
  if (actorMention && (option.type === T.USER || option.type === T.MENTIONABLE)) return actorMention;
  return sampleFor(option);
}

/**
 * إيمبد إرشادي مضغوط على طراز ProBot.
 *
 * 📐 قاعدة التصميم: الإيمبد يجب أن يُقرأ بنظرة واحدة دون تمرير.
 * لذلك لا حقول منفصلة لكل معلومة — كل شيء في وصف واحد قصير مرتّب:
 *     سطر الخطأ · الصيغة · الاختصارات · مثال · من يستطيع استخدامه
 * جرّبنا الشكل الطويل (٦ حقول) فكان يملأ الشاشة ويصعب قراءته.
 *
 * @param {object} command تعريف الأمر من commandData
 * @param {object} opts
 * @param {string} opts.reason        سبب عدم التنفيذ
 * @param {string} [opts.subcommand]  الأمر الفرعي المختار
 * @param {string} [opts.username]    اسم من كتب الأمر
 * @param {string} [opts.actorMention] منشن من كتب الأمر
 * @param {string[]} [opts.aliases]   اختصارات اللوحة لهذا الأمر
 * @param {string[]} [opts.roleIds]   رتب هذا الأمر + الرتب العامة
 * @param {string} [opts.prefix]      البادئة المستعملة فعلياً
 * @returns {EmbedBuilder}
 */
function buildUsageEmbed(command, {
  reason,
  subcommand = null,
  username = '',
  actorMention = '',
  aliases = [],
  roleIds = [],
  prefix = '!',
  invokedAs = null
} = {}) {
  const { options, subcommands } = optionsFor(command, subcommand);
  // سطر الأساس: إن استُدعي الأمر باختصار نعرض ما كتبه العضو فعلاً (فهو يعمل
  // مجرّداً وبالبريفكس على السواء)، وإلا فالاسم الرسمي — وصيغته الوحيدة
  // العاملة هي السلاش. كنا نعرض «!ban» وهو أمر ميت تماماً.
  const base = invokedAs ? `${prefix}${invokedAs}` : `/${command.name}`;
  const head = `${base}${subcommand ? ` ${subcommand}` : ''}`;
  const permission = COMMAND_PERMISSIONS[command.name] || 'للجميع';

  // عند عدم اختيار نوع فرعي نعرض النوع كجزء من الصيغة، وإلا خرج السطر
  // ناقصاً («!mute» وحدها) ولا يعلّم العضو شيئاً.
  const pendingSub = subcommands.length && !subcommand;
  const subSlot = pendingSub ? ` <${subcommands.map(sub => sub.name).join('|')}>` : '';
  const sampleSub = pendingSub ? ` ${subcommands[0].name}` : '';

  // سطر الصيغة: <مطلوب> [اختياري]
  const syntax = `${head}${subSlot}${options.length ? ' ' + options.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ') : ''}`;

  // مثال واقعي؛ عند وجود أنواع نستعمل أول نوع وخياراته ليكون المثال كاملاً.
  const exampleOptions = pendingSub ? (subcommands[0].options || []) : options;
  const example = `${head}${sampleSub}${exampleOptions.length ? ' ' + exampleOptions.map(o => sampleForWithActor(o, actorMention)).join(' ') : ''}`;

  const lines = [];

  // ١) سبب الفشل — مختصر وواضح
  // بعض المصادر تضع ❌ في بداية نصها؛ لا نكررها.
  lines.push(`❌ ${String(reason || '').replace(/^[❌⚠️\s]+/, '')}`);
  lines.push('');

  // ٢) الصيغة والمثال داخل كتلة واحدة: أسهل قراءة من كتلتين منفصلتين
  lines.push('```');
  lines.push(syntax);
  if (example !== syntax) lines.push(example);
  lines.push('```');

  // ٣) الأنواع الفرعية — سطر واحد فقط عند الحاجة
  if (subcommands.length && !subcommand) {
    lines.push(`🔀 **الأنواع:** ${subcommands.map(sub => `\`${sub.name}\``).join(' · ')}`);
  }

  // ٤) القيم المحدودة — سطر واحد لكل خيار ذي قائمة، لا جدول كامل
  for (const option of options) {
    if (!Array.isArray(option.choices) || !option.choices.length) continue;
    const values = option.choices.map(choice => `\`${choice.value}\``).join(' · ');
    lines.push(`🔸 **${option.name}:** ${values}${uniqueFirstLetters(option.choices) ? ' _(يكفي الحرف الأول)_' : ''}`);
  }

  // ٥) تلميح المدة — يظهر فقط لو الأمر فيه خيار مدة
  if ([...options, ...exampleOptions].some(option => DURATION_OPTION_NAMES.has(option.name))) {
    lines.push(`⏱️ **المدة:** ${DURATION_HINT}`);
  }

  // ٦) طرق الاستدعاء: الاسم الرسمي + اختصارات اللوحة، سطر واحد.
  // الاسم الرسمي يُعرض بالسلاش وحده لأنه صيغته الوحيدة العاملة؛
  // أما الاختصارات فتعمل مجرّدة وبالبريفكس كما حدّدها المالك.
  const forms = [`\`/${command.name}\``];
  const extras = (aliases || []).map(alias => String(alias).trim()).filter(Boolean).slice(0, 8);
  if (extras.length) forms.push(...extras.map(alias => `\`${alias}\``));
  lines.push(`🔑 **الاستدعاء:** ${forms.join(' · ')}`);

  // ٧) من يستطيع استخدامه: الرتب أولاً، والصلاحية بديلاً لمن بلا رتبة
  const roleMentions = (roleIds || [])
    .filter(id => /^[0-9]{5,25}$/.test(String(id)))
    .slice(0, 6)
    .map(id => `<@&${id}>`);
  lines.push(`🛡️ **الصلاحية:** ${roleMentions.length ? roleMentions.join(' ') : permission}`);

  const embed = new EmbedBuilder()
    .setColor('#834dd9')
    .setDescription(lines.join('\n').slice(0, 4000));

  if (username) embed.setFooter({ text: `${username} · /${command.name} للقائمة التفاعلية` });
  return embed;
}

module.exports = {
  buildUsageEmbed,
  buildSyntax,
  buildExamples,
  COMMAND_PERMISSIONS,
  OPTION_TYPES: T
};
