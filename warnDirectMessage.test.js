'use strict';

// ============================================================================
// اختبارات رسالة الإنذار الخاصة
//
// العقد الحرج: فشل إرسال الخاص يجب ألا يُفشل أمر الإنذار إطلاقاً.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { applyVariables, buildWarnDirectMessage, sendWarnDirectMessage } = require('./warnDirectMessage');
const { normalizeWarnDmConfig, WARN_DM_DEFAULTS, WARN_DM_VARIABLES } = require('./commandConfig');

const VARS = {
  '{العضو}': 'سالم',
  '{السبب}': 'سب وشتم',
  '{المشرف}': 'أحمد',
  '{السيرفر}': 'سيرفر ON',
  '{رقم_الإنذار}': '42',
  '{عدد_الإنذارات}': '3'
};

// ---------------------------------------------------------------------------
// استبدال المتغيرات
// ---------------------------------------------------------------------------

test('المتغيرات تُستبدل بقيمها الصحيحة', () => {
  assert.equal(applyVariables('مرحباً {العضو}، السبب: {السبب}', VARS), 'مرحباً سالم، السبب: سب وشتم');
});

test('المتغير غير المعروف يبقى كما هو ولا يختفي بصمت', () => {
  assert.equal(applyVariables('قيمة {غير_موجود} هنا', VARS), 'قيمة {غير_موجود} هنا');
});

test('قيمة مُدرَجة لا يُعاد تفسيرها كمتغير', () => {
  // لو كان اسم العضو نفسه «{السبب}» يجب أن يظهر كنص لا أن يتحول لسبب الإنذار.
  const tricky = { ...VARS, '{العضو}': '{السبب}' };
  assert.equal(applyVariables('{العضو}', tricky), '{السبب}');
});

test('قوس غير مغلق لا يكسر النص', () => {
  assert.equal(applyVariables('نص {ناقص', VARS), 'نص {ناقص');
});

test('كل متغير معلن في اللوحة له قيمة فعلية عند الإرسال', () => {
  for (const variable of WARN_DM_VARIABLES) {
    assert.ok(Object.prototype.hasOwnProperty.call(VARS, variable.key),
      `${variable.key} معروض في اللوحة لكنه لا يُستبدل فعلياً`);
  }
});

// ---------------------------------------------------------------------------
// التطبيع والأمان
// ---------------------------------------------------------------------------

test('أول تشغيل يعطي قالباً جاهزاً لا بطاقة فارغة', () => {
  const config = normalizeWarnDmConfig({});
  assert.equal(config.messageText, WARN_DM_DEFAULTS.messageText);
  assert.ok(config.embedDescription.length > 0);
});

test('بعد أول حفظ يُحترم أي حقل يُفرَّغ عمداً', () => {
  const config = normalizeWarnDmConfig({ enabled: true, messageText: '', embedTitle: 'عنوان' });
  assert.equal(config.messageText, '', 'الحقل المفرَّغ عمداً لا يُعاد ملؤه');
  assert.equal(config.embedTitle, 'عنوان');
});

test('روابط الصور تقبل https فقط', () => {
  assert.equal(normalizeWarnDmConfig({ enabled: true, embedImageUrl: 'https://cdn.x/a.png' }).embedImageUrl, 'https://cdn.x/a.png');
  for (const bad of ['javascript:alert(1)', 'http://x.com/a.png', 'data:image/png;base64,AAA', 'ftp://x/a.png']) {
    assert.equal(normalizeWarnDmConfig({ enabled: true, embedImageUrl: bad }).embedImageUrl, '', `${bad} يجب أن يُرفض`);
  }
});

test('اللون غير الصالح يرجع للون الهوية', () => {
  assert.equal(normalizeWarnDmConfig({ enabled: true, embedColor: 'red' }).embedColor, WARN_DM_DEFAULTS.embedColor);
  assert.equal(normalizeWarnDmConfig({ enabled: true, embedColor: '#a1b2c3' }).embedColor, '#A1B2C3');
});

test('النصوص تُقصّ إلى حدود ديسكورد', () => {
  const config = normalizeWarnDmConfig({ enabled: true, embedTitle: 'ع'.repeat(500), embedDescription: 'ن'.repeat(5000) });
  assert.ok(config.embedTitle.length <= 256);
  assert.ok(config.embedDescription.length <= 4000);
});

// ---------------------------------------------------------------------------
// بناء الرسالة
// ---------------------------------------------------------------------------

test('الرسالة تُبنى بنص وإيمبد مستبدلي المتغيرات', () => {
  const payload = buildWarnDirectMessage(normalizeWarnDmConfig({}), VARS);
  assert.ok(payload.content.includes('سالم'));
  assert.equal(payload.embeds.length, 1);
  const embed = payload.embeds[0].toJSON();
  assert.ok(embed.description.includes('سب وشتم'));
  assert.ok(embed.description.includes('42'));
  assert.ok(embed.footer.text.includes('سيرفر ON'));
});

test('إيقاف الإيمبد يترك النص وحده', () => {
  const config = normalizeWarnDmConfig({ ...WARN_DM_DEFAULTS, embedEnabled: false });
  const payload = buildWarnDirectMessage(config, VARS);
  assert.equal(payload.embeds.length, 0);
  assert.ok(payload.content.length > 0);
  assert.equal(payload.isEmpty, false);
});

test('إعداد فارغ تماماً يُعلَّم isEmpty فلا نرسل رسالة فارغة لديسكورد', () => {
  const config = normalizeWarnDmConfig({ enabled: true, messageText: '', embedEnabled: true, embedTitle: '', embedDescription: '', embedFooter: '' });
  const payload = buildWarnDirectMessage(config, VARS);
  assert.equal(payload.isEmpty, true);
  assert.equal(payload.embeds.length, 0, 'لا يُبنى إيمبد فارغ يرفضه ديسكورد');
});

test('الصور تُضاف للإيمبد عند وجودها فقط', () => {
  const withImage = normalizeWarnDmConfig({ ...WARN_DM_DEFAULTS, embedImageUrl: 'https://cdn.x/a.png', embedThumbnailUrl: 'https://cdn.x/t.png' });
  const embed = buildWarnDirectMessage(withImage, VARS).embeds[0].toJSON();
  assert.equal(embed.image.url, 'https://cdn.x/a.png');
  assert.equal(embed.thumbnail.url, 'https://cdn.x/t.png');

  const without = buildWarnDirectMessage(normalizeWarnDmConfig({}), VARS).embeds[0].toJSON();
  assert.equal(without.image, undefined);
});

// ---------------------------------------------------------------------------
// الإرسال — العقد الحرج
// ---------------------------------------------------------------------------

test('الإرسال ينجح ويمرّر النص والإيمبد', async () => {
  let received = null;
  const user = { send: async payload => { received = payload; } };
  const status = await sendWarnDirectMessage(user, normalizeWarnDmConfig({}), VARS);
  assert.equal(status, 'sent');
  assert.ok(received.content.includes('سالم'));
  assert.equal(received.embeds.length, 1);
});

test('خاص العضو المغلق لا يرمي خطأ بل يرجع blocked', async () => {
  const user = { send: async () => { throw new Error('Cannot send messages to this user'); } };
  const status = await sendWarnDirectMessage(user, normalizeWarnDmConfig({}), VARS);
  assert.equal(status, 'blocked', 'لا بد أن يُبتلع الخطأ حتى لا يفشل أمر الإنذار');
});

test('الإشعار المعطَّل لا يحاول الإرسال إطلاقاً', async () => {
  let called = false;
  const user = { send: async () => { called = true; } };
  const status = await sendWarnDirectMessage(user, normalizeWarnDmConfig({ enabled: false }), VARS);
  assert.equal(status, 'disabled');
  assert.equal(called, false, 'يجب ألا يُستدعى الإرسال إطلاقاً');
});

test('الإعداد الفارغ لا يُرسل رسالة فارغة', async () => {
  let called = false;
  const user = { send: async () => { called = true; } };
  const config = normalizeWarnDmConfig({ enabled: true, messageText: '', embedEnabled: false });
  const status = await sendWarnDirectMessage(user, config, VARS);
  assert.equal(status, 'empty');
  assert.equal(called, false);
});
