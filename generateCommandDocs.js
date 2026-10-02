#!/usr/bin/env node
'use strict';
// ==========================================================================
// 📖 generateCommandDocs.js — يولّد COMMANDS.md من الكود مباشرة
//
// لماذا نولّده بدل كتابته يدوياً؟
// أي جدول أوامر مكتوب باليد يتقادم بعد أول تعديل، فيصبح التوثيق مضلّلاً
// أسوأ من غيابه. هذا الملف يقرأ مصادر الحقيقة الفعلية في المشروع:
//   • slashCommands.js  → أسماء الأوامر وأوصافها وخياراتها الحقيقية
//   • commandCategories.js → تصنيف كل أمر
// ثم يكتب مرجعاً مرتّباً أبجدياً. أعد تشغيله بعد أي إضافة أمر.
//
// الاستخدام:  node generateCommandDocs.js
// ==========================================================================

const fs = require('fs');
const path = require('path');

const root = __dirname;
const { commandData } = require(path.join(root, 'slashCommands'));
const { getSlashCommandCategories } = require(path.join(root, 'commandCategories'));
const { sortByName } = require(path.join(root, 'commandSorting'));

// أسماء الأقسام بالعربية كما تظهر في صفحة الأوامر
const CATEGORY_LABELS = {
  tickets: '🎫 التذاكر',
  admin: '🛡️ الإشراف والإدارة',
  senior: '⭐ الإدارة العليا',
  owner: '👑 المالك',
  xp: '📈 الإكسبي والمستويات',
  services: '🧰 الخدمات والمجتمع',
  other: '📦 أخرى'
};

// أنواع خيارات ديسكورد (من توثيق Application Command Option Type)
const OPTION_TYPES = {
  1: 'أمر فرعي', 2: 'مجموعة أوامر', 3: 'نص', 4: 'رقم صحيح', 5: 'صح/خطأ',
  6: 'عضو', 7: 'روم', 8: 'رتبة', 9: 'عضو أو رتبة', 10: 'رقم عشري', 11: 'مرفق'
};

const escapeCell = value => String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** يبني سطر الاستخدام الحقيقي للأمر من خياراته المعرَّفة فعلاً */
function usageOf(command) {
  const subcommands = (command.options || []).filter(option => option.type === 1 || option.type === 2);
  if (subcommands.length) {
    return `/${command.name} ${subcommands.map(sub => sub.name).join('|')}`;
  }
  const args = (command.options || []).map(option =>
    option.required ? `<${option.name}>` : `[${option.name}]`
  );
  return `/${command.name}${args.length ? ' ' + args.join(' ') : ''}`;
}

/** تفاصيل الخيارات/الأوامر الفرعية لعرضها تحت كل أمر */
function detailsOf(command) {
  const options = command.options || [];
  if (!options.length) return '';
  return options.map(option => {
    const kind = OPTION_TYPES[option.type] || `نوع ${option.type}`;
    const need = option.type === 1 || option.type === 2 ? '' : option.required ? ' · **مطلوب**' : ' · اختياري';
    const nested = (option.options || []).length
      ? ` — خياراته: ${option.options.map(o => `\`${o.name}\``).join('، ')}`
      : '';
    return `    - \`${option.name}\` _(${kind}${need})_ — ${option.description || ''}${nested}`;
  }).join('\n');
}

const sorted = sortByName(commandData, command => command.name);

// --- تجميع حسب القسم (الأقسام أبجدية أيضاً حسب تسميتها العربية) ---
// 🔢 عضوية واحدة لكل أمر: القسم الأساسي هو أول تصنيف في commandCategories،
//    وبذلك يكون مجموع أعداد الأقسام = إجمالي الأوامر بالضبط (52) بلا تكرار،
//    تماماً كما تفعل صفحة /commands في لوحة التحكم.
const primaryCategoryOf = name => getSlashCommandCategories(name)[0] || 'other';
const byCategory = new Map();
for (const command of sorted) {
  const key = primaryCategoryOf(command.name);
  if (!byCategory.has(key)) byCategory.set(key, []);
  byCategory.get(key).push(command);
}

const lines = [];
lines.push('# 📖 مرجع أوامر البوت');
lines.push('');
lines.push('> ⚙️ **هذا الملف مُولَّد تلقائياً — لا تعدّله يدوياً.**');
lines.push('> لإعادة توليده بعد إضافة أو تعديل أمر: `node generateCommandDocs.js`');
lines.push('> المصدر: `slashCommands.js` و `commandCategories.js`.');
lines.push('');
lines.push(`**إجمالي الأوامر:** ${commandData.length} أمراً. كل الأوامر تعمل بالسلاش \`/الأمر\` — وأوامر التكت وحدها تبقى بالبريفكس \`!الأمر\`.`);
lines.push('');
lines.push('كل القوائم في هذا الملف مرتّبة أبجدياً (a → z) — نفس ترتيب صفحة الأوامر في لوحة التحكم.');
lines.push('');

// --- فهرس سريع ---
lines.push('## 🔎 الفهرس السريع');
lines.push('');
lines.push('| الأمر | الوصف | القسم |');
lines.push('|---|---|---|');
for (const command of sorted) {
  const categories = CATEGORY_LABELS[primaryCategoryOf(command.name)] || primaryCategoryOf(command.name);
  lines.push(`| [\`/${command.name}\`](#${command.name}) | ${escapeCell(command.description)} | ${categories} |`);
}
lines.push('');

// --- الأوامر حسب القسم ---
lines.push('## 🗂️ الأوامر حسب القسم');
lines.push('');
const categoryKeys = sortByName([...byCategory.keys()], key => CATEGORY_LABELS[key] || key);
for (const key of categoryKeys) {
  const commands = byCategory.get(key);
  lines.push(`### ${CATEGORY_LABELS[key] || key}  _(${commands.length} أمر)_`);
  lines.push('');
  lines.push(commands.map(c => `\`/${c.name}\``).join(' · '));
  lines.push('');
}

// --- التفاصيل الكاملة ---
lines.push('## 📋 تفاصيل كل أمر');
lines.push('');
for (const command of sorted) {
  lines.push(`### \`${command.name}\``);
  lines.push('');
  lines.push(`${command.description || '—'}`);
  lines.push('');
  lines.push(`- **الاستخدام:** \`${usageOf(command)}\``);
  lines.push('- **الصيغة:** سلاش فقط — والاختصار المجرّد (بلا بريفكس) يعمل إن أضافه المالك.');
  lines.push(`- **القسم:** ${CATEGORY_LABELS[primaryCategoryOf(command.name)] || primaryCategoryOf(command.name)}`);
  const details = detailsOf(command);
  if (details) {
    lines.push('- **الخيارات:**');
    lines.push(details);
  }
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## 🛡️ أين أضبط صلاحيات الأوامر؟');
lines.push('');
lines.push('كل الصلاحيات تُضبط من لوحة التحكم، صفحة **`/commands`**، بدون لمس الكود:');
lines.push('');
lines.push('| ما تريد فعله | أين |');
lines.push('|---|---|');
lines.push('| تفعيل أو إيقاف أمر | بطاقة الأمر ← «حالة الأمر» |');
lines.push('| تحديد الرتب المسموح لها | بطاقة الأمر ← «الرولات المسموح لها» |');
lines.push('| السماح لأشخاص بأعيانهم | بطاقة الأمر ← «آيديات أشخاص مسموح لهم» |');
lines.push('| إضافة اختصار للأمر | بطاقة الأمر ← «اختصارات تُكتب مجرّدة» |');
lines.push('| رتبة تتجاوز كل القيود | بطاقة «صلاحية الإدارة العامة» |');
lines.push('');
lines.push('> ملاحظة: صلاحيات ديسكورد نفسها تبقى مطبَّقة دائماً. مالك السيرفر وحاملو صلاحية');
lines.push('> `Administrator` يتجاوزون قيود الرتب، كما أن ترتيب رتبة البوت يجب أن يكون أعلى');
lines.push('> من الرتبة التي يتعامل معها.');
lines.push('');

const outPath = path.join(root, 'COMMANDS.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✅ تم توليد COMMANDS.md — ${commandData.length} أمراً في ${categoryKeys.length} أقسام.`);
