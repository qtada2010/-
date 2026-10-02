'use strict';

// ============================================================================
// ⚠️ بناء رسالة الإنذار الخاصة (DM)
//
// هذا الملف هو المصدر الوحيد لبناء رسالة الإنذار. تستعمله جهتان:
//   • البوت  — عند تنفيذ /warn لإرسال الرسالة فعلياً.
//   • اللوحة — لعرض المعاينة.
// وجود مصدر واحد يضمن أن ما يراه المالك في المعاينة هو حرفياً ما يصل العضو.
// ============================================================================

const { EmbedBuilder } = require('discord.js');

/**
 * يستبدل المتغيرات داخل نص.
 * الاستبدال يتم بمسح واحد لكل مفتاح على نص المصدر، فلا يمكن أن تُعاد معالجة
 * قيمة مُدرَجة (لو كتب عضو اسمه «{السبب}» فلن يتحول إلى سبب الإنذار).
 */
function applyVariables(template, variables) {
  if (typeof template !== 'string' || !template) return '';
  let out = '';
  let index = 0;

  while (index < template.length) {
    if (template[index] !== '{') {
      out += template[index];
      index += 1;
      continue;
    }
    const close = template.indexOf('}', index);
    if (close === -1) {
      out += template.slice(index);
      break;
    }
    const token = template.slice(index, close + 1);
    if (Object.prototype.hasOwnProperty.call(variables, token)) {
      out += String(variables[token] ?? '');
    } else {
      out += token; // متغير غير معروف يبقى كما هو بدل أن يختفي بصمت
    }
    index = close + 1;
  }
  return out;
}

/**
 * يبني محتوى رسالة الإنذار الخاصة.
 *
 * @param {object} config إعدادات اللوحة بعد التطبيع
 * @param {object} variables خريطة {المتغير} → القيمة
 * @returns {{content: string, embeds: Array, isEmpty: boolean}}
 */
function buildWarnDirectMessage(config, variables = {}) {
  const content = applyVariables(config.messageText, variables).slice(0, 2000);
  const embeds = [];

  if (config.embedEnabled) {
    const title = applyVariables(config.embedTitle, variables).slice(0, 256);
    const description = applyVariables(config.embedDescription, variables).slice(0, 4000);
    const footer = applyVariables(config.embedFooter, variables).slice(0, 2048);

    // لا نبني إيمبد فارغاً — ديسكورد يرفضه ويفشل الإرسال.
    if (title || description || footer || config.embedImageUrl || config.embedThumbnailUrl) {
      const embed = new EmbedBuilder().setColor(config.embedColor || '#834DD9');
      if (title) embed.setTitle(title);
      if (description) embed.setDescription(description);
      if (footer) embed.setFooter({ text: footer });
      if (config.embedImageUrl) embed.setImage(config.embedImageUrl);
      if (config.embedThumbnailUrl) embed.setThumbnail(config.embedThumbnailUrl);
      embed.setTimestamp();
      embeds.push(embed);
    }
  }

  return { content, embeds, isEmpty: !content && !embeds.length };
}

/**
 * يرسل الإنذار للعضو بالخاص.
 *
 * ⚠️ قاعدة أساسية: فشل الإرسال لا يُفشل أمر الإنذار إطلاقاً.
 * الإنذار مسجَّل في قاعدة البيانات قبل هذه الدالة، وإغلاق العضو لخاصه
 * قرار شخصي لا يجوز أن يمنع الإدارة من إنذاره.
 *
 * @returns {Promise<'sent'|'disabled'|'empty'|'blocked'>}
 */
async function sendWarnDirectMessage(user, config, variables) {
  if (!config?.enabled) return 'disabled';
  const payload = buildWarnDirectMessage(config, variables);
  if (payload.isEmpty) return 'empty';

  try {
    await user.send({ content: payload.content || undefined, embeds: payload.embeds });
    return 'sent';
  } catch {
    // خاص مغلق أو البوت محظور — نتجاهل بصمت ونُبلغ المشرف في رد الأمر.
    return 'blocked';
  }
}

module.exports = { applyVariables, buildWarnDirectMessage, sendWarnDirectMessage };
