'use strict';

// ============================================================================
// اختبارات إيمبد الاستخدام + اختصارات فترات /top
//
// العقد المطلوب من المستخدم:
//   • الأمر الذي يفشل بسبب معطيات ناقصة/خاطئة → إيمبد استخدام غني.
//   • الأمر الذي ينفَّذ فعلاً (مثل !profile) → لا إيمبد إطلاقاً.
//   • /top يقبل الحرف أو الكلمة الإنجليزية، و!top وحده = الإجمالي.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert');

const { buildUsageEmbed, buildSyntax, buildExamples, COMMAND_PERMISSIONS } = require('./commandUsage');

// buildSyntax/buildExamples تعملان على (اسم الأمر، الأمر الفرعي، الخيارات)
const optionsOf = name => (findCommand(name).options || []);
const { parsePrefixOptions } = require('./slashPrefix');
const { commandData } = require('./slashCommands');

const findCommand = name => commandData.find(command => command.name === name);

// رسالة وهمية: لا منشنات ولا كاش، فأي خيار عضو/روم/رتبة يفشل عمداً.
const fakeMessage = () => ({
  guild: {
    members: { cache: [], fetch: async () => null },
    roles: { cache: [] },
    channels: { cache: [], fetch: async () => null }
  },
  mentions: { users: { find: () => null } },
  client: { users: { fetch: async () => null } }
});

const parse = (name, args) => parsePrefixOptions(findCommand(name), args, fakeMessage(), {});

// ---------------------------------------------------------------------------
// 1) اختصارات فترات /top
// ---------------------------------------------------------------------------

test('‏!top بدون وسائط يعطي الإجمالي افتراضياً ولا يُظهر إيمبد', async () => {
  const result = await parse('top', []);
  assert.strictEqual(result.error, undefined, 'الأمر ينفَّذ فلا يجوز ظهور إيمبد الاستخدام');
  assert.ok(!result.values.period, 'الفترة تُترك فارغة ليطبّق المعالج الإجمالي كافتراضي');
});

test('‏/top يقبل الحرف الأول والكلمة الإنجليزية الكاملة لكل فترة', async () => {
  const expected = {
    d: 'daily', day: 'daily', daily: 'daily',
    w: 'weekly', week: 'weekly', weekly: 'weekly',
    m: 'monthly', month: 'monthly', monthly: 'monthly',
    t: 'total', total: 'total'
  };
  for (const [input, period] of Object.entries(expected)) {
    const result = await parse('top', [input]);
    assert.strictEqual(result.error, undefined, `!top ${input} يجب أن ينجح`);
    assert.strictEqual(result.values.period, period, `!top ${input} يجب أن يعطي ${period}`);
  }
});

test('‏/top يقبل الصيغ العربية للفترات', async () => {
  for (const [input, period] of [['اسبوعي', 'weekly'], ['الأسبوعي', 'weekly'], ['شهري', 'monthly'], ['يومي', 'daily']]) {
    const result = await parse('top', [input]);
    assert.strictEqual(result.values.period, period, `!top ${input} يجب أن يعطي ${period}`);
  }
});

test('‏/top بقيمة غير معروفة يُظهر إيمبد الاستخدام بدل التنفيذ الصامت', async () => {
  for (const bad of ['xyz', 'wekly', 'yearly']) {
    const result = await parse('top', [bad]);
    assert.ok(result.error, `!top ${bad} يجب أن يُرفض لا أن يُنفَّذ كإجمالي`);
    assert.match(result.error, /total/, 'رسالة الخطأ تسرد القيم المقبولة');
  }
});

test('‏/top يحافظ على الأرشيف عندما تُذكر الفترة', async () => {
  const result = await parse('top', ['weekly', '2026-09']);
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.values.period, 'weekly');
  assert.strictEqual(result.values.archive, '2026-09');
});

test('مطابقة البادئة تُرفض إن كانت غامضة بين قيمتين', async () => {
  const command = {
    name: 'fake',
    options: [{ type: 3, name: 'mode', required: true, choices: [{ name: 'أ', value: 'alpha' }, { name: 'ب', value: 'alert' }] }]
  };
  const ambiguous = await parsePrefixOptions(command, ['al'], fakeMessage(), {});
  assert.ok(ambiguous.error, 'البادئة الغامضة تُرفض بدل التخمين');
  const unique = await parsePrefixOptions(command, ['alp'], fakeMessage(), {});
  assert.strictEqual(unique.values.mode, 'alpha', 'البادئة الفريدة تُقبل');
});

// ---------------------------------------------------------------------------
// 2) الإيمبد يظهر عند الفشل فقط
// ---------------------------------------------------------------------------

test('الأمر الذي ينفَّذ بلا وسائط لا يُنتج خطأ إطلاقاً', async () => {
  const silent = commandData.filter(command => {
    const options = command.options || [];
    return !options.some(option => option.type === 1) && !options.some(option => option.required);
  });
  assert.ok(silent.length >= 10, 'يجب أن توجد أوامر كثيرة بلا وسائط إلزامية');
  for (const command of silent) {
    const result = await parsePrefixOptions(command, [], fakeMessage(), {});
    assert.strictEqual(result.error, undefined, `${command.name} ينفَّذ بلا وسائط فلا يجوز إظهار إيمبد`);
  }
});

test('الأمر الذي يحتاج وسيطاً إلزامياً ولم يُعطَه يُنتج خطأ يصلح للإيمبد', async () => {
  for (const name of ['ban', 'kick', 'warn']) {
    const command = findCommand(name);
    if (!command) continue;
    const result = await parsePrefixOptions(command, [], fakeMessage(), {});
    assert.ok(result.error, `!${name} بلا وسائط يجب أن يفشل`);
  }
});

// ---------------------------------------------------------------------------
// 3) بنية الإيمبد نفسه
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 3) شكل الإيمبد المضغوط (طراز ProBot) — كل شيء في وصف واحد قصير
// ---------------------------------------------------------------------------

const descriptionOf = (name, options) =>
  buildUsageEmbed(findCommand(name), Object.assign({ reason: 'ينقص العضو' }, options)).toJSON().description;

test('الإيمبد مضغوط: وصف واحد بلا حقول منفصلة', () => {
  const embed = buildUsageEmbed(findCommand('ban'), { reason: 'ينقص العضو' }).toJSON();
  assert.ok(!embed.fields || embed.fields.length === 0, 'الشكل المضغوط لا يستعمل حقولاً منفصلة');
  assert.ok(embed.description.length > 0);
  assert.ok(embed.description.split('\n').length <= 12, 'الإيمبد يجب أن يُقرأ بنظرة واحدة بلا تمرير');
  assert.ok(embed.color, 'الإيمبد ملوّن بهوية الموقع');
});

test('الإيمبد يحوي الصيغة والمثال والاستدعاء والصلاحية', () => {
  const text = descriptionOf('ban', { aliases: ['لف'], roleIds: ['112233445566778899'] });
  assert.match(text, /<member>/, 'الصيغة تميّز الإلزامي');
  assert.match(text, /\[reason\]/, 'الصيغة تميّز الاختياري');
  assert.match(text, /الاستدعاء/, 'سطر طرق الاستدعاء');
  assert.match(text, /الصلاحية/, 'سطر الصلاحية');
});

test('سبب الفشل يظهر أولاً وبعلامة واحدة لا مكررة', () => {
  const text = descriptionOf('ban', { reason: '❌ ينقص العضو' });
  assert.ok(text.startsWith('❌ ينقص العضو'), 'السبب أول سطر وبعلامة واحدة');
  assert.ok(!text.startsWith('❌ ❌'), 'لا تتكرر العلامة');
});

test('المثال يستخدم منشن الشخص الذي أخطأ لا عبارة عامة', () => {
  const text = descriptionOf('ban', { actorMention: '<@445566778899>' });
  assert.ok(text.includes('<@445566778899>'), 'لا بد من منشن الشخص نفسه');
  assert.ok(!text.includes('@العضو'), 'لا تبقى العبارة العامة مع وجود منشن');
});

test('الاختصارات تُعرض مجرّدة لأنها تعمل بلا بريفكس', () => {
  const text = descriptionOf('ban', { aliases: ['لف', 'بان'] });
  assert.match(text, /`!ban`/, 'الاسم الرسمي يُعرض مع البريفكس');
  assert.match(text, /`لف`/, 'الاختصار يُعرض مجرّداً');
  assert.ok(!text.includes('`!لف`'), 'لا نعرض الاختصار ببريفكس لأنه يعمل مجرّداً');
});

test('الرتب تُعرض كمنشن، والصلاحية بديل عند غيابها', () => {
  const withRoles = descriptionOf('ban', { roleIds: ['112233445566778899', 'ليس-رقماً'] });
  assert.ok(withRoles.includes('<@&112233445566778899>'), 'الرتبة الصالحة تظهر');
  assert.ok(!withRoles.includes('ليس-رقماً'), 'المدخل غير الصالح لا يُعرض');
  assert.match(descriptionOf('ban', { roleIds: [] }), /حظر الأعضاء/, 'الصلاحية بديل واضح');
});

test('الأنواع الفرعية تظهر في الصيغة وفي سطر الأنواع', () => {
  const text = descriptionOf('mute', { subcommand: null });
  assert.match(text, /<text\|voice>/, 'الصيغة توضّح أن النوع مطلوب');
  assert.match(text, /الأنواع/, 'سطر الأنواع المتاحة');
  assert.ok(!/```\n!mute\n!mute\n```/.test(text), 'لا يتكرر السطر نفسه مرتين');
});

test('تلميح وحدات المدة يظهر لأوامر المدة فقط', () => {
  assert.match(descriptionOf('ban'), /2h/, 'أمر فيه مدة يعرض التلميح');
  assert.ok(!/2h/.test(descriptionOf('kick')), 'أمر بلا مدة لا يعرض تلميح المدة');
});

test('سطر القيم المحدودة يظهر لخيارات القوائم', () => {
  const text = descriptionOf('top', { reason: 'قيمة غير معروفة' });
  assert.match(text, /total/, 'القيم المقبولة معروضة');
  assert.match(text, /الحرف الأول/, 'تلميح اختصار الحرف');
});

test('جدول الصلاحيات لا يحتوي أمراً غير موجود في البوت', () => {
  const names = new Set(commandData.map(command => command.name));
  for (const name of Object.keys(COMMAND_PERMISSIONS)) {
    assert.ok(names.has(name), `${name} مذكور في جدول الصلاحيات لكنه غير موجود كأمر`);
  }
});
