// ==========================================================================
// 🧩 customCommands.js — منطق مشترك لأوامر البوت المخصّصة (الضريبة / الاستدعاء / التحدث)
//
// الهدف: أن ينفّذ أمر السلاش (/tax) وأمر البريفكس ($tax) *نفس المنطق بالضبط*
// من مصدر واحد، بدل تكرار الكود في ملفين ثم اختلاف سلوكهما مع الوقت.
//
// كل الدوال هنا نقيّة (pure): تستقبل الإعدادات والقيم وتُرجع ما يجب إرساله،
// دون لمس ديسكورد أو قاعدة البيانات — ما يجعلها سهلة الاختبار.
// ==========================================================================
'use strict';

const { EmbedBuilder } = require('discord.js');

// يحوّل لون hex المحفوظ في الإعدادات إلى رقم يقبله ديسكورد
function hexToColorInt(hex, fallback = 0x059669) {
  const value = String(hex || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
  const parsed = Number.parseInt(value.slice(1), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// --------------------------------------------------------------------------
// 💰 حاسبة الضريبة
// --------------------------------------------------------------------------
function buildTaxPayload(taxConfig, rawAmount) {
  const amount = Number.parseInt(String(rawAmount ?? '').trim(), 10);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    return { error: '❌ يرجى كتابة مبلغ صحيح!' };
  }

  // نسبة الضريبة مضبوطة في commandConfig.js بين 0 و99، فلا يحدث قسمة على صفر
  const rate = taxConfig.taxRatePercent / 100;
  const netAmount = Math.floor(amount * (1 - rate));
  const grossAmount = Math.ceil(amount / (1 - rate));

  const embed = new EmbedBuilder()
    .setTitle(taxConfig.embedTitle)
    .addFields(
      { name: taxConfig.originalLabel, value: `\`${amount.toLocaleString()}\``, inline: true },
      { name: taxConfig.netLabel, value: `\`${netAmount.toLocaleString()}\``, inline: true },
      { name: taxConfig.grossLabel, value: `\`${grossAmount.toLocaleString()}\``, inline: false }
    )
    .setColor(hexToColorInt(taxConfig.embedColor, 0x059669));

  return { payload: { embeds: [embed] }, amount, netAmount, grossAmount };
}

// --------------------------------------------------------------------------
// 🔔 الاستدعاء — رسالة خاصة للعضو مع رابط مباشر للروم
// --------------------------------------------------------------------------
function buildComePayload(comeConfig, { adminTag, memberTag, channelMention, messageUrl }) {
  const description = String(comeConfig.embedDescription || '')
    .replaceAll('{admin}', adminTag || '')
    .replaceAll('{member}', memberTag || '')
    .replaceAll('{channel}', channelMention || '')
    .replaceAll('{link}', messageUrl || '');

  const embed = new EmbedBuilder()
    .setTitle(comeConfig.embedTitle)
    .setDescription(description)
    .setColor(hexToColorInt(comeConfig.embedColor, 0xeab308));

  return { payload: { embeds: [embed], allowedMentions: { parse: [] } }, description };
}

// --------------------------------------------------------------------------
// 🗣️ التحدث — نشر نص باسم البوت مع التحكم في المنشنات
// --------------------------------------------------------------------------
const MENTION_PARSE_BY_POLICY = Object.freeze({
  users: ['users'],
  roles: ['roles'],
  none: []
});

function buildSayPayload(sayConfig, rawText) {
  const content = String(rawText ?? '').trim();
  if (!content) return { error: '❌ يرجى كتابة الرسالة!' };

  const payload = { content };
  // سياسة "all" تترك ديسكورد يعالج المنشنات طبيعياً، وغيرها تقيّدها
  if (sayConfig.mentionPolicy !== 'all') {
    payload.allowedMentions = { parse: MENTION_PARSE_BY_POLICY[sayConfig.mentionPolicy] || [] };
  }
  return { payload };
}

module.exports = {
  hexToColorInt,
  buildTaxPayload,
  buildComePayload,
  buildSayPayload
};
