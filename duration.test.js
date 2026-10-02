'use strict';

// ============================================================================
// اختبارات وحدات المدة — m دقائق · h ساعات · d أيام · w أسابيع
//
// العقد الحرج (التوافق الخلفي): الرقم المجرّد يبقى دقائق كما كان دائماً،
// فكل من اعتاد «!ban @عضو 60» يحصل على النتيجة نفسها بعد التغيير.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { parseDuration, formatDuration } = require('./duration');
const { parsePrefixOptions } = require('./slashPrefix');
const { commandData } = require('./slashCommands');

const minutesOf = input => parseDuration(input).minutes;

test('الرقم المجرّد يبقى دقائق — توافق خلفي كامل', () => {
  assert.equal(minutesOf('60'), 60);
  assert.equal(minutesOf('1'), 1);
  assert.equal(minutesOf(60), 60, 'الرقم القادم من خيار سلاش رقمي يعمل أيضاً');
});

test('الوحدات الإنجليزية تُفهم بكل صيغها', () => {
  for (const input of ['30m', '30min', '30mins', '30minute', '30minutes']) {
    assert.equal(minutesOf(input), 30, `${input} = 30 دقيقة`);
  }
  for (const input of ['2h', '2hr', '2hrs', '2hour', '2hours']) {
    assert.equal(minutesOf(input), 120, `${input} = ساعتان`);
  }
  for (const input of ['7d', '7day', '7days']) {
    assert.equal(minutesOf(input), 10080, `${input} = سبعة أيام`);
  }
  assert.equal(minutesOf('1w'), 10080, 'أسبوع = 7 أيام');
});

test('الوحدات العربية مدعومة', () => {
  assert.equal(minutesOf('30د'), 30);
  assert.equal(minutesOf('2ساعة'), 120);
  assert.equal(minutesOf('3ايام'), 4320);
  assert.equal(minutesOf('3أيام'), 4320, 'الهمزة لا تغيّر النتيجة');
});

test('تركيب عدة وحدات معاً', () => {
  assert.equal(minutesOf('1h30m'), 90);
  assert.equal(minutesOf('2h 30m'), 150, 'المسافات تُتجاهل');
  assert.equal(minutesOf('1d2h'), 1560);
});

test('كلمات الدوام تعني بلا نهاية', () => {
  for (const word of ['دائم', 'نهائي', 'perm', 'permanent', 'forever']) {
    const result = parseDuration(word);
    assert.equal(result.ok, true, `${word} يجب أن يُفهم`);
    assert.equal(result.permanent, true, `${word} يعني دائم`);
    assert.equal(result.minutes, null);
  }
});

test('الفارغ مقبول ويعني «بلا مدة»', () => {
  for (const empty of ['', null, undefined]) {
    const result = parseDuration(empty);
    assert.equal(result.ok, true);
    assert.equal(result.minutes, null);
    assert.equal(result.permanent, false, 'الفارغ ليس «دائم» صراحةً — المعالج يقرر');
  }
});

test('المدخلات غير المفهومة تُرفض ولا تُخمَّن', () => {
  for (const bad of ['abc', '5x', '0', 'h', '-5', '2hh']) {
    assert.equal(parseDuration(bad).ok, false, `${bad} يجب أن يُرفض`);
  }
});

test('العرض بالعربية صحيح نحوياً', () => {
  assert.equal(formatDuration(null), 'دائم');
  assert.equal(formatDuration(1), 'دقيقة');
  assert.equal(formatDuration(2), 'دقيقتان');
  assert.equal(formatDuration(60), 'ساعة');
  assert.equal(formatDuration(120), 'ساعتان');
  assert.equal(formatDuration(90), 'ساعة و30 دقيقة');
  assert.equal(formatDuration(1440), 'يوم');
});

// ---------------------------------------------------------------------------
// التكامل مع تحليل البريفكس
// ---------------------------------------------------------------------------

const user = { id: '7', username: 'سالم' };
const fakeMessage = () => ({
  guild: { members: { cache: { find: () => null }, fetch: async () => ({ user, id: '7' }) },
    roles: { cache: { find: () => null } }, channels: { cache: { find: () => null } } },
  mentions: { users: { find: () => user } },
  client: { users: { fetch: async () => user } }
});
const parseBan = args => parsePrefixOptions(commandData.find(c => c.name === 'ban'), args, {}, fakeMessage());

test('خيار المدة يقبل الوحدات في البريفكس', async () => {
  for (const value of ['2h', '7d', '30', '1h30m']) {
    const result = await parseBan(['<@7>', value]);
    assert.equal(result.error, undefined, `!ban @عضو ${value} يجب أن ينجح`);
    assert.equal(result.values.duration_minutes, value);
  }
});

test('كلمة ليست مدة لا تُبتلع في خانة المدة بل تذهب للسبب', async () => {
  // قبل الإصلاح كان الخيار النصي يبتلع أول كلمة مهما كانت،
  // فيضيع السبب وتُسجَّل مدة بلا معنى.
  const result = await parseBan(['<@7>', 'سبب', 'بدون', 'مدة']);
  assert.equal(result.error, undefined);
  assert.equal(result.values.duration_minutes, undefined, 'لا مدة');
  assert.equal(result.values.reason, 'سبب بدون مدة', 'الكلمات كلها ذهبت للسبب');
});

test('المدة والسبب معاً يُفصلان صحيحاً', async () => {
  const result = await parseBan(['<@7>', '7d', 'سب', 'وشتم']);
  assert.equal(result.values.duration_minutes, '7d');
  assert.equal(result.values.reason, 'سب وشتم');
});

test('كل أوامر المدة تستعمل خياراً نصياً يقبل الوحدات', () => {
  const durationNames = new Set(['duration_minutes', 'minutes']);
  const found = [];
  for (const command of commandData) {
    const scan = (label, options) => (options || []).forEach(option => {
      if (!durationNames.has(option.name)) return;
      found.push(label);
      assert.equal(option.type, 3, `${label}.${option.name} يجب أن يكون نصياً ليقبل 2h`);
    });
    scan(command.name, command.options);
    (command.options || []).filter(o => o.type === 1).forEach(sub => scan(`${command.name} ${sub.name}`, sub.options));
  }
  assert.ok(found.length >= 3, `توقعت ثلاثة خيارات مدة على الأقل، وجدت ${found.length}`);
});
