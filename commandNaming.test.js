'use strict';
// ==========================================================================
// اختبارات سياسة «الاسم الواحد»
//
// القاعدة: لكل أمر اسم واحد فقط، يُستدعى بصيغتين لا ثالث لهما:
//     /الأمر   (سلاش)        و      !الأمر   (بريفكس)
//
// لا اختصارات، ولا أسماء عربية بديلة، ولا أسماء قديمة. هذه الاختبارات تمنع
// عودة أي منها بالخطأ عند تعديل لاحق.
// ==========================================================================
const test = require('node:test');
const assert = require('node:assert');

const {
  resolveSlashPrefixRoute,
  SLASH_COMMAND_NAMES,
  LEGACY_PREFIX_ROUTES
} = require('./slashCommandConfig');
const { commandData } = require('./slashCommands');

test('كل أمر مسجَّل يُوجَّه باسمه الرسمي', () => {
  for (const command of commandData) {
    const route = resolveSlashPrefixRoute(command.name);
    assert.ok(route, `الأمر ${command.name} لا يُوجَّه بالبريفكس!`);
    assert.equal(route.command, command.name);
  }
});

test('لا اسم عربي قديم يُوجَّه إلى أي أمر', () => {
  // LEGACY_PREFIX_ROUTES ما زال موجوداً كقائمة أسماء محجوزة ولعرض
  // «الأسماء السابقة» في اللوحة — لكنه لم يعد مصدر توجيه.
  const stillRouting = Object.keys(LEGACY_PREFIX_ROUTES)
    .filter(name => !SLASH_COMMAND_NAMES.includes(name))
    .filter(name => resolveSlashPrefixRoute(name) !== null);

  assert.deepEqual(stillRouting, [],
    `هذه الأسماء القديمة ما زالت تُوجَّه رغم إلغاء الاختصارات: ${stillRouting.join(', ')}`);
});

test('الاختصارات التي يحدّدها المالك من اللوحة تعمل', () => {
  // الاختصار قرار صاحب السيرفر: ما يكتبه في اللوحة يجب أن يُوجَّه فعلاً.
  const config = {
    globalRoleIds: [],
    commands: {
      ban: { enabled: true, aliases: ['بان', 'لف', 'برا'], roleIds: [], userIds: [] },
      role: { enabled: true, aliases: [], roleIds: [], userIds: [], giveAliases: ['اعطي'], removeAliases: ['اسحب'] }
    }
  };

  for (const alias of ['بان', 'لف', 'برا']) {
    const route = resolveSlashPrefixRoute(alias, config);
    assert.ok(route, `الاختصار «${alias}» الذي حدّده المالك يجب أن يعمل`);
    assert.equal(route.command, 'ban');
  }

  assert.equal(resolveSlashPrefixRoute('اعطي', config).subcommand, 'give');
  assert.equal(resolveSlashPrefixRoute('اسحب', config).subcommand, 'remove');
});

test('الأسماء الرسمية تُوجَّه دائماً ولو كانت اللوحة فارغة', () => {
  // الاسم الرسمي لا يعتمد على أي إعداد: يعمل حتى لو لم يحدَّد أي اختصار.
  for (const name of ['top', 'ban', 'role', 'clear', 'warn']) {
    assert.equal(resolveSlashPrefixRoute(name, { commands: {} }).command, name);
    assert.equal(resolveSlashPrefixRoute(name).command, name);
  }
});
test('الأسماء غير المعروفة لا تُوجَّه', () => {
  for (const name of ['', '   ', 'لا-يوجد', 'randomthing', 'توب']) {
    assert.equal(resolveSlashPrefixRoute(name), null);
  }
});

test('اسم الأمر غير حسّاس لحالة الأحرف ولا للمسافات', () => {
  assert.equal(resolveSlashPrefixRoute('  BAN  ').command, 'ban');
  assert.equal(resolveSlashPrefixRoute('Top').command, 'top');
});
